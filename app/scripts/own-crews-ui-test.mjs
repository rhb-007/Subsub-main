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
  t.ck("My availability is in the nav", items.some((x) => /^My availability/.test(x)), JSON.stringify(items));
  t.ck("and My Crews", items.some((x) => /^My Crews/.test(x)), JSON.stringify(items));

  await open(page, "My availability");
  let txt = await main(page);
  t.ck("My availability opens on its own page", /My availability/.test(txt) && /Every client that hires you sees them/.test(txt),
    txt.slice(0, 200));
  // NO CREWS IS A WAY IN, not a sentence pointing somewhere else.
  const goBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".ss-main button")].find((x) => /Add a crew/.test(x.innerText));
    b?.click();
    return !!b;
  });
  t.ck("with no crews it offers to add one", goBtn);
  await wait(900);
  txt = await main(page);
  t.ck("and that lands on My crews", /My crews/i.test(txt) && /Save crews/.test(txt), txt.slice(0, 200));

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

  console.log("\n-- marking a day off --");
  await open(page, "My availability");
  const day = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".mini-cal .mc-day.free")][3];
    const k = b?.getAttribute("data-day");
    b?.click();
    return k;
  });
  await wait(900);
  const p1 = patches.at(-1);
  t.ck("tapping a day posts it on that crew", patches.length === 2 && p1?.crews?.[0]?.unavailableDays?.includes(day),
    JSON.stringify({ day, p1 }));
  const drawn = await page.evaluate((k) => document.querySelector(`.mini-cal [data-day="${k}"]`)?.className || "", day);
  t.ck("and the day is drawn off", /\boff\b/.test(drawn), drawn);

  console.log("\n-- a refusal --");
  REFUSE = true;
  const day2 = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".mini-cal .mc-day.free")][5];
    const k = b?.getAttribute("data-day");
    b?.click();
    return k;
  });
  await wait(900);
  const drawn2 = await page.evaluate((k) => document.querySelector(`.mini-cal [data-day="${k}"]`)?.className || "", day2);
  t.ck("a refused day is put back", /\bfree\b/.test(drawn2) && !/\boff\b/.test(drawn2), drawn2);
  const err = await page.evaluate(() => document.querySelector(".ss-main .fld-err")?.innerText || "");
  t.ck("and it says why", /Each crew needs a name/.test(err), err);
  t.ck("and the earlier day is still off", /\boff\b/.test(
    await page.evaluate((k) => document.querySelector(`.mini-cal [data-day="${k}"]`)?.className || "", day)));

  // And on My Crews: a refused save says why and does NOT say Saved.
  await open(page, "My Crews");
  const n0 = patches.length;
  await page.evaluate(() => [...document.querySelectorAll(".ss-main button")]
    .find((x) => /Save crews/.test(x.innerText))?.click());
  await wait(900);
  const crewsPane = await page.evaluate(() => ({
    err: document.querySelector(".ss-main .fld-err")?.innerText || "",
    saved: !!document.querySelector(".ss-main .saved-note"),
  }));
  t.ck("a refused crew save reached the server", patches.length === n0 + 1, `${n0} -> ${patches.length}`);
  t.ck("and My Crews says why", /Each crew needs a name/.test(crewsPane.err), JSON.stringify(crewsPane));
  t.ck("and does not claim Saved", !crewsPane.saved, JSON.stringify(crewsPane));
  REFUSE = false;

  t.ck("no page error", crashes.length === 0 && logs.length === 0, [...crashes, ...logs].join(" | "));
  await ctx.close();

  console.log("\n-- an account nobody can hire --");
  KIND = "property_manager";
  const v2 = await visitApp(browser, { host: "cascade", webPort: WEB,
    seat: { userId: "u_rb", accountId: "acc_cas" }, viewport: { width: 1340, height: 1800 } });
  await wait(2800);
  const items2 = await nav(v2.page);
  t.ck("the app rendered for a property manager", items2.length > 0, JSON.stringify(items2));
  t.ck("and there is no My availability or My Crews",
    !items2.some((x) => /^My availability|^My Crews/.test(x)), JSON.stringify(items2));
  await v2.ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
