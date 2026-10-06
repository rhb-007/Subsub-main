// The staff console's dashboard and its two lists, in a real browser.
//
// Asked for as: move Right now to the top and give it a free-to-paid box and
// an account-types box; bring trades and locations up and make them smaller;
// make every sub page thin rows that open into a window; and put filters on
// Accounts and Companies. Everything below is MEASURED rather than read off
// the source, because source order is not screen order and a static check
// that a block moved passes whether or not it lands anywhere near the top.
//
//   node scripts/console-lists-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-console-lists-test");
const WEB = 5371, API = 9071;
const t = tally();

console.log("\n-- building the console --");
buildApp({ outDir: OUT, apiPort: API, platform: true });

const STAFF = { userId: "u_staff", name: "Staff Person", email: "staff@subsub.test",
  role: "superadmin", finance: true, impersonate: true };

const acct = (id, name, kind, plan, extra = {}) => ({ id, name, subdomain: id, kind, plan,
  billing: "monthly", comped: false, compNote: null, trades: [], hostnameStatus: "active",
  subscriptionStatus: plan === "scale" ? "active" : null, createdAt: "2026-01-04", status: "active",
  lastActive: "2026-10-05", ...extra });

const BOOT = {
  accounts: [
    acct("acc_sub", "Pacific Apartment Maintenance", "subcontractor", "basic",
      { trades: ["roofing", "gutters", "painting", "plumbing"] }),
    acct("acc_gc", "Outerhome", "general_contractor", "scale",
      { trades: ["roofing", "gutters", "painting", "siding", "electrical"] }),
    // A comped Scale account: on the plan, paying nothing. Only this row can
    // tell "paying" from "on Scale".
    acct("acc_gc2", "Northline Builders", "general_contractor", "scale", { comped: true, compNote: "Design partner",
      trades: ["roofing", "siding"] }),
    acct("acc_pm", "Sound Property Management", "property_manager", "scale", { trades: ["roofing"] }),
    acct("acc_port", "Harbor Portfolio", "portfolio_manager", "basic"),
    acct("acc_own", "Ruston Owner LLC", "building_owner", "basic"),
    // Canceled: off every live count, still in the list.
    acct("acc_gone", "Gone Exteriors", "general_contractor", "basic", { status: "canceled" }),
  ],
  users: [
    { id: "u_a1", name: "Rae Admin", email: "rae@outerhome.test", phone: null },
    { id: "u_a2", name: "Juan Soto", email: "juan@pacific.test", phone: null },
    { id: "u_pm", name: "Priya Manager", email: "priya@harbor.test", phone: null },
    { id: "u_a3", name: "Sam Sound", email: "sam@sound.test", phone: null },
    { id: "u_a4", name: "Nell North", email: "nell@northline.test", phone: null },
    { id: "u_a5", name: "Ruth Owner", email: "ruth@ruston.test", phone: null },
    { id: "u_a6", name: "Gina Gone", email: "gina@gone.test", phone: null },
  ],
  memberships: [
    { userId: "u_a1", accountId: "acc_gc", role: "admin", companyId: null },
    { userId: "u_a2", accountId: "acc_sub", role: "admin", companyId: null },
    // Harbor's only person is a project manager: an account with no admin.
    { userId: "u_pm", accountId: "acc_port", role: "pm", companyId: null },
    { userId: "u_a3", accountId: "acc_pm", role: "admin", companyId: null },
    { userId: "u_a4", accountId: "acc_gc2", role: "admin", companyId: null },
    { userId: "u_a5", accountId: "acc_own", role: "admin", companyId: null },
    { userId: "u_a6", accountId: "acc_gone", role: "admin", companyId: null },
  ],
  companies: [
    { id: "cmp_own_acc_gc", company: "Outerhome", contact: "Rae Admin", accountName: "Outerhome",
      email: "rae@outerhome.test", license: "OUTERH001", city: "Seattle", state: "WA" },
    { id: "cmp_sj", company: "San Juan Exteriors", contact: "Richard Braun", email: "rb@sanjuan.test",
      license: "SJ123", city: "Tacoma", state: "WA",
      licenseCheck: { status: "Suspended" } },
    { id: "cmp_dup1", company: "Ace Gutters", contact: "Danny Ace", email: "danny@ace.test",
      license: "ACE777", city: "Everett", state: "WA" },
    { id: "cmp_dup2", company: "Ace Gutters LLC", contact: "Dan Ace", email: "dan@ace.test",
      license: "ACE777", city: "Olympia", state: "WA" },
    { id: "cmp_far", company: "Skagit Framing", contact: "Jo Skagit", email: "jo@skagit.test",
      license: null, city: "Burlington", state: "WA" },
  ],
  engagements: [
    { id: "en1", accountId: "acc_gc", companyId: "cmp_sj", status: "active", categories: ["roofing"], docReview: {} },
    { id: "en2", accountId: "acc_pm", companyId: "cmp_sj", status: "active", categories: ["roofing"], docReview: {} },
    { id: "en3", accountId: "acc_gc", companyId: "cmp_dup1", status: "active", categories: ["gutters"], docReview: {} },
  ],
  jobs: [], subEvents: [], activity: [], smsDaily: [],
};

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path === "/api/platform/me") return [200, STAFF];
  if (path === "/api/platform/bootstrap") return [200, BOOT];
  if (path === "/api/platform/companies") return [200, []];
  if (path.startsWith("/api/platform/activity/")) return [200, []];
  if (path.startsWith("/api/platform/accounts/") && path.endsWith("/fee-terms"))
    return [200, { terms: { bps: 50, capCents: 50000, freeCents: 5_000_000 },
      defaults: { bps: 50, capCents: 50000, freeCents: 5_000_000 }, custom: false, note: null, processedCents: 0 }];
  if (path === "/api/notify/log") return [200, []];
  return undefined;
} });

const browser = await launch();
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 1280, height: 1600 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));

const nav = (label) => page.evaluate((l) => [...document.querySelectorAll(".pf-nav button")]
  .find((b) => b.innerText.trim() === l)?.click(), label);
const setFilter = (id, value) => page.evaluate((id, value) => {
  const sel = document.querySelector(`.fbar [data-filter="${id}"] select`);
  if (!sel) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  set.call(sel, value);
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}, id, value);
const search = (q) => page.evaluate((q) => {
  const inp = document.querySelector(".fbar .fbar-q input");
  if (!inp) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(inp, q);
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, q);
const rowNames = () => page.evaluate(() => [...document.querySelectorAll(".pf-rows .pf-row .pf-row-name b")]
  .map((b) => b.innerText.trim()));

try {
  await page.goto(`http://127.0.0.1:${WEB}/`, { waitUntil: "domcontentloaded" });
  await wait(2600);
  const gotIn = await page.evaluate(() => !!document.querySelector(".pf-main") && /Dashboard/.test(document.body.innerText));
  t.ck("the console loaded past its sign-in", gotIn,
    await page.evaluate(() => document.body.innerText.slice(0, 160).replace(/\s+/g, " ")));
  if (!gotIn) throw new Error("console never opened");

  console.log("\n-- the dashboard leads with Right now --");
  const order = await page.evaluate(() => [...document.querySelectorAll(".pf-section")]
    .map((sec) => ({ h: sec.querySelector(".pf-section-hd h3")?.innerText.trim(),
      top: Math.round(sec.getBoundingClientRect().top) })));
  const rn = order.find((o) => /right now/i.test(o.h || ""));
  const tm = order.find((o) => /this month/i.test(o.h || ""));
  const rg = order.find((o) => /range/i.test(o.h || ""));
  t.ck("Right now is on the dashboard", !!rn, JSON.stringify(order));
  t.ck("and above This month and the range", !!rn && !!tm && !!rg && rn.top < tm.top && rn.top < rg.top,
    JSON.stringify(order));

  const cards = await page.evaluate(() => [...document.querySelectorAll(".pf-dash-card")]
    .map((c) => ({ h: c.querySelector("h3")?.innerText.trim(), text: c.innerText.replace(/\s+/g, " ") })));
  const conv = cards.find((c) => /free\s*→\s*paid/i.test(c.h || ""));
  t.ck("there is a Free → paid box in it", !!conv, cards.map((c) => c.h).join(" | "));
  // Six live accounts; Outerhome and Sound bill, Northline is comped. A box
  // counting the plan would say 3.
  t.ck("it counts accounts that PAY, not accounts on Scale -- 2 of 6",
    /\b2\s*of 6 live paying/.test(conv?.text || ""), conv?.text);
  // And the Revenue card beside it agrees: it read mrr alone and said 3.
  const rev = cards.find((c) => /^revenue/i.test(c.h || ""));
  t.ck("the Revenue card names the same number of paying accounts",
    /\b2 paying accounts\b/.test(rev?.text || ""), rev?.text);

  const kinds = await page.evaluate(() => {
    const c = document.querySelector(".pf-dash-kinds");
    return c ? [...c.querySelectorAll(".pf-kind-list button")].map((b) => ({
      kind: b.dataset.kind, label: b.querySelector("span")?.innerText.trim(), n: b.querySelector("b")?.innerText.trim() })) : null;
  });
  t.ck("there is an Account types box", !!kinds, JSON.stringify(kinds));
  t.ck("naming the five kinds in the order asked for",
    JSON.stringify((kinds || []).map((k) => k.label)) === JSON.stringify(
      ["Subcontractor", "General contractor", "Property manager", "Portfolio manager", "Building owner"]),
    JSON.stringify((kinds || []).map((k) => k.label)));
  // Two general contractors are live and one is canceled: 3 would be counting
  // the canceled one.
  t.ck("with live counts per kind -- 1, 2, 1, 1, 1",
    JSON.stringify((kinds || []).map((k) => k.n)) === JSON.stringify(["1", "2", "1", "1", "1"]),
    JSON.stringify((kinds || []).map((k) => k.n)));

  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + "/console-dash.png", clip: { x: 0, y: 0, width: 1280, height: 900 } });
  console.log("\n-- trades and locations are up top, and small --");
  const ranks = await page.evaluate(() => {
    const split = document.querySelector(".pf-split-compact");
    const tm = [...document.querySelectorAll(".pf-section")].find((s) => /this month/i.test(s.innerText.split("\n")[0]));
    return split ? {
      top: Math.round(split.getBoundingClientRect().top),
      thisMonthTop: tm ? Math.round(tm.getBoundingClientRect().top) : null,
      lists: [...split.querySelectorAll(".pf-rank")].map((ol) => ol.querySelectorAll("li").length),
      height: Math.round(split.getBoundingClientRect().height),
      more: !!document.querySelector(".pf-rank-more"),
    } : null;
  });
  t.ck("they sit above the period figures", !!ranks && ranks.thisMonthTop !== null && ranks.top < ranks.thisMonthTop,
    JSON.stringify(ranks));
  t.ck("each starts at three rows", JSON.stringify(ranks?.lists) === "[3,3]", JSON.stringify(ranks?.lists));
  t.ck("and the pair is short", (ranks?.height || 999) < 190, `${ranks?.height}px`);
  t.ck("with a way to see more", ranks?.more === true);
  await page.evaluate(() => document.querySelector(".pf-rank-more")?.click());
  await wait(300);
  const opened = await page.evaluate(() => [...document.querySelectorAll(".pf-split-compact .pf-rank")]
    .map((ol) => ol.querySelectorAll("li").length));
  t.ck("which opens them to more", opened.every((n) => n > 3), JSON.stringify(opened));

  console.log("\n-- a kind on the dashboard is the way into that list --");
  await page.evaluate(() => document.querySelector('.pf-kind-list button[data-kind="portfolio_manager"]')?.click());
  await wait(500);
  t.ck("pressing Portfolio manager lists only Harbor Portfolio",
    JSON.stringify(await rowNames()) === JSON.stringify(["Harbor Portfolio"]), JSON.stringify(await rowNames()));
  t.ck("and the filter says so", await page.evaluate(() =>
    document.querySelector('.fbar [data-filter="kind"] select')?.value === "portfolio_manager"
    && /1 of 7/.test(document.querySelector(".fbar-n")?.innerText || "")));

  console.log("\n-- Accounts: one line each --");
  await page.evaluate(() => document.querySelector(".fbar-clear")?.click());
  await wait(300);
  const acRows = await page.evaluate(() => [...document.querySelectorAll(".pf-rows .pf-row")]
    .map((r) => ({ h: Math.round(r.getBoundingClientRect().height), w: Math.round(r.getBoundingClientRect().width) })));
  t.ck("every account is a row", acRows.length === 7, `${acRows.length}`);
  t.ck("a thin one", acRows.length > 0 && acRows.every((r) => r.h <= 72), JSON.stringify(acRows.map((r) => r.h)));
  t.ck("running the width of the page", acRows.length > 0 && acRows.every((r) => r.w > 900), JSON.stringify(acRows.map((r) => r.w)));
  t.ck("and the old card grid is gone", await page.evaluate(() => !document.querySelector(".pf-account-grid")));

  await setFilter("plan", "basic"); await wait(300);
  t.ck("the plan filter narrows to Basic",
    JSON.stringify((await rowNames()).sort()) === JSON.stringify(["Gone Exteriors", "Harbor Portfolio", "Pacific Apartment Maintenance", "Ruston Owner LLC"]),
    JSON.stringify(await rowNames()));
  await setFilter("plan", ""); await setFilter("flag", "noadmin"); await wait(300);
  t.ck("the No admin flag finds the account with only a project manager",
    JSON.stringify(await rowNames()) === JSON.stringify(["Harbor Portfolio"]), JSON.stringify(await rowNames()));
  await setFilter("flag", ""); await search("juan@pacific"); await wait(300);
  t.ck("search finds an account by a person's email",
    JSON.stringify(await rowNames()) === JSON.stringify(["Pacific Apartment Maintenance"]), JSON.stringify(await rowNames()));
  await search("zzz-nothing"); await wait(300);
  t.ck("a search that matches nothing says so, with the way out",
    await page.evaluate(() => /Nothing matches/.test(document.querySelector(".pf-rows")?.innerText || "")
      && !!document.querySelector(".pf-rows .pf-linkbtn")));
  await page.evaluate(() => document.querySelector(".fbar-clear")?.click());
  await wait(300);

  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + "/console-accounts.png", clip: { x: 0, y: 0, width: 1280, height: 800 } });
  console.log("\n-- a row opens the account in a window, over the list --");
  await page.evaluate(() => [...document.querySelectorAll(".pf-rows .pf-row")]
    .find((r) => /Outerhome/.test(r.innerText))?.click());
  await wait(900);
  const win = await page.evaluate(() => {
    const m = document.querySelector(".modal.modal-acct");
    return m ? { h2: m.querySelector("h2")?.innerText.trim(), list: !!document.querySelector(".pf-rows .pf-row"),
      fee: !!m.querySelector(".pf-fee") } : null;
  });
  t.ck("the account opens in a window", !!win, JSON.stringify(win));
  t.ck("for the row that was pressed", win?.h2 === "Outerhome", win?.h2);
  t.ck("with the list still behind it", win?.list === true);
  t.ck("and the whole account inside it", win?.fee === true);

  await page.evaluate(() => [...document.querySelectorAll(".modal-acct button")]
    .find((b) => /Delete account/.test(b.innerText))?.click());
  await wait(500);
  const del = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll(".modal")];
    const conf = boxes.find((m) => /to confirm/i.test(m.innerText));
    if (!conf) return null;
    const r = conf.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
    return { onTop: conf.contains(hit) };
  });
  t.ck("deleting from inside it asks for the typed name", !!del, JSON.stringify(del));
  t.ck("in a box drawn OVER the account window, not under it", del?.onTop === true, JSON.stringify(del));
  await page.evaluate(() => [...document.querySelectorAll(".modal button")].find((b) => /^Cancel$/.test(b.innerText.trim()))?.click());
  await wait(300);
  await page.evaluate(() => document.querySelector(".modal-acct .modal-close")?.click());
  await wait(400);
  t.ck("closing it leaves the list where it was", await page.evaluate(() =>
    !document.querySelector(".modal-acct") && document.querySelectorAll(".pf-rows .pf-row").length === 7));

  console.log("\n-- Companies: rows, a window, and filters --");
  await nav("Companies"); await wait(600);
  const coRows = await page.evaluate(() => [...document.querySelectorAll(".pf-rows .pf-row")]
    .map((r) => Math.round(r.getBoundingClientRect().height)));
  t.ck("every company is a row", coRows.length === 5, `${coRows.length}`);
  t.ck("a thin one", coRows.length > 0 && coRows.every((h) => h <= 72), JSON.stringify(coRows));
  t.ck("and the old card grid is gone", await page.evaluate(() => !document.querySelector(".pf-company-grid")));

  await setFilter("type", "account"); await wait(300);
  t.ck("Type: Accounts lists only the account's own company row",
    JSON.stringify(await rowNames()) === JSON.stringify(["Outerhome"]), JSON.stringify(await rowNames()));
  await setFilter("type", "contractor"); await wait(300);
  t.ck("and Contractors leaves it out", !(await rowNames()).includes("Outerhome") && (await rowNames()).length === 4,
    JSON.stringify(await rowNames()));
  await setFilter("type", ""); await setFilter("lic", "issue"); await wait(300);
  t.ck("Licences: Failing check finds the suspended one",
    JSON.stringify(await rowNames()) === JSON.stringify(["San Juan Exteriors"]), JSON.stringify(await rowNames()));
  await setFilter("lic", ""); await setFilter("reach", "dup"); await wait(300);
  t.ck("Flags: Possible duplicate finds both records on one licence",
    JSON.stringify((await rowNames()).sort()) === JSON.stringify(["Ace Gutters", "Ace Gutters LLC"]), JSON.stringify(await rowNames()));
  await setFilter("reach", "multi"); await wait(300);
  t.ck("Flags: Serving 2+ accounts finds the one two accounts hire",
    JSON.stringify(await rowNames()) === JSON.stringify(["San Juan Exteriors"]), JSON.stringify(await rowNames()));
  await setFilter("reach", ""); await setFilter("city", "Burlington, WA"); await wait(300);
  t.ck("Cities narrows by where they are",
    JSON.stringify(await rowNames()) === JSON.stringify(["Skagit Framing"]), JSON.stringify(await rowNames()));
  await setFilter("city", ""); await search("ace777"); await wait(300);
  t.ck("search finds a company by its licence number", (await rowNames()).length === 2, JSON.stringify(await rowNames()));
  await page.evaluate(() => document.querySelector(".fbar-clear")?.click());
  await wait(300);

  await page.evaluate(() => [...document.querySelectorAll(".pf-rows .pf-row")]
    .find((r) => /Skagit/.test(r.innerText))?.click());
  await wait(600);
  const cw = await page.evaluate(() => {
    const m = document.querySelector(".modal.modal-co");
    return m ? { h2: m.querySelector("h2")?.innerText.trim(),
      detail: /License/i.test(m.querySelector(".pfc-rows")?.innerText || ""),
      edit: !!m.querySelector(".pfe-open input") } : null;
  });
  t.ck("a company opens in a window", !!cw, JSON.stringify(cw));
  t.ck("for the row that was pressed", cw?.h2 === "Skagit Framing", cw?.h2);
  t.ck("with its detail", cw?.detail === true);
  t.ck("and its edit form, in the same window", cw?.edit === true);
  await page.evaluate(() => document.querySelector(".modal-co .modal-close")?.click());
  await wait(300);

  console.log("\n-- the attention list leads into a narrowed list --");
  await nav("Dashboard"); await wait(500);
  await page.evaluate(() => [...document.querySelectorAll(".pf-act")]
    .find((p) => /license check/i.test(p.innerText))?.querySelector("a")?.click());
  await wait(500);
  t.ck("the failing-licence line opens Companies already narrowed to it",
    await page.evaluate(() => document.querySelector('.fbar [data-filter="lic"] select')?.value === "issue")
      && JSON.stringify(await rowNames()) === JSON.stringify(["San Juan Exteriors"]),
    JSON.stringify(await rowNames()));

  console.log("\n-- and on a phone --");
  await page.setViewport({ width: 390, height: 900 });
  await nav("Accounts"); await wait(600);
  const phone = await page.evaluate(() => ({
    over: document.documentElement.scrollWidth - window.innerWidth,
    rows: [...document.querySelectorAll(".pf-rows .pf-row")].map((r) => Math.round(r.getBoundingClientRect().right)),
  }));
  t.ck("nothing scrolls sideways", phone.over <= 0, `${phone.over}px`);
  t.ck("and every row ends inside the screen", phone.rows.length === 7 && phone.rows.every((r) => r <= 390),
    JSON.stringify(phone.rows));

  t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
