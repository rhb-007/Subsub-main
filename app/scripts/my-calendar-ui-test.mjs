// THE CONTRACTOR'S MONTH, ON ITS OWN PAGE.
//
// Asked for as: *"need to allow the calendar to be expanded to its own page so
// easier to visualize for the actual person [doing the] job"*.
//
// Driven in a browser because every claim here is only true as drawn. The
// month is computed from work that exists only at runtime, so a static check
// that the component mentions `aim` passes with the value never used -- the
// lesson the hiring side's grid already paid for.
//
//   IT IS ITS OWN PANE, reachable from the nav and from the dashboard panel
//   that names the next job. A panel that names a job and routes somewhere
//   unable to show it is the lie the hiring side's "Open the calendar" told.
//
//   IT OPENS WHERE THE WORK IS, not on today's month -- and only moves when
//   today's is empty, which needs a fixture with work in both.
//
//   THE DOT ANSWERS *IS THE TIME AGREED*, not "is the job covered". Confirmed
//   and proposed must not read the same pixels: two states drawn identically
//   is the chip bug this project already paid for, and only the computed
//   value can see it.
//
//   AND A DAY OPENS TO THE WINDOW, the client and the trade.
//
//   node --no-warnings scripts/my-calendar-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-mycal-test");
const WEB = 5333, API = 9031;
const t = tally();

// Dates relative to today so the suite does not go stale. SOON and LATER are
// in THIS month wherever possible; FAR is deliberately two months out, which
// is the row the fortnight strip on the dashboard can never show and the
// whole reason a month grid exists.
const day = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const SOON = day(2), LATER = day(5), FAR = day(62), GONE = day(-20);
// A day in THIS month that is strictly in the past, floored at the 1st. It is
// the only fixture that can tell "stay on a month with work in it" from
// "always follow the work": both rules agree whenever the nearest future job
// is in this month. On the 1st such a day cannot exist, and the suite says so
// rather than reporting a green that means nothing -- the hiring side's own
// grid records exactly this.
const PAST_HERE = (() => {
  const t = new Date();
  const d = new Date(t); d.setDate(Math.max(1, t.getDate() - 5));
  return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    ok: d.getDate() < t.getDate() };
})();
const monthOf = (k) => k.slice(0, 7);

const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_juan", name: "Juan Soto", email: "juan@pacificam.test", role: "contractor" },
};
// The relationship this account engaged them under. Flipped between the two
// values and re-read, because a chip left on one answer is right for one of
// them and never checked for the other -- the diagonal coverage this project
// keeps recording.
let ENGAGED = "handyman";
const SUB = () => ({
  engagedAs: ENGAGED,
  id: "cmp_pac", company: "Pacific apartment maintenance", engagementId: "en_pac",
  accountId: "acc_pm", contact: "Juan Soto", email: "juan@pacificam.test", phone: null,
  categories: ["electrical", "plumbing"], caps: [], crews: [], propertyIds: [], zips: [],
  notify: {}, rating: null, bond: true, insurance: true, contract: true, w9: true,
  hasPortal: true, license: "", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {},
});
const assign = (trade, wo) => ({ [trade]: {
  id: wo, wo, subId: "cmp_pac", status: "accepted", auto: false,
  responseWindow: null, respondBy: null, respondedAt: null, value: "100",
  payKind: "fixed", rate: "", capHours: null, tradeScope: null, crewName: null,
  signedWO: null, rating: null,
} });
const job = (o) => ({
  id: o.id, accountId: "acc_pm", propertyId: null, title: o.title, status: "active",
  date: o.date || null, time: o.time || null,
  address: o.address || "4915 North Highland ST", area: "Ruston", zip: "98407",
  trades: [o.trade], assignments: assign(o.trade, o.wo), notes: "", createdAt: "2026-10-01",
  photos: [], severity: null, client: null, sqft: null, stories: null, scope: "",
  measurementDocs: [], materialSource: null, materialsPaidBy: null,
  requestedBy: null, approvedAt: "2026-10-01", declinedAt: null, withdrawnAt: null,
  completedAt: null, access: null, accessEffective: null, accessUserId: null,
  reportDetail: null, propertyName: null,
});
const JOBS = () => [
  job({ id: "j_conf", title: "Sparking breaker", trade: "electrical", wo: "WO-1" }),
  job({ id: "j_prop", title: "Press Apartments - leaking sink", trade: "plumbing", wo: "WO-2" }),
  job({ id: "j_far", title: "Boiler service", trade: "plumbing", wo: "WO-3" }),
  job({ id: "j_gone", title: "Hallway light", trade: "electrical", wo: "WO-4" }),
  // No date and no visit: the one thing a calendar can never show.
  job({ id: "j_none", title: "Gate repair", trade: "plumbing", wo: "WO-5" }),
  job({ id: "j_past", title: "Done last week", trade: "plumbing", wo: "WO-6" }),
];
// The appointments. A CONFIRMED one and a PROPOSED one in the same month, so
// the two tones can be told apart -- a fixture where every row is the same
// kind cannot see a grid that draws them identically.
const V = {
  j_past: { id: "v5", date: PAST_HERE.key, startTime: "09:00", endTime: "11:00", status: "confirmed", note: null },
  j_conf: { id: "v1", date: SOON, startTime: "11:00", endTime: "13:15", status: "confirmed", note: null },
  j_prop: { id: "v2", date: LATER, startTime: "14:00", endTime: "16:00", status: "proposed", note: null },
  j_far: { id: "v3", date: FAR, startTime: "08:00", endTime: "10:00", status: "confirmed", note: null },
  j_gone: { id: "v4", date: GONE, startTime: "09:00", endTime: "11:00", status: "confirmed", note: null },
};
const wrow = (jobId, trade, wo) => ({
  woId: wo, wo, jobId, trade, accountId: "acc_pm",
  accountName: "Sound Property Management", accountSubdomain: "soundpm",
  accountKind: "property_manager", here: true, status: "accepted", auto: false,
  responseWindow: null, respondBy: null, respondedAt: null,
  title: JOBS().find((j) => j.id === jobId).title, address: "4915 North Highland ST",
  area: "Ruston", zip: "98407", propertyName: null,
  date: null, time: null, severity: null, jobStatus: "active", completedAt: null,
  tradeScope: null, crewName: null, payKind: "fixed", value: "100", rate: "",
  capHours: null, signedWO: null, issuedAt: null, updatedAtIso: null,
  access: null, visit: V[jobId] || null,
});
// TWO FIXTURES, because the aim rule can only be told from "open on today"
// by a month with NOTHING in it. The first has work in today's month, so the
// grid must STAY; the second has work only two months out, so it must MOVE.
// Asserting one of those alone is the vacuous pass the hiring side's own grid
// recorded -- and the past-dated row has to go from the second, or today's
// month is not empty and the mutation survives again.
let MODE = "now";
const WORK = () => ({ work:
  MODE === "future"
    ? [wrow("j_far", "plumbing", "WO-3"), wrow("j_none", "plumbing", "WO-5")]
  : MODE === "pastHere"
    // Work in this month, all of it behind us, and the next appointment two
    // months out. "Stay" answers this month; "always follow the work" answers
    // December.
    ? [wrow("j_past", "plumbing", "WO-6"), wrow("j_far", "plumbing", "WO-3")]
    : [wrow("j_conf", "electrical", "WO-1"), wrow("j_prop", "plumbing", "WO-2"),
       wrow("j_far", "plumbing", "WO-3"), wrow("j_gone", "electrical", "WO-4"),
       wrow("j_past", "plumbing", "WO-6"), wrow("j_none", "plumbing", "WO-5")] });

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/subs") return [200, [SUB()]];
  if (path === "/api/account-users") return [200, [
    { id: "u_juan", name: "Juan Soto", email: "juan@pacificam.test", phone: null,
      role: "contractor", subId: "cmp_pac", propertyIds: [], unit: null,
      hasLogin: true, inviteSentAt: null, hasAvatar: false },
  ]];
  if (path === "/api/my-work") return [200, WORK()];
  if (path === "/api/jobs") return [200, JOBS()];
  if (/^\/api\/work-orders\/[^/]+\/plan$/.test(path))
    return [200, { valueCents: 10000, milestones: [], releases: [], retainageBps: 0 }];
  if (/\/inspection$/.test(path)) return [404, { error: "not_found" }];
  if (path === "/api/properties" || path === "/api/invites"
    || path === "/api/clients" || path === "/api/my-connect-requests"
    || path === "/api/connect-requests" || path === "/api/property-transfers"
    || path === "/api/visits" || path === "/api/my-quotes"
    || path === "/api/doc-shares" || path === "/api/inspections"
    || path === "/api/change-orders") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const cal = (page) => page.evaluate(() => {
  const el = document.querySelector(".mycal");
  if (!el) return null;
  const cells = [...el.querySelectorAll(".jcal-cell:not(.empty)")];
  return {
    head: (el.querySelector("h2")?.innerText || "").trim(),
    month: (el.querySelector(".jcal-month")?.innerText || "").replace(/\s+/g, " ").trim(),
    marked: cells.filter((c) => c.classList.contains("has"))
      .map((c) => ({ dom: (c.querySelector(".jc-dom")?.innerText || "").trim(),
        tones: [...c.querySelectorAll(".jc-dot")].map((d) => ({
          cls: [...d.classList].filter((x) => x !== "jc-dot").join(),
          bg: getComputedStyle(d).backgroundColor })) })),
    undated: [...el.querySelectorAll(".jcal-undated")].map((p) => p.innerText.replace(/\s+/g, " ").trim()),
    key: (el.querySelector(".jcal-key")?.innerText || "").replace(/\s+/g, " ").trim(),
    dayRows: [...el.querySelectorAll(".jcd-row")].map((r) => r.innerText.replace(/\s+/g, " ").trim()),
  };
});
const nav = (page, label) => page.evaluate((l) =>
  [...document.querySelectorAll("nav button, .drawer button, aside button")]
    .find((b) => b.innerText.trim().toLowerCase().startsWith(l.toLowerCase()))?.click(), label);

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_juan", accountId: "acc_pm" }, viewport: { width: 1340, height: 1700 } });
  const logs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/i.test(m.text())) logs.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => logs.push("THROW " + String(e).slice(0, 200)));
  await wait(2900);

  console.log("\n-- the dashboard panel routes to it --");
  const link = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".my-sched .sh-head .sh-link")][0];
    return b ? b.innerText.trim() : null;
  });
  // A panel that names the next job has to route somewhere that can show it.
  t.ck("the schedule panel offers the calendar", /open the calendar/i.test(link || ""), String(link));
  await page.evaluate(() => document.querySelector(".my-sched .sh-head .sh-link")?.click());
  await wait(900);
  let c = await cal(page);
  t.ck("and it opens", !!c, String(c));
  t.ck("headed as theirs", /my calendar/i.test(c?.head || ""), c?.head);

  console.log("\n-- it opens on the month the work is in --");
  // Today's month has two appointments in this fixture, so it must stay put
  // rather than being yanked to the one two months out.
  const thisMonth = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
  t.ck("which is this one, because there is work in it",
    (c?.month || "").includes(thisMonth.split(" ")[0]), `${c?.month} vs ${thisMonth}`);
  t.ck("and it counts what is in it", /\d+ jobs?/.test(c?.month || ""), c?.month);

  console.log("\n-- and agreed is not drawn like waiting on a yes --");
  const tones = (c?.marked || []).flatMap((m) => m.tones);
  t.ck("there are days marked", (c?.marked || []).length >= 2, JSON.stringify(c?.marked));
  const full = tones.find((x) => x.cls === "full");
  const open = tones.find((x) => x.cls === "open");
  t.ck("one day is agreed and one is not", !!full && !!open,
    JSON.stringify(tones.map((x) => x.cls)));
  // Only the computed value can see two states drawn the same.
  t.ck("and they are different pixels", full?.bg && open?.bg && full.bg !== open.bg,
    `${full?.bg} vs ${open?.bg}`);
  // The key says what the colours mean in the contractor's own terms, not the
  // hiring account's "all trades assigned".
  t.ck("the key is about the time, not about cover",
    /time agreed/i.test(c?.key || "") && /waiting on a yes/i.test(c?.key || "")
    && !/trades/i.test(c?.key || ""), c?.key);

  console.log("\n-- a day opens to the window --");
  await page.evaluate(() => [...document.querySelectorAll(".jcal-cell.has")][0]?.click());
  await wait(600);
  c = await cal(page);
  t.ck("the day lists what is on it", (c?.dayRows || []).length >= 1, JSON.stringify(c?.dayRows));
  const r0 = (c?.dayRows || [])[0] || "";
  t.ck("with the agreed window rather than the job's own time",
    /AM|PM/.test(r0), r0);
  t.ck("the trade", /Electrical|Plumbing/i.test(r0), r0);
  t.ck("and whether it is settled", /Confirmed|Not confirmed/.test(r0), r0);

  console.log("\n-- and what a calendar cannot show is counted --");
  t.ck("the job with no date at all is reported",
    (c?.undated || []).some((p) => /1 job has no date on it yet/i.test(p)),
    JSON.stringify(c?.undated));

  console.log("\n-- and on the month the work moves to, when this one is empty --");
  {
    // THE DISCRIMINATING CASE. With work in today's month the aim and "open on
    // today" give the same answer, so a grid that ignored the work entirely
    // passed every assertion above -- which a mutation duly proved.
    MODE = "future";
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(2900);
    await page.evaluate(() => document.querySelector(".my-sched .sh-head .sh-link")?.click());
    await wait(900);
    const f = await cal(page);
    const want = new Date(`${FAR}T12:00:00`)
      .toLocaleDateString(undefined, { month: "long", year: "numeric" });
    t.ck("it opens where the work is, not on today",
      (f?.month || "").includes(want.split(" ")[0]), `${f?.month} vs ${want}`);
    t.ck("and the day is marked there", (f?.marked || []).length === 1,
      JSON.stringify(f?.marked));
    MODE = "now";
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(2900);
  }

  console.log("\n-- but a month with work in it is where it stays --");
  if (!PAST_HERE.ok) {
    console.log("  --  today is the 1st, so a past day in this month cannot exist."
      + " This branch cannot be told from 'always follow the work' today.");
  } else {
    MODE = "pastHere";
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(2900);
    await page.evaluate(() => document.querySelector(".my-sched .sh-head .sh-link")?.click());
    await wait(900);
    const q = await cal(page);
    const here = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
    // Being yanked to December because the only job AHEAD is there would hide
    // the one earlier this month, which is the whole conservatism in the rule.
    t.ck("work behind us still counts as a month to land on",
      (q?.month || "").includes(here.split(" ")[0]), `${q?.month} vs ${here}`);
    // A day that has been and gone is spent, not waiting on anybody -- which
    // is the third tone and the only fixture that shows it.
    t.ck("and a day behind us is drawn as spent",
      (q?.marked || []).some((m) => m.tones.some((x) => x.cls === "done")),
      JSON.stringify(q?.marked));
    MODE = "now";
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(2900);
  }

  console.log("\n-- the schedule sits above the numbers --");
  {
    await nav(page, "My Jobs");
    await wait(900);
    const geom = await page.evaluate(() => {
      const sched = document.querySelector(".my-sched");
      const grid = document.querySelector(".dash-grid");
      if (!sched || !grid) return null;
      return { sched: sched.getBoundingClientRect().top, grid: grid.getBoundingClientRect().top };
    });
    // MEASURED, not read off the source: source order is not screen order,
    // and a static check that the JSX moved passes whether or not the panel
    // lands anywhere near the top.
    t.ck("both are on the dashboard", !!geom, String(geom));
    t.ck("and the schedule is above the four tiles", geom && geom.sched < geom.grid,
      JSON.stringify(geom));
  }

  console.log("\n-- and the chip says what this account engaged them as --");
  {
    const chip = () => page.evaluate(() =>
      (document.querySelector(".user-btn .user-role")?.innerText || "").trim());
    // The report: Pacific was set to handyman and the drop-down still said
    // Contractor.
    t.ck("a handyman reads handyman", /handyman/i.test(await chip()), await chip());
    ENGAGED = "subcontractor";
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(2900);
    // BOTH BRANCHES IN THE SAME PLACE. A chip hard-coded to "Handyman" passes
    // the assertion above on its own -- and the ordinary case is the one that
    // must not regress. On a property manager the roster word is Contractor,
    // which is also what this used to say, so the fixture cannot tell a fix
    // from the old constant unless the handyman branch is checked too.
    const c2 = await chip();
    t.ck("and a subcontractor reads the account's own roster word",
      /contractor/i.test(c2) && !/handyman/i.test(c2), c2);
    ENGAGED = "handyman";
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(2900);
  }

  console.log("\n-- the nav has its own way in --");
  await nav(page, "My Jobs");
  await wait(700);
  t.ck("leaving it works", await page.evaluate(() => !document.querySelector(".mycal")));
  await nav(page, "My calendar");
  await wait(900);
  t.ck("and the nav brings it back", !!(await cal(page)));

  t.ck("nothing threw on the page", logs.length === 0, logs.join(" | "));
  t.ck("and the harness saw no crash", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
