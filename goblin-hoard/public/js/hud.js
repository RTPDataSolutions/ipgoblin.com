/**
 * hud.js - the in-game HUD and every full-screen state (title, intro, pause,
 * game over, victory). All of it is drawn into the 384x216 buffer.
 */

import { C } from './art.js';
import { drawSprite } from './entities.js';
import { wipesIn } from './scores.js';

const W = 384;
const H = 216;

const pad7 = (n) => String(n).padStart(7, '0');

/** Whether the "press enter" line should show on the game over screens. */
const promptVisible = (g) => ['none', 'offline', 'skipped'].includes(g.post);

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

  /**
   * Soft dark backing for a HUD corner. The parallax moon drifts the whole
   * width of a level, so sooner or later it sits directly behind the hearts
   * and the life count becomes unreadable. Sky-independent contrast is
   * cheaper than trying to park the backdrop art somewhere safe.
   */
  hudScrim(ctx, x, y, w, h) {
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = '#05080a';
    ctx.fillRect(x + 1, y, w - 2, h);
    ctx.fillRect(x, y + 1, w, h - 2);
    ctx.restore();
  }

  /* ------------------------------------------------------------- in-game  */

  draw(ctx, g) {
    const f = this.font;
    const heart = g.art.heart.frames[0].r;

    this.hudScrim(ctx, 2, 2, 14 + g.player.maxHealth * 13, 30);
    this.hudScrim(ctx, W - 72, 2, 70, 27);

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

  /** Dark band behind the title text, so it reads over the busy parallax. */
  titleScrim(ctx) {
    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = '#070c05';
    ctx.fillRect(0, 92, W, 96);
    ctx.restore();
    ctx.fillStyle = C.skinD;
    ctx.fillRect(0, 92, W, 1);
    ctx.fillRect(0, 187, W, 1);
  }

  title(ctx, g) {
    const f = this.font;
    const t = g.time;

    // Spacing accounts for the wave: each word can shift +/- (waveAmp * scale),
    // so the two lines need that much clearance or they collide mid-animation.
    f.draw(ctx, 'GOBLIN', W / 2, 6, {
      color: C.skinL, align: 'center', scale: 5, outline: '#0b1207',
      wave: t * 2.4, waveAmp: 1,
    });
    f.draw(ctx, 'HOARD', W / 2, 50, {
      color: C.gold, align: 'center', scale: 5, outline: '#0b1207',
      wave: t * 2.4 + 1.6, waveAmp: 1,
    });

    f.draw(ctx, 'A 16-BIT SMASH AND GRAB', W / 2, 98, {
      color: C.skinL, align: 'center', shadow: '#000000',
    });

    if (g.best > 0) {
      f.draw(ctx, `BEST ${String(g.best).padStart(7, '0')}`, W / 2, 112, {
        color: C.cyanL, align: 'center', shadow: '#000000',
      });
    }

    if (Math.floor(t * 1.8) % 2 === 0) {
      f.draw(ctx, g.input.usedTouch ? 'TAP TO START' : 'PRESS ENTER TO START', W / 2, 128, {
        color: C.goldL, align: 'center', scale: 2, shadow: '#000000',
      });
    }

    const lines = g.input.usedTouch
      ? ['MOVE  LEFT / RIGHT PADS', 'JUMP  TAP AGAIN TO FLUTTER', 'WHIP  THE DIAMOND BUTTON']
      : ['MOVE  ARROWS / WASD', 'JUMP  SPACE  (TWICE TO FLUTTER)', 'WHIP  X     PAUSE  P     MUTE  M'];
    lines.forEach((line, i) => {
      f.draw(ctx, line, W / 2, 152 + i * 11, { color: C.skinL, align: 'center', shadow: '#000000' });
    });

    f.draw(ctx, 'IPGOBLIN.COM', W - 4, 205, { color: C.skin, align: 'right', shadow: '#000000' });
    if (g.scores.boards && !g.input.usedTouch) {
      f.draw(ctx, '< > HIGH SCORES', 4, 205, { color: C.skin, shadow: '#000000' });
    }
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
    if (g.post === 'offline') {
      f.draw(ctx, 'THE SCOREBOARD IS OUT OF REACH', W / 2, 154, { color: C.skinD, align: 'center' });
    }
    if (promptVisible(g) && Math.floor(g.time * 1.8) % 2 === 0) {
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
    if (g.post === 'offline') {
      f.draw(ctx, 'THE SCOREBOARD IS OUT OF REACH', W / 2, 156, { color: C.skinD, align: 'center' });
    }
    if (promptVisible(g) && Math.floor(g.time * 1.8) % 2 === 0) {
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

  /* ---------------------------------------------------------- high scores */

  /** The title screen's other page: both boards, attract-loop style. */
  titleScores(ctx, g) {
    const f = this.font;
    const b = g.scores.boards;
    this.dim(ctx, 0.74);
    f.draw(ctx, 'HALL OF HOARDERS', W / 2, 6, {
      color: C.gold, align: 'center', scale: 2, outline: '#0b1207',
    });
    f.draw(ctx, `THIS WEEK'S BOARD IS WIPED IN ${wipesIn(g.scores.resetIn)}`, W / 2, 23, {
      color: C.skinL, align: 'center', shadow: '#000000',
    });
    this.boards(ctx, g, b);
    if (b.champion) {
      f.draw(ctx, `LAST WEEK'S CHAMPION  ${b.champion.name}  ${pad7(b.champion.score)}`, W / 2, 162, {
        color: C.skin, align: 'center', shadow: '#000000',
      });
    }
    if (Math.floor(g.time * 1.8) % 2 === 0) {
      f.draw(ctx, g.input.usedTouch ? 'TAP TO START' : 'PRESS ENTER TO START', W / 2, 176, {
        color: C.goldL, align: 'center', scale: 2, shadow: '#000000',
      });
    }
  }

  /** After posting: where the run landed, with your line lit up. */
  ranks(ctx, g) {
    const f = this.font;
    const res = g.posted?.week ? g.posted : g.scores.boards;
    this.dim(ctx, 0.84);
    const wk = res?.week?.you;
    const all = res?.all?.you;
    f.draw(ctx, wk ? `#${wk.rank} THIS WEEK` : 'SCORE POSTED', W / 2, 6, {
      color: C.cyanL, align: 'center', scale: 2, outline: '#0b1207',
    });

    const improved = g.posted?.posted?.improved;
    let flair = '';
    if (improved?.all) flair = 'NEW PERSONAL BEST!';
    else if (improved?.week) flair = 'NEW BEST THIS WEEK!';
    else if (improved) flair = 'YOUR BEST STILL STANDS';
    const sub = [all ? `#${all.rank} ALL TIME` : '', flair].filter(Boolean).join(' - ');
    f.draw(ctx, sub, W / 2, 23, {
      color: improved?.all || improved?.week ? C.goldL : C.skinL, align: 'center', shadow: '#000000',
    });

    if (res?.week) this.boards(ctx, g, res);
    f.draw(ctx, 'EVERY BOARD LIVES AT SCORES.IPGOBLIN.COM', W / 2, 162, {
      color: C.skin, align: 'center', shadow: '#000000',
    });
    if (Math.floor(g.time * 1.8) % 2 === 0) {
      f.draw(ctx, g.input.usedTouch ? 'TAP TO CONTINUE' : 'PRESS ENTER TO CONTINUE', W / 2, 180, {
        color: C.goldL, align: 'center', shadow: '#000000',
      });
    }
  }

  /** This week on the left, all time on the right. */
  boards(ctx, g, b) {
    this.boardColumn(ctx, g, 16, 'THIS WEEK', b.week);
    this.boardColumn(ctx, g, 198, 'ALL TIME', b.all);
  }

  /**
   * One board, ten lines. If you are on it but below the tenth line, the
   * last two lines become a gap and your own line, so you always see yours.
   */
  boardColumn(ctx, g, x0, label, board) {
    const f = this.font;
    const mid = x0 + 85;
    f.draw(ctx, label, mid, 35, { color: C.goldL, align: 'center', shadow: '#000000' });
    ctx.fillStyle = C.goldD;
    ctx.fillRect(x0 + 4, 44, 162, 1);

    if (!board.top.length) {
      f.draw(ctx, 'NOBODY YET', mid, 70, { color: C.skinL, align: 'center', shadow: '#000000' });
      f.draw(ctx, 'THE TOP SPOT IS', mid, 88, { color: C.skinD, align: 'center' });
      f.draw(ctx, 'UP FOR GRABS', mid, 98, { color: C.skinD, align: 'center' });
      return;
    }

    let rows = board.top.slice(0, 10);
    if (board.you && !rows.some((e) => e.you)) rows = [...rows.slice(0, 8), null, { ...board.you, you: true }];

    rows.forEach((e, i) => {
      const y = 49 + i * 11;
      if (!e) {
        f.draw(ctx, '. . .', mid, y, { color: C.skinD, align: 'center' });
        return;
      }
      if (e.you) {
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.25 * Math.sin(g.time * 5);
        ctx.fillStyle = C.cyanD;
        ctx.fillRect(x0, y - 2, 170, 11);
        ctx.restore();
      }
      const name = e.you ? C.cyanL : e.rank === 1 ? C.gold : C.skinL;
      f.draw(ctx, String(e.rank), x0 + 16, y, { color: e.you ? C.cyanL : C.skinD, align: 'right', shadow: '#000000' });
      f.draw(ctx, e.name, x0 + 22, y, { color: name, shadow: '#000000' });
      f.draw(ctx, pad7(e.score), x0 + 142, y, { color: e.you ? C.cyanL : C.goldL, align: 'right', shadow: '#000000' });
      f.draw(ctx, e.won ? 'WON' : `L${e.level}`, x0 + 168, y, {
        color: e.won ? C.gold : C.skin, align: 'right', shadow: '#000000',
      });
    });
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
