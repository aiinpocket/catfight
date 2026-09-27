import { describe, expect, it } from 'vitest';
import { simulateMatch, STAGES, type SimPlayer } from '../src/index.js';

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
  it('stage 1 is beatable by a weak player, stage 8 is hard for an average one', () => {
    const weak: SimPlayer = { secPerQuestion: 6, accuracy: 0.55, strategy: ['tank', 'archer'] };
    const w1 = Array.from({ length: 100 }, (_, i) => simulateMatch(weak, STAGES[0].ai, i + 1)).filter((r) => r.winner === 'left').length;
    expect(w1).toBeGreaterThan(60);
    const w8 = Array.from({ length: 100 }, (_, i) => simulateMatch(avg, STAGES[7].ai, i + 1)).filter((r) => r.winner === 'left').length;
    expect(w8).toBeLessThan(50);
    expect(w8).toBeGreaterThan(5);
  });
});
