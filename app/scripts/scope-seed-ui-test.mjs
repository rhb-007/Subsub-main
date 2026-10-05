// THE SEEDED SCOPE HAS TO SURVIVE CHOOSING THE CONTRACTOR.
//
// Reported as *"the scope is empty still when raising a job for an inspection
// follow up ... should be prepopulated"*, with the work-order modal on screen:
// an empty **Scope for painting** box, its placeholder showing, and the italic
// note under it reading *"Filled in from the painting rooms on the inspection.
// Edit it if you want."*
//
// Everything about the seed was right. The route answered, the hook fetched,
// the effect in `PickContractor` ran and `lines` held the text. Then `pickSub`
// -- which runs when somebody picks the contractor, and is the press that
// makes the scope boxes exist at all -- replaced the whole of `lines` with a
// fresh object whose every scope was "". So the seed was written and wiped
// before anything could draw it.
//
// WHY NOTHING STATIC COULD SEE IT, which is what this suite is for. The effect
// is exactly right. The note is exactly right. `pickSub` is exactly right for
// everything it was written to initialise. The bug is only in the ORDER, and
// the one witness is the drawn textarea after the pick. `test:tradescope`
// asserts the effect and its guard in the source and passed throughout.
//
// AND THE NOTE AND THE BOX ARE TWO RECORDS OF ONE FACT. The note is gated on
// `tradeScopes[t]` and the box on `lines[t].scope`, and the live screen drew
// one without the other -- so every block here reads BOTH and requires them to
// agree, in the negative direction as well as the positive.
//
//   node --no-warnings scripts/scope-seed-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-scopeseed-test");
const WEB = 5349, API = 9045;
const t = tally();

const SEED = "From the move-out inspection of unit 14b on 2026-10-04:\n"
  + "• Hallway — Follow-up\n"
  + "    - photo: Wood-grain door panel needs to be repaired - chipped and scratched.";

// Flipped per block. `{}` is the ordinary answer for a job nobody walked, and
// it has to leave the box alone rather than the fix inventing text for it.
let SCOPES = { painting: SEED };

const acct = () => ({
  id: "acc_x", name: "Sound Property Management", subdomain: "sound", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["painting"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Chris Lane", email: "chris@x.test", role: "admin" },
});
const USERS = () => [{ id: "usr_r", name: "Chris Lane", email: "chris@x.test", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];

const verified = { status: "verified", checks: {}, limits: {} };
// Covers BOTH trades on the job, so the bundle box offers finish carpentry --
// which is the trade the inspection said nothing about, and so the negative
// half of every assertion here.
const SUBS = () => [{
  id: "sub_1", engagementId: "en_1", accountId: "acc_x",
  company: "Pacific apartment maintenance", contact: "Juan Soto",
  phone: "(206)555-0100", email: "juan@pacific.test",
  city: "Seattle", state: "WA", zip: "98122", license: "PACIFI*123AB", licenseCheck: null,
  crews: [{ id: "c1", name: "Crew 1", available: true, unavailableDays: [], members: [{ name: "Joe", role: "Lead" }] }],
  coverage: { mode: "cities", cities: ["Seattle"] }, available: true, unavailableDays: [],
  warranty: null, insurance: 1, bond: 1, contract: 1, w9: 1,
  docFiles: { insurance: "coi.pdf", bond: "bond.pdf", contract: "a.pdf", w9: "w9.pdf" },
  notify: { email: true, sms: false },
  docReview: { insurance: verified, bond: verified, contract: verified, w9: verified },
  categories: ["painting", "trim_carpentry"], caps: [], rating: 4.5, ratedJobs: 4,
  accepted: 4, declined: 0, notes: "", status: "active", propertyIds: [],
  hasPortal: false, answersForItself: false, autoSchedule: false, engagedAs: "subcontractor",
  docs: { insurance: { fileName: "coi.pdf", expiresOn: "2030-01-01" },
    bond: { fileName: "bond.pdf", expiresOn: "2030-01-01" },
    contract: { fileName: "a.pdf", expiresOn: null }, w9: { fileName: "w9.pdf", expiresOn: null } },
  docState: "current", docAssignable: true, docSoonest: "2030-01-01",
}];

const JOBS = () => [{
  id: "job_1", accountId: "acc_x", title: "Move-out work — unit 14b", address: "1620 Belmont Ave",
  area: "Seattle", zip: "98122", propertyId: "prop_1", date: "2030-03-04", time: "09:00",
  trades: ["painting", "trim_carpentry"], assignments: {}, status: "active", severity: null,
  notes: "", sqft: null, stories: null, materialsBy: null, createdAt: "2030-01-01",
  requestedBy: null, approvedAt: "2030-01-01", withdrawnAt: null, completedAt: null,
  measurementDocs: [], readOnly: false, scope: SEED,
}];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/account-users") return [200, USERS()];
  if (path === "/api/subs") return [200, SUBS()];
  if (path === "/api/jobs" && method === "GET") return [200, JOBS()];
  if (/\/trade-scope$/.test(path)) return [200, { scopes: SCOPES }];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_x",
    name: "Press Apartments", address: "1620 Belmont Ave", city: "Seattle", state: "WA",
    zip: "98122", units: 141, notes: "", ownedByAnother: false, ownerDeclared: false }]];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/tenants"
    || path === "/api/clients" || path === "/api/visits"
    || path === "/api/inspections") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

// Every work-order line as it is actually drawn: the trade, what is in the
// box, and whether the note claiming it was filled in is beside it.
const READ = () => [...document.querySelectorAll(".modal .wo-line")].map((el) => ({
  head: (el.querySelector(".wol-title, .wol-check")?.innerText || "").replace(/\s+/g, " ").trim(),
  open: !!el.querySelector(".wol-body"),
  scope: el.querySelector(".wol-body textarea")?.value ?? null,
  // `.fld-note` is also the class on the value field's hint ("their pay for
  // this trade only"), so a bare lookup in the body finds whichever exists and
  // reports that one as the scope's -- the whichever-one-exists trap. Read it
  // off the textarea's OWN label.
  note: (el.querySelector(".wol-body textarea")?.closest("label")?.querySelector(".fld-note")?.innerText || "")
    .replace(/\s+/g, " ").trim(),
}));

// Open Jobs, open the first empty trade slot, pick the contractor, tick the
// bundled trade, and read every line back.
const openAndPick = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^Jobs/i.test((b.innerText || "").trim()))?.click());
  await wait(900);
  const opened = await page.evaluate(() => { const b = document.querySelector(".trade-assign"); b?.click(); return !!b; });
  await wait(900);
  const picked = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".modal .rec-send")][0];
    b?.click(); return !!b;
  });
  await wait(700);
  // The bundled trade's body only exists once it is ticked, and an unopened
  // box cannot be read -- "there is no text" and "there is no box" are
  // different answers and only one of them is about the seed.
  await page.evaluate(() => {
    const box = [...document.querySelectorAll(".modal .wol-check input")][0];
    if (box && !box.checked) box.click();
  });
  await wait(400);
  return { opened, picked };
};

try {
  console.log("\n-- the trade the inspection named --");
  const { ctx, page } = await visitApp(browser, { host: "sound", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1600 } });
  await wait(2600);
  const got = await openAndPick(page);
  t.ck("the assign form opened and a contractor was picked", got.opened && got.picked, JSON.stringify(got));
  const lines = await page.evaluate(READ);
  t.ck("both work-order lines are drawn and open", lines.length === 2 && lines.every((l) => l.open),
    JSON.stringify(lines.map((l) => ({ head: l.head, open: l.open }))));
  const paint = lines.find((l) => /painting/i.test(l.head));
  const carp = lines.find((l) => /carpentry/i.test(l.head));

  // THE ASSERTION THE LIVE PRODUCT FAILED.
  t.ck("the painting scope is filled in from the inspection",
    (paint?.scope || "").includes("Hallway") && (paint?.scope || "").includes("door panel"),
    JSON.stringify(paint?.scope));
  t.ck("and it is the whole seed, not a fragment of it",
    (paint?.scope || "").trim() === SEED.trim(), JSON.stringify(paint?.scope));
  t.ck("and the note beside it says where the text came from",
    /Filled in from the painting rooms/i.test(paint?.note || ""), paint?.note);

  // THE NEGATIVE HALF, IN THE SAME PLACE. A fix that filled every box would
  // pass every assertion above and put the wrong unit's rooms on a work order.
  t.ck("the trade the inspection said nothing about stays empty",
    (carp?.scope || "") === "", JSON.stringify(carp?.scope));
  t.ck("and carries no note claiming it was filled in", (carp?.note || "") === "", carp?.note);

  console.log("\n-- typing survives choosing somebody else --");
  {
    await page.evaluate((v) => {
      const el = [...document.querySelectorAll(".modal .wo-line .wol-body textarea")][0];
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true }));
    }, "Repaint the hallway only.");
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".modal button")]
      .find((b) => /^Back$/i.test((b.innerText || "").trim()))?.click());
    await wait(500);
    await page.evaluate(() => { [...document.querySelectorAll(".modal .rec-send")][0]?.click(); });
    await wait(700);
    const again = await page.evaluate(READ);
    const p2 = again.find((l) => /painting/i.test(l.head));
    t.ck("their own words are still there after going back and picking again",
      (p2?.scope || "") === "Repaint the hallway only.", JSON.stringify(p2?.scope));
    t.ck("and the note comes off, because the text is theirs now", (p2?.note || "") === "", p2?.note);
  }

  console.log("\n-- and a box they CLEARED stays cleared --");
  {
    // Seeded, never forced. Putting the seed back over a box somebody emptied
    // is the preselection-mistaken-for-a-choice failure, one press along.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".modal .wo-line .wol-body textarea")][0];
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      set.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".modal button")]
      .find((b) => /^Back$/i.test((b.innerText || "").trim()))?.click());
    await wait(500);
    await page.evaluate(() => { [...document.querySelectorAll(".modal .rec-send")][0]?.click(); });
    await wait(700);
    const again = await page.evaluate(READ);
    const p3 = again.find((l) => /painting/i.test(l.head));
    t.ck("the emptied box is not re-filled", (p3?.scope || "") === "", JSON.stringify(p3?.scope));
  }
  await ctx.close();

  console.log("\n-- a job nobody walked --");
  {
    SCOPES = {};
    const s = await visitApp(browser, { host: "sound", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1600 } });
    await wait(2600);
    const r = await openAndPick(s.page);
    t.ck("the form still opens", r.opened && r.picked, JSON.stringify(r));
    const lines2 = await s.page.evaluate(READ);
    t.ck("every box is empty", lines2.length === 2 && lines2.every((l) => (l.scope || "") === ""),
      JSON.stringify(lines2.map((l) => l.scope)));
    t.ck("and nothing claims a fill that did not happen",
      lines2.every((l) => (l.note || "") === ""), JSON.stringify(lines2.map((l) => l.note)));
    await s.ctx.close();
  }
} finally {
  await browser.close();
  web.close();
  api.close();
}

t.done();
