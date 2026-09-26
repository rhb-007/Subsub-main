// Handing a building over, on the screen, from both sides.
//
// The rule is that one side asks and the other agrees, and the side that asked
// has already agreed by asking. A screen is where that quietly breaks: show the
// requester an Accept button and the whole guarantee is gone, whatever the API
// does. So the negative matters more than the positive here -- whoever raised a
// request must be offered Withdraw and nothing else.
//
// Three sides exist and they are different screens of the same object:
//
//   owner-seat  a guest on their manager's account, who may ask for it
//   manager     runs a building somebody else owns, who may offer it
//   holder      owns and runs it, who may appoint a manager
//
//   node scripts/handover-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-handover-test");
const WEB = 5221, API = 8933;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const PM = {
  id: "acc_pm", name: "Cascade Management", subdomain: "cascade", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "u_pm", name: "Priya Manager", email: "priya@cascade.test", role: "admin" },
};
const OWNER = {
  id: "acc_dana", name: "Dana Holdings", subdomain: "danaholdings", kind: "building_owner",
  plan: "basic", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "u_dana", name: "Dana Reyes", email: "dana@owner.test", role: "admin" },
};

let PROPS_PM = [
  { id: "p_cedar", accountId: "acc_pm", name: "12 Cedar St", address: "12 Cedar St",
    area: "Seattle", city: "Seattle", state: "WA", zip: "98101", units: 8, notes: "",
    ownedByAnother: true },
  { id: "p_elm", accountId: "acc_pm", name: "40 Elm Ave", address: "40 Elm Ave",
    city: "Tacoma", state: "WA", zip: "98402", units: 4, notes: "", ownedByAnother: false },
];
let PROPS_OWNER = [
  { id: "p_cedar", accountId: "acc_dana", name: "12 Cedar St", address: "12 Cedar St",
    city: "Seattle", state: "WA", zip: "98101", units: 8, notes: "", ownedByAnother: false },
];
const PROPS_PM_BASE = PROPS_PM;
// Open work a previous operator is still finishing, on the PM's jobs screen.
let JOBS_PM = [];
let TRANSFERS = [];
// Work the appointed manager has booked at the owner's building.
let JOBS_OWNER = [];

const requested = [], decided = [], cancelled = [], appointed = [], asked = [], declared = [];
const USERS_PM = [
  { id: "u_pm", name: "Priya Manager", email: "priya@cascade.test", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "u_dana", name: "Dana Reyes", email: "dana@owner.test", phone: null, role: "owner",
    subId: null, propertyIds: ["p_cedar"], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
];

let WHICH = "pm";
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  const acct = WHICH === "pm" ? PM : OWNER;
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct];
  if (path === "/api/account") return [200, acct];
  if (path === "/api/properties") return [200, WHICH === "pm" ? PROPS_PM : PROPS_OWNER];
  if (path === "/api/account-users") return [200, WHICH === "pm" ? USERS_PM : [
    { id: "u_dana", name: "Dana Reyes", email: "dana@owner.test", phone: null, role: "admin",
      subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/property-transfers") return [200, TRANSFERS];
  if (path === "/api/subs") return [200, []];
  if (path === "/api/jobs" && method === "POST") {
    asked.push(body);
    return [201, { id: "job_new", requested: true, job: { id: "job_new", accountId: "acc_other",
      title: body?.title, propertyId: body?.propertyId, trades: body?.trades || [],
      assignments: {}, status: "active", readOnly: true, atOwnedProperty: true,
      managedBy: "Sound PM", createdAt: new Date().toISOString().slice(0, 10), photos: [] } }];
  }
  if (path === "/api/jobs") return [200, WHICH === "pm" ? JOBS_PM : JOBS_OWNER];
  if (path === "/api/invites" || path === "/api/connect-requests") return [200, []];
  const rq = /^\/api\/properties\/([^/]+)\/transfer$/.exec(path);
  if (rq && method === "POST") { requested.push({ id: rq[1], body }); return [201, { id: "tr1", awaiting: "acc_pm" }]; }
  const dec = /^\/api\/properties\/([^/]+)\/declare-ownership$/.exec(path);
  if (dec && method === "POST") {
    declared.push({ id: dec[1], own: body?.own });
    PROPS_PM = PROPS_PM.map((p) => p.id === dec[1]
      ? { ...p, ownerDeclared: body?.own !== false } : p);
    return [200, { ok: true, ownerDeclaredAt: body?.own === false ? null : "2026-09-26" }];
  }
  const ap = /^\/api\/properties\/([^/]+)\/appoint$/.exec(path);
  if (ap && method === "POST") { appointed.push({ id: ap[1], body }); return [201, { id: "tr2", to: "Sound PM", awaiting: "acc_other" }]; }
  const dc = /^\/api\/property-transfers\/([^/]+)\/decide$/.exec(path);
  if (dc && method === "POST") { decided.push({ id: dc[1], body }); return [200, { ok: true, status: body?.accept ? "accepted" : "declined" }]; }
  const cx = /^\/api\/property-transfers\/([^/]+)\/cancel$/.exec(path);
  if (cx && method === "POST") { cancelled.push(cx[1]); return [200, { ok: true }]; }
  return undefined;
} });

const browser = await launch();
const openAs = async (which) => {
  WHICH = which;
  const acct = which === "pm" ? PM : OWNER;
  const r = await visitApp(browser, { host: acct.subdomain, webPort: WEB,
    seat: { userId: acct.user.id, accountId: acct.id }, viewport: { width: 1340, height: 1900 } });
  await wait(2600);
  return r;
};
const toProperties = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^(Properties|Buildings)/.test(b.innerText.trim().split("\n")[0]))?.click());
  await wait(1000);
};
// Open a building's detail panel. The tile carries the name and the counts;
// the handover conversation, the owners and the actions are all in here now.
const openDetail = async (page, name) => {
  await page.evaluate((n) => {
    const c = [...document.querySelectorAll(".prop-card")]
      .find((x) => x.querySelector("h3")?.innerText.trim() === n);
    c?.querySelector(".pt-open")?.click();
  }, name);
  await wait(700);
};
const closeDetail = async (page) => {
  await page.evaluate(() => document.querySelector(".modal-close")?.click());
  await wait(400);
};
// What the open panel says. Left async and named `card` so the assertions below
// keep reading as they did.
const card = async (page, name) => {
  await openDetail(page, name);
  const got = await page.evaluate(() => {
    const d = document.querySelector(".prop-detail");
    if (!d) return null;
    const h = d.querySelector(".prop-handover");
    return { handover: h ? h.innerText.replace(/\s+/g, " ").trim() : null,
      live: !!d.querySelector(".prop-handover.live"),
      buttons: h ? [...h.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean) : [],
      cta: [...d.querySelectorAll(".pd-acts button")].map((b) => b.innerText.trim()).filter(Boolean),
      managed: d.querySelector(".ph-managed")?.innerText.trim() || null };
  });
  await closeDetail(page);
  return got;
};
// Acting on the open panel: click something in it by its label.
const clickIn = async (page, name, re) => {
  await openDetail(page, name);
  const hit = await page.evaluate((rs) => {
    const d = document.querySelector(".prop-detail");
    const b = [...(d?.querySelectorAll("button") || [])]
      .find((x) => new RegExp(rs, "i").test(x.innerText));
    if (!b) return null; b.click(); return b.innerText.trim();
  }, re.source);
  await wait(700);
  return hit;
};

try {
  console.log("\n-- the manager can offer a building its owner owns --");
  {
    TRANSFERS = [];
    const { ctx, page, crashes } = await openAs("pm");
    await toProperties(page);
    const cedar = await card(page, "12 Cedar St");
    const elm = await card(page, "40 Elm Ave");
    t.ck("the owned-by-another building offers a handover",
      /hand over to the owner/i.test(cedar?.handover || ""), cedar?.handover);
    t.ck("and says their record survives it",
      /stays yours/i.test(cedar?.handover || ""), cedar?.handover);
    // A building with no owner recorded reads, after 039's backfill, as this
    // account's own -- and this account is a MANAGING AGENT. Appointing is the
    // owner's move, so it is not offered here however the columns read.
    t.ck("a managing agent is not offered appointing",
      !/appoint a property manager/i.test(elm?.handover || ""), elm?.handover);
    // Not a dead end: the path out is named, because it is a real one.
    t.ck("and is pointed at adding the owner instead",
      /add the owner/i.test(elm?.handover || ""), elm?.handover);
    t.ck("no appoint button on the card either",
      !elm.buttons.some((b) => /appoint/i.test(b)), JSON.stringify(elm.buttons));
    // The escape hatch, for the firm that really does own one. Offered, never
    // assumed -- the columns read the same either way.
    t.ck("but it can say it owns this one",
      elm.buttons.some((b) => /we own this one ourselves/i.test(b)), JSON.stringify(elm.buttons));
    t.ck("and is told what that means",
      /owns rather than manages for somebody/i.test(elm?.handover || ""), elm?.handover);

    await clickIn(page, "12 Cedar St", /hand over/);
    await page.evaluate(() => {
      const d = document.querySelector(".prop-detail");
      [...d.querySelectorAll(".prop-handover button")].find((b) => /send the request/i.test(b.innerText))?.click();
    });
    await wait(1100);
    t.ck("sending it reaches the server", requested.length === 1 && requested[0].id === "p_cedar",
      JSON.stringify(requested));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- whoever asked is offered Withdraw, never Accept --");
  {
    // The request the manager just made. They asked, so they have agreed; the
    // screen must not let them agree twice.
    TRANSFERS = [{ id: "tr1", propertyId: "p_cedar", status: "pending", kind: "handover",
      direction: "manager_offered", requestedByAccountId: "acc_pm",
      fromAccountId: "acc_pm", toAccountId: "acc_dana", awaiting: "acc_dana",
      toAccount: "Dana Holdings", note: "End of the month" }];
    const { ctx, page } = await openAs("pm");
    await toProperties(page);
    const c = await card(page, "12 Cedar St");
    t.ck("the card shows it in flight", c?.live === true, JSON.stringify(c));
    t.ck("it says it is waiting on the owner", /waiting on the owner/i.test(c.handover), c.handover);
    t.ck("the note they wrote is shown back", /End of the month/.test(c.handover), c.handover);
    // THE NEGATIVE THAT MATTERS.
    t.ck("no accept button is offered to the side that asked",
      !c.buttons.some((b) => /hand it over|accept/i.test(b)), JSON.stringify(c.buttons));
    t.ck("only withdraw", c.buttons.length === 1 && /withdraw/i.test(c.buttons[0]), JSON.stringify(c.buttons));

    await clickIn(page, "12 Cedar St", /withdraw/);
    await wait(1000);
    t.ck("withdrawing reaches the server", cancelled.includes("tr1"), JSON.stringify(cancelled));
    await ctx.close();
  }

  console.log("\n-- and the side that has not agreed decides --");
  {
    // Same row, read from the owner's account. They are awaited.
    TRANSFERS = [{ id: "tr1", propertyId: "p_cedar", status: "pending", kind: "handover",
      direction: "manager_offered", requestedByAccountId: "acc_pm",
      fromAccountId: "acc_pm", toAccountId: "acc_dana", awaiting: "acc_dana",
      toAccount: "Dana Holdings", note: null }];
    const { ctx, page } = await openAs("owner");
    await toProperties(page);
    const c = await card(page, "12 Cedar St");
    t.ck("the owner is asked to decide", c?.live === true, JSON.stringify(c));
    t.ck("both answers are offered",
      c.buttons.some((b) => /hand it over|accept/i.test(b)) && c.buttons.some((b) => /decline/i.test(b)),
      JSON.stringify(c.buttons));
    t.ck("and no withdraw, because it is not their request",
      !c.buttons.some((b) => /withdraw/i.test(b)), JSON.stringify(c.buttons));
    t.ck("it says the old jobs stay on the manager's record",
      /stay on your manager's record/i.test(c.handover), c.handover);

    await clickIn(page, "12 Cedar St", /hand it over|accept/);
    await wait(1100);
    t.ck("accepting reaches the server with accept true",
      decided.length === 1 && decided[0].body.accept === true, JSON.stringify(decided));
    await ctx.close();
  }

  console.log("\n-- an owner holding their building appoints somebody --");
  {
    TRANSFERS = [];
    const { ctx, page } = await openAs("owner");
    await toProperties(page);
    const c = await card(page, "12 Cedar St");
    t.ck("appointing is offered", /appoint a property manager/i.test(c?.handover || ""), c?.handover);

    await clickIn(page, "12 Cedar St", /appoint/);
    await wait(700);
    const form = await page.evaluate(() => {
      const h = document.querySelector(".prop-handover");
      return { text: h.innerText.replace(/\s+/g, " ").trim(),
        hasInput: !!h.querySelector('input') };
    });
    t.ck("it asks for their SubSub address", form.hasInput && /subsub address/i.test(form.text), form.text);
    // Not a search. There is no endpoint that would answer one.
    t.ck("and says plainly there is nothing to search",
      /no directory to search/i.test(form.text), form.text);

    await page.evaluate(() => {
      const h = document.querySelector(".prop-handover");
      const i = h.querySelector("input");
      const d = Object.getOwnPropertyDescriptor(i.constructor.prototype, "value");
      d.set.call(i, "soundpm"); i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(400);
    await page.evaluate(() => {
      const h = document.querySelector(".prop-handover");
      [...h.querySelectorAll("button")].find((b) => /ask them to manage/i.test(b.innerText))?.click();
    });
    await wait(1100);
    t.ck("it reaches the server with the subdomain typed",
      appointed.length === 1 && appointed[0].body.subdomain === "soundpm", JSON.stringify(appointed));
    await ctx.close();
  }

console.log("\n-- and they can watch the work at it, without touching it --");
  {
    TRANSFERS = [];
    PROPS_OWNER = [{ id: "p_cedar", accountId: "acc_other", name: "12 Cedar St",
      address: "12 Cedar St", city: "Seattle", state: "WA", zip: "98101", units: 8, notes: "",
      ownedNotOperated: true, managedBy: "Sound PM" }];
    JOBS_OWNER = [{
      id: "job_theirs", accountId: "acc_other", title: "Boiler service", status: "active",
      date: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10), time: null,
      address: "12 Cedar St", area: "Seattle", zip: "98101", propertyId: "p_cedar",
      trades: ["plumbing"], assignments: {}, notes: "", scope: "Annual service",
      createdAt: new Date().toISOString().slice(0, 10), photos: [],
      readOnly: true, atOwnedProperty: true, managedBy: "Sound PM",
    }];
    const { ctx, page } = await openAs("owner");
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => /^Jobs/.test(b.innerText.trim().split("\n")[0]))?.click());
    await wait(1100);
    const card = await page.evaluate(() => {
      const c = [...document.querySelectorAll(".job-card")].find((x) => /Boiler service/.test(x.innerText));
      if (!c) return null;
      return { text: c.innerText.replace(/\s+/g, " ").trim(),
        notMine: c.className.includes("not-mine"),
        buttons: [...c.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean) };
    });
    t.ck("the work at their building is on their jobs screen", !!card, String(card));
    t.ck("and the card says who runs it", /sound pm runs this/i.test(card.text), card.text);
    t.ck("it reads as one they only watch", card.notMine === true, String(card.notMine));
    // THE NEGATIVE: none of the manager's actions may be offered.
    t.ck("no assign button", !card.buttons.some((b) => /assign/i.test(b)), JSON.stringify(card.buttons));
    t.ck("no replace or withdraw",
      !card.buttons.some((b) => /replace|withdraw/i.test(b)), JSON.stringify(card.buttons));
    t.ck("no change order", !card.buttons.some((b) => /change order/i.test(b)), JSON.stringify(card.buttons));
    t.ck("no overflow button", !card.buttons.some((b) => /overflow/i.test(b)), JSON.stringify(card.buttons));
    // This one was live: canComplete answers "may this ROLE complete jobs",
    // which is not "may they complete THIS job", so an owner was offered Mark
    // job complete on work their manager was running.
    t.ck("and they cannot mark their manager's job complete",
      !card.buttons.some((b) => /complete/i.test(b)), JSON.stringify(card.buttons));
    t.ck("it says whose job assigning it is",
      /their manager assigns this|handled by their manager/i.test(card.text), card.text);
    await ctx.close();
    JOBS_OWNER = [];
  }

  console.log("\n-- a building they own but do not run says so --");
  {
    TRANSFERS = [];
    PROPS_OWNER = [{ id: "p_cedar", accountId: "acc_other", name: "12 Cedar St",
      address: "12 Cedar St", city: "Seattle", state: "WA", zip: "98101", units: 8, notes: "",
      ownedNotOperated: true, managedBy: "Sound PM" }];
    const { ctx, page } = await openAs("owner");
    await toProperties(page);
    const c = await card(page, "12 Cedar St");
    t.ck("the card says who runs it", /managed by sound pm/i.test(c?.managed || ""), String(c?.managed));
    const cta = (await card(page, "12 Cedar St"))?.cta || [];
    // They cannot book the work. They can ask for it -- the alternative is
    // watching your own building and having to ring somebody.
    t.ck("it offers to ask the manager", cta.some((b) => /ask your manager/i.test(b)), JSON.stringify(cta));
    // THE NEGATIVE: it is not their building to run.
    t.ck("and does not offer to assign vendors",
      !cta.some((b) => /assign/i.test(b)), JSON.stringify(cta));
    t.ck("nor to raise a job of their own",
      !cta.some((b) => /new job here/i.test(b)), JSON.stringify(cta));
    await ctx.close();
  }

  console.log("\n-- and asking for work there says whose job it becomes --");
  {
    TRANSFERS = []; asked.length = 0;
    PROPS_OWNER = [{ id: "p_cedar", accountId: "acc_other", name: "12 Cedar St",
      address: "12 Cedar St", city: "Seattle", state: "WA", zip: "98101", units: 8, notes: "",
      ownedNotOperated: true, managedBy: "Sound PM" },
    { id: "p_elm", accountId: "acc_dana", name: "40 Elm Ave", address: "40 Elm Ave",
      city: "Tacoma", state: "WA", zip: "98402", units: 4, notes: "" }];
    const { ctx, page } = await openAs("owner");
    await toProperties(page);
    await clickIn(page, "12 Cedar St", /ask your manager/);
    await wait(900);
    const form = await page.evaluate(() => {
      const f = document.querySelector(".modal .form") || document.querySelector(".form");
      if (!f) return null;
      return { head: f.querySelector("h2")?.innerText.trim(),
        sub: f.querySelector(".form-sub")?.innerText.replace(/\s+/g, " ").trim(),
        send: [...f.querySelectorAll(".form-actions button")].map((b) => b.innerText.trim()),
        options: [...f.querySelectorAll("select option")].map((o) => o.innerText.trim()) };
    });
    t.ck("the form knows it is a request, not a job", form?.head === "Request work", String(form?.head));
    // The account is an admin of its own account -- the ROLE says they may
    // create jobs. The building is what makes this a request.
    t.ck("and names who it goes to", /sound pm/i.test(form?.sub || ""), form?.sub);
    t.ck("and that nothing is booked until they approve",
      /nothing is booked until they approve/i.test(form?.sub || ""), form?.sub);
    t.ck("the button sends rather than creates",
      form.send.some((b) => /send this request/i.test(b))
        && !form.send.some((b) => /find contractors/i.test(b)), JSON.stringify(form.send));
    // The picker says which buildings are somebody else's to run, so the
    // answer is visible before anything is sent.
    t.ck("the list marks the building somebody else runs",
      form.options.some((o) => /12 Cedar St — run by Sound PM/.test(o)), JSON.stringify(form.options));
    t.ck("and leaves their own unmarked",
      form.options.some((o) => o === "40 Elm Ave"), JSON.stringify(form.options));

    // Sending it reaches the server naming the building, which is the only
    // thing that decides whose account the work lands on.
    await page.evaluate(() => {
      const f = document.querySelector(".modal .form") || document.querySelector(".form");
      const ti = [...f.querySelectorAll("input")].find((i) => /full exterior/i.test(i.placeholder || ""));
      // React tracks the value it set, so assigning .value alone is ignored.
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(ti, "Boiler making a noise");
      ti.dispatchEvent(new Event("input", { bubbles: true }));
      [...f.querySelectorAll(".pick")].find((b) => /plumb/i.test(b.innerText))?.click();
    });
    await wait(400);
    await page.evaluate(() => {
      const f = document.querySelector(".modal .form") || document.querySelector(".form");
      [...f.querySelectorAll(".form-actions button")].find((b) => /send this request/i.test(b.innerText))?.click();
    });
    await wait(1100);
    t.ck("it reaches the server", asked.length === 1, JSON.stringify(asked));
    t.ck("naming the building it is at", asked[0]?.propertyId === "p_cedar", String(asked[0]?.propertyId));
    t.ck("and what is wrong", /boiler/i.test(asked[0]?.title || ""), String(asked[0]?.title));
    await ctx.close();
    PROPS_OWNER = PROPS_OWNER.slice(0, 1);
  }
  console.log("\n-- saying so turns appointing on, for that building only --");
  {
    TRANSFERS = []; declared.length = 0; appointed.length = 0;
    PROPS_PM = PROPS_PM_BASE;
    const { ctx, page } = await openAs("pm");
    await toProperties(page);
    // Say it.
    const hit = await clickIn(page, "40 Elm Ave", /we own this one ourselves/);
    t.ck("the claim reaches the server", declared.length === 1 && declared[0].own === true,
      JSON.stringify(declared));
    t.ck("naming the building it is about", declared[0]?.id === "p_elm", String(declared[0]?.id));
    t.ck("the button was the one clicked", /we own this one/i.test(hit || ""), String(hit));

    // And now appointing is there, on that building.
    const elm = await card(page, "40 Elm Ave");
    t.ck("appointing is offered once it is recorded",
      /appoint a property manager/i.test(elm?.handover || ""), elm?.handover);
    // Reversible: nobody should be stuck with a claim they mis-tapped.
    t.ck("and the claim can be taken back",
      /isn.t ours after all/i.test(elm?.handover || ""), elm?.handover);

    // THE NEGATIVE: the other building is untouched. A firm with two hundred
    // client buildings must not unlock them by declaring one.
    const cedar = await card(page, "12 Cedar St");
    t.ck("the other building is not unlocked by it",
      !/appoint a property manager/i.test(cedar?.handover || ""), cedar?.handover);
    await ctx.close();
    PROPS_PM = PROPS_PM_BASE;
  }

  console.log("\n-- and taking it back puts things as they were --");
  {
    TRANSFERS = []; declared.length = 0;
    PROPS_PM = PROPS_PM_BASE.map((p) => p.id === "p_elm" ? { ...p, ownerDeclared: true } : p);
    const { ctx, page } = await openAs("pm");
    await toProperties(page);
    await clickIn(page, "40 Elm Ave", /isn.t ours after all/);
    t.ck("the withdrawal reaches the server", declared.length === 1 && declared[0].own === false,
      JSON.stringify(declared));
    const elm = await card(page, "40 Elm Ave");
    t.ck("appointing goes with it",
      !/appoint a property manager/i.test(elm?.handover || ""), elm?.handover);
    t.ck("and the offer to claim it comes back",
      /we own this one ourselves/i.test(elm?.handover || ""), elm?.handover);
    await ctx.close();
    PROPS_PM = PROPS_PM_BASE;
  }

  console.log("\n-- open repairs the previous manager is still finishing --");
  {
    TRANSFERS = [];
    // Sound PM has just taken Cedar on. Cascade is still finishing two repairs
    // at it: one with a contractor booked, one still waiting. Neither job row
    // carries an accountId -- what crosses is the redacted shape, not the job.
    PROPS_PM = [{ id: "p_cedar", accountId: "acc_pm", name: "12 Cedar St",
      address: "12 Cedar St", city: "Seattle", state: "WA", zip: "98101", units: 8, notes: "" }];
    JOBS_PM = [
      { id: "job_leak", title: "Roof leak", propertyId: "p_cedar", trades: ["roofing"],
        scope: "Water in the top flat", date: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
        time: "07:00", address: "12 Cedar St", area: "Seattle", zip: "98101", status: "active",
        severity: "urgent", photos: [], createdAt: new Date().toISOString().slice(0, 10),
        bookedTrades: ["roofing"], assignments: {}, requestedByName: "Tam Tenant",
        previousManager: "Cascade Management", inherited: true, readOnly: true },
      { id: "job_boiler", title: "Boiler service", propertyId: "p_cedar", trades: ["plumbing"],
        scope: "Annual service", date: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10),
        time: "07:00", address: "12 Cedar St", area: "Seattle", zip: "98101", status: "active",
        photos: [], createdAt: new Date().toISOString().slice(0, 10),
        bookedTrades: [], assignments: {}, previousManager: "Cascade Management",
        inherited: true, readOnly: true },
    ];
    const { ctx, page } = await openAs("pm");
    await page.evaluate(() => [...document.querySelectorAll("button")]
      .find((b) => /^Jobs/.test(b.innerText.trim().split("\n")[0]))?.click());
    await wait(1100);
    const cards = await page.evaluate(() => [...document.querySelectorAll(".job-card")].map((c) => ({
      text: c.innerText.replace(/\s+/g, " ").trim(),
      notMine: c.className.includes("not-mine"),
      badge: c.querySelector(".job-inherited")?.innerText.trim() || null,
      watching: c.querySelector(".job-watching")?.innerText.trim() || null,
      buttons: [...c.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean),
    })));
    // The whole point: a job row with no accountId on it must still reach the
    // screen. The memo has dropped exactly this kind of flag before.
    t.ck("the inherited repairs are on the jobs screen", cards.length === 2,
      JSON.stringify(cards.map((c) => c.text.slice(0, 30))));
    const leak = cards.find((c) => /Roof leak/.test(c.text));
    t.ck("the card names who is finishing it",
      /Cascade Management is finishing this/.test(leak?.badge || ""), String(leak?.badge));
    // NOT the owner's sentence -- this is at their own building.
    t.ck("and does not read as somebody else's building",
      !leak?.watching, String(leak?.watching));
    t.ck("it reads as one they do not run", leak?.notMine === true, String(leak?.notMine));
    // What they need in order to run the building.
    t.ck("a booked trade says somebody is coming",
      /Contractor booked — let them in/.test(leak?.text || ""), leak?.text);
    const boiler = cards.find((c) => /Boiler service/.test(c.text));
    t.ck("and an unbooked one says nobody is yet",
      /Nobody booked for this yet/.test(boiler?.text || ""), boiler?.text);
    t.ck("the tenant who reported it is named", /Tam Tenant/.test(leak?.text || ""), leak?.text);
    // THE NEGATIVE: none of the actions of an account that runs the work.
    t.ck("no assign button", !leak.buttons.some((b) => /assign|find alternativ/i.test(b)),
      JSON.stringify(leak.buttons));
    t.ck("no replace or withdraw",
      !leak.buttons.some((b) => /replace|withdraw/i.test(b)), JSON.stringify(leak.buttons));
    t.ck("no change order", !leak.buttons.some((b) => /change order/i.test(b)), JSON.stringify(leak.buttons));
    // Nor may they close out the previous manager's repair: completion is
    // two-party and both parties are on the other account.
    t.ck("and cannot mark it complete",
      !leak.buttons.some((b) => /complete/i.test(b)), JSON.stringify(leak.buttons));
    // And nothing about the previous manager's contractor or contract.
    t.ck("no price on the card", !/\$[0-9]/.test(leak?.text || ""), leak?.text);
    t.ck("no work order number", !/WO-/.test(leak?.text || ""), leak?.text);
    // And the card must not contradict itself: "no contractor, no work order
    // issued" sat right next to "contractor booked", because no assignments
    // object crosses.
    t.ck("it does not deny the contractor it just announced",
      !/No contractor/.test(leak?.text || ""), leak?.text);
    t.ck("it says whose work order it is",
      /On Cascade Management's work order/.test(leak?.text || ""), leak?.text);
    t.ck("and an unbooked trade has no work order yet",
      /No work order yet/.test(boiler?.text || ""), boiler?.text);
    await ctx.close();
    JOBS_PM = []; PROPS_PM = PROPS_PM_BASE;
  }

  console.log("\n-- and the count is on the table before anybody accepts --");
  {
    PROPS_PM = PROPS_PM_BASE;
    // An appointment waiting on Cascade to accept, at a building with three
    // repairs still open on the owner's side.
    TRANSFERS = [{ id: "tr9", propertyId: "p_cedar", propertyName: "12 Cedar St",
      fromAccountId: "acc_dana", toAccountId: "acc_pm", requestedByAccountId: "acc_dana",
      fromAccount: "Dana Holdings", toAccount: "Cascade Management",
      direction: "owner_requested", kind: "appointment", status: "pending", note: null,
      createdAt: new Date().toISOString(), decidedAt: null,
      awaiting: "acc_pm", awaitingMe: true, mine: "to",
      openWork: 3,
      openWorkText: "3 open repairs at this building are being finished by the previous manager. "
        + "You can see what and when, but it stays theirs to complete and to pay." }];
    const { ctx, page } = await openAs("pm");
    await toProperties(page);
    await openDetail(page, "12 Cedar St");
    const panel = await page.evaluate(() => {
      const h = document.querySelector(".prop-detail .prop-handover");
      return { open: h?.querySelector(".ph-open")?.innerText.replace(/\s+/g, " ").trim() || null,
        small: h?.querySelector(".ph-small")?.innerText.replace(/\s+/g, " ").trim() || null,
        buttons: [...(h?.querySelectorAll("button") || [])].map((b) => b.innerText.trim()) };
    });
    await closeDetail(page);
    t.ck("the count is on the decision panel", /3 open repairs/.test(panel.open || ""), String(panel.open));
    t.ck("and says it stays with the previous manager",
      /being finished by the previous manager/.test(panel.open || ""), String(panel.open));
    // It informs; it never blocks. Both answers are still offered.
    t.ck("accepting is still offered", panel.buttons.some((b) => /accept/i.test(b)),
      JSON.stringify(panel.buttons));
    t.ck("and declining too", panel.buttons.some((b) => /decline/i.test(b)),
      JSON.stringify(panel.buttons));
    // The promise the panel makes has to be true: the jobs do not move.
    t.ck("it no longer promises the jobs come too",
      !/its jobs[^.]*become yours/i.test(panel.small || ""), String(panel.small));
    t.ck("it says work under way stays with whoever started it",
      /stays with the manager who started it/i.test(panel.small || ""), String(panel.small));
    await ctx.close();
    TRANSFERS = [];
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
