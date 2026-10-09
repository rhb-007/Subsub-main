// WHY the add-a-subcontractor lookup came back empty, said in words.
//
// The gate's lookup printed "Nobody on SubSub matches that" for three
// different answers: a real miss, the account's OWN company (which cannot be
// connected to itself), and a lookup that never reached an answer -- a staff
// sign-in past its thirty minutes, a dropped connection. Reported as typing
// the address of a company plainly on SubSub and being told it was not, which
// sends somebody off to type in a duplicate of it.
//
// So the three are told apart, and a failure offers Try again. Each branch is
// driven against a stubbed reply, and the found case is asserted in the same
// place so a fix that stopped drawing anything cannot pass.
//
//   node --no-warnings scripts/connect-why-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-connectwhy-test");
const WEB = 5447, API = 9147;
const t = tally();

const ACCOUNT = {
  id: "acc_s", name: "Sound Property Management", subdomain: "sound", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: null,
  user: { id: "usr_c", name: "Chris Lee", email: "chris@sound.test", role: "admin" },
};
// What the next lookup answers.
let REPLY = [200, { found: false }];
const asked = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path.startsWith("/api/connect/lookup")) { asked.push(path); return REPLY; }
  if (["/api/subs", "/api/jobs", "/api/invites", "/api/connect-requests", "/api/my-connect-requests",
    "/api/properties", "/api/tenants", "/api/clients", "/api/agreements"].includes(path)) return [200, []];
  if (path === "/api/account-users") return [200, [{ id: "usr_c", name: "Chris Lee", email: "chris@sound.test",
    phone: null, role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openGate = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((x) => /^(Sub)?contractors\s*\d*$/i.test(x.innerText.trim().replace(/\n/g, " ")))?.click());
  await wait(900);
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((x) => /^\+?\s*Add$/.test(x.innerText.trim()))?.click());
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll("button, [role=menuitem]")]
    .find((x) => /^(Sub)?contractor$/i.test(x.innerText.trim()))?.click());
  await wait(900);
};
const typeEmail = (page, v) => page.evaluate((val) => {
  const el = document.querySelector('.cx-gate input[type=email]');
  if (!el) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(el, val); el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, v);
const read = (page) => page.evaluate(() => {
  const g = document.querySelector(".cx-gate");
  return {
    gate: !!g,
    hints: [...(g?.querySelectorAll(".cov-hint") || [])].map((h) => h.innerText.replace(/\s+/g, " ").trim()),
    found: !!g?.querySelector(".cx-found"),
    retry: !!g?.querySelector(".cx-retry"),
  };
});

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "sound", webPort: WEB,
    seat: { userId: "usr_c", accountId: "acc_s" }, viewport: { width: 1100, height: 1400 } });
  await wait(2200);
  await openGate(page);

  console.log("\n-- the lookup never reached an answer --");
  REPLY = [401, { error: "impersonation_expired" }];
  t.ck("the add form's first screen opened", (await typeEmail(page, "rbraun@gmail.com")) === true);
  await wait(1300);
  let r = await read(page);
  t.ck("the form is really there", r.gate, JSON.stringify(r));
  t.ck("it does NOT say nobody matches, because it did not look",
    !r.hints.some((h) => /Nobody on SubSub matches/.test(h)), JSON.stringify(r.hints));
  t.ck("it says the staff sign-in ran out", r.hints.some((h) => /staff sign-in has run out/i.test(h)), JSON.stringify(r.hints));
  t.ck("and offers to try again", r.retry);

  console.log("\n-- trying again once it can answer --");
  REPLY = [200, { found: true, match: { companyId: "cmp_own_cas", company: "Cascade Apartment Services",
    contact: null, where: null, engaged: false, pending: false } }];
  const before = asked.length;
  await page.evaluate(() => document.querySelector(".cx-retry")?.click());
  await wait(1300);
  r = await read(page);
  t.ck("Try again asks again", asked.length === before + 1, `${before} -> ${asked.length}`);
  t.ck("and finds the company", r.found, JSON.stringify(r));

  console.log("\n-- some other refusal --");
  REPLY = [500, { error: "internal" }];
  await typeEmail(page, "other@x.test"); await wait(1300);
  r = await read(page);
  t.ck("a refusal names its code and is still not 'nobody matches'",
    r.hints.some((h) => /could not check that just now \(internal\)/.test(h))
    && !r.hints.some((h) => /Nobody on SubSub matches/.test(h)), JSON.stringify(r.hints));

  console.log("\n-- this account's own company --");
  REPLY = [200, { found: false, reason: "own_company" }];
  await typeEmail(page, "self@x.test"); await wait(1300);
  r = await read(page);
  t.ck("it says this is the account's own company",
    r.hints.some((h) => /this account's own company/i.test(h)), JSON.stringify(r.hints));
  t.ck("and not 'nobody matches'", !r.hints.some((h) => /Nobody on SubSub matches/.test(h)));

  console.log("\n-- a real miss --");
  REPLY = [200, { found: false }];
  await typeEmail(page, "nobody@x.test"); await wait(1300);
  r = await read(page);
  t.ck("a real miss still says nobody matches", r.hints.some((h) => /Nobody on SubSub matches/.test(h)), JSON.stringify(r.hints));
  t.ck("with no retry offered", !r.retry);
  t.ck("no page error", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
