import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(migrationsDir).filter(file => file.endsWith('.sql'));

const entries = files
  .map(file => {
    const match = file.match(/_(\d{3})_/);
    return match ? { file, number: Number(match[1]) } : null;
  })
  .filter(Boolean);

if (entries.length !== files.length) {
  const invalid = files.filter(file => !/_\d{3}_/.test(file));
  throw new Error(`MIGRATION_NAMING_INVALID: ${invalid.join(', ')}`);
}

const byNumber = new Map();
for (const entry of entries) {
  const list = byNumber.get(entry.number) ?? [];
  list.push(entry.file);
  byNumber.set(entry.number, list);
}

const duplicates = [...byNumber.entries()].filter(([, list]) => list.length > 1);
if (duplicates.length) {
  throw new Error(
    `MIGRATION_DUPLICATES: ${duplicates.map(([number, list]) => `${String(number).padStart(3, '0')}=[${list.join(', ')}]`).join('; ')}`,
  );
}

const expectedMax = Math.max(...byNumber.keys());
const missing = [];
for (let number = 1; number <= expectedMax; number += 1) {
  if (!byNumber.has(number)) missing.push(String(number).padStart(3, '0'));
}

if (missing.length) {
  throw new Error(`MIGRATION_SEQUENCE_GAPS: ${missing.join(', ')}`);
}

console.log(
  `Migration sequence verified: ${files.length} files, IDs 001-${String(expectedMax).padStart(3, '0')}, no duplicates or gaps.`,
);
