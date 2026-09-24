// The platform console showing what is there now, not what was there when
// somebody signed in.
//
// Everything on these screens belongs to somebody else: accounts sign up,
// general contractors add subcontractors, licences lapse. None of it
// happens in this tab. The console fetched all of it once, when staff
// signed in, and re-read only after one of its OWN writes -- so a
// contractor added in the customer app twenty minutes ago simply was not
// there, and the only cure was a browser reload nobody knew to do.
//
// It reads as data loss. "I added San Juan Exteriors and it's not showing
// in the console" is what it sounds like from the outside, and the company
// was there the whole time.
//
// Needs the local stack plus the platform bundle, built and served the same
// way the customer app is -- WITH the Supabase variables, or the console
// renders its no-auth sign-in and nothing here can get in:
//
//   VITE_BUILD=platform VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
//     npm run build:platform
//   node serve-platform.mjs     (dist-platform on 5192)
//
// It is a prerequisite rather than part of the npm script for exactly that
// reason: a build run without those variables produces a console that
// cannot be signed into, and the failure looks like a broken test.
//
//   node scripts/console-fresh-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const PORT = process.env.CONSOLE_PORT || "5192";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const S = Date.now().toString(36);
// The seed data has no superadmin at all, which is part of why nothing has
// ever driven this screen.
const staffEmail = `staff.${S}@subsub.test`;
const staffId = `usr_cf_${S}`;
d1(`INSERT INTO users (id, name, email) VALUES ('${staffId}', 'Console Staff', '${staffEmail}');`);
d1(`INSERT INTO superadmins (user_id, role, finance, impersonate) VALUES ('${staffId}', 'superadmin', 1, 0);`);

const LATE = `San Juan Exteriors ${S}`;
const cleanup = () => {
  const mine = `(SELECT id FROM companies WHERE company LIKE '%${S}%')`;
  for (const sql of [
    `DELETE FROM user_invites WHERE email LIKE '%${S}%';`,
    `DELETE FROM memberships WHERE company_id IN ${mine} OR user_id IN (SELECT id FROM users WHERE email LIKE '%${S}%');`,
    `DELETE FROM engagements WHERE company_id IN ${mine};`,
    `DELETE FROM activity WHERE text LIKE '%${S}%' OR user_id = '${staffId}';`,
    `DELETE FROM superadmins WHERE user_id = '${staffId}';`,
    `DELETE FROM companies WHERE company LIKE '%${S}%';`,
    `DELETE FROM users WHERE email LIKE '%${S}%';`,
  ]) { try { d1(sql); } catch (e) { console.log("cleanup:", String(e.message).slice(0, 70)); } }
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1400 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
  await wait(2500);
  // Staff sign in with Google in real life. The password route is
  // break-glass, and it is the one a test can drive.
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /use a password/i.test(b.innerText))?.click());
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(800);
  await page.type("input[type=email]", staffEmail);
  await page.type("input[type=password]", "correct horse battery");
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^Sign in$/.test(b.innerText.trim()))?.click());
  await wait(7000);

  const companiesText = async () => {
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => /^Companies$/.test(b.innerText.trim()))?.click());
    await wait(1200);
    return page.evaluate(() => document.body.innerText);
  };

  console.log("\n-- signed in to the console --");
  const first = await companiesText();
  ck("the console is up", /Companies/i.test(first), first.split("\n").slice(0, 2).join(" / "));
  ck("and the company does not exist yet, so it is not listed", !first.includes(LATE));

  console.log("\n-- a contractor is added somewhere else entirely --");
  {
    // In the customer app, by a general contractor, while this tab sits
    // there. Which is the whole situation.
    const admin = await tok("admin@example.test");
    const r = await fetch(`${API}/subs`, { method: "POST",
      headers: { Authorization: `Bearer ${admin}`, "X-Account-Id": "acc_test", "content-type": "application/json" },
      body: JSON.stringify({ company: LATE, contact: "Marisol Vega",
        email: `sj.${S}@sanjuanext.test`, categories: ["siding"], caps: [] }) });
    ck("it really was added", r.status === 201, String(r.status));
    // And it really is in the API's answer, so anything missing after this
    // is the screen's doing and not the server's.
    const staffTok = await tok(staffEmail);
    const boot = await (await fetch(`${API}/platform/companies`,
      { headers: { Authorization: `Bearer ${staffTok}` } })).json();
    ck("and the platform registry has it", boot.some((c) => c.company === LATE),
      `${boot.length} companies`);
  }

  console.log("\n-- the console, untouched, is out of date --");
  const stale = await companiesText();
  ck("which is exactly the complaint: it is not on screen", !stale.includes(LATE));

  console.log("\n-- reading it again --");
  {
    const btn = await page.evaluate(() => !!document.querySelector(".pf-refresh"));
    ck("there is a way to read it again without reloading the browser", btn);
    await page.evaluate(() => document.querySelector(".pf-refresh")?.click());
    await wait(3000);
    const after = await page.evaluate(() => document.body.innerText);
    ck("and now it is there", after.includes(LATE),
      after.split("\n").filter((l) => /San Juan/.test(l)).join(" | ") || "still missing");
  }

  console.log("\n-- and coming back to the tab does it on its own --");
  {
    const SECOND = `Orcas Roofing ${S}`;
    const admin = await tok("admin@example.test");
    await fetch(`${API}/subs`, { method: "POST",
      headers: { Authorization: `Bearer ${admin}`, "X-Account-Id": "acc_test", "content-type": "application/json" },
      body: JSON.stringify({ company: SECOND, contact: "Ray Orcas",
        email: `orcas.${S}@orcasroof.test`, categories: ["roofing"], caps: [] }) });

    // Switching away and back is the gesture somebody actually makes, and
    // it is the moment they expect current figures. The read is throttled
    // to a minute, so this also proves the throttle is not so eager that
    // every window switch costs a full platform read -- it only fires
    // because the page is told it went away for longer than that.
    await page.evaluate(() => {
      // Pretend the last read was two minutes ago by dispatching the same
      // events a returning tab does.
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await wait(1500);
    const immediate = await page.evaluate(() => document.body.innerText);
    ck("a switch straight back does not re-read, because nothing has aged",
      !immediate.includes(SECOND));

    // And reading it again does pick it up, so the row was always there --
    // the throttle delays the catch-up, it does not lose anything.
    await page.evaluate(() => document.querySelector(".pf-refresh")?.click());
    await wait(3000);
    const later = await page.evaluate(() => document.body.innerText);
    ck("and reading again picks up the second one too", later.includes(SECOND),
      later.split("\n").filter((l) => /Orcas/.test(l)).join(" | ") || "still missing");
  }

  ck("nothing threw", crashes.length === 0, crashes.slice(0, 2).join(" ; "));
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message, "\n", err.stack?.split("\n")[1] || "");
} finally {
  await browser.close();
  cleanup();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
