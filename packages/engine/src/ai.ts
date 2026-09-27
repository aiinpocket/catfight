import { spawn, type BattleState } from './battle.js';
import type { Side } from './units.js';

export interface AiConfig {
  /** score gained per second (simulates answering) */
  scorePerSec: number;
  /** cyclic spawn order */
  strategy: string[];
  /** delay before AI starts earning, ms */
  warmupMs?: number;
}

export interface AiState {
  cfg: AiConfig;
  side: Side;
  idx: number;
  accum: number;
}

export const DEFAULT_STRATEGY = ['tank', 'archer', 'tank', 'archer', 'mage', 'tank', 'runner', 'archer', 'medic', 'scholar'];
/** 10 pts x 70% / 4 s */
export const DEFAULT_SCORE_PER_SEC = 1.75;

export function createAi(side: Side, cfg: AiConfig): AiState {
  return { cfg, side, idx: 0, accum: 0 };
}

/** Accrue score continuously and spawn according to strategy. Call once per tick before step(). */
export function aiStep(state: BattleState, ai: AiState, dtMs: number): void {
  if (state.winner) return;
  if ((ai.cfg.warmupMs ?? 0) > state.timeMs) return;
  ai.accum += ai.cfg.scorePerSec * (dtMs / 1000);
  const whole = Math.floor(ai.accum);
  if (whole > 0) {
    state.score[ai.side] += whole;
    ai.accum -= whole;
  }
  const strat = ai.cfg.strategy.length ? ai.cfg.strategy : DEFAULT_STRATEGY;
  const unitId = strat[ai.idx % strat.length];
  if (spawn(state, ai.side, unitId)) ai.idx++;
}
