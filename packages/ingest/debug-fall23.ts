import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

const fileId = '1OkHXrwOeIv_jFBnMSmBuhitzXnBr-yrA'; // FBK Fall 2023
const res = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, {
  headers: { 'User-Agent': 'Mozilla/5.0' },
  signal: AbortSignal.timeout(12000),
});
const buf = Buffer.from(await res.arrayBuffer());
const parsed = await pdfParse(buf);

console.log('=== RAW PDF TEXT ===');
console.log(repr(parsed.text));

function repr(s: string) {
  return s.split('\n').map((line, i) => `${i.toString().padStart(3,'0')}| ${JSON.stringify(line)}`).join('\n');
}
