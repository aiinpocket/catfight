import type { AiConfig } from './ai.js';

export interface StageDef {
  id: number;
  name: string;
  category: string;
  ai: AiConfig;
  /** points granted on first clear */
  reward: number;
}

/** How many times the category list cycles before the stage list ends. */
export const STAGE_ROUNDS = 5;

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
 * AI difficulty for stage n (1-based). Score income grows linearly and is capped,
 * warm-up shrinks, the spawn strategy gets richer.
 * n=1 -> 0.5/s (weak players win ~95%), n=15 -> ~3.0/s (average players win ~30%).
 */
export function stageAi(n: number): AiConfig {
  const scorePerSec = Math.min(3.5, +(0.5 + (n - 1) * 0.18).toFixed(2));
  const warmupMs = Math.max(0, 8000 - (n - 1) * 1000);
  const strategy = STRATEGIES[Math.min(STRATEGIES.length - 1, Math.floor((n - 1) / 2))];
  return { scorePerSec, strategy, warmupMs };
}

export function stageReward(n: number): number {
  return 50 + n * 10;
}

/**
 * Build the stage list from the category order stored in the database:
 * stage n uses categories[(n-1) % categories.length], so the same bank comes back
 * every full cycle at a higher difficulty.
 */
export function buildStages(categories: { id: string; name: string }[], rounds = STAGE_ROUNDS): StageDef[] {
  if (!categories.length) return [];
  return Array.from({ length: categories.length * rounds }, (_, i) => {
    const n = i + 1;
    const cat = categories[i % categories.length];
    const round = Math.floor(i / categories.length) + 1;
    const stars = round > 1 ? ` ${'★'.repeat(Math.min(round - 1, 4))}` : '';
    return { id: n, name: `${cat.name}${stars}`, category: cat.id, ai: stageAi(n), reward: stageReward(n) };
  });
}
