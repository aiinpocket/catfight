import { describe, expect, it } from 'vitest';
import { abilityText, aiStep, BOSS_LIST, bossDef, buildStages, createAi, createBattle, spawn, spawnFree, stageAi, step, TICK_MS, unitDef, UNITS } from '../src/index.js';

/** stage number of a boss by name (the list is ordered by historical exit year) */
const N = (name: string) => BOSS_LIST.findIndex((b) => b.name === name) + 1;

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
    expect(st[N('真田幸村喵') - 1].boss.name).toBe('真田幸村喵');
    expect(st[N('雜賀孫市喵') - 1].boss.name).toBe('雜賀孫市喵');
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
    const boss = at(s, `boss_${N('雜賀孫市喵')}`, 900); // 雜賀孫市喵
    s.score.left = 120;
    // scholars do not attack, so the fragile boss survives the full 10 s
    const a = spawn(s, 'left', 'scholar')!;
    const b = spawn(s, 'left', 'scholar')!;
    a.x = 100;
    b.x = 400;
    const x0 = boss.x;
    for (let i = 0; i < 20 * 10; i++) step(s); // 10 s
    expect(boss.x).toBe(x0);
    const dmg = (bossDef(N('雜賀孫市喵')).boss as { dmg: number }).dmg;
    expect(a.hp).toBeCloseTo(80 - dmg, 3);
    expect(b.hp).toBeLessThanOrEqual(80 - dmg); // b also walks into the boss's normal range
    expect(s.towerHp.left).toBe(800);
  });

  it('真田 rampUp: damage grows with consecutive hits on one target and resets on a new one', () => {
    const s = createBattle();
    const boss = at(s, `boss_${N('真田幸村喵')}`, 520); // 真田幸村喵
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
    // 德川家康 armor
    let s = createBattle();
    let boss = at(s, `boss_${N('德川家康喵')}`, 520);
    s.score.left = 40;
    spawn(s, 'left', 'archer')!.x = 440; // 80 away: inside archer reach (105)
    step(s);
    const armor = (bossDef(N('德川家康喵')).boss as { frac: number }).frac;
    expect(boss.maxHp - boss.hp).toBeCloseTo(40 * (1 - armor), 3);

    // 竹中半兵衛 evade: every 3rd hit ignored
    s = createBattle();
    boss = at(s, `boss_${N('竹中半兵衛喵')}`, 520);
    s.score.left = 40;
    spawn(s, 'left', 'archer')!.x = 440; // 80 away: inside archer reach (105)
    for (let i = 0; i < 20 * 3; i++) step(s); // 3 hits at t=0,1,2
    expect(boss.hitsTaken).toBe(3);
    expect(boss.maxHp - boss.hp).toBeCloseTo(80, 3);

    // 淺井長政 lastStand
    s = createBattle();
    boss = at(s, `boss_${N('淺井長政喵')}`, 520);
    boss.hp = 1;
    s.score.left = 40;
    spawn(s, 'left', 'archer')!.x = 440; // 80 away: inside archer reach (105)
    step(s);
    expect(boss.revived).toBe(true);
    expect(boss.hp).toBeGreaterThan(1);
    expect(s.entities).toContain(boss);
  });

  it('summon and split create free allies, scoreDrain steals score, knockback pushes', () => {
    // 豐臣秀吉 summon
    let s = createBattle();
    at(s, `boss_${N('豐臣秀吉喵')}`, 900);
    const { everySec: every, unitId: summonId } = bossDef(N('豐臣秀吉喵')).boss as { everySec: number; unitId: string };
    for (let i = 0; i < 20 * every + 1; i++) step(s);
    expect(s.entities.filter((e) => e.side === 'right' && e.unitId === summonId)).toHaveLength(1);

    // 北條氏康 split
    s = createBattle();
    const b = at(s, `boss_${N('北條氏康喵')}`, 520);
    b.hp = 1;
    s.score.left = 40;
    spawn(s, 'left', 'archer')!.x = 440; // 80 away: inside archer reach (105)
    step(s);
    const frags = s.entities.filter((e) => e.side === 'right' && e.unitId === 'tank');
    expect(frags).toHaveLength(2);
    // fragments share one cat's hp
    for (const f of frags) expect(f.maxHp).toBe(Math.round(UNITS.tank.hp / 2));

    // 黑田官兵衛 scoreDrain
    s = createBattle();
    at(s, `boss_${N('黑田官兵衛喵')}`, 520);
    s.score.left = 100;
    spawn(s, 'left', 'tank')!.x = 500;
    step(s);
    expect(s.score.left).toBe(70 - (bossDef(N('黑田官兵衛喵')).boss as { amount: number }).amount);

    // 島津義弘 knockback
    s = createBattle();
    at(s, `boss_${N('島津義弘喵')}`, 520);
    s.score.left = 30;
    const t = spawn(s, 'left', 'tank')!;
    t.x = 500;
    step(s);
    expect(t.x).toBeLessThan(500);
  });

  it('slowAura and towerBuster and execute behave', () => {
    // 今川義元 slowAura: player archer hits fewer times in 5 s
    let s = createBattle();
    at(s, `boss_${N('今川義元喵')}`, 900);
    s.score.left = 40;
    spawn(s, 'left', 'archer')!.x = 800; // boss at 900 is in range
    const boss = s.entities.find((e) => e.unitId === `boss_${N('今川義元喵')}`)!;
    for (let i = 0; i < 20 * 5; i++) step(s);
    const frac = (bossDef(N('今川義元喵')).boss as { frac: number }).frac;
    const hits = Math.round((boss.maxHp - boss.hp) / 40);
    expect(hits).toBeLessThan(5);
    expect(hits).toBeGreaterThanOrEqual(Math.floor(1 + 4 * (1 - frac)) - 1);

    // 明智光秀 towerBuster
    s = createBattle();
    at(s, `boss_${N('明智光秀喵')}`, 30);
    step(s);
    const d14 = bossDef(N('明智光秀喵'));
    const mult = (d14.boss as { mult: number }).mult;
    expect(800 - s.towerHp.left).toBeCloseTo(d14.dps * (d14.attackInterval ?? 1) * mult, 3);

    // 加藤清正 execute
    s = createBattle();
    at(s, `boss_${N('加藤清正喵')}`, 520);
    s.score.left = 30;
    const t = spawn(s, 'left', 'tank')!;
    t.x = 500;
    t.hp = 60; // 20% -> after any hit below 15%..30% threshold -> executed
    step(s);
    expect(s.entities).not.toContain(t);
  });
});
