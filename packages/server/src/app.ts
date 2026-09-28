import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { buildStages, DEFAULT_SCORE_PER_SEC, MAX_UPGRADE_LEVEL, UNITS, UPGRADE_TRACKS, upgradeCost, upgradeLevel, type Upgrades, type UpgradeTrack } from '@catfight/engine';
import { createUserRows, listCategories, type DB } from './db.js';

export interface AppOptions {
  db: DB;
  jwtSecret: string;
  logger?: boolean;
}

interface JwtPayload {
  uid: number;
}

interface QuestionRow {
  id: number;
  category: string;
  text: string;
  options: string[] | string;
  answer_index: number;
  explanation: string | null;
}

const usernameSchema = z.string().regex(/^[A-Za-z0-9_]{3,20}$/);
const passwordSchema = z.string().min(8).max(72);
const displaySchema = z.string().trim().min(1).max(20);
const categorySchema = z.string().regex(/^[a-z0-9_\-]{1,40}$/);

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export function buildApp({ db, jwtSecret, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });
  app.register(cors, { origin: true });

  const sign = (uid: number) => jwt.sign({ uid } satisfies JwtPayload, jwtSecret, { expiresIn: '7d' });

  function auth(req: FastifyRequest): number {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    try {
      return (jwt.verify(token, jwtSecret) as JwtPayload).uid;
    } catch {
      throw httpError(401, 'unauthorized');
    }
  }

  async function requireCategory(id: string) {
    const r = await db.query('SELECT 1 FROM categories WHERE id = $1', [id]);
    if (!r.rows.length) throw httpError(400, '沒有這個題庫分類');
  }

  app.setErrorHandler((err, _req, reply) => {
    const e = err as { statusCode?: number; message?: string };
    if (e instanceof z.ZodError) return reply.status(400).send({ error: 'invalid input', issues: e.issues });
    if (!e.statusCode || e.statusCode >= 500) app.log.error(err);
    reply.status(e.statusCode ?? 500).send({ error: e.message ?? 'error' });
  });

  // users seen in a battle recently (heartbeat or question fetch); lets deploys wait for a quiet moment
  const activeBattles = new Map<number, number>();
  const ACTIVE_WINDOW_MS = 60_000;
  const touchActive = (uid: number) => activeBattles.set(uid, Date.now());
  const countActive = () => {
    const now = Date.now();
    for (const [uid, t] of activeBattles) if (now - t > ACTIVE_WINDOW_MS) activeBattles.delete(uid);
    return activeBattles.size;
  };

  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true, activeBattles: countActive() };
  });

  app.post('/api/battle/heartbeat', async (req) => {
    touchActive(auth(req));
    return { ok: true };
  });

  // ---------- auth ----------
  app.post('/api/auth/register', async (req, reply) => {
    const body = z.object({ username: usernameSchema, displayName: displaySchema, password: passwordSchema }).parse(req.body);
    const username = body.username.toLowerCase();
    const exists = await db.query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (exists.rows.length) return reply.status(409).send({ error: '帳號已被使用' });
    const hash = await bcrypt.hash(body.password, 12);
    const uid = await createUserRows(db, username, body.displayName, hash);
    return { token: sign(uid), me: await getMe(db, uid) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string(), password: z.string() }).parse(req.body);
    const r = await db.query<{ id: number; password_hash: string }>('SELECT id, password_hash FROM users WHERE username = $1', [body.username.toLowerCase()]);
    const row = r.rows[0];
    if (!row || !(await bcrypt.compare(body.password, row.password_hash))) return reply.status(401).send({ error: '帳號或密碼錯誤' });
    return { token: sign(row.id), me: await getMe(db, row.id) };
  });

  app.get('/api/me', async (req) => getMe(db, auth(req)));

  // ---------- content ----------
  app.get('/api/units', async () => Object.values(UNITS));

  app.get('/api/categories', async () => listCategories(db));

  app.get('/api/stages', async (req) => {
    const uid = auth(req);
    const prog = await db.query<{ cleared_stages: number[] }>('SELECT cleared_stages FROM user_progress WHERE user_id = $1', [uid]);
    const cleared = new Set(prog.rows[0]?.cleared_stages ?? []);
    const cats = (await listCategories(db)).filter((c) => c.count > 0);
    // every stage is open: players pick the exam category they care about
    return buildStages(cats).map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      reward: s.reward,
      targetAccuracy: s.targetAccuracy,
      powerTier: s.powerTier,
      ai: s.ai,
      boss: s.boss,
      unlocked: true,
      cleared: cleared.has(s.id),
    }));
  });

  app.get('/api/questions', async (req) => {
    auth(req);
    const q = z
      .object({
        category: categorySchema,
        limit: z.coerce.number().int().min(1).max(100).default(50),
        exclude: z.string().optional(),
      })
      .parse(req.query);
    await requireCategory(q.category);
    const exclude = (q.exclude ?? '')
      .split(',')
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0);
    let rows = (
      await db.query<QuestionRow>(
        `SELECT id, category, text, options, answer_index, explanation FROM questions
         WHERE category = $1 AND NOT (id = ANY($2::int[])) ORDER BY random() LIMIT $3`,
        [q.category, exclude, q.limit],
      )
    ).rows;
    if (rows.length < q.limit) {
      // bank smaller than the request: top up with previously seen questions
      const seen = new Set(rows.map((r) => r.id));
      const more = (
        await db.query<QuestionRow>('SELECT id, category, text, options, answer_index, explanation FROM questions WHERE category = $1 ORDER BY random() LIMIT $2', [
          q.category,
          q.limit - rows.length,
        ])
      ).rows;
      rows = rows.concat(more.filter((r) => !seen.has(r.id)));
    }
    return rows.map(shuffledQuestion);
  });

  // ---------- progression ----------
  app.post('/api/unlock', async (req, reply) => {
    const uid = auth(req);
    touchActive(uid);
    const { unitId } = z.object({ unitId: z.string() }).parse(req.body);
    const def = UNITS[unitId];
    if (!def) return reply.status(404).send({ error: 'no such unit' });
    return db.tx(async (q) => {
      const prog = (await q<{ points: number; unlocked_units: string[] }>('SELECT points, unlocked_units FROM user_progress WHERE user_id = $1 FOR UPDATE', [uid])).rows[0];
      const unlocked = prog.unlocked_units;
      if (unlocked.includes(unitId)) return getMe(db, uid, q);
      if (prog.points < def.unlockCost) throw httpError(400, '點數不足');
      unlocked.push(unitId);
      await q('UPDATE user_progress SET points = points - $1, unlocked_units = $2 WHERE user_id = $3', [def.unlockCost, JSON.stringify(unlocked), uid]);
      return getMe(db, uid, q);
    });
  });

  app.post('/api/upgrade', async (req, reply) => {
    const uid = auth(req);
    const { unitId, track } = z.object({ unitId: z.string(), track: z.enum(UPGRADE_TRACKS as [UpgradeTrack, ...UpgradeTrack[]]) }).parse(req.body);
    if (!UNITS[unitId]) return reply.status(404).send({ error: 'no such unit' });
    return db.tx(async (q) => {
      const prog = (
        await q<{ points: number; unlocked_units: string[]; upgrades: Upgrades }>('SELECT points, unlocked_units, upgrades FROM user_progress WHERE user_id = $1 FOR UPDATE', [uid])
      ).rows[0];
      if (!prog.unlocked_units.includes(unitId)) throw httpError(400, '請先解鎖這隻貓');
      const cur = upgradeLevel(prog.upgrades, unitId, track);
      if (cur >= MAX_UPGRADE_LEVEL) throw httpError(400, '已達最高等級');
      const cost = upgradeCost(cur + 1);
      if (prog.points < cost) throw httpError(400, '點數不足');
      const next: Upgrades = { ...prog.upgrades, [unitId]: { ...(prog.upgrades[unitId] ?? {}), [track]: cur + 1 } };
      await q('UPDATE user_progress SET points = points - $1, upgrades = $2 WHERE user_id = $3', [cost, JSON.stringify(next), uid]);
      return getMe(db, uid, q);
    });
  });

  // ---------- versus ----------
  app.post('/api/match/opponent', async (req) => {
    const uid = auth(req);
    const { category } = z.object({ category: categorySchema }).parse(req.body ?? {});
    await requireCategory(category);
    const r = await db.query<{ user_id: number; display_name: string; total_score: number; total_seconds: number; rating: number }>(
      `SELECT s.user_id, u.display_name, s.total_score, s.total_seconds, r.rating
       FROM user_stats s JOIN users u ON u.id = s.user_id JOIN ratings r ON r.user_id = s.user_id
       WHERE s.category = $1 AND s.user_id <> $2 AND s.total_seconds > 30
       ORDER BY random() LIMIT 1`,
      [category, uid],
    );
    const cand = r.rows[0];
    if (!cand) return { opponentId: null, displayName: '練習機器人', scorePerSec: DEFAULT_SCORE_PER_SEC, rating: 1000 };
    return { opponentId: cand.user_id, displayName: cand.display_name, scorePerSec: cand.total_score / cand.total_seconds, rating: cand.rating };
  });

  app.post('/api/match/result', async (req, reply) => {
    const uid = auth(req);
    activeBattles.delete(uid);
    const body = z
      .object({
        mode: z.enum(['stage', 'versus']),
        category: categorySchema,
        stage: z.number().int().min(1).optional(),
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
    await requireCategory(body.category);

    const cats = (await listCategories(db)).filter((c) => c.count > 0);
    const stages = buildStages(cats);
    if (body.mode === 'stage' && (body.stage! > stages.length || stages[body.stage! - 1].category !== body.category)) {
      return reply.status(400).send({ error: 'stage/category mismatch' });
    }

    const out = await db.tx(async (q) => {
      await q(
        `INSERT INTO match_results (user_id, mode, category, stage, opponent_id, won, score, seconds, questions, correct)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [uid, body.mode, body.category, body.stage ?? null, body.opponentId ?? null, body.won, body.score, body.seconds, body.questions, body.correct],
      );
      await q(
        `INSERT INTO user_stats (user_id, category, games, wins, total_score, total_seconds, questions, correct) VALUES ($1,$2,1,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id, category) DO UPDATE SET games = user_stats.games + 1, wins = user_stats.wins + EXCLUDED.wins,
           total_score = user_stats.total_score + EXCLUDED.total_score, total_seconds = user_stats.total_seconds + EXCLUDED.total_seconds,
           questions = user_stats.questions + EXCLUDED.questions, correct = user_stats.correct + EXCLUDED.correct`,
        [uid, body.category, body.won ? 1 : 0, body.score, body.seconds, body.questions, body.correct],
      );
      let reward = 0;
      let ratingDelta = 0;
      if (body.mode === 'stage') {
        const prog = (await q<{ cleared_stages: number[] }>('SELECT cleared_stages FROM user_progress WHERE user_id = $1 FOR UPDATE', [uid])).rows[0];
        const st = stages[body.stage! - 1];
        const cleared = prog.cleared_stages ?? [];
        const firstClear = !cleared.includes(body.stage!);
        // a win pays the full first-clear reward once, then a quarter on replays; a loss still pays half of what the win would have
        const winReward = firstClear ? st.reward : Math.round(st.reward / 4);
        reward = body.won ? winReward : Math.floor(winReward / 2);
        if (body.won && firstClear) {
          cleared.push(body.stage!);
          await q('UPDATE user_progress SET cleared_stages = $1, max_stage = GREATEST(max_stage, $2), points = points + $3 WHERE user_id = $4', [
            JSON.stringify(cleared),
            body.stage,
            reward,
            uid,
          ]);
        } else {
          await q('UPDATE user_progress SET points = points + $1 WHERE user_id = $2', [reward, uid]);
        }
      }
      if (body.mode === 'versus') {
        ratingDelta = body.won ? 25 : -15;
        await q('UPDATE ratings SET rating = GREATEST(0, rating + $1), wins = wins + $2, losses = losses + $3 WHERE user_id = $4', [
          ratingDelta,
          body.won ? 1 : 0,
          body.won ? 0 : 1,
          uid,
        ]);
      }
      return { reward, ratingDelta, me: await getMe(db, uid, q) };
    });
    return out;
  });

  app.get('/api/leaderboard', async () => {
    const r = await db.query(
      `SELECT u.display_name AS "displayName", r.rating, r.wins, r.losses FROM ratings r JOIN users u ON u.id = r.user_id
       WHERE r.wins + r.losses > 0 ORDER BY r.rating DESC, r.wins DESC LIMIT 100`,
    );
    return r.rows;
  });

  return app;
}

/** "以上皆是", "甲、乙、丙、丁皆非", "ABC 皆可"… — an option that sums up the others only makes sense as the last one. */
export function isCatchAllOption(o: string): boolean {
  const s = o.trim();
  // short only: "以上櫃股票作價抵繳股款…" is a real statement, not a summary
  return s.length <= 12 && (/^(以上|上述|全部)/.test(s) || /皆(是|非|正確|不正確|錯誤|對|錯|可|不可|然|不然)$/.test(s));
}

/** Randomise option order per delivery so the same question never looks identical twice.
 *  Catch-all options stay at the end (keeping their relative order); only the rest are shuffled. */
function shuffledQuestion(r: QuestionRow) {
  const options = (typeof r.options === 'string' ? JSON.parse(r.options) : r.options) as string[];
  const order = options.map((_, i) => i).filter((i) => !isCatchAllOption(options[i]));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.push(...options.map((_, i) => i).filter((i) => isCatchAllOption(options[i])));
  return {
    id: r.id,
    category: r.category,
    text: r.text,
    options: order.map((i) => options[i]),
    answerIndex: order.indexOf(r.answer_index),
    explanation: r.explanation ?? undefined,
  };
}

export async function getMe(db: DB, uid: number, q: DB['query'] = db.query) {
  const u = (
    await q<{ id: number; username: string; displayName: string; createdAt: string }>(
      'SELECT id, username, display_name AS "displayName", created_at AS "createdAt" FROM users WHERE id = $1',
      [uid],
    )
  ).rows[0];
  if (!u) throw httpError(401, 'unauthorized');
  const prog = (
    await q<{ points: number; unlocked_units: string[]; clearedCount: number; upgrades: Upgrades }>(
      'SELECT points, unlocked_units, jsonb_array_length(cleared_stages)::int AS "clearedCount", upgrades FROM user_progress WHERE user_id = $1',
      [uid],
    )
  ).rows[0];
  const rating = (await q<{ rating: number; wins: number; losses: number }>('SELECT rating, wins, losses FROM ratings WHERE user_id = $1', [uid])).rows[0];
  const stats = (
    await q<{ category: string; games: number; wins: number; totalScore: number; totalSeconds: number; questions: number; correct: number }>(
      'SELECT category, games, wins, total_score AS "totalScore", total_seconds AS "totalSeconds", questions, correct FROM user_stats WHERE user_id = $1',
      [uid],
    )
  ).rows;
  return {
    ...u,
    points: prog.points,
    unlockedUnits: prog.unlocked_units,
    clearedCount: Number(prog.clearedCount),
    upgrades: prog.upgrades ?? {},
    rating,
    stats: stats.map((s) => ({ ...s, totalScore: Number(s.totalScore), totalSeconds: Number(s.totalSeconds), scorePerSec: Number(s.totalSeconds) > 0 ? Number(s.totalScore) / Number(s.totalSeconds) : 0 })),
  };
}
