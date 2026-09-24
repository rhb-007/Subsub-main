// Coming back to the tab after lunch.
//
// Sessions were being thrown away on a single 401, and a single 401 is the
// ordinary result of leaving a tab alone for an hour. Supabase access tokens
// last that long and the library refreshes them on a timer -- but browsers
// throttle timers in background tabs, so the tab you come back to is exactly
// the one whose token quietly aged out. The first call carried it, the
// Worker said 401, and resumeSession() read that as "signed out" and cleared
// the seat.
//
// That also explains why it only happened sometimes: if the refresh timer
// had happened to fire recently, the token was fine. Pure timing, which is
// the worst kind of bug to be told about and the easiest to reproduce once
// you know where to look.
//
// Three states are driven here, all by rewriting what the browser has
// stored, which is exactly what time does on its own:
//
//   a token past its expiry   -- refresh before sending, no 401 at all
//   a token that is simply bad -- 401, refresh, retry, and they stay in
//   nothing left to refresh    -- signed out, which is correct
//
//   node scripts/session-life-test.mjs

import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902";
const HOST = "cascademanagement.subsub.work";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const refreshes = async () => (await (await fetch(`${AUTH}/__refreshes`)).json()).refreshed;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

async function signedIn() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1100, height: 1300 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(1200);
  await page.type("input[type=email]", "pm@example.test");
  await page.type("input[type=password]", "correct horse battery");
  await page.waitForSelector(".login-btn", { timeout: 15000 });
  await page.click(".login-btn");
  await wait(6000);
  return { ctx, page, crashes };
}

// What the browser has stored, and how to age it.
const readStored = (page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => /^sb-.*auth-token$/.test(k));
  return { key, value: key ? localStorage.getItem(key) : null, ours: localStorage.getItem("subsub.auth") };
});
const writeStored = (page, key, obj) => page.evaluate((k, v) => localStorage.setItem(k, v), key, JSON.stringify(obj));

const state = (page) => page.evaluate(() => ({
  onLoginScreen: !!document.querySelector("input[type=password]"),
  text: document.body.innerText.slice(0, 200),
  stillHasSeat: !!localStorage.getItem("subsub.auth"),
}));

try {
  console.log("\n-- a token that expired while the tab was asleep --");
  {
    const { ctx, page, crashes } = await signedIn();
    const before = await readStored(page);
    ck("signed in to begin with", !(await state(page)).onLoginScreen);
    ck("with a session stored", !!before.value, before.key);

    // Exactly what an hour does: the token is unchanged, its expiry is past.
    const session = JSON.parse(before.value);
    const aged = { ...session, expires_at: Math.floor(Date.now() / 1000) - 60, expires_in: 0 };
    await writeStored(page, before.key, aged);
    const r0 = await refreshes();

    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(7000);
    const s = await state(page);
    ck("they are still signed in", !s.onLoginScreen, s.text.split("\n").filter(Boolean).slice(0, 3).join(" / "));
    ck("and land back in their account", /Good to see you/.test(s.text), s.text.slice(0, 60));
    ck("their seat was not thrown away", s.stillHasSeat === true);
    // Refreshed before sending rather than after being refused.
    ck("the token was refreshed", (await refreshes()) > r0, `${r0} → ${await refreshes()}`);
    ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a token the server will not accept --");
  {
    // Not expired by the clock, just not good any more. This is the path
    // that has to survive a 401: refresh, send it again, stay in.
    const { ctx, page, crashes } = await signedIn();
    const before = await readStored(page);
    const session = JSON.parse(before.value);
    const broken = { ...session, access_token: "not.a.real.token" };
    await writeStored(page, before.key, broken);
    const r0 = await refreshes();

    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(8000);
    const s = await state(page);
    ck("a 401 does not sign them out", !s.onLoginScreen,
      s.text.split("\n").filter(Boolean).slice(0, 3).join(" / "));
    ck("they are in their account", /Good to see you/.test(s.text), s.text.slice(0, 60));
    ck("after one refresh", (await refreshes()) > r0, `${r0} → ${await refreshes()}`);
    ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- nothing left to refresh --");
  {
    // The one case where signing somebody out is the right answer.
    const { ctx, page } = await signedIn();
    const before = await readStored(page);
    const session = JSON.parse(before.value);
    await writeStored(page, before.key, {
      ...session, access_token: "not.a.real.token", refresh_token: "no-such-refresh-token",
      expires_at: Math.floor(Date.now() / 1000) - 60,
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(9000);
    const s = await state(page);
    // Either outcome is honest: back to sign-in, or "couldn't load your
    // account" with a way to retry. What must not happen is a broken app.
    ck("they are told, one way or the other",
      s.onLoginScreen || /couldn't load your account|Can't reach SubSub/i.test(s.text),
      s.text.split("\n").filter(Boolean).slice(0, 3).join(" / "));
    ck("and are not left staring at a half-loaded account",
      !/Good to see you/.test(s.text), s.text.slice(0, 80));
    await ctx.close();
  }

  console.log("\n-- and a normal load does not refresh for no reason --");
  {
    const { ctx, page } = await signedIn();
    const r0 = await refreshes();
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(6000);
    ck("still signed in", !(await state(page)).onLoginScreen);
    // A fresh token has fifty-eight minutes on it; refreshing it would be
    // churn, and churn on a rotating refresh token is its own hazard.
    ck("no refresh was needed", (await refreshes()) === r0, `${r0} → ${await refreshes()}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
