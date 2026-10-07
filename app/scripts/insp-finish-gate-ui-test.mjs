// A flagged walk is finished only once its job is raised, and auto-schedule
// says WHY it could not place a turnaround, on the inspection, with the way on.
//
// Asked for as *"if there is an issue, it should not let you finish, only
// raise one"* and *"it told me it could not auto match ... it needs to be on
// that interface when it tells you this instead of a dead end. Also, why did
// the automatic match get rejected?"*. Driven in a browser because both halves
// are what is on screen: which button is drawn, and what the panel names.
//
//   node --no-warnings scripts/insp-finish-gate-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-insp-finish-gate-test");
const WEB = 5395, API = 9095;
const t = tally();

const acct = {
  id: "acc_x", name: "Sound Property Management", subdomain: "soundpm", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["flooring"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active", autoTurnaround: true,
  user: { id: "usr_r", name: "Christopher Lane", email: "chris@x.test", role: "admin" },
};
const JOB = {
  id: "job_9", accountId: "acc_x", propertyId: "prop_1", title: "Move-out repairs, unit 10B",
  trades: ["flooring"], assignments: {}, status: "active", date: "2026-10-09", address: "1620 Belmont Ave",
  scope: "Kitchen — Fail", notes: "", photos: [], createdAt: "2026-10-07", updatedAt: "2026-10-07",
};
let DETAIL, jobsNow, raised;
const reset = () => {
  raised = [];
  jobsNow = [];
  DETAIL = {
    id: "insp_1", propertyId: "prop_1", unit: "10B", kind: "move_out", tenantName: "",
    inspectedOn: "2026-10-06", status: "draft", finishedAt: null, jobId: null, job: null,
    createdAt: "2026-10-06 00:00:00", aiDrafts: false, recipients: [], sends: [], reopens: [],
    rooms: [
      { id: "r1", name: "Kitchen", status: "fail", note: "Floor needs refinishing and polishing", position: 0, photos: [] },
      { id: "r2", name: "Hallway", status: "ok", note: "", position: 1, photos: [] },
    ],
  };
};
reset();
const AUTO = {
  skipped: "no_candidate", considered: 2, trade: "flooring",
  passedOver: [
    { companyId: "c1", company: "Pacific apartment maintenance", why: "documents", kinds: ["insurance", "bond"] },
    { companyId: "c2", company: "Acme Roofing", why: "not_this_trade", handyman: false },
  ],
};
const api = serveApi({ port: API, delay: 60, routes: (path, method, body) => {
  if (path === "/api/inspections" && method === "GET") return [200, [{ id: "insp_1", propertyId: "prop_1",
    unit: "10B", kind: "move_out", status: DETAIL.status, rooms: 2, flagged: 1, unchecked: 0,
    jobId: DETAIL.jobId, createdAt: "2026-10-06" }]];
  if (path === "/api/inspections/insp_1" && method === "GET") return [200, DETAIL];
  if (path === "/api/inspections/insp_1/job" && method === "POST") {
    raised.push(body);
    DETAIL = { ...DETAIL, jobId: "job_9", job: { id: "unassigned", tone: "wait", label: "Needs a contractor" } };
    jobsNow = [JOB];
    return [201, { jobId: "job_9", auto: AUTO }];
  }
  if (path === "/api/jobs" && method === "GET") return [200, jobsNow];
  if (path.startsWith("/api/account-by-subdomain/") || path === "/api/account") return [200, acct];
  if (path === "/api/account-users") return [200, [{ id: "usr_r", name: "Christopher Lane",
    email: "chris@x.test", role: "admin", propertyIds: [], hasLogin: true }]];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_x", name: "Press Apartments",
    address: "1620 Belmont Ave", city: "Seattle", state: "WA", zip: "98122", units: 141, notes: "" }]];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });
const web = serveApp({ dir: OUT, port: WEB });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const read = (page) => page.evaluate(() => {
  const acts = [...document.querySelectorAll(".pd-acts button")].map((b) => (b.innerText || "").trim());
  const miss = document.querySelector(".insp-automiss");
  const modalH = [...document.querySelectorAll(".modal h2")].map((h) => (h.innerText || "").trim());
  return {
    onInspection: [...document.querySelectorAll(".dash-hello h2")].some((h) => /^Inspection$/i.test(h.innerText.trim())),
    acts,
    finish: acts.some((a) => /Finish inspection/.test(a)),
    raise: acts.some((a) => /Raise a job/.test(a)),
    notes: [...document.querySelectorAll(".fld-note")].map((n) => n.innerText),
    miss: miss ? miss.innerText : null,
    missBtns: miss ? [...miss.querySelectorAll("button")].map((b) => b.innerText.trim()) : [],
    modalH,
  };
});
const open = async () => {
  const { ctx, page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1200, height: 1300 } });
  await wait(2600);
  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^inspections/i.test((b.innerText || "").trim()))?.click());
  await wait(900);
  await page.evaluate(() => document.querySelector(".insp-row")?.click());
  await wait(1200);
  return { ctx, page };
};

try {
  console.log("\n-- a flagged walk with no job: raise, do not finish --");
  const { ctx, page } = await open();
  let s = await read(page);
  t.ck("the inspection opened", s.onInspection, JSON.stringify(s));
  t.ck("Raise a job is offered", s.raise, JSON.stringify(s.acts));
  // The property under test is the BUTTON NOT BEING THERE. A greyed Finish
  // beside Raise reads as two choices, which is what was asked to go.
  t.ck("and Finish is not", !s.finish, JSON.stringify(s.acts));
  t.ck("with the reason said where it would be",
    s.notes.some((n) => /Raise the job for the flagged room first/.test(n)), JSON.stringify(s.notes));

  console.log("\n-- raising it, and auto-schedule could not place it --");
  await page.evaluate(() => [...document.querySelectorAll(".pd-acts button")]
    .find((b) => /Raise a job/.test(b.innerText))?.click());
  await wait(600);
  await page.evaluate(() => [...document.querySelectorAll(".modal button")]
    .find((b) => /Raise the job/.test(b.innerText))?.click());
  await wait(1500);
  s = await read(page);
  t.ck("the job was raised", raised.length === 1, JSON.stringify(raised));
  // A MISS STAYS HERE. Jumping to the Jobs list on the back of "assign it by
  // hand" was the dead end reported.
  t.ck("and the screen stays on the inspection", s.onInspection, JSON.stringify(s.modalH));
  t.ck("which says auto-schedule could not place it", /none could take Flooring/.test(s.miss || ""), String(s.miss));
  t.ck("naming each company it passed over, with the documents it is waiting on",
    /Pacific apartment maintenance: documents not verified yet \(Certificate of insurance, Surety bond\)/
      .test(s.miss || ""),
    String(s.miss));
  t.ck("and the one not set up for the trade", /Acme Roofing: not set up for Flooring/.test(s.miss || ""), String(s.miss));
  t.ck("with a way on", s.missBtns.some((b) => /Pick a contractor/.test(b)), JSON.stringify(s.missBtns));
  // And the job is raised, so Finish is the next thing and is now drawn.
  t.ck("Finish is offered now the job exists", s.finish, JSON.stringify(s.acts));

  await page.evaluate(() => [...document.querySelectorAll(".insp-automiss button")]
    .find((b) => /Pick a contractor/.test(b.innerText))?.click());
  await wait(1200);
  s = await read(page);
  t.ck("Pick a contractor opens the assign form for that trade",
    s.modalH.some((h) => /Assign flooring \/ carpet contractor/i.test(h)), JSON.stringify(s.modalH));
  t.ck("over the inspection, not instead of it", s.onInspection);
  await ctx.close().catch(() => {});
} catch (e) {
  t.ck("the suite ran without throwing", false, e?.stack || String(e));
} finally {
  await browser.close().catch(() => {});
  web.close(); api.close();
}
t.done();
