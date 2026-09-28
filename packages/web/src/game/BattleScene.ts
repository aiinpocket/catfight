import Phaser from 'phaser';
import { ATTACK_INTERVAL, BALANCE, FIELD_LENGTH, TICK_MS, UNITS, unitDef, type BattleEvent, type BattleState, type Entity, type Side, SMALL_UNIT_SCALE } from '@catfight/engine';

export interface BattleDriver {
  /** advance the game by one fixed tick */
  tick(): void;
  state: BattleState;
  /** boss unit id for this battle (sprite is loaded from /assets/boss/<id>.png) */
  bossId?: string;
  /** boss display name for the label above its hp bar */
  bossName?: string;
  /** called with each engine event batch after a tick (toasts etc.) */
  onEvents?: (events: BattleState['events']) => void;
}

const UNIT_KEYS = Object.keys(UNITS);
const isBoss = (id: string) => id.startsWith('boss_');

interface SpriteRec {
  img: Phaser.GameObjects.Image;
  hp: Phaser.GameObjects.Graphics;
  label?: Phaser.GameObjects.Text;
  /** ms timestamp until which the sprite shows its hurt tint */
  hurtUntil: number;
  /** melee lunge offset, decays each frame */
  lunge: number;
  knock: number;
  /** resting scale; per-frame squash/stretch is applied on top */
  base: number;
  /** ms timestamp of the spawn pop-in */
  spawnAt: number;
}

/** Renders the engine state with hit feedback: projectiles, lunges, damage numbers, beams, tower shake. */
export class BattleScene extends Phaser.Scene {
  private driver!: BattleDriver;
  private acc = 0;
  private sprites = new Map<number, SpriteRec>();
  /** unit definitions by id (regular cats and bosses) */
  private defOf(id: string) {
    return UNITS[id] ?? unitDef(id);
  }
  private towers!: Record<Side, Phaser.GameObjects.Image>;
  private towerHp!: Record<Side, Phaser.GameObjects.Graphics>;
  private towerText!: Record<Side, Phaser.GameObjects.Text>;
  private fx!: Phaser.GameObjects.Graphics;
  private padX = 40;
  private groundY = 0;
  private unitScale = 1;
  private beams: { y: number; x1: number; x2: number; until: number }[] = [];

  constructor() {
    super('battle');
  }

  init(data: { driver: BattleDriver }) {
    this.driver = data.driver;
  }

  preload() {
    for (const k of UNIT_KEYS) this.load.image(k, `/assets/${k}.png`);
    if (this.driver.bossId) this.load.image(this.driver.bossId, `/assets/boss/${this.driver.bossId}.png`);
    this.load.image('tower_player', '/assets/tower_player.png');
    this.load.image('tower_enemy', '/assets/tower_enemy.png');
    this.load.image('background', '/assets/background.png');
  }

  create() {
    const { width, height } = this.scale;
    this.groundY = height - 18;
    this.unitScale = Math.min(0.45, (height * 0.36) / 256);
    const bg = this.add.image(width / 2, height / 2, 'background');
    const s = Math.max(width / bg.width, height / bg.height);
    bg.setScale(s).setScrollFactor(0);

    const towerScale = Math.min(0.5, (height * 0.62) / 340);
    this.towers = {
      left: this.add.image(this.padX - 10, this.groundY, 'tower_player').setOrigin(0.5, 1).setScale(towerScale),
      right: this.add.image(width - this.padX + 10, this.groundY, 'tower_enemy').setOrigin(0.5, 1).setScale(towerScale),
    };
    this.towerHp = { left: this.add.graphics(), right: this.add.graphics() };
    const style = { fontSize: '11px', color: '#ffffff', fontFamily: 'sans-serif', stroke: '#000000', strokeThickness: 3 };
    this.towerText = {
      left: this.add.text(this.padX - 10, 58, '', style).setOrigin(0.5, 0).setDepth(61),
      right: this.add.text(width - this.padX + 10, 58, '', style).setOrigin(0.5, 0).setDepth(61),
    };
    this.fx = this.add.graphics().setDepth(70);
    this.sprites.clear();
    this.scale.on('resize', () => this.scene.restart({ driver: this.driver }));
  }

  private fxX(x: number) {
    const { width } = this.scale;
    return this.padX + (x / FIELD_LENGTH) * (width - this.padX * 2);
  }

  update(time: number, delta: number) {
    this.acc += Math.min(delta, 250);
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.driver.tick();
      const ev = this.driver.state.events;
      if (ev.length) {
        this.handleEvents(ev, time);
        this.driver.onEvents?.(ev);
      }
    }
    this.render(time, delta);
  }

  // ---------- event driven feedback ----------
  private handleEvents(events: BattleEvent[], time: number) {
    const st = this.driver.state;
    const byId = new Map(st.entities.map((e) => [e.id, e]));
    for (const ev of events) {
      if (ev.type === 'hit') {
        const a = this.sprites.get(ev.attackerId);
        const t = this.sprites.get(ev.targetId);
        const target = byId.get(ev.targetId);
        const tx = t ? this.centerX(t) : target ? this.fxX(target.x) : null;
        if (tx === null) continue;
        const ty = this.groundY - (t?.img.displayHeight ?? 40) * 0.55;
        const aside = byId.get(ev.attackerId)?.side ?? 'left';
        const big = !!target && target.unitId.startsWith('boss_');
        if (ev.snipe && a) {
          this.beams.push({ y: this.groundY - a.img.displayHeight * 0.55, x1: this.centerX(a), x2: tx, until: time + 220 });
          this.impact(tx, ty, 0xffe066, big);
        } else if (ev.ranged && a) {
          this.shootProjectile(this.centerX(a), this.groundY - a.img.displayHeight * 0.6, tx, ty, aside, () => this.impact(tx, ty, aside === 'left' ? 0x9fd3ff : 0xffb3b3, big));
          a.lunge = -8; // recoil
        } else if (a) {
          const abig = !!byId.get(ev.attackerId)?.unitId.startsWith('boss_');
          a.lunge = this.strikeLen(abig); // strike: the whole body snaps into the target
          this.slash(tx, ty, aside, abig);
          this.impact(tx, ty, 0xffffff, big);
        }
        if (t) {
          t.hurtUntil = time + 140;
          t.knock = byId.get(ev.attackerId)?.unitId.startsWith('boss_') ? 14 : 7;
        }
        this.damageText(tx, ty - 14, Math.round(ev.amount), target?.side === 'left' ? '#ff6b6b' : '#ffe066');
      } else if (ev.type === 'evade') {
        const t = this.sprites.get(ev.targetId);
        if (t) this.damageText(this.centerX(t), this.groundY - t.img.displayHeight - 14, 'MISS', '#9fd3ff');
      } else if (ev.type === 'towerHit' && ev.attackerId !== undefined) {
        const tower = this.towers[ev.side];
        this.tweens.add({ targets: tower, x: tower.x + (ev.side === 'left' ? -4 : 4), duration: 40, yoyo: true, repeat: 2 });
        this.damageText(tower.x, this.groundY - tower.displayHeight * 0.7, Math.round(ev.amount), ev.side === 'left' ? '#ff6b6b' : '#ffe066');
        const a = this.sprites.get(ev.attackerId);
        const attacker = byId.get(ev.attackerId);
        if (a && attacker) {
          const tx = tower.x + (ev.side === 'left' ? tower.displayWidth * 0.3 : -tower.displayWidth * 0.3);
          const ty = this.groundY - tower.displayHeight * 0.45;
          const abig = attacker.unitId.startsWith('boss_');
          if (attacker.range > 60) {
            this.shootProjectile(this.centerX(a), this.groundY - a.img.displayHeight * 0.6, tx, ty, attacker.side, () => this.impact(tx, ty, 0xffffff, false));
            a.lunge = -8;
          } else {
            a.lunge = this.strikeLen(abig);
            this.slash(tx, ty, attacker.side, abig);
            this.impact(tx, ty, 0xffffff, false);
          }
        }
      } else if (ev.type === 'special') {
        const s = this.sprites.get(ev.entityId);
        if (s) this.damageText(this.centerX(s), this.groundY - s.img.displayHeight - 16, ev.kind === 'lastStand' ? '復活！' : ev.kind === 'summon' ? '召喚！' : '狙擊！', '#ffe066');
      } else if (ev.type === 'spawn' && ev.unitId.startsWith('boss_')) {
        this.cameras.main.shake(300, 0.006);
        this.cameras.main.flash(250, 255, 224, 102, false);
      }
    }
  }

  private shootProjectile(x1: number, y1: number, x2: number, y2: number, side: Side, onArrive?: () => void) {
    const color = side === 'left' ? 0x9fd3ff : 0xffb3b3;
    const angle = Phaser.Math.RadToDeg(Math.atan2(y2 - y1, x2 - x1));
    const streak = this.add.ellipse(x1, y1, 22, 6, color, 0.9).setAngle(angle).setDepth(65);
    const dot = this.add.circle(x1, y1, 4, 0xffffff).setDepth(66);
    // muzzle flash
    const flash = this.add.circle(x1, y1, 6, 0xffffff, 0.9).setDepth(66);
    this.tweens.add({ targets: flash, scale: 2.2, alpha: 0, duration: 130, onComplete: () => flash.destroy() });
    this.tweens.add({
      targets: [streak, dot],
      x: x2,
      y: y2,
      duration: 200,
      ease: 'Linear',
      onComplete: () => {
        streak.destroy();
        dot.destroy();
        onArrive?.();
      },
    });
  }

  /** expanding ring + spark burst at the point of impact */
  private impact(x: number, y: number, color: number, big: boolean) {
    const r = big ? 14 : 9;
    const ring = this.add.circle(x, y, r, color, 0).setStrokeStyle(3, color, 0.95).setDepth(70);
    this.tweens.add({ targets: ring, scale: big ? 2.4 : 1.9, alpha: 0, duration: 220, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
    const spark = this.add.star(x, y, 4, r * 0.35, r * 1.1, 0xffffff, 1).setDepth(71).setAngle(Phaser.Math.Between(0, 90));
    this.tweens.add({ targets: spark, scale: big ? 1.8 : 1.4, angle: spark.angle + 45, alpha: 0, duration: 180, onComplete: () => spark.destroy() });
  }

  /** how far a melee strike carries the body; bosses are ~2.3x larger so their lunge scales with them */
  private strikeLen(boss: boolean) {
    return boss ? 70 : 30;
  }

  /** a weapon-swing arc in front of the target, drawn in the attacker's direction */
  private slash(x: number, y: number, side: Side, boss: boolean) {
    const r = boss ? 46 : 22;
    const g = this.add.graphics().setDepth(72);
    const dir = side === 'left' ? 1 : -1;
    // arc sweeping from above to below the impact point, bulging toward the target
    const start = dir === 1 ? -Math.PI * 0.45 : Math.PI * 0.55;
    const end = dir === 1 ? Math.PI * 0.45 : Math.PI * 1.45;
    g.lineStyle(boss ? 9 : 5, 0xffffff, 0.95).beginPath().arc(x - dir * r * 0.4, y, r, start, end, false).strokePath();
    g.lineStyle(boss ? 4 : 2, 0xffe066, 0.9).beginPath().arc(x - dir * r * 0.4, y, r * 0.8, start, end, false).strokePath();
    this.tweens.add({ targets: g, alpha: 0, scaleX: 1.25, scaleY: 1.25, duration: boss ? 240 : 170, ease: 'Cubic.Out', onComplete: () => g.destroy() });
  }

  /** screen x of a sprite's body centre (sprites are anchored at their front edge) */
  private centerX(s: SpriteRec) {
    return s.img.getCenter().x ?? s.img.x;
  }

  private damageText(x: number, y: number, text: string | number, color: string) {
    const t = this.add
      .text(x + Phaser.Math.Between(-8, 8), y, String(text), { fontSize: '15px', fontStyle: 'bold', color, fontFamily: 'sans-serif', stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(80);
    this.tweens.add({ targets: t, y: y - 26, alpha: 0, duration: 650, ease: 'Cubic.Out', onComplete: () => t.destroy() });
  }

  // ---------- per-frame state sync ----------
  private render(time: number, delta: number) {
    const st = this.driver.state;
    const alive = new Set<number>();
    for (const e of st.entities) {
      alive.add(e.id);
      let s = this.sprites.get(e.id);
      if (!s) {
        const boss = isBoss(e.unitId);
        const key = this.textures.exists(e.unitId) ? e.unitId : 'tank';
        // bosses keep the full sprite size; regular cats are smaller so future units have room to vary
        const scale = this.unitScale * (boss ? 1.6 : SMALL_UNIT_SCALE);
        // anchor at the front edge (art has ~15% transparent padding): a melee pair stands nose to nose instead of overlapping
        const img = this.add.image(this.fxX(e.x), this.groundY, key).setOrigin(e.side === 'left' ? 0.82 : 0.18, 1).setScale(scale);
        // boss art already faces left; regular sprites face right
        if (e.side === 'right' && !boss) img.setFlipX(true).setTint(0xffc9c9);
        if (e.side === 'left' && boss) img.setFlipX(true);
        s = { img, hp: this.add.graphics(), hurtUntil: 0, lunge: 0, knock: 0, base: scale, spawnAt: boss ? this.time.now : 0 };
        if (boss) {
          s.label = this.add
            .text(img.x, 0, this.driver.bossName ?? 'BOSS', { fontSize: '11px', fontStyle: 'bold', color: '#ffe066', fontFamily: 'sans-serif', stroke: '#000000', strokeThickness: 3 })
            .setOrigin(0.5, 1)
            .setDepth(51);
          img.setAlpha(0);
        }
        this.sprites.set(e.id, s);
      }
      this.draw(e, s, time, delta);
    }
    for (const [id, s] of this.sprites) {
      if (!alive.has(id)) {
        this.tweens.add({ targets: s.img, alpha: 0, y: s.img.y - 20, angle: 25, duration: 300, onComplete: () => s.img.destroy() });
        s.hp.destroy();
        s.label?.destroy();
        this.sprites.delete(id);
      }
    }
    this.drawTower('left', st.towerHp.left);
    this.drawTower('right', st.towerHp.right);
    this.drawBeams(time);
  }

  private draw(e: Entity, s: SpriteRec, time: number, delta: number) {
    const boss = isBoss(e.unitId);
    const def = this.defOf(e.unitId);
    const moving = !e.attacking;
    const bob = moving && def?.speed !== 0 ? Math.abs(Math.sin(time / 90 + e.id)) * 6 : 0;
    // strike (positive) or recoil (negative) decays back to rest; knockback pushes the victim away
    s.lunge = s.lunge > 0 ? Math.max(0, s.lunge - delta * 0.09) : Math.min(0, s.lunge + delta * 0.06);
    s.knock = Math.max(0, s.knock - delta * 0.05);
    const dir = e.side === 'left' ? 1 : -1;
    // wind-up: while a hit is charging, the cat pulls back and leans, then snaps forward on the hit event
    const interval = def?.attackInterval ?? ATTACK_INTERVAL;
    const windup = e.attacking && (def?.dps ?? 0) > 0 ? Phaser.Math.Clamp(1 - e.cooldown / interval, 0, 1) : 0;
    const pull = windup * windup * (boss ? 26 : 7);
    const jitter = (e.id % 3) * 4;
    s.img.setPosition(this.fxX(e.x) + dir * (s.lunge - pull - s.knock) - dir * jitter, this.groundY - bob);
    s.img.setDepth(10 + (e.side === 'left' ? e.x : FIELD_LENGTH - e.x) / 100 + (boss ? 5 : 0));
    const strike = Math.max(0, s.lunge) / this.strikeLen(boss);
    s.img.setAngle(dir * (strike * (boss ? 16 : 22) - windup * (boss ? 8 : 12)));
    // squash while charging, stretch forward on the strike, flinch when hurt, pop in on spawn
    let sx = 1 + strike * 0.16 - windup * 0.06;
    let sy = 1 - windup * 0.12 + strike * 0.04;
    if (time < s.hurtUntil) {
      sx *= 1.06;
      sy *= 0.9;
    }
    if (s.spawnAt) {
      const p = Phaser.Math.Clamp((time - s.spawnAt) / 400, 0, 1);
      const pop = 1 + 0.4 * (1 - p) * (1 - p);
      sx *= pop;
      sy *= pop;
      s.img.setAlpha(p);
    }
    s.img.setScale(s.base * sx, s.base * sy);
    if (time < s.hurtUntil) s.img.setTint(0xff4040);
    else if (e.special) s.img.setTint(0xffe066);
    else if (e.side === 'right' && !boss) s.img.setTint(0xffc9c9);
    else s.img.clearTint();

    const w = boss ? 64 : 28;
    const h = s.img.displayHeight;
    const y = this.groundY - h - 10;
    const cx = this.centerX(s);
    s.hp.clear();
    s.hp.setDepth(50);
    s.hp.fillStyle(0x000000, 0.6).fillRect(cx - w / 2, y, w, boss ? 7 : 5);
    const color = boss ? 0xffe066 : e.side === 'left' ? 0x3ddc84 : 0xff5a5f;
    s.hp.fillStyle(color, 1).fillRect(cx - w / 2, y, w * (e.hp / e.maxHp), boss ? 7 : 5);
    if (s.label) s.label.setPosition(cx, y - 2);
  }

  private drawTower(side: Side, hp: number) {
    const { width } = this.scale;
    const g = this.towerHp[side];
    const max = BALANCE.towerHp;
    const w = 90;
    const x = side === 'left' ? this.padX - 10 - w / 2 : width - this.padX + 10 - w / 2;
    const y = 46;
    g.clear();
    g.setDepth(60);
    g.fillStyle(0x000000, 0.6).fillRect(x, y, w, 10);
    g.fillStyle(side === 'left' ? 0x3ddc84 : 0xff5a5f, 1).fillRect(x, y, w * Math.max(0, hp / max), 10);
    g.lineStyle(1, 0xffffff, 0.8).strokeRect(x, y, w, 10);
    this.towerText[side].setText(`${side === 'left' ? '我方城堡' : '敵方城堡'} ${Math.ceil(hp)}`);
  }

  private drawBeams(time: number) {
    this.fx.clear();
    this.beams = this.beams.filter((b) => b.until > time);
    for (const b of this.beams) {
      const a = (b.until - time) / 220;
      this.fx.lineStyle(6, 0xffe066, 0.35 * a).lineBetween(b.x1, b.y, b.x2, b.y);
      this.fx.lineStyle(2, 0xffffff, 0.9 * a).lineBetween(b.x1, b.y, b.x2, b.y);
    }
  }
}
