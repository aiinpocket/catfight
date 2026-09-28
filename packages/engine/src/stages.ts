import type { AiConfig } from './ai.js';
import { BOSS_COUNT, bossDef, bossId } from './bosses.js';
import { POWER_MAX_TIER, powerTier, readerIncome, targetAccuracy } from './schedule.js';

export interface StageDef {
  id: number;
  name: string;
  category: string;
  ai: AiConfig;
  /** points granted on first clear */
  reward: number;
  /** accuracy the stage is tuned for: a player who reads every question and answers this well should clear it */
  targetAccuracy: number;
  /** enemy cat power tier (0 = weakest); one step per accuracy step of the schedule */
  powerTier: number;
  boss: { unitId: string; name: string; desc: string; hp: number; dps: number; range: number };
}

/** Total number of stages. */
export const STAGE_COUNT = BOSS_COUNT;
/** AI income relative to what the reference player earns at the stage's target accuracy; unit power range */
export const STAGE_TUNE = { incomeFactor: 1.0, startScore: 50, unitMulMin: 0.7, unitMulMax: 1.0, respawnFrom: 60, respawnMs: 60_000 };

/** hp/dps multiplier for the AI's regular cats at stage n: weakest at the first block, full strength once the bar hits its max */
export function unitMul(n: number): { hp: number; dps: number } {
  const m = +(STAGE_TUNE.unitMulMin + (STAGE_TUNE.unitMulMax - STAGE_TUNE.unitMulMin) * (powerTier(n) / POWER_MAX_TIER)).toFixed(3);
  return { hp: m, dps: m };
}

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
 * AI difficulty for stage n (1..100). The AI earns what the reference player would earn at the stage's
 * target accuracy (times incomeFactor), its regular cats grow from half to full strength along the
 * accuracy schedule, warm-up shrinks, the spawn strategy gets richer, and the stage boss shows up
 * earlier (and comes back once more in the late game).
 */
export function stageAi(n: number): AiConfig {
  const t = Math.min(1, Math.max(0, (n - 1) / (STAGE_COUNT - 1)));
  const scorePerSec = +(readerIncome(targetAccuracy(n)) * STAGE_TUNE.incomeFactor).toFixed(2);
  const warmupMs = Math.round(Math.max(0, 3000 - 3000 * t));
  const strategy = STRATEGIES[Math.min(STRATEGIES.length - 1, Math.floor(t * STRATEGIES.length))];
  return {
    scorePerSec,
    strategy,
    warmupMs,
    boss: { unitId: bossId(n), atMs: Math.round(20_000 - 8_000 * t), respawnMs: n >= STAGE_TUNE.respawnFrom ? STAGE_TUNE.respawnMs : 0 },
    unitMul: unitMul(n),
    startScore: STAGE_TUNE.startScore,
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
      targetAccuracy: targetAccuracy(n),
      powerTier: powerTier(n),
      boss: { unitId: b.id, name: b.name, desc: b.desc, hp: b.hp, dps: b.dps, range: b.range },
    };
  });
}
