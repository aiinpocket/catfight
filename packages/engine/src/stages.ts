import type { AiConfig } from './ai.js';
import { BOSS_COUNT, bossDef, bossId } from './bosses.js';

export interface StageDef {
  id: number;
  name: string;
  category: string;
  ai: AiConfig;
  /** points granted on first clear */
  reward: number;
  boss: { unitId: string; name: string; desc: string; hp: number; dps: number; range: number };
}

/** Total number of stages. */
export const STAGE_COUNT = BOSS_COUNT;
/** AI income curve knobs: scorePerSec = base + gain * t^pow */
export const STAGE_TUNE = { base: 0.5, gain: 2.5, pow: 1.8, respawnFrom: 80, respawnMs: 75_000 };

const STRATEGIES: string[][] = [
  ['tank', 'tank', 'archer'],
  ['tank', 'archer'],
  ['tank', 'archer', 'tank', 'mage'],
  ['tank', 'archer', 'mage'],
  ['tank', 'archer', 'runner', 'mage'],
  ['tank', 'mage', 'archer', 'medic'],
  ['tank', 'archer', 'mage', 'medic', 'runner'],
  ['tank', 'tank', 'archer', 'mage', 'medic', 'mage'],
];

/**
 * AI difficulty for stage n (1..100). Score income rises smoothly (0.5/s -> ~4.5/s),
 * warm-up shrinks, the spawn strategy gets richer, and the stage boss shows up earlier
 * (and comes back once more in the late game).
 */
export function stageAi(n: number): AiConfig {
  const t = Math.min(1, Math.max(0, (n - 1) / (STAGE_COUNT - 1)));
  const scorePerSec = +(STAGE_TUNE.base + STAGE_TUNE.gain * Math.pow(t, STAGE_TUNE.pow)).toFixed(2);
  const warmupMs = Math.round(Math.max(0, 8000 - 8000 * t));
  const strategy = STRATEGIES[Math.min(STRATEGIES.length - 1, Math.floor(t * STRATEGIES.length))];
  return {
    scorePerSec,
    strategy,
    warmupMs,
    boss: { unitId: bossId(n), atMs: Math.round(60_000 - 35_000 * t), respawnMs: n >= STAGE_TUNE.respawnFrom ? STAGE_TUNE.respawnMs : 0 },
  };
}

export function stageReward(n: number): number {
  return 50 + n * 10;
}

/**
 * Build the stage list from the category order stored in the database:
 * stage n uses categories[(n-1) % categories.length], so the same bank comes back
 * every full cycle at a higher difficulty. Each stage has its own warlord boss.
 */
export function buildStages(categories: { id: string; name: string }[], count = STAGE_COUNT): StageDef[] {
  if (!categories.length) return [];
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const cat = categories[i % categories.length];
    const b = bossDef(n);
    return {
      id: n,
      name: cat.name,
      category: cat.id,
      ai: stageAi(n),
      reward: stageReward(n),
      boss: { unitId: b.id, name: b.name, desc: b.desc, hp: b.hp, dps: b.dps, range: b.range },
    };
  });
}
