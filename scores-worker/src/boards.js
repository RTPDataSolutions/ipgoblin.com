/**
 * D1 queries for the boards. Every read is a walk down the `bests_by_rank`
 * index, so a top ten costs about ten rows read however big the table gets.
 */

import { isoWeek, previousWeek } from './weeks.js';

const TOP_SQL = `
  SELECT name, score, level, won, created_at, player = ?4 AS you
  FROM bests
  WHERE game = ?1 AND board = ?2 AND hidden = 0
  ORDER BY score DESC, created_at ASC
  LIMIT ?3`;

// Ties go to whoever got there first, the same order TOP_SQL uses.
const ME_SQL = `
  SELECT b.name, b.score, b.level, b.won, b.created_at,
    1 + (SELECT COUNT(*) FROM bests x
         WHERE x.game = b.game AND x.board = b.board AND x.hidden = 0
           AND x.score >= b.score
           AND (x.score > b.score OR x.created_at < b.created_at)) AS rank
  FROM bests b
  WHERE b.game = ?1 AND b.board = ?2 AND b.player = ?3 AND b.hidden = 0`;

const RUN_SQL = `
  INSERT INTO runs (game, run, player, name, score, level, won, seconds, created_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`;

// Only ever moves a best up. A new row inherits the player's hidden flag, so
// hiding a player also keeps them off every board they reach afterwards.
const BEST_SQL = `
  INSERT INTO bests (game, board, player, name, score, level, won, created_at, hidden)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
    (SELECT COALESCE(MAX(hidden), 0) FROM bests WHERE game = ?1 AND player = ?3))
  ON CONFLICT (game, board, player) DO UPDATE SET
    name = excluded.name, score = excluded.score, level = excluded.level,
    won = excluded.won, created_at = excluded.created_at
  WHERE excluded.score > bests.score`;

// A player's name is whatever they used last, on every board.
const RENAME_SQL = 'UPDATE bests SET name = ?3 WHERE game = ?1 AND player = ?2 AND name <> ?3';

export function boardIds(now) {
  const week = isoWeek(now);
  return { week, last: previousWeek(week) };
}

/** Top of this week, top of all time, last week's winner, and optionally you. */
export function readStatements(db, game, ids, limit, player) {
  const stmts = [
    db.prepare(TOP_SQL).bind(game, ids.week.id, limit, player || ''),
    db.prepare(TOP_SQL).bind(game, 'all', limit, player || ''),
    db.prepare(TOP_SQL).bind(game, ids.last.id, 1, ''),
  ];
  if (player) {
    stmts.push(
      db.prepare(ME_SQL).bind(game, ids.week.id, player),
      db.prepare(ME_SQL).bind(game, 'all', player),
    );
  }
  return stmts;
}

export const READS_WITH_PLAYER = 5;
export const READS_WITHOUT_PLAYER = 3;

/** The run, both personal bests, and the rename. Results 1 and 2 say whether a best moved. */
export function submitStatements(db, s, ids) {
  const won = s.won ? 1 : 0;
  return [
    db.prepare(RUN_SQL).bind(s.game, s.nonce, s.player, s.name, s.score, s.level, won, s.seconds, s.now),
    db.prepare(BEST_SQL).bind(s.game, ids.week.id, s.player, s.name, s.score, s.level, won, s.now),
    db.prepare(BEST_SQL).bind(s.game, 'all', s.player, s.name, s.score, s.level, won, s.now),
    db.prepare(RENAME_SQL).bind(s.game, s.player, s.name),
  ];
}

function entry(row, i) {
  const e = {
    rank: row.rank ?? i + 1,
    name: row.name,
    score: row.score,
    level: row.level,
    won: !!row.won,
    at: new Date(row.created_at).toISOString(),
  };
  if (row.you) e.you = true;
  return e;
}

/** Turns the results of `readStatements` into the API's board shape. */
export function shapeBoards(results, ids, now, player) {
  const [week, all, last, meWeek, meAll] = results.map((r) => r.results || []);
  const out = {
    week: {
      id: ids.week.id,
      ends: new Date(ids.week.end).toISOString(),
      endsIn: Math.max(0, Math.round((ids.week.end - now) / 1000)),
      top: week.map(entry),
    },
    all: { top: all.map(entry) },
    champion: last[0] ? { week: ids.last.id, ...entry(last[0], 0) } : null,
  };
  if (player) {
    out.week.you = meWeek[0] ? entry(meWeek[0]) : null;
    out.all.you = meAll[0] ? entry(meAll[0]) : null;
  }
  return out;
}
