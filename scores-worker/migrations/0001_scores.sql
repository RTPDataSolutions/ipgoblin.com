-- The goblin arcade's high score tables.

-- Every accepted score, one row per run. This is the audit trail: it is what
-- to read when a score looks wrong, and the boards can be rebuilt from it.
CREATE TABLE runs (
  id         INTEGER PRIMARY KEY,
  game       TEXT    NOT NULL,
  run        TEXT    NOT NULL UNIQUE,  -- the run token's nonce, so a token posts once
  player     TEXT    NOT NULL,         -- random id the browser made up; not an account
  name       TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  level      INTEGER NOT NULL,
  won        INTEGER NOT NULL DEFAULT 0,
  seconds    INTEGER NOT NULL,         -- how long the run token was out
  created_at INTEGER NOT NULL          -- epoch milliseconds
);

CREATE INDEX runs_by_time ON runs (game, created_at);

-- Personal bests: one row per player per board. `board` is 'all' for all time,
-- or an ISO week such as '2026-W40'. A row's score only ever goes up.
CREATE TABLE bests (
  game       TEXT    NOT NULL,
  board      TEXT    NOT NULL,
  player     TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  level      INTEGER NOT NULL,
  won        INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0,  -- moderation; see the README
  PRIMARY KEY (game, board, player)
);

-- Top-N and rank queries walk this in order, so they read only the rows they need.
CREATE INDEX bests_by_rank ON bests (game, board, hidden, score DESC, created_at);

-- Renames, and carrying a hidden player's flag onto each new week's board.
CREATE INDEX bests_by_player ON bests (game, player);
