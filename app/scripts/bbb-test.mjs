// 089. A SUB'S BBB RATING ON THEIR PASSPORT, through the real Worker.
//
// What is pinned is what a later pass would undo, or get wrong quietly:
//
//   THE SUB LINKS THEIR OWN PROFILE. A whole bbb.org profile address, never a
//   name, never another host, never a search page.
//
//   NOTHING DRAWS UNTIL IT IS TRUE AND FRESH. No API key, no grade, or a
//   reading older than BBB's 30-day rule: the public page carries no rating.
//
//   A FAILED READ KEEPS THE LAST GOOD ONE. An outage stamps last_failed_at and
//   leaves the grade; linking a DIFFERENT business clears it.
//
//   node --no-warnings scripts/bbb-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { parseBbbProfileUrl, readBbbAnswer, bbbPublic, bbbOwnView, BBB_STALE_DAYS } from "../shared/bbb.js";
import { addDaysIso } from "../shared/docs.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const TODAY = new Date().toISOString().slice(0, 10);
const day = (n) => addDaysIso(TODAY, n);
const URL_OK = "https://www.bbb.org/us/wa/tacoma/profile/roofing-contractors/bay-roofing-1296-1000123456";

// ---- the rules -------------------------------------------------------------------
console.log("\nthe rules");
let p = parseBbbProfileUrl(URL_OK + "?utm=x#reviews");
ck("a profile address gives both ids", p.ok && p.bbbId === "1296" && p.businessId === "1000123456", JSON.stringify(p));
ck("the query and anchor are dropped", p.url === URL_OK);
ck("an address without https still parses", parseBbbProfileUrl("bbb.org/us/wa/t/profile/r/bay-1296-1000123456").ok);
ck("another host is refused", parseBbbProfileUrl("https://evil.test/us/profile/r/bay-1296-1000123456").error === "not_a_bbb_profile");
ck("a host that only starts with bbb.org is refused", !parseBbbProfileUrl("https://www.bbb.org.evil.test/profile/r/bay-1296-1000123456").ok);
ck("a search page is refused", !parseBbbProfileUrl("https://www.bbb.org/search?find_text=bay").ok);
ck("a bare name is refused", !parseBbbProfileUrl("Bay Roofing").ok);
ck("empty says empty", parseBbbProfileUrl("  ").error === "empty");
ck("the API answer is read in its documented spelling",
  JSON.stringify(readBbbAnswer({ SearchResults: [{ BBBRating: "a+", IsBBBAccredited: true }] })) === '{"ok":true,"rating":"A+","accredited":true}');
ck("an answer naming neither is unreadable, never a guess", readBbbAnswer({ SearchResults: [{ Name: "x" }] }).error === "unreadable");
ck("an empty answer is not found", readBbbAnswer({ SearchResults: [] }).error === "not_found");
const row = { profile_url: URL_OK, rating: "A", accredited: 1, checked_at: day(-3) };
ck("a fresh grade draws while live", bbbPublic(row, { live: true, today: TODAY })?.rating === "A");
ck("not while the API is off", bbbPublic(row, { live: false, today: TODAY }) === null);
ck(`a reading ${BBB_STALE_DAYS} days old still draws`, !!bbbPublic({ ...row, checked_at: day(-BBB_STALE_DAYS) }, { live: true, today: TODAY }));
ck("one day past that does not", bbbPublic({ ...row, checked_at: day(-BBB_STALE_DAYS - 1) }, { live: true, today: TODAY }) === null);
ck("a stored word that is not a grade does not", bbbPublic({ ...row, rating: "great" }, { live: true, today: TODAY }) === null);
ck("the sub's own view says why nothing shows",
  bbbOwnView({ ...row, checked_at: day(-40) }, { live: true, today: TODAY }).why === "stale"
  && bbbOwnView(row, { live: false, today: TODAY }).why === "not_live"
  && bbbOwnView({ ...row, checked_at: null, last_failed_at: TODAY }, { live: true, today: TODAY }).why === "check_failed");

// ---- through the Worker ----------------------------------------------------------
const bbbCalls = [];
let bbbReply = () => new Response(JSON.stringify({ SearchResults: [{ BBBRating: "A+", IsBBBAccredited: true }] }));
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://bbb.test")) { bbbCalls.push({ u, auth: init.headers?.Authorization }); return bbbReply(); }
  return new Response("{}");
};

const db = freshDb({ base: SCHEMA, migrations: [] });
db.exec(`
  INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
    ('acc_sub','Bay Roofing','bayroof','subcontractor','basic'),
    ('acc_pm','Sound PM','soundpm','property_manager','scale');
  INSERT INTO companies(id,company,contact,city,state) VALUES ('cmp_bay','Bay Roofing','Rae Bay','Tacoma','WA');
  UPDATE accounts SET company_id = 'cmp_bay' WHERE id = 'acc_sub';
  INSERT INTO users(id,name,email) VALUES ('u_sub','Rae Bay','rae@bay.test'), ('u_pm','Pat','pat@pm.test');
  INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_sub','u_sub','acc_sub','admin'), ('m_pm','u_pm','acc_pm','admin');
`);
const off = { DB: makeD1(db), CRON_SECRET: "cron" };
const on = { ...off, BBB_API_TOKEN: "tok", BBB_API_BASE: "https://bbb.test" };
const call = (env, path, { method = "GET", body, who = "u_sub", acct = "acc_sub", headers = {} } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers, ...(who ? { "X-User-Id": who, "X-Account-Id": acct } : {}) },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

console.log("\nlinking, with the API off");
let [s, mine] = await json(await call(off, "/api/my-passport"));
ck("the Passport carries an unlinked BBB view", s === 200 && mine.bbb?.linked === false && mine.bbb?.live === false, JSON.stringify(mine.bbb));
const SLUG = mine.passport.slug;
[s, mine] = await json(await call(off, "/api/my-passport/bbb", { method: "PUT", body: { url: "https://evil.test/x" } }));
ck("a non-BBB address is refused by name", s === 400 && mine.error === "not_a_bbb_profile");
[s, mine] = await json(await call(off, "/api/my-passport/bbb", { method: "PUT", body: { url: URL_OK } }));
ck("a profile links with the API off", s === 200 && mine.bbb.linked && mine.bbb.why === "not_live" && mine.checked === null, JSON.stringify(mine));
ck("and nothing was asked of BBB", bbbCalls.length === 0);
let pub = await (await call(off, `/api/public/passport/${SLUG}`, { who: null })).json();
ck("the public page draws no rating", pub.bbb === null, JSON.stringify(pub.bbb));
[s] = await json(await call(off, "/api/my-passport/bbb", { method: "PUT", body: { url: URL_OK }, who: "u_pm", acct: "acc_pm" }));
ck("a property manager has no Passport to link", s === 409);

console.log("\nwith the API on");
[s, mine] = await json(await call(on, "/api/my-passport/bbb", { method: "PUT", body: { url: URL_OK } }));
ck("linking reads the rating at once", s === 200 && mine.checked?.ok && mine.bbb.rating === "A+" && mine.bbb.shown, JSON.stringify(mine));
ck("BBB is asked about the two ids off the address, with the token", /BBBID=1296/.test(bbbCalls[0]?.u) && /BusinessId=1000123456/.test(bbbCalls[0]?.u) && bbbCalls[0]?.auth === "Bearer tok", JSON.stringify(bbbCalls[0]));
pub = await (await call(on, `/api/public/passport/${SLUG}`, { who: null })).json();
ck("the public page carries the grade, the badge and the profile", pub.bbb?.rating === "A+" && pub.bbb.accredited === true && pub.bbb.url === URL_OK && pub.bbb.checkedOn === TODAY, JSON.stringify(pub.bbb));

bbbReply = () => new Response("down", { status: 503 });
db.prepare(`UPDATE bbb_profiles SET checked_at = ? WHERE company_id = 'cmp_bay'`).run(day(-2));
let sw = await (await call(on, "/api/cron/bbb", { who: null, headers: { Authorization: "Bearer cron" } })).json();
const kept = db.prepare(`SELECT * FROM bbb_profiles`).get();
ck("the sweep tries a row not read today", sw.failed === 1, JSON.stringify(sw));
ck("a failed read keeps the last good grade", kept.rating === "A+" && kept.checked_at === day(-2) && kept.last_error === "bbb_503", JSON.stringify(kept));
pub = await (await call(on, `/api/public/passport/${SLUG}`, { who: null })).json();
ck("and the page still draws it while it is fresh", pub.bbb?.rating === "A+");
db.prepare(`UPDATE bbb_profiles SET checked_at = ? WHERE company_id = 'cmp_bay'`).run(day(-31));
pub = await (await call(on, `/api/public/passport/${SLUG}`, { who: null })).json();
ck("past 30 days it stops drawing", pub.bbb === null);
bbbReply = () => new Response(JSON.stringify({ SearchResults: [{ BBBRating: "B", IsBBBAccredited: false }] }));
sw = await (await call(on, "/api/cron/bbb", { who: null, headers: { Authorization: "Bearer cron" } })).json();
pub = await (await call(on, `/api/public/passport/${SLUG}`, { who: null })).json();
ck("the next good read brings it back, changed", sw.ok === 1 && pub.bbb?.rating === "B" && pub.bbb.accredited === false, JSON.stringify(pub.bbb));
const before = bbbCalls.length;
sw = await (await call(on, "/api/cron/bbb", { who: null, headers: { Authorization: "Bearer cron" } })).json();
ck("a row read today is not asked again", bbbCalls.length === before && sw.ok === 0, JSON.stringify(sw));
ck("the cron route wants the secret", (await call(on, "/api/cron/bbb", { who: null })).status === 403);

console.log("\nchanging and removing");
bbbReply = () => new Response(JSON.stringify({ SearchResults: [] }));
[s, mine] = await json(await call(on, "/api/my-passport/bbb", { method: "PUT",
  body: { url: "https://www.bbb.org/us/wa/tacoma/profile/roofing/other-co-1296-2000999" } }));
const after = db.prepare(`SELECT * FROM bbb_profiles`).get();
ck("a different business clears the old grade", s === 200 && after.rating === null && after.checked_at === null && after.business_id === "2000999", JSON.stringify(after));
ck("and says it was not found", mine.checked?.ok === false && mine.checked.error === "not_found" && mine.bbb.why === "check_failed", JSON.stringify(mine));
[s, mine] = await json(await call(on, "/api/my-passport/bbb", { method: "DELETE" }));
ck("removing unlinks it", s === 200 && mine.bbb.linked === false && !db.prepare(`SELECT 1 FROM bbb_profiles`).get());

console.log("\na database without 089");
db.exec(`DROP TABLE bbb_profiles`);
pub = await call(on, `/api/public/passport/${SLUG}`, { who: null });
ck("the public page still answers, with no rating", pub.status === 200 && (await pub.json()).bbb === null);
sw = await (await call(on, "/api/cron/bbb", { who: null, headers: { Authorization: "Bearer cron" } })).json();
ck("the sweep stands down", sw.skipped === "not migrated", JSON.stringify(sw));
[s, mine] = await json(await call(on, "/api/my-passport/bbb", { method: "PUT", body: { url: URL_OK } }));
ck("linking names the migration", s === 503 && mine.migration === "089_bbb_profiles", JSON.stringify(mine));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
