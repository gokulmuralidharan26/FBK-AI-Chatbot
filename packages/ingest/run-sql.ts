/**
 * Run arbitrary SQL against the Supabase project via the Management API.
 *
 * Usage:
 *   npx tsx run-sql.ts "SELECT COUNT(*) FROM alumni"
 *   npx tsx run-sql.ts --file ../../supabase/migrations/003_alumni.sql
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

const PAT = process.env.SUPABASE_PAT!;
const PROJECT = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace('https://', '').split('.')[0];

if (!PAT) { console.error('SUPABASE_PAT not set in .env.local'); process.exit(1); }

const args = process.argv.slice(2);
let sql: string;

if (args[0] === '--file') {
  sql = readFileSync(args[1], 'utf-8');
} else {
  sql = args.join(' ');
}

if (!sql.trim()) { console.error('No SQL provided'); process.exit(1); }

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});

const data = await res.json();
if (!res.ok) {
  console.error('SQL error:', JSON.stringify(data, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
