// THE HANDYMAN CEILING ON THE SCREEN THAT CAN STILL CHANGE THE NUMBER.
//
// The route records the verdict; this is where it is any use. Driven in a
// browser because every claim here is only true as drawn, and each of them
// passes a static check:
//
//   IT IS NEVER A GATE. Issue stays enabled with the warning on screen, which
//   is the whole design -- the figures are secondary-source and thirteen of the
//   fifty-one say so about themselves. An assertion that the component
//   *mentions* the check passes with the button wired shut.
//
//   TWO TONES, VISIBLY. A thing to know and a thing to act on reading the same
//   pixels is the chip bug this project already paid for: correct markup,
//   nothing on screen. Only computed colour can see it.
//
//   AND IT IS ABOVE THE BUTTON. A warning under the control it is about is a
//   warning read after the press.
//
//   node --no-warnings scripts/handycap-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-handycap-test");
const WEB = 5321, API = 9019;
const t = tally();

// The handyman is registered in OREGON and the building is in WASHINGTON, so
// $700 is under one figure and over the other: the only fixture that can show
// which state the screen reads.
let STATE = "WA";

const acct = () => ({
  id: "acc_x", name: "Cascade Management", subdomain: "cascade", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["painting"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Chris Lane", email: "chris@x.test", role: "admin" },
});
const USERS = () => [{ id: "usr_r", name: "Chris Lane", email: "chris@x.test", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];

const verified = { status: "verified", checks: {}, limits: {} };
const sub = (over) => ({
  id: over.id, engagementId: `en_${over.id}`, accountId: "acc_x",
  company: "Co", contact: "C", phone: "(206)555-0100", email: "c@x.test",
  city: "Portland", state: "OR", zip: "97201", license: "",
  licenseCheck: null, crews: [{ id: "c1", name: "Crew 1", available: true, unavailableDays: [],
    members: [{ name: "Joe", role: "Lead" }] }],
  coverage: { mode: "cities", cities: ["Seattle"] }, available: true, unavailableDays: [],
  warranty: null, insurance: 1, bond: 1, contract: 1, w9: 1,
  docFiles: { insurance: "coi.pdf", bond: "bond.pdf", contract: "a.pdf", w9: "w9.pdf" },
  notify: { email: true, sms: false },
  docReview: { insurance: verified, bond: verified, contract: verified, w9: verified },
  categories: ["painting"], caps: [], rating: 4.5, ratedJobs: 4, accepted: 4, declined: 0,
  notes: "", status: "active", propertyIds: [], hasPortal: false, answersForItself: false,
  autoSchedule: false, engagedAs: "subcontractor",
  docs: { insurance: { fileName: "coi.pdf", expiresOn: "2030-01-01" },
    bond: { fileName: "bond.pdf", expiresOn: "2030-01-01" },
    contract: { fileName: "a.pdf", expiresOn: null }, w9: { fileName: "w9.pdf", expiresOn: null } },
  docState: "current", docAssignable: true, docSoonest: "2030-01-01",
  ...over,
});
const SUBS = () => [
  sub({ id: "cmp_fix", company: "Ray the Fixer", engagedAs: "handyman" }),
  sub({ id: "cmp_roof", company: "Bay Roofing Inc", engagedAs: "subcontractor" }),
];
const JOBS = () => [{
  id: "job_1", accountId: "acc_x", propertyId: "prop_1", title: "Paint 3B", status: "active",
  date: "2026-11-02", time: null, address: "1620 Belmont", area: "Seattle", zip: "98122",
  trades: ["painting"], assignments: {}, notes: "", createdAt: "2026-10-01", photos: [],
  severity: null, client: null, sqft: null, stories: null,
}];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/account-users") return [200, USERS()];
  if (path === "/api/subs") return [200, SUBS()];
  if (path === "/api/jobs" && method === "GET") return [200, JOBS()];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_x",
    name: "Press Apartments", address: "1620 Belmont Ave", city: "Seattle", state: STATE,
    zip: "98122", units: 141, notes: "", ownedByAnother: false, ownerDeclared: false }]];
  if (path === "/api/payouts/status") {
    return [200, { status: "none", ready: false, requirements: [], configured: false }];
  }
  if (path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/tenants"
    || path === "/api/clients" || path === "/api/visits"
    || path === "/api/inspections") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

// A controlled input needs the node's own descriptor setter: assigning .value
// does not reach React's onChange, which this project has reported as a broken
// product twice.
const typeMoney = (page, text) => page.evaluate((v) => {
  const box = [...document.querySelectorAll(".modal input")]
    .find((i) => /value/i.test(i.closest("label")?.innerText || ""));
  if (!box) return false;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(box, v);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, text);

const openAssign = async (company) => {
  const { ctx, page } = await visitApp(browser, { host: "cascade", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
  await wait(2600);
  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^Jobs/i.test((b.innerText || "").trim()))?.click());
  await wait(800);
  await page.evaluate(() => document.querySelector(".trade-assign")?.click());
  await wait(800);
  const picked = await page.evaluate((who) => {
    const row = [...document.querySelectorAll(".modal .rec-send")]
      .find((b) => new RegExp(who, "i").test(b.closest("li,div,tr")?.innerText || ""
        + (b.parentElement?.parentElement?.innerText || "")));
    const any = [...document.querySelectorAll(".modal .rec-send")]
      .find((b) => new RegExp(who, "i").test(
        b.closest("[class]")?.parentElement?.innerText || ""));
    (row || any)?.click();
    return !!(row || any);
  }, company);
  await wait(700);
  return { ctx, page, picked };
};

// The block, as the browser computed it.
const hcap = (page) => page.evaluate(() => {
  const el = document.querySelector(".modal .hcap");
  if (!el) return null;
  const cs = getComputedStyle(el);
  const btn = [...document.querySelectorAll(".modal .form-actions button")]
    .find((b) => /^Issue/i.test((b.innerText || "").trim()));
  return {
    tone: el.classList.contains("hcap-warn") ? "warn" : "note",
    bg: cs.backgroundColor, border: cs.borderTopColor,
    head: (el.querySelector("strong")?.innerText || "").trim(),
    body: [...el.querySelectorAll("p")].map((p) => (p.innerText || "").replace(/\s+/g, " ").trim()),
    // THE PROPERTY, not the markup: a warning under the button it is about is
    // read after the press.
    aboveButton: !!btn && el.getBoundingClientRect().bottom <= btn.getBoundingClientRect().top + 1,
    issueDisabled: btn ? btn.disabled : null,
    issueLabel: btn ? (btn.innerText || "").trim() : null,
  };
});

try {
  console.log("\n-- over the building's cap --");
  let warnTone = null;
  {
    STATE = "WA";
    const { ctx, page, picked } = await openAssign("Ray the Fixer");
    t.ck("the handyman can be picked out of the list", picked);
    t.ck("and the value box takes a figure", await typeMoney(page, "700"));
    await wait(500);
    const h = await hcap(page);
    t.ck("the ceiling is drawn", !!h, JSON.stringify(h));
    t.ck("and it is the warning tone", h?.tone === "warn", JSON.stringify(h?.tone));
    // THE STATE IS THE BUILDING'S. $700 is over Washington's $500 and under
    // Oregon's $1,000, and the company row says Oregon -- so naming Washington
    // here is the only thing that proves which one was read.
    t.ck("read off the building's state", /Washington/.test(h?.head || ""), h?.head);
    t.ck("it names the figure and the overage",
      /\$700/.test((h?.body || []).join(" ")) && /\$500/.test((h?.body || []).join(" ")),
      JSON.stringify(h?.body));
    t.ck("and the state's own caveat rides with it",
      /advertise/i.test((h?.body || []).join(" ")), JSON.stringify(h?.body));
    t.ck("which says the figure is unconfirmed",
      /not been checked/i.test((h?.body || []).join(" ")), JSON.stringify(h?.body));

    // THE CENTRAL CLAIM.
    t.ck("Issue is still live under it", h?.issueDisabled === false, JSON.stringify(h?.issueDisabled));
    t.ck("and still says Issue work order", /work order/i.test(h?.issueLabel || ""), h?.issueLabel);
    t.ck("the warning sits above the button", h?.aboveButton === true);
    warnTone = { bg: h?.bg, border: h?.border };
    await ctx.close();
  }

  console.log("\n-- under it, and the tones differ in pixels --");
  {
    STATE = "WA";
    const { ctx, page } = await openAssign("Ray the Fixer");
    await typeMoney(page, "300");
    await wait(500);
    const h = await hcap(page);
    t.ck("it is still drawn under the cap", !!h, JSON.stringify(h));
    t.ck("as a note rather than a warning", h?.tone === "note", JSON.stringify(h?.tone));
    t.ck("saying it is within the limit", /Within Washington/.test(h?.head || ""), h?.head);
    // THE CHIP LESSON: the class is not the state, the pixels are.
    t.ck("and the two tones are visibly different",
      !!warnTone && (h?.bg !== warnTone.bg || h?.border !== warnTone.border),
      JSON.stringify([warnTone, { bg: h?.bg, border: h?.border }]));
    t.ck("Issue is live here too", h?.issueDisabled === false);
    await ctx.close();
  }

  console.log("\n-- a state that licenses nobody --");
  {
    STATE = "TX";
    const { ctx, page } = await openAssign("Ray the Fixer");
    await typeMoney(page, "40000");
    await wait(500);
    const h = await hcap(page);
    t.ck("$40,000 in Texas is not a warning", h?.tone === "note", JSON.stringify(h?.tone));
    t.ck("and it names Texas", /Texas/.test(h?.head || ""), h?.head);
    t.ck("with local rules named", /city or county/i.test((h?.body || []).join(" ")),
      JSON.stringify(h?.body));
    await ctx.close();
  }

  console.log("\n-- and nothing at all for a subcontractor --");
  {
    // Asserted in the same place as the handyman, because a change that drew
    // this for everybody passes a suite that only drives the one -- the
    // diagonal coverage that left `hiresLabel` half-wired.
    STATE = "WA";
    const { ctx, page } = await openAssign("Bay Roofing");
    await typeMoney(page, "90000");
    await wait(500);
    t.ck("no ceiling is drawn for a licensed subcontractor", (await hcap(page)) === null);
    // And the form is really open, or the absence above is a screen that never
    // rendered rather than an absence.
    const live = await page.evaluate(() => {
      const btn = [...document.querySelectorAll(".modal .form-actions button")]
        .find((b) => /^Issue/i.test((b.innerText || "").trim()));
      return { btn: !!btn, off: btn ? btn.disabled : null,
        who: (document.querySelector(".modal .form-sub")?.innerText || "").trim() };
    });
    t.ck("while the issue form is open on them", live.btn && /Bay Roofing/.test(live.who),
      JSON.stringify(live));
    t.ck("and ready to send", live.off === false, JSON.stringify(live));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
