import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { fakeD1 } from './d1.js';

const HOARD = 'https://hoard.ipgoblin.com';
const GHOUL = 'https://ghoultime.ipgoblin.com';
const T0 = Date.parse('2026-09-29T19:00:00Z');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const playerId = (n) => `player-${String(n).padStart(4, '0')}-xxxxxxxxxxxx`;

const rot13 = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 52) % 26) + 65));

let env;
let clock;
const realNow = Date.now;
Date.now = () => clock;
after(() => { Date.now = realNow; });

beforeEach(() => {
  env = { DB: fakeD1(), RUN_KEY: 'test-key' };
  clock = T0;
});

const call = (path, init) => worker.fetch(new Request(`https://scores.ipgoblin.com${path}`, init), env);

async function get(path) {
  const r = await call(path);
  return { status: r.status, headers: r.headers, body: await r.json() };
}

async function post(path, body, origin, raw) {
  const headers = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  const r = await call(path, { method: 'POST', headers, body: raw ?? JSON.stringify(body) });
  return { status: r.status, headers: r.headers, body: await r.json() };
}

async function startRun(game, origin) {
  const r = await post(`/v1/${game}/runs`, {}, origin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.run;
}

/** Start a run, let `seconds` pass, post the score. */
async function play(game, fields, seconds = 60) {
  const origin = game === 'goblin-hoard' ? HOARD : GHOUL;
  const run = await startRun(game, origin);
  clock += seconds * 1000;
  return post(`/v1/${game}/scores`, { run, level: 1, ...fields }, origin);
}

const runCount = () => env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM runs').get().n;

test('reads are open to anyone and start empty', async () => {
  const r = await get('/v1/boards');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(Object.keys(r.body.games), ['goblin-hoard', 'ghoul-time']);
  for (const g of Object.values(r.body.games)) {
    assert.deepEqual({ size: g.size, top: g.top, cutoff: g.cutoff }, { size: 10, top: [], cutoff: 0 });
  }
});

test('only the game itself may start runs and post scores', async () => {
  assert.equal((await post('/v1/goblin-hoard/runs', {}, GHOUL)).status, 403);
  assert.equal((await post('/v1/goblin-hoard/runs', {}, null)).status, 403);
  assert.equal((await post('/v1/goblin-hoard/runs', {}, 'http://127.0.0.1:8788')).status, 403);

  env.ALLOW_LOCAL_ORIGINS = 'true';
  assert.equal((await post('/v1/goblin-hoard/runs', {}, 'http://127.0.0.1:8788')).status, 200);

  const pre = await call('/v1/goblin-hoard/scores', {
    method: 'OPTIONS',
    headers: { origin: HOARD, 'access-control-request-method': 'POST' },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), HOARD);
  assert.equal(pre.headers.get('access-control-allow-headers'), 'content-type');
});

test('a posted score lands on the table, once', async () => {
  const run = await startRun('goblin-hoard', HOARD);
  clock += 90_000;
  const body = { run, player: A, name: 'mel', score: 1200, level: 2 };
  const r = await post('/v1/goblin-hoard/scores', body, HOARD);

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.headers.get('access-control-allow-origin'), HOARD);
  assert.deepEqual(r.body.posted, { name: 'MEL', score: 1200, level: 2, won: false, improved: true });
  assert.deepEqual(r.body.top, [{
    rank: 1, name: 'MEL', score: 1200, level: 2, won: false, at: new Date(clock).toISOString(), you: true,
  }]);
  assert.equal(r.body.size, 10);
  assert.equal(r.body.cutoff, 0);

  const again = await post('/v1/goblin-hoard/scores', body, HOARD);
  assert.equal(again.status, 409);
  assert.equal(runCount(), 1);

  const row = env.DB.sqlite.prepare('SELECT seconds, name FROM runs').get();
  assert.deepEqual({ ...row }, { seconds: 90, name: 'MEL' });
});

test('a best only moves up, and a new name follows the player', async () => {
  await play('goblin-hoard', { player: A, name: 'MEL', score: 1200 });
  const r = await play('goblin-hoard', { player: A, name: 'MELLY', score: 800 });

  assert.equal(r.body.posted.improved, false);
  assert.deepEqual(r.body.top.map((e) => [e.name, e.score]), [['MELLY', 1200]]);
  assert.equal(runCount(), 2);
});

test('higher scores rank first, and ties go to whoever got there first', async () => {
  await play('ghoul-time', { player: A, name: 'ANN', score: 1200 });
  await play('ghoul-time', { player: B, name: 'BOB', score: 3000 });
  const r = await play('ghoul-time', { player: C, name: 'CAT', score: 1200 });

  assert.deepEqual(r.body.top.map((e) => [e.rank, e.name, !!e.you]), [
    [1, 'BOB', false], [2, 'ANN', false], [3, 'CAT', true],
  ]);

  const lb = await get(`/v1/ghoul-time/leaderboard?player=${A}&limit=2`);
  assert.equal(lb.status, 200);
  assert.deepEqual(lb.body.top.map((e) => [e.name, !!e.you]), [['BOB', false], ['ANN', true]]);

  const anon = await get('/v1/ghoul-time/leaderboard');
  assert.ok(anon.body.top.every((e) => !e.you));

  // The other game's table is separate.
  assert.deepEqual((await get('/v1/goblin-hoard/leaderboard')).body.top, []);
});

test('the table holds ten, and a better run knocks the tenth off', async () => {
  for (let i = 1; i <= 10; i++) {
    await play('ghoul-time', { player: playerId(i), name: `CHEF ${i}`, score: i * 100 });
  }
  let lb = await get('/v1/ghoul-time/leaderboard');
  assert.equal(lb.body.top.length, 10);
  assert.equal(lb.body.cutoff, 100);
  assert.equal(lb.body.top[9].name, 'CHEF 1');

  // Matching the tenth is not enough: ties go to whoever got there first.
  const tie = await play('ghoul-time', { player: A, name: 'ANN', score: 100 });
  assert.equal(tie.status, 200);
  assert.equal(tie.body.posted.improved, true);
  assert.ok(!tie.body.top.some((e) => e.you), 'a tie does not get on');
  assert.equal(tie.body.cutoff, 100);

  // Beating it does, and CHEF 1 rolls off the bottom.
  const beat = await play('ghoul-time', { player: A, name: 'ANN', score: 150 });
  assert.deepEqual(beat.body.top.slice(-1).map((e) => [e.rank, e.name, e.you]), [[10, 'ANN', true]]);
  assert.equal(beat.body.top.length, 10);
  assert.ok(!beat.body.top.some((e) => e.name === 'CHEF 1'));
  assert.equal(beat.body.cutoff, 150);

  lb = await get(`/v1/ghoul-time/leaderboard?player=${playerId(1)}`);
  assert.ok(!lb.body.top.some((e) => e.you), 'the knocked-off player is no longer on it');

  // Getting back on means beating the new tenth.
  const back = await play('ghoul-time', { player: playerId(1), name: 'CHEF 1', score: 160 });
  assert.equal(back.body.top[9].name, 'CHEF 1');
  assert.ok(!back.body.top.some((e) => e.name === 'ANN'));
});

test('the table is never reset', async () => {
  await play('goblin-hoard', { player: A, name: 'ANN', score: 1000 });
  clock += 400 * 86_400_000;
  const lb = await get('/v1/goblin-hoard/leaderboard');
  assert.deepEqual(lb.body.top.map((e) => [e.name, e.score]), [['ANN', 1000]]);
});

test('scores that do not add up are refused and nothing is written', async () => {
  const cases = [
    [{ player: A, name: 'MEL', score: 9_000, level: 1 }, 'goblin-hoard', 422],
    [{ player: A, name: 'MEL', score: 30_000, level: 3, won: true }, 'goblin-hoard', 422],
    [{ player: A, name: 'MEL', score: 5_000, level: 5 }, 'ghoul-time', 422],
    [{ player: A, name: 'MEL', score: 100, won: true }, 'ghoul-time', 422],
    [{ player: A, name: 'MEL', score: 0 }, 'ghoul-time', 422],
    [{ player: A, name: 'MEL', score: 10.5 }, 'ghoul-time', 422],
    [{ player: A, name: 'MEL', score: '100' }, 'ghoul-time', 422],
    [{ player: A, name: '  ', score: 100 }, 'ghoul-time', 422],
    [{ player: A, name: '-.-', score: 100 }, 'ghoul-time', 422],
    [{ player: A, name: rot13('N.F.F'), score: 100 }, 'ghoul-time', 422],
    [{ player: 'short', name: 'MEL', score: 100 }, 'ghoul-time', 400],
  ];
  for (const [fields, game, status] of cases) {
    const r = await play(game, fields, 30);
    assert.equal(r.status, status, `${JSON.stringify(fields)} -> ${JSON.stringify(r.body)}`);
    assert.equal(typeof r.body.error, 'string');
  }

  const forged = await post('/v1/ghoul-time/scores', {
    run: 'ghoul-time.1790000000000.AAAAAAAAAAAAAAAA.c2lnbmF0dXJl', player: A, name: 'MEL', score: 100, level: 1,
  }, GHOUL);
  assert.equal(forged.status, 422);

  const hoardRun = await startRun('goblin-hoard', HOARD);
  const crossed = await post('/v1/ghoul-time/scores', { run: hoardRun, player: A, name: 'MEL', score: 100, level: 1 }, GHOUL);
  assert.equal(crossed.status, 422);

  const notJson = await post('/v1/ghoul-time/scores', null, GHOUL, 'score=100');
  assert.equal(notJson.status, 400);

  assert.equal(runCount(), 0);
});

test('an old run cannot be posted', async () => {
  const r = await play('ghoul-time', { player: A, name: 'MEL', score: 100 }, 25 * 3600);
  assert.equal(r.status, 422);
  assert.match(r.body.error, /too old/);
});

test('a hidden player drops off the table and stays off', async () => {
  await play('ghoul-time', { player: A, name: 'CHEATER', score: 9000 });
  await play('ghoul-time', { player: B, name: 'BOB', score: 100 });
  env.DB.sqlite.prepare('UPDATE bests SET hidden = 1 WHERE player = ?').run(A);

  const lb = await get(`/v1/ghoul-time/leaderboard?player=${A}`);
  assert.deepEqual(lb.body.top.map((e) => e.name), ['BOB']);

  const r = await play('ghoul-time', { player: A, name: 'CHEATER', score: 9500 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.top.map((e) => e.name), ['BOB']);
});

test('without RUN_KEY the scoreboard says so instead of accepting anything', async () => {
  delete env.RUN_KEY;
  assert.equal((await post('/v1/ghoul-time/runs', {}, GHOUL)).status, 503);
  assert.equal((await get('/v1/ghoul-time/leaderboard')).status, 200);
});

test('rate limits turn requests away with 429', async () => {
  env.SCORE_LIMIT = { limit: async () => ({ success: false }) };
  const run = await startRun('ghoul-time', GHOUL);
  const r = await post('/v1/ghoul-time/scores', { run, player: A, name: 'MEL', score: 100, level: 1 }, GHOUL);
  assert.equal(r.status, 429);
});

test('the page lists every table and escapes what it prints', async () => {
  await play('goblin-hoard', { player: A, name: 'MEL', score: 45_000, level: 4, won: true }, 900);
  env.DB.sqlite.prepare(
    "INSERT INTO bests (game, player, name, score, level, won, created_at) VALUES ('ghoul-time', ?, '<b>x</b>', 5, 1, 0, ?)",
  ).run(B, clock);

  const r = await call('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const html = await r.text();
  assert.match(html, /GOBLIN HOARD/);
  assert.match(html, /GHOUL TIME/);
  assert.match(html, /45,000/);
  assert.match(html, /Beat the Root Daemon/);
  assert.match(html, /9 places left/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /week/i);

  const data = await get('/?format=json');
  assert.equal(data.body.games['goblin-hoard'].top[0].name, 'MEL');
  assert.equal((await get('/v1/boards?limit=1')).body.games['ghoul-time'].top.length, 1);
});

test('unknown games, paths and methods are turned away', async () => {
  assert.equal((await get('/v1/pong/leaderboard')).status, 404);
  assert.equal((await call('/nope')).status, 404);
  assert.equal((await call('/v1/ghoul-time/leaderboard', { method: 'DELETE' })).status, 405);
  assert.equal((await call('/v1/ghoul-time/runs', { method: 'GET', headers: { origin: GHOUL } })).status, 405);
  assert.equal((await call('/help')).status, 200);
});
