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
  if (path === "/api/jobs") return [200, [JOB]];
  if (path === "/api/threads" && method === "GET") {
    const list = asTenant
      ? THREADS.filter((x) => x.kind === "tenant").map((x) => ({ ...x, side: "party", unread: x.id === "th1" ? 0 : x.unread }))
      : THREADS;
    return [200, { threads: list, unread: list.reduce((n, x) => n + x.unread, 0) }];
  }
  if (path === "/api/message-contacts") return [200, { contacts: asTenant
    ? [{ kind: "tenant", group: "Your building", label: "Sound Property Management", sub: "Your building's office", start: { kind: "tenant", partyUserId: "usr_t" } }]
    : [{ kind: "tenant", group: "Tenants", label: "Tess Nguyen", sub: "Unit 3B, Cedar Flats", start: { kind: "tenant", partyUserId: "usr_t" } },
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
    return [200, { thread: { ...base, side: asTenant ? "party" : "home" }, messages: MESSAGES[id] || [],
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
    const dash = await page.evaluate(() => {
      const s = document.querySelector(".sec-msgs");
      return s ? { text: s.innerText, reply: !![...s.querySelectorAll("button")].find((b) => /Reply/.test(b.innerText)) } : null;
    });
    t.ck("the dashboard lists the unread message", !!dash && /Tess Nguyen/.test(dash.text) && /anyone coming/.test(dash.text), JSON.stringify(dash));
    t.ck("with Reply on the row", !!dash?.reply);
    await clickText(page, ".sec-msgs button", /^Reply$/);
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
    await clickText(page, ".job-msgs .jm-btn", /Pacific/);
    await wait(900);
    const js = sent.filter((x) => x.path === "/api/threads").at(-1);
    t.ck("and opens the JOB's thread with that company", js?.body?.jobId === "j1" && js.body.partyCompanyId === "cmp_p" && js.body.kind === "crew", JSON.stringify(js));
    p = await pane(page);
    t.ck("in a window beside the job", !!p && /Leaking sink/.test(p.about || ""), JSON.stringify(p));
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
