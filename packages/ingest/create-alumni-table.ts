import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

// We can't run DDL via supabase-js REST API directly.
// Instead, use the Supabase Management API's database query endpoint.
// We'll use the postgres.js client or fetch directly to the Postgres connection.

// Actually, let's use the fact that Supabase exposes a SQL endpoint via the Management API.
// The project ref is mfvoejliyjahnzwbxggf.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// The SQL to run
const SQL = `
create table if not exists alumni (
  id           uuid        primary key default uuid_generate_v4(),
  full_name    text        not null,
  first_name   text,
  last_name    text,
  city         text,
  company      text,
  role         text,
  industry     text,
  facebook_url text,
  linkedin_url text,
  notes        text,
  tapping_class text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique(full_name, city)
);

alter table alumni enable row level security;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'service role full access alumni' AND polrelid = 'alumni'::regclass) THEN
    CREATE POLICY "service role full access alumni" ON alumni FOR ALL USING (auth.role() = 'service_role');
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'anon can read alumni' AND polrelid = 'alumni'::regclass) THEN
    CREATE POLICY "anon can read alumni" ON alumni FOR SELECT USING (true);
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;
`;

// Use Supabase's pg-meta admin endpoint
const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];
const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
  },
  body: JSON.stringify({ query: SQL }),
});

if (res.ok) {
  console.log('✓ alumni table created');
} else {
  const err = await res.text();
  console.log('Management API failed:', res.status, err.slice(0, 200));
  console.log('\nPlease run the SQL in supabase/migrations/003_alumni.sql manually in the Supabase SQL Editor.');
}
