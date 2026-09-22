// A tenant is told when their report moves -- if they asked to be.
//
// Read back from the stand-ins, not the database: the thing being checked is
// what reached the inbox and the phone, at which stage, and that turning it
// off means nothing reaches them.
//
//   node scripts/send-stub.mjs &
//   npx wrangler dev --config=./wrangler.toml --local --port 8787
//   node scripts/tenant-notify-test.mjs

const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const ACCOUNT = "acc_pm";
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const call = async (t, path, opts = {}) => {
  const r = await fetch(API + path, { ...opts, headers: { "X-Account-Id": ACCOUNT,
    ...(t ? { Authorization: `Bearer ${t}` } : {}), "content-type": "application/json", ...(opts.headers || {}) } });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};
const emails = async () => (await (await fetch("http://127.0.0.1:8904/__sent")).json());
const texts = async () => (await (await fetch("http://127.0.0.1:8905/__sent")).json());
const clear = async () => { await fetch("http://127.0.0.1:8904/__clear"); await fetch("http://127.0.0.1:8905/__clear"); };
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const pm = await tok("pm@example.test");
const S = Date.now().toString(36);
const email = `nia.${S}@example.test`;

console.log("\n-- a tenant who has signed in --");
await clear();
const made = await call(pm, "/tenants", { method: "POST", body: JSON.stringify({
  propertyId: "p1", firstName: "Nia", lastName: "Osei", email, phone: "(206) 555-0142", unit: "8C", channels: ["email"] }) });
ck("added", made.status === 201, JSON.stringify(made.body?.sent));
const link = (await emails())[0]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
const set = await fetch(`${API}/tenant-invite/${link}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "correct horse battery" }) });
ck("and set up", set.status === 200, String(set.status));
const tenant = await tok(email);
const me = await call(tenant, "/auth/me");
ck("their sign-in carries their notification choices, defaulted",
  me.body?.user?.notify?.email === true && me.body.user.notify.sms === false && me.body.user.notify.statusChanges === true,
  JSON.stringify(me.body?.user?.notify));

console.log("\n-- they report something --");
const rep = await call(tenant, "/jobs", { method: "POST", body: JSON.stringify({
  title: "Bathroom fan is dead", propertyId: "p1", address: "101 Main St", trades: [] }) });
ck("the report goes in as a request", rep.status === 201 && rep.body?.requested === true, JSON.stringify(rep.body));
const jobId = rep.body.id;

console.log("\n-- approved: told by email, by default --");
await clear();
const ap = await call(pm, `/jobs/${jobId}/approve`, { method: "POST" });
ck("approved", ap.status === 200 && ap.body?.ok);
let em = await emails(); let sm = await texts();
ck("one email, to the tenant", em.length === 1 && [].concat(em[0]?.to).join() === email, `${em.length} email(s) to ${[].concat(em[0]?.to || []).join()}`);
ck("saying it was approved, by name", /has been approved/.test(em[0]?.text || "") && /Bathroom fan is dead/.test(em[0]?.text || ""), em[0]?.subject);
ck("with a link to their building's address", /subsub\.work\//.test(em[0]?.text || ""));
ck("and no text, because they did not ask for one", sm.length === 0, `${sm.length} text(s)`);
ck("the manager approving is not the one told", ![].concat(em[0]?.to).includes("pm@example.test"));

console.log("\n-- they ask for texts as well --");
const prefs = await call(tenant, "/me", { method: "PATCH", body: JSON.stringify({ notify: { email: true, sms: true, statusChanges: true } }) });
ck("saved", prefs.status === 200 && prefs.body?.notify?.sms === true, JSON.stringify(prefs.body));
ck("and read back on the next sign-in", (await call(tenant, "/auth/me")).body?.user?.notify?.sms === true);

console.log("\n-- a contractor is assigned: told both ways --");
await clear();
const as = await call(pm, `/jobs/${jobId}/assign`, { method: "POST", body: JSON.stringify({
  trade: "electrical", companyId: "cmp_r", responseWindow: "24h" }) });
ck("assigned", as.status === 201, JSON.stringify(as.body));
em = await emails(); sm = await texts();
const toTenant = em.filter((m) => [].concat(m.to).join() === email);
ck("an email to the tenant", toTenant.length === 1, `${toTenant.length} (of ${em.length} total; the contractor gets the work order)`);
ck("saying a contractor has it", /gone to a contractor|contractor assigned/i.test(toTenant[0]?.text || ""), toTenant[0]?.subject);
ck("and a text, now that they asked", sm.length === 1 && sm[0]?.To === "+12065550142", JSON.stringify(sm.map((t) => t.To)));
ck("short enough to send as one", (sm[0]?.Body || "").length <= 160, `${(sm[0]?.Body || "").length} chars`);

console.log("\n-- the contractor accepts: told it is booked --");
await clear();
const sub = await tok("ana@rainier.test");
const woId = as.body.id;
const acc = await call(sub, `/work-orders/${woId}/respond`, { method: "POST", body: JSON.stringify({ status: "accepted" }) });
ck("accepted", acc.status === 200, JSON.stringify(acc.body));
em = (await emails()).filter((m) => [].concat(m.to).join() === email);
ck("told it has a contractor assigned", em.length === 1 && /contractor assigned/i.test(em[0]?.text || ""), em[0]?.subject);

console.log("\n-- they turn it off --");
await call(tenant, "/me", { method: "PATCH", body: JSON.stringify({ notify: { email: true, sms: true, statusChanges: false } }) });
await clear();
const done = await call(pm, `/jobs/${jobId}/complete`, { method: "POST" });
ck("the job completes", done.status === 200);
em = (await emails()).filter((m) => [].concat(m.to).join() === email); sm = await texts();
ck("and nothing reaches them", em.length === 0 && sm.length === 0, `${em.length} email(s), ${sm.length} text(s)`);

console.log("\n-- and back on, for the last word --");
await call(tenant, "/me", { method: "PATCH", body: JSON.stringify({ notify: { email: true, sms: false, statusChanges: true } }) });
await call(pm, `/jobs/${jobId}/reopen`, { method: "POST" });
await clear();
await call(pm, `/jobs/${jobId}/complete`, { method: "POST" });
em = (await emails()).filter((m) => [].concat(m.to).join() === email);
ck("done is said as done", em.length === 1 && /is done/.test(em[0]?.text || ""), em[0]?.subject);

console.log("\n-- what is not a tenant's --");
ck("a tenant cannot set somebody else's choices (the route only knows its caller)",
  (await call(tenant, "/me", { method: "PATCH", body: JSON.stringify({ notify: { email: false, sms: false, statusChanges: false }, userId: "usr_pm" }) })).status === 200
  && (await call(pm, "/auth/me")).body?.user?.notify?.statusChanges === true);
await clear();
const own = await call(pm, "/jobs", { method: "POST", body: JSON.stringify({ title: "Office refit", address: "1 HQ Way", trades: [] }) });
await call(pm, `/jobs/${own.body.id}/complete`, { method: "POST" });
ck("an ordinary job, reported by nobody, tells nobody", (await emails()).length === 0 && (await texts()).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
