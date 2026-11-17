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
