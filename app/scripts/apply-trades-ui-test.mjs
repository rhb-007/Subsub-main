// The application form's Trades step must offer trades.
//
// Reported from outerhome.subsub.work/?apply=1: step 2 drew "What trades do
// you cover?" with nothing under it, then City, ZIP and crews, and Continue
// never enabled. `tradesAllowed` answers NULL for a subcontractor, meaning
// every trade, and the form read it through `new Set(null)` -- an empty set --
// so every subcontractor applying, cold or by invite, saw no trades at all.
// A handyman invite worked, which is why the handyman suite stayed green.
//
// Both branches are driven in the same place: a fix that showed every trade
// to everybody passes the subcontractor half and puts Roofing in front of a
// handyman the route will refuse it for.
//
//   node scripts/apply-trades-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, tally, wait } from "./lib/stub-stack.mjs";
import { TRADES } from "../shared/trades.js";
import { HANDYMAN_TRADES } from "../shared/engaged.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-applytrades-test");
const WEB = 5285, API = 8985;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const ACCOUNT = {
  id: "acc_o", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null,
};
const invite = (engagedAs) => ({
  label: null, invitedEmail: "juan@pacific.test", phone: null, contact: "Juan Soto",
  companyName: "Pacific apartment maintenance", known: null, knownEnough: false,
  engagedAs, account: { name: "Outerhome", subdomain: "outerhome", theme: null,
    logoKey: null, useDefaultMark: true, id: "acc_o" },
});

serveApp({ dir: OUT, port: WEB });
serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/invite/tok_sub") return [200, invite("subcontractor")];
  if (path === "/api/invite/tok_handy") return [200, invite("handyman")];
  return undefined;
} });

const browser = await launch();

async function toTrades(url, fill) {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1200 });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(url, { waitUntil: "networkidle0" });
  await wait(500);
  if (fill) {
    const type = async (label, v) => page.evaluate((l, val) => {
      const f = [...document.querySelectorAll("label.wl-fld")].find((x) => x.textContent.trim().startsWith(l));
      const i = f?.querySelector("input");
      if (!i) return;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(i, val); i.dispatchEvent(new Event("input", { bubbles: true }));
    }, label, v);
    await type("Company name", "Cascade Roofing");
    await type("Your name", "Ana Ruiz");
    await type("Email", "ana@cascade.test");
  }
  const cont = async () => page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /^Continue/.test(x.textContent.trim()));
    if (!b) return "missing";
    if (b.disabled) return "disabled";
    b.click(); return "clicked";
  });
  const first = await cont();
  await wait(300);
  const read = () => page.evaluate(() => ({
    onTrades: /What trades do you cover/i.test(document.body.innerText),
    picks: [...document.querySelectorAll(".wl-pick")].map((b) => b.textContent.trim()),
  }));
  return { page, first, read, cont, errs };
}

console.log("\n-- a subcontractor applying cold --");
{
  const r = await toTrades(`http://127.0.0.1:${WEB}/?apply=outerhome`, true);
  t.ck("step 1 continues", r.first === "clicked", r.first);
  const s = await r.read();
  t.ck("it reaches the Trades step", s.onTrades);
  t.ck("and every trade is offered", s.picks.length === TRADES.length, `${s.picks.length} of ${TRADES.length}`);
  t.ck("Continue waits on a trade", (await r.cont()) === "disabled");
  await r.page.evaluate(() => [...document.querySelectorAll(".wl-pick")].find((b) => /Roofing/.test(b.textContent))?.click());
  await wait(150);
  t.ck("picking one lights it", (await r.page.$$(".wl-pick.on")).length === 1);
  t.ck("and Continue moves on", (await r.cont()) === "clicked");
  await wait(200);
  t.ck("to the last step", await r.page.evaluate(() => /How should we reach you/i.test(document.body.innerText)));
  t.ck("nothing crashed", r.errs.length === 0, r.errs.join(" | "));
}

console.log("\n-- a subcontractor invite --");
{
  const r = await toTrades(`http://127.0.0.1:${WEB}/?invite=tok_sub`, false);
  t.ck("step 1 continues from the invite's details", r.first === "clicked", r.first);
  const s = await r.read();
  t.ck("every trade is offered there too", s.picks.length === TRADES.length, `${s.picks.length} of ${TRADES.length}`);
}

console.log("\n-- a handyman invite, in the same place --");
{
  const r = await toTrades(`http://127.0.0.1:${WEB}/?invite=tok_handy`, false);
  t.ck("step 1 continues", r.first === "clicked", r.first);
  const s = await r.read();
  t.ck("only the handyman trades are offered", s.picks.length === HANDYMAN_TRADES.length,
    `${s.picks.length} of ${HANDYMAN_TRADES.length}`);
  t.ck("and not Roofing", !s.picks.some((p) => /^Roofing$/.test(p)), s.picks.join(", "));
}

await browser.close();
t.done();
