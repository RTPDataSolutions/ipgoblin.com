/**
 * D1 queries for the tables. Each game has one table, never reset: the top
 * ten players by their best run. Everyone else rolls off the bottom.
 */

export const TABLE_SIZE = 10;

// Ties go to whoever got there first, so a new run has to beat a score, not
// just match it, to knock it off.
const TOP_SQL = `
  SELECT name, score, level, won, created_at, player = ?3 AS you
  FROM bests
  WHERE game = ?1 AND hidden = 0
  ORDER BY score DESC, created_at ASC
  LIMIT ?2`;

const RUN_SQL = `
  INSERT INTO runs (game, run, player, name, score, level, won, seconds, created_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`;

// Only ever moves a best up. `hidden` is left alone, so a hidden player stays hidden.
const BEST_SQL = `
  INSERT INTO bests (game, player, name, score, level, won, created_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  ON CONFLICT (game, player) DO UPDATE SET
    name = excluded.name, score = excluded.score, level = excluded.level,
    won = excluded.won, created_at = excluded.created_at
  WHERE excluded.score > bests.score`;

// A player's name is whatever they used last, even when the run did not beat their best.
const RENAME_SQL = 'UPDATE bests SET name = ?3 WHERE game = ?1 AND player = ?2 AND name <> ?3';

export function tableStatement(db, game, player) {
  return db.prepare(TOP_SQL).bind(game, TABLE_SIZE, player || '');
}

/** The run, the player's best, and the rename. Result 1 says whether the best moved. */
export function submitStatements(db, s) {
  const won = s.won ? 1 : 0;
  return [
    db.prepare(RUN_SQL).bind(s.game, s.nonce, s.player, s.name, s.score, s.level, won, s.seconds, s.now),
    db.prepare(BEST_SQL).bind(s.game, s.player, s.name, s.score, s.level, won, s.now),
    db.prepare(RENAME_SQL).bind(s.game, s.player, s.name),
  ];
}

function entry(row, i) {
  const e = {
    rank: i + 1,
    name: row.name,
    score: row.score,
    level: row.level,
    won: !!row.won,
    at: new Date(row.created_at).toISOString(),
  };
  if (row.you) e.you = true;
  return e;
}

/**
 * The API's table shape. `cutoff` is the score a new run has to beat to get
 * on: the tenth place's, or 0 while there are still empty places.
 */
export function shapeTable(result, limit = TABLE_SIZE) {
  const rows = (result.results || []).map(entry);
  return {
    size: TABLE_SIZE,
    top: rows.slice(0, limit),
    cutoff: rows.length < TABLE_SIZE ? 0 : rows[TABLE_SIZE - 1].score,
  };
}
