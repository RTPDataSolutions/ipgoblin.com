/**
 * main.js - GOBLIN HOARD.
 *
 * Boots the art, owns the game state machine and runs a fixed-timestep loop.
 * Rendering happens into a 384x216 buffer that is scaled up by whole numbers
 * only, so the pixel grid never breaks.
 */

import { buildArt, buildHudIcons, C } from './art.js';
import { buildTiles } from './tiles.js';
import { Font } from './font.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Fx } from './fx.js';
import { Hud } from './hud.js';
import { Level } from './level.js';
import { LEVELS } from './levels.js';
import { Player } from './player.js';
import { Pickup, Chest, Door, ENEMY_CLASSES } from './entities.js';

const VIEW_W = 384;
const VIEW_H = 216;
const STEP = 1 / 60;
const STORE_BEST = 'goblin-hoard.best';
const STORE_MUTE = 'goblin-hoard.muted';

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* private mode */ }
  },
};

class Game {
  constructor() {
    this.canvas = document.getElementById('screen');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.viewW = VIEW_W;
    this.viewH = VIEW_H;

    this.font = new Font();
    this.art = buildArt();
    this.icons = buildHudIcons();
    this.tilesets = buildTiles(VIEW_W, VIEW_H);
    this.hud = new Hud(this.font, this.icons);
    this.fx = new Fx(this.font);
    this.sound = new Sound();
    this.input = new Input(document.getElementById('shell'));
    this.input.bindScreenTap(this.canvas);
    this.input.onMute = () => this.toggleSound();

    this.cam = { x: 0, y: 0 };
    this.entities = [];
    this.time = 0;
    this.state = 'title';
    this.best = parseInt(store.get(STORE_BEST, '0'), 10) || 0;
    this.totalLevels = LEVELS.length;
    this.hint = '';
    this.hintT = 0;
    this.clearBonus = 0;
    this.newBest = false;
    this.boss = null;

    this.sound.setEnabled(store.get(STORE_MUTE, '0') !== '1');

    this.resetRun();
    this.buildTitleScene();
    this.bindChrome();
    this.resize();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));

    // The audio context can only start from a genuine user gesture.
    const unlock = () => {
      this.sound.unlock();
      if (this.state === 'title') this.sound.music('title');
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });

    this.last = performance.now();
    this.acc = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  /* ---------------------------------------------------------------- setup */

  bindChrome() {
    const soundBtn = document.getElementById('btn-sound');
    const fullBtn = document.getElementById('btn-full');
    this.soundBtn = soundBtn;
    this.syncSoundBtn();
    soundBtn.addEventListener('click', () => { this.sound.unlock(); this.toggleSound(); soundBtn.blur(); });
    fullBtn.addEventListener('click', () => {
      const shell = document.getElementById('shell');
      if (document.fullscreenElement) document.exitFullscreen();
      else shell.requestFullscreen?.();
      fullBtn.blur();
    });

    const touch = document.getElementById('touch');
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (coarse) {
      touch.hidden = false;
      touch.removeAttribute('aria-hidden');
      this.input.usedTouch = true;
    }
    this.touchEl = touch;
  }

  toggleSound() {
    const on = !this.sound.enabled;
    this.sound.setEnabled(on);
    store.set(STORE_MUTE, on ? '0' : '1');
    this.syncSoundBtn();
  }

  syncSoundBtn() {
    if (!this.soundBtn) return;
    const on = this.sound.enabled;
    this.soundBtn.textContent = on ? '\u266B sound on' : '\u266B sound off';
    this.soundBtn.setAttribute('aria-pressed', String(on));
  }

  /** Scale the canvas to fill the window, integer-only once it is large. */
  resize() {
    const chrome = 70;
    const availW = Math.max(160, window.innerWidth - 16);
    const availH = Math.max(120, window.innerHeight - chrome);
    let scale = Math.min(availW / VIEW_W, availH / VIEW_H);
    // Whole-number scaling keeps every pixel square, but on small screens
    // rounding 1.9 down to 1 would waste half the display, so below 2x the
    // canvas is allowed to fill the space instead.
    scale = scale >= 2 ? Math.floor(scale) : Math.max(0.35, scale);
    this.canvas.style.width = `${Math.round(VIEW_W * scale)}px`;
    this.canvas.style.height = `${Math.round(VIEW_H * scale)}px`;
  }

  /* ----------------------------------------------------------- run state  */

  resetRun() {
    this.score = 0;
    this.loot = 0;
    this.lives = 3;
    this.combo = 0;
    this.comboT = 0;
    this.newBest = false;
    this.levelIndex = 0;
  }

  buildTitleScene() {
    this.titleTileset = this.tilesets[0];
    this.titleCam = { x: 0, y: 40 };
    this.titlePose = 'idle';
    this.titlePoseT = 0;
  }

  startRun() {
    this.resetRun();
    this.startLevel(0);
  }

  startLevel(index) {
    this.levelIndex = index;
    this.levelDef = LEVELS[index];
    this.level = new Level(this.levelDef);
    this.tileset = this.tilesets[this.levelDef.theme];
    this.entities = [];
    this.boss = null;
    this.fx.reset();
    this.combo = 0;
    this.comboT = 0;

    const spawn = this.level.playerSpawn;
    this.player = new Player(this, spawn.x, spawn.y);
    this.safeSpot = { x: spawn.x, y: spawn.y };
    this.safeT = 0;

    for (const s of this.level.spawns) this.spawnFromMarker(s);

    this.cam.x = Math.max(0, Math.min(this.level.pixelW - VIEW_W, this.player.cx - VIEW_W / 2));
    this.cam.y = Math.max(0, Math.min(this.level.pixelH - VIEW_H, this.player.cy - VIEW_H / 2));

    this.state = 'intro';
    this.introT = 2.1;
    this.sound.music(this.levelDef.music);

    this.hint = '';
    this.hintT = 0;
    if (index === 0) this.showHint(this.input.usedTouch ? 'TAP THE DIAMOND TO WHIP' : 'PRESS X TO WHIP', 4.5);
    else if (index === 1) this.showHint('JUMP TWICE TO FLUTTER', 3.5);
    else if (index === 2) this.showHint('SHIELDS BLOCK THE FRONT - GO OVER OR BEHIND', 4.5);
    else if (index === 3) this.showHint('HIT IT WHEN IT COMES DOWN', 4);
  }

  spawnFromMarker(s) {
    if (s.kind === 'chest') { this.entities.push(new Chest(this, s.x, s.y)); return; }
    if (s.kind === 'door') { this.entities.push(new Door(this, s.x, s.y)); return; }
    if (s.kind in ENEMY_CLASSES) {
      const e = new ENEMY_CLASSES[s.kind](this, s.x, s.y);
      if (s.kind === 'boss') this.boss = e;
      this.entities.push(e);
      return;
    }
    this.entities.push(new Pickup(this, s.kind, s.x, s.y));
  }

  spawn(e) { this.entities.push(e); }

  showHint(text, seconds) {
    this.hint = text;
    this.hintT = seconds;
  }

  /* --------------------------------------------------------- game events  */

  addScore(n) {
    this.score += Math.round(n);
    if (this.score > this.best) {
      this.best = this.score;
      if (this.state !== 'title') this.newBest = true;
    }
  }

  killed(enemy, dir) {
    this.combo++;
    this.comboT = 2.4;
    const mult = 1 + (this.combo - 1) * 0.35;
    const points = Math.round(enemy.score * mult);
    this.addScore(points);
    this.fx.text(enemy.cx, enemy.y - 2, `${points}`, this.combo >= 3 ? C.emberL : C.goldL);
    if (this.combo >= 3) this.fx.flash(C.goldL, 0.12, 8);
  }

  onPlayerDied() {
    this.deathHold = 1.5;
    this.combo = 0;
    this.sound.music(null);
  }

  respawnPlayer() {
    this.lives--;
    if (this.lives <= 0) {
      this.state = 'gameover';
      this.commitBest();
      this.sound.music('defeat');
      return;
    }
    // Clear anything in flight so the goblin does not land in a bullet.
    this.entities = this.entities.filter((e) => !(e.constructor && e.constructor.name === 'Shot'));
    this.player.respawn(this.safeSpot.x, this.safeSpot.y);
    this.fx.flash('#ffffff', 0.35, 5);
    this.sound.music(this.levelDef.music);
    this.state = 'play';
  }

  completeLevel() {
    if (this.state !== 'play') return;
    this.state = 'clear';
    this.clearT = 2.2;
    this.clearBonus = 1000 + this.player.health * 150 + this.lives * 250;
    this.addScore(this.clearBonus);
    this.sound.sfx('door');
    this.sound.music(null);
    this.fx.flash('#ffffff', 0.5, 2.5);
  }

  bossDefeated(boss) {
    this.addScore(boss.score);
    this.fx.text(boss.cx, boss.cy, `${boss.score}`, C.goldL, { scale: 2, life: 1.6 });
    const door = new Door(this, boss.cx, this.level.pixelH - 3 * 16);
    this.entities.push(door);
    this.showHint('THE WAY OUT IS OPEN', 4);
    this.sound.music('victory');
  }

  commitBest() {
    if (this.score >= this.best) {
      this.best = this.score;
      store.set(STORE_BEST, this.best);
    }
  }

  /* ------------------------------------------------------------ main loop */

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let delta = (now - this.last) / 1000;
    this.last = now;
    if (delta > 0.25) delta = 0.25;      // tab was in the background
    this.acc += delta;

    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.update(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === 5) this.acc = 0;
    this.draw();
  }

  update(dt) {
    this.time += dt;
    this.input.poll();

    switch (this.state) {
      case 'title':
        this.titleCam.x += 14 * dt;
        this.titlePoseT += dt;
        if (this.titlePose === 'attack' && this.titlePoseT > 0.34) {
          this.titlePose = 'idle';
          this.titlePoseT = 0;
        } else if (this.titlePose === 'idle' && this.titlePoseT > 3.2) {
          this.titlePose = 'attack';
          this.titlePoseT = 0;
          this.fx.sparkle(30, 176, [C.goldL, C.white]);
        }
        this.fx.update(dt);
        if (this.input.confirmPressed()) {
          this.sound.unlock();
          this.sound.sfx('select');
          this.startRun();
        }
        break;

      case 'intro':
        this.introT -= dt;
        this.fx.update(dt);
        if (this.introT <= 0 || this.input.confirmPressed()) this.state = 'play';
        break;

      case 'play':
        this.updatePlay(dt);
        break;

      case 'paused':
        if (this.input.pressed('pause') || this.input.pressed('start')) {
          this.state = 'play';
          this.sound.sfx('pause');
          this.sound.music(this.levelDef.music);
        }
        break;

      case 'clear':
        this.updateWorld(dt, true);
        this.clearT -= dt;
        if (this.clearT <= 0) {
          if (this.levelIndex + 1 >= LEVELS.length) {
            this.state = 'victory';
            this.commitBest();
            this.sound.music('victory');
          } else {
            this.startLevel(this.levelIndex + 1);
          }
        }
        break;

      case 'gameover':
      case 'victory':
        this.fx.update(dt);
        if (this.input.confirmPressed()) {
          this.sound.sfx('select');
          this.state = 'title';
          this.resetRun();
          this.sound.music('title');
        }
        break;

      default:
        break;
    }

    this.input.endFrame();
  }

  updatePlay(dt) {
    if (this.input.pressed('pause')) {
      this.state = 'paused';
      this.sound.sfx('pause');
      this.sound.music(null);
      return;
    }

    if (this.hintT > 0) this.hintT -= dt;

    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    if (this.player.dead) {
      this.deathHold -= dt;
      this.updateWorld(dt, true);
      if (this.deathHold <= 0) this.respawnPlayer();
      return;
    }

    this.updateWorld(dt, false);

    // Remember the last patch of safe ground to respawn on.
    this.safeT -= dt;
    const p = this.player;
    if (p.onGround && this.safeT <= 0 && !this.level.hazardInRect(p.x, p.y + p.h, p.w, 4)) {
      this.safeT = 0.35;
      this.safeSpot = { x: p.cx, y: p.y + p.h };
    }
  }

  /** Steps the world. `frozen` keeps effects running with the player idle. */
  updateWorld(dt, playerFrozen) {
    if (this.fx.freeze > 0) {
      this.fx.freeze -= dt;
      this.fx.update(dt);
      this.updateCamera(dt);
      return;
    }

    if (!playerFrozen) this.player.update(dt, this.input);
    else this.player.update(dt, this.input);

    const n = this.entities.length;
    for (let i = 0; i < n; i++) {
      const e = this.entities[i];
      if (e.dead) continue;
      if (e.active === false && e.isEnemy) continue;
      e.update(dt);
    }
    if (this.entities.some((e) => e.dead)) {
      this.entities = this.entities.filter((e) => !e.dead);
    }

    this.fx.update(dt);
    this.updateCamera(dt);
  }

  updateCamera(dt) {
    const p = this.player;
    if (!p) return;
    const lookAhead = this.boss && !this.boss.dead ? 0 : p.face * 26;
    const tx = p.cx + lookAhead - VIEW_W / 2;
    const ty = p.cy - VIEW_H / 2 + 14;
    const kx = 1 - Math.pow(0.0001, dt);
    const ky = 1 - Math.pow(0.002, dt);
    this.cam.x += (tx - this.cam.x) * kx;
    this.cam.y += (ty - this.cam.y) * ky;
    this.cam.x = Math.max(0, Math.min(this.level.pixelW - VIEW_W, this.cam.x));
    this.cam.y = Math.max(0, Math.min(this.level.pixelH - VIEW_H, this.cam.y));
  }

  /* ---------------------------------------------------------------- draw  */

  draw() {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;

    if (this.state === 'title') {
      this.drawTitle(ctx);
      return;
    }

    const shakeX = Math.round(this.fx.shakeX);
    const shakeY = Math.round(this.fx.shakeY);
    const cam = { x: Math.round(this.cam.x) + shakeX, y: Math.round(this.cam.y) + shakeY };

    this.level.drawBackground(ctx, cam, this.tileset, VIEW_W, VIEW_H);
    this.level.draw(ctx, cam, this.tileset, this.time, VIEW_W, VIEW_H);

    // Props and pickups, then enemies, then shots, so nothing important hides.
    this.drawLayer(ctx, cam, (e) => e instanceof Door || e instanceof Chest);
    this.drawLayer(ctx, cam, (e) => e instanceof Pickup);
    this.drawLayer(ctx, cam, (e) => e.isEnemy);
    if (this.player) this.player.draw(ctx, cam);
    this.drawLayer(ctx, cam, (e) => !e.isEnemy && !(e instanceof Pickup) && !(e instanceof Door) && !(e instanceof Chest));

    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    this.fx.draw(ctx);
    ctx.restore();
    this.fx.drawText(ctx, cam.x, cam.y);

    this.fx.drawFlash(ctx, VIEW_W, VIEW_H);
    this.hud.draw(ctx, this);

    if (this.state === 'intro') this.hud.levelIntro(ctx, this);
    else if (this.state === 'paused') this.hud.pause(ctx, this);
    else if (this.state === 'clear') this.hud.levelClear(ctx, this);
    else if (this.state === 'gameover') this.hud.gameOver(ctx, this);
    else if (this.state === 'victory') this.hud.victory(ctx, this);
  }

  drawLayer(ctx, cam, test) {
    for (const e of this.entities) {
      if (e.dead || !test(e)) continue;
      e.draw(ctx, cam);
    }
  }

  drawTitle(ctx) {
    const ts = this.titleTileset;
    ctx.drawImage(ts.sky, 0, 0);
    for (const layer of ts.layers) {
      const lw = layer.img.width;
      let ox = -(this.titleCam.x * layer.speed) % lw;
      if (ox > 0) ox -= lw;
      for (let x = Math.round(ox); x < VIEW_W; x += lw) ctx.drawImage(layer.img, x, 0);
    }
    // a ledge along the bottom for the goblin to stand on
    for (let x = 0; x < VIEW_W; x += 16) {
      ctx.drawImage(ts.solid[1], x, VIEW_H - 32);
      ctx.drawImage(ts.solid[0], x, VIEW_H - 16);
    }
    this.hud.titleGoblin(ctx, this);
    // a coin the goblin is clearly thinking about
    const coin = this.art.coin;
    const ci = Math.floor(this.time * 9) % coin.frames.length;
    ctx.drawImage(coin.frames[ci].r, 352, 172 + Math.round(Math.sin(this.time * 3) * 2));
    this.hud.title(ctx, this);
    this.fx.drawFlash(ctx, VIEW_W, VIEW_H);
  }
}

function boot() {
  try {
    window.goblinHoard = new Game();
  } catch (err) {
    console.error(err);
    const c = document.getElementById('screen');
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0d1408';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#8ede4f';
    ctx.font = '10px monospace';
    ctx.fillText('The goblin tripped over something:', 12, 28);
    ctx.fillText(String(err && err.message ? err.message : err).slice(0, 60), 12, 44);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
