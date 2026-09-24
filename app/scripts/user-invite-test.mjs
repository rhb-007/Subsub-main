// Adding somebody to the account, and telling them.
//
// Users -> Add wrote a users row and a membership and sent nothing at all.
// No email, no link, nothing. Whoever was added learned they had an account
// by being told out loud, and got in by noticing "Already invited? Create
// your password" on the sign-in screen and working out that it meant them.
// A manager added on a Friday had no way to discover any of that alone.
//
// And the roster looked identical whether somebody had signed in a hundred
// times or had never heard of SubSub, so nobody could see it happening.
//
// Both halves are asserted here. The third assertion is the one that keeps
// the feature honest: an invite is only marked sent when something actually
// left, because a row that says "sent two days ago" over a message that
// never went is how an admin waits on a colleague who was never asked.
//
//   node scripts/user-invite-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const MAIL = process.env.MAIL_STUB || "http://127.0.0.1:8904";
const HOST = "cascademanagement.subsub.work";
const ACCOUNT = "acc_pm";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sentMail = async () => (await (await fetch(`${MAIL}/__sent`)).json());

d1("DELETE FROM rate_limits WHERE bucket LIKE 'user-invite:%';");

const pm = await tok("pm@example.test");
const H = { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
const S = Date.now().toString(36);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

try {
  console.log("\n-- adding somebody now tells them --");
  const email = `priya.${S}@cascademanagement.test`;
  const before = (await sentMail()).length;
  const added = await (await fetch(`${API}/account-users`, { method: "POST", headers: H,
    body: JSON.stringify({ name: "Priya Raman", email, phone: "2065550188", role: "pm" }) })).json();
  ck("they are added", !!added.id, JSON.stringify(added).slice(0, 80));
  ck("and an invite went out", added.invited === true, JSON.stringify(added));

  const mail = (await sentMail()).slice(before);
  ck("one message left", mail.length === 1, `${mail.length}`);
  ck("to them", (mail[0]?.to || [])[0] === email || mail[0]?.to === email, JSON.stringify(mail[0]?.to));
  ck("saying who added them", /Richard Braun/.test(mail[0]?.subject || "") || /added you/i.test(mail[0]?.subject || ""),
    mail[0]?.subject);
  ck("and what they are there to do", /manager/i.test(mail[0]?.text || ""), (mail[0]?.text || "").slice(0, 120));

  const link = (mail[0]?.text || "").match(/https?:\/\/[^\s]*\?user=[0-9a-f]{64}/)?.[0] || "";
  const token = link.match(/user=([0-9a-f]{64})/)?.[1];
  ck("and carries a token", !!token, String(token).slice(0, 12));
  // This account has no live branded hostname, and sending somebody to an
  // address with no certificate would be worse than sending them to the
  // shared one. The rule is "branded only once it is actually serving", so
  // both halves are checked rather than whichever this account happens to be.
  ck("with no live hostname, the link is the shared address",
    /app\.subsub\.work/.test(link), link.slice(0, 60));

  {
    // And with one, it is theirs.
    d1(`UPDATE accounts SET hostname_status = 'active' WHERE id = '${ACCOUNT}';`);
    try {
      const b = (await sentMail()).length;
      await fetch(`${API}/account-users`, { method: "POST", headers: H,
        body: JSON.stringify({ name: "Branded Link", email: `branded.${S}@cascademanagement.test`, role: "pm" }) });
      const l = ((await sentMail()).slice(b)[0]?.text || "").match(/https?:\/\/[^\s]*\?user=/)?.[0] || "";
      ck("once the hostname is live, the link is the account's own",
        /cascademanagement\.subsub\.work/.test(l), l.slice(0, 60));
    } finally {
      d1(`UPDATE accounts SET hostname_status = NULL WHERE id = '${ACCOUNT}';`);
    }
  }

  console.log("\n-- the roster says who cannot get in yet --");
  const roster = await (await fetch(`${API}/account-users`, { headers: H })).json();
  const row = roster.find((r) => r.email === email);
  ck("the new person is on it", !!row, JSON.stringify(roster.map((r) => r.email).slice(0, 4)));
  ck("marked as having no login", row?.hasLogin === false, String(row?.hasLogin));
  ck("with the invite recorded as sent", !!row?.inviteSentAt, String(row?.inviteSentAt));
  // Somebody already in should not be nagged about a password they have.
  const rich = roster.find((r) => r.email === "pm@example.test");
  ck("and somebody who is already in is not", rich?.hasLogin === true, String(rich?.hasLogin));

  console.log("\n-- the link asks for one thing --");
  const look = await (await fetch(`${API}/user-invite/${token}`)).json();
  ck("it knows who it is for", look.name === "Priya Raman", look.name);
  ck("and which seat", look.role === "pm", look.role);
  ck("and which company", look.account?.name === "Cascade Management", look.account?.name);

  console.log("\n-- setting the password gets them in --");
  const accepted = await (await fetch(`${API}/user-invite/${token}`, { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "correct horse battery" }) })).json();
  ck("accepted", accepted.ok === true, JSON.stringify(accepted));

  const theirs = await tok(email);
  const me = await (await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${theirs}` } })).json();
  ck("SubSub knows them", !!me.user?.id, JSON.stringify(me.user || {}).slice(0, 70));
  ck("in the seat they were given",
    (me.memberships || []).some((m) => m.accountId === ACCOUNT && m.role === "pm"),
    JSON.stringify((me.memberships || []).map((m) => `${m.accountId}:${m.role}`)));

  const after = await (await fetch(`${API}/account-users`, { headers: H })).json();
  ck("and the roster stops flagging them", after.find((r) => r.email === email)?.hasLogin === true);

  console.log("\n-- a spent link cannot be used twice --");
  const again = await fetch(`${API}/user-invite/${token}`, { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "some other password" }) });
  ck("refused", again.status === 410, `HTTP ${again.status}`);
  ck("by name", (await again.json()).error === "used");

  console.log("\n-- a short password is refused before anything happens --");
  {
    const e2 = `short.${S}@cascademanagement.test`;
    await fetch(`${API}/account-users`, { method: "POST", headers: H,
      body: JSON.stringify({ name: "Short Pass", email: e2, role: "pm" }) });
    const t2 = ((await sentMail()).slice(-1)[0]?.text || "").match(/\?user=([0-9a-f]{64})/)?.[1];
    const weak = await fetch(`${API}/user-invite/${t2}`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "short" }) });
    ck("refused", weak.status === 400, `HTTP ${weak.status}`);
    // And the link is not burnt by the attempt.
    const still = await fetch(`${API}/user-invite/${t2}`);
    ck("and the link still works", still.status === 200, `HTTP ${still.status}`);
  }

  console.log("\n-- sending it again --");
  {
    const e3 = `again.${S}@cascademanagement.test`;
    const r3 = await (await fetch(`${API}/account-users`, { method: "POST", headers: H,
      body: JSON.stringify({ name: "Send Again", email: e3, role: "pm" }) })).json();
    const b3 = (await sentMail()).length;
    const resent = await (await fetch(`${API}/account-users/${r3.id}/invite`, { method: "POST", headers: H })).json();
    ck("it goes again", resent.invited === true, JSON.stringify(resent));
    ck("and another message leaves", (await sentMail()).length === b3 + 1);

    // The first link is withdrawn, so a list of live links cannot outgrow
    // the number of people waiting on one.
    const firstToken = ((await sentMail()).slice(b3 - 1, b3)[0]?.text || "").match(/\?user=([0-9a-f]{64})/)?.[1];
    const dead = await fetch(`${API}/user-invite/${firstToken}`);
    ck("the earlier one stops working", dead.status === 410, `HTTP ${dead.status}`);

    // And nobody who is already in gets a "choose a password" email.
    const inAlready = await fetch(`${API}/account-users/usr_pm/invite`, { method: "POST", headers: H });
    ck("somebody who already has a login is not sent one", inAlready.status === 409, `HTTP ${inAlready.status}`);
    ck("and it says why", (await inAlready.json()).reason === "already_has_login");
  }

  console.log("\n-- and the sign-in page no longer explains itself --");
  {
    // The line this whole piece of work was to remove: "Already invited?
    // Create your password", on every sign-in screen in the product. It was
    // the only way in for anybody an account had added, because none of the
    // three invites sent anything. All three send now and every one ends on
    // a screen that takes a password.
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(e.message));
    for (const host of [HOST, "app.subsub.work", "outerhome.subsub.work"]) {
      await page.goto(`http://${host}:${PORT}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("input[type=password]", { timeout: 15000 });
      await wait(900);
      const t = await page.evaluate(() => document.body.innerText);
      ck(`${host}: the line is gone`, !/Already invited/i.test(t), t.replace(/\n+/g, " | ").slice(0, 120));
      // And the things that still have a job are still there.
      ck(`${host}: signing in still works`, /Sign in/.test(t) && /Forgot password/.test(t));
    }
    ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- through the actual page --");
  {
    const e4 = `walk.${S}@cascademanagement.test`;
    const b4 = (await sentMail()).length;
    await fetch(`${API}/account-users`, { method: "POST", headers: H,
      body: JSON.stringify({ name: "Walk Through", email: e4, role: "pm" }) });
    const t4 = ((await sentMail()).slice(b4)[0]?.text || "").match(/\?user=([0-9a-f]{64})/)?.[1];

    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1000, height: 1300 });
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(e.message));
    await page.goto(`http://${HOST}:${PORT}/?user=${t4}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("input[type=password]", { timeout: 15000 });
    await wait(1000);
    const shown = await page.evaluate(() => document.body.innerText);
    ck("it welcomes them by name", /Walk/.test(shown), shown.split("\n").filter(Boolean).slice(0, 4).join(" / "));
    ck("names the company", /Cascade Management/.test(shown));
    ck("and says which seat", /as a manager/i.test(shown), shown.split("\n").filter(Boolean).slice(1, 3).join(" / "));
    ck("and does not ask for anything else", (await page.evaluate(
      () => document.querySelectorAll(".wl-fld input").length)) === 1);

    await page.type("input[type=password]", "correct horse battery");
    await page.evaluate(() => [...document.querySelectorAll(".wl-btn")].find((b) => /Set password/.test(b.textContent))?.click());
    await wait(3500);
    const end = await page.evaluate(() => document.body.innerText);
    ck("it says they are set up", /You're set up/.test(end), end.split("\n").filter(Boolean).slice(0, 3).join(" / "));
    ck("nothing threw", crashes.length === 0, crashes.join(" | "));

    const t5 = await tok(e4);
    const me5 = await (await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${t5}` } })).json();
    ck("and they can sign in", (me5.memberships || []).length > 0,
      JSON.stringify((me5.memberships || []).length));
    await ctx.close();
  }
} finally {
  await browser.close();
  // Cascade Management's roster is what other suites count seats against.
  try {
    d1(`DELETE FROM user_invites WHERE email LIKE '%${S}%';`);
    d1(`DELETE FROM membership_properties WHERE membership_id IN
        (SELECT id FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${S}%'));`);
    d1(`DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%${S}%');`);
    d1(`DELETE FROM users WHERE email LIKE '%${S}%';`);
  } catch (err) {
    console.error("cleanup failed -- Cascade Management may keep rows from this run:", err?.message || err);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
