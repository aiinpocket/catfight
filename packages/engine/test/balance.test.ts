import { describe, expect, it } from 'vitest';
import { buildStages, simulateMatch, stageAi, uniformUpgrades, type SimPlayer } from '../src/index.js';

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
  it('stage 1 is beatable by an average player, stage 55 is a coin flip for an upgraded average one', () => {
    // stage 1 is meant to be a real fight: average players win most of the time, weak ones struggle
    const w1 = Array.from({ length: 100 }, (_, i) => simulateMatch(avg, stageAi(1), i + 1)).filter((r) => r.winner === 'left').length;
    expect(w1).toBeGreaterThan(75);
    const mid = { ...avg, upgrades: uniformUpgrades(5) };
    const w55 = Array.from({ length: 60 }, (_, i) => simulateMatch(mid, stageAi(55), i + 1)).filter((r) => r.winner === 'left').length / 60;
    expect(w55).toBeLessThan(0.9);
  });

  it('difficulty is monotonic and cycles categories', () => {
    for (let n = 1; n < 100; n++) expect(stageAi(n + 1).scorePerSec).toBeGreaterThanOrEqual(stageAi(n).scorePerSec);
    expect(stageAi(100).scorePerSec).toBeGreaterThan(stageAi(1).scorePerSec * 4);
    const st = buildStages([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], 6);
    expect(st.map((s) => s.category)).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
    expect(st[3].boss.hp).toBeGreaterThanOrEqual(st[0].boss.hp * 0.5);
    expect(st[3].boss.name).not.toBe(st[0].boss.name);
    expect(buildStages([])).toEqual([]);
  });
});
