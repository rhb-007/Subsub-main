// THE DEVELOPER PAGE IS A HOME WITH TABS, AND EVERY OLD ANCHOR STILL LANDS.
//
// developers.html covers jobs from a CRM, inspections, Postman, automation
// tools and the reference reads. With script, one tab shows at a time; an
// anchor anywhere on the page (#inspections, #postman, #zapier, #start, and
// the app's link to #zapier) opens the tab holding it. Without script every
// panel shows, so the static suites and crawlers read the whole page.
//
//   node --no-warnings scripts/dev-tabs-test.mjs

import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, tally, wait } from "./lib/stub-stack.mjs";

const t = tally();
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(join(root, "developers.html"), "utf8");

console.log("-- static --");
const tabs = [...html.matchAll(/<a class="dev-tab" data-tab="([^"]+)" href="#([^"]+)">([^<]+)<\/a>/g)];
t.ck("six tabs", tabs.length === 6, tabs.map((m) => m[3]).join(" / "));
for (const [, tab, target] of tabs) {
  const at = html.indexOf(`id="${target}"`);
  const panelStart = html.lastIndexOf('<section class="dev-panel"', at);
  const panelTag = html.slice(panelStart, html.indexOf(">", panelStart));
  t.ck(`the ${tab} tab points inside its own panel`, at > 0 && panelTag.includes(`data-tab="${tab}"`), panelTag);
}
t.ck("Postman is in Will it work with mine?", /Everything else<\/span>[\s\S]*?<li>Postman<\/li>[\s\S]*?<\/ul>/.test(html));
const starts = [...html.matchAll(/data-start="([^"]+)"/g)].map((m) => m[1]);
t.ck("more than two ways to start, including no SubSub tools at all",
  starts.length >= 5 && starts.includes("webhook") && starts.includes("code"), starts.join(","));

console.log("\n-- in a browser --");
const WEB = 5468;
const site = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/developers.html");
  const f = join(root, p);
  if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": p.endsWith(".html") ? "text/html" : "application/octet-stream" });
  res.end(readFileSync(f));
}).listen(WEB);
const browser = await launch();
const state = (page) => page.evaluate(() => ({
  on: [...document.querySelectorAll(".dev-panel")].filter((p) => getComputedStyle(p).display !== "none").map((p) => p.dataset.tab),
  tab: document.querySelector(".dev-tab.is-on")?.dataset.tab,
  current: document.querySelector('.dev-tab[aria-current="page"]')?.dataset.tab,
  scrollX: document.documentElement.scrollWidth - innerWidth,
}));
const open = async (hash, width = 820, js = true) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setJavaScriptEnabled(js);
  await page.setViewport({ width, height: 1100 });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e.message || e)));
  await page.goto(`http://127.0.0.1:${WEB}/developers.html${hash}`, { waitUntil: "domcontentloaded" });
  await wait(300);
  return { ctx, page, errs };
};

{
  const { ctx, page, errs } = await open("");
  const s = await state(page);
  t.ck("with no anchor, only the overview shows", JSON.stringify(s.on) === '["overview"]', JSON.stringify(s.on));
  t.ck("and its tab is the current one", s.tab === "overview" && s.current === "overview", `${s.tab}/${s.current}`);
  await page.click('.dev-tab[data-tab="crm"]'); await wait(200);
  const c = await state(page);
  t.ck("pressing a tab shows that panel alone", JSON.stringify(c.on) === '["crm"]', JSON.stringify(c.on));
  t.ck("and puts it in the address", await page.evaluate(() => location.hash) === "#crm");
  await page.goBack(); await wait(200);
  t.ck("back returns to the overview", JSON.stringify((await state(page)).on) === '["overview"]');
  await page.click('.dev-start-card[data-start="postman"] .dev-start-btn'); await wait(300);
  const pm = await page.evaluate(() => ({ on: [...document.querySelectorAll(".dev-panel")].filter((p) => getComputedStyle(p).display !== "none").map((p) => p.dataset.tab),
    top: document.getElementById("postman").getBoundingClientRect().top }));
  t.ck("a card's link opens the tab it points into", JSON.stringify(pm.on) === '["postman"]', JSON.stringify(pm.on));
  t.ck("and the heading is on screen, under the sticky bars", pm.top >= 60 && pm.top < 700, String(pm.top));
  t.ck("no script errors", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

for (const [hash, tab] of [["#inspections", "inspections"], ["#zapier", "automation"], ["#postman", "postman"], ["#start", "overview"], ["#webhook", "crm"], ["#reference", "reference"]]) {
  const { ctx, page } = await open(hash);
  const s = await state(page);
  t.ck(`${hash} opens the ${tab} tab`, JSON.stringify(s.on) === JSON.stringify([tab]) && s.tab === tab, JSON.stringify(s));
  await ctx.close();
}

{
  const { ctx, page } = await open("", 390);
  const s = await state(page);
  t.ck("at 390px nothing scrolls sideways", s.scrollX <= 0, String(s.scrollX));
  const bar = await page.evaluate(() => { const b = document.querySelector(".dev-tabs"); return { sw: b.scrollWidth, cw: b.clientWidth, h: b.getBoundingClientRect().height }; });
  t.ck("the tab bar scrolls inside itself instead", bar.sw > bar.cw && bar.h < 60, JSON.stringify(bar));
  await page.click('.dev-tab[data-tab="reference"]'); await wait(200);
  t.ck("and its last tab still opens", JSON.stringify((await state(page)).on) === '["reference"]');
  await ctx.close();
}

{
  const { ctx, page } = await open("", 820, false);
  const s = await state(page);
  t.ck("without script every panel shows", s.on.length === 6, JSON.stringify(s.on));
  await ctx.close();
}

await browser.close(); site.close();
t.done();
