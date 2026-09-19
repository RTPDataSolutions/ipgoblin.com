/**
 * hud.js - the in-game HUD and every full-screen state (title, intro, pause,
 * game over, victory). All of it is drawn into the 384x216 buffer.
 */

import { C } from './art.js';
import { drawSprite } from './entities.js';

const W = 384;
const H = 216;

export class Hud {
  constructor(font, icons) {
    this.font = font;
    this.icons = icons;
  }

  panel(ctx, x, y, w, h, alpha = 0.78) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#0b1207';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.fillStyle = C.skinD;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillRect(x + w - 1, y, 1, h);
  }

  dim(ctx, alpha = 0.62) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#05080a';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /* ------------------------------------------------------------- in-game  */

  draw(ctx, g) {
    const f = this.font;
    const heart = g.art.heart.frames[0].r;

    for (let i = 0; i < g.player.maxHealth; i++) {
      const on = i < g.player.health;
      const x = 5 + i * 13;
      ctx.save();
      if (!on) ctx.globalAlpha = 0.25;
      else if (g.player.health === 1 && Math.floor(g.time * 6) % 2 === 0) ctx.globalAlpha = 0.55;
      ctx.drawImage(heart, x, 4);
      ctx.restore();
    }

    // lives
    ctx.drawImage(this.icons.head, 6, 19);
    f.draw(ctx, `*${g.lives}`, 19, 22, { color: C.skinL, shadow: '#000000' });

    // score
    f.draw(ctx, String(g.score).padStart(7, '0'), W - 5, 5, {
      color: C.goldL, align: 'right', shadow: '#000000',
    });

    // loot counter
    const coin = g.art.coin.frames[0].r;
    ctx.drawImage(coin, W - 62, 15);
    f.draw(ctx, `${g.loot}`, W - 5, 17, { color: C.gold, align: 'right', shadow: '#000000' });

    // combo
    if (g.combo >= 2) {
      const k = Math.min(1, g.comboT / 2.4);
      const bob = Math.sin(g.time * 14) * 1;
      f.draw(ctx, `${g.combo} CHAIN`, W / 2, 6 + bob, {
        color: g.combo >= 5 ? C.emberL : C.goldL, align: 'center', shadow: '#000000', scale: 1,
      });
      ctx.fillStyle = C.goldD;
      ctx.fillRect(W / 2 - 24, 15, 48, 1);
      ctx.fillStyle = C.goldL;
      ctx.fillRect(W / 2 - 24, 15, Math.round(48 * k), 1);
    }

    const bossVisible = g.boss && !g.boss.dead;
    if (bossVisible) this.bossBar(ctx, g);

    if (g.hintT > 0 && g.state === 'play') {
      const a = Math.min(1, g.hintT);
      ctx.save();
      ctx.globalAlpha = a;
      // The boss bar owns the bottom of the screen; get out of its way.
      f.draw(ctx, g.hint, W / 2, bossVisible ? 36 : H - 26, {
        color: C.skinL, align: 'center', shadow: '#000000',
      });
      ctx.restore();
    }
  }

  bossBar(ctx, g) {
    const w = 180;
    const x = (W - w) / 2;
    const y = H - 14;
    const k = Math.max(0, g.boss.hp / g.boss.maxHp);
    ctx.fillStyle = '#0b1207';
    ctx.fillRect(x - 2, y - 2, w + 4, 10);
    ctx.fillStyle = C.steelD;
    ctx.fillRect(x, y, w, 6);
    ctx.fillStyle = k > 0.3 ? C.magenta : C.ember;
    ctx.fillRect(x, y, Math.round(w * k), 6);
    ctx.fillStyle = C.white;
    ctx.fillRect(x, y, Math.round(w * k), 1);
    this.font.draw(ctx, 'THE ROOT DAEMON', W / 2, y - 11, {
      color: C.magenta, align: 'center', shadow: '#000000',
    });
  }

  /* -------------------------------------------------------------- screens */

  title(ctx, g) {
    const f = this.font;
    const t = g.time;

    // Spacing accounts for the wave: each word can shift +/- (waveAmp * scale),
    // so the two lines need that much clearance or they collide mid-animation.
    f.draw(ctx, 'GOBLIN', W / 2, 6, {
      color: C.skinL, align: 'center', scale: 5, outline: '#0b1207',
      wave: t * 2.4, waveAmp: 1,
    });
    f.draw(ctx, 'HOARD', W / 2, 53, {
      color: C.gold, align: 'center', scale: 5, outline: '#0b1207',
      wave: t * 2.4 + 1.6, waveAmp: 1,
    });
    f.draw(ctx, 'A 16-BIT SMASH AND GRAB', W / 2, 97, {
      color: C.skin, align: 'center', shadow: '#000000',
    });

    if (g.best > 0) {
      f.draw(ctx, `BEST ${String(g.best).padStart(7, '0')}`, W / 2, 110, {
        color: C.cyanL, align: 'center', shadow: '#000000',
      });
    }

    if (Math.floor(t * 1.8) % 2 === 0) {
      f.draw(ctx, g.input.usedTouch ? 'TAP TO START' : 'PRESS ENTER TO START', W / 2, 126, {
        color: C.goldL, align: 'center', scale: 2, shadow: '#000000',
      });
    }

    const lines = g.input.usedTouch
      ? ['MOVE  LEFT / RIGHT PADS', 'JUMP  TAP AGAIN TO FLUTTER', 'WHIP  THE DIAMOND BUTTON']
      : ['MOVE  ARROWS / WASD', 'JUMP  SPACE  (TWICE TO FLUTTER)', 'WHIP  X     PAUSE  P     MUTE  M'];
    lines.forEach((line, i) => {
      f.draw(ctx, line, W / 2, 149 + i * 11, { color: C.skin, align: 'center', shadow: '#000000' });
    });

    f.draw(ctx, 'IPGOBLIN.COM', W - 4, 205, { color: C.skinD, align: 'right', shadow: '#000000' });
  }

  levelIntro(ctx, g) {
    const f = this.font;
    const def = g.levelDef;
    this.dim(ctx, 0.72);
    f.draw(ctx, `LEVEL ${g.levelIndex + 1}`, W / 2, 68, {
      color: C.goldL, align: 'center', scale: 3, shadow: '#000000',
    });
    f.draw(ctx, def.name, W / 2, 104, {
      color: C.skinL, align: 'center', scale: 2, shadow: '#000000',
    });
    f.draw(ctx, def.subtitle, W / 2, 128, { color: C.skinD, align: 'center' });
  }

  pause(ctx, g) {
    const f = this.font;
    this.dim(ctx, 0.66);
    this.panel(ctx, 96, 62, 192, 92);
    f.draw(ctx, 'PAUSED', W / 2, 74, { color: C.goldL, align: 'center', scale: 2, shadow: '#000000' });
    const rows = [
      `SCORE   ${String(g.score).padStart(7, '0')}`,
      `LOOT    ${g.loot}`,
      `LEVEL   ${g.levelIndex + 1} / ${g.totalLevels}`,
    ];
    rows.forEach((r, i) => f.draw(ctx, r, W / 2, 98 + i * 11, { color: C.skinL, align: 'center' }));
    f.draw(ctx, 'P TO RESUME    M MUTES', W / 2, 136, { color: C.skinD, align: 'center' });
  }

  gameOver(ctx, g) {
    const f = this.font;
    this.dim(ctx, 0.74);
    f.draw(ctx, 'THE GOBLIN', W / 2, 44, { color: C.tunicL, align: 'center', scale: 3, shadow: '#000000' });
    f.draw(ctx, 'IS DONE FOR', W / 2, 72, { color: C.tunicL, align: 'center', scale: 3, shadow: '#000000' });
    f.draw(ctx, `FINAL SCORE  ${String(g.score).padStart(7, '0')}`, W / 2, 112, {
      color: C.goldL, align: 'center', shadow: '#000000',
    });
    f.draw(ctx, `LOOT  ${g.loot}    BEST  ${String(g.best).padStart(7, '0')}`, W / 2, 126, {
      color: C.skinD, align: 'center',
    });
    if (g.newBest) {
      f.draw(ctx, 'NEW PERSONAL BEST!', W / 2, 142, {
        color: C.cyanL, align: 'center', wave: g.time * 5, waveAmp: 1,
      });
    }
    if (Math.floor(g.time * 1.8) % 2 === 0) {
      f.draw(ctx, g.input.usedTouch ? 'TAP TO TRY AGAIN' : 'PRESS ENTER TO TRY AGAIN', W / 2, 168, {
        color: C.skinL, align: 'center', shadow: '#000000',
      });
    }
  }

  victory(ctx, g) {
    const f = this.font;
    this.dim(ctx, 0.68);
    f.draw(ctx, 'THE HOARD', W / 2, 26, {
      color: C.gold, align: 'center', scale: 4, outline: '#0b1207', wave: g.time * 2, waveAmp: 1,
    });
    f.draw(ctx, 'IS YOURS', W / 2, 64, {
      color: C.gold, align: 'center', scale: 4, outline: '#0b1207', wave: g.time * 2 + 1.4, waveAmp: 1,
    });
    const rows = [
      `SCORE      ${String(g.score).padStart(7, '0')}`,
      `LOOT       ${g.loot} COINS`,
      `LIVES LEFT ${g.lives}`,
      `BEST       ${String(g.best).padStart(7, '0')}`,
    ];
    rows.forEach((r, i) => f.draw(ctx, r, W / 2, 104 + i * 12, {
      color: i === 3 ? C.cyanL : C.skinL, align: 'center', shadow: '#000000',
    }));
    if (Math.floor(g.time * 1.8) % 2 === 0) {
      f.draw(ctx, g.input.usedTouch ? 'TAP TO PLAY AGAIN' : 'PRESS ENTER TO PLAY AGAIN', W / 2, 168, {
        color: C.goldL, align: 'center', shadow: '#000000',
      });
    }
  }

  levelClear(ctx, g) {
    const f = this.font;
    this.dim(ctx, 0.6);
    f.draw(ctx, 'LEVEL CLEAR', W / 2, 74, {
      color: C.goldL, align: 'center', scale: 3, shadow: '#000000', wave: g.time * 4, waveAmp: 1,
    });
    f.draw(ctx, `+${g.clearBonus} CLEAR BONUS`, W / 2, 110, { color: C.skinL, align: 'center' });
  }

  /** Little goblin standing on the title-screen ledge. */
  titleGoblin(ctx, g) {
    const art = g.art.goblin;
    const set = g.titlePose === 'attack' ? art.attack : art.idle;
    const idx = g.titlePose === 'attack'
      ? Math.min(set.frames.length - 1, Math.floor(g.titlePoseT * 12))
      : Math.floor(g.time * 4) % set.frames.length;
    drawSprite(ctx, { x: 0, y: 0 }, set, idx, 16, 184 - 20, true, false);
  }
}
