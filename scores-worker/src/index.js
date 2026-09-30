/**
 * IP Goblin scores: the high score tables for the goblin arcade.
 *
 *   GET  /                          every table, as a web page
 *   GET  /v1/boards                 every table, as JSON (?limit=1-10, default 3)
 *   GET  /v1/:game/leaderboard      one game's table (?limit=1-10, ?player=<id>)
 *   POST /v1/:game/runs             start a run, get a run token
 *   POST /v1/:game/scores           post a finished run's score
 *
 * Each game has one table, the top ten, and it is never reset: a name stays
 * up until ten better runs push it off.
 *
 * Reads are open to anyone. Writes are only accepted from the game's own
 * origin, need a run token issued when the run started, and have to look like
 * something a person could score in the time the run took.
 */

import { GAMES, GAME_IDS } from './games.js';
import { cleanName, isRude } from './names.js';
import { issueRun, checkRun } from './runs.js';
import { tableStatement, submitStatements, shapeTable, TABLE_SIZE } from './boards.js';
import { renderPage } from './page.js';

const READ_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-max-age': '86400',
};

const PLAYER_RE = /^[A-Za-z0-9_-]{16,64}$/;
const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function json(body, status = 200, headers = {}) {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function text(body, status = 200, headers = {}) {
  return new Response(`${body}\n`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

const fail = (error, status, headers) => json({ error }, status, headers);

function clampInt(raw, min, max, fallback) {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Counted per IP at each Cloudflare location. A missing binding never blocks. */
async function limited(limiter, request) {
  if (!limiter) return false;
  const key = request.headers.get('cf-connecting-ip') || 'unknown';
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch {
    return false;
  }
}

/** The CORS headers for a write, or null when this origin may not write. */
function writeCors(request, env, game) {
  const origin = request.headers.get('origin');
  const ok = origin === GAMES[game].origin ||
    (env.ALLOW_LOCAL_ORIGINS === 'true' && LOCAL_ORIGIN_RE.test(origin || ''));
  if (!ok) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

async function readJson(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) return null;
  const body = await request.text();
  if (body.length > 4096) return null;
  try {
    const v = JSON.parse(body);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ reads */

async function allTables(env, limit) {
  const results = await env.DB.batch(GAME_IDS.map((game) => tableStatement(env.DB, game, '')));
  const games = {};
  GAME_IDS.forEach((game, i) => {
    games[game] = { title: GAMES[game].title, url: GAMES[game].url, ...shapeTable(results[i], limit) };
  });
  return { games };
}

async function getLeaderboard(request, env, game, url) {
  if (await limited(env.READ_LIMIT, request)) return fail('Slow down, the scribes are busy.', 429, READ_CORS);
  const limit = clampInt(url.searchParams.get('limit'), 1, TABLE_SIZE, TABLE_SIZE);
  const p = url.searchParams.get('player') || '';
  const player = PLAYER_RE.test(p) ? p : '';
  const result = await tableStatement(env.DB, game, player).all();
  return json({ game, title: GAMES[game].title, ...shapeTable(result, limit) }, 200, READ_CORS);
}

/* ----------------------------------------------------------------- writes */

async function postRun(request, env, game, cors) {
  if (await limited(env.RUN_LIMIT, request)) return fail('Slow down, the scribes are busy.', 429, cors);
  if (!env.RUN_KEY) return fail('The scoreboard is not set up yet.', 503, cors);
  return json({ run: await issueRun(env.RUN_KEY, game, Date.now()) }, 200, cors);
}

async function postScore(request, env, game, cors) {
  if (await limited(env.SCORE_LIMIT, request)) return fail('Too many scores at once. Wait a minute.', 429, cors);
  if (!env.RUN_KEY) return fail('The scoreboard is not set up yet.', 503, cors);

  const body = await readJson(request);
  if (!body) return fail('Send the score as JSON.', 400, cors);

  const def = GAMES[game];
  const { player, score, level } = body;
  const won = body.won === true;
  if (typeof player !== 'string' || !PLAYER_RE.test(player)) return fail('Missing player id.', 400, cors);
  if (!Number.isSafeInteger(score) || score < 1 || score > 1e9) return fail('That is not a score.', 422, cors);
  if (!Number.isInteger(level) || level < 1 || level > def.maxLevel) return fail('That is not a level.', 422, cors);
  if (won && !def.canWin) return fail('Nobody wins this one.', 422, cors);

  const name = cleanName(body.name);
  if (!/[A-Z0-9]/.test(name)) return fail('Give the goblins a name to carve.', 422, cors);
  if (isRude(name)) return fail('The goblins refuse to carve that. Pick another name.', 422, cors);

  const now = Date.now();
  const run = await checkRun(env.RUN_KEY, body.run, game, now);
  if (run.error === 'expired') return fail('That run is too old to post. Play another!', 422, cors);
  if (run.error) return fail('That run was not started here.', 422, cors);

  const why = def.implausible({ score, level, won, seconds: run.seconds });
  if (why) {
    console.warn(JSON.stringify({ rejected: game, why, name, score, level, won, seconds: run.seconds }));
    return fail('The goblins counted that twice and it does not add up.', 422, cors);
  }

  const writes = submitStatements(env.DB, {
    game, nonce: run.nonce, player, name, score, level, won, seconds: run.seconds, now,
  });
  let results;
  try {
    results = await env.DB.batch([...writes, tableStatement(env.DB, game, player)]);
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(String(err?.message))) {
      return fail('That run is already on the wall.', 409, cors);
    }
    throw err;
  }

  const improved = results[1].meta.changes > 0;
  const table = shapeTable(results[writes.length]);
  return json({ game, title: def.title, posted: { name, score, level, won, improved }, ...table }, 200, cors);
}

/* ----------------------------------------------------------------- router */

const USAGE = `IP GOBLIN SCORES

  GET  /                        every table, as a web page
  GET  /v1/boards               every table, as JSON (?limit=1-10, default 3)
  GET  /v1/<game>/leaderboard   one game's table (?limit=1-10, default 10)
  POST /v1/<game>/runs          start a run (from the game only)
  POST /v1/<game>/scores        post a score (from the game only)

Games: ${GAME_IDS.join(', ')}

Each game has one table: the top ${TABLE_SIZE} players, by their best run. It is
never reset. A name stays up until ${TABLE_SIZE} better runs push it off.

https://ipgoblin.com/#arcade`;

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const read = method === 'GET' || method === 'HEAD';

  if (path === '/favicon.ico') return new Response(null, { status: 204 });

  const m = path.match(/^\/v1\/([a-z0-9-]+)\/(leaderboard|runs|scores)$/);
  if (m) {
    const [, game, action] = m;
    if (!GAMES[game]) return fail(`No game called ${game}.`, 404, READ_CORS);

    if (action === 'leaderboard') {
      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: READ_CORS });
      if (!read) return fail('Read-only.', 405, { ...READ_CORS, allow: 'GET, HEAD, OPTIONS' });
      return getLeaderboard(request, env, game, url);
    }

    const cors = writeCors(request, env, game);
    if (!cors) return fail(`Scores are posted from ${GAMES[game].title} itself.`, 403);
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method !== 'POST') return fail('POST only.', 405, { ...cors, allow: 'POST, OPTIONS' });
    return action === 'runs' ? postRun(request, env, game, cors) : postScore(request, env, game, cors);
  }

  if (!read && method !== 'OPTIONS') return text('The goblins only answer GET here.', 405, { allow: 'GET, HEAD' });
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: READ_CORS });

  if (path === '/v1/boards') {
    if (await limited(env.READ_LIMIT, request)) return fail('Slow down, the scribes are busy.', 429, READ_CORS);
    return json(await allTables(env, clampInt(url.searchParams.get('limit'), 1, TABLE_SIZE, 3)), 200, READ_CORS);
  }

  if (path === '/') {
    if (await limited(env.READ_LIMIT, request)) return text('Slow down, the scribes are busy.', 429);
    const data = await allTables(env, TABLE_SIZE);
    if (url.searchParams.get('format') === 'json') return json(data, 200, READ_CORS);
    return new Response(renderPage(data.games), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  if (path === '/help') return text(USAGE, 200, READ_CORS);

  return text(`No goblin lives at ${path}.\n\n${USAGE}`, 404, READ_CORS);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      console.error(err?.stack || String(err));
      return fail('The scoreboard goblins tripped over something.', 500, READ_CORS);
    }
  },
};
