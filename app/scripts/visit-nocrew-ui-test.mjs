// "DID YOUR VENDOR SHOW UP?" ABOUT A JOB NOBODY WAS EVER SENT TO.
//
// Reported from a job reading 0/1 trades, Electrical, no contractor, out to
// overflow -- and under it, "the tenant (Ricard Bond) says a vendor showed up
// on Sep 23, 2026 - 10 AM-11 AM", beside an access note promising that "the
// tenant and the subcontractor both confirm the time". Nobody had accepted the
// job. The only work order was an offer that ran out with no reply, which the
// outcome route counted as somebody sent.
//
// Both sides, drawn:
//   - the MANAGER's card says nobody was sent, not that somebody came, and the
//     access note says nobody is coming until somebody accepts -- while a job a
//     crew DID accept still reads "says a vendor showed up";
//   - the DASHBOARD's past-due line says nobody has accepted it, not "no visit
//     set", for a job with nobody on it;
//   - the TENANT is asked "Did your vendor show up?" only about the job a crew
//     accepted, and an answer already given about a job nobody accepted reads
//     as still waiting on a vendor, never "Visited".
//
//   node --no-warnings scripts/visit-nocrew-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-visitnocrew-test");
const WEB = 5435, API = 9205;
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
let SEAT = { userId: "u_mgr", role: "admin" };
const USERS = [
  { id: "u_mgr", name: "Richard Braun", email: "rb@soundpm.test", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "u_ten", name: "Ricard Bond", email: "rbond@t.test", phone: null, role: "tenant",
    subId: null, propertyIds: ["prop_1"], unit: "53", hasLogin: true, inviteSentAt: null, hasAvatar: false },
];
const SUB = {
  id: "cmp_pac", company: "Pacific apartment maintenance", engagementId: "en_pac",
  accountId: "acc_pm", contact: "Juan Soto", email: "juan@pacific.test", phone: null,
  categories: ["electrical", "plumbing"], caps: [], crews: [], propertyIds: [], zips: [],
  notify: {}, rating: null, bond: true, insurance: true, contract: true, w9: true,
  hasPortal: true, license: "", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {}, engagedAs: "subcontractor", status: "active",
};
const wo = (trade, status, extra = {}) => ({ [trade]: {
  id: `wo-${trade}`, wo: `WO-${trade}`, subId: "cmp_pac", company: "Pacific apartment maintenance",
  status, auto: false, responseWindow: "24h", respondBy: status === "pending" ? `${key(-5)}T10:00:00Z` : null,
  respondedAt: null, value: "300", payKind: "fixed", rate: "", capHours: null, tradeScope: null,
  crewName: null, signedWO: null, rating: null, ...extra } });
const job = (id, title, trades, assignments, extra = {}) => ({
  id, accountId: "acc_pm", propertyId: "prop_1", title, status: "active",
  date: key(-2), time: "10:00", address: "1620 Belmont Ave", area: "Seattle", zip: "98122",
  trades, assignments, notes: "", createdAt: "Oct 1", createdAtIso: "2026-10-01T00:00:00Z",
  photos: [], severity: null, client: null, sqft: null, stories: null, scope: "", measurementDocs: [],
  materialSource: null, materialsPaidBy: null, requestedBy: "u_ten", approvedAt: "2026-10-02",
  declinedAt: null, withdrawnAt: null, completedAt: null, access: null, accessEffective: "tenant",
  accessUserId: null, reportDetail: null, propertyName: "Press Apartments", readOnly: false, spans: {}, ...extra,
});
const JOBS = [
  // THE REPORTED ONE: an offer that ran out, and the tenant already said yes.
  job("j_offer", "There's no power in one room", ["electrical"], wo("electrical", "pending")),
  // Nobody ever offered it: an agreed time that has passed.
  job("j_none", "No heat in the bedroom", ["hvac"], {}),
  // A crew DID accept, and the tenant said they came: still reads that way.
  job("j_came", "Kitchen tap drips", ["plumbing"], wo("plumbing", "accepted")),
  // A crew accepted and the window passed: this one is the tenant's question.
  job("j_ask", "Bathroom fan is loud", ["electrical"], wo("electrical", "accepted")),
];
const T = "2026-10-01T12:00:00.000Z";
const v = (id, jobId, status, extra = {}) => ({ id, jobId, status, date: key(-2), startTime: "10:00",
  endTime: "11:00", note: "", tenantNote: null, respondedAt: T, contractorAt: null, contractorNote: null,
  managerAt: T, proposedBy: "u_mgr", createdAt: T, turn: null, waitingOn: [], ...extra });
const VISITS = [
  v("v_offer", "j_offer", "happened", { parties: ["manager", "tenant"] }),
  v("v_none", "j_none", "confirmed", { parties: ["manager", "tenant"] }),
  v("v_came", "j_came", "happened", { contractorAt: T, parties: ["contractor", "manager", "tenant"] }),
  v("v_ask", "j_ask", "confirmed", { contractorAt: T, parties: ["contractor", "manager", "tenant"] }),
];
const PROP = { id: "prop_1", accountId: "acc_pm", name: "Press Apartments", address: "1620 Belmont Ave",
  city: "Seattle", state: "WA", zip: "98122", units: 60, notes: "", ownedByAnother: false,
  vendorIds: [], ownerIds: [], tenantIds: [], ownerAccountId: "acc_pm", ownedNotOperated: false, readOnly: false };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, { ...PM, user: { ...PM.user, id: SEAT.userId, role: SEAT.role } }];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/visits") return [200, VISITS];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/properties") return [200, [PROP]];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (/^\/api\/jobs\/[^/]+\/trade-scope$/.test(path)) return [200, { scopes: {} }];
  if (/^\/api\/jobs\/[^/]+\/access$/.test(path)) return [200, { kind: "tenant", people: [], when: null }];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/invites" || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/tenants" || path === "/api/clients" || path === "/api/notices"
    || path === "/api/my-notices" || path === "/api/inspections" || path === "/api/my-quotes"
    || path === "/api/doc-shares" || path === "/api/property-transfers" || path === "/api/overflow-posts"
    || path === "/api/threads") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();
const nav = (page, re) => page.evaluate((src) => [...document.querySelectorAll("nav button")]
  .find((b) => new RegExp(src, "i").test((b.innerText || "").trim()))?.click(), re);

try {
  console.log("\n-- the manager's dashboard --");
  const m = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1340, height: 1600 } });
  await wait(2800);
  const late = await m.page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".shl-row")]
    .map((r) => [r.querySelector(".shl-title")?.innerText.trim(), r.querySelector(".shl-state")?.innerText.trim()])));
  t.ck("the past-due rows are drawn", Object.keys(late).length >= 2, JSON.stringify(late));
  t.ck("a job nobody accepted says so, not 'no visit set'",
    /nobody has accepted it/.test(late["No heat in the bedroom"] || ""), JSON.stringify(late));
  t.ck("and a job with a crew still says its visit passed",
    /Visit passed/.test(late["Bathroom fan is loud"] || ""), JSON.stringify(late));

  // The chip is the longest thing on the row, and in the half-width panel an
  // iPad draws it ran past the amber box. Measured, because only the drawn
  // box knows whether it fits.
  for (const width of [1340, 1024, 820, 600, 390]) {
    await m.page.setViewport({ width, height: 1600 });
    await wait(500);
    const fit = await m.page.evaluate(() => {
      const box = document.querySelector(".sh-late");
      if (!box) return null;
      const edge = box.getBoundingClientRect().right;
      return [...box.querySelectorAll(".shl-row")].map((r) => {
        const st = r.querySelector(".shl-state").getBoundingClientRect();
        const ti = r.querySelector(".shl-title").getBoundingClientRect();
        return { over: Math.round(st.right - edge), title: Math.round(ti.width) };
      });
    });
    t.ck(`at ${width}px every chip stays inside the past-due box`,
      !!fit && fit.length >= 2 && fit.every((f) => f.over <= 0), JSON.stringify(fit));
    t.ck(`at ${width}px every title keeps room to be read`,
      !!fit && fit.length >= 2 && fit.every((f) => f.title >= 90), JSON.stringify(fit));
  }
  await m.page.setViewport({ width: 1340, height: 1600 });
  await wait(400);

  console.log("\n-- the manager's job cards --");
  await nav(m.page, "^Jobs");
  await wait(1200);
  await openCards(m.page);
  await wait(600);
  const cards = await m.page.evaluate(() => Object.fromEntries(["j_offer", "j_none", "j_came", "j_ask"].map((id) => {
    const c = [...document.querySelectorAll(`[data-job-id="${id}"]`)].find((x) => x.querySelector(".visit-access, .visit-state"));
    if (!c) return [id, null];
    return [id, {
      states: [...c.querySelectorAll(".visit-state")].map((p) => p.innerText.replace(/\s+/g, " ").trim()),
      nobodySent: !!c.querySelector("[data-nobody-sent]"),
      noCrew: c.querySelector("[data-nocrew]")?.innerText.replace(/\s+/g, " ").trim() || null,
    }];
  })));
  t.ck("all four cards are drawn", Object.values(cards).every(Boolean), JSON.stringify(cards));
  const offer = cards.j_offer || {};
  t.ck("THE REPORTED JOB no longer says a vendor showed up",
    !!cards.j_offer && !offer.states.some((s) => /says a vendor showed up/.test(s)), JSON.stringify(offer));
  t.ck("it says nobody was sent, and that the tenant's answer does not count",
    offer.nobodySent && offer.states.some((s) => /no contractor was assigned, so nobody was sent/.test(s)
      && /Ricard Bond\) answered that somebody came; that answer does not count/.test(s)), JSON.stringify(offer.states));
  t.ck("and the access note says nobody is coming until somebody accepts",
    /nobody is coming until one does/.test(offer.noCrew || ""), String(offer.noCrew));
  const none = cards.j_none || {};
  t.ck("a passed time with nobody on the job says nobody was sent, not 'hasn't said whether anybody showed up'",
    none.nobodySent && !none.states.some((s) => /hasn't said yet whether anybody showed up/.test(s)),
    JSON.stringify(none));
  t.ck("and says it once, with the way to fix it", none.states?.length === 1 && /Assign one, then propose a new time/.test(none.states[0])
    && !/does not count/.test(none.states[0]), JSON.stringify(none.states));
  const came = cards.j_came || {};
  t.ck("a job a crew accepted still reads 'says a vendor showed up'",
    came.states?.some((s) => /says a vendor showed up/.test(s)) && !came.nobodySent && !came.noCrew,
    JSON.stringify(came));
  const ask = cards.j_ask || {};
  t.ck("and a crewed passed visit still waits on the tenant's answer",
    ask.states?.some((s) => /hasn't said yet whether anybody showed up/.test(s)) && !ask.nobodySent,
    JSON.stringify(ask));
  t.ck("the manager's screen did not crash", m.crashes.length === 0, JSON.stringify(m.crashes));
  await m.ctx.close();

  console.log("\n-- the tenant --");
  SEAT = { userId: "u_ten", role: "tenant" };
  const tn = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_ten", accountId: "acc_pm" }, viewport: { width: 1100, height: 2200 } });
  await wait(2800);
  const ten = await tn.page.evaluate(() => {
    const sec = [...document.querySelectorAll(".tn-sec")].find((s) => /Did your vendor show up\?/i.test(s.querySelector(".tn-sec-title")?.innerText || ""));
    const rows = Object.fromEntries([...document.querySelectorAll(".tn-row")].map((r) =>
      [r.querySelector(".tn-row-title")?.innerText.trim(), {
        chip: r.querySelector(".tn-chip")?.innerText.trim() || null,
        asks: !!r.querySelector(".tn-after") }]));
    return { titles: [...document.querySelectorAll(".tn-sec-title")].map((x) => x.innerText), overdue: sec ? [...sec.querySelectorAll(".tn-row-title")].map((x) => x.innerText.trim()) : null, rows };
  });
  t.ck("the tenant's reports are drawn", Object.keys(ten.rows).length >= 4, JSON.stringify(ten));
  t.ck("'Did your vendor show up?' lists only the job a crew accepted",
    JSON.stringify(ten.overdue) === JSON.stringify(["Bathroom fan is loud"]), JSON.stringify([ten.overdue, ten.titles]));
  const o = ten.rows["There's no power in one room"] || {};
  t.ck("the reported job does not read 'Visited'", !!o.chip && !/^Visited/.test(o.chip), String(o.chip));
  t.ck("it reads as still waiting on a vendor", /Still waiting on a vendor to accept/.test(o.chip || ""), String(o.chip));
  t.ck("and asks nothing", o.asks === false, JSON.stringify(o));
  const n = ten.rows["No heat in the bedroom"] || {};
  t.ck("a job nobody was offered reads as still lining one up", /Still lining up a vendor/.test(n.chip || ""), String(n.chip));
  t.ck("a job a crew accepted, answered, still reads Visited", /^Visited/.test(ten.rows["Kitchen tap drips"]?.chip || ""),
    JSON.stringify(ten.rows["Kitchen tap drips"]));
  t.ck("the crewed one with its window passed asks", ten.rows["Bathroom fan is loud"]?.asks === true,
    JSON.stringify(ten.rows["Bathroom fan is loud"]));
  t.ck("the tenant's screen did not crash", tn.crashes.length === 0, JSON.stringify(tn.crashes));
  await tn.ctx.close();
} catch (e) { t.ck("threw", false, String(e?.stack || e)); }
await browser.close(); web.close(); api.close();
t.done();
