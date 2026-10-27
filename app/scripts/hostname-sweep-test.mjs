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
const ins = (id, sub, status, err) => {
  const row = { id, name: id, subdomain: sub, plan: "scale", hostname_status: status, hostname_error: err };
  const keys = Object.keys(row).filter((k) => cols.includes(k));
  db.prepare(`INSERT INTO accounts (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => row[k]));
};
ins("acc_stuck", "ruddproperties", "pending", "CNAME record not set");
ins("acc_wait", "waiting", "pending", null);

const calls = [];
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(typeof url === "string" ? url : url.url);
  const m = init.method || "GET";
  calls.push(`${m} ${u.pathname}`);
  if (u.pathname.endsWith("/dns_records") && m === "GET") {
    const name = u.searchParams.get("name");
    return json({ success: true, result: [{ id: "r1", name, type: "CNAME", content: "subsub-app.pages.dev", proxied: true }] });
  }
  if (/\/pages\/projects\/subsub-app\/domains$/.test(u.pathname)) return json({ success: false, errors: [{ message: "Domain already exists" }] }, 409);
  const dm = u.pathname.match(/\/domains\/(.+)$/);
  if (dm) {
    const name = decodeURIComponent(dm[1]);
    if (m === "PATCH") return json({ success: true, result: { name, status: "pending" } });
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
