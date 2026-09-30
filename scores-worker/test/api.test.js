import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { fakeD1 } from './d1.js';

const HOARD = 'https://hoard.ipgoblin.com';
const GHOUL = 'https://ghoultime.ipgoblin.com';
const T0 = Date.parse('2026-09-29T19:00:00Z');        // a Tuesday, in 2026-W40
const NEXT_WEEK = Date.parse('2026-10-06T12:00:00Z'); // 2026-W41

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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
  assert.equal(r.body.week.id, '2026-W40');
  assert.equal(r.body.week.ends, '2026-10-05T00:00:00.000Z');
  assert.equal(r.body.week.endsIn, 5 * 86400 + 5 * 3600);
  for (const g of Object.values(r.body.games)) {
    assert.deepEqual(g.week.top, []);
    assert.deepEqual(g.all.top, []);
    assert.equal(g.champion, null);
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

test('a posted score lands on both boards, once', async () => {
  const run = await startRun('goblin-hoard', HOARD);
  clock += 90_000;
  const body = { run, player: A, name: 'mel', score: 1200, level: 2 };
  const r = await post('/v1/goblin-hoard/scores', body, HOARD);

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.headers.get('access-control-allow-origin'), HOARD);
  assert.deepEqual(r.body.posted, {
    name: 'MEL', score: 1200, level: 2, won: false, improved: { week: true, all: true },
  });
  assert.deepEqual(r.body.week.top, [{
    rank: 1, name: 'MEL', score: 1200, level: 2, won: false, at: new Date(clock).toISOString(), you: true,
  }]);
  assert.equal(r.body.week.you.rank, 1);
  assert.equal(r.body.all.you.rank, 1);

  const again = await post('/v1/goblin-hoard/scores', body, HOARD);
  assert.equal(again.status, 409);
  assert.equal(runCount(), 1);

  const row = env.DB.sqlite.prepare('SELECT seconds, name FROM runs').get();
  assert.deepEqual({ ...row }, { seconds: 90, name: 'MEL' });
});

test('bests only move up, and a new name follows the player everywhere', async () => {
  await play('goblin-hoard', { player: A, name: 'MEL', score: 1200 });
  const r = await play('goblin-hoard', { player: A, name: 'MELLY', score: 800 });

  assert.deepEqual(r.body.posted.improved, { week: false, all: false });
  assert.equal(r.body.week.top.length, 1);
  assert.equal(r.body.week.top[0].score, 1200);
  assert.equal(r.body.week.top[0].name, 'MELLY');
  assert.equal(r.body.all.top[0].name, 'MELLY');
  assert.equal(runCount(), 2);
});

test('higher scores rank first, and ties go to whoever got there first', async () => {
  await play('ghoul-time', { player: A, name: 'ANN', score: 1200 });
  await play('ghoul-time', { player: B, name: 'BOB', score: 3000 });
  const r = await play('ghoul-time', { player: C, name: 'CAT', score: 1200 });

  assert.deepEqual(r.body.week.top.map((e) => [e.rank, e.name, !!e.you]), [
    [1, 'BOB', false], [2, 'ANN', false], [3, 'CAT', true],
  ]);
  assert.equal(r.body.week.you.rank, 3);

  const lb = await get(`/v1/ghoul-time/leaderboard?player=${A}&limit=2`);
  assert.equal(lb.status, 200);
  assert.deepEqual(lb.body.week.top.map((e) => e.name), ['BOB', 'ANN']);
  assert.equal(lb.body.week.top[1].you, true);
  assert.equal(lb.body.week.top[0].you, undefined);
  assert.equal(lb.body.week.you.rank, 2);
  assert.equal(lb.body.all.you.rank, 2);

  const anon = await get('/v1/ghoul-time/leaderboard');
  assert.equal('you' in anon.body.week, false);
  assert.ok(anon.body.week.top.every((e) => !e.you));

  // The other game's boards are separate.
  assert.deepEqual((await get('/v1/goblin-hoard/leaderboard')).body.week.top, []);
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

test('the weekly board wipes on Monday and remembers its champion', async () => {
  await play('goblin-hoard', { player: A, name: 'ANN', score: 1000 });
  await play('goblin-hoard', { player: B, name: 'BOB', score: 2000 });

  clock = NEXT_WEEK;
  const lb = await get('/v1/goblin-hoard/leaderboard');
  assert.equal(lb.body.week.id, '2026-W41');
  assert.deepEqual(lb.body.week.top, []);
  assert.deepEqual(lb.body.all.top.map((e) => e.name), ['BOB', 'ANN']);
  assert.equal(lb.body.champion.week, '2026-W40');
  assert.equal(lb.body.champion.name, 'BOB');
  assert.equal(lb.body.champion.score, 2000);

  const r = await play('goblin-hoard', { player: A, name: 'ANN', score: 500 });
  assert.deepEqual(r.body.posted.improved, { week: true, all: false });
  assert.deepEqual(r.body.week.top.map((e) => [e.name, e.score]), [['ANN', 500]]);
  assert.equal(r.body.all.you.score, 1000);
  assert.equal(r.body.all.you.rank, 2);
});

test('a hidden player drops off every board and stays off', async () => {
  await play('ghoul-time', { player: A, name: 'CHEATER', score: 9000 });
  await play('ghoul-time', { player: B, name: 'BOB', score: 100 });
  env.DB.sqlite.prepare("UPDATE bests SET hidden = 1 WHERE player = ?").run(A);

  const lb = await get(`/v1/ghoul-time/leaderboard?player=${A}`);
  assert.deepEqual(lb.body.week.top.map((e) => e.name), ['BOB']);
  assert.equal(lb.body.week.you, null);

  clock = NEXT_WEEK;
  const r = await play('ghoul-time', { player: A, name: 'CHEATER', score: 9500 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.week.top, []);
  assert.equal(r.body.week.you, null);
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

test('the page lists every board and escapes what it prints', async () => {
  await play('goblin-hoard', { player: A, name: 'MEL', score: 45_000, level: 4, won: true }, 900);
  env.DB.sqlite.prepare(
    "INSERT INTO bests (game, board, player, name, score, level, won, created_at) VALUES ('ghoul-time', 'all', ?, '<b>x</b>', 5, 1, 0, ?)",
  ).run(B, clock);

  const r = await call('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const html = await r.text();
  assert.match(html, /GOBLIN HOARD/);
  assert.match(html, /GHOUL TIME/);
  assert.match(html, /45,000/);
  assert.match(html, /Beat the Root Daemon/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.doesNotMatch(html, /<script/i);

  const data = await get('/?format=json');
  assert.equal(data.body.games['goblin-hoard'].week.top[0].name, 'MEL');
});

test('unknown games, paths and methods are turned away', async () => {
  assert.equal((await get('/v1/pong/leaderboard')).status, 404);
  assert.equal((await call('/nope')).status, 404);
  assert.equal((await call('/v1/ghoul-time/leaderboard', { method: 'DELETE' })).status, 405);
  assert.equal((await call('/v1/ghoul-time/runs', { method: 'GET', headers: { origin: GHOUL } })).status, 405);
  assert.equal((await call('/help')).status, 200);
});
