// A JOB WITH NO TRADE CAN NEVER BE ASSIGNED, so approving one is refused
// until the kind of work is named. Reported on a tenant's "Something else"
// report -- torn upholstery -- approved with nothing to send anybody to, which
// then sat at "0/0 trades" for ever.
//
//   node --no-warnings scripts/approve-trade-test.mjs
import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES ('acc_pm','Sound','soundpm','property_manager','scale');
    INSERT INTO users(id,name,email) VALUES ('u_mgr','Chris','c@s.test'), ('u_ten','John','j@s.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_mgr','u_mgr','acc_pm','admin'), ('m_ten','u_ten','acc_pm','tenant');
    INSERT INTO jobs(id,account_id,title,date,trades,status,requested_by) VALUES
      ('j_none','acc_pm','Torn upholstery on lounge chair',NULL,'[]','active','u_ten'),
      ('j_named','acc_pm','Kitchen tap drips',NULL,'["plumbing"]','active','u_ten');
  `);
  return { db, env: { DB: makeD1(db) } };
};
const approve = (env, id, body) => worker.fetch(new Request(`https://api.subsub.work/api/jobs/${id}/approve`, {
  method: "POST", body: JSON.stringify(body || {}),
  headers: { "Content-Type": "application/json", "X-User-Id": "u_mgr", "X-Account-Id": "acc_pm" } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const jobOf = (db, id) => db.prepare(`SELECT approved_at, trades FROM jobs WHERE id = ?`).get(id);

try {
  const { db, env } = seed();
  let [s, b] = await json(await approve(env, "j_none"));
  ck("a request naming no trade is not approved bare", s === 409 && b.error === "trade_required", `${s} ${JSON.stringify(b)}`);
  ck("and nothing was written", !jobOf(db, "j_none").approved_at);
  [s, b] = await json(await approve(env, "j_none", { trades: ["not_a_trade"] }));
  ck("an id SubSub does not know does not count as one", s === 409 && b.error === "trade_required", `${s}`);
  [s, b] = await json(await approve(env, "j_none", { trades: ["handyman_general", "painting"].filter(Boolean) }));
  const t = JSON.parse(jobOf(db, "j_none").trades || "[]");
  ck("naming one approves it", s === 200 && !!jobOf(db, "j_none").approved_at, `${s} ${JSON.stringify(b)}`);
  ck("with the trade written onto the job", t.includes("painting") && !t.includes("handyman_general"), JSON.stringify(t));
  ck("and the reply carries the trades", Array.isArray(b.trades) && b.trades.includes("painting"), JSON.stringify(b));
  [s] = await json(await approve(env, "j_named"));
  ck("a request that already names one approves as before", s === 200, String(s));
  ck("keeping its trade", JSON.parse(jobOf(db, "j_named").trades).join() === "plumbing", jobOf(db, "j_named").trades);
} catch (e) {
  fail++; console.log("FAIL  threw:", e?.stack || e);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
