// A REFUSED ASSIGNMENT MUST DRAW NOTHING, LOG NOTHING AND SAY WHY.
//
// Reported as a roster of jobs assigned to a contractor whose own portal
// showed none of them. The portal was right. `POST /api/jobs/:jobId/assign`
// had refused every one with `documents_incomplete` -- and this screen fired
// the calls, then patched the job and wrote the feed entry SYNCHRONOUSLY,
// outside the promise. So the trade drew as assigned with a work order number
// on it, the feed recorded "Issued a work order" about one that does not
// exist, and the whole lot vanished on reload.
//
// Third instance of the save-that-reports-success shape in this file --
// `updateSub`, `completeJob`, and now the single most consequential press in
// the product. What makes it worth its own suite is that NO STATIC CHECK CAN
// SEE IT: `setJobs(... issueWO ...)` is exactly the right code, and the bug is
// only that it runs whether or not the server agreed. The property is what is
// on screen after the press.
//
//   node --no-warnings scripts/assign-refused-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-assignref-test");
const WEB = 5325, API = 9023;
const t = tally();

// What the route answers. Flipped per block, because the whole subject is the
// difference between a press the server took and one it refused.
let REPLY = [201, { id: "wo_1", woNumber: "WO-1", status: "pending", notified: { emailed: true, to: "c@x.test" } }];
// Every assign call the browser actually made, so "it did not draw it" can be
// told apart from "it never asked".
let CALLS = 0;

const acct = () => ({
  id: "acc_x", name: "Cascade Management", subdomain: "cascade", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["painting"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Chris Lane", email: "chris@x.test", role: "admin" },
});
const USERS = () => [{ id: "usr_r", name: "Chris Lane", email: "chris@x.test", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];

const verified = { status: "verified", checks: {}, limits: {} };
// THE FIXTURE IS A CONTRACTOR WHO LOOKS ASSIGNABLE FROM HERE. The roster row
// carries verified documents, because the refusal under test is the SERVER's
// -- a row the screen already knew was short would never reach the button, and
// a suite driving that case could not tell a guarded patch from a hidden one.
const SUBS = () => [{
  id: "sub_1", engagementId: "en_1", accountId: "acc_x",
  company: "Pacific apartment maintenance", contact: "Juan Soto",
  phone: "(206)555-0100", email: "juan@pacific.test",
  city: "Seattle", state: "WA", zip: "98122", license: "PACIFI*123AB",
  licenseCheck: null,
  crews: [{ id: "c1", name: "Crew 1", available: true, unavailableDays: [], members: [{ name: "Joe", role: "Lead" }] }],
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
}];

const JOBS = () => [{
  id: "job_1", accountId: "acc_x", title: "Repaint unit 3B", address: "1620 Belmont Ave",
  area: "Seattle", zip: "98122", propertyId: "prop_1", date: "2030-03-04", time: "09:00",
  trades: ["painting"], assignments: {}, status: "active", severity: null,
  notes: "", sqft: null, stories: null, materialsBy: null, createdAt: "2030-01-01",
  requestedBy: null, approvedAt: "2030-01-01", withdrawnAt: null, completedAt: null,
  measurementDocs: [], readOnly: false,
}];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/account-users") return [200, USERS()];
  if (path === "/api/subs") return [200, SUBS()];
  if (path === "/api/jobs" && method === "GET") return [200, JOBS()];
  if (/\/assign$/.test(path) && method === "POST") { CALLS += 1; return REPLY; }
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

const typeMoney = (page, text) => page.evaluate((v) => {
  const box = [...document.querySelectorAll(".modal input")]
    .find((i) => /value/i.test(i.closest("label")?.innerText || ""));
  if (!box) return false;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(box, v);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, text);

// Open Jobs, open the empty trade slot, pick the contractor, price it, press
// Issue. Returns what the JOBS screen reads afterwards.
const pressIssue = async () => {
  CALLS = 0;
  const { ctx, page } = await visitApp(browser, { host: "cascade", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
  await wait(2600);
  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^Jobs/i.test((b.innerText || "").trim()))?.click());
  await wait(800);
  const opened = await page.evaluate(() => { const b = document.querySelector(".trade-assign"); b?.click(); return !!b; });
  await wait(800);
  const picked = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".modal .rec-send")][0];
    b?.click(); return !!b;
  });
  await wait(700);
  await typeMoney(page, "1800");
  await wait(250);
  const pressed = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".modal .form-actions button")]
      .find((x) => /^Issue/i.test((x.innerText || "").trim()));
    if (!b || b.disabled) return false;
    b.click(); return true;
  });
  await wait(1400);
  const seen = await page.evaluate(() => ({
    // The trade row as it now reads. A refused assignment must leave the slot
    // open -- which is the only thing that tells a guarded patch from one that
    // ran anyway, because the note alone is drawn in both cases.
    stillOpen: !!document.querySelector(".trade-assign"),
    // Whether the contractor's NAME is drawn against the trade. A second
    // reading of the same press, because "the Assign button is still there"
    // and "nothing was written against this trade" are not quite the same
    // claim, and the live bug drew both halves.
    namedOnJob: /Pacific apartment maintenance/i
      .test(document.querySelector(".job-card, .jobs-list, main")?.innerText || ""),
    body: (document.body.innerText || "").replace(/\s+/g, " "),
    note: (document.querySelector(".billing-note")?.innerText || "").replace(/\s+/g, " ").trim(),
  }));
  await ctx.close();
  return { opened, picked, pressed, ...seen };
};

try {
  console.log("\n-- the server refuses it --");
  {
    // What the route really answers, including which way the documents are
    // short: nothing uploaded is the contractor's to fix, and this account can
    // only ask.
    REPLY = [409, { error: "documents_incomplete", missing: ["insurance", "bond"],
      absent: ["insurance", "bond"], unreviewed: [] }];
    const r = await pressIssue();
    t.ck("the assign form opened and a contractor was picked", r.opened && r.picked,
      JSON.stringify({ opened: r.opened, picked: r.picked }));
    t.ck("and Issue was live enough to press", r.pressed === true, String(r.pressed));
    t.ck("the request really went", CALLS === 1, String(CALLS));
    // THE ASSERTION THE LIVE PRODUCT FAILED.
    t.ck("the trade is STILL unassigned after a refusal", r.stillOpen === true, String(r.stillOpen));
    // WHAT THIS SUITE CANNOT REACH, said rather than faked: the feed entry
    // ("Issued a work order ...") is written by `logEvent` and read back from
    // the server on the Dashboard, so the stub cannot show it. It is guarded
    // by the same early return as the patch below and has no assertion of its
    // own -- an assertion that cannot fail is worse than none, which this
    // project has now recorded a dozen times.
    t.ck("and the contractor is not named against the trade either",
      r.namedOnJob === false, String(r.namedOnJob));
    t.ck("the note says plainly that nothing was issued",
      /No work order was issued/i.test(r.note), r.note);
    t.ck("and names the documents rather than the error code",
      /certificate of insurance/i.test(r.note) && !/documents_incomplete/.test(r.note), r.note);
    t.ck("and tells this account to ask, because nothing is on file",
      /has not uploaded/i.test(r.note), r.note);
  }

  console.log("\n-- on file, and waiting on THIS account's review --");
  {
    // The opposite instruction. Chasing a contractor for a certificate that is
    // already on file is a work order waiting a week on the one party who was
    // never the blocker.
    REPLY = [409, { error: "documents_incomplete", missing: ["insurance"],
      absent: [], unreviewed: ["insurance"] }];
    const r = await pressIssue();
    t.ck("still nothing drawn", r.stillOpen === true, String(r.stillOpen));
    t.ck("and the note sends them to their own review rather than to the contractor",
      /waiting on your review/i.test(r.note) && !/has not uploaded/i.test(r.note), r.note);
  }

  console.log("\n-- and the press the server took --");
  {
    // THE OTHER BRANCH, IN THE SAME PLACE. A fix that simply stopped drawing
    // would pass every assertion above and break the product -- the diagonal
    // coverage this project keeps recording.
    REPLY = [201, { id: "wo_1", woNumber: "WO-1", status: "pending",
      notified: { emailed: true, to: "juan@pacific.test" } }];
    const r = await pressIssue();
    t.ck("the slot fills when the server took it", r.stillOpen === false, String(r.stillOpen));
    t.ck("and the note confirms it was sent",
      /Work order sent to Pacific apartment maintenance/i.test(r.note), r.note);
    t.ck("and nothing says it was not issued",
      !/No work order was issued/i.test(r.note), r.note);
  }
} finally {
  await browser.close(); web.close(); api.close();
}

t.done();
