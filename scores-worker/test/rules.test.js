import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanName, isRude } from '../src/names.js';
import { issueRun, checkRun } from '../src/runs.js';
import { GAMES } from '../src/games.js';

// Keep the rude words out of the test source too.
const rot13 = (s) => s.replace(/[a-z]/gi, (c) => {
  const base = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
});

test('cleanName upper-cases, strips what the fonts cannot draw, and caps the length', () => {
  assert.equal(cleanName('mel'), 'MEL');
  assert.equal(cleanName('  goblin   king  '), 'GOBLIN KIN');
  assert.equal(cleanName('<b>hi</b>'), 'BHIB');
  assert.equal(cleanName('ｇｏｂ'), 'GOB');                      // full-width folds to ASCII
  assert.equal(cleanName('zoë 🎮!'), 'ZOE !');                   // accents drop, emoji go
  assert.equal(cleanName('a.b_c-d?'), 'A.B_C-D?');
  assert.equal(cleanName('   '), '');
  assert.equal(cleanName(42), '');
  assert.equal(cleanName('x'.repeat(10_000)).length, 10);
});

test('isRude catches rude names, including disguised ones', () => {
  for (const n of ['shpx', 'shhhpx', 'S.H.P.X', 'zbz fuvg', 'nff', 'n.f.f', 'wvmm']) {
    const name = cleanName(rot13(n));
    assert.equal(isRude(name), true, `${n} should be refused`);
  }
  assert.equal(isRude(cleanName('5U1T')), false);
  assert.equal(isRude(cleanName(rot13('fuvg').replace('I', '1').replace('i', '1'))), true);
  assert.equal(isRude('1488'), true);
});

test('isRude leaves innocent names alone', () => {
  for (const n of ['CLASSIC', 'BASS', 'GRAPE', 'THERAPIST', 'PEACOCK', 'DICKENS', 'ANALYST', 'TITAN',
    'SWANK', 'TORPEDO', 'ESSEX', 'KNIGHT', 'NIGEL', 'COCKATOO', 'MEL', 'GOBLIN KIN', 'XX_SNIPER']) {
    assert.equal(isRude(n), false, `${n} should be allowed`);
  }
});

test('run tokens round-trip, and refuse tampering, other games and old age', async () => {
  const t0 = Date.parse('2026-09-29T19:00:00Z');
  const token = await issueRun('k', 'ghoul-time', t0);

  assert.deepEqual(await checkRun('k', token, 'ghoul-time', t0 + 90_500), {
    nonce: token.split('.')[2], seconds: 90,
  });
  assert.equal((await checkRun('other-key', token, 'ghoul-time', t0)).error, 'invalid');
  assert.equal((await checkRun('k', token, 'goblin-hoard', t0)).error, 'invalid');
  assert.equal((await checkRun('k', token, 'ghoul-time', t0 + 25 * 3600_000)).error, 'expired');
  assert.equal((await checkRun('k', token, 'ghoul-time', t0 - 5 * 60_000)).error, 'invalid');

  const [g, issued, nonce, sig] = token.split('.');
  const backdated = [g, String(Number(issued) - 3600_000), nonce, sig].join('.');
  assert.equal((await checkRun('k', backdated, 'ghoul-time', t0)).error, 'invalid');
  for (const bad of [null, '', 'a.b.c', `${token}x`, `${token}.x`, 'x'.repeat(500)]) {
    assert.equal((await checkRun('k', bad, 'ghoul-time', t0)).error, 'invalid');
  }
});

test('GOBLIN HOARD refuses scores the levels cannot hold', () => {
  const check = GAMES['goblin-hoard'].implausible;
  assert.equal(check({ score: 5_800, level: 1, won: false, seconds: 40 }), null);
  assert.equal(check({ score: 45_000, level: 4, won: true, seconds: 600 }), null);
  assert.match(check({ score: 9_000, level: 1, won: false, seconds: 400 }), /ceiling/);
  assert.match(check({ score: 20_000, level: 3, won: false, seconds: 12 }), /reached level 3/);
  assert.match(check({ score: 40_000, level: 3, won: true, seconds: 600 }), /won before/);
});

test('GHOUL TIME refuses scores faster than a person could cook', () => {
  const check = GAMES['ghoul-time'].implausible;
  assert.equal(check({ score: 12_000, level: 2, seconds: 90 }), null);
  assert.equal(check({ score: 150_000, level: 12, seconds: 900 }), null);
  assert.match(check({ score: 60_000, level: 1, seconds: 10 }), /pace/);
  assert.match(check({ score: 5_000, level: 5, seconds: 30 }), /reached level 5/);
  assert.match(check({ score: 250_000, level: 2, seconds: 3_000 }), /by level 2/);
});
