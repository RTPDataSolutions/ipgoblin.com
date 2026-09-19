/**
 * entities.js - shared physics, enemies, pickups, projectiles and the boss.
 *
 * Every entity's (x, y) is the top-left of its collision box. Sprites carry
 * their own offsets, so drawing is always `x + ox, y + oy`.
 */

import { TS } from './tiles.js';
import { C } from './art.js';

const GRAVITY = 1500;
const MAX_FALL = 430;

/* ----------------------------------------------------------------- physics */

/** Move along X in <=8px steps so nothing tunnels through a tile. */
export function moveX(e, level, dx) {
  let hit = false;
  let remaining = dx;
  while (Math.abs(remaining) > 0.0001) {
    const step = Math.max(-8, Math.min(8, remaining));
    remaining -= step;
    e.x += step;
    const y0 = Math.floor(e.y / TS);
    const y1 = Math.floor((e.y + e.h - 1) / TS);
    if (step > 0) {
      const tx = Math.floor((e.x + e.w - 1) / TS);
      for (let ty = y0; ty <= y1; ty++) {
        if (level.isSolid(tx, ty)) { e.x = tx * TS - e.w; hit = true; remaining = 0; break; }
      }
    } else if (step < 0) {
      const tx = Math.floor(e.x / TS);
      for (let ty = y0; ty <= y1; ty++) {
        if (level.isSolid(tx, ty)) { e.x = (tx + 1) * TS; hit = true; remaining = 0; break; }
      }
    }
  }
  return hit;
}

/**
 * Move along Y. Returns 'ground', 'ceiling' or null. One-way platforms only
 * stop an entity that was already above them and is moving down.
 */
export function moveY(e, level, dy, opts = {}) {
  let result = null;
  let remaining = dy;
  while (Math.abs(remaining) > 0.0001) {
    const step = Math.max(-8, Math.min(8, remaining));
    remaining -= step;
    const prevBottom = e.y + e.h;
    e.y += step;
    const x0 = Math.floor(e.x / TS);
    const x1 = Math.floor((e.x + e.w - 1) / TS);
    if (step > 0) {
      const ty = Math.floor((e.y + e.h - 1) / TS);
      for (let tx = x0; tx <= x1; tx++) {
        const solid = level.isSolid(tx, ty);
        const platform = opts.platforms && !opts.dropThrough && level.isPlatform(tx, ty) &&
          prevBottom <= ty * TS + 1.5;
        if (solid || platform) {
          e.y = ty * TS - e.h;
          result = 'ground';
          remaining = 0;
          break;
        }
      }
    } else if (step < 0) {
      const ty = Math.floor(e.y / TS);
      for (let tx = x0; tx <= x1; tx++) {
        if (level.isSolid(tx, ty)) { e.y = (ty + 1) * TS; result = 'ceiling'; remaining = 0; break; }
      }
    }
  }
  return result;
}

export function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function drawSprite(ctx, cam, s, idx, x, y, faceRight, flash) {
  const bank = flash ? s.flash : s.frames;
  const f = bank[idx % bank.length];
  ctx.drawImage(faceRight ? f.r : f.l, Math.round(x + s.ox - cam.x), Math.round(y + s.oy - cam.y));
}

/* ------------------------------------------------------------------- base  */

export class Entity {
  constructor(g, x, y, w, h) {
    this.g = g;
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.vx = 0;
    this.vy = 0;
    this.dead = false;
    this.face = 1;
    this.t = 0;
    this.solidGround = false;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  /** Culled when far off-screen, so distant enemies cost nothing. */
  get active() {
    const cam = this.g.cam;
    return this.x + this.w > cam.x - 160 && this.x < cam.x + this.g.viewW + 160;
  }

  gravity(dt, scale = 1) {
    this.vy = Math.min(MAX_FALL, this.vy + GRAVITY * scale * dt);
  }

  update() {}
  draw() {}
}

/* ---------------------------------------------------------------- pickups  */

const PICKUP_DEF = {
  coin: { w: 10, h: 10, score: 25, sfx: 'coin', art: 'coin', text: null },
  gem: { w: 12, h: 12, score: 250, sfx: 'gem', art: 'gem', text: '250' },
  heart: { w: 12, h: 12, score: 0, sfx: 'heart', art: 'heart', text: 'HEART' },
  idol: { w: 12, h: 12, score: 2500, sfx: 'key', art: 'key', text: 'IDOL! 2500' },
};

export class Pickup extends Entity {
  constructor(g, kind, cx, cy) {
    const d = PICKUP_DEF[kind];
    super(g, cx - d.w / 2, cy - d.h / 2, d.w, d.h);
    this.kind = kind;
    this.def = d;
    this.baseY = this.y;
    this.phase = Math.random() * Math.PI * 2;
    this.magnet = false;
    this.launched = false;
  }

  /** Coins that burst out of a chest arc through the air before settling. */
  launch(vx, vy) {
    this.launched = true;
    this.vx = vx;
    this.vy = vy;
    this.settle = 0;
  }

  update(dt) {
    this.t += dt;
    const p = this.g.player;

    if (this.launched) {
      this.gravity(dt, 0.8);
      moveX(this, this.g.level, this.vx * dt);
      const r = moveY(this, this.g.level, this.vy * dt, { platforms: true });
      this.vx *= Math.pow(0.94, dt * 60);
      if (r === 'ground') {
        this.vy = this.vy > 60 ? -this.vy * 0.35 : 0;
        if (Math.abs(this.vy) < 30) { this.launched = false; this.baseY = this.y; }
      }
    } else {
      this.y = this.baseY + Math.sin(this.t * 3 + this.phase) * 1.6;
    }

    if (p && !p.dead) {
      const dx = p.cx - this.cx;
      const dy = p.cy - this.cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < 40 * 40) this.magnet = true;
      if (this.magnet && !this.launched) {
        const d = Math.max(1, Math.sqrt(d2));
        this.x += (dx / d) * 200 * dt;
        this.y += (dy / d) * 200 * dt;
        this.baseY = this.y;
      }
      if (overlaps(this, p)) this.collect();
    }
  }

  collect() {
    this.dead = true;
    const g = this.g;
    g.sound.sfx(this.def.sfx);
    if (this.kind === 'heart') {
      g.player.heal(1);
      g.fx.text(this.cx, this.y - 4, 'HEART', C.tunicL);
    } else {
      g.addScore(this.def.score);
      if (this.def.text) g.fx.text(this.cx, this.y - 4, this.def.text, this.kind === 'idol' ? C.goldL : C.cyanL);
    }
    if (this.kind === 'coin') g.loot++;
    g.fx.sparkle(this.cx, this.cy, this.kind === 'coin' ? [C.goldL, C.gold] : [C.cyanL, C.white]);
  }

  draw(ctx, cam) {
    const art = this.g.art[this.def.art];
    const idx = Math.floor(this.t * 9) % art.frames.length;
    drawSprite(ctx, cam, art, idx, this.x, this.y, true, false);
  }
}

/* ----------------------------------------------------------------- chest   */

export class Chest extends Entity {
  constructor(g, cx, feetY) {
    super(g, cx - 9, feetY - 16, 18, 16);
    this.open = false;
  }

  hitByWhip() { this.pop(); }

  pop() {
    if (this.open) return;
    this.open = true;
    const g = this.g;
    g.sound.sfx('chest');
    g.fx.burst(this.cx, this.y, 14, { speed: 150, life: 0.5, color: [C.gold, C.goldL, C.white], g: 420 });
    g.fx.shake(2.5, 0.2);
    for (let i = 0; i < 7; i++) {
      const p = new Pickup(g, 'coin', this.cx, this.y + 2);
      p.launch((Math.random() - 0.5) * 170, -180 - Math.random() * 90);
      g.spawn(p);
    }
    if (Math.random() < 0.5) {
      const gem = new Pickup(g, 'gem', this.cx, this.y);
      gem.launch((Math.random() - 0.5) * 90, -240);
      g.spawn(gem);
    }
  }

  update(dt) {
    this.t += dt;
    const p = this.g.player;
    if (!this.open && p && !p.dead && overlaps(this, p)) this.pop();
  }

  draw(ctx, cam) {
    const art = this.open ? this.g.art.chest.open : this.g.art.chest.closed;
    drawSprite(ctx, cam, art, 0, this.x, this.y, true, false);
  }
}

/* ------------------------------------------------------------------ door   */

export class Door extends Entity {
  constructor(g, cx, feetY) {
    super(g, cx - 13, feetY - 40, 26, 40);
    this.used = false;
    this.appear = 0;
  }

  update(dt) {
    this.t += dt;
    this.appear = Math.min(1, this.appear + dt * 2);
    if (this.t % 0.25 < dt) {
      this.g.fx.particle({
        x: this.cx + (Math.random() - 0.5) * 18,
        y: this.y + this.h - 4,
        vx: (Math.random() - 0.5) * 14, vy: -26 - Math.random() * 20,
        life: 0.8, g: -18, drag: 0.95, size: 2, color: C.skinL,
      });
    }
    const p = this.g.player;
    if (!this.used && p && !p.dead && overlaps(this, p) && p.onGround) {
      this.used = true;
      this.g.completeLevel();
    }
  }

  draw(ctx, cam) {
    const art = this.g.art.door;
    const idx = Math.floor(this.t * 8) % art.frames.length;
    if (this.appear < 1) {
      ctx.save();
      ctx.globalAlpha = this.appear;
      drawSprite(ctx, cam, art, idx, this.x, this.y, true, false);
      ctx.restore();
    } else {
      drawSprite(ctx, cam, art, idx, this.x, this.y, true, false);
    }
  }
}

/* ------------------------------------------------------------- projectiles */

export class Shot extends Entity {
  constructor(g, x, y, vx, vy, opts = {}) {
    const s = opts.big ? 10 : 6;
    super(g, x - s / 2, y - s / 2, s, s);
    this.vx = vx;
    this.vy = vy;
    this.big = !!opts.big;
    this.damage = opts.damage || 1;
    this.life = opts.life || 4;
    this.gravityScale = opts.gravityScale || 0;
    this.face = vx >= 0 ? 1 : -1;
  }

  update(dt) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) { this.burst(); return; }
    if (this.gravityScale) this.gravity(dt, this.gravityScale);
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.g.level.solidInRect(this.x, this.y, this.w, this.h)) { this.burst(); return; }
    if (this.t % 0.06 < dt) {
      this.g.fx.trail(this.cx, this.cy, this.big ? C.magenta : C.ember);
    }
    const p = this.g.player;
    if (p && !p.dead && overlaps(this, p)) {
      p.hurt(this.damage, Math.sign(this.vx) || 1);
      this.burst();
    }
  }

  burst() {
    this.dead = true;
    this.g.fx.burst(this.cx, this.cy, this.big ? 12 : 7, {
      speed: 90, life: 0.3, g: 60, color: this.big ? [C.magenta, C.white] : [C.emberL, C.ember],
    });
  }

  draw(ctx, cam) {
    const art = this.big ? this.g.art.bossShot : this.g.art.shot;
    const idx = Math.floor(this.t * 16) % art.frames.length;
    drawSprite(ctx, cam, art, idx, this.x, this.y, this.face > 0, false);
  }
}

/* ---------------------------------------------------------------- enemies  */

export class Enemy extends Entity {
  constructor(g, x, y, w, h) {
    super(g, x, y, w, h);
    this.hp = 1;
    this.maxHp = 1;
    this.contactDamage = 1;
    this.hurtT = 0;
    this.score = 100;
    this.gore = [C.oozeL, C.ooze, C.oozeD];
    this.isEnemy = true;
    this.stompable = true;
  }

  /** Returns true if the hit landed; false means it was blocked. */
  hurt(amount, dir, source) {
    if (this.hurtT > 0.05 || this.dead) return false;
    this.hp -= amount;
    this.hurtT = 0.22;
    this.vx += dir * 90;
    if (this.hp <= 0) { this.die(dir); return true; }
    this.g.sound.sfx('hit');
    this.g.fx.impact(this.cx, this.cy, [C.white, C.emberL], false);
    return true;
  }

  die(dir) {
    this.dead = true;
    const g = this.g;
    g.sound.sfx('kill');
    g.fx.gore(this.cx, this.cy, this.gore);
    g.fx.impact(this.cx, this.cy, [C.white, C.goldL], true);
    g.killed(this, dir);
  }

  /** Walk until a wall or a ledge, then turn around. */
  patrol(dt, speed) {
    const level = this.g.level;
    this.vx = this.face * speed;
    if (moveX(this, level, this.vx * dt)) this.face *= -1;
    // Look for floor just ahead of the leading foot.
    if (this.onGround) {
      const aheadX = this.face > 0 ? this.x + this.w + 2 : this.x - 2;
      const tx = Math.floor(aheadX / TS);
      const ty = Math.floor((this.y + this.h + 2) / TS);
      const supported = this.g.level.isSolid(tx, ty) || this.g.level.isPlatform(tx, ty);
      if (!supported) this.face *= -1;
    }
  }

  fall(dt) {
    this.gravity(dt);
    this.onGround = moveY(this, this.g.level, this.vy * dt, { platforms: true }) === 'ground';
    if (this.onGround) this.vy = 0;
    if (this.y > this.g.level.pixelH + 80) this.dead = true;
  }

  tickHurt(dt) { if (this.hurtT > 0) this.hurtT -= dt; }

  get flashing() { return this.hurtT > 0 && Math.floor(this.hurtT * 40) % 2 === 0; }
}

export class Slime extends Enemy {
  constructor(g, cx, feetY) {
    super(g, cx - 6, feetY - 11, 12, 11);
    this.hp = this.maxHp = 2;
    this.score = 150;
    this.hopT = Math.random() * 1.2;
    this.face = Math.random() < 0.5 ? -1 : 1;
  }

  update(dt) {
    this.t += dt;
    this.tickHurt(dt);
    this.hopT -= dt;
    if (this.onGround && this.hopT <= 0) {
      this.vy = -180;
      this.hopT = 1.1 + Math.random() * 0.5;
      this.onGround = false;
      this.g.fx.dust(this.cx, this.y + this.h, 0);
    }
    if (this.onGround) {
      this.vx *= Math.pow(0.8, dt * 60);
      moveX(this, this.g.level, this.vx * dt);
    } else {
      this.patrol(dt, 44);
    }
    this.fall(dt);
  }

  draw(ctx, cam) {
    const art = this.g.art.slime;
    let idx = 0;
    if (!this.onGround) idx = this.vy < 0 ? 2 : 3;
    else idx = this.hopT < 0.18 ? 1 : 0;
    drawSprite(ctx, cam, art, idx, this.x, this.y, this.face > 0, this.flashing);
  }
}

export class Bat extends Enemy {
  constructor(g, cx, feetY) {
    super(g, cx - 7, feetY - 12, 14, 12);
    this.hp = this.maxHp = 1;
    this.score = 200;
    this.gore = [C.batL, C.bat, C.batD];
    this.homeX = this.x;
    this.homeY = this.y;
    this.state = 'hover';
    this.phase = Math.random() * Math.PI * 2;
    this.cool = 0;
  }

  update(dt) {
    this.t += dt;
    this.tickHurt(dt);
    const p = this.g.player;
    this.cool -= dt;

    if (this.state === 'hover') {
      this.x = this.homeX + Math.sin(this.t * 1.6 + this.phase) * 26;
      this.y = this.homeY + Math.sin(this.t * 2.7 + this.phase) * 9;
      if (p && !p.dead && this.cool <= 0) {
        const dx = p.cx - this.cx;
        const dy = p.cy - this.cy;
        if (Math.abs(dx) < 74 && dy > -8 && dy < 130) {
          this.state = 'dive';
          const d = Math.max(1, Math.hypot(dx, dy));
          this.vx = (dx / d) * 190;
          this.vy = (dy / d) * 190;
          this.g.sound.sfx('shoot');
        }
      }
      this.face = p && p.cx < this.cx ? -1 : 1;
    } else if (this.state === 'dive') {
      const hitX = moveX(this, this.g.level, this.vx * dt);
      const hitY = moveY(this, this.g.level, this.vy * dt);
      if (hitX || hitY) {
        this.state = 'return';
        this.g.fx.dust(this.cx, this.cy);
      }
      if (this.t % 0.08 < dt) this.g.fx.trail(this.cx, this.cy, C.batD);
    } else {
      const dx = this.homeX - this.x;
      const dy = this.homeY - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 4) { this.state = 'hover'; this.cool = 1.1; this.vx = this.vy = 0; }
      else { this.x += (dx / d) * 110 * dt; this.y += (dy / d) * 110 * dt; }
      this.face = dx < 0 ? -1 : 1;
    }
  }

  draw(ctx, cam) {
    const art = this.g.art.bat;
    const speed = this.state === 'dive' ? 22 : 12;
    const idx = Math.floor(this.t * speed) % art.frames.length;
    drawSprite(ctx, cam, art, idx, this.x, this.y, this.face > 0, this.flashing);
  }
}

export class Knight extends Enemy {
  constructor(g, cx, feetY) {
    super(g, cx - 7, feetY - 22, 14, 22);
    this.hp = this.maxHp = 4;
    this.score = 400;
    this.gore = [C.steelL, C.steel, C.emberL];
    this.state = 'walk';
    this.timer = 0;
  }

  /** The shield eats anything that arrives from the front. */
  hurt(amount, dir, source) {
    const fromFront = source === 'whip' && dir === -this.face;
    if (fromFront && this.state !== 'stun') {
      this.g.sound.sfx('block');
      this.g.fx.burst(this.cx + this.face * 9, this.cy - 2, 6, {
        speed: 110, dir: this.face > 0 ? -0.6 : Math.PI + 0.6, spread: 1.2,
        life: 0.3, color: [C.white, C.steelL], size: 2,
      });
      this.g.fx.shake(1.6, 0.1);
      this.g.fx.text(this.cx, this.y - 6, 'CLANG', C.steelL, { life: 0.5, vy: -18 });
      return false;
    }
    return super.hurt(amount, dir, source);
  }

  update(dt) {
    this.t += dt;
    this.tickHurt(dt);
    this.timer -= dt;
    const p = this.g.player;

    if (this.state === 'stun') {
      this.vx *= Math.pow(0.85, dt * 60);
      moveX(this, this.g.level, this.vx * dt);
      if (this.timer <= 0) this.state = 'walk';
    } else if (this.state === 'charge') {
      this.vx = this.face * 132;
      if (moveX(this, this.g.level, this.vx * dt)) { this.state = 'walk'; this.face *= -1; }
      if (this.timer <= 0) this.state = 'walk';
      if (this.t % 0.1 < dt) this.g.fx.dust(this.cx, this.y + this.h, -this.face);
    } else {
      this.patrol(dt, 38);
      if (p && !p.dead && this.timer <= 0) {
        const dx = p.cx - this.cx;
        if (Math.sign(dx) === this.face && Math.abs(dx) < 92 && Math.abs(p.cy - this.cy) < 30) {
          this.state = 'charge';
          this.timer = 1.0;
          this.g.sound.sfx('charge');
        }
      }
    }
    this.fall(dt);
  }

  draw(ctx, cam) {
    const art = this.g.art.knight;
    const speed = this.state === 'charge' ? 18 : 7;
    const idx = this.state === 'stun' ? 0 : Math.floor(this.t * speed) % art.frames.length;
    drawSprite(ctx, cam, art, idx, this.x, this.y, this.face > 0, this.flashing);
  }
}

export class Turret extends Enemy {
  constructor(g, cx, feetY) {
    super(g, cx - 9, feetY - 20, 18, 20);
    this.hp = this.maxHp = 3;
    this.score = 300;
    this.gore = [C.steelL, C.steel, C.steelD];
    this.cool = 1.2;
    this.charge = 0;
    this.stompable = false;
  }

  update(dt) {
    this.t += dt;
    this.tickHurt(dt);
    this.fall(dt);
    const p = this.g.player;
    if (!p || p.dead) return;

    this.face = p.cx < this.cx ? -1 : 1;
    const dx = Math.abs(p.cx - this.cx);
    const dy = Math.abs(p.cy - this.cy);
    this.cool -= dt;

    if (dx < 190 && dy < 46) {
      if (this.cool <= 0.55 && this.charge === 0) {
        this.charge = 1;
        this.g.sound.sfx('charge');
      }
      if (this.cool <= 0) {
        this.cool = 1.9;
        this.charge = 0;
        const sx = this.cx + this.face * 12;
        const sy = this.y + 8;
        this.g.spawn(new Shot(this.g, sx, sy, this.face * 150, 0));
        this.g.sound.sfx('shoot');
        this.g.fx.burst(sx, sy, 5, { speed: 70, dir: this.face > 0 ? 0 : Math.PI, spread: 0.8, life: 0.25, color: [C.emberL, C.ember] });
      }
    } else {
      this.charge = 0;
      this.cool = Math.max(this.cool, 0.7);
    }
  }

  draw(ctx, cam) {
    const art = this.g.art.turret;
    const idx = this.charge ? (1 + Math.floor(this.t * 14) % 3) : 0;
    drawSprite(ctx, cam, art, idx, this.x, this.y, this.face > 0, this.flashing);
  }
}

/* ------------------------------------------------------------------ boss   */

export class Boss extends Enemy {
  constructor(g, cx, feetY) {
    super(g, cx - 24, feetY - 44, 48, 44);
    this.hp = this.maxHp = 30;
    this.score = 5000;
    this.contactDamage = 1;
    this.gore = [C.magenta, C.steelL, C.white];
    this.stompable = false;
    this.homeY = this.y;
    this.state = 'enter';
    this.timer = 1.6;
    this.shots = 0;
    this.dying = 0;
    this.arenaMin = Math.max(0, this.x - 150);
    this.arenaMax = Math.min(g.level.pixelW - this.w, this.x + 150);
    this.dir = 1;
  }

  get phase() {
    const k = this.hp / this.maxHp;
    return k > 0.6 ? 1 : k > 0.3 ? 2 : 3;
  }

  hurt(amount, dir, source) {
    if (this.dying || this.dead) return false;
    if (this.hurtT > 0.05) return false;
    this.hp -= amount;
    this.hurtT = 0.2;
    this.g.sound.sfx('bossHit');
    this.g.fx.impact(this.cx + (dir > 0 ? -14 : 14), this.cy, [C.white, C.magenta], false);
    if (this.hp <= 0) this.beginDeath();
    return true;
  }

  beginDeath() {
    this.dying = 2.6;
    this.state = 'dying';
    this.g.sound.sfx('bossDie');
    this.g.sound.music(null);
    this.g.fx.shake(6, 2.4);
  }

  update(dt) {
    this.t += dt;
    this.tickHurt(dt);
    const p = this.g.player;

    if (this.state === 'dying') {
      this.dying -= dt;
      this.y += 14 * dt;
      if (this.t % 0.16 < dt) {
        const ex = this.x + Math.random() * this.w;
        const ey = this.y + Math.random() * this.h;
        this.g.fx.burst(ex, ey, 12, { speed: 140, life: 0.6, g: 120, color: [C.emberL, C.ember, C.white] });
        this.g.fx.ring(ex, ey, 20, C.white, 0.3);
        this.g.fx.flash('#ffffff', 0.35, 6);
      }
      if (this.dying <= 0) {
        this.dead = true;
        this.g.fx.flash('#ffffff', 0.9, 1.6);
        this.g.bossDefeated(this);
      }
      return;
    }

    this.timer -= dt;
    const ph = this.phase;

    switch (this.state) {
      case 'enter':
        this.y = this.homeY - 60 + Math.min(60, (1.6 - Math.max(0, this.timer)) * 40);
        if (this.timer <= 0) { this.state = 'drift'; this.timer = 1.4; }
        break;

      case 'drift': {
        this.x += this.dir * (34 + ph * 12) * dt;
        if (this.x < this.arenaMin) { this.x = this.arenaMin; this.dir = 1; }
        if (this.x > this.arenaMax) { this.x = this.arenaMax; this.dir = -1; }
        this.y = this.homeY + Math.sin(this.t * 1.4) * 7;
        if (this.timer <= 0) {
          this.state = Math.random() < (ph >= 3 ? 0.65 : ph >= 2 ? 0.55 : 0.4) ? 'slamUp' : 'shoot';
          this.timer = this.state === 'shoot' ? 0.35 : 0.7;
          this.shots = ph >= 3 ? 5 : ph >= 2 ? 4 : 3;
          if (this.state === 'slamUp') this.g.sound.sfx('charge');
        }
        break;
      }

      case 'shoot': {
        this.y = this.homeY + Math.sin(this.t * 1.4) * 7;
        if (this.timer <= 0) {
          this.shots--;
          const tx = p ? p.cx : this.cx;
          const ty = p ? p.cy : this.cy + 60;
          const a = Math.atan2(ty - (this.y + 32), tx - this.cx) + (Math.random() - 0.5) * 0.35;
          const sp = 150 + ph * 22;
          this.g.spawn(new Shot(this.g, this.cx, this.y + 32, Math.cos(a) * sp, Math.sin(a) * sp, { big: ph >= 3 }));
          this.g.sound.sfx('shoot');
          this.timer = 0.22;
          if (this.shots <= 0) { this.state = 'drift'; this.timer = 1.1 - ph * 0.15; }
        }
        break;
      }

      case 'slamUp':
        this.y -= 90 * dt;
        if (p) this.x += Math.sign(p.cx - this.cx) * 120 * dt;
        this.x = Math.max(this.arenaMin, Math.min(this.arenaMax, this.x));
        if (this.timer <= 0) { this.state = 'slam'; this.vy = 0; }
        break;

      case 'slam': {
        this.vy = Math.min(600, this.vy + 1800 * dt);
        this.y += this.vy * dt;
        const floor = this.g.level.pixelH - 3 * TS - this.h;
        if (this.y >= floor) {
          this.y = floor;
          this.state = 'recover';
          this.timer = 0.85;
          this.g.fx.shake(7, 0.45);
          this.g.fx.flash('#ffffff', 0.3, 6);
          this.g.sound.sfx('bossHit');
          for (const s of [-1, 1]) {
            this.g.fx.burst(this.cx + s * 24, this.y + this.h, 14, {
              speed: 190, dir: s > 0 ? -0.5 : Math.PI + 0.5, spread: 1.1,
              life: 0.5, g: 320, color: [C.steelL, C.white, C.magenta],
            });
            this.g.spawn(new Shot(this.g, this.cx + s * 26, this.y + this.h - 6, s * 165, -140, { gravityScale: 0.7, life: 2.2 }));
          }
          if (p && !p.dead && p.onGround) p.stagger();
        }
        break;
      }

      case 'recover':
        if (this.timer <= 0) {
          this.state = 'rise';
          this.timer = 1.1;
        }
        break;

      case 'rise':
        this.y -= 120 * dt;
        if (this.y <= this.homeY) { this.y = this.homeY; this.state = 'drift'; this.timer = 0.9; }
        break;

      default:
        this.state = 'drift';
        break;
    }
  }

  draw(ctx, cam) {
    const art = this.g.art.boss;
    const idx = Math.floor(this.t * 9) % art.frames.length;
    const face = this.g.player && this.g.player.cx < this.cx ? -1 : 1;
    drawSprite(ctx, cam, art, idx, this.x, this.y, face > 0, this.flashing || this.state === 'dying');
  }
}

export const ENEMY_CLASSES = { slime: Slime, bat: Bat, knight: Knight, turret: Turret, boss: Boss };
