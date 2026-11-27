// A JOB BOOKED FROM THE AVAILABILITY GRID TAKES A RANGE OF DAYS, AND EVERY ONE
// OF THEM IS CHECKED AND BOOKED.
//
// Reported as "it needs to be a date range, not just a singular day of work
// (the work could only last one day or 30 days)". The job form's When step
// asked for a start and nothing else, so a five-day job booked from a free day
// held one cell on the grid, and the four after it went on reading free.
//
//   node --no-warnings scripts/job-range-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";
import { spanDates } from "../shared/span.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-jobrange-test");
const WEB = 5743, API = 9443;
const t = tally();

const pad = (n) => String(n).padStart(2, "0");
const key = (off) => { const d = new Date(); d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isWeekend = (k) => { const g = new Date(`${k}T12:00:00Z`).getUTCDay(); return g === 0 || g === 6; };
// The first weekday at least `from` days out, so the fixture does not depend
// on what day the suite runs.
const weekdayFrom = (from) => { let i = from; while (isWeekend(key(i))) i += 1; return i; };

const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_mgr", name: "Richard Braun", email: "rb@soundpm.test", role: "admin" },
};
const USERS = [{ id: "u_mgr", name: "Richard Braun", email: "rb@soundpm.test", phone: null, role: "admin",
  subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];
const verified = (kinds) => Object.fromEntries(kinds.map((k) =>
  [k, { status: "verified", verifiedBy: "Richard Braun", verifiedAt: "2026-10-01T00:00:00Z" }]));
const sub = (id, company, extra = {}) => ({
  id, company, engagementId: `en_${id}`, accountId: "acc_pm", contact: `${company} owner`,
  email: `${id}@test.test`, phone: null, categories: ["plumbing"], caps: [], crews: [],
  propertyIds: [], zips: [], notify: {}, rating: 0, ratedJobs: 0, bond: true, insurance: true,
  contract: true, w9: true, hasPortal: true, answersForItself: true, license: "BAY1", available: true,
  licenseCheck: { found: true, status: "ACTIVE", expirationDate: "2030-12-31", checkedAt: "2026-10-20", licenseNumber: "BAY1" },
  unavailableDays: [], docReview: verified(["insurance", "bond", "contract", "w9"]), coverage: {},
  engagedAs: "subcontractor", status: "active", ...extra,
});

// Bay Roofing holds a five-working-day job from the first weekday tomorrow
// or later. Crew Co holds a one-day job (no estimate) a few days on.
const S0 = weekdayFrom(1);
const spanStart = key(S0);
const spanDays = spanDates({ start: spanStart, days: 5 });
const CREW_BUSY = key(weekdayFrom(S0 + 2));
const job = (id, title, date, assignments, spans = {}) => ({
  id, accountId: "acc_pm", propertyId: null, title, status: "active", date, time: "09:00",
  address: "1 Main", area: "Seattle", zip: "98122", trades: ["plumbing"], assignments,
  notes: "", createdAt: "Oct 1", photos: [], severity: null, scope: "", measurementDocs: [],
  requestedBy: null, approvedAt: "2026-10-02", declinedAt: null, withdrawnAt: null, completedAt: null,
  readOnly: false, spans,
});
const JOBS = [
  job("j_span", "Five-day repipe", spanStart, {
    plumbing: { id: "wo1", wo: "WO-1", subId: "cmp_bay", company: "Bay Roofing", status: "accepted",
      auto: false, value: "100", crewName: null } },
  { plumbing: { start: spanStart, first: spanDays[0], end: spanDays[4], days: 5, weekends: false } }),
  job("j_crew", "Crew Co day", CREW_BUSY, {
    plumbing: { id: "wo2", wo: "WO-2", subId: "cmp_crew", company: "Crew Co", status: "accepted",
      auto: false, value: "100", crewName: "A" } }),
];
const SUBS = [
  sub("cmp_bay", "Bay Roofing"),
  sub("cmp_crew", "Crew Co", { crews: [{ id: "c1", name: "A", available: true, unavailableDays: [], members: [] }] }),
];

let posted = null;
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs" && method === "POST") { posted = body; return [201, { id: "j_new", requested: false }]; }
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/subs") return [200, SUBS];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path.startsWith("/api/jobs/") && path.endsWith("/assign")) return [201, { ok: true }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();
try {
  const m = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1340, height: 1200 } });
  await wait(2000);
  await m.page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^Availability/i.test(b.innerText.trim()))?.click());
  await wait(1500);
  const cells = (name) => m.page.evaluate((n) => {
    const kids = [...(document.querySelector(".cal-grid")?.children || [])];
    const i = kids.findIndex((el) => el.classList.contains("cal-sub") && el.innerText.includes(n));
    if (i < 0) return [];
    return kids.slice(i + 1, i + 15).map((c) => ({ day: c.dataset.day, cls: c.className }));
  }, name);

  console.log("\n-- the grid books every day of an estimate --");
  const bay = await cells("Bay Roofing");
  const inView = spanDays.filter((d) => bay.some((c) => c.day === d));
  t.ck("the grid is drawn", bay.length === 14, String(bay.length));
  t.ck("every working day of the five-day estimate is booked",
    inView.length > 1 && inView.every((d) => /booked/.test(bay.find((c) => c.day === d)?.cls || "")),
    JSON.stringify(inView.map((d) => bay.find((c) => c.day === d)?.cls)));
  t.ck("a day after the estimate ends is free",
    bay.filter((c) => c.day > spanDays[4]).some((c) => /\bup\b/.test(c.cls)), "");
  t.ck("a weekend inside the range is not booked (the crew does not work them)",
    bay.filter((c) => c.day > spanDays[0] && c.day < spanDays[4] && isWeekend(c.day)).every((c) => !/booked/.test(c.cls)), "");

  console.log("\n-- a range on the When step --");
  // Press Crew Co's first free day, which is the start.
  const start = await m.page.evaluate(() => {
    const kids = [...document.querySelector(".cal-grid").children];
    const i = kids.findIndex((el) => el.classList.contains("cal-sub") && el.innerText.includes("Crew Co"));
    const cell = kids.slice(i + 1, i + 15).find((c) => c.classList.contains("clickable"));
    cell?.click();
    return cell?.dataset.day || null;
  });
  await wait(700);
  t.ck("the day opens the choice of an open slot or a new job",
    await m.page.evaluate(() => [...document.querySelectorAll(".modal .ac-card")].some((b) => /Create a new job/.test(b.innerText))), "");
  await m.page.evaluate(() => [...document.querySelectorAll(".modal .ac-card")]
    .find((b) => /Create a new job/.test(b.innerText))?.click());
  await wait(700);
  const typeIn = (label, value) => m.page.evaluate((l, v) => {
    const lab = [...document.querySelectorAll(".modal label.fld")].find((x) => x.firstChild?.textContent?.trim().startsWith(l));
    const el = lab?.querySelector("input,textarea");
    if (!el) return false;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, label, value);
  const pressNext = () => m.page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")]
    .find((b) => /^Next/.test(b.innerText.trim()))?.click());
  t.ck("the job form opened from a free day", !!start && await m.page.evaluate(() => !!document.querySelector(".modal .job-steps")), String(start));
  await typeIn("Job name", "Bathroom remodel");
  await typeIn("Service address", "22 Pine St");
  await pressNext(); await wait(400);
  const startBox = await m.page.evaluate(() => [...document.querySelectorAll(".modal label.fld")]
    .find((x) => x.firstChild?.textContent?.trim().startsWith("Start date"))?.querySelector("input")?.value || "");
  t.ck("the day pressed on the grid is the start date", startBox === start, JSON.stringify({ startBox, start }));
  const whenAt = await m.page.evaluate(() => ({
    days: !!document.querySelector(".modal .job-len input[type=number]"),
    list: [...document.querySelectorAll(".modal .job-days-list li")].length,
  }));
  t.ck("the When step asks how many working days", whenAt.days, JSON.stringify(whenAt));
  t.ck("left empty it is one day, and that day is listed", whenAt.list === 1, String(whenAt.list));

  // Long enough to run into Crew Co's booked day.
  const want = spanDates({ start, days: 30 }).indexOf(CREW_BUSY) + 1;
  await typeIn("How many working days?", String(Math.max(want, 2)));
  await wait(300);
  const range = await m.page.evaluate(() => ({
    days: [...document.querySelectorAll(".modal .job-days-list li")].map((li) => ({ d: li.dataset.day, bad: li.classList.contains("bad") })),
    head: document.querySelector(".modal .job-days-head")?.innerText || "",
    warn: document.querySelector(".modal .job-days .for-sub.warn")?.innerText || "",
  }));
  const expect = spanDates({ start, days: Math.max(want, 2) });
  t.ck("every working day of the range is listed", JSON.stringify(range.days.map((x) => x.d)) === JSON.stringify(expect),
    JSON.stringify({ got: range.days.map((x) => x.d), expect }));
  t.ck("the day the contractor is already booked is marked", range.days.find((x) => x.d === CREW_BUSY)?.bad === true,
    JSON.stringify(range.days));
  t.ck("the other days are ticked free", range.days.filter((x) => x.d !== CREW_BUSY).every((x) => !x.bad), "");
  t.ck("the clash is named in words", /already booked/.test(range.warn), range.warn);

  // A length that ends before the clash: free on every day.
  await typeIn("How many working days?", "2");
  await wait(300);
  const ok = await m.page.evaluate(() => document.querySelector(".modal .job-days .for-sub")?.innerText || "");
  t.ck("a range clear of bookings says they are free on every day", /free on all 2 days/.test(ok), ok);

  await pressNext(); await wait(300);
  await pressNext(); await wait(300);
  await m.page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")]
    .find((b) => /Create job/.test(b.innerText))?.click());
  await wait(1200);
  const sp = posted?.spans?.plumbing;
  t.ck("the job is saved with the range as the trade's estimate",
    sp && sp.start === start && sp.days === 2 && sp.weekends === false, JSON.stringify(posted?.spans));
  t.ck("the screen did not crash", m.crashes.length === 0, JSON.stringify(m.crashes));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
