/**
 * Import question JSON files into the SQLite database.
 * usage: tsx scripts/import-questions.ts [dbPath] [dir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { CATEGORY_IDS } from '@catfight/engine';
import { openDb, insertQuestions } from '../src/db.js';

const schema = z.array(
  z.object({
    category: z.enum(CATEGORY_IDS as [string, ...string[]]),
    text: z.string().min(4),
    options: z.array(z.string().min(1)).length(4),
    answerIndex: z.number().int().min(0).max(3),
    explanation: z.string().optional(),
    source: z.string().optional(),
  }),
);

const dbPath = process.argv[2] ?? process.env.DB_PATH ?? path.resolve('data/catfight.db');
const dir = process.argv[3] ?? path.resolve('../../data/questions');
const db = openDb(dbPath);
let total = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
  const qs = schema.parse(raw);
  const n = insertQuestions(db, qs);
  console.log(`${f}: ${qs.length} questions, ${n} new`);
  total += n;
}
console.log(`imported ${total} new questions into ${dbPath}`);
