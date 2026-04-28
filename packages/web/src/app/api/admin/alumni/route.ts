import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const INDUSTRY_MAP: Array<{ pattern: RegExp; industry: string }> = [
  { pattern: /mckinsey|bain|boston consulting|bcg|deloitte|accenture|kpmg|pwc|ernst|kearney|oliver wyman|booz|accordian/i, industry: 'Consulting' },
  { pattern: /goldman|j\.?p\.? morgan|jpmorgan|morgan stanley|blackstone|kkr|blackrock|point72|midcap|citadel|two sigma|bridgewater|sequoia|andreessen|a16z|insight partners|general atlantic|warburg|carlyle|apollo|bain capital|citi wealth|cravath|goodwin|latham|skadden|davis polk|weil|kirkland|cleary|white & case|wachtell|ropes|gunderson|cooley|wilson sonsini/i, industry: 'Finance' },
  { pattern: /google|meta|facebook|amazon|aws|apple|microsoft|netflix|spotify|stripe|airbnb|uber|lyft|salesforce|oracle|sap|ibm|intel|nvidia|snowflake|databricks|palantir|appLovin|twilio|figma|atlassian|slack|zoom|dropbox|github|gitlab|shopify|mongodb|confluent|datadog|splunk|cloudflare|okta|servicenow|workday|duetti|wealthkind|bluevine|solidus/i, industry: 'Tech' },
  { pattern: /\blaw\b|legal|attorney|counsel|esq\b|llp\b|litigation/i, industry: 'Law' },
  { pattern: /hospital|health|medical|med student|doctor|physician|clinic|pharma|biotech|nicklaus/i, industry: 'Healthcare' },
  { pattern: /\bnfl\b|\bnba\b|\bmlb\b|espn|sports|athletic/i, industry: 'Sports' },
  { pattern: /\bpr\b|public relations|communications|marketing|media|advertising|brand|agency|burson|edelman|sunshine sachs|gagen|ipsy|accordian/i, industry: 'Marketing / PR' },
  { pattern: /real estate|realty|cbre|jll|cushman|colliers|brookfield/i, industry: 'Real Estate' },
  { pattern: /government|senate|house|congress|policy|political|lobby|council|mayor|acypl/i, industry: 'Government / Policy' },
  { pattern: /\btax\b|accounting|audit|\bcpa\b|bookkeeping|rsm|grant thornton|bdo/i, industry: 'Accounting / Finance' },
  { pattern: /founder|co-?founder|\bceo\b|startup|entrepreneur/i, industry: 'Entrepreneurship' },
  { pattern: /bloomberg|reuters|wsj|journalism|news|reporter|editor/i, industry: 'Media / Journalism' },
  { pattern: /\bcpg\b|pepsi|coke|unilever|procter|nestle|kraft/i, industry: 'Consumer Goods' },
  { pattern: /linkedin|recruiter|talent|\bhr\b|human resources|staffing|booksource/i, industry: 'HR / Recruiting' },
];

function inferIndustry(company: string, notes: string): string {
  const text = `${company} ${notes}`;
  for (const { pattern, industry } of INDUSTRY_MAP) {
    if (pattern.test(text)) return industry;
  }
  return company ? 'Other' : '';
}

function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  const lines = content.split(/\r?\n/);
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

export const maxDuration = 60;

// GET: list all alumni with optional filters
export async function GET(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { searchParams } = new URL(req.url);
  const city = searchParams.get('city');
  const industry = searchParams.get('industry');
  const limit = parseInt(searchParams.get('limit') ?? '200');

  let q = supabase.from('alumni').select('*').order('full_name').limit(limit);
  if (city) q = q.ilike('city', `%${city}%`);
  if (industry) q = q.ilike('industry', `%${industry}%`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alumni: data ?? [], count: (data ?? []).length });
}

// POST: import CSV
export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const city = (formData.get('city') as string | null)?.trim() ?? '';

  if (!file || !city) {
    return NextResponse.json({ error: 'file and city are required' }, { status: 400 });
  }

  const content = await file.text();
  const rows = parseCSV(content);
  if (rows.length < 2) return NextResponse.json({ error: 'CSV is empty' }, { status: 400 });

  const header = rows[0].map((h) => h.toLowerCase());
  const idx = (name: string) => header.findIndex((h) => h.includes(name));

  const FB_IDX = idx('facebook');
  const FULL_IDX = idx('full name');
  const FIRST_IDX = idx('first name');
  const LAST_IDX = idx('last name');
  const COMPANY_IDX = idx('company');
  const ROLE_IDX = idx('role');
  const LINKEDIN_IDX = idx('linkedin');
  const NOTES_IDX = header.length - 1;

  const records = [];
  const errors: string[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const fullName = FULL_IDX >= 0 ? row[FULL_IDX]?.trim() : '';
    if (!fullName) continue;

    const company = COMPANY_IDX >= 0 ? row[COMPANY_IDX]?.trim() ?? '' : '';
    const role = ROLE_IDX >= 0 ? row[ROLE_IDX]?.trim() ?? '' : '';
    const notes = NOTES_IDX >= 0 ? row[NOTES_IDX]?.trim() ?? '' : '';
    const cleanNotes = notes.length > 150 ? '' : notes;

    records.push({
      full_name: fullName,
      first_name: FIRST_IDX >= 0 ? row[FIRST_IDX]?.trim() || null : null,
      last_name: LAST_IDX >= 0 ? row[LAST_IDX]?.trim() || null : null,
      city,
      company: company || null,
      role: role || null,
      industry: inferIndustry(company, cleanNotes) || null,
      facebook_url: FB_IDX >= 0 ? row[FB_IDX]?.trim() || null : null,
      linkedin_url: LINKEDIN_IDX >= 0 ? row[LINKEDIN_IDX]?.trim() || null : null,
      notes: cleanNotes || null,
    });
  }

  // Batch upsert in chunks of 50
  let inserted = 0;
  for (let i = 0; i < records.length; i += 50) {
    const batch = records.slice(i, i + 50);
    const { error } = await supabase
      .from('alumni')
      .upsert(batch, { onConflict: 'full_name,city' });
    if (error) {
      errors.push(`Batch ${Math.floor(i / 50) + 1}: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  return NextResponse.json({ inserted, total: records.length, errors });
}

// DELETE: remove an alumni by ID
export async function DELETE(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await supabase.from('alumni').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
