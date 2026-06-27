/**
 * Repairs fused-name entries in document_chunks.
 *
 * Problem: OCR of 2-column PDFs placed two people's names on the same row,
 * so they were stored as one sentence like:
 *   "Aaron Banks Saloni Patel was inducted into Florida Blue Key in the FBK Fall 2017 Tapping Class."
 *
 * This script:
 *   1. Finds every chunk where the name has 4 or 5 words
 *   2. Splits it into 2 individual chunks (one per person)
 *   3. Deletes the fused chunk and inserts the two correct ones
 *
 * Run: npx tsx fix-fused-names.ts [--dry-run]
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../web/.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const DRY_RUN = process.argv.includes('--dry-run');

// ── Common first names for split-point detection ─────────────────────────────
// Used to determine where one name ends and another begins in 5-word fusions.
const FIRST_NAMES = new Set([
  'Aaron','Abby','Abigail','Adam','Adeel','Adrian','Aidan','Alexa','Alex','Alexander',
  'Alexandra','Alexis','Alicia','Alison','Allison','Alyssa','Amanda','Amber','Amy',
  'Ana','Andrew','Angela','Angelina','Angie','Anna','Anthony','Ashley','Austin',
  'Ben','Benjamin','Beth','Brandon','Brenda','Brian','Brody','Brooke','Bryan',
  'Carlos','Caroline','Catherine','Charles','Charlie','Charlotte','Chelsea','Chris',
  'Christian','Christina','Christopher','Claire','Claudia','Clayton','Cody','Cole',
  'Connor','Courtney','Crystal','Cynthia',
  'Daniel','David','Delaney','Derek','Diana','Dylan',
  'Emily','Emma','Eric','Erica','Ethan','Evan',
  'Faith','Filomena','Frank','Gabriel','Garrett','Gary','Gerrard','Grace','Grant',
  'Haley','Hannah','Helen','Henry','Hunter','Isabel','Isabella','Isaiah',
  'Jack','Jacob','Jake','James','Jason','Jeffrey','Jennifer','Jessica','John',
  'Jonathan','Jordan','Jose','Joseph','Josh','Joshua','Julia','Julie','Justin',
  'Karen','Katherine','Kailey','Kate','Katie','Kayla','Kelsi','Kevin',
  'Kyle','Lauren','Leslie','Libby','Logan','Luis',
  'Madison','Maria','Marina','Mark','Mary','Matthew','Megan','Melissa','Michael',
  'Michelle','Mike','Molly','Morgan','Nathan','Nicholas','Nicole','Noah',
  'Oliver','Omar','Paul','Peter','Philip','Rachel','Rebecca','Robert','Ryan',
  'Samantha','Samuel','Santiago','Sara','Sarah','Scott','Sean','Serena','Stephanie',
  'Steve','Steven','Sydney','Taylor','Thomas','Timothy','Tyler','Victoria','William',
  // Less-common but seen in the data
  'Alec','Alaina','Albie','Alexa','Alfredo','Alexia','Anastasia','Anyeli','Ariana',
  'Bettina','Beverley','Brody','Caitlin','Casandra','Cassidy','Claudia','Clayton',
  'Conor','Cristina','Dwayne','Elsa','Esdras','Fion','Gerrard','Genevieve',
  'Gracie','Hayley','Imani','Isabelle','Jared','Juliana','Kailee','Kason',
  'Kayla','Kelsi','Kendall','Kendra','Kristen','Lacy','Lakshay','Laurie',
  'Lena','Lexi','Lindsey','Lisha','Logan','Lukas','Lyndsay','Lyne',
  'Macy','Makena','Marcus','Mariam','Marina','Matteo','Maura','Meagan',
  'Meredith','Mia','Milan','Mireille','Miriam','Natalia','Natasha','Neil',
  'Nikail','Noel','Odessa','Paige','Paola','Patrick','Paula','Peyton',
  'Phillip','Priya','Reagan','Reed','Reid','Reilly','Rena','Renata',
  'Renee','Ricky','Riley','Robin','Robyn','Rodney','Ruben','Russell',
  'Rynn','Sachin','Samara','Sandy','Sasha','Savannah','Sebastian','Serena',
  'Sierra','Simone','Solange','Spencer','Tae','Tamika','Tara','Teresa',
  'Tiffany','Todd','Tony','Trevor','Trey','Tucker','Tyler','Valerie',
  'Vanessa','Veronica','Victor','Vincent','Vivian','Walter','Wendy','Whitney',
  'Willaim','Yessenia','Zach','Zachary','Zoe',
]);

// Titles that appear as prefixes (signal the start of a new "honorary" name)
const TITLES = new Set([
  'senator', 'judge', 'dean', 'representative', 'rep', 'governor', 'gov',
  'president', 'dr', 'dr.', 'professor', 'prof', 'mayor', 'general',
]);

/**
 * Determine where to split a 5-word name into two people.
 * Returns the split index (0-based word where Person2 starts).
 */
function findSplitPoint(words: string[]): number {
  // Check for titles at position 2 or 3 — they signal the start of Person2
  if (TITLES.has(words[2].toLowerCase())) return 2;
  if (TITLES.has(words[3].toLowerCase())) return 3;

  // Check if word[2] looks like a first name → 2+3 split
  if (FIRST_NAMES.has(words[2])) return 2;

  // Check if word[3] looks like a first name → 3+2 split
  if (FIRST_NAMES.has(words[3])) return 3;

  // Default to 2+3 split if unclear
  return 2;
}

/**
 * Given a fused name string, return an array of individual names.
 */
function splitName(name: string): string[] {
  const words = name.trim().split(/\s+/);

  if (words.length <= 3) {
    // 1–3 words = single person (possibly middle name)
    return [name];
  }

  if (words.length === 4) {
    // Always 2+2
    return [
      words.slice(0, 2).join(' '),
      words.slice(2, 4).join(' '),
    ];
  }

  if (words.length === 5) {
    const split = findSplitPoint(words);
    return [
      words.slice(0, split).join(' '),
      words.slice(split).join(' '),
    ];
  }

  // 6+ words: try 3+3 or check for title
  if (words.length === 6) {
    if (TITLES.has(words[3].toLowerCase())) {
      return [words.slice(0, 3).join(' '), words.slice(3).join(' ')];
    }
    return [words.slice(0, 3).join(' '), words.slice(3).join(' ')];
  }

  // Fallback: just return the original
  console.warn(`  ⚠️  Can't auto-split "${name}" (${words.length} words) — skipping`);
  return [name];
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\nFBK Fused-Name Repair`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}\n`);

// Fetch all chunks with 4 or 5 word names
let from = 0;
const fuseChunks: Array<{
  id: string; document_id: string; content: string; metadata: Record<string, unknown>;
}> = [];

while (true) {
  const { data } = await supabase
    .from('document_chunks')
    .select('id, document_id, content, metadata')
    .ilike('content', '%inducted into Florida Blue Key%')
    .range(from, from + 999);
  if (!data || data.length === 0) break;
  for (const chunk of data) {
    const nameMatch = chunk.content.match(/^(.+?) was inducted into/);
    if (!nameMatch) continue;
    const wordCount = nameMatch[1].trim().split(/\s+/).length;
    if (wordCount >= 4) fuseChunks.push(chunk as typeof fuseChunks[number]);
  }
  if (data.length < 1000) break;
  from += 1000;
}

console.log(`Found ${fuseChunks.length} fused-name chunks to repair\n`);

let fixed = 0;
let skipped = 0;
let newChunks = 0;

for (const chunk of fuseChunks) {
  const nameMatch = chunk.content.match(/^(.+?) was inducted into Florida Blue Key in the (.+?)\./);
  if (!nameMatch) { skipped++; continue; }

  const fusedName = nameMatch[1].trim();
  const tappingClass = nameMatch[2].trim();
  const names = splitName(fusedName);

  if (names.length === 1 && names[0] === fusedName) { skipped++; continue; }

  console.log(`  Split: "${fusedName}" →`);
  names.forEach(n => console.log(`    → "${n}"`));

  if (!DRY_RUN) {
    // Delete the fused chunk
    await supabase.from('document_chunks').delete().eq('id', chunk.id);

    // Insert individual chunks (without embeddings — they'll be created on next query via fallback scan)
    for (const name of names) {
      const newContent = `${name} was inducted into Florida Blue Key in the ${tappingClass}.`;
      await supabase.from('document_chunks').insert({
        document_id: chunk.document_id,
        content: newContent,
        metadata: {
          ...chunk.metadata,
          title: chunk.metadata.title,
        },
        // embedding will be generated on first use via JS cosine fallback,
        // or can be re-run via the fix-tapping-titles ingest script
      });
      newChunks++;
    }
    fixed++;
  } else {
    fixed++;
    newChunks += names.length;
  }
}

console.log('\n' + '─'.repeat(50));
console.log(`✅  Done`);
console.log(`   Fused chunks fixed: ${fixed}`);
console.log(`   New chunks created: ${newChunks} (+${newChunks - fixed} net new people)`);
console.log(`   Skipped:            ${skipped}`);
if (DRY_RUN) console.log('\n   (Dry run — nothing written to database)');
console.log('\n⚠️  Note: New chunks have no embeddings yet.');
console.log('   The JS cosine fallback in rag.ts will still find them via full-text similarity.');
console.log('   To add proper embeddings, re-run the fix-tapping-titles ingest script.');
