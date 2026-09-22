// A tenant's own report: taken back, or corrected within ten minutes.
//
//   npm run test:notify   (fixture: a contractor with reviewed documents and a login)
//   node scripts/tenant-report-test.mjs

const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const call = async (t, path, opts = {}) => {
  const r = await fetch(API + path, { ...opts, headers: { "X-Account-Id": "acc_pm",
    ...(t ? { Authorization: `Bearer ${t}` } : {}), "content-type": "application/json", ...(opts.headers || {}) } });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};
const emails = async () => (await (await fetch("http://127.0.0.1:8904/__sent")).json());
const clear = async () => { await fetch("http://127.0.0.1:8904/__clear"); await fetch("http://127.0.0.1:8905/__clear"); };
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const pm = await tok("pm@example.test");
const S = Date.now().toString(36);
const email = `uma.${S}@example.test`;
await clear();
await call(pm, "/tenants", { method: "POST", body: JSON.stringify({ propertyId: "p1", firstName: "Uma", lastName: "Reyes", email, unit: "6A", channels: ["email"] }) });
const link = (await emails())[0]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
await fetch(`${API}/tenant-invite/${link}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery" }) });
const tenant = await tok(email);
const other = await tok(`nobody.${S}@example.test`);

console.log("\n-- correcting a fresh report --");
const rep = await call(tenant, "/jobs", { method: "POST", body: JSON.stringify({ title: `Kitchen tap dripping ${S}`, propertyId: "p1", address: "101 Main St", trades: ["plumbing"], scope: "Unit 6A. Started: today." }) });
const jobId = rep.body.id;
const fresh = (await call(tenant, "/jobs")).body.find((j) => j.id === jobId);
ck("the report carries its full creation time", !!fresh.createdAtIso && /\d{2}:\d{2}/.test(fresh.createdAtIso), fresh.createdAtIso);
const ed = await call(tenant, `/jobs/${jobId}/report`, { method: "PATCH", body: JSON.stringify({ title: `Kitchen tap won't stop ${S}`, scope: "Unit 6A. Started: today. It's the cold side." }) });
ck("within ten minutes, it can be corrected", ed.status === 200 && /won't stop/.test(ed.body?.title), JSON.stringify(ed.body?.title));
ck("and the details with it", /cold side/.test(ed.body?.scope || ""));
ck("the manager sees the corrected one", /won't stop/.test((await call(pm, "/jobs")).body.find((j) => j.id === jobId)?.title || ""));
ck("a title cannot be emptied", (await call(tenant, `/jobs/${jobId}/report`, { method: "PATCH", body: JSON.stringify({ title: "  " }) })).body?.error === "title_required");
ck("the manager cannot use the tenant's route", (await call(pm, `/jobs/${jobId}/report`, { method: "PATCH", body: JSON.stringify({ title: "x" }) })).status === 403);
ck("nor a stranger", (await call(other, `/jobs/${jobId}/report`, { method: "PATCH", body: JSON.stringify({ title: "x" }) })).status !== 200);

console.log("\n-- once the manager has acted on it, it is theirs --");
await call(pm, `/jobs/${jobId}/approve`, { method: "POST" });
ck("approved, it can no longer be changed", (await call(tenant, `/jobs/${jobId}/report`, { method: "PATCH", body: JSON.stringify({ title: "late" }) })).body?.error === "already_actioned");

console.log("\n-- the ten minutes --");
// Back-date one to eleven minutes ago through the API's own clock: there is
// no route for that, so this uses a second report created with an old
// created_at via the fixture path is not possible either. Instead, assert
// the window from the value the API exposes.
const old = await call(tenant, "/jobs", { method: "POST", body: JSON.stringify({ title: `Old one ${S}`, propertyId: "p1", address: "101 Main St", trades: [] }) });
const oldRow = (await call(tenant, "/jobs")).body.find((j) => j.id === old.body.id);
const ageMs = Date.now() - new Date(String(oldRow.createdAtIso).replace(" ", "T") + "Z").getTime();
ck("a just-made report reads as seconds old, in UTC, so the window can be computed", ageMs >= 0 && ageMs < 60000, `${Math.round(ageMs / 1000)}s`);

console.log("\n-- once somebody is booked, it is not theirs to take back --");
// This used to be allowed, and unwound the booking. It should not be: a
// contractor has been given a slot and may have turned other work away for
// it, and the first they would know is arriving to be told it was cancelled
// by someone they have never spoken to. The tenant asks the manager, who
// can still call it off.
const as = await call(pm, `/jobs/${jobId}/assign`, { method: "POST", body: JSON.stringify({ trade: "plumbing", companyId: "cmp_r", responseWindow: "24h" }) });
ck("assigned first", as.status === 201, JSON.stringify(as.body));
await call(pm, `/jobs/${jobId}/visits`, { method: "POST", body: JSON.stringify({ date: "2026-10-10", startTime: "09:00" }) });
ck("with a visit waiting on them", (await call(tenant, "/visits")).body.some((v) => v.jobId === jobId && v.status === "proposed"));
ck("the manager cannot withdraw it for them either", (await call(pm, `/jobs/${jobId}/withdraw`, { method: "POST", body: JSON.stringify({}) })).status === 403);
const blocked = await call(tenant, `/jobs/${jobId}/withdraw`, { method: "POST", body: JSON.stringify({ note: "It stopped on its own" }) });
ck("and the tenant is refused, by name", blocked.status === 409 && blocked.body?.error === "contractor_assigned", JSON.stringify(blocked.body));
const stillOn = (await call(pm, "/jobs")).body.find((j) => j.id === jobId);
ck("nothing was taken back", !stillOn.withdrawnAt);
ck("the work order still stands", Object.keys(stillOn.assignments || {}).length === 1);
ck("and the visit is still waiting", (await call(pm, "/visits")).body.some((v) => v.jobId === jobId));

console.log("\n-- taking back one nobody is booked for --");
const free = await call(tenant, "/jobs", { method: "POST", body: JSON.stringify({ title: `Nobody booked ${S}`, propertyId: "p1", address: "101 Main St", trades: [] }) });
const freeId = free.body.id;
await clear();
const wd = await call(tenant, `/jobs/${freeId}/withdraw`, { method: "POST", body: JSON.stringify({ note: "It stopped on its own" }) });
ck("withdrawn, with the reason", wd.status === 200 && wd.body?.ok, JSON.stringify(wd.body));
ck("and nothing had to be unwound", wd.body?.voided === 0, String(wd.body?.voided));
const after = (await call(pm, "/jobs")).body.find((j) => j.id === freeId);
ck("the manager's copy says withdrawn, and why", !!after.withdrawnAt && after.withdrawnNote === "It stopped on its own");
ck("withdrawing again is harmless", (await call(tenant, `/jobs/${freeId}/withdraw`, { method: "POST", body: JSON.stringify({}) })).body?.alreadyWithdrawn === true);
ck("and it cannot be edited afterwards", (await call(tenant, `/jobs/${freeId}/report`, { method: "PATCH", body: JSON.stringify({ title: "x" }) })).body?.error === "withdrawn");
await clear();
await call(pm, `/jobs/${freeId}/complete`, { method: "POST" });
ck("completing a withdrawn job tells the tenant nothing", (await emails()).length === 0);

console.log("\n-- a finished one cannot be taken back --");
const done = await call(tenant, "/jobs", { method: "POST", body: JSON.stringify({ title: `Finished ${S}`, propertyId: "p1", address: "101 Main St", trades: [] }) });
await call(pm, `/jobs/${done.body.id}/approve`, { method: "POST" });
await call(pm, `/jobs/${done.body.id}/complete`, { method: "POST" });
ck("refused once completed", (await call(tenant, `/jobs/${done.body.id}/withdraw`, { method: "POST", body: JSON.stringify({}) })).body?.error === "already_completed");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
