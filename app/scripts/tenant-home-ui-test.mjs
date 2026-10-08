// 072. The tenant's dashboard, drawn: weather, notices, the two ways to
// report, and their own contact details -- plus the manager's half, posting a
// notice from the building and reading a tenant's details back.
//
// Asked for as "a proper dashboard with weather highlighted, report a problem,
// a place holder for a AI powered number to call/text into and report a
// problem, important building notification, preferred contact information,
// emergency contact". Each of those is asserted as DRAWN, because each card is
// fed by a fetch that only exists at runtime and a static check that the
// component is mounted passes over a card that renders nothing.
//
// Three things in it are the properties rather than the decoration:
//
//   THE AI LINE PRINTS NO NUMBER. A number that does not answer is worse than
//   none -- somebody with water through the ceiling would ring it. So the
//   suite reads the whole card for anything shaped like a phone number.
//
//   IMPORTANT COMES FIRST, AND AN EXPIRED NOTICE IS NOT DRAWN. The browser
//   filters by its OWN date, so a stub serving one that ran out yesterday is
//   the only way to see that it does.
//
//   A SAVE SENDS THE WHOLE ROW. The route stores both cards in one record, so
//   saving the emergency contact must carry the contact preference with it --
//   a body with only the half being edited would wipe the other half.
//
//   node --no-warnings scripts/tenant-home-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-tenanthome-test");
const WEB = 5399, API = 9099;
const t = tally();

const dayKey = (n = 0) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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
  { id: "usr_t", name: "Tess Nguyen", email: "tess@x.test", phone: "(206)555-0188", role: "tenant",
    subId: null, propertyIds: ["prop_1"], unit: "3B", hasLogin: true, inviteSentAt: null, hasAvatar: false },
];
let NOTICES = [];
let CONTACT = {};
let MANAGER = { company: "Sound Property Management", kind: "property_manager",
  managers: [{ name: "Riley Park", role: "pm", email: "riley@soundpm.test", phone: "(206) 555-0142" }] };
let WEATHER = {};
const sent = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct];
  if (path === "/api/account") return [200, acct];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/properties") return [200, [PROP]];
  if (path === "/api/weather") return [200, WEATHER];
  if (path === "/api/notices" && method === "GET") return [200, { notices: NOTICES }];
  if (path === "/api/notices" && method === "POST") {
    sent.push({ path, body });
    const n = { id: "n_new", propertyId: body.propertyId, propertyName: "Cedar Flats", title: body.title,
      body: body.body || null, important: !!body.important, endsOn: body.endsOn || null,
      createdAt: `${dayKey()} 10:00:00`, createdByName: "Richard Braun", emailed: body.email ? 3 : 0 };
    NOTICES = [n, ...NOTICES];
    return [201, { notice: n, emailed: body.email ? 3 : 0, notEmailed: body.email ? 1 : 0 }];
  }
  if (path === "/api/my-manager") return [200, MANAGER];
  if (path === "/api/me/contact" && method === "GET") return [200, CONTACT];
  if (path === "/api/me/contact" && method === "PUT") {
    sent.push({ path, body });
    CONTACT = { ...body, email: "tess@x.test", phone: body.phone || null };
    return [200, CONTACT];
  }
  if (path === "/api/tenants") return [200, [
    { userId: "usr_t", name: "Tess Nguyen", email: "tess@x.test", phone: "(206)555-0188", unit: "3B",
      propertyId: "prop_1", propertyName: "Cedar Flats", status: "active",
      contact: { prefer: "text", bestTime: "After 5pm", emergencyName: "Jo Nguyen",
        emergencyRelation: "sister", emergencyPhone: "(253)555-0111" } },
    { userId: "usr_q", name: "Quiet Quinn", email: "q@x.test", phone: null, unit: "4",
      propertyId: "prop_1", propertyName: "Cedar Flats", status: "active", contact: null },
  ]];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/jobs" || path === "/api/subs" || path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/clients" || path === "/api/visits") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const asTenant = async (viewport = { width: 1100, height: 1400 }) => {
  const { ctx, page, crashes } = await visitApp(browser, { host: "x", webPort: WEB,
    seat: { userId: "usr_t", accountId: "acc_x" }, viewport });
  await wait(2600);
  return { ctx, page, crashes };
};
const read = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    return { top: b.top, left: b.left, bottom: b.bottom, height: b.height, width: b.width }; };
  return {
    hello: q(".tn-hello h2")?.innerText || "",
    eyebrow: q(".tn-eyebrow")?.innerText || null,
    nav: [...document.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).filter((x) => /^(Tenant HQ|Dashboard)$/.test(x)),
    wxPlace: q(".tn-wx-place")?.innerText || null,
    noticesHead: q(".tn-notices .tn-sec-h")?.innerText || null,
    noticesEmpty: q(".tn-notice-empty")?.innerText || null,
    wx: q(".tn-wx")?.innerText || null,
    wxRect: r(q(".tn-wx")), helloRect: r(q(".tn-hello")),
    notices: [...document.querySelectorAll(".tn-notice")].map((n) => ({
      text: n.innerText, important: n.classList.contains("important"),
      open: !!n.querySelector(".tn-notice-more"),
      expanded: n.querySelector(".tn-notice-line")?.getAttribute("aria-expanded") || null,
      lineH: n.querySelector(".tn-notice-line")?.getBoundingClientRect().height ?? null,
      h: n.getBoundingClientRect().height,
      right: n.getBoundingClientRect().right })),
    cta: q(".tn-actions .tn-cta")?.innerText || null,
    ctaRect: r(q(".tn-actions .tn-cta")), aiRect: r(q(".tn-ai")),
    ai: q(".tn-ai")?.innerText || null,
    contact: q(".tn-contact")?.innerText || null,
    mgr: q(".tn-mgr")?.innerText || null,
    mgrMark: !!document.querySelector(".tn-mgr img, .tn-mgr .brand-initials, .tn-mgr-co"),
    mgrHrefs: [...document.querySelectorAll(".tn-mgr a")].map((a) => a.getAttribute("href")),
    tabs: [...document.querySelectorAll(".seg-tabs button")].map((b) => b.innerText.trim()),
    tabOn: q(".seg-tabs button.on")?.innerText.trim() || null,
    emergency: q(".tn-emergency")?.innerText || null,
    width: document.documentElement.scrollWidth,
  };
});
const clickText = (page, sel, re) => page.evaluate((s, rs) => {
  const el = [...document.querySelectorAll(s)].find((e) => new RegExp(rs).test(e.innerText || ""));
  if (el) el.click(); return !!el;
}, sel, re.source);
// React reads the native setter, not .value.
const typeInto = (page, sel, value) => page.evaluate((s, v) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, sel, value);

try {
  console.log("\n-- a tenant's dashboard, everything filled in --");
  {
    WEATHER = { tempF: 58.4, code: 61, place: "Seattle", hiF: 62.2, loF: 49.6 };
    NOTICES = [
      { id: "n1", propertyId: "prop_1", propertyName: "Cedar Flats", title: "Bins moved to Thursday",
        body: null, important: false, endsOn: null, createdAt: `${dayKey()} 09:00:00` },
      { id: "n2", propertyId: "prop_1", propertyName: "Cedar Flats", title: "Water off Tuesday 9 to 1",
        body: "The main is being replaced.", important: true, endsOn: dayKey(3), createdAt: `${dayKey(-2)} 09:00:00` },
      { id: "n3", propertyId: "prop_1", propertyName: "Cedar Flats", title: "Old news",
        body: null, important: true, endsOn: dayKey(-1), createdAt: `${dayKey(-9)} 09:00:00` },
    ];
    CONTACT = { prefer: null, phone: "(206)555-0188", email: "tess@x.test" };
    const { ctx, page, crashes } = await asTenant();
    const s = await read(page);
    t.ck("the tenant is in", /Hello, Tess/.test(s.hello), s.hello);
    t.ck("the weather is drawn, highlighted", s.wx && /58°F/.test(s.wx) && /Rain/.test(s.wx), String(s.wx));
    t.ck("with today's high and low and the town", s.wx && /H 62°/.test(s.wx) && /L 50°/.test(s.wx) && /Seattle/.test(s.wx), String(s.wx));
    // Where the reading is for: the building's town, state and ZIP -- not its
    // name, which says nothing about where it is.
    t.ck("the weather says the building's city, state and ZIP", s.wxPlace === "Seattle, WA 98101", String(s.wxPlace));
    t.ck("and not the building's name", !/Cedar Flats/.test(s.wx || ""), String(s.wx));
    t.ck("the screen is called Tenant HQ, on the page", /Tenant HQ/i.test(s.eyebrow || ""), String(s.eyebrow));
    t.ck("and in the nav, with no Dashboard beside it", s.nav.includes("Tenant HQ") && !s.nav.includes("Dashboard"),
      JSON.stringify(s.nav));
    t.ck("the notices section is headed as the building's", /Notices from your building/i.test(s.noticesHead || ""),
      String(s.noticesHead));
    t.ck("with notices on it there is no empty-state line", s.noticesEmpty === null, String(s.noticesEmpty));
    t.ck("beside the greeting on a wide screen",
      s.wxRect && s.helloRect && Math.abs(s.wxRect.top - s.helloRect.top) < 60 && s.wxRect.left > s.helloRect.left,
      JSON.stringify({ wx: s.wxRect?.top, hi: s.helloRect?.top }));

    t.ck("the building's notices are drawn", s.notices.length === 2, JSON.stringify(s.notices.map((n) => n.text.slice(0, 30))));
    t.ck("the important one first, and marked", s.notices[0]?.important && /Water off Tuesday/.test(s.notices[0].text)
      && /Important/i.test(s.notices[0].text), JSON.stringify(s.notices[0]));
    t.ck("one past its last day is not drawn", !s.notices.some((n) => /Old news/.test(n.text)));

    // NARROW UNTIL SELECTED. Each notice is a thin line -- the mark, the title
    // and the day -- and the body is one tap away. Length checks first: an
    // every() over no notices is true, and would pass loudest exactly when the
    // list had disappeared.
    t.ck("every notice starts as a closed line", s.notices.length === 2
      && s.notices.every((n) => !n.open && n.expanded === "false"), JSON.stringify(s.notices.map((n) => [n.open, n.expanded])));
    t.ck("and a closed line is thin", s.notices.length === 2 && s.notices.every((n) => n.h <= 60 && n.lineH >= 44),
      JSON.stringify(s.notices.map((n) => [n.h, n.lineH])));
    t.ck("the closed line does not show the body", !/main is being replaced/.test(s.notices[0]?.text || ""),
      String(s.notices[0]?.text));
    t.ck("but does say when it went up", /\S/.test(s.notices[0]?.text || "") && /(Today|Yesterday|\w{3},? \w{3} \d)/.test(s.notices[0]?.text || ""),
      String(s.notices[0]?.text));
    await clickText(page, ".tn-notice .tn-notice-line", /Water off Tuesday/);
    await wait(250);
    const o = await read(page);
    t.ck("selecting one opens it, with its details and its last day",
      o.notices[0]?.open && o.notices[0]?.expanded === "true"
      && /main is being replaced/.test(o.notices[0]?.text || "") && /until /.test(o.notices[0]?.text || ""),
      JSON.stringify(o.notices[0]));
    t.ck("and only that one", o.notices.length === 2 && !o.notices[1].open, JSON.stringify(o.notices.map((n) => n.open)));
    await clickText(page, ".tn-notice .tn-notice-line", /Water off Tuesday/);
    await wait(250);
    const c = await read(page);
    t.ck("selecting it again closes it", c.notices.length === 2 && !c.notices[0].open
      && !/main is being replaced/.test(c.notices[0].text), JSON.stringify(c.notices[0]));

    t.ck("Report a problem is the big button", /Report a problem/.test(s.cta || "") && s.ctaRect?.height >= 80,
      JSON.stringify(s.ctaRect));
    t.ck("the call-or-text line is there, and says it is coming", /Call or text to report/.test(s.ai || "") && /Coming soon/i.test(s.ai || ""),
      String(s.ai));
    // The property that matters about a placeholder: it must not be dialable.
    t.ck("and prints no number anybody could ring", s.ai && !/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(s.ai), String(s.ai));
    t.ck("the two sit side by side", s.ctaRect && s.aiRect && Math.abs(s.ctaRect.top - s.aiRect.top) < 4,
      JSON.stringify({ c: s.ctaRect?.top, a: s.aiRect?.top }));

    // THE TWO CONTACT CARDS MOVED TO MY ACCOUNT, and in their place is who
    // runs the building and how to reach them.
    t.ck("the contact cards are no longer on Tenant HQ", s.contact === null && s.emergency === null,
      JSON.stringify({ c: s.contact, e: s.emergency }));
    t.ck("the property manager card is there, naming the company",
      /Your property manager/i.test(s.mgr || "") && /Sound Property Management/.test(s.mgr || ""), String(s.mgr));
    // The company is already in the header and in each person's title, so the
    // card carries no logo and no company line of its own.
    t.ck("and no second logo or company line on it", s.mgrMark === false, String(s.mgrMark));
    t.ck("and the person who looks after the building, with their title",
      /Riley Park/.test(s.mgr || "") && /Property manager/.test(s.mgr || ""), String(s.mgr));
    t.ck("one tap to call, text or email them",
      JSON.stringify(s.mgrHrefs) === JSON.stringify(["tel:2065550142", "sms:2065550142", "mailto:riley@soundpm.test"]),
      JSON.stringify(s.mgrHrefs));
    t.ck("and 911 first", /Call 911/.test(s.mgr || ""), String(s.mgr));

    // AND THE WAY TO THEIR OWN DETAILS, because that is where they went.
    await clickText(page, ".tn-mgr-link", /reaches you/);
    await wait(700);
    let acc = await read(page);
    t.ck("the link opens My account on the right tab",
      JSON.stringify(acc.tabs) === JSON.stringify(["Profile", "How we reach you", "Emergency contact"])
      && acc.tabOn === "How we reach you", JSON.stringify({ tabs: acc.tabs, on: acc.tabOn }));
    t.ck("preferred contact asks, naming the number on file",
      /Preferred contact/.test(acc.contact || "") && /Not chosen yet/.test(acc.contact || "") && /555-0188/.test(acc.contact || ""), String(acc.contact));
    t.ck("one card per tab", acc.emergency === null, String(acc.emergency));

    console.log("\n-- saving a preference and an emergency contact --");
    sent.length = 0;
    await clickText(page, ".tn-contact .tn-card-head button", /Add/);
    await wait(300);
    await clickText(page, ".tn-contact .pick", /^Text me$/);
    await typeInto(page, ".tn-contact .tn-card-form label:nth-of-type(2) input", "Weekdays after 5pm");
    await clickText(page, ".tn-contact .form-actions button", /Save/);
    await wait(600);
    let b = sent.find((x) => x.path === "/api/me/contact")?.body;
    t.ck("the choice and the time are sent", b?.prefer === "text" && b?.bestTime === "Weekdays after 5pm" && b?.phone === "(206)555-0188",
      JSON.stringify(b));
    let now = await read(page);
    t.ck("and the card reads it back", /Text me/.test(now.contact || "") && /Weekdays after 5pm/.test(now.contact || ""), String(now.contact));

    await clickText(page, ".seg-tabs button", /^Emergency contact$/);
    await wait(400);
    acc = await read(page);
    t.ck("emergency contact has its own tab, and says 911 first",
      /Emergency contact/.test(acc.emergency || "") && /None given yet/.test(acc.emergency || "") && /Call 911/.test(acc.emergency || ""),
      String(acc.emergency));
    sent.length = 0;
    await clickText(page, ".tn-emergency .tn-card-head button", /Add/);
    await wait(300);
    const ins = ".tn-emergency .tn-card-form input";
    await page.evaluate((s) => { document.querySelectorAll(s).forEach((e, i) => e.setAttribute("data-i", String(i))); }, ins);
    await typeInto(page, `${ins}[data-i="0"]`, "Jo Nguyen");
    await typeInto(page, `${ins}[data-i="1"]`, "sister");
    await typeInto(page, `${ins}[data-i="2"]`, "253 555 0111");
    await clickText(page, ".tn-emergency .form-actions button", /Save/);
    await wait(600);
    b = sent.find((x) => x.path === "/api/me/contact")?.body;
    t.ck("the emergency contact is sent", b?.emergencyName === "Jo Nguyen" && b?.emergencyPhone === "253 555 0111", JSON.stringify(b));
    t.ck("WITH the preference already saved, so the other half survives", b?.prefer === "text" && b?.bestTime === "Weekdays after 5pm",
      JSON.stringify(b));
    now = await read(page);
    t.ck("and the card reads it back", /Jo Nguyen/.test(now.emergency || "") && /sister/.test(now.emergency || ""), String(now.emergency));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/tenant-wide.png`, fullPage: true });
    await ctx.close();
  }

  console.log("\n-- no weather draws nothing; no notices still draws the section --");
  {
    WEATHER = {}; NOTICES = []; CONTACT = { prefer: null, phone: null, email: "tess@x.test" };
    MANAGER = { company: "Sound Property Management", managers: [] };
    const { ctx, page } = await asTenant();
    const s = await read(page);
    t.ck("the tenant is in", /Hello, Tess/.test(s.hello), s.hello);
    t.ck("no weather means no weather card", s.wx === null, String(s.wx));
    // The notices section is ALWAYS there: a section a tenant has never seen
    // is one they do not know to look at the day the bins move.
    t.ck("no notices still draws the notices section", s.notices.length === 0
      && /Notices from your building/i.test(s.noticesHead || ""), String(s.noticesHead));
    // Asked for as an icon and "no messages", not a paragraph: two words,
    // and the long explanation is gone.
    t.ck("saying just No messages, with an icon", (s.noticesEmpty || "").trim() === "No messages"
      && (await page.evaluate(() => !!document.querySelector(".tn-notice-empty svg"))), String(s.noticesEmpty));
    t.ck("and the report button is still there", /Report a problem/.test(s.cta || ""));
    // Nobody set up to answer is said, never an empty card.
    t.ck("with nobody to name, the manager card points at Report a problem",
      /Report a problem above/.test(s.mgr || "") && s.mgrHrefs.length === 0, String(s.mgr));
    await ctx.close();
  }

  console.log("\n-- on a phone --");
  {
    WEATHER = { tempF: 58.4, code: 61, place: "Seattle", hiF: 62.2, loF: 49.6 };
    // A long title is the case a thin line has to survive at phone width.
    NOTICES = [{ id: "n9", propertyId: "prop_1", propertyName: "Cedar Flats",
      title: "Packages have been taken from the lobby twice this week, please collect deliveries promptly",
      body: "Use the parcel lockers by the mail room.", important: true, endsOn: null,
      createdAt: `${dayKey()} 09:00:00` }];
    const { ctx, page } = await asTenant({ width: 390, height: 1400 });
    const s = await read(page);
    t.ck("nothing runs off the side", s.width <= 390, String(s.width));
    t.ck("a long notice is still one thin line on a phone", s.notices.length === 1
      && s.notices[0].h <= 60 && s.notices[0].right <= 390, JSON.stringify(s.notices[0]));
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/tenant-phone.png`, fullPage: true });
    t.ck("the two report cards stack", s.ctaRect && s.aiRect && s.aiRect.top > s.ctaRect.bottom - 1,
      JSON.stringify({ c: s.ctaRect, a: s.aiRect }));
    await ctx.close();
  }

  console.log("\n-- the manager's half --");
  {
    NOTICES = [];
    const { ctx, page, crashes } = await visitApp(browser, { host: "x", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1300 } });
    await wait(2600);
    await clickText(page, "nav button, .nav button, aside button, button", /^Properties/);
    await wait(900);
    await page.evaluate(() => {
      const n = [...document.querySelectorAll(".prop-row, .prop-tile, [class*=prop]")]
        .find((e) => /Cedar Flats/.test(e.innerText || "") && (e.tagName === "BUTTON" || e.getAttribute("role") === "button"));
      (n || [...document.querySelectorAll("button")].find((b) => /Cedar Flats/.test(b.innerText)))?.click();
    });
    await wait(700);
    const panel = await page.evaluate(() => document.querySelector(".pd-notices")?.innerText || null);
    t.ck("a building's window carries its notices panel", panel && /Notices to tenants/i.test(panel), String(panel));
    sent.length = 0;
    await clickText(page, ".pd-notices button", /Post a notice/);
    await wait(300);
    await typeInto(page, ".pd-notice-form input:not([type])", "Water off Tuesday 9 to 1");
    await page.evaluate(() => { document.querySelectorAll(".pd-notice-form .pd-chk input").forEach((c) => c.click()); });
    await clickText(page, ".pd-notice-form .form-actions button", /Post notice/);
    await wait(700);
    const b = sent.find((x) => x.path === "/api/notices")?.body;
    t.ck("it posts to this building", b?.propertyId === "prop_1" && b?.title === "Water off Tuesday 9 to 1", JSON.stringify(b));
    t.ck("important and emailed, as ticked", b?.important === true && b?.email === true, JSON.stringify(b));
    const after = await page.evaluate(() => document.querySelector(".pd-notices")?.innerText || "");
    t.ck("it says how many were emailed, and how many were not", /emailed to 3 tenants/.test(after) && /1 not emailed/.test(after), after);
    t.ck("and lists it, marked important", /Water off Tuesday 9 to 1/.test(after) && /Important/i.test(after), after);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));

    console.log("\n-- and posts one from the Add menu, without opening the building --");
    await page.evaluate(() => document.querySelector(".modal-close")?.click());
    await wait(300);
    const opened = await page.evaluate(() => { const b = document.querySelector(".add-btn"); if (b) b.click(); return !!b; });
    await wait(300);
    const items = await page.evaluate(() => [...document.querySelectorAll("button, [role=menuitem]")]
      .map((b) => (b.innerText || "").trim()).filter((x) => /Notice to tenants/.test(x)));
    t.ck("the Add menu offers a notice to tenants", opened && items.length >= 1, JSON.stringify({ opened, items }));
    await clickText(page, "button, [role=menuitem]", /^Notice to tenants$/);
    await wait(500);
    const modal = await page.evaluate(() => ({
      text: document.querySelector(".notice-modal")?.innerText || null,
      formOpen: !!document.querySelector(".notice-modal .pd-notice-form"),
      picker: !!document.querySelector(".notice-modal select"),
    }));
    t.ck("it opens straight onto the form", modal.formOpen, JSON.stringify(modal));
    t.ck("one building is picked for you, with no picker", !modal.picker && /Cedar Flats|Notices to tenants/i.test(modal.text || ""),
      JSON.stringify(modal));
    sent.length = 0;
    await typeInto(page, ".notice-modal .pd-notice-form input:not([type])", "Recycling moves to Thursdays");
    await clickText(page, ".notice-modal .pd-notice-form .form-actions button", /Post notice/);
    await wait(700);
    const b2 = sent.find((x) => x.path === "/api/notices")?.body;
    t.ck("and it posts to that building", b2?.propertyId === "prop_1" && b2?.title === "Recycling moves to Thursdays",
      JSON.stringify(b2));
    t.ck("nothing crashed on the way", crashes.length === 0, crashes.join(" | "));

    console.log("\n-- and reads what a tenant told them --");
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.querySelector(".modal-close")?.click());
    await wait(300);
    // "My account", not "Account" -- the nav says whose it is.
    await page.evaluate(() => [...document.querySelectorAll("button, a, [role=button]")]
      .find((b) => /^My account$/.test((b.innerText || "").trim().split("\n")[0]))?.click());
    await wait(900);
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => /^Tenants/.test(b.innerText.trim()))?.click());
    await wait(1200);
    const rows = await page.evaluate(() => [...document.querySelectorAll(".user-row")].map((r) => r.innerText));
    if (!rows.length) console.log(await page.evaluate(() => document.body.innerText.slice(0, 1500)));
    const tess = rows.find((r) => /Tess Nguyen/.test(r)) || "";
    const quinn = rows.find((r) => /Quiet Quinn/.test(r)) || "";
    t.ck("the tenants list is on screen", rows.length === 2, String(rows.length));
    t.ck("Tess's row says how she'd like to be reached", /Prefers a text · After 5pm/.test(tess), tess);
    t.ck("and who to call", /Emergency: Jo Nguyen \(sister\) · \(253\)555-0111/.test(tess), tess);
    t.ck("a tenant who said nothing has no such line", quinn && !/Prefers|Emergency/.test(quinn), quinn);
    await ctx.close();
  }
} catch (e) {
  t.ck("the suite ran without throwing", false, e?.stack || String(e));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
