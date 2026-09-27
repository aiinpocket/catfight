import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { insertQuestions, openDb } from '../src/db.js';

let app: FastifyInstance;
let tokenA = '';
let tokenB = '';

const H = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  const db = openDb(':memory:');
  insertQuestions(
    db,
    Array.from({ length: 12 }, (_, i) => ({
      category: 'finance_basics',
      text: `題目 ${i}`,
      options: ['A', 'B', 'C', 'D'],
      answerIndex: i % 4,
    })),
  );
  insertQuestions(db, [{ category: 'bank_law', text: '法規題', options: ['甲', '乙', '丙', '丁'], answerIndex: 1 }]);
  app = buildApp({ db, jwtSecret: 'test-secret' });
  await app.ready();
});

describe('auth', () => {
  it('registers, rejects duplicates and bad input, logs in', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Alice_1', displayName: '愛麗絲', password: 'password1' } });
    expect(r.statusCode).toBe(200);
    tokenA = r.json().token;
    expect(r.json().me.unlockedUnits).toEqual(['tank', 'archer']);
    expect(r.json().me.username).toBe('alice_1');

    const dup = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'alice_1', displayName: 'x', password: 'password1' } });
    expect(dup.statusCode).toBe(409);

    const bad = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'a', displayName: 'x', password: 'short' } });
    expect(bad.statusCode).toBe(400);

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ALICE_1', password: 'password1' } });
    expect(login.statusCode).toBe(200);
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice_1', password: 'nope-nope' } });
    expect(wrong.statusCode).toBe(401);

    const b = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bob', displayName: '鮑伯', password: 'password2' } });
    tokenB = b.json().token;
  });

  it('never returns the password hash and requires a token', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: H(tokenA) });
    expect(me.statusCode).toBe(200);
    expect(JSON.stringify(me.json())).not.toContain('$2');
    const anon = await app.inject({ method: 'GET', url: '/api/me' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('questions', () => {
  it('returns random questions of a category, honours exclude, tops up small banks', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/questions?category=finance_basics&limit=5', headers: H(tokenA) });
    expect(r.statusCode).toBe(200);
    const qs = r.json() as { id: number; options: string[] }[];
    expect(qs).toHaveLength(5);
    expect(qs[0].options).toHaveLength(4);

    const ex = qs.map((q) => q.id).join(',');
    const r2 = await app.inject({ method: 'GET', url: `/api/questions?category=finance_basics&limit=5&exclude=${ex}`, headers: H(tokenA) });
    const ids2 = (r2.json() as { id: number }[]).map((q) => q.id);
    expect(ids2.some((id) => qs.some((q) => q.id === id))).toBe(false);

    const r3 = await app.inject({ method: 'GET', url: '/api/questions?category=bank_law&limit=50', headers: H(tokenA) });
    expect(r3.json()).toHaveLength(1);

    const badCat = await app.inject({ method: 'GET', url: '/api/questions?category=nope', headers: H(tokenA) });
    expect(badCat.statusCode).toBe(400);
  });
});

describe('stage mode', () => {
  it('grants reward on first clear, unlocks next stage, smaller reward on replay', async () => {
    const st0 = await app.inject({ method: 'GET', url: '/api/stages', headers: H(tokenA) });
    expect(st0.json()[0].unlocked).toBe(true);
    expect(st0.json()[1].unlocked).toBe(false);

    const payload = { mode: 'stage', category: 'finance_basics', stage: 1, won: true, score: 200, seconds: 120, questions: 30, correct: 20 };
    const r = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenA), payload });
    expect(r.statusCode).toBe(200);
    expect(r.json().reward).toBe(60);
    expect(r.json().me.points).toBe(60);
    expect(r.json().me.maxStage).toBe(1);

    const st1 = await app.inject({ method: 'GET', url: '/api/stages', headers: H(tokenA) });
    expect(st1.json()[1].unlocked).toBe(true);

    const again = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenA), payload });
    expect(again.json().reward).toBe(15);

    const lost = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenA), payload: { ...payload, won: false } });
    expect(lost.json().reward).toBe(0);
  });

  it('unlocks units with points and refuses when short', async () => {
    const no = await app.inject({ method: 'POST', url: '/api/unlock', headers: H(tokenA), payload: { unitId: 'medic' } });
    expect(no.statusCode).toBe(400);
    // 75 points so far, mage costs 100: clear stage 2
    await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenA), payload: { mode: 'stage', category: 'bank_law', stage: 2, won: true, score: 100, seconds: 100, questions: 20, correct: 12 } });
    const ok = await app.inject({ method: 'POST', url: '/api/unlock', headers: H(tokenA), payload: { unitId: 'mage' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().unlockedUnits).toContain('mage');
    expect(ok.json().points).toBe(45);
    const twice = await app.inject({ method: 'POST', url: '/api/unlock', headers: H(tokenA), payload: { unitId: 'mage' } });
    expect(twice.json().points).toBe(45);
  });
});

describe('versus mode', () => {
  it('falls back to a bot when nobody else has played the category', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/match/opponent', headers: H(tokenB), payload: { category: 'trust' } });
    expect(r.json().opponentId).toBeNull();
    expect(r.json().scorePerSec).toBeCloseTo(1.75);
  });

  it('matches against another player using their score-per-second in that category', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/match/opponent', headers: H(tokenB), payload: { category: 'finance_basics' } });
    expect(r.json().opponentId).not.toBeNull();
    expect(r.json().displayName).toBe('愛麗絲');
    // alice: 3 results in finance_basics, 200+200+200 score over 360 s
    expect(r.json().scorePerSec).toBeCloseTo(600 / 360);
  });

  it('updates rating and leaderboard', async () => {
    const win = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenB), payload: { mode: 'versus', category: 'finance_basics', opponentId: 1, won: true, score: 150, seconds: 90, questions: 25, correct: 15 } });
    expect(win.json().ratingDelta).toBe(25);
    expect(win.json().me.rating.rating).toBe(1025);
    const lose = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenB), payload: { mode: 'versus', category: 'finance_basics', opponentId: 1, won: false, score: 50, seconds: 90, questions: 25, correct: 5 } });
    expect(lose.json().me.rating.rating).toBe(1010);

    const lb = await app.inject({ method: 'GET', url: '/api/leaderboard' });
    expect(lb.json()[0]).toMatchObject({ displayName: '鮑伯', rating: 1010, wins: 1, losses: 1 });
    expect(lb.json()).toHaveLength(1);
  });

  it('rejects impossible stats', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenB), payload: { mode: 'versus', category: 'finance_basics', won: true, score: 1, seconds: 10, questions: 5, correct: 9 } });
    expect(r.statusCode).toBe(400);
  });
});
