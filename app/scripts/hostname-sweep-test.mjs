// The nightly sweep and a branded address stuck on "CNAME record not set".
//
// PENDING WITH AN ERROR ON IT IS NOT WAITING, IT IS STUCK. The sweep used to
// only ASK about a pending address, so a domain Pages registered before its
// CNAME existed sat on that error for ever. Pinned here: a pending address
// with an error is re-provisioned (Pages asked to re-validate), and one
// merely waiting on its certificate is only asked.
//
//   node --no-warnings scripts/hostname-sweep-test.mjs
import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const db = freshDb({ base: SCHEMA, migrations: [] });
const cols = db.prepare("PRAGMA table_info(accounts)").all().map((c) => c.name);
const ins = (id, sub, status, err, extra = {}) => {
  const row = { id, name: id, subdomain: sub, plan: "scale", hostname_status: status, hostname_error: err, ...extra };
  const keys = Object.keys(row).filter((k) => cols.includes(k));
  db.prepare(`INSERT INTO accounts (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => row[k]));
};
ins("acc_stuck", "ruddproperties", "pending", "CNAME record not set");
ins("acc_wait", "waiting", "pending", null);
// What kept soundm on "being prepared": a comp that is Scale everywhere but
// the plan column, an answer ("absent") the sweep never looked at again, and
// a pending address whose Pages domain no longer exists.
ins("acc_comp", "compedco", null, null, { plan: "basic", comped: 1 });
ins("acc_absent", "absentco", "absent", null);
ins("acc_gone", "goneco", "pending", null);
ins("acc_compactive", "compactive", "active", null, { plan: "basic", comped: 1 });
db.exec(`INSERT INTO users(id,name,email) VALUES ('u_a','Ann','ann@x.test'),('u_p','Pat','pat@x.test');
  INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m1','u_a','acc_comp','admin'),('m2','u_p','acc_comp','pm');`);

const calls = [];
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === "string" ? url : url.url);
  const m = init.method || "GET";
  calls.push(`${m} ${u.pathname}`);
  if (m === "POST" && /\/domains$/.test(u.pathname)) {
    const nm = JSON.parse(init.body || "{}").name || "";
    calls.push(`POST ${u.pathname}#${nm.split(".")[0]}`);
  }
  if (u.pathname.endsWith("/dns_records") && m === "GET") {
    const name = u.searchParams.get("name");
    return json({ success: true, result: [{ id: "r1", name, type: "CNAME", content: "subsub-app.pages.dev", proxied: true }] });
  }
  if (/\/pages\/projects\/subsub-app\/domains$/.test(u.pathname)) {
    const name = JSON.parse(init.body || "{}").name;
    if (["compedco", "absentco", "goneco"].some((n) => name?.startsWith(n))) return json({ success: true, result: { name, status: "pending" } });
    return json({ success: false, errors: [{ message: "Domain already exists" }] }, 409);
  }
  const dm = u.pathname.match(/\/domains\/(.+)$/);
  if (dm) {
    const name = decodeURIComponent(dm[1]);
    if (m === "PATCH") return json({ success: true, result: { name, status: "pending" } });
    if (m === "DELETE") return json({ success: true, result: {} });
    // goneco: Pages has no such domain until the sweep registers it again.
    if (name.startsWith("goneco") && !calls.includes("POST /client/v4/accounts/a1/pages/projects/subsub-app/domains#goneco"))
      return json({ success: false, errors: [{ message: "not found" }] }, 404);
    const stuck = name.startsWith("ruddproperties") && !calls.some((c) => c.startsWith("PATCH") && c.includes(name));
    return json({ success: true, result: { name, status: "pending", ...(stuck ? { verification_data: { error_message: "CNAME record not set" } } : {}) } });
  }
  throw new Error("unexpected " + m + " " + u.pathname);
};

const { default: worker } = await import("../worker/index.js");
const env = { DB: makeD1(db), CRON_SECRET: "cron", CF_API_TOKEN: "t".repeat(40), CF_ZONE_ID: "z1",
  CF_ACCOUNT_ID: "a1", CF_PAGES_PROJECT: "subsub-app", APP_DOMAIN: "subsub.work" };
const res = await worker.fetch(new Request("https://api.subsub.work/api/cron/hostname-sweep",
  { headers: { Authorization: "Bearer cron" } }), env, { waitUntil() {} });
ck("the sweep runs", res.status === 200, String(res.status));
ck("Pages is asked to re-validate the stuck address",
  calls.includes("PATCH /client/v4/accounts/a1/pages/projects/subsub-app/domains/ruddproperties.subsub.work"), calls.join(" | "));
ck("the address merely waiting is only asked, never patched",
  !calls.some((c) => c.startsWith("PATCH") && c.includes("waiting.subsub.work")));
const row = db.prepare("SELECT hostname_status, hostname_error FROM accounts WHERE id = 'acc_stuck'").get();
ck("and the stale error is cleared", row.hostname_status === "pending" && row.hostname_error === null, JSON.stringify(row));

const st = (id) => db.prepare("SELECT hostname_status FROM accounts WHERE id = ?").get(id)?.hostname_status;
ck("a comped account on the Basic plan column is set up", st("acc_comp") === "pending"
  && calls.includes("POST /client/v4/accounts/a1/pages/projects/subsub-app/domains#compedco"), String(st("acc_comp")));
ck("an account stored as absent is set up again", st("acc_absent") === "pending"
  && calls.includes("POST /client/v4/accounts/a1/pages/projects/subsub-app/domains#absentco"), String(st("acc_absent")));
ck("a pending address Pages no longer has is registered, not left absent", st("acc_gone") === "pending"
  && calls.includes("POST /client/v4/accounts/a1/pages/projects/subsub-app/domains#goneco"), String(st("acc_gone")));
ck("and a live comped address is never taken down",
  !calls.some((c) => c.startsWith("DELETE") && c.includes("compactive")) && st("acc_compactive") === "active");

console.log("\n-- the Branding tab's Check now --");
const post = (seat) => worker.fetch(new Request("https://api.subsub.work/api/account/hostname", {
  method: "POST", headers: { "X-User-Id": seat[0], "X-Account-Id": seat[1] } }), env, { waitUntil() {} });
db.exec(`UPDATE accounts SET hostname_status = NULL WHERE id = 'acc_comp'`);
const before = calls.length;
const r1 = await post(["u_a", "acc_comp"]);
const b1 = await r1.json();
ck("an admin's press runs the setup and answers the status", r1.status === 200 && b1.hostnameStatus === "pending"
  && calls.slice(before).some((c) => c.includes("compedco")), `${r1.status} ${JSON.stringify(b1)}`);
ck("a project manager is refused", (await post(["u_p", "acc_comp"])).status === 403);
let last;
for (let i = 0; i < 6; i++) last = await post(["u_a", "acc_comp"]);
ck("and it is rate-limited", last.status === 429, String(last.status));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
