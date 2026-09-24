// The card you open to find out who a contractor is.
//
// It opened with nine trade chips -- "Electrical / Plumbing / HVAC /
// Drywall / Demolition / Painting / Water & Fire Restoration / Insulation"
// -- and the company name came fourth, under all of them. The one thing
// somebody opens this card to check was the thing it said last.
//
// And the Edit button sat in the top-right corner, which is where the
// modal's close X is positioned absolutely, on top of everything. Edit was
// half-covered by it. Both of those are geometry, so this file measures
// rather than reads: where things are on screen, and whether two of them
// occupy the same pixels.
//
// Needs the local stack and a branded host -- see poweredby-contrast-test.
//
//   node scripts/sub-detail-test.mjs

import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";
// Cascade Management rather than Outerhome: this needs an account that
// HAS contractors, and Outerhome's empty roster is the whole subject of
// another suite, which cleans it back to nothing on every run.
const HOST = process.env.APP_HOST || "cascademanagement.subsub.work";
const EMAIL = process.env.APP_EMAIL || "pm@example.test";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

// Two rectangles sharing any pixel at all.
const overlaps = (a, b) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

async function openFirstContractor(page) {
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^Contractors/.test(b.innerText.trim().split("\n")[0]))?.click());
  await wait(1500);
  await page.evaluate(() => document.querySelector(".grid .card")?.click());
  await wait(1200);
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1400 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(1200);
  await page.type("input[type=email]", EMAIL);
  await page.type("input[type=password]", "correct horse battery");
  await page.click(".login-btn");
  await wait(6500);
  await openFirstContractor(page);

  const shape = () => page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom,
        w: Math.round(r.width), h: Math.round(r.height), text: el.innerText.trim() };
    };
    return {
      card: box(".detail"),
      id: box(".detail-id"),
      name: box(".detail-id h2"),
      trades: box(".detail-trades"),
      edit: box(".edit-btn"),
      close: box(".modal-close"),
      caps: box(".detail section h4"),
    };
  });

  console.log("\n-- the card is open --");
  const s = await shape();
  ck("a contractor's card opened", !!s.card && !!s.name, s.name?.text || "nothing");

  console.log("\n-- who it is, first --");
  ck("the company name is in an identity panel of its own", !!s.id, String(!!s.id));
  ck("and the panel is the first thing in the card",
    !!s.id && !!s.card && s.id.top - s.card.top < 24, `${Math.round((s.id?.top ?? 0) - (s.card?.top ?? 0))}px in`);
  // The complaint: the trades came first and the name came fourth.
  ck("the name sits above the trades, not under them",
    !!s.trades && s.name.bottom <= s.trades.top,
    `name ends ${Math.round(s.name.bottom)}, trades start ${Math.round(s.trades?.top ?? 0)}`);
  ck("and it is set larger than the body of the card",
    Number(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".detail-id h2")).fontSize))) >= 20,
    await page.evaluate(() => getComputedStyle(document.querySelector(".detail-id h2")).fontSize));
  ck("the contact details are in the same panel as the name", await page.evaluate(() =>
    !!document.querySelector(".detail-id .detail-contact")));

  console.log("\n-- and the trades below it --");
  ck("the trades are still there", !!s.trades && s.trades.h > 0,
    await page.evaluate(() => [...document.querySelectorAll(".detail-trades .cat-badge")]
      .map((b) => b.innerText.trim()).join(", ").slice(0, 80)));
  ck("above the rest of the card", !!s.caps && s.trades.bottom <= s.caps.top + 1,
    `trades end ${Math.round(s.trades?.bottom ?? 0)}, first section ${Math.round(s.caps?.top ?? 0)}`);

  console.log("\n-- nothing is hiding under the close button --");
  ck("the close button is there to be hidden behind", !!s.close, String(!!s.close));
  ck("Edit is not under it", !!s.edit && !overlaps(s.edit, s.close),
    `edit ${Math.round(s.edit?.left)}-${Math.round(s.edit?.right)} x ${Math.round(s.edit?.top)}-${Math.round(s.edit?.bottom)}, `
    + `close ${Math.round(s.close?.left)}-${Math.round(s.close?.right)} x ${Math.round(s.close?.top)}-${Math.round(s.close?.bottom)}`);
  ck("nor is the company name", !overlaps(s.name, s.close),
    `name right edge ${Math.round(s.name.right)}, close left edge ${Math.round(s.close.left)}`);
  // The real test of "not covered" is whether a click lands on it.
  ck("and a click on Edit reaches Edit", await page.evaluate(() => {
    const r = document.querySelector(".edit-btn").getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && !!hit.closest(".edit-btn");
  }));

  console.log("\n-- on a phone --");
  {
    await page.setViewport({ width: 390, height: 844 });
    await wait(900);
    const p = await shape();
    ck("the name is still above the trades",
      !!p.trades && p.name.bottom <= p.trades.top, `${Math.round(p.name.bottom)} vs ${Math.round(p.trades?.top ?? 0)}`);
    ck("Edit is still clear of the close button", !overlaps(p.edit, p.close),
      `edit ${Math.round(p.edit.left)}-${Math.round(p.edit.right)}, close ${Math.round(p.close.left)}-${Math.round(p.close.right)}`);
    ck("the name is not under it either", !overlaps(p.name, p.close),
      `name ${Math.round(p.name.left)}-${Math.round(p.name.right)}, close ${Math.round(p.close.left)}`);
    ck("and nothing spills off the side", await page.evaluate(() => {
      const el = document.querySelector(".modal");
      return el.scrollWidth <= el.clientWidth + 1;
    }));
  }

  ck("nothing threw", crashes.length === 0, crashes.slice(0, 2).join(" ; "));
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message, "\n", err.stack?.split("\n")[1] || "");
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
