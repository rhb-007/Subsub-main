// Every screen says which screen it is.
//
// Properties had a heading and the rest did not, so Contractors opened on a
// search box, Availability on a colour key, Jobs on a row of filters and My
// account on a strip of tabs — four screens that begin by asking you
// something without first saying what they are. On a tablet, where the nav
// is behind a hamburger, there was then nothing on the page naming where
// you were at all.
//
// Same for the contractor's own side, where five of the six panes opened on
// a panel with no page title above it.
//
// The console already had one on every screen; this checks that too, so it
// stays that way.
//
// Needs the local stack (worker 8787, supa stub 8902, app dist 5191,
// platform dist 5192).
//
//   node scripts/page-head-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const PORT = process.env.APP_PORT || "5191";
const CONSOLE = process.env.CONSOLE_PORT || "5192";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

const signIn = async (host, email) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 1400 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://${host}.subsub.work:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(900);
  await page.type("input[type=email]", email);
  await page.type("input[type=password]", "correct horse battery");
  await page.click(".login-btn");
  await wait(7000);
  return { ctx, page, crashes };
};
const nav = async (page, label) => {
  const hit = await page.evaluate((l) => {
    const b = [...document.querySelectorAll("nav button")]
      .find((x) => new RegExp(`^${l}`, "i").test(x.innerText.trim()));
    b?.click();
    return !!b;
  }, label);
  await wait(2400);
  return hit;
};
// The first heading inside the screen, and the line under it. Read from the
// top of the page rather than by class, because the point is that something
// up there names the screen -- not that it uses one particular component.
const head = (page) => page.evaluate(() => {
  const main = document.querySelector(".ss-main");
  if (!main) return null;
  const h = main.querySelector("h2");
  if (!h) return { title: null };
  const r = h.getBoundingClientRect();
  return {
    title: h.textContent.trim(),
    sub: h.closest("div")?.querySelector("p")?.textContent.trim() || null,
    top: Math.round(r.top + window.scrollY),
    size: Math.round(parseFloat(getComputedStyle(h).fontSize)),
  };
});

try {
  console.log("\n-- the account's screens --");
  {
    const { ctx, page, crashes } = await signIn("cascademanagement", "pm@example.test");
    // Dashboard greets by name, which names the screen well enough and is
    // deliberately not "Dashboard"; the rest say what they are.
    const want = [
      ["Dashboard", /good to see you/i],
      ["Contractors", /^Contractors$/],
      ["Availability", /^Availability$/],
      ["Jobs", /^Jobs$/],
      ["Properties", /^Properties$/],
      ["Uniforms", /uniform/i],
      ["My account", /^My account$/],
    ];
    for (const [tab, re] of want) {
      const there = await nav(page, tab);
      ck(`${tab}: the tab is there`, there === true);
      const h = await head(page);
      ck(`${tab}: names itself`, !!h?.title && re.test(h.title), h?.title || "no heading at all");
      // Above the search box, the filters, the tabs -- whatever the screen
      // opens with. A title below the controls is not a title.
      ck(`${tab}: at the top of the screen`, h.top < 320, `${h.top}px down`);
      ck(`${tab}: and set as a heading`, h.size >= 18, `${h.size}px`);
    }
    // The line under the title is arithmetic somebody can check, not filler.
    await nav(page, "Contractors");
    const c = await head(page);
    ck("Contractors says how many there are", /\d+ on your list/.test(c.sub || ""), c.sub);
    await nav(page, "Jobs");
    const j = await head(page);
    ck("Jobs says how many are open", /\d+ still open/.test(j.sub || ""), j.sub);
    await nav(page, "My account");
    const a = await head(page);
    ck("My account says whose it is and which seat",
      /Richard Braun/.test(a.sub || "") && /admin/i.test(a.sub || ""), a.sub);
    // Using the same words as the header chip rather than a second
    // vocabulary for the same thing.
    const chip = await page.evaluate(() =>
      document.querySelector(".user-role, .drawer-user-txt span")?.textContent.trim() || null);
    // Guarded: `!chip || ...` would pass on a selector that matches nothing,
    // which is how a check of two strings becomes a check of neither.
    ck("the header states the seat", !!chip, String(chip));
    ck("and the page head uses the same words for it",
      !!chip && a.sub.includes(chip), `${a.sub} | ${chip}`);
    ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }

  console.log("\n-- the contractor's own screens --");
  {
    const { ctx, page, crashes } = await signIn("cascademanagement", "ana@rainier.test");
    for (const [tab, re] of [
      ["My Jobs", /good to see you/i],
      ["Job Settings", /^Job settings$/],
      ["My Crews", /^My crews$/],
      ["My Documents", /^My documents$/],
      ["Uniforms", /^Uniforms$/],
      ["Connect", /^Connect$/],
    ]) {
      const there = await nav(page, tab);
      ck(`${tab}: the pane is there`, there === true);
      const h = await head(page);
      ck(`${tab}: names itself`, !!h?.title && re.test(h.title), h?.title || "no heading at all");
      ck(`${tab}: at the top of the screen`, h.top < 320, `${h.top}px down`);
    }
    // The panel underneath must not repeat the name it now carries above.
    await nav(page, "My Crews");
    const dupe = await page.evaluate(() => {
      const title = document.querySelector(".ss-main h2")?.textContent.trim().toLowerCase();
      return [...document.querySelectorAll(".ss-main .portal-panel h4")]
        .map((x) => x.textContent.trim().toLowerCase()).filter((t) => t === title);
    });
    ck("and the panel below does not say it twice", dupe.length === 0, dupe.join(", "));
    ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }

  console.log("\n-- and the console, which already had them --");
  {
    const S = Date.now().toString(36);
    const email = `ph.${S}@subsub.test`, id = `usr_ph_${S}`;
    d1(`INSERT INTO users (id, name, email) VALUES ('${id}', 'Console Staff', '${email}');`);
    d1(`INSERT INTO superadmins (user_id, role, finance, impersonate) VALUES ('${id}', 'superadmin', 1, 0);`);
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 1400 });
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(e.message));
    await page.goto(`http://127.0.0.1:${CONSOLE}/`, { waitUntil: "domcontentloaded" });
    await wait(2500);
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => /use a password/i.test(b.innerText))?.click());
    await page.waitForSelector("input[type=password]", { timeout: 15000 });
    await wait(800);
    await page.type("input[type=email]", email);
    await page.type("input[type=password]", "correct horse battery");
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => /^Sign in$/.test(b.innerText.trim()))?.click());
    await wait(7000);
    for (const [label, re] of [
      ["Dashboard", /^Dashboard$/], ["Accounts", /^Accounts$/], ["Companies", /^Companies$/],
      ["Revenue", /^Revenue$/], ["Health", /^Health$/],
    ]) {
      await page.evaluate((l) => [...document.querySelectorAll(".pf-nav button")]
        .find((b) => new RegExp(`^${l}`, "i").test(b.innerText.trim()))?.click(), label);
      await wait(2200);
      const h = await page.evaluate(() => {
        const el = document.querySelector(".pf-main h2");
        return el ? { title: el.textContent.trim(),
          top: Math.round(el.getBoundingClientRect().top + window.scrollY) } : null;
      });
      ck(`console ${label}: names itself`, !!h && re.test(h.title), h?.title || "no heading");
      ck(`console ${label}: at the top`, h.top < 320, `${h.top}px down`);
    }
    ck("nothing threw in the console", crashes.length === 0, crashes.slice(0, 2).join(" ; "));
    await ctx.close();
    d1(`DELETE FROM activity WHERE user_id = '${id}'`);
    d1(`DELETE FROM superadmins WHERE user_id = '${id}'`);
    d1(`DELETE FROM users WHERE id = '${id}'`);
  }
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
