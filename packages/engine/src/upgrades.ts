import type { UnitDef } from './units.js';

export type UpgradeTrack = 'hp' | 'atk' | 'special';
export const UPGRADE_TRACKS: UpgradeTrack[] = ['hp', 'atk', 'special'];
export const MAX_UPGRADE_LEVEL = 10;

/** { unitId: { hp, atk, special } } — missing entries mean level 0 */
export type Upgrades = Record<string, Partial<Record<UpgradeTrack, number>>>;

export const HP_PER_LEVEL = 0.1;
export const ATK_PER_LEVEL = 0.1;

/** points needed to go from level-1 to level */
export function upgradeCost(level: number): number {
  return 20 + 10 * level;
}

export function upgradeLevel(up: Upgrades | undefined, unitId: string, track: UpgradeTrack): number {
  const v = up?.[unitId]?.[track] ?? 0;
  return Math.max(0, Math.min(MAX_UPGRADE_LEVEL, Math.floor(v)));
}

/** Human-readable description of a unit's special track at level n. */
export function specialText(def: UnitDef, n: number): string {
  switch (def.id) {
    case 'tank':
      return `近戰命中額外造成自身最大血量 ${n}% 的傷害`;
    case 'archer':
      return `射程 +${2 * n}`;
    case 'mage':
      return `攻擊 +${n}`;
    case 'scholar':
      return `死亡後加分效果延續 ${(0.2 * n).toFixed(1)} 秒`;
    case 'runner':
      return `在場時對手攻速 −${2 * n}%`;
    case 'medic':
      return `每秒補血 +${(0.5 * n).toFixed(1)}`;
    default:
      return '';
  }
}

export interface EffectiveStats {
  hp: number;
  dps: number;
  range: number;
  /** extra damage per melee hit as a fraction of own max hp (tank) */
  hpBonusFrac: number;
  /** seconds the scholar aura lingers after death */
  auraLingerSec: number;
  /** enemy attack-speed reduction fraction while runner is on the field */
  enemySlow: number;
  /** flat heal per second bonus (medic) */
  healBonus: number;
}

export function effectiveStats(def: UnitDef, up: Upgrades | undefined): EffectiveStats {
  const hpL = upgradeLevel(up, def.id, 'hp');
  const atkL = upgradeLevel(up, def.id, 'atk');
  const spL = upgradeLevel(up, def.id, 'special');
  let dps = def.dps * (1 + ATK_PER_LEVEL * atkL);
  let range = def.range;
  if (def.id === 'mage') dps += spL;
  if (def.id === 'archer') range += 2 * spL;
  return {
    hp: Math.round(def.hp * (1 + HP_PER_LEVEL * hpL)),
    dps,
    range,
    hpBonusFrac: def.id === 'tank' ? 0.01 * spL : 0,
    auraLingerSec: def.id === 'scholar' ? 0.2 * spL : 0,
    enemySlow: def.id === 'runner' ? 0.02 * spL : 0,
    healBonus: def.id === 'medic' ? 0.5 * spL : 0,
  };
}
