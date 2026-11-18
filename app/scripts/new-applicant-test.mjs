// A CONTRACTOR WHO JOINS THE ROSTER ON THEIR OWN IS SAID ON THE DASHBOARD.
//
// Reported as "a subcontractor just signed up for Outerhome, but it's not
// showing up ... if a new subcontractor signed up to be on your roster, it
// should show annotation on your dashboard. It's an important event."
//
// Server half. What this pins:
//   An application through the public form is carried on /api/subs as
//   appliedAt (ISO, with a Z), appliedVia "form", applicationSeenAt null.
//   POST /api/subs/:companyId/application-seen records it as seen, for this
//   account's own engagement only; anybody else's is not_found.
//   The rule the dashboard reads (shared/applicants.js): unseen, or seen
//   before the newest application, and within APPLICANT_DAYS.
//
//   node --no-warnings scripts/new-applicant-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { newApplicants, applicantLine, APPLICANT_DAYS } from "../shared/applicants.js";
import { onRoster } from "../shared/roster.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d && !ok ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const db = freshDb({ base: SCHEMA, migrations: [] });
db.exec(`
  INSERT INTO accounts(id,name,subdomain,kind,plan,billing) VALUES
    ('acc','Outerhome','outerhome','general_contractor','scale','monthly'),
    ('acc2','Other GC','othergc','general_contractor','scale','monthly');
  INSERT INTO users(id,name,email) VALUES ('u_ann','Ann Lee','ann@x.test'),('u_zed','Zed','zed@x.test'),
    ('u_pat','Pat','pat@x.test'),('u_dup','Ann Again','ANN@x.test');
  INSERT INTO users(id,name,email,notify) VALUES ('u_off','Off','off@x.test','{"email":false}');
  INSERT INTO memberships(id,user_id,account_id,role) VALUES
    ('m_ann','u_ann','acc','admin'),('m_zed','u_zed','acc2','admin'),
    ('m_pat','u_pat','acc','pm'),('m_off','u_off','acc','admin'),('m_dup','u_dup','acc','pm');
`);
// Resend, stubbed at fetch, so the mail is what was really asked to go.
const mails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://mail.test/")) {
    mails.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "m" + mails.length }), { status: 200 });
  }
  return realFetch(url, init);
};
const env = { DB: makeD1(db), RESEND_API_KEY: "k", MAIL_FROM: "hello@subsub.work", RESEND_API_BASE: "https://mail.test" };
const call = async (path, { method = "GET", as = "u_ann", acct = "acc", body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, headers: { "Content-Type": "application/json", "X-User-Id": as, "X-Account-Id": acct },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env, { waitUntil() {} });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

console.log("\n-- an application through the public form --");
const applied = await worker.fetch(new Request("https://api.subsub.work/api/apply/outerhome", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ company: "Bay Roofing", contact: "Rae Bay", email: "rae@bay.test", categories: ["roofing"] }),
}), env, { waitUntil() {} });
ck("the application is accepted", applied.status === 200, String(applied.status));

console.log("\n-- the account is told by email --");
const told = mails.filter((m) => /roster/.test(m.subject));
const toList = told.map((m) => m.to[0].toLowerCase()).sort();
ck("the admin and the project manager are emailed", toList.includes("ann@x.test") && toList.includes("pat@x.test"), JSON.stringify(toList));
ck("somebody who turned email off is not", !toList.includes("off@x.test"), JSON.stringify(toList));
ck("one address is emailed once", toList.filter((t) => t === "ann@x.test").length === 1, JSON.stringify(toList));
ck("nobody on another account is", !toList.includes("zed@x.test"), JSON.stringify(toList));
const annMail = told.find((m) => m.to[0] === "ann@x.test");
ck("it names the company and says they applied", /Bay Roofing applied to join your roster/.test(annMail?.subject || ""), annMail?.subject);
ck("it greets them by first name", /^Hi Ann,/.test(annMail?.text || ""), annMail?.text);
ck("it links straight to their card", /\/\?open=sub&id=/.test(annMail?.text || ""), annMail?.text);
ck("the applicant still gets their own confirmation", mails.some((m) => m.to[0] === "rae@bay.test"));
const logged = db.prepare("SELECT COUNT(*) n FROM email_log WHERE kind = 'roster_joined' AND account_id = 'acc'").get().n;
ck("each send is logged", logged === 2, String(logged));

let subs = (await call("/api/subs")).body;
let bay = (subs || []).find((s) => s.company === "Bay Roofing");
ck("Bay Roofing is on the roster", !!bay, JSON.stringify(subs));
ck("carrying when it applied, as ISO with a Z", /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(bay?.appliedAt || ""), String(bay?.appliedAt));
ck("through the form", bay?.appliedVia === "form", String(bay?.appliedVia));
ck("and nobody has looked yet", bay?.applicationSeenAt === null, String(bay?.applicationSeenAt));
ck("so the dashboard rule lists it", newApplicants(subs).some((s) => s.company === "Bay Roofing"));
ck("as an application", /Applied to join/.test(applicantLine(bay)));

console.log("\n-- 102: it waits for a yes rather than landing on the roster --");
ck("it is held off the roster (paused)", bay?.status === "paused" && !onRoster(bay?.status), String(bay?.status));
ck("as a pending application", bay?.application === "pending", String(bay?.application));
const rae = mails.find((m) => m.to[0] === "rae@bay.test");
ck("the applicant is told it is being reviewed", /review it and let you know whether they accept/.test(rae?.text || ""), rae?.text);
ck("with a link to sign in", /https:\/\/(outerhome|app)\.subsub\.work\//.test(rae?.text || ""), rae?.text);
ck("and what to add", /Certificate of insurance[\s\S]*W-9[\s\S]*license number/.test(rae?.text || ""), rae?.text);
ck("the account is asked to accept or decline", /accept or decline/.test(annMail?.subject || "") && /SubSub Standard Subcontractor Agreement/.test(annMail?.text || ""), annMail?.text);

console.log("\n-- marking it seen --");
const other = await call(`/api/subs/${bay.id}/application-seen`, { method: "POST", as: "u_zed", acct: "acc2" });
ck("another account cannot mark it", other.status === 404 && other.body.error === "not_found", JSON.stringify(other));
const seen = await call(`/api/subs/${bay.id}/application-seen`, { method: "POST" });
ck("this account can", seen.status === 200 && seen.body.ok, JSON.stringify(seen));
// The same second as the application: seen stamps can tie it, and a tie is seen.
subs = (await call("/api/subs")).body;
bay = subs.find((s) => s.company === "Bay Roofing");
ck("it comes back seen", !!bay?.applicationSeenAt, String(bay?.applicationSeenAt));
ck("and drops off the dashboard", !newApplicants(subs).some((s) => s.company === "Bay Roofing"), JSON.stringify(bay));

console.log("\n-- accepting and declining --");
{
  const otherAcc = await call(`/api/subs/${bay.id}/application`, { method: "POST", as: "u_zed", acct: "acc2", body: { decision: "accept" } });
  ck("another account cannot decide it", otherAcc.status === 404, JSON.stringify(otherAcc));
  const bad = await call(`/api/subs/${bay.id}/application`, { method: "POST", body: { decision: "maybe" } });
  ck("a decision that is neither is refused", bad.status === 400 && bad.body.error === "bad_decision", JSON.stringify(bad));
  const before = mails.length;
  const ok = await call(`/api/subs/${bay.id}/application`, { method: "POST", body: { decision: "accept" } });
  ck("accepting puts them on the roster", ok.status === 200 && ok.body.status === "active" && ok.body.application === "accepted", JSON.stringify(ok));
  const again = await call(`/api/subs/${bay.id}/application`, { method: "POST", body: { decision: "decline" } });
  ck("and a second press decides nothing", again.status === 409 && again.body.error === "not_pending" && again.body.state === "accepted", JSON.stringify(again));
  const told2 = mails.slice(before).find((m) => m.to[0] === "rae@bay.test");
  ck("the applicant hears they were accepted", /accepted your application/.test(told2?.subject || ""), told2?.subject);
  const s2 = (await call("/api/subs")).body.find((x) => x.id === bay.id);
  ck("the roster reads them as active and accepted", s2?.status === "active" && s2?.application === "accepted", JSON.stringify(s2));

  await worker.fetch(new Request("https://api.subsub.work/api/apply/outerhome", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company: "Nope Paint", contact: "Ned", email: "ned@nope.test", categories: ["painting"] }),
  }), env, { waitUntil() {} });
  const nope = (await call("/api/subs")).body.find((x) => x.company === "Nope Paint");
  ck("a second applicant is pending", nope?.application === "pending" && nope?.status === "paused", JSON.stringify(nope));
  const b2 = mails.length;
  const no = await call(`/api/subs/${nope.id}/application`, { method: "POST", body: { decision: "decline" } });
  ck("declining ends it", no.status === 200 && no.body.status === "ended" && no.body.application === "declined", JSON.stringify(no));
  const seats = db.prepare("SELECT COUNT(*) n FROM memberships WHERE account_id = 'acc' AND company_id = ? AND role = 'contractor'").get(nope.id).n;
  ck("and takes away the seat applying gave them", seats === 0, String(seats));
  const told3 = mails.slice(b2).find((m) => m.to[0] === "ned@nope.test");
  ck("they are told kindly, with no reason", /aren't taking Nope Paint on right now/.test(told3?.text || ""), told3?.text);

  const { readFileSync: rf } = await import("node:fs");
  const { runCheck } = await import("./lib/check-sql.mjs");
  const chk = runCheck(db);
  ck("the invariant reads zero", chk.m102_inv_pending_on_roster === 0, String(chk.m102_inv_pending_on_roster));
  db.exec(`INSERT INTO roster_applications(engagement_id,account_id,company_id,state) VALUES ('ghost','acc','x','pending')`);
  ck("and counts a pending row nothing holds off the roster", runCheck(db).m102_inv_pending_on_roster === 1);
  db.exec(`DELETE FROM roster_applications WHERE engagement_id = 'ghost'`);
}

console.log("\n-- the rule --");
const now = Date.parse("2026-11-09T12:00:00Z");
const r = newApplicants([
  { id: "a", appliedAt: "2026-11-09T10:00:00Z", applicationSeenAt: null },
  { id: "b", appliedAt: "2026-11-08T10:00:00Z", applicationSeenAt: "2026-11-01T10:00:00Z", appliedVia: "invite" },
  { id: "c", appliedAt: "2026-11-08T10:00:00Z", applicationSeenAt: "2026-11-08T11:00:00Z" },
  { id: "d", appliedAt: new Date(now - (APPLICANT_DAYS + 1) * 86400000).toISOString(), applicationSeenAt: null },
  { id: "e", appliedAt: null },
], now).map((s) => s.id);
ck("unseen and seen-before-applying are listed, newest first", JSON.stringify(r) === '["a","b"]', JSON.stringify(r));
ck("an invite reads as accepting it", /Accepted your invite/.test(applicantLine({ appliedVia: "invite" })));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
