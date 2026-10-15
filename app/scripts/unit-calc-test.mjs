// The per-unit pricing section on the pricing page (084, 086).
//
// It used to carry a calculator. Asked for as "Work out your price should be
// part of the flow of signup, should not be on the pricing page", so the page
// explains the rule and sends people to signup, where get-started.html asks
// for the units and quotes the price (test:signupunits drives that). The page
// has no build step, so what it still states is a hand copy of
// app/shared/unitpricing.js, and this suite keeps the copy honest:
//
//   EVERY FIGURE ON THE PAGE IS THE MODULE'S: the threshold, the unit price,
//   the minimum and the table of setup steps.
//
//   THERE IS NO CALCULATOR, and the section links into signup on Scale,
//   monthly, as a property manager -- which is where the units are asked.
//
//   node --no-warnings scripts/unit-calc-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch, tally, wait } from "./lib/stub-stack.mjs";
import { UNIT_THRESHOLD, UNIT_PRICE_CENTS, MIN_MONTHLY_CENTS, SETUP_TIERS } from "../shared/unitpricing.js";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const PAGE = join(root, "pricing.html");
const html = readFileSync(PAGE, "utf8");
const t = tally();
const usd = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

console.log("\n-- the page's figures are the module's --");
const band = (html.match(/<div class="units-band" id="units">([\s\S]*?)<\/section>/) || [])[1] || "";
const text = band.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
t.ck("the section is there", band.length > 0);
t.ck("the threshold", text.includes(`more than ${UNIT_THRESHOLD} units`), text.slice(0, 200));
t.ck("the unit price", text.includes(`${usd(UNIT_PRICE_CENTS)} per occupied unit`));
t.ck("the minimum", text.includes(`${usd(MIN_MONTHLY_CENTS)} a month`) && text.includes(`never less than ${usd(MIN_MONTHLY_CENTS)}`));
const table = [...band.matchAll(/<tr><td>([^<]+)<\/td><td>\$([\d,]+)<\/td><\/tr>/g)].map((m) => Number(m[2].replace(/,/g, "")) * 100);
t.ck("the table of setup steps", table.join(",") === SETUP_TIERS.map((s) => s.cents).join(","), table.join(","));

console.log("\n-- the price is worked out in signup, not here --");
const noComments = html.replace(/<!--[\s\S]*?-->/g, "");
t.ck("no calculator on the page", !/unitsCalc|id="ucTotal"|id="ucOcc"|Work out your price/.test(noComments));
const go = (band.match(/id="unitsGoBtn"[^>]*href="([^"]+)"/) || band.match(/href="([^"]+)"[^>]*id="unitsGoBtn"/) || [])[1] || "";
t.ck("the section links into signup on Scale, monthly, as a property manager",
  /^get-started\.html\?plan=scale&amp;billing=monthly&amp;as=property%20manager$/.test(go), go);
t.ck("and says the price is shown as they sign up", /worked out as you sign up/.test(text));

const browser = await launch();
try {
  for (const vw of [1200, 390]) {
    console.log(`\n-- drawn at ${vw}px --`);
    const page = await browser.newPage();
    await page.setViewport({ width: vw, height: 1000 });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(pathToFileURL(PAGE).href, { waitUntil: "domcontentloaded" });
    await wait(200);
    const r = await page.evaluate(() => {
      const b = document.getElementById("unitsGoBtn"), box = document.getElementById("units");
      const br = b?.getBoundingClientRect(), xr = box?.getBoundingClientRect();
      return { shown: !!br && br.width > 0 && getComputedStyle(b).display !== "none",
        inside: !!br && br.right <= xr.right + 0.5, vw: innerWidth, sw: document.documentElement.scrollWidth };
    });
    t.ck("the Start on Scale button is drawn inside the section", r.shown && r.inside, JSON.stringify(r));
    t.ck("nothing scrolls sideways", r.sw <= r.vw + 1, JSON.stringify(r));
    t.ck("no script error", errs.length === 0, errs.join(" | "));
    await page.close();
  }
} finally {
  await browser.close();
}
t.done();
