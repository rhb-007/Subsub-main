// HOW LONG EACH TRADE TAKES, on screen: the trade row, the window that sets
// it, the job form, the timeline, and the crew's own card and calendar.
//
// Static checks cannot see any of this. A bar on a timeline is a grid column
// worked out from dates that only exist at runtime, and "the estimate the
// form sends" is the body of a request -- so the suite draws the screens and
// reads both back.
//
// What is pinned:
//
//   THE TRADE ROW SAYS HOW LONG, and a trade with no estimate offers to set
//   one rather than drawing a blank that reads as a one-day job.
//
//   THE CREW'S SUGGESTION IS ANSWERED IN PLACE, and the answer is what is
//   sent -- Use theirs posts accept: true.
//
//   THE WINDOW AND THE FORM SEND THE FIGURES SOMEBODY TYPED, for that trade.
//
//   ON THE TIMELINE A BAR STARTS AND ENDS UNDER ITS OWN DAYS, and a trade with
//   no estimate is a dot, not a one-day bar.
//
//   THE CREW SEES THEIR OWN LENGTH AND CAN SUGGEST ANOTHER, and their calendar
//   marks every day of it, not only the first.
//
//   node scripts/job-span-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";
import { spanView, spanDates } from "../shared/span.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-job-span-test");
const WEB = 5475, API = 9175;
const t = tally();

const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// The Monday of next week: inside the timeline's first window from today,
// and a three-day span from it does not cross a weekend.
const MON1 = (() => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return key(d); })();
const plus = (k, n) => { const d = new Date(`${k}T12:00:00`); d.setDate(d.getDate() + n); return key(d); };
const PLUMB = spanView({ start: MON1, days: 3 });
const PAINT = { ...spanView({ start: plus(MON1, 3), days: 2 }),
  proposal: { start: plus(MON1, 3), days: 4, end: spanView({ start: plus(MON1, 3), days: 4 }).end,
    note: "two coats", by: "Ann Bay", at: "2026-10-10T10:00:00Z" } };

let SEAT = "mgr";
const ACCOUNT = () => ({
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: SEAT === "mgr"
    ? { id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", role: "admin" }
    : { id: "u_pac", name: "Juan Soto", email: "juan@pac.test", role: "contractor" },
});
const sub = (id, company, cats) => ({
  id, company, engagementId: `en_${id}`, accountId: "acc_pm", contact: `${company} owner`,
  email: `${id}@test.test`, phone: null, categories: cats, caps: [], crews: [],
  propertyIds: [], zips: [], notify: {}, rating: 0, ratedJobs: 0, bond: true, insurance: true,
  contract: true, w9: true, hasPortal: true, license: "", licenseCheck: null, available: true,
  unavailableDays: [], docReview: {}, coverage: {}, engagedAs: "subcontractor", status: "active",
});
const SUBS = [sub("cmp_pac", "Pacific apartment maintenance", ["plumbing"]), sub("cmp_bay", "Bay Painting", ["painting"])];
const wo = (id, subId, company, status = "accepted") => ({ id, subId, company, wo: `WO-${id}`, status,
  auto: false, value: "900", respondBy: null, responseWindow: null, respondedAt: null, tradeScope: null,
  crewName: null, payKind: "fixed", rate: "", capHours: null, signedWO: null, rating: null });
const base = (id, title, trades, assignments, spans, date) => ({
  id, accountId: "acc_pm", propertyId: null, title, status: "active", date, time: "09:00",
  address: "1620 Belmont Ave", area: "Seattle", zip: "98122", trades, assignments, spans,
  notes: "", createdAt: "2026-10-05", photos: [], severity: null, client: null, sqft: null,
  stories: null, scope: "", measurementDocs: [], materialSource: null, materialsPaidBy: null,
  requestedBy: null, approvedAt: "2026-10-05", declinedAt: null, withdrawnAt: null, completedAt: null,
  access: null, accessEffective: "manager", accessUserId: null, reportDetail: null, propertyName: null, visit: null,
});
let SPANS = { plumbing: PLUMB, painting: PAINT };
const JOBS = () => SEAT === "mgr" ? [
  base("j_span", "Bathroom refit", ["plumbing", "painting"],
    { plumbing: wo("1", "cmp_pac", "Pacific apartment maintenance"), painting: wo("2", "cmp_bay", "Bay Painting", "pending") },
    SPANS, MON1),
  base("j_none", "Roof patch", ["roofing"], {}, {}, plus(MON1, 1)),
] : [
  // A contractor's copy: their own trade, their own estimate.
  base("j_span", "Bathroom refit", ["plumbing", "painting"],
    { plumbing: wo("1", "cmp_pac", "Pacific apartment maintenance") }, { plumbing: PLUMB }, MON1),
];
const WORK = () => SEAT === "mgr" ? { work: [] } : { work: [{
  woId: "1", wo: "WO-1", jobId: "j_span", trade: "plumbing", span: PLUMB, accountId: "acc_pm",
  accountName: "Sound Property Management", accountSubdomain: "soundpm", accountKind: "property_manager",
  here: true, status: "accepted", auto: false, responseWindow: null, respondBy: null, respondedAt: null,
  title: "Bathroom refit", address: "1620 Belmont Ave", area: "Seattle", zip: "98122", propertyName: null,
  date: MON1, time: "09:00", severity: null, jobStatus: "active", completedAt: null, tradeScope: null,
  crewName: null, payKind: "fixed", value: "900", rate: "", capHours: null, signedWO: null, issuedAt: null,
  updatedAtIso: null, access: null, visit: null }] };
const sent = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (method !== "GET") sent.push({ path, method, body });
  if (path === "/api/auth/me") return [200, { user: ACCOUNT().user, memberships: [
    { accountId: "acc_pm", accountName: "Sound Property Management", subdomain: "soundpm", kind: "property_manager",
      role: ACCOUNT().user.role, companyId: SEAT === "mgr" ? null : "cmp_pac", plan: "scale", billing: "monthly",
      theme: null, trades: [], logoKey: null, useDefaultMark: true }] }];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT()];
  if (path === "/api/account") return [200, ACCOUNT()];
  if (path === "/api/subs") return [200, SUBS];
  if (path === "/api/account-users") return [200, [SEAT === "mgr"
    ? { id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", phone: null, role: "admin",
      subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }
    : { id: "u_pac", name: "Juan Soto", email: "juan@pac.test", phone: null, role: "contractor",
      subId: "cmp_pac", propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/jobs") return [200, JOBS()];
  if (path === "/api/my-work") return [200, WORK()];
  if (path === "/api/jobs/j_span/spans" && method === "PUT") {
    const next = { ...SPANS };
    for (const [tr, v] of Object.entries(body?.spans || {})) next[tr] = v ? spanView(v) : undefined;
    SPANS = next;
    return [200, { ok: true, spans: next }];
  }
  if (/^\/api\/jobs\/j_span\/spans\/painting\/answer$/.test(path)) {
    const { proposal, ...rest } = PAINT;
    const out = body?.accept ? spanView({ start: proposal.start, days: proposal.days }) : rest;
    SPANS = { ...SPANS, painting: out };
    return [200, { ok: true, accepted: !!body?.accept, spans: SPANS }];
  }
  if (/^\/api\/jobs\/j_span\/spans\/plumbing\/propose$/.test(path))
    return [200, { ok: true, proposed: true, span: { ...PLUMB, proposal: { start: body.start, days: body.days, end: body.start } } }];
  if (path === "/api/jobs/j_span" && method === "PATCH") return [200, { ok: true, rescheduled: null,
    spans: Object.fromEntries(Object.entries(body?.spans || {}).map(([tr, v]) => [tr, spanView(v)])) }];
  if (/^\/api\/jobs\/[^/]+\/trade-scope$/.test(path)) return [200, { scopes: {} }];
  if (/^\/api\/jobs\/[^/]+\/access$/.test(path)) return [404, { error: "not_found" }];
  if (/^\/api\/work-orders\/[^/]+\/plan$/.test(path))
    return [200, { valueCents: 90000, milestones: [], releases: [], retainageBps: 0 }];
  if (/\/inspection$/.test(path)) return [404, { error: "not_found" }];
  if (["/api/properties", "/api/invites", "/api/clients", "/api/connect-requests", "/api/my-connect-requests",
    "/api/doc-shares", "/api/property-transfers", "/api/overflow-posts", "/api/inspections", "/api/my-quotes",
    "/api/visits", "/api/change-orders"].includes(path)) return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const nav = (page, re) => page.evaluate((src) => [...document.querySelectorAll("nav button, .drawer button, aside button")]
  .find((b) => new RegExp(src, "i").test((b.innerText || "").trim()))?.click(), re);
const setNum = (page, sel, v) => page.evaluate(([s, val]) => {
  const el = document.querySelector(s);
  if (!el) return false;
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, val);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, [sel, v]);
const clickText = (page, sel, re) => page.evaluate(([s, src]) => {
  const b = [...document.querySelectorAll(s)].find((x) => new RegExp(src, "i").test(x.innerText.trim()));
  if (b) b.click();
  return !!b;
}, [sel, re]);
const last = (pred) => [...sent].reverse().find(pred);

try {
  const { page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1280, height: 1600 } });
  const logs = [];
  page.on("pageerror", (e) => logs.push("THROW " + String(e).slice(0, 200)));
  await wait(2800);
  await nav(page, "^Jobs");
  await wait(1200);
  await openCards(page);
  await wait(600);

  console.log("\n-- the trade row says how long --");
  const rows = await page.evaluate(() => [...document.querySelectorAll(".job-card .trade-row, [data-job-id] .trade-row")]
    .map((r) => ({
      job: r.closest("[data-job-id]")?.getAttribute("data-job-id"),
      trade: r.querySelector(".trade-name")?.innerText.trim(),
      est: r.querySelector(".tsp-line")?.innerText.replace(/\s+/g, " ").trim() || null,
      add: r.querySelector(".tsp-add")?.innerText.trim() || null,
      prop: r.querySelector(".tsp-prop")?.innerText.replace(/\s+/g, " ").trim() || null,
    })));
  const plumb = rows.find((r) => r.job === "j_span" && /Plumbing/.test(r.trade || "")) || {};
  const paint = rows.find((r) => r.job === "j_span" && /Painting/.test(r.trade || "")) || {};
  const roof = rows.find((r) => r.job === "j_none") || {};
  t.ck("the trade rows are on screen", rows.length >= 3, JSON.stringify(rows).slice(0, 300));
  t.ck("an estimated trade says how long, in working days", /Est\..*3 working days/i.test(plumb.est || ""), String(plumb.est));
  t.ck("and offers to change it", /Change/.test(plumb.est || ""), String(plumb.est));
  t.ck("a trade with no estimate offers to set one rather than a blank",
    /How long will it take\?/.test(roof.add || "") && !roof.est, JSON.stringify(roof));
  t.ck("the crew's suggestion is shown under the estimate, named and with its length",
    /Bay Painting suggests .*4 working days.*two coats/.test(paint.prop || ""), String(paint.prop));

  console.log("\n-- the suggestion is answered in place --");
  await page.evaluate(() => [...document.querySelectorAll(".tsp-use")][0]?.click());
  await wait(700);
  const ans = last((x) => /\/spans\/painting\/answer$/.test(x.path));
  t.ck("Use theirs sends accept: true", ans?.body?.accept === true, JSON.stringify(ans));
  const after = await page.evaluate(() => document.querySelectorAll(".tsp-prop").length);
  t.ck("and the answered suggestion goes", after === 0, String(after));

  console.log("\n-- the window that sets one --");
  await page.evaluate(() => {
    const r = [...document.querySelectorAll("[data-job-id='j_span'] .trade-row")]
      .find((x) => /Plumbing/.test(x.querySelector(".trade-name")?.innerText || ""));
    r?.querySelector(".tsp-edit")?.click();
  });
  await wait(500);
  const opened = await page.evaluate(() => !!document.querySelector(".span-modal"));
  t.ck("Change opens the estimate window", opened);
  // iPad Safari gives a date box its own intrinsic width and height, which
  // Chrome does not, so the test stands that in with a UA-weight rule (:where
  // adds no specificity) and checks the window's own CSS wins over it.
  for (const w of [820, 1024]) {
    await page.setViewport({ width: w, height: 1000 });
    await page.evaluate(() => {
      if (document.getElementById("safari-date")) return;
      const st = document.createElement("style"); st.id = "safari-date";
      st.textContent = ":where(input[type=date]){min-width:300px;height:54px}";
      document.head.appendChild(st);
    });
    await wait(150);
    const g = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
      const ds = r(".span-modal .spf-start input"), dd = r(".span-modal .spf-days input");
      const ls = r(".span-modal .spf-start"), ld = r(".span-modal .spf-days");
      return ds && dd ? { dsR: ds.right, ddL: dd.left, lsT: ls.top, ldT: ld.top, dsH: ds.height, ddH: dd.height } : null;
    });
    t.ck(`at ${w}px the date box ends before the days box starts`, !!g && g.dsR <= g.ddL + 0.5, JSON.stringify(g));
    t.ck(`at ${w}px both labels start on one line`, !!g && Math.abs(g.lsT - g.ldT) < 1, JSON.stringify(g));
    t.ck(`at ${w}px both boxes are one height`, !!g && Math.abs(g.dsH - g.ddH) < 1, JSON.stringify(g));
  }
  await page.evaluate(() => document.getElementById("safari-date")?.remove());
  await page.setViewport({ width: 1100, height: 1000 });
  await setNum(page, ".span-modal .spf-days input", "4");
  await wait(250);
  const out = await page.evaluate(() => document.querySelector(".span-modal .spf-out")?.innerText.trim() || "");
  t.ck("the finish is worked out as the length is typed", /^Finishes /.test(out), out);
  await clickText(page, ".span-modal .form-actions button", "Save estimate");
  await wait(700);
  const put = last((x) => x.path === "/api/jobs/j_span/spans" && x.method === "PUT");
  t.ck("Save sends that trade's figures and only that trade",
    JSON.stringify(put?.body) === JSON.stringify({ spans: { plumbing: { start: MON1, days: 4, weekends: false } } }),
    JSON.stringify(put?.body));
  const est4 = await page.evaluate(() => [...document.querySelectorAll("[data-job-id='j_span'] .tsp-line")]
    .map((x) => x.innerText).join(" | "));
  t.ck("and the row draws the server's answer", /4 working days/.test(est4), est4);

  console.log("\n-- the job form carries them --");
  await page.evaluate(() => document.querySelector("[data-job-id='j_span'] .job-title-edit")?.click());
  await wait(700);
  await page.evaluate(() => [...document.querySelectorAll(".modal .job-steps button")]
    .find((b) => /Trades/.test(b.innerText))?.click());
  await wait(400);
  const form = await page.evaluate(() => ({
    rows: [...document.querySelectorAll(".modal .js-row")].map((r) => ({
      trade: r.getAttribute("data-trade"), days: r.querySelector(".spf-days input")?.value })),
    head: [...document.querySelectorAll(".modal .form-sec")].map((x) => x.innerText.trim()),
  }));
  t.ck("the Trades step asks how long each trade takes", form.head.some((h) => /how long each trade/i.test(h)),
    JSON.stringify(form.head));
  t.ck("one row per trade on the job", form.rows.length === 2, JSON.stringify(form.rows));
  t.ck("seeded with the estimate the job has", form.rows.find((r) => r.trade === "plumbing")?.days === "4",
    JSON.stringify(form.rows));
  await setNum(page, ".modal .js-row[data-trade='painting'] .spf-days input", "6");
  await wait(250);
  await clickText(page, ".modal .form-actions button", "Save changes");
  await wait(800);
  const patch = last((x) => x.path === "/api/jobs/j_span" && x.method === "PATCH");
  t.ck("saving the job sends each trade's estimate",
    patch?.body?.spans?.painting?.days === 6 && patch.body.spans.plumbing?.days === 4,
    JSON.stringify(patch?.body?.spans));

  console.log("\n-- the timeline --");
  SPANS = { plumbing: PLUMB, painting: PAINT };
  await page.evaluate(() => [...document.querySelectorAll(".jv-seg button")].find((b) => /Timeline/.test(b.innerText))?.click());
  await wait(600);
  const tl = await page.evaluate(() => {
    const el = document.querySelector(".jtl");
    if (!el) return null;
    const dayAt = (k) => el.querySelector(`.jtl-day[data-day="${k}"]`)?.getBoundingClientRect();
    return {
      days: el.querySelectorAll(".jtl-head .jtl-day").length,
      jobs: [...el.querySelectorAll(".jtl-job")].map((j) => j.getAttribute("data-job-id")),
      bar: (() => {
        const b = el.querySelector(".jtl-job[data-job-id='j_span'] .jtl-lane[data-trade='plumbing'] .jtl-bar");
        return b ? { l: b.getBoundingClientRect().left, r: b.getBoundingClientRect().right, txt: b.innerText.trim() } : null;
      })(),
      dot: !!el.querySelector(".jtl-job[data-job-id='j_none'] .jtl-dot"),
      noneBar: !!el.querySelector(".jtl-job[data-job-id='j_none'] .jtl-bar"),
      key: (el.querySelector(".jcal-key")?.innerText || "").replace(/\s+/g, " "),
      _dayRects: Object.fromEntries([...el.querySelectorAll(".jtl-head .jtl-day")].map((d) =>
        [d.getAttribute("data-day"), { l: d.getBoundingClientRect().left, r: d.getBoundingClientRect().right }])),
      dayAtOk: !!dayAt,
    };
  });
  t.ck("the Timeline view opens", !!tl, String(tl));
  t.ck("four weeks across on a tablet", tl?.days === 28, String(tl?.days));
  t.ck("both jobs are on it", tl?.jobs.includes("j_span") && tl.jobs.includes("j_none"), JSON.stringify(tl?.jobs));
  // Plumbing is four days now: the job form's save above came back with the
  // server's answer, and the timeline draws what the job holds.
  const P4 = spanView({ start: MON1, days: 4 });
  const sDay = tl?._dayRects?.[P4.first];
  const eDay = tl?._dayRects?.[P4.end];
  t.ck("a bar starts under the day its trade starts",
    !!tl?.bar && !!sDay && Math.abs(tl.bar.l - sDay.l) <= 3, JSON.stringify({ bar: tl?.bar, sDay }));
  t.ck("and ends under the day it finishes",
    !!tl?.bar && !!eDay && Math.abs(tl.bar.r - eDay.r) <= 3, JSON.stringify({ bar: tl?.bar, eDay }));
  t.ck("named for its trade and who has it", /Plumbing · Pacific/.test(tl?.bar?.txt || ""), String(tl?.bar?.txt));
  t.ck("a trade with no estimate is a dot, not a one-day bar", tl?.dot === true && tl?.noneBar === false,
    JSON.stringify({ dot: tl?.dot, bar: tl?.noneBar }));
  t.ck("and the key says what a dot means", /No estimate yet/.test(tl?.key || ""), String(tl?.key));

  await page.setViewport({ width: 390, height: 900 });
  await wait(300);
  await page.evaluate(() => [...document.querySelectorAll(".jv-seg button")].find((b) => /List/.test(b.innerText))?.click());
  await wait(200);
  await page.evaluate(() => [...document.querySelectorAll(".jv-seg button")].find((b) => /Timeline/.test(b.innerText))?.click());
  await wait(500);
  const phone = await page.evaluate(() => ({
    days: document.querySelectorAll(".jtl .jtl-head .jtl-day").length,
    over: document.scrollingElement.scrollWidth - window.innerWidth,
  }));
  t.ck("two weeks on a phone", phone.days === 14, String(phone.days));
  t.ck("without the page scrolling sideways", phone.over <= 1, String(phone.over));
  t.ck("the manager's screens drew without throwing", crashes.length === 0 && logs.length === 0,
    JSON.stringify([...crashes, ...logs]).slice(0, 300));

  console.log("\n-- the crew's side --");
  SEAT = "pac";
  const crew = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_pac", accountId: "acc_pm" }, viewport: { width: 1280, height: 1600 } });
  const cp = crew.page;
  const clogs = [];
  cp.on("pageerror", (e) => clogs.push("THROW " + String(e).slice(0, 200)));
  await wait(2800);
  await nav(cp, "^My Jobs");
  await wait(1000);
  await openCards(cp);
  await cp.evaluate(() => document.querySelectorAll(".jr-line, .jl-btn[aria-expanded='false']").forEach((b) => b.click()));
  await wait(600);
  const card = await cp.evaluate(() => {
    const s = document.querySelector(".jr-span");
    return s ? { txt: s.innerText.replace(/\s+/g, " ").trim(), btn: s.querySelector(".jr-span-btn")?.innerText.trim() } : null;
  });
  t.ck("the crew's card says how long their trade takes", /Estimated .*3 working days/.test(card?.txt || ""), JSON.stringify(card));
  t.ck("and offers to suggest a different length", card?.btn === "Suggest a different length", JSON.stringify(card));
  await cp.evaluate(() => document.querySelector(".jr-span .jr-span-btn")?.click());
  await wait(500);
  await setNum(cp, ".span-modal .spf-days input", "5");
  await wait(200);
  await clickText(cp, ".span-modal .form-actions button", "Send suggestion");
  await wait(800);
  const prop = last((x) => /\/spans\/plumbing\/propose$/.test(x.path));
  t.ck("Send posts their figures as a suggestion", prop?.body?.days === 5 && prop.body.start === MON1,
    JSON.stringify(prop?.body));

  await cp.evaluate(() => [...document.querySelectorAll(".seg-tabs button, .mj-tabs button, .jobs-panes button")]
    .find((b) => /^Calendar/i.test(b.innerText.trim()))?.click());
  await wait(700);
  const site = await cp.evaluate(() => [...document.querySelectorAll(".mycal .jcal-cell.on-site")]
    .map((c) => c.getAttribute("data-day")));
  const want = spanDates({ start: PLUMB.start, days: PLUMB.days });
  const sameMonth = want.filter((k) => k.slice(0, 7) === want[0].slice(0, 7));
  t.ck("the crew's calendar marks every day of the span, not only the first",
    sameMonth.length > 0 && sameMonth.every((k) => site.includes(k)), JSON.stringify({ site, want }));
  t.ck("and nothing outside it", site.every((k) => want.includes(k)), JSON.stringify(site));
  t.ck("the crew's screens drew without throwing", crew.crashes.length === 0 && clogs.length === 0,
    JSON.stringify([...crew.crashes, ...clogs]).slice(0, 300));
} catch (e) {
  t.ck("the suite ran to the end", false, String(e?.stack || e).slice(0, 400));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
