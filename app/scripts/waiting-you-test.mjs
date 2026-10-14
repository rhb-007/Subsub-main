// WAITING ON YOU: every place a workflow has stopped until this account
// answers, on the dashboard, with the answer beside it.
//
// Reported with three screenshots of one job. The tenant's screen read "You
// said Oct 14 works -- waiting on Sound Property Management to confirm it";
// the handyman had put that time forward; and the manager's dashboard filed
// the job under "Ready to mark complete", saying nothing about a time at all,
// beside another reading "All 0 trade accepted". The answer existed, inside the
// job card, and nothing on the dashboard said it was wanted.
//
// Three dashboards, each measured as drawn:
//   - the MANAGER gets a Waiting on you panel above the schedule with the time
//     to approve (and Approve working from the row), a window that was turned
//     down, a crew's suggested length, and an approved job with no trade --
//     and NOT a declined window a newer proposal already replaced, nor a time
//     that is the crew's turn. Ready to mark complete no longer lists a job
//     with no trades or a time still being agreed, and still lists one whose
//     agreed day has passed;
//   - the TENANT gets a time put to them as a section of its own, first;
//   - the CONTRACTOR gets a time put to them as a section of its own, above
//     job requests, and it is not repeated in Current & upcoming.
//
//   node --no-warnings scripts/waiting-you-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-waitingyou-test");
const WEB = 5433, API = 9203;
const t = tally();

const pad = (n) => String(n).padStart(2, "0");
const key = (off) => { const d = new Date(); d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_mgr", name: "Richard Braun", email: "rb@soundpm.test", role: "admin" },
};
let SEAT = { userId: "u_mgr", accountId: "acc_pm", role: "admin" };
const USERS = [
  { id: "u_mgr", name: "Richard Braun", email: "rb@soundpm.test", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "u_ten", name: "John Smith", email: "js@t.test", phone: null, role: "tenant",
    subId: null, propertyIds: ["prop_1"], unit: "53", hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "u_sub", name: "Juan Soto", email: "juan@pacific.test", phone: null, role: "contractor",
    subId: "cmp_pac", propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
];
const SUB = {
  id: "cmp_pac", company: "Pacific apartment maintenance", engagementId: "en_pac",
  accountId: "acc_pm", contact: "Juan Soto", email: "juan@pacific.test", phone: null,
  categories: ["windows_doors", "painting"], caps: [], crews: [], propertyIds: [], zips: [],
  notify: {}, rating: null, bond: true, insurance: true, contract: true, w9: true,
  hasPortal: true, license: "", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {}, engagedAs: "handyman",
};
const acc = (trade, extra = {}) => ({ [trade]: {
  id: `wo-${trade}`, wo: `WO-${trade}`, subId: "cmp_pac", company: "Pacific apartment maintenance",
  status: "accepted", auto: false, responseWindow: null, respondBy: null, respondedAt: null,
  value: "300", payKind: "fixed", rate: "", capHours: null, tradeScope: null, crewName: null,
  signedWO: null, rating: null, ...extra } });
const job = (id, title, extra = {}) => ({
  id, accountId: "acc_pm", propertyId: "prop_1", title, status: "active",
  date: key(-2), time: "09:00", address: "1620 Belmont Ave", area: "Seattle", zip: "98122",
  trades: ["windows_doors"], assignments: acc("windows_doors"), notes: "", createdAt: "Oct 1",
  createdAtIso: "2026-10-01T00:00:00Z", photos: [], severity: null, client: null, sqft: null,
  stories: null, scope: "", measurementDocs: [], materialSource: null, materialsPaidBy: null,
  requestedBy: "u_ten", approvedAt: "2026-10-02", declinedAt: null, withdrawnAt: null,
  completedAt: null, access: null, accessEffective: "tenant", accessUserId: "u_ten",
  reportDetail: null, propertyName: "Press Apartments", readOnly: false, spans: {}, ...extra,
});
const JOBS = () => [
  // THE REPORTED ONE: the handyman countered, the tenant already said yes, and
  // the chain has reached the hiring side. Every trade is accepted, which is
  // exactly why it used to read as ready to complete.
  job("j_time", "Bedrooom window frame seems to be bent"),
  // A proposed time that has already GONE BY, reported at 3:54 PM over a 9-10
  // AM window that morning: not a question any more, so never an Approve.
  job("j_gone", "Shower head leaks"),
  // "All 0 trade accepted": approved, with no trade on it.
  job("j_zero", "Torn upholstery on lounge chair", { trades: [], assignments: {} }),
  // The newest window was turned down by the tenant.
  job("j_decl", "Kitchen tap drips"),
  // An OLD declined window a newer proposal has since replaced. The old
  // section read every declined row and still showed this one.
  job("j_old", "Hall light flickers", { date: key(5) }),
  // A time that is the CREW's to answer, not ours.
  job("j_crew", "Balcony door sticks", { date: key(5) }),
  // The crew suggested a different length.
  job("j_span", "Repaint unit 12", { date: key(6), trades: ["painting"], assignments: acc("painting"),
    spans: { painting: { start: key(6), days: 2, weekends: false, first: key(6), end: key(7),
      proposal: { start: key(6), days: 4, end: key(9), note: "Two coats and the trim", by: "Juan Soto" } } } }),
  // A REQUEST that names no trade: approving it as it stood made a job nobody
  // could ever be sent to, so the trade is picked where it is approved.
  job("j_req", "Lounge chair cushion split", { trades: [], assignments: {}, approvedAt: null, date: key(4) }),
  // Genuinely ready: its agreed day has passed.
  job("j_ready", "Replace closet door", { date: key(-3) }),
];
const T = "2026-10-10T12:00:00.000Z";
const v = (id, jobId, extra) => ({ id, jobId, status: "proposed", date: key(3), startTime: "09:00",
  endTime: "10:00", note: "", tenantNote: null, respondedAt: null, contractorAt: null,
  contractorNote: null, managerAt: null, proposedBy: "u_sub", createdAt: T,
  parties: ["contractor", "manager", "tenant"], ...extra });
const VISITS = () => [
  v("v_time", "j_time", { contractorAt: T, respondedAt: T, turn: "manager", waitingOn: ["manager"] }),
  v("v_gone", "j_gone", { date: key(-1), contractorAt: T, turn: "manager", waitingOn: ["manager", "tenant"] }),
  v("v_decl", "j_decl", { status: "declined", tenantNote: "I'm at work until 6", turn: null }),
  v("v_old1", "j_old", { status: "declined", tenantNote: "old", createdAt: "2026-10-05T00:00:00.000Z", turn: null }),
  v("v_old2", "j_old", { status: "confirmed", contractorAt: T, managerAt: T, respondedAt: T, date: key(5), turn: null }),
  v("v_crew", "j_crew", { proposedBy: "u_mgr", managerAt: T, turn: "contractor", waitingOn: ["contractor", "tenant"] }),
  v("v_ready", "j_ready", { status: "confirmed", date: key(-3), contractorAt: T, managerAt: T, respondedAt: T, turn: null }),
];

const answered = [];
const approvals = [];
let VIS = VISITS();
const PROP = { id: "prop_1", accountId: "acc_pm", name: "Press Apartments", address: "1620 Belmont Ave",
  city: "Seattle", state: "WA", zip: "98122", units: 60, notes: "", ownedByAnother: false, ownerDeclared: false };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, { ...PM, user: { ...PM.user, id: SEAT.userId, role: SEAT.role } }];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, JOBS()];
  if (path === "/api/visits") return [200, VIS];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/properties") return [200, [PROP]];
  if (/^\/api\/visits\/[^/]+\/respond$/.test(path) && method === "POST") {
    const id = path.split("/")[3];
    answered.push({ id, body });
    const row = VIS.find((x) => x.id === id);
    const next = { ...row, status: "confirmed", managerAt: T, turn: null, waitingOn: [] };
    VIS = VIS.map((x) => (x.id === id ? next : x));
    return [200, next];
  }
  if (/^\/api\/jobs\/[^/]+\/approve$/.test(path) && method === "POST") {
    approvals.push({ id: path.split("/")[3], body });
    return [200, { ok: true, trades: body?.trades || [] }];
  }
  if (path === "/api/my-work") {
    // The crew's own list: one window that is theirs to answer, one that is not.
    const row = (j, vis) => ({ woId: `wo-${j.id}`, wo: `WO-${j.id}`, jobId: j.id, trade: j.trades[0],
      accountId: "acc_pm", accountName: "Sound Property Management", accountSubdomain: "soundpm",
      accountKind: "property_manager", here: true, status: "accepted", auto: false,
      responseWindow: null, respondBy: null, respondedAt: null, title: j.title, address: j.address,
      area: j.area, zip: j.zip, propertyName: null, date: j.date, time: j.time, severity: null,
      jobStatus: "active", completedAt: null, tradeScope: null, crewName: null, payKind: "fixed",
      value: "300", rate: "", capHours: null, signedWO: null, issuedAt: null, updatedAtIso: null,
      visit: vis && { id: vis.id, date: vis.date, startTime: vis.startTime, endTime: vis.endTime,
        status: vis.status, note: null, contractorAt: vis.contractorAt, turn: vis.turn, waitingOn: vis.waitingOn } });
    return [200, { work: [
      row(JOBS().find((j) => j.id === "j_crew"), VIS.find((x) => x.id === "v_crew")),
      row(JOBS().find((j) => j.id === "j_time"), { ...VIS.find((x) => x.id === "v_time") }),
      row(JOBS().find((j) => j.id === "j_gone"), { ...VIS.find((x) => x.id === "v_gone"), turn: "contractor", contractorAt: null }),
    ] }];
  }
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/invites" || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/tenants" || path === "/api/clients" || path === "/api/notices"
    || path === "/api/my-notices") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const panel = (page) => page.evaluate(() => {
  const s = document.querySelector(".dash-sec.sec-yt");
  if (!s) return null;
  const rows = [...s.querySelectorAll(".yt-row")].map((r) => ({
    kind: r.dataset.yt, title: r.querySelector(".dr-title")?.innerText || "",
    lede: r.querySelector(".yt-lede")?.innerText || "", when: r.querySelector(".yt-when")?.innerText || "",
    meta: r.querySelector(".dr-meta")?.innerText || "",
    acts: [...r.querySelectorAll(".vact")].map((b) => b.innerText.trim()),
    err: r.querySelector(".dash-row-err")?.innerText || null }));
  return { count: s.querySelector(".sec-count")?.innerText || "", rows,
    more: s.querySelector(".dash-more")?.getAttribute("data-total") || null,
    top: s.getBoundingClientRect().top,
    schedTop: document.querySelector(".dash-top")?.getBoundingClientRect().top ?? null };
});

try {
  console.log("\n-- the manager --");
  const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1340, height: 1400 } });
  await wait(2600);
  let p = await panel(page);
  t.ck("a Waiting on you panel is on the dashboard", !!p, String(p));
  t.ck("it counts the five things waiting", p?.count === "5", p?.count);
  t.ck("it sits above the schedule row", p && p.schedTop !== null && p.top < p.schedTop,
    JSON.stringify({ top: p?.top, sched: p?.schedTop }));
  // Open the whole list so every row can be read.
  await page.evaluate(() => document.querySelector(".dash-sec.sec-yt .dash-more")?.click());
  await wait(400);
  p = await panel(page);
  const kinds = (p?.rows || []).map((r) => `${r.kind}:${r.title}`);
  t.ck("the time to approve leads", kinds[0] === "time:Bedrooom window frame seems to be bent", JSON.stringify(kinds));
  const time = p?.rows.find((r) => r.kind === "time");
  t.ck("it says who proposed it", /Pacific apartment maintenance proposed a new time/.test(time?.lede || ""), time?.lede);
  t.ck("the window is on a line of its own", /9 AM/.test(time?.when || ""), time?.when);
  t.ck("and that the tenant already said yes", /John Smith \(the tenant\) already said it works/.test(time?.meta || ""), time?.meta);
  t.ck("Approve is on the row", (time?.acts || []).includes("Approve this time"), JSON.stringify(time?.acts));
  const gone = p?.rows.find((r) => r.kind === "lapsed");
  t.ck("a proposed time that has gone by is on it as passed", gone?.title === "Shower head leaks"
    && /has passed/.test(gone?.lede || ""), JSON.stringify(gone));
  t.ck("and it is NOT offered for approval", !!gone && !(gone.acts || []).includes("Approve this time"), JSON.stringify(gone?.acts));
  t.ck("it leads with proposing a new time", (gone?.acts || [])[0] === "Propose a new time", JSON.stringify(gone?.acts));
  t.ck("and says nothing was booked", /Nobody booked it/.test(gone?.meta || ""), gone?.meta);
  const decl = p?.rows.find((r) => r.kind === "declined");
  t.ck("a turned-down window is on it, with the reason", decl?.title === "Kitchen tap drips"
    && /I'm at work until 6/.test(decl?.meta || "") && /can't make it/.test(decl?.lede || ""), JSON.stringify(decl));
  t.ck("an old decline a newer proposal replaced is NOT", !kinds.some((k) => /Hall light/.test(k)), JSON.stringify(kinds));
  t.ck("a time that is the crew's turn is NOT", !kinds.some((k) => /Balcony door/.test(k)), JSON.stringify(kinds));
  const span = p?.rows.find((r) => r.kind === "span");
  t.ck("a crew's suggested length is on it, with both answers", /says Painting takes 4 working days/.test(span?.lede || "")
    && (span?.acts || []).includes("Use theirs") && (span?.acts || []).includes("Keep ours"), JSON.stringify(span));
  const zero = p?.rows.find((r) => r.kind === "notrade");
  t.ck("an approved job with no trade is on it", zero?.title === "Torn upholstery on lounge chair"
    && (zero?.acts || []).includes("Add a trade"), JSON.stringify(zero));

  console.log("\n-- ready to mark complete --");
  await page.evaluate(() => document.querySelector(".dash-back")?.click());
  await wait(400);
  const ready = await page.evaluate(() => {
    const s = [...document.querySelectorAll(".dash-sec")].find((x) => /Ready to mark complete/i.test(x.querySelector("h3")?.innerText || ""));
    return s ? [...s.querySelectorAll(".dr-title")].map((x) => x.innerText) : null;
  });
  t.ck("the section is on the page", Array.isArray(ready), String(ready));
  t.ck("it lists the job whose agreed day has passed", (ready || []).includes("Replace closet door"), JSON.stringify(ready));
  t.ck("not one with no trades", !(ready || []).includes("Torn upholstery on lounge chair"), JSON.stringify(ready));
  t.ck("not one whose time is still being agreed", !(ready || []).includes("Bedrooom window frame seems to be bent"), JSON.stringify(ready));

  console.log("\n-- approving from the row --");
  const pressed = await page.evaluate(() => {
    const r = document.querySelector(".dash-sec.sec-yt .yt-row[data-yt='time']");
    const b = r && [...r.querySelectorAll(".vact")].find((x) => /Approve this time/.test(x.innerText));
    if (b) b.click(); return !!b;
  });
  t.ck("Approve this time is pressed", pressed);
  await wait(900);
  t.ck("it answered the window as the hiring side",
    answered.length === 1 && answered[0].id === "v_time" && answered[0].body?.status === "confirmed", JSON.stringify(answered));
  p = await panel(page);
  t.ck("and the row has left the panel", !(p?.rows || []).some((r) => r.kind === "time"), JSON.stringify(p?.rows?.map((r) => r.kind)));

  console.log("\n-- a request with no trade --");
  const reqRow = await page.evaluate(() => {
    const s = [...document.querySelectorAll(".dash-sec")].find((x) => /Work requests/i.test(x.querySelector("h3")?.innerText || ""));
    const r = s && [...s.querySelectorAll(".dash-row")].find((x) => /Lounge chair/.test(x.innerText));
    const b = r && r.querySelector(".dash-row-btn");
    return { has: !!r, btn: b?.innerText.trim() || null };
  });
  t.ck("the request is on the dashboard", reqRow.has, JSON.stringify(reqRow));
  t.ck("its button says to pick a trade, not Approve", /Pick a trade/.test(reqRow.btn || "")
    && !/^Approve$/.test(reqRow.btn || ""), JSON.stringify(reqRow));
  await page.evaluate(() => {
    const s = [...document.querySelectorAll(".dash-sec")].find((x) => /Work requests/i.test(x.querySelector("h3")?.innerText || ""));
    const r = s && [...s.querySelectorAll(".dash-row")].find((x) => /Lounge chair/.test(x.innerText));
    r?.querySelector(".dash-row-btn")?.click();
  });
  await wait(500);
  const detail = () => page.evaluate(() => {
    const m = document.querySelector(".modal");
    const sec = m?.querySelector("[data-req-trade]");
    const approve = m && [...m.querySelectorAll(".form-actions .btn-solid")].find((b) => /Approv/.test(b.innerText));
    return { open: !!m, trade: !!sec, chips: sec ? [...sec.querySelectorAll(".chip")].map((c) => c.innerText.trim()) : [],
      approveDisabled: approve ? approve.disabled : null, warn: sec?.querySelector(".warn")?.innerText || "" };
  });
  let d = await detail();
  t.ck("pressing it opens the request with a trade picker", d.open && d.trade, JSON.stringify(d));
  t.ck("Approve waits until a trade is picked", d.approveDisabled === true, JSON.stringify(d));
  t.ck("a trade somebody on the roster covers is listed first", /^(Windows \/ Doors|Painting)\s*1$/.test(d.chips[0] || ""), JSON.stringify(d.chips.slice(0, 3)));
  await page.evaluate(() => {
    const c = [...document.querySelectorAll(".modal [data-req-trade] .chip")].find((x) => /^Plumbing/.test(x.innerText.trim()));
    c?.click();
  });
  await wait(250);
  d = await detail();
  t.ck("a trade nobody covers says so, and still lets it through", /Nobody on your roster does Plumbing/.test(d.warn)
    && d.approveDisabled === false, JSON.stringify(d));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".modal .form-actions .btn-solid")].find((x) => /Approve/.test(x.innerText));
    b?.click();
  });
  await wait(800);
  t.ck("approving sends the trade with it", approvals.length === 1 && approvals[0].id === "j_req"
    && JSON.stringify(approvals[0].body?.trades) === JSON.stringify(["plumbing"]), JSON.stringify(approvals));

  console.log("\n-- not work we handle --");
  await page.evaluate(() => document.querySelector(".dash-sec.sec-yt .dash-more")?.click());
  await wait(400);
  const ended = await page.evaluate(() => {
    const r = document.querySelector(".dash-sec.sec-yt .yt-row[data-yt='notrade']");
    const b = r && [...r.querySelectorAll(".vact")].find((x) => /Not work we handle/.test(x.innerText));
    if (b) b.click(); return !!b;
  });
  t.ck("a job with no trade offers a way to close it", ended);
  await wait(700);
  const endModal = await page.evaluate(() => !!document.querySelector(".modal .endj-picks"));
  t.ck("and that opens the cancel / defer window", endModal);
  t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
  await ctx.close();

  console.log("\n-- the tenant --");
  VIS = VISITS().map((x) => (x.id === "v_time"
    ? { ...x, respondedAt: null, contractorAt: T, turn: "tenant", waitingOn: ["manager", "tenant"] }
    : x.id === "v_gone" ? { ...x, managerAt: T, turn: "tenant", waitingOn: ["tenant"] } : x));
  SEAT = { userId: "u_ten", accountId: "acc_pm", role: "tenant" };
  // A section folded closed on some earlier visit: the question must still be
  // on screen, which only a saved "closed" can tell apart from the default.
  const tn = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_ten", accountId: "acc_pm" }, viewport: { width: 1100, height: 1400 },
    onNewDocument: () => { try { localStorage.setItem("subsub.tn.open.asking", "0"); } catch { /* none */ } } });
  await wait(2600);
  const ten = await tn.page.evaluate(() => {
    const secs = [...document.querySelectorAll(".tn-sec")];
    const ask = document.querySelector(".tn-sec.tn-sec-ask");
    return { first: secs[0]?.classList.contains("tn-sec-ask") || false,
      head: ask?.querySelector(".tn-sec-title")?.innerText || "",
      items: ask ? ask.querySelectorAll(".tn-list > *").length : 0,
      text: ask?.innerText || "",
      yes: !!ask && [...ask.querySelectorAll("button")].some((b) => /Yes, that works/.test(b.innerText)),
      toggles: ask ? ask.querySelectorAll("button.tn-sec-head").length : -1,
      goneRow: [...document.querySelectorAll(".tn-row")].find((r) => /Shower head/.test(r.innerText))?.innerText || null };
  });
  t.ck("a time put to the tenant is its own section, first", ten.first, JSON.stringify(ten));
  t.ck("headed as waiting on them", /Waiting on you/i.test(ten.head), ten.head);
  t.ck("it holds that report and only that one -- not a window still the crew's turn",
    ten.items === 1 && /Bedrooom/.test(ten.text), JSON.stringify(ten));
  t.ck("and the answer is on it", ten.yes, JSON.stringify(ten));
  t.ck("a time that has gone by is not asked of them", !/Shower head/.test(ten.text), JSON.stringify(ten));
  t.ck("its row says it passed, and offers no yes", !!ten.goneRow && /time passed/i.test(ten.goneRow)
    && !/Yes, that works/.test(ten.goneRow), JSON.stringify(ten.goneRow));
  t.ck("and it cannot be folded away", ten.toggles === 0, JSON.stringify(ten));
  await tn.ctx.close();

  console.log("\n-- the contractor --");
  VIS = VISITS();
  SEAT = { userId: "u_sub", accountId: "acc_pm", role: "contractor" };
  const cs = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_sub", accountId: "acc_pm" }, viewport: { width: 1100, height: 1500 } });
  await wait(2800);
  const con = await cs.page.evaluate(() => {
    const ask = document.querySelector(".dash-sec.sec-yt");
    const titles = (s) => (s ? [...s.querySelectorAll(".jl-title, .jr-title, h4")].map((x) => x.innerText) : []);
    const up = [...document.querySelectorAll(".dash-sec")].find((x) => /Current/i.test(x.querySelector("h3")?.innerText || ""));
    const goneLine = [...document.querySelectorAll(".jr-card")].find((r) => /Shower head/.test(r.innerText))?.innerText || null;
    return { has: !!ask, head: ask?.querySelector("h3")?.innerText || "", inAsk: titles(ask), inUp: titles(up), goneLine };
  });
  t.ck("a time put to the crew is its own section", con.has, JSON.stringify(con));
  t.ck("it holds the window that is theirs", con.inAsk.some((x) => /Balcony door/i.test(x)), JSON.stringify(con));
  t.ck("and not one that is somebody else's turn", !con.inAsk.some((x) => /Bedrooom/i.test(x)), JSON.stringify(con));
  t.ck("a time that has gone by is not asked of the crew", !con.inAsk.some((x) => /Shower head/i.test(x)), JSON.stringify(con));
  t.ck("its line says the time passed", /Time passed/.test(con.goneLine || ""), con.goneLine);
  t.ck("and it is not repeated under Current & upcoming", !con.inUp.some((x) => /Balcony door/i.test(x)), JSON.stringify(con));
  t.ck("nothing crashed", cs.crashes.length === 0, cs.crashes.join(" | "));
  await cs.ctx.close();
} catch (e) {
  t.ck("the suite ran without throwing", false, e?.stack || String(e));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
