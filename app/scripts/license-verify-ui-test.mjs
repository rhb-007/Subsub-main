// Pressing Verify on a WA registration, in a browser.
//
// When the check could not run -- a staff sign-in past its thirty minutes, a
// signed-out session, no connection -- the screen used to fall back on a local
// stand-in that answered ACTIVE, with a made-up bond and insurer, for any
// number at all. So a check that never ran drew a verified registration and
// made the contractor assignable. This drives the card's Verify against each
// answer and reads what is drawn.
//
//   node --no-warnings scripts/license-verify-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-licverify-test");
const WEB = 5449, API = 9149;
const t = tally();

const ACCOUNT = {
  id: "acc_s", name: "Sound Property Management", subdomain: "sound", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: null,
  user: { id: "usr_c", name: "Chris Lee", email: "chris@sound.test", role: "admin" },
};
let CHECK = null;
const SUB = () => ({
  engagedAs: "subcontractor", id: "cmp_c", company: "Cascade Apartment Services", engagementId: "en_c",
  accountId: "acc_s", contact: "R Braun", email: "rbraun@gmail.com", phone: "555-0100",
  categories: ["plumbing"], caps: [], crews: [], propertyIds: [], zips: [], notify: {}, rating: null,
  bond: true, insurance: true, contract: true, w9: true,
  hasPortal: true, answersForItself: true, license: "CASCAAS900T1", ubi: "604123456", state: "WA",
  licenseCheck: CHECK, available: true, unavailableDays: [], coverage: {},
  docReview: { insurance: { status: "verified" }, bond: { status: "verified" },
    contract: { status: "verified" }, w9: { status: "verified" } },
});
const ACTIVE = { found: true, status: "ACTIVE", licenseType: "CONSTRUCTION CONTRACTOR",
  licenseNumber: "CASCAAS900T1", effectiveDate: "2025-01-15", expirationDate: "2099-12-31", suspendDate: null,
  checkedAt: "2026-10-09", bond: { surety: "North River Insurance Company", number: null, amount: 30000, expires: null },
  insurance: { carrier: "State National Ins Co", policy: "NXT9-01-GL", coverage: 1000000, expires: "2099-01-01" } };
let VERIFY = [401, { error: "impersonation_expired" }];
const verifies = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/subs") return [200, [SUB()]];
  if (path === "/api/subs/cmp_c/verify-license" && method === "POST") { verifies.push(1); return VERIFY; }
  if (path === "/api/account-users") return [200, [{ id: "usr_c", name: "Chris Lee", email: "chris@sound.test",
    phone: null, role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const readCard = (page) => page.evaluate(() => {
  const sec = [...document.querySelectorAll(".detail section")]
    .find((x) => /WA contractor registration/i.test(x.querySelector("h4")?.innerText || ""));
  return {
    there: !!sec,
    chip: sec?.querySelector(".lic-status")?.innerText.trim() || "",
    ok: !!sec?.querySelector(".lic-card.ok"),
    meta: sec?.querySelector(".lic-meta")?.innerText.trim() || "",
    state: sec?.querySelector(".lic-state")?.innerText.trim() || "",
    msg: sec?.querySelector(".lic-verify-msg")?.innerText.trim() || "",
    tone: sec?.querySelector(".lic-verify-msg")?.className || "",
    btn: sec?.querySelector(".lic-verify button")?.innerText.trim() || "",
  };
});
const press = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll(".detail section")]
    .find((x) => /WA contractor registration/i.test(x.querySelector("h4")?.innerText || ""))
    ?.querySelector(".lic-verify button")?.click());
  await wait(1000);
};

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "sound", webPort: WEB,
    seat: { userId: "usr_c", accountId: "acc_s" }, viewport: { width: 1200, height: 1600 } });
  await wait(2400);

  console.log("\n-- the dashboard row, when the check cannot run --");
  const row = await page.evaluate(() => {
    const sec = [...document.querySelectorAll(".dash-sec")].find((x) => /Registration problems/i.test(x.innerText));
    const b = sec?.querySelector(".lic-verify button");
    b?.click();
    return { there: !!sec, btn: b?.innerText.trim() || "" };
  });
  t.ck("an unverified registration is on the dashboard with Verify", row.there && /Verify/.test(row.btn), JSON.stringify(row));
  await wait(1000);
  const rowAfter = await page.evaluate(() => {
    const sec = [...document.querySelectorAll(".dash-sec")].find((x) => /Registration problems/i.test(x.innerText));
    return { still: !!sec && /Cascade Apartment Services/.test(sec.innerText),
      msg: sec?.querySelector(".lic-verify-msg")?.innerText.trim() || "" };
  });
  t.ck("it says the staff sign-in ran out", /staff sign-in has run out/i.test(rowAfter.msg), JSON.stringify(rowAfter));
  t.ck("and the contractor is still listed as a problem", rowAfter.still, JSON.stringify(rowAfter));

  console.log("\n-- the contractor's card --");
  await page.evaluate(() => [...document.querySelectorAll("nav button, .drawer button, aside button")]
    .find((x) => /^(sub)?contractors/i.test(x.innerText.trim()))?.click());
  await wait(900);
  await page.evaluate(() => [...document.querySelectorAll(".grid .card")]
    .find((c) => /Cascade Apartment Services/.test(c.innerText))?.click());
  await wait(900);
  let c = await readCard(page);
  t.ck("the registration section is there", c.there && c.btn === "Verify", JSON.stringify(c));
  t.ck("unchecked to start", /^not checked$/i.test(c.chip) && !c.ok, JSON.stringify(c));

  VERIFY = [401, { error: "impersonation_expired" }];
  const n0 = verifies.length;
  await press(page);
  c = await readCard(page);
  t.ck("the press reached the server", verifies.length === n0 + 1);
  t.ck("a check that did not run draws NO registration", !c.ok && /^not checked$/i.test(c.chip) && !/active/i.test(c.chip + c.meta), JSON.stringify(c));
  t.ck("and no bond or insurer it never read", c.state === "", c.state);
  t.ck("it says why, as an error", /staff sign-in has run out/i.test(c.msg) && /err/.test(c.tone), JSON.stringify(c));

  VERIFY = [400, { error: "no_license_on_file" }];
  await press(page);
  c = await readCard(page);
  t.ck("no number on file is named", /no licence number on file/i.test(c.msg), c.msg);

  VERIFY = [200, ACTIVE];
  await press(page);
  c = await readCard(page);
  t.ck("a real answer draws Active", c.ok && /^active$/i.test(c.chip), JSON.stringify(c));
  t.ck("with the bond and insurer L&I gave", /\$30,000.*North River/.test(c.state) && /\$1,000,000.*State National/.test(c.state), c.state);
  t.ck("and says it checked just now", /Checked with L&I just now: Active/.test(c.msg) && /ok/.test(c.tone), JSON.stringify(c));
  t.ck("the button now reads Re-check", c.btn === "Re-check", c.btn);

  VERIFY = [200, { ...ACTIVE, checkFailed: true, failure: "CHECK_FAILED", lastFailedAt: "2026-10-09" }];
  await press(page);
  c = await readCard(page);
  t.ck("L&I not answering keeps the registration on screen", c.ok && /^active$/i.test(c.chip), JSON.stringify(c));
  t.ck("and says nothing changed", /didn't answer just now, so nothing changed/.test(c.msg) && /warn/.test(c.tone), c.msg);

  t.ck("no page error", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
