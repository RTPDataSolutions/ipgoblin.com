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
    backD: '#181f16', back: '#26331f',
    accent: C.gold,
    // Secondary hue, sprinkled through the rock as mineral flecks and used
    // for the backdrop's small details. It is what stops each theme reading
    // as a single colour with the brightness turned up and down.
    accent2: '#ff7fb0',
    fog: '#3f7a6a',
    sky: ['#1b1040', '#45256b', '#a1427a', '#e87a4e', '#f7c46b'],
    hazard: 'spike',
  },
  {
    name: 'The Packet Mines',
    rockD: '#241b2c', rock: '#3f3350', rockL: '#5d4d72',
    capD: '#12506e', cap: '#2fa5d6', capL: '#8ce8ff',
    backD: '#150f1f', back: '#221a33',
    accent: C.cyanL,
    accent2: '#9dff5c',
    fog: '#2f6f9e',
    sky: ['#04060f', '#0d1a3a', '#1c3a6e', '#2f76a8', '#63d2e8'],
    hazard: 'lava',
  },
  {
    name: 'The Firewall Keep',
    rockD: '#2b1a18', rock: '#4d2f2a', rockL: '#7a4d3f',
    capD: '#7a2410', cap: '#c2452e', capL: '#ef7420',
    backD: '#1f1113', back: '#33191c',
    accent: C.emberL,
    accent2: '#5cd8ff',
    fog: '#b8471f',
    sky: ['#1b0620', '#5c1030', '#a82a2a', '#e8681f', '#ffc247'],
    hazard: 'lava',
  },
  {
    name: 'The Root Daemon',
    rockD: '#181a24', rock: '#2e3346', rockL: '#4a5270',
    capD: '#5c1a6e', cap: '#a02fc6', capL: '#e07af0',
    backD: '#0e0a18', back: '#1b1430',
    accent: C.magenta,
    accent2: '#4dffc4',
    fog: '#7a2ea8',
    sky: ['#05030d', '#1a0a33', '#3d1263', '#7a1f8c', '#c24da8'],
    hazard: 'lava',
  },
];

/* -------------------------------------------------------------- solid tile */

function solidTile(theme, mask, seed) {
  const g = new Grid(TS, TS);
  const r = rng(seed * 2654435761 + mask * 97 + 7);

  const up = mask & MASK.UP, right = mask & MASK.RIGHT;
  const down = mask & MASK.DOWN, left = mask & MASK.LEFT;

  // Rock body: strata, noise and a few blocks. Large floors are mostly this
  // tile repeated, so without internal structure the ground reads as one flat
  // slab of colour.
  g.rect(0, 0, TS, TS, theme.rock);
  const strataA = mix(theme.rock, theme.rockD, 0.45);
  const strataB = mix(theme.rock, theme.rockL, 0.4);
  for (let y = 0; y < TS; y++) {
    // Gently waving bands give the mass a geological grain.
    const band = Math.sin(y * 0.9 + seed) > 0.35;
    for (let x = 0; x < TS; x++) {
      const n = r();
      if (band && n < 0.5) g.set(x, y, strataA);
      else if (n < 0.13) g.set(x, y, theme.rockD);
      else if (n < 0.24) g.set(x, y, theme.rockL);
      else if (n < 0.33) g.set(x, y, strataB);
    }
  }
  // A couple of larger embedded blocks with a lit top edge.
  for (let b = 0; b < 2; b++) {
    const bx = 1 + Math.floor(r() * (TS - 6));
    const by = 6 + Math.floor(r() * (TS - 9));
    const bw = 3 + Math.floor(r() * 3);
    g.rect(bx, by, bw, 3, theme.rockD);
    g.rect(bx, by, bw, 1, theme.rockL);
    g.rect(bx, by + 3, bw, 1, darken(theme.rockD, 0.3));
  }

  // Mineral flecks in the theme's secondary hue. Sparse on purpose: a few
  // saturated pixels per tile lift a grey mass without turning the floor
  // into something that competes with the goblin for attention.
  const veins = r() < 0.55 ? 1 + Math.floor(r() * 2) : 0;
  for (let v = 0; v < veins; v++) {
    const vx = 2 + Math.floor(r() * (TS - 4));
    const vy = 6 + Math.floor(r() * (TS - 8));
    g.set(vx, vy, theme.accent2);
    g.set(vx + 1, vy, darken(theme.accent2, 0.35));
    if (r() < 0.5) g.set(vx, vy + 1, darken(theme.accent2, 0.5));
  }

  // Open faces get a lit edge, closed faces stay dark so masses read as solid.
  if (up) {
    // Dithered bands rather than flat stripes. A solid row of the brightest
    // colour running unbroken across the level reads as a neon strip laid on
    // the floor; letting the tones interleave and vary per tile makes the
    // same edge read as light falling on rock.
    g.rect(0, 0, TS, 5, theme.cap);
    g.dither(0, 0, TS, 1, theme.cap, theme.capL, 0.72);
    g.dither(0, 1, TS, 1, theme.cap, theme.capL, 0.3);
    g.dither(0, 3, TS, 1, theme.cap, theme.capD, 0.45);
    g.dither(0, 4, TS, 1, theme.capD, theme.cap, 0.25);
    // ragged underside of the cap, chewing down into the rock
    for (let x = 0; x < TS; x++) {
      const d = Math.floor(r() * 3);
      g.rect(x, 5, 1, d, theme.capD);
      if (r() < 0.3) g.set(x, 5 + d, mix(theme.capD, theme.rock, 0.5));
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
  if (up) g.dither(0, 0, TS, 1, theme.cap, theme.capL, 0.72);
  if (down) g.rect(0, TS - 1, TS, 1, ink);
  if (left) g.rect(0, 0, 1, TS, ink);
  if (right) g.rect(TS - 1, 0, 1, TS, ink);

  return bake(g);
}

function platformTile(theme, seed) {
  const g = new Grid(TS, TS);
  const r = rng(seed * 22695477 + 13);
  g.rect(0, 0, TS, 6, theme.rock);
  // Same dithered lit edge as the ground, so a ledge does not read as a
  // painted bar floating in mid-air.
  g.dither(0, 0, TS, 1, theme.cap, theme.capL, 0.6);
  g.dither(0, 1, TS, 1, theme.rock, theme.cap, 0.75);
  g.dither(0, 2, TS, 1, theme.rock, theme.capD, 0.4);
  g.rect(0, 5, TS, 1, darken(theme.rockD, 0.4));
  for (let x = 0; x < TS; x++) if (r() < 0.3) g.set(x, 3, theme.rockD);
  if (r() < 0.4) g.set(2 + Math.floor(r() * (TS - 4)), 3, theme.accent2);
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
  // An occasional glowing mosaic chip, so back walls are not a flat slab.
  if (r() < 0.45) {
    const mx = 2 + Math.floor(r() * (TS - 4));
    const my = 2 + Math.floor(r() * (TS - 4));
    const chip = r() < 0.5 ? theme.accent : theme.accent2;
    g.rect(mx, my, 2, 2, darken(chip, 0.55));
    g.set(mx, my, darken(chip, 0.3));
  }
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
  const stops = theme.sky;
  // Walk the stops as contiguous bands. Each band starts exactly where the
  // previous one ended, or a row is left unpainted and draws as a dark seam
  // across the whole backdrop.
  const bands = stops.length - 1;
  let y0 = 0;
  for (let i = 0; i < bands; i++) {
    const y1 = Math.round(((i + 1) / bands) * h);
    g.gradient(0, y0, w, y1 - y0, stops[i], stops[i + 1], 6);
    y0 = y1;
  }
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
  const col = mix(theme.sky[theme.sky.length - 1], theme.rockD, 0.62);
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
          if (r() < 0.55) {
            // Lit windows alternate between the two theme hues so a distant
            // wall reads as inhabited rather than as a row of identical dots.
            const lit = r() < 0.35 ? theme.accent2 : theme.accent;
            g.rect(wx, wy, 3, 4, darken(lit, 0.25));
            g.rect(wx, wy, 3, 1, lit);
          }
        }
      }
    }
  }
  return bake(g);
}

/**
 * A soft band of coloured haze sitting between the distant and mid layers.
 * Cheap atmospheric perspective: it tints the horizon, separates the parallax
 * planes and is most of what stops the backdrops looking monochrome.
 */
function fogLayer(theme, w, h, seed) {
  const g = new WrapGrid(w, h);
  const r = rng(seed);
  const top = Math.floor(h * 0.34);
  const base = theme.fog;
  for (let y = top; y < h; y++) {
    const k = (y - top) / (h - top);
    // Densest in the middle of the band, fading out top and bottom. Kept
    // light: this is atmosphere behind the level, not a filter over it.
    const density = Math.sin(Math.min(1, k * 1.15) * Math.PI) * 0.26;
    if (density <= 0.02) continue;
    const band = mix(base, lighten(base, 0.35), k);
    for (let x = 0; x < w; x++) {
      const wob = Math.sin(x * 0.035 + y * 0.09) * 0.12;
      g.dither(x, y, 1, 1, null, band, Math.max(0, density + wob));
    }
  }
  // A few brighter wisps drifting through it.
  for (let i = 0; i < 16; i++) {
    const wx = Math.floor(r() * w);
    const wy = top + Math.floor(r() * (h - top) * 0.8);
    const len = 10 + Math.floor(r() * 26);
    for (let d = 0; d < len; d++) {
      if (r() < 0.45) g.set(wx + d, wy + Math.round(Math.sin(d * 0.2) * 1.5), lighten(base, 0.45));
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
    // Two variants per autotile mask. A long flat floor is one mask repeated
    // for the whole level, so a single tile per mask turns the ground into a
    // visibly stamped pattern; alternating two breaks the repeat up.
    const solid = [];
    for (let mask = 0; mask < 16; mask++) {
      solid.push([
        solidTile(theme, mask, ti + 1),
        solidTile(theme, mask, (ti + 1) * 31 + 17),
      ]);
    }
    const lava = [];
    const lavaTop = [];
    for (let f = 0; f < 4; f++) {
      lava.push(lavaTile(theme, f, false));
      lavaTop.push(lavaTile(theme, f, true));
    }
    return {
      theme,
      solid,
      platform: [platformTile(theme, ti + 1), platformTile(theme, (ti + 1) * 13 + 5)],
      spike: spikeTile(theme),
      lava,
      lavaTop,
      back: [backTile(theme, ti + 1), backTile(theme, ti + 11)],
      torch: torchFrames(theme),
      vine: vineTile(theme),
      sky: skyCanvas(theme, viewW, viewH),
      layers: [
        { img: starLayer(theme, viewW, viewH, 1000 + ti), speed: 0.08, y: 0 },
        { img: fogLayer(theme, viewW, viewH, 1500 + ti), speed: 0.14, y: 0 },
        { img: midLayer(theme, viewW, viewH, 2000 + ti), speed: 0.22, y: 0 },
        { img: nearLayer(theme, viewW, viewH, 3000 + ti), speed: 0.45, y: 0 },
      ],
    };
  });
}

export { canvas };
