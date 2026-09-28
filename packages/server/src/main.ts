import path from 'node:path';
import fs from 'node:fs';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';
import { importBank, openPg, openPglite, type DB, type QuestionBankFile } from './db.js';

const WEB_DIR = path.resolve(process.env.WEB_DIR ?? path.resolve(process.cwd(), '../web/dist'));
const QUESTIONS_DIR = path.resolve(process.env.QUESTIONS_DIR ?? path.resolve(process.cwd(), '../../data/questions'));
const PORT = Number(process.env.PORT ?? 8080);
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const DATABASE_URL = process.env.DATABASE_URL ?? '';

if (!JWT_SECRET || !DATABASE_URL) {
  console.error('JWT_SECRET and DATABASE_URL are required');
  process.exit(1);
}

async function connectWithRetry(url: string, attempts = 30): Promise<DB> {
  // pglite://./some/dir -> embedded Postgres persisted in that directory (local dev without Docker)
  if (url.startsWith('pglite://')) {
    const dir = path.resolve(url.slice('pglite://'.length));
    fs.mkdirSync(dir, { recursive: true });
    console.log(`using embedded PGlite at ${dir}`);
    return openPglite(dir);
  }
  for (let i = 1; ; i++) {
    try {
      return await openPg(url);
    } catch (e) {
      if (i >= attempts) throw e;
      console.log(`postgres not ready (${(e as Error).message}); retry ${i}/${attempts}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** Import every data/questions/*.json on boot (idempotent: existing category+text pairs are skipped). */
export async function importQuestionDir(db: DB, dir: string) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const bank = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as QuestionBankFile;
      if (!bank.category?.id || !Array.isArray(bank.questions)) {
        console.warn(`questions: skipped ${f} (expected { category: {id, name}, questions: [...] })`);
        continue;
      }
      const n = await importBank(db, bank);
      console.log(`questions: ${f} -> ${bank.category.id} (${bank.category.name}) ${n} new/updated of ${bank.questions.length}`);
      total += n;
    } catch (e) {
      console.warn(`questions: failed ${f}: ${(e as Error).message}`);
    }
  }
  return total;
}

const db = await connectWithRetry(DATABASE_URL);
await importQuestionDir(db, QUESTIONS_DIR);

const app = buildApp({ db, jwtSecret: JWT_SECRET, logger: true });

if (fs.existsSync(WEB_DIR)) {
  app.register(fastifyStatic, { root: WEB_DIR, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`catfight server on :${PORT}`);
