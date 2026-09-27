import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { CATEGORY_IDS, DEFAULT_SCORE_PER_SEC, STAGES, UNITS } from '@catfight/engine';
import { createUserRows, type DB, type QuestionRow } from './db.js';

export interface AppOptions {
  db: DB;
  jwtSecret: string;
  logger?: boolean;
}

interface JwtPayload {
  uid: number;
}

const usernameSchema = z.string().regex(/^[A-Za-z0-9_]{3,20}$/);
const passwordSchema = z.string().min(8).max(72);
const displaySchema = z.string().trim().min(1).max(20);

export function buildApp({ db, jwtSecret, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });
  app.register(cors, { origin: true });

  const sign = (uid: number) => jwt.sign({ uid } satisfies JwtPayload, jwtSecret, { expiresIn: '7d' });

  function auth(req: FastifyRequest): number {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    try {
      const p = jwt.verify(token, jwtSecret) as JwtPayload;
      return p.uid;
    } catch {
      throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    }
  }

  app.setErrorHandler((err, _req, reply) => {
    const e = err as { statusCode?: number; message?: string; validation?: unknown };
    if (e instanceof z.ZodError) return reply.status(400).send({ error: 'invalid input', issues: e.issues });
    reply.status(e.statusCode ?? 500).send({ error: e.message ?? 'error' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  // ---------- auth ----------
  app.post('/api/auth/register', async (req, reply) => {
    const body = z.object({ username: usernameSchema, displayName: displaySchema, password: passwordSchema }).parse(req.body);
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username.toLowerCase());
    if (exists) return reply.status(409).send({ error: '帳號已被使用' });
    const hash = await bcrypt.hash(body.password, 12);
    const uid = createUserRows(db, body.username.toLowerCase(), body.displayName, hash);
    return { token: sign(uid), me: getMe(db, uid) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string(), password: z.string() }).parse(req.body);
    const row = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(body.username.toLowerCase()) as
      | { id: number; password_hash: string }
      | undefined;
    if (!row || !(await bcrypt.compare(body.password, row.password_hash))) {
      return reply.status(401).send({ error: '帳號或密碼錯誤' });
    }
    return { token: sign(row.id), me: getMe(db, row.id) };
  });

  app.get('/api/me', async (req) => getMe(db, auth(req)));

  // ---------- content ----------
  app.get('/api/units', async () => Object.values(UNITS));

  app.get('/api/stages', async (req) => {
    const uid = auth(req);
    const prog = db.prepare('SELECT max_stage FROM user_progress WHERE user_id = ?').get(uid) as { max_stage: number };
    return STAGES.map((s) => ({ id: s.id, name: s.name, category: s.category, reward: s.reward, unlocked: s.id <= prog.max_stage + 1, cleared: s.id <= prog.max_stage }));
  });

  app.get('/api/questions', async (req) => {
    auth(req);
    const q = z
      .object({
        category: z.enum(CATEGORY_IDS as [string, ...string[]]),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        exclude: z.string().optional(),
      })
      .parse(req.query);
    const exclude = (q.exclude ?? '')
      .split(',')
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0);
    let rows = db
      .prepare(
        `SELECT * FROM questions WHERE category = ? ${exclude.length ? `AND id NOT IN (${exclude.map(() => '?').join(',')})` : ''} ORDER BY RANDOM() LIMIT ?`,
      )
      .all(q.category, ...exclude, q.limit) as QuestionRow[];
    // if the bank is smaller than the request, top up with excluded ones
    if (rows.length < q.limit) {
      const more = db
        .prepare('SELECT * FROM questions WHERE category = ? ORDER BY RANDOM() LIMIT ?')
        .all(q.category, q.limit - rows.length) as QuestionRow[];
      const seen = new Set(rows.map((r) => r.id));
      rows = rows.concat(more.filter((r) => !seen.has(r.id)));
    }
    return rows.map(toQuestion);
  });

  // ---------- progression ----------
  app.post('/api/unlock', async (req, reply) => {
    const uid = auth(req);
    const { unitId } = z.object({ unitId: z.string() }).parse(req.body);
    const def = UNITS[unitId];
    if (!def) return reply.status(404).send({ error: 'no such unit' });
    const prog = db.prepare('SELECT points, unlocked_units FROM user_progress WHERE user_id = ?').get(uid) as { points: number; unlocked_units: string };
    const unlocked: string[] = JSON.parse(prog.unlocked_units);
    if (unlocked.includes(unitId)) return getMe(db, uid);
    if (prog.points < def.unlockCost) return reply.status(400).send({ error: '點數不足' });
    unlocked.push(unitId);
    db.prepare('UPDATE user_progress SET points = points - ?, unlocked_units = ? WHERE user_id = ?').run(def.unlockCost, JSON.stringify(unlocked), uid);
    return getMe(db, uid);
  });

  // ---------- versus ----------
  app.post('/api/match/opponent', async (req) => {
    const uid = auth(req);
    const { category } = z.object({ category: z.enum(CATEGORY_IDS as [string, ...string[]]) }).parse(req.body ?? {});
    const cand = db
      .prepare(
        `SELECT s.user_id, u.display_name, s.total_score, s.total_seconds, r.rating
         FROM user_stats s JOIN users u ON u.id = s.user_id JOIN ratings r ON r.user_id = s.user_id
         WHERE s.category = ? AND s.user_id != ? AND s.total_seconds > 30
         ORDER BY RANDOM() LIMIT 1`,
      )
      .get(category, uid) as { user_id: number; display_name: string; total_score: number; total_seconds: number; rating: number } | undefined;
    if (!cand) {
      return { opponentId: null, displayName: '練習機器人', scorePerSec: DEFAULT_SCORE_PER_SEC, rating: 1000 };
    }
    return { opponentId: cand.user_id, displayName: cand.display_name, scorePerSec: cand.total_score / cand.total_seconds, rating: cand.rating };
  });

  app.post('/api/match/result', async (req, reply) => {
    const uid = auth(req);
    const body = z
      .object({
        mode: z.enum(['stage', 'versus']),
        category: z.enum(CATEGORY_IDS as [string, ...string[]]),
        stage: z.number().int().min(1).max(STAGES.length).optional(),
        opponentId: z.number().int().nullable().optional(),
        won: z.boolean(),
        score: z.number().int().min(0),
        seconds: z.number().min(1).max(3600),
        questions: z.number().int().min(0),
        correct: z.number().int().min(0),
      })
      .parse(req.body);
    if (body.correct > body.questions) return reply.status(400).send({ error: 'bad stats' });
    if (body.mode === 'stage' && !body.stage) return reply.status(400).send({ error: 'stage required' });

    const out = db.transaction(() => {
      db.prepare(
        'INSERT INTO match_results (user_id, mode, category, stage, opponent_id, won, score, seconds, questions, correct) VALUES (?,?,?,?,?,?,?,?,?,?)',
      ).run(uid, body.mode, body.category, body.stage ?? null, body.opponentId ?? null, body.won ? 1 : 0, body.score, body.seconds, body.questions, body.correct);
      db.prepare(
        `INSERT INTO user_stats (user_id, category, games, wins, total_score, total_seconds, questions, correct) VALUES (?,?,1,?,?,?,?,?)
         ON CONFLICT(user_id, category) DO UPDATE SET games = games + 1, wins = wins + excluded.wins,
           total_score = total_score + excluded.total_score, total_seconds = total_seconds + excluded.total_seconds,
           questions = questions + excluded.questions, correct = correct + excluded.correct`,
      ).run(uid, body.category, body.won ? 1 : 0, body.score, body.seconds, body.questions, body.correct);

      let reward = 0;
      let ratingDelta = 0;
      if (body.mode === 'stage' && body.won) {
        const prog = db.prepare('SELECT max_stage FROM user_progress WHERE user_id = ?').get(uid) as { max_stage: number };
        const st = STAGES[body.stage! - 1];
        if (body.stage! > prog.max_stage) {
          reward = st.reward;
          db.prepare('UPDATE user_progress SET max_stage = ?, points = points + ? WHERE user_id = ?').run(body.stage, reward, uid);
        } else {
          reward = Math.round(st.reward / 4);
          db.prepare('UPDATE user_progress SET points = points + ? WHERE user_id = ?').run(reward, uid);
        }
      }
      if (body.mode === 'versus') {
        ratingDelta = body.won ? 25 : -15;
        db.prepare('UPDATE ratings SET rating = MAX(0, rating + ?), wins = wins + ?, losses = losses + ? WHERE user_id = ?').run(
          ratingDelta,
          body.won ? 1 : 0,
          body.won ? 0 : 1,
          uid,
        );
      }
      return { reward, ratingDelta };
    })();
    return { ...out, me: getMe(db, uid) };
  });

  app.get('/api/leaderboard', async () => {
    return db
      .prepare(
        `SELECT u.display_name AS displayName, r.rating, r.wins, r.losses FROM ratings r JOIN users u ON u.id = r.user_id
         WHERE r.wins + r.losses > 0 ORDER BY r.rating DESC, r.wins DESC LIMIT 100`,
      )
      .all();
  });

  return app;
}

function toQuestion(r: QuestionRow) {
  return { id: r.id, category: r.category, text: r.text, options: JSON.parse(r.options) as string[], answerIndex: r.answer_index, explanation: r.explanation ?? undefined };
}

export function getMe(db: DB, uid: number) {
  const u = db.prepare('SELECT id, username, display_name AS displayName, created_at AS createdAt FROM users WHERE id = ?').get(uid) as
    | { id: number; username: string; displayName: string; createdAt: string }
    | undefined;
  if (!u) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
  const prog = db.prepare('SELECT points, unlocked_units, max_stage AS maxStage FROM user_progress WHERE user_id = ?').get(uid) as {
    points: number;
    unlocked_units: string;
    maxStage: number;
  };
  const rating = db.prepare('SELECT rating, wins, losses FROM ratings WHERE user_id = ?').get(uid) as { rating: number; wins: number; losses: number };
  const stats = db
    .prepare('SELECT category, games, wins, total_score AS totalScore, total_seconds AS totalSeconds, questions, correct FROM user_stats WHERE user_id = ?')
    .all(uid) as { category: string; games: number; wins: number; totalScore: number; totalSeconds: number; questions: number; correct: number }[];
  return {
    ...u,
    points: prog.points,
    unlockedUnits: JSON.parse(prog.unlocked_units) as string[],
    maxStage: prog.maxStage,
    rating,
    stats: stats.map((s) => ({ ...s, scorePerSec: s.totalSeconds > 0 ? s.totalScore / s.totalSeconds : 0 })),
  };
}
