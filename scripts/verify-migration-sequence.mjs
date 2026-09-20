import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'));

const entries = files
  .map((file) => {
    const match = file.match(/_(\d{3})_/);
    return match ? { file, number: Number(match[1]) } : null;
  })
  .filter(Boolean);

if (entries.length !== files.length) {
  const invalid = files.filter((file) => !/_\d{3}_/.test(file));
  throw new Error(`MIGRATION_NAMING_INVALID: ${invalid.join(', ')}`);
}

const numbers = [...new Set(entries.map((entry) => entry.number))].sort((a, b) => a - b);
const expectedMax = Math.max(...numbers);
const missing = [];

for (let number = 1; number <= expectedMax; number += 1) {
  if (!numbers.includes(number)) missing.push(String(number).padStart(3, '0'));
}

if (missing.length) {
  throw new Error(`MIGRATION_SEQUENCE_GAPS: ${missing.join(', ')}`);
}

const duplicateNumbers = numbers
  .map((number) => ({
    number,
    files: entries.filter((entry) => entry.number === number).map((entry) => entry.file),
  }))
  .filter((entry) => entry.files.length > 1);

console.log(
  `Migration sequence verified: ${files.length} SQL files covering IDs 001-${String(expectedMax).padStart(3, '0')}, no missing migration IDs.`,
);

if (duplicateNumbers.length) {
  console.warn(
    `Historical duplicate migration IDs detected (allowed for recovered lineage): ${duplicateNumbers
      .map((entry) => `${String(entry.number).padStart(3, '0')}=[${entry.files.join(', ')}]`)
      .join('; ')}`,
  );
}
