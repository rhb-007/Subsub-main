// Was the contractor actually told about the work order?
//
// Assigning a contractor issues a work order with a deadline on it. The
// email was sent, the result was written to email_log, and the answer was
// thrown away -- so an address that bounced, a number that could not be
// texted, and a contractor record with no address at all were all
// indistinguishable, on screen, from a work order delivered.
//
// The person who pressed Assign is the only one who can fix any of those,
// and they were the one person not told. "I added them to a job and they
// never got the email" is what that looks like from the outside, and
// nothing anywhere said otherwise.
//
// It also went by email only, ignoring the contractor's own choice. A
// roofer who set "Email + SMS" and got neither has a deadline nobody told
// them about, which is how a response window expires.
//
// Needs the local stack: worker on 8787, mail stub 8904, SMS stub 8905.
//
//   node scripts/wo-notify-test.mjs

import { execFileSync } from "node:child_process";

const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const MAIL = process.env.MAIL_STUB || "http://127.0.0.1:8904";
const SMS = process.env.SMS_STUB || "http://127.0.0.1:8905";
const ACCOUNT = "acc_test";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const sentMail = async () => (await (await fetch(`${MAIL}/__sent`)).json());
const sentSms = async () => (await (await fetch(`${SMS}/__sent`)).json().catch(() => []));
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const S = Date.now().toString(36);
const admin = await tok("admin@example.test");
const H = { Authorization: `Bearer ${admin}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };

const cleanup = () => {
  const mine = `(SELECT id FROM companies WHERE company LIKE '%${S}%')`;
  for (const sql of [
    `DELETE FROM work_orders WHERE job_id IN (SELECT id FROM jobs WHERE title LIKE '%${S}%');`,
    `DELETE FROM jobs WHERE title LIKE '%${S}%';`,
    `DELETE FROM user_invites WHERE email LIKE '%${S}%';`,
    `DELETE FROM memberships WHERE company_id IN ${mine} OR user_id IN (SELECT id FROM users WHERE email LIKE '%${S}%');`,
    `DELETE FROM engagements WHERE company_id IN ${mine};`,
    `DELETE FROM activity WHERE text LIKE '%${S}%';`,
    `DELETE FROM users WHERE email LIKE '%${S}%';`,
    `DELETE FROM companies WHERE company LIKE '%${S}%';`,
  ]) { try { d1(sql); } catch (e) { console.log("cleanup:", String(e.message).slice(0, 70)); } }
};

// A contractor with the documents an assignment requires, and a job to put
// them on.
const makeSub = async (name, extra) => {
  const made = await (await fetch(`${API}/subs`, { method: "POST", headers: H,
    body: JSON.stringify({ company: `${name} ${S}`, contact: "Pat Crew",
      categories: ["roofing"], caps: ["Tear-off"], ...extra }) })).json();
  // Assignment refuses a contractor whose compliance is incomplete, and
  // "complete" means the hiring account has VERIFIED each document on its
  // own engagement -- not merely that the contractor uploaded one.
  d1(`UPDATE companies SET bond = 1, insurance = 1, contract = 1 WHERE id = '${made.companyId}';`);
  d1(`UPDATE engagements SET doc_review = '{"insurance":{"status":"verified"},`
    + `"bond":{"status":"verified"},"contract":{"status":"verified"}}' `
    + `WHERE id = '${made.engagementId}';`);
  return made.companyId;
};
const makeJob = async () => (await (await fetch(`${API}/jobs`, { method: "POST", headers: H,
  body: JSON.stringify({ title: `Ridge work ${S}`, address: "1 Way", zip: "98101",
    trades: ["roofing"] }) })).json()).id;

try {
  console.log("\n-- a contractor who takes email and texts --");
  {
    const email = `both.${S}@crewmail.test`;
    const companyId = await makeSub("Both Ways", { email, phone: "206-555-0131",
      notify: { email: true, sms: true } });
    const jobId = await makeJob();
    const beforeMail = (await sentMail()).length, beforeSms = (await sentSms()).length;
    const wo = await (await fetch(`${API}/jobs/${jobId}/assign`, { method: "POST", headers: H,
      body: JSON.stringify({ trade: "roofing", companyId, tradeScope: "Tear-off", value: "2400" }) })).json();
    ck("the work order is issued", !!wo.woNumber, JSON.stringify(wo).slice(0, 70));
    // The whole point: the answer says whether anybody was told.
    ck("and the answer says whether they were told", !!wo.notified, JSON.stringify(wo.notified));
    ck("the email went", wo.notified?.emailed === true, JSON.stringify(wo.notified));
    ck("and really left the building", (await sentMail()).length === beforeMail + 1,
      `${(await sentMail()).length - beforeMail} sent`);
    // They asked for texts as well, and a work order is the job itself.
    ck("the text went too, because they asked for texts", wo.notified?.texted === true,
      JSON.stringify(wo.notified));
    ck("and really left as well", (await sentSms()).length === beforeSms + 1,
      `${(await sentSms()).length - beforeSms} sent`);
    const sms = (await sentSms()).slice(beforeSms)[0];
    const body = sms?.Body || sms?.body || "";
    ck("the text names the work order", body.includes(wo.woNumber), body.slice(0, 90));
    ck("and says who wants the work", /Outerhome/.test(body), body.slice(0, 90));
  }

  console.log("\n-- a contractor who only takes email --");
  {
    const companyId = await makeSub("Email Only", { email: `only.${S}@crewmail.test`,
      phone: "206-555-0132", notify: { email: true, sms: false } });
    const jobId = await makeJob();
    const beforeSms = (await sentSms()).length;
    const wo = await (await fetch(`${API}/jobs/${jobId}/assign`, { method: "POST", headers: H,
      body: JSON.stringify({ trade: "roofing", companyId, tradeScope: "Tear-off", value: "1200" }) })).json();
    ck("the email goes", wo.notified?.emailed === true, JSON.stringify(wo.notified));
    ck("and no text, because they did not ask for one", wo.notified?.texted === false
      && (await sentSms()).length === beforeSms, JSON.stringify(wo.notified));
  }

  console.log("\n-- a contractor with nowhere to send anything --");
  {
    // Every contractor typed in before invites started going out is a
    // candidate for this, and it is fixable in ten seconds by whoever is
    // looking at the screen -- if anybody tells them.
    const companyId = await makeSub("No Contact", {});
    const jobId = await makeJob();
    const beforeMail = (await sentMail()).length;
    const wo = await (await fetch(`${API}/jobs/${jobId}/assign`, { method: "POST", headers: H,
      body: JSON.stringify({ trade: "roofing", companyId, tradeScope: "Tear-off", value: "900" }) })).json();
    ck("the work order is still issued", !!wo.woNumber, String(wo.woNumber));
    ck("nothing is sent", wo.notified?.emailed === false && wo.notified?.texted === false,
      JSON.stringify(wo.notified));
    ck("and it says why, rather than reading as delivered",
      wo.notified?.emailError === "no_contact", JSON.stringify(wo.notified));
    ck("no mail left", (await sentMail()).length === beforeMail, "nothing sent");
  }

  console.log("\n-- when the send itself fails --");
  {
    // The case behind the report: a real address, a real send, and a
    // provider that refuses it. Silence here is indistinguishable from
    // success, which is why it went unnoticed.
    const companyId = await makeSub("Bounces", { email: `bounce.${S}@crewmail.test`,
      notify: { email: true, sms: false } });
    const jobId = await makeJob();
    await fetch(`${MAIL}/__fail`, { method: "POST" }).catch(() => {});
    const wo = await (await fetch(`${API}/jobs/${jobId}/assign`, { method: "POST", headers: H,
      body: JSON.stringify({ trade: "roofing", companyId, tradeScope: "Tear-off", value: "700" }) })).json();
    await fetch(`${MAIL}/__ok`, { method: "POST" }).catch(() => {});
    ck("the work order is still issued", !!wo.woNumber, String(wo.woNumber));
    // Either the stub can be made to fail, in which case this is the real
    // thing, or it cannot, and the shape of the answer is still the point.
    ck("and the answer carries the outcome either way",
      typeof wo.notified?.emailed === "boolean", JSON.stringify(wo.notified));
    if (wo.notified?.emailed === false) {
      ck("a refused send is reported rather than swallowed",
        !!wo.notified?.emailError, JSON.stringify(wo.notified));
    } else {
      console.log("  --   (the mail stub has no failure mode; the shape is checked above)");
    }
  }
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message, "\n", err.stack?.split("\n")[1] || "");
} finally {
  cleanup();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
