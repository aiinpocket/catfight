import { addScore, createBattle, spawn, step, TICK_MS, type BattleState } from './battle.js';
import { aiStep, createAi, DEFAULT_STRATEGY, type AiConfig } from './ai.js';
import type { Side } from './units.js';

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimPlayer {
  /** average seconds per question */
  secPerQuestion: number;
  /** probability of a correct answer */
  accuracy: number;
  strategy?: string[];
}

export interface SimResult {
  winner: Side | null;
  seconds: number;
  questions: Record<Side, number>;
  correct: Record<Side, number>;
}

/**
 * Headless match between a simulated human player (left) and either another
 * simulated human or an AI config (right). Used by tests and the balance script.
 */
export function simulateMatch(left: SimPlayer, right: SimPlayer | AiConfig, seed = 1, maxSeconds = 600): SimResult {
  const rand = rng(seed);
  const state = createBattle();
  const players: { side: Side; p: SimPlayer; nextAt: number; idx: number }[] = [{ side: 'left', p: left, nextAt: 0, idx: 0 }];
  let ai = null as ReturnType<typeof createAi> | null;
  if ('scorePerSec' in right) ai = createAi('right', right);
  else players.push({ side: 'right', p: right, nextAt: 0, idx: 0 });

  const questions: Record<Side, number> = { left: 0, right: 0 };
  const correct: Record<Side, number> = { left: 0, right: 0 };

  while (!state.winner && state.timeMs < maxSeconds * 1000) {
    for (const pl of players) {
      if (state.timeMs >= pl.nextAt) {
        questions[pl.side]++;
        const ok = rand() < pl.p.accuracy;
        // answer time jitter +-30%; wrong answers cost an extra 1.2 s reveal
        const t = pl.p.secPerQuestion * (0.7 + rand() * 0.6) + (ok ? 0.3 : 1.2);
        pl.nextAt = state.timeMs + t * 1000;
        if (ok) {
          correct[pl.side]++;
          addScore(state, pl.side);
        }
      }
      const strat = pl.p.strategy ?? DEFAULT_STRATEGY;
      const unitId = strat[pl.idx % strat.length];
      if (spawn(state, pl.side, unitId)) pl.idx++;
    }
    if (ai) aiStep(state, ai, TICK_MS);
    step(state, TICK_MS);
  }
  return { winner: state.winner, seconds: state.timeMs / 1000, questions, correct };
}

export function runUntilEnd(state: BattleState, maxTicks = 20000): BattleState {
  for (let i = 0; i < maxTicks && !state.winner; i++) step(state);
  return state;
}
