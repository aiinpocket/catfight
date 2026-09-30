import { DEFAULT_UNLOCKED } from '@catfight/engine';

/** Minimal query interface shared by node-postgres (production) and PGlite (tests). */
export interface DB {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  /** run fn inside a transaction on a dedicated connection */
  tx<T>(fn: (q: DB['query']) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function openPg(connectionString: string): Promise<DB> {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString, max: 10 });
  const db: DB = {
    async query(sql, params = []) {
      const r = await pool.query(sql, params as unknown[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const out = await fn(async (sql, params = []) => {
          const r = await c.query(sql, params as unknown[]);
          return { rows: r.rows, rowCount: r.rowCount ?? 0 };
        });
        await c.query('COMMIT');
        return out;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
  await migrate(db);
  return db;
}

/** In-process Postgres (WASM) for tests and local dev. Pass a directory to persist. */
export async function openPglite(dataDir?: string): Promise<DB> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  const q: DB['query'] = async (sql, params = []) => {
    if (params.length === 0) {
      // exec supports multi-statement SQL (migrations); query() uses the extended protocol and does not
      const rs = await pg.exec(sql);
      const last = rs[rs.length - 1];
      return { rows: (last?.rows ?? []) as never[], rowCount: last?.affectedRows ?? last?.rows.length ?? 0 };
    }
    const r = await pg.query(sql, params as unknown[]);
    return { rows: r.rows as never[], rowCount: r.affectedRows ?? r.rows.length };
  };
  let chain = Promise.resolve();
  const db: DB = {
    query: q,
    tx(fn) {
      // PGlite is single-connection: serialise transactions
      const run = chain.then(async () => {
        await pg.query('BEGIN');
        try {
          const out = await fn(q);
          await pg.query('COMMIT');
          return out;
        } catch (e) {
          await pg.query('ROLLBACK');
          throw e;
        }
      });
      chain = run.then(
        () => {},
        () => {},
      );
      return run;
    },
    close: () => pg.close(),
  };
  await migrate(db);
  return db;
}

export async function migrate(db: DB) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS user_progress (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      points INTEGER NOT NULL DEFAULT 0,
      unlocked_units JSONB NOT NULL,
      max_stage INTEGER NOT NULL DEFAULT 0,
      upgrades JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS upgrades JSONB NOT NULL DEFAULT '{}'::jsonb;
    -- all stages are open; first-clear rewards are tracked per stage instead of by a linear max_stage
    ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS cleared_stages JSONB NOT NULL DEFAULT '[]'::jsonb;
    UPDATE user_progress SET cleared_stages = COALESCE((SELECT jsonb_agg(g) FROM generate_series(1, max_stage) g), '[]'::jsonb)
      WHERE max_stage > 0 AND cleared_stages = '[]'::jsonb;
    CREATE TABLE IF NOT EXISTS user_stats (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      games INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      total_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      total_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
      questions INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, category)
    );
    CREATE TABLE IF NOT EXISTS ratings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL DEFAULT 1000,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS match_results (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      category TEXT NOT NULL,
      stage INTEGER,
      opponent_id INTEGER,
      won BOOLEAN NOT NULL,
      score INTEGER NOT NULL,
      seconds DOUBLE PRECISION NOT NULL,
      questions INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS questions (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      options JSONB NOT NULL,
      answer_index INTEGER NOT NULL,
      explanation TEXT,
      source TEXT
    );
    -- questions that share a stem but have different options are distinct items
    ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_category_text_key;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_questions_cat_text_opts ON questions(category, text, options);
    CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);
    CREATE INDEX IF NOT EXISTS idx_match_user ON match_results(user_id);
    -- per-player history of each question: how often it came up and how often it was answered wrong
    CREATE TABLE IF NOT EXISTS user_question_stats (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      seen INTEGER NOT NULL DEFAULT 0,
      wrong INTEGER NOT NULL DEFAULT 0,
      last_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, question_id)
    );
  `);
}

export interface QuestionInput {
  text: string;
  options: string[];
  answerIndex: number;
  explanation?: string;
  source?: string;
}

export interface QuestionBankFile {
  category: { id: string; name: string; sortOrder?: number };
  questions: QuestionInput[];
}

/** Upsert a category and insert its questions (existing category+text pairs are skipped). Returns inserted count. */
export async function importBank(db: DB, bank: QuestionBankFile): Promise<number> {
  return db.tx(async (q) => {
    await q(
      `INSERT INTO categories (id, name, sort_order) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order`,
      [bank.category.id, bank.category.name, bank.category.sortOrder ?? 0],
    );
    let n = 0;
    for (const it of bank.questions) {
      const r = await q(
        `INSERT INTO questions (category, text, options, answer_index, explanation, source) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (category, text, options) DO UPDATE
           SET answer_index = EXCLUDED.answer_index, explanation = EXCLUDED.explanation, source = EXCLUDED.source
           WHERE questions.answer_index IS DISTINCT FROM EXCLUDED.answer_index
              OR questions.explanation IS DISTINCT FROM EXCLUDED.explanation
              OR questions.source IS DISTINCT FROM EXCLUDED.source`,
        [bank.category.id, it.text, JSON.stringify(it.options), it.answerIndex, it.explanation ?? null, it.source ?? null],
      );
      n += r.rowCount;
    }
    return n;
  });
}

export interface StaleQuestion {
  id: number;
  category: string;
  text: string;
  options: string[];
  source: string | null;
}

/**
 * Questions in the database that no bank file contains any more, for the categories those files cover.
 * A question is identified by (category, text, options), so a corrected stem or option leaves the old
 * row behind on re-import; this finds those leftovers. Categories without a file are not touched.
 */
export async function findStaleQuestions(db: DB, banks: QuestionBankFile[]): Promise<StaleQuestion[]> {
  const key = (text: string, options: string[]) => JSON.stringify([text, options]);
  const keep = new Map<string, Set<string>>();
  for (const b of banks) {
    const set = keep.get(b.category.id) ?? new Set<string>();
    for (const q of b.questions) set.add(key(q.text, q.options));
    keep.set(b.category.id, set);
  }
  const stale: StaleQuestion[] = [];
  for (const [category, set] of keep) {
    const r = await db.query<StaleQuestion>('SELECT id, category, text, options, source FROM questions WHERE category = $1 ORDER BY id', [category]);
    for (const row of r.rows) if (!set.has(key(row.text, row.options))) stale.push(row);
  }
  return stale;
}

/** Delete questions by id (their per-player answer history goes with them). Returns the number deleted. */
export async function deleteQuestions(db: DB, ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  return (await db.query('DELETE FROM questions WHERE id = ANY($1::int[])', [ids])).rowCount;
}

export async function listCategories(db: DB): Promise<{ id: string; name: string; count: number }[]> {
  const r = await db.query<{ id: string; name: string; count: string }>(
    `SELECT c.id, c.name, COUNT(q.id)::int AS count FROM categories c LEFT JOIN questions q ON q.category = c.id
     GROUP BY c.id, c.name, c.sort_order ORDER BY c.sort_order, c.id`,
  );
  return r.rows.map((x) => ({ id: x.id, name: x.name, count: Number(x.count) }));
}

export async function createUserRows(db: DB, username: string, displayName: string, passwordHash: string): Promise<number> {
  return db.tx(async (q) => {
    const r = await q<{ id: number }>('INSERT INTO users (username, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id', [
      username,
      displayName,
      passwordHash,
    ]);
    const id = r.rows[0].id;
    await q('INSERT INTO user_progress (user_id, unlocked_units) VALUES ($1, $2)', [id, JSON.stringify(DEFAULT_UNLOCKED)]);
    await q('INSERT INTO ratings (user_id) VALUES ($1)', [id]);
    return id;
  });
}
