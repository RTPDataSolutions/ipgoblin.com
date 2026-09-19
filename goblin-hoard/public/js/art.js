/**
 * art.js - every character, pickup and prop in the game, drawn in code.
 *
 * Sprites are built once at boot into small canvases. Each sprite set carries
 * its own anchor (ox/oy) describing how the artwork sits against the entity's
 * collision box, so the game can draw with `x + ox, y + oy` and never think
 * about it again.
 */

import { Grid, bake, bakeFacing, bakeFlash, lighten, darken, rng } from './pixl.js';

export const C = {
  ink: '#0b1207',
  // goblin
  skinD: '#2c6420',
  skin: '#4e9a2d',
  skinL: '#8ede4f',
  skinX: '#bdf391',
  eyeW: '#fdf6d8',
  eyeP: '#d8382f',
  tooth: '#f4efd6',
  tunicD: '#7d2716',
  tunic: '#c2452e',
  tunicL: '#e4714a',
  leatherD: '#43260f',
  leather: '#7d4a1f',
  leatherL: '#b3763a',
  gold: '#ffd23f',
  goldD: '#c08611',
  goldL: '#fff3a8',
  // hardware
  steelD: '#333a4c',
  steel: '#6d768f',
  steelL: '#b9c2d8',
  bone: '#e8e0c8',
  // slime
  oozeD: '#166b4c',
  ooze: '#2fbd83',
  oozeL: '#86f2bd',
  // bat
  batD: '#3a1f57',
  bat: '#7b3fb0',
  batL: '#c079e8',
  // fire / energy
  emberD: '#a0300c',
  ember: '#ef7420',
  emberL: '#ffd23f',
  cyanD: '#12506e',
  cyan: '#2fa5d6',
  cyanL: '#8ce8ff',
  magenta: '#e04fb0',
  white: '#ffffff',
};

/** Bundle grids into a drawable sprite set anchored to a collision box. */
function set(grids, hbW, hbH, feetRow, opts = {}) {
  const w = grids[0].w;
  const h = grids[0].h;
  return {
    w,
    h,
    ox: Math.round((hbW - w) / 2) + (opts.dx || 0),
    oy: hbH - 1 - feetRow + (opts.dy || 0),
    frames: grids.map(bakeFacing),
    flash: grids.map((g) => bakeFlash(g, C.white)),
  };
}

function finish(g, outline) {
  g.rim(0.22, 0.26);
  g.outline(outline || C.ink, true);
  return g;
}

/* ------------------------------------------------------------------ goblin */

const G = { W: 28, H: 30, CX: 14, FEET: 27 };

/**
 * One goblin frame. Everything is positional: give it hand and foot targets
 * and it builds the pose, which makes run cycles and swings a matter of maths
 * rather than redrawing pixels.
 */
function goblin(p = {}) {
  const g = new Grid(G.W, G.H);
  const bob = p.bob || 0;
  const lean = p.lean || 0;
  const crouch = p.crouch || 0;

  const hipY = 18 + bob + crouch;
  const shY = 12 + bob + crouch;
  const cx = G.CX;
  const bodyX = cx + lean;
  const headX = bodyX + (p.headX || 0);
  const headY = 7 + bob + crouch + (p.headY || 0);

  const footF = p.footF || [cx + 2, G.FEET];
  const footB = p.footB || [cx - 3, G.FEET];
  const handF = p.handF || [bodyX + 5, shY + 6];
  const handB = p.handB || [bodyX - 4, shY + 6];

  // --- back limbs, darkened so they read as further away
  g.limb(bodyX - 2, hipY, footB[0], footB[1] - 1, 3, C.tunicD, C.tunicD, 0);
  g.rect(footB[0] - 2, footB[1] - 1, 5, 2, C.leatherD);
  g.limb(bodyX - 1, shY + 1, handB[0], handB[1], 3, C.skinD, C.skinD, 1.6);

  // --- loot sack slung on the back
  const sackX = bodyX - 7, sackY = hipY - 5;
  g.ellipse(sackX, sackY, 4, 4.2, C.leather);
  g.ellipse(sackX - 1, sackY - 1, 2.2, 2, C.leatherL);
  g.rect(sackX - 1, sackY - 5, 3, 2, C.leatherD);
  g.set(sackX, sackY + 1, C.gold);
  g.set(sackX + 1, sackY + 2, C.goldD);

  // --- torso
  g.ellipse(bodyX, shY + 3.5, 5.2, 5.2, C.tunic);
  g.rect(bodyX - 5, shY + 2, 10, 5, C.tunic);
  g.ellipse(bodyX, shY + 6.5, 5.4, 3.4, C.tunic);
  // chest highlight + trim
  g.rect(bodyX - 3, shY, 6, 2, C.tunicL);
  g.rect(bodyX + 3, shY + 1, 2, 6, C.tunicD);
  // belt
  g.rect(bodyX - 5, hipY - 2, 11, 2, C.leatherD);
  g.rect(bodyX, hipY - 2, 2, 2, C.gold);

  // --- front leg
  g.limb(bodyX + 1, hipY, footF[0], footF[1] - 1, 3, C.skin, C.skin, 0);
  g.rect(footF[0] - 2, footF[1] - 1, 6, 2, C.leather);
  g.rect(footF[0] - 2, footF[1] - 1, 6, 1, C.leatherL);

  // --- head
  const hx = headX, hy = headY;
  // big swept-back ear
  const ear = p.ear || 0;
  g.tri(hx - 3, hy - 1, hx - 11, hy - 4 + ear, hx - 3, hy + 4, C.skin);
  g.tri(hx - 4, hy, hx - 9, hy - 2.5 + ear, hx - 4, hy + 2.5, C.skinD);
  // skull + jaw
  g.ellipse(hx, hy, 5.2, 4.6, C.skin);
  g.ellipse(hx + 1, hy + 3, 4.4, 3.2, C.skin);
  g.ellipse(hx - 1, hy - 2, 3.4, 2.2, C.skinL);
  // hooked nose
  g.tri(hx + 2, hy + 0.5, hx + 8, hy + 2.5, hx + 2, hy + 4.5, C.skinL);
  g.tri(hx + 2, hy + 2.5, hx + 6, hy + 3.5, hx + 2, hy + 5, C.skin);
  // brow
  g.line(hx - 3, hy - 2, hx + 3, hy - 3, C.skinD);
  g.line(hx - 3, hy - 1, hx + 3, hy - 2, C.skinD);

  // eyes
  const eye = p.eye || 'open';
  if (eye === 'shut') {
    g.rect(hx - 3, hy, 3, 1, C.ink);
    g.rect(hx + 1, hy - 1, 3, 1, C.ink);
  } else {
    const squint = eye === 'squint' ? 1 : 0;
    const wide = eye === 'wide' ? 1 : 0;
    g.rect(hx - 3, hy - squint, 3, 2 - squint + wide, C.eyeW);
    g.rect(hx + 1, hy - 1 - squint, 3, 2 - squint + wide, C.eyeW);
    g.rect(hx - 2, hy + 1 - squint - wide, 1, 1, C.eyeP);
    g.rect(hx + 2, hy - squint - wide, 1, 1, C.eyeP);
  }

  // mouth + tusks
  const mouth = p.mouth || 0;
  if (mouth > 0) {
    g.rect(hx - 3, hy + 4, 6, 1 + mouth, C.ink);
    g.set(hx - 2, hy + 4, C.tooth);
    g.set(hx + 2, hy + 4, C.tooth);
  } else {
    g.rect(hx - 3, hy + 5, 6, 1, C.skinD);
  }
  g.set(hx - 2, hy + 3, C.tooth);
  g.set(hx + 2, hy + 3, C.tooth);

  // leather cap with a gold band
  g.ellipse(hx - 1, hy - 3.5, 5.4, 3, C.leather);
  g.rect(hx - 6, hy - 3, 11, 1, C.leatherL);
  g.set(hx + 3, hy - 5, C.gold);
  g.rect(hx - 6, hy - 2, 3, 1, C.leatherD);

  // --- front arm, drawn last so it sits over the torso
  g.limb(bodyX + 2, shY + 1, handF[0], handF[1], 3, C.skinL, C.skinL, 1.8);
  // bracer
  g.rect(handF[0] - 2, handF[1] - 3, 3, 2, C.leather);

  return finish(g);
}

function goblinFrames() {
  const cx = G.CX;
  const F = G.FEET;
  const stand = { footF: [cx + 2, F], footB: [cx - 3, F] };

  const idle = [
    goblin({ ...stand, bob: 0, ear: 0, handF: [cx + 6, 19], handB: [cx - 5, 19] }),
    goblin({ ...stand, bob: 1, ear: 1, handF: [cx + 6, 20], handB: [cx - 5, 20], eye: 'squint' }),
    goblin({ ...stand, bob: 1, ear: 1, handF: [cx + 6, 20], handB: [cx - 5, 20] }),
    goblin({ ...stand, bob: 0, ear: 0, handF: [cx + 6, 19], handB: [cx - 5, 19], eye: 'squint' }),
  ];

  // Run cycle: feet travel an ellipse, arms counter-swing, body bobs twice.
  const run = [];
  const STEPS = 8;
  for (let i = 0; i < STEPS; i++) {
    const a = (i / STEPS) * Math.PI * 2;
    const footAt = (ang) => {
      const lift = Math.max(0, Math.sin(ang));
      return [cx + Math.cos(ang) * 5.5, F - lift * 6];
    };
    const handAt = (ang) => [cx + Math.cos(ang) * 5.5 + 1, 18 - Math.sin(ang) * 2.5];
    run.push(goblin({
      footF: footAt(a),
      footB: footAt(a + Math.PI),
      handF: handAt(a + Math.PI),
      handB: handAt(a),
      bob: -Math.abs(Math.sin(a)) > -0.5 ? 0 : -1,
      lean: 1,
      ear: Math.sin(a) > 0 ? -1 : 1,
      mouth: 1,
      eye: 'squint',
    }));
  }

  const jump = [goblin({
    footF: [cx + 4, F - 3], footB: [cx - 2, F - 6],
    handF: [cx + 4, 8], handB: [cx - 6, 10],
    bob: -1, lean: 1, ear: -2, mouth: 1, eye: 'wide',
  })];

  const fall = [goblin({
    footF: [cx + 5, F - 1], footB: [cx - 5, F - 4],
    handF: [cx + 7, 9], handB: [cx - 7, 9],
    bob: 0, ear: 2, mouth: 1, eye: 'wide',
  })];

  // Whip swing: wind back, snap forward, recover.
  const attack = [
    goblin({ ...stand, handF: [cx - 3, 9], handB: [cx - 5, 18], lean: -1, ear: -1, eye: 'squint', mouth: 1 }),
    goblin({ footF: [cx + 4, F], footB: [cx - 4, F], handF: [cx + 9, 13], handB: [cx - 4, 20], lean: 2, ear: 2, mouth: 2, eye: 'wide' }),
    goblin({ footF: [cx + 3, F], footB: [cx - 4, F], handF: [cx + 8, 17], handB: [cx - 5, 20], lean: 1, ear: 1, mouth: 1, eye: 'squint' }),
  ];

  const hurt = [goblin({
    footF: [cx + 5, F - 1], footB: [cx - 5, F],
    handF: [cx + 2, 8], handB: [cx - 7, 9],
    lean: -2, headX: -1, ear: 3, mouth: 2, eye: 'shut',
  })];

  const crouch = [goblin({
    footF: [cx + 4, F], footB: [cx - 4, F],
    handF: [cx + 5, 22], handB: [cx - 5, 22],
    crouch: 4, ear: 2, eye: 'squint',
  })];

  const dead = [goblin({
    footF: [cx + 6, F], footB: [cx - 6, F],
    handF: [cx + 7, 24], handB: [cx - 7, 24],
    crouch: 7, ear: 4, eye: 'shut', mouth: 2,
  })];

  return {
    idle: set(idle, 12, 20, G.FEET),
    run: set(run, 12, 20, G.FEET),
    jump: set(jump, 12, 20, G.FEET),
    fall: set(fall, 12, 20, G.FEET),
    attack: set(attack, 12, 20, G.FEET),
    hurt: set(hurt, 12, 20, G.FEET),
    crouch: set(crouch, 12, 20, G.FEET),
    dead: set(dead, 12, 20, G.FEET),
  };
}

/* ----------------------------------------------------------------- enemies */

/** Packet Slime: a hopping blob of leaked traffic. */
function slimeFrames() {
  const frames = [];
  const poses = [
    { rx: 7, ry: 5.2, dy: 0 },
    { rx: 7.8, ry: 4.2, dy: 1 },
    { rx: 6, ry: 7, dy: -1 },
    { rx: 6.6, ry: 6, dy: 0 },
  ];
  for (const pose of poses) {
    const g = new Grid(18, 16);
    const cy = 13 - pose.ry + pose.dy;
    g.ellipse(9, cy + pose.ry - 0.5, pose.rx, pose.ry, C.ooze);
    g.rect(9 - pose.rx, cy + pose.ry - 1, pose.rx * 2, 1.5, C.ooze);
    g.ellipse(7, cy + pose.ry * 0.5, pose.rx * 0.55, pose.ry * 0.4, C.oozeL);
    g.ellipse(9, cy + pose.ry * 1.4, pose.rx * 0.8, pose.ry * 0.4, C.oozeD);
    // drips
    g.set(9 + pose.rx - 2, cy + pose.ry * 1.7, C.oozeD);
    // eyes
    g.rect(6, cy + pose.ry - 1, 2, 2, C.eyeW);
    g.rect(11, cy + pose.ry - 1, 2, 2, C.eyeW);
    g.set(7, cy + pose.ry, C.ink);
    g.set(12, cy + pose.ry, C.ink);
    frames.push(finish(g));
  }
  return set(frames, 12, 11, 13);
}

/** Byte Bat: flits in a sine wave, then dives. */
function batFrames() {
  const frames = [];
  const spans = [
    [-6, -2, 6, -2],
    [-8, -5, 8, -5],
    [-9, 1, 9, 1],
    [-7, 3, 7, 3],
  ];
  for (const [lx, ly, rx2, ry2] of spans) {
    const g = new Grid(24, 18);
    const cx = 12, cy = 8;
    // wings
    g.tri(cx - 2, cy - 1, cx + lx, cy + ly, cx - 2, cy + 4, C.bat);
    g.tri(cx + 2, cy - 1, cx + rx2, cy + ry2, cx + 2, cy + 4, C.bat);
    g.tri(cx - 2, cy + 1, cx + lx * 0.7, cy + ly * 0.7 + 2, cx - 2, cy + 4, C.batD);
    g.tri(cx + 2, cy + 1, cx + rx2 * 0.7, cy + ry2 * 0.7 + 2, cx + 2, cy + 4, C.batD);
    // body
    g.ellipse(cx, cy + 1, 3.4, 4, C.batL);
    g.ellipse(cx, cy + 3, 2.6, 2.6, C.bat);
    // ears
    g.tri(cx - 3, cy - 2, cx - 4, cy - 6, cx - 1, cy - 3, C.batL);
    g.tri(cx + 3, cy - 2, cx + 4, cy - 6, cx + 1, cy - 3, C.batL);
    // face
    g.set(cx - 2, cy, C.emberL);
    g.set(cx + 2, cy, C.emberL);
    g.rect(cx - 1, cy + 2, 3, 1, C.tooth);
    frames.push(finish(g));
  }
  return set(frames, 14, 12, 12);
}

/** Firewall Knight: armoured, blocks attacks from the front. */
function knightFrames() {
  const frames = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const g = new Grid(26, 30);
    const cx = 13, feet = 27;
    const step = Math.cos(a) * 3;
    const bob = Math.abs(Math.sin(a)) > 0.7 ? -1 : 0;
    // legs
    g.limb(cx - 1, 19 + bob, cx - 1 - step, feet - 1, 4, C.steelD, C.steelD, 0);
    g.limb(cx + 1, 19 + bob, cx + 1 + step, feet - 1, 4, C.steel, C.steel, 0);
    g.rect(cx - 4 - step, feet - 1, 6, 2, C.steelD);
    g.rect(cx - 1 + step, feet - 1, 6, 2, C.steelD);
    // torso
    g.rect(cx - 5, 10 + bob, 11, 10, C.steel);
    g.ellipse(cx, 11 + bob, 6, 3.6, C.steelL);
    g.rect(cx - 5, 18 + bob, 11, 2, C.steelD);
    g.rect(cx - 1, 12 + bob, 2, 6, C.emberD);
    // head
    g.rect(cx - 4, 3 + bob, 9, 7, C.steel);
    g.ellipse(cx, 4 + bob, 4.6, 3, C.steelL);
    g.rect(cx - 3, 6 + bob, 7, 2, C.ink);
    g.rect(cx + 1, 6 + bob, 2, 2, C.emberL);
    g.rect(cx - 2, 6 + bob, 2, 2, C.ember);
    // plume - the loudest thing on the sprite, kept inside the grid so the
    // outline pass has a margin to work with
    g.rect(cx - 2, 3 + bob, 5, 3, C.emberD);
    g.rect(cx - 1, 2 + bob, 3, 4, C.ember);
    g.rect(cx, 2 + bob, 2, 2, C.emberL);
    // shield on the leading side, gold-rimmed so it is obvious what blocks
    g.rect(cx + 5, 8 + bob, 6, 15, C.goldD);
    g.rect(cx + 6, 9 + bob, 4, 13, C.steelL);
    g.rect(cx + 6, 9 + bob, 4, 2, C.white);
    g.rect(cx + 6, 14 + bob, 4, 4, C.emberD);
    g.rect(cx + 7, 15 + bob, 2, 2, C.emberL);
    frames.push(finish(g));
  }
  return set(frames, 14, 22, 27);
}

/** Router Golem: bolted to the wall, spits packets at you. */
function turretFrames() {
  const build = (charge) => {
    const g = new Grid(24, 24);
    const cx = 12, cy = 13;
    // stone housing
    g.rect(4, 6, 16, 15, C.steelD);
    g.rect(5, 7, 14, 13, C.steel);
    g.rect(5, 7, 14, 2, C.steelL);
    g.rect(2, 19, 20, 4, C.steelD);
    g.rect(3, 20, 18, 2, C.steel);
    // rivets
    for (const [rx, ry] of [[6, 9], [17, 9], [6, 18], [17, 18]]) g.set(rx, ry, C.steelL);
    // glowing eye socket
    const glow = charge > 0 ? C.emberL : C.emberD;
    g.rect(7, 11, 10, 6, C.ink);
    g.ellipse(cx, cy + 1, 4 + charge, 2.4 + charge * 0.6, glow);
    g.ellipse(cx, cy + 1, 2 + charge, 1.2 + charge * 0.4, charge > 0 ? C.white : C.ember);
    // barrel
    g.rect(18, 11, 5, 5, C.steelD);
    g.rect(19, 12, 4, 3, C.steel);
    if (charge > 0) g.rect(22, 12, 2, 3, C.emberL);
    // antenna
    g.rect(11, 1, 2, 5, C.steelD);
    g.ellipse(12, 1, 2, 2, charge > 0 ? C.emberL : C.cyan);
    return finish(g);
  };
  return set([build(0), build(0.5), build(1), build(0.5)], 18, 20, 22);
}

/** THE ROOT DAEMON: the level-four boss, a floating mainframe skull. */
function bossFrames() {
  const build = (t, hurtPose) => {
    const g = new Grid(64, 56);
    const cx = 32;
    const cy = 26 + Math.round(Math.sin(t * Math.PI * 2) * 2);
    // outer casing
    g.ellipse(cx, cy, 24, 18, C.steelD);
    g.ellipse(cx, cy - 2, 22, 15, C.steel);
    g.ellipse(cx, cy - 6, 18, 8, C.steelL);
    // jaw
    g.ellipse(cx, cy + 12, 16, 8, C.steel);
    g.rect(cx - 15, cy + 10, 30, 6, C.steelD);
    for (let i = 0; i < 7; i++) g.rect(cx - 13 + i * 4, cy + 10, 2, 4, C.bone);
    // eye sockets
    const eyeC = hurtPose ? C.white : C.emberL;
    g.ellipse(cx - 9, cy - 1, 6, 5, C.ink);
    g.ellipse(cx + 9, cy - 1, 6, 5, C.ink);
    const pulse = 2.2 + Math.sin(t * Math.PI * 4) * 0.8;
    g.ellipse(cx - 9, cy, pulse + 1, pulse, C.emberD);
    g.ellipse(cx + 9, cy, pulse + 1, pulse, C.emberD);
    g.ellipse(cx - 9, cy, pulse - 0.4, pulse - 0.8, eyeC);
    g.ellipse(cx + 9, cy, pulse - 0.4, pulse - 0.8, eyeC);
    // nose vent
    g.tri(cx, cy + 3, cx - 3, cy + 8, cx + 3, cy + 8, C.ink);
    // horns / heatsinks
    g.tri(cx - 20, cy - 8, cx - 30, cy - 22, cx - 12, cy - 14, C.steel);
    g.tri(cx + 20, cy - 8, cx + 30, cy - 22, cx + 12, cy - 14, C.steel);
    g.tri(cx - 20, cy - 9, cx - 26, cy - 18, cx - 15, cy - 13, C.steelL);
    g.tri(cx + 20, cy - 9, cx + 26, cy - 18, cx + 15, cy - 13, C.steelL);
    // status lights
    for (let i = 0; i < 5; i++) {
      const on = (Math.floor(t * 8) + i) % 3 === 0;
      g.rect(cx - 10 + i * 5, cy - 13, 2, 2, on ? C.cyanL : C.cyanD);
    }
    // cabling
    g.thickLine(cx - 22, cy + 6, cx - 28, cy + 16, 2, C.cyanD);
    g.thickLine(cx + 22, cy + 6, cx + 28, cy + 16, 2, C.cyanD);
    return finish(g);
  };
  const frames = [];
  for (let i = 0; i < 6; i++) frames.push(build(i / 6, false));
  return set(frames, 48, 44, 52);
}

/* --------------------------------------------------------- shots & pickups */

function shotFrames(color, glow, size) {
  const frames = [];
  for (let i = 0; i < 4; i++) {
    const g = new Grid(size * 2 + 4, size * 2 + 4);
    const c = size + 2;
    const w = size + Math.sin((i / 4) * Math.PI * 2) * 0.6;
    g.ellipse(c, c, w, w * 0.85, color);
    g.ellipse(c - 0.5, c - 0.5, w * 0.5, w * 0.45, glow);
    g.set(c + Math.round(w), c, color);
    frames.push(finish(g));
  }
  return set(frames, size * 2, size * 2, size * 2 + 2);
}

function coinFrames() {
  const frames = [];
  const widths = [4, 3, 1.4, 3];
  for (const w of widths) {
    const g = new Grid(12, 12);
    g.ellipse(6, 6, w, 4.4, C.goldD);
    g.ellipse(6, 5.4, w * 0.75, 3.4, C.gold);
    if (w > 2) {
      g.ellipse(5.4, 4.6, w * 0.35, 1.4, C.goldL);
      g.rect(6, 4, 1, 4, C.goldD);
    }
    frames.push(finish(g));
  }
  return set(frames, 10, 10, 11);
}

function gemFrames() {
  const frames = [];
  for (let i = 0; i < 4; i++) {
    const g = new Grid(14, 14);
    const cx = 7, cy = 7 + Math.round(Math.sin((i / 4) * Math.PI * 2));
    g.tri(cx, cy - 5, cx - 4, cy - 1, cx + 4, cy - 1, C.cyanL);
    g.tri(cx - 4, cy - 1, cx + 4, cy - 1, cx, cy + 5, C.cyan);
    g.tri(cx - 4, cy - 1, cx, cy - 5, cx, cy + 5, C.cyanD);
    g.set(cx + 1, cy - 3, C.white);
    if (i === 1) g.set(cx + 3, cy - 4, C.white);
    frames.push(finish(g));
  }
  return set(frames, 12, 12, 13);
}

function heartFrames() {
  const frames = [];
  for (let i = 0; i < 4; i++) {
    const g = new Grid(14, 14);
    const s = 1 + Math.sin((i / 4) * Math.PI * 2) * 0.12;
    const cx = 7, cy = 7;
    g.ellipse(cx - 2.2 * s, cy - 1.4 * s, 2.6 * s, 2.6 * s, C.eyeP);
    g.ellipse(cx + 2.2 * s, cy - 1.4 * s, 2.6 * s, 2.6 * s, C.eyeP);
    g.tri(cx - 4.6 * s, cy - 0.6 * s, cx + 4.6 * s, cy - 0.6 * s, cx, cy + 5 * s, C.eyeP);
    g.ellipse(cx - 2.2 * s, cy - 2.4 * s, 1.2 * s, 1 * s, C.tunicL);
    frames.push(finish(g));
  }
  return set(frames, 12, 12, 13);
}

function chestFrames() {
  const build = (open) => {
    const g = new Grid(22, 20);
    g.rect(2, 9, 18, 10, C.leatherD);
    g.rect(3, 10, 16, 8, C.leather);
    g.rect(3, 10, 16, 2, C.leatherL);
    g.rect(2, 17, 18, 2, C.leatherD);
    if (open) {
      g.rect(1, 2, 20, 4, C.leather);
      g.rect(1, 2, 20, 2, C.leatherL);
      g.ellipse(11, 9, 7, 2.5, C.gold);
      g.ellipse(8, 8, 2, 1.4, C.goldL);
      g.ellipse(14, 8, 1.6, 1.2, C.goldL);
    } else {
      g.ellipse(11, 9, 9, 5, C.leather);
      g.rect(2, 9, 18, 2, C.leatherD);
      g.ellipse(11, 7, 8, 3, C.leatherL);
      g.rect(9, 8, 4, 5, C.gold);
      g.rect(10, 10, 2, 2, C.goldD);
    }
    // corner bands
    g.rect(2, 9, 2, 10, C.goldD);
    g.rect(18, 9, 2, 10, C.goldD);
    return finish(g);
  };
  return { closed: set([build(false)], 18, 16, 19), open: set([build(true)], 18, 16, 19) };
}

/** The level exit: a goblin-green portal arch. */
function doorFrames() {
  const frames = [];
  for (let i = 0; i < 6; i++) {
    const g = new Grid(34, 44);
    const t = i / 6;
    // stone arch
    g.rect(2, 6, 30, 37, C.steelD);
    g.ellipse(17, 8, 15, 9, C.steelD);
    g.rect(5, 10, 24, 33, C.steel);
    g.ellipse(17, 11, 12, 8, C.steel);
    g.rect(0, 40, 34, 4, C.steelD);
    // portal interior
    g.rect(8, 14, 18, 26, C.ink);
    g.ellipse(17, 15, 9, 6, C.ink);
    for (let y = 0; y < 26; y++) {
      const wob = Math.sin((y / 26) * Math.PI * 3 + t * Math.PI * 2) * 2;
      const w = 8 - Math.abs(y - 13) * 0.15;
      g.dither(17 - w + wob, 14 + y, w * 2, 1, C.skinD, C.skinL, 0.35 + Math.sin(y * 0.6 + t * 6) * 0.3);
    }
    // keystone + torches
    g.rect(15, 3, 5, 5, C.gold);
    g.rect(16, 4, 3, 3, C.goldL);
    const flick = 1 + Math.sin(t * Math.PI * 2) * 0.6;
    g.ellipse(4, 16, 2, 2 + flick, C.ember);
    g.ellipse(30, 16, 2, 2 + flick, C.ember);
    g.ellipse(4, 16, 1, 1 + flick * 0.5, C.emberL);
    g.ellipse(30, 16, 1, 1 + flick * 0.5, C.emberL);
    frames.push(finish(g));
  }
  return set(frames, 26, 40, 43);
}

/** Big gold "!" marker that floats over a dropped key item. */
function keyFrames() {
  const frames = [];
  for (let i = 0; i < 4; i++) {
    const g = new Grid(16, 16);
    const cy = 8 + Math.round(Math.sin((i / 4) * Math.PI * 2));
    g.circle(5, cy, 3.4, C.gold);
    g.circle(5, cy, 1.6, null);
    g.erase(3, cy - 2, 4, 4);
    g.circle(5, cy, 3.4, C.gold);
    g.ellipse(5, cy, 1.5, 1.5, C.ink);
    g.rect(7, cy - 1, 7, 2, C.gold);
    g.rect(11, cy + 1, 2, 2, C.gold);
    g.rect(13, cy + 1, 1, 3, C.gold);
    g.rect(7, cy - 1, 7, 1, C.goldL);
    frames.push(finish(g));
  }
  return set(frames, 12, 12, 14);
}

export function buildArt() {
  const art = {
    goblin: goblinFrames(),
    slime: slimeFrames(),
    bat: batFrames(),
    knight: knightFrames(),
    turret: turretFrames(),
    boss: bossFrames(),
    shot: shotFrames(C.ember, C.emberL, 3),
    bossShot: shotFrames(C.magenta, C.white, 5),
    coin: coinFrames(),
    gem: gemFrames(),
    heart: heartFrames(),
    chest: chestFrames(),
    door: doorFrames(),
    key: keyFrames(),
  };
  return art;
}

/** A little goblin head used as the life counter in the HUD. */
export function buildHudIcons() {
  const head = new Grid(12, 12);
  head.tri(4, 5, 0, 2, 4, 9, C.skin);
  head.ellipse(6, 5.5, 4, 4, C.skin);
  head.ellipse(5, 4, 2.6, 1.8, C.skinL);
  head.rect(3, 5, 2, 2, C.eyeW);
  head.rect(7, 5, 2, 2, C.eyeW);
  head.set(4, 6, C.eyeP);
  head.set(8, 6, C.eyeP);
  head.rect(4, 9, 5, 1, C.skinD);
  head.set(4, 8, C.tooth);
  head.set(8, 8, C.tooth);
  finish(head);

  const skull = head.clone();
  skull.replace(C.skin, '#7a8a72');
  skull.replace(C.skinL, '#9dad94');
  skull.replace(C.skinD, '#4c5748');
  skull.replace(C.eyeP, '#2b2b2b');

  return { head: bake(head), skull: bake(skull) };
}

export { rng, lighten, darken };
