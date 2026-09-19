/**
 * fx.js - particles, floating numbers, screen shake, hit-stop and flashes.
 *
 * Everything here is cosmetic, but it is most of what makes the game feel
 * good: a hit that does not shake, freeze and spray is a hit that reads as
 * nothing happening.
 */

import { C } from './art.js';

const TAU = Math.PI * 2;

class P {
  constructor() { this.dead = true; }
}

export class Fx {
  constructor(font) {
    this.font = font;
    this.parts = [];
    this.texts = [];
    this.rings = [];
    this.shakeMag = 0;
    this.shakeTime = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.freeze = 0;
    this.flashColor = null;
    this.flashAlpha = 0;
    this.flashDecay = 4;
    this.t = 0;
  }

  reset() {
    this.parts.length = 0;
    this.texts.length = 0;
    this.rings.length = 0;
    this.shakeMag = this.shakeTime = this.shakeX = this.shakeY = 0;
    this.freeze = 0;
    this.flashAlpha = 0;
  }

  /** Reuse dead particles so a busy screen does not churn the heap. */
  _alloc() {
    for (const p of this.parts) if (p.dead) return p;
    const p = new P();
    this.parts.push(p);
    return p;
  }

  particle(o) {
    if (this.parts.length > 420 && !this.parts.some((p) => p.dead)) return null;
    const p = this._alloc();
    p.dead = false;
    p.x = o.x; p.y = o.y;
    p.vx = o.vx || 0; p.vy = o.vy || 0;
    p.life = p.max = o.life || 0.5;
    p.g = o.g ?? 400;
    p.drag = o.drag ?? 0.9;
    p.size = o.size ?? 2;
    p.color = o.color || C.white;
    p.fade = o.fade || null;
    p.shape = o.shape || 'pixel';
    p.spin = o.spin || 0;
    p.bounce = o.bounce || 0;
    p.shrink = o.shrink ?? true;
    return p;
  }

  /** A generic radial burst; the workhorse for hits, deaths and pickups. */
  burst(x, y, count, o = {}) {
    const speed = o.speed ?? 90;
    const spread = o.spread ?? TAU;
    const dir = o.dir ?? 0;
    for (let i = 0; i < count; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.particle({
        x, y,
        vx: Math.cos(a) * s + (o.vx || 0),
        vy: Math.sin(a) * s + (o.vy || 0),
        life: (o.life ?? 0.45) * (0.6 + Math.random() * 0.8),
        g: o.g,
        drag: o.drag,
        size: o.size ?? (Math.random() < 0.4 ? 2 : 1),
        color: Array.isArray(o.color) ? o.color[(Math.random() * o.color.length) | 0] : (o.color || C.white),
        fade: o.fade,
        shape: o.shape,
        bounce: o.bounce,
      });
    }
  }

  dust(x, y, dir = 0) {
    this.burst(x, y, 4, {
      speed: 34, spread: 1.4, dir: dir === 0 ? -Math.PI / 2 : (dir > 0 ? Math.PI : 0),
      life: 0.32, g: -30, drag: 0.86, color: ['#c9c2a8', '#8f8a76'], size: 2,
    });
  }

  landPuff(x, y) {
    for (const s of [-1, 1]) {
      this.burst(x + s * 4, y, 4, {
        speed: 60, spread: 0.9, dir: s > 0 ? -0.25 : Math.PI + 0.25,
        life: 0.35, g: -40, drag: 0.82, color: ['#d8d2b8', '#a49e88'], size: 2,
      });
    }
  }

  /** Hit spray + the freeze and shake that sell the impact. */
  impact(x, y, color, big) {
    this.burst(x, y, big ? 16 : 9, {
      speed: big ? 170 : 120, life: 0.4, g: 260, drag: 0.9,
      color: color || [C.emberL, C.ember, C.white], size: 2,
    });
    this.rings.push({ x, y, r: big ? 3 : 2, max: big ? 22 : 13, life: 0.22, t: 0.22, color: color2(color) });
    this.shake(big ? 4.5 : 2.4, big ? 0.28 : 0.16);
    this.hitstop(big ? 0.085 : 0.05);
  }

  gore(x, y, colors) {
    this.burst(x, y, 18, {
      speed: 160, life: 0.7, g: 520, drag: 0.94, color: colors, size: 2, bounce: 0.3,
    });
    this.burst(x, y, 8, {
      speed: 60, life: 0.5, g: -20, drag: 0.85, color: ['#ffffff', '#d8d8d8'], size: 3,
    });
  }

  sparkle(x, y, color) {
    this.burst(x, y, 7, {
      speed: 70, life: 0.5, g: -60, drag: 0.88, color: color || [C.goldL, C.gold, C.white], size: 1, shape: 'star',
    });
  }

  trail(x, y, color) {
    this.particle({ x, y, vx: 0, vy: 0, life: 0.22, g: 0, drag: 0.8, size: 2, color, shrink: true });
  }

  ring(x, y, max, color, life = 0.3) {
    this.rings.push({ x, y, r: 2, max, life, t: life, color });
  }

  text(x, y, str, color, opts = {}) {
    this.texts.push({
      x, y, str, color: color || C.gold,
      life: opts.life || 0.9, t: opts.life || 0.9,
      vy: opts.vy ?? -26, scale: opts.scale || 1,
    });
  }

  shake(mag, dur = 0.2) {
    if (mag > this.shakeMag) { this.shakeMag = mag; this.shakeTime = dur; this.shakeDur = dur; }
  }

  hitstop(d) { if (d > this.freeze) this.freeze = d; }

  flash(color, alpha = 0.55, decay = 4) {
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
    this.flashDecay = decay;
  }

  update(dt) {
    this.t += dt;
    for (const p of this.parts) {
      if (p.dead) continue;
      p.life -= dt;
      if (p.life <= 0) { p.dead = true; continue; }
      p.vy += p.g * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t -= dt;
      t.y += t.vy * dt;
      t.vy *= Math.pow(0.9, dt * 60);
      if (t.t <= 0) this.texts.splice(i, 1);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t -= dt;
      if (r.t <= 0) { this.rings.splice(i, 1); continue; }
      const k = 1 - r.t / r.life;
      r.r = 2 + (r.max - 2) * k;
    }

    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const k = Math.max(0, this.shakeTime / (this.shakeDur || 0.2));
      const m = this.shakeMag * k * k;
      this.shakeX = (Math.random() - 0.5) * 2 * m;
      this.shakeY = (Math.random() - 0.5) * 2 * m;
      if (this.shakeTime <= 0) { this.shakeMag = 0; this.shakeX = this.shakeY = 0; }
    }

    if (this.flashAlpha > 0) {
      this.flashAlpha = Math.max(0, this.flashAlpha - this.flashDecay * dt);
    }
  }

  /** World-space layer: particles and rings, drawn with the camera applied. */
  draw(ctx) {
    for (const p of this.parts) {
      if (p.dead) continue;
      const k = p.life / p.max;
      ctx.fillStyle = p.fade && k < 0.4 ? p.fade : p.color;
      const s = p.shrink ? Math.max(1, Math.round(p.size * (0.35 + k * 0.65))) : p.size;
      const x = Math.round(p.x - s / 2);
      const y = Math.round(p.y - s / 2);
      if (p.shape === 'star' && s > 1) {
        ctx.fillRect(x, y - 1, s, s + 2);
        ctx.fillRect(x - 1, y, s + 2, s);
      } else {
        ctx.fillRect(x, y, s, s);
      }
    }

    for (const r of this.rings) {
      const k = r.t / r.life;
      ctx.fillStyle = r.color;
      const steps = Math.max(8, Math.round(r.r * 3));
      const alpha = k;
      if (alpha < 0.25) continue;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * TAU;
        ctx.fillRect(Math.round(r.x + Math.cos(a) * r.r), Math.round(r.y + Math.sin(a) * r.r * 0.75), 1, 1);
      }
    }
  }

  /** Screen-space layer: floating score numbers. */
  drawText(ctx, camX, camY) {
    for (const t of this.texts) {
      const k = t.t / t.life;
      if (k < 0.35 && Math.floor(this.t * 30) % 2 === 0) continue;
      this.font.draw(ctx, t.str, Math.round(t.x - camX), Math.round(t.y - camY), {
        color: t.color, align: 'center', scale: t.scale, shadow: '#000000',
      });
    }
  }

  drawFlash(ctx, w, h) {
    if (this.flashAlpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.flashAlpha);
    ctx.fillStyle = this.flashColor || '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

function color2(color) {
  if (Array.isArray(color)) return color[0];
  return color || C.white;
}
