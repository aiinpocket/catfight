import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { importBank, openPglite, type DB } from '../src/db.js';

let db: DB;
let app: FastifyInstance;
let tokenA = '';
let tokenB = '';

const H = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  db = await openPglite();
  await importBank(db, {
    category: { id: 'finance_basics', name: '金融常識', sortOrder: 1 },
    questions: Array.from({ length: 12 }, (_, i) => ({ text: `題目 ${i}`, options: ['甲', '乙', '丙', '丁'], answerIndex: i % 4 })),
  });
  await importBank(db, { category: { id: 'security', name: '安控', sortOrder: 2 }, questions: [{ text: '安控題', options: ['A', 'B', 'C', 'D'], answerIndex: 1 }] });
  await importBank(db, { category: { id: 'empty_cat', name: '空的', sortOrder: 3 }, questions: [] });
  app = buildApp({ db, jwtSecret: 'test-secret' });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('auth', () => {
  it('registers, rejects duplicates and bad input, logs in', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Alice_1', displayName: '愛麗絲', password: 'password1' } });
    expect(r.statusCode).toBe(200);
    tokenA = r.json().token;
    expect(r.json().me.unlockedUnits).toEqual(['tank', 'archer']);
    expect(r.json().me.username).toBe('alice_1');

    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'alice_1', displayName: 'x', password: 'password1' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'a', displayName: 'x', password: 'short' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ALICE_1', password: 'password1' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice_1', password: 'nope-nope' } })).statusCode).toBe(401);

    const b = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bob', displayName: '鮑伯', password: 'password2' } });
    tokenB = b.json().token;
  });

  it('never returns the password hash and requires a token', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: H(tokenA) });
    expect(me.statusCode).toBe(200);
    expect(JSON.stringify(me.json())).not.toContain('$2');
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
  });
});

describe('categories, questions and stages', () => {
  it('lists categories with counts in sort order', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/categories' });
    expect(r.json()).toEqual([
      { id: 'finance_basics', name: '金融常識', count: 12 },
      { id: 'security', name: '安控', count: 1 },
      { id: 'empty_cat', name: '空的', count: 0 },
    ]);
  });

  it('re-importing the same bank adds nothing', async () => {
    const n = await importBank(db, { category: { id: 'security', name: '安控', sortOrder: 2 }, questions: [{ text: '安控題', options: ['A', 'B', 'C', 'D'], answerIndex: 1 }] });
    expect(n).toBe(0);
  });

  it('returns random questions with shuffled options and a consistent answer index', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/questions?category=finance_basics&limit=12', headers: H(tokenA) });
    expect(r.statusCode).toBe(200);
    const qs = r.json() as { id: number; text: string; options: string[]; answerIndex: number }[];
    expect(qs).toHaveLength(12);
    for (const q of qs) {
      const i = Number(q.text.replace('題目 ', ''));
      expect(q.options[q.answerIndex]).toBe(['甲', '乙', '丙', '丁'][i % 4]);
      expect(new Set(q.options)).toEqual(new Set(['甲', '乙', '丙', '丁']));
    }
    // over many deliveries the option order must vary
    const orders = new Set<string>();
    for (let k = 0; k < 15; k++) {
      const one = (await app.inject({ method: 'GET', url: '/api/questions?category=security&limit=1', headers: H(tokenA) })).json()[0];
      orders.add(one.options.join(''));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('honours exclude, tops up small banks, rejects unknown categories', async () => {
    const first = (await app.inject({ method: 'GET', url: '/api/questions?category=finance_basics&limit=5', headers: H(tokenA) })).json() as { id: number }[];
    const ex = first.map((q) => q.id).join(',');
    const second = (await app.inject({ method: 'GET', url: `/api/questions?category=finance_basics&limit=5&exclude=${ex}`, headers: H(tokenA) })).json() as { id: number }[];
    expect(second.some((q) => first.some((f) => f.id === q.id))).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/questions?category=security&limit=50', headers: H(tokenA) })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/questions?category=nope', headers: H(tokenA) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/questions?category=empty_cat', headers: H(tokenA) })).json()).toEqual([]);
  });

  it('builds stages by cycling categories that have questions', async () => {
    const st = (await app.inject({ method: 'GET', url: '/api/stages', headers: H(tokenA) })).json() as { id: number; category: string; unlocked: boolean; ai: { scorePerSec: number } }[];
    expect(st.length).toBe(2 * 5);
    expect(st.map((s) => s.category).slice(0, 4)).toEqual(['finance_basics', 'security', 'finance_basics', 'security']);
    expect(st[2].ai.scorePerSec).toBeGreaterThan(st[0].ai.scorePerSec);
    expect(st[0].unlocked).toBe(true);
    expect(st[1].unlocked).toBe(false);
  });
});

describe('stage mode', () => {
  it('grants reward on first clear, unlocks next stage, smaller reward on replay', async () => {
    const payload = { mode: 'stage', category: 'finance_basics', stage: 1, won: true, score: 200, seconds: 120, questions: 30, correct: 20 };
    const r = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenA), payload });
    expect(r.statusCode).toBe(200);
    expect(r.json().reward).toBe(60);
    expect(r.json().me.points).toBe(60);
    expect(r.json().me.maxStage).toBe(1);

    const st = (await app.inject({ method: 'GET', url: '/api/stages', headers: H(tokenA) })).json();
    expect(st[1].unlocked).toBe(true);

    expect((await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenA), payload })).json().reward).toBe(15);
    expect((await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenA), payload: { ...payload, won: false } })).json().reward).toBe(0);
    // stage 2 is 'security', reporting it as finance_basics is rejected
    expect((await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenA), payload: { ...payload, stage: 2 } })).statusCode).toBe(400);
  });

  it('unlocks units with points and refuses when short', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/unlock', headers: H(tokenA), payload: { unitId: 'medic' } })).statusCode).toBe(400);
    // 75 points so far; clear stage 2 (+70) -> 145, mage costs 100
    await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenA), payload: { mode: 'stage', category: 'security', stage: 2, won: true, score: 100, seconds: 100, questions: 20, correct: 12 } });
    const ok = await app.inject({ method: 'POST', url: '/api/unlock', headers: H(tokenA), payload: { unitId: 'mage' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().unlockedUnits).toContain('mage');
    expect(ok.json().points).toBe(45);
    expect((await app.inject({ method: 'POST', url: '/api/unlock', headers: H(tokenA), payload: { unitId: 'mage' } })).json().points).toBe(45);
  });
});

describe('upgrades', () => {
  it('buys levels with points, enforces unlock, cost and max level', async () => {
    // alice has 45 points; tank hp level 1 costs 30
    const locked = await app.inject({ method: 'POST', url: '/api/upgrade', headers: H(tokenA), payload: { unitId: 'medic', track: 'hp' } });
    expect(locked.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/upgrade', headers: H(tokenA), payload: { unitId: 'tank', track: 'hp' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().upgrades).toEqual({ tank: { hp: 1 } });
    expect(ok.json().points).toBe(15);
    const poor = await app.inject({ method: 'POST', url: '/api/upgrade', headers: H(tokenA), payload: { unitId: 'tank', track: 'special' } });
    expect(poor.statusCode).toBe(400);
    expect(poor.json().error).toBe('點數不足');
    const bad = await app.inject({ method: 'POST', url: '/api/upgrade', headers: H(tokenA), payload: { unitId: 'tank', track: 'luck' } });
    expect(bad.statusCode).toBe(400);
    // max level
    await db.query(`UPDATE user_progress SET points = 100000, upgrades = '{"tank":{"hp":10}}' WHERE user_id = 1`);
    const max = await app.inject({ method: 'POST', url: '/api/upgrade', headers: H(tokenA), payload: { unitId: 'tank', track: 'hp' } });
    expect(max.statusCode).toBe(400);
    expect(max.json().error).toBe('已達最高等級');
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: H(tokenA) });
    expect(me.json().upgrades.tank.hp).toBe(10);
  });
});

describe('versus mode', () => {
  it('falls back to a bot when nobody else has played the category', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/match/opponent', headers: H(tokenB), payload: { category: 'empty_cat' } });
    expect(r.json().opponentId).toBeNull();
    expect(r.json().scorePerSec).toBeCloseTo(1.75);
  });

  it('matches against another player using their score-per-second in that category', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/match/opponent', headers: H(tokenB), payload: { category: 'finance_basics' } });
    expect(r.json().displayName).toBe('愛麗絲');
    expect(r.json().scorePerSec).toBeCloseTo(600 / 360);
  });

  it('updates rating and leaderboard', async () => {
    const win = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenB), payload: { mode: 'versus', category: 'finance_basics', opponentId: 1, won: true, score: 150, seconds: 90, questions: 25, correct: 15 } });
    expect(win.json().ratingDelta).toBe(25);
    expect(win.json().me.rating.rating).toBe(1025);
    const lose = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenB), payload: { mode: 'versus', category: 'finance_basics', opponentId: 1, won: false, score: 50, seconds: 90, questions: 25, correct: 5 } });
    expect(lose.json().me.rating.rating).toBe(1010);
    const lb = await app.inject({ method: 'GET', url: '/api/leaderboard' });
    expect(lb.json()).toEqual([{ displayName: '鮑伯', rating: 1010, wins: 1, losses: 1 }]);
  });

  it('rejects impossible stats', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenB), payload: { mode: 'versus', category: 'finance_basics', won: true, score: 1, seconds: 10, questions: 5, correct: 9 } });
    expect(r.statusCode).toBe(400);
  });
});
