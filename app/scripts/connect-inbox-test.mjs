// Being asked to work with somebody, from the side that has to answer.
//
// "This connection request from Cascade Management to Outerhome is nowhere to
// be found on the Outerhome side. It says it's waiting for Outerhome to
// accept. On Outerhome, there is nothing to accept."
//
// It was fetched and it was never shown. Since 031 an account is a company
// too, so an admin can be asked to connect -- but the only screen rendering
// the request was Account > Company, and the amber badge that would have
// pointed at it lives in the contractor portal's nav, inside can("portal").
// ROLES.admin does not include "portal". So the asking side read "waiting on
// their answer" indefinitely and the answering side had nothing to answer,
// with no badge, no dashboard row and no notification anywhere.
//
// The whole point of a two-party handshake is that the second party can see
// it. This is the test that they can.
//
//   node scripts/connect-inbox-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-connectin-test");
const WEB = 5225, API = 8937;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

// Outerhome: a general contractor, so hireable, and the seat is an ADMIN --
// the role with no contractor portal, which is the whole bug.
const OH = {
  id: "acc_oh", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "u_rb", name: "Richard Braun", email: "rb@outerhome.test", role: "admin" },
};

let INCOMING = [];
const answered = [], askedAbout = [];
// What the account deciding may learn about the one asking. Counts and towns,
// never a building's address and never their contractor list.
let ASKER = {
  id: "cr1", account: "Cascade Management", kind: "property_manager",
  since: "2025-03-14T00:00:00Z", askedBy: "Priya Manager", via: "search",
  message: "We have siding work in Ballard.",
  createdAt: new Date(Date.now() - 15 * 3600 * 1000).toISOString(),
  buildings: 14, towns: ["Seattle, WA", "Bellevue, WA", "Tacoma, WA"], jobs: 120,
  trades: ["siding", "roofing"],
};

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, OH];
  if (path === "/api/account") return [200, OH];
  if (path === "/api/my-connect-requests") return [200, INCOMING];
  if (path === "/api/connect-requests") return [200, []];
  const ak = /^\/api\/my-connect-requests\/([^/]+)\/asker$/.exec(path);
  if (ak) { askedAbout.push(ak[1]); return [200, { ...ASKER, id: ak[1] }]; }
  const rq = /^\/api\/my-connect-requests\/([^/]+)\/respond$/.exec(path);
  if (rq && method === "POST") {
    answered.push({ id: rq[1], accept: body?.accept });
    INCOMING = INCOMING.map((r) => r.id === rq[1]
      ? { ...r, status: body?.accept ? "accepted" : "declined" } : r);
    return [200, { ok: true, status: body?.accept ? "accepted" : "declined" }];
  }
  // The seat's role is read off here. Returning an empty list left the role
  // defaulting to "contractor", which is the one seat that always COULD see
  // these -- so the fixture has to be the admin it is about.
  if (path === "/api/account-users") return [200, [
    { id: "u_rb", name: "Richard Braun", email: "rb@outerhome.test", phone: null, role: "admin",
      subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  ]];
  if (path === "/api/properties" || path === "/api/subs" || path === "/api/jobs"
    || path === "/api/invites" || path === "/api/property-transfers") return [200, []];
  return undefined;
} });

const browser = await launch();
const open = async () => {
  const r = await visitApp(browser, { host: OH.subdomain, webPort: WEB,
    seat: { userId: "u_rb", accountId: "acc_oh" }, viewport: { width: 1340, height: 1400 } });
  await wait(2800);
  return r;
};
const read = (page) => page.evaluate(() => {
  const sec = [...document.querySelectorAll(".dash-sec")]
    .find((s) => /asking to work with you/i.test(s.querySelector("h3")?.innerText || ""));
  const nav = [...document.querySelectorAll("button")]
    .find((b) => /^Dashboard/.test(b.innerText.trim().split("\n")[0]));
  return {
    section: sec ? sec.innerText.replace(/\s+/g, " ").trim() : null,
    count: sec?.querySelector(".sec-count")?.innerText.trim() || null,
    buttons: sec ? [...sec.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean) : [],
    badge: nav?.querySelector(".count.amber")?.innerText.trim() || null,
  };
});

try {
  console.log("\n-- somebody has asked, and the account is an admin seat --");
  {
    INCOMING = [{
      id: "cr1", account: "Cascade Management", accountId: "acc_pm",
      company: "Outerhome", companyName: "Outerhome", contact: "Richard Braun",
      city: "Seattle", state: "WA", via: "search", status: "pending",
      message: "We have siding work in Ballard.",
      createdAt: new Date(Date.now() - 15 * 3600 * 1000).toISOString(),
    }];
    answered.length = 0;
    const { ctx, page, crashes } = await open();
    const got = await read(page);

    // THE BUG: this section did not exist for an admin, at all.
    t.ck("the request is on the dashboard", !!got.section, String(got.section));
    t.ck("and names who is asking", /Cascade Management/.test(got.section || ""), got.section);
    t.ck("and what they wrote", /siding work in Ballard/.test(got.section || ""), got.section);
    t.ck("and how long it has been waiting", /15 hours ago|14 hours ago|hours ago/.test(got.section || ""),
      got.section);
    // An answer is the entire point.
    t.ck("accepting is offered", got.buttons.some((b) => /accept/i.test(b)), JSON.stringify(got.buttons));
    t.ck("declining is offered", got.buttons.some((b) => /decline/i.test(b)), JSON.stringify(got.buttons));
    // Findable from anywhere, not only once you happen to be on the dashboard.
    t.ck("the nav carries the count", got.badge === "1", String(got.badge));
    t.ck("and the section counts it too", got.count === "1", String(got.count));
    // Saying yes hands over documents, and somebody tapping Accept on a phone
    // deserves to know that before they do.
    t.ck("it says what accepting gives away",
      /work orders and see your trades, crews, availability and compliance documents/i
        .test(got.section || ""), got.section);
    t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and you can see who is asking before you decide --");
  {
    INCOMING = [{
      id: "cr1", account: "Cascade Management", accountId: "acc_pm",
      company: "Outerhome", companyName: "Outerhome", contact: "Richard Braun",
      city: "Seattle", state: "WA", via: "search", status: "pending",
      message: "We have siding work in Ballard.",
      createdAt: new Date(Date.now() - 15 * 3600 * 1000).toISOString(),
    }];
    answered.length = 0; askedAbout.length = 0;
    const { ctx, page } = await open();
    // The name is the way in.
    await page.evaluate(() => {
      const sec = [...document.querySelectorAll(".dash-sec")]
        .find((s) => /asking to work with you/i.test(s.querySelector("h3")?.innerText || ""));
      sec.querySelector(".cx-open")?.click();
    });
    await wait(1200);
    const panel = await page.evaluate(() => {
      const el = document.querySelector(".asker-panel");
      if (!el) return null;
      return { text: el.innerText.replace(/\s+/g, " ").trim(),
        acts: [...el.querySelectorAll(".form-actions button")].map((b) => b.innerText.trim()) };
    });
    t.ck("the panel opens", !!panel, String(panel));
    t.ck("and it asked about THAT request", askedAbout.length === 1 && askedAbout[0] === "cr1",
      JSON.stringify(askedAbout));
    // What the decision turns on.
    t.ck("it says what kind of outfit they are", /Property manager/.test(panel.text), panel.text);
    t.ck("and how long they have been here", /since March 2025/i.test(panel.text), panel.text);
    t.ck("how many buildings", /14/.test(panel.text), panel.text);
    t.ck("and which towns", /Seattle, WA/.test(panel.text) && /Tacoma, WA/.test(panel.text), panel.text);
    t.ck("how much work has gone through", /120 jobs/.test(panel.text), panel.text);
    t.ck("what they hire for", /Siding/i.test(panel.text), panel.text);
    t.ck("and who actually asked", /Priya Manager/.test(panel.text), panel.text);
    // The decision is takeable from here rather than sending them back.
    t.ck("both answers are offered in the panel",
      panel.acts.some((b) => /accept/i.test(b)) && panel.acts.some((b) => /decline/i.test(b)),
      JSON.stringify(panel.acts));
    // And it still says what saying yes costs.
    t.ck("it repeats what accepting gives away",
      /trades, crews, availability and compliance documents/i.test(panel.text), panel.text);

    // Answering from inside the panel works and closes it.
    await page.evaluate(() => {
      const el = document.querySelector(".asker-panel");
      [...el.querySelectorAll(".form-actions button")].find((b) => /accept/i.test(b.innerText))?.click();
    });
    await wait(1400);
    t.ck("accepting from the panel reaches the server",
      answered.length === 1 && answered[0].accept === true, JSON.stringify(answered));
    t.ck("and the panel closes",
      await page.evaluate(() => !document.querySelector(".asker-panel")));
    await ctx.close();
  }

console.log("\n-- and answering it reaches the server --");
  {
    INCOMING = [{
      id: "cr1", account: "Cascade Management", accountId: "acc_pm",
      company: "Outerhome", companyName: "Outerhome", contact: "Richard Braun",
      city: "Seattle", state: "WA", via: "search", status: "pending", message: null,
      createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    }];
    answered.length = 0;
    const { ctx, page } = await open();
    await page.evaluate(() => {
      const sec = [...document.querySelectorAll(".dash-sec")]
        .find((s) => /asking to work with you/i.test(s.querySelector("h3")?.innerText || ""));
      [...sec.querySelectorAll("button")].find((b) => /accept/i.test(b.innerText))?.click();
    });
    await wait(1400);
    t.ck("the answer reaches the server", answered.length === 1, JSON.stringify(answered));
    t.ck("and it is a yes", answered[0]?.accept === true, JSON.stringify(answered[0]));
    // Answered is answered: it must not sit there looking unanswered.
    const after = await read(page);
    t.ck("the request leaves the dashboard", !after.section, String(after.section));
    t.ck("and the badge goes with it", after.badge === null, String(after.badge));
    await ctx.close();
  }

  console.log("\n-- declining is a real answer too --");
  {
    INCOMING = [{
      id: "cr2", account: "Cascade Management", accountId: "acc_pm",
      company: "Outerhome", companyName: "Outerhome", contact: "Richard Braun",
      city: "Seattle", state: "WA", via: "code", status: "pending", message: null,
      createdAt: new Date().toISOString(),
    }];
    answered.length = 0;
    const { ctx, page } = await open();
    // A scanned code says so rather than claiming they were searched for.
    const got = await read(page);
    t.ck("a scanned code is described as one", /scanned your code/i.test(got.section || ""), got.section);
    await page.evaluate(() => {
      const sec = [...document.querySelectorAll(".dash-sec")]
        .find((s) => /asking to work with you/i.test(s.querySelector("h3")?.innerText || ""));
      [...sec.querySelectorAll("button")].find((b) => /decline/i.test(b.innerText))?.click();
    });
    await wait(1400);
    t.ck("the decline reaches the server", answered.length === 1 && answered[0].accept === false,
      JSON.stringify(answered));
    await ctx.close();
  }

  console.log("\n-- and with nobody asking, nothing is shouted about --");
  {
    INCOMING = [
      // Already answered: finished business, not an inbox item.
      { id: "cr3", account: "Cascade Management", accountId: "acc_pm", company: "Outerhome",
        companyName: "Outerhome", contact: "Richard Braun", city: "Seattle", state: "WA",
        via: "search", status: "accepted", message: null, createdAt: new Date().toISOString() },
    ];
    const { ctx, page } = await open();
    const got = await read(page);
    t.ck("no section when nothing is pending", !got.section, String(got.section));
    t.ck("and no badge on the nav", got.badge === null, String(got.badge));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
