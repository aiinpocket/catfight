import { UNITS, type AuraType, type Side } from './units.js';

export const FIELD_LENGTH = 1000;
export const BALANCE = { towerHp: 800, overtimeMs: 150_000, overtimeBleed: 10 };
export const TOWER_HP = BALANCE.towerHp;
export const TICK_MS = 50;
export const SCORE_PER_CORRECT = 10;
export const TOWER_RANGE_PAD = 20;
/** seconds between hits; damage per hit = dps * ATTACK_INTERVAL */
export const ATTACK_INTERVAL = 1.0;
/** after this many ms both towers bleed OVERTIME_BLEED hp/s so a match always ends */
export const OVERTIME_MS = BALANCE.overtimeMs;
export const OVERTIME_BLEED = BALANCE.overtimeBleed;

export interface Entity {
  id: number;
  side: Side;
  unitId: string;
  x: number;
  hp: number;
  maxHp: number;
  /** true while attacking this tick (renderer hint) */
  attacking: boolean;
  /** seconds until the next hit */
  cooldown: number;
  /** true on the tick a hit lands (renderer hint) */
  hit: boolean;
}

export type BattleEvent =
  | { type: 'spawn'; entityId: number; side: Side; unitId: string }
  | { type: 'death'; entityId: number; side: Side; unitId: string }
  | { type: 'towerHit'; side: Side; amount: number }
  | { type: 'win'; side: Side };

export interface BattleState {
  tick: number;
  timeMs: number;
  towerHp: Record<Side, number>;
  score: Record<Side, number>;
  entities: Entity[];
  nextId: number;
  winner: Side | null;
  /** events produced during the last step (renderer hint) */
  events: BattleEvent[];
}

export function createBattle(): BattleState {
  return {
    tick: 0,
    timeMs: 0,
    towerHp: { left: BALANCE.towerHp, right: BALANCE.towerHp },
    score: { left: 0, right: 0 },
    entities: [],
    nextId: 1,
    winner: null,
    events: [],
  };
}

export const other = (s: Side): Side => (s === 'left' ? 'right' : 'left');
const dir = (s: Side) => (s === 'left' ? 1 : -1);
export const towerX = (s: Side) => (s === 'left' ? 0 : FIELD_LENGTH);

/** Strongest active aura value of the given type on a side (auras do not stack). */
export function auraValue(state: BattleState, side: Side, type: AuraType): number {
  let best = 0;
  for (const e of state.entities) {
    if (e.side !== side || e.hp <= 0) continue;
    const a = UNITS[e.unitId].aura;
    if (a && a.type === type) best = Math.max(best, a.value);
  }
  return best;
}

/** Add score for a correct answer; applies scholar aura. Returns points gained. */
export function addScore(state: BattleState, side: Side, base = SCORE_PER_CORRECT): number {
  const gained = base + auraValue(state, side, 'scoreBonus');
  state.score[side] += gained;
  return gained;
}

export function canSpawn(state: BattleState, side: Side, unitId: string): boolean {
  const def = UNITS[unitId];
  return !!def && state.winner === null && state.score[side] >= def.cost;
}

/** Spend score and spawn. Returns the entity or null if unaffordable. */
export function spawn(state: BattleState, side: Side, unitId: string): Entity | null {
  if (!canSpawn(state, side, unitId)) return null;
  const def = UNITS[unitId];
  state.score[side] -= def.cost;
  const e: Entity = { id: state.nextId++, side, unitId, x: towerX(side), hp: def.hp, maxHp: def.hp, attacking: false, cooldown: 0, hit: false };
  state.entities.push(e);
  state.events.push({ type: 'spawn', entityId: e.id, side, unitId });
  return e;
}

/** Advance the simulation by one tick. Deterministic. */
export function step(state: BattleState, dtMs = TICK_MS): void {
  if (state.winner) return;
  state.events = [];
  const dt = dtMs / 1000;
  state.tick++;
  state.timeMs += dtMs;

  const speedMul: Record<Side, number> = {
    left: 1 + auraValue(state, 'left', 'speed'),
    right: 1 + auraValue(state, 'right', 'speed'),
  };
  const heal: Record<Side, number> = {
    left: auraValue(state, 'left', 'heal'),
    right: auraValue(state, 'right', 'heal'),
  };
  const damage = new Map<number, number>();
  const towerDamage: Record<Side, number> = { left: 0, right: 0 };
  // positions at the start of the tick, so processing order does not favour either side
  const x0 = new Map<number, number>(state.entities.map((e) => [e.id, e.x]));
  const px = (t: Entity) => x0.get(t.id)!;

  for (const e of state.entities) {
    if (e.hp <= 0) continue;
    const def = UNITS[e.unitId];
    const enemy = other(e.side);
    const d = dir(e.side);
    const ex = px(e);
    e.attacking = false;
    e.hit = false;
    e.cooldown = Math.max(0, e.cooldown - dt);
    const hitDmg = def.dps * ATTACK_INTERVAL;
    if (def.dps > 0) {
      const inRange = state.entities.filter(
        (t) => t.side === enemy && t.hp > 0 && (px(t) - ex) * d >= -5 && Math.abs(px(t) - ex) <= def.range,
      );
      if (inRange.length > 0) {
        e.attacking = true;
        const targets =
          def.attackType === 'area'
            ? inRange
            : [inRange.reduce((a, b) => (Math.abs(px(a) - ex) <= Math.abs(px(b) - ex) ? a : b))];
        if (e.cooldown <= 0) {
          e.hit = true;
          e.cooldown = ATTACK_INTERVAL;
          for (const t of targets) damage.set(t.id, (damage.get(t.id) ?? 0) + hitDmg);
        }
        continue;
      }
      const distTower = Math.abs(towerX(enemy) - ex);
      if (distTower <= def.range + TOWER_RANGE_PAD) {
        e.attacking = true;
        if (e.cooldown <= 0) {
          e.hit = true;
          e.cooldown = ATTACK_INTERVAL;
          towerDamage[enemy] += hitDmg;
        }
        continue;
      }
    } else {
      // support units hang back: stop when an enemy is close ahead, or near the enemy tower
      const blocked = state.entities.some(
        (t) => t.side === enemy && t.hp > 0 && (px(t) - ex) * d >= 0 && Math.abs(px(t) - ex) <= 60,
      );
      if (blocked) continue;
      if (Math.abs(towerX(enemy) - ex) <= 80) continue;
    }
    e.x += d * def.speed * speedMul[e.side] * dt;
    e.x = Math.max(0, Math.min(FIELD_LENGTH, e.x));
  }

  for (const e of state.entities) {
    const dmg = damage.get(e.id) ?? 0;
    e.hp = Math.min(e.maxHp, e.hp - dmg + heal[e.side] * dt);
    if (e.hp <= 0) {
      e.hp = 0;
      state.events.push({ type: 'death', entityId: e.id, side: e.side, unitId: e.unitId });
    }
  }
  state.entities = state.entities.filter((e) => e.hp > 0);

  if (state.timeMs > BALANCE.overtimeMs) {
    towerDamage.left += BALANCE.overtimeBleed * dt;
    towerDamage.right += BALANCE.overtimeBleed * dt;
  }
  for (const side of ['left', 'right'] as Side[]) {
    if (towerDamage[side] > 0) {
      state.towerHp[side] = Math.max(0, state.towerHp[side] - towerDamage[side]);
      state.events.push({ type: 'towerHit', side, amount: towerDamage[side] });
    }
  }
  if (state.towerHp.right <= 0 && state.towerHp.left <= 0) {
    // simultaneous (overtime): more army hp wins, then more unspent score, then tick parity
    const armyHp = (side: Side) => state.entities.filter((e) => e.side === side).reduce((a, e) => a + e.hp, 0);
    const dl = armyHp('left') - armyHp('right');
    const ds = state.score.left - state.score.right;
    state.winner = dl !== 0 ? (dl > 0 ? 'left' : 'right') : ds !== 0 ? (ds > 0 ? 'left' : 'right') : state.tick % 2 === 0 ? 'left' : 'right';
  } else if (state.towerHp.right <= 0) state.winner = 'left';
  else if (state.towerHp.left <= 0) state.winner = 'right';
  if (state.winner) state.events.push({ type: 'win', side: state.winner });
}
