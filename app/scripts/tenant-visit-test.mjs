// A time for the repair, agreed with the tenant.
//
// Nothing reads as scheduled to a tenant until they have confirmed a
// proposed visit, and declining one puts it back in the manager's lap with
// the tenant's reason attached. Read from the stand-ins where a message is
// the thing being checked.
//
//   npm run test:notify   (its fixture is needed: a contractor with reviewed documents)
//   node scripts/tenant-visit-test.mjs

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
const email = `oda.${S}@example.test`;
await clear();
const made = await call(pm, "/tenants", { method: "POST", body: JSON.stringify({ propertyId: "p1", firstName: "Oda", lastName: "Lind", email, unit: "5D", channels: ["email"] }) });
const link = (await emails())[0]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
await fetch(`${API}/tenant-invite/${link}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery" }) });
const tenant = await tok(email);
const other = await tok(`someone.else.${S}@example.test`);   // a stranger with a token and no seat

console.log("\n-- a report, approved and assigned --");
const rep = await call(tenant, "/jobs", { method: "POST", body: JSON.stringify({ title: `Radiator cold ${S}`, propertyId: "p1", address: "101 Main St", trades: ["hvac"] }) });
const jobId = rep.body.id;
ck("nothing can be proposed before approval",
  (await call(pm, `/jobs/${jobId}/visits`, { method: "POST", body: JSON.stringify({ date: "2026-10-06" }) })).body?.error === "not_approved");
await call(pm, `/jobs/${jobId}/approve`, { method: "POST" });
const as = await call(pm, `/jobs/${jobId}/assign`, { method: "POST", body: JSON.stringify({ trade: "hvac", companyId: "cmp_r", responseWindow: "24h" }) });
ck("assigned", as.status === 201, JSON.stringify(as.body));
const sub = await tok("ana@rainier.test");
await call(sub, `/work-orders/${as.body.id}/respond`, { method: "POST", body: JSON.stringify({ status: "accepted" }) });
const before = (await call(tenant, "/jobs")).body.find((j) => j.id === jobId);
ck("the contractor accepting does NOT put a date on the job", !before.date, String(before.date));

console.log("\n-- the manager proposes a time --");
for (const [label, body, code] of [
  ["a date that isn't one", { date: "next tuesday" }, "bad_date"],
  ["a time that isn't one", { date: "2026-10-06", startTime: "9am" }, "bad_time"],
  ["a window that ends first", { date: "2026-10-06", startTime: "11:00", endTime: "09:00" }, "bad_window"],
]) ck(`refuses ${label}`, (await call(pm, `/jobs/${jobId}/visits`, { method: "POST", body: JSON.stringify(body) })).body?.error === code);
await clear();
const v1 = await call(pm, `/jobs/${jobId}/visits`, { method: "POST", body: JSON.stringify({ date: "2026-10-06", startTime: "09:00", endTime: "11:00", note: "The tech needs the boiler room key too" }) });
ck("proposed", v1.status === 201 && v1.body?.status === "proposed", JSON.stringify(v1.body));
const told = (await emails()).filter((m) => [].concat(m.to).join() === email);
ck("the tenant is told, with the time in it", told.length === 1 && /Oct 6/.test(told[0].text) && /9 AM–11 AM/.test(told[0].text), told[0]?.subject);
ck("and asked to confirm", /confirm/i.test(told[0]?.subject || ""));
const seen = (await call(tenant, "/visits")).body;
ck("they can see it", Array.isArray(seen) && seen.some((v) => v.id === v1.body.id && v.note === "The tech needs the boiler room key too"));
ck("the job still has no date -- proposing is not scheduling", !(await call(tenant, "/jobs")).body.find((j) => j.id === jobId).date);

console.log("\n-- who may answer --");
ck("the manager cannot answer for them", (await call(pm, `/visits/${v1.body.id}/respond`, { method: "POST", body: JSON.stringify({ status: "confirmed" }) })).status === 403);
ck("nor a stranger", (await call(other, `/visits/${v1.body.id}/respond`, { method: "POST", body: JSON.stringify({ status: "confirmed" }) })).status !== 200);
ck("nor is a bad answer taken", (await call(tenant, `/visits/${v1.body.id}/respond`, { method: "POST", body: JSON.stringify({ status: "maybe" }) })).body?.error === "bad_status");

console.log("\n-- it doesn't work for them --");
const no = await call(tenant, `/visits/${v1.body.id}/respond`, { method: "POST", body: JSON.stringify({ status: "declined", note: "At work until 6 on weekdays" }) });
ck("declined, with the reason", no.status === 200 && no.body?.status === "declined" && no.body?.tenantNote === "At work until 6 on weekdays");
ck("the manager sees the reason", (await call(pm, "/visits")).body.some((v) => v.id === v1.body.id && v.status === "declined" && /until 6/.test(v.tenantNote)));
ck("still no date on the job", !(await call(pm, "/jobs")).body.find((j) => j.id === jobId).date);
ck("answering twice is refused", (await call(tenant, `/visits/${v1.body.id}/respond`, { method: "POST", body: JSON.stringify({ status: "confirmed" }) })).body?.error === "not_open");

console.log("\n-- the contractor proposes the next one --");
await clear();
const v2 = await call(sub, `/jobs/${jobId}/visits`, { method: "POST", body: JSON.stringify({ date: "2026-10-07", startTime: "18:30", endTime: "20:00" }) });
ck("a contractor holding the work order may propose", v2.status === 201, JSON.stringify(v2.body));
ck("the earlier one is superseded, so only one is live",
  (await call(pm, "/visits")).body.filter((v) => v.jobId === jobId).length === 1);
ck("the tenant is told again, evening this time", /6:30 PM–8 PM/.test((await emails()).find((m) => [].concat(m.to).join() === email)?.text || ""));

console.log("\n-- and it works --");
const yes = await call(tenant, `/visits/${v2.body.id}/respond`, { method: "POST", body: JSON.stringify({ status: "confirmed" }) });
ck("confirmed", yes.status === 200 && yes.body?.status === "confirmed");
const job = (await call(tenant, "/jobs")).body.find((j) => j.id === jobId);
ck("NOW the job has the date and time", job.date === "2026-10-07" && job.time === "18:30", `${job.date} ${job.time}`);
ck("and the manager's job list agrees", (await call(pm, "/jobs")).body.find((j) => j.id === jobId)?.date === "2026-10-07");

console.log("\n-- a job nobody lives at --");
const own = await call(pm, "/jobs", { method: "POST", body: JSON.stringify({ title: `Lobby paint ${S}`, address: "1 HQ Way", trades: ["painting"] }) });
const v3 = await call(pm, `/jobs/${own.body.id}/visits`, { method: "POST", body: JSON.stringify({ date: "2026-10-09", startTime: "08:00" }) });
ck("stands at once -- there is nobody to ask", v3.body?.status === "confirmed");
ck("and dates the job", (await call(pm, "/jobs")).body.find((j) => j.id === own.body.id)?.date === "2026-10-09");
ck("a contractor with no work order on a job cannot propose for it",
  (await call(sub, `/jobs/${own.body.id}/visits`, { method: "POST", body: JSON.stringify({ date: "2026-10-09" }) })).status === 403);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
