// Milestones, verification and release, driven through the real routes
// against a real database.
//
// Not a stub. The migrations are applied to node:sqlite and the Worker is
// handed that, so a UNIQUE index really fires, a CHECK really refuses, and a
// route that forgot its WHERE account_id really leaks. Those are the
// failures worth catching in code that decides when money moves; a mock
// answers whatever the test expected and catches none of them.
//
// The rule under test is the two-party one: the subcontractor marks work
// reached, the hiring account verifies it, and NEITHER SIDE CAN DO BOTH.
// Guarded three ways on purpose, because one way is a way somebody removes
// by accident -- and the third guard matters more than it looks, since an
// account that is also somebody's subcontractor holds both seats, which 031
// made ordinary rather than exotic.
//
//   node --no-warnings scripts/milestone-test.mjs

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, makeR2, freshDb } from "./lib/d1-sqlite.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

// Enough schema for the routes under test. Deliberately hand-written rather
// than the whole of 001: if a route reaches for a column that is not here,
// that is worth knowing.
const BASE = `
CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, kind TEXT, company_id TEXT);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, auth_id TEXT);
CREATE TABLE companies (id TEXT PRIMARY KEY, company TEXT, license TEXT);
CREATE TABLE memberships (id TEXT PRIMARY KEY, user_id TEXT, account_id TEXT, role TEXT, company_id TEXT);
CREATE TABLE properties (id TEXT PRIMARY KEY, account_id TEXT, state TEXT);
CREATE TABLE jobs (id TEXT PRIMARY KEY, account_id TEXT, property_id TEXT, title TEXT, updated_at TEXT);
CREATE TABLE engagements (id TEXT PRIMARY KEY, account_id TEXT, company_id TEXT);
CREATE TABLE work_orders (
  id TEXT PRIMARY KEY, wo_number INTEGER, job_id TEXT, trade TEXT, company_id TEXT,
  engagement_id TEXT, value_cents INTEGER, status TEXT, voided_at TEXT);
CREATE TABLE membership_properties (membership_id TEXT, property_id TEXT);
`;

const MIGRATIONS = ["033_job_ledger", "034_retainage", "035_waiver_chain", "036_wo_scope"]
  .map((f) => readFileSync(join(app, `worker/migrations/${f}.sql`), "utf8"));

const seed = () => {
  const db = freshDb({ base: BASE, migrations: MIGRATIONS });
  db.exec(`
    INSERT INTO accounts(id,name,kind) VALUES ('acc1','Outerhome','general_contractor');
    INSERT INTO companies(id,company) VALUES ('cmp_sub','Cascade Roofworks');
    INSERT INTO users(id,name) VALUES ('u_admin','Richard'),('u_pm','Miguel'),('u_sub','Dana');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m1','u_admin','acc1','admin',NULL),
      ('m2','u_pm','acc1','pm',NULL),
      ('m3','u_sub','acc1','contractor','cmp_sub');
    INSERT INTO properties(id,account_id,state) VALUES ('p1','acc1','WA');
    INSERT INTO jobs(id,account_id,property_id,title) VALUES ('j1','acc1','p1','Roof');
    INSERT INTO engagements(id,account_id,company_id) VALUES ('e1','acc1','cmp_sub');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,value_cents,status)
      VALUES ('wo1',1,'j1','roofing','cmp_sub','e1',100000,'accepted');
    -- A second account, to prove scoping.
    INSERT INTO accounts(id,name,kind) VALUES ('acc2','Sound PM','property_manager');
    INSERT INTO users(id,name) VALUES ('u_other','Stranger');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m4','u_other','acc2','admin');
  `);
  return { db, env: { DB: makeD1(db), FILES: makeR2() } };
};

const call = (env, who, path, init = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    ...init,
    body: init.body ? JSON.stringify(init.body) : undefined,
    headers: { "Content-Type": "application/json", "X-User-Id": who.user, "X-Account-Id": who.account },
  }), env);
const ADMIN = { user: "u_admin", account: "acc1" };
const PM = { user: "u_pm", account: "acc1" };
const SUB = { user: "u_sub", account: "acc1" };
const OTHER = { user: "u_other", account: "acc2" };
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

const plan = (env, who = ADMIN, milestones) =>
  call(env, who, "/api/work-orders/wo1/plan", { method: "PUT", body: { milestones } });

console.log("\n-- the parts have to sum to the whole --");
{
  const { env } = seed();
  let [s, b] = await json(await plan(env, ADMIN, [{ label: "Tear-off", amountCents: 40000 }]));
  ck("a plan that is short is refused", s === 400 && b.error === "does_not_cover", `${s} ${JSON.stringify(b)}`);
  ck("and says by how much", b.by === -60000, String(b.by));
  [s, b] = await json(await plan(env, ADMIN, [{ label: "a", amountCents: 60000 }, { label: "b", amountCents: 60000 }]));
  ck("so is one that is over", s === 400 && b.by === 20000, `${s} ${b.by}`);
  [s, b] = await json(await plan(env, ADMIN, [{ label: "Tear-off", amountCents: 40000 }, { label: "Dry-in", amountCents: 60000 }]));
  ck("an exact plan is taken", s === 200 && b.milestones === 2, `${s} ${JSON.stringify(b)}`);
  [s, b] = await json(await plan(env, ADMIN, []));
  ck("an empty plan is not a plan", s === 400 && b.error === "no_milestones", `${s} ${b.error}`);
}

console.log("\n-- who may do what --");
{
  const { env } = seed();
  await plan(env, ADMIN, [{ label: "All of it", amountCents: 100000 }]);
  const [, p] = await json(await call(env, ADMIN, "/api/work-orders/wo1/plan"));
  const mid = p.milestones[0].id;

  let [s, b] = await json(await call(env, ADMIN, `/api/milestones/${mid}/reach`, { method: "POST", body: {} }));
  ck("the paying side cannot mark work reached", s === 403 && b.error === "not_yours_to_mark", `${s} ${b.error}`);

  [s, b] = await json(await call(env, SUB, `/api/milestones/${mid}/verify`, { method: "POST", body: {} }));
  ck("and the subcontractor cannot verify their own", s === 403, `${s} ${JSON.stringify(b)}`);

  [s, b] = await json(await call(env, ADMIN, `/api/milestones/${mid}/verify`, { method: "POST", body: {} }));
  ck("nothing can be verified before it is reached", s === 409 && b.error === "not_reached", `${s} ${b.error}`);

  [s, b] = await json(await call(env, SUB, `/api/milestones/${mid}/reach`,
    { method: "POST", body: { note: "Dried in", photos: ["acc1/x/a.jpg"] } }));
  ck("the subcontractor may mark it reached", s === 200, `${s} ${JSON.stringify(b)}`);
  ck("and the photo is counted, not required", b.photos === 1, String(b.photos));

  [s, b] = await json(await call(env, PM, `/api/milestones/${mid}/verify`, { method: "POST", body: {} }));
  ck("a project manager may verify", s === 200, `${s} ${JSON.stringify(b)}`);
  ck("which creates the release", !!b.releaseId, JSON.stringify(b));
  ck("for the whole amount, nothing held", b.gross === 100000 && b.retainage === 0 && b.net === 100000, JSON.stringify(b));

  [s, b] = await json(await call(env, PM, `/api/milestones/${mid}/verify`, { method: "POST", body: {} }));
  ck("verifying twice is refused", s === 409 && b.error === "already_verified", `${s} ${b.error}`);
}

console.log("\n-- and nobody is both parties, even holding both seats --");
{
  // The case 031 made ordinary: an account that is also a subcontractor.
  const { db, env } = seed();
  db.exec(`UPDATE memberships SET role='admin', company_id='cmp_sub' WHERE user_id='u_sub'`);
  await plan(env, ADMIN, [{ label: "All", amountCents: 100000 }]);
  const [, p] = await json(await call(env, ADMIN, "/api/work-orders/wo1/plan"));
  const mid = p.milestones[0].id;
  // Reached by them while they held a contractor seat...
  db.exec(`UPDATE wo_milestones SET status='reached', reached_by='u_sub',
             reached_at=CURRENT_TIMESTAMP WHERE id='${mid}'`);
  const [s, b] = await json(await call(env, { user: "u_sub", account: "acc1" },
    `/api/milestones/${mid}/verify`, { method: "POST", body: {} }));
  ck("the same person cannot verify what they marked", s === 409 && b.error === "same_person",
    `${s} ${JSON.stringify(b)}`);
  ck("and it is said in words, not just a code", /cannot verify/.test(b.detail || ""), String(b.detail));
}

console.log("\n-- retainage and the fee, held back across milestones --");
{
  const { env } = seed();
  await call(env, ADMIN, "/api/work-orders/wo1/scope", { method: "PATCH", body: { retainageBps: 500 } });
  await plan(env, ADMIN, [{ label: "a", amountCents: 33333 }, { label: "b", amountCents: 33333 }, { label: "c", amountCents: 33334 }]);
  const [, p] = await json(await call(env, ADMIN, "/api/work-orders/wo1/plan"));
  let held = 0, net = 0;
  for (const m of p.milestones) {
    await call(env, SUB, `/api/milestones/${m.id}/reach`, { method: "POST", body: {} });
    const [, b] = await json(await call(env, ADMIN, `/api/milestones/${m.id}/verify`, { method: "POST", body: {} }));
    held += b.retainage; net += b.net;
  }
  ck("five per cent held over three uneven parts is exactly five per cent",
    held === 5000, `${held} of 100000`);
  ck("and the rest went out", net === 95000, String(net));
  ck("the fee rate is recorded even at zero",
    (await json(await call(env, ADMIN, "/api/work-orders/wo1/plan")))[1].releases.every((r) => r.feeBps === 0));
}

console.log("\n-- a plan cannot be re-cut once money is owed --");
{
  const { env } = seed();
  await plan(env, ADMIN, [{ label: "All", amountCents: 100000 }]);
  const [, p] = await json(await call(env, ADMIN, "/api/work-orders/wo1/plan"));
  const mid = p.milestones[0].id;
  await call(env, SUB, `/api/milestones/${mid}/reach`, { method: "POST", body: {} });
  await call(env, ADMIN, `/api/milestones/${mid}/verify`, { method: "POST", body: {} });

  let [s, b] = await json(await plan(env, ADMIN, [{ label: "Different", amountCents: 100000 }]));
  ck("re-planning is refused", s === 409 && b.error === "already_verified", `${s} ${b.error}`);
  [s, b] = await json(await call(env, ADMIN, "/api/work-orders/wo1/scope",
    { method: "PATCH", body: { retainageBps: 1000 } }));
  ck("and so is moving the retainage", s === 409, `${s} ${b.error}`);
}

console.log("\n-- the waiver gate --");
{
  const { db, env } = seed();
  await plan(env, ADMIN, [{ label: "All", amountCents: 100000 }]);
  const [, p0] = await json(await call(env, ADMIN, "/api/work-orders/wo1/plan"));
  const mid = p0.milestones[0].id;
  await call(env, SUB, `/api/milestones/${mid}/reach`, { method: "POST", body: {} });
  const [, v] = await json(await call(env, ADMIN, `/api/milestones/${mid}/verify`, { method: "POST", body: {} }));

  let [s, b] = await json(await call(env, ADMIN, `/api/releases/${v.releaseId}/settle`,
    { method: "POST", body: { method: "check", reference: "1042" } }));
  ck("money will not go out with no waiver", s === 409 && b.error === "waiver_outstanding",
    `${s} ${JSON.stringify(b.reasons)}`);
  ck("and it says why", b.reasons.includes("no_waiver"), JSON.stringify(b.reasons));

  [s, b] = await json(await call(env, ADMIN, `/api/releases/${v.releaseId}/settle`,
    { method: "POST", body: { method: "check", override: true } }));
  ck("an override without a reason is refused", s === 400 && b.error === "override_reason_required",
    `${s} ${b.error}`);

  // Labour only, with a signed waiver through today: clear.
  const today = new Date().toISOString().slice(0, 10);
  db.exec(`UPDATE work_orders SET scope_kind='labor_only' WHERE id='wo1'`);
  db.exec(`INSERT INTO lien_waivers(id, job_id, account_id, from_company_id, to_company_id,
             tier, release_id, kind, through_date, scope_kind, status, signed_at)
           VALUES ('lw1','j1','acc1','cmp_sub',NULL,0,'${v.releaseId}',
             'conditional_progress','${today}','labor_only','signed',CURRENT_TIMESTAMP)`);
  const [ws, wb] = await json(await call(env, ADMIN, `/api/releases/${v.releaseId}/waiver-state`));
  ck("labour only with a signed waiver is clear", ws === 200 && wb.clear === true, JSON.stringify(wb));
  ck("and the state carries no supplier names", !/from_company|Cascade/.test(JSON.stringify(wb)), JSON.stringify(wb));

  [s, b] = await json(await call(env, ADMIN, `/api/releases/${v.releaseId}/settle`,
    { method: "POST", body: { method: "check", reference: "1042" } }));
  ck("now the money goes", s === 200 && b.status === "paid", `${s} ${JSON.stringify(b)}`);

  [s, b] = await json(await call(env, ADMIN, `/api/releases/${v.releaseId}/settle`,
    { method: "POST", body: { method: "check", reference: "1043" } }));
  ck("and cannot go twice", s === 409 && b.error === "already_paid", `${s} ${b.error}`);
}

console.log("\n-- an override is recorded, not just allowed --");
{
  const { env } = seed();
  await plan(env, ADMIN, [{ label: "All", amountCents: 100000 }]);
  const [, p] = await json(await call(env, ADMIN, "/api/work-orders/wo1/plan"));
  const mid = p.milestones[0].id;
  await call(env, SUB, `/api/milestones/${mid}/reach`, { method: "POST", body: {} });
  const [, v] = await json(await call(env, ADMIN, `/api/milestones/${mid}/verify`, { method: "POST", body: {} }));
  const [s] = await json(await call(env, ADMIN, `/api/releases/${v.releaseId}/settle`,
    { method: "POST", body: { method: "check", override: true, overrideReason: "Paid on the owner's instruction" } }));
  ck("it pays", s === 200, String(s));
  const [, after] = await json(await call(env, ADMIN, "/api/work-orders/wo1/plan"));
  const ov = after.events.find((e) => e.kind === "release.override");
  ck("and the override is its own event", !!ov, after.events.map((e) => e.kind).join(","));
  ck("carrying the reason", /owner's instruction/.test(ov?.payload?.reason || ""), String(ov?.payload?.reason));
  ck("and what was outstanding at the time",
    Array.isArray(ov?.payload?.chain?.reasons), JSON.stringify(ov?.payload?.chain));
}

console.log("\n-- the record is append-only and complete --");
{
  const { db, env } = seed();
  await plan(env, ADMIN, [{ label: "All", amountCents: 100000 }]);
  const [, p] = await json(await call(env, ADMIN, "/api/work-orders/wo1/plan"));
  const mid = p.milestones[0].id;
  await call(env, SUB, `/api/milestones/${mid}/reach`, { method: "POST", body: { note: "Done" } });
  await call(env, ADMIN, `/api/milestones/${mid}/verify`, { method: "POST", body: {} });
  const [, after] = await json(await call(env, ADMIN, "/api/work-orders/wo1/plan"));
  const kinds = after.events.map((e) => e.kind);
  ck("every step left a mark",
    ["plan.set", "milestone.reached", "milestone.verified"].every((k) => kinds.includes(k)), kinds.join(","));
  ck("in order", kinds.indexOf("milestone.reached") < kinds.indexOf("milestone.verified"), kinds.join(","));
  const reached = after.events.find((e) => e.kind === "milestone.reached");
  ck("with who did it and in what seat",
    reached.actorUserId === "u_sub" && reached.actorRole === "contractor", JSON.stringify(reached));
  const verified = after.events.find((e) => e.kind === "milestone.verified");
  ck("and the amounts as they stood", verified.payload.gross === 100000, JSON.stringify(verified.payload));
  ck("nothing updates an event", db.prepare(
    `SELECT COUNT(*) n FROM wo_events WHERE work_order_id='wo1'`).get().n === 3);
}

console.log("\n-- and none of it reaches another account --");
{
  const { env } = seed();
  await plan(env, ADMIN, [{ label: "All", amountCents: 100000 }]);
  const [, p] = await json(await call(env, ADMIN, "/api/work-orders/wo1/plan"));
  const mid = p.milestones[0].id;
  for (const [path, init] of [
    ["/api/work-orders/wo1/plan", {}],
    ["/api/work-orders/wo1/plan", { method: "PUT", body: { milestones: [{ label: "x", amountCents: 100000 }] } }],
    ["/api/work-orders/wo1/scope", { method: "PATCH", body: { retainageBps: 100 } }],
    [`/api/milestones/${mid}/reach`, { method: "POST", body: {} }],
    [`/api/milestones/${mid}/verify`, { method: "POST", body: {} }],
    [`/api/milestones/${mid}/reject`, { method: "POST", body: { reason: "no" } }],
  ]) {
    const [s] = await json(await call(env, OTHER, path, init));
    ck(`a stranger gets nothing from ${init.method || "GET"} ${path.replace(mid, ":id")}`,
      s === 404 || s === 403, String(s));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
