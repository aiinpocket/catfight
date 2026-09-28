import { describe, expect, it } from 'vitest';
import {
  addScore,
  auraValue,
  canSpawn,
  createBattle,
  FIELD_LENGTH,
  runUntilEnd,
  spawn,
  STAGE_START_SCORE,
  step,
  TOWER_HP,
  UNITS,
} from '../src/index.js';

describe('economy', () => {
  it('adds base score and applies scholar bonus without stacking', () => {
    const s = createBattle();
    expect(addScore(s, 'left')).toBe(10);
    s.score.left = 200;
    spawn(s, 'left', 'scholar');
    spawn(s, 'left', 'scholar');
    expect(addScore(s, 'left')).toBe(15);
  });

  it('refuses spawn when unaffordable and deducts cost when it works', () => {
    const s = createBattle();
    expect(canSpawn(s, 'left', 'tank')).toBe(false);
    expect(spawn(s, 'left', 'tank')).toBeNull();
    s.score.left = 30;
    const e = spawn(s, 'left', 'tank');
    expect(e).not.toBeNull();
    expect(s.score.left).toBe(0);
    expect(s.entities).toHaveLength(1);
    expect(s.events[0]).toMatchObject({ type: 'spawn', unitId: 'tank' });
  });
});

describe('movement', () => {
  it('moves left units right and right units left at their speed', () => {
    const s = createBattle();
    s.score = { left: 100, right: 100 };
    spawn(s, 'left', 'tank');
    spawn(s, 'right', 'tank');
    for (let i = 0; i < 20; i++) step(s); // 1 s
    expect(s.entities[0].x).toBeCloseTo(40, 5);
    expect(s.entities[1].x).toBeCloseTo(FIELD_LENGTH - 40, 5);
  });

  it('runner aura speeds up allies by 30% and does not stack', () => {
    const s = createBattle();
    s.score.left = 1000;
    spawn(s, 'left', 'tank');
    spawn(s, 'left', 'runner');
    spawn(s, 'left', 'runner');
    expect(auraValue(s, 'left', 'speed')).toBeCloseTo(0.3);
    for (let i = 0; i < 20; i++) step(s);
    expect(s.entities[0].x).toBeCloseTo(40 * 1.3, 5);
  });
});

describe('combat', () => {
  it('a lone tank kills the enemy tower and wins', () => {
    const s = createBattle();
    s.score.left = 30;
    spawn(s, 'left', 'tank');
    runUntilEnd(s);
    expect(s.winner).toBe('left');
    expect(s.towerHp.right).toBe(0);
    // (1000-50)/40 ~ 24 s walk, then 800/30 ~ 27 s of chewing
    expect(s.timeMs / 1000).toBeGreaterThan(45);
    expect(s.timeMs / 1000).toBeLessThan(55);
  });

  it('two equal tanks meet in the middle and trade, then the survivor side keeps pushing', () => {
    const s = createBattle();
    s.score = { left: 30, right: 30 };
    spawn(s, 'left', 'tank');
    spawn(s, 'right', 'tank');
    // walk ~12 s to meet, then 300 hp / 30 dps = 10 s of mutual fighting
    for (let i = 0; i < 20 * 30; i++) step(s);
    expect(s.entities.length).toBe(0);
    expect(s.towerHp.left).toBe(TOWER_HP);
    expect(s.towerHp.right).toBe(TOWER_HP);
  });

  it('archer starts hitting the tank before the tank can reach it', () => {
    const s = createBattle();
    s.score = { left: 40, right: 30 };
    spawn(s, 'left', 'archer');
    spawn(s, 'right', 'tank');
    // closing speed 80/s, archer opens fire at 105 => ~11.2 s; tank needs ~1 s more to reach melee
    for (let i = 0; i < 232; i++) step(s); // 11.6 s
    const tank = s.entities.find((e) => e.side === 'right')!;
    const archer = s.entities.find((e) => e.side === 'left')!;
    expect(tank.hp).toBeLessThan(UNITS.tank.hp);
    expect(archer.hp).toBe(UNITS.archer.hp);
  });

  it('mage hits every enemy in range while archer hits only one', () => {
    const s = createBattle();
    s.score = { left: 80, right: 90 };
    spawn(s, 'left', 'mage');
    for (let k = 0; k < 3; k++) spawn(s, 'right', 'tank');
    for (let i = 0; i < 20 * 12; i++) step(s);
    const enemies = s.entities.filter((e) => e.side === 'right');
    expect(enemies).toHaveLength(3);
    const hps = enemies.map((e) => Math.round(e.hp));
    expect(new Set(hps).size).toBe(1);
    expect(hps[0]).toBeLessThan(UNITS.tank.hp);
  });

  it('medic heals allies over time and does not stack', () => {
    const s = createBattle();
    s.score.left = 1000;
    const t = spawn(s, 'left', 'tank')!;
    spawn(s, 'left', 'medic');
    spawn(s, 'left', 'medic');
    t.hp = 100;
    for (let i = 0; i < 20 * 5; i++) step(s);
    expect(t.hp).toBeCloseTo(140, 3);
    for (let i = 0; i < 20 * 60; i++) step(s);
    expect(t.hp).toBe(UNITS.tank.hp);
  });
});

describe('determinism', () => {
  it('produces identical states for identical inputs', () => {
    const run = () => {
      const s = createBattle();
      s.score = { left: 500, right: 500 };
      ['tank', 'archer', 'mage', 'runner', 'medic', 'scholar'].forEach((u) => {
        spawn(s, 'left', u);
        spawn(s, 'right', u);
      });
      for (let i = 0; i < 2000; i++) step(s);
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });

  it('step is a no-op after a winner is decided', () => {
    const s = createBattle();
    s.towerHp.right = 0.001;
    s.score.left = 30;
    const e = spawn(s, 'left', 'tank')!;
    e.x = FIELD_LENGTH - 10;
    step(s);
    expect(s.winner).toBe('left');
    const tick = s.tick;
    step(s);
    expect(s.tick).toBe(tick);
  });
});

describe('stage starting score', () => {
  it('createBattle seeds the given score so a stage player can field one cat at once', () => {
    const s = createBattle({}, { left: STAGE_START_SCORE });
    expect(s.score.left).toBe(50);
    expect(s.score.right).toBe(0);
    expect(spawn(s, 'left', 'archer')).not.toBeNull();
    expect(createBattle().score.left).toBe(0);
  });
});
