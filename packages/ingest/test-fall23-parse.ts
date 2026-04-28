import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

function splitFusedNames(line: string): string[] {
  const split = line.replace(/([a-záàâãéèêíïóôõöúüñç])([A-ZÁÀÂÃÉÈÍÏÓÔÕÖÚÜÑÇ])/g, '$1\u0000$2');
  const parts = split.split('\u0000').map((s) => s.trim()).filter((s) => s.length > 2);
  return parts.filter((p) => /^[A-ZÁÀÂÃÉÈÍÏÓÔÕÖÚÜÑÇ]/.test(p) && p.split(' ').length >= 2 && p.split(' ').length <= 5);
}

const nameRe = /^([A-Z][a-zA-Záàâãéèêíïóôõöúüñç'\-]+(?:\s[A-Z][a-zA-Záàâãéèêíïóôõöúüñç'\-]+)+)$/;
const lastFirstRe = /^([A-Z][a-zA-Záàâãéèêíïóôõöúüñç'\-]+),\s*([A-Z][a-zA-Záàâãéèêíïóôõöúüñç'\-]+.*)$/;

const fileId = '1OkHXrwOeIv_jFBnMSmBuhitzXnBr-yrA';
const res = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
const buf = Buffer.from(await res.arrayBuffer());
const parsed = await pdfParse(buf);

const names = new Set<string>();
for (const line of parsed.text.split('\n').map(l => l.trim()).filter(l => l.length > 0)) {
  if (line.length > 8 && /[a-z][A-Z]/.test(line)) {
    const parts = splitFusedNames(line);
    if (parts.length > 1) { parts.forEach(p => names.add(p)); continue; }
  }
  const lastFirst = line.match(lastFirstRe);
  if (lastFirst) { names.add(`${lastFirst[2].trim()} ${lastFirst[1].trim()}`); continue; }
  const words = line.split(' ');
  if (words.length >= 2 && words.length <= 5 && nameRe.test(line)) names.add(line);
}

console.log(`Extracted ${names.size} names:`);
[...names].sort().forEach(n => console.log(' ', n));
console.log('\nKrish found:', names.has('Krish Talati'));
