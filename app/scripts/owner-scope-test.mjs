// Building owners, and what they must not be able to reach.
//
// This one talks to a running Worker rather than importing a function, because
// the thing being tested is not a function: it is whether a request carrying
// an owner's token gets back somebody else's building. A test that called the
// handlers directly would prove the filters exist, not that every route is
// behind one. The interesting cases are all "ask for it anyway" -- the page
// never offers them, so the page is not what is being checked.
//
// Needs the local stack:
//   npx wrangler dev --config=./wrangler.toml --local --port 8787
// with SUPABASE_URL/SUPABASE_ANON_KEY in .dev.vars pointed at an auth
// stand-in, and the fixture below seeded. See scripts/owner-scope-fixture.sql.
//
//   node scripts/owner-scope-test.mjs
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const ACCOUNT = process.env.ACCOUNT_ID || "acc_pm";

const tok = async (email) =>
  (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email }) })).json()).access_token;

const call = async (token, path, opts = {}) => {
  const r = await fetch(API + path, {
    ...opts,
    headers: { "X-Account-Id": ACCOUNT, Authorization: `Bearer ${token}`,
               "content-type": "application/json", ...(opts.headers || {}) },
  });
  let body = null;
  try { body = await r.json(); } catch { /* some routes answer with nothing */ }
  return { status: r.status, body };
};

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${detail ? "  -- " + detail : ""}`);
};

const dana = await tok("owner1@example.test");   // granted p1 and p2
const theo = await tok("owner2@example.test");   // granted p9
const pm   = await tok("pm@example.test");       // runs the account
const mgr  = await tok("manager1@example.test"); // assigned p1 and p9
const wide = await tok("manager2@example.test"); // same role, no list at all

console.log("\n-- each owner sees their own buildings and no others --");
const dp = await call(dana, "/properties");
check("Dana sees exactly her two", dp.status === 200 && dp.body.length === 2
  && dp.body.every((p) => ["p1", "p2"].includes(p.id)),
  (dp.body || []).map((p) => p.id).join(","));
const tp = await call(theo, "/properties");
check("Theo sees only his one", tp.body?.length === 1 && tp.body[0].id === "p9");
check("the manager still sees the whole portfolio", (await call(pm, "/properties")).body?.length === 16);

console.log("\n-- jobs follow the buildings --");
const dj = await call(dana, "/jobs");
// Not an exact count: each run of this file leaves a request behind, and a
// test that only passes the first time is a test nobody will trust.
check("Dana sees the jobs at her buildings",
  dj.body?.some((j) => j.id === "job_p1") && dj.body.some((j) => j.id === "job_p2"));
check("and every job she is sent is at one of them",
  dj.body.every((j) => ["p1", "p2"].includes(j.propertyId)),
  dj.body.map((j) => j.propertyId).join(","));
check("and not Theo's", !(dj.body || []).some((j) => j.id === "job_p9"));
// A job with no building is the account's own work. NULL is not in any list,
// so this falls out of the filter rather than needing a rule of its own --
// worth asserting precisely because nothing in the code says it.
check("and not the account's own unbuildinged job",
  !(dj.body || []).some((j) => j.id === "job_none"));

console.log("\n-- what an owner cannot reach at all --");
for (const [label, path, method] of [
  ["the cross-account booking feed", "/jobs/all-bookings", "GET"],
  ["invite links", "/invites", "GET"],
  ["uniform orders", "/uniform-orders", "GET"],
  ["creating a property", "/properties", "POST"],
  ["adding a user", "/account-users", "POST"],
]) {
  const r = await call(dana, path, { method, body: method === "POST" ? "{}" : undefined });
  check(`refused: ${label}`, r.status === 403, `status ${r.status}`);
}
const au = await call(dana, "/account-users");
check("the member list returns only herself",
  au.body?.length === 1 && au.body[0].email === "owner1@example.test");

console.log("\n-- raising work --");
check("not at somebody else's building",
  (await call(dana, "/jobs", { method: "POST", body: JSON.stringify(
    { title: "x", propertyId: "p9", trades: ["roofing"] }) })).status === 403);
check("not with no building named",
  (await call(dana, "/jobs", { method: "POST", body: JSON.stringify(
    { title: "x", trades: ["roofing"] }) })).status === 400);
const made = await call(dana, "/jobs", { method: "POST", body: JSON.stringify(
  { title: "Gutters blocked", propertyId: "p1", trades: ["roofing"] }) });
check("but yes at her own", made.status === 201 && made.body.requested === true);
const id = made.body?.id;

console.log("\n-- a request is not work until the account agrees --");
const asJob = (await call(pm, "/jobs")).body.find((j) => j.id === id);
check("the manager sees it as a request", !!asJob?.requestedBy && !asJob?.approvedAt);
check("nothing can be assigned against it",
  (await call(pm, `/jobs/${id}/assign`, { method: "POST",
    body: JSON.stringify({ trade: "roofing", companyId: "cmp_r" }) })).status === 409);
check("the owner cannot approve their own request",
  (await call(dana, `/jobs/${id}/approve`, { method: "POST" })).status === 403);
check("the manager can", (await call(pm, `/jobs/${id}/approve`, { method: "POST" })).status === 200);
check("and then it is a job", !!(await call(pm, "/jobs")).body.find((j) => j.id === id)?.approvedAt);

console.log("\n-- money --");
const mgrWO = (await call(pm, "/jobs")).body.find((j) => j.id === "job_p1")?.assignments?.roofing;
const ownWO = (await call(dana, "/jobs")).body.find((j) => j.id === "job_p1")?.assignments?.roofing;
check("the manager is sent the value", mgrWO?.value === "4800", String(mgrWO?.value));
check("the owner is sent the same work order with no value on it", ownWO && !("value" in ownWO));
check("but still sees who is coming", ownWO?.subId === "cmp_r" && ownWO?.crewName === "Crew A");

console.log("\n-- the contractor list is the account's, not the owner's --");
const dsubs = (await call(dana, "/subs")).body;
check("Dana sees the one working her building", dsubs.some((s) => s.id === "cmp_r"));
check("not one with no work there", !dsubs.some((s) => s.id === "cmp_s"));
check("Theo, with no work orders at all, sees none", (await call(theo, "/subs")).body.length === 0);
check("the manager sees both", (await call(pm, "/subs")).body.length === 2);


// ---------------------------------------------------------------------------
// A property manager assigned to named buildings. Same role as any other
// manager -- the list is the only difference -- so the questions are: does
// the list actually narrow them, does its absence leave a colleague seeing
// everything, and can they still do the job inside it?
// ---------------------------------------------------------------------------
console.log("\n-- the same role, unnarrowed, still sees the whole account --");
check("every building", (await call(wide, "/properties")).body?.length === 16);
// Not a count -- earlier checks in this file raise requests that stay. What
// matters is that nothing is filtered out: the buildings nobody assigned them
// and the account-wide job with no building at all.
const wideJobs = (await call(wide, "/jobs")).body;
check("every job, including ones at buildings nobody assigned them",
  ["job_p1", "job_p2", "job_p9", "job_none"].every((id) => wideJobs.some((j) => j.id === id)),
  wideJobs.map((j) => j.id).join(","));
check("and can still act on one at a building nobody assigned them",
  (await call(wide, "/jobs/job_p2", { method: "PATCH", body: JSON.stringify({ notes: "seen" }) })).status === 200);

console.log("\n-- a narrowed property manager sees only their buildings --");
const mp = await call(mgr, "/properties");
check("scoped to p1 and p9", mp.body?.length === 2
  && mp.body.every((p) => ["p1", "p9"].includes(p.id)),
  (mp.body || []).map((p) => p.id).join(","));
const mj = await call(mgr, "/jobs");
check("and the jobs at exactly those",
  mj.body.every((j) => ["p1", "p9"].includes(j.propertyId)),
  mj.body.map((j) => j.propertyId).join(","));
// p2 is Dana's and not theirs. Sharing p1 with her must not carry p2 across.
check("not p2, which is an owner's but not theirs",
  !mj.body.some((j) => j.id === "job_p2"));

console.log("\n-- but unlike an owner, they can act --");
const mgrJob = await call(mgr, "/jobs", { method: "POST", body: JSON.stringify(
  { title: "Boiler service", propertyId: "p9", trades: ["roofing"] }) });
check("they create jobs, not requests",
  mgrJob.status === 201 && mgrJob.body.requested === false, `requested=${mgrJob.body?.requested}`);
check("and are sent costs, which an owner is not",
  "value" in ((await call(mgr, "/jobs")).body.find((j) => j.id === "job_p1")?.assignments?.roofing || {}));
check("and get the whole contractor roster to pick from",
  (await call(mgr, "/subs")).body.length === 2);

console.log("\n-- and stop at the edge of their list --");
check("no job at a building they do not manage",
  (await call(mgr, "/jobs", { method: "POST", body: JSON.stringify(
    { title: "x", propertyId: "p2", trades: ["roofing"] }) })).status === 403);
// The id is in the URL. The list endpoints never showed them job_p2, but
// that is not the same as being unable to reach it.
check("cannot complete a job at a building that is not theirs",
  (await call(mgr, "/jobs/job_p2/complete", { method: "POST" })).status === 403);
check("cannot assign against one either",
  (await call(mgr, "/jobs/job_p2/assign", { method: "POST", body: JSON.stringify(
    { trade: "roofing", companyId: "cmp_r" }) })).status === 403);
check("nor reach the work order issued for a job of theirs from elsewhere",
  (await call(theo, "/work-orders/wo_1/crew", { method: "POST",
    body: JSON.stringify({ crewName: "x" }) })).status === 403);

console.log("\n-- and cannot change the portfolio or the account --");
for (const [label, path, method, body] of [
  ["add a building", "/properties", "POST", "{}"],
  ["edit a building that is not theirs", "/properties/p2", "PATCH", "{}"],
  ["remove a building that is not theirs", "/properties/p2", "DELETE", null],
  ["add a user", "/account-users", "POST", "{}"],
  ["change the account", "/account", "PATCH", "{}"],
  ["open billing", "/billing/portal", "POST", "{}"],
]) {
  check(`refused: ${label}`, (await call(mgr, path, { method, body })).status === 403,
    `status ${(await call(mgr, path, { method, body })).status}`);
}
// An unnarrowed manager is unchanged by all of this: same role, same powers.
check("but an unnarrowed one can still edit a building",
  (await call(wide, "/properties/p2", { method: "PATCH", body: JSON.stringify({ name: "Building 2" }) })).status === 200);

console.log("\n-- an account that stops keeping buildings --");
// The account type is editable, so a portfolio can be switched to "general
// contractor" while scoped seats still exist on it. Their buildings go away
// underneath them; what must not happen is the API handing them everything
// instead. (The page has its own guard for the same case -- it used to crash.)
await call(pm, "/account", { method: "PATCH", body: JSON.stringify({ kind: "general_contractor" }) });
const stranded = await call(mgr, "/jobs");
check("a stranded seat still sees only its own buildings' jobs",
  stranded.status === 200 && stranded.body.every((j) => ["p1", "p9"].includes(j.propertyId)));
check("and still cannot reach another's",
  (await call(mgr, "/jobs/job_p2/complete", { method: "POST" })).status === 403);
await call(pm, "/account", { method: "PATCH", body: JSON.stringify({ kind: "property_manager" }) });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
