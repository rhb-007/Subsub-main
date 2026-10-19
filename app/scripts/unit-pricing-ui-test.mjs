// Per-unit pricing, on screen (084).
//
// The server suite (test:unitpricing) proves the rule and the Stripe half.
// This one proves what only a browser can: that a property manager past 80
// units is SHOWN their own price before they press anything, that yearly is
// not offered to them, and that the occupied count is asked for on the
// building and refused before the press when it is over the units.
//
//   node --no-warnings scripts/unit-pricing-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-unitprice-test");
const WEB = 5513, API = 9213;
const t = tally();
const sent = [];

let KIND = "property_manager";
let UNITS = null;
let PLAN = "basic", PERIOD_END = null;
const acct = () => ({
  id: "acc_pm", name: "Sound Property Management", subdomain: "sound", kind: KIND,
  plan: PLAN, billing: "annual", currentPeriodEnd: PERIOD_END, useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: null, hostnameStatus: null,
  user: { id: "usr_a", name: "Rae Lane", email: "rae@sound.test", role: "admin" },
});
const PROPS = [
  { id: "p1", accountId: "acc_pm", name: "Ballard Apts", address: "1 Market St", city: "Seattle", state: "WA",
    zip: "98107", units: 60, occupiedUnits: "", notes: "", ownedByAnother: false, ownerDeclared: false },
  { id: "p2", accountId: "acc_pm", name: "Press Apts", address: "2 Pike St", city: "Seattle", state: "WA",
    zip: "98101", units: 40, occupiedUnits: 30, notes: "", ownedByAnother: false, ownerDeclared: false },
];
const APPLIES = { eligible: true, applies: true, total: 100, occupied: 90, unknown: 1, monthlyCents: 11250,
  perUnitCents: 11250, setupCents: 25000, setupLabel: "81–250 units", annualAllowed: false, threshold: 80,
  unitPriceCents: 125, minMonthlyCents: 9900, setupCharged: null, migrated: true };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/account-users") return [200, [{ id: "usr_a", name: "Rae Lane", email: "rae@sound.test",
    phone: null, role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/properties" && method === "GET") return [200, KIND === "general_contractor" ? [] : PROPS];
  if (path === "/api/properties" && method === "POST") {
    sent.push({ path, body });
    if (body?.name === "Refuse me") return [400, { error: "occupied_over_units" }];
    return [201, { id: "p_new" }];
  }
  if (path === "/api/billing" && method === "GET") return [200, { plan: "basic", cycle: "annual", status: null,
    currentPeriodEnd: null, hasCustomer: false, configured: true, invoices: [], sms: null, units: UNITS }];
  if (path === "/api/billing/checkout" && method === "POST") {
    sent.push({ path, body });
    return [501, { error: "billing_not_configured" }];
  }
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openSubscription = async (page) => {
  await page.click(".user-btn");
  await wait(300);
  await page.click(".um-account");
  await wait(800);
  const tab = await page.evaluate(() => { const b = [...document.querySelectorAll(".seg-tabs button")]
    .find((x) => /^Subscription$/.test(x.innerText.trim())); b?.click(); return !!b; });
  await wait(1200);
  return tab;
};
const billingState = (page) => page.evaluate(() => ({
  panel: document.querySelector(".unit-price")?.innerText || "",
  applies: !!document.querySelector(".unit-price.applies"),
  monthlyOnly: document.querySelector(".unit-monthly-only")?.innerText || "",
  cycleTabs: [...document.querySelectorAll(".cycle button")].map((b) => b.innerText.trim()),
  current: document.querySelector(".plan-current .pc-cycle")?.innerText || "",
  scaleBill: [...document.querySelectorAll(".plan-card")].find((c) => /scale/i.test(c.querySelector(".plan-name")?.innerText || ""))
    ?.innerText || "",
  scalePrice: [...document.querySelectorAll(".plan-card")].find((c) => /scale/i.test(c.querySelector(".plan-name")?.innerText || ""))
    ?.querySelector(".plan-price")?.innerText || "",
  unitBill: document.querySelector(".plan-unit-bill")?.innerText || "",
  unitFeat: document.querySelector(".plan-unit-feat")?.innerText || "",
  err: document.querySelector(".billing-err")?.innerText || "",
}));

try {
  console.log("\n-- a portfolio past 80 units, on the Subscription tab --");
  {
    KIND = "property_manager"; UNITS = APPLIES;
    const { ctx, page, crashes } = await visitApp(browser, { host: "sound", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_pm" }, viewport: { width: 1180, height: 1500 } });
    await wait(2600);
    t.ck("the Subscription tab opened", await openSubscription(page));
    const s = await billingState(page);
    t.ck("it says what Scale costs this account, with its own numbers",
      s.applies && /Units across your buildings\s*100/.test(s.panel) && /Occupied\s*90/.test(s.panel)
      && /\$112\.50/.test(s.panel) && /\$1\.25 × 90/.test(s.panel), s.panel);
    t.ck("and the one-time setup fee, with its step", /\$250/.test(s.panel) && /81–250 units/.test(s.panel), s.panel);
    t.ck("and names the building with no occupied count", /One building has no occupied count/.test(s.panel), s.panel);
    t.ck("yearly is not offered", s.cycleTabs.length === 0 && /Billed monthly/.test(s.monthlyOnly),
      `${s.cycleTabs.join(",")} | ${s.monthlyOnly}`);
    t.ck("the Scale card quotes the per-unit month, not $99", /^\$112\.50\s*\/mo/.test(s.scalePrice), s.scalePrice);
    t.ck("and shows how it got there", s.unitBill === "$1.25 × 90 occupied units", s.unitBill);
    // An account left on yearly is moved to monthly before the press, so the
    // checkout is never asked for a yearly price the server refuses.
    sent.length = 0;
    await page.evaluate(() => [...document.querySelectorAll(".plan-card .plan-btn")]
      .find((b) => /Upgrade/.test(b.innerText))?.click());
    await wait(900);
    const co = sent.find((x) => x.path === "/api/billing/checkout");
    t.ck("Upgrade asks for monthly", co?.body?.cycle === "monthly", JSON.stringify(sent));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- priced on the units given at signup, before any building --");
  {
    // 086. With no building carrying a unit count, the account is priced on
    // what it said at signup, and the panel has to say so -- otherwise "Units
    // across your buildings 300" reads as wrong on an account with none.
    KIND = "property_manager";
    UNITS = { ...APPLIES, total: 300, occupied: 250, unknown: 0, monthlyCents: 31250, perUnitCents: 31250,
      setupCents: 50000, setupLabel: "251–500 units", fromEstimate: true, estimate: { total: 300, occupied: 250 } };
    const { ctx, page } = await visitApp(browser, { host: "sound", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_pm" }, viewport: { width: 1180, height: 1500 } });
    await wait(2600);
    await openSubscription(page);
    const s = await billingState(page);
    t.ck("it names the signup units rather than the buildings",
      /Units you gave at signup\s*300/.test(s.panel) && !/Units across your buildings/.test(s.panel), s.panel);
    t.ck("and says the price follows the buildings once they are added",
      /no building here has a unit count/.test(s.panel) && /follows them/.test(s.panel), s.panel);
    t.ck("the Scale card quotes the same month", /^\$312\.50\s*\/mo/.test(s.scalePrice), s.scalePrice);
    await ctx.close();
    UNITS = APPLIES;
  }

  console.log("\n-- at 80 or fewer units: the $99 minimum, still monthly only --");
  {
    // One Scale price for these kinds at every size. The $990 year is $82.50
    // a month, under their own $99 floor, so it is not offered here either.
    KIND = "property_manager";
    UNITS = { ...APPLIES, applies: false, total: 60, occupied: 60, unknown: 0, monthlyCents: 9900,
      perUnitCents: 7500, setupCents: 0, setupLabel: null, annualAllowed: false };
    const { ctx, page } = await visitApp(browser, { host: "sound", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_pm" }, viewport: { width: 1180, height: 1500 } });
    await wait(2600);
    await openSubscription(page);
    const s = await billingState(page);
    t.ck("it says the flat price and the rule past 80",
      !s.applies && /hold 60 units/.test(s.panel) && /\$99 a month/.test(s.panel) && /\$1\.25 per occupied unit/.test(s.panel), s.panel);
    t.ck("yearly is not offered at 60 units either", s.cycleTabs.length === 0 && /Billed monthly/.test(s.monthlyOnly),
      `${s.cycleTabs.join(",")} | ${s.monthlyOnly}`);
    t.ck("the card says $99 a month, never $82.50", /^\$99\s*\/mo/.test(s.scalePrice) && !/82\.50|\$990/.test(s.scaleBill),
      `${s.scalePrice} | ${s.scaleBill}`);
    t.ck("and lists the rule", !s.unitBill && /Over 80 units/.test(s.unitFeat), s.unitFeat);
    await ctx.close();
  }

  console.log("\n-- the reported account: on Scale, stored yearly, nothing actually paid yearly --");
  {
    // 149 units, $186.25 in the price box and $82.50 on the card. The price
    // box and the card must say the same thing, and so must the current plan.
    KIND = "property_manager"; PLAN = "scale"; PERIOD_END = null;
    UNITS = { ...APPLIES, total: 149, occupied: 149, unknown: 3, monthlyCents: 18625, perUnitCents: 18625 };
    const { ctx, page } = await visitApp(browser, { host: "sound", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_pm" }, viewport: { width: 1180, height: 1500 } });
    await wait(2600);
    await openSubscription(page);
    const s = await billingState(page);
    t.ck("the price box says $186.25", /\$186\.25/.test(s.panel), s.panel);
    t.ck("the Scale card says the same $186.25", /^\$186\.25\s*\/mo/.test(s.scalePrice), s.scalePrice);
    t.ck("and nowhere a yearly price", !/82\.50|\$990/.test(s.scaleBill) && s.cycleTabs.length === 0,
      `${s.scaleBill} | ${s.cycleTabs.join(",")}`);
    t.ck("the current plan says the same month", /^\$186\.25\/mo/.test(s.current), s.current);
    await ctx.close();
  }

  console.log("\n-- a yearly subscription already paid for keeps its year --");
  {
    KIND = "property_manager"; PLAN = "scale"; PERIOD_END = "2027-03-01T00:00:00.000Z";
    UNITS = { ...APPLIES, total: 149, occupied: 149, unknown: 0, monthlyCents: 18625, perUnitCents: 18625 };
    const { ctx, page } = await visitApp(browser, { host: "sound", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_pm" }, viewport: { width: 1180, height: 1500 } });
    await wait(2600);
    await openSubscription(page);
    const s = await billingState(page);
    t.ck("it says the year is paid, and offers no switch", /Your Scale year is paid through/.test(s.monthlyOnly)
      && s.cycleTabs.length === 0, `${s.monthlyOnly} | ${s.cycleTabs.join(",")}`);
    t.ck("and the current plan is the year they paid", /\$990\/yr/.test(s.current), s.current);
    await ctx.close();
    PLAN = "basic"; PERIOD_END = null;
  }

  console.log("\n-- a general contractor is never shown any of it --");
  {
    KIND = "general_contractor"; UNITS = null;
    const { ctx, page } = await visitApp(browser, { host: "sound", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_pm" }, viewport: { width: 1180, height: 1500 } });
    await wait(2600);
    const opened = await openSubscription(page);
    const s = await billingState(page);
    t.ck("the tab really opened", opened && s.cycleTabs.length === 2, s.cycleTabs.join(","));
    t.ck("no unit panel, no unit line on the card", !s.panel && !s.unitFeat && !s.unitBill, `${s.panel}|${s.unitFeat}`);
    await ctx.close();
  }

  console.log("\n-- the occupied count on a building --");
  {
    KIND = "property_manager"; UNITS = APPLIES;
    const { ctx, page, crashes } = await visitApp(browser, { host: "sound", webPort: WEB,
      seat: { userId: "usr_a", accountId: "acc_pm" }, viewport: { width: 1180, height: 1500 } });
    await wait(2600);
    await page.evaluate(() => [...document.querySelectorAll("nav button")]
      .find((b) => /^Properties/i.test((b.innerText || "").trim()))?.click());
    await wait(900);
    const detail = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".pt-open")].find((x) => x.innerText.trim() === "Press Apts");
      b?.click(); return !!b;
    });
    await wait(700);
    const occ = await page.evaluate(() => [...document.querySelectorAll(".pd-occ")].map((e) => e.innerText));
    t.ck("a building's window says how many units are occupied", detail && occ.some((x) => /30 occupied/.test(x)),
      occ.join(" | "));
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.querySelector(".modal-backdrop")?.click());
    await wait(400);
    await page.evaluate(() => document.querySelector(".add-btn.small")?.click());
    await wait(700);
    const fill = async (sel, v) => page.evaluate(([s, val]) => {
      const el = document.querySelector(s); if (!el) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(el, val); el.dispatchEvent(new Event("input", { bubbles: true })); return true;
    }, [sel, v]);
    const has = await page.evaluate(() => !!document.querySelector(".prop-occupied"));
    t.ck("the property form asks for occupied units beside the total", has);
    await page.evaluate(() => {
      const ins = [...document.querySelectorAll(".settings-panel input")];
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const put = (el, v) => { set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
      put(ins[0], "Fremont Lofts"); put(ins[1], "3 Leary Way");
    });
    const unitsSel = ".prop-units .fld:first-child input";
    await fill(unitsSel, "10");
    await fill(".prop-occupied", "12");
    await wait(300);
    let f = await page.evaluate(() => ({
      note: document.querySelector(".prop-occ-note")?.className || "",
      noteText: document.querySelector(".prop-occ-note")?.innerText || "",
      save: [...document.querySelectorAll(".settings-panel .btn-solid")].find((b) => /Add property/.test(b.innerText))?.disabled,
    }));
    t.ck("more occupied than units is said before the press", /is-bad/.test(f.note) && /More units are occupied/.test(f.noteText), f.noteText);
    t.ck("and Add is not pressable", f.save === true, String(f.save));
    await fill(".prop-occupied", "8");
    await wait(300);
    sent.length = 0;
    await page.evaluate(() => [...document.querySelectorAll(".settings-panel .btn-solid")]
      .find((b) => /Add property/.test(b.innerText))?.click());
    await wait(900);
    const post = sent.find((x) => x.path === "/api/properties");
    t.ck("the count goes to the server with the building", post?.body?.occupiedUnits === "8" && post?.body?.units === "10",
      JSON.stringify(post?.body));
    // A refusal stays on the form, with its reason.
    await page.evaluate(() => document.querySelector(".add-btn.small")?.click());
    await wait(700);
    await page.evaluate(() => {
      const ins = [...document.querySelectorAll(".settings-panel input")];
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const put = (el, v) => { set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
      put(ins[0], "Refuse me"); put(ins[1], "4 Leary Way");
    });
    await wait(200);
    await page.evaluate(() => [...document.querySelectorAll(".settings-panel .btn-solid")]
      .find((b) => /Add property/.test(b.innerText))?.click());
    await wait(900);
    f = await page.evaluate(() => ({
      err: document.querySelector(".prop-save-err")?.innerText || "",
      formUp: !!document.querySelector(".prop-occupied"),
    }));
    t.ck("a refused save keeps the form up and says why", f.formUp && /More units are occupied/.test(f.err), JSON.stringify(f));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} catch (err) {
  t.ck("the suite ran to the end", false, err?.stack || String(err));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
