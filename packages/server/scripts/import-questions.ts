/**
 * Validate and import question bank JSON files into PostgreSQL.
 * usage: DATABASE_URL=postgres://...  (or pglite://volumes/pglite)  tsx scripts/import-questions.ts [dir]
 *
 * File format (one file per category):
 * {
 *   "category": { "id": "finance_basics", "name": "金融常識", "sortOrder": 1 },
 *   "questions": [
 *     { "text": "…", "options": ["A","B","C","D"], "answerIndex": 1, "explanation": "…", "source": "…" }
 *   ]
 * }
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { importBank, openPg, openPglite } from '../src/db.js';

export const bankSchema = z.object({
  category: z.object({ id: z.string().regex(/^[a-z0-9_\-]{1,40}$/), name: z.string().min(1).max(40), sortOrder: z.number().int().optional() }),
  questions: z.array(
    z.object({
      text: z.string().min(4),
      options: z.array(z.string().min(1)).length(4),
      answerIndex: z.number().int().min(0).max(3),
      explanation: z.string().optional(),
      source: z.string().optional(),
    }),
  ),
});

const dir = path.resolve(process.argv[2] ?? '../../data/questions');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL required');
  process.exit(1);
}
// pglite://<dir> uses the embedded Postgres, same as the server's DATABASE_URL (handy to validate a bank without Docker)
let db;
if (url.startsWith('pglite://')) {
  const pgDir = path.resolve(url.slice('pglite://'.length));
  fs.mkdirSync(pgDir, { recursive: true });
  db = await openPglite(pgDir);
} else {
  db = await openPg(url);
}
let total = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const bank = bankSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
  const n = await importBank(db, bank);
  console.log(`${f}: ${bank.category.id} ${bank.questions.length} questions, ${n} new`);
  total += n;
}
console.log(`imported ${total} new questions`);
await db.close();
