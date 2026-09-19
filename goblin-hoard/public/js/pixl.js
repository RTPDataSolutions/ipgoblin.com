/**
 * pixl.js - a tiny pixel-art toolkit.
 *
 * Every sprite, tile and backdrop in GOBLIN HOARD is drawn here at load time
 * instead of being shipped as an image. A `Grid` is a small array of colour
 * strings you draw shapes into; `bake()` turns it into a canvas the game can
 * blit. Auto-outlining and rim lighting are what give everything the chunky,
 * cohesive 16-bit look without hand-placing every pixel.
 */

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const rgbCache = new Map();

function parseHex(hex) {
  let v = rgbCache.get(hex);
  if (v) return v;
  let h = hex.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  rgbCache.set(hex, v);
  return v;
}

const clamp255 = (n) => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));

function toHex(r, g, b) {
  return '#' + ((1 << 24) | (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)).toString(16).slice(1);
}

export function lighten(hex, amt) {
  const [r, g, b] = parseHex(hex);
  return toHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
}

export function darken(hex, amt) {
  const [r, g, b] = parseHex(hex);
  return toHex(r * (1 - amt), g * (1 - amt), b * (1 - amt));
}

export function mix(a, b, t) {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/** Deterministic little PRNG, so generated art is identical every load. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Array(w * h).fill(null);
  }

  clone() {
    const g = new Grid(this.w, this.h);
    g.d = this.d.slice();
    return g;
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.d[y * this.w + x];
  }

  set(x, y, c) {
    if (!c) return;
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = c;
  }

  /** Only paints where something is already opaque - handy for shading. */
  setOver(x, y, c) {
    if (this.get(Math.round(x), Math.round(y))) this.set(x, y, c);
  }

  clear(x, y) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = null;
  }

  fill(c) {
    this.d.fill(c);
    return this;
  }

  rect(x, y, w, h, c) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    return this;
  }

  frame(x, y, w, h, c) {
    this.rect(x, y, w, 1, c);
    this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c);
    this.rect(x + w - 1, y, 1, h, c);
    return this;
  }

  erase(x, y, w, h) {
    x = Math.round(x); y = Math.round(y);
    for (let j = y; j < y + Math.round(h); j++) for (let i = x; i < x + Math.round(w); i++) this.clear(i, j);
    return this;
  }

  ellipse(cx, cy, rx, ry, c) {
    if (rx <= 0 || ry <= 0) return this;
    const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
    return this;
  }

  circle(cx, cy, r, c) {
    return this.ellipse(cx, cy, r, r, c);
  }

  /** Filled triangle, barycentric coverage test over the bounding box. */
  tri(x0, y0, x1, y1, x2, y2, c) {
    const minX = Math.floor(Math.min(x0, x1, x2));
    const maxX = Math.ceil(Math.max(x0, x1, x2));
    const minY = Math.floor(Math.min(y0, y1, y2));
    const maxY = Math.ceil(Math.max(y0, y1, y2));
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) return this;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) this.set(x, y, c);
      }
    }
    return this;
  }

  line(x0, y0, x1, y1, c) {
    return this.thickLine(x0, y0, x1, y1, 1, c);
  }

  thickLine(x0, y0, x1, y1, width, c) {
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2));
    const r = (width - 1) / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + dx * t, y = y0 + dy * t;
      if (width <= 1) this.set(x, y, c);
      else this.circle(x + 0.5, y + 0.5, r + 0.5, c);
    }
    return this;
  }

  /** A limb: tapered line from a joint to a hand/foot, with a blob on the end. */
  limb(x0, y0, x1, y1, w, c, capColor, capR) {
    this.thickLine(x0, y0, x1, y1, w, c);
    if (capR > 0) this.circle(x1 + 0.5, y1 + 0.5, capR, capColor || c);
    return this;
  }

  /** Ordered 4x4 dither between two colours; ratio 0 = all a, 1 = all b. */
  dither(x, y, w, h, a, b, ratio) {
    const cut = ratio * 16;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const px = Math.round(x + i), py = Math.round(y + j);
        const threshold = BAYER[py & 3][px & 3];
        this.set(px, py, threshold < cut ? b : a);
      }
    }
    return this;
  }

  /** Vertical dithered gradient, the cheap way to fake more colours. */
  gradient(x, y, w, h, top, bottom, bands) {
    const n = bands || h;
    for (let j = 0; j < h; j++) {
      const t = h <= 1 ? 0 : j / (h - 1);
      const step = Math.floor(t * (n - 1)) / Math.max(1, n - 1);
      const c = mix(top, bottom, step);
      const cNext = mix(top, bottom, Math.min(1, step + 1 / Math.max(1, n - 1)));
      const local = t * (n - 1) - Math.floor(t * (n - 1));
      for (let i = 0; i < w; i++) {
        const px = Math.round(x + i), py = Math.round(y + j);
        this.set(px, py, BAYER[py & 3][px & 3] < local * 16 ? cNext : c);
      }
    }
    return this;
  }

  /** Copy the opaque pixels of another grid onto this one. */
  blit(src, dx, dy, flipX) {
    dx = Math.round(dx); dy = Math.round(dy);
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.get(x, y);
        if (c) this.set(dx + (flipX ? src.w - 1 - x : x), dy + y, c);
      }
    }
    return this;
  }

  replace(from, to) {
    for (let i = 0; i < this.d.length; i++) if (this.d[i] === from) this.d[i] = to;
    return this;
  }

  /** Recolour every opaque pixel - used for flash / silhouette frames. */
  tint(c) {
    for (let i = 0; i < this.d.length; i++) if (this.d[i]) this.d[i] = c;
    return this;
  }

  /** Grow a 1px border into the transparent pixels touching the shape. */
  outline(c, diagonal) {
    const out = this.d.slice();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        const hit = this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1) ||
          (diagonal && (this.get(x - 1, y - 1) || this.get(x + 1, y - 1) || this.get(x - 1, y + 1) || this.get(x + 1, y + 1)));
        if (hit) out[y * this.w + x] = c;
      }
    }
    this.d = out;
    return this;
  }

  /**
   * Top-lit rim shading: pixels with nothing above them get brighter, pixels
   * with nothing below them get darker. Run before outline().
   */
  rim(up, down) {
    const out = this.d.slice();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.get(x, y);
        if (!c) continue;
        if (up && !this.get(x, y - 1)) out[y * this.w + x] = lighten(c, up);
        else if (down && !this.get(x, y + 1)) out[y * this.w + x] = darken(c, down);
      }
    }
    this.d = out;
    return this;
  }

  /** Trim to the opaque bounds; returns { grid, ox, oy }. */
  trimmed() {
    let minX = this.w, minY = this.h, maxX = -1, maxY = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!this.get(x, y)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return { grid: new Grid(1, 1), ox: 0, oy: 0 };
    const g = new Grid(maxX - minX + 1, maxY - minY + 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) g.set(x - minX, y - minY, this.get(x, y));
    }
    return { grid: g, ox: minX, oy: minY };
  }
}

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** Turn a Grid into a canvas. */
export function bake(grid) {
  const c = canvas(grid.w, grid.h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(grid.w, grid.h);
  const data = img.data;
  for (let i = 0; i < grid.d.length; i++) {
    const col = grid.d[i];
    if (!col) continue;
    const [r, g, b] = parseHex(col);
    const o = i * 4;
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Bake a grid into both facings so nothing has to flip at draw time. */
export function bakeFacing(grid) {
  const flipped = new Grid(grid.w, grid.h).blit(grid, 0, 0, true);
  return { r: bake(grid), l: bake(flipped), w: grid.w, h: grid.h };
}

/** A solid-colour copy of a sprite, for damage flashes. */
export function bakeFlash(grid, color) {
  return bakeFacing(grid.clone().tint(color));
}
