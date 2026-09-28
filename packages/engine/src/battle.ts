import { UNITS, type AuraType, type Side, type UnitDef } from './units.js';
import { effectiveStats, type Upgrades } from './upgrades.js';
import { unitDef } from './bosses.js';

export const FIELD_LENGTH = 1000;
export const BALANCE = { towerHp: 800, overtimeMs: 150_000, overtimeBleed: 10, stageStartScore: 50 };
/** score the player starts a stage with, enough to field one cat before the first question is read */
export const STAGE_START_SCORE = BALANCE.stageStartScore;
export const TOWER_HP = BALANCE.towerHp;
export const TICK_MS = 50;
export const SCORE_PER_CORRECT = 10;
export const TOWER_RANGE_PAD = 20;
/** default seconds between hits; damage per hit = dps * attackInterval */
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
  /** effective (upgraded) dps and range for this entity */
  dps: number;
  range: number;
  hpBonusFrac: number;
  /** boss bookkeeping */
  targetId: number | null;
  stacks: number;
  hitsTaken: number;
  abilityAt: number;
  revived: boolean;
  /** true on the tick a boss fires its special (renderer hint) */
  special: boolean;
}

export type BattleEvent =
  | { type: 'spawn'; entityId: number; side: Side; unitId: string }
  | { type: 'death'; entityId: number; side: Side; unitId: string }
  | { type: 'towerHit'; side: Side; amount: number; attackerId?: number }
  | { type: 'hit'; attackerId: number; targetId: number; amount: number; ranged: boolean; snipe: boolean }
  | { type: 'evade'; targetId: number }
  | { type: 'special'; entityId: number; unitId: string; kind: string }
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
  /** per-side unit upgrades (AI side is usually empty) */
  upgrades: Record<Side, Upgrades>;
  /** time (ms) until which a dead scholar's aura still applies, per side */
  scholarLingerUntil: Record<Side, number>;
  /** hp/dps multiplier for a side's regular cats (paid spawns, boss summons and splits alike); bosses are never scaled */
  unitMul: Record<Side, { hp: number; dps: number }>;
}

export function createBattle(upgrades: Partial<Record<Side, Upgrades>> = {}, startScore: Partial<Record<Side, number>> = {}): BattleState {
  return {
    upgrades: { left: upgrades.left ?? {}, right: upgrades.right ?? {} },
    scholarLingerUntil: { left: 0, right: 0 },
    unitMul: { left: { hp: 1, dps: 1 }, right: { hp: 1, dps: 1 } },
    tick: 0,
    timeMs: 0,
    towerHp: { left: BALANCE.towerHp, right: BALANCE.towerHp },
    score: { left: startScore.left ?? 0, right: startScore.right ?? 0 },
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
    const def = unitDef(e.unitId);
    const a = def.aura;
    if (a && a.type === type) {
      let v = a.value;
      if (type === 'heal') v += effectiveStats(def, state.upgrades[side]).healBonus;
      best = Math.max(best, v);
    }
  }
  if (type === 'scoreBonus' && best === 0 && state.scholarLingerUntil[side] > state.timeMs) best = UNITS.scholar.aura!.value;
  return best;
}

/** Attack-speed reduction applied to `side` by enemy runners and slow-aura bosses on the field. */
export function enemySlowOn(state: BattleState, side: Side): number {
  const enemy = other(side);
  let best = 0;
  for (const e of state.entities) {
    if (e.side !== enemy || e.hp <= 0) continue;
    if (e.unitId === 'runner') best = Math.max(best, effectiveStats(UNITS.runner, state.upgrades[enemy]).enemySlow);
    const b = unitDef(e.unitId).boss;
    if (b?.kind === 'slowAura') best = Math.max(best, b.frac);
  }
  return Math.min(0.8, best);
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

function makeEntity(state: BattleState, side: Side, def: UnitDef, x: number): Entity {
  const st = effectiveStats(def, state.upgrades[side]);
  const m = def.boss ? { hp: 1, dps: 1 } : state.unitMul[side];
  const hp = Math.max(1, Math.round(st.hp * m.hp));
  const e: Entity = {
    id: state.nextId++,
    side,
    unitId: def.id,
    x,
    hp,
    maxHp: hp,
    attacking: false,
    cooldown: 0,
    hit: false,
    dps: st.dps * m.dps,
    range: st.range,
    hpBonusFrac: st.hpBonusFrac,
    targetId: null,
    stacks: 0,
    hitsTaken: 0,
    abilityAt: state.timeMs,
    revived: false,
    special: false,
  };
  state.entities.push(e);
  state.events.push({ type: 'spawn', entityId: e.id, side, unitId: def.id });
  return e;
}

/** Spend score and spawn. Returns the entity or null if unaffordable. */
export function spawn(state: BattleState, side: Side, unitId: string): Entity | null {
  if (!canSpawn(state, side, unitId)) return null;
  const def = UNITS[unitId];
  state.score[side] -= def.cost;
  return makeEntity(state, side, def, towerX(side));
}

/** Spawn without paying (bosses, summons, splits). */
export function spawnFree(state: BattleState, side: Side, unitId: string, x = towerX(side)): Entity | null {
  if (state.winner) return null;
  return makeEntity(state, side, unitDef(unitId), x);
}

export function isBoss(e: Entity): boolean {
  return e.unitId.startsWith('boss_');
}

interface Hit {
  attacker: Entity;
  target: Entity;
  dmg: number;
  snipe?: boolean;
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
  const hits: Hit[] = [];
  const towerDamage: Record<Side, number> = { left: 0, right: 0 };
  const pushes: { e: Entity; dx: number }[] = [];
  // positions at the start of the tick, so processing order does not favour either side
  const x0 = new Map<number, number>(state.entities.map((e) => [e.id, e.x]));
  const px = (t: Entity) => x0.get(t.id)!;
  const slow: Record<Side, number> = { left: enemySlowOn(state, 'left'), right: enemySlowOn(state, 'right') };
  const snapshot = [...state.entities];

  for (const e of snapshot) {
    if (e.hp <= 0) continue;
    const def = unitDef(e.unitId);
    const boss = def.boss;
    const enemy = other(e.side);
    const d = dir(e.side);
    const ex = px(e);
    e.attacking = false;
    e.hit = false;
    e.special = false;

    // ---- periodic boss abilities ----
    if (boss) {
      if (boss.kind === 'regen') e.hp = Math.min(e.maxHp, e.hp + boss.perSec * dt);
      if (boss.kind === 'healAllies') {
        for (const a of snapshot) if (a.side === e.side && a.hp > 0 && a.id !== e.id) a.hp = Math.min(a.maxHp, a.hp + boss.perSec * dt);
      }
      if (boss.kind === 'summon' && state.timeMs - e.abilityAt >= boss.everySec * 1000) {
        e.abilityAt = state.timeMs;
        e.special = true;
        spawnFree(state, e.side, boss.unitId, ex);
        state.events.push({ type: 'special', entityId: e.id, unitId: e.unitId, kind: boss.kind });
      }
      if (boss.kind === 'snipe' && state.timeMs - e.abilityAt >= boss.everySec * 1000) {
        e.abilityAt = state.timeMs;
        e.special = true;
        e.attacking = true;
        for (const t of snapshot) if (t.side === enemy && t.hp > 0 && (px(t) - ex) * d >= -5) hits.push({ attacker: e, target: t, dmg: boss.dmg, snipe: true });
        state.events.push({ type: 'special', entityId: e.id, unitId: e.unitId, kind: boss.kind });
      }
    }

    // ---- attack cooldown ----
    let interval = def.attackInterval ?? ATTACK_INTERVAL;
    if (boss?.kind === 'berserk') interval *= boss.minIntervalFrac + (1 - boss.minIntervalFrac) * (e.hp / e.maxHp);
    // slowed units recover cooldown more slowly (attack speed -X%)
    e.cooldown = Math.max(0, e.cooldown - dt * (1 - slow[e.side]));
    let hitDmg = e.dps * (def.attackInterval ?? ATTACK_INTERVAL) + e.maxHp * e.hpBonusFrac;
    if (boss?.kind === 'enrage' && e.hp / e.maxHp < boss.below) hitDmg *= boss.mult;

    if (e.dps > 0) {
      const inRange = snapshot.filter((t) => t.side === enemy && t.hp > 0 && (px(t) - ex) * d >= -5 && Math.abs(px(t) - ex) <= e.range);
      if (inRange.length > 0) {
        e.attacking = true;
        const nearest = inRange.reduce((a, b) => (Math.abs(px(a) - ex) <= Math.abs(px(b) - ex) ? a : b));
        const targets = def.attackType === 'area' ? inRange : [nearest];
        if (e.cooldown <= 0) {
          e.hit = true;
          e.cooldown = interval;
          let dmg = hitDmg;
          if (boss?.kind === 'rampUp') {
            if (e.targetId === nearest.id) e.stacks++;
            else e.stacks = 0;
            dmg *= 1 + boss.perHit * e.stacks;
          }
          if (boss?.kind === 'charge' && e.targetId !== nearest.id) dmg *= boss.firstHitMult;
          e.targetId = nearest.id;
          for (const t of targets) {
            hits.push({ attacker: e, target: t, dmg });
            if (boss?.kind === 'knockback') pushes.push({ e: t, dx: d * boss.dist });
          }
          if (boss?.kind === 'scoreDrain') state.score[enemy] = Math.max(0, state.score[enemy] - boss.amount);
        }
        continue;
      }
      e.targetId = null;
      e.stacks = 0;
      const distTower = Math.abs(towerX(enemy) - ex);
      if (distTower <= e.range + TOWER_RANGE_PAD) {
        e.attacking = true;
        if (e.cooldown <= 0) {
          e.hit = true;
          e.cooldown = interval;
          const td = boss?.kind === 'towerBuster' ? hitDmg * boss.mult : hitDmg;
          towerDamage[enemy] += td;
          state.events.push({ type: 'towerHit', side: enemy, amount: td, attackerId: e.id });
        }
        continue;
      }
    } else {
      // support units hang back: stop when an enemy is close ahead, or near the enemy tower
      const blocked = snapshot.some((t) => t.side === enemy && t.hp > 0 && (px(t) - ex) * d >= 0 && Math.abs(px(t) - ex) <= 60);
      if (blocked) continue;
      if (Math.abs(towerX(enemy) - ex) <= 80) continue;
    }
    if (def.speed > 0) {
      e.x += d * def.speed * speedMul[e.side] * dt;
      e.x = Math.max(0, Math.min(FIELD_LENGTH, e.x));
    }
  }

  // ---- resolve hits with defensive modifiers ----
  const damage = new Map<number, number>();
  for (const h of hits) {
    const tb = unitDef(h.target.unitId).boss;
    let dmg = h.dmg;
    if (tb?.kind === 'evade') {
      h.target.hitsTaken++;
      if (h.target.hitsTaken % tb.every === 0) {
        state.events.push({ type: 'evade', targetId: h.target.id });
        continue;
      }
    }
    if (tb?.kind === 'armor') dmg *= 1 - tb.frac;
    const ab = unitDef(h.attacker.unitId).boss;
    if (ab?.kind === 'lifesteal') h.attacker.hp = Math.min(h.attacker.maxHp, h.attacker.hp + dmg * ab.frac);
    if (ab?.kind === 'execute' && h.target.hp - dmg > 0 && (h.target.hp - dmg) / h.target.maxHp < ab.below && !isBoss(h.target)) dmg = h.target.hp;
    damage.set(h.target.id, (damage.get(h.target.id) ?? 0) + dmg);
    state.events.push({ type: 'hit', attackerId: h.attacker.id, targetId: h.target.id, amount: dmg, ranged: h.attacker.range > 60 || !!h.snipe, snipe: !!h.snipe });
  }
  // knockback: dx already points toward the target's own tower
  for (const p of pushes) p.e.x = Math.max(0, Math.min(FIELD_LENGTH, p.e.x + p.dx));

  for (const e of state.entities) {
    const dmg = damage.get(e.id) ?? 0;
    e.hp = Math.min(e.maxHp, e.hp - dmg + heal[e.side] * dt);
    if (e.hp <= 0) {
      const boss = unitDef(e.unitId).boss;
      if (boss?.kind === 'lastStand' && !e.revived) {
        e.revived = true;
        e.hp = e.maxHp * boss.hpFrac;
        e.special = true;
        state.events.push({ type: 'special', entityId: e.id, unitId: e.unitId, kind: boss.kind });
        continue;
      }
      e.hp = 0;
      if (e.unitId === 'scholar') {
        const linger = effectiveStats(UNITS.scholar, state.upgrades[e.side]).auraLingerSec;
        if (linger > 0) state.scholarLingerUntil[e.side] = Math.max(state.scholarLingerUntil[e.side], state.timeMs + linger * 1000);
      }
      state.events.push({ type: 'death', entityId: e.id, side: e.side, unitId: e.unitId });
      if (boss?.kind === 'split') {
        // fragments share one cat's worth of hp between them
        for (let k = 0; k < boss.count; k++) {
          const f = spawnFree(state, e.side, boss.unitId, e.x);
          if (f) f.hp = f.maxHp = Math.max(1, Math.round(f.maxHp / boss.count));
        }
      }
    }
  }
  state.entities = state.entities.filter((e) => e.hp > 0);

  if (state.timeMs > BALANCE.overtimeMs) {
    towerDamage.left += BALANCE.overtimeBleed * dt;
    towerDamage.right += BALANCE.overtimeBleed * dt;
  }
  for (const side of ['left', 'right'] as Side[]) {
    if (towerDamage[side] > 0) state.towerHp[side] = Math.max(0, state.towerHp[side] - towerDamage[side]);
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
