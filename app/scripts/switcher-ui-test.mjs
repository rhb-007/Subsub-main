// The switcher on the screen, at two seats and at twenty-five.
//
// The assertions that matter:
//
//   IT SURVIVES A REFRESH. Signing in loads every seat; resuming a session
//   loaded only the one being entered, so the switcher was right immediately
//   after sign-in and gone after a reload. A way out of an account that exists
//   until you reload the page is not a way out.
//
//   THE THRESHOLD HOLDS BOTH WAYS. Two seats keep the flat list with the
//   relationship under each name. Twenty-five collapse to one entry and a
//   panel, so Sign out is still reachable.
//
//   NO SEAT IS UNREACHABLE. Twenty-five in, twenty-five out, grouped.
//
//   node scripts/switcher-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-switcher-test");
const WEB = 5235, API = 8947;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const HOME = {
  id: "acc_home", name: "Bay Roofing", subdomain: "bayroofing", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "u_bay", name: "Rae Bay", email: "rae@bayroofing.test", role: "contractor" },
};
const SUB = {
  id: "cmp_bay", company: "Bay Roofing", engagementId: "en_home", accountId: "acc_home",
  contact: "Rae Bay", email: "rae@bayroofing.test", phone: null, categories: ["roofing"],
  caps: [], crews: [], propertyIds: [], zips: [], notify: {}, rating: null,
  bond: true, insurance: true, contract: true, w9: true, hasPortal: true,
  license: "BAYRR001QZ", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {}, autoSchedule: false,
};

const seat = (n, role, name, subdomain, kind = "general_contractor") => ({
  accountId: `acc_${n}`, accountName: name, subdomain, role, kind,
  plan: "basic", billing: "monthly", theme: null, trades: [], logoKey: null,
  useDefaultMark: true, companyId: role === "contractor" ? "cmp_bay" : null,
});

// The seat we are standing in, plus however many others.
const HOME_SEAT = { ...seat("home", "contractor", "Bay Roofing", "bayroofing"),
  accountId: "acc_home" };

const CLIENTS = [
  seat("alder", "contractor", "Alder Construction", "alder"),
  seat("birch", "contractor", "Birch Builders", "birch"),
];
const MANY = [
  ...CLIENTS,
  ...Array.from({ length: 20 }, (_, i) =>
    seat(`gc${i}`, "contractor", `Contractor ${String(i + 1).padStart(2, "0")} Ltd`, `gc${i}`)),
  seat("own", "admin", "Bay Roofing Holdings", "bayholdings"),
  seat("mgr", "tenant", "Fairview Lettings", "fairview", "property_manager"),
  seat("pmx", "owner", "Sound Property", "soundprop", "property_manager"),
];

let SEATS = CLIENTS;
// Two requests waiting at one client, one at another, so the ordering has
// something to order by.
let MY_WORK = { work: [
  { woId: "w1", wo: "WO-1", jobId: "j1", trade: "roofing", accountId: "acc_birch",
    accountName: "Birch Builders", accountSubdomain: "birch", here: false,
    status: "pending", auto: false, respondBy: null, title: "Gutter run",
    address: "40 Elm Ave", date: "2026-10-09", jobStatus: "active", value: "1200" },
  { woId: "w2", wo: "WO-2", jobId: "j2", trade: "roofing", accountId: "acc_birch",
    accountName: "Birch Builders", accountSubdomain: "birch", here: false,
    status: "pending", auto: false, respondBy: null, title: "Ridge cap",
    address: "9 Oak Row", date: "2026-10-11", jobStatus: "active", value: "900" },
  { woId: "w3", wo: "WO-3", jobId: "j3", trade: "roofing", accountId: "acc_alder",
    accountName: "Alder Construction", accountSubdomain: "alder", here: false,
    status: "pending", auto: false, respondBy: null, title: "Flat roof patch",
    address: "3 Fir Close", date: "2026-10-14", jobStatus: "active", value: "880" },
] };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  // Every seat this person holds. resumeSession() reads this now; before the
  // fix it never did, and the switcher was empty after any reload.
  if (path === "/api/auth/me") return [200, {
    user: HOME.user,
    memberships: [HOME_SEAT, ...SEATS],
  }];
  if (path === "/api/account-users") return [200, [
    { id: "u_bay", name: "Rae Bay", email: "rae@bayroofing.test", phone: null,
      role: "contractor", subId: "cmp_bay", propertyIds: [], unit: null,
      hasLogin: true, inviteSentAt: null, hasAvatar: false },
  ]];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, HOME];
  if (path === "/api/account") return [200, HOME];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/my-work") return [200, MY_WORK];
  if (path === "/api/jobs" || path === "/api/properties" || path === "/api/invites"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/doc-shares" || path === "/api/clients"
    || path === "/api/property-transfers") return [200, []];
  return undefined;
} });

const browser = await launch();
const drawer = (page) => page.evaluate(() => {
  const els = [...document.querySelectorAll(".drawer-actions button")];
  return els.map((b) => b.innerText.replace(/\s+/g, " ").trim());
});

try {
  console.log("\n-- a couple of seats: the flat list, unchanged --");
  {
    SEATS = CLIENTS;
    const { ctx, page, crashes } = await visitApp(browser, { host: "bayroofing", webPort: WEB,
      seat: { userId: "u_bay", accountId: "acc_home" }, viewport: { width: 1200, height: 1500 } });
    await wait(3000);

    const rows = await drawer(page);
    t.ck("both other seats are listed flat",
      rows.filter((r) => /Alder Construction|Birch Builders/.test(r)).length === 2,
      JSON.stringify(rows));
    t.ck("with the relationship under the name",
      rows.some((r) => /you are their subcontractor/.test(r)), JSON.stringify(rows));
    t.ck("no panel entry at this size",
      !rows.some((r) => /^Switch account/.test(r)), JSON.stringify(rows));
    t.ck("and Sign out is still there", rows.some((r) => /Sign out/.test(r)));
    // The whole point of ordering: Birch has two waiting, Alder one.
    const iB = rows.findIndex((r) => /Birch Builders/.test(r));
    const iA = rows.findIndex((r) => /Alder Construction/.test(r));
    t.ck("the one with more waiting on you comes first", iB < iA, `Birch ${iB}, Alder ${iA}`);
    const badges = await page.evaluate(() => Object.fromEntries(
      [...document.querySelectorAll(".drawer-actions .switch-acct")].map((b) => [
        b.querySelector(".sw-name")?.innerText.trim(),
        b.querySelector(".count")?.innerText.trim() || null])));
    t.ck("and each says how many",
      badges["Birch Builders"] === "2" && badges["Alder Construction"] === "1",
      JSON.stringify(badges));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- twenty-five seats: one entry and a panel --");
  {
    SEATS = MANY;
    const { ctx, page, crashes } = await visitApp(browser, { host: "bayroofing", webPort: WEB,
      seat: { userId: "u_bay", accountId: "acc_home" }, viewport: { width: 1200, height: 1500 } });
    await wait(3200);

    const rows = await drawer(page);
    t.ck("the drawer does not list them all", rows.length < 8, `${rows.length}: ${JSON.stringify(rows).slice(0, 140)}`);
    t.ck("one entry stands in for the lot",
      rows.some((r) => /^Switch account/.test(r)), JSON.stringify(rows));
    t.ck("and says how many there are",
      rows.some((r) => /25 others you hold a seat in/.test(r)), JSON.stringify(rows));
    t.ck("Sign out has not been pushed off the list", rows.some((r) => /Sign out/.test(r)));
    const manyBadge = await page.evaluate(() =>
      document.querySelector(".drawer-actions .switch-many .count")?.innerText.trim() || null);
    t.ck("with everything waiting on you counted on it", manyBadge === "3", String(manyBadge));

    await page.evaluate(() => [...document.querySelectorAll(".drawer-actions button")]
      .find((b) => /^Switch account/.test(b.innerText))?.click());
    await wait(700);

    const panel = await page.evaluate(() => {
      const el = document.querySelector(".seat-pick");
      if (!el) return null;
      return {
        heads: [...el.querySelectorAll(".seat-head")].map((h) => h.innerText.replace(/\s+/g, " ").trim()),
        names: [...el.querySelectorAll(".seat-name")].map((n) => n.innerText.trim()),
        waits: [...el.querySelectorAll(".seat-wait")].map((n) => n.innerText.trim()),
        hasSearch: !!el.querySelector(".seat-search"),
        text: el.innerText.replace(/\s+/g, " ").trim(),
      };
    });
    t.ck("the panel opens", !!panel, String(panel));
    t.ck("every seat is reachable", panel.names.length === 25, String(panel.names.length));
    t.ck("no seat appears twice", new Set(panel.names).size === 25, String(new Set(panel.names).size));
    t.ck("the one we are standing in is not among them",
      !panel.names.includes("Bay Roofing"), JSON.stringify(panel.names.slice(0, 3)));

    // The heading carries what the rows were repeating.
    t.ck("grouped by relationship", panel.heads.length === 3, JSON.stringify(panel.heads));
    t.ck("clients first", /companies that hire you/i.test(panel.heads[0]), panel.heads[0]);
    t.ck("then accounts you work in", /accounts you work in/i.test(panel.heads[1]), panel.heads[1]);
    t.ck("then the ones managed for you", /managed for you/i.test(panel.heads[2]), panel.heads[2]);
    t.ck("and the rows stop repeating it",
      !/you are their subcontractor/.test(panel.text), panel.text.slice(0, 160));

    t.ck("ordered by what is waiting on you", panel.names[0] === "Birch Builders",
      JSON.stringify(panel.names.slice(0, 3)));
    t.ck("and it says so on the row", panel.waits[0] === "2 waiting on you", panel.waits[0]);
    t.ck("only the accounts that have something waiting say anything",
      panel.waits.length === 2, JSON.stringify(panel.waits));

    // Searching, over their own memberships only.
    t.ck("there is a search box", panel.hasSearch);
    await page.evaluate(() => {
      const el = document.querySelector(".seat-search");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, "fairview");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(500);
    const found = await page.evaluate(() =>
      [...document.querySelectorAll(".seat-name")].map((n) => n.innerText.trim()));
    t.ck("the subdomain finds it", found.length === 1 && found[0] === "Fairview Lettings",
      JSON.stringify(found));

    await page.evaluate(() => {
      const el = document.querySelector(".seat-search");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, "nobody here");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(500);
    t.ck("no match says so rather than going blank",
      await page.evaluate(() => !!document.querySelector(".seat-none")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and it is still there after a reload --");
  {
    SEATS = CLIENTS;
    const { ctx, page, crashes } = await visitApp(browser, { host: "bayroofing", webPort: WEB,
      seat: { userId: "u_bay", accountId: "acc_home" }, viewport: { width: 1200, height: 1500 } });
    await wait(3000);
    const before = await drawer(page);
    t.ck("the seats are there to begin with",
      before.filter((r) => /Alder|Birch/.test(r)).length === 2, JSON.stringify(before));

    // This is the bug: signing in loaded every seat and resuming did not, so a
    // refresh emptied the switcher.
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(3200);
    const after = await drawer(page);
    t.ck("and still there after a refresh",
      after.filter((r) => /Alder|Birch/.test(r)).length === 2, JSON.stringify(after));
    t.ck("with the relationship intact",
      after.some((r) => /you are their subcontractor/.test(r)), JSON.stringify(after));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
