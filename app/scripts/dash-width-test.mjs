// The top row of the dashboard, measured at the widths people actually hold.
//
// The schedule panel and the setup checklist are meant to sit side by side.
// They were laid out with repeat(auto-fit, minmax(420px, 1fr)), which needs
// 856 points of room for the pair. A tablet held upright gives 708 to 798.
// So on every iPad in portrait -- the way this gets used on a job site --
// the two panels stacked, and the row that the whole redesign was about
// only ever existed on a laptop. It shipped that way and was reported back
// within the day: "still no side by side".
//
// A breakpoint you cannot see is a breakpoint you will get wrong again, so
// this measures it rather than asserting the number. The real stylesheet is
// lifted out of App.tsx and dropped on a blank page with the two panels in
// it; the browser does the grid arithmetic and we read the boxes back.
//
// No worker, no database, no sign-in -- it is the stylesheet under test, so
// the only thing it needs is a browser.
//
//   node scripts/dash-width-test.mjs

import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

// ---- the real stylesheet, not a copy of it ----------------------------
const src = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8").split("\n");
const start = src.findIndex((l) => l === "const CSS = `");
const end = src.findIndex((l, i) => i > start && l === "`;");
if (!(start > 0 && end > start)) {
  console.log("FAIL  could not find the stylesheet block in App.tsx");
  process.exit(1);
}
const css = src.slice(start + 1, end).join("\n");

// Two panels with enough in them to have a natural height, because a grid
// row with empty children would line its feet up whatever the rule said.
const page_html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body><div class="ss-root"><main class="ss-main">
  <div class="dash-top" id="top">
    <section class="sched-hero" id="hero">
      <div class="sh-head"><h3>What's scheduled</h3><button class="sh-all">Open the calendar</button></div>
      <div class="sh-none"><p>Nothing booked in yet.</p></div>
      <div class="sh-strip" id="strip">${Array.from({ length: 14 }, (_, i) =>
        `<button class="shs-day"><span class="shs-dow">W</span><span class="shs-dom">${i + 1}</span><span class="shs-n"></span></button>`).join("")}</div>
    </section>
    <div class="gs-card" id="gs">
      <div class="gs-head"><div><h3>Get set up</h3><p>Progress &middot; 1 of 4 done</p></div>
        <button class="gs-hide">x</button></div>
      <div class="gs-bar"><span style="width:25%"></span></div>
      <ol class="gs-steps">
        <li class="gs-step done"><span class="gs-tick"></span><div class="gs-body"><b>Tell us what you hire out</b></div></li>
        <li class="gs-step now"><span class="gs-tick"></span><div class="gs-body"><b>Bring your subcontractors in</b>
          <p>Send them a link and they build their own profile and upload their own documents. Faster than
             chasing paperwork, and it stays theirs to keep current.</p>
          <div class="gs-acts"><button class="btn-solid">Invite a subcontractor</button>
            <button class="btn-ghost">Add one myself</button></div></div></li>
        <li class="gs-step later"><span class="gs-tick"></span><div class="gs-body"><b>Approve their documents</b></div></li>
        <li class="gs-step later"><span class="gs-tick"></span><div class="gs-body"><b>Create your first job</b></div></li>
      </ol>
    </div>
  </div>
</main></div></body></html>`;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});

const measure = async (page, width, only = null) => {
  await page.setViewport({ width, height: 1200 });
  if (only) await page.evaluate((id) => { document.getElementById(id).style.display = "none"; }, only);
  else await page.evaluate(() => { document.getElementById("gs").style.display = ""; });
  return page.evaluate(() => {
    const box = (id) => {
      const el = document.getElementById(id);
      if (!el || el.style.display === "none") return null;
      const r = el.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), w: Math.round(r.width) };
    };
    return { layout: document.documentElement.clientWidth,
      top: box("top"), hero: box("hero"), gs: box("gs") };
  });
};

try {
  const page = await browser.newPage();
  await page.setContent(page_html, { waitUntil: "domcontentloaded" });

  // Real portrait widths, in CSS points, of the tablets somebody would be
  // holding: iPad mini, iPad / iPad Air, iPad Pro 11", iPad Pro 13".
  const upright = [
    [744, "an iPad mini held upright"],
    [810, "a 10.2in iPad held upright"],
    [820, "an iPad Air held upright"],
    [834, "an iPad Pro 11in held upright"],
    [1024, "an iPad Pro 13in held upright"],
  ];
  console.log("\n-- the two panels share the row on a tablet held upright --");
  for (const [w, what] of upright) {
    const b = await measure(page, w);
    ck(`${what} (${w}) has no scrollbar eating the width`, b.layout === w, `${b.layout}`);
    ck(`${what}: both panels on the same row`, b.hero.t === b.gs.t, `${b.hero.t} vs ${b.gs.t}`);
    ck(`${what}: the schedule on the left`, b.hero.r <= b.gs.l, `${b.hero.r} | ${b.gs.l}`);
    ck(`${what}: an even split`, Math.abs(b.hero.w - b.gs.w) < 4, `${b.hero.w} vs ${b.gs.w}`);
    ck(`${what}: filling the row between them`,
      b.hero.w + b.gs.w > b.top.w - 40, `${b.hero.w} + ${b.gs.w} in ${b.top.w}`);
  }

  console.log("\n-- and on a laptop, where it already worked --");
  for (const w of [1180, 1400]) {
    const b = await measure(page, w);
    ck(`${w}: on the same row`, b.hero.t === b.gs.t, `${b.hero.t} vs ${b.gs.t}`);
    // auto-fit will lay out as many tracks as fit. Three would fit at this
    // width; the empty one has to collapse, or the pair sits in two thirds
    // of the row with a gap on the end.
    ck(`${w}: an even split, not two thirds and a gap`,
      Math.abs(b.hero.w - b.gs.w) < 4 && b.hero.w + b.gs.w > b.top.w - 40,
      `${b.hero.w} + ${b.gs.w} in ${b.top.w}`);
  }

  console.log("\n-- a phone still gets them one above the other --");
  for (const [w, what] of [[390, "an iPhone"], [430, "a large iPhone"], [700, "a narrow window"]]) {
    const b = await measure(page, w);
    ck(`${what} (${w}): stacked`, b.hero.t < b.gs.t, `${b.hero.t} vs ${b.gs.t}`);
    ck(`${what} (${w}): each takes the full width`,
      Math.abs(b.hero.w - b.top.w) < 4 && Math.abs(b.gs.w - b.top.w) < 4,
      `${b.hero.w} / ${b.gs.w} of ${b.top.w}`);
  }

  console.log("\n-- and the schedule fills the row once the checklist is gone --");
  for (const w of [744, 834, 1400]) {
    const b = await measure(page, w, "gs");
    ck(`${w}: the checklist is not rendered`, b.gs === null, String(b.gs));
    ck(`${w}: so the schedule takes the whole row`,
      Math.abs(b.hero.w - b.top.w) < 4, `${b.hero.w} of ${b.top.w}`);
  }

  // ---- and no dead air inside the shorter panel ----------------------
  // The two panels are as tall as each other. With nothing booked in, the
  // schedule's own content is a short line, so the slack has to go
  // somewhere: into the empty state, not into a gap above the fortnight.
  console.log("\n-- the empty schedule fills its panel rather than leaving a hole --");
  for (const w of [834, 1180]) {
    await measure(page, w);
    const g = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const none = r(".sh-none"), strip = r("#strip"), hero = r("#hero");
      return { gap: Math.round(strip.top - none.bottom),
        noneH: Math.round(none.height), heroH: Math.round(hero.height) };
    });
    ck(`${w}: the empty state is not collapsed`, g.noneH >= 96, JSON.stringify(g));
    ck(`${w}: and there is no hole above the fortnight`, g.gap < 40, JSON.stringify(g));
    ck(`${w}: it takes most of the panel it is in`, g.noneH > g.heroH * 0.4, JSON.stringify(g));
  }

  // The fortnight strip is the thing a narrower panel costs. It is allowed
  // to run off the end -- it scrolls sideways -- but the panel around it is
  // not allowed to push the page sideways with it.
  console.log("\n-- a narrower panel costs days on the strip, not a sideways page --");
  {
    await measure(page, 744);
    const o = await page.evaluate(() => ({
      pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      stripScrolls: (() => { const s = document.getElementById("strip"); return s.scrollWidth > s.clientWidth; })(),
      stripOverflow: getComputedStyle(document.getElementById("strip")).overflowX,
    }));
    ck("the page does not scroll sideways", !o.pageScrolls, JSON.stringify(o));
    ck("the strip is the thing that scrolls", o.stripOverflow === "auto", o.stripOverflow);
    ck("and it has more days in it than fit", o.stripScrolls, JSON.stringify(o));
  }
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
