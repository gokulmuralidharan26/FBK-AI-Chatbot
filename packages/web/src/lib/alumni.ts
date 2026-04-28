import { supabase } from './supabase';

export interface AlumniRecord {
  id: string;
  full_name: string;
  first_name?: string | null;
  last_name?: string | null;
  city?: string | null;
  company?: string | null;
  role?: string | null;
  industry?: string | null;
  facebook_url?: string | null;
  linkedin_url?: string | null;
  notes?: string | null;
  tapping_class?: string | null;
}

export interface AlumniQuery {
  city?: string;
  industry?: string;
  company?: string;
  role?: string;
  name?: string;
}

/**
 * Detect whether a user message is an alumni networking query.
 * Returns true if the message is asking to find/connect with alumni.
 */
export function isAlumniQuery(message: string): boolean {
  const lower = message.toLowerCase();
  const triggers = [
    'alumni',
    'alum ',
    'fbk member',
    'connect me with',
    'find someone',
    'who works at',
    'who is in',
    'fbk in nyc',
    'fbk in new york',
    'fbk in tampa',
    'fbk in atlanta',
    'fbk in dc',
    'fbk in chicago',
    'fbk in miami',
    'fbk network',
    'networking',
    'referral',
    'outreach',
  ];
  return triggers.some((t) => lower.includes(t));
}

/**
 * Parse a natural-language alumni query into structured filters.
 * This is a fast heuristic approach — the LLM adds nuance on top.
 */
export function parseAlumniQuery(message: string): AlumniQuery {
  const lower = message.toLowerCase();
  const q: AlumniQuery = {};

  // City detection
  const cityMap: Record<string, string> = {
    'new york': 'New York',
    'nyc': 'New York',
    'ny ': 'New York',
    'manhattan': 'New York',
    'brooklyn': 'New York',
    'tampa': 'Tampa',
    'jacksonville': 'Jacksonville',
    'jax': 'Jacksonville',
    'atlanta': 'Atlanta',
    'atl': 'Atlanta',
    'dc': 'Washington',
    'washington': 'Washington',
    'd.c.': 'Washington',
    'chicago': 'Chicago',
    'miami': 'Miami',
    'los angeles': 'Los Angeles',
    'la ': 'Los Angeles',
    'san francisco': 'San Francisco',
    'sf ': 'San Francisco',
    'boston': 'Boston',
    'austin': 'Austin',
    'seattle': 'Seattle',
  };
  for (const [key, val] of Object.entries(cityMap)) {
    if (lower.includes(key)) { q.city = val; break; }
  }

  // Industry/role detection
  const industryMap: Record<string, string> = {
    'consulting': 'Consulting',
    'consultant': 'Consulting',
    'investment banking': 'Finance',
    'banking': 'Finance',
    'finance': 'Finance',
    'financial': 'Finance',
    'private equity': 'Finance',
    'hedge fund': 'Finance',
    'venture capital': 'Finance',
    'vc ': 'Finance',
    'tech': 'Tech',
    'technology': 'Tech',
    'software': 'Tech',
    'engineering': 'Tech',
    'product management': 'Tech',
    'product manager': 'Tech',
    'pm ': 'Tech',
    'law': 'Law',
    'legal': 'Law',
    'attorney': 'Law',
    'lawyer': 'Law',
    'marketing': 'Marketing / PR',
    'pr ': 'Marketing / PR',
    'public relations': 'Marketing / PR',
    'healthcare': 'Healthcare',
    'medical': 'Healthcare',
    'doctor': 'Healthcare',
    'real estate': 'Real Estate',
    'government': 'Government / Policy',
    'policy': 'Government / Policy',
    'politics': 'Government / Policy',
    'accounting': 'Accounting / Finance',
    'startup': 'Entrepreneurship',
    'founder': 'Entrepreneurship',
    'media': 'Media / Journalism',
    'journalism': 'Media / Journalism',
    'education': 'Education',
    'recruiting': 'HR / Recruiting',
    'hr ': 'HR / Recruiting',
  };
  for (const [key, val] of Object.entries(industryMap)) {
    if (lower.includes(key)) { q.industry = val; break; }
  }

  // Company detection — extract quoted or known names
  const companyMatch = message.match(/(?:at|@|work(?:s|ing)? (?:at|for)|employed at)\s+([A-Z][^\s,.?!]+(?:\s[A-Z][^\s,.?!]+)?)/);
  if (companyMatch) q.company = companyMatch[1];

  // Role keyword (non-industry specific)
  const roleKeywords = ['product manager', 'pm', 'engineer', 'designer', 'analyst', 'associate', 'director', 'vp', 'manager', 'partner', 'associate'];
  for (const kw of roleKeywords) {
    if (lower.includes(kw)) { q.role = kw; break; }
  }

  return q;
}

/**
 * Search alumni by structured filters.
 * Returns up to 20 matching records.
 */
export async function searchAlumni(query: AlumniQuery, limit = 20): Promise<AlumniRecord[]> {
  let q = supabase.from('alumni').select('*');

  if (query.city) {
    q = q.ilike('city', `%${query.city}%`);
  }
  if (query.industry) {
    // Allow partial match so "Tech" hits "Tech" and "Finance" hits "Finance / Accounting"
    q = q.ilike('industry', `%${query.industry.split('/')[0].trim()}%`);
  }
  if (query.company) {
    q = q.ilike('company', `%${query.company}%`);
  }
  if (query.name) {
    q = q.ilike('full_name', `%${query.name}%`);
  }

  // If role is product-management-specific, also search company/role columns
  if (query.role) {
    q = q.or(`role.ilike.%${query.role}%,notes.ilike.%${query.role}%,company.ilike.%${query.role}%`);
  }

  q = q.order('full_name').limit(limit);

  const { data, error } = await q;
  if (error) {
    console.error('Alumni search error:', error);
    return [];
  }
  return (data ?? []) as AlumniRecord[];
}

/**
 * Format an alumni result list into a readable string for the LLM context.
 */
export function formatAlumniResults(alumni: AlumniRecord[], query: AlumniQuery): string {
  if (alumni.length === 0) {
    const location = query.city ? ` in ${query.city}` : '';
    const industry = query.industry ? ` in ${query.industry}` : '';
    return `No FBK alumni found${location}${industry} in the database yet. The alumni database is still growing — you can add more alumni via the admin panel.`;
  }

  const lines = alumni.map((a) => {
    const parts: string[] = [`**${a.full_name}**`];
    if (a.role && a.company) parts.push(`${a.role} at ${a.company}`);
    else if (a.company) parts.push(a.company);
    else if (a.role) parts.push(a.role);
    if (a.industry) parts.push(`[${a.industry}]`);
    if (a.city) parts.push(`📍 ${a.city}`);
    const links: string[] = [];
    if (a.facebook_url) links.push(`[Facebook](${a.facebook_url})`);
    if (a.linkedin_url) links.push(`[LinkedIn](${a.linkedin_url})`);
    if (links.length) parts.push(links.join(' · '));
    return `- ${parts.join(' · ')}`;
  });

  const location = query.city ? ` in ${query.city}` : '';
  const industry = query.industry ? ` in ${query.industry}` : '';
  return `Found ${alumni.length} FBK alumni${location}${industry}:\n\n${lines.join('\n')}`;
}
