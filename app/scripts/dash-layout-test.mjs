// The dashboard, made scannable.
//
// Three things were wrong with the shape of it. The schedule panel and the
// setup checklist sat one above the other, so the second thing somebody is
// working through in their first month started a screen down. The schedule
// panel carried its own "New job" button a couple of inches below the one
// in the page header. And ten sections below them drew every row they had,
// so a morning with eight approvals, forty unassigned trades and a handful
// of documents ran to several screenfuls and the section at the bottom
// might as well not have been there.
//
// The sections are CAPPED, not folded away: the heading and its count stay
// on screen whatever happens, because "5 documents to verify" is the signal
// somebody needs whether or not they open it. Hiding that behind a closed
// header would be tidier and worse.
//
// Needs the local stack (worker 8787, supa stub 8902, app dist 5191).
//
//   node scripts/dash-layout-test.mjs

import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

const signIn = async (host, email, width = 1400) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height: 1400 });
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
const boxes = (page) => page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top + window.scrollY),
      w: Math.round(r.width), h: Math.round(r.height) };
  };
  return { top: box(".dash-top"), hero: box(".sched-hero"), gs: box(".gs-card") };
});

try {
  // ---- side by side, where both exist ----------------------------------
  console.log("\n-- the schedule and the checklist share the top --");
  {
    const { ctx, page, crashes } = await signIn("outerhome", "admin@example.test");
    const b = await boxes(page);
    ck("both panels are there", !!b.hero && !!b.gs, JSON.stringify(b));
    ck("on the same row", b.hero.t === b.gs.t, `${b.hero.t} vs ${b.gs.t}`);
    ck("the schedule on the left", b.hero.r <= b.gs.l, `${b.hero.r} | ${b.gs.l}`);
    ck("and they split the width evenly",
      Math.abs(b.hero.w - b.gs.w) < 4, `${b.hero.w} vs ${b.gs.w}`);
    // "Large boxes", which means the shorter one does not sit up in the
    // corner leaving a ragged foot.
    ck("with their feet in line", Math.abs(b.hero.h - b.gs.h) < 4, `${b.hero.h} vs ${b.gs.h}`);
    ck("and they fill the row between them",
      b.hero.w + b.gs.w > b.top.w - 40, `${b.hero.w} + ${b.gs.w} in ${b.top.w}`);

    // ---- the button that was in two places ----------------------------
    const buttons = await page.evaluate(() => ({
      inPanel: [...document.querySelectorAll(".sched-hero button")].map((x) => x.innerText.trim()),
      inHeader: [...document.querySelectorAll(".dash-cta button")].map((x) => x.innerText.trim()),
    }));
    ck("the schedule panel offers no New job of its own",
      !buttons.inPanel.some((t) => /new job|request work/i.test(t)), buttons.inPanel.join(" | "));
    ck("and the page header still does",
      buttons.inHeader.some((t) => /new job|request work/i.test(t)), buttons.inHeader.join(" | "));

    // ---- and they stack when there is no room -------------------------
    await page.setViewport({ width: 700, height: 1400 });
    await wait(900);
    const narrow = await boxes(page);
    ck("on a narrow screen they stack", narrow.hero.t < narrow.gs.t,
      `${narrow.hero.t} vs ${narrow.gs.t}`);
    ck("each taking the full width",
      Math.abs(narrow.hero.w - narrow.top.w) < 4 && Math.abs(narrow.gs.w - narrow.top.w) < 4,
      `${narrow.hero.w} / ${narrow.gs.w} of ${narrow.top.w}`);
    ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }

  // ---- and the schedule fills the row once the checklist is gone -------
  console.log("\n-- with the checklist finished or dismissed --");
  {
    const { ctx, page } = await signIn("cascademanagement", "pm@example.test");
    const b = await boxes(page);
    ck("the checklist is not on this account's dashboard", b.gs === null, JSON.stringify(b.gs));
    // A fixed two-column grid would leave the schedule in half a row beside
    // a permanent gap. auto-fit is what stops that.
    ck("so the schedule takes the whole row",
      Math.abs(b.hero.w - b.top.w) < 4, `${b.hero.w} of ${b.top.w}`);

    // ---- the sections below ------------------------------------------
    console.log("\n-- and the sections below are capped --");
    const secs = await page.evaluate(() => [...document.querySelectorAll(".dash-sec")].map((s) => {
      const more = s.querySelector(".dash-more");
      const rows = s.querySelectorAll(".dash-row, .dash-doc-row").length;
      return {
        title: s.querySelector("h3")?.textContent.trim().replace(/\s+/g, " ") || "",
        count: Number(s.querySelector(".sec-count")?.textContent.trim() || 0),
        rows, more: more?.innerText.trim() || null,
        showAll: /^Show all (\d+)/.exec(more?.innerText || "")?.[1] || null,
      };
    }));
    ck("there are sections to look at", secs.length >= 4, `${secs.length}`);
    const capped = secs.filter((x) => x.showAll);
    // Guarded: the three assertions below are .every() over this list plus
    // a read of capped[0], and an empty one passes two of them without
    // looking at anything and crashes on the third.
    ck("some of them have more than fits", capped.length > 0,
      secs.map((x) => `${x.title}:${x.rows}`).join(" | "));
    if (!capped.length) throw new Error("no section was capped -- nothing below would be testing anything");
    // The cap itself.
    ck("and none of those shows more than three rows",
      capped.every((x) => x.rows <= 3), capped.map((x) => `${x.title} ${x.rows}`).join(" | "));
    // The heading and its number stay put. That is the whole argument for
    // capping rather than folding: the count is the signal.
    ck("every section still says how many it has",
      secs.every((x) => x.count > 0 || x.rows > 0),
      secs.map((x) => `${x.title}=${x.count}`).join(" | "));
    ck("and the button says how many are hidden behind it",
      capped.every((x) => Number(x.showAll) > 3), capped.map((x) => x.more).join(" | "));

    // Opening one shows exactly what it promised.
    const target = capped[0];
    const opened = await page.evaluate((title) => {
      const s = [...document.querySelectorAll(".dash-sec")]
        .find((x) => x.querySelector("h3")?.textContent.trim().replace(/\s+/g, " ") === title);
      s.querySelector(".dash-more").click();
      return new Promise((res) => setTimeout(() => res({
        rows: s.querySelectorAll(".dash-row, .dash-doc-row").length,
        more: s.querySelector(".dash-more")?.innerText.trim(),
      }), 400));
    }, target.title);
    ck("opening one shows every row it said it had",
      opened.rows === Number(target.showAll), `${opened.rows} of ${target.showAll}`);
    ck("and the button offers the way back", /show the first 3/i.test(opened.more || ""), opened.more);

    // Left open, it stays open: somebody who works out of one queue every
    // morning should not reopen it every morning.
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(7000);
    const after = await page.evaluate((title) => {
      const s = [...document.querySelectorAll(".dash-sec")]
        .find((x) => x.querySelector("h3")?.textContent.trim().replace(/\s+/g, " ") === title);
      return { rows: s?.querySelectorAll(".dash-row, .dash-doc-row").length,
        more: s?.querySelector(".dash-more")?.innerText.trim() };
    }, target.title);
    ck("and it is still open on the way back",
      after.rows === Number(target.showAll), `${after.rows} of ${target.showAll}`);
    const others = await page.evaluate(() => [...document.querySelectorAll(".dash-sec")]
      .filter((s) => /^Show all/.test(s.querySelector(".dash-more")?.innerText || ""))
      .map((s) => s.querySelectorAll(".dash-row, .dash-doc-row").length));
    ck("while the ones nobody opened are still capped",
      others.every((n) => n <= 3), others.join(", "));
    await ctx.close();
  }
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
