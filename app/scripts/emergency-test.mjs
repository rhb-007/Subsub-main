// Emergencies, end to end.
//
// Two levels, and the difference is who can help. A fire is not a
// subcontractor's problem: the app says get out and call emergency
// services, and nothing is dispatched, because emergency services are not
// something this system can route to. A burst pipe is exactly a
// subcontractor's problem, and at two in the morning the difference between
// a plumber in an hour and a plumber at nine is a ceiling.
//
// So an urgent report approves itself and issues a work order -- but only
// to a contractor the account deliberately named, and only if their
// paperwork is verified, because sending an uninsured contractor into an
// emergency is how an emergency becomes a lawsuit.
//
//   npm run test:emergency
//   node scripts/emergency-test.mjs

const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const ACCOUNT = "acc_pm";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const call = async (t, path, opts = {}) => {
  const r = await fetch(API + path, { ...opts, headers: { "X-Account-Id": ACCOUNT,
    Authorization: `Bearer ${t}`, "content-type": "application/json", ...(opts.headers || {}) } });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};
const mail = async () => (await (await fetch("http://127.0.0.1:8904/__sent")).json());
const texts = async () => (await (await fetch("http://127.0.0.1:8905/__sent")).json());
const clear = async () => { await fetch("http://127.0.0.1:8904/__clear"); await fetch("http://127.0.0.1:8905/__clear"); };

const pm = await tok("pm@example.test");
const S = Date.now().toString(36);
const EMAIL = `siren.${S}@example.test`;
await call(pm, "/tenants", { method: "POST", body: JSON.stringify({ propertyId: "p1", firstName: "Wes", lastName: "Hale", email: EMAIL, unit: "2C", channels: ["email"] }) });
const sent = await mail();
const inv = sent[sent.length - 1]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
await fetch(`${API}/tenant-invite/${inv}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery" }) });
const tn = await tok(EMAIL);

const report = (problem, title) => call(tn, "/jobs", { method: "POST", body: JSON.stringify({
  title: title || problem, propertyId: "p1", address: "101 Main St", trades: ["plumbing"],
  reportDetail: { problem, started: "Today", words: "", unit: "2C" } }) });

console.log("\n-- severity is decided here, not asked for --");
const ordinary = await report("A faucet is dripping");
ck("an ordinary problem has no severity", ordinary.body.severity === null, String(ordinary.body.severity));
const burst = await report("A pipe has burst", `Burst pipe ${S}`);
ck("a burst pipe is urgent", burst.body.severity === "urgent", String(burst.body.severity));
const fire = await report("There's a fire, or I can smell smoke", `Fire ${S}`);
ck("a fire is life safety", fire.body.severity === "911", String(fire.body.severity));

const forged = await call(tn, "/jobs", { method: "POST", body: JSON.stringify({
  title: `Forged ${S}`, propertyId: "p1", address: "101 Main St", trades: [],
  severity: "urgent",                                  // claimed, not earned
  reportDetail: { problem: "A faucet is dripping", started: "Today", words: "", unit: "2C" } }) });
ck("a tenant cannot declare their own emergency", forged.body.severity === null, String(forged.body.severity));
ck("and nothing was dispatched for it", !forged.body.emergency?.dispatched);

console.log("\n-- with nobody named, nothing dispatches --");
await call(pm, "/account", { method: "PATCH", body: JSON.stringify({ emergencyCompanyId: null }) });
await clear();
const noOne = await report("Water is flooding in", `Flood A ${S}`);
ck("it is still urgent", noOne.body.severity === "urgent");
ck("but nothing was sent", noOne.body.emergency?.dispatched === false, JSON.stringify(noOne.body.emergency));
ck("and it says why", noOne.body.emergency?.reason === "no_emergency_contractor", noOne.body.emergency?.reason);
ck("it is not approved behind the manager's back",
  !(await call(pm, "/jobs")).body.find((j) => j.id === noOne.body.id)?.approvedAt);

console.log("\n-- naming one --");
const bad = await call(pm, "/account", { method: "PATCH", body: JSON.stringify({ emergencyCompanyId: "cmp_nobody" }) });
ck("a company the account does not work with is refused", bad.status === 400 && bad.body?.error === "not_engaged", JSON.stringify(bad.body));
const set = await call(pm, "/account", { method: "PATCH", body: JSON.stringify({ emergencyCompanyId: "cmp_r" }) });
ck("one it does work with is accepted", set.status === 200, JSON.stringify(set.body).slice(0, 80));
ck("and it reads back", (await call(pm, "/account")).body.emergencyCompanyId === "cmp_r");

console.log("\n-- an urgent report now sends somebody --");
// A contractor with no mobile on file is the normal case in the seed data,
// and the dispatch has to survive it: an email still goes and nothing
// throws. Then one with a mobile, because a text at two in the morning is
// the whole point of this feature.
// Cleared first, so this holds on the second run as well as the first --
// the with-mobile case below sets one, and without this the suite would
// quietly stop testing the no-mobile path after its first ever run.
await call(pm, "/subs/cmp_r", { method: "PATCH", body: JSON.stringify({ phone: "" }) });
await clear();
const noPhone = await report("A pipe has burst", `Burst noPhone ${S}`);
ck("a contractor with no mobile still gets the call-out", noPhone.body.emergency?.dispatched === true, JSON.stringify(noPhone.body.emergency));
ck("by email", (await mail()).some((m) => /emergency call-out/i.test(m.subject || "")));
ck("and nothing was texted into the void", (await texts()).length === 0, `${(await texts()).length} text(s)`);

await call(pm, "/subs/cmp_r", { method: "PATCH", body: JSON.stringify({ phone: "(206)555-0142" }) });
await clear();
const flood = await report("Water is flooding in", `Flood B ${S}`);
const em = flood.body.emergency;
ck("a contractor was dispatched", em?.dispatched === true, JSON.stringify(em));
ck("with a work order number", /^WO-\d+$/.test(em?.woNumber || ""), em?.woNumber);
const row = (await call(pm, "/jobs")).body.find((j) => j.id === flood.body.id);
ck("the report approved itself, because dispatching requires it", !!row?.approvedAt);
ck("and carries the assignment", Object.keys(row?.assignments || {}).length === 1, JSON.stringify(Object.keys(row?.assignments || {})));
ck("on a two-hour clock, not the usual day",
  Object.values(row.assignments)[0]?.responseWindow === "2h" || Object.values(row.assignments)[0]?.status === "accepted",
  JSON.stringify(Object.values(row.assignments)[0]?.responseWindow));
const toCo = (await mail()).filter((m) => /emergency call-out/i.test(m.subject || ""));
ck("the contractor was emailed", toCo.length === 1, `${toCo.length} email(s)`);
ck("and the subject says what it is", /Emergency call-out/.test(toCo[0]?.subject || ""), toCo[0]?.subject);
const sms = await texts();
ck("and texted too, because two in the morning is the point", sms.length >= 1, `${sms.length} text(s)`);
// Twilio posts form fields, so the stand-in records Body with a capital B.
ck("the text names the address", /101 Main St/.test(sms.map((x) => x.Body || "").join(" ")), sms[0]?.Body?.slice(0, 90));
ck("and says plainly that it is an emergency", /EMERGENCY/.test(sms[0]?.Body || ""), sms[0]?.Body?.slice(0, 40));

console.log("\n-- a fire is never dispatched --");
await clear();
const fire2 = await report("I can smell gas", `Gas ${S}`);
ck("it is life safety", fire2.body.severity === "911");
ck("nothing was sent to a contractor", !fire2.body.emergency, JSON.stringify(fire2.body.emergency));
const fireRow = (await call(pm, "/jobs")).body.find((j) => j.id === fire2.body.id);
ck("and it is not auto-approved either", !fireRow?.approvedAt, fireRow?.approvedAt || "not approved");
ck("no contractor was emailed", (await mail()).filter((m) => /call-out/i.test(m.subject || "")).length === 0);
ck("but the manager can see it, flagged", fireRow?.severity === "911", fireRow?.severity);

console.log("\n-- paperwork still counts --");
await call(pm, "/account", { method: "PATCH", body: JSON.stringify({ emergencyCompanyId: "cmp_s" }) });
await clear();
const unverified = await report("A pipe has burst", `Burst C ${S}`);
const why = unverified.body.emergency;
ck("an unverified contractor is not sent into an emergency",
  why?.dispatched === false && why?.reason === "documents_incomplete", JSON.stringify(why));
ck("and the manager is not left thinking somebody is coming",
  !(await call(pm, "/jobs")).body.find((j) => j.id === unverified.body.id)?.approvedAt);

console.log("\n-- turning it back off --");
await call(pm, "/account", { method: "PATCH", body: JSON.stringify({ emergencyCompanyId: null }) });
ck("clearing it works", (await call(pm, "/account")).body.emergencyCompanyId === null);
const after = await report("A pipe has burst", `Burst D ${S}`);
ck("and nothing dispatches again", after.body.emergency?.dispatched === false, after.body.emergency?.reason);

console.log("\n-- a manager's own job is never an emergency --");
const own = await call(pm, "/jobs", { method: "POST", body: JSON.stringify({
  title: `Own work ${S}`, address: "1 HQ Way", trades: [],
  reportDetail: { problem: "A pipe has burst", started: "Today", words: "", unit: "" } }) });
ck("they already know how to prioritise their own work", own.body.severity === null, String(own.body.severity));

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
