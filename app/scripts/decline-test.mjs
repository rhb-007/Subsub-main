// Saying no to a request.
//
// A request that cannot be refused sits on the dashboard forever and the
// person who asked is never told. The reason is the point, so it is read
// back from the mail stand-in rather than from the row.
//
//   npm run test:notify   (fixture: a contractor with reviewed documents)
//   node scripts/decline-test.mjs

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
const email = `zoe.${S}@example.test`;
await clear();
await call(pm, "/tenants", { method: "POST", body: JSON.stringify({ propertyId: "p1", firstName: "Zoe", lastName: "Kerr", email, unit: "7B", channels: ["email"] }) });
const link = (await emails())[0]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
await fetch(`${API}/tenant-invite/${link}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery" }) });
const tenant = await tok(email);
const mk = async (title) => (await call(tenant, "/jobs", { method: "POST", body: JSON.stringify({ title, propertyId: "p1", address: "101 Main St", trades: [] }) })).body.id;

console.log("\n-- a reason is not optional --");
const j1 = await mk(`Paint scuff ${S}`);
ck("no reason, no decline", (await call(pm, `/jobs/${j1}/decline`, { method: "POST", body: JSON.stringify({}) })).body?.error === "reason_required");
ck("nor an empty one", (await call(pm, `/jobs/${j1}/decline`, { method: "POST", body: JSON.stringify({ note: "   " }) })).body?.error === "reason_required");
ck("and it is still waiting", !(await call(pm, "/jobs")).body.find((j) => j.id === j1)?.declinedAt);

console.log("\n-- turning it down --");
await clear();
const why = "That's decorative wear, not a repair the building covers";
const d = await call(pm, `/jobs/${j1}/decline`, { method: "POST", body: JSON.stringify({ note: why }) });
ck("declined", d.status === 200 && d.body?.ok, JSON.stringify(d.body));
const row = (await call(pm, "/jobs")).body.find((j) => j.id === j1);
ck("with the reason on the job", !!row.declinedAt && row.declinedNote === why);
ck("and not approved by it", !row.approvedAt);
const told = (await emails()).filter((m) => [].concat(m.to).join() === email);
ck("the tenant is told", told.length === 1, `${told.length} email(s)`);
ck("the subject says it wasn't approved", /wasn't approved/i.test(told[0]?.subject || ""), told[0]?.subject);
ck("and the body carries the reason", told[0]?.text.includes(why), (told[0]?.text || "").split("\n").find((l) => l.includes("decorative")));
ck("the tenant's own list shows it declined", !!(await call(tenant, "/jobs")).body.find((j) => j.id === j1)?.declinedAt);
ck("declining twice is harmless", (await call(pm, `/jobs/${j1}/decline`, { method: "POST", body: JSON.stringify({ note: "again" }) })).body?.alreadyDeclined === true);

console.log("\n-- a declined request is out of the live work --");
ck("nothing can be assigned against it",
  (await call(pm, `/jobs/${j1}/assign`, { method: "POST", body: JSON.stringify({ trade: "painting", companyId: "cmp_r" }) })).status === 409);
// The app does not offer Withdraw on a refused report, and the API does not
// need to forbid it: taking back something already refused changes nothing.
// What matters is that doing it cannot erase the refusal or its reason.
const wdAfter = await call(tenant, `/jobs/${j1}/withdraw`, { method: "POST", body: JSON.stringify({}) });
const stillRefused = (await call(pm, "/jobs")).body.find((j) => j.id === j1);
ck("withdrawing one already refused cannot erase the refusal",
  wdAfter.status === 200 && !!stillRefused.declinedAt && stillRefused.declinedNote === why,
  JSON.stringify({ declined: !!stillRefused.declinedAt, note: stillRefused.declinedNote }));

console.log("\n-- changing your mind --");
const j2 = await mk(`Loose handrail ${S}`);
await call(pm, `/jobs/${j2}/decline`, { method: "POST", body: JSON.stringify({ note: "Thought it was cosmetic" }) });
const ap = await call(pm, `/jobs/${j2}/approve`, { method: "POST" });
ck("a declined one can still be approved", ap.status === 200 && ap.body?.ok);
const after = (await call(pm, "/jobs")).body.find((j) => j.id === j2);
ck("and it stops reading as declined", !!after.approvedAt && !after.declinedAt, JSON.stringify({ a: !!after.approvedAt, d: after.declinedAt }));
ck("so it can be assigned now",
  (await call(pm, `/jobs/${j2}/assign`, { method: "POST", body: JSON.stringify({ trade: "roofing", companyId: "cmp_r", responseWindow: "24h" }) })).status === 201);

console.log("\n-- what cannot be declined --");
const j3 = await mk(`Already approved ${S}`);
await call(pm, `/jobs/${j3}/approve`, { method: "POST" });
ck("one already approved", (await call(pm, `/jobs/${j3}/decline`, { method: "POST", body: JSON.stringify({ note: "no" }) })).body?.error === "already_approved");
const j4 = await mk(`Taken back ${S}`);
await call(tenant, `/jobs/${j4}/withdraw`, { method: "POST", body: JSON.stringify({}) });
ck("one the tenant already took back", (await call(pm, `/jobs/${j4}/decline`, { method: "POST", body: JSON.stringify({ note: "no" }) })).body?.error === "withdrawn");
const own = await call(pm, "/jobs", { method: "POST", body: JSON.stringify({ title: `Own work ${S}`, address: "1 HQ Way", trades: [] }) });
ck("the account's own job, which nobody asked for", (await call(pm, `/jobs/${own.body.id}/decline`, { method: "POST", body: JSON.stringify({ note: "no" }) })).body?.error === "not_a_request");

console.log("\n-- who may --");
ck("a tenant cannot decline their own request",
  (await call(tenant, `/jobs/${await mk(`Nope ${S}`)}/decline`, { method: "POST", body: JSON.stringify({ note: "x" }) })).status === 403);
const mgr = await tok("manager1@example.test");
ck("a property manager scoped to that building can", (await call(mgr, `/jobs/${await mk(`Scoped ${S}`)}/decline`, { method: "POST", body: JSON.stringify({ note: "Not this quarter" }) })).status === 200);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
