import Phaser from 'phaser';
import { BALANCE, FIELD_LENGTH, TICK_MS, UNITS, type BattleEvent, type BattleState, type Entity, type Side } from '@catfight/engine';

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
}

/** Renders the engine state with hit feedback: projectiles, lunges, damage numbers, beams, tower shake. */
export class BattleScene extends Phaser.Scene {
  private driver!: BattleDriver;
  private acc = 0;
  private sprites = new Map<number, SpriteRec>();
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
        const tx = t?.img.x ?? (target ? this.fxX(target.x) : null);
        if (tx === null) continue;
        const ty = this.groundY - (t?.img.displayHeight ?? 40) * 0.6;
        if (ev.snipe && a) {
          this.beams.push({ y: this.groundY - a.img.displayHeight * 0.55, x1: a.img.x, x2: tx, until: time + 220 });
        } else if (ev.ranged && a) {
          this.shootProjectile(a.img.x, this.groundY - a.img.displayHeight * 0.6, tx, ty, byId.get(ev.attackerId)?.side ?? 'left');
        } else if (a) {
          a.lunge = 14;
        }
        if (t) {
          t.hurtUntil = time + 120;
          this.tweens.add({ targets: t.img, scaleX: t.img.scaleX * 0.92, scaleY: t.img.scaleY * 1.06, duration: 60, yoyo: true });
        }
        this.damageText(tx, ty - 10, Math.round(ev.amount), target?.side === 'left' ? '#ff6b6b' : '#ffe066');
      } else if (ev.type === 'evade') {
        const t = this.sprites.get(ev.targetId);
        if (t) this.damageText(t.img.x, this.groundY - t.img.displayHeight - 14, 'MISS', '#9fd3ff');
      } else if (ev.type === 'towerHit' && ev.attackerId !== undefined) {
        const tower = this.towers[ev.side];
        this.tweens.add({ targets: tower, x: tower.x + (ev.side === 'left' ? -4 : 4), duration: 40, yoyo: true, repeat: 2 });
        this.damageText(tower.x, this.groundY - tower.displayHeight * 0.7, Math.round(ev.amount), ev.side === 'left' ? '#ff6b6b' : '#ffe066');
        const a = this.sprites.get(ev.attackerId);
        const attacker = byId.get(ev.attackerId);
        if (a && attacker) {
          if (attacker.range > 60) this.shootProjectile(a.img.x, this.groundY - a.img.displayHeight * 0.6, tower.x, this.groundY - tower.displayHeight * 0.5, attacker.side);
          else a.lunge = 14;
        }
      } else if (ev.type === 'special') {
        const s = this.sprites.get(ev.entityId);
        if (s) this.damageText(s.img.x, this.groundY - s.img.displayHeight - 16, ev.kind === 'lastStand' ? '復活！' : ev.kind === 'summon' ? '召喚！' : '狙擊！', '#ffe066');
      }
    }
  }

  private shootProjectile(x1: number, y1: number, x2: number, y2: number, side: Side) {
    const dot = this.add.circle(x1, y1, 4, side === 'left' ? 0x9fd3ff : 0xffb3b3).setDepth(65);
    const trail = this.add.circle(x1, y1, 2, 0xffffff, 0.7).setDepth(64);
    this.tweens.add({
      targets: [dot, trail],
      x: x2,
      y: y2,
      duration: 160,
      ease: 'Linear',
      onComplete: () => {
        dot.destroy();
        trail.destroy();
      },
    });
  }

  private damageText(x: number, y: number, text: string | number, color: string) {
    const t = this.add
      .text(x + Phaser.Math.Between(-8, 8), y, String(text), { fontSize: '13px', fontStyle: 'bold', color, fontFamily: 'sans-serif', stroke: '#000000', strokeThickness: 3 })
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
        const scale = this.unitScale * (boss ? 1.6 : 1);
        const img = this.add.image(this.fxX(e.x), this.groundY, key).setOrigin(0.5, 1).setScale(scale);
        // boss art already faces left; regular sprites face right
        if (e.side === 'right' && !boss) img.setFlipX(true).setTint(0xffc9c9);
        if (e.side === 'left' && boss) img.setFlipX(true);
        s = { img, hp: this.add.graphics(), hurtUntil: 0, lunge: 0 };
        if (boss) {
          s.label = this.add
            .text(img.x, 0, this.driver.bossName ?? 'BOSS', { fontSize: '11px', fontStyle: 'bold', color: '#ffe066', fontFamily: 'sans-serif', stroke: '#000000', strokeThickness: 3 })
            .setOrigin(0.5, 1)
            .setDepth(51);
          img.setAlpha(0).setScale(scale * 1.4);
          this.tweens.add({ targets: img, alpha: 1, scaleX: scale, scaleY: scale, duration: 400, ease: 'Back.Out' });
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
    const moving = !e.attacking;
    const bob = moving && UNITS[e.unitId]?.speed !== 0 ? Math.abs(Math.sin(time / 90 + e.id)) * 6 : 0;
    s.lunge = Math.max(0, s.lunge - delta * 0.12);
    const lungeDir = e.side === 'left' ? 1 : -1;
    const jitter = (e.id % 3) * 5;
    s.img.setPosition(this.fxX(e.x) + lungeDir * s.lunge + (e.side === 'left' ? -jitter : jitter), this.groundY - bob);
    s.img.setDepth(10 + (e.side === 'left' ? e.x : FIELD_LENGTH - e.x) / 100 + (boss ? 5 : 0));
    // lean forward while attacking
    s.img.setAngle(e.attacking ? lungeDir * 6 : 0);
    if (time < s.hurtUntil) s.img.setTint(0xff4040);
    else if (e.special) s.img.setTint(0xffe066);
    else if (e.side === 'right' && !boss) s.img.setTint(0xffc9c9);
    else s.img.clearTint();

    const w = boss ? 64 : 36;
    const h = s.img.displayHeight;
    const y = this.groundY - h - 10;
    s.hp.clear();
    s.hp.setDepth(50);
    s.hp.fillStyle(0x000000, 0.6).fillRect(s.img.x - w / 2, y, w, boss ? 7 : 5);
    const color = boss ? 0xffe066 : e.side === 'left' ? 0x3ddc84 : 0xff5a5f;
    s.hp.fillStyle(color, 1).fillRect(s.img.x - w / 2, y, w * (e.hp / e.maxHp), boss ? 7 : 5);
    if (s.label) s.label.setPosition(s.img.x, y - 2);
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
