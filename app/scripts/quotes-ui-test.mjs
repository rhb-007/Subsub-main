// Asking for quotes, and answering one.
//
// Two screens that never meet. The account's is on the trade row beside Assign
// and Overflow, because that is where a slot with nobody in it is looked at.
// The subcontractor's is in their portal, above job requests, because being
// asked to price something is the earlier conversation.
//
// The assertions that matter:
//
//   NOTHING TRAVELS SIDEWAYS. The invited company's screen never names anybody
//   else who was asked, and after an award it says whether THEY won -- never
//   who did, or for how much.
//
//   IT IS NOT A JOB OFFER. No countdown, no accept, no decline: nothing is on
//   offer yet, and a card that looks like a work order would be a lie.
//
//   THE COMPARISON IS ORDERED AND THE SPREAD IS HONEST. Cheapest marked rather
//   than merely first, and no spread until two people have answered.
//
//   node scripts/quotes-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-quotes-test");
const WEB = 5239, API = 8951;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const GC = {
  id: "acc_a", name: "Alder Construction", subdomain: "alder", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "u_boss", name: "Pat Boss", email: "pat@alder.test", role: "admin" },
};
const sub = (id, company, cats) => ({
  id, company, engagementId: `en_${id}`, accountId: "acc_a", contact: company,
  email: `${id}@test.test`, phone: null, categories: cats, caps: [], crews: [],
  propertyIds: [], zips: [], notify: {}, rating: null, status: "active",
  bond: true, insurance: true, contract: true, w9: true, hasPortal: true,
  license: null, licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {},
});
const SUBS = [
  sub("cmp_bay", "Bay Roofing", ["roofing"]),
  sub("cmp_pine", "Pine Roofing", ["roofing"]),
  sub("cmp_oak", "Oak Roofing", ["roofing"]),
  sub("cmp_volt", "Volt Electric", ["electrical"]),
];
const JOB = {
  id: "j_mill", accountId: "acc_a", title: "Re-roof the mill", address: "12 Mill Lane",
  area: null, zip: null, date: "2026-11-02", time: null, trades: ["roofing"],
  scope: "Strip and re-cover, 400sqm", status: "active", assignments: {},
  photos: [], measurementDocs: [], propertyId: null, requestedBy: null,
  approvedAt: null, severity: null, notes: null,
};

let JOBS = [JOB];
let REQS = [];
let MY_QUOTES = [];
const asks = [], awards = [], answers = [], answerPaths = [];

// WHAT THEY ARE BEING ASKED TO PRICE, WITH THE PICTURES. Narrowed by the
// SERVER to the rooms this trade was asked about, which is why the stub answers
// one room: the panel must not be doing that narrowing itself, and a stub
// handing it the whole walk would let a browser-side filter pass.
const QINSP = {
  kind: "move_out", unit: "3B", inspectedOn: "2026-10-01", trade: "roofing",
  rooms: [{ id: "r_ridge", name: "Ridge and flashing", status: "fail",
    note: "Flashing lifted along the ridge",
    photos: [{ id: "ph_ridge", name: "ridge.jpg", type: "image/jpeg",
      caption: "Lifted about two feet from the chimney" }] }],
};
// A one-pixel PNG, so the thumbnail really loads rather than drawing the
// "Couldn't load" state -- which would pass a check that only counted figures.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea735ed130000000049454e44ae426082",
  "hex");
// EVERY ASK, counted. One panel reading one record is the property; two mounts
// of it would be two requests, which only the wire can see.
const inspAsks = [];
// AND WHICH ROUTE THE BYTES CAME FROM. This has to be read off the wire: a
// thumbnail pointed at the WRONG route still renders an <img>, because
// `ReportPhoto` fails only when the fetch rejects and the stub answers
// something for every path -- so a count of loaded pictures passes whichever
// route was asked. The mutation that proves it hard-codes the work-order
// loader, and nothing but this list can see it.
const photoAsks = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body, headers) => {
  const contractor = String(headers["x-user-id"] || "") === "u_bay";
  if (path === "/api/auth/me") return [200, { user: GC.user, memberships: [
    { accountId: "acc_a", accountName: "Alder Construction", subdomain: "alder",
      kind: "general_contractor", role: contractor ? "contractor" : "admin",
      companyId: contractor ? "cmp_bay" : null, plan: "scale", billing: "monthly",
      theme: null, trades: [], logoKey: null, useDefaultMark: true }] }];
  if (path === "/api/account-users") return [200, [
    { id: "u_boss", name: "Pat Boss", email: "pat@alder.test", phone: null, role: "admin",
      subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
    { id: "u_bay", name: "Rae Bay", email: "rae@bay.test", phone: null, role: "contractor",
      subId: "cmp_bay", propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  ]];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, GC];
  if (path === "/api/account") return [200, GC];
  if (path === "/api/subs") return [200, SUBS];
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/my-quotes") return [200, MY_QUOTES];
  if (/^\/api\/jobs\/[^/]+\/quote-requests$/.test(path)) {
    if (method === "POST") { asks.push(body); return [201, { id: "qr1", asked: (body.companyIds || []).length }]; }
    return [200, REQS];
  }
  if (/^\/api\/quote-requests\/[^/]+\/award$/.test(path)) {
    awards.push(body); return [200, { ok: true, woId: "wo1", woNumber: "WO-1" }];
  }
  if (/^\/api\/quotes\/[^/]+$/.test(path) && method === "POST") {
    answers.push(body); answerPaths.push(path); return [200, { ok: true }];
  }
  // Keyed by the INVITE. `qi_bare` is an invite on a job nobody walked, which
  // is the ordinary case -- the route answers 404 and the panel draws nothing.
  if (/^\/api\/quotes\/[^/]+\/inspection$/.test(path)) {
    inspAsks.push(path);
    return path.includes("qi_bare") ? [404, { error: "not_found" }] : [200, QINSP];
  }
  if (/\/inspection\/photo\//.test(path)) {
    photoAsks.push(path);
    return [200, null, { raw: PNG, type: "image/png" }];
  }
  if (path === "/api/properties" || path === "/api/invites" || path === "/api/clients"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/doc-shares" || path === "/api/property-transfers"
    || path === "/api/overflow-posts") return [200, []];
  return undefined;
} });

const browser = await launch();
const open = (userId) => visitApp(browser, { host: "alder", webPort: WEB,
  seat: { userId, accountId: "acc_a" }, viewport: { width: 1280, height: 1600 } });

try {
  console.log("\n-- the account asks its own roster --");
  {
    REQS = []; asks.length = 0;
    const { ctx, page, crashes } = await open("u_boss");
    await wait(3000);
    await page.evaluate(() => [...document.querySelectorAll("nav button")]
      .find((b) => /^Jobs/.test(b.innerText.trim()))?.click());
    await wait(1200);
    await openCards(page);
    // Open the job so its trade rows render.
    await page.evaluate(() => [...document.querySelectorAll(".job-card h3, .job-card button")]
      .find((e) => /Re-roof the mill/i.test(e.innerText))?.click());
    await wait(900);

    const offered = await page.evaluate(() => [...document.querySelectorAll(".trade-actions button")]
      .map((b) => b.innerText.replace(/\s+/g, " ").trim()));
    t.ck("asking for quotes is offered on an empty slot",
      offered.some((b) => /Ask for quotes/i.test(b)), JSON.stringify(offered));
    t.ck("beside assigning, not instead of it",
      offered.some((b) => /Assign/i.test(b)), JSON.stringify(offered));
    // The two ways to fill a slot from your OWN roster are one choice: award it
    // at a price you name, or ask several what they would charge. Overflow is a
    // different question -- it is for having nobody -- so it goes last rather
    // than between them.
    const iA = offered.findIndex((b) => /Assign/i.test(b));
    const iQ = offered.findIndex((b) => /Ask for quotes/i.test(b));
    const iO = offered.findIndex((b) => /^Overflow$/i.test(b));
    t.ck("the two roster options sit together", iQ === iA + 1, `${iA} then ${iQ}`);
    t.ck("and overflow comes after both", iO > iQ, `overflow at ${iO}, quotes at ${iQ}`);

    await page.evaluate(() => [...document.querySelectorAll(".trade-actions button")]
      .find((b) => /Ask for quotes/i.test(b.innerText))?.click());
    await wait(700);

    const panel = await page.evaluate(() => {
      const names = [...document.querySelectorAll(".qa-name")].map((n) => n.innerText.trim());
      return { names, text: document.body.innerText.replace(/\s+/g, " ") };
    });
    t.ck("only the roofers are offered", panel.names.length === 3, JSON.stringify(panel.names));
    t.ck("the electrician is not among them", !panel.names.includes("Volt Electric"));
    // The thing that makes this not overflow.
    t.ck("it promises they will not see each other",
      /will see who else you asked/i.test(panel.text), "");

    await page.evaluate(() => {
      const picks = [...document.querySelectorAll(".qa-pick")];
      picks[0].click(); picks[1].click();
    });
    await wait(400);
    await page.evaluate(() => [...document.querySelectorAll(".form-actions button")]
      .find((b) => /^Ask 2 contractors$/.test(b.innerText.trim()))?.click());
    await wait(900);
    t.ck("the ask reaches the server", asks.length === 1, JSON.stringify(asks));
    // One item, carried in the same shape a several-item ask uses -- so the
    // route has one door, not a single-trade one beside a batch one.
    t.ck("naming the trade", asks[0]?.items?.length === 1 && asks[0]?.items?.[0]?.trade === "roofing",
      JSON.stringify(asks[0]?.items));
    t.ck("and exactly who was picked", (asks[0]?.companyIds || []).length === 2,
      JSON.stringify(asks[0]?.companyIds));
    t.ck("carrying the scope everybody reads",
      /400sqm/.test(asks[0]?.items?.[0]?.scope || ""), String(asks[0]?.items?.[0]?.scope));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and compares what comes back --");
  {
    REQS = [{ id: "qr1", jobId: "j_mill", trade: "roofing", status: "open",
      scope: "Strip and re-cover, 400sqm", dueAt: null, state: "quotes_in",
      invites: [
        { id: "i2", companyId: "cmp_pine", company: "Pine Roofing", status: "quoted",
          priceCents: 412500, canStart: "2026-11-12", note: null },
        { id: "i1", companyId: "cmp_bay", company: "Bay Roofing", status: "quoted",
          priceCents: 480000, canStart: "2026-11-05", note: "Parking needed." },
        { id: "i3", companyId: "cmp_oak", company: "Oak Roofing", status: "passed",
          priceCents: null, canStart: null, note: "Booked until January." },
      ] }];
    awards.length = 0;
    const { ctx, page, crashes } = await open("u_boss");
    await wait(3000);
    await page.evaluate(() => [...document.querySelectorAll("nav button")]
      .find((b) => /^Jobs/.test(b.innerText.trim()))?.click());
    await wait(1200);
    await openCards(page);
    await page.evaluate(() => [...document.querySelectorAll(".job-card h3, .job-card button")]
      .find((e) => /Re-roof the mill/i.test(e.innerText))?.click());
    await wait(900);

    const pill = await page.evaluate(() =>
      document.querySelector(".qr-pill")?.innerText.replace(/\s+/g, " ").trim() || null);
    t.ck("the slot says how many have answered", /2 of 3 quoted/.test(pill || ""), String(pill));

    await page.evaluate(() => document.querySelector(".qr-pill")?.click());
    await wait(700);
    const cmp = await page.evaluate(() => ({
      rows: [...document.querySelectorAll(".qp-row")].map((r) => ({
        best: r.classList.contains("best"),
        text: r.innerText.replace(/\s+/g, " ").trim(),
      })),
      spread: document.querySelector(".qp-spread")?.innerText.replace(/\s+/g, " ").trim() || null,
    }));
    t.ck("everyone asked is on it", cmp.rows.length === 3, String(cmp.rows.length));
    t.ck("cheapest first", /Pine Roofing/.test(cmp.rows[0].text), cmp.rows[0].text);
    t.ck("and marked, not merely first", cmp.rows[0].best === true);
    t.ck("the pass is shown rather than hidden",
      cmp.rows.some((r) => /Oak Roofing/.test(r.text) && /Passed/i.test(r.text)),
      JSON.stringify(cmp.rows.map((r) => r.text)));
    t.ck("with their reason", cmp.rows.some((r) => /Booked until January/.test(r.text)));
    t.ck("two answers make a spread", /apart/.test(cmp.spread || ""), String(cmp.spread));
    t.ck("showing both ends", /\$4,125\.00/.test(cmp.spread || "")
      && /\$4,800\.00/.test(cmp.spread || ""), String(cmp.spread));

    await page.evaluate(() => [...document.querySelectorAll(".qp-row button")]
      .find((b) => /Award/i.test(b.innerText))?.click());
    await wait(900);
    t.ck("awarding reaches the server", awards.length === 1, JSON.stringify(awards));
    t.ck("for the one that was picked", awards[0]?.companyId === "cmp_pine",
      String(awards[0]?.companyId));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the subcontractor answers, and learns nothing about the others --");
  {
    MY_QUOTES = [{
      inviteId: "i1", requestId: "qr1", status: "invited", requestStatus: "open",
      wonIt: false, priceCents: null, canStart: null, note: null,
      invitedAt: "2026-10-01", answeredAt: null, dueAt: "2026-10-20", trade: "roofing",
      accountId: "acc_a", accountName: "Alder Construction", accountSubdomain: "alder",
      job: { id: "j_mill", title: "Re-roof the mill", address: "12 Mill Lane",
        area: null, zip: null, date: "2026-11-02", time: null, severity: null,
        trades: ["roofing"], scope: "Strip and re-cover, 400sqm",
        assignments: {}, quoting: true, readOnly: true },
    }];
    answers.length = 0;
    photoAsks.length = 0;
    inspAsks.length = 0;
    const { ctx, page, crashes } = await open("u_bay");
    await wait(3100);
    await openCards(page);

    const card = await page.evaluate(() => {
      const c = document.querySelector(".qask");
      return c ? { text: c.innerText.replace(/\s+/g, " ").trim(),
        buttons: [...c.querySelectorAll("button")].map((b) => b.innerText.replace(/\s+/g, " ").trim()) } : null;
    });
    t.ck("they are told they were asked", !!card, String(card));
    t.ck("naming who asked", /For Alder Construction/.test(card.text), card.text.slice(0, 90));
    t.ck("and what to price", /400sqm/.test(card.text));
    t.ck("with the date they want it by", /Wanted by 2026-10-20/.test(card.text));

    // It is NOT a job offer.
    t.ck("no accept button", !card.buttons.some((b) => /^Accept$/i.test(b)),
      JSON.stringify(card.buttons));
    t.ck("no countdown to respond", !/left to respond/.test(card.text), card.text.slice(0, 120));
    t.ck("it asks for a price instead",
      /What would you charge/.test(card.text), card.text.slice(0, 140));
    t.ck("and passing is offered", card.buttons.some((b) => /^Pass$/i.test(b)));

    // Nothing about anybody else.
    t.ck("no sign of the other roofers",
      !/Pine|Oak/.test(card.text), card.text.slice(0, 160));

    // ---- WHAT THEY ARE PRICING, WITH THE PICTURES ----------------------
    //
    // 062 gave the rooms, the captions and the photographs to the company that
    // WON. A quote request is pre-award and there is no work order yet, so the
    // people actually being asked for a number were the ones who could not see
    // the mark -- and a price given off a line of text changes when somebody
    // gets there.
    //
    // DRIVEN RATHER THAN READ OFF THE SOURCE, which is the lesson 062 paid
    // for one screen along: a static check that the panel is mounted passes
    // over a modal that throws, and a panel that renders nothing reads
    // exactly like a card that never had one.
    const ins = await page.evaluate(() => {
      const p = document.querySelector(".qask .woi");
      if (!p) return { missing: true };
      return {
        text: p.innerText.replace(/\s+/g, " ").trim(),
        rooms: [...p.querySelectorAll(".woi-room")].map((r) => ({
          head: r.querySelector("b")?.innerText || "",
          note: r.querySelector(".woi-note")?.innerText || "",
          caps: [...r.querySelectorAll("figcaption")].map((f) => f.innerText),
          thumbs: [...r.querySelectorAll(".ph-thumb img")].length,
          gone: [...r.querySelectorAll(".ph-thumb.is-gone")].length,
        })),
        only: p.querySelector(".woi-only")?.innerText.replace(/\s+/g, " ").trim() || null,
      };
    });
    t.ck("the panel is on the card", !ins.missing, JSON.stringify(ins).slice(0, 160));
    t.ck("naming the room", ins.rooms?.[0]?.head === "Ridge and flashing",
      JSON.stringify(ins.rooms));
    t.ck("with what was wrong with it",
      /Flashing lifted/.test(ins.rooms?.[0]?.note || ""), ins.rooms?.[0]?.note);
    // THE PHOTOGRAPH ITSELF, loaded. A figure with no img is the
    // "Couldn't load" state, which a count of figures cannot tell apart.
    t.ck("and the photograph really loaded",
      ins.rooms?.[0]?.thumbs === 1 && ins.rooms?.[0]?.gone === 0,
      JSON.stringify(ins.rooms?.[0]));
    t.ck("with the caption under it",
      /Lifted about two feet/.test((ins.rooms?.[0]?.caps || []).join(" ")),
      JSON.stringify(ins.rooms?.[0]?.caps));
    // AND IT CAME THROUGH THE INVITE, not the work order. There is no work
    // order yet -- that is the whole reason this route exists -- so a loader
    // left on the work-order one would ask for bytes under an id that names
    // nothing, and the picture would still draw.
    t.ck("and the bytes came through the invite",
      photoAsks.length === 1 && /^\/api\/quotes\/i1\/inspection\/photo\/ph_ridge$/.test(photoAsks[0]),
      JSON.stringify(photoAsks));
    // SAID, because "what the inspection found" over one room reads as the
    // whole walk -- and somebody pricing off that has priced a unit rather
    // than their own part of it.
    t.ck("and it says these are the rooms they were asked about",
      /asked about/.test(ins.only || ""), String(ins.only));
    t.ck("and that the rest is somebody else's",
      /somebody else's/.test(ins.only || ""), String(ins.only));
    // ONE PANEL, ONE REQUEST. Two mounts of it would be two asks for one
    // record, which nothing on the screen can see.
    t.ck("asked for once", inspAsks.length === 1, JSON.stringify(inspAsks));

    // THE SET IS STRUNG TOGETHER, through the one lightbox -- so the quote
    // card did not grow a second one on its way to showing a picture.
    await page.evaluate(() => document.querySelector(".qask .woi .ph-thumb")?.click());
    await wait(500);
    const lb = await page.evaluate(() => {
      const b = document.querySelector(".ph-lightbox");
      return b ? { open: true, img: !!b.querySelector("img") } : { open: false };
    });
    t.ck("tapping it opens the lightbox", lb.open === true, JSON.stringify(lb));
    t.ck("with the picture in it", lb.img === true, JSON.stringify(lb));
    await page.keyboard.press("Escape").catch(() => {});
    await page.evaluate(() => [...document.querySelectorAll(".ph-lightbox button")]
      .find((b) => /close/i.test(b.getAttribute("aria-label") || b.innerText))?.click());
    await wait(400);

    await page.evaluate(() => [...document.querySelectorAll(".qask button")]
      .find((b) => /Send a quote/i.test(b.innerText))?.click());
    await wait(500);
    await page.evaluate(() => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const el = document.querySelector(".qask input[inputmode=decimal]");
      set.call(el, "4800");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".qask-form .form-actions button")]
      .find((b) => /^Send quote$/i.test(b.innerText.trim()))?.click());
    await wait(900);
    t.ck("the quote reaches the server", answers.length === 1, JSON.stringify(answers));
    t.ck("in whole cents", answers[0]?.priceCents === 480000, String(answers[0]?.priceCents));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and a job nobody walked gets no panel at all --");
  {
    // THE ORDINARY CASE. Most jobs were typed or arrived from a CRM, so the
    // route answers 404 and the card draws nothing -- a heading over "no
    // photos" on every quote request in the product is the noise that teaches
    // people to stop reading the card. The positive case above is what makes
    // this absence mean anything: on its own it passes over a panel that never
    // renders for anybody.
    MY_QUOTES = [{ ...MY_QUOTES[0], inviteId: "qi_bare", status: "invited",
      requestStatus: "open", wonIt: false, priceCents: null, answeredAt: null }];
    inspAsks.length = 0;
    const { ctx, page, crashes } = await open("u_bay");
    await wait(3100);
    await openCards(page);
    const got = await page.evaluate(() => ({
      card: !!document.querySelector(".qask"),
      panel: !!document.querySelector(".qask .woi"),
      only: !!document.querySelector(".qask .woi-only"),
    }));
    t.ck("the card is still there", got.card === true, JSON.stringify(got));
    t.ck("and carries no inspection panel", got.panel === false, JSON.stringify(got));
    t.ck("nor the line about which rooms", got.only === false, JSON.stringify(got));
    t.ck("but it did ask", inspAsks.length === 1, JSON.stringify(inspAsks));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  // ---- SEVERAL ITEMS, SENT TOGETHER, PRICED ONE BY ONE --------------------
  //
  // Reported as "it sent one separate quote request for each one plus one
  // together ... it should be together sent, but quoted individually for each
  // item". Two halves, and each is driven here rather than read off the
  // source: the ask is one press carrying every item, and the company asked
  // about two of them gets ONE card with a price box per item.
  const UNIT = {
    id: "j_unit", accountId: "acc_a", title: "Move-out work, unit 32", address: "4 Pier St",
    area: null, zip: null, date: "2026-11-09", time: null, trades: ["roofing", "electrical"],
    scope: "From the move-out inspection of unit 32", status: "active", assignments: {},
    photos: [], measurementDocs: [], propertyId: null, requestedBy: null,
    approvedAt: null, severity: null, notes: null,
  };

  console.log("\n-- one ask carries every item on the job --");
  {
    JOBS = [UNIT]; REQS = []; asks.length = 0;
    const { ctx, page, crashes } = await open("u_boss");
    await wait(3000);
    await page.evaluate(() => [...document.querySelectorAll("nav button")]
      .find((b) => /^Jobs/.test(b.innerText.trim()))?.click());
    await wait(1200);
    await openCards(page);
    await page.evaluate(() => [...document.querySelectorAll(".job-card h3, .job-card button")]
      .find((e) => /unit 32/i.test(e.innerText))?.click());
    await wait(900);
    // Opened from ONE slot, which is how anybody arrives at it.
    await page.evaluate(() => [...document.querySelectorAll(".trade-actions button")]
      .find((b) => /Ask for quotes/i.test(b.innerText))?.click());
    await wait(800);
    const m = await page.evaluate(() => ({
      items: [...document.querySelectorAll(".qa-trade")].map((b) => ({
        name: b.innerText.trim(), on: b.classList.contains("on") })),
      people: [...document.querySelectorAll(".qa-pick:not(.qa-trade) .qa-name")]
        .map((n) => n.innerText.replace(/\s+/g, " ").trim()),
    }));
    t.ck("every open item on the job is offered", m.items.length === 2, JSON.stringify(m.items));
    t.ck("and both are ticked from the start", m.items.every((i) => i.on), JSON.stringify(m.items));
    t.ck("everybody who covers either item can be asked",
      m.people.length === 4 && m.people.some((p) => /Volt Electric/.test(p)), JSON.stringify(m.people));
    t.ck("each says which items it would price",
      m.people.some((p) => /Volt Electric/.test(p) && /Electrical/.test(p))
      && m.people.some((p) => /Bay Roofing/.test(p) && /Roofing/.test(p)), JSON.stringify(m.people));

    // Picking only a roofer leaves the electrical item going to nobody.
    await page.evaluate(() => [...document.querySelectorAll(".qa-pick:not(.qa-trade)")]
      .find((b) => /Bay Roofing/.test(b.innerText))?.click());
    await wait(300);
    const half = await page.evaluate(() => ({
      note: [...document.querySelectorAll(".fld-note")].map((n) => n.innerText)
        .find((x) => /Nobody you picked/.test(x)) || null,
      dead: [...document.querySelectorAll(".form-actions .btn-solid")]
        .find((b) => /Ask/.test(b.innerText))?.disabled ?? null,
    }));
    t.ck("an item nobody picked can price is named", /electrical/i.test(half.note || ""), String(half.note));
    t.ck("and it will not send yet", half.dead === true, String(half.dead));

    await page.evaluate(() => [...document.querySelectorAll(".qa-pick:not(.qa-trade)")]
      .find((b) => /Volt Electric/.test(b.innerText))?.click());
    await wait(300);
    const btn = await page.evaluate(() => [...document.querySelectorAll(".form-actions .btn-solid")]
      .map((b) => b.innerText.trim()).find((x) => /^Ask/.test(x)) || null);
    t.ck("the button says it is one ask about two items",
      btn === "Ask 2 contractors about 2 items", String(btn));
    await page.evaluate(() => [...document.querySelectorAll(".form-actions .btn-solid")]
      .find((b) => /^Ask 2 contractors/.test(b.innerText.trim()))?.click());
    await wait(900);
    t.ck("ONE request reaches the server, not one per item", asks.length === 1, JSON.stringify(asks));
    t.ck("carrying both items",
      (asks[0]?.items || []).map((i) => i.trade).sort().join(",") === "electrical,roofing",
      JSON.stringify(asks[0]?.items));
    t.ck("to the two who were picked", (asks[0]?.companyIds || []).length === 2,
      JSON.stringify(asks[0]?.companyIds));
    // The job's own scope is the whole walk; under each of two items it is
    // exactly the text the per-item split exists to replace.
    t.ck("and neither item is seeded with the whole job's scope",
      (asks[0]?.items || []).every((i) => !/move-out inspection of unit 32/.test(i.scope || "")),
      JSON.stringify(asks[0]?.items));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
    JOBS = [JOB];
  }

  console.log("\n-- the company asked about both gets one card, a price per item --");
  {
    const q = (inviteId, requestId, trade, scope) => ({
      inviteId, requestId, status: "invited", requestStatus: "open",
      wonIt: false, priceCents: null, canStart: null, note: null,
      invitedAt: "2026-10-01", answeredAt: null, dueAt: null, trade,
      accountId: "acc_a", accountName: "Alder Construction", accountSubdomain: "alder",
      job: { id: "j_unit", title: "Move-out work, unit 32", address: "4 Pier St",
        area: null, zip: null, date: "2026-11-09", time: null, severity: null,
        trades: [trade], scope, assignments: {}, quoting: true, readOnly: true },
    });
    MY_QUOTES = [q("i_roof", "qr_roof", "roofing", "Ridge flashing lifted"),
      q("i_elec", "qr_elec", "electrical", "Loft light dead")];
    answers.length = 0; answerPaths.length = 0; inspAsks.length = 0;
    const { ctx, page, crashes } = await open("u_bay");
    await wait(3100);
    // MINIMIZED FIRST, and the line still says it is a price somebody is
    // waiting on, and for how many items -- a closed card that read as
    // quiet would be a request nobody answers.
    const line = await page.evaluate(() => {
      const el = document.querySelector(".qask.job-line");
      return el ? el.innerText.replace(/\s+/g, " ") : null;
    });
    t.ck("it arrives as one line", !!line, String(line));
    t.ck("which says how many items are waiting on a price", /Price 2 items/.test(line || ""), String(line));
    await openCards(page);
    const c = await page.evaluate(() => ({
      cards: document.querySelectorAll(".qask").length,
      items: [...document.querySelectorAll(".qask .qask-item")].map((i) => i.innerText.replace(/\s+/g, " ")),
      count: document.querySelector(".qask .qask-count")?.innerText || null,
    }));
    t.ck("two invites on one job are ONE card", c.cards === 1, String(c.cards));
    t.ck("with a line per item", c.items.length === 2, JSON.stringify(c.items));
    t.ck("each carrying its own scope",
      c.items.some((x) => /Ridge flashing/.test(x)) && c.items.some((x) => /Loft light/.test(x)),
      JSON.stringify(c.items));
    t.ck("and saying how many there are", /2 items/.test(c.count || ""), String(c.count));
    // Each line's rooms are narrowed per trade on the server, so each asks for
    // its own -- under its own invite.
    t.ck("each item's rooms are asked for under its own invite",
      inspAsks.some((p) => /i_roof/.test(p)) && inspAsks.some((p) => /i_elec/.test(p)),
      JSON.stringify(inspAsks));

    await page.evaluate(() => [...document.querySelectorAll(".qask button")]
      .find((b) => /Price these/i.test(b.innerText))?.click());
    await wait(500);
    const boxes = await page.evaluate(() => document.querySelectorAll(".qask input[inputmode=decimal]").length);
    t.ck("a price box per item", boxes === 2, String(boxes));
    await page.evaluate(() => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const el = document.querySelector(".qask input[inputmode=decimal]");
      set.call(el, "2100");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    // Half answered is not answered: silence about the second item would read
    // on the other side as that item still pending.
    const half = await page.evaluate(() => ({
      dead: [...document.querySelectorAll(".qask-form .form-actions .btn-solid")][0]?.disabled ?? null,
      note: [...document.querySelectorAll(".qask-form .fld-note")].map((n) => n.innerText)
        .find((x) => /Give a price/.test(x)) || null,
    }));
    t.ck("one price of two does not send", half.dead === true, String(half.dead));
    t.ck("and names the item still unanswered", /Electrical/.test(half.note || ""), String(half.note));

    // The ELECTRICAL line's own control -- each line carries one, and the
    // first in the card is the roofing line's.
    await page.evaluate(() => [...document.querySelectorAll(".qask .qask-item")]
      .find((i) => /Electrical/.test(i.querySelector(".qask-item-head")?.innerText || ""))
      ?.querySelector(".qask-skip")?.click());
    await wait(300);
    const ready = await page.evaluate(() => ({
      btn: [...document.querySelectorAll(".qask-form .form-actions .btn-solid")].map((b) => [b.innerText, b.disabled]),
      skips: [...document.querySelectorAll(".qask .qask-skip")].map((b) => b.innerText),
    }));
    t.ck("passing on the second makes it sendable, as one quote",
      ready.btn[0]?.[0] === "Send quote" && ready.btn[0]?.[1] === false, JSON.stringify(ready));
    await page.evaluate(() => [...document.querySelectorAll(".qask-form .form-actions .btn-solid")][0]?.click());
    await wait(900);
    const by = Object.fromEntries(answerPaths.map((p, i) => [p.split("/").pop(), answers[i]]));
    t.ck("each item is answered on its own", answers.length === 2, JSON.stringify(answerPaths));
    t.ck("the priced one carries its price", by.i_roof?.priceCents === 210000, JSON.stringify(by.i_roof));
    t.ck("and the other is a pass, not a zero", by.i_elec?.pass === true && !by.i_elec?.priceCents,
      JSON.stringify(by.i_elec));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- afterwards, they learn about themselves only --");
  {
    MY_QUOTES = [{
      inviteId: "i1", requestId: "qr1", status: "quoted", requestStatus: "awarded",
      wonIt: false, priceCents: 480000, canStart: "2026-11-05", note: null,
      invitedAt: "2026-10-01", answeredAt: "2026-10-02", dueAt: null, trade: "roofing",
      accountId: "acc_a", accountName: "Alder Construction", accountSubdomain: "alder",
      job: { id: "j_mill", title: "Re-roof the mill", address: "12 Mill Lane",
        area: null, zip: null, date: "2026-11-02", time: null, severity: null,
        trades: ["roofing"], scope: "Strip and re-cover, 400sqm",
        assignments: {}, quoting: true, readOnly: true },
    }];
    const { ctx, page, crashes } = await open("u_bay");
    await wait(3100);
    const sent = await page.evaluate(() => {
      const r = document.querySelector(".qs-row");
      return r ? r.innerText.replace(/\s+/g, " ").trim() : null;
    });
    t.ck("the quote they sent is still listed", !!sent, String(sent));
    t.ck("with their own number on it", /\$4,800\.00/.test(sent || ""), String(sent));
    t.ck("and that they did not get it", /not this time/i.test(sent || ""), String(sent));
    // The line that must not move.
    t.ck("with the client named readably, not as an escape",
      !/\\u00[0-9a-f]{2}/i.test(sent || ""), String(sent));
    t.ck("never who did get it",
      !/Pine|Oak|4,125/.test(sent || ""), String(sent));
    t.ck("and it is no longer asking them for anything",
      await page.evaluate(() => !document.querySelector(".qask")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
