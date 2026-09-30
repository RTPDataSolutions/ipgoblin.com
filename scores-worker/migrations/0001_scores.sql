-- The goblin arcade's high score tables.

-- Every accepted score, one row per run. This is the audit trail: it is what
-- to read when a score looks wrong, and the tables can be rebuilt from it.
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

-- Each player's best run in each game. A row's score only ever goes up. The
-- table people see is the top ten of these and is never reset, so a name
-- stays up until ten better runs push it off.
CREATE TABLE bests (
  game       TEXT    NOT NULL,
  player     TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  level      INTEGER NOT NULL,
  won        INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0,  -- moderation; see the README
  PRIMARY KEY (game, player)
);

-- The top ten is a walk down this index, reading only the rows it returns.
CREATE INDEX bests_by_rank ON bests (game, hidden, score DESC, created_at);
