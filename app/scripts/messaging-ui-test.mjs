// 081. Messages, drawn: the Inbox, the nav badge, the dashboard's New
// messages, the conversation beside a job, and the tenant's half.
//
// What is pinned, and why each is here rather than assumed:
//
//   AN UNREAD MESSAGE IS FOUND FROM ANYWHERE: a count on the Inbox entry and
//   a row on the dashboard with Reply on it, which opens THAT conversation.
//
//   WHAT IS TYPED IS WHAT IS SENT. The body of the POST is read, not the
//   bubble -- a composer that draws the words and posts nothing is the bug a
//   screen test is there to catch.
//
//   NEW MESSAGE LISTS THE CALLER'S OWN RELATIONSHIPS and starts the thread the
//   server names; the composer is then on screen.
//
//   THE JOB CARD NAMES ITS PARTIES and opens the job's own thread with each:
//   the request sent carries the job and the company or person.
//
//   A TENANT WRITES FROM THEIR REPORT, and the request names them and the job.
//
//   A PARTY WHO HAS GONE leaves the history readable and no composer.
//
//   ON A PHONE the list and the conversation are one screen at a time, with a
//   way back.
//
//   node --no-warnings scripts/messaging-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-messaging-test");
const WEB = 5507, API = 9109;
const t = tally();

const today = new Date().toISOString().slice(0, 10);
const acct = {
  id: "acc_x", name: "Sound Property Management", subdomain: "x", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
};
const PROP = { id: "prop_1", accountId: "acc_x", name: "Cedar Flats", address: "12 Cedar St",
  city: "Seattle", state: "WA", zip: "98101", units: 24, notes: "", ownedByAnother: false, ownerDeclared: false };
const USERS = [
  { id: "usr_r", name: "Richard Braun", email: "rb@x.test", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "usr_t", name: "Tess Nguyen", email: "tess@x.test", phone: null, role: "tenant",
    subId: null, propertyIds: ["prop_1"], unit: "3B", hasLogin: true, inviteSentAt: null, hasAvatar: false },
];
const SUBS = [{ id: "cmp_p", company: "Pacific Apartment Maintenance", engagementId: "en1", accountId: "acc_x",
  categories: ["plumbing"], propertyIds: [], crews: [], bond: true, insurance: true, contract: true,
  hasPortal: true, notify: {}, rating: null, zips: [] }];
const JOB = { id: "j1", accountId: "acc_x", title: "Leaking sink", propertyId: "prop_1", address: "12 Cedar St",
  trades: ["plumbing"], status: "active", date: today, time: "09:00", photos: [], createdAt: today,
  requestedBy: "usr_t", approvedAt: today, scope: "Under the kitchen sink",
  assignments: { plumbing: { subId: "cmp_p", company: "Pacific Apartment Maintenance", status: "accepted", wo: "WO-1", id: "wo1" } } };

const thread = (o) => ({ accountId: "acc_x", kind: "tenant", partyUserId: "usr_t", partyCompanyId: null,
  partyAccountId: null, jobId: null, propertyId: "prop_1", accountName: "Sound Property Management",
  jobTitle: null, propertyName: "Cedar Flats", unit: "3B", partyName: "Tess Nguyen",
  lastAt: new Date().toISOString(), createdAt: new Date().toISOString(), lastHasPhoto: false, ...o });
let THREADS = [];
let MESSAGES = {};
let GONE = new Set();
let VISIT = null;
let LINKS = [];
const sent = [];
const reset = () => {
  THREADS = [
    thread({ id: "th1", side: "home", unread: 1, lastBody: "Is anyone coming about the sink?", lastSide: "party" }),
    thread({ id: "th2", side: "home", unread: 0, kind: "crew", partyUserId: null, partyCompanyId: "cmp_p",
      propertyId: null, partyName: "Pacific Apartment Maintenance", unit: null, lastBody: "Parts arrive Tuesday.", lastSide: "party" }),
  ];
  MESSAGES = {
    th1: [{ id: "m1", threadId: "th1", authorUserId: "usr_t", authorName: "Tess Nguyen", authorSide: "party",
      body: "Is anyone coming about the sink?", photos: [], createdAt: new Date(Date.now() - 3600000).toISOString(), editedAt: null }],
    th2: [{ id: "m2", threadId: "th2", authorUserId: "usr_p", authorName: "Juan Soto", authorSide: "party",
      body: "Parts arrive Tuesday.", photos: [], createdAt: new Date(Date.now() - 7200000).toISOString(), editedAt: null }],
  };
  GONE = new Set();
  VISIT = { id: "v1", jobId: "j1", date: "2099-10-14", startTime: "09:00", endTime: "10:00", status: "proposed",
    proposedBy: "usr_p", parties: ["contractor", "manager", "tenant"], turn: "manager", waitingOn: ["manager", "tenant"],
    contractorAt: "2026-10-01T00:00:00Z", managerAt: null, respondedAt: null };
  LINKS = [];
  sent.length = 0;
};
reset();
let asTenant = false;

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body, headers) => {
  const who = headers?.["x-user-id"];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct];
  if (path === "/api/account") return [200, acct];
  if (path === "/api/account-users") return [200, who === "usr_t" ? USERS.filter((u) => u.id === "usr_t") : USERS];
  if (path === "/api/properties") return [200, [PROP]];
  if (path === "/api/subs") return [200, who === "usr_t" ? [] : SUBS];
  if (path === "/api/jobs" && method === "POST") {
    sent.push({ path, body });
    if (body.fromThread) LINKS.push({ threadId: body.fromThread.id, jobId: "j_new", jobTitle: body.title, at: new Date().toISOString() });
    return [201, { id: "j_new", requested: false, job: { ...JOB, id: "j_new", title: body.title, requestedBy: null },
      fromThread: body.fromThread ? { linked: true, photos: 0 } : undefined }];
  }
  if (path === "/api/jobs") return [200, [JOB, { ...JOB, id: "j2", title: "Gutter clean", trades: ["gutters"],
    requestedBy: null, assignments: {}, scope: "" }]];
  if (path === "/api/threads" && method === "GET") {
    const list = asTenant
      ? THREADS.filter((x) => x.kind === "tenant").map((x) => ({ ...x, side: "party", unread: x.id === "th1" ? 0 : x.unread }))
      : THREADS;
    return [200, { threads: list, unread: list.reduce((n, x) => n + x.unread, 0) }];
  }
  if (path === "/api/message-contacts") return [200, { contacts: asTenant
    ? [{ kind: "tenant", group: "Your building", label: "Sound Property Management", sub: "Your building's office", start: { kind: "tenant", partyUserId: "usr_t" } }]
    : [{ kind: "tenant", group: "Tenants", label: "Tess Nguyen", sub: "Unit 3B, Cedar Flats", unit: "3B",
         propertyId: "prop_1", propertyName: "Cedar Flats", start: { kind: "tenant", partyUserId: "usr_t" } },
       // A building with a thousand tenants: the case a flat scroll cannot serve.
       ...Array.from({ length: 1000 }, (_, i) => ({ kind: "tenant", group: "Tenants", label: `Resident ${String(i + 1).padStart(4, "0")}`,
         sub: `Unit ${i + 1}, Harbor Tower`, unit: String(i + 1), propertyId: "prop_2", propertyName: "Harbor Tower",
         start: { kind: "tenant", partyUserId: `usr_h${i + 1}` } })),
       { kind: "crew", group: "Contractors", label: "Pacific Apartment Maintenance", sub: "", start: { kind: "crew", partyCompanyId: "cmp_p" } }] }];
  if (path === "/api/threads" && method === "POST") {
    sent.push({ path, body });
    const id = `th_${body.kind}_${body.jobId || "g"}_${body.partyCompanyId || body.partyUserId || "self"}`;
    if (!MESSAGES[id]) MESSAGES[id] = [];
    const t0 = thread({ id, side: asTenant ? "party" : "home", unread: 0, kind: body.kind, jobId: body.jobId || null,
      jobTitle: body.jobId ? JOB.title : null, partyCompanyId: body.partyCompanyId || null,
      partyName: body.partyCompanyId ? "Pacific Apartment Maintenance" : "Tess Nguyen", lastBody: "" });
    return [201, { thread: t0, message: null }];
  }
  const one = /^\/api\/threads\/([^/]+)$/.exec(path);
  if (one && method === "GET") {
    const id = one[1];
    const base = THREADS.find((x) => x.id === id) || thread({ id, side: asTenant ? "party" : "home",
      jobId: id.includes("_j1_") ? "j1" : null, jobTitle: id.includes("_j1_") ? JOB.title : null,
      kind: id.includes("crew") ? "crew" : "tenant",
      partyName: id.includes("cmp_p") ? "Pacific Apartment Maintenance" : "Tess Nguyen" });
    THREADS = THREADS.map((x) => x.id === id ? { ...x, unread: 0 } : x);
    const isJob = id.includes("_j1_");
    const context = isJob ? {
      job: { id: "j1", title: JOB.title, status: "active", date: today, approved: true, closed: false },
      visit: VISIT ? { ...VISIT } : null, viewerParty: asTenant ? "tenant" : "manager", canPropose: true, woId: null, away: false,
      events: [
        { at: new Date(Date.now() - 86400000 * 2).toISOString(), kind: "wo_accepted", company: "Pacific Apartment Maintenance" },
        ...(VISIT ? [{ at: new Date(Date.now() - 86400000).toISOString(), kind: "visit_proposed", by: "Pacific Apartment Maintenance",
          window: { date: VISIT.date, startTime: VISIT.startTime, endTime: VISIT.endTime } }] : []),
      ] } : { events: LINKS.filter((l) => l.threadId === id).map((l) => ({ at: l.at, kind: "job_linked", jobId: l.jobId, jobTitle: l.jobTitle })) };
    return [200, { thread: { ...base, side: asTenant ? "party" : "home" }, messages: MESSAGES[id] || [], context,
      canPost: !GONE.has(id), partyGone: GONE.has(id) }];
  }
  const post = /^\/api\/threads\/([^/]+)\/messages$/.exec(path);
  if (post && method === "POST") {
    sent.push({ path, body });
    const m = { id: `m${Date.now()}`, threadId: post[1], authorUserId: who, authorName: asTenant ? "Tess Nguyen" : "Richard Braun",
      authorSide: asTenant ? "party" : "home", body: body.body, photos: [], createdAt: new Date().toISOString(), editedAt: null };
    (MESSAGES[post[1]] = MESSAGES[post[1]] || []).push(m);
    return [201, { message: m }];
  }
  const vr = /^\/api\/visits\/([^/]+)\/respond$/.exec(path);
  if (vr && method === "POST") { sent.push({ path, body }); VISIT = { ...VISIT, status: "confirmed", managerAt: new Date().toISOString(), waitingOn: [] }; return [200, { ok: true }]; }
  if (path === "/api/jobs/j1/visits" && method === "POST") { sent.push({ path, body }); return [201, { ok: true }]; }
  if (path === "/api/visits" || path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/clients" || path === "/api/tenants") return [200, []];
  if (path === "/api/notices") return [200, { notices: [] }];
  if (path === "/api/my-manager") return [200, { company: "Sound Property Management", managers: [] }];
  if (path === "/api/me/contact") return [200, {}];
  if (path === "/api/weather") return [200, {}];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const clickText = (page, sel, re) => page.evaluate((s, rs) => {
  const el = [...document.querySelectorAll(s)].find((e) => new RegExp(rs).test((e.innerText || "").trim()));
  if (el) el.click(); return !!el;
}, sel, re.source);
const typeInto = (page, sel, value) => page.evaluate((s, v) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, sel, value);
const pane = (page) => page.evaluate(() => {
  const p = document.querySelector(".thr-pane");
  return p ? { who: p.querySelector(".thr-who b")?.innerText || null,
    about: p.querySelector(".thr-about")?.innerText || null,
    msgs: [...p.querySelectorAll(".msg")].map((m) => ({ mine: m.classList.contains("msg-mine"), body: m.querySelector(".msg-bubble")?.innerText || "" })),
    compose: !!p.querySelector(".thr-compose textarea"), gone: p.querySelector(".thr-gone")?.innerText || null } : null;
});

try {
  console.log("\n-- the manager --");
  {
    asTenant = false; reset();
    const { ctx, page, crashes } = await visitApp(browser, { host: "x", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1100, height: 1100 } });
    await wait(2800);
    const nav = await page.evaluate(() => document.querySelector('[data-nav="inbox"]')?.innerText.replace(/\s+/g, " ").trim() || null);
    t.ck("the Inbox is in the menu with its unread count", nav === "Inbox1" || nav === "Inbox 1", String(nav));
    // THE BADGE IS ONE PILL. It was an amber dot inside an amber pill: the dot
    // vanished into its own background and its pulse ring spilled over the
    // time beside it. One solid, rounded count, and nothing inside it.
    const badge = await page.evaluate(() => {
      const b = document.querySelector('[data-nav="inbox"] .count');
      if (!b) return null;
      const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
      return { live: b.classList.contains("live-n"), dot: !!b.querySelector(".act-dot"), h: Math.round(r.height),
        w: Math.round(r.width), radius: parseFloat(cs.borderTopLeftRadius), bg: cs.backgroundColor };
    });
    t.ck("the unread badge is one rounded pill with no dot inside it",
      !!badge && badge.live && !badge.dot && badge.h >= 18 && badge.h <= 22 && badge.w >= badge.h && badge.radius >= badge.h / 2 - 1,
      JSON.stringify(badge));
    // And on the row it sits clear of the time, which the old dot's ring ran into.
    await page.evaluate(() => document.querySelector('[data-nav="inbox"]')?.click());
    await wait(800);
    const rowBadge = await page.evaluate(() => {
      const row = [...document.querySelectorAll(".ib-row")].find((r) => r.classList.contains("unread"));
      const b = row?.querySelector(".count"), tm = row?.querySelector(".ib-time");
      if (!b || !tm) return null;
      const br = b.getBoundingClientRect(), tr = tm.getBoundingClientRect();
      return { live: b.classList.contains("live-n"), dot: !!b.querySelector(".act-dot"), gap: Math.round(br.left - tr.right),
        h: Math.round(br.height) };
    });
    t.ck("the row's unread badge is the same pill, clear of the time",
      !!rowBadge && rowBadge.live && !rowBadge.dot && rowBadge.gap >= 4 && rowBadge.h <= 22, JSON.stringify(rowBadge));
    await page.evaluate(() => [...document.querySelectorAll("nav button, .tabs button, button")].find((b) => /^Dashboard/.test((b.innerText || "").trim()))?.click());
    await wait(800);
    const dash = await page.evaluate(() => {
      const s = document.querySelector(".sec-msgs");
      return s ? { text: s.innerText, reply: !![...s.querySelectorAll("button")].find((b) => /Reply/.test(b.innerText)) } : null;
    });
    t.ck("the dashboard lists the unread message", !!dash && /Tess Nguyen/.test(dash.text) && /anyone coming/.test(dash.text), JSON.stringify(dash));
    t.ck("with Reply on the row", !!dash?.reply);
    // The whole row opens the conversation, so press the MESSAGE, not Reply.
    const rowShape = await page.evaluate(() => {
      const r = document.querySelector(".sec-msgs .msg-row");
      return r ? { isButton: r.tagName === "BUTTON", nested: r.querySelectorAll("button").length } : null;
    });
    t.ck("the whole message row is one button, with nothing nested in it", rowShape?.isButton && rowShape.nested === 0, JSON.stringify(rowShape));
    await page.evaluate(() => document.querySelector(".sec-msgs .msg-row .dr-title")?.click());
    await wait(900);
    let p = await pane(page);
    t.ck("Reply opens that conversation in the Inbox", p?.who?.startsWith("Tess Nguyen") && p.msgs.length === 1 && !p.msgs[0].mine, JSON.stringify(p));
    t.ck("with a composer", !!p?.compose);
    await typeInto(page, ".thr-box", "Sam is booked for Tuesday at 9.");
    await clickText(page, ".thr-compose button", /Send/);
    await wait(700);
    const post = sent.find((x) => x.path === "/api/threads/th1/messages");
    t.ck("what was typed is what was sent", post?.body?.body === "Sam is booked for Tuesday at 9.", JSON.stringify(post));
    p = await pane(page);
    t.ck("and it is drawn as mine", p?.msgs.at(-1)?.mine && /Tuesday at 9/.test(p.msgs.at(-1).body), JSON.stringify(p?.msgs));
    const rows = await page.evaluate(() => [...document.querySelectorAll(".ib-row")].map((r) => r.innerText.replace(/\s+/g, " ")));
    t.ck("the list carries both conversations", rows.length === 2 && rows.some((r) => /Pacific/.test(r)), JSON.stringify(rows));

    // New message: own relationships, then the thread opens.
    await clickText(page, "button", /New message/);
    await wait(700);
    const picks = await page.evaluate(() => [...document.querySelectorAll(".nm-row")].map((b) => b.innerText.replace(/\s+/g, " ").trim()));
    t.ck("New message lists the account's own people", picks.some((x) => /Tess Nguyen/.test(x)) && picks.some((x) => /Pacific/.test(x)), JSON.stringify(picks));
    // TENANTS GROUPED BY BUILDING, a cap on what is drawn, and search that is
    // always there -- a building can hold a thousand tenants.
    const nm = () => page.evaluate(() => ({
      heads: [...document.querySelectorAll(".nm-group .form-sec")].map((h) => h.innerText.replace(/\s+/g, " ").trim()),
      rows: [...document.querySelectorAll(".nm-row")].map((b) => b.innerText.replace(/\s+/g, " ").trim()),
      more: [...document.querySelectorAll(".nm-more")].map((m) => m.innerText.trim()),
      search: !!document.querySelector(".nm-search"),
      props: [...document.querySelectorAll('.nm-sel[aria-label="Building"] option')].map((o) => o.textContent),
    }));
    let nmv = await nm();
    t.ck("tenants are grouped by building", nmv.heads.some((h) => /Tenants · Cedar Flats/i.test(h)) && nmv.heads.some((h) => /Tenants · Harbor Tower/i.test(h)), JSON.stringify(nmv.heads));
    t.ck("a thousand tenants are not all drawn, and it says how to find the rest",
      nmv.rows.filter((r) => /Resident/.test(r)).length === 40 && nmv.more.some((m) => /40 of 1,000/.test(m) && /Search/.test(m)),
      JSON.stringify({ n: nmv.rows.length, more: nmv.more }));
    t.ck("search is there and a building dropdown lists the buildings", nmv.search && nmv.props.includes("Harbor Tower") && nmv.props.includes("Cedar Flats"), JSON.stringify(nmv.props));
    await typeInto(page, ".nm-search", "unit 777");
    await wait(300);
    nmv = await nm();
    t.ck("searching a unit finds that one tenant out of the thousand", nmv.rows.length === 1 && /Resident 0777/.test(nmv.rows[0]), JSON.stringify(nmv.rows));
    await typeInto(page, ".nm-search", "");
    await page.evaluate(() => {
      const el = document.querySelector('.nm-sel[aria-label="Building"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "prop_1");
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await wait(300);
    nmv = await nm();
    t.ck("picking a building narrows the list to the people there", nmv.rows.length === 1 && /Tess Nguyen/.test(nmv.rows[0]), JSON.stringify(nmv.rows));
    await page.evaluate(() => {
      const el = document.querySelector('.nm-sel[aria-label="Building"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "");
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await wait(300);
    await clickText(page, ".nm-row", /Pacific/);
    await wait(900);
    const start = sent.filter((x) => x.path === "/api/threads").at(-1);
    t.ck("picking one starts the thread the server names", start?.body?.kind === "crew" && start.body.partyCompanyId === "cmp_p", JSON.stringify(start));
    p = await pane(page);
    t.ck("and its conversation opens, ready to write", p?.who?.startsWith("Pacific") && p.compose, JSON.stringify(p));

    // A party who has gone.
    GONE.add("th2");
    await clickText(page, ".ib-row", /Pacific/);
    await wait(800);
    p = await pane(page);
    t.ck("a party who has gone leaves the history and no composer", p && p.msgs.length === 1 && !p.compose && /no longer/.test(p.gone || ""), JSON.stringify(p));

    // The job card.
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Jobs/.test((b.innerText || "").trim()))?.click());
    await wait(900);
    await openCards(page);
    await wait(500);
    const parties = await page.evaluate(() => [...document.querySelectorAll(".job-msgs .jm-btn")].map((b) => b.innerText.trim()));
    t.ck("the job card names who to message about it", parties.some((x) => /Tess/.test(x)) && parties.some((x) => /Pacific/.test(x)), JSON.stringify(parties));
    // WHERE it is, which is what was reported missing: under the trades, not
    // at the foot of the card below the visit block.
    const place = await page.evaluate(() => {
      const card = [...document.querySelectorAll(".job-msgs")].find((m) => m.querySelector(".jm-btn"))?.closest(".job-card");
      const row = card?.querySelector(".job-msgs"), vis = card?.querySelector(".visit-block");
      return row && vis ? { row: row.getBoundingClientRect().top, vis: vis.getBoundingClientRect().top } : null;
    });
    t.ck("the Message row sits above the visit block, under the trades", !!place && place.row < place.vis, JSON.stringify(place));
    const none = await page.evaluate(() => [...document.querySelectorAll(".jm-none")].map((n) => n.innerText.trim()));
    t.ck("a job with nobody on it says so rather than drawing no row", none.length === 1 && /nobody on this job/.test(none[0]), JSON.stringify(none));
    await clickText(page, ".job-msgs .jm-btn", /Pacific/);
    await wait(900);
    const js = sent.filter((x) => x.path === "/api/threads").at(-1);
    t.ck("and opens the JOB's thread with that company", js?.body?.jobId === "j1" && js.body.partyCompanyId === "cmp_p" && js.body.kind === "crew", JSON.stringify(js));
    p = await pane(page);
    t.ck("in a window beside the job", !!p && /Leaking sink/.test(p.about || ""), JSON.stringify(p));

    console.log("\n-- 082: the job, not the chat, decides --");
    const bar = await page.evaluate(() => {
      const b = document.querySelector(".thr-modal [data-thr-job]");
      return b ? { text: b.innerText.replace(/\s+/g, " "), buttons: [...b.querySelectorAll("button")].map((x) => x.innerText.trim()) } : null;
    });
    t.ck("the job's live window is at the top of its conversation", !!bar && /proposed/i.test(bar.text) && /9 AM/.test(bar.text), JSON.stringify(bar));
    t.ck("with Confirm and Decline when it is this side's turn", !!bar && bar.buttons.some((x) => /Confirm this time/.test(x)) && bar.buttons.some((x) => /^Decline/.test(x)), JSON.stringify(bar?.buttons));
    const evs = await page.evaluate(() => [...document.querySelectorAll(".thr-modal .thr-event")].map((e) => e.innerText.replace(/\s+/g, " ")));
    t.ck("the job's history sits between the messages", evs.some((x) => /accepted the work order/.test(x)) && evs.some((x) => /proposed/.test(x)), JSON.stringify(evs));
    const unbooked = await page.evaluate(() => document.querySelector(".thr-modal .thr-unbooked")?.innerText || null);
    t.ck("and the box says a time in a message is not a booking", /aren't booked until someone presses Confirm/.test(unbooked || ""), String(unbooked));
    await typeInto(page, ".thr-modal .thr-box", "Tuesday at 9 works for me");
    await wait(250);
    let nudge = await page.evaluate(() => document.querySelector(".thr-modal [data-nudge]")?.innerText || null);
    t.ck("typing a time offers to propose it", /Messages don't book visits/.test(nudge || ""), String(nudge));
    await typeInto(page, ".thr-modal .thr-box", "The dog will be in the yard");
    await wait(250);
    nudge = await page.evaluate(() => document.querySelector(".thr-modal [data-nudge]")?.innerText || null);
    t.ck("and nothing else does", nudge === null, String(nudge));
    await clickText(page, ".thr-modal [data-thr-job] button", /Confirm this time/);
    await wait(900);
    const conf = sent.find((x) => /^\/api\/visits\/v1\/respond$/.test(x.path));
    t.ck("Confirm is the real answer, through the visit route", conf?.body?.status === "confirmed", JSON.stringify(conf));
    const after = await page.evaluate(() => document.querySelector(".thr-modal [data-thr-job]")?.innerText.replace(/\s+/g, " ") || "");
    t.ck("and the bar then reads booked", /booked/i.test(after) && !/Confirm this time/.test(after), after);
    await clickText(page, ".thr-modal [data-act=propose]", /Propose/);
    await wait(400);
    const form = await page.evaluate(() => !!document.querySelector(".thr-modal .thr-propose input[type=date]"));
    t.ck("Propose another time opens the real time form", form);
    await page.evaluate(() => {
      const el = document.querySelector(".thr-modal .thr-propose input[type=date]");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "2099-10-20");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickText(page, ".thr-modal .thr-propose button", /Propose this time/);
    await wait(800);
    const prop = sent.find((x) => x.path === "/api/jobs/j1/visits");
    t.ck("and proposing goes through the job's visit route", prop?.body?.date === "2099-10-20", JSON.stringify(prop));
    await page.evaluate(() => document.querySelector(".modal-close")?.click());
    await wait(400);

    console.log("\n-- 082: a conversation becomes a job through the job form --");
    await page.evaluate(() => document.querySelector('[data-nav="inbox"]')?.click());
    await wait(700);
    await clickText(page, ".ib-row", /Tess/);
    await wait(800);
    const acts = await page.evaluate(() => [...document.querySelectorAll(".thr-acts button")].map((b) => b.innerText.trim()));
    t.ck("a general conversation with a tenant offers Create a job", acts.some((x) => /Create a job from this/.test(x)), JSON.stringify(acts));
    t.ck("and no time buttons, since it is not about a job", !acts.some((x) => /Propose/.test(x)), JSON.stringify(acts));
    await clickText(page, ".thr-acts button", /Create a job/);
    await wait(700);
    const jf = await page.evaluate(() => {
      const m = [...document.querySelectorAll(".modal")].pop();
      const title = [...(m?.querySelectorAll("input") || [])].find((i) => /anyone coming/i.test(i.value));
      const scope = [...(m?.querySelectorAll("textarea") || [])].find((x) => /anyone coming/i.test(x.value));
      return { open: /Create job|New job/i.test(m?.innerText || ""), title: title?.value || null, scope: !!scope };
    });
    t.ck("it opens the job form, filled in from what they said", jf.open && !!jf.title, JSON.stringify(jf));
    const next = () => page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")]
      .find((b) => /^Next/.test(b.innerText.trim()))?.click());
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".modal input")].find((i) => /address/i.test(i.placeholder || "") || /address/i.test(i.closest("label")?.innerText || ""));
      if (el && !el.value) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "12 Cedar St"); el.dispatchEvent(new Event("input", { bubbles: true })); }
    });
    await next(); await wait(300); await next(); await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".modal .pick-grid .chip, .modal .pick-grid button")]
      .find((b) => /Plumbing/i.test(b.innerText))?.click());
    await wait(200); await next(); await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")].find((b) => /Create job/i.test(b.innerText))?.click());
    await wait(1000);
    const made = [...sent].reverse().find((x) => x.path === "/api/jobs");
    t.ck("the job is created through the real route, naming the conversation", made?.body?.fromThread?.id === "th1", JSON.stringify(made?.body?.fromThread));
    t.ck("with the tenant it was with", made?.body?.accessUserId === "usr_t", JSON.stringify(made?.body?.accessUserId));
    await wait(600);
    const linked = await page.evaluate(() => [...document.querySelectorAll(".thr-event")].map((e) => e.innerText).find((x) => /Job created from this conversation/.test(x)) || null);
    t.ck("and the conversation says so, staying on screen", !!linked, String(linked));
    t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the tenant --");
  {
    asTenant = true; reset();
    const { ctx, page, crashes } = await visitApp(browser, { host: "x", webPort: WEB,
      seat: { userId: "usr_t", accountId: "acc_x" }, viewport: { width: 1100, height: 1100 } });
    await wait(2800);
    const nav = await page.evaluate(() => !!document.querySelector('[data-nav="inbox"]'));
    t.ck("a tenant has an Inbox too", nav);
    const opened = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".tn-row-open")].find((x) => /Leaking sink/.test(x.innerText || ""));
      if (b) b.click(); return !!b;
    });
    t.ck("their report is on Tenant HQ", opened);
    await wait(800);
    const btn = await page.evaluate(() => [...document.querySelectorAll(".msg-about")].map((b) => b.innerText.trim()));
    t.ck("their report offers a message to the office", btn.some((x) => /Message Sound Property Management/.test(x)), JSON.stringify(btn));
    await clickText(page, ".msg-about", /Message/);
    await wait(900);
    const st = sent.filter((x) => x.path === "/api/threads").at(-1);
    t.ck("which opens the thread about that report, naming them", st?.body?.kind === "tenant" && st.body.partyUserId === "usr_t" && st.body.jobId === "j1", JSON.stringify(st));
    const p = await pane(page);
    t.ck("ready to write", !!p?.compose, JSON.stringify(p));
    await page.evaluate(() => document.querySelector(".modal-close")?.click());
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".modal-close")].forEach((b) => b.click()));
    await wait(300);
    MESSAGES.th1.push({ id: "m9", threadId: "th1", authorUserId: "usr_t", authorName: "Tess Nguyen", authorSide: "party",
      body: "The bathroom fan rattles all night", photos: [], createdAt: new Date().toISOString(), editedAt: null });
    await page.evaluate(() => document.querySelector('[data-nav="inbox"]')?.click());
    await wait(700);
    await clickText(page, ".ib-row", /Sound/);
    await wait(800);
    const tacts = await page.evaluate(() => [...document.querySelectorAll(".thr-acts button")].map((b) => b.innerText.trim()));
    t.ck("a tenant's conversation with the office offers Report a problem", tacts.some((x) => /Report a problem/.test(x)), JSON.stringify(tacts));
    await clickText(page, ".thr-acts button", /Report a problem/);
    await wait(900);
    // The words go in the box the form shows once they say what it is: the
    // report is still the structured thing, and picking the problem is theirs.
    await clickText(page, "button", /^Something else$/);
    await wait(400);
    await clickText(page, "button", /I'll describe it/);
    await wait(400);
    const rf = await page.evaluate(() => [...document.querySelectorAll("textarea")].map((x) => x.value).find((v) => /fan rattles/.test(v)) || null);
    t.ck("which opens the real report form with their words in it", !!rf, String(rf));
    await clickText(page, "button", /^Send it$/);
    await wait(1000);
    const rep = [...sent].reverse().find((x) => x.path === "/api/jobs");
    t.ck("and sending it names the conversation, through the real report", rep?.body?.fromThread?.id === "th1" && !!rep.body.reportDetail, JSON.stringify(rep?.body && { ft: rep.body.fromThread, rd: !!rep.body.reportDetail }));
    t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- on a phone --");
  {
    asTenant = false; reset();
    const { ctx, page, crashes } = await visitApp(browser, { host: "x", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 390, height: 844 } });
    await wait(2800);
    await page.evaluate(() => document.querySelector('[data-nav="inbox"]')?.click());
    await wait(700);
    const before = await page.evaluate(() => ({
      list: getComputedStyle(document.querySelector(".inbox-list")).display,
      pane: getComputedStyle(document.querySelector(".inbox-pane")).display,
      width: document.documentElement.scrollWidth }));
    t.ck("the list first, the conversation hidden", before.list !== "none" && before.pane === "none", JSON.stringify(before));
    await clickText(page, ".ib-row", /Tess/);
    await wait(800);
    const after = await page.evaluate(() => ({
      list: getComputedStyle(document.querySelector(".inbox-list")).display,
      back: !!document.querySelector(".thr-back") && getComputedStyle(document.querySelector(".thr-back")).display !== "none",
      width: document.documentElement.scrollWidth }));
    t.ck("then the conversation alone, with a way back", after.list === "none" && after.back, JSON.stringify(after));
    t.ck("and nothing runs off the side", after.width <= 390 && before.width <= 390, JSON.stringify([before.width, after.width]));
    await page.evaluate(() => document.querySelector(".thr-back")?.click());
    await wait(400);
    const back = await page.evaluate(() => getComputedStyle(document.querySelector(".inbox-list")).display);
    t.ck("back returns to the list", back !== "none", back);
    t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
