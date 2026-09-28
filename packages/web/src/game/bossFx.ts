import Phaser from 'phaser';
import { BOSS_LIST, unitDef, type BossAbility, type Entity } from '@catfight/engine';

/** what a boss looks like when it fights: attack motion comes from its stat profile, flavour from its ability */
export interface BossStyle {
  profile: 'melee' | 'ranged' | 'tanky' | 'fast' | 'artillery';
  kind: BossAbility['kind'];
  ability: BossAbility;
}

const cache = new Map<string, BossStyle | null>();
export function bossStyle(unitId: string): BossStyle | null {
  if (!unitId.startsWith('boss_')) return null;
  let s = cache.get(unitId);
  if (s === undefined) {
    const n = Number(unitId.slice(5));
    const entry = BOSS_LIST[n - 1];
    const ability = unitDef(unitId).boss;
    s = entry && ability ? { profile: entry.profile, kind: ability.kind, ability } : null;
    cache.set(unitId, s);
  }
  return s;
}

/** slash colour for stacking-damage bosses: white -> yellow -> orange -> red as the stacks build */
export function rampColor(stacks: number): number {
  if (stacks >= 5) return 0xff4d4d;
  if (stacks >= 3) return 0xff9a3c;
  if (stacks >= 1) return 0xffe066;
  return 0xffffff;
}

/** the scene-side hooks the boss effects need */
export interface FxHost {
  scene: Phaser.Scene;
  groundY: number;
  impact(x: number, y: number, color: number, big: boolean): void;
  damageText(x: number, y: number, text: string | number, color: string): void;
}

export class BossFx {
  constructor(private h: FxHost) {}

  private get add() {
    return this.h.scene.add;
  }
  private get tweens() {
    return this.h.scene.tweens;
  }

  /** wide flat ring rolling out along the ground (stomps, artillery shells, tower busting) */
  shockwave(x: number, color = 0xffffff, size = 1) {
    const ring = this.add.ellipse(x, this.h.groundY - 4, 40 * size, 12 * size).setStrokeStyle(4, color, 0.9).setFillStyle(color, 0).setDepth(69).setBlendMode(Phaser.BlendModes.ADD);
    const glow = this.add.ellipse(x, this.h.groundY - 4, 60 * size, 16 * size, color, 0.35).setDepth(68).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: glow, scaleX: 2.6, scaleY: 1.8, alpha: 0, duration: 300, ease: 'Cubic.Out', onComplete: () => glow.destroy() });
    this.tweens.add({ targets: ring, scaleX: 3.2, scaleY: 2.2, alpha: 0, duration: 380, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
    for (let i = 0; i < 4; i++) {
      const puff = this.add.circle(x + Phaser.Math.Between(-18, 18) * size, this.h.groundY - 6, Phaser.Math.Between(5, 9) * size, 0xd8d0c0, 0.7).setDepth(68);
      this.tweens.add({ targets: puff, y: puff.y - 22 - Math.random() * 16, x: puff.x + Phaser.Math.Between(-14, 14), scale: 1.8, alpha: 0, duration: 420 + i * 60, onComplete: () => puff.destroy() });
    }
  }

  /** two crossed thin cuts: fast bosses strike twice in a blink */
  crossSlash(x: number, y: number, color: number, size = 1) {
    const g = this.add.graphics().setDepth(72).setBlendMode(Phaser.BlendModes.ADD);
    const r = 26 * size;
    g.lineStyle(4, 0xffffff, 0.95).lineBetween(x - r, y - r * 0.7, x + r, y + r * 0.7);
    g.lineStyle(2, color, 0.9).lineBetween(x - r, y - r * 0.7, x + r, y + r * 0.7);
    this.tweens.add({ targets: g, alpha: 0, duration: 160, onComplete: () => g.destroy() });
    const g2 = this.add.graphics().setDepth(72).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    g2.lineStyle(4, 0xffffff, 0.95).lineBetween(x - r, y + r * 0.7, x + r, y - r * 0.7);
    g2.lineStyle(2, color, 0.9).lineBetween(x - r, y + r * 0.7, x + r, y - r * 0.7);
    this.tweens.add({ targets: g2, alpha: { from: 0, to: 1 }, duration: 70, yoyo: true, hold: 60, delay: 60, onComplete: () => g2.destroy() });
  }

  /** ghost copy of the sprite left behind by a dash */
  afterimage(img: Phaser.GameObjects.Image, tint = 0xffffff) {
    const ghost = this.add
      .image(img.x, img.y, img.texture.key)
      .setOrigin(img.originX, img.originY)
      .setScale(img.scaleX, img.scaleY)
      .setFlipX(img.flipX)
      .setAngle(img.angle)
      .setAlpha(0.45)
      .setTint(tint)
      .setDepth(img.depth - 1);
    this.tweens.add({ targets: ghost, alpha: 0, duration: 220, onComplete: () => ghost.destroy() });
  }

  /** three horizontal speed lines trailing behind a charging body */
  speedLines(x: number, y: number, dir: 1 | -1, color = 0xffffff) {
    const g = this.add.graphics().setDepth(73);
    for (let i = -1; i <= 1; i++) {
      const len = 34 + Math.abs(i) * -8;
      g.lineStyle(3 - Math.abs(i), color, 0.8).lineBetween(x - dir * 10, y + i * 12, x - dir * (10 + len), y + i * 12);
    }
    this.tweens.add({ targets: g, x: -dir * 30, alpha: 0, duration: 200, onComplete: () => g.destroy() });
  }

  /** a long thin arrow instead of the generic bolt */
  arrow(x1: number, y1: number, x2: number, y2: number, color: number, onArrive?: () => void) {
    const angle = Phaser.Math.RadToDeg(Math.atan2(y2 - y1, x2 - x1));
    const shaft = this.add.rectangle(x1, y1, 30, 3, 0xf2e2c4).setAngle(angle).setDepth(65);
    const head = this.add.triangle(x1, y1, 0, -5, 0, 5, 9, 0, color).setAngle(angle).setDepth(66);
    const flash = this.add.circle(x1, y1, 5, 0xffffff, 0.9).setDepth(66);
    this.tweens.add({ targets: flash, scale: 2, alpha: 0, duration: 120, onComplete: () => flash.destroy() });
    const d = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    this.tweens.add({
      targets: [shaft, head],
      x: '+=' + (x2 - x1),
      y: '+=' + (y2 - y1),
      duration: Math.max(140, d * 1.1),
      ease: 'Linear',
      onComplete: () => {
        shaft.destroy();
        head.destroy();
        onArrive?.();
      },
    });
  }

  /** a lobbed shell on a parabola, exploding on arrival */
  lob(x1: number, y1: number, x2: number, y2: number, onArrive?: () => void) {
    const shell = this.add.circle(x1, y1, 7, 0x2b2b2b).setStrokeStyle(2, 0xffb347, 1).setDepth(66);
    const fuse = this.add.circle(x1, y1 - 6, 2, 0xffe066).setDepth(67);
    const peak = Math.min(y1, y2) - 70;
    const dur = 460;
    this.tweens.add({ targets: [shell, fuse], x: { from: x1, to: x2 }, duration: dur, ease: 'Linear' });
    this.tweens.add({ targets: [shell, fuse], y: peak, duration: dur / 2, ease: 'Quad.Out', yoyo: false });
    this.tweens.add({
      targets: [shell, fuse],
      y: y2,
      delay: dur / 2,
      duration: dur / 2,
      ease: 'Quad.In',
      onComplete: () => {
        shell.destroy();
        fuse.destroy();
        this.explosion(x2, y2);
        onArrive?.();
      },
    });
    const smokeTimer = this.h.scene.time.addEvent({
      delay: 45,
      repeat: Math.floor(dur / 45) - 1,
      callback: () => {
        const p = this.add.circle(shell.x, shell.y, 3, 0xbbbbbb, 0.6).setDepth(64);
        this.tweens.add({ targets: p, scale: 2.2, alpha: 0, duration: 300, onComplete: () => p.destroy() });
      },
    });
    this.h.scene.time.delayedCall(dur, () => smokeTimer.remove(false));
  }

  explosion(x: number, y: number) {
    const halo = this.add.circle(x, y, 26, 0xff7a1a, 0.5).setDepth(70).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: halo, scale: 2.4, alpha: 0, duration: 380, ease: 'Cubic.Out', onComplete: () => halo.destroy() });
    const core = this.add.circle(x, y, 10, 0xffe066, 1).setDepth(71).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: core, scale: 3.2, alpha: 0, duration: 260, ease: 'Cubic.Out', onComplete: () => core.destroy() });
    const ring = this.add.circle(x, y, 12, 0xff7a1a, 0).setStrokeStyle(4, 0xff7a1a, 0.9).setDepth(70).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 320, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
    for (let i = 0; i < 7; i++) {
      const a = (Math.PI * 2 * i) / 7 + Math.random() * 0.5;
      const sp = this.add.circle(x, y, 3, i % 2 ? 0xffb347 : 0xffffff).setDepth(72);
      this.tweens.add({ targets: sp, x: x + Math.cos(a) * 34, y: y + Math.sin(a) * 24, alpha: 0, duration: 300 + Math.random() * 120, onComplete: () => sp.destroy() });
    }
    this.h.scene.cameras.main.shake(140, 0.005);
    this.shockwave(x, 0xff9a3c, 0.8);
  }

  /** little red motes drifting from the victim into the boss (lifesteal) */
  drain(x1: number, y1: number, x2: number, y2: number, color = 0xff4d6d) {
    for (let i = 0; i < 4; i++) {
      const p = this.add.circle(x1 + Phaser.Math.Between(-8, 8), y1 + Phaser.Math.Between(-8, 8), 3, color, 0.95).setDepth(74).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: p, x: x2, y: y2 - Phaser.Math.Between(0, 20), alpha: 0.2, scale: 0.5, duration: 320 + i * 70, ease: 'Sine.In', delay: i * 40, onComplete: () => p.destroy() });
    }
  }

  /** a coin flying from the hit to the score counter (scoreDrain) */
  coin(x: number, y: number) {
    const c = this.add.circle(x, y, 6, 0xffd23f).setStrokeStyle(2, 0xb8860b, 1).setDepth(85);
    this.tweens.add({ targets: c, x: 26, y: 22, scale: 0.6, duration: 520, ease: 'Cubic.In', onComplete: () => c.destroy() });
  }

  /** thin side-going shockwave toward the victim (knockback) */
  pushWave(x: number, y: number, dir: 1 | -1) {
    const w = this.add.ellipse(x, y, 10, 34, 0xffffff, 0).setStrokeStyle(3, 0xffffff, 0.9).setDepth(72).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: w, x: x + dir * 40, scaleX: 2.4, scaleY: 1.4, alpha: 0, duration: 220, ease: 'Cubic.Out', onComplete: () => w.destroy() });
  }

  /** big red X: a finishing blow (execute) */
  executeMark(x: number, y: number) {
    const g = this.add.graphics().setDepth(76);
    const r = 30;
    g.lineStyle(8, 0x000000, 0.5).lineBetween(x - r, y - r, x + r, y + r).lineBetween(x - r, y + r, x + r, y - r);
    g.lineStyle(5, 0xff2d2d, 1).lineBetween(x - r, y - r, x + r, y + r).lineBetween(x - r, y + r, x + r, y - r);
    g.setScale(0.4);
    this.tweens.add({ targets: g, scaleX: 1, scaleY: 1, duration: 90, ease: 'Back.Out' });
    this.tweens.add({ targets: g, alpha: 0, delay: 260, duration: 220, onComplete: () => g.destroy() });
    this.h.damageText(x, y - 30, '處決！', '#ff2d2d');
  }

  /** hexagonal shield flash (armor absorbing a hit) */
  shieldFlash(x: number, y: number, dir: 1 | -1) {
    const g = this.add.graphics().setDepth(72);
    const cx = x + dir * 6;
    g.lineStyle(3, 0x9fd3ff, 0.95).beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const px = cx + Math.cos(a) * 16;
      const py = y + Math.sin(a) * 16;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath().strokePath().fillStyle(0x9fd3ff, 0.25).fillPath();
    this.tweens.add({ targets: g, alpha: 0, scaleX: 1.3, scaleY: 1.3, duration: 200, onComplete: () => g.destroy() });
  }

  /** gold magic circle at the feet (summon) */
  magicCircle(x: number) {
    const y = this.h.groundY - 3;
    const outer = this.add.ellipse(x, y, 70, 22, 0xffe066, 0).setStrokeStyle(3, 0xffe066, 0.9).setDepth(9);
    const inner = this.add.ellipse(x, y, 40, 13, 0xffe066, 0.15).setStrokeStyle(2, 0xffffff, 0.8).setDepth(9);
    this.tweens.add({ targets: [outer, inner], angle: 180, duration: 700 });
    this.tweens.add({ targets: [outer, inner], alpha: 0, delay: 450, duration: 300, onComplete: () => [outer, inner].forEach((o) => o.destroy()) });
    const beam = this.add.rectangle(x, y, 26, 80, 0xffe066, 0.35).setOrigin(0.5, 1).setDepth(9).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: beam, scaleY: 1.4, alpha: 0, duration: 450, onComplete: () => beam.destroy() });
  }

  /** golden pillar of light (revive) */
  revivePillar(x: number) {
    const pillar = this.add.rectangle(x, this.h.groundY, 40, 200, 0xffe066, 0.55).setOrigin(0.5, 1).setDepth(75).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: pillar, scaleX: 2.2, alpha: 0, duration: 600, ease: 'Cubic.Out', onComplete: () => pillar.destroy() });
    this.h.scene.cameras.main.flash(300, 255, 224, 102, false);
  }

  /** rising green plus signs (regen / heal allies) */
  healSparkle(x: number, y: number) {
    const t = this.add.text(x + Phaser.Math.Between(-12, 12), y, '+', { fontSize: '14px', fontStyle: 'bold', color: '#7dff9a', fontFamily: 'sans-serif', stroke: '#000000', strokeThickness: 2 }).setOrigin(0.5).setDepth(74);
    this.tweens.add({ targets: t, y: y - 24, alpha: 0, duration: 600, onComplete: () => t.destroy() });
  }

  /** a spinning paper dart (the bond cat's certificate) with a faint paper trail */
  dart(x1: number, y1: number, x2: number, y2: number, color: number, onArrive?: () => void) {
    const angle = Phaser.Math.RadToDeg(Math.atan2(y2 - y1, x2 - x1));
    const paper = this.add.rectangle(x1, y1, 16, 9, 0xfff8e6).setStrokeStyle(1, color, 1).setAngle(angle).setDepth(66);
    const stripe = this.add.rectangle(x1, y1, 16, 3, color, 0.9).setAngle(angle).setDepth(67);
    const d = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const dur = Math.max(150, d * 1.3);
    this.tweens.add({ targets: [paper, stripe], angle: angle + 540, duration: dur });
    this.tweens.add({
      targets: [paper, stripe],
      x: '+=' + (x2 - x1),
      y: '+=' + (y2 - y1),
      duration: dur,
      ease: 'Sine.Out',
      onComplete: () => {
        paper.destroy();
        stripe.destroy();
        onArrive?.();
      },
    });
    const trail = this.h.scene.time.addEvent({
      delay: 40,
      repeat: Math.floor(dur / 40) - 1,
      callback: () => {
        const p = this.add.rectangle(paper.x, paper.y, 6, 3, 0xffffff, 0.5).setAngle(paper.angle).setDepth(65);
        this.tweens.add({ targets: p, alpha: 0, duration: 160, onComplete: () => p.destroy() });
      },
    });
    this.h.scene.time.delayedCall(dur, () => trail.remove(false));
  }

  /** violet spell ring rolling out from the caster across its whole reach (area attack) */
  arcaneBurst(x: number, y: number, reachPx: number, dir: 1 | -1) {
    const gy = this.h.groundY - 3;
    // sigil under the caster
    const sigil = this.add.ellipse(x, gy, 44, 14, 0xc084fc, 0.2).setStrokeStyle(2, 0xc084fc, 0.9).setDepth(9).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: sigil, angle: 120, alpha: 0, duration: 420, onComplete: () => sigil.destroy() });
    // the wave itself: a ring that sweeps forward to the edge of the reach
    const wave = this.add.ellipse(x, y, 20, 46, 0xc084fc, 0).setStrokeStyle(4, 0xd8b4fe, 0.95).setDepth(71).setBlendMode(Phaser.BlendModes.ADD);
    const glow = this.add.ellipse(x, y, 30, 56, 0xc084fc, 0.35).setDepth(70).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: [wave, glow], x: x + dir * reachPx, scaleY: 1.3, alpha: 0, duration: 300, ease: 'Cubic.Out', onComplete: () => [wave, glow].forEach((o) => o.destroy()) });
    for (let i = 0; i < 6; i++) {
      const p = this.add.circle(x + dir * Phaser.Math.Between(6, 20), y + Phaser.Math.Between(-16, 16), 3, 0xe9d5ff, 0.95).setDepth(72).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: p, x: x + dir * (reachPx * (0.4 + Math.random() * 0.6)), y: p.y - Phaser.Math.Between(6, 30), alpha: 0, duration: 260 + i * 40, onComplete: () => p.destroy() });
    }
  }

  /** small violet flare on each creature the spell touches */
  arcaneHit(x: number, y: number) {
    const f = this.add.star(x, y, 6, 4, 11, 0xe9d5ff, 1).setDepth(73).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: f, scale: 1.7, angle: 60, alpha: 0, duration: 240, onComplete: () => f.destroy() });
  }

  /** gold coin flash + short ground thump (the deposit cat's coin slam) */
  coinSlam(x: number, y: number) {
    const coin = this.add.circle(x, y, 9, 0xffd23f).setStrokeStyle(2, 0xb8860b, 1).setDepth(73);
    const mark = this.add.text(x, y, '$', { fontSize: '12px', fontStyle: 'bold', color: '#7a5200', fontFamily: 'sans-serif' }).setOrigin(0.5).setDepth(74);
    this.tweens.add({ targets: [coin, mark], scale: 1.6, alpha: 0, duration: 220, ease: 'Cubic.Out', onComplete: () => [coin, mark].forEach((o) => o.destroy()) });
    this.shockwave(x, 0xffd23f, 0.5);
  }

  /** per-frame passive aura for the support cats (analyst / runner / insurer) */
  drawUnitAura(g: Phaser.GameObjects.Graphics, unitId: string, cx: number, h: number, time: number, dir: 1 | -1) {
    g.clear();
    g.setBlendMode(Phaser.BlendModes.ADD);
    const gy = this.h.groundY - 3;
    const pulse = (time % 1400) / 1400;
    if (unitId === 'scholar') {
      // teal ring with three rising "chart bars" ticking upward
      g.lineStyle(2, 0x5eead4, 0.35 + 0.15 * Math.sin(time / 260)).strokeEllipse(cx, gy, 36, 10);
      for (let k = 0; k < 3; k++) {
        const p = (pulse + k / 3) % 1;
        const bx = cx - dir * (10 - k * 8);
        g.fillStyle(0x5eead4, 0.6 * (1 - p)).fillRect(bx - 2, gy - 6 - p * (14 + k * 6), 4, 6 + k * 3);
      }
    } else if (unitId === 'runner') {
      // wind streaks flicking behind the feet
      for (let k = 0; k < 3; k++) {
        const p = (pulse * 2 + k / 3) % 1;
        const yy = gy - 4 - k * 6;
        g.lineStyle(2, 0x9ff3ff, 0.55 * (1 - p)).lineBetween(cx - dir * (8 + p * 10), yy, cx - dir * (22 + p * 26), yy);
      }
    } else if (unitId === 'medic') {
      const p = pulse;
      g.lineStyle(2, 0x7dff9a, 0.6 * (1 - p)).strokeEllipse(cx, gy, 30 + p * 50, 9 + p * 14);
      g.lineStyle(2, 0x7dff9a, 0.4).strokeEllipse(cx, gy, 30, 9);
    }
  }

  /** per-frame passive aura drawn under/around the boss */
  drawAura(g: Phaser.GameObjects.Graphics, e: Entity, style: BossStyle, cx: number, h: number, time: number, dir: 1 | -1) {
    g.clear();
    g.setBlendMode(Phaser.BlendModes.ADD);
    const gy = this.h.groundY - 3;
    const pulse = (time % 1200) / 1200;
    switch (style.kind) {
      case 'slowAura': {
        // purple ripples spreading out along the ground
        for (let k = 0; k < 2; k++) {
          const p = (pulse + k * 0.5) % 1;
          g.lineStyle(3, 0xb388ff, 0.7 * (1 - p)).strokeEllipse(cx, gy, 40 + p * 90, 12 + p * 26);
        }
        break;
      }
      case 'enrage': {
        const ab = style.ability as { below: number };
        if (e.hp / e.maxHp < ab.below) {
          const a = 0.35 + 0.25 * Math.sin(time / 90);
          g.fillStyle(0xff2d2d, a * 0.5).fillEllipse(cx, gy, 70, 18);
          g.lineStyle(3, 0xff2d2d, a).strokeEllipse(cx, gy, 76 + 8 * Math.sin(time / 120), 20);
        }
        break;
      }
      case 'berserk': {
        const rage = 1 - e.hp / e.maxHp;
        if (rage > 0.3) {
          g.lineStyle(2, 0xff9a3c, 0.5 * rage).strokeEllipse(cx, gy, 60, 16);
          // heat shimmer lines flickering behind the body
          for (let k = 0; k < 3; k++) {
            const yy = this.h.groundY - h * (0.25 + k * 0.2) + Math.sin(time / 60 + k) * 3;
            g.lineStyle(2, 0xff9a3c, 0.35 * rage).lineBetween(cx - dir * 20, yy, cx - dir * (40 + k * 8), yy);
          }
        }
        break;
      }
      case 'regen':
      case 'healAllies': {
        const a = 0.25 + 0.2 * Math.sin(time / 200);
        g.lineStyle(2, 0x7dff9a, a).strokeEllipse(cx, gy, 56, 15);
        break;
      }
      case 'armor': {
        // faint hexagonal shield floating in front
        const sx = cx + dir * 26;
        const sy = this.h.groundY - h * 0.5;
        g.lineStyle(2, 0x9fd3ff, 0.35 + 0.15 * Math.sin(time / 300)).beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          const px = sx + Math.cos(a) * 14;
          const py = sy + Math.sin(a) * 14;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath().strokePath();
        break;
      }
      case 'lastStand': {
        if (!e.revived) g.lineStyle(2, 0xffe066, 0.3 + 0.2 * Math.sin(time / 250)).strokeEllipse(cx, gy, 58, 15);
        break;
      }
      case 'snipe': {
        // a steady aiming line while the shot charges
        const y = this.h.groundY - h * 0.55;
        g.lineStyle(1, 0xffe066, 0.25 + 0.2 * pulse).lineBetween(cx + dir * 20, y, cx + dir * 400, y);
        break;
      }
      default:
        break;
    }
  }
}
