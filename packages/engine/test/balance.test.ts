import { describe, expect, it } from 'vitest';
import {
  aiStep,
  bossDef,
  buildStages,
  createAi,
  createBattle,
  POWER_MAX_TIER,
  powerTier,
  REF_PLAYER,
  SCHEDULE_TOP_STAGE,
  simulateMatch,
  stageAi,
  targetAccuracy,
  TICK_MS,
  uniformUpgrades,
  unitMul,
  UNITS,
  type SimPlayer,
} from '../src/index.js';

const avg: SimPlayer = { secPerQuestion: 4, accuracy: 0.7 };

function percentile(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

describe('balance: two average players', () => {
  const N = 300;
  const results = Array.from({ length: N }, (_, i) => simulateMatch(avg, avg, i + 1));
  const qs = results.map((r) => r.questions.left);

  it('always ends with a winner well before the cap', () => {
    expect(results.every((r) => r.winner !== null)).toBe(true);
  });

  it('decides the match after 30-50 questions (median), p10 >= 20, p90 <= 80', () => {
    const med = percentile(qs, 0.5);
    expect(med).toBeGreaterThanOrEqual(30);
    expect(med).toBeLessThanOrEqual(50);
    expect(percentile(qs, 0.1)).toBeGreaterThanOrEqual(20);
    expect(percentile(qs, 0.9)).toBeLessThanOrEqual(80);
  });

  it('is fair between sides', () => {
    const leftWins = results.filter((r) => r.winner === 'left').length / N;
    expect(leftWins).toBeGreaterThan(0.4);
    expect(leftWins).toBeLessThan(0.6);
  });
});

describe('balance: stage curve', () => {
  it('follows the accuracy standard: 40% for stages 1-10, +5% every 5 stages up to 80%', () => {
    expect(targetAccuracy(1)).toBe(0.4);
    expect(targetAccuracy(10)).toBe(0.4);
    expect(targetAccuracy(11)).toBe(0.45);
    expect(targetAccuracy(15)).toBe(0.45);
    expect(targetAccuracy(16)).toBe(0.5);
    expect(targetAccuracy(45)).toBe(0.75);
    expect(targetAccuracy(46)).toBe(0.8);
    expect(SCHEDULE_TOP_STAGE).toBe(46);
    expect(targetAccuracy(100)).toBe(0.8);
  });

  it('a reader at the stage target accuracy wins most matches (calibrated bosses); stage 1 is easy for an average player', () => {
    const w1 = Array.from({ length: 100 }, (_, i) => simulateMatch(avg, stageAi(1), i + 1)).filter((r) => r.winner === 'left').length;
    expect(w1).toBeGreaterThan(75);
    for (const n of [1, 8, 17, 33, 46, 64, 90]) {
      const p: SimPlayer = { secPerQuestion: REF_PLAYER.secPerQuestion, accuracy: targetAccuracy(n), strategy: n < 20 ? ['tank', 'archer'] : undefined, upgrades: uniformUpgrades(Math.min(10, Math.round(n / 10))) };
      const w = Array.from({ length: 60 }, (_, i) => simulateMatch(p, stageAi(n), i + 1)).filter((r) => r.winner === 'left').length / 60;
      expect(w, `stage ${n}`).toBeGreaterThanOrEqual(0.55);
    }
  });

  it('difficulty is monotonic and cycles categories', () => {
    for (let n = 1; n < 100; n++) expect(stageAi(n + 1).scorePerSec).toBeGreaterThanOrEqual(stageAi(n).scorePerSec);
    expect(stageAi(100).scorePerSec).toBeGreaterThan(stageAi(1).scorePerSec * 1.5);
    const st = buildStages([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], 6);
    expect(st.map((s) => s.category)).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
    expect(st[3].targetAccuracy).toBe(0.4);
    expect(st[3].boss.name).not.toBe(st[0].boss.name);
    expect(buildStages([])).toEqual([]);
  });
});

describe('balance: enemy cat power tiers', () => {
  it('AI cats start weak and gain a step per accuracy step, bosses are untouched', () => {
    expect(powerTier(1)).toBe(0);
    expect(powerTier(10)).toBe(0);
    expect(powerTier(11)).toBe(1);
    expect(powerTier(16)).toBe(2);
    expect(powerTier(46)).toBe(POWER_MAX_TIER);
    expect(powerTier(100)).toBe(POWER_MAX_TIER);
    expect(unitMul(1).hp).toBeLessThan(unitMul(11).hp);
    expect(unitMul(100).hp).toBe(1);
    const state = createBattle();
    const ai = createAi('right', { ...stageAi(1), boss: undefined, warmupMs: 0 });
    state.score.right = 100;
    aiStep(state, ai, TICK_MS);
    const cat = state.entities.find((e) => e.side === 'right')!;
    expect(cat.unitId).toBe('tank');
    expect(cat.maxHp).toBe(Math.round(UNITS.tank.hp * unitMul(1).hp));
    expect(cat.dps).toBeCloseTo(UNITS.tank.dps * unitMul(1).dps);
    const b = bossDef(1);
    const st = createBattle();
    const ai2 = createAi('right', stageAi(1));
    st.timeMs = stageAi(1).boss!.atMs;
    aiStep(st, ai2, TICK_MS);
    const boss = st.entities.find((e) => e.unitId === b.id)!;
    expect(boss.maxHp).toBe(b.hp);
  });

  it('a slow reader (7 s per question, 60% right) wins most of the first three stages', () => {
    const reader: SimPlayer = { secPerQuestion: 7.5, accuracy: 0.6, strategy: ['tank', 'archer'] };
    for (const n of [1, 2, 3]) {
      const w = Array.from({ length: 60 }, (_, i) => simulateMatch(reader, stageAi(n), i + 1)).filter((r) => r.winner === 'left').length / 60;
      expect(w, `stage ${n}`).toBeGreaterThan(0.7);
    }
  });
});
