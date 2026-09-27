import path from 'node:path';
import fs from 'node:fs';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';
import { openDb, insertQuestions, type QuestionInput } from './db.js';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, 'catfight.db');
const WEB_DIR = process.env.WEB_DIR ?? path.resolve(process.cwd(), '../web/dist');
const QUESTIONS_DIR = process.env.QUESTIONS_DIR ?? path.resolve(process.cwd(), '../../data/questions');
const PORT = Number(process.env.PORT ?? 8080);
const JWT_SECRET = process.env.JWT_SECRET ?? '';

if (!JWT_SECRET) {
  console.error('JWT_SECRET is required');
  process.exit(1);
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = openDb(DB_PATH);

// seed / refresh questions from json files on every boot (idempotent)
if (fs.existsSync(QUESTIONS_DIR)) {
  let total = 0;
  for (const f of fs.readdirSync(QUESTIONS_DIR).filter((f) => f.endsWith('.json'))) {
    const qs = JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, f), 'utf-8')) as QuestionInput[];
    total += insertQuestions(db, qs);
  }
  console.log(`questions: imported ${total} new rows from ${QUESTIONS_DIR}`);
}

const app = buildApp({ db, jwtSecret: JWT_SECRET, logger: true });

if (fs.existsSync(WEB_DIR)) {
  app.register(fastifyStatic, { root: WEB_DIR, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

app.listen({ port: PORT, host: '0.0.0.0' }).then(() => console.log(`catfight server on :${PORT}`));
