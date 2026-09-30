// Removing somebody asks first, and a filter panel does not open itself.
//
// Both removals fired straight off a trash icon: the row vanished, the request
// went, and the only way to find out you had hit the wrong row was that the
// wrong person was gone. A trash icon in a list is a one-pixel target beside
// every other row's, on a screen run from an iPad.
//
// What the assertions have to be careful about:
//
//   ABSENCE AFTER A CLICK IS NOT A CONFIRMATION. Checking that a modal appears
//   is only half of it -- the modal could appear AND the request still go. So
//   the API calls are counted, and the count has to be zero until somebody
//   agrees and one afterwards.
//
//   AND CANCEL HAS TO LEAVE THEM THERE. A modal whose Cancel removes anyway is
//   worse than no modal, because it was asked and answered.
//
//   A COLLAPSED PANEL MUST STILL SAY IT IS NARROWED, or a filtered list reads
//   as the whole list with no sign anything is being held back.
//
//   node --no-warnings scripts/confirm-remove-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-confirmremove-test");
const WEB = 5287, API = 8987;
const t = tally();

const ACCOUNT = {
  id: "acc_x", name: "Outerhome", subdomain: "outerhome", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};
const USERS = [
  { id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "usr_p", name: "Pat Lee", email: "pat@outerhome.co", phone: null, role: "pm",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
];
const PROPS = [{ id: "p1", accountId: "acc_x", ownerAccountId: "acc_x", name: "Harbor Flats", address: "9 Dock Rd", city: "Tacoma",
  state: "WA", zip: "98402", units: 12, vendorIds: [], ownerIds: [], notes: "" }];
const TENANTS = [
  { userId: "usr_t", name: "Sam Reyes", email: "sam@t.test", phone: null, unit: "3B",
    propertyId: "p1", propertyName: "Harbor Flats", addedAt: "2026-01-01", status: "active" },
];

// Every write is counted. "A modal appeared" is not the property under test --
// "nothing was sent until somebody agreed" is.
let deletes = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (method === "DELETE") { deletes.push(path); return [200, { ok: true }]; }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/properties") return [200, PROPS];
  if (path === "/api/tenants") return [200, TENANTS];
  if (path === "/api/subs" || path === "/api/jobs" || path === "/api/invites"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/clients") return [200, []];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openAccount = async (page, tab) => {
  await page.evaluate(() => [...document.querySelectorAll("nav button, .nav-item, header button")]
    .find((b) => /My account|Account/i.test(b.innerText || ""))?.click());
  await wait(600);
  await page.evaluate((want) => [...document.querySelectorAll("button")]
    .find((b) => b.innerText.trim() === want)?.click(), tab);
  await wait(900);
};

try {
  // ---- removing a teammate ------------------------------------------------
  console.log("\n-- removing a user asks first --");
  {
    deletes = [];
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
    await wait(2200);
    await openAccount(page, "Users");

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".user-row")].map((r) => (r.innerText || "").replace(/\n/g, " ")));
    t.ck("the users screen opened, so the rest of this can fail",
      rows.some((r) => /Pat Lee/.test(r)), JSON.stringify(rows));

    // The trash icon on the row that is not the signed-in admin.
    await page.evaluate(() => {
      const row = [...document.querySelectorAll(".user-row")]
        .find((r) => /Pat Lee/.test(r.innerText || ""));
      row?.querySelector("button.icon-x")?.click();
    });
    await wait(600);

    const modal = await page.evaluate(() => {
      const f = [...document.querySelectorAll(".modal .form, .form")]
        .find((x) => /Remove Pat Lee\?/i.test(x.innerText || ""));
      return f ? (f.innerText || "").replace(/\s+/g, " ").trim() : null;
    });
    t.ck("a modal asks, naming the person", !!modal, String(modal).slice(0, 70));
    // "Remove user" does not say whether their history goes with them, which
    // is the thing somebody hesitates over.
    t.ck("and says what actually happens to their work",
      /jobs, reports and reviews|nothing they did is erased/i.test(modal || ""),
      String(modal).slice(0, 140));
    t.ck("and that it is reversible", /invite them back/i.test(modal || ""));
    // THE HALF THAT MATTERS: nothing has been sent.
    t.ck("nothing has been sent yet", deletes.length === 0, JSON.stringify(deletes));
    t.ck("and the row is still there", await page.evaluate(() =>
      [...document.querySelectorAll(".user-row")].some((r) => /Pat Lee/.test(r.innerText || ""))));

    // Cancel has to mean cancel.
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => b.innerText.trim() === "Cancel")?.click());
    await wait(500);
    t.ck("Cancel sends nothing", deletes.length === 0, JSON.stringify(deletes));
    t.ck("and leaves them on the list", await page.evaluate(() =>
      [...document.querySelectorAll(".user-row")].some((r) => /Pat Lee/.test(r.innerText || ""))));

    // And confirming does the thing.
    await page.evaluate(() => {
      const row = [...document.querySelectorAll(".user-row")]
        .find((r) => /Pat Lee/.test(r.innerText || ""));
      row?.querySelector("button.icon-x")?.click();
    });
    await wait(500);
    await page.evaluate(() => [...document.querySelectorAll("button.btn-danger")]
      .find((b) => /Remove/i.test(b.innerText || ""))?.click());
    await wait(900);
    t.ck("confirming sends exactly one delete",
      deletes.length === 1 && /\/api\/account-users\/usr_p/.test(deletes[0]),
      JSON.stringify(deletes));
    await page.close(); await ctx.close();
  }

  // ---- and a tenant -------------------------------------------------------
  console.log("\n-- removing a tenant asks first, and the filters are folded --");
  {
    deletes = [];
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
    await wait(2200);
    await openAccount(page, "Tenants");
    await wait(600);

    const state = await page.evaluate(() => ({
      list: [...document.querySelectorAll(".user-row")].map((r) => (r.innerText || "").replace(/\n/g, " ")),
      navs: [...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim().slice(0, 18)).filter(Boolean).slice(0, 26),
      // A FOLDED panel, not a missing one: the toggle has to be there or the
      // filters are simply gone.
      toggle: !!document.querySelector(".tn-filter-toggle"),
      // No DOM nodes in here: they cannot cross to the test process, and the
      // evaluate throws rather than returning a partial object -- which reads
      // as "the screen did not render".
      open: (() => { const r = document.querySelector(".tn-filter-row");
        return r ? getComputedStyle(r).display !== "none" : null; })(),
      search: !!document.querySelector(".tn-search"),
      pane: (document.querySelector(".acct-pane, .settings-panel, main")?.innerText || document.body.innerText || "").replace(/\n/g, " | ").slice(0, 200),
    }));
    t.ck("the tenants screen opened", state.list.some((r) => /Sam Reyes/.test(r)),
      JSON.stringify({ list: state.list, pane: state.pane }));
    t.ck("there is a filters toggle", state.toggle === true);
    // The computed style, not the attribute: `[hidden]` is a UA rule at the
    // weakest specificity and `.tn-filter-row` sets display:flex, so only the
    // computed value knows whether the override actually won.
    t.ck("and the panel is folded on arrival", state.open === false, String(state.open));
    t.ck("while the search box stays, because searching is what they came to do",
      state.search === true);

    await page.evaluate(() => document.querySelector(".tn-filter-toggle")?.click());
    await wait(400);
    t.ck("pressing it opens the panel", await page.evaluate(() => {
      const r = document.querySelector(".tn-filter-row");
      return r ? getComputedStyle(r).display !== "none" : false;
    }));

    await page.evaluate(() => {
      const row = [...document.querySelectorAll(".user-row")]
        .find((r) => /Sam Reyes/.test(r.innerText || ""));
      row?.querySelector("button.icon-x")?.click();
    });
    await wait(600);
    const tMod = await page.evaluate(() => {
      const f = [...document.querySelectorAll(".form")]
        .find((x) => /Remove Sam Reyes\?/i.test(x.innerText || ""));
      return f ? (f.innerText || "").replace(/\s+/g, " ").trim() : null;
    });
    t.ck("a tenant is asked about too, by name", !!tMod, String(tMod).slice(0, 70));
    // Which home. "Remove tenant" on a portfolio screen does not say which
    // one, and the unit is the thing that tells them they have the right row.
    t.ck("naming the unit and the building", /3B/.test(tMod || "") && /Harbor Flats/.test(tMod || ""),
      String(tMod).slice(0, 120));
    t.ck("and nothing has been sent", deletes.length === 0, JSON.stringify(deletes));
    await page.close(); await ctx.close();
  }

  // ---- the roster's own filters -------------------------------------------
  console.log("\n-- and the roster's filters are folded too --");
  {
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
    await wait(2200);
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((x) => /^(Sub)?contractors\s*\d*$/i.test(x.innerText.trim().replace(/\n/g, " ")))?.click());
    await wait(1000);
    const r = await page.evaluate(() => ({
      toggle: !!document.querySelector(".filter-toggle"),
      panel: !!document.querySelector(".filters"),
      search: !!document.querySelector(".search-input input"),
    }));
    t.ck("the toggle is there", r.toggle === true, JSON.stringify(r));
    t.ck("the panel is not open on arrival", r.panel === false, JSON.stringify(r));
    t.ck("and the search box still is", r.search === true, JSON.stringify(r));
    await page.evaluate(() => document.querySelector(".filter-toggle")?.click());
    await wait(400);
    t.ck("pressing it opens the panel",
      await page.evaluate(() => !!document.querySelector(".filters")));
    await page.close(); await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
