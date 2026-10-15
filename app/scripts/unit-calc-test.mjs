// The units calculator on the pricing page (084).
//
// Asked for as "a place to select how many active units to determine the
// monthly rate". The page has no build step, so its figures are a hand copy
// of app/shared/unitpricing.js -- the module the checkout charges by -- and
// this suite is what keeps the copy honest:
//
//   EVERY FIGURE ON THE PAGE IS THE MODULE'S. The threshold, the unit price,
//   the minimum and every setup step are read off the calculator's data
//   attributes and compared with the module, so a price change in one place
//   fails here until the other follows.
//
//   THE PAGE ANSWERS WHAT THE BILL WOULD. Driven in a browser and compared,
//   case by case, with unitPricing() itself: the flat price at 80 and under,
//   occupied x $1.25 past it, the $99 floor, the setup step by TOTAL units,
//   and a refusal when more units are occupied than exist.
//
//   node --no-warnings scripts/unit-calc-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch, tally, wait } from "./lib/stub-stack.mjs";
import { unitPricing, UNIT_THRESHOLD, UNIT_PRICE_CENTS, MIN_MONTHLY_CENTS, SETUP_TIERS } from "../shared/unitpricing.js";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const PAGE = join(root, "pricing.html");
const html = readFileSync(PAGE, "utf8");
const t = tally();

console.log("\n-- the page's figures are the module's --");
const attr = (n) => (html.match(new RegExp(`id="unitsCalc"[^>]*?${n}="([^"]*)"`, "s")) || [])[1];
t.ck("the threshold", Number(attr("data-threshold")) === UNIT_THRESHOLD, attr("data-threshold"));
t.ck("the unit price", Number(attr("data-unit-cents")) === UNIT_PRICE_CENTS, attr("data-unit-cents"));
t.ck("the minimum", Number(attr("data-min-cents")) === MIN_MONTHLY_CENTS, attr("data-min-cents"));
const steps = String(attr("data-setup") || "").split(",").map((p) => p.split(":").map(Number))
  .map(([u, c]) => [u || Infinity, c]);
t.ck("every setup step, in order", steps.length === SETUP_TIERS.length
  && SETUP_TIERS.every((s, i) => steps[i][0] === s.upTo && steps[i][1] === s.cents), attr("data-setup"));
const table = [...html.matchAll(/<tr><td>([^<]+)<\/td><td>\$([\d,]+)<\/td><\/tr>/g)].map((m) => Number(m[2].replace(/,/g, "")) * 100);
t.ck("and the table of steps beside it says the same", table.join(",") === SETUP_TIERS.map((s) => s.cents).join(","), table.join(","));

const browser = await launch();
try {
  for (const vw of [1200, 390]) {
    console.log(`\n-- driven in a browser at ${vw}px, against unitPricing() --`);
    const page = await browser.newPage();
    await page.setViewport({ width: vw, height: 1000 });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(pathToFileURL(PAGE).href, { waitUntil: "domcontentloaded" });
    await wait(300);
    const set = async (sel, v) => {
      await page.evaluate((s, val) => { const el = document.querySelector(s); el.value = String(val);
        el.dispatchEvent(new Event("input", { bubbles: true })); }, sel, v);
      await wait(40);
    };
    const read = () => page.evaluate(() => ({
      month: document.getElementById("ucMonth").textContent, how: document.getElementById("ucHow").textContent,
      setup: document.getElementById("ucSetup").textContent, occ: document.getElementById("ucOcc").value,
      err: document.getElementById("ucHow").classList.contains("uc-err"),
    }));
    const usd = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
    // 260 total, 240 occupied: the setup step is by TOTAL units ($500), and by
    // occupied it would read $250 -- the one case that tells the two apart.
    const cases = [[120, 110], [80, 80], [81, 81], [100, 50], [260, 240], [300, 290], [600, 600], [1200, 1100]];
    for (const [total, occupied] of cases) {
      await set("#ucTotal", total);
      await set("#ucOcc", occupied);
      const r = await read();
      const want = unitPricing("property_manager", [{ units: total, occupiedUnits: occupied }]);
      const okMonth = r.month === usd(want.applies ? want.monthlyCents : MIN_MONTHLY_CENTS);
      const okSetup = want.applies ? r.setup.includes(usd(want.setupCents)) : /No setup fee/.test(r.setup);
      t.ck(`${total} units, ${occupied} occupied: ${r.month} a month, ${want.applies ? usd(want.setupCents) + " setup" : "no setup"}`,
        okMonth && okSetup, JSON.stringify(r));
    }
    await set("#ucTotal", 100);
    await set("#ucOcc", 50);
    t.ck("under the floor it says so", /\$99 minimum/.test((await read()).how), (await read()).how);
    await set("#ucOcc", 150);
    const bad = await read();
    t.ck("more occupied than units is refused, with no price", bad.err && bad.month === "—" && !bad.setup, JSON.stringify(bad));
    await page.goto(pathToFileURL(PAGE).href, { waitUntil: "domcontentloaded" });
    await wait(200);
    await set("#ucTotal", 400);
    t.ck("occupied follows the total until somebody types in it", (await read()).occ === "400", (await read()).occ);
    await set("#ucOcc", 350);
    await set("#ucTotal", 500);
    t.ck("and stops following once they have", (await read()).occ === "350", (await read()).occ);
    await set("#ucRange", 900);
    t.ck("the slider sets the total", await page.evaluate(() => document.getElementById("ucTotal").value) === "900");
    const fit = await page.evaluate(() => {
      const c = document.getElementById("unitsCalc").getBoundingClientRect();
      return { right: c.right, vw: innerWidth, scroll: document.documentElement.scrollWidth };
    });
    t.ck("it fits the screen with nothing sideways", fit.right <= fit.vw + 0.5 && fit.scroll <= fit.vw + 1, JSON.stringify(fit));
    t.ck("no script error", errs.length === 0, errs.join(" | "));
    await page.close();
  }
} finally {
  await browser.close();
}
t.done();
