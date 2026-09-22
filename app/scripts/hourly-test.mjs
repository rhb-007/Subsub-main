// Paying by the hour, with a ceiling.
//
// A work order could carry one number and one number only: a fixed price.
// That is the wrong shape for work nobody can price in advance -- a leak
// somebody has to open a wall to find -- and the alternative was guessing a
// figure and re-issuing when the guess turned out wrong.
//
// The ceiling is not optional. An hourly rate with no cap is an open
// cheque, which is the thing a work order exists to avoid.
//
//   node scripts/hourly-test.mjs

const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const ACCOUNT = "acc_pm";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const pm = await tok("pm@example.test");
const H = { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
const call = async (path, opts = {}) => {
  const r = await fetch(API + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};
const S = Date.now().toString(36);
const mkJob = async (title) => (await call("/jobs", { method: "POST", body: JSON.stringify({
  title, propertyId: "p1", address: "101 Main St", zip: "98101", trades: ["roofing"] }) })).body.id;
const woOn = async (jobId) => {
  const j = (await call("/jobs")).body.find((x) => x.id === jobId);
  return Object.values(j?.assignments || {})[0] || null;
};

console.log("\n-- a fixed price still behaves exactly as it did --");
const j1 = await mkJob(`Fixed ${S}`);
const a1 = await call(`/jobs/${j1}/assign`, { method: "POST", body: JSON.stringify({
  trade: "roofing", companyId: "cmp_r", value: "450", responseWindow: "24h" }) });
ck("it issues", a1.status === 201, JSON.stringify(a1.body).slice(0, 80));
const w1 = await woOn(j1);
ck("and is marked fixed without being asked", w1?.payKind === "fixed", w1?.payKind);
ck("with the value it was given", w1?.value === "450", w1?.value);
ck("and no rate or cap on it", !w1?.rate && w1?.capHours === null, JSON.stringify({ rate: w1?.rate, cap: w1?.capHours }));

console.log("\n-- by the hour --");
const j2 = await mkJob(`Hourly ${S}`);
const a2 = await call(`/jobs/${j2}/assign`, { method: "POST", body: JSON.stringify({
  trade: "roofing", companyId: "cmp_r", payKind: "hourly", rate: "85", capHours: 6, responseWindow: "24h" }) });
ck("it issues", a2.status === 201, JSON.stringify(a2.body).slice(0, 80));
const w2 = await woOn(j2);
ck("marked hourly", w2?.payKind === "hourly", w2?.payKind);
ck("carrying the rate", w2?.rate === "85", w2?.rate);
ck("and the cap", w2?.capHours === 6, String(w2?.capHours));
// The whole reason value_cents keeps its old meaning: every total already
// written against it goes on adding up.
ck("and a value that is the ceiling, so totals still work", w2?.value === "510", w2?.value);

console.log("\n-- the ceiling is not optional --");
const j3 = await mkJob(`Bad ${S}`);
const noCap = await call(`/jobs/${j3}/assign`, { method: "POST", body: JSON.stringify({
  trade: "roofing", companyId: "cmp_r", payKind: "hourly", rate: "85" }) });
ck("a rate with no cap is refused", noCap.status === 400 && noCap.body?.error === "cap_required", JSON.stringify(noCap.body));
const noRate = await call(`/jobs/${j3}/assign`, { method: "POST", body: JSON.stringify({
  trade: "roofing", companyId: "cmp_r", payKind: "hourly", capHours: 6 }) });
ck("and a cap with no rate is too", noRate.status === 400 && noRate.body?.error === "rate_required", JSON.stringify(noRate.body));
for (const [what, patch] of [
  ["zero hours", { rate: "85", capHours: 0 }],
  ["negative hours", { rate: "85", capHours: -3 }],
  ["a zero rate", { rate: "0", capHours: 4 }],
  ["hours that are not a number", { rate: "85", capHours: "soon" }],
]) {
  const r = await call(`/jobs/${j3}/assign`, { method: "POST", body: JSON.stringify({
    trade: "roofing", companyId: "cmp_r", payKind: "hourly", ...patch }) });
  ck(`${what} is refused`, r.status === 400, `${r.status} ${JSON.stringify(r.body)}`);
}
ck("and nothing was issued by any of them", (await woOn(j3)) === null, JSON.stringify(await woOn(j3)));

console.log("\n-- fractions of an hour --");
const j4 = await mkJob(`Half ${S}`);
await call(`/jobs/${j4}/assign`, { method: "POST", body: JSON.stringify({
  trade: "roofing", companyId: "cmp_r", payKind: "hourly", rate: "120", capHours: 1.5, responseWindow: "24h" }) });
const w4 = await woOn(j4);
ck("half an hour is allowed, and the ceiling rounds honestly",
  w4?.capHours === 1.5 && w4?.value === "180", JSON.stringify({ cap: w4?.capHours, value: w4?.value }));

console.log("\n-- what an emergency dispatch does --");
// It sets no price at all, which has to stay valid rather than becoming a
// half-formed hourly order.
await call("/account", { method: "PATCH", body: JSON.stringify({ emergencyCompanyId: "cmp_r" }) });
const tenantEmail = `hr.${S}@example.test`;
await call("/tenants", { method: "POST", body: JSON.stringify({ propertyId: "p1", firstName: "Iris", lastName: "Vane", email: tenantEmail, unit: "4E", channels: ["email"] }) });
const sent = await (await fetch("http://127.0.0.1:8904/__sent")).json();
const inv = sent[sent.length - 1]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
await fetch(`${API}/tenant-invite/${inv}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery" }) });
const tn = await tok(tenantEmail);
const em = await (await fetch(`${API}/jobs`, { method: "POST",
  headers: { Authorization: `Bearer ${tn}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" },
  body: JSON.stringify({ title: `Burst ${S}`, propertyId: "p1", address: "101 Main St", trades: ["plumbing"],
    reportDetail: { problem: "A pipe has burst", started: "Today", words: "", unit: "4E" } }) })).json();
ck("the call-out still goes out", em.emergency?.dispatched === true, JSON.stringify(em.emergency));
const wEm = await woOn(em.id);
ck("priced as fixed with nothing set, not as a broken hourly",
  wEm?.payKind === "fixed" && !wEm?.rate && wEm?.capHours === null,
  JSON.stringify({ kind: wEm?.payKind, rate: wEm?.rate, cap: wEm?.capHours }));
await call("/account", { method: "PATCH", body: JSON.stringify({ emergencyCompanyId: null }) });

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
