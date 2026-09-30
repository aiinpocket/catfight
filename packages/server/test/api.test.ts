import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { deleteQuestions, findStaleQuestions, importBank, openPglite, type DB } from '../src/db.js';

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

  it('reports active battles from heartbeats and clears them on result', async () => {
    const tokenD = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'dave', displayName: 'D', password: 'password4' } })).json().token as string;
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().activeBattles).toBe(0);
    expect((await app.inject({ method: 'POST', url: '/api/battle/heartbeat', headers: H(tokenD) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().activeBattles).toBe(1);
    await app.inject({
      method: 'POST',
      url: '/api/match/result',
      headers: H(tokenD),
      payload: { mode: 'stage', category: 'finance_basics', stage: 1, won: false, score: 10, seconds: 30, questions: 5, correct: 1 },
    });
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().activeBattles).toBe(0);
  });

  it('re-importing the same bank adds nothing', async () => {
    const n = await importBank(db, { category: { id: 'security', name: '安控', sortOrder: 2 }, questions: [{ text: '安控題', options: ['A', 'B', 'C', 'D'], answerIndex: 1 }] });
    expect(n).toBe(0);
  });

  it('re-importing a corrected answer updates the row; a different option set is a new question', async () => {
    const n = await importBank(db, { category: { id: 'security', name: '安控', sortOrder: 2 }, questions: [{ text: '安控題', options: ['A', 'B', 'C', 'D'], answerIndex: 3 }] });
    expect(n).toBe(1);
    const r = await db.query<{ answer_index: number }>("SELECT answer_index FROM questions WHERE category = 'security' AND text = '安控題'");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].answer_index).toBe(3);
    const m = await importBank(db, { category: { id: 'security', name: '安控', sortOrder: 2 }, questions: [{ text: '安控題', options: ['E', 'F', 'G', 'H'], answerIndex: 0 }] });
    expect(m).toBe(1);
    const r2 = await db.query("SELECT id FROM questions WHERE category = 'security' AND text = '安控題'");
    expect(r2.rows).toHaveLength(2);
    await db.query("DELETE FROM questions WHERE category = 'security' AND options::text LIKE '%\"E\"%'");
    await importBank(db, { category: { id: 'security', name: '安控', sortOrder: 2 }, questions: [{ text: '安控題', options: ['A', 'B', 'C', 'D'], answerIndex: 1 }] });
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

  it('keeps catch-all options such as 以上皆是 at the end, in their original relative order', async () => {
    await importBank(db, {
      category: { id: 'catchall', name: '總結選項', sortOrder: 3 },
      questions: [{ text: '總結題', options: ['甲、乙、丙、丁皆非', '以上皆是', '只有甲', '只有乙'], answerIndex: 1 }],
    });
    const orders = new Set<string>();
    for (let k = 0; k < 20; k++) {
      const one = (await app.inject({ method: 'GET', url: '/api/questions?category=catchall&limit=1', headers: H(tokenA) })).json()[0] as {
        options: string[];
        answerIndex: number;
      };
      expect(one.options.slice(2)).toEqual(['甲、乙、丙、丁皆非', '以上皆是']);
      expect(one.answerIndex).toBe(3);
      orders.add(one.options.slice(0, 2).join(''));
    }
    expect(orders.size).toBe(2);
    await db.query("DELETE FROM questions WHERE category = 'catchall'");
    await db.query("DELETE FROM categories WHERE id = 'catchall'");
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
    const st = (await app.inject({ method: 'GET', url: '/api/stages', headers: H(tokenA) })).json() as {
      id: number;
      category: string;
      unlocked: boolean;
      ai: { scorePerSec: number; boss: { unitId: string }; unitMul: { hp: number } };
      powerTier: number;
      boss: { name: string; desc: string };
    }[];
    expect(st.length).toBe(100);
    expect(st.map((s) => s.category).slice(0, 4)).toEqual(['finance_basics', 'security', 'finance_basics', 'security']);
    expect(st[20].ai.scorePerSec).toBeGreaterThan(st[0].ai.scorePerSec);
    expect(st[0].powerTier).toBe(0);
    expect(st[10].powerTier).toBe(1);
    expect(st[0].ai.unitMul.hp).toBeLessThan(st[10].ai.unitMul.hp);
    // bosses are ordered by historical exit year: 太田道灌 (d. 1486) opens, 真田信之 (d. 1658) closes
    expect(st[0].boss.name).toBe('太田道灌喵');
    expect(st[0].ai.boss.unitId).toBe('boss_1');
    expect(st[99].boss.name).toBe('真田信之喵');
    const saika = st.findIndex((s) => s.boss.name === '雜賀孫市喵');
    expect(st[saika].boss.desc).toContain('貫穿');
    expect(st[saika].ai.boss.unitId).toBe(`boss_${saika + 1}`);
    expect(st.every((s) => s.unlocked)).toBe(true);
  });
});

describe('stage mode', () => {
  it('grants reward on first clear, unlocks next stage, smaller reward on replay', async () => {
    const payload = { mode: 'stage', category: 'finance_basics', stage: 1, won: true, score: 200, seconds: 120, questions: 30, correct: 20 };
    const r = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenA), payload });
    expect(r.statusCode).toBe(200);
    expect(r.json().reward).toBe(60);
    expect(r.json().me.points).toBe(60);
    expect(r.json().me.clearedCount).toBe(1);

    const st = (await app.inject({ method: 'GET', url: '/api/stages', headers: H(tokenA) })).json() as { cleared: boolean }[];
    expect(st[0].cleared).toBe(true);
    expect(st[1].cleared).toBe(false);

    // stages can be cleared in any order; each one pays its first-clear reward once
    const tokenC = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'carol', displayName: 'C', password: 'password3' } })).json().token as string;
    const r3 = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenC), payload: { ...payload, stage: 2, category: 'security' } });
    expect(r3.json().reward).toBe(70);
    expect(r3.json().me.clearedCount).toBe(1);
    expect((await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenC), payload: { ...payload, stage: 2, category: 'security' } })).json().reward).toBe(18);

    expect((await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenA), payload })).json().reward).toBe(15);
    // a loss pays half of what the win would have (floored): 15/2 -> 7 on a cleared stage, 90/2 -> 45 on an uncleared one, and never clears it
    expect((await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenA), payload: { ...payload, won: false } })).json().reward).toBe(7);
    const lost4 = (await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenC), payload: { ...payload, stage: 4, category: 'security', won: false } })).json();
    expect(lost4.reward).toBe(45);
    expect(lost4.me.clearedCount).toBe(1);
    // stage 2 is 'security', reporting it as finance_basics is rejected
    expect((await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenA), payload: { ...payload, stage: 2 } })).statusCode).toBe(400);
  });

  it('unlocks units with points and refuses when short', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/unlock', headers: H(tokenA), payload: { unitId: 'medic' } })).statusCode).toBe(400);
    // 82 points so far (60 + 15 + 7 loss consolation); clear stage 2 (+70) -> 152, mage costs 100
    await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenA), payload: { mode: 'stage', category: 'security', stage: 2, won: true, score: 100, seconds: 100, questions: 20, correct: 12 } });
    const ok = await app.inject({ method: 'POST', url: '/api/unlock', headers: H(tokenA), payload: { unitId: 'mage' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().unlockedUnits).toContain('mage');
    expect(ok.json().points).toBe(52);
    expect((await app.inject({ method: 'POST', url: '/api/unlock', headers: H(tokenA), payload: { unitId: 'mage' } })).json().points).toBe(52);
  });
});

describe('upgrades', () => {
  it('buys levels with points, enforces unlock, cost and max level', async () => {
    // alice has 52 points; tank hp level 1 costs 30
    const locked = await app.inject({ method: 'POST', url: '/api/upgrade', headers: H(tokenA), payload: { unitId: 'medic', track: 'hp' } });
    expect(locked.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/upgrade', headers: H(tokenA), payload: { unitId: 'tank', track: 'hp' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().upgrades).toEqual({ tank: { hp: 1 } });
    expect(ok.json().points).toBe(22);
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

describe('answer history', () => {
  it('counts how often a player has missed each question, across battles and per player', async () => {
    const token = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'erin', displayName: 'E', password: 'password5' } })).json().token as string;
    const qs = (await app.inject({ method: 'GET', url: '/api/questions?category=finance_basics&limit=2', headers: H(token) })).json() as { id: number }[];
    const [q1, q2] = qs.map((q) => q.id);
    const base = { mode: 'stage', category: 'finance_basics', stage: 1, won: false, score: 10, seconds: 30, questions: 3, correct: 1 };
    // q1 missed twice in one battle, q2 answered right; an id that does not exist is ignored
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/match/result',
      headers: H(token),
      payload: { ...base, questions: 4, answers: [{ questionId: q1, correct: false }, { questionId: q2, correct: true }, { questionId: q1, correct: false }, { questionId: 999999, correct: false }] },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().wrongCounts).toEqual({ [q1]: 2, [q2]: 0 });
    // next battle: totals carry over
    const r2 = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(token), payload: { ...base, questions: 2, answers: [{ questionId: q1, correct: true }, { questionId: q2, correct: false }] } });
    expect(r2.json().wrongCounts).toEqual({ [q1]: 2, [q2]: 1 });
    // another player has their own history; a result without answers still works
    const r3 = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(tokenB), payload: { ...base, questions: 1, correct: 0, answers: [{ questionId: q1, correct: false }] } });
    expect(r3.json().wrongCounts).toEqual({ [q1]: 1 });
    const r4 = await app.inject({ method: 'POST', url: '/api/match/result', headers: H(token), payload: base });
    expect(r4.statusCode).toBe(200);
    expect(r4.json().wrongCounts).toEqual({});
  });
});

describe('pruning corrected questions', () => {
  it('finds rows that no bank file contains any more, only in the categories the files cover', async () => {
    const cat = { id: 'prune_cat', name: '修剪', sortOrder: 9 };
    const good = { text: '正確的題目', options: ['A', 'B', 'C', 'D'], answerIndex: 0 };
    await importBank(db, { category: cat, questions: [good, { text: '正確的題目', options: ['A', 'B', 'C', 'D 黏到下一題的案例'], answerIndex: 0 }, { text: '舊題幹', options: ['A', 'B', 'C', 'D'], answerIndex: 1 }] });
    // the corrected bank is split over two files of the same category
    const banks = [
      { category: cat, questions: [good] },
      { category: cat, questions: [{ text: '【案例】…\n【問題】舊題幹', options: ['A', 'B', 'C', 'D'], answerIndex: 1 }] },
    ];
    for (const b of banks) await importBank(db, b);
    const stale = await findStaleQuestions(db, banks);
    expect(stale.map((s) => s.text).sort()).toEqual(['正確的題目', '舊題幹']);
    expect(stale.every((s) => s.category === 'prune_cat')).toBe(true);
    const before = Number((await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM questions WHERE category <> 'prune_cat'")).rows[0].n);
    expect(await deleteQuestions(db, stale.map((s) => s.id))).toBe(2);
    expect(await findStaleQuestions(db, banks)).toEqual([]);
    expect(Number((await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM questions WHERE category = 'prune_cat'")).rows[0].n)).toBe(2);
    expect(Number((await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM questions WHERE category <> 'prune_cat'")).rows[0].n)).toBe(before);
  });
});
