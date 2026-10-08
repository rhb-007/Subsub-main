// THE TENANT CAN ANSWER A TIME, AND PUT ANOTHER ONE FORWARD.
//
// Reported with the tenant's report on screen: a chip reading "Confirm a
// time", a sentence saying the time had been put forward, a popup saying to
// "close this and confirm it on your dashboard" -- and nothing anywhere to
// press. The route refused the tenant until the crew and the hiring side had
// both agreed, and the tenant could never propose a time at all.
//
// Driven in a browser because every claim is about what is DRAWN and what
// REACHES THE SERVER:
//
//   BEFORE IT IS THEIR TURN THEY CAN STILL ANSWER, and the panel says who else
//   has to confirm rather than pretending nobody does.
//
//   THREE ANSWERS: yes, another time, no. Another time is the same form the
//   manager and the crew use, and it posts a real proposal.
//
//   ONCE THEY HAVE SAID YES, the question goes and who is left is named.
//
//   AND THE POPUP CARRIES THE SAME PANEL, rather than sending them to a
//   dashboard that has nothing on it.
//
//   node --no-warnings scripts/tenant-visit-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-tenantvisit-test");
const WEB = 5419, API = 9119;
const t = tally();

const dayKey = (n = 0) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const SOON = dayKey(2), LATER = dayKey(4);

const acct = {
  id: "acc_x", name: "Sound Property Management", subdomain: "x", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["windows_doors"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
};
const PROP = { id: "prop_1", accountId: "acc_x", name: "North Highland LLC", address: "4915 North Highland St",
  city: "Ruston", state: "WA", zip: "98407", units: 60, notes: "", ownedByAnother: false, ownerDeclared: false };
const USERS = [
  { id: "usr_t", name: "John Smith", email: "john@x.test", phone: null, role: "tenant",
    subId: null, propertyIds: ["prop_1"], unit: "53", hasLogin: true, inviteSentAt: null, hasAvatar: false },
];
const JOB = {
  id: "job_w", accountId: "acc_x", propertyId: "prop_1", title: "Bedrooom window frame seems to be bent",
  scope: "Window frame seems to be bent and won't close properly", trades: ["windows_doors"],
  status: "active", date: null, time: null, requestedBy: "usr_t", approvedAt: `${dayKey()} 09:00:00`,
  createdAt: `${dayKey()} 08:00:00`, photos: [], access: "tenant", accessEffective: "tenant",
  assignments: { windows_doors: { id: "WO-1", wo: "WO-1", subId: "cmp_pac", status: "accepted", auto: true } },
};
// The reported state: the crew put this window forward, so the hiring side
// answers next and the tenant is last.
const fresh = () => ({
  id: "v1", jobId: "job_w", date: SOON, startTime: "11:15", endTime: "12:15", status: "proposed",
  note: null, respondedAt: null, contractorAt: `${dayKey()}T10:00:00Z`, managerAt: null,
  parties: ["contractor", "manager", "tenant"], turn: "manager",
});
let VISIT = fresh();
const answers = [];
const proposals = [];
// 073. The Access panel's answer for this job, as the server shapes it for
// the tenant: their own number marked as theirs, and the crew that accepted.
const freshPlan = () => ({
  kind: "tenant", how: null, howFrom: null, live: true, migration: null, canEditHow: true,
  when: { date: SOON, startTime: "11:15", endTime: "12:15", status: "confirmed" },
  people: [
    { side: "tenant", firstName: "John", phone: "2065550111", you: true },
    { side: "crew", company: "Pacific apartment maintenance", firstName: "Juan", phone: "2065550122" },
  ],
});
let PLAN = freshPlan();
const hows = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct];
  if (path === "/api/account") return [200, acct];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/properties") return [200, [PROP]];
  if (path === "/api/jobs") return [200, [JOB]];
  if (path === "/api/visits") return [200, [VISIT]];
  if (/^\/api\/visits\/[^/]+\/respond$/.test(path) && method === "POST") {
    answers.push(body);
    VISIT = body.status === "declined"
      ? { ...VISIT, status: "declined", tenantNote: body.note || null, turn: null }
      : { ...VISIT, respondedAt: new Date().toISOString(), turn: "manager" };
    return [200, VISIT];
  }
  if (/^\/api\/jobs\/[^/]+\/visits$/.test(path) && method === "POST") {
    proposals.push(body);
    VISIT = { id: "v2", jobId: "job_w", date: body.date, startTime: body.startTime, endTime: body.endTime,
      status: "proposed", note: body.note || null, respondedAt: new Date().toISOString(),
      contractorAt: null, managerAt: null, parties: ["contractor", "manager", "tenant"], turn: "contractor" };
    return [201, VISIT];
  }
  if (path === "/api/jobs/job_w/access" && method === "GET") return [200, PLAN];
  if (path === "/api/jobs/job_w/access-how" && method === "PUT") {
    hows.push(body);
    PLAN = { ...PLAN, how: body.how, howFrom: "tenant" };
    return [200, PLAN];
  }
  if (path === "/api/my-manager") return [200, { company: "Sound Property Management", managers: [] }];
  if (path === "/api/notices") return [200, { notices: [] }];
  if (path === "/api/weather" || path === "/api/me/contact") return [200, {}];
  if (path === "/api/subs" || path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/clients") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const asTenant = async () => {
  const { ctx, page, crashes } = await visitApp(browser, { host: "x", webPort: WEB,
    seat: { userId: "usr_t", accountId: "acc_x" }, viewport: { width: 1100, height: 1600 } });
  await wait(2600);
  return { ctx, page, crashes };
};
// The panel on the report row (not the popup).
const panel = (page, scope = ".tn-row") => page.evaluate((sc) => {
  const p = document.querySelector(`${sc} .tn-visit`);
  if (!p) return null;
  return {
    text: p.innerText,
    btns: [...p.querySelectorAll(".vacts button")].map((b) => b.innerText.trim()),
    form: !!p.querySelector(".visit-form"),
  };
}, scope);
const press = (page, scope, re) => page.evaluate((sc, rs) => {
  const b = [...document.querySelectorAll(`${sc} .tn-visit button`)]
    .find((x) => new RegExp(rs).test(x.innerText.trim()));
  if (b) b.click();
  return !!b;
}, scope, re.source);
const chip = (page) => page.evaluate(() => document.querySelector(".tn-row .tn-chip")?.innerText.trim() || null);

try {
  console.log("\n-- before it is their turn --");
  {
    VISIT = fresh(); answers.length = 0;
    const { ctx, page, crashes } = await asTenant();
    const p = await panel(page);
    t.ck("the report row is there", !!(await chip(page)), String(await chip(page)));
    t.ck("there is something to press", (p?.btns || []).length === 3, JSON.stringify(p?.btns));
    t.ck("yes, another time, and no, in that order",
      JSON.stringify(p?.btns) === JSON.stringify(["Yes, that works", "Propose another time", "That doesn't work"]),
      JSON.stringify(p?.btns));
    // It says who else still has to agree, by name, rather than pretending the
    // tenant's yes books it.
    t.ck("and says the managing agent still has to confirm",
      /Sound Property Management still has to confirm it/.test(p?.text || ""), p?.text);
    t.ck("without calling it the hiring side", !/hiring side/i.test(p?.text || ""), p?.text);
    // The crew put this one forward, so the agent did not "propose" it.
    t.ck("and without claiming the agent proposed it", !/Management proposes/.test(p?.text || ""), p?.text);

    await press(page, ".tn-row", /^Yes, that works$/);
    await wait(700);
    t.ck("yes reaches the server, once", answers.length === 1 && answers[0].status === "confirmed",
      JSON.stringify(answers));
    const after = await panel(page);
    t.ck("then the question goes", !(after?.btns || []).includes("Yes, that works"), JSON.stringify(after?.btns));
    t.ck("and it says who is left", /You said[\s\S]*works/.test(after?.text || "")
      && /Waiting on Sound Property Management to confirm/.test(after?.text || ""), after?.text);
    t.ck("another time is still on offer", (after?.btns || []).includes("Propose another time"),
      JSON.stringify(after?.btns));
    t.ck("and the chip stops asking", (await chip(page)) === "Waiting on confirmation", String(await chip(page)));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- putting another time forward --");
  {
    VISIT = fresh(); proposals.length = 0;
    const { ctx, page } = await asTenant();
    await press(page, ".tn-row", /^Propose another time$/);
    await wait(400);
    const p = await panel(page);
    t.ck("it opens the same form the others use", p?.form === true, JSON.stringify(p));
    await page.evaluate((d) => {
      const inp = document.querySelector(".tn-row .visit-form input[type=date]");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(inp, d);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }, LATER);
    await wait(200);
    await page.evaluate(() => document.querySelector(".tn-row .visit-form .btn-solid")?.click());
    await wait(800);
    t.ck("and posts a real proposal", proposals.length === 1 && proposals[0].date === LATER,
      JSON.stringify(proposals));
    const after = await panel(page);
    t.ck("which then reads as theirs, waiting on the others",
      /You said[\s\S]*works/.test(after?.text || "") && /the contractor/.test(after?.text || ""), after?.text);
    await ctx.close();
  }

  console.log("\n-- saying no asks why --");
  {
    VISIT = fresh(); answers.length = 0;
    const { ctx, page } = await asTenant();
    await press(page, ".tn-row", /^That doesn't work$/);
    await wait(300);
    t.ck("nothing is sent by opening it", answers.length === 0, JSON.stringify(answers));
    await press(page, ".tn-row", /^Send/);
    await wait(700);
    t.ck("then it sends a decline", answers.length === 1 && answers[0].status === "declined", JSON.stringify(answers));
    await ctx.close();
  }

  console.log("\n-- the popup carries the same panel --");
  {
    VISIT = fresh();
    const { ctx, page } = await asTenant();
    await page.evaluate(() => document.querySelector(".tn-row .tn-row-open")?.click());
    await wait(600);
    const m = await panel(page, ".modal");
    t.ck("the popup opened", await page.evaluate(() => !!document.querySelector(".modal")));
    t.ck("and can be answered there", JSON.stringify(m?.btns)
      === JSON.stringify(["Yes, that works", "Propose another time", "That doesn't work"]), JSON.stringify(m?.btns));
    t.ck("rather than sending them to the dashboard",
      !(await page.evaluate(() => /confirm it on your dashboard/i.test(document.querySelector(".modal")?.innerText || ""))));
    await ctx.close();
  }
  console.log("\n-- who lets who in, and how to reach them --");
  {
    VISIT = fresh(); PLAN = freshPlan(); hows.length = 0;
    const { ctx, page, crashes } = await asTenant();
    const acc = (scope) => page.evaluate((sc) => {
      const p = document.querySelector(`${sc} .acc-panel`);
      if (!p) return null;
      return {
        text: p.innerText,
        tel: [...p.querySelectorAll("a[href^='tel:']")].map((a) => a.getAttribute("href")),
        sms: [...p.querySelectorAll("a[href^='sms:']")].map((a) => a.getAttribute("href")),
      };
    }, scope);
    const a = await acc(".tn-row");
    t.ck("the report row carries an Access panel", !!a, String(a));
    t.ck("which says who lets who in, from the tenant's side",
      /You let Pacific apartment maintenance in\./.test(a?.text || ""), a?.text);
    t.ck("names the crew by first name, with their mobile",
      /Juan/.test(a?.text || "") && /\(206\)555-0122/.test(a?.text || ""), a?.text);
    t.ck("one tap to call them and one to text",
      JSON.stringify(a?.tel) === JSON.stringify(["tel:2065550122"])
      && JSON.stringify(a?.sms) === JSON.stringify(["sms:2065550122"]), JSON.stringify(a));
    t.ck("and shows the tenant their own number as the one the crew has",
      /\(206\)555-0111/.test(a?.text || "") && /You/.test(a?.text || ""), a?.text);
    t.ck("with no call button on their own number", !(a?.tel || []).includes("tel:2065550111"));

    await page.evaluate(() => [...document.querySelectorAll(".tn-row .acc-change")][0]?.click());
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".tn-row .acc-preset")]
      .find((b) => /garage/.test(b.innerText))?.click());
    await wait(200);
    await page.evaluate(() => [...document.querySelectorAll(".tn-row .acc-edit button")]
      .find((b) => /^Save$/.test(b.innerText.trim()))?.click());
    await wait(700);
    t.ck("saying which door reaches the server", hows.length === 1
      && hows[0].how === "The tenant will open the garage door", JSON.stringify(hows));
    const after = await acc(".tn-row");
    t.ck("and the panel then says it", /The tenant will open the garage door/.test(after?.text || ""), after?.text);

    await page.evaluate(() => document.querySelector(".tn-row .tn-row-open")?.click());
    await wait(600);
    const m = await acc(".modal");
    t.ck("the popup carries the same panel", /You let Pacific apartment maintenance in\./.test(m?.text || ""), m?.text);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
