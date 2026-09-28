import { describe, expect, it } from 'vitest';
import { addScore, createBattle, effectiveStats, spawn, step, UNITS, upgradeCost, upgradeLevel, type Upgrades } from '../src/index.js';

const L = (unit: string, track: 'hp' | 'atk' | 'special', n: number): Upgrades => ({ [unit]: { [track]: n } });

describe('upgrade maths', () => {
  it('clamps levels to 0..10 and prices levels linearly', () => {
    expect(upgradeLevel({ tank: { hp: 12 } }, 'tank', 'hp')).toBe(10);
    expect(upgradeLevel({ tank: { hp: -1 } }, 'tank', 'hp')).toBe(0);
    expect(upgradeLevel(undefined, 'tank', 'hp')).toBe(0);
    expect(upgradeCost(1)).toBe(30);
    expect(upgradeCost(10)).toBe(120);
  });

  it('hp and atk tracks scale base stats by 10% per level', () => {
    expect(effectiveStats(UNITS.tank, L('tank', 'hp', 5)).hp).toBe(450);
    expect(effectiveStats(UNITS.archer, L('archer', 'atk', 10)).dps).toBeCloseTo(80);
    expect(effectiveStats(UNITS.mage, L('mage', 'special', 7)).dps).toBe(32);
    expect(effectiveStats(UNITS.archer, L('archer', 'special', 4)).range).toBe(113);
  });
});

describe('upgrade effects in battle', () => {
  it('tank special adds 1%*N of max hp per hit', () => {
    const s = createBattle({ left: L('tank', 'special', 10) });
    s.score = { left: 30, right: 30 };
    const a = spawn(s, 'left', 'tank')!;
    const b = spawn(s, 'right', 'tank')!;
    a.x = 500;
    b.x = 520;
    step(s); // first hit lands immediately
    expect(b.hp).toBeCloseTo(300 - (30 + 300 * 0.1));
    expect(a.hp).toBeCloseTo(300 - 30);
  });

  it('archer special extends range so it opens fire earlier', () => {
    const plain = createBattle();
    const up = createBattle({ left: L('archer', 'special', 10) });
    for (const s of [plain, up]) {
      s.score = { left: 40, right: 30 };
      spawn(s, 'left', 'archer')!.x = 500;
      spawn(s, 'right', 'tank')!.x = 615; // 115 away: inside 125 (upgraded), outside 105
      step(s);
    }
    expect(plain.entities[1].hp).toBe(300);
    expect(up.entities[1].hp).toBeLessThan(300);
  });

  it('scholar aura lingers 0.2*N seconds after death', () => {
    const s = createBattle({ left: L('scholar', 'special', 10) });
    s.score.left = 60;
    const sc = spawn(s, 'left', 'scholar')!;
    sc.hp = 0.0001;
    // kill it with an enemy tank standing on top
    s.score.right = 30;
    spawn(s, 'right', 'tank')!.x = sc.x + 10;
    step(s);
    expect(s.entities.find((e) => e.unitId === 'scholar')).toBeUndefined();
    expect(addScore(s, 'left')).toBe(15); // still +5 for 2 s
    for (let i = 0; i < 20 * 2; i++) step(s); // 2 s later
    expect(addScore(s, 'left')).toBe(10);
  });

  it('runner special slows enemy attack speed', () => {
    const s = createBattle({ left: L('runner', 'special', 10) }); // enemy attack speed -20%
    s.score = { left: 50, right: 30 };
    spawn(s, 'left', 'runner')!.x = 100;
    const t = spawn(s, 'right', 'tank')!;
    t.x = 990; // attacking the right... place it at the left tower instead
    t.x = 20;
    const hp0 = s.towerHp.left;
    for (let i = 0; i < 20 * 5; i++) step(s); // 5 s: unslowed tank would land 5 hits, slowed 1 + floor(4*0.8)=4
    const hits = Math.round((hp0 - s.towerHp.left) / 30);
    expect(hits).toBe(4);
  });

  it('medic special adds 0.5*N heal per second and hp track raises max hp', () => {
    const s = createBattle({ left: { medic: { special: 10 }, tank: { hp: 10 } } });
    s.score.left = 1000;
    const t = spawn(s, 'left', 'tank')!;
    expect(t.maxHp).toBe(600);
    spawn(s, 'left', 'medic');
    t.hp = 100;
    for (let i = 0; i < 20 * 4; i++) step(s);
    expect(t.hp).toBeCloseTo(100 + 4 * 13, 3);
  });
});
