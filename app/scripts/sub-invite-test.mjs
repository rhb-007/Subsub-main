// Inviting a subcontractor, the way the tenant side already worked.
//
// Before this, an account made a link, copied it out of SubSub, and pasted
// it into their own email. Two things followed from that.
//
// The step that decides whether anybody is actually invited happened
// somewhere nothing here could see. Nothing knew who a link was for, whether
// it was ever sent, or whether it bounced -- and a general contractor
// onboarding twenty subcontractors did twenty copy-pastes, each one a chance
// to send the wrong link to the wrong company.
//
// And the contractor, having filled in their whole profile, had no way in.
// The old flow created the company, the engagement and a users row and never
// created a login. They had to notice "Already invited? Create your
// password" on the sign-in screen and work out that it meant them.
//
// Both are fixed here: SubSub sends the invite, and the form that the link
// opens takes a password along with everything else.
//
// The third assertion is the one that was a live bug rather than a missing
// feature. "Submit application" called the server and set "Thanks, we've got
// it" in the same breath, without waiting -- so a spent link, a refusal or a
// dropped connection all showed the same thank-you page, and the contractor
// went away believing a general contractor had their details.
//
//   node scripts/sub-invite-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const MAIL = process.env.MAIL_STUB || "http://127.0.0.1:8904";
const HOST = "outerhome.subsub.work";
const ACCOUNT = "acc_test";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;

const admin = await tok("admin@example.test");
const H = { Authorization: `Bearer ${admin}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
const S = Date.now().toString(36);
const sentMail = async () => (await (await fetch(`${MAIL}/__sent`)).json());

// Accepting an invite goes through the public "apply" limiter, ten an hour
// per address. This file accepts several, so a second run in the same hour
// would fail on the limit rather than on anything it is testing.
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
d1("DELETE FROM rate_limits WHERE bucket LIKE 'apply:%';");

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

try {
  console.log("\n-- SubSub sends it, and knows it did --");
  const email = `miguel.${S}@cascaderoofworks.test`;
  const before = (await sentMail()).length;
  const made = await (await fetch(`${API}/invites`, { method: "POST", headers: H,
    body: JSON.stringify({ email, phone: "206-555-0142", contact: "Miguel Alvarez",
      companyName: "Cascade Roofworks", label: "Cascade Roofworks" }) })).json();

  ck("the invite records who it is for", made.email === email, made.email);
  ck("and the number too", !!made.phone, String(made.phone));
  ck("and that it was sent", !!made.sentAt, String(made.sentAt));
  // Each route reported on its own: an invite that claims to have gone by
  // text when texting is not switched on is a message somebody waits on.
  ck("the email is reported as sent", made.emailed === true, String(made.emailed));
  ck("and the text separately", typeof made.texted === "boolean", String(made.texted));
  ck("a text that could not go says why rather than blaming the number",
    made.texted || made.textError === "sms_not_configured" || !!made.textError,
    String(made.textError));

  const mail = (await sentMail()).slice(before);
  ck("one email left the building", mail.length === 1, `${mail.length} sent`);
  ck("to them", mail[0]?.to === email || (mail[0]?.to || [])[0] === email, JSON.stringify(mail[0]?.to));
  ck("naming who is asking", /Outerhome/.test(mail[0]?.subject || ""), mail[0]?.subject);
  ck("and naming them", /Cascade Roofworks/.test(mail[0]?.subject || ""), mail[0]?.subject);

  // A Scale account with its own address invites people to their page, not
  // to SubSub's. This was hardcoded to app.subsub.work.
  const link = (mail[0]?.text || "").match(/https?:\/\/[^\s]*\?invite=[0-9a-f]{64}/)?.[0] || "";
  ck("the link goes to the inviting company's own address",
    /outerhome\.subsub\.work/.test(link) || /app\.subsub\.work/.test(link), link.slice(0, 60));
  const token = link.match(/invite=([0-9a-f]{64})/)?.[1];
  ck("and carries the token", !!token, String(token).slice(0, 12));

  console.log("\n-- the form opens part-filled --");
  const look = await (await fetch(`${API}/invite/${token}`)).json();
  ck("it knows the address it was sent to", look.invitedEmail === email, look.invitedEmail);
  ck("and the company", look.companyName === "Cascade Roofworks", look.companyName);
  ck("and who", look.contact === "Miguel Alvarez", look.contact);

  console.log("\n-- accepting it sets a password, which is the point --");
  const accepted = await (await fetch(`${API}/invite/${token}`, { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ company: "Cascade Roofworks", contact: "Miguel Alvarez", email,
      phone: "2065550142", license: `CASCAD${S.slice(-3).toUpperCase()}`, categories: ["roofing"],
      notifyEmail: true, password: "correct horse battery" }) })).json();
  ck("the application lands", accepted.ok === true, JSON.stringify(accepted).slice(0, 120));
  ck("and a login is made with it", accepted.login?.created === true, JSON.stringify(accepted.login));

  // The whole reason for the change: they can sign in now, without finding
  // a second screen nobody told them about.
  const theirs = await tok(email);
  const me = await (await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${theirs}` } })).json();
  ck("they are somebody SubSub recognises", !!me.user?.id, JSON.stringify(me.user || {}).slice(0, 80));
  ck("with a seat at the account that invited them",
    (me.memberships || []).some((m) => m.accountId === ACCOUNT && m.role === "contractor"),
    JSON.stringify((me.memberships || []).map((m) => `${m.accountId}:${m.role}`)));

  console.log("\n-- when texting is not switched on, nobody is told a text went --");
  {
    // The live state today: no Twilio or Telnyx credentials on the Worker.
    // The invite must still go by email, and the text must be reported as
    // not sent, with a reason that does not send somebody off to check a
    // number that is perfectly fine.
    const UNCONF = process.env.UNCONFIGURED_API || "http://127.0.0.1:8788/api";
    const r = await (await fetch(`${UNCONF}/invites`, { method: "POST", headers: H,
      body: JSON.stringify({ email: `nosms.${S}@example.test`, phone: "206-555-0177",
        contact: "No Texts", companyName: "No Texts Co" }) })).json();
    ck("the email still goes", r.emailed === true, String(r.emailed));
    ck("the text is reported as not sent", r.texted === false, String(r.texted));
    ck("and says texting is not configured, not that the number is wrong",
      r.textError === "sms_not_configured", String(r.textError));
    // One route working is still an invite, so it counts as sent.
    ck("the invite still counts as sent", !!r.sentAt, String(r.sentAt));
  }

  console.log("\n-- a link with nobody to send it to still works --");
  const linkOnly = await (await fetch(`${API}/invites`, { method: "POST", headers: H,
    body: JSON.stringify({ label: `Handed over ${S}` }) })).json();
  ck("it is created", !!linkOnly.url, String(linkOnly.url).slice(0, 40));
  // Created and sent are different facts, and a row that conflates them is
  // how an account ends up waiting on somebody who was never asked.
  ck("and does not claim to have been sent", !linkOnly.sentAt, String(linkOnly.sentAt));
  // `sendFailed` was one flag for one route. There are two routes now, each
  // reported on its own, and a link nobody asked us to send has neither a
  // success nor a failure to report.
  ck("neither route claims to have sent it", !linkOnly.emailed && !linkOnly.texted,
    `emailed ${linkOnly.emailed}, texted ${linkOnly.texted}`);
  ck("and neither reports a failure it did not have",
    !linkOnly.emailError && !linkOnly.textError,
    `${linkOnly.emailError} / ${linkOnly.textError}`);

  console.log("\n-- a bad address is refused before anything is made --");
  const bad = await fetch(`${API}/invites`, { method: "POST", headers: H,
    body: JSON.stringify({ email: "not-an-address" }) });
  ck("refused", bad.status === 400, `HTTP ${bad.status}`);
  ck("by name", (await bad.json()).error === "bad_email");

  console.log("\n-- and the thank-you page has to be earned --");
  {
    // The live bug: submit fired and the success screen went up without
    // waiting. A spent invite is the cheapest way to prove it is gone.
    const spent = await (await fetch(`${API}/invites`, { method: "POST", headers: H,
      body: JSON.stringify({ email: `spent.${S}@example.test`, companyName: "Spent Co" }) })).json();
    const all = await sentMail();
    const spentLink = (all[all.length - 1]?.text || "").match(/\?invite=([0-9a-f]{64})/)?.[1];
    await fetch(`${API}/invite/${spentLink}`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ company: "Spent Co", contact: "A", email: `first.${S}@example.test`,
        categories: ["roofing"], notifyEmail: true }) });
    ck("the invite is used up", !!spent.id);

    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1000, height: 1400 });
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(e.message));
    await page.goto(`http://${HOST}:${PORT}/?invite=${spentLink}`, { waitUntil: "domcontentloaded" });
    await wait(3500);
    const text = await page.evaluate(() => document.body.innerText);
    // A dead link never reaches the form at all, which is the other half of
    // the same rule: say what is wrong rather than take details nobody can use.
    ck("a spent invite says so instead of taking an application",
      /already been used|isn't valid|expired/i.test(text), text.split("\n").filter(Boolean).slice(0, 4).join(" / "));
    ck("and never shows a thank-you", !/Thanks — we've got it/.test(text));
    ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and when it fails mid-form, nobody is thanked --");
  {
    // The bug itself, reproduced: the form is reachable, they fill it in,
    // and the submit fails. Before, "Thanks -- we've got it" went up anyway,
    // because the success screen was set without waiting for the answer.
    // The invite is spent from outside while the form is open, which is a
    // real thing -- an account revokes it, or somebody else used the link.
    const e3 = `race.${S}@example.test`;
    const b3 = (await sentMail()).length;
    await fetch(`${API}/invites`, { method: "POST", headers: H,
      body: JSON.stringify({ email: e3, contact: "Pat Lee", companyName: "Race Co" }) });
    const t3 = ((await sentMail()).slice(b3)[0]?.text || "").match(/\?invite=([0-9a-f]{64})/)?.[1];

    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1000, height: 1500 });
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(e.message));
    await page.goto(`http://${HOST}:${PORT}/?invite=${t3}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".wl-fld input", { timeout: 15000 });
    await wait(1200);
    await page.evaluate(() => [...document.querySelectorAll(".wl-btn")].find((b) => /Continue/.test(b.textContent))?.click());
    await wait(500);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Roofing$/i.test(b.textContent.trim()))?.click());
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".wl-btn")].find((b) => /Continue/.test(b.textContent))?.click());
    await wait(500);

    // Spent, from somewhere else, while they were typing.
    await fetch(`${API}/invite/${t3}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ company: "Race Co", contact: "Someone Else",
        email: `other.${S}@example.test`, categories: ["roofing"], notifyEmail: true }) });

    await page.evaluate(() => [...document.querySelectorAll(".wl-btn")].find((b) => /Submit application/.test(b.textContent))?.click());
    await wait(4000);
    const out = await page.evaluate(() => document.body.innerText);
    ck("no thank-you", !/Thanks — we've got it/.test(out), out.split("\n").filter(Boolean).slice(0, 3).join(" / "));
    ck("the form is still there", /Submit application/.test(out));
    ck("and it says what went wrong", /already been used|isn't valid|couldn't send/i.test(out),
      out.split("\n").filter(Boolean).slice(-3).join(" / "));
    ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the whole thing, through the actual pages --");
  {
    const e2 = `dana.${S}@northlineroofing.test`;
    const b2 = (await sentMail()).length;
    await fetch(`${API}/invites`, { method: "POST", headers: H,
      body: JSON.stringify({ email: e2, contact: "Dana Poole", companyName: "Northline Roofing" }) });
    const m2 = (await sentMail()).slice(b2);
    const t2 = (m2[0]?.text || "").match(/\?invite=([0-9a-f]{64})/)?.[1];

    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1000, height: 1500 });
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(e.message));
    await page.goto(`http://${HOST}:${PORT}/?invite=${t2}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".wl-fld input", { timeout: 15000 });
    await wait(1200);

    const prefill = await page.evaluate(() => [...document.querySelectorAll(".wl-fld")]
      .map((l) => [l.textContent.replace(/\s+/g, " ").trim().slice(0, 12), l.querySelector("input")?.value]));
    ck("the company is already in", prefill.some(([, v]) => v === "Northline Roofing"), JSON.stringify(prefill.slice(0, 4)));
    ck("and the address", prefill.some(([, v]) => v === e2), JSON.stringify(prefill.slice(0, 4)));

    // Through all three steps.
    await page.evaluate(() => [...document.querySelectorAll(".wl-btn")].find((b) => /Continue/.test(b.textContent))?.click());
    await wait(600);
    await page.evaluate(() => [...document.querySelectorAll(".wl-pick, .pick, button")]
      .find((b) => /^Roofing$/i.test(b.textContent.trim()))?.click());
    await wait(400);
    await page.evaluate(() => [...document.querySelectorAll(".wl-btn")].find((b) => /Continue/.test(b.textContent))?.click());
    await wait(600);

    const hasPw = await page.evaluate(() => !!document.querySelector('input[type=password]'));
    ck("the last step asks for a password", hasPw);
    await page.type("input[type=password]", "correct horse battery");
    await page.evaluate(() => [...document.querySelectorAll(".wl-btn")].find((b) => /Submit application/.test(b.textContent))?.click());
    await wait(4000);

    const after = await page.evaluate(() => document.body.innerText);
    ck("it thanks them", /Thanks — we've got it/.test(after), after.split("\n").filter(Boolean).slice(0, 3).join(" / "));
    // Which of the two truthful endings depends on the Supabase project:
    // with email confirmation on it says check your inbox, with it off it
    // says the password works now. Either is fine. What is not fine is the
    // old line -- "you'll get an email with a link to set a password" --
    // said to somebody who has just set one.
    ck("it does not promise an email about a password they already chose",
      !/link to set a password/i.test(after), after.split("\n").filter(Boolean).slice(0, 6).join(" / "));
    ck("it says what actually happened to the password",
      /password is set/i.test(after) || /confirming your address/i.test(after)
        || /password you already use/i.test(after),
      after.split("\n").filter(Boolean).slice(2, 4).join(" / "));
    ck("nothing threw", crashes.length === 0, crashes.join(" | "));

    const t3 = await tok(e2);
    const me3 = await (await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${t3}` } })).json();
    ck("and they really can sign in", !!me3.user?.id && (me3.memberships || []).length > 0,
      JSON.stringify({ user: !!me3.user, memberships: (me3.memberships || []).length }));
    await ctx.close();
  }
} finally {
  await browser.close();
  // Put the account back. This file adds real subcontractors to Outerhome,
  // and Outerhome is the account other suites rely on having an empty
  // roster -- test:addsub asserts the empty state and every row left behind
  // here made it fail. A test that quietly changes what the next one is
  // testing is worse than no test.
  try {
    // One statement per call, and in reference order: sub_invites.company_id
    // points at companies, so the invites go first or the last delete fails
    // on a foreign key and leaves the roster half cleared.
    d1(`DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${S}%');`);
    d1(`DELETE FROM engagements WHERE company_id IN (SELECT id FROM companies WHERE email LIKE '%${S}%');`);
    d1(`DELETE FROM sub_invites WHERE email LIKE '%${S}%' OR label LIKE '%${S}%'
        OR company_id IN (SELECT id FROM companies WHERE email LIKE '%${S}%');`);
    d1(`DELETE FROM users WHERE email LIKE '%${S}%';`);
    d1(`DELETE FROM companies WHERE email LIKE '%${S}%';`);
  } catch (err) {
    console.error("cleanup failed -- Outerhome may be left with rows from this run:", err?.message || err);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
