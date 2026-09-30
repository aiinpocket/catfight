/**
 * Validate and import question bank JSON files into PostgreSQL.
 * usage: DATABASE_URL=postgres://...  (or pglite://volumes/pglite)  tsx scripts/import-questions.ts [dir] [--prune]
 *
 * A question is identified by (category, text, options): correcting a stem or an option in a bank file
 * inserts a new row and leaves the old one behind. After importing, the script lists those leftovers
 * (rows of the imported categories that no file contains any more); pass --prune to delete them.
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
import { deleteQuestions, findStaleQuestions, importBank, openPg, openPglite } from '../src/db.js';

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

const args = process.argv.slice(2);
const prune = args.includes('--prune');
const dir = path.resolve(args.find((a) => !a.startsWith('--')) ?? '../../data/questions');
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
const banks = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const bank = bankSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
  const n = await importBank(db, bank);
  console.log(`${f}: ${bank.category.id} ${bank.questions.length} questions, ${n} new`);
  total += n;
  banks.push(bank);
}
console.log(`imported ${total} new questions`);

const stale = await findStaleQuestions(db, banks);
for (const s of stale) console.log(`stale #${s.id} [${s.category}] ${s.source ?? ''} | ${s.text.slice(0, 40)} | longest option ${Math.max(...s.options.map((o) => o.length))} chars`);
if (!stale.length) console.log('no stale questions');
else if (prune) console.log(`deleted ${await deleteQuestions(db, stale.map((s) => s.id))} stale questions`);
else console.log(`${stale.length} stale questions are no longer in any bank file; re-run with --prune to delete them`);
await db.close();
