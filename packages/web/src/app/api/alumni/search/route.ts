/**
 * GET /api/alumni/search
 *
 * Public alumni search endpoint.
 * Accepts query params: location, industry, company, name, tapping_class
 *
 * Example:
 *   /api/alumni/search?location=New York&industry=Tech
 *   /api/alumni/search?company=Google
 *   /api/alumni/search?location=NYC&industry=finance&limit=10
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { searchParams } = new URL(req.url);
  const location     = searchParams.get('location');
  const industry     = searchParams.get('industry');
  const company      = searchParams.get('company');
  const name         = searchParams.get('name');
  const tapping      = searchParams.get('tapping_class');
  const limit        = Math.min(parseInt(searchParams.get('limit') ?? '20'), 100);
  const minConf      = parseFloat(searchParams.get('min_confidence') ?? '0');

  let q = supabase
    .from('alumni')
    .select('full_name, company, role, city, state, industry, tapping_class, linkedin_url, facebook_url, confidence')
    .order('full_name')
    .limit(limit);

  // Location: match either city or state
  if (location) {
    q = q.or(`city.ilike.%${location}%,state.ilike.%${location}%`);
  }

  // Industry: partial match (e.g. "Tech" matches "Tech" and "Entrepreneurship")
  if (industry) {
    q = q.ilike('industry', `%${industry.split('/')[0].trim()}%`);
  }

  if (company) {
    q = q.ilike('company', `%${company}%`);
  }

  if (name) {
    q = q.ilike('full_name', `%${name}%`);
  }

  if (tapping) {
    q = q.ilike('tapping_class', `%${tapping}%`);
  }

  // Only return results with sufficient confidence (when enriched via Tavily/PDL)
  if (minConf > 0) {
    q = q.or(`confidence.gte.${minConf},confidence.is.null`);
  }

  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = (data ?? []).map((a) => ({
    name:          a.full_name,
    company:       a.company ?? null,
    role:          a.role ?? null,
    location:      [a.city, a.state].filter(Boolean).join(', ') || null,
    industry:      a.industry ?? null,
    tapping_class: a.tapping_class ?? null,
    linkedin_url:  a.linkedin_url ?? null,
    facebook_url:  a.facebook_url ?? null,
    confidence:    a.confidence ?? null,
  }));

  return NextResponse.json({ results, count: results.length });
}
