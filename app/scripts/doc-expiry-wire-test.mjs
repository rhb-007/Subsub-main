// The expiry logic, actually connected to something.
//
// shared/docs.js has been right for a while and imported by nothing but its
// own test: 64 assertions passing, zero callers. Migration 037's tables were
// applied to the live database and stayed empty. So an approved certificate
// that ran out eight months ago still read as verified, still passed the
// assignment gate, and nobody was ever told -- which is the exact failure the
// module was written to prevent, still happening.
//
// This drives the real Worker against a real database and covers the three
// joins that were missing:
//
//   what the certificate says is written down, on the COMPANY not the
//   engagement, because one COI cannot expire on different days for
//   different accounts
//
//   assignment asks about the JOB'S date, so cover lapsing on the Friday
//   does not pass for work booked the Tuesday after
//
//   the nightly sweep chases at 30/14/3/0, once each, and treats a lapse
//   under already-booked work as its own urgent case without cancelling it
//
//   node --no-warnings scripts/doc-expiry-wire-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;
// The assign route writes these, so schema.sql alone leaves it 503-ing on a
// migration rather than exercising the gate under test.
const M024 = `
ALTER TABLE work_orders ADD COLUMN pay_kind TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE work_orders ADD COLUMN rate_cents INTEGER;
ALTER TABLE work_orders ADD COLUMN cap_hours REAL;`;
const M037 = readFileSync(new URL("../worker/migrations/037_document_detail.sql", import.meta.url), "utf8");

const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M024, M031, M037] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc1','Cascade Management','cascade','property_manager');
    INSERT INTO companies(id,company,contact,email,insurance,bond,contract,w9,doc_files) VALUES
      ('cmp_sj','San Juan Exteriors','Richard Braun','rb@sanjuan.test',1,1,1,1,
        '{"insurance":"coi.pdf","bond":"bond.pdf","contract":"msa.pdf","w9":"w9.pdf"}'),
      ('cmp_leg','Legacy Roofing','Pat Legacy','pat@legacy.test',1,1,1,1,
        '{"insurance":"old-coi.pdf","bond":"old-bond.pdf","contract":"old-msa.pdf","w9":"old-w9.pdf"}');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_admin','Account Admin','admin@cascade.test','auth_admin'),
      ('u_sj','Richard Braun','rb@sanjuan.test','auth_sj');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m1','u_admin','acc1','admin',NULL),
      ('m2','u_sj','acc1','contractor','cmp_sj');
    INSERT INTO engagements(id,account_id,company_id,status,doc_review) VALUES
      ('en_sj','acc1','cmp_sj','active',
        '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}'),
      ('en_leg','acc1','cmp_leg','active',
        '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}');
  `);
  return { db, env: { DB: makeD1(db) } };
};

const call = (env, who, path, opts = {}) => worker.fetch(
  new Request(`https://api.subsub.work/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-User-Id": who,
               "X-Account-Id": "acc1", ...(opts.headers || {}) },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const row = (db, sql, ...b) => db.prepare(sql).get(...b);

// Upload and approve, which is the real sequence. An upload deliberately puts
// the review back to pending on every engagement -- a new certificate has not
// been checked by anybody -- so a test that only uploads is testing a company
// nobody has approved.
const fileOn = async (env, companyId, kind, detail = {}) => {
  await call(env, "u_admin", `/subs/${companyId}/documents/${kind}`,
    { method: "POST", body: JSON.stringify({ fileName: `${kind}.pdf` }) });
  return call(env, "u_admin", `/subs/${companyId}/documents/${kind}/review`,
    { method: "POST", body: JSON.stringify({ status: "verified", ...detail }) });
};

console.log("\n-- what the certificate says gets written down --");
{
  const { db, env } = seed();
  let [s] = await json(await call(env, "u_admin", "/subs/cmp_sj/documents/insurance",
    { method: "POST", body: JSON.stringify({ fileKey: "k1", fileName: "coi-2026.pdf" }) }));
  ck("an upload is accepted", s === 200, String(s));
  const up = row(db, `SELECT * FROM company_docs WHERE company_id='cmp_sj' AND kind='insurance'`);
  ck("and leaves a row describing it", !!up && up.file_name === "coi-2026.pdf", JSON.stringify(up));
  ck("still not approved", !up.approved_at, String(up.approved_at));

  [s] = await json(await call(env, "u_admin", "/subs/cmp_sj/documents/insurance/review",
    { method: "POST", body: JSON.stringify({ status: "verified", issuer: "Acme Mutual",
      policyNo: "CGL-99812", coverage: "2000000", effectiveOn: iso(-10), expiresOn: iso(200) }) }));
  ck("approval is accepted", s === 200, String(s));
  const ap = row(db, `SELECT * FROM company_docs WHERE id = ?`, up.id);
  ck("the carrier is stored", ap.issuer === "Acme Mutual", String(ap.issuer));
  ck("the policy number is stored", ap.policy_no === "CGL-99812", String(ap.policy_no));
  ck("coverage is whole cents, not dollars", ap.coverage_cents === 200000000, String(ap.coverage_cents));
  ck("the expiry is an ISO day", ap.expires_on === iso(200), String(ap.expires_on));
  ck("and it is stamped approved, by whom", !!ap.approved_at && ap.approved_by === "u_admin",
    `${ap.approved_at} ${ap.approved_by}`);

  // The certificate is the company's. Putting the date on the engagement
  // would mean one COI expiring on different days for different accounts.
  const en = row(db, `SELECT doc_review FROM engagements WHERE id='en_sj'`);
  ck("the engagement still holds only the verdict",
    JSON.parse(en.doc_review).insurance.status === "verified");
  ck("and the expiry is not duplicated onto it",
    !row(db, `SELECT COUNT(*) n FROM pragma_table_info('engagements') WHERE name='expires_on'`).n);
}

console.log("\n-- a replacement supersedes, it does not overwrite --");
{
  const { db, env } = seed();
  await call(env, "u_admin", "/subs/cmp_sj/documents/insurance",
    { method: "POST", body: JSON.stringify({ fileKey: "k1", fileName: "coi-2025.pdf" }) });
  await call(env, "u_admin", "/subs/cmp_sj/documents/insurance",
    { method: "POST", body: JSON.stringify({ fileKey: "k2", fileName: "coi-2026.pdf" }) });
  const all = db.prepare(`SELECT file_name, superseded_at FROM company_docs
    WHERE company_id='cmp_sj' AND kind='insurance' ORDER BY uploaded_at`).all();
  ck("both certificates are still there", all.length === 2, JSON.stringify(all));
  ck("the old one is marked superseded", !!all.find((r) => r.file_name === "coi-2025.pdf").superseded_at);
  ck("the new one is not", !all.find((r) => r.file_name === "coi-2026.pdf").superseded_at);

  // "Were they insured on the day of that job" has to stay answerable.
  await call(env, "u_admin", "/subs/cmp_sj/documents/insurance", { method: "DELETE" });
  const after = db.prepare(`SELECT COUNT(*) n FROM company_docs WHERE company_id='cmp_sj' AND kind='insurance'`).get();
  ck("deleting the current one removes no history", after.n === 2, String(after.n));
  ck("it supersedes it instead",
    db.prepare(`SELECT COUNT(*) n FROM company_docs
      WHERE company_id='cmp_sj' AND kind='insurance' AND superseded_at IS NULL`).get().n === 0);
}

console.log("\n-- the roster says what it knows, as of today --");
{
  const { env } = seed();
  await fileOn(env, "cmp_sj", "insurance", { expiresOn: iso(12) });
  const [s, rows] = await json(await call(env, "u_admin", "/subs"));
  ck("the roster loads", s === 200, String(s));
  const sj = rows.find((r) => r.id === "cmp_sj");
  ck("the certificate's expiry is on it", sj.docs?.insurance?.expiresOn === iso(12),
    JSON.stringify(sj.docs?.insurance));
  ck("and it reads as expiring, not current", sj.docState === "expiring", String(sj.docState));
  ck("expiring is still assignable -- it is a warning, not a bar",
    sj.docAssignable === true, String(sj.docAssignable));

  // A company whose files all predate 037 must not suddenly read as having no
  // insurance. The file is there; we simply have no row describing it.
  const leg = rows.find((r) => r.id === "cmp_leg");
  ck("a pre-037 company still reads as having its documents",
    leg.docs?.insurance?.legacy === true && leg.docState === "current",
    `${JSON.stringify(leg.docs?.insurance)} ${leg.docState}`);
}

console.log("\n-- assignment asks about the job's date, not today's --");
{
  const { db, env } = seed();
  db.exec(`INSERT INTO jobs(id,account_id,title,date,status) VALUES
    ('job_soon','acc1','Cedar Park re-roof','${iso(3)}','active'),
    ('job_late','acc1','Elm St gutters','${iso(60)}','active');`);
  // Current today, and for the job three days out. Not for the one in sixty.
  await fileOn(env, "cmp_sj", "insurance", { expiresOn: iso(20) });
  await fileOn(env, "cmp_sj", "bond", { expiresOn: iso(400) });
  await fileOn(env, "cmp_sj", "contract");

  let [s] = await json(await call(env, "u_admin", "/jobs/job_soon/assign",
    { method: "POST", body: JSON.stringify({ trade: "roofing", companyId: "cmp_sj", value: "5000" }) }));
  ck("a job inside the cover is assigned", s === 201 || s === 200, String(s));

  let [s2, b2] = await json(await call(env, "u_admin", "/jobs/job_late/assign",
    { method: "POST", body: JSON.stringify({ trade: "gutters", companyId: "cmp_sj", value: "5000" }) }));
  ck("a job past the expiry is refused",
    s2 === 409 && b2.error === "documents_lapse_before_job", `${s2} ${JSON.stringify(b2)}`);
  ck("and it names which document, not just 'documents'",
    JSON.stringify(b2.lapsing) === '["insurance"]', JSON.stringify(b2.lapsing));
  ck("and says both dates so somebody can act",
    b2.detail.includes(iso(20)) && b2.detail.includes(iso(60)), b2.detail);
  ck("the bond, which is current for that date, is not blamed",
    !b2.lapsing.includes("bond"), JSON.stringify(b2.lapsing));
  ck("no work order was written", db.prepare(
    `SELECT COUNT(*) n FROM work_orders WHERE job_id='job_late'`).get().n === 0);

  // This is the bug that was live: verified is not the same as in force.
  const en = JSON.parse(db.prepare(`SELECT doc_review FROM engagements WHERE id='en_sj'`).get().doc_review);
  ck("and the review still says verified, which is why the date had to be checked",
    en.insurance.status === "verified");

  // A W-9 has no shelf life and must never be the reason a job is refused.
  await fileOn(env, "cmp_sj", "w9");
  db.exec(`INSERT INTO jobs(id,account_id,title,date,status) VALUES
    ('job_w9','acc1','Third job','${iso(5)}','active');`);
  const [s3] = await json(await call(env, "u_admin", "/jobs/job_w9/assign",
    { method: "POST", body: JSON.stringify({ trade: "siding", companyId: "cmp_sj", value: "100" }) }));
  ck("a document with no expiry blocks nothing", s3 === 201 || s3 === 200, String(s3));
}

console.log("\n-- the nightly sweep chases, once per milestone --");
{
  const { db, env } = seed();
  await fileOn(env, "cmp_sj", "insurance", { expiresOn: iso(13) });

  const sweep = () => call(env, "u_admin", "/cron/doc-expiry",
    { headers: { Authorization: "Bearer s3cret" } });
  env.CRON_SECRET = "s3cret";

  let [s, b] = await json(await sweep());
  ck("the sweep runs", s === 200, `${s} ${JSON.stringify(b)}`);
  ck("it sent one chase", b.sent === 1, JSON.stringify(b));
  const r1 = db.prepare(`SELECT days_out FROM doc_reminders`).all();
  ck("at the 14-day milestone, the one it has passed",
    r1.length === 1 && r1[0].days_out === 14, JSON.stringify(r1));

  [s, b] = await json(await sweep());
  ck("running it again sends nothing", b.sent === 0, JSON.stringify(b));
  ck("and writes no second row", db.prepare(`SELECT COUNT(*) n FROM doc_reminders`).get().n === 1);

  ck("it is refused without the cron secret",
    (await call(env, "u_admin", "/cron/doc-expiry")).status === 403);
}

console.log("\n-- and the index is what actually stops a double chase --");
{
  // Worth asserting directly, because it cannot be caught behaviourally. The
  // sweep asks dueReminder() what is outstanding AND relies on a unique index
  // to claim the milestone; with the index in place, removing the first check
  // changes nothing observable, so a mutation run cannot tell you which one is
  // load-bearing. It is the index. If somebody drops it as redundant, every
  // document gets chased every night and nothing else here fails.
  const { db } = seed();
  const idx = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='index' AND name='ux_doc_reminder'`).get();
  ck("the reminder index exists", !!idx, String(idx?.sql));
  ck("and it is UNIQUE on the document and the milestone",
    /UNIQUE/i.test(idx.sql) && /company_doc_id/.test(idx.sql) && /days_out/.test(idx.sql), idx.sql);

  // And that the sweep leans on it rather than only on its own bookkeeping.
  const src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  ck("a duplicate claim is handled rather than thrown",
    /UNIQUE constraint failed/.test(src.slice(src.indexOf("async function docExpirySweep"),
      src.indexOf("app.get(\"/api/cron/doc-expiry\""))));
}

console.log("\n-- a lapse under booked work is urgent, and cancels nothing --");
{
  const { db, env } = seed();
  env.CRON_SECRET = "s3cret";
  await fileOn(env, "cmp_sj", "insurance", { expiresOn: iso(-2) });
  db.exec(`INSERT INTO jobs(id,account_id,title,date,status) VALUES
    ('job_booked','acc1','Booked already','${iso(9)}','active');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status)
      VALUES ('wo1','WO-100001','job_booked','roofing','cmp_sj','en_sj','accepted');`);

  const [, b] = await json(await call(env, "u_admin", "/cron/doc-expiry",
    { headers: { Authorization: "Bearer s3cret" } }));
  ck("it is counted as urgent", b.urgent === 1, JSON.stringify(b));
  ck("recorded at -1, its own milestone",
    db.prepare(`SELECT days_out FROM doc_reminders`).get().days_out === -1);
  // The whole point: the crew still turns up.
  ck("the work order is untouched",
    db.prepare(`SELECT status, voided_at FROM work_orders WHERE id='wo1'`).get().status === "accepted");
  ck("the job is untouched",
    db.prepare(`SELECT status FROM jobs WHERE id='job_booked'`).get().status === "active");
  // And the account that has a crew arriving uninsured is told.
  const act = db.prepare(`SELECT text FROM activity WHERE kind='doc_expired'`).get();
  ck("the account is told in their own feed", !!act && /expired/.test(act.text), String(act?.text));
  ck("and it says a replacement was asked for", /replacement requested/.test(act?.text || ""), String(act?.text));

  // With no booked work it is an ordinary lapse, chased at 0.
  const { db: db2, env: env2 } = seed();
  env2.CRON_SECRET = "s3cret";
  await fileOn(env2, "cmp_sj", "insurance", { expiresOn: iso(-2) });
  await call(env2, "u_admin", "/cron/doc-expiry", { headers: { Authorization: "Bearer s3cret" } });
  ck("a lapse with nothing booked is chased at 0, not -1",
    db2.prepare(`SELECT days_out FROM doc_reminders`).get().days_out === 0);
  ck("and raises no urgent activity",
    db2.prepare(`SELECT COUNT(*) n FROM activity WHERE kind='doc_expired'`).get().n === 0);
}

console.log("\n-- and it walks down the milestones as the date approaches --");
{
  // 30, 14, 3, 0 -- each once. A document does not get chased at 14 and then
  // go quiet for the last fortnight, and it does not get chased at 14 twice
  // because it is still inside fourteen days tomorrow.
  const { db, env } = seed();
  env.CRON_SECRET = "s3cret";
  const sweep = () => call(env, "u_admin", "/cron/doc-expiry",
    { headers: { Authorization: "Bearer s3cret" } });
  const sent = () => db.prepare(`SELECT days_out FROM doc_reminders ORDER BY days_out DESC`)
    .all().map((r) => r.days_out);

  await fileOn(env, "cmp_sj", "insurance", { expiresOn: iso(20) });
  await sweep();
  ck("twenty days out is chased at 30", JSON.stringify(sent()) === "[30]", JSON.stringify(sent()));

  // Move the certificate closer rather than the clock: same row, new date,
  // which is also what happens when somebody corrects a mistyped expiry.
  const cur = () => db.prepare(`SELECT id FROM company_docs
    WHERE company_id='cmp_sj' AND kind='insurance' AND superseded_at IS NULL`).get().id;
  db.prepare(`UPDATE company_docs SET expires_on = ? WHERE id = ?`).run(iso(10), cur());
  await sweep();
  ck("ten days out is chased again, at 14", JSON.stringify(sent()) === "[30,14]", JSON.stringify(sent()));
  await sweep();
  ck("and not a second time at 14", JSON.stringify(sent()) === "[30,14]", JSON.stringify(sent()));

  db.prepare(`UPDATE company_docs SET expires_on = ? WHERE id = ?`).run(iso(2), cur());
  await sweep();
  ck("two days out is chased at 3", JSON.stringify(sent()) === "[30,14,3]", JSON.stringify(sent()));

  db.prepare(`UPDATE company_docs SET expires_on = ? WHERE id = ?`).run(iso(0), cur());
  await sweep();
  ck("the day it expires is chased at 0", JSON.stringify(sent()) === "[30,14,3,0]", JSON.stringify(sent()));
  await sweep();
  ck("and then it stops -- four chases, not one a night",
    JSON.stringify(sent()) === "[30,14,3,0]", JSON.stringify(sent()));
}

console.log("\n-- a corrected expiry on the same certificate is chased afresh --");
{
  // The renewal case below replaces the row, so its reminders are empty
  // whatever happens. This one does NOT: approving again writes a new date
  // onto the SAME row, and the reminders already on file would suppress every
  // future chase against it if nothing cleared them.
  const { db, env } = seed();
  env.CRON_SECRET = "s3cret";
  const sweep = () => call(env, "u_admin", "/cron/doc-expiry",
    { headers: { Authorization: "Bearer s3cret" } });

  await fileOn(env, "cmp_sj", "insurance", { expiresOn: iso(2) });
  await sweep();
  const id = db.prepare(`SELECT id FROM company_docs
    WHERE company_id='cmp_sj' AND kind='insurance' AND superseded_at IS NULL`).get().id;
  ck("the mistyped date was chased at 3",
    db.prepare(`SELECT days_out FROM doc_reminders WHERE company_doc_id = ?`).get(id).days_out === 3);

  // Same document, re-approved with the right date. No new upload.
  await call(env, "u_admin", "/subs/cmp_sj/documents/insurance/review",
    { method: "POST", body: JSON.stringify({ status: "verified", expiresOn: iso(20) }) });
  ck("it is still the same row", db.prepare(`SELECT id FROM company_docs
    WHERE company_id='cmp_sj' AND kind='insurance' AND superseded_at IS NULL`).get().id === id);
  ck("and its old chases were cleared",
    db.prepare(`SELECT COUNT(*) n FROM doc_reminders WHERE company_doc_id = ?`).get(id).n === 0,
    String(db.prepare(`SELECT COUNT(*) n FROM doc_reminders WHERE company_doc_id = ?`).get(id).n));

  const [, b] = await json(await sweep());
  ck("so the corrected date gets its own chase", b.sent === 1, JSON.stringify(b));
  ck("at 30, against the new date",
    db.prepare(`SELECT days_out FROM doc_reminders WHERE company_doc_id = ?`).get(id).days_out === 30);
}

console.log("\n-- a renewal restarts the chase --");
{
  const { db, env } = seed();
  env.CRON_SECRET = "s3cret";
  await fileOn(env, "cmp_sj", "insurance", { expiresOn: iso(2) });
  await call(env, "u_admin", "/cron/doc-expiry", { headers: { Authorization: "Bearer s3cret" } });
  ck("the old certificate was chased", db.prepare(`SELECT COUNT(*) n FROM doc_reminders`).get().n === 1);

  // They renew. A new row, and the reminders for it must start clean --
  // otherwise the next expiry passes in silence.
  await call(env, "u_admin", "/subs/cmp_sj/documents/insurance",
    { method: "POST", body: JSON.stringify({ fileName: "coi-new.pdf" }) });
  await call(env, "u_admin", "/subs/cmp_sj/documents/insurance/review",
    { method: "POST", body: JSON.stringify({ status: "verified", expiresOn: iso(13) }) });
  const [, b] = await json(await call(env, "u_admin", "/cron/doc-expiry",
    { headers: { Authorization: "Bearer s3cret" } }));
  ck("the renewed certificate is chased on its own schedule", b.sent === 1, JSON.stringify(b));
  const cur = db.prepare(`SELECT id FROM company_docs
    WHERE company_id='cmp_sj' AND kind='insurance' AND superseded_at IS NULL`).get();
  ck("at 14 days against the new date",
    db.prepare(`SELECT days_out FROM doc_reminders WHERE company_doc_id = ?`).get(cur.id).days_out === 14);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
