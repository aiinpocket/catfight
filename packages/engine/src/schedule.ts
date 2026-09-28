/**
 * The difficulty standard: stages 1-10 are tuned for a player answering 40% right, then the bar rises
 * 5 points every 5 stages until it reaches 80% (stage 46) and stays there. The reference player reads
 * every question (REF_PLAYER.secPerQuestion) rather than guessing fast.
 */
export const ACCURACY_SCHEDULE = { first: 0.4, firstUntil: 10, step: 0.05, every: 5, max: 0.8 };
export const REF_PLAYER = { secPerQuestion: 7.5 };

export function targetAccuracy(n: number): number {
  const s = ACCURACY_SCHEDULE;
  if (n <= s.firstUntil) return s.first;
  return +Math.min(s.max, s.first + s.step * (Math.floor((n - s.firstUntil - 1) / s.every) + 1)).toFixed(2);
}

/** 0 for the first block, +1 per accuracy step of the schedule */
export function powerTier(n: number): number {
  return Math.round((targetAccuracy(n) - ACCURACY_SCHEDULE.first) / ACCURACY_SCHEDULE.step);
}
export const POWER_MAX_TIER = Math.round((ACCURACY_SCHEDULE.max - ACCURACY_SCHEDULE.first) / ACCURACY_SCHEDULE.step);

/** first stage at which the bar reaches its maximum */
export const SCHEDULE_TOP_STAGE = ACCURACY_SCHEDULE.firstUntil + ACCURACY_SCHEDULE.every * (POWER_MAX_TIER - 1) + 1;

/** 0..1 along the accuracy schedule (1 once the bar is at its max) */
export function scheduleT(n: number): number {
  return powerTier(n) / POWER_MAX_TIER;
}

/** 0..1 across the stages after the bar is maxed (matches the player's upgrade growth), 0 before */
export function lateT(n: number, count = 100): number {
  return Math.max(0, Math.min(1, (n - SCHEDULE_TOP_STAGE) / (count - SCHEDULE_TOP_STAGE)));
}

/** points per second a reader earns at the given accuracy (10 per correct answer; wrong answers linger a bit longer) */
export function readerIncome(accuracy: number, secPerQuestion = REF_PLAYER.secPerQuestion): number {
  const perQuestion = secPerQuestion + 0.3 * accuracy + 1.2 * (1 - accuracy);
  return (10 * accuracy) / perQuestion;
}
