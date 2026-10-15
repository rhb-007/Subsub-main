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
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

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
// What the roster row says about the documents, per block. "ok" is the
// fixture the server-refusal blocks need: a row that looks assignable.
// Whether the contractor has granted auto-schedule.
let AUTO = false;
let ROSTER = "ok";
// The reported row: a long name and three documents on file and unread.
let NAME = "Pacific apartment maintenance";
const reviewFor = () => ROSTER === "ok"
  ? { insurance: verified, bond: verified, contract: verified, w9: verified }
  : ROSTER === "toReview"
    // On file and unread: this account's own job.
    ? { insurance: { status: "pending" }, bond: { status: "pending" }, contract: { status: "pending" }, w9: verified }
    // Not uploaded: theirs.
    : { insurance: verified, contract: verified, w9: verified };
// THE FIXTURE IS A CONTRACTOR WHO LOOKS ASSIGNABLE FROM HERE. The roster row
// carries verified documents, because the refusal under test is the SERVER's
// -- a row the screen already knew was short would never reach the button, and
// a suite driving that case could not tell a guarded patch from a hidden one.
const SUBS = () => [{
  id: "sub_1", engagementId: "en_1", accountId: "acc_x",
  company: NAME, contact: "Juan Soto",
  phone: "(206)555-0100", email: "juan@pacific.test",
  city: "Seattle", state: "WA", zip: "98122", license: "PACIFI*123AB",
  licenseCheck: null,
  crews: [{ id: "c1", name: "Crew 1", available: true, unavailableDays: [], members: [{ name: "Joe", role: "Lead" }] }],
  coverage: { mode: "cities", cities: ["Seattle"] }, available: true, unavailableDays: [],
  warranty: null, insurance: 1, bond: ROSTER === "notIn" ? 0 : 1, contract: 1, w9: 1,
  docFiles: { insurance: "coi.pdf", bond: "bond.pdf", contract: "a.pdf", w9: "w9.pdf" },
  notify: { email: true, sms: false },
  docReview: reviewFor(),
  categories: ["painting"], caps: [], rating: 4.5, ratedJobs: 4, accepted: 4, declined: 0,
  notes: "", status: "active", propertyIds: [], hasPortal: false, answersForItself: false,
  autoSchedule: AUTO, engagedAs: "subcontractor",
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
  await openCards(page);
  const opened = await page.evaluate(() => { const b = document.querySelector(".trade-assign"); b?.click(); return !!b; });
  await wait(800);
  const picked = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".modal .rec-send")][0];
    b?.click(); return !!b;
  });
  await wait(700);
  await typeMoney(page, "1800");
  await wait(250);
  // THE DEADLINE CONTROL, read before the press. Auto-schedule means the work
  // order goes out accepted, so there is nothing to set a deadline on.
  const form = await page.evaluate(() => ({
    deadline: [...document.querySelectorAll(".modal label")]
      .some((l) => /Response deadline/i.test(l.innerText || "") && l.querySelector("select")),
    autoNote: (document.querySelector(".modal .wo-auto-note")?.innerText || "").replace(/\s+/g, " ").trim(),
  }));
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
    // THE REASON IN THE WINDOW. It used to close on a refusal and put the
    // reason in a toast at the foot of the page behind it.
    modalOpen: !!document.querySelector(".modal"),
    refused: (document.querySelector(".modal .assign-refused")?.innerText || "").replace(/\s+/g, " ").trim(),
    refusedReview: !!document.querySelector(".modal .assign-refused button"),
  }));
  await ctx.close();
  return { opened, picked, pressed, ...form, ...seen };
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
    t.ck("the window stays open after the refusal", r.modalOpen === true, String(r.modalOpen));
    t.ck("and says plainly, inside it, that nothing was issued",
      /No work order was issued/i.test(r.refused), r.refused);
    t.ck("and names the documents rather than the error code",
      /certificate of insurance/i.test(r.refused) && !/documents_incomplete/.test(r.refused), r.refused);
    t.ck("and tells this account to ask, because nothing is on file",
      /has not uploaded/i.test(r.refused), r.refused);
    t.ck("with no Review button, because there is nothing to review",
      r.refusedReview === false, String(r.refusedReview));
    t.ck("and no toast at the foot of the page saying it a second time",
      !/No work order was issued/i.test(r.note), r.note);
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
    t.ck("and the window sends them to their own review rather than to the contractor",
      /waiting on your review/i.test(r.refused) && !/has not uploaded/i.test(r.refused), r.refused);
    t.ck("with a Review button right there", r.refusedReview === true, String(r.refusedReview));
  }

  console.log("\n-- the list says it before anybody presses --");
  for (const mode of ["toReview", "notIn"]) {
    // THE REPORTED CASE: certificates on file and unread drew "Docs complete"
    // and a Select button, because the row read three presence flags rather
    // than what the route asks. The route then refused the press.
    ROSTER = mode;
    // At an iPad's width, where it was reported, with the reported name.
    NAME = mode === "toReview" ? "Puget Electricity / Plumbing" : "Pacific apartment maintenance";
    const { ctx, page } = await visitApp(browser, { host: "cascade", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" },
      viewport: { width: Number(process.env.VW || 1024), height: 1366 } });
    await wait(2600);
    await page.evaluate(() => [...document.querySelectorAll("nav button")]
      .find((b) => /^Jobs/i.test((b.innerText || "").trim()))?.click());
    await wait(800);
    await openCards(page);
    await page.evaluate(() => document.querySelector(".trade-assign")?.click());
    await wait(800);
    const row = await page.evaluate(() => {
      const r = document.querySelector(".modal .pick-row");
      if (!r) return null;
      return {
        text: (r.innerText || "").replace(/\s+/g, " "),
        buttons: [...r.querySelectorAll("button")].map((b) => (b.innerText || "").trim()),
      };
    });
    t.ck(`${mode}: the contractor is on the list`, !!row, JSON.stringify(row));
    t.ck(`${mode}: not called complete`, !!row && !/Docs complete/i.test(row.text), row?.text);
    t.ck(`${mode}: and offers no Select the route would refuse`,
      !!row && row.buttons.length > 0 && !row.buttons.some((b) => /^Select/.test(b)), JSON.stringify(row?.buttons));
    if (mode === "toReview") {
      // THE REPORTED LAYOUT: the review panel beside the name squeezed it to
      // a word a line and drew over the rating. Measured, because the markup
      // was right both times.
      const lay = await page.evaluate(() => {
        const r = document.querySelector(".modal .pick-row");
        const rect = (el) => el ? el.getBoundingClientRect() : null;
        const h4 = rect(r?.querySelector(".rec-head h4"));
        const main = rect(r?.querySelector(".rec-main"));
        const why = rect(r?.querySelector(".rec-why-review"));
        const starsEl = r?.querySelector(".stars");
        const st = rect(starsEl);
        const hit = st ? document.elementFromPoint(st.left + st.width / 2, st.top + st.height / 2) : null;
        const lh = h4 ? parseFloat(getComputedStyle(r.querySelector(".rec-head h4")).lineHeight) || 20 : 20;
        const chips = [...(r?.querySelectorAll(".rec-tags > span") || [])].map((c) => c.getBoundingClientRect().height);
        // NOTHING HANGS OFF THE CARD. Reported with "Review surety bond" and
        // "Request docs" cut off at the row's right edge: the panel was the
        // row's full width AND pushed in by the rank column, so it overran
        // by exactly that. Every box and every button is measured against
        // the row, and a button whose label is clipped inside it is caught
        // by its own scroll width.
        const rr = rect(r);
        const boxes = [...(r?.querySelectorAll(".rec-blocked, .rec-why, button") || [])].map((el) => ({
          what: (el.innerText || el.className).trim().slice(0, 30), right: el.getBoundingClientRect().right,
          clipped: el.scrollWidth > el.clientWidth + 1 }));
        const over = boxes.filter((b) => b.right > rr.right - 1 || b.clipped);
        return { over, h4: h4 && { w: h4.width, h: h4.height }, lh, mainBottom: main?.bottom, whyTop: why?.top,
          whyW: why?.width, rowW: rect(r)?.width, starsHit: !!(hit && starsEl.contains(hit)), chips };
      });
      t.ck("toReview: the name sits on one line, not a word a line",
        !!lay.h4 && lay.h4.h < lay.lh * 1.6 && lay.h4.w > 150, JSON.stringify(lay));
      t.ck("toReview: the rating is drawn on top, not under the panel", lay.starsHit === true, JSON.stringify(lay));
      t.ck("toReview: the review panel is under the name block, not beside it",
        lay.whyTop != null && lay.mainBottom != null && lay.whyTop >= lay.mainBottom - 1, JSON.stringify(lay));
      t.ck("toReview: and it takes most of the row's width",
        lay.whyW != null && lay.rowW != null && lay.whyW > lay.rowW * 0.75, JSON.stringify(lay));
      t.ck("toReview: nothing runs off the right edge of the row, and no button is cut off",
        Array.isArray(lay.over) && lay.over.length === 0, JSON.stringify(lay.over));
      t.ck("toReview: no chip wraps onto a second line",
        lay.chips.length > 0 && lay.chips.every((h) => h < 28), JSON.stringify(lay.chips));
      t.ck("toReview: says it is waiting on YOUR review, naming the document",
        /Waiting on your review/i.test(row?.text || "") && /Certificate of insurance/i.test(row?.text || ""), row?.text);
      t.ck("toReview: the action is Review, not Request docs",
        (row?.buttons || []).some((b) => /^Review certificate of insurance/i.test(b))
          && !(row?.buttons || []).some((b) => /Request docs/i.test(b)), JSON.stringify(row?.buttons));
      // Pressing it opens the review over the assign window, which is still
      // underneath to come back to.
      await page.evaluate(() => [...document.querySelectorAll(".modal .pick-row button")]
        .find((b) => /^Review/i.test((b.innerText || "").trim()))?.click());
      await wait(700);
      const after = await page.evaluate(() => {
        const ms = [...document.querySelectorAll(".modal")];
        return { count: ms.length, top: (ms[ms.length - 1]?.innerText || "").slice(0, 400).replace(/\s+/g, " ") };
      });
      t.ck("toReview: Review opens the document review over the assign window",
        after.count >= 2 && /insurance/i.test(after.top) && !/Assign painting contractor/i.test(after.top),
        JSON.stringify(after));
    } else {
      t.ck("notIn: says what is not uploaded, and asks them",
        /Not uploaded yet/i.test(row?.text || "") && /Surety bond/i.test(row?.text || "")
          && (row?.buttons || []).some((b) => /Request docs/i.test(b)), JSON.stringify(row));
      const over = await page.evaluate(() => {
        const r = document.querySelector(".modal .pick-row");
        if (!r) return null;
        const right = r.getBoundingClientRect().right;
        return [...r.querySelectorAll(".rec-blocked, .rec-why, button")]
          .filter((el) => el.getBoundingClientRect().right > right - 1 || el.scrollWidth > el.clientWidth + 1)
          .map((el) => (el.innerText || el.className).trim().slice(0, 30));
      });
      t.ck("notIn: Request docs stays inside the row, at an iPad's width",
        Array.isArray(over) && over.length === 0, JSON.stringify(over));
      t.ck("notIn: and no Review button, because there is nothing on file to review",
        !(row?.buttons || []).some((b) => /^Review/i.test(b)), JSON.stringify(row?.buttons));
    }
    await ctx.close();
  }
  ROSTER = "ok";

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
    t.ck("a contractor without auto-schedule gets the response deadline", r.deadline === true, String(r.deadline));
    t.ck("and no auto-schedule note", r.autoNote === "", r.autoNote);
  }

  console.log("\n-- a contractor who has granted auto-schedule --");
  {
    // BOTH BRANCHES IN THE SAME PLACE: the deadline is withheld only where it
    // means nothing, and asserted present just above.
    AUTO = true;
    REPLY = [201, { id: "wo_2", woNumber: "WO-2", status: "accepted",
      notified: { emailed: true, to: "juan@pacific.test" } }];
    const r = await pressIssue();
    t.ck("auto-schedule: no response deadline drop-down", r.deadline === false, String(r.deadline));
    t.ck("auto-schedule: one line says why, naming the contractor",
      /Auto-schedule is on/i.test(r.autoNote) && /Pacific apartment maintenance/.test(r.autoNote), r.autoNote);
    t.ck("auto-schedule: Issue still works", r.pressed === true && CALLS === 1, `${r.pressed} ${CALLS}`);
    AUTO = false;
  }
} finally {
  await browser.close(); web.close(); api.close();
}

t.done();
