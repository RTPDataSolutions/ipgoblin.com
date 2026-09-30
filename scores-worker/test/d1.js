/**
 * Just enough of D1 for the tests, on Node's built-in SQLite, with the real
 * migrations applied. Statements bind `?1`-style parameters the way D1 does,
 * and `batch()` is one transaction, as it is on D1.
 */

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

export function fakeD1() {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, dir), 'utf8'));
  }

  class Statement {
    constructor(sql, args = []) {
      this.sql = sql;
      this.args = args;
    }

    bind(...args) { return new Statement(this.sql, args); }

    exec() {
      const stmt = db.prepare(this.sql);
      if (/^\s*SELECT/i.test(this.sql)) {
        return { success: true, results: stmt.all(...this.args).map((r) => ({ ...r })), meta: { changes: 0 } };
      }
      const r = stmt.run(...this.args);
      return { success: true, results: [], meta: { changes: Number(r.changes) } };
    }

    async all() { return this.exec(); }
    async run() { return this.exec(); }
    async first() { return this.exec().results[0] ?? null; }
  }

  return {
    sqlite: db,
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => s.exec());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw new Error(`D1_ERROR: ${err.message}`);
      }
    },
  };
}
