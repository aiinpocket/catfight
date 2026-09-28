import { describe, expect, it } from 'vitest';
import { abilityText, aiStep, BOSS_LIST, bossDef, buildStages, createAi, createBattle, spawn, spawnFree, stageAi, step, TICK_MS, unitDef } from '../src/index.js';

describe('boss table', () => {
  it('has 100 unique warlords with a description each', () => {
    expect(BOSS_LIST).toHaveLength(100);
    expect(new Set(BOSS_LIST.map((b) => b.name)).size).toBe(100);
    for (let n = 1; n <= 100; n++) {
      const d = bossDef(n);
      expect(d.id).toBe(`boss_${n}`);
      expect(d.boss).toBeDefined();
      expect(abilityText(d.boss!).length).toBeGreaterThan(5);
      expect(unitDef(d.id)).toBe(d);
    }
    expect(bossDef(100).hp).toBeGreaterThan(bossDef(1).hp * 5);
  });

  it('stages carry their boss and the AI spawns it at the configured time', () => {
    const st = buildStages([{ id: 'a', name: 'A' }]);
    expect(st).toHaveLength(100);
    expect(st[6].boss.name).toBe('真田幸村喵');
    expect(st[7].boss.name).toBe('雜賀孫市喵');
    const s = createBattle();
    const ai = createAi('right', stageAi(1));
    const at = stageAi(1).boss!.atMs;
    while (s.timeMs < at) {
      aiStep(s, ai, TICK_MS);
      expect(s.entities.some((e) => e.unitId === 'boss_1')).toBe(false);
      step(s);
    }
    aiStep(s, ai, TICK_MS);
    expect(s.entities.some((e) => e.unitId === 'boss_1')).toBe(true);
  });
});

describe('boss abilities', () => {
  const at = (s: ReturnType<typeof createBattle>, unitId: string, x: number, side: 'left' | 'right' = 'right') => {
    const e = spawnFree(s, side, unitId, x)!;
    return e;
  };

  it('雜賀 snipe: never moves, every 10 s hits every enemy ahead but not the tower', () => {
    const s = createBattle();
    const boss = at(s, 'boss_8', 900); // 雜賀孫市喵 (stage 8)
    s.score.left = 120;
    // scholars do not attack, so the fragile boss survives the full 10 s
    const a = spawn(s, 'left', 'scholar')!;
    const b = spawn(s, 'left', 'scholar')!;
    a.x = 100;
    b.x = 400;
    const x0 = boss.x;
    for (let i = 0; i < 20 * 10; i++) step(s); // 10 s
    expect(boss.x).toBe(x0);
    const dmg = (bossDef(8).boss as { dmg: number }).dmg;
    expect(a.hp).toBeCloseTo(80 - dmg, 3);
    expect(b.hp).toBeLessThanOrEqual(80 - dmg); // b also walks into the boss's normal range
    expect(s.towerHp.left).toBe(800);
  });

  it('真田 rampUp: damage grows with consecutive hits on one target and resets on a new one', () => {
    const s = createBattle();
    const boss = at(s, 'boss_7', 520); // 真田幸村喵
    s.score.left = 60;
    const t1 = spawn(s, 'left', 'tank')!;
    t1.x = 500;
    t1.hp = t1.maxHp = 100000;
    step(s);
    const first = 100000 - t1.hp;
    for (let i = 0; i < 20; i++) step(s);
    const second = 100000 - first - t1.hp;
    expect(second).toBeGreaterThan(first);
    expect(boss.stacks).toBe(1);
    // new target closer -> stacks reset
    const t2 = spawn(s, 'left', 'tank')!;
    t2.x = 515;
    t2.hp = t2.maxHp = 100000;
    for (let i = 0; i < 20; i++) step(s);
    expect(boss.stacks).toBe(0);
  });

  it('armor, evade, regen and lastStand keep bosses alive longer', () => {
    // 德川家康 armor (stage 3)
    let s = createBattle();
    let boss = at(s, 'boss_3', 520);
    s.score.left = 40;
    spawn(s, 'left', 'archer')!.x = 440; // 80 away: inside archer reach (105)
    step(s);
    const armor = (bossDef(3).boss as { frac: number }).frac;
    expect(boss.maxHp - boss.hp).toBeCloseTo(40 * (1 - armor), 3);

    // 竹中半兵衛 evade (stage 19): every 3rd hit ignored
    s = createBattle();
    boss = at(s, 'boss_19', 520);
    s.score.left = 40;
    spawn(s, 'left', 'archer')!.x = 440; // 80 away: inside archer reach (105)
    for (let i = 0; i < 20 * 3; i++) step(s); // 3 hits at t=0,1,2
    expect(boss.hitsTaken).toBe(3);
    expect(boss.maxHp - boss.hp).toBeCloseTo(80, 3);

    // 淺井長政 lastStand (stage 25)
    s = createBattle();
    boss = at(s, 'boss_25', 520);
    boss.hp = 1;
    s.score.left = 40;
    spawn(s, 'left', 'archer')!.x = 440; // 80 away: inside archer reach (105)
    step(s);
    expect(boss.revived).toBe(true);
    expect(boss.hp).toBeGreaterThan(1);
    expect(s.entities).toContain(boss);
  });

  it('summon and split create free allies, scoreDrain steals score, knockback pushes', () => {
    // 豐臣秀吉 summon (stage 2)
    let s = createBattle();
    at(s, 'boss_2', 900);
    const every = (bossDef(2).boss as { everySec: number }).everySec;
    for (let i = 0; i < 20 * every + 1; i++) step(s);
    expect(s.entities.filter((e) => e.side === 'right' && e.unitId === 'tank')).toHaveLength(1);

    // 北條氏康 split (stage 12)
    s = createBattle();
    const b = at(s, 'boss_12', 520);
    b.hp = 1;
    s.score.left = 40;
    spawn(s, 'left', 'archer')!.x = 440; // 80 away: inside archer reach (105)
    step(s);
    expect(s.entities.filter((e) => e.side === 'right' && e.unitId === 'tank')).toHaveLength(2);

    // 黑田官兵衛 scoreDrain (stage 18)
    s = createBattle();
    at(s, 'boss_18', 520);
    s.score.left = 100;
    spawn(s, 'left', 'tank')!.x = 500;
    step(s);
    expect(s.score.left).toBe(70 - (bossDef(18).boss as { amount: number }).amount);

    // 島津義弘 knockback (stage 11)
    s = createBattle();
    at(s, 'boss_11', 520);
    s.score.left = 30;
    const t = spawn(s, 'left', 'tank')!;
    t.x = 500;
    step(s);
    expect(t.x).toBeLessThan(500);
  });

  it('slowAura and towerBuster and execute behave', () => {
    // 今川義元 slowAura (stage 13): player archer hits fewer times in 5 s
    let s = createBattle();
    at(s, 'boss_13', 900);
    s.score.left = 40;
    spawn(s, 'left', 'archer')!.x = 800; // boss at 900 is in range
    const boss = s.entities.find((e) => e.unitId === 'boss_13')!;
    for (let i = 0; i < 20 * 5; i++) step(s);
    const frac = (bossDef(13).boss as { frac: number }).frac;
    const hits = Math.round((boss.maxHp - boss.hp) / 40);
    expect(hits).toBeLessThan(5);
    expect(hits).toBeGreaterThanOrEqual(Math.floor(1 + 4 * (1 - frac)) - 1);

    // 明智光秀 towerBuster (stage 14)
    s = createBattle();
    at(s, 'boss_14', 30);
    step(s);
    const d14 = bossDef(14);
    const mult = (d14.boss as { mult: number }).mult;
    expect(800 - s.towerHp.left).toBeCloseTo(d14.dps * (d14.attackInterval ?? 1) * mult, 3);

    // 加藤清正 execute (stage 20)
    s = createBattle();
    at(s, 'boss_20', 520);
    s.score.left = 30;
    const t = spawn(s, 'left', 'tank')!;
    t.x = 500;
    t.hp = 60; // 20% -> after any hit below 15%..30% threshold -> executed
    step(s);
    expect(s.entities).not.toContain(t);
  });
});
