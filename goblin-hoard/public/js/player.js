/**
 * player.js - the goblin.
 *
 * Movement is tuned around the level geometry: roughly 2.6 tiles of jump
 * height and 4.5 tiles of distance, doubled by the mid-air flutter. Coyote
 * time and jump buffering are what stop the controls feeling brittle.
 */

import { TS } from './tiles.js';
import { C } from './art.js';
import { Entity, moveX, moveY, overlaps, drawSprite } from './entities.js';

const RUN_MAX = 158;
const RUN_ACCEL = 1250;
const AIR_ACCEL = 780;
const FRICTION = 1500;
const AIR_DRAG = 260;
const JUMP_VEL = 342;
const FLUTTER_VEL = 296;
const GRAVITY = 1500;
const GRAVITY_APEX = 1080;      // lighter near the top of a jump
const GRAVITY_FALL = 1750;
const MAX_FALL = 430;
const COYOTE = 0.1;
const BUFFER = 0.13;

const WINDUP = 0.07;
const ACTIVE = 0.11;
const RECOVER = 0.15;
const ATTACK_TOTAL = WINDUP + ACTIVE + RECOVER;

export class Player extends Entity {
  constructor(g, cx, feetY) {
    super(g, cx - 6, feetY - 20, 12, 20);
    this.maxHealth = 4;
    this.health = 4;
    this.face = 1;
    this.onGround = false;
    this.coyote = 0;
    this.buffer = 0;
    this.jumps = 0;
    this.maxJumps = 2;
    this.attackT = 0;
    this.attackCool = 0;
    this.hitSet = new Set();
    this.invuln = 0;
    this.hurtT = 0;
    this.staggerT = 0;
    this.dead = false;
    this.deathT = 0;
    this.anim = 0;
    this.runPhase = 0;
    this.crouching = false;
    this.stepT = 0;
    this.enteringDoor = false;
  }

  respawn(cx, feetY) {
    this.x = cx - this.w / 2;
    this.y = feetY - this.h;
    this.vx = this.vy = 0;
    this.dead = false;
    this.deathT = 0;
    this.invuln = 1.4;
    this.hurtT = 0;
    this.staggerT = 0;
    this.attackT = 0;
    this.health = this.maxHealth;
    this.jumps = 0;
    this.enteringDoor = false;
  }

  get attacking() { return this.attackT > 0; }

  get attackPhase() {
    const e = ATTACK_TOTAL - this.attackT;
    if (e < WINDUP) return 'windup';
    if (e < WINDUP + ACTIVE) return 'active';
    return 'recover';
  }

  heal(n) {
    this.health = Math.min(this.maxHealth, this.health + n);
    this.g.fx.sparkle(this.cx, this.cy, [C.tunicL, C.white]);
  }

  stagger() {
    if (this.invuln > 0 || this.dead) return;
    this.staggerT = 0.35;
    this.vy = -140;
    this.g.fx.shake(2, 0.15);
  }

  hurt(amount, dir) {
    if (this.invuln > 0 || this.dead || this.g.state !== 'play') return;
    this.health -= amount;
    this.g.combo = 0;
    this.invuln = 1.25;
    this.hurtT = 0.4;
    this.vx = -dir * 150;
    this.vy = -210;
    this.onGround = false;
    this.g.fx.impact(this.cx, this.cy, [C.tunicL, C.white, C.eyeP], true);
    this.g.fx.flash('#c2452e', 0.4, 5);
    this.g.fx.shake(4, 0.3);
    if (this.health <= 0) this.die();
    else this.g.sound.sfx('hurt');
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    this.health = 0;
    this.vy = -300;
    this.vx = -this.face * 60;
    this.g.sound.sfx('die');
    this.g.fx.gore(this.cx, this.cy, [C.skinL, C.skin, C.tunic]);
    this.g.fx.shake(5, 0.5);
    this.g.onPlayerDied();
  }

  /* ------------------------------------------------------------- updating */

  update(dt, input) {
    this.t += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.staggerT > 0) this.staggerT -= dt;
    if (this.attackCool > 0) this.attackCool -= dt;

    if (this.dead) {
      this.deathT += dt;
      this.vy = Math.min(MAX_FALL, this.vy + GRAVITY * dt);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vx *= Math.pow(0.96, dt * 60);
      return;
    }

    const locked = this.staggerT > 0 || this.enteringDoor;
    const axis = locked ? 0 : input.axis;
    this.crouching = !locked && this.onGround && input.down('down') && Math.abs(this.vx) < 30;

    /* --- horizontal --- */
    const accel = this.onGround ? RUN_ACCEL : AIR_ACCEL;
    if (axis !== 0) {
      this.vx += axis * accel * dt;
      this.vx = Math.max(-RUN_MAX, Math.min(RUN_MAX, this.vx));
      if (!this.attacking) this.face = axis;
    } else {
      const drag = (this.onGround ? FRICTION : AIR_DRAG) * dt;
      if (Math.abs(this.vx) <= drag) this.vx = 0;
      else this.vx -= Math.sign(this.vx) * drag;
    }
    // Swinging the whip plants the goblin's feet a bit.
    if (this.attacking && this.onGround) this.vx *= Math.pow(0.86, dt * 60);

    /* --- jumping --- */
    if (!locked && input.pressed('jump')) this.buffer = BUFFER;
    if (this.buffer > 0) this.buffer -= dt;
    if (this.coyote > 0) this.coyote -= dt;

    const wantDrop = input.down('down');
    if (this.buffer > 0) {
      if (this.onGround && wantDrop && this.onPlatformOnly()) {
        // Down + jump drops through a one-way platform.
        this.buffer = 0;
        this.y += 2;
        this.onGround = false;
        this.coyote = 0;
        this.dropTimer = 0.14;
        this.g.sound.sfx('land');
      } else if (this.onGround || this.coyote > 0) {
        this.doJump(JUMP_VEL, false);
      } else if (this.jumps < this.maxJumps) {
        this.doJump(FLUTTER_VEL, true);
      }
    }
    // Releasing jump early cuts the arc short.
    if (this.vy < -60 && !input.down('jump')) this.vy += 1500 * dt;

    /* --- attacking --- */
    if (!locked && input.pressed('attack') && this.attackCool <= 0) {
      this.attackT = ATTACK_TOTAL;
      this.attackCool = ATTACK_TOTAL + 0.06;
      this.hitSet.clear();
      this.g.sound.sfx('whip');
    }
    if (this.attackT > 0) {
      this.attackT -= dt;
      if (this.attackPhase === 'active') this.swingHitbox();
      if (this.attackT <= 0) this.hitSet.clear();
    }

    /* --- gravity and movement --- */
    let gScale = GRAVITY;
    if (this.vy < 0) gScale = GRAVITY;
    else if (Math.abs(this.vy) < 46) gScale = GRAVITY_APEX;
    else gScale = GRAVITY_FALL;
    this.vy = Math.min(MAX_FALL, this.vy + gScale * dt);

    if (this.dropTimer > 0) this.dropTimer -= dt;

    moveX(this, this.g.level, this.vx * dt);
    const wasAir = !this.onGround;
    const res = moveY(this, this.g.level, this.vy * dt, {
      platforms: true,
      dropThrough: this.dropTimer > 0,
    });

    if (res === 'ground') {
      if (wasAir && this.vy > 190) {
        this.g.fx.landPuff(this.cx, this.y + this.h);
        this.g.sound.sfx('land');
        this.g.fx.shake(Math.min(2.2, this.vy / 220), 0.1);
      }
      this.onGround = true;
      this.jumps = 0;
      this.coyote = COYOTE;
      this.vy = 0;
    } else {
      if (this.onGround) this.coyote = COYOTE;
      this.onGround = false;
      if (res === 'ceiling') this.vy = Math.max(this.vy, 30);
    }

    /* --- running dust and animation --- */
    if (this.onGround && Math.abs(this.vx) > 40) {
      this.runPhase += Math.abs(this.vx) * dt * 0.055;
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = 0.18;
        this.g.fx.dust(this.cx - this.face * 5, this.y + this.h, this.face);
      }
    } else {
      this.runPhase += dt * 3;
    }

    this.checkHazards();
    this.checkStomp();
    this.checkContact();

    if (this.y > this.g.level.pixelH + 40) this.die();
  }

  onPlatformOnly() {
    const ty = Math.floor((this.y + this.h + 1) / TS);
    const x0 = Math.floor(this.x / TS);
    const x1 = Math.floor((this.x + this.w - 1) / TS);
    let sawPlatform = false;
    for (let tx = x0; tx <= x1; tx++) {
      if (this.g.level.isSolid(tx, ty)) return false;
      if (this.g.level.isPlatform(tx, ty)) sawPlatform = true;
    }
    return sawPlatform;
  }

  doJump(vel, isFlutter) {
    this.vy = -vel;
    this.onGround = false;
    this.buffer = 0;
    this.coyote = 0;
    this.jumps = isFlutter ? this.maxJumps : 1;
    this.g.sound.sfx(isFlutter ? 'doubleJump' : 'jump');
    if (isFlutter) {
      this.g.fx.ring(this.cx, this.y + this.h - 2, 12, C.skinL, 0.22);
      this.g.fx.burst(this.cx, this.y + this.h - 2, 8, {
        speed: 80, life: 0.35, g: 120, color: [C.skinL, C.white], size: 2,
      });
    } else {
      this.g.fx.dust(this.cx, this.y + this.h, 0);
    }
  }

  /** The whip's active rectangle, and everything it connects with. */
  swingHitbox() {
    const reach = 30;
    // Tall box: the swing visually starts overhead and comes down, so it has
    // to reach flyers, not just whatever is standing at foot level.
    const box = {
      x: this.face > 0 ? this.x + this.w - 2 : this.x - reach + 2,
      y: this.y - 14,
      w: reach,
      h: 34,
    };
    for (const e of this.g.entities) {
      if (e.dead || this.hitSet.has(e)) continue;
      if (e.isEnemy) {
        if (!overlaps(box, e)) continue;
        this.hitSet.add(e);
        const landed = e.hurt(1, this.face, 'whip');
        if (landed) {
          this.g.fx.hitstop(0.05);
          if (!this.onGround && this.vy > 0) this.vy = Math.min(this.vy, 120);
        }
      } else if (e instanceof Object && typeof e.hitByWhip === 'function') {
        if (!overlaps(box, e)) continue;
        this.hitSet.add(e);
        e.hitByWhip();
      }
    }
  }

  /** Falling onto an enemy's head damages it and bounces the goblin. */
  checkStomp() {
    if (this.vy <= 40 || this.invuln > 0.9) return;
    for (const e of this.g.entities) {
      if (e.dead || !e.isEnemy || !e.stompable) continue;
      const feet = this.y + this.h;
      const headBand = e.y + 10;
      if (feet < e.y - 2 || feet > headBand) continue;
      if (this.x + this.w < e.x + 2 || this.x > e.x + e.w - 2) continue;
      e.hurt(2, this.face, 'stomp');
      this.vy = -270;
      this.jumps = Math.min(this.jumps, 1);
      this.g.fx.impact(this.cx, e.y, [C.white, C.goldL], false);
      this.g.sound.sfx('hit');
      return;
    }
  }

  checkContact() {
    if (this.invuln > 0) return;
    for (const e of this.g.entities) {
      if (e.dead || !e.isEnemy || !e.contactDamage) continue;
      if (e.state === 'dying') continue;
      if (!overlaps(this, e)) continue;
      this.hurt(e.contactDamage, Math.sign(this.cx - e.cx) || 1);
      return;
    }
  }

  checkHazards() {
    const hz = this.g.level.hazardInRect(this.x + 2, this.y + 4, this.w - 4, this.h - 4);
    if (!hz) return;

    if (hz === 'lava') {
      // The rescue is unconditional: damage has i-frames, and without this the
      // goblin sinks straight through the lava and out of the world during
      // them. Knockback alone would also fling it back into what it touched.
      if (this.invuln <= 0) this.hurt(2, Math.sign(this.vx) || -this.face);
      const safe = this.g.safeSpot;
      if (safe) {
        this.x = safe.x - this.w / 2;
        this.y = safe.y - this.h;
        this.vx = 0;
        this.vy = 0;
        this.g.fx.burst(this.cx, this.cy, 10, { speed: 80, life: 0.4, g: -40, color: [C.skinL, C.white] });
      } else {
        this.vy = -360;
      }
      return;
    }

    if (this.invuln > 0) return;
    this.hurt(1, Math.sign(this.vx) || -this.face);
  }

  /* ------------------------------------------------------------- drawing  */

  currentFrames() {
    const art = this.g.art.goblin;
    if (this.dead) return [art.dead, 0];
    if (this.hurtT > 0.15) return [art.hurt, 0];
    if (this.attacking) {
      const p = this.attackPhase;
      return [art.attack, p === 'windup' ? 0 : p === 'active' ? 1 : 2];
    }
    if (!this.onGround) return this.vy < -20 ? [art.jump, 0] : [art.fall, 0];
    if (this.crouching) return [art.crouch, 0];
    if (Math.abs(this.vx) > 24) return [art.run, Math.floor(this.runPhase) % art.run.frames.length];
    return [art.idle, Math.floor(this.t * 3.5) % art.idle.frames.length];
  }

  draw(ctx, cam) {
    // Blink while invulnerable, but never while actually dying.
    if (this.invuln > 0 && !this.dead && Math.floor(this.invuln * 22) % 2 === 0) return;
    const [set, idx] = this.currentFrames();
    const flash = this.hurtT > 0.25;
    drawSprite(ctx, cam, set, idx, this.x, this.y, this.face > 0, flash);
    this.drawWhip(ctx, cam);
  }

  /** The whip is drawn as a chain of links sweeping through an arc. */
  drawWhip(ctx, cam) {
    if (!this.attacking) return;
    const phase = this.attackPhase;
    if (phase === 'windup') return;

    const elapsed = ATTACK_TOTAL - this.attackT - WINDUP;
    const k = Math.max(0, Math.min(1, elapsed / (phase === 'active' ? ACTIVE : ACTIVE + RECOVER)));
    const a0 = -2.15, a1 = 0.55;
    const ang = a0 + (a1 - a0) * k;
    const len = 30 * (phase === 'active' ? 1 : Math.max(0, 1 - (elapsed - ACTIVE) / RECOVER));
    if (len <= 1) return;

    const hx = this.cx + this.face * 4;
    const hy = this.y + 7;
    const N = 8;
    let tipX = hx, tipY = hy;
    for (let i = 1; i <= N; i++) {
      const f = i / N;
      const a = ang + f * 0.85;
      const px = hx + this.face * Math.cos(a) * len * f;
      const py = hy + Math.sin(a) * len * f;
      const size = i > N - 2 ? 2 : i > 3 ? 2 : 3;
      ctx.fillStyle = i > N - 2 ? C.goldL : i % 2 ? C.leather : C.leatherL;
      ctx.fillRect(Math.round(px - cam.x - size / 2), Math.round(py - cam.y - size / 2), size, size);
      tipX = px; tipY = py;
    }
    if (phase === 'active') {
      ctx.fillStyle = C.white;
      ctx.fillRect(Math.round(tipX - cam.x - 1), Math.round(tipY - cam.y - 1), 3, 3);
      if (Math.random() < 0.6) this.g.fx.trail(tipX, tipY, C.goldL);
    }
  }
}
