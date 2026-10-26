// ONE APPOINTMENT PER COMPANY, ON THE SCREENS (098).
//
// A job with two companies on it: the hiring side's Schedule tab draws one
// time per company, headed by who it is, and a time proposed there carries
// that company; the tenant's report draws each company's time and answers
// each on its own. Paired with appointments-test, which holds the route.
//
//   node scripts/appointments-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-appointments-test");
const WEB = 5965, API = 9965;
const t = tally();

const dayKey = (n = 0) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
};
const sub = (id, company, cats) => ({
  id, company, engagementId: `en_${id}`, accountId: "acc_pm", contact: `${company} owner`,
  email: `${id}@test.test`, phone: null, categories: cats, caps: ["Repairs"], crews: [],
  propertyIds: [], zips: [], notify: {}, rating: 0, ratedJobs: 0, bond: true, insurance: true,
  contract: true, w9: true, hasPortal: true, license: "", licenseCheck: null, available: true,
  unavailableDays: [], docReview: {}, coverage: {}, engagedAs: "subcontractor", status: "active",
});
const SUBS = [sub("cmp_cas", "Cascade Plumbing", ["plumbing"]), sub("cmp_bay", "Bay Painting", ["painting"])];
const USERS = [
  { id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "u_ten", name: "John Smith", email: "john@x.test", phone: null, role: "tenant",
    subId: null, propertyIds: ["prop_1"], unit: "53", hasLogin: true, inviteSentAt: null, hasAvatar: false },
];
const wo = (id, subId, company) => ({ id, subId, company, wo: `WO-${id}`, status: "accepted",
  auto: false, value: "900", respondBy: null, tradeScope: null, crewName: "Crew A" });
const JOB = {
  id: "job_two", accountId: "acc_pm", propertyId: "prop_1", title: "Bathroom repair", status: "active",
  date: null, time: null, address: "1620 Belmont Ave", area: "Seattle", zip: "98122",
  trades: ["plumbing", "painting"],
  assignments: { plumbing: wo("1", "cmp_cas", "Cascade Plumbing"), painting: wo("2", "cmp_bay", "Bay Painting") },
  notes: "", createdAt: "2026-10-05", photos: [], severity: null, client: null, sqft: null, stories: null,
  scope: "Leaking tap and the wall behind it", measurementDocs: [], materialSource: null, materialsPaidBy: null,
  requestedBy: "u_ten", approvedAt: "2026-10-05", declinedAt: null, withdrawnAt: null, completedAt: null,
  access: "tenant", accessEffective: "tenant", accessUserId: null, reportDetail: null,
  propertyName: "Press Apartments", visit: null,
};
let VISITS = [];
const fresh = () => [
  { id: "v_cas", jobId: "job_two", companyId: "cmp_cas", companyName: "Cascade Plumbing", date: dayKey(3),
    startTime: "09:00", endTime: "10:00", status: "proposed", note: null, respondedAt: null,
    contractorAt: `${dayKey()}T10:00:00Z`, managerAt: `${dayKey()}T10:00:00Z`,
    parties: ["contractor", "manager", "tenant"], turn: "tenant", createdAt: "2026-10-20 10:00:00" },
];
const proposals = [], answers = [];
const PROP = { id: "prop_1", accountId: "acc_pm", name: "Press Apartments", address: "1620 Belmont Ave",
  city: "Seattle", state: "WA", zip: "98122", units: 20, notes: "", vendorIds: [], ownerIds: [], tenantIds: [],
  ownerAccountId: "acc_pm", ownedNotOperated: false, readOnly: false };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/subs") return [200, SUBS];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, [JOB]];
  if (path === "/api/visits") return [200, VISITS];
  if (/^\/api\/jobs\/[^/]+\/visits$/.test(path) && method === "POST") {
    proposals.push(body);
    const v = { id: `v_new${proposals.length}`, jobId: "job_two", companyId: body.companyId || null,
      companyName: body.companyId === "cmp_bay" ? "Bay Painting" : null, date: body.date,
      startTime: body.startTime, endTime: body.endTime, status: "proposed", note: body.note || null,
      respondedAt: null, contractorAt: null, managerAt: new Date().toISOString(),
      parties: ["contractor", "manager", "tenant"], turn: "contractor", createdAt: "2026-10-26 10:00:00" };
    VISITS = [v, ...VISITS];
    return [201, v];
  }
  if (/^\/api\/visits\/[^/]+\/respond$/.test(path) && method === "POST") {
    const id = path.split("/")[3];
    answers.push({ id, body });
    VISITS = VISITS.map((v) => v.id === id ? { ...v, respondedAt: new Date().toISOString(), status: "confirmed" } : v);
    return [200, VISITS.find((v) => v.id === id)];
  }
  if (/^\/api\/jobs\/[^/]+\/access$/.test(path)) return [200, { kind: "tenant", how: null, people: [], live: true, when: null }];
  if (/^\/api\/jobs\/[^/]+\/trade-scope$/.test(path)) return [200, { scopes: {} }];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/properties") return [200, [PROP]];
  if (path === "/api/my-manager") return [200, { company: PM.name, managers: [] }];
  if (path === "/api/notices") return [200, { notices: [] }];
  if (path === "/api/weather" || path === "/api/me/contact") return [200, {}];
  if (path === "/api/invites" || path === "/api/clients" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/doc-shares" || path === "/api/tenants"
    || path === "/api/property-transfers" || path === "/api/overflow-posts"
    || path === "/api/inspections" || path === "/api/my-quotes") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

try {
  console.log("\n-- the hiring side: one time per company --");
  {
    VISITS = fresh();
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1024, height: 1366 } });
    await wait(2800);
    await page.evaluate(() => [...document.querySelectorAll("nav button")]
      .find((b) => /^Jobs/i.test((b.innerText || "").trim()))?.click());
    await wait(1200);
    const line = await page.evaluate(() => document.querySelector('.job-line[data-job-id="job_two"]')?.innerText || "");
    t.ck("the job line says a time is still to be arranged", /time to be arranged/i.test(line), line.replace(/\s+/g, " "));
    await page.evaluate(() => document.querySelector('.job-line[data-job-id="job_two"] .jl-btn')?.click());
    await wait(800);
    await page.evaluate(() => document.querySelector('.modal-job .job-tab[data-tab="schedule"]')?.click());
    await wait(500);
    const slots = await page.evaluate(() => [...document.querySelectorAll(".modal-job .visit-slot")]
      .filter((x) => x.getClientRects().length).map((x) => ({
        company: x.getAttribute("data-company"), head: x.querySelector(".vs-head")?.innerText.replace(/\s+/g, " ") || "",
        text: x.innerText.replace(/\s+/g, " "), form: !!x.querySelector(".visit-form"),
      })));
    t.ck("two appointments, one per company", slots.length === 2, JSON.stringify(slots.map((x) => x.company)));
    const cas = slots.find((x) => x.company === "cmp_cas"), bay = slots.find((x) => x.company === "cmp_bay");
    t.ck("each headed by the company and its trade", /Cascade Plumbing/.test(cas?.head || "") && /Plumbing/.test(cas?.head || "")
      && /Bay Painting/.test(bay?.head || "") && /Painting/.test(bay?.head || ""), JSON.stringify([cas?.head, bay?.head]));
    t.ck("Cascade's time is shown as proposed", /Proposed/.test(cas?.text || ""), cas?.text);
    t.ck("Bay has no time yet, so its form is open", !!bay?.form && !cas?.form, JSON.stringify([cas?.form, bay?.form]));

    // Propose Bay's time from Bay's own box.
    await page.evaluate((d) => {
      const box = document.querySelector('.modal-job .visit-slot[data-company="cmp_bay"]');
      const set = (i, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, v);
        i.dispatchEvent(new Event("input", { bubbles: true })); };
      const [date, from] = box.querySelectorAll(".visit-form input");
      set(date, d); set(from, "13:00");
    }, dayKey(5));
    await wait(200);
    await page.evaluate(() => document.querySelector('.modal-job .visit-slot[data-company="cmp_bay"] .visit-form .btn-solid')?.click());
    await wait(1200);
    t.ck("the time is proposed for Bay, by name", proposals.length === 1 && proposals[0].companyId === "cmp_bay",
      JSON.stringify(proposals));
    const after = await page.evaluate(() => [...document.querySelectorAll(".modal-job .visit-slot")]
      .filter((x) => x.getClientRects().length).map((x) => x.getAttribute("data-company") + ":" + x.innerText.replace(/\s+/g, " ")));
    t.ck("and Cascade's time is still there beside it", after.some((x) => x.startsWith("cmp_cas:") && /Proposed/.test(x))
      && after.some((x) => x.startsWith("cmp_bay:") && /Proposed/.test(x)), JSON.stringify(after));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the tenant: each company's time answered on its own --");
  {
    VISITS = [...fresh(), { id: "v_bay", jobId: "job_two", companyId: "cmp_bay", companyName: "Bay Painting",
      date: dayKey(6), startTime: "13:00", endTime: "14:00", status: "proposed", note: null, respondedAt: null,
      contractorAt: `${dayKey()}T11:00:00Z`, managerAt: `${dayKey()}T11:00:00Z`,
      parties: ["contractor", "manager", "tenant"], turn: "tenant", createdAt: "2026-10-21 10:00:00" }];
    answers.length = 0;
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "u_ten", accountId: "acc_pm" }, viewport: { width: 1100, height: 1600 } });
    await wait(2800);
    const appts = await page.evaluate(() => [...document.querySelectorAll(".tn-row .tn-appt")].map((x) => ({
      who: x.querySelector(".tn-appt-for")?.innerText || "", text: x.innerText.replace(/\s+/g, " ") })));
    t.ck("two times on the report, one per company", appts.length === 2, JSON.stringify(appts));
    t.ck("each says who is coming", appts.map((x) => x.who).join() === "Cascade Plumbing,Bay Painting", JSON.stringify(appts.map((x) => x.who)));
    await page.evaluate(() => {
      const box = [...document.querySelectorAll(".tn-row .tn-appt")].find((x) => /Bay Painting/.test(x.innerText));
      [...box.querySelectorAll("button")].find((b) => /Yes, that works/.test(b.innerText))?.click();
    });
    await wait(900);
    t.ck("answering Bay's answers Bay's, not Cascade's", answers.length === 1 && answers[0].id === "v_bay",
      JSON.stringify(answers));
    const booked = await page.evaluate(() => document.querySelector(".tn-row .tn-appt-booked")?.innerText || "");
    t.ck("and Bay then reads as booked", /Bay Painting.*booked/.test(booked), booked);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
  t.done();
}
