/**
 * Enriches all FBK tapping class members with current location, company,
 * role, and LinkedIn URL via the People Data Labs (PDL) Person Enrichment API.
 *
 * Prerequisites:
 *   1. Sign up free at https://peopledatalabs.com  (1,000 lookups/month free)
 *   2. Add PDL_API_KEY to packages/web/.env.local
 *   3. Run: npx tsx enrich-alumni.ts
 *
 * The script is safe to re-run — it skips names that already have enriched data
 * and only fills in fields that are currently empty.
 *
 * Usage:
 *   npx tsx enrich-alumni.ts              # enrich all un-enriched members
 *   npx tsx enrich-alumni.ts --dry-run    # preview without writing to DB
 *   npx tsx enrich-alumni.ts --limit 50   # process only first N names
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

const PDL_KEY = process.env.PDL_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!PDL_KEY) {
  console.error('❌  PDL_API_KEY is not set in packages/web/.env.local');
  console.error('   Sign up free at https://peopledatalabs.com and add your key.');
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit=') || a === '--limit');
const LIMIT = limitArg
  ? parseInt(limitArg.includes('=') ? limitArg.split('=')[1] : args[args.indexOf('--limit') + 1])
  : Infinity;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ── Helpers ───────────────────────────────────────────────────────────────────

const RATE_LIMIT_MS = 700; // ~85 calls/min to stay under free-tier 100/min limit
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PDLPerson {
  full_name?: string;
  job_company_name?: string;
  job_title?: string;
  location_locality?: string;   // city
  location_region?: string;     // state
  location_country?: string;
  industry?: string;
  linkedin_url?: string;
}

interface PDLResponse {
  status: number;
  data?: PDLPerson;
  error?: { type: string; message: string };
}

async function lookupPerson(name: string): Promise<PDLPerson | null> {
  const params = new URLSearchParams({
    name,
    school: 'university of florida',
    min_likelihood: '6',   // require high confidence match
    pretty: 'false',
  });

  const res = await fetch(`https://api.peopledatalabs.com/v5/person/enrich?${params}`, {
    headers: { 'X-Api-Key': PDL_KEY! },
  });

  const json: PDLResponse = await res.json();

  if (json.status === 200 && json.data) return json.data;
  if (json.status === 404) return null; // no match — expected for many names
  if (json.status === 402) {
    console.error('\n⚠️  PDL quota exhausted. Re-run tomorrow or upgrade your plan.');
    process.exit(1);
  }
  if (json.status === 401) {
    console.error('\n❌  PDL API key is invalid. Check PDL_API_KEY in .env.local.');
    process.exit(1);
  }
  // Any other error — log and skip
  console.warn(`  PDL ${json.status} for "${name}": ${json.error?.message ?? 'unknown error'}`);
  return null;
}

function titleCase(s?: string): string {
  if (!s) return '';
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

// Normalize PDL industry labels to our standard tags
const PDL_INDUSTRY_MAP: Record<string, string> = {
  'computer software': 'Tech',
  'information technology and services': 'Tech',
  'internet': 'Tech',
  'semiconductors': 'Tech',
  'computer hardware': 'Tech',
  'financial services': 'Finance',
  'investment banking': 'Finance',
  'investment management': 'Finance',
  'venture capital & private equity': 'Finance',
  'law practice': 'Law',
  'legal services': 'Law',
  'management consulting': 'Consulting',
  'hospital & health care': 'Healthcare',
  'medical practice': 'Healthcare',
  'pharmaceuticals': 'Healthcare',
  'biotechnology': 'Healthcare',
  'marketing and advertising': 'Marketing / PR',
  'public relations and communications': 'Marketing / PR',
  'real estate': 'Real Estate',
  'government administration': 'Government / Policy',
  'political organization': 'Government / Policy',
  'accounting': 'Accounting / Finance',
  'entertainment': 'Media / Journalism',
  'media production': 'Media / Journalism',
  'newspapers': 'Media / Journalism',
  'broadcast media': 'Media / Journalism',
  'education management': 'Education',
  'higher education': 'Education',
  'human resources': 'HR / Recruiting',
  'staffing and recruiting': 'HR / Recruiting',
  'consumer goods': 'Consumer Goods',
  'retail': 'Consumer Goods',
  'sports': 'Sports',
};

function normalizeIndustry(pdlIndustry?: string): string {
  if (!pdlIndustry) return '';
  return PDL_INDUSTRY_MAP[pdlIndustry.toLowerCase()] ?? titleCase(pdlIndustry);
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\nFBK Alumni Enrichment via People Data Labs`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
if (LIMIT !== Infinity) console.log(`Limit: first ${LIMIT} names`);
console.log('');

// 1. Fetch all tapping class member names from document_chunks
console.log('Loading tapping class names from database…');
const allNames: Array<{ name: string; tappingClass: string }> = [];
let from = 0;
while (true) {
  const { data } = await supabase
    .from('document_chunks')
    .select('content')
    .ilike('content', '%was inducted into Florida Blue Key%')
    .range(from, from + 999);
  if (!data || data.length === 0) break;
  for (const chunk of data) {
    const m = chunk.content.match(/^(.+?)\s+was inducted into Florida Blue Key in the (.+?)\./);
    if (m) allNames.push({ name: m[1].trim(), tappingClass: m[2].trim() });
  }
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`Found ${allNames.length} tapping class members\n`);

// 2. Find which names already have enriched data (skip them to save quota)
const { data: existing } = await supabase
  .from('alumni')
  .select('full_name, enriched_at')
  .not('enriched_at', 'is', null);

const alreadyEnriched = new Set(
  (existing ?? []).map((r) => r.full_name.toLowerCase().trim())
);
console.log(`Already enriched: ${alreadyEnriched.size} (will skip)`);

const toProcess = allNames.filter(
  ({ name }) => !alreadyEnriched.has(name.toLowerCase().trim())
);
const capped = toProcess.slice(0, LIMIT === Infinity ? toProcess.length : LIMIT);
console.log(`To process: ${capped.length} names\n`);

if (capped.length === 0) {
  console.log('✅  Nothing to enrich. All names are already up to date.');
  process.exit(0);
}

// 3. Enrich each name
let matched = 0;
let skipped = 0;
let errors = 0;

for (let i = 0; i < capped.length; i++) {
  const { name, tappingClass } = capped[i];
  const pct = Math.round(((i + 1) / capped.length) * 100);
  process.stdout.write(`[${i + 1}/${capped.length}] ${pct}% — "${name}"… `);

  let person: PDLPerson | null = null;
  try {
    person = await lookupPerson(name);
  } catch (e) {
    console.log(`ERROR: ${(e as Error).message}`);
    errors++;
    await sleep(RATE_LIMIT_MS);
    continue;
  }

  if (!person) {
    console.log('no match');
    skipped++;

    // Still upsert with just the tapping class so we track coverage
    if (!DRY_RUN) {
      await supabase.from('alumni').upsert({
        full_name: name,
        tapping_class: tappingClass,
        enriched_at: new Date().toISOString(),
        enrichment_source: 'pdl',
      }, { onConflict: 'full_name,city' });
    }
  } else {
    const city = titleCase(person.location_locality);
    const state = titleCase(person.location_region);
    const company = titleCase(person.job_company_name);
    const role = titleCase(person.job_title);
    const industry = normalizeIndustry(person.industry);
    const linkedinUrl = person.linkedin_url
      ? (person.linkedin_url.startsWith('http') ? person.linkedin_url : `https://${person.linkedin_url}`)
      : null;

    console.log(`✓ ${city || '?'}, ${state || '?'} | ${company || '?'} | ${role || '?'}`);
    matched++;

    if (!DRY_RUN) {
      await supabase.from('alumni').upsert({
        full_name: name,
        tapping_class: tappingClass,
        city: city || null,
        state: state || null,
        company: company || null,
        role: role || null,
        industry: industry || null,
        linkedin_url: linkedinUrl,
        enriched_at: new Date().toISOString(),
        enrichment_source: 'pdl',
      }, { onConflict: 'full_name,city' });
    }
  }

  await sleep(RATE_LIMIT_MS);
}

console.log('\n' + '─'.repeat(50));
console.log(`✅  Done`);
console.log(`   Matched:   ${matched}/${capped.length} (${Math.round((matched / capped.length) * 100)}%)`);
console.log(`   No match:  ${skipped}`);
console.log(`   Errors:    ${errors}`);
if (DRY_RUN) console.log('\n   (Dry run — nothing written to database)');
