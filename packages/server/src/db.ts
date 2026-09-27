import Database from 'better-sqlite3';
import { DEFAULT_UNLOCKED } from '@catfight/engine';

export type DB = Database.Database;

export function openDb(path = ':memory:'): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_progress (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      points INTEGER NOT NULL DEFAULT 0,
      unlocked_units TEXT NOT NULL,
      max_stage INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS user_stats (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      games INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      total_score REAL NOT NULL DEFAULT 0,
      total_seconds REAL NOT NULL DEFAULT 0,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      category TEXT NOT NULL,
      stage INTEGER,
      opponent_id INTEGER,
      won INTEGER NOT NULL,
      score INTEGER NOT NULL,
      seconds REAL NOT NULL,
      questions INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      text TEXT NOT NULL,
      options TEXT NOT NULL,
      answer_index INTEGER NOT NULL,
      explanation TEXT,
      source TEXT,
      UNIQUE(category, text)
    );
    CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);
    CREATE INDEX IF NOT EXISTS idx_match_user ON match_results(user_id);
  `);
}

export interface QuestionRow {
  id: number;
  category: string;
  text: string;
  options: string;
  answer_index: number;
  explanation: string | null;
  source: string | null;
}

export interface QuestionInput {
  category: string;
  text: string;
  options: string[];
  answerIndex: number;
  explanation?: string;
  source?: string;
}

export function insertQuestions(db: DB, qs: QuestionInput[]): number {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO questions (category, text, options, answer_index, explanation, source) VALUES (?, ?, ?, ?, ?, ?)',
  );
  let n = 0;
  const tx = db.transaction((rows: QuestionInput[]) => {
    for (const q of rows) {
      const r = stmt.run(q.category, q.text, JSON.stringify(q.options), q.answerIndex, q.explanation ?? null, q.source ?? null);
      n += r.changes;
    }
  });
  tx(qs);
  return n;
}

export function createUserRows(db: DB, username: string, displayName: string, passwordHash: string): number {
  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)').run(username, displayName, passwordHash);
    const id = Number(r.lastInsertRowid);
    db.prepare('INSERT INTO user_progress (user_id, unlocked_units) VALUES (?, ?)').run(id, JSON.stringify(DEFAULT_UNLOCKED));
    db.prepare('INSERT INTO ratings (user_id) VALUES (?)').run(id);
    return id;
  });
  return tx();
}
