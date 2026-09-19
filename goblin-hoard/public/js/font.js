/**
 * font.js - a 5x7 bitmap font.
 *
 * Canvas `fillText` would be anti-aliased and would fight the pixel grid, so
 * text is a baked atlas instead. Atlases are tinted and cached per colour.
 */

import { canvas } from './pixl.js';

const GW = 5;
const GH = 7;

// Each glyph is 7 rows of 5 cells, '#' on and '.' off.
const GLYPHS = {
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#',
  B: '####./#...#/#...#/####./#...#/#...#/####.',
  C: '.####/#..../#..../#..../#..../#..../.####',
  D: '####./#...#/#...#/#...#/#...#/#...#/####.',
  E: '#####/#..../#..../####./#..../#..../#####',
  F: '#####/#..../#..../####./#..../#..../#....',
  G: '.####/#..../#..../#..##/#...#/#...#/.####',
  H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
  I: '#####/..#../..#../..#../..#../..#../#####',
  J: '...##/....#/....#/....#/....#/#...#/.###.',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#',
  L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#',
  N: '#...#/##..#/#.#.#/#.#.#/#..##/#...#/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
  R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.',
  T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#',
  X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..',
  Z: '#####/....#/...#./..#../.#.../#..../#####',
  0: '.###./#...#/#..##/#.#.#/##..#/#...#/.###.',
  1: '..#../.##../..#../..#../..#../..#../.###.',
  2: '.###./#...#/....#/...#./..#../.#.../#####',
  3: '####./....#/....#/.###./....#/....#/####.',
  4: '#..#./#..#./#..#./#####/...#./...#./...#.',
  5: '#####/#..../####./....#/....#/#...#/.###.',
  6: '..##./.#.../#..../####./#...#/#...#/.###.',
  7: '#####/....#/...#./..#../.#.../.#.../.#...',
  8: '.###./#...#/#...#/.###./#...#/#...#/.###.',
  9: '.###./#...#/#...#/.####/....#/...#./.##..',
  ' ': '...../...../...../...../...../...../.....',
  '.': '...../...../...../...../...../.##../.##..',
  ',': '...../...../...../...../.##../.##../.#...',
  '!': '..#../..#../..#../..#../..#../...../..#..',
  '?': '.###./#...#/....#/...#./..#../...../..#..',
  ':': '...../.##../.##../...../.##../.##../.....',
  "'": '..#../..#../...../...../...../...../.....',
  '-': '...../...../...../#####/...../...../.....',
  '+': '...../..#../..#../#####/..#../..#../.....',
  '/': '....#/....#/...#./..#../.#.../#..../#....',
  '%': '##..#/##.#./...#./..#../.#.../.#.##/#..##',
  '(': '...#./..#../.#.../.#.../.#.../..#../...#.',
  ')': '.#.../..#../...#./...#./...#./..#../.#...',
  '*': '...../#...#/.#.#./..#../.#.#./#...#/.....',
  '@': '.#.#./#####/#####/#####/.###./..#../.....',  // heart
  $: '.###./#.#.#/#.#.#/#.#.#/#.#.#/#.#.#/.###.',   // coin
  '>': '#..../.##../..##./...##/..##./.##../#....',
  '<': '....#/..##./.##../##.../.##../..##./....#',
  '^': '..#../.###./#####/...../...../...../.....',
  '=': '...../...../#####/...../#####/...../.....',
  '_': '...../...../...../...../...../...../#####',
  '[': '.###./.#.../.#.../.#.../.#.../.#.../.###.',
  ']': '.###./...#./...#./...#./...#./...#./.###.',
};

const ORDER = Object.keys(GLYPHS);
const INDEX = new Map(ORDER.map((c, i) => [c, i]));

function buildAtlas() {
  const c = canvas(ORDER.length * (GW + 1), GH);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(c.width, GH);
  const d = img.data;
  ORDER.forEach((ch, gi) => {
    const rows = GLYPHS[ch].split('/');
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        if (rows[y] && rows[y][x] === '#') {
          const px = gi * (GW + 1) + x;
          const o = (y * c.width + px) * 4;
          d[o] = 255; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = 255;
        }
      }
    }
  });
  ctx.putImageData(img, 0, 0);
  return c;
}

export class Font {
  constructor() {
    this.white = buildAtlas();
    this.cache = new Map([['#ffffff', this.white]]);
    this.gw = GW;
    this.gh = GH;
  }

  atlas(color) {
    let c = this.cache.get(color);
    if (c) return c;
    c = canvas(this.white.width, this.white.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(this.white, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    this.cache.set(color, c);
    return c;
  }

  width(text, scale = 1, tracking = 1) {
    if (!text) return 0;
    return (text.length * (GW + tracking) - tracking) * scale;
  }

  /**
   * Draw a string. `align` accepts left/center/right, `shadow` draws a dark
   * copy one pixel down-right, `wave` bobs each character in turn.
   */
  draw(ctx, text, x, y, opts = {}) {
    if (text == null) return;
    const s = String(text).toUpperCase();
    const scale = opts.scale || 1;
    const tracking = opts.tracking ?? 1;
    const color = opts.color || '#ffffff';
    const step = (GW + tracking) * scale;

    let ox = Math.round(x);
    const w = this.width(s, scale, tracking);
    if (opts.align === 'center') ox = Math.round(x - w / 2);
    else if (opts.align === 'right') ox = Math.round(x - w);
    const oy = Math.round(y);

    const paint = (atlas, dx, dy) => {
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        const gi = INDEX.has(ch) ? INDEX.get(ch) : INDEX.get('?');
        if (ch === ' ') continue;
        let wob = 0;
        if (opts.wave) wob = Math.round(Math.sin(opts.wave + i * 0.55) * (opts.waveAmp || 2)) * scale;
        ctx.drawImage(
          atlas, gi * (GW + 1), 0, GW, GH,
          dx + i * step, dy + wob, GW * scale, GH * scale,
        );
      }
    };

    if (opts.shadow) {
      const so = (opts.shadowOffset || 1) * scale;
      paint(this.atlas(opts.shadow === true ? '#000000' : opts.shadow), ox + so, oy + so);
    }
    if (opts.outline) {
      const a = this.atlas(opts.outline);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) paint(a, ox + dx * scale, oy + dy * scale);
    }
    paint(this.atlas(color), ox, oy);
  }
}
