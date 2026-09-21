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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
