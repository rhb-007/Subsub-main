// A job that is finished with takes no more contractors -- on the screen AND
// on the route.
//
// Reported as "a completed job still looks like it can be edited". It was
// worse than it looked. The empty trade slot's action row had no `done` check
// at all, so a completed job drew Assign & issue WO, Ask for quotes and
// Overflow exactly as a live one did -- and every one of them WORKED, because
// `isClosed` lived in App.tsx and nowhere else:
//
//   POST /api/jobs/:jobId/assign  selected `id, requested_by, approved_at,
//     date` and never read `status`.
//   canRequestQuotes  checked `withdrawnAt` and never `status`.
//   POST /api/jobs/:jobId/overflow  checked neither.
//
// So neither half was holding the line. A work order issued against a job
// closed out last week is a contractor turning up to work nobody is
// expecting, and an overflow post reaches past this account to companies who
// would answer an offer that cannot be taken up.
//
// What the assertions have to be careful about:
//
//   THE ROUTE IS THE SUBJECT, NOT THE BUTTON. Hiding a control is not a gate
//   -- this file's oldest rule -- so the server checks are asserted on their
//   own, and a screen assertion that passed while the route was open is
//   exactly what happened here.
//
//   AND "A MODAL APPEARED" IS NOT THE PROPERTY. The confirmation could appear
//   and the job still complete behind it, so the API calls are counted: zero
//   until somebody agrees, one afterwards -- and Cancel has to leave the job
//   open.
//
//   node --no-warnings scripts/job-closed-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";
import { jobIsClosed, jobClosure, completionEffects, CLOSED_REASONS } from "../shared/jobstate.js";
import { canRequestQuotes } from "../shared/quotes.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-jobclosed-test");
const WEB = 5301, API = 9001;
const t = tally();
const APP = readFileSync(join(app, "src/App.tsx"), "utf8");
const WORKER = readFileSync(join(app, "worker/index.js"), "utf8");

// ---- the predicate -------------------------------------------------------
console.log("\n-- what counts as closed --");
{
  t.ck("a live job is not", jobIsClosed({ status: "active" }) === false);
  t.ck("completed is", jobIsClosed({ status: "completed" }) === true);
  t.ck("withdrawn is", jobIsClosed({ withdrawnAt: "2026-01-01" }) === true);
  t.ck("declined is", jobIsClosed({ declinedAt: "2026-01-01" }) === true);
  t.ck("and nothing at all is not", jobIsClosed(null) === false && jobIsClosed({}) === false);

  // BOTH SPELLINGS, because the browser holds `withdrawnAt` and the Worker
  // passes a raw row. A missed conversion reads as "not closed", which is the
  // direction that opens the gate -- so the snake_case half is the one worth
  // pinning hardest.
  t.ck("the Worker's row shape answers the same", jobIsClosed({ withdrawn_at: "2026-01-01" }) === true);
  t.ck("and its declined column too", jobIsClosed({ declined_at: "2026-01-01" }) === true);

  // Told apart by the words, because they are different events: "we finished
  // it" and "they took it back" need different sentences on the card.
  t.ck("each closure names itself", jobClosure({ status: "completed" }).reason === "completed"
    && jobClosure({ declinedAt: "x" }).reason === "declined");
  t.ck("and withdrawn outranks a stale completed status",
    jobClosure({ status: "completed", withdrawn_at: "x" }).reason === "withdrawn");
  t.ck("every reason has words to draw",
    Object.values(CLOSED_REASONS).every((r) => r.label && r.why));
}

console.log("\n-- what completing one costs, named rather than counted --");
{
  const j = { trades: ["roofing", "gutters", "siding"],
    assignments: { roofing: { status: "accepted" }, gutters: { status: "pending" } } };
  const e = completionEffects(j, { openQuotes: 2, openOverflow: 1 });
  t.ck("a trade nobody is on is named", e.unassigned.join() === "siding", JSON.stringify(e.unassigned));
  // The one the card cannot show: a slot IS filled, so it counts as 1/1 --
  // and the contractor has not said yes yet.
  t.ck("and so is one waiting on an answer", e.awaiting.join() === "gutters", JSON.stringify(e.awaiting));
  t.ck("an accepted trade is neither",
    !e.unassigned.includes("roofing") && !e.awaiting.includes("roofing"));
  t.ck("open quote requests carry through", e.openQuotes === 2 && e.openOverflow === 1);
  t.ck("and a fully-assigned job has nothing outstanding", (() => {
    const f = completionEffects({ trades: ["roofing"], assignments: { roofing: { status: "accepted" } } });
    return !f.unassigned.length && !f.awaiting.length;
  })());
  t.ck("a job with no trades does not throw", (() => {
    try { completionEffects({}); completionEffects(); return true; } catch { return false; }
  })());
}

// ---- the three routes ----------------------------------------------------
//
// THE HALF THAT WAS ACTUALLY BROKEN. Each of these is asserted on the route
// rather than on the button, because the buttons were there the whole time
// and so was the bug.
console.log("\n-- the routes refuse, not just the screen --");
{
  t.ck("asking for quotes on a completed job is refused",
    canRequestQuotes({ status: "completed" }, { role: "admin" }).ok === false);
  t.ck("and it says why", canRequestQuotes({ status: "completed" }, { role: "admin" }).reason === "job_closed");
  // Withdrawn keeps its own existing reason: a different thing happened and
  // the screen already has words for it.
  t.ck("withdrawn keeps the answer it already had",
    canRequestQuotes({ withdrawnAt: "x" }, { role: "admin" }).reason === "withdrawn");
  t.ck("a live job is still allowed",
    canRequestQuotes({ status: "active" }, { role: "admin" }).ok === true);

  // The assign route. The SELECT is asserted as well as the check: without
  // the column the predicate reads `undefined` and answers "not closed",
  // which is the gate failing open with nothing to see.
  const assign = (WORKER.match(/app\.post\("\/api\/jobs\/:jobId\/assign"[\s\S]{0,2600}/) || [""])[0];
  t.ck("the assign route reads the job's status at all", /status, withdrawn_at, declined_at/.test(assign));
  // 066 MOVED THE REFUSAL INTO ONE HELPER, and the property is stronger for
  // it rather than weaker: closed AND on hold are two different answers and
  // both have to refuse, so a route reading `jobClosure` alone would issue
  // the work order on a job somebody deliberately put on hold. What is
  // pinned is that the door reads the shared refusal, and that the refusal
  // itself answers both -- the second is what the first is worth.
  t.ck("and refuses through the shared refusal", /jobCommitRefusal\(job\)/.test(assign));

  const ovf = (WORKER.match(/app\.post\("\/api\/jobs\/:jobId\/overflow"[\s\S]{0,1800}/) || [""])[0];
  t.ck("the overflow route reads it too", /status, withdrawn_at, declined_at/.test(ovf));
  t.ck("and refuses through it as well", /jobCommitRefusal\(job\)/.test(ovf));

  const refusal = (WORKER.match(/function jobCommitRefusal\(job\)[\s\S]{0,700}/) || [""])[0];
  t.ck("which answers job_closed for a closure",
    /jobClosure\(job\)[\s\S]{0,160}job_closed/.test(refusal));
  t.ck("and job_deferred for a hold",
    /jobHold\(job[\s\S]{0,160}job_deferred/.test(refusal));

  // One predicate. A second copy in App.tsx is how the two sides drifted in
  // the first place.
  t.ck("and the browser reads the shared one rather than its own",
    /const isClosed = jobIsClosed;/.test(APP)
    && !/const isClosed = \(j\) => j\.status === "completed"/.test(APP));
}

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const ACCOUNT = {
  id: "acc_x", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};
const USERS = [{ id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];

const jobBase = {
  accountId: "acc_x", client: "", address: "14 Alder Way", area: "Seattle", zip: "98101",
  sqft: null, stories: null, time: "07:00", scope: "", materialSource: null,
  materialSupplier: null, materialBranch: null, materialsPaidBy: null,
  measurementDocs: [], photos: [], notes: "", requestedBy: null, approvedAt: null,
  withdrawnAt: null, declinedAt: null, severity: "standard", createdAtIso: "2026-09-01T00:00:00Z",
  readOnly: false, inherited: false, atOwnedProperty: false, propertyId: null,
};
// The reported one: completed, and nobody was ever on it.
const DONE_JOB = { ...jobBase, id: "job_done", title: "Zapier connection test",
  date: "2026-11-10", trades: ["roofing"], assignments: {},
  status: "completed", completedAt: "2026-10-01" };
const LIVE_JOB = { ...jobBase, id: "job_live", title: "Queen Anne Roofing - Demo",
  date: "2026-10-12", trades: ["roofing", "soffit_fascia"], assignments: {}, status: "active" };

let completes = 0;
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, [DONE_JOB, LIVE_JOB]];
  if (/^\/api\/jobs\/[^/]+\/complete$/.test(path)) { completes += 1; return [200, { ok: true }]; }
  if (path === "/api/subs" || path === "/api/properties" || path === "/api/invites"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/tenants" || path === "/api/clients") return [200, []];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });

const openJobs = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^jobs/i.test((b.innerText || "").trim()))?.click());
  await wait(1600);
  // "All", so the completed one is on screen beside the live one.
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^All\b/.test((b.innerText || "").trim()))?.click());
  await wait(900);
};

const readCard = (page, id) => page.evaluate((jid) => {
  const c = document.querySelector(`[data-job-id="${jid}"]`);
  if (!c) return null;
  const btns = [...c.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).filter(Boolean);
  const row = c.querySelector(".trade-row");
  return {
    done: c.className.includes("done"),
    buttons: btns,
    shut: (c.querySelector(".trade-shut")?.innerText || "").trim(),
    rowOpacity: row ? Number(getComputedStyle(row).opacity) : null,
  };
}, id);

try {
  console.log("\n-- a completed job offers nothing to press but Reopen --");
  {
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1800 } });
    await wait(2400);
    await openJobs(page);

    const done = await readCard(page, "job_done");
    t.ck("the completed card is on screen", !!done, String(done));
    t.ck("and is marked done", done?.done === true, String(done?.done));

    // THE REPORTED BUG, each named separately: one assertion over "no
    // buttons" would pass if the card failed to render at all, which is why
    // the card is read first.
    const b = (done?.buttons || []).join(" | ");
    t.ck("Assign & issue WO is gone", !/Assign/i.test(b), b);
    t.ck("Ask for quotes is gone", !/Ask for quotes/i.test(b), b);
    t.ck("Overflow is gone", !/Overflow/i.test(b), b);
    t.ck("Mark job complete is gone", !/Mark job complete/i.test(b), b);
    // The one way back, which the person asked for by name.
    t.ck("and Reopen is still there", /Reopen/i.test(b), b);

    // Said rather than left blank: an empty row where buttons were reads as a
    // screen that failed to draw.
    t.ck("the empty trade says the job is shut", /completed/i.test(done?.shut || ""), String(done?.shut));
    t.ck("and points at the way back", /reopen/i.test(done?.shut || ""), String(done?.shut));

    // Greyed, but not to the point of hiding the notes and ratings that are
    // the reason to open a finished job.
    t.ck("the trade rows are muted", done?.rowOpacity !== null && done.rowOpacity < 1,
      String(done?.rowOpacity));
    t.ck("and still readable", (done?.rowOpacity ?? 0) >= 0.6, String(done?.rowOpacity));

    // THE LIVE JOB IS UNTOUCHED. A fix that greys everything is not a fix,
    // and testing only the completed card cannot tell the two apart -- the
    // diagonal-coverage trap this repo already records about `hiresLabel`.
    const live = await readCard(page, "job_live");
    const lb = (live?.buttons || []).join(" | ");
    t.ck("a live job still offers Assign", /Assign/i.test(lb), lb);
    t.ck("and Ask for quotes", /Ask for quotes/i.test(lb), lb);
    t.ck("and Overflow", /Overflow/i.test(lb), lb);
    t.ck("and Mark job complete", /Mark job complete/i.test(lb), lb);
    t.ck("and is not greyed", live?.done === false && live?.rowOpacity === 1, String(live?.rowOpacity));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- completing asks first, and the question is what it costs --");
  {
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1800 } });
    await wait(2400);
    await openJobs(page);
    completes = 0;

    await page.evaluate(() => [...document.querySelectorAll('[data-job-id="job_live"] button')]
      .find((b) => /Mark job complete/i.test(b.innerText || ""))?.click());
    await wait(900);
    const modal = await page.evaluate(() => {
      const m = document.querySelector(".modal");
      return m ? { text: (m.innerText || "").replace(/\s+/g, " ").trim(),
        loose: [...m.querySelectorAll(".cc-loose li")].map((x) => x.textContent.trim()) } : null;
    });
    t.ck("a confirmation opens", !!modal, String(modal));
    t.ck("naming the job", /Queen Anne Roofing/i.test(modal?.text || ""), (modal?.text || "").slice(0, 80));
    // Not "are you sure": it says what completing DOES.
    t.ck("and saying it stops taking contractors",
      /Assign/i.test(modal?.text || "") && /Overflow/i.test(modal?.text || ""),
      (modal?.text || "").slice(0, 200));
    t.ck("and that it can be reopened", /reopen/i.test(modal?.text || ""), (modal?.text || "").slice(0, 200));
    // NAMED, NOT COUNTED. This job has two trades and nobody on either.
    t.ck("the unassigned trades are named",
      (modal?.loose || []).some((x) => /Roofing/i.test(x)) && (modal?.loose || []).some((x) => /Soffit/i.test(x)),
      JSON.stringify(modal?.loose));

    // THE PROPERTY UNDER TEST IS THE CALL, NOT THE MODAL. A modal can appear
    // and the request still go.
    t.ck("and nothing has been completed yet", completes === 0, String(completes));

    // Cancel has to leave it open -- a confirmation whose Cancel completes
    // anyway is worse than none, because it was asked and answered.
    await page.evaluate(() => [...document.querySelectorAll(".modal button")]
      .find((b) => /^Cancel$/i.test((b.innerText || "").trim()))?.click());
    await wait(700);
    t.ck("Cancel completes nothing", completes === 0, String(completes));
    t.ck("and closes the question", await page.evaluate(() => !document.querySelector(".modal")));

    // And agreeing is what does it.
    await page.evaluate(() => [...document.querySelectorAll('[data-job-id="job_live"] button')]
      .find((b) => /Mark job complete/i.test(b.innerText || ""))?.click());
    await wait(800);
    await page.evaluate(() => [...document.querySelectorAll(".modal button")]
      .find((b) => /Mark complete/i.test(b.innerText || ""))?.click());
    await wait(1200);
    t.ck("agreeing completes it, once", completes === 1, String(completes));
    t.ck("and the card closes down behind it", await page.evaluate(() => {
      const c = document.querySelector('[data-job-id="job_live"]');
      return !!c && c.className.includes("done");
    }));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- nothing threw --");
  t.ck("no \\uXXXX escape reached the page", !/\\u[0-9a-fA-F]{4}/.test(
    await (async () => {
      const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
        seat: { userId: "usr_r", accountId: "acc_x" } });
      await wait(2000);
      const txt = await page.evaluate(() => document.body.innerText);
      await ctx.close().catch(() => {});
      return txt;
    })()));
} finally {
  await browser.close().catch(() => {});
  web.close(); api.close();
}

t.done();
