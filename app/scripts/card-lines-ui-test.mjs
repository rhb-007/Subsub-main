// Large cards are minimized into lines by default.
//
// Asked for as "need to be able to minimize these large cards into more
// narrow lines on jobs ui and on any ui within all accounts that have large
// cards ... should be minimized by default". The Jobs screen, the roster and
// the contractor's own job list each drew a card per row big enough that forty
// of them were forty screens.
//
// The assertions that matter:
//
//   MINIMIZED IS THE DEFAULT, and a line is narrow. Checked as a measured
//   height, because a "line" that wraps to the height of the card it replaced
//   has minimized nothing.
//
//   THE LINE STILL SAYS WHAT NEEDS SOMEBODY. A closed card that hid an empty
//   slot or an offer nobody answered is a list that reads as fine when it is
//   not -- so each flag is asserted on the job that should carry it, and its
//   absence on the one that should not.
//
//   ARRIVING AT A JOB OPENS IT. The dashboard's "Open in Jobs" lands on the
//   card, and ringing a closed line would answer "here it is" to somebody who
//   came to act on it.
//
//   node scripts/card-lines-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-card-lines-test");
const WEB = 5361, API = 9061;
const t = tally();

const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", role: "admin" },
};
const sub = (id, company, cats, extra = {}) => ({
  id, company, engagementId: `en_${id}`, accountId: "acc_pm", contact: `${company} owner`,
  email: `${id}@test.test`, phone: null, categories: cats, caps: ["Repairs", "Installs"], crews: [],
  propertyIds: [], zips: [], notify: {}, rating: 0, ratedJobs: 0, bond: true, insurance: true,
  contract: true, w9: true, hasPortal: true, license: "", licenseCheck: null, available: true,
  unavailableDays: [], docReview: {}, coverage: {}, engagedAs: "subcontractor", status: "active", ...extra,
});
const SUBS = [
  sub("cmp_pac", "Pacific apartment maintenance", ["plumbing", "painting"]),
  sub("cmp_bay", "Bay Roofing", ["roofing", "gutters"]),
  sub("cmp_gap", "Gap Electric", ["electrical"], { insurance: false, bond: false }),
];
const USERS = [{ id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
  inviteSentAt: null, hasAvatar: false },
{ id: "u_bay", name: "Rae Bay", email: "cmp_bay@test.test", phone: null,
  role: "contractor", subId: "cmp_bay", propertyIds: [], unit: null, hasLogin: true,
  inviteSentAt: null, hasAvatar: false }];
const base = (id, title, trades, extra = {}) => ({
  id, accountId: "acc_pm", propertyId: "prop_1", title, status: "active", date: "2026-11-02", time: null,
  address: "1620 Belmont Ave", area: "Seattle", zip: "98122", trades, assignments: {},
  notes: "", createdAt: "2026-10-05", photos: [], severity: null, client: null, sqft: null,
  stories: null, scope: "Work at the building", measurementDocs: [], materialSource: null,
  materialsPaidBy: null, requestedBy: null, approvedAt: "2026-10-05", declinedAt: null,
  withdrawnAt: null, completedAt: null, access: null, accessEffective: "manager", accessUserId: null,
  reportDetail: null, propertyName: "Press Apartments", visit: null, ...extra,
});
const PAST = new Date(Date.now() - 3 * 3600000).toISOString();
const FUTURE = new Date(Date.now() + 30 * 3600000).toISOString();
const JOBS = [
  // Two slots, nobody on either.
  base("j_open", "Move-out work — unit 14", ["plumbing", "painting"],
    { fromInspection: { id: "insp_1", kind: "move_out", unit: "14" } }),
  // An offer that ran out with no answer.
  base("j_noreply", "Gutter run at the back", ["gutters"], { assignments: {
    gutters: { id: "wo_1", subId: "cmp_bay", company: "Bay Roofing", wo: "WO-1001", status: "pending",
      auto: false, value: "1200", respondBy: PAST, tradeScope: null, crewName: null },
  } }),
  // Finished, so there is nothing on it for anybody.
  base("j_done", "Repaint the lobby", ["painting"], { status: "completed", completedAt: "2026-10-04",
    assignments: { painting: { id: "wo_2", subId: "cmp_pac", company: "Pacific apartment maintenance",
      wo: "WO-1002", status: "accepted", auto: false, value: "800", respondBy: null, tradeScope: null,
      crewName: null } } }),
];
// The contractor's side: one request at this account, waiting on a yes.
const MY_WORK = { work: [
  { woId: "wo_1", wo: "WO-1001", jobId: "j_noreply", trade: "gutters",
    accountId: "acc_pm", accountName: "Sound Property Management", accountSubdomain: "soundpm",
    here: true, status: "pending", auto: false, respondBy: FUTURE,
    title: "Gutter run at the back", address: "1620 Belmont Ave", date: "2026-11-02",
    propertyName: "Press Apartments", jobStatus: "active", value: "1200", payKind: "fixed" },
] };
const PORTAL_JOB = { ...JOBS[1], assignments: { gutters: { ...JOBS[1].assignments.gutters, respondBy: FUTURE } } };

let SEAT = "admin";
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body, headers) => {
  // Which seat this block is driving. Set per block rather than read off a
  // request header, because not every request the app makes on its first
  // render carries the seat.
  const contractor = SEAT === "contractor" || String(headers["x-user-id"] || "") === "u_bay";
  if (path === "/api/auth/me") return [200, { user: contractor ? { id: "u_bay", name: "Rae Bay",
    email: "cmp_bay@test.test", role: "contractor" } : PM.user, memberships: [
    { accountId: "acc_pm", accountName: PM.name, subdomain: "soundpm", kind: "property_manager",
      role: contractor ? "contractor" : "admin", companyId: contractor ? "cmp_bay" : null, plan: "scale",
      billing: "monthly", theme: null, trades: [], logoKey: null, useDefaultMark: true }] }];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/subs") return [200, SUBS];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, contractor ? [PORTAL_JOB] : JOBS];
  if (path === "/api/my-work") return [200, contractor ? MY_WORK : { work: [] }];
  if (/^\/api\/jobs\/[^/]+\/trade-scope$/.test(path)) return [200, { scopes: {} }];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_pm", name: "Press Apartments",
    address: "1620 Belmont Ave", city: "Seattle", state: "WA", zip: "98122", units: 20, notes: "",
    vendorIds: [], ownerIds: [], tenantIds: [], ownerAccountId: "acc_pm", ownedNotOperated: false, readOnly: false },
  { id: "prop_2", accountId: "acc_pm", name: "North Highland LLC",
    address: "4915 North Highland St", city: "Ruston", state: "WA", zip: "98407", units: 2, notes: "",
    vendorIds: [], ownerIds: [], tenantIds: [], ownerAccountId: "acc_pm", ownedNotOperated: false, readOnly: false }]];
  if (path === "/api/invites" || path === "/api/clients" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/doc-shares"
    || path === "/api/property-transfers" || path === "/api/overflow-posts"
    || path === "/api/inspections" || path === "/api/my-quotes") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const nav = (page, re) => page.evaluate((src) => [...document.querySelectorAll("nav button")]
  .find((b) => new RegExp(src, "i").test((b.innerText || "").trim()))?.click(), re);
const readJobs = (page) => page.evaluate(() => [...document.querySelectorAll(".jobs-list [data-job-id]")]
  .map((c) => ({
    id: c.getAttribute("data-job-id"),
    line: c.classList.contains("job-line"),
    h: Math.round(c.getBoundingClientRect().height),
    text: c.innerText.replace(/\s+/g, " ").trim(),
    flag: c.querySelector(".jl-flag")?.innerText || null,
    trades: c.querySelectorAll(".trade-row").length,
    inModal: !!c.closest(".modal.modal-job"),
    insp: c.querySelector(".job-insp")?.innerText.trim() || null,
  })));
const byId = (rows, id) => rows.find((r) => r.id === id) || {};

try {
  console.log("\n-- the Jobs screen opens as lines --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1280, height: 1600 } });
    await wait(2800);
    await nav(page, "^Jobs");
    await wait(1200);
    await page.evaluate(() => [...document.querySelectorAll(".seg-tabs.sm button")]
      .find((b) => /^All/i.test(b.innerText.trim()))?.click());
    await wait(700);
    let rows = await readJobs(page);
    // Guarded: every .every() below is true over an empty list.
    t.ck("there are jobs on the screen", rows.length === 3, JSON.stringify(rows.map((r) => r.id)));
    t.ck("every one is minimized", rows.length === 3 && rows.every((r) => r.line), JSON.stringify(rows.map((r) => [r.id, r.line])));
    t.ck("and none of them draws its trade rows", rows.every((r) => r.trades === 0));
    t.ck("each line is narrow", rows.length === 3 && rows.every((r) => r.h > 0 && r.h <= 80),
      JSON.stringify(rows.map((r) => r.h)));
    t.ck("a line names the job and where it is",
      /Move-out work/.test(byId(rows, "j_open").text) && /1620 Belmont Ave/.test(byId(rows, "j_open").text),
      byId(rows, "j_open").text);
    t.ck("empty slots are said on the line", byId(rows, "j_open").flag === "2 unassigned", String(byId(rows, "j_open").flag));
    t.ck("an offer nobody answered is said on the line", byId(rows, "j_noreply").flag === "No reply",
      String(byId(rows, "j_noreply").flag));
    t.ck("and a finished job carries no flag", byId(rows, "j_done").flag === null, String(byId(rows, "j_done").flag));

    console.log("\n-- a job raised from an inspection says so on its line --");
    // Asked for as "a quick design reference to created from an inspection to
    // differentiate them from other jobs". Asserted on the job that carries it
    // AND its absence on the ones that do not, because a badge on every line
    // differentiates nothing.
    t.ck("the inspection job's line carries the badge",
      /Move-out/.test(byId(rows, "j_open").insp || "") && /unit 14/.test(byId(rows, "j_open").insp || ""),
      String(byId(rows, "j_open").insp));
    t.ck("and the others do not", byId(rows, "j_noreply").insp === null && byId(rows, "j_done").insp === null,
      JSON.stringify([byId(rows, "j_noreply").insp, byId(rows, "j_done").insp]));

    console.log("\n-- a line opens its job in a window, and closes again --");
    await page.evaluate(() => document.querySelector('[data-job-id="j_open"] .jl-btn')?.click());
    await wait(400);
    rows = await readJobs(page);
    t.ck("pressing the line opens that job", byId(rows, "j_open").line === false && byId(rows, "j_open").trades === 2,
      JSON.stringify(byId(rows, "j_open")));
    t.ck("in a window, not pushed into the list", byId(rows, "j_open").inModal === true, JSON.stringify(byId(rows, "j_open")));
    t.ck("once -- the line is not still drawn behind it",
      rows.filter((r) => r.id === "j_open").length === 1, JSON.stringify(rows.map((r) => r.id)));
    t.ck("the window says where the job came from",
      /Move-out inspection/.test(byId(rows, "j_open").insp || ""), String(byId(rows, "j_open").insp));
    t.ck("the others stay lines", byId(rows, "j_noreply").line && byId(rows, "j_done").line);
    await page.evaluate(() => document.querySelector(".modal.modal-job")?.parentElement?.querySelector(".modal-close")?.click());
    await wait(400);
    rows = await readJobs(page);
    t.ck("closing the window puts it back to a line", byId(rows, "j_open").line === true,
      JSON.stringify(byId(rows, "j_open")));
    t.ck("and no window is left open", await page.evaluate(() => !document.querySelector(".modal.modal-job")));

    console.log("\n-- every card on the page at once --");
    const pick = (l) => page.evaluate((x) => [...document.querySelectorAll(".jobs-view button")]
      .find((b) => b.innerText.trim() === x)?.click(), l);
    t.ck("the list offers Lines and Cards",
      (await page.evaluate(() => [...document.querySelectorAll(".jobs-view button")].map((b) => b.innerText.trim())))
        .join("|") === "Lines|Cards");
    await pick("Cards");
    await wait(400);
    rows = await readJobs(page);
    t.ck("Cards draws every card", rows.length === 3 && rows.every((r) => !r.line && r.trades > 0), JSON.stringify(rows.map((r) => [r.line, r.trades])));
    t.ck("on the page, not in windows", rows.every((r) => !r.inModal));
    await pick("Lines");
    await wait(400);
    rows = await readJobs(page);
    t.ck("Lines shuts them again", rows.length === 3 && rows.every((r) => r.line));

    console.log("\n-- the filter bar narrows the list --");
    const bar = () => page.evaluate(() => ({
      has: !!document.querySelector(".jobs-list .fbar"),
      selects: [...document.querySelectorAll(".jobs-list .fbar select")].map((x) => x.getAttribute("aria-label")),
      n: document.querySelector(".jobs-list .fbar-n")?.innerText || null,
    }));
    const setSel = (label, v) => page.evaluate(([l, val]) => {
      const sel = [...document.querySelectorAll(".jobs-list .fbar select")].find((x) => x.getAttribute("aria-label") === l);
      if (!sel) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      set.call(sel, val); sel.dispatchEvent(new Event("change", { bubbles: true })); return true;
    }, [label, v]);
    const typeQ = (v) => page.evaluate((val) => {
      const i = document.querySelector(".jobs-list .fbar input");
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(i, val); i.dispatchEvent(new Event("input", { bubbles: true }));
    }, v);
    let b0 = await bar();
    t.ck("there is a filter bar on top of the jobs", b0.has, JSON.stringify(b0));
    t.ck("with a search box and the job and trade filters", b0.selects.includes("Jobs") && b0.selects.includes("Trades"), JSON.stringify(b0.selects));
    t.ck("and no count while nothing narrows", b0.n === null, String(b0.n));
    t.ck("a property filter is not offered over a single property", !b0.selects.includes("Properties"), JSON.stringify(b0.selects));
    await setSel("Jobs", "unassigned");
    await wait(300);
    rows = await readJobs(page);
    t.ck("Needs a contractor lists exactly the job with empty slots",
      rows.map((r) => r.id).join() === "j_open", JSON.stringify(rows.map((r) => r.id)));
    t.ck("and says how many of how many", /^1 of 3$/.test((await bar()).n || ""), String((await bar()).n));
    await setSel("Jobs", "inspection");
    await wait(300);
    rows = await readJobs(page);
    t.ck("Raised from an inspection lists only that job", rows.map((r) => r.id).join() === "j_open", JSON.stringify(rows.map((r) => r.id)));
    await setSel("Jobs", "");
    await typeQ("gutter");
    await wait(300);
    rows = await readJobs(page);
    t.ck("the search finds a job by its words", rows.map((r) => r.id).join() === "j_noreply", JSON.stringify(rows.map((r) => r.id)));
    await setSel("Trades", "painting");
    await wait(300);
    rows = await readJobs(page);
    t.ck("and filters stack", rows.length === 0, JSON.stringify(rows.map((r) => r.id)));
    await page.evaluate(() => document.querySelector(".jobs-list .fbar-clear")?.click());
    await wait(300);
    rows = await readJobs(page);
    t.ck("Clear puts every job back", rows.length === 3 && (await bar()).n === null, JSON.stringify(rows.map((r) => r.id)));

    console.log("\n-- arriving at a job opens it --");
    await nav(page, "^Dashboard");
    await wait(900);
    const opened = await page.evaluate(() => {
      const sec = [...document.querySelectorAll(".dash-sec")]
        .find((s) => /Needs a contractor/i.test(s.querySelector("h3")?.innerText || ""));
      const row = [...(sec?.querySelectorAll(".dash-row") || [])].find((r) => r.innerText.includes("Plumbing"));
      row?.querySelector(".dash-row-open")?.click();
      return !!row;
    });
    await wait(700);
    t.ck("the dashboard row opens the job's details", opened);
    const went = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".jp .form-actions button")].find((x) => /Open in Jobs/.test(x.innerText));
      b?.click(); return !!b;
    });
    await wait(1200);
    rows = await readJobs(page);
    t.ck("Open in Jobs is pressable", went);
    t.ck("and the job it lands on is open, not a line",
      byId(rows, "j_open").line === false && byId(rows, "j_open").trades === 2, JSON.stringify(byId(rows, "j_open")));
    t.ck("in its window", byId(rows, "j_open").inModal === true, JSON.stringify(byId(rows, "j_open")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- properties are thin rows across the page, each opening a window --");
  for (const width of [1280, 390]) {
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width, height: 1400 } });
    await wait(2800);
    if (width < 600) {
      await page.evaluate(() => document.querySelector("[aria-label='Menu']")?.click());
      await wait(400);
    }
    await nav(page, "^Properties");
    await wait(1200);
    const read = () => page.evaluate(() => {
      const main = document.querySelector("main.ss-main");
      const mr = main?.getBoundingClientRect();
      return [...document.querySelectorAll(".prop-grid .prop-card")].map((c) => {
        const r = c.getBoundingClientRect();
        const st = c.querySelector(".prop-stats")?.getBoundingClientRect();
        return {
          name: c.querySelector("h3")?.innerText.trim(),
          w: Math.round(r.width), mainW: Math.round(mr?.width || 0), h: Math.round(r.height),
          top: Math.round(r.top),
          // THE CLIP IN THE REPORT: the counts ran into the tile's bottom border.
          statsInside: !!st && st.bottom <= r.bottom - 2 && st.right <= r.right + 1,
        };
      });
    });
    let rows = await read();
    const tag = `(${width}px)`;
    t.ck(`both properties are listed ${tag}`, rows.length === 2, JSON.stringify(rows));
    // One per line: each row nearly the width of the page, stacked rather than
    // side by side.
    t.ck(`each is a full-width row ${tag}`, rows.length === 2 && rows.every((r) => r.w >= r.mainW - 60),
      JSON.stringify(rows.map((r) => [r.w, r.mainW])));
    t.ck(`stacked, one under the other ${tag}`, rows.length === 2 && rows[1].top > rows[0].top + rows[0].h - 2,
      JSON.stringify(rows.map((r) => [r.top, r.h])));
    t.ck(`each row is thin ${tag}`, rows.every((r) => r.h > 0 && r.h <= (width < 600 ? 110 : 70)),
      JSON.stringify(rows.map((r) => r.h)));
    t.ck(`and the counts sit inside the row ${tag}`, rows.length === 2 && rows.every((r) => r.statsInside),
      JSON.stringify(rows));
    await page.evaluate(() => [...document.querySelectorAll(".prop-grid .prop-card")]
      .find((c) => /North Highland/.test(c.innerText))?.querySelector(".prop-addr")?.click());
    await wait(500);
    t.ck(`pressing anywhere on a row opens its window ${tag}`, await page.evaluate(() =>
      [...document.querySelectorAll(".modal .prop-detail h2")].some((h) => /North Highland/.test(h.innerText))));
    await page.evaluate(() => { for (const b of document.querySelectorAll(".modal-close")) b.click(); });
    await wait(400);
    if (width > 600) {
      const sels = await page.evaluate(() => [...document.querySelectorAll(".fbar select")].map((x) => x.getAttribute("aria-label")));
      t.ck("the properties page has the filter bar", sels.includes("Cities") && sels.includes("Properties"), JSON.stringify(sels));
      await page.evaluate(() => {
        const sel = [...document.querySelectorAll(".fbar select")].find((x) => x.getAttribute("aria-label") === "Cities");
        const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        set.call(sel, "Ruston"); sel.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await wait(300);
      rows = await read();
      t.ck("a city narrows it to that city", rows.map((r) => r.name).join() === "North Highland LLC", JSON.stringify(rows.map((r) => r.name)));
      t.ck("and says so", await page.evaluate(() => document.querySelector(".fbar-n")?.innerText) === "1 of 2");
    }
    t.ck(`nothing crashed ${tag}`, crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the roster opens as lines --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1280, height: 1600 } });
    await wait(2800);
    await nav(page, "^(Sub)?contractors");
    await wait(1200);
    const r = await page.evaluate(() => {
      const g = document.querySelector(".grid");
      const rows = [...document.querySelectorAll(".grid .card")];
      return {
        rowsClass: !!g?.classList.contains("rows"),
        n: rows.length,
        lines: rows.filter((c) => c.classList.contains("card-row")).length,
        hs: rows.map((c) => Math.round(c.getBoundingClientRect().height)),
        names: rows.map((c) => c.querySelector(".name-row h3")?.innerText || ""),
        gap: rows.find((c) => /Gap Electric/.test(c.innerText))?.querySelector(".cr-docs")?.innerText || null,
        ready: rows.find((c) => /Bay Roofing/.test(c.innerText))?.querySelector(".cr-docs")?.innerText || null,
      };
    });
    t.ck("there are contractors on the screen", r.n === 3, JSON.stringify(r));
    t.ck("each is a line, not a card", r.n === 3 && r.lines === 3 && r.rowsClass, JSON.stringify(r));
    t.ck("and each line is narrow", r.hs.length === 3 && r.hs.every((h) => h > 0 && h <= 80), JSON.stringify(r.hs));
    t.ck("the name is still the first thing on it", r.names.includes("Bay Roofing"), JSON.stringify(r.names));
    t.ck("a contractor short of documents says so on the line", /gap/i.test(r.gap || ""), String(r.gap));
    t.ck("and one with everything says ready", /Ready/.test(r.ready || ""), String(r.ready));
    await page.evaluate(() => [...document.querySelectorAll(".grid .card")]
      .find((c) => /Bay Roofing/.test(c.innerText))?.click());
    await wait(700);
    t.ck("pressing a line opens their details",
      await page.evaluate(() => [...document.querySelectorAll(".modal")].some((m) => /Bay Roofing/.test(m.innerText))));
    await page.evaluate(() => { for (const b of document.querySelectorAll(".modal-close")) b.click(); });
    await wait(400);
    await page.evaluate(() => [...document.querySelectorAll(".roster-view button")]
      .find((b) => /Cards/.test(b.innerText))?.click());
    await wait(500);
    const c = await page.evaluate(() => ({
      rowsClass: !!document.querySelector(".grid.rows"),
      lines: document.querySelectorAll(".grid .card-row").length,
      cards: document.querySelectorAll(".grid .card .card-docs").length,
    }));
    t.ck("the cards are one press away", !c.rowsClass && c.lines === 0 && c.cards === 3, JSON.stringify(c));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and on a phone, which is where it was reported --");
  {
    // The roster was reported from a phone showing full cards. At 390px a line
    // must still be a line: short, nothing running off the right, and the
    // job list the same.
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 390, height: 900 } });
    await wait(2800);
    const openNav = async (re) => {
      await page.evaluate(() => document.querySelector(".menu-btn, .hamburger, [aria-label='Menu']")?.click());
      await wait(400);
      await page.evaluate((src) => [...document.querySelectorAll("nav button, .drawer button")]
        .find((b) => new RegExp(src, "i").test(b.innerText.trim()))?.click(), re);
      await wait(1200);
    };
    await openNav("^(Sub)?contractors");
    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".grid .card")];
      return {
        n: rows.length,
        lines: rows.filter((c) => c.classList.contains("card-row")).length,
        hs: rows.map((c) => Math.round(c.getBoundingClientRect().height)),
        over: rows.some((c) => c.getBoundingClientRect().right > window.innerWidth + 1),
        scrollX: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    t.ck("the roster rendered on a phone", r.n === 3, JSON.stringify(r));
    t.ck("as lines there too", r.lines === 3, JSON.stringify(r));
    t.ck("each phone line is short", r.hs.length === 3 && r.hs.every((h) => h > 0 && h <= 130), JSON.stringify(r.hs));
    t.ck("nothing runs off the right", !r.over && !r.scrollX, JSON.stringify(r));
    await openNav("^Jobs");
    const j = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".job-card")];
      return {
        n: cards.length,
        lines: cards.filter((c) => c.classList.contains("job-line")).length,
        hs: cards.map((c) => Math.round(c.getBoundingClientRect().height)),
        scrollX: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    t.ck("the jobs rendered on a phone", j.n > 0, JSON.stringify(j));
    t.ck("every job is a line on a phone", j.n > 0 && j.lines === j.n, JSON.stringify(j));
    t.ck("and each is short", j.hs.every((h) => h > 0 && h <= 130), JSON.stringify(j.hs));
    t.ck("and the page does not scroll sideways", !j.scrollX, JSON.stringify(j));
    t.ck("nothing crashed on a phone", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the contractor's own job requests open as lines --");
  {
    SEAT = "contractor";
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_bay", accountId: "acc_pm" }, viewport: { width: 1280, height: 1600 } });
    await wait(3000);
    const read = () => page.evaluate(() => [...document.querySelectorAll(".jr-card")].map((c) => ({
      line: c.classList.contains("job-line"),
      h: Math.round(c.getBoundingClientRect().height),
      text: c.innerText.replace(/\s+/g, " ").trim(),
      flag: c.querySelector(".jl-flag")?.innerText || null,
      accept: [...c.querySelectorAll("button")].some((b) => /^Accept$/.test(b.innerText.trim())),
    })));
    let cards = await read();
    const gr = cards.find((x) => /Gutter run/.test(x.text));
    t.ck("the request is on the screen", !!gr, JSON.stringify(cards.map((x) => x.text.slice(0, 40))));
    t.ck("minimized", !!gr && gr.line && gr.h <= 80, JSON.stringify(gr));
    t.ck("with no Accept until it is opened", !!gr && !gr.accept);
    t.ck("and the line says it is waiting on their reply", /^Reply/.test(gr?.flag || ""), String(gr?.flag));
    await page.evaluate(() => [...document.querySelectorAll(".jr-card .jl-btn")]
      .find((b) => /Gutter run/.test(b.innerText))?.click());
    await wait(500);
    cards = await read();
    // Case-insensitive: the open card's heading is text-transformed, and
    // Chrome's innerText applies it.
    const open = cards.find((x) => /Gutter run/i.test(x.text));
    t.ck("opened, it is the full card with its answer", !!open && !open.line && open.accept, JSON.stringify(open));
    t.ck("in a window over the list", await page.evaluate(() =>
      !!document.querySelector(".modal.modal-job .jr-card")));
    await page.evaluate(() => { for (const b of document.querySelectorAll(".modal-close")) b.click(); });
    await wait(400);

    console.log("\n-- and their list has the same filter bar --");
    const pick = (v) => page.evaluate((val) => {
      const sel = [...document.querySelectorAll(".fbar select")].find((x) => x.getAttribute("aria-label") === "Work");
      if (!sel) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      set.call(sel, val); sel.dispatchEvent(new Event("change", { bubbles: true })); return true;
    }, v);
    t.ck("My Jobs has a filter bar with the Work filter", await pick("reply"));
    await wait(300);
    cards = await read();
    t.ck("Waiting on my reply keeps the request", cards.some((x) => /Gutter run/i.test(x.text)), JSON.stringify(cards.map((x) => x.text.slice(0, 30))));
    await pick("completed");
    await wait(300);
    cards = await read();
    t.ck("Completed hides it", !cards.some((x) => /Gutter run/i.test(x.text)), JSON.stringify(cards.map((x) => x.text.slice(0, 30))));
    t.ck("while the counts above stay whole", await page.evaluate(() =>
      [...document.querySelectorAll(".dash-card")].some((c) => /^1\s*Job request/i.test(c.innerText.trim()))));
    await page.evaluate(() => document.querySelector(".fbar-clear")?.click());
    await wait(300);
    cards = await read();
    t.ck("Clear brings it back", cards.some((x) => /Gutter run/i.test(x.text)));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
