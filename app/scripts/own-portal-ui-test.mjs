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
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-ownportal-test");
const WEB = 5337, API = 9035;
const t = tally();

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

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/my-company") {
    return KIND === "subcontractor" || KIND === "general_contractor"
      ? [200, MY_COMPANY] : [409, { error: "not_hireable" }];
  }
  if (path === "/api/my-work") return [200, NO_WORK ? { work: [] } : MY_WORK()];
  if (path === "/api/account-users") return [200, [
    { id: "u_juan", name: "Juan Soto", email: "juan@pacific.test", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/jobs" || path === "/api/subs" || path === "/api/properties"
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
  t.ck("My Jobs is in the nav", items.some((x) => /^My Jobs/.test(x)), JSON.stringify(items));
  // The calendar is a view inside My Jobs now, not an entry of its own.
  t.ck("and no separate My calendar", !items.some((x) => /^My calendar/.test(x)), JSON.stringify(items));

  console.log("\n-- and pressing it lands on the work, not back on the dashboard --");
  await open(page, "My Jobs");
  const jobsPane = await page.evaluate(() => ({
    onNav: (document.querySelector("nav button.on")?.innerText || "").trim(),
    text: (document.querySelector(".ss-main")?.innerText || "").replace(/\s+/g, " ").slice(0, 600),
  }));
  // THE DEAD END BEING REPLACED: the entry existed nowhere, and anything that
  // pointed at the pane fell through to the dashboard.
  t.ck("My Jobs is the selected tab", /^My Jobs/.test(jobsPane.onNav), jobsPane.onNav);
  t.ck("and it did not fall back to the account dashboard",
    !/Properties under management|Unassigned trade slots/.test(jobsPane.text),
    jobsPane.text.slice(0, 160));
  // The work itself -- given to them by somebody else, which is the only kind
  // a subcontractor account has.
  t.ck("the job they were given is on it",
    /leaking sink/i.test(jobsPane.text), jobsPane.text.slice(0, 300));
  t.ck("and it names who it is for",
    /Sound Property Management/i.test(jobsPane.text), jobsPane.text.slice(0, 300));
  // AND NOT FOR THEMSELVES. The one-client line read `brand.name`, which on
  // their OWN account is their own name -- "Working for Pacific apartment
  // maintenance", said to Pacific.
  t.ck("and does not say they work for themselves",
    !/(Working|Subcontracting|Contracting) for Pacific/i.test(jobsPane.text),
    (jobsPane.text.match(/\w+ for [A-Z][^·|]{0,40}/) || [""])[0]);

  console.log("\n-- the calendar opens too --");
  await page.evaluate(() => [...document.querySelectorAll(".jobs-view button")].find((b) => /Calendar/.test(b.innerText))?.click());
  await new Promise((r) => setTimeout(r, 900));
  const cal = await page.evaluate(() => ({
    onNav: (document.querySelector("nav button.on")?.innerText || "").trim(),
    grid: !!document.querySelector(".jcal, .mycal"),
  }));
  t.ck("My Jobs stays the selected entry", /^My Jobs/.test(cal.onNav), cal.onNav);
  t.ck("and a month grid is drawn", cal.grid === true, JSON.stringify(cal));

  console.log("\n-- nobody verifies their own paperwork --");
  await open(page, "My Jobs");
  const badge = await page.evaluate(() =>
    (document.querySelector(".ss-main")?.innerText || "")
      .match(/can'?t be assigned[^.]*\./i)?.[0] || "");
  // Four documents are on file and nobody has reviewed them, because there is
  // nobody on the other side to. A count derived from a hiring account's
  // verdict would sit red for ever -- the permanently-amber failure docs.js
  // exists to prevent.
  t.ck("no \"upload your documents\" banner over four already on file",
    badge === "", badge);

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
    await open(px, "My Jobs");
    const mine = await screens(px);
    t.ck(`${kind}: My Jobs still draws the portal`, /^My Jobs/.test(mine.onNav) && mine.mains === 1,
      JSON.stringify(mine));
    await cx.close().catch(() => {});
  }
  KIND = "subcontractor";

  console.log("\n-- NOBODY HAS GIVEN THEM WORK: a GC gets no My Jobs, a subcontractor names no client --");
  // Reported from Outerhome, a general contractor nobody had hired: My Jobs and
  // My calendar in the nav opened onto an empty schedule, an upload banner and
  // "Outerhome -- Working for Outerhome". Both kinds in the same place, because
  // the subcontractor's entries must survive the fix: being hired is the whole
  // reason that kind exists.
  NO_WORK = true;
  for (const kind of ["general_contractor", "subcontractor"]) {
    KIND = kind;
    const { ctx: cx, page: px } = await visitApp(browser, { host: "pacific", webPort: WEB,
      seat: { userId: "u_juan", accountId: "acc_pac" }, viewport: { width: 1340, height: 1800 } });
    await wait(2800);
    const its = await nav(px);
    t.ck(`${kind}: the app rendered`, its.some((x) => /^Dashboard/.test(x)), JSON.stringify(its));
    if (kind === "general_contractor") {
      t.ck("a GC nobody has hired has no My Jobs", !its.some((x) => /^My Jobs/.test(x)), JSON.stringify(its));
      t.ck("and no My calendar", !its.some((x) => /^My calendar/.test(x)), JSON.stringify(its));
    } else {
      t.ck("a subcontractor keeps My Jobs with nothing on it", its.some((x) => /^My Jobs/.test(x)), JSON.stringify(its));
      await open(px, "My Jobs");
      const who = await px.evaluate(() => (document.querySelector(".who-bar")?.innerText || "").replace(/\s+/g, " ").trim());
      t.ck("the bar is drawn", who.length > 0, who);
      t.ck("and does not say they work for themselves", !/for Pacific/i.test(who), who);
      t.ck("it says there are no clients yet", /No clients yet/.test(who), who);
    }
    await cx.close().catch(() => {});
  }
  NO_WORK = false;
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
