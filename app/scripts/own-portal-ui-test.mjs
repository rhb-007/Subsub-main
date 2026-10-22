// A SUBCONTRACTOR ACCOUNT'S OWN TEAM CAN SEE THE WORK THEY HAVE BEEN GIVEN.
//
// Reported as *"on the contractor admin / Sound Property Management My Jobs is
// not visible… Redirects to dashboard instead"*.
//
// `can("portal")` is the `contractor` seat role and nothing else -- a seat
// somebody ELSE invited onto THEIR account. `ROLES.admin` does not have it. So
// the person who signed up as a subcontractor, and who is the admin of their
// own business, could not reach My Jobs, My calendar or any of it. Fifteenth
// instance of a rule already written down here: anything that made an
// account-a-company true has to have a home outside the contractor portal,
// because the seat that runs an account never has one.
//
// THE SERVER WAS ALREADY RIGHT -- `seatCompany` answers the account's own
// company for an admin, so `/api/my-work` has been returning their work the
// whole time. Only the browser's gate was wrong, which is why this is a UI
// suite and why a server one would have passed throughout.
//
// What is pinned:
//
//   THE TWO ENTRIES APPEAR AND THEY WORK. A nav entry that routes to a pane
//   rendering nothing is the dead end being replaced, so the panes are opened
//   and read rather than counted.
//
//   AND NOT FOR AN ACCOUNT NOBODY CAN HIRE. A property manager has no company
//   to be given work as, so the entries must not appear -- asserted in the
//   same place, because a change that showed them to everybody passes every
//   assertion written against the subcontractor alone.
//
//   PRESENCE, NOT APPROVAL. Nobody verifies their own paperwork, so the
//   document count must not sit red for ever over four documents already
//   uploaded -- the permanently-amber failure docs.js exists to prevent.
//
//   node --no-warnings scripts/own-portal-ui-test.mjs

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-ownportal-test");
const WEB = 5337, API = 9035;
const t = tally();

// THE STAFF SESSION'S WAY BACK IS NOT DRAWN TWICE. A staff session cannot be
// driven here (resumeSession refuses one), so this reads the source: the
// "Back to your company" row is skipped wherever the switcher already lists
// that account, and a seat row goes through openSeat, which re-signs staff.
{
  const src = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "../src/App.tsx"), "utf8");
  const backs = src.match(/impersonating\?\.returnTo && impersonating\.returnTo\.id !== account\.id[^(]*\(/g) || [];
  t.ck("both Back rows exist", backs.length === 2, String(backs.length));
  t.ck("and each is skipped when the switcher lists that account",
    backs.length === 2 && backs.every((b) => /menuSeatIds\.has|otherSeats\.some/.test(b)), JSON.stringify(backs));
  t.ck("seat rows go through openSeat, not goToSeat",
    (src.match(/goToSeat\((m|seat)\.accountId\)/g) || []).length === 0);
}

let KIND = "subcontractor";
// Whether anybody has given this account work. Off, the account has a company
// row and nothing on it -- which is every general contractor nobody has hired.
let NO_WORK = false;
const acct = () => ({
  id: "acc_pac", name: "Pacific apartment maintenance", subdomain: "pacific",
  kind: KIND, plan: "basic", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["plumbing"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_juan", name: "Juan Soto", email: "juan@pacific.test", role: "admin" },
});
// Their own company row, which is what `seatCompany` resolves for an admin.
// All four documents on file and NOT reviewed by anybody, because there is
// nobody to review them: an account's own company has no engagement.
const MY_COMPANY = {
  companyId: "cmp_pac", company: "Pacific apartment maintenance", contact: "Juan Soto",
  email: "juan@pacific.test", phone: "2065550111", license: "PACIFAM881QT", ubi: "",
  city: "Seattle", state: "WA", zip: "98122",
  coverage: { mode: "cities", cities: ["Seattle"], radii: [] },
  docs: { insurance: true, bond: true, contract: true, w9: true },
  findable: true, code: "cmp_own_acc_pac", openToHire: true, openAnswered: true,
  url: null, sharesSent: 0,
};
// Work given to them BY SOMEBODY ELSE, which is the whole point: it is at
// another account, so none of it is in this account's own job list.
const MY_WORK = () => ({ work: [{
  woId: "w1", wo: "WO-1", jobId: "job_leak", trade: "plumbing", status: "accepted",
  auto: false, responseWindow: null, respondBy: null, respondedAt: "2026-10-01",
  crewName: null, value: "400", payKind: "fixed", rate: "", capHours: null,
  tradeScope: null, signedWO: null, here: false,
  accountId: "acc_pm", accountName: "Sound Property Management", accountKind: "property_manager",
  title: "Press Apartments - leaking sink", address: "1620 Belmont Ave", area: "Seattle",
  zip: "98122", date: "2026-10-09", status_job: "active", severity: null,
  access: "manager",
  visit: { id: "v1", jobId: "job_leak", status: "confirmed", date: "2026-10-09",
    startTime: "09:00", endTime: "11:00", respondedAt: null, contractorAt: "2026-10-02",
    contractorNote: null, tenantNote: null, note: "" },
} ] });

// THE CLIENT'S SIDE. Juan holds a contractor seat on Sound's account, made
// when Pacific accepted Sound's request to connect, so the link above My
// account has somewhere to land. Answered per account, off X-Account-Id,
// because a stub that answers Pacific whatever is asked cannot see the
// switch land.
let SEAT = true;
const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "basic", billing: "monthly", useDefaultMark: true, theme: null,
  trades: [], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_juan", name: "Juan Soto", email: "juan@pacific.test", role: "contractor" },
};
const PM_SUB = {
  id: "cmp_pac", companyId: "cmp_pac", engagementId: "en_pac", accountId: "acc_pm",
  company: "Pacific apartment maintenance", contact: "Juan Soto", email: "juan@pacific.test",
  phone: null, categories: ["plumbing"], caps: [], crews: [], propertyIds: [], zips: [],
  notify: {}, rating: null, bond: true, insurance: true, contract: true, w9: true,
  hasPortal: true, answersForItself: true, license: "PACIFAM881QT", licenseCheck: null,
  available: true, unavailableDays: [], docReview: {}, coverage: {}, autoSchedule: false,
};
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body, headers) => {
  const away = String(headers["x-account-id"] || "") === "acc_pm";
  if (path === "/api/auth/me") return [200, { user: { id: "u_juan", name: "Juan Soto", email: "juan@pacific.test" },
    memberships: [
      { accountId: "acc_pac", accountName: "Pacific apartment maintenance", subdomain: "pacific",
        kind: KIND, role: "admin", companyId: null, plan: "basic", billing: "monthly", theme: null,
        trades: ["plumbing"], logoKey: null, useDefaultMark: true },
      ...(SEAT ? [{ accountId: "acc_pm", accountName: "Sound Property Management", subdomain: "soundpm",
        kind: "property_manager", role: "contractor", companyId: "cmp_pac", plan: "basic",
        billing: "monthly", theme: null, trades: [], logoKey: null, useDefaultMark: true }] : []),
    ] }];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, away ? PM : acct()];
  if (path === "/api/subs") return [200, away ? [PM_SUB] : []];
  if (path === "/api/my-company") {
    if (away) return [409, { error: "not_hireable" }];
    return KIND === "subcontractor" || KIND === "general_contractor"
      ? [200, MY_COMPANY] : [409, { error: "not_hireable" }];
  }
  if (path === "/api/my-work") {
    if (NO_WORK) return [200, { work: [] }];
    // Over there, the same work is THIS account's.
    return [200, away ? { work: MY_WORK().work.map((w) => ({ ...w, here: true })) } : MY_WORK()];
  }
  if (path === "/api/account-users") return [200, [
    { id: "u_juan", name: "Juan Soto", email: "juan@pacific.test", phone: null,
      role: away ? "contractor" : "admin", subId: away ? "cmp_pac" : null, propertyIds: [], unit: null,
      hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/jobs" || path === "/api/properties"
    || path === "/api/invites" || path === "/api/clients" || path === "/api/visits"
    || path === "/api/my-connect-requests" || path === "/api/connect-requests"
    || path === "/api/property-transfers" || path === "/api/my-quotes"
    || path === "/api/doc-shares" || path === "/api/inspections"
    || path === "/api/change-orders") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const nav = (page) => page.evaluate(() =>
  [...document.querySelectorAll("nav button")].map((b) => b.innerText.replace(/\s+/g, " ").trim()));
const open = async (page, label) => {
  await page.evaluate((l) => [...document.querySelectorAll("nav button")]
    .find((b) => b.innerText.trim().toUpperCase().startsWith(l.toUpperCase()))?.click(), label);
  await wait(1200);
};

try {
  console.log("\n-- the owner of a subcontractor account --");
  const { ctx, page, crashes } = await visitApp(browser, { host: "pacific", webPort: WEB,
    seat: { userId: "u_juan", accountId: "acc_pac" }, viewport: { width: 1340, height: 1800 } });
  const logs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/i.test(m.text())) logs.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => logs.push("THROW " + String(e).slice(0, 200)));

  await wait(2800);

  const items = await nav(page);
  t.ck("the app rendered at all", items.length > 0, JSON.stringify(items));
  // TWO DASHBOARDS IN ONE, reported from Cascade: My Jobs in this account's
  // own nav, beside Jobs, drew a client's side of the work inside it. It is
  // gone. Get your GCs came off with it and went back at the owner's word: a
  // subcontractor refers GCs from its own account.
  t.ck("no My Jobs in the account's own nav", !items.some((x) => /^My Jobs/.test(x)), JSON.stringify(items));
  t.ck("Get your GCs is on it", items.some((x) => /^Get your GCs on SubSub/.test(x)), JSON.stringify(items));
  t.ck("and no separate My calendar", !items.some((x) => /^My calendar/.test(x)), JSON.stringify(items));

  console.log("\n-- the client's dashboard is a link below My account --");
  const drawer = await page.evaluate(() => [...document.querySelectorAll(".drawer-actions > button, .drawer-actions > p")]
    .map((b) => ({ t: b.innerText.replace(/\s+/g, " ").trim(), client: b.classList.contains("client-dash") })));
  const ci = drawer.findIndex((r) => r.client && /Sound Property Management/.test(r.t));
  const ai = drawer.findIndex((r) => /^My account/.test(r.t));
  t.ck("the drawer links to Sound's side", ci >= 0, JSON.stringify(drawer));
  t.ck("below My account", ci >= 0 && ai >= 0 && ai < ci, JSON.stringify(drawer));
  // Not twice: the switcher row for the same seat is the same door.
  t.ck("and Sound is not listed a second time as a switcher row",
    drawer.filter((r) => /Sound Property Management/.test(r.t)).length === 1, JSON.stringify(drawer));
  await page.click(".user-btn");
  await wait(400);
  const menu = await page.evaluate(() => [...document.querySelectorAll(".user-menu > button")]
    .map((b) => ({ t: b.innerText.replace(/\s+/g, " ").trim(), client: b.classList.contains("um-client") })));
  const mi = menu.findIndex((r) => r.client && /Sound Property Management/.test(r.t));
  const mai = menu.findIndex((r) => /^My account/.test(r.t));
  t.ck("and the profile menu does too, below My account",
    mi >= 0 && mai >= 0 && mai < mi, JSON.stringify(menu));
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector(".add-scrim")?.click());
  await wait(300);
  const dashLink = await page.evaluate(() => [...document.querySelectorAll(".sec-cw .dash-more")]
    .map((b) => b.innerText.trim()));
  t.ck("the dashboard's client panel opens Sound's side, not My Jobs",
    dashLink.some((x) => /Open Sound Property Management's dashboard/.test(x))
      && !dashLink.some((x) => /My Jobs/.test(x)), JSON.stringify(dashLink));

  console.log("\n-- pressing it lands on Sound's side, under Sound's name --");
  await page.evaluate(() => document.querySelector(".drawer-actions .client-dash")?.click());
  await wait(2500);
  const there = await page.evaluate(() => ({
    brand: (document.querySelector(".header-top .brand-name")?.innerText || "").trim(),
    nav: [...document.querySelectorAll("nav button")].map((b) => b.innerText.replace(/\s+/g, " ").trim()),
    onNav: (document.querySelector("nav button.on")?.innerText || "").trim(),
    text: (document.querySelector(".ss-main")?.innerText || "").replace(/\s+/g, " ").slice(0, 4000),
    who: (document.querySelector(".who-bar")?.innerText || "").replace(/\s+/g, " ").trim(),
  }));
  t.ck("the top of the page says Sound Property Management", there.brand === "Sound Property Management",
    JSON.stringify(there.brand));
  t.ck("My Jobs is there, on their side", there.nav.some((x) => /^My Jobs/.test(x)), JSON.stringify(there.nav));
  t.ck("and Get your GCs is there too", there.nav.some((x) => /Get your GCs/.test(x)), JSON.stringify(there.nav));
  t.ck("it opens on My Jobs, working for Sound", /^My Jobs/.test(there.onNav) && /Sound Property Management/.test(there.who),
    JSON.stringify({ on: there.onNav, who: there.who }));
  const back = await page.evaluate(() => [...document.querySelectorAll(".drawer-actions button")]
    .map((b) => b.innerText.replace(/\s+/g, " ").trim()));
  t.ck("and the way back to Pacific is in the drawer", back.some((x) => /Pacific apartment maintenance/.test(x)),
    JSON.stringify(back));

  t.ck("the page's own console is clean", logs.length === 0, logs.join(" | "));
  t.ck("and the harness saw no crash", crashes.length === 0, crashes.join(" | "));
  await ctx.close().catch(() => {});

  console.log("\n-- ONE DASHBOARD PER SCREEN, on both hireable kinds --");
  // Reported from Outerhome, a general contractor: the Contractors roster had
  // a whole second dashboard under it -- an upload banner, a greeting, a
  // "Working for Outerhome" bar and a second schedule. The portal was drawn
  // under EVERY screen for an account's own admin, because the gate read
  // `ownSub` beside `can("portal")`. Counted as <main> elements and greetings
  // rather than looked for by text, because the duplicate is the whole fault
  // and a text search finds the first copy whether or not there is a second.
  // Both kinds in the same place: the report was a GC and the code path is the
  // same for a subcontractor.
  const screens = async (page) => page.evaluate(() => ({
    mains: document.querySelectorAll("main.ss-main").length,
    greetings: [...document.querySelectorAll("main.ss-main h2")]
      .filter((h) => /^Good (morning|afternoon|evening)/.test(h.innerText.trim())).length,
    whoBar: document.querySelectorAll(".who-bar").length,
    onNav: (document.querySelector("nav button.on")?.innerText || "").trim(),
  }));
  for (const kind of ["general_contractor", "subcontractor"]) {
    KIND = kind;
    const { ctx: cx, page: px } = await visitApp(browser, { host: "pacific", webPort: WEB,
      seat: { userId: "u_juan", accountId: "acc_pac" }, viewport: { width: 1340, height: 1800 } });
    await wait(2800);
    const dash = await screens(px);
    t.ck(`${kind}: the dashboard rendered`, /^Dashboard/.test(dash.onNav) && dash.mains >= 1, JSON.stringify(dash));
    t.ck(`${kind}: one screen on the dashboard, not two`, dash.mains === 1, JSON.stringify(dash));
    t.ck(`${kind}: one greeting on it`, dash.greetings <= 1, JSON.stringify(dash));
    t.ck(`${kind}: no portal who-bar under the dashboard`, dash.whoBar === 0, JSON.stringify(dash));
    await open(px, "Subcontractors");
    const roster = await screens(px);
    t.ck(`${kind}: the roster screen opened`, /contractors/i.test(roster.onNav), JSON.stringify(roster));
    t.ck(`${kind}: one screen under the roster, not a dashboard below it`,
      roster.mains === 1 && roster.whoBar === 0 && roster.greetings === 0, JSON.stringify(roster));
    t.ck(`${kind}: no My Jobs in the account's own nav`, !(await nav(px)).some((x) => /^My Jobs/.test(x)));
    await cx.close().catch(() => {});
  }
  KIND = "subcontractor";

  console.log("\n-- NOBODY HAS GIVEN THEM WORK: a GC gets no My Jobs, a subcontractor names no client --");
  // Reported from Outerhome, a general contractor nobody had hired: My Jobs and
  // My calendar in the nav opened onto an empty schedule, an upload banner and
  // "Outerhome -- Working for Outerhome". Both kinds in the same place, because
  // the subcontractor's entries must survive the fix: being hired is the whole
  // reason that kind exists.
  NO_WORK = true; SEAT = false;
  for (const kind of ["general_contractor", "subcontractor"]) {
    KIND = kind;
    const { ctx: cx, page: px } = await visitApp(browser, { host: "pacific", webPort: WEB,
      seat: { userId: "u_juan", accountId: "acc_pac" }, viewport: { width: 1340, height: 1800 } });
    await wait(2800);
    const its = await nav(px);
    t.ck(`${kind}: the app rendered`, its.some((x) => /^Dashboard/.test(x)), JSON.stringify(its));
    t.ck(`${kind}: no My Jobs`, !its.some((x) => /^My Jobs/.test(x)), JSON.stringify(its));
    t.ck(`${kind}: and no My calendar`, !its.some((x) => /^My calendar/.test(x)), JSON.stringify(its));
    // Get your GCs is the subcontractor's, with or without work; a GC refers
    // from Account -> Refer a GC instead.
    t.ck(`${kind}: Get your GCs ${kind === "subcontractor" ? "is" : "is not"} in the nav`,
      its.some((x) => /^Get your GCs/.test(x)) === (kind === "subcontractor"), JSON.stringify(its));
    // No seat anywhere and no work: there is no client to link to, so none is
    // drawn rather than a link onto a refusal.
    const dl = await px.evaluate(() => document.querySelectorAll(".drawer-actions .client-dash").length);
    t.ck(`${kind}: and no client link with nobody to link to`, dl === 0, String(dl));
    await cx.close().catch(() => {});
  }
  NO_WORK = false; SEAT = true;
  KIND = "subcontractor";

  console.log("\n-- and an account nobody can hire gets neither --");
  {
    // ASSERTED IN THE SAME PLACE. A change that showed these to everybody
    // passes every assertion above on its own -- the diagonal coverage that
    // left `hiresLabel` half-wired.
    KIND = "property_manager";
    const { ctx: c2, page: p2 } = await visitApp(browser, { host: "pacific", webPort: WEB,
      seat: { userId: "u_juan", accountId: "acc_pac" }, viewport: { width: 1340, height: 1800 } });
    await wait(2800);
    const items2 = await nav(p2);
    t.ck("the app rendered for them too", items2.length > 0, JSON.stringify(items2));
    t.ck("no My Jobs", !items2.some((x) => /^My Jobs/.test(x)), JSON.stringify(items2));
    // SAID RATHER THAN PINNED: the account-kind half of that guard is defence
    // in depth and no fixture the product can produce tells it from the
    // company half. `/api/my-company` answers `not_hireable` for a kind that
    // cannot be hired, so `myCompany` is null and `ownSub` is null whether or
    // not `isHireable` is also asked -- a mutation deleting it survives, and
    // it survives for the right reason. It stays because it fails closed the
    // day that route starts answering for a kind it should not.
    t.ck("no My calendar", !items2.some((x) => /^My calendar/.test(x)), JSON.stringify(items2));
    await c2.close().catch(() => {});
    KIND = "subcontractor";
  }
} finally {
  await browser.close().catch(() => {});
  web.close(); api.close();
}

t.done();
