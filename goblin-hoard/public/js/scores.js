/**
 * scores.js - the world high score table, kept by scores.ipgoblin.com.
 *
 * Optional by design. If the scoreboard cannot be reached the game plays
 * exactly as before: the title screen just never flips to the table, and the
 * game over screen says the scoreboard is offline.
 *
 * A run asks for a token when it starts and hands it back with the score,
 * which lets the scoreboard check the score against how long the run took.
 */

const GAME = 'goblin-hoard';
const TIMEOUT_MS = 8000;
const STORE_PLAYER = 'goblin-hoard.player';
const STORE_NAME = 'goblin-hoard.name';

export const NAME_MAX = 10;

// Offered to a first-time player so posting is one keypress. Typing replaces it.
const GOBLIN_NAMES = [
  'GRIMBLE', 'SNAGTOOTH', 'WORTNOSE', 'GRUBNUK', 'SKITTER', 'MUDFLAP', 'NIBBLES',
  'GRISTLE', 'SNIVEL', 'KNUCKLES', 'FESTER', 'DRIBBLE', 'GOBBO', 'SCABBY', 'BOGWART',
];

function apiBase() {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' ? 'http://127.0.0.1:8789' : 'https://scores.ipgoblin.com';
}

/** The scoreboard's own name rules, so what you type is what goes up. */
export function cleanName(raw) {
  return String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ._!?-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

function newPlayerId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Scoreboard {
  constructor(store) {
    this.store = store;
    this.base = apiBase();
    // Not an account: a random id so your best run is one line on the board.
    this.player = store.get(STORE_PLAYER, '');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(this.player)) {
      this.player = newPlayerId();
      store.set(STORE_PLAYER, this.player);
    }
    this.savedName = cleanName(store.get(STORE_NAME, ''));
    this.table = null;
    this.fetchedAt = 0;
    this.loading = null;
    this.triedAt = -Infinity;
    this.run = null;
    this.runReq = null;
  }

  get suggestedName() {
    return this.savedName || GOBLIN_NAMES[Math.floor(Math.random() * GOBLIN_NAMES.length)];
  }

  /** Seconds since the table was fetched. */
  get age() {
    return this.table ? (performance.now() - this.fetchedAt) / 1000 : Infinity;
  }

  async request(path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const init = body === undefined
      ? { signal: ctrl.signal }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal };
    let res;
    try {
      res = await fetch(this.base + path, init);
    } catch {
      throw new Error('Could not reach the scoreboard.');
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(data?.error || `The scoreboard said ${res.status}.`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  accept(data) {
    this.table = data;
    this.fetchedAt = performance.now();
  }

  /**
   * Fetch the table. Never throws; on failure the old table (if any) stays.
   * At most one attempt every ten seconds unless forced, so a scoreboard
   * that is down is not asked again every frame.
   */
  refresh(force = false) {
    if (this.loading) return this.loading;
    if (!force && performance.now() - this.triedAt < 10_000) return Promise.resolve();
    this.triedAt = performance.now();
    this.loading = this.request(`/v1/${GAME}/leaderboard?player=${encodeURIComponent(this.player)}`)
      .then((data) => this.accept(data))
      .catch(() => {})
      .finally(() => { this.loading = null; });
    return this.loading;
  }

  startRun() {
    this.run = null;
    const req = this.request(`/v1/${GAME}/runs`, {})
      .then((data) => { if (this.runReq === req) this.run = data.run; })
      .catch(() => {});
    this.runReq = req;
  }

  /** Whether this run can be posted. Waits for the start request if it is still out. */
  async ready() {
    if (!this.run && this.runReq) await this.runReq;
    return !!this.run;
  }

  async submit({ name, score, level, won }) {
    if (!(await this.ready())) throw new Error('The scoreboard was out of reach when this run started.');
    let data;
    try {
      data = await this.request(`/v1/${GAME}/scores`, {
        run: this.run, player: this.player, name, score, level, won,
      });
    } catch (err) {
      // 409: this run already went up, e.g. an earlier answer never arrived.
      if (err.status !== 409) throw err;
      this.run = null;
      await this.refresh(true);
      return { posted: null, ...this.table };
    }
    this.run = null;
    this.savedName = data.posted.name;
    this.store.set(STORE_NAME, this.savedName);
    this.accept(data);
    return data;
  }
}
