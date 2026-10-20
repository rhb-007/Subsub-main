// 093. NOBODY IS SENT A WORK ORDER THEY CANNOT ANSWER -- end to end through
// the real Worker.
//
// Asked for as: "it should not allow something to be scheduled for somebody
// who is not on subsub ... invite them to subsub instead ... once they accept,
// they would automatically get that job scheduled, or at least presented to
// them so they can either accept or decline."
//
// What is pinned:
//
//   REFUSED, BY NAME. A work order for a company nobody signs in as is
//   `not_on_subsub`, after every other check, and nothing is written.
//
//   HELD AND INVITED. With `hold` the job is kept for them and they are
//   invited from their card -- once, however many trades are held.
//
//   RELEASED WHEN THEY JOIN, as an offer. Accepting the invite issues the work
//   order through the same route, pending, with its window starting then; a
//   hiring-side auto-schedule flag does not survive their arrival. A release
//   the route refuses closes the hold with its reason.
//
//   node --no-warnings scripts/held-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { onSubsubSql } from "./lib/onsubsub.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { rankCandidates } from "../shared/autopick.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const W = readFileSync(join(app, "worker", "index.js"), "utf8");
const APP = readFileSync(join(app, "src", "App.tsx"), "utf8");
const VERIFIED = `{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}`;

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES ('u_mgr','Chris Lane','chris@soundpm.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_mgr','u_mgr','acc_pm','admin');
    INSERT INTO companies(id,company,contact,email,phone,state,insurance,bond,contract,w9) VALUES
      -- Typed in off a business card: verified paperwork, no login anywhere.
      ('cmp_new','Scuttle Plumbing','Sam','sam@scuttle.test',NULL,'WA',1,1,1,1),
      -- Typed in with nothing to invite them on.
      ('cmp_mute','Quiet Glass','Quinn',NULL,NULL,'WA',1,1,1,1),
      -- Typed in, paperwork not reviewed: the documents gate comes first.
      ('cmp_raw','Raw Roofing','Rae','rae@raw.test',NULL,'WA',1,1,1,1),
      -- On SubSub through another account.
      ('cmp_on','Signed In Electric','Ola','ola@on.test',NULL,'WA',1,1,1,1);
    INSERT INTO engagements(id,account_id,company_id,status,categories,doc_review,auto_schedule) VALUES
      ('en_new','acc_pm','cmp_new','active','["plumbing","painting"]','${VERIFIED}',1),
      ('en_mute','acc_pm','cmp_mute','active','["plumbing"]','${VERIFIED}',0),
      ('en_raw','acc_pm','cmp_raw','active','["plumbing"]','{}',0),
      ('en_on','acc_pm','cmp_on','active','["plumbing","electrical"]','${VERIFIED}',0);
    INSERT INTO jobs(id,account_id,title,trades,date,status) VALUES
      ('j1','acc_pm','Leaking tap and a wall','["plumbing","painting"]','2026-12-01','active'),
      ('j2','acc_pm','Another tap','["plumbing"]','2026-12-02','active'),
      ('j3','acc_pm','Third tap','["plumbing"]','2026-12-03','active');
  `);
  db.exec(onSubsubSql(["cmp_on"]));
  return { db, env: { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null } } };
};

const call = (env, path, body, method = "POST") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, ...(method === "GET" ? {} : { body: JSON.stringify(body || {}) }),
    headers: { "Content-Type": "application/json", "X-User-Id": "u_mgr", "X-Account-Id": "acc_pm" },
  }), env);
const pub = (env, path, body) => worker.fetch(new Request(`https://api.subsub.work${path}`, {
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const assign = (env, jobId, trade, companyId, extra = {}) => call(env, `/api/jobs/${jobId}/assign`,
  { trade, companyId, payKind: "fixed", value: "180", responseWindow: "24h", ...extra });
const wos = (db, jobId) => db.prepare(`SELECT * FROM work_orders WHERE job_id = ?`).all(jobId);
const holds = (db) => db.prepare(`SELECT * FROM held_assignments ORDER BY created_at, rowid`).all();

try {
  console.log("\n-- refused, by name, and nothing is written --");
  {
    const { db, env } = seed();
    const [s, b] = await json(await assign(env, "j1", "plumbing", "cmp_new"));
    ck("a company nobody signs in as is refused", s === 409 && b.error === "not_on_subsub", `${s} ${JSON.stringify(b)}`);
    ck("and the reply names them", b.company === "Scuttle Plumbing");
    ck("no work order was written", wos(db, "j1").length === 0);
    ck("and nothing held", holds(db).length === 0);
    // AFTER every other check: a refusal the hiring side can fix itself comes
    // first, so holding never hides a reason the release would hit anyway.
    const [s2, b2] = await json(await assign(env, "j1", "plumbing", "cmp_raw", { hold: true }));
    ck("the documents gate is asked first", s2 === 409 && b2.error === "documents_incomplete", `${s2} ${b2.error}`);
    ck("and a refused hold holds nothing", holds(db).length === 0);
    // UNSCOPED: a login on another account is a login.
    const [s3] = await json(await assign(env, "j2", "plumbing", "cmp_on"));
    ck("a company with a login elsewhere is issued as before", s3 === 201, String(s3));
  }

  console.log("\n-- held and invited --");
  const { db, env } = seed();
  let token;
  {
    const [s, b] = await json(await assign(env, "j1", "plumbing", "cmp_new", { hold: true }));
    ck("holding answers 202, not a work order", s === 202 && b.held === true, `${s} ${JSON.stringify(b).slice(0, 160)}`);
    ck("no work order was written", wos(db, "j1").length === 0);
    const h = holds(db);
    ck("one hold, for that slot and company", h.length === 1 && h[0].job_id === "j1"
      && h[0].trade === "plumbing" && h[0].company_id === "cmp_new", JSON.stringify(h));
    ck("carrying the request as it was sent", JSON.parse(h[0].payload).value === "180"
      && !("hold" in JSON.parse(h[0].payload)), h[0].payload);
    const inv = db.prepare(`SELECT * FROM sub_invites WHERE company_id = 'cmp_new'`).all();
    ck("an invite was raised from their card", inv.length === 1 && inv[0].email === "sam@scuttle.test", JSON.stringify(inv));
    token = inv[0]?.token;
    // A second trade held for the same contractor is not a second invite.
    db.prepare(`UPDATE sub_invites SET sent_at = CURRENT_TIMESTAMP WHERE company_id = 'cmp_new'`).run();
    const [s2, b2] = await json(await assign(env, "j1", "painting", "cmp_new", { hold: true }));
    ck("a second trade is held too", s2 === 202 && holds(db).length === 2, `${s2}`);
    ck("without inviting them again", b2.invite?.recent === true
      && db.prepare(`SELECT COUNT(*) n FROM sub_invites WHERE company_id = 'cmp_new'`).get().n === 1, JSON.stringify(b2.invite));
    const [s3, b3] = await json(await call(env, "/api/held-assignments", null, "GET"));
    ck("the account lists what it is holding", s3 === 200 && b3.held?.length === 2
      && b3.held.every((x) => x.company === "Scuttle Plumbing"), JSON.stringify(b3));
    // Nothing on the card to invite them on: nothing held.
    const [s4, b4] = await json(await assign(env, "j2", "plumbing", "cmp_mute", { hold: true }));
    ck("no email or mobile holds nothing", s4 === 400 && b4.error === "no_contact" && holds(db).length === 2, `${s4} ${b4.error}`);
  }

  console.log("\n-- released when they join, as an offer --");
  {
    const before = Date.now();
    const [s, b] = await json(await pub(env, `/api/invite/${token}`,
      { company: "Scuttle Plumbing", contact: "Sam", email: "sam@scuttle.test" }));
    ck("they accept the invite", s === 200 && b.ok, `${s} ${JSON.stringify(b).slice(0, 120)}`);
    const w = wos(db, "j1");
    ck("both held trades became work orders", w.length === 2, JSON.stringify(w.map((x) => x.trade)));
    ck("pending, for them to accept or decline", w.every((x) => x.status === "pending"), JSON.stringify(w.map((x) => x.status)));
    ck("even though the hiring side had switched auto-schedule on", w.every((x) => !x.auto_scheduled)
      && db.prepare(`SELECT auto_schedule a FROM engagements WHERE id='en_new'`).get().a === 0);
    ck("with their window starting now", w.every((x) => x.respond_by && Date.parse(x.respond_by) >= before + 23 * 3600e3),
      JSON.stringify(w.map((x) => x.respond_by)));
    ck("at the price that was held", w.every((x) => x.value_cents === 18000));
    const h = holds(db);
    ck("each hold names the work order it became", h.every((x) => x.released_at && x.work_order_id
      && w.some((o) => o.id === x.work_order_id)), JSON.stringify(h));
    ck("and none is listed as held any more", (await json(await call(env, "/api/held-assignments", null, "GET")))[1].held.length === 0);
    ck("the invariant reads zero", runCheck(db).m093_inv_held_released_nothing === 0);
  }

  console.log("\n-- a release the route refuses closes the hold with its reason --");
  {
    const { db: d2, env: e2 } = seed();
    await assign(e2, "j3", "plumbing", "cmp_new", { hold: true });
    // Their certificate is sent back while the job waits.
    d2.prepare(`UPDATE engagements SET doc_review = '{}' WHERE id = 'en_new'`).run();
    const t2 = d2.prepare(`SELECT token FROM sub_invites WHERE company_id = 'cmp_new'`).get().token;
    await pub(e2, `/api/invite/${t2}`, { company: "Scuttle Plumbing", contact: "Sam", email: "sam@scuttle.test" });
    const h = holds(d2)[0];
    ck("nothing is issued", wos(d2, "j3").length === 0);
    ck("the hold is closed with the route's reason", !!h.released_at && h.release_error === "documents_incomplete", JSON.stringify(h));
    ck("so the slot is free", (await json(await call(e2, "/api/held-assignments", null, "GET")))[1].held.length === 0);
    ck("and the account is told", !!d2.prepare(`SELECT 1 FROM activity WHERE kind = 'held_refused'`).get());
    d2.prepare(`UPDATE held_assignments SET release_error = NULL`).run();
    ck("the invariant counts a release with neither", runCheck(d2).m093_inv_held_released_nothing === 1);
  }

  console.log("\n-- assigning somebody else, stopping, and joining elsewhere --");
  {
    const { db: d3, env: e3 } = seed();
    await assign(e3, "j2", "plumbing", "cmp_new", { hold: true });
    const [s] = await json(await assign(e3, "j2", "plumbing", "cmp_on"));
    ck("somebody on SubSub can still be assigned the slot", s === 201, String(s));
    ck("which cancels the hold", !!holds(d3)[0].cancelled_at && !holds(d3)[0].work_order_id);

    await assign(e3, "j3", "plumbing", "cmp_new", { hold: true });
    const open = holds(d3).find((x) => !x.cancelled_at && !x.released_at);
    const [sc] = await json(await call(e3, `/api/held-assignments/${open.id}/cancel`));
    ck("a hold can be stopped", sc === 200 && !!holds(d3).find((x) => x.id === open.id).cancelled_at);
    const [sc2] = await json(await call(e3, `/api/held-assignments/${open.id}/cancel`));
    ck("and stopping it twice is a miss", sc2 === 404);

    // Joined through somebody else's invite: the 10-minute sweep finds them.
    await assign(e3, "j1", "plumbing", "cmp_new", { hold: true });
    d3.exec(onSubsubSql(["cmp_new"]));
    const { heldSweep } = await import("../worker/index.js");
    const r = heldSweep ? await heldSweep(e3) : null;
    const w = wos(d3, "j1");
    ck("the sweep issues it once they are on SubSub", w.length === 1 && w[0].company_id === "cmp_new"
      && w[0].status === "pending", JSON.stringify({ r, w: w.map((x) => x.status) }));
  }

  console.log("\n-- the other doors --");
  {
    const { db: d4, env: e4 } = seed();
    d4.prepare(`UPDATE accounts SET emergency_company_id = 'cmp_new' WHERE id = 'acc_pm'`).run();
    d4.exec(`INSERT INTO users(id,name,email) VALUES ('u_ten','Tia','tia@t.test');
      INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES ('p1','acc_pm','Press','1 Main','Seattle','WA','98101');
      INSERT INTO memberships(id,user_id,account_id,role,unit) VALUES ('m_ten','u_ten','acc_pm','tenant','2A');
      INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_ten','p1');`);
    const r = await worker.fetch(new Request("https://api.subsub.work/api/jobs", {
      method: "POST", headers: { "Content-Type": "application/json", "X-User-Id": "u_ten", "X-Account-Id": "acc_pm" },
      body: JSON.stringify({ title: "Burst pipe", propertyId: "p1", trades: ["plumbing"], severity: "urgent",
        reportDetail: { problem: "A pipe has burst", started: "Now", words: "Water everywhere" } }) }), e4);
    const b = await r.json().catch(() => ({}));
    ck("an emergency call-out is not sent to somebody not on SubSub",
      b.emergency?.dispatched === false && b.emergency?.reason === "not_on_subsub", JSON.stringify(b.emergency));
    const ranked = rankCandidates([{ companyId: "c", company: "C", categories: ["plumbing"], notOnSubsub: true,
      busy: [], unavailable: [] }], { trade: "plumbing", from: "2026-12-01" });
    ck("auto-schedule passes over them, and says why",
      ranked.picked == null && (ranked.skipped || []).some((x) => x.why === "not_on_subsub"), JSON.stringify(ranked));
  }

  console.log("\n-- acting as the account, the way production runs it --");
  {
    // With Supabase configured the middleware wants a bearer token, and a
    // request carrying only X-User-Id is refused. The relay "as the account"
    // used to be exactly that request, so every auto-proposed turnaround
    // window was refused live while passing every suite that ran without it.
    const { db: d5, env: e5 } = seed();
    d5.exec(`
      UPDATE accounts SET auto_turnaround = 1 WHERE id = 'acc_pm';
      INSERT INTO users(id,name,email,auth_id) VALUES ('u_crew','Ola','ola@on.test','auth_crew');
      INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES ('m_crew','u_crew','acc_pm','contractor','cmp_on');
      INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES ('p9','acc_pm','Press','1 Main','Seattle','WA','98101');
      UPDATE jobs SET property_id = 'p9' WHERE id = 'j2';
      INSERT INTO inspections(id,account_id,property_id,unit,kind,status,job_id) VALUES ('ins9','acc_pm','p9','3B','move_out','finished','j2');
    `);
    const [si, wo] = await json(await assign(e5, "j2", "plumbing", "cmp_on"));
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => String(url).endsWith("/auth/v1/user")
      ? new Response(JSON.stringify({ id: "auth_crew", email: "ola@on.test" }),
        { status: init?.headers?.Authorization === "Bearer tok_crew" ? 200 : 401 })
      : real(url, init);
    try {
      const env = { ...e5, SUPABASE_URL: "https://supa.test", SUPABASE_ANON_KEY: "anon" };
      const r = await worker.fetch(new Request(`https://api.subsub.work/api/work-orders/${wo.id}/respond`, {
        method: "POST", body: JSON.stringify({ status: "accepted" }),
        headers: { "Content-Type": "application/json", Authorization: "Bearer tok_crew", "X-Account-Id": "acc_pm" } }), env);
      const v = d5.prepare(`SELECT * FROM visits WHERE job_id = 'j2'`).all();
      ck("the crew accepts with a real sign-in", si === 201 && r.status === 200, `${si} ${r.status}`);
      ck("and the window is put forward as the account", v.length === 1 && v[0].proposed_by === "u_mgr" && !!v[0].manager_at,
        JSON.stringify(v));
    } finally { globalThis.fetch = real; }
  }

  console.log("\n-- the shape --");
  {
    ck("the refusal is after the documents and the lapse check",
      W.indexOf('error: "not_on_subsub"') > W.indexOf('"documents_lapse_before_job"',
        W.indexOf('app.post("/api/jobs/:jobId/assign"')));
    // The relay as the account goes in-process: a header pair is refused in
    // production, where the middleware wants a bearer token.
    const asSelf = W.slice(W.indexOf("const asSelf = async"), W.indexOf("const asSelf = async") + 1600);
    ck("acting as the account goes through ACTING_AS", /ACTING_AS\.set\(req, auth\)/.test(asSelf)
      && /teamSeatAuth\(c\.env, as\.userId, as\.accountId\)/.test(asSelf));
    ck("the redemption route releases holds", /releaseHeldAssignments\(c\.env, \{ accountId: account\.id, companyId \}\)/.test(
      W.slice(W.indexOf('app.post("/api/invite/:token"'), W.indexOf('app.post("/api/invite/:token"') + 4000)));
    ck("the 10-minute cron runs the sweep", /\["held", heldSweep\]/.test(W));
    ck("the assign window offers Invite and hold", /Invite and hold this job/.test(APP) && /hold: true/.test(APP));
    ck("the auto-schedule card offers no switch to somebody not on SubSub",
      /sub\.answersForItself === false && !on\)/.test(APP));
  }
} catch (err) {
  ck("the suite threw", false, err?.stack || String(err));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
