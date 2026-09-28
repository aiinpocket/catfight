export type Side = 'left' | 'right';
export type AuraType = 'speed' | 'heal' | 'scoreBonus';

export interface UnitDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  hp: number;
  dps: number;
  range: number;
  speed: number;
  attackType: 'single' | 'area';
  aura?: { type: AuraType; value: number };
  /** points needed to unlock in stage mode; 0 = default */
  unlockCost: number;
  /** seconds between hits (default ATTACK_INTERVAL) */
  attackInterval?: number;
  /** boss special ability (bosses only) */
  boss?: import('./bosses.js').BossAbility;
}

export const UNITS: Record<string, UnitDef> = {
  tank: { id: 'tank', name: '存款貓', desc: '便宜耐打的近戰牆', cost: 30, hp: 300, dps: 30, range: 30, speed: 40, attackType: 'single', unlockCost: 0 },
  archer: { id: 'archer', name: '債券貓', desc: '遠距離穩定輸出', cost: 40, hp: 120, dps: 40, range: 150, speed: 40, attackType: 'single', unlockCost: 0 },
  mage: { id: 'mage', name: '衍生品貓', desc: '範圍攻擊，清小兵', cost: 80, hp: 150, dps: 25, range: 100, speed: 40, attackType: 'area', unlockCost: 100 },
  scholar: { id: 'scholar', name: '分析師貓', desc: '在場時每題答對 +5 分', cost: 60, hp: 80, dps: 0, range: 0, speed: 40, attackType: 'single', aura: { type: 'scoreBonus', value: 5 }, unlockCost: 150 },
  runner: { id: 'runner', name: '高頻貓', desc: '友軍移動速度 +30%', cost: 50, hp: 120, dps: 15, range: 30, speed: 50, attackType: 'single', aura: { type: 'speed', value: 0.3 }, unlockCost: 200 },
  medic: { id: 'medic', name: '保險貓', desc: '友軍每秒回復 8 血', cost: 70, hp: 100, dps: 0, range: 0, speed: 40, attackType: 'single', aura: { type: 'heal', value: 8 }, unlockCost: 250 },
};

export const UNIT_IDS = Object.keys(UNITS);
export const DEFAULT_UNLOCKED = ['tank', 'archer'];
