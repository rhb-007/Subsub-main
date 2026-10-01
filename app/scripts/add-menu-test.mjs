// What the header's Add control offers, per account kind — and the one case
// where it offered a second copy of a button already on the screen.
//
// Reported from a property manager's dashboard as **"it says add job twice"**,
// beside a general contractor's where it reads correctly. Both halves are
// real and they are different bugs:
//
//   THE DUPLICATE. The dashboard's own call to action is `New job` (or
//   `Request work` for an owner). The header's Add collapses to a single
//   button whenever the seat has exactly one thing it can add — and that one
//   thing IS the job — so the two sat side by side saying the same word. A
//   seat with a real menu never showed it, which is why a general contractor
//   admin looked fine and nothing anywhere reported it.
//
//   THE MISSING ITEM. An account that keeps buildings can add one, and a
//   general contractor cannot: `can("properties")` is `hasProperties(account)`
//   rather than the role's list alone. That is already right — this pins it,
//   because a rule with two branches needs both asserted in the same place or
//   the coverage is diagonal, which is the trap `hiresLabel` already records
//   in this repository.
//
//   node --no-warnings scripts/add-menu-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-addmenu-test");
const WEB = 5303, API = 9003;
const t = tally();

const acct = (kind, extra = {}) => ({
  id: "acc_x", name: kind === "general_contractor" ? "Outerhome" : "Sound Property Management",
  subdomain: "x", kind, plan: "scale", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["roofing"], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Richard Braun", email: "rb@x.test", role: "admin" }, ...extra,
});
const USERS = (role) => [{ id: "usr_r", name: "Richard Braun", email: "rb@x.test", phone: null,
  role, subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];

let KIND = "general_contractor";
let ROLE = "admin";
let SCOPE = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct(KIND)];
  if (path === "/api/account") return [200, acct(KIND)];
  if (path === "/api/account-users") return [200,
    USERS(ROLE).map((u) => ({ ...u, propertyIds: SCOPE }))];
  if (path === "/api/jobs" || path === "/api/subs" || path === "/api/properties"
    || path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/tenants"
    || path === "/api/clients") return [200, []];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

// What the header offers, and what the dashboard offers, read separately.
const readHeader = (page) => page.evaluate(() => {
  const btn = document.querySelector(".ss-header .add-btn");
  return {
    label: btn ? (btn.innerText || "").replace(/\s+/g, " ").trim() : null,
    isMenu: !!btn && /^Add$/i.test((btn.innerText || "").trim()),
  };
});
const openMenu = async (page) => {
  await page.evaluate(() => document.querySelector(".ss-header .add-btn")?.click());
  await wait(400);
  return page.evaluate(() => [...document.querySelectorAll(".add-menu button")]
    .map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()));
};
const dashCta = (page) => page.evaluate(() => [...document.querySelectorAll(".dash-cta button")]
  .map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()));

const open = async (seat = { userId: "usr_r", accountId: "acc_x" }) => {
  const { ctx, page } = await visitApp(browser, { host: "x", webPort: WEB, seat,
    viewport: { width: 1340, height: 1200 } });
  await wait(2400);
  return { ctx, page };
};

try {
  console.log("\n-- a general contractor: no buildings, so nothing to add one to --");
  {
    KIND = "general_contractor"; ROLE = "admin"; SCOPE = [];
    const { ctx, page } = await open();
    const h = await readHeader(page);
    t.ck("the header carries a menu", h.isMenu === true, JSON.stringify(h));
    const items = await openMenu(page);
    t.ck("it offers the roster", items.some((x) => /subcontractor|contractor/i.test(x)), JSON.stringify(items));
    t.ck("an invite link", items.some((x) => /invite link/i.test(x)), JSON.stringify(items));
    t.ck("and a job", items.some((x) => /^job$/i.test(x)), JSON.stringify(items));
    // The half that is deliberately absent: a GC has no building list.
    t.ck("and NOT a property", !items.some((x) => /^property$/i.test(x)), JSON.stringify(items));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- an account that keeps buildings can add one --");
  for (const kind of ["property_manager", "portfolio_manager", "building_owner"]) {
    KIND = kind; ROLE = "admin"; SCOPE = [];
    const { ctx, page } = await open();
    const items = await openMenu(page);
    t.ck(`${kind}: Property is offered`, items.some((x) => /^property$/i.test(x)), JSON.stringify(items));
    t.ck(`${kind}: and a job still is`, items.some((x) => /^job$/i.test(x)), JSON.stringify(items));
    t.ck(`${kind}: with the roster and the invite link`,
      items.some((x) => /contractor/i.test(x)) && items.some((x) => /invite link/i.test(x)),
      JSON.stringify(items));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- AND THE DASHBOARD DOES NOT SAY IT TWICE --");
  {
    // A seat narrowed to named buildings runs those buildings, not the firm,
    // so its only Add action is the job — which is exactly the dashboard's own
    // call to action. THIS is the reported state.
    KIND = "property_manager"; ROLE = "pm"; SCOPE = ["prop_1"];
    const { ctx, page } = await open();
    const cta = await dashCta(page);
    t.ck("the dashboard offers New job", cta.some((x) => /new job/i.test(x)), JSON.stringify(cta));
    const h = await readHeader(page);
    // The property under test: not that the header is empty in general, but
    // that this ONE screen does not carry the same button twice.
    t.ck("and the header does not repeat it", h.label === null, JSON.stringify(h));
    const all = await page.evaluate(() => [...document.querySelectorAll("button")]
      .map((b) => (b.innerText || "").replace(/\s+/g, " ").trim())
      .filter((x) => /^(\+ )?New job$/i.test(x)));
    t.ck("so New job appears exactly once on the page", all.length === 1, JSON.stringify(all));

    // And it is only dropped HERE. On every other screen the header button is
    // the only way in, so removing it outright would take the action away.
    await page.evaluate(() => [...document.querySelectorAll("nav button")]
      .find((b) => /^jobs/i.test((b.innerText || "").trim()))?.click());
    await wait(1200);
    const onJobs = await readHeader(page);
    t.ck("the Jobs screen still offers it", /new job/i.test(onJobs.label || ""), JSON.stringify(onJobs));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- a seat with a real menu keeps it on the dashboard --");
  {
    // `Add` over four items is not a duplicate of anything, so the fix must
    // not take the menu away from the account that has one.
    KIND = "property_manager"; ROLE = "admin"; SCOPE = [];
    const { ctx, page } = await open();
    const h = await readHeader(page);
    t.ck("the menu is still there", h.isMenu === true, JSON.stringify(h));
    const cta = await dashCta(page);
    t.ck("beside the dashboard's own CTA", cta.some((x) => /new job/i.test(x)), JSON.stringify(cta));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- nothing threw --");
  {
    KIND = "property_manager"; ROLE = "admin"; SCOPE = [];
    const { ctx, page } = await open();
    t.ck("no \\uXXXX escape reached the page",
      !/\\u[0-9a-fA-F]{4}/.test(await page.evaluate(() => document.body.innerText)));
    await ctx.close().catch(() => {});
  }
} finally {
  await browser.close().catch(() => {});
  web.close(); api.close();
}

t.done();
