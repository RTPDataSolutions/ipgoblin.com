/**
 * level.js - the runtime tilemap: assembly, collision queries and drawing.
 */

import { SEG, SEG_W, SEG_H } from './levels.js';
import { T, TS, MASK } from './tiles.js';

const CHAR_TILE = {
  '.': T.EMPTY,
  ' ': T.EMPTY,
  '#': T.SOLID,
  '=': T.PLATFORM,
  '^': T.SPIKE,
  '~': T.LAVA_TOP,
  _: T.LAVA,
  b: T.BACK,
  t: T.TORCH,
  v: T.VINE,
};

const CHAR_SPAWN = {
  c: 'coin',
  g: 'gem',
  h: 'heart',
  '?': 'chest',
  '!': 'idol',
  S: 'slime',
  B: 'bat',
  K: 'knight',
  R: 'turret',
  X: 'boss',
  D: 'door',
};

export class Level {
  constructor(def) {
    this.def = def;
    this.w = def.segs.length * SEG_W;
    this.h = SEG_H;
    this.tiles = new Uint8Array(this.w * this.h);
    this.masks = new Uint8Array(this.w * this.h);
    this.variant = new Uint8Array(this.w * this.h);
    this.backBehind = new Uint8Array(this.w * this.h);
    this.spawns = [];
    this.playerSpawn = { x: 32, y: 200 };
    this._build();
    this._computeMasks();
  }

  get pixelW() { return this.w * TS; }
  get pixelH() { return this.h * TS; }

  _build() {
    this.def.segs.forEach((name, si) => {
      const seg = SEG[name];
      if (!seg) { console.warn('unknown segment', name); return; }
      for (let y = 0; y < SEG_H; y++) {
        const row = seg[y] || '';
        if (row.length !== SEG_W) {
          console.warn(`segment "${name}" row ${y} is ${row.length} wide, expected ${SEG_W}`);
        }
        for (let x = 0; x < SEG_W; x++) {
          const ch = row[x] ?? '.';
          const gx = si * SEG_W + x;
          const i = y * this.w + gx;
          this.variant[i] = (gx * 7 + y * 3) % 2;

          if (ch in CHAR_TILE) {
            this.tiles[i] = CHAR_TILE[ch];
            continue;
          }
          this.tiles[i] = T.EMPTY;

          const cx = gx * TS + TS / 2;
          if (ch === 'P') {
            // Feet on the bottom edge of the marker tile.
            this.playerSpawn = { x: cx, y: (y + 1) * TS };
          } else if (ch in CHAR_SPAWN) {
            const kind = CHAR_SPAWN[ch];
            const centred = kind === 'coin' || kind === 'gem' || kind === 'heart' || kind === 'idol';
            this.spawns.push({
              kind,
              x: cx,
              y: centred ? y * TS + TS / 2 : (y + 1) * TS,
              tx: gx,
              ty: y,
            });
          }
        }
      }
    });
  }

  /**
   * Autotile mask per solid tile: a bit is set when that side is *open*.
   * Outside the map counts as solid so the level border never grows a cap.
   */
  _computeMasks() {
    const solidOrOutside = (x, y) => {
      if (x < 0 || x >= this.w || y < 0 || y >= this.h) return true;
      return this.tiles[y * this.w + x] === T.SOLID;
    };
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (this.tiles[i] === T.SOLID) {
          let m = 0;
          if (!solidOrOutside(x, y - 1)) m |= MASK.UP;
          if (!solidOrOutside(x + 1, y)) m |= MASK.RIGHT;
          if (!solidOrOutside(x, y + 1)) m |= MASK.DOWN;
          if (!solidOrOutside(x - 1, y)) m |= MASK.LEFT;
          this.masks[i] = m;
        } else if (this.tiles[i] !== T.BACK) {
          // Props inside a walled area need the wall drawn behind them.
          const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
            const nx = x + dx, ny = y + dy;
            return nx >= 0 && nx < this.w && ny >= 0 && ny < this.h &&
              this.tiles[ny * this.w + nx] === T.BACK;
          });
          this.backBehind[i] = near ? 1 : 0;
        }
      }
    }
  }

  tileAt(tx, ty) {
    if (tx < 0 || tx >= this.w) return T.SOLID;   // walls at the level edges
    if (ty < 0 || ty >= this.h) return T.EMPTY;   // open sky above, void below
    return this.tiles[ty * this.w + tx];
  }

  isSolid(tx, ty) { return this.tileAt(tx, ty) === T.SOLID; }

  isPlatform(tx, ty) { return this.tileAt(tx, ty) === T.PLATFORM; }

  /** Solid for something that ignores one-way platforms (flying enemies). */
  isBlocking(tx, ty) { return this.isSolid(tx, ty); }

  isHazard(tx, ty) {
    const t = this.tileAt(tx, ty);
    return t === T.SPIKE || t === T.LAVA || t === T.LAVA_TOP;
  }

  /** True if any tile overlapping the rect is a hazard. */
  hazardInRect(x, y, w, h) {
    const x0 = Math.floor(x / TS), x1 = Math.floor((x + w - 1) / TS);
    const y0 = Math.floor(y / TS), y1 = Math.floor((y + h - 1) / TS);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = this.tileAt(tx, ty);
        if (t === T.LAVA || t === T.LAVA_TOP) return 'lava';
        // Spikes only hurt in their upper half, where the points are.
        if (t === T.SPIKE && y + h > ty * TS + 2) return 'spike';
      }
    }
    return null;
  }

  solidInRect(x, y, w, h) {
    const x0 = Math.floor(x / TS), x1 = Math.floor((x + w - 1) / TS);
    const y0 = Math.floor(y / TS), y1 = Math.floor((y + h - 1) / TS);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) if (this.isSolid(tx, ty)) return true;
    }
    return false;
  }

  /* -------------------------------------------------------------- drawing */

  drawBackground(ctx, cam, tileset, viewW, viewH) {
    ctx.drawImage(tileset.sky, 0, 0);
    for (const layer of tileset.layers) {
      const img = layer.img;
      const lw = img.width;
      let ox = -(cam.x * layer.speed) % lw;
      if (ox > 0) ox -= lw;
      const oy = Math.round(-cam.y * layer.speed * 0.35);
      for (let x = Math.round(ox); x < viewW; x += lw) {
        ctx.drawImage(img, x, oy);
      }
    }
  }

  draw(ctx, cam, tileset, time, viewW, viewH) {
    const lavaFrame = Math.floor(time * 7) % 4;
    const torchFrame = Math.floor(time * 10) % 4;
    const x0 = Math.max(0, Math.floor(cam.x / TS));
    const x1 = Math.min(this.w - 1, Math.floor((cam.x + viewW) / TS));
    const y0 = Math.max(0, Math.floor(cam.y / TS));
    const y1 = Math.min(this.h - 1, Math.floor((cam.y + viewH) / TS));

    for (let ty = y0; ty <= y1; ty++) {
      const py = ty * TS - cam.y;
      for (let tx = x0; tx <= x1; tx++) {
        const i = ty * this.w + tx;
        const t = this.tiles[i];
        if (t === T.EMPTY && !this.backBehind[i]) continue;
        const px = tx * TS - cam.x;

        if (this.backBehind[i] && t !== T.BACK) {
          ctx.drawImage(tileset.back[this.variant[i]], px, py);
        }

        switch (t) {
          case T.SOLID:
            ctx.drawImage(tileset.solid[this.masks[i]], px, py);
            break;
          case T.PLATFORM:
            ctx.drawImage(tileset.platform, px, py);
            break;
          case T.SPIKE:
            ctx.drawImage(tileset.spike, px, py);
            break;
          case T.LAVA_TOP:
            ctx.drawImage(tileset.lavaTop[lavaFrame], px, py);
            break;
          case T.LAVA:
            ctx.drawImage(tileset.lava[lavaFrame], px, py);
            break;
          case T.BACK:
            ctx.drawImage(tileset.back[this.variant[i]], px, py);
            break;
          case T.TORCH:
            ctx.drawImage(tileset.torch[(torchFrame + tx) % 4], px, py);
            break;
          case T.VINE:
            ctx.drawImage(tileset.vine, px, py);
            break;
          default:
            break;
        }
      }
    }
  }
}
