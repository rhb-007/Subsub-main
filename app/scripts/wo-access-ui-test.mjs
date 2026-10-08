// ACCESS ON THE WORK ORDER, AS DRAWN.
//
// Asked for as "put a link on all work orders to access information (if a
// property manager, portfolio manager, or owner)". The work order is what a
// crew opens before driving somewhere, and the one thing it never said was how
// they get in.
//
//   A PM ACCOUNT'S WORK ORDER CARRIES AN ACCESS LINK AND THE SECTION IT GOES
//   TO, for the office and for the crew, read through the same route and the
//   same panel the job card uses.
//
//   A CREW HOLDING ONLY AN OFFER is told when it will appear, never a blank:
//   the route refuses them on purpose (no number for a door they have not
//   agreed to stand at).
//
//   AND A GENERAL CONTRACTOR'S WORK ORDER HAS NONE. A GC keeps no buildings and
//   no tenants, so an Access section there would be a heading over nothing.
//   Asserted in the same suite, positive case first, because "there is no
//   link" passes loudest on a modal that never opened.
//
//   node --no-warnings scripts/wo-access-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-woaccess-test");
const WEB = 5421, API = 9121;
const t = tally();

const S = { kind: "property_manager", role: "admin", accessStatus: 200, accessAsks: 0 };
const ACC = () => ({
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: S.kind, plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_me", name: "Juan Soto", email: "juan@pacificam.test", role: S.role },
});
const SUB = {
  id: "cmp_pac", company: "Pacific apartment maintenance", engagementId: "en_pac",
  accountId: "acc_pm", contact: "Juan Soto", email: "juan@pacificam.test", phone: null,
  categories: ["plumbing"], caps: [], crews: [], propertyIds: [], zips: [],
  notify: {}, rating: null, bond: true, insurance: true, contract: true, w9: true,
  hasPortal: true, license: "", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {},
};
const JOB = () => ({
  id: "job_sink", accountId: "acc_pm", propertyId: null, title: "Leaking sink - unit 14B",
  status: "active", date: "2026-10-09", time: "09:00",
  address: "1620 Belmont Ave", area: "Seattle", zip: "98122",
  trades: ["plumbing"], notes: "", createdAt: "2026-10-01",
  assignments: { plumbing: {
    id: "WO-1", wo: "WO-1", subId: "cmp_pac", company: "Pacific apartment maintenance",
    contact: "Juan Soto", status: S.role === "contractor" && S.accessStatus === 404 ? "pending" : "accepted",
    auto: false, responseWindow: null, respondBy: null, respondedAt: null, value: "400",
    payKind: "fixed", rate: "", capHours: null, tradeScope: null, crewName: null,
    signedWO: null, rating: null,
  } },
  photos: [], severity: null, client: null, sqft: null, stories: null, scope: "Fix the leak",
  measurementDocs: [], materialSource: null, materialsPaidBy: null,
  requestedBy: null, approvedAt: "2026-10-01", declinedAt: null, withdrawnAt: null,
  completedAt: null, access: "tenant", accessEffective: "tenant", accessUserId: "u_john",
  reportDetail: null, propertyName: null, visit: null,
});
const PLAN = {
  kind: "tenant", how: "Meet at the front door", howFrom: "tenant", live: true,
  when: { date: "2026-10-09", startTime: "09:00", endTime: "10:00", status: "confirmed" },
  people: [
    { side: "tenant", firstName: "John", phone: "+12065550101" },
    { side: "crew", firstName: "Juan", company: "Pacific apartment maintenance", phone: "+12065550199" },
  ],
  canEditHow: true,
};

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACC()];
  if (path === "/api/account") return [200, ACC()];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/account-users") return [200, [
    { id: "u_me", name: "Juan Soto", email: "juan@pacificam.test", phone: null,
      role: S.role, subId: S.role === "contractor" ? "cmp_pac" : null, propertyIds: [], unit: null,
      hasLogin: true, inviteSentAt: null, hasAvatar: false },
  ]];
  if (path === "/api/jobs") return [200, [JOB()]];
  if (path === "/api/jobs/job_sink/access") {
    S.accessAsks++;
    return S.accessStatus === 200 ? [200, PLAN] : [404, { error: "job_not_found" }];
  }
  if (/^\/api\/work-orders\/[^/]+\/inspection$/.test(path)) return [404, { error: "not_found" }];
  if (/^\/api\/work-orders\/[^/]+\/plan$/.test(path))
    return [200, { valueCents: 40000, milestones: [], releases: [], retainageBps: 0 }];
  if (/^\/api\/jobs\/[^/]+\/trade-scope$/.test(path)) return [200, {}];
  if (path === "/api/my-work") return [200, { work: [] }];
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

const goJobs = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("nav button, .nav button, aside button, button")]
    .find((b) => /^Jobs\b/.test((b.innerText || "").trim()))?.click());
  await wait(700);
};
const openAsTeam = async (page) => {
  await goJobs(page);
  await openCards(page);
  await page.evaluate(() => document.querySelector(".ta-wo-link")?.click());
  await wait(1300);
};
const openAsCrew = async (page) => {
  await openCards(page);
  await page.evaluate(() => document.querySelector(".jr-card .wo-open-btn")?.click());
  await wait(1300);
};
const read = (page) => page.evaluate(() => {
  const doc = document.querySelector(".modal .wo-doc");
  if (!doc) return null;
  const link = doc.querySelector(".wd-acc-link");
  const sec = doc.querySelector(".wo-acc");
  const row = [...doc.querySelectorAll(".wd-row")].find((r) => /^Access/.test((r.querySelector("span")?.innerText || "").trim()));
  return {
    title: (doc.querySelector("h2")?.innerText || "").trim(),
    link: link ? link.innerText.trim() : null,
    row: row ? row.querySelector("strong")?.innerText.replace(/\s+/g, " ").trim() : null,
    sec: sec ? sec.innerText.replace(/\s+/g, " ").trim() : null,
    panel: !!sec?.querySelector(".acc-panel"),
    calls: [...(sec?.querySelectorAll('a[href^="tel:"]') || [])].map((a) => a.getAttribute("href")),
    rung: !!sec?.classList.contains("rung"),
  };
});

try {
  console.log("\n-- the office opens a work order on a property manager's job --");
  {
    S.kind = "property_manager"; S.role = "admin"; S.accessStatus = 200; S.accessAsks = 0;
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_me", accountId: "acc_pm" }, viewport: { width: 1340, height: 1400 } });
    await wait(2600);
    await openAsTeam(page);
    const r = await read(page);
    t.ck("the work order opened", !!r && r.title === "WO-1", JSON.stringify(r));
    t.ck("its header carries an Access link", r?.link === "Access", String(r?.link));
    t.ck("the Job section names who lets who in",
      /John \(the tenant\) lets Pacific apartment maintenance in/.test(r?.row || ""), String(r?.row));
    t.ck("its link reads from the office's side", /How they get in/.test(r?.row || "") && !/Who lets you in/.test(r?.row || ""));
    t.ck("one Access heading, not two", ((r?.sec || "").match(/\bAccess\b/gi) || []).length === 1, String(r?.sec));
    t.ck("the Access section draws the same panel the job card uses", r?.panel === true);
    t.ck("it says where to meet", /Meet at the front door/.test(r?.sec || ""), String(r?.sec));
    t.ck("the office can call both sides from it",
      r?.calls?.length === 2, JSON.stringify(r?.calls));
    await page.evaluate(() => document.querySelector(".modal .wd-acc-link")?.click());
    await wait(300);
    const r2 = await read(page);
    t.ck("pressing the link rings the section", r2?.rung === true);
    const txt = await page.evaluate(() => new Promise((res) => {
      const orig = URL.createObjectURL;
      URL.createObjectURL = (b) => { b.text().then(res); return "blob:x"; };
      const btn = [...document.querySelectorAll(".modal button")].find((b) => /Download work order/.test(b.innerText));
      btn?.click();
      setTimeout(() => { URL.createObjectURL = orig; res(null); }, 1500);
    }));
    t.ck("the downloaded work order carries the access block",
      /ACCESS\n.*lets Pacific apartment maintenance in\.\nWhere: Meet at the front door/.test(txt || ""), String(txt).slice(0, 400));
    t.ck("and the people to call", /Contact: John \(Tenant\)/.test(txt || ""));
    t.ck("no page error", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the crew opens it --");
  {
    S.kind = "property_manager"; S.role = "contractor"; S.accessStatus = 200;
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_me", accountId: "acc_pm" }, viewport: { width: 1340, height: 1400 } });
    await wait(2600);
    await openAsCrew(page);
    const r = await read(page);
    t.ck("the crew's work order opened", !!r && r.title === "WO-1", JSON.stringify(r));
    t.ck("it carries the Access link too", r?.link === "Access");
    t.ck("written from the crew's side", /John \(the tenant\) lets you in/.test(r?.row || ""), String(r?.row));
    t.ck("and its link reads from their side", /Who lets you in/.test(r?.row || ""));
    t.ck("no page error", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a crew holding only an offer --");
  {
    S.kind = "property_manager"; S.role = "contractor"; S.accessStatus = 404;
    const { ctx, page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_me", accountId: "acc_pm" }, viewport: { width: 1340, height: 1400 } });
    await wait(2600);
    await openAsCrew(page);
    const r = await read(page);
    t.ck("the work order opened", !!r && r.title === "WO-1", JSON.stringify(r));
    t.ck("the link is still there", r?.link === "Access");
    t.ck("and the section says when it will appear, not a blank",
      /appear here once you accept this work order/.test(r?.sec || ""), String(r?.sec));
    t.ck("and gives no number", (r?.calls || []).length === 0);
    await ctx.close();
  }

  console.log("\n-- a general contractor's work order --");
  {
    S.kind = "general_contractor"; S.role = "admin"; S.accessStatus = 200; S.accessAsks = 0;
    const { ctx, page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_me", accountId: "acc_pm" }, viewport: { width: 1340, height: 1400 } });
    await wait(2600);
    // The job card makes its own read; what is asserted is that OPENING THE
    // WORK ORDER adds none.
    await goJobs(page); await openCards(page); await wait(600);
    const before = S.accessAsks;
    await page.evaluate(() => document.querySelector(".ta-wo-link")?.click());
    await wait(1300);
    const r = await read(page);
    t.ck("the work order opened (so the absence below means something)",
      !!r && r.title === "WO-1", JSON.stringify(r));
    t.ck("no Access link", r && r.link === null, String(r?.link));
    t.ck("no Access section", r && r.sec === null);
    t.ck("and opening it asks the access route nothing", S.accessAsks === before, `${before} -> ${S.accessAsks}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
