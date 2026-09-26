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
let TRANSFERS = [];
// Work the appointed manager has booked at the owner's building.
let JOBS_OWNER = [];

const requested = [], decided = [], cancelled = [], appointed = [];
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
  if (path === "/api/jobs") return [200, WHICH === "pm" ? [] : JOBS_OWNER];
  if (path === "/api/invites" || path === "/api/connect-requests") return [200, []];
  const rq = /^\/api\/properties\/([^/]+)\/transfer$/.exec(path);
  if (rq && method === "POST") { requested.push({ id: rq[1], body }); return [201, { id: "tr1", awaiting: "acc_pm" }]; }
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
const card = (page, name) => page.evaluate((n) => {
  const c = [...document.querySelectorAll(".prop-card")].find((x) => x.querySelector("h3")?.innerText.trim() === n);
  if (!c) return null;
  const h = c.querySelector(".prop-handover");
  return { handover: h ? h.innerText.replace(/\s+/g, " ").trim() : null,
    live: !!c.querySelector(".prop-handover.live"),
    buttons: h ? [...h.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean) : [],
    managed: c.querySelector(".ph-managed")?.innerText.trim() || null };
}, name);

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
    // A building nobody else owns has nothing to hand over -- it offers
    // appointing instead, which is the holder's move.
    t.ck("a building they own themselves offers appointing a manager",
      /appoint a property manager/i.test(elm?.handover || ""), elm?.handover);
    t.ck("and says the owner keeps it", /you keep it/i.test(elm?.handover || ""), elm?.handover);

    await page.evaluate(() => {
      const c = [...document.querySelectorAll(".prop-card")].find((x) => /Cedar/.test(x.innerText));
      [...c.querySelectorAll(".prop-handover button")].find((b) => /hand over/i.test(b.innerText))?.click();
    });
    await wait(600);
    await page.evaluate(() => {
      const c = [...document.querySelectorAll(".prop-card")].find((x) => /Cedar/.test(x.innerText));
      [...c.querySelectorAll(".prop-handover button")].find((b) => /send the request/i.test(b.innerText))?.click();
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

    await page.evaluate(() => {
      const x = [...document.querySelectorAll(".prop-card")].find((y) => /Cedar/.test(y.innerText));
      [...x.querySelectorAll(".prop-handover button")].find((b) => /withdraw/i.test(b.innerText))?.click();
    });
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

    await page.evaluate(() => {
      const x = [...document.querySelectorAll(".prop-card")].find((y) => /Cedar/.test(y.innerText));
      [...x.querySelectorAll(".prop-handover button")].find((b) => /hand it over|accept/i.test(b.innerText))?.click();
    });
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

    await page.evaluate(() => {
      const x = [...document.querySelectorAll(".prop-card")].find((y) => /Cedar/.test(y.innerText));
      [...x.querySelectorAll(".prop-handover button")].find((b) => /appoint/i.test(b.innerText))?.click();
    });
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
    // Raising work on it is their manager's job.
    const cta = await page.evaluate(() => {
      const x = [...document.querySelectorAll(".prop-card")].find((y) => /Cedar/.test(y.innerText));
      return [...x.querySelectorAll(".prop-cta button")].map((b) => b.innerText.trim());
    });
    t.ck("and it does not offer to raise work there",
      !cta.some((b) => /new job|request work/i.test(b)), JSON.stringify(cta));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
