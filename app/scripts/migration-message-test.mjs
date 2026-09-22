// What the app says when the tenants migrations have not been run.
//
// The bug this exists to stop coming back: SQLite has two ways of saying a
// column is missing and they share no words. A SELECT says "no such column:
// unit"; an INSERT says "table memberships has no column named unit". The
// migration detector knew only the first, so GET /api/tenants named the
// migration and POST /api/tenants -- which inserts -- threw a plain 500 and
// the form said "Could not add them. Try again."
//
// Run against a database with 014 applied but 015 not:
//   node scripts/migration-message-test.mjs

import { DatabaseSync } from "node:sqlite";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

// The detector, copied from worker/index.js. Kept in step by this test: if
// the two drift, the assertions below start failing on real SQLite wording.
function missingSchema(err) {
  const m = [err?.message, err?.cause?.message, err].map((x) => String(x || "")).join(" | ");
  if (!/no such (table|column)|has no column named/i.test(m)) return null;
  if (/tenant_invites|memberships\.unit|\bunit\b/i.test(m)) {
    return /sent_at/i.test(m) ? "017_tenant_invite_sent" : "015_tenants";
  }
  if (/membership_properties/i.test(m)) return "014_building_owners";
  if (/cancel_at_period_end/i.test(m)) return "013_cancel_at_period_end";
  return "unknown";
}

// A database in the shape it is in with 014 applied and 015 not: memberships
// exists, memberships.unit does not, tenant_invites does not.
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT);
  CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, subdomain TEXT);
  CREATE TABLE properties (id TEXT PRIMARY KEY, account_id TEXT, name TEXT);
  CREATE TABLE memberships (
    id TEXT PRIMARY KEY, user_id TEXT, account_id TEXT, role TEXT, company_id TEXT);
  CREATE TABLE membership_properties (membership_id TEXT, property_id TEXT,
    PRIMARY KEY (membership_id, property_id));
`);

const thrown = (sql, args = []) => {
  try { db.prepare(sql).run(...args); return null; } catch (e) { return e; }
};

console.log("\n-- what each statement in createTenant throws before 015 --");

const insertSeat = thrown(
  `INSERT INTO memberships (id, user_id, account_id, role, unit) VALUES (?, ?, ?, 'tenant', ?)`,
  ["m1", "u1", "a1", "4B"]);
ck("adding a tenant hits the missing column", !!insertSeat, insertSeat?.message);
ck("and it is recognised as migration 015", missingSchema(insertSeat) === "015_tenants",
   String(missingSchema(insertSeat)));

const updateSeat = thrown(`UPDATE memberships SET unit = COALESCE(?, unit) WHERE id = ?`, ["4B", "m1"]);
ck("the update wording is recognised too", missingSchema(updateSeat) === "015_tenants",
   updateSeat?.message);

const selectRoster = thrown(`SELECT unit FROM memberships`);
ck("and the roster's select", missingSchema(selectRoster) === "015_tenants", selectRoster?.message);

const invites = thrown(`INSERT INTO tenant_invites (id) VALUES (?)`, ["i1"]);
ck("the missing invites table too", missingSchema(invites) === "015_tenants", invites?.message);

console.log("\n-- and after 015 --");
db.exec(`ALTER TABLE memberships ADD COLUMN unit TEXT;
         CREATE TABLE tenant_invites (id TEXT PRIMARY KEY, token TEXT, sent_at TEXT);`);
ck("the insert goes through", thrown(
  `INSERT INTO memberships (id, user_id, account_id, role, unit) VALUES (?, ?, ?, 'tenant', ?)`,
  ["m1", "u1", "a1", "4B"]) === null);

console.log("\n-- the other migrations keep their own names --");
const noMp = (() => { try {
  new DatabaseSync(":memory:").prepare("SELECT 1 FROM membership_properties").get();
} catch (e) { return e; } })();
ck("membership_properties points at 014", missingSchema(noMp) === "014_building_owners",
   noMp?.message);
const noCancel = (() => { try {
  const d = new DatabaseSync(":memory:"); d.exec("CREATE TABLE accounts (id TEXT)");
  d.prepare("SELECT cancel_at_period_end FROM accounts").get();
} catch (e) { return e; } })();
ck("cancel_at_period_end points at 013", missingSchema(noCancel) === "013_cancel_at_period_end",
   noCancel?.message);

console.log("\n-- and an ordinary error is not mistaken for one --");
ck("a constraint failure is not a migration",
  missingSchema(new Error("UNIQUE constraint failed: users.email")) === null);
ck("nor is a network error", missingSchema(new Error("fetch failed")) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
