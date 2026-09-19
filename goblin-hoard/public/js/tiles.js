/**
 * tiles.js - tilesets and parallax backdrops, generated at boot.
 *
 * Solid tiles are auto-tiled from a 4-bit neighbour mask (up/right/down/left),
 * so a level author only ever writes `#` and the correct edge, cap and corner
 * art falls out automatically.
 */

import { Grid, bake, canvas, rng, mix, lighten, darken } from './pixl.js';
import { C } from './art.js';

export const TS = 16;

export const T = {
  EMPTY: 0,
  SOLID: 1,
  PLATFORM: 2,
  SPIKE: 3,
  LAVA: 4,
  BACK: 5,
  TORCH: 6,
  VINE: 7,
  LAVA_TOP: 8,
};

export const MASK = { UP: 1, RIGHT: 2, DOWN: 4, LEFT: 8 };

/** A Grid whose x axis wraps, so backdrops tile seamlessly. */
class WrapGrid extends Grid {
  set(x, y, c) {
    if (!c) return;
    x = Math.round(x); y = Math.round(y);
    if (y < 0 || y >= this.h) return;
    x = ((x % this.w) + this.w) % this.w;
    this.d[y * this.w + x] = c;
  }

  get(x, y) {
    if (y < 0 || y >= this.h) return null;
    x = Math.round(x);
    x = ((x % this.w) + this.w) % this.w;
    return this.d[y * this.w + x];
  }
}

export const THEMES = [
  {
    name: 'The Mossy Ruins',
    rockD: '#2a2f26', rock: '#4a5240', rockL: '#6e7a5c',
    capD: '#2c6420', cap: '#4e9a2d', capL: '#8ede4f',
    backD: '#161c14', back: '#222c1d',
    accent: C.gold,
    sky: ['#0a1428', '#17304a', '#2b5566', '#4a7a5e'],
    hazard: 'spike',
  },
  {
    name: 'The Packet Mines',
    rockD: '#241b2c', rock: '#3f3350', rockL: '#5d4d72',
    capD: '#12506e', cap: '#2fa5d6', capL: '#8ce8ff',
    backD: '#120d18', back: '#1c1524',
    accent: C.cyanL,
    sky: ['#05060f', '#0d1022', '#161a38', '#232a52'],
    hazard: 'lava',
  },
  {
    name: 'The Firewall Keep',
    rockD: '#2b1a18', rock: '#4d2f2a', rockL: '#7a4d3f',
    capD: '#7a2410', cap: '#c2452e', capL: '#ef7420',
    backD: '#1a0f0e', back: '#281817',
    accent: C.emberL,
    sky: ['#170710', '#3a0f18', '#6b1d18', '#a83a16'],
    hazard: 'lava',
  },
  {
    name: 'The Root Daemon',
    rockD: '#181a24', rock: '#2e3346', rockL: '#4a5270',
    capD: '#5c1a6e', cap: '#a02fc6', capL: '#e07af0',
    backD: '#0a0a12', back: '#14141f',
    accent: C.magenta,
    sky: ['#04040a', '#0c0818', '#1c0e2e', '#3a1250'],
    hazard: 'lava',
  },
];

/* -------------------------------------------------------------- solid tile */

function solidTile(theme, mask, seed) {
  const g = new Grid(TS, TS);
  const r = rng(seed * 2654435761 + mask * 97 + 7);

  const up = mask & MASK.UP, right = mask & MASK.RIGHT;
  const down = mask & MASK.DOWN, left = mask & MASK.LEFT;

  // Rock body with a little dithered noise so large masses are not flat.
  g.rect(0, 0, TS, TS, theme.rock);
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const n = r();
      if (n < 0.14) g.set(x, y, theme.rockD);
      else if (n < 0.26) g.set(x, y, theme.rockL);
    }
  }
  // A couple of larger cracks / blocks.
  const bx = 2 + Math.floor(r() * 8), by = 5 + Math.floor(r() * 8);
  g.rect(bx, by, 2 + Math.floor(r() * 3), 2, theme.rockD);
  g.rect(bx + 1, by - 1, 2, 1, theme.rockL);

  // Open faces get a lit edge, closed faces stay dark so masses read as solid.
  if (up) {
    g.rect(0, 0, TS, 4, theme.cap);
    g.rect(0, 0, TS, 1, theme.capL);
    g.rect(0, 4, TS, 1, theme.capD);
    // ragged underside of the cap
    for (let x = 0; x < TS; x++) {
      const d = Math.floor(r() * 3);
      g.rect(x, 5, 1, d, theme.capD);
    }
  }
  if (down) {
    g.rect(0, TS - 2, TS, 2, theme.rockD);
    for (let x = 0; x < TS; x += 2) if (r() < 0.5) g.set(x, TS - 3, theme.rockD);
  }
  if (left) {
    g.rect(0, up ? 5 : 0, 2, TS, theme.rockD);
    g.rect(1, up ? 5 : 0, 1, TS, theme.rock);
    if (up) g.rect(0, 0, 2, 5, theme.capD);
  }
  if (right) {
    g.rect(TS - 2, up ? 5 : 0, 2, TS, theme.rockD);
    g.rect(TS - 2, up ? 5 : 0, 1, theme.rockL);
    if (up) g.rect(TS - 2, 0, 2, 5, theme.capD);
  }
  // Hard outline on every open face keeps the 16-bit look crisp.
  const ink = darken(theme.rockD, 0.55);
  if (up) g.rect(0, 0, TS, 1, theme.capL);
  if (down) g.rect(0, TS - 1, TS, 1, ink);
  if (left) g.rect(0, 0, 1, TS, ink);
  if (right) g.rect(TS - 1, 0, 1, TS, ink);

  return bake(g);
}

function platformTile(theme, seed) {
  const g = new Grid(TS, TS);
  const r = rng(seed * 22695477 + 13);
  g.rect(0, 0, TS, 6, theme.rock);
  g.rect(0, 0, TS, 1, theme.capL);
  g.rect(0, 1, TS, 1, theme.cap);
  g.rect(0, 5, TS, 1, darken(theme.rockD, 0.4));
  for (let x = 0; x < TS; x++) if (r() < 0.3) g.set(x, 3, theme.rockD);
  // end caps hint at a carved ledge
  g.rect(0, 2, 1, 3, theme.rockD);
  g.rect(TS - 1, 2, 1, 3, theme.rockD);
  return bake(g);
}

function spikeTile(theme) {
  const g = new Grid(TS, TS);
  g.rect(0, 12, TS, 4, theme.rockD);
  g.rect(0, 12, TS, 1, theme.rock);
  for (let i = 0; i < 4; i++) {
    const x = i * 4 + 2;
    g.tri(x, 1, x - 2, 13, x + 2, 13, C.steelL);
    g.tri(x, 3, x - 1, 13, x + 1, 13, C.white);
    g.tri(x + 1, 5, x + 2, 13, x, 13, C.steel);
  }
  g.rect(0, TS - 1, TS, 1, darken(theme.rockD, 0.5));
  return bake(g);
}

function lavaTile(theme, frame, top) {
  const g = new Grid(TS, TS);
  const hot = theme.name.includes('Mines')
    ? { a: '#0d5a8c', b: '#2fa5d6', c: '#8ce8ff' }
    : { a: '#a82505', b: '#f58a1e', c: '#ffe259' };
  g.rect(0, 0, TS, TS, hot.a);
  for (let y = 0; y < TS; y++) {
    // Brighter and more mobile than a flat fill, so hazards read at a glance.
    const t = 0.45 + Math.sin(y * 0.5 + frame * 1.6) * 0.32;
    g.dither(0, y, TS, 1, hot.a, hot.b, t);
  }
  for (let x = 0; x < TS; x += 3) {
    const bub = Math.round((Math.sin(x * 1.7 + frame * 2.1) * 0.5 + 0.5) * (TS - 4)) + 2;
    g.set(x, bub, hot.c);
    g.set(x + 1, bub, hot.b);
  }
  if (top) {
    for (let x = 0; x < TS; x++) {
      const wave = Math.round(Math.sin((x * 0.6) + frame * 1.2) * 1.2);
      g.rect(x, 0, 1, 2 + wave, null);
      g.set(x, 2 + wave, hot.c);
      g.set(x, 3 + wave, hot.c);
      g.set(x, 4 + wave, hot.b);
    }
  }
  return bake(g);
}

function backTile(theme, seed) {
  const g = new Grid(TS, TS);
  const r = rng(seed * 69069 + 3);
  g.rect(0, 0, TS, TS, theme.back);
  // recessed brickwork
  for (let row = 0; row < 2; row++) {
    const y = row * 8;
    const off = row % 2 ? 4 : 0;
    g.rect(0, y, TS, 1, theme.backD);
    for (let x = off; x < TS + off; x += 8) g.rect(x % TS, y, 1, 8, theme.backD);
  }
  for (let i = 0; i < 6; i++) g.set(Math.floor(r() * TS), Math.floor(r() * TS), theme.backD);
  return bake(g);
}

function torchFrames(theme) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const g = new Grid(TS, TS);
    const t = i / 4;
    // bracket
    g.rect(6, 8, 4, 8, C.leatherD);
    g.rect(7, 8, 2, 8, C.leather);
    g.rect(5, 7, 6, 2, C.steelD);
    // flame
    const h = 6 + Math.sin(t * Math.PI * 2) * 1.5;
    const sway = Math.sin(t * Math.PI * 2 + 1) * 1.2;
    const hot = theme.accent;
    g.ellipse(8 + sway, 6, 3, h * 0.55, C.emberD);
    g.ellipse(8 + sway * 0.7, 6, 2, h * 0.45, C.ember);
    g.ellipse(8 + sway * 0.4, 6.5, 1, h * 0.3, hot);
    g.set(8 + Math.round(sway), 2, C.white);
    out.push(bake(g));
  }
  return out;
}

function vineTile(theme) {
  const g = new Grid(TS, TS);
  for (let y = 0; y < TS; y++) {
    const x = 8 + Math.round(Math.sin(y * 0.45) * 2);
    g.set(x, y, theme.capD);
    g.set(x + 1, y, theme.cap);
    if (y % 4 === 0) {
      g.ellipse(x + (y % 8 ? 3 : -2), y, 2, 1.4, theme.cap);
      g.set(x + (y % 8 ? 3 : -2), y, theme.capL);
    }
  }
  return bake(g);
}

/* --------------------------------------------------------------- backdrops */

function skyCanvas(theme, w, h) {
  const g = new Grid(w, h);
  const [a, b, c, d] = theme.sky;
  // Contiguous bands: each starts exactly where the previous one ended, or a
  // row is left unpainted and shows up as a dark line across the backdrop.
  const b1 = Math.floor(h * 0.45);
  const b2 = Math.floor(h * 0.75);
  g.gradient(0, 0, w, b1, a, b, 6);
  g.gradient(0, b1, w, b2 - b1, b, c, 5);
  g.gradient(0, b2, w, h - b2, c, d, 4);
  return bake(g);
}

function starLayer(theme, w, h, seed) {
  const g = new WrapGrid(w, h);
  const r = rng(seed);
  const count = 90;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * h * 0.7);
    const bright = r();
    g.set(x, y, bright > 0.85 ? '#ffffff' : bright > 0.5 ? '#c8d8ff' : '#7e8fc0');
    if (bright > 0.95) {
      g.set(x - 1, y, '#8ea4d8');
      g.set(x + 1, y, '#8ea4d8');
      g.set(x, y - 1, '#8ea4d8');
      g.set(x, y + 1, '#8ea4d8');
    }
  }
  // moon / distant core, kept left of centre so the title never covers it
  const mx = Math.floor(w * 0.18), my = Math.floor(h * 0.17);
  if (theme.name.includes('Ruins')) {
    g.circle(mx, my, 13, '#e8ecc8');
    g.circle(mx - 4, my - 3, 3, '#cfd4ae');
    g.circle(mx + 3, my + 4, 2, '#cfd4ae');
    g.circle(mx + 5, my - 5, 1.5, '#cfd4ae');
  } else {
    g.circle(mx, my, 10, darken(theme.cap, 0.55));
    g.circle(mx, my, 7, darken(theme.cap, 0.3));
    g.circle(mx, my, 3, theme.capL);
  }
  return bake(g);
}

/** Mid-ground silhouette: hills, cavern walls or battlements per theme. */
function midLayer(theme, w, h, seed) {
  const g = new WrapGrid(w, h);
  const r = rng(seed);
  const col = mix(theme.sky[3], theme.rockD, 0.6);
  const colL = lighten(col, 0.12);

  if (theme.name.includes('Ruins')) {
    for (let i = 0; i < 7; i++) {
      const cx = (i * w) / 7 + r() * 20;
      const ph = 38 + r() * 40;
      g.tri(cx - ph * 0.9, h, cx, h - ph, cx + ph * 0.9, h, col);
      g.tri(cx - ph * 0.3, h - ph * 0.55, cx, h - ph, cx + ph * 0.2, h - ph * 0.6, colL);
    }
  } else if (theme.name.includes('Mines')) {
    for (let x = 0; x < w; x++) {
      const top = h - 30 - Math.sin(x * 0.04) * 14 - Math.sin(x * 0.11) * 7;
      g.rect(x, top, 1, h - top, col);
      g.set(x, top, colL);
      const bot = 22 + Math.sin(x * 0.05 + 2) * 10 + Math.sin(x * 0.13) * 5;
      g.rect(x, 0, 1, bot, col);
      g.set(x, bot, colL);
    }
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(r() * w), len = 8 + r() * 16;
      g.tri(x - 3, 0, x + 3, 0, x, len, col);
      g.tri(x - 3, h, x + 3, h, x, h - len, col);
    }
  } else {
    // battlements / server racks
    for (let i = 0; i < 9; i++) {
      const bw = 22 + Math.floor(r() * 22);
      const bh = 34 + Math.floor(r() * 46);
      const x = Math.floor((i * w) / 9 + r() * 8);
      g.rect(x, h - bh, bw, bh, col);
      g.rect(x, h - bh, bw, 2, colL);
      for (let m = 0; m < bw; m += 6) g.rect(x + m, h - bh - 4, 4, 4, col);
      for (let wy = h - bh + 8; wy < h - 6; wy += 10) {
        for (let wx = x + 4; wx < x + bw - 4; wx += 8) {
          if (r() < 0.55) g.rect(wx, wy, 3, 4, theme.accent);
        }
      }
    }
  }
  return bake(g);
}

/** Near-ground silhouette, darkest and fastest-scrolling. */
function nearLayer(theme, w, h, seed) {
  const g = new WrapGrid(w, h);
  const r = rng(seed);
  const col = darken(theme.rockD, 0.35);
  const colL = lighten(col, 0.1);

  if (theme.name.includes('Ruins')) {
    // Bare, gnarled trees: trunk, a few forking branches, no canopy - a filled
    // canopy at this scale just reads as a mushroom.
    for (let i = 0; i < 10; i++) {
      const x = Math.floor((i * w) / 10 + r() * 24);
      const th = 44 + r() * 42;
      const top = h - th;
      g.rect(x, top, 4, th, col);
      g.rect(x, top, 1, th, colL);
      for (let b = 0; b < 5; b++) {
        const by = top + 4 + b * (th / 7);
        const dir = b % 2 ? 1 : -1;
        const len = 7 + r() * 9;
        const tipX = x + 2 + dir * len;
        const tipY = by - 6 - r() * 5;
        g.thickLine(x + 2, by, tipX, tipY, 2, col);
        g.thickLine(tipX, tipY, tipX + dir * (3 + r() * 4), tipY - 4 - r() * 4, 1, col);
      }
      // the two topmost forks
      g.thickLine(x + 2, top + 2, x - 5 - r() * 4, top - 7 - r() * 5, 2, col);
      g.thickLine(x + 2, top + 2, x + 9 + r() * 4, top - 8 - r() * 5, 2, col);
    }
  } else if (theme.name.includes('Mines')) {
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(r() * w);
      const ch = 16 + r() * 28;
      const cw = 3 + r() * 4;
      g.tri(x - cw, h, x, h - ch, x + cw, h, col);
      g.tri(x - cw * 0.4, h, x, h - ch, x + cw * 0.3, h, colL);
    }
  } else {
    for (let i = 0; i < 8; i++) {
      const x = Math.floor((i * w) / 8 + r() * 20);
      g.rect(x, h - 70, 8, 70, col);
      g.rect(x - 2, h - 74, 12, 5, col);
      g.rect(x - 1, h - 73, 10, 2, colL);
      // hanging chain
      for (let cy = h - 66; cy < h - 20; cy += 5) g.rect(x + 3, cy, 2, 3, col);
    }
  }
  return bake(g);
}

/* ------------------------------------------------------------------ export */

export function buildTiles(viewW, viewH) {
  return THEMES.map((theme, ti) => {
    const solid = [];
    for (let mask = 0; mask < 16; mask++) solid.push(solidTile(theme, mask, ti + 1));
    const lava = [];
    const lavaTop = [];
    for (let f = 0; f < 4; f++) {
      lava.push(lavaTile(theme, f, false));
      lavaTop.push(lavaTile(theme, f, true));
    }
    return {
      theme,
      solid,
      platform: platformTile(theme, ti + 1),
      spike: spikeTile(theme),
      lava,
      lavaTop,
      back: [backTile(theme, ti + 1), backTile(theme, ti + 11)],
      torch: torchFrames(theme),
      vine: vineTile(theme),
      sky: skyCanvas(theme, viewW, viewH),
      layers: [
        { img: starLayer(theme, viewW, viewH, 1000 + ti), speed: 0.08, y: 0 },
        { img: midLayer(theme, viewW, viewH, 2000 + ti), speed: 0.22, y: 0 },
        { img: nearLayer(theme, viewW, viewH, 3000 + ti), speed: 0.45, y: 0 },
      ],
    };
  });
}

export { canvas };
