import { spawn, spawnFree, towerX, type BattleState } from './battle.js';
import type { Side } from './units.js';

export interface BossSpawn {
  unitId: string;
  /** when the boss first appears */
  atMs: number;
  /** re-appears this long after it dies (0 = never) */
  respawnMs?: number;
}

export interface AiConfig {
  /** score gained per second (simulates answering) */
  scorePerSec: number;
  /** cyclic spawn order */
  strategy: string[];
  /** delay before AI starts earning, ms */
  warmupMs?: number;
  /** stage boss */
  boss?: BossSpawn;
  /** stat multiplier for the AI's regular cats, including boss summons and splits (the boss itself is unaffected); 1 = same as the player's */
  unitMul?: { hp: number; dps: number };
  /** score the AI starts with (mirrors the player's stage starting score) */
  startScore?: number;
}

export interface AiState {
  cfg: AiConfig;
  side: Side;
  idx: number;
  accum: number;
  bossEntityId: number | null;
  bossDiedAt: number | null;
  bossSpawns: number;
}

export const DEFAULT_STRATEGY = ['tank', 'archer', 'tank', 'archer', 'mage', 'tank', 'runner', 'archer', 'medic', 'scholar'];
/** 10 pts x 70% / 4 s */
export const DEFAULT_SCORE_PER_SEC = 1.75;

export function createAi(side: Side, cfg: AiConfig): AiState {
  return { cfg, side, idx: 0, accum: 0, bossEntityId: null, bossDiedAt: null, bossSpawns: 0 };
}

/** Accrue score continuously and spawn according to strategy; handles boss (re)spawns. Call once per tick before step(). */
export function aiStep(state: BattleState, ai: AiState, dtMs: number): void {
  if (state.winner) return;
  if (ai.cfg.unitMul) state.unitMul[ai.side] = ai.cfg.unitMul;
  const boss = ai.cfg.boss;
  if (boss) {
    if (ai.bossEntityId !== null && !state.entities.some((e) => e.id === ai.bossEntityId)) {
      ai.bossEntityId = null;
      ai.bossDiedAt = state.timeMs;
    }
    const due =
      ai.bossEntityId === null &&
      (ai.bossSpawns === 0 ? state.timeMs >= boss.atMs : !!boss.respawnMs && ai.bossDiedAt !== null && state.timeMs - ai.bossDiedAt >= boss.respawnMs);
    if (due) {
      // bosses step out in front of their tower so stationary ones do not sit on it
      const e = spawnFree(state, ai.side, boss.unitId, towerX(ai.side) + (ai.side === 'left' ? 80 : -80));
      if (e) {
        ai.bossEntityId = e.id;
        ai.bossSpawns++;
      }
    }
  }
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
