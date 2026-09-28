import { UNITS, type UnitDef } from './units.js';

/** Boss special abilities. Numbers are tuned per stage in bossDef(). */
export type BossAbility =
  | { kind: 'snipe'; everySec: number; dmg: number } // does not move; periodic piercing shot hitting every enemy ahead (never the tower)
  | { kind: 'rampUp'; perHit: number } // +perHit damage multiplier per consecutive hit on the same target
  | { kind: 'charge'; firstHitMult: number } // first hit on a fresh target deals extra damage
  | { kind: 'armor'; frac: number } // incoming damage reduced
  | { kind: 'regen'; perSec: number } // regenerates hp
  | { kind: 'summon'; everySec: number; unitId: string } // spawns a free ally periodically
  | { kind: 'slowAura'; frac: number } // enemies attack slower while boss lives
  | { kind: 'knockback'; dist: number } // pushes target back on hit
  | { kind: 'evade'; every: number } // ignores every Nth incoming hit
  | { kind: 'berserk'; minIntervalFrac: number } // attacks faster as hp drops
  | { kind: 'enrage'; below: number; mult: number } // damage multiplier under an hp fraction
  | { kind: 'lifesteal'; frac: number } // heals a fraction of damage dealt
  | { kind: 'towerBuster'; mult: number } // extra damage to the tower
  | { kind: 'scoreDrain'; amount: number } // each hit removes enemy score
  | { kind: 'execute'; below: number } // finishes targets under an hp fraction
  | { kind: 'split'; count: number; unitId: string } // spawns allies where it dies
  | { kind: 'healAllies'; perSec: number } // heals all allies
  | { kind: 'pierce' } // hits every enemy in range
  | { kind: 'lastStand'; hpFrac: number }; // revives once

export interface BossEntry {
  name: string;
  /** year the historical figure died; BOSS_LIST is sorted by it */
  died: number;
  /** short English description for the art prompt */
  look: string;
  ability: BossAbility['kind'];
  /** stat profile */
  profile: 'melee' | 'ranged' | 'tanky' | 'fast' | 'artillery';
}

/** 100 Sengoku warlord cats, in stage order. Abilities are set here; magnitudes scale with the stage. */
export const BOSS_LIST: BossEntry[] = [
  // ordered by historical exit: the year each warlord left the stage (died), earliest first, so the last
  // stages belong to the ones who outlived everyone. Keep this sorted when adding entries.
  { name: '太田道灌喵', died: 1486, look: 'castle architect poet', ability: 'towerBuster', profile: 'ranged' },
  { name: '北條早雲喵', died: 1519, look: 'old founder, monk robe over armor', ability: 'lifesteal', profile: 'melee' },
  { name: '尼子經久喵', died: 1541, look: 'crafty old lord, moon crest', ability: 'scoreDrain', profile: 'ranged' },
  { name: '大內義隆喵', died: 1551, look: 'cultured wealthy lord, silk robes', ability: 'summon', profile: 'ranged' },
  { name: '陶晴賢喵', died: 1555, look: 'rebel general, spear, stormy', ability: 'charge', profile: 'melee' },
  { name: '齋藤道三喵', died: 1556, look: 'viper motif, oil merchant turned lord, sly', ability: 'scoreDrain', profile: 'melee' },
  { name: '今川義元喵', died: 1560, look: 'court noble makeup, elegant kimono over armor', ability: 'slowAura', profile: 'ranged' },
  { name: '山本勘助喵', died: 1561, look: 'one-eyed strategist with a cane', ability: 'summon', profile: 'ranged' },
  { name: '三好長慶喵', died: 1564, look: 'capital lord, elegant black armor', ability: 'slowAura', profile: 'ranged' },
  { name: '宇佐美定滿喵', died: 1564, look: 'old tactician on a boat', ability: 'slowAura', profile: 'ranged' },
  { name: '毛利元就喵', died: 1571, look: 'three arrows held together, wise elder', ability: 'lifesteal', profile: 'ranged' },
  { name: '北條氏康喵', died: 1571, look: 'triangle scales crest, scarred face, sturdy armor', ability: 'split', profile: 'tanky' },
  { name: '武田信玄喵', died: 1573, look: 'white horsehair helmet, red armor, war fan', ability: 'charge', profile: 'fast' },
  { name: '朝倉義景喵', died: 1573, look: 'refined nobleman, purple armor', ability: 'slowAura', profile: 'ranged' },
  { name: '淺井長政喵', died: 1573, look: 'young lord, blue armor, family crest', ability: 'lastStand', profile: 'melee' },
  { name: '里見義堯喵', died: 1574, look: 'coastal lord with eight dog banners', ability: 'summon', profile: 'ranged' },
  { name: '山縣昌景喵', died: 1575, look: 'red cavalry armor, small but fierce', ability: 'charge', profile: 'fast' },
  { name: '馬場信春喵', died: 1575, look: 'unscarred veteran, calm, spear', ability: 'evade', profile: 'melee' },
  { name: '內藤昌豐喵', died: 1575, look: 'steady general, banner with wind', ability: 'healAllies', profile: 'ranged' },
  { name: '柿崎景家喵', died: 1575, look: 'vanguard brute with a giant naginata', ability: 'pierce', profile: 'melee' },
  { name: '直江景綱喵', died: 1577, look: 'loyal elder retainer, banner', ability: 'healAllies', profile: 'ranged' },
  { name: '松永久秀喵', died: 1577, look: 'villainous grin, holding a tea kettle bomb', ability: 'split', profile: 'artillery' },
  { name: '上杉謙信喵', died: 1578, look: 'white monk hood over armor, holding a sword', ability: 'regen', profile: 'melee' },
  { name: '高坂昌信喵', died: 1578, look: 'retreat master, elegant', ability: 'regen', profile: 'ranged' },
  { name: '山中鹿介喵', died: 1578, look: 'deer antler helmet, crescent, loyal', ability: 'lastStand', profile: 'melee' },
  { name: '竹中半兵衛喵', died: 1579, look: 'pale scholar, folding fan, gentle', ability: 'evade', profile: 'ranged' },
  { name: '蘆名盛氏喵', died: 1580, look: 'lord of the lake castle, sturdy', ability: 'regen', profile: 'tanky' },
  { name: '宇喜多直家喵', died: 1581, look: 'poisoner schemer, hidden dagger', ability: 'execute', profile: 'fast' },
  { name: '佐久間信盛喵', died: 1582, look: 'retreating general, tired veteran', ability: 'regen', profile: 'tanky' },
  { name: '武田勝賴喵', died: 1582, look: 'proud young lord, cavalry armor', ability: 'enrage', profile: 'fast' },
  { name: '織田信長喵', died: 1582, look: 'red and black armor with a flame crest, commanding', ability: 'enrage', profile: 'melee' },
  { name: '織田信忠喵', died: 1582, look: 'young heir in red and black armor', ability: 'rampUp', profile: 'melee' },
  { name: '森蘭丸喵', died: 1582, look: 'young page, elegant, small sword', ability: 'evade', profile: 'fast' },
  { name: '明智光秀喵', died: 1582, look: 'bellflower crest, blue armor, matchlock', ability: 'towerBuster', profile: 'ranged' },
  { name: '柴田勝家喵', died: 1583, look: 'broken water jar, burly, huge axe', ability: 'berserk', profile: 'melee' },
  { name: '龍造寺隆信喵', died: 1584, look: 'enormous bear-like cat on a palanquin', ability: 'armor', profile: 'tanky' },
  { name: '池田恆興喵', died: 1584, look: 'butterfly crest, loyal general', ability: 'knockback', profile: 'melee' },
  { name: '森長可喵', died: 1584, look: 'demon-like, wild spear called demon-slayer', ability: 'berserk', profile: 'melee' },
  { name: '筒井順慶喵', died: 1584, look: 'hesitant monk lord at a crossroads', ability: 'healAllies', profile: 'ranged' },
  { name: '丹羽長秀喵', died: 1585, look: 'reliable steward, plain sturdy armor', ability: 'armor', profile: 'tanky' },
  { name: '立花道雪喵', died: 1585, look: 'old general on a palanquin with a lightning sword', ability: 'pierce', profile: 'artillery' },
  { name: '蜂須賀正勝喵', died: 1586, look: 'bandit-like, with a swarm crest', ability: 'split', profile: 'melee' },
  { name: '荒木村重喵', died: 1586, look: 'rebel lord eating rice from a sword tip', ability: 'lifesteal', profile: 'melee' },
  { name: '高橋紹運喵', died: 1586, look: 'loyal defender, castle banner', ability: 'lastStand', profile: 'tanky' },
  { name: '瀧川一益喵', died: 1586, look: 'musketeer lord, tall banner', ability: 'snipe', profile: 'artillery' },
  { name: '吉川元春喵', died: 1586, look: 'fierce warrior brother, big sword', ability: 'berserk', profile: 'melee' },
  { name: '大友宗麟喵', died: 1587, look: 'christian cross, cannon, western style armor', ability: 'snipe', profile: 'artillery' },
  { name: '島津家久喵', died: 1587, look: 'ambush master, cross crest, bow', ability: 'snipe', profile: 'artillery' },
  { name: '佐佐成政喵', died: 1588, look: 'snowy mountain crossing, fur cloak', ability: 'regen', profile: 'tanky' },
  { name: '雜賀孫市喵', died: 1589, look: 'matchlock musket, crow feather cloak, three-legged crow crest', ability: 'snipe', profile: 'artillery' },
  { name: '北條氏政喵', died: 1590, look: 'lord of the great castle, rice bowl', ability: 'summon', profile: 'tanky' },
  { name: '大久保忠世喵', died: 1594, look: 'sturdy gatekeeper general', ability: 'armor', profile: 'tanky' },
  { name: '蒲生氏鄉喵', died: 1595, look: 'catfish-tail helmet, silver armor', ability: 'charge', profile: 'fast' },
  { name: '酒井忠次喵', died: 1596, look: 'veteran general, drum', ability: 'slowAura', profile: 'melee' },
  { name: '小早川隆景喵', died: 1597, look: 'naval strategist, wave crest', ability: 'slowAura', profile: 'ranged' },
  { name: '足利義昭喵', died: 1597, look: 'shogun in court robes, scheming', ability: 'summon', profile: 'ranged' },
  { name: '服部半藏喵', died: 1597, look: 'black ninja garb, kusarigama', ability: 'evade', profile: 'fast' },
  { name: '六角義賢喵', died: 1598, look: 'hexagon crest, hillside castle lord', ability: 'armor', profile: 'tanky' },
  { name: '豐臣秀吉喵', died: 1598, look: 'golden gourd standard, monkey-like grin, shiny armor', ability: 'summon', profile: 'ranged' },
  { name: '前田利家喵', died: 1599, look: 'gold armor, extremely long spear', ability: 'pierce', profile: 'melee' },
  { name: '長宗我部元親喵', died: 1599, look: 'island warrior, naval banner, spear', ability: 'summon', profile: 'melee' },
  { name: '鳥居元忠喵', died: 1600, look: 'castle defender, bandaged, resolute', ability: 'lastStand', profile: 'tanky' },
  { name: '島津豐久喵', died: 1600, look: 'young reckless warrior, cross crest', ability: 'lastStand', profile: 'fast' },
  { name: '石田三成喵', died: 1600, look: 'scholarly, banner reading loyalty, healing charms', ability: 'healAllies', profile: 'ranged' },
  { name: '小西行長喵', died: 1600, look: 'merchant lord, ship, cross', ability: 'towerBuster', profile: 'ranged' },
  { name: '九鬼嘉隆喵', died: 1600, look: 'pirate lord, iron ship, anchor', ability: 'pierce', profile: 'artillery' },
  { name: '井伊直政喵', died: 1602, look: 'crimson red armor, red devil', ability: 'charge', profile: 'fast' },
  { name: '風魔小太郎喵', died: 1603, look: 'giant ninja with wild hair and fangs', ability: 'evade', profile: 'fast' },
  { name: '黑田官兵衛喵', died: 1604, look: 'strategist with a bowl helmet and a map', ability: 'scoreDrain', profile: 'ranged' },
  { name: '村上武吉喵', died: 1604, look: 'sea pirate king, wave crest', ability: 'evade', profile: 'ranged' },
  { name: '山內一豐喵', died: 1605, look: 'on a fine horse, humble lord', ability: 'charge', profile: 'fast' },
  { name: '榊原康政喵', died: 1606, look: 'gold and black armor, spear', ability: 'rampUp', profile: 'melee' },
  { name: '細川藤孝喵', died: 1610, look: 'poet lord with scroll and sword', ability: 'healAllies', profile: 'ranged' },
  { name: '本多忠勝喵', died: 1610, look: 'deer antler helmet, huge dragonfly spear', ability: 'pierce', profile: 'melee' },
  { name: '島津義久喵', died: 1611, look: 'eldest brother lord, cross crest, calm', ability: 'armor', profile: 'tanky' },
  { name: '真田昌幸喵', died: 1611, look: 'cunning old fox, six coins crest', ability: 'split', profile: 'ranged' },
  { name: '加藤清正喵', died: 1611, look: 'tall silver helmet, tiger-hunting spear', ability: 'execute', profile: 'melee' },
  { name: '佐竹義重喵', died: 1612, look: 'demon lord of the east, centipede helmet', ability: 'rampUp', profile: 'melee' },
  { name: '有馬晴信喵', died: 1612, look: 'christian lord with rosary and musket', ability: 'snipe', profile: 'artillery' },
  { name: '前田慶次喵', died: 1612, look: 'flamboyant giant with a huge spear and monkey', ability: 'berserk', profile: 'melee' },
  { name: '最上義光喵', died: 1614, look: 'northern lord, iron war fan', ability: 'knockback', profile: 'melee' },
  { name: '仙石秀久喵', died: 1614, look: 'reckless general with a bell', ability: 'knockback', profile: 'melee' },
  { name: '真田幸村喵', died: 1615, look: 'red armor, deer antler helmet, six coins crest', ability: 'rampUp', profile: 'melee' },
  { name: '豐臣秀賴喵', died: 1615, look: 'giant young lord in gold armor at a burning castle', ability: 'lastStand', profile: 'tanky' },
  { name: '片倉小十郎喵', died: 1615, look: 'calm advisor, black armor, sword', ability: 'execute', profile: 'melee' },
  { name: '德川家康喵', died: 1616, look: 'heavy black armor with hollyhock crest, calm', ability: 'armor', profile: 'tanky' },
  { name: '本多正信喵', died: 1616, look: 'sly advisor, plain robe over armor', ability: 'scoreDrain', profile: 'ranged' },
  { name: '鍋島直茂喵', died: 1618, look: 'sly retainer with a cat-bell', ability: 'lifesteal', profile: 'melee' },
  { name: '島津義弘喵', died: 1619, look: 'cross crest, fierce, twin swords', ability: 'knockback', profile: 'melee' },
  { name: '直江兼續喵', died: 1620, look: 'helmet with the character love, elegant', ability: 'healAllies', profile: 'ranged' },
  { name: '上杉景勝喵', died: 1623, look: 'silent stern lord, black armor', ability: 'armor', profile: 'tanky' },
  { name: '福島正則喵', died: 1624, look: 'drunk brawler, big spear, wild', ability: 'charge', profile: 'fast' },
  { name: '毛利輝元喵', died: 1625, look: 'young heir, large banner', ability: 'healAllies', profile: 'tanky' },
  { name: '藤堂高虎喵', died: 1630, look: 'castle builder with blueprints, very tall', ability: 'towerBuster', profile: 'melee' },
  { name: '伊達政宗喵', died: 1636, look: 'black armor, crescent moon helmet, eye patch', ability: 'enrage', profile: 'melee' },
  { name: '立花宗茂喵', died: 1643, look: 'perfect samurai, bow and sword', ability: 'rampUp', profile: 'ranged' },
  { name: '細川忠興喵', died: 1646, look: 'sharp-tempered lord, black helmet', ability: 'enrage', profile: 'melee' },
  { name: '伊達成實喵', died: 1646, look: 'centipede crest helmet, reckless', ability: 'charge', profile: 'fast' },
  { name: '宇喜多秀家喵', died: 1655, look: 'handsome young lord, gold armor', ability: 'enrage', profile: 'melee' },
  { name: '真田信之喵', died: 1658, look: 'steadfast elder brother, red armor', ability: 'armor', profile: 'tanky' },
];

export const BOSS_COUNT = BOSS_LIST.length;
export const bossId = (stage: number) => `boss_${stage}`;

const PROFILE = {
  melee: { hp: 1.0, dps: 1.0, range: 30, speed: 40, interval: 1.0 },
  ranged: { hp: 0.6, dps: 0.9, range: 160, speed: 40, interval: 1.0 },
  tanky: { hp: 1.8, dps: 0.6, range: 30, speed: 32, interval: 1.2 },
  fast: { hp: 0.7, dps: 1.1, range: 30, speed: 65, interval: 0.7 },
  artillery: { hp: 0.5, dps: 0.8, range: 220, speed: 30, interval: 2.0 },
} as const;

/** Ability magnitudes for stage n (1-based). t in [0,1] across the 100 stages. */
export function bossAbility(kind: BossAbility['kind'], n: number): BossAbility {
  const t = Math.min(1, (n - 1) / 99);
  const lerp = (a: number, b: number) => +(a + (b - a) * t).toFixed(2);
  switch (kind) {
    case 'snipe':
      return { kind, everySec: 10, dmg: Math.round(lerp(10, 60)) };
    case 'rampUp':
      return { kind, perHit: lerp(0.1, 0.25) };
    case 'charge':
      return { kind, firstHitMult: lerp(2, 4) };
    case 'armor':
      return { kind, frac: lerp(0.25, 0.5) };
    case 'regen':
      return { kind, perSec: Math.round(lerp(5, 40)) };
    case 'summon':
      return { kind, everySec: Math.round(lerp(18, 7)), unitId: n < 40 ? 'tank' : n < 75 ? 'archer' : 'mage' };
    case 'slowAura':
      return { kind, frac: lerp(0.2, 0.4) };
    case 'knockback':
      return { kind, dist: Math.round(lerp(40, 90)) };
    case 'evade':
      return { kind, every: n < 50 ? 3 : 2 };
    case 'berserk':
      return { kind, minIntervalFrac: lerp(0.5, 0.3) };
    case 'enrage':
      return { kind, below: 0.5, mult: lerp(1.5, 2.2) };
    case 'lifesteal':
      return { kind, frac: lerp(0.3, 0.6) };
    case 'towerBuster':
      return { kind, mult: lerp(2, 4) };
    case 'scoreDrain':
      return { kind, amount: Math.round(lerp(2, 6)) };
    case 'execute':
      return { kind, below: lerp(0.15, 0.3) };
    case 'split':
      return { kind, count: n < 50 ? 2 : 3, unitId: n < 60 ? 'tank' : 'archer' };
    case 'healAllies':
      return { kind, perSec: Math.round(lerp(6, 30)) };
    case 'pierce':
      return { kind };
    case 'lastStand':
      return { kind, hpFrac: lerp(0.3, 0.5) };
  }
}

export function abilityText(a: BossAbility): string {
  switch (a.kind) {
    case 'snipe':
      return `不會移動，每 ${a.everySec} 秒射出貫穿全場的子彈，對前方所有敵人造成 ${a.dmg} 點傷害（不傷主堡）`;
    case 'rampUp':
      return `連續攻擊同一目標時每次攻擊力 +${Math.round(a.perHit * 100)}%，更換目標後重置`;
    case 'charge':
      return `移動快速，對新目標的第一擊造成 ${a.firstHitMult} 倍傷害`;
    case 'armor':
      return `受到的傷害減少 ${Math.round(a.frac * 100)}%`;
    case 'regen':
      return `每秒回復 ${a.perSec} 血`;
    case 'summon':
      return `每 ${a.everySec} 秒免費召喚一隻${UNITS[a.unitId]?.name ?? a.unitId}`;
    case 'slowAura':
      return `在場時所有敵人攻速 −${Math.round(a.frac * 100)}%`;
    case 'knockback':
      return `每次命中把目標擊退 ${a.dist}`;
    case 'evade':
      return `每 ${a.every} 次受到攻擊就閃避 1 次`;
    case 'berserk':
      return `血量越低攻擊越快，最快到原本的 ${Math.round(a.minIntervalFrac * 100)}% 間隔`;
    case 'enrage':
      return `血量低於 ${Math.round(a.below * 100)}% 時攻擊力 ×${a.mult}`;
    case 'lifesteal':
      return `造成傷害的 ${Math.round(a.frac * 100)}% 轉為回血`;
    case 'towerBuster':
      return `對主堡的傷害 ×${a.mult}`;
    case 'scoreDrain':
      return `每次命中偷走你 ${a.amount} 分`;
    case 'execute':
      return `命中血量低於 ${Math.round(a.below * 100)}% 的目標時直接擊殺`;
    case 'split':
      return `死亡時在原地分裂出 ${a.count} 隻${UNITS[a.unitId]?.name ?? a.unitId}`;
    case 'healAllies':
      return `每秒治療所有友軍 ${a.perSec} 血`;
    case 'pierce':
      return `每次攻擊命中射程內所有敵人`;
    case 'lastStand':
      return `第一次死亡時以 ${Math.round(a.hpFrac * 100)}% 血量復活`;
  }
}

/** global boss stat multipliers (balance knobs) */
export const BOSS_TUNE = { hpMul: 0.8, dpsMul: 0.9 };
const bossCache = new Map<number, UnitDef>();
let cacheKey = '';

/** Full unit definition for the boss of stage n (1..100). */
export function bossDef(n: number): UnitDef {
  const key = `${BOSS_TUNE.hpMul}/${BOSS_TUNE.dpsMul}`;
  if (key !== cacheKey) {
    bossCache.clear();
    cacheKey = key;
  }
  const cached = bossCache.get(n);
  if (cached) return cached;
  const entry = BOSS_LIST[(n - 1) % BOSS_COUNT];
  const p = PROFILE[entry.profile];
  const t = (n - 1) / 99;
  const baseHp = 420 + 2600 * t * t + 540 * t; // 420 -> ~3560
  const baseDps = 12 + 70 * t; // 12 -> 82
  const ability = bossAbility(entry.ability, n);
  const def: UnitDef = {
    id: bossId(n),
    name: entry.name,
    desc: abilityText(ability),
    cost: 0,
    hp: Math.round(baseHp * p.hp * BOSS_TUNE.hpMul),
    dps: Math.round(baseDps * p.dps * BOSS_TUNE.dpsMul),
    range: p.range,
    speed: ability.kind === 'snipe' ? 0 : p.speed,
    attackType: ability.kind === 'pierce' ? 'area' : 'single',
    unlockCost: 0,
    attackInterval: p.interval,
    boss: ability,
  };
  bossCache.set(n, def);
  return def;
}

/** Look up any unit definition, regular or boss. */
export function unitDef(id: string): UnitDef {
  const u = UNITS[id];
  if (u) return u;
  if (id.startsWith('boss_')) return bossDef(Number(id.slice(5)));
  throw new Error(`unknown unit ${id}`);
}
