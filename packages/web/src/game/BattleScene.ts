import Phaser from 'phaser';
import { BALANCE, FIELD_LENGTH, TICK_MS, UNITS, type BattleState, type Entity, type Side } from '@catfight/engine';

export interface BattleDriver {
  /** advance the game by one fixed tick */
  tick(): void;
  state: BattleState;
  /** boss unit id for this battle (sprite is loaded from /assets/boss/<id>.png) */
  bossId?: string;
  /** called with each engine event batch after a tick (toasts etc.) */
  onEvents?: (events: BattleState['events']) => void;
}

const UNIT_KEYS = Object.keys(UNITS);

/** Renders the engine state. The scene owns the fixed-timestep loop and calls driver.tick(). */
export class BattleScene extends Phaser.Scene {
  private driver!: BattleDriver;
  private acc = 0;
  private sprites = new Map<number, { img: Phaser.GameObjects.Image; hp: Phaser.GameObjects.Graphics }>();
  private towerHp!: Record<Side, Phaser.GameObjects.Graphics>;
  private padX = 40;
  private groundY = 0;
  private unitScale = 1;

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
    this.add.image(this.padX - 10, this.groundY, 'tower_player').setOrigin(0.5, 1).setScale(towerScale);
    this.add.image(width - this.padX + 10, this.groundY, 'tower_enemy').setOrigin(0.5, 1).setScale(towerScale);
    this.towerHp = { left: this.add.graphics(), right: this.add.graphics() };
    this.scale.on('resize', () => this.scene.restart({ driver: this.driver }));
  }

  private fx(x: number) {
    const { width } = this.scale;
    return this.padX + (x / FIELD_LENGTH) * (width - this.padX * 2);
  }

  update(time: number, delta: number) {
    this.acc += Math.min(delta, 250);
    while (this.acc >= TICK_MS) {
      this.acc -= TICK_MS;
      this.driver.tick();
      if (this.driver.onEvents && this.driver.state.events.length) this.driver.onEvents(this.driver.state.events);
    }
    this.render(time);
  }

  private render(time: number) {
    const st = this.driver.state;
    const alive = new Set<number>();
    for (const e of st.entities) {
      alive.add(e.id);
      let s = this.sprites.get(e.id);
      if (!s) {
        const boss = e.unitId.startsWith('boss_');
        const key = this.textures.exists(e.unitId) ? e.unitId : 'tank';
        const img = this.add.image(this.fx(e.x), this.groundY, key).setOrigin(0.5, 1).setScale(this.unitScale * (boss ? 1.6 : 1));
        // boss art already faces left; regular sprites face right
        if (e.side === 'right' && !boss) img.setFlipX(true).setTint(0xffc9c9);
        if (e.side === 'left' && boss) img.setFlipX(true);
        s = { img, hp: this.add.graphics() };
        this.sprites.set(e.id, s);
      }
      this.draw(e, s, time);
    }
    for (const [id, s] of this.sprites) {
      if (!alive.has(id)) {
        this.tweens.add({ targets: s.img, alpha: 0, y: s.img.y - 20, duration: 250, onComplete: () => s.img.destroy() });
        s.hp.destroy();
        this.sprites.delete(id);
      }
    }
    this.drawTower('left', st.towerHp.left);
    this.drawTower('right', st.towerHp.right);
  }

  private draw(e: Entity, s: { img: Phaser.GameObjects.Image; hp: Phaser.GameObjects.Graphics }, time: number) {
    const moving = !e.attacking;
    const bob = moving ? Math.abs(Math.sin(time / 90 + e.id)) * 6 : 0;
    const lunge = e.hit ? (e.side === 'left' ? 8 : -8) : 0;
    const jitter = (e.id % 3) * 5;
    s.img.setPosition(this.fx(e.x) + lunge + (e.side === 'left' ? -jitter : jitter), this.groundY - bob);
    s.img.setDepth(10 + (e.side === 'left' ? e.x : FIELD_LENGTH - e.x) / 100);
    const boss = e.unitId.startsWith('boss_');
    if (e.special) s.img.setTint(0xffe066);
    else if (e.hit) s.img.setTint(0xffffff);
    else if (e.side === 'right' && !boss) s.img.setTint(0xffc9c9);
    else s.img.clearTint();
    const w = boss ? 60 : 36;
    const h = s.img.displayHeight;
    s.hp.clear();
    s.hp.setDepth(50);
    s.hp.fillStyle(0x000000, 0.6).fillRect(s.img.x - w / 2, this.groundY - h - 10, w, 5);
    s.hp.fillStyle(e.side === 'left' ? 0x3ddc84 : 0xff5a5f, 1).fillRect(s.img.x - w / 2, this.groundY - h - 10, w * (e.hp / e.maxHp), 5);
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
    g.fillStyle(0x000000, 0.6).fillRect(x, y, w, 8);
    g.fillStyle(side === 'left' ? 0x3ddc84 : 0xff5a5f, 1).fillRect(x, y, w * Math.max(0, hp / max), 8);
  }
}
