/**
 * Import alumni from a CSV file into Supabase.
 *
 * Usage:
 *   npx tsx import-alumni.ts <path-to-csv> <city>
 *
 * Example:
 *   npx tsx import-alumni.ts ../../downloads/facebook-nyc.csv "New York, NY"
 *
 * CSV format expected (header row):
 *   Facebook URL, Full Name, First Name, Last Name, <ignored>, Company, Role, <notes>
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ── Industry inference from company name ────────────────────────────────────
const INDUSTRY_MAP: Array<{ patterns: RegExp; industry: string }> = [
  { patterns: /mckinsey|bain|boston consulting|bcg|deloitte|accenture|kpmg|pwc|ernst|kearney|oliver wyman|booz|strategy&|roland berger|accordian/i, industry: 'Consulting' },
  { patterns: /goldman|j\.?p\.? morgan|jpmorgan|morgan stanley|blackstone|kkr|blackrock|point72|midcap|midcap|citadel|two sigma|bridgewater|sequoia|andreessen|a16z|insight partners|general atlantic|warburg|carlyle|apollo|bain capital|citi wealth|cravath|goodwin|latham|skadden|davis polk|weil|kirkland|cleary|white & case|wachtell|ropes|gunderson|cooley|wilson sonsini/i, industry: 'Finance' },
  { patterns: /google|meta|facebook|amazon|aws|apple|microsoft|netflix|spotify|stripe|airbnb|uber|lyft|salesforce|oracle|sap|ibm|intel|nvidia|snowflake|databricks|palantir|appLovin|twilio|figma|atlassian|slack|zoom|dropbox|github|gitlab|shopify|mongodb|confluent|datadog|splunk|cloudflare|okta|servicenow|workday|veeva|zendesk|hubspot|duetti|wealthkind|bluevine|solidus/i, industry: 'Tech' },
  { patterns: /law|legal|attorney|counsel|esq\b|llp\b|l\.l\.p|bar |firm|litigation|judiciary/i, industry: 'Law' },
  { patterns: /hospital|health|medical|med student|doctor|physician|clinic|pharma|biotech|bioscience|nicklaus|johnson & johnson|pfizer|merck|moderna|abbvie|genentech|roche|novartis|astrazeneca|bristol|lilly|amgen|gilead|regeneron/i, industry: 'Healthcare' },
  { patterns: /nfl|nba|mlb|nhl|espn|sports|athletic|league|team|stadium|champion|olympic/i, industry: 'Sports' },
  { patterns: /pr\b|public relations|communications|marketing|media|advertising|brand|agency|publicis|wpp|omnicom|ipg|burson|edelman|sunshine sachs|gagen|mccann|ogilvy|bbdo/i, industry: 'Marketing / PR' },
  { patterns: /real estate|realty|cbre|jll|cushman|colliers|brookfield|related|equity residential|essex|avalonbay|lease|landlord/i, industry: 'Real Estate' },
  { patterns: /government|senate|house|congress|policy|political|state department|white house|lobby|council|mayor|commissioner|acypl|legislat/i, industry: 'Government / Policy' },
  { patterns: /education|university|college|school|teach|professor|academic|curriculum|edtech|coursera|khan/i, industry: 'Education' },
  { patterns: /tax|accounting|audit|cpa|bookkeeping|financial planning|wealth management|rsm|grant thornton|bdo|crowe/i, industry: 'Accounting / Finance' },
  { patterns: /founder|co-?founder|ceo|startup|venture|entrepreneur|incubator|accelerator/i, industry: 'Entrepreneurship' },
  { patterns: /bloomberg|reuters|wsj|new york times|nyt|journalism|news|reporter|editor|journalist|media/i, industry: 'Media / Journalism' },
  { patterns: /cpg|consumer|pepsi|coke|unilever|procter|nestle|kraft|heinz|mondelez|colgate|revlon|loreal|lvmh/i, industry: 'Consumer Goods' },
  { patterns: /linkedin|recruiter|talent|hr\b|human resources|staffing|hiring|booksource/i, industry: 'HR / Recruiting' },
];

function inferIndustry(company: string, notes: string): string {
  const text = `${company} ${notes}`.toLowerCase();
  for (const { patterns, industry } of INDUSTRY_MAP) {
    if (patterns.test(text)) return industry;
  }
  return company ? 'Other' : '';
}

// ── CSV parser (handles quoted fields) ──────────────────────────────────────
function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    rows.push(fields);
  }
  return rows;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const [,, csvPath, city] = process.argv;
if (!csvPath || !city) {
  console.error('Usage: npx tsx import-alumni.ts <csv-path> <city>');
  console.error('  e.g.: npx tsx import-alumni.ts ~/Downloads/facebook.csv "New York, NY"');
  process.exit(1);
}

const raw = readFileSync(csvPath, 'utf-8');
const rows = parseCSV(raw);
const header = rows[0];
console.log(`CSV columns: ${header.join(' | ')}`);
console.log(`City: ${city}`);
console.log(`Rows: ${rows.length - 1}`);

// Map header → index
const idx = (name: string) => header.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
const FB_IDX = idx('facebook');
const FULL_IDX = idx('full name');
const FIRST_IDX = idx('first name');
const LAST_IDX = idx('last name');
const COMPANY_IDX = idx('company');
const ROLE_IDX = idx('role');
// "Helpful" notes are usually in the last column
const NOTES_IDX = header.length - 1;

let inserted = 0;
let skipped = 0;
const errors: string[] = [];

for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  const fullName = row[FULL_IDX]?.trim() ?? '';
  if (!fullName) { skipped++; continue; }

  const company = COMPANY_IDX >= 0 ? row[COMPANY_IDX]?.trim() ?? '' : '';
  const role    = ROLE_IDX >= 0    ? row[ROLE_IDX]?.trim() ?? ''    : '';
  const notes   = NOTES_IDX >= 0   ? row[NOTES_IDX]?.trim() ?? ''   : '';

  // Skip if notes column looks like a pre-written outreach message (long)
  const cleanNotes = notes.length > 100 ? '' : notes;

  const industry = inferIndustry(company, cleanNotes);

  const record = {
    full_name:    fullName,
    first_name:   FIRST_IDX >= 0 ? row[FIRST_IDX]?.trim() : undefined,
    last_name:    LAST_IDX >= 0  ? row[LAST_IDX]?.trim()  : undefined,
    city,
    company:      company || null,
    role:         role || null,
    industry:     industry || null,
    facebook_url: FB_IDX >= 0 ? row[FB_IDX]?.trim() || null : null,
    notes:        cleanNotes || null,
  };

  const { error } = await supabase
    .from('alumni')
    .upsert(record, { onConflict: 'full_name,city' });

  if (error) {
    errors.push(`Row ${r} (${fullName}): ${error.message}`);
  } else {
    inserted++;
    const ind = industry ? ` [${industry}]` : '';
    const co = company ? ` @ ${company}` : '';
    console.log(`  ✓ ${fullName}${co}${ind}`);
  }
}

console.log(`\nDone: ${inserted} inserted/updated, ${skipped} skipped, ${errors.length} errors`);
if (errors.length) console.log('Errors:', errors.join('\n'));
