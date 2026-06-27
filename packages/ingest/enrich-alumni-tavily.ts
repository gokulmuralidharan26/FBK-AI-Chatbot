/**
 * Enriches FBK alumni using Tavily web search + Gemini extraction.
 *
 * Unlike the PDL script, this uses no paid quota beyond Tavily's free tier.
 * It's ideal for enriching the names PDL couldn't find (no LinkedIn profile,
 * recent grads, etc.) and for re-running without waiting for PDL quota reset.
 *
 * Flow for each name:
 *   1. Tavily search: "<name> Florida Blue Key LinkedIn job location"
 *   2. Gemini extracts: { company, role, location, linkedin_url, confidence }
 *   3. (Optional) PDL lookup if PDL_API_KEY present and Gemini confidence < 0.75
 *   4. Upsert into alumni table if confidence > 0.6
 *
 * Usage:
 *   npx tsx enrich-alumni-tavily.ts              # enrich all un-enriched
 *   npx tsx enrich-alumni-tavily.ts --dry-run    # preview without writing
 *   npx tsx enrich-alumni-tavily.ts --limit=50   # process only first 50
 *
 *   # Use a specific list instead of the full DB:
 *   npx tsx enrich-alumni-tavily.ts --names "John Doe,Jane Smith,Bob Jones"
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { tavily as tavilyClient } from '@tavily/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TAVILY_KEY     = process.env.TAVILY_API_KEY;
const PDL_KEY        = process.env.PDL_API_KEY;
const NAVIGATOR_KEY  = process.env.NAVIGATOR_API_KEY;
const NAVIGATOR_URL  = process.env.NAVIGATOR_BASE_URL;
const MIN_CONFIDENCE = 0.6;

if (!TAVILY_KEY)    { console.error('❌  TAVILY_API_KEY not set in .env.local'); process.exit(1); }
if (!NAVIGATOR_KEY) { console.error('❌  NAVIGATOR_API_KEY not set in .env.local'); process.exit(1); }

const supabase   = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const navigator  = new OpenAI({ apiKey: NAVIGATOR_KEY, baseURL: NAVIGATOR_URL });
const tavily     = tavilyClient({ apiKey: TAVILY_KEY! });

// ── CLI args ──────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2);
const DRY_RUN   = args.includes('--dry-run');
const limitArg  = args.find(a => a.startsWith('--limit'));
const LIMIT     = limitArg
  ? parseInt(limitArg.includes('=') ? limitArg.split('=')[1] : args[args.indexOf('--limit') + 1])
  : Infinity;
const namesArg  = args.find(a => a.startsWith('--names'));
const CLI_NAMES = namesArg
  ? (namesArg.includes('=') ? namesArg.split('=')[1] : args[args.indexOf('--names') + 1])
      .split(',').map(n => n.trim()).filter(Boolean)
  : null;

// ── Test data (used when running without a DB, per spec) ─────────────────────

const TEST_NAMES = [
  'John Doe University of Florida',
  'Jane Smith Florida Blue Key',
  'Michael Johnson UF FBK',
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnrichedProfile {
  name: string;
  company: string | null;
  role: string | null;
  location: string | null;
  linkedin_url: string | null;
  confidence: number;
  source: string;
}

// ── Tavily search ─────────────────────────────────────────────────────────────

async function tavilySearch(name: string): Promise<string> {
  try {
    const result = await tavily.search(
      `"${name}" "Florida Blue Key" LinkedIn job location`,
      { maxResults: 5, searchDepth: 'basic', includeAnswer: true }
    );

    // Combine answer + snippet text into one context block
    const snippets = (result.results ?? [])
      .map((r: { title: string; url: string; content: string }) =>
        `[${r.title}](${r.url})\n${r.content}`)
      .join('\n\n');

    return [result.answer ?? '', snippets].filter(Boolean).join('\n\n').slice(0, 3000);
  } catch (err) {
    console.warn(`  Tavily error for "${name}": ${(err as Error).message}`);
    return '';
  }
}

// ── LLM extraction (NaviGator) ────────────────────────────────────────────────

async function llmExtract(name: string, context: string): Promise<EnrichedProfile | null> {
  const prompt = `You are extracting professional profile data for a Florida Blue Key (FBK) alumni named "${name}".

Based ONLY on the web search results below, extract their current professional information.
You MUST always respond with a valid JSON object — even if you find no information.

Return ONLY this JSON (no markdown, no explanation):
{
  "name": "${name}",
  "company": "current employer name, or null",
  "role": "current job title, or null",
  "location": "City, State format, or null",
  "linkedin_url": "full https://linkedin.com/in/... URL, or null",
  "confidence": <number 0.0–1.0>
}

Confidence guide:
- 0.0  → person not found or completely ambiguous
- 0.3  → found someone with this name but unsure if it's the FBK member
- 0.6  → reasonably confident this is the right person
- 0.85 → confident — name + UF/FBK context match
- 0.95 → very confident — "Florida Blue Key" explicitly mentioned

Search results:
${context || '(no results found)'}`;

  try {
    const res = await navigator.chat.completions.create({
      model: 'gpt-oss-20b',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 300,
    });
    const text = res.choices[0]?.message?.content?.trim() ?? '';
    const jsonMatch = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const parsed = JSON.parse(jsonMatch[0]) as EnrichedProfile;
    parsed.source = 'tavily+navigator';
    return parsed;
  } catch (err) {
    console.warn(`  LLM error for "${name}": ${(err as Error).message}`);
    return null;
  }
}

// ── PDL enrichment (optional enhancement) ─────────────────────────────────────

async function pdlLookup(name: string): Promise<Partial<EnrichedProfile> | null> {
  if (!PDL_KEY) return null;
  try {
    const params = new URLSearchParams({
      name,
      school: 'university of florida',
      min_likelihood: '7',
    });
    const res  = await fetch(`https://api.peopledatalabs.com/v5/person/enrich?${params}`,
      { headers: { 'X-Api-Key': PDL_KEY } });
    const data = await res.json();
    if (data.status !== 200 || !data.data) return null;
    const p = data.data;
    return {
      company:      p.job_company_name ?? null,
      role:         p.job_title ?? null,
      location:     [p.location_locality, p.location_region].filter(Boolean).join(', ') || null,
      linkedin_url: p.linkedin_url ? (p.linkedin_url.startsWith('http') ? p.linkedin_url : `https://${p.linkedin_url}`) : null,
      confidence:   0.85,
      source:       'pdl',
    };
  } catch {
    return null;
  }
}

// ── Upsert into alumni table ───────────────────────────────────────────────────

async function upsertProfile(profile: EnrichedProfile) {
  const locParts = (profile.location ?? '').split(',').map(s => s.trim());
  const city     = locParts[0] || null;
  const state    = locParts[1] || null;

  const payload = {
    company:           profile.company,
    role:              profile.role,
    city,
    state,
    linkedin_url:      profile.linkedin_url,
    confidence:        profile.confidence,
    enrichment_source: profile.source,
    enriched_at:       new Date().toISOString(),
  };

  // Find existing row by name (case-insensitive)
  const { data: existing } = await supabase
    .from('alumni')
    .select('id')
    .ilike('full_name', profile.name)
    .limit(1);

  if (existing?.[0]) {
    // Update the existing row
    await supabase.from('alumni').update(payload).eq('id', existing[0].id);
  } else {
    // Insert a new row
    await supabase.from('alumni').insert({ full_name: profile.name, ...payload });
  }
}

// ── Load names to process ─────────────────────────────────────────────────────

async function loadNames(): Promise<string[]> {
  if (CLI_NAMES) return CLI_NAMES;

  // Load un-enriched tapping class members from DB
  let from = 0;
  const names: string[] = [];
  while (true) {
    const { data } = await supabase
      .from('document_chunks')
      .select('content')
      .ilike('content', '%inducted into Florida Blue Key%')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const chunk of data) {
      const m = chunk.content.match(/^(.+?) was inducted into Florida Blue Key/);
      if (m) names.push(m[1].trim());
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  // Skip names that already have enrichment with high confidence
  const { data: alreadyDone } = await supabase
    .from('alumni')
    .select('full_name')
    .not('enriched_at', 'is', null)
    .gte('confidence', MIN_CONFIDENCE);

  const done = new Set((alreadyDone ?? []).map(r => r.full_name.toLowerCase()));
  return names.filter(n => !done.has(n.toLowerCase()));
}

// ── Main ──────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

console.log(`\nFBK Alumni Enrichment — Tavily + Gemini`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
if (PDL_KEY) console.log('PDL: enabled (used as enhancement when confidence < 0.75)');
console.log('');

let names = await loadNames();

// Fall back to test data if DB is empty
if (names.length === 0) {
  console.log('No unenriched names in DB — using test data\n');
  names = TEST_NAMES;
}

if (LIMIT !== Infinity) names = names.slice(0, LIMIT);
console.log(`Processing ${names.length} names\n`);

let enriched  = 0;
let skipped   = 0;
let noMatch   = 0;

for (let i = 0; i < names.length; i++) {
  const name = names[i];
  const pct  = Math.round(((i + 1) / names.length) * 100);
  console.log(`[${i + 1}/${names.length}] ${pct}% — "${name}"`);

  // Step 1: Tavily search
  const context = await tavilySearch(name);

  // Step 2: LLM extraction
  let profile = await llmExtract(name, context);
  if (!profile) { skipped++; await sleep(500); continue; }

  // Step 3: Optional PDL enhancement
  if (PDL_KEY && profile.confidence < 0.75) {
    const pdl = await pdlLookup(name);
    if (pdl && (pdl.confidence ?? 0) > profile.confidence) {
      profile = { ...profile, ...pdl, name, source: 'pdl+tavily' };
      console.log(`  → PDL improved: ${profile.company ?? '?'} | ${profile.location ?? '?'}`);
    }
  }

  const conf = profile.confidence.toFixed(2);

  if (profile.confidence < MIN_CONFIDENCE) {
    console.log(`  → Skip (confidence ${conf} < ${MIN_CONFIDENCE}): no reliable match found`);
    noMatch++;
    await sleep(500);
    continue;
  }

  console.log(`  ✓ conf=${conf} | ${profile.company ?? '—'} · ${profile.role ?? '—'} | ${profile.location ?? '—'}`);
  if (profile.linkedin_url) console.log(`    LinkedIn: ${profile.linkedin_url}`);

  enriched++;
  if (!DRY_RUN) await upsertProfile(profile);

  await sleep(600); // stay within Tavily free-tier rate limits
}

console.log('\n' + '─'.repeat(50));
console.log(`✅  Done`);
console.log(`   Enriched:   ${enriched}/${names.length}`);
console.log(`   Low conf:   ${noMatch} (skipped — confidence < ${MIN_CONFIDENCE})`);
console.log(`   Errors:     ${skipped}`);
if (DRY_RUN) console.log('\n   (Dry run — nothing written to database)');
