// An account's own payment-fee terms, set from the staff console.
//
// SubSub's fee defaults to 0.5%, at most $500 a payment, with the first
// $50,000 an account sends through SubSub free (shared/fee.js). Staff can set
// a different rate, cap or free amount for one account; 071 holds it.
//
// What this pins: support can read the terms and only a superadmin can set
// them; a slipped decimal is refused; a reason is required; every change is
// audited with the old terms and the new; and "back to standard" deletes the
// row, so the account follows the defaults again. That the terms are then
// what is CHARGED is pinned in test:escrow, which pays a release on an
// account with its own rate.
//
//   node --no-warnings scripts/fee-terms-test.mjs

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";

const supa = createServer((req, res) => {
  const who = String(req.headers.authorization || "").replace("Bearer ", "");
  if (!who || who === "nobody") { res.writeHead(401); return res.end("{}"); }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id: `auth_${who}`, email: `${who}@subsub.test` }));
}).listen(8928);

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const APP = readFileSync(join(app, "src", "App.tsx"), "utf8");

const seed = ({ migrated = true } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  if (!migrated) db.exec(`DROP TABLE account_fee_terms`);
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_gc','Outerhome','general_contractor','outerhome','scale');
    INSERT INTO companies(id,company) VALUES ('cmp_roof','Cascade Roofworks');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_super','Richard','super@subsub.test','auth_super'),
      ('u_plain','Helper','plain@subsub.test','auth_plain');
    INSERT INTO superadmins(user_id,role,finance,impersonate) VALUES
      ('u_super','superadmin',1,1), ('u_plain','standard',0,0);
  `);
  return { db, env: { DB: makeD1(db),
    SUPABASE_URL: "http://127.0.0.1:8928", SUPABASE_ANON_KEY: "stub", STAFF_ALLOW_PASSWORD: "1" } };
};

const call = (env, path, opts = {}, who = "super") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method: opts.method || "GET",
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${who}` },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const URL_ = "/api/platform/accounts/acc_gc/fee-terms";
const put = (env, body, who) => call(env, URL_, { method: "PUT", body }, who);

try {
  console.log("\n-- the standard terms, and how much is used --");
  {
    const { db, env } = seed();
    db.exec(`
      INSERT INTO engagements(id,account_id,company_id,status) VALUES ('en1','acc_gc','cmp_roof','active');
      INSERT INTO jobs(id,account_id,title,trades) VALUES ('job1','acc_gc','Re-roof','["roofing"]');
      INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,value_cents,status)
        VALUES ('wo1','WO-1','job1','roofing','cmp_roof','en1',3000000,'accepted');
      INSERT INTO wo_milestones(id,work_order_id,account_id,seq,label,amount_cents,status) VALUES
        ('m1','wo1','acc_gc',1,'a',2000000,'verified'), ('m2','wo1','acc_gc',2,'b',1000000,'verified');
      INSERT INTO wo_releases(id,work_order_id,account_id,milestone_id,company_id,gross_cents,net_cents,status,method) VALUES
        ('r1','wo1','acc_gc','m1','cmp_roof',2000000,2000000,'paid','stripe'),
        -- A check: nothing went through SubSub, so it uses none of the free amount.
        ('r2','wo1','acc_gc','m2','cmp_roof',1000000,1000000,'paid','check');`);
    const [s, b] = await json(await call(env, URL_, {}, "plain"));
    ck("support can read them", s === 200, `${s} ${JSON.stringify(b)}`);
    ck("the standard terms", b.terms?.bps === 50 && b.terms?.capCents === 50000 && b.terms?.freeCents === 5_000_000
      && b.custom === false, JSON.stringify(b));
    ck("and what has gone through SubSub, checks excluded",
      b.processedCents === 2_000_000 && b.freeLeftCents === 3_000_000, JSON.stringify(b));
  }

  console.log("\n-- setting them --");
  {
    const { db, env } = seed();
    let [s, b] = await json(await put(env, { bps: 25, capCents: 25000, freeCents: 10_000_000, note: "Design partner" }, "plain"));
    ck("support cannot set them -- it is pricing", s === 403, `${s} ${JSON.stringify(b)}`);
    ck("and nothing was written", db.prepare(`SELECT COUNT(*) n FROM account_fee_terms`).get().n === 0);

    [s, b] = await json(await put(env, { bps: 25, capCents: 25000, freeCents: 10_000_000 }));
    ck("a reason is required -- a rate nobody can explain becomes permanent",
      s === 400 && b.error === "reason_required", `${s} ${JSON.stringify(b)}`);
    [s, b] = await json(await put(env, { bps: 5000, capCents: 25000, freeCents: 0, note: "x" }));
    ck("a slipped decimal is refused -- 50% is not a rate anybody means", s === 400 && b.error === "bad_rate", JSON.stringify(b));
    [s, b] = await json(await put(env, { bps: 5, capCents: -1, freeCents: 0, note: "x" }));
    ck("a negative cap is refused", s === 400 && b.error === "bad_cap", JSON.stringify(b));
    [s, b] = await json(await put(env, { bps: 2.5, capCents: 100, freeCents: 0, note: "x" }));
    ck("a fraction of a basis point is refused, not rounded quietly", s === 400 && b.error === "bad_rate", JSON.stringify(b));

    [s, b] = await json(await put(env, { bps: 25, capCents: 25000, freeCents: 10_000_000, note: "Design partner through 2027" }));
    ck("a superadmin sets them", s === 200 && b.custom === true, `${s} ${JSON.stringify(b)}`);
    const row = db.prepare(`SELECT * FROM account_fee_terms WHERE account_id='acc_gc'`).get();
    ck("they are stored", row?.fee_bps === 25 && row.cap_cents === 25000 && row.free_cents === 10_000_000
      && row.note === "Design partner through 2027" && row.updated_by === "u_super", JSON.stringify(row));
    [s, b] = await json(await call(env, URL_));
    ck("and read back as the account's own", b.custom === true && b.terms.bps === 25 && b.note === "Design partner through 2027",
      JSON.stringify(b));
    const ev = db.prepare(`SELECT payload FROM events WHERE kind = 'fee_terms_changed'`).all();
    const p = JSON.parse(ev[0]?.payload || "{}");
    ck("and the change is audited with the old terms and the new",
      ev.length === 1 && p.from?.bps === 50 && p.to?.bps === 25 && p.note === "Design partner through 2027",
      JSON.stringify(ev));

    [s, b] = await json(await put(env, { bps: 10, capCents: 25000, freeCents: 0, note: "Renegotiated" }));
    ck("setting them again replaces them, one row per account",
      s === 200 && db.prepare(`SELECT COUNT(*) n FROM account_fee_terms`).get().n === 1
      && db.prepare(`SELECT fee_bps b FROM account_fee_terms`).get().b === 10);
    ck("a free amount of zero is stored as zero, not as the default",
      db.prepare(`SELECT free_cents f FROM account_fee_terms`).get().f === 0);

    [s, b] = await json(await put(env, { reset: true }));
    ck("back to standard deletes the row", s === 200 && b.custom === false
      && db.prepare(`SELECT COUNT(*) n FROM account_fee_terms`).get().n === 0, JSON.stringify(b));
    [s, b] = await json(await call(env, URL_));
    ck("so the account follows the defaults again", b.custom === false && b.terms.bps === 50, JSON.stringify(b));
    ck("and the reset is audited too",
      db.prepare(`SELECT COUNT(*) n FROM events WHERE kind = 'fee_terms_changed'`).get().n === 3);
    const [s404] = await json(await call(env, "/api/platform/accounts/nope/fee-terms"));
    ck("an account that does not exist is not found", s404 === 404, String(s404));
    ck("CHECK.sql sees 071", runCheck(db).m071_fee_terms === 5, String(runCheck(db).m071_fee_terms));
  }

  console.log("\n-- a database without 071 --");
  {
    const { env } = seed({ migrated: false });
    let [s, b] = await json(await call(env, URL_));
    ck("reads as the standard terms and names the migration",
      s === 200 && b.terms?.bps === 50 && b.migration === "071_fee_terms", `${s} ${JSON.stringify(b)}`);
    [s, b] = await json(await put(env, { bps: 25, capCents: 25000, freeCents: 0, note: "x" }));
    ck("and setting them names the migration rather than failing", s === 503 && b.migration === "071_fee_terms",
      `${s} ${JSON.stringify(b)}`);
  }

  console.log("\n-- on the console --");
  {
    ck("the panel is on the account, beside the comp",
      /<CompPanel account=\{open\.a\}[\s\S]{0,200}<FeeTermsPanel accountId=\{open\.a\.id\} canEdit=\{isSuper\} \/>/.test(APP));
    const panel = APP.slice(APP.indexOf("function FeeTermsPanel"), APP.indexOf("function CompanyEditFields"));
    ck("the rate is typed as a percent and stored in basis points",
      /bps: Math\.round\(Number\(f\.pct\) \* 100\)/.test(panel));
    ck("and it says back what a $10,000 payment would cost before the save",
      /A \$10,000 payment past the free amount would cost them/.test(panel));
    ck("and Save waits for a reason", /disabled=\{busy \|\| !changed \|\| !note\.trim\(\)\}/.test(panel));
  }
} finally {
  supa.close();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
