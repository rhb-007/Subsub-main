// A SUBCONTRACTOR ACCOUNT'S OWN TEAM SETS ITS CREWS AND DAYS OFF, in a browser.
//
// Reported as "if I'm a contractor or sub contractor, where do I adjust my
// availability -- I can't find the calendars". The contractor seat sets it
// under Job Settings; the business owner, signed in as the admin of their own
// subcontractor account, had My Jobs and My calendar and nowhere at all to
// block a day.
//
// What is pinned:
//
//   MY AVAILABILITY AND MY CREWS ARE IN THE NAV AND THEY OPEN. A nav entry
//   that routes to nothing is the dead end being replaced.
//
//   A TAPPED DAY GOES TO PATCH /api/my-company, never to /api/subs/:id --
//   the account's own row has its own route, and the roster's would refuse.
//   The body is read, because a day drawn as off over a write that posted the
//   wrong thing is a crew booked on a day they believe they blocked.
//
//   A REFUSAL PUTS THE DAY BACK AND SAYS SO.
//
//   NOT FOR AN ACCOUNT NOBODY CAN HIRE, asserted in the same place.
//
//   node --no-warnings scripts/own-crews-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-owncrews-test");
const WEB = 5451, API = 9151;
const t = tally();

let KIND = "subcontractor";
let CREWS = [];
let REFUSE = false;
const patches = [];
const subPatches = [];

const acct = () => ({
  id: "acc_cas", name: "Cascade Apartment Services", subdomain: "cascade",
  kind: KIND, plan: "basic", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["plumbing"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_rb", name: "R Braun", email: "rb@cascade.test", role: "admin" },
});
const company = () => ({
  companyId: "cmp_cas", company: "Cascade Apartment Services", contact: "R Braun",
  email: "rb@cascade.test", phone: "2065550199", license: "CASCAAS900T1", ubi: "",
  city: "Tacoma", state: "WA", zip: "98407",
  coverage: { mode: "cities", cities: ["Tacoma"], radii: [] },
  docs: { insurance: true, bond: true, contract: true, w9: true },
  findable: true, code: "cmp_own_acc_cas", openToHire: true, openAnswered: true,
  url: null, sharesSent: 0, crews: CREWS,
});

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/my-company" && method === "PATCH") {
    patches.push(body);
    if (REFUSE) return [400, { error: "invalid_crews" }];
    CREWS = body.crews;
    return [200, { ok: true, ...company() }];
  }
  if (path === "/api/my-company") {
    return KIND === "subcontractor" ? [200, company()] : [409, { error: "not_hireable" }];
  }
  if (path.startsWith("/api/subs/") && method === "PATCH") { subPatches.push(path); return [200, {}]; }
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/account-users") return [200, [
    { id: "u_rb", name: "R Braun", email: "rb@cascade.test", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false }]];
  if (["/api/jobs", "/api/subs", "/api/properties", "/api/invites", "/api/clients", "/api/visits",
    "/api/my-connect-requests", "/api/connect-requests", "/api/property-transfers", "/api/my-quotes",
    "/api/doc-shares", "/api/inspections", "/api/change-orders"].includes(path)) return [200, []];
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
  await wait(1000);
};
const main = (page) => page.evaluate(() => (document.querySelector(".ss-main")?.innerText || "").replace(/\s+/g, " "));
const setVal = (page, sel, i, v) => page.evaluate(({ sel, i, v }) => {
  const el = document.querySelectorAll(sel)[i];
  if (!el) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, { sel, i, v });

try {
  console.log("\n-- the owner of a subcontractor account, with no crews yet --");
  const { ctx, page, crashes } = await visitApp(browser, { host: "cascade", webPort: WEB,
    seat: { userId: "u_rb", accountId: "acc_cas" }, viewport: { width: 1340, height: 1800 } });
  const logs = [];
  page.on("pageerror", (e) => logs.push("THROW " + String(e).slice(0, 200)));
  await wait(2800);

  const items = await nav(page);
  t.ck("the app rendered", items.length > 0, JSON.stringify(items));
  // ONE ENTRY FOR THE WORK. My calendar, My availability and My Crews were
  // three more nav items for one question, reported as too many.
  t.ck("My Jobs is in the nav", items.some((x) => /^My Jobs/.test(x)), JSON.stringify(items));
  t.ck("and My calendar, My availability and My Crews are not",
    !items.some((x) => /^My calendar|^My availability|^My Crews/.test(x)), JSON.stringify(items));

  await open(page, "My Jobs");
  const tabs = await page.evaluate(() => [...document.querySelectorAll(".jobs-view button")].map((b) => b.innerText.trim()));
  t.ck("My Jobs carries a Jobs and a Calendar view", tabs.length === 2 && /^Jobs/.test(tabs[0]) && /^Calendar/.test(tabs[1]),
    JSON.stringify(tabs));
  await page.evaluate(() => [...document.querySelectorAll(".jobs-view button")].find((b) => /Calendar/.test(b.innerText))?.click());
  await wait(800);
  let txt = await main(page);
  t.ck("the calendar opens under My Jobs", /Your jobs and your crews' days off/.test(txt) && !!(await page.$(".jcal-grid")),
    txt.slice(0, 200));
  t.ck("and My Jobs stays the selected nav entry", /^My Jobs/.test(await page.evaluate(() =>
    (document.querySelector("nav button.on")?.innerText || "").trim())));
  // NO CREWS IS A WAY IN, not a sentence pointing somewhere else.
  const goBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".mcal-crews button")].find((x) => /Add a crew/.test(x.innerText));
    b?.click();
    return !!b;
  });
  t.ck("with no crews it offers to add one", goBtn);
  await wait(900);
  txt = await main(page);
  // CREWS SIT WITH THE SUBCONTRACTORS, because both are the labour.
  const netTabs = await page.evaluate(() => [...document.querySelectorAll(".net-view button")]
    .map((b) => ({ t: b.innerText.trim(), on: b.classList.contains("on") })));
  t.ck("that lands on the roster page's My crews tab",
    netTabs.length === 2 && /^Subcontractors/.test(netTabs[0].t) && /^My crews/.test(netTabs[1].t) && netTabs[1].on,
    JSON.stringify(netTabs));
  t.ck("with the crew editor on it", /Save crews/.test(txt), txt.slice(0, 200));

  console.log("\n-- naming a crew and saving it --");
  await setVal(page, ".crew-name-input", 0, "Day crew");
  await setVal(page, ".member-row input", 0, "Rob");
  await page.evaluate(() => [...document.querySelectorAll(".ss-main button")]
    .find((x) => /Save crews/.test(x.innerText))?.click());
  await wait(1000);
  const p0 = patches.at(-1);
  t.ck("saving goes to the account's own company", patches.length === 1 && Array.isArray(p0?.crews),
    JSON.stringify(patches));
  t.ck("with the crew that was typed", p0?.crews?.[0]?.name === "Day crew" && p0.crews[0].members?.[0]?.name === "Rob",
    JSON.stringify(p0));
  t.ck("and never through the roster's route", subPatches.length === 0, JSON.stringify(subPatches));
  t.ck("and it says Saved over a write that happened", /Saved/.test(await main(page)));

  // The nav entry lands on the roster, not on whichever tab was open last.
  await open(page, "Subcontractors");
  const back = await page.evaluate(() => [...document.querySelectorAll(".net-view button")]
    .map((b) => b.classList.contains("on")));
  t.ck("the Subcontractors entry opens on the roster half", back[0] === true && back[1] === false, JSON.stringify(back));

  console.log("\n-- marking a day off on the calendar --");
  await open(page, "My Jobs");
  await page.evaluate(() => [...document.querySelectorAll(".jobs-view button")].find((b) => /Calendar/.test(b.innerText))?.click());
  await wait(800);
  const chip = await page.evaluate(() => document.querySelector(".mcal-crew")?.innerText.replace(/\s+/g, " ").trim() || "");
  t.ck("the crew is named above the month, taking work", /Day crew/.test(chip) && /Taking work/.test(chip), chip);
  const today = await page.evaluate(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const pickDay = (skip) => page.evaluate(({ today, skip }) => {
    const cells = [...document.querySelectorAll(".jcal-cell[data-day]")].filter((c) => c.dataset.day > today);
    const c = cells[skip];
    c?.click();
    return c?.dataset.day || null;
  }, { today, skip });
  const day = await pickDay(1);
  await wait(500);
  const row = await page.evaluate(() => document.querySelector(".jcd-crew")?.innerText.replace(/\s+/g, " ").trim() || "");
  t.ck("the day's panel says who is working", /Day crew/.test(row) && /Working/.test(row), row);
  await page.evaluate(() => [...document.querySelectorAll(".jcd-crew button")].find((b) => /Mark off/.test(b.innerText))?.click());
  await wait(900);
  const p1 = patches.at(-1);
  t.ck("Mark off posts that day on that crew", patches.length === 2 && p1?.crews?.[0]?.unavailableDays?.includes(day),
    JSON.stringify({ day, p1 }));
  const drawn = await page.evaluate((k) => document.querySelector(`.jcal-cell[data-day="${k}"]`)?.className || "", day);
  t.ck("and the day is drawn off on the same calendar as the jobs", /crew-off/.test(drawn), drawn);
  t.ck("and the panel offers the way back", /Mark working/.test(await page.evaluate(() =>
    document.querySelector(".jcd-crew")?.innerText || "")));

  console.log("\n-- a refusal --");
  REFUSE = true;
  const day2 = await pickDay(4);
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll(".jcd-crew button")].find((b) => /Mark off/.test(b.innerText))?.click());
  await wait(900);
  const drawn2 = await page.evaluate((k) => document.querySelector(`.jcal-cell[data-day="${k}"]`)?.className || "", day2);
  t.ck("a refused day is put back", !/crew-off/.test(drawn2), drawn2);
  const err = await page.evaluate(() => document.querySelector(".ss-main .fld-err")?.innerText || "");
  t.ck("and it says why", /Each crew needs a name/.test(err), err);
  t.ck("and the earlier day is still off", /crew-off/.test(
    await page.evaluate((k) => document.querySelector(`.jcal-cell[data-day="${k}"]`)?.className || "", day)));

  // And on My crews: a refused save says why and does NOT say Saved.
  await open(page, "Subcontractors");
  await page.evaluate(() => [...document.querySelectorAll(".net-view button")].find((b) => /My crews/.test(b.innerText))?.click());
  await wait(600);
  const n0 = patches.length;
  await page.evaluate(() => [...document.querySelectorAll(".ss-main button")]
    .find((x) => /Save crews/.test(x.innerText))?.click());
  await wait(900);
  const crewsPane = await page.evaluate(() => ({
    err: document.querySelector(".ss-main .fld-err")?.innerText || "",
    saved: !!document.querySelector(".ss-main .saved-note"),
  }));
  t.ck("a refused crew save reached the server", patches.length === n0 + 1, `${n0} -> ${patches.length}`);
  t.ck("and My crews says why", /Each crew needs a name/.test(crewsPane.err), JSON.stringify(crewsPane));
  t.ck("and does not claim Saved", !crewsPane.saved, JSON.stringify(crewsPane));
  REFUSE = false;

  t.ck("no page error", crashes.length === 0 && logs.length === 0, [...crashes, ...logs].join(" | "));
  await ctx.close();

  console.log("\n-- a paused crew, and pausing one --");
  {
    // A paused crew is not taking work at all, so its days off must not turn
    // a day half-closed: the one working crew being off is the whole company
    // off. Only a paused crew that ALSO has the day off can tell those apart.
    const d = new Date(Date.now() + 9 * 86400000);
    const D = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    CREWS = [
      { id: "a", name: "Day crew", available: true, unavailableDays: [D], members: [{ name: "Rob", role: "" }] },
      { id: "b", name: "Night crew", available: false, unavailableDays: [D], members: [{ name: "Ana", role: "" }] },
    ];
    const v3 = await visitApp(browser, { host: "cascade", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_cas" }, viewport: { width: 1340, height: 1800 } });
    await wait(2600);
    await open(v3.page, "My Jobs");
    await v3.page.evaluate(() => [...document.querySelectorAll(".jobs-view button")].find((b) => /Calendar/.test(b.innerText))?.click());
    await wait(700);
    // Page to the month the day is in, if it is next month.
    if (!(await v3.page.$(`.jcal-cell[data-day="${D}"]`))) {
      await v3.page.evaluate(() => document.querySelector('.jcal-nav[aria-label="Next month"]')?.click());
      await wait(400);
    }
    const cls = await v3.page.evaluate((k) => document.querySelector(`.jcal-cell[data-day="${k}"]`)?.className || "", D);
    t.ck("the only working crew off is the whole day off, whatever a paused crew says", /crew-off/.test(cls) && !/crew-part/.test(cls), cls);
    const chips = await v3.page.evaluate(() => [...document.querySelectorAll(".mcal-crew")].map((b) => b.innerText.replace(/\s+/g, " ").trim()));
    t.ck("the paused crew says so above the month", chips.some((c) => /Night crew/.test(c) && /Paused/.test(c)), JSON.stringify(chips));
    const before = patches.length;
    await v3.page.evaluate(() => [...document.querySelectorAll(".mcal-crew")].find((b) => /Day crew/.test(b.innerText))?.click());
    await wait(800);
    const pp = patches.at(-1);
    t.ck("pressing a crew pauses it, through the account's own company",
      patches.length === before + 1 && pp?.crews?.find((c) => c.id === "a")?.available === false, JSON.stringify(pp));
    t.ck("and with every crew paused the calendar says nothing will be booked",
      /Every crew is paused/.test(await v3.page.evaluate(() => document.querySelector(".mcal-paused")?.innerText || "")));
    await v3.ctx.close();
    CREWS = [];
  }

  console.log("\n-- an account nobody can hire --");
  KIND = "property_manager";
  const v2 = await visitApp(browser, { host: "cascade", webPort: WEB,
    seat: { userId: "u_rb", accountId: "acc_cas" }, viewport: { width: 1340, height: 1800 } });
  await wait(2800);
  const items2 = await nav(v2.page);
  t.ck("the app rendered for a property manager", items2.length > 0, JSON.stringify(items2));
  t.ck("and there is no My Jobs, My availability or My Crews",
    !items2.some((x) => /^My Jobs|^My availability|^My Crews/.test(x)), JSON.stringify(items2));
  await v2.page.evaluate(() => [...document.querySelectorAll("nav button")].find((b) => /^Contractors/.test(b.innerText.trim()))?.click());
  await wait(900);
  const pmHead = await v2.page.evaluate(() => (document.querySelector(".ss-main")?.innerText || "").slice(0, 300));
  t.ck("its roster page opened", /Contractors/.test(pmHead), pmHead.slice(0, 120));
  t.ck("and carries no My crews tab, because it has no company of its own",
    !(await v2.page.$(".net-view")), pmHead.slice(0, 120));
  await v2.ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
