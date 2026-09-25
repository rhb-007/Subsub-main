// A D1 that is really node:sqlite, so routes can be tested against a real
// database instead of a stub that agrees with whatever the test expects.
//
// A hand-written mock answers the query it was told to expect. It cannot
// fail a UNIQUE index, cannot enforce a CHECK, and cannot notice that a
// route forgot its WHERE account_id -- which are exactly the failures worth
// catching in code that moves money. So: apply the real migrations to a real
// SQLite database and give the Worker the four methods it actually uses.
//
// D1's surface, from grepping worker/index.js: prepare().bind().first(),
// .all(), .run(), and DB.batch(). Nothing else.
//
// Not a substitute for running against D1 itself. SQLite here is not the
// build Cloudflare runs, and the differences that matter (concurrency, the
// one-statement-at-a-time console behaviour) are invisible to this. It is
// for what a ROUTE does: what it writes, what it refuses, and what it
// scopes.

import { DatabaseSync } from "node:sqlite";

// D1 returns column values as plain JS; node:sqlite hands back BigInt for
// INTEGER in some builds, and a route comparing 5n === 5 is a bug nobody
// wrote.
const plain = (row) => {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === "bigint" ? Number(v) : v;
  return out;
};

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args); }
  #prep() {
    const s = this.db.prepare(this.sql);
    // undefined is not a SQLite value. D1 takes it as NULL rather than
    // throwing, and routes rely on that.
    return { s, args: this.args.map((a) => (a === undefined ? null : a)) };
  }
  async first() {
    const { s, args } = this.#prep();
    return plain(s.get(...args)) ?? null;
  }
  async all() {
    const { s, args } = this.#prep();
    return { results: (s.all(...args) || []).map(plain), success: true };
  }
  async run() {
    const { s, args } = this.#prep();
    const r = s.run(...args);
    return { success: true, meta: { changes: Number(r.changes ?? 0), last_row_id: Number(r.lastInsertRowid ?? 0) } };
  }
}

export function makeD1(db) {
  return {
    prepare: (sql) => new Stmt(db, sql),
    // D1 batches in one transaction and stops at the first failure. Same
    // here, so a route that relies on a batch being all-or-nothing is
    // tested against that and not against something more forgiving.
    batch: async (stmts) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const st of stmts) out.push(await st.run());
        db.exec("COMMIT");
        return out;
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}

// A database with the real schema on it.
//
// The migrations are applied in order from the folder, which means a
// migration that does not apply cleanly breaks every route test rather than
// being discovered in a console at midnight.
export function freshDb({ migrations, base }) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  if (base) db.exec(base);
  for (const sql of migrations) db.exec(sql);
  return db;
}

// R2, for a route that stores a file.
export const makeR2 = () => {
  const store = new Map();
  return {
    put: async (key, body, opts) => { store.set(key, { body, ...opts }); return { key }; },
    get: async (key) => store.get(key) || null,
    delete: async (key) => { store.delete(key); },
    _store: store,
  };
};
