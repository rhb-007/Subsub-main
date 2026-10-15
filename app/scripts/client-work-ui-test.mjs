// WORK A CLIENT GAVE US IS ON OUR OWN DASHBOARD AND JOBS SCREEN, AND IT IS
// ANSWERED THERE.
//
// Reported from Cascade Apartment Services: Sound Property Management assigned
// them a tenant's job -- "Paint is peeling off the ceiling in both of the
// bathrooms" -- and it was on neither Cascade's Dashboard nor their Jobs
// screen. Where it did appear (My Jobs) the only move was "Go to Sound", which
// needs a seat on Sound. And "assigned, time to be arranged" looked the same as
// "scheduled", so nobody could tell what was waiting on them.
//
// What is pinned:
//
//   THE PANEL IS ON BOTH SCREENS, and leads with what is waiting: an offer to
//   answer and work taken with no time on it, each with a pulsing dot.
//
//   ASSIGNED-NO-TIME HAS ITS OWN COLOUR, distinct from the waiting amber and
//   the booked green.
//
//   THE ANSWERS GO THROUGH OUR OWN ACCOUNT: Accept and Propose a time reach
//   /api/my-work/:woId/*, never a "go there" door.
//
//   AND A PROPERTY MANAGER, which has no company to be given work as, gets no
//   panel -- asserted after the dashboard is shown to have rendered.
//
//   node --no-warnings scripts/client-work-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-clientwork-test");
const WEB = 5481, API = 9181;
const t = tally();

const DAY = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

let KIND = "subcontractor";
const acct = () => ({
  id: "acc_cas", name: "Cascade Apartment Services", subdomain: "cascade",
  kind: KIND, plan: "basic", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["painting"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_ric", name: "Ricard Brando", email: "rbraun@cascade.test", role: "admin" },
});
const MY_COMPANY = {
  companyId: "cmp_cas", company: "Cascade Apartment Services", contact: "Ricard Brando",
  email: "rbraun@cascade.test", phone: "2067778888", license: "CASCAAS881QT", ubi: "",
  city: "Seattle", state: "WA", zip: "98122",
  coverage: { mode: "cities", cities: ["Seattle"], radii: [] },
  docs: { insurance: true, bond: true, contract: true, w9: true },
  findable: true, code: "cmp_own_acc_cas", openToHire: true, openAnswered: true,
  url: null, sharesSent: 0,
};
const base = (o) => ({
  wo: "WO-1", trade: "painting", auto: false, responseWindow: null, respondBy: null,
  respondedAt: null, crewName: null, value: "400", payKind: "fixed", rate: "", capHours: null,
  tradeScope: null, signedWO: null, here: false,
  accountId: "acc_pm", accountName: "Sound Property Management", accountKind: "property_manager",
  address: "1620 Belmont Ave", area: "Seattle", zip: "98122", date: null, jobStatus: "active",
  severity: null, access: "tenant", visit: null, ...o,
});
const WORK = () => [
  // Accepted, no time: nobody is coming until Cascade says when.
  base({ woId: "wo_paint", wo: "WO-1", jobId: "job_paint", status: "accepted", respondedAt: "2026-10-10",
    title: "Paint is peeling off of the ceiling in both of the bathrooms" }),
  // An offer still open.
  base({ woId: "wo_gate", wo: "WO-2", jobId: "job_gate", status: "pending",
    respondBy: new Date(Date.now() + 20 * 3600e3).toISOString(), title: "Fix the side gate latch" }),
  // Booked: nothing to do.
  base({ woId: "wo_booked", wo: "WO-3", jobId: "job_booked", status: "accepted", respondedAt: "2026-10-02",
    title: "Patch the hallway drywall", date: DAY(6),
    visit: { id: "v_b", jobId: "job_booked", status: "confirmed", date: DAY(6), startTime: "09:00",
      endTime: "11:00", contractorAt: "2026-10-03", note: "" } }),
];

const posts = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (method === "POST" && path.startsWith("/api/my-work/")) {
    posts.push({ path, body: typeof body === "string" ? JSON.parse(body || "{}") : body });
    if (path.endsWith("/visits")) return [201, { id: "v_new", status: "proposed", date: DAY(3) }];
    return [200, { ok: true }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/my-company") {
    return KIND === "subcontractor" ? [200, MY_COMPANY] : [409, { error: "not_hireable" }];
  }
  if (path === "/api/my-work") return [200, { work: KIND === "subcontractor" ? WORK() : [] }];
  if (path === "/api/account-users") return [200, [
    { id: "u_ric", name: "Ricard Brando", email: "rbraun@cascade.test", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/jobs" || path === "/api/subs" || path === "/api/properties"
    || path === "/api/invites" || path === "/api/clients" || path === "/api/visits"
    || path === "/api/my-connect-requests" || path === "/api/connect-requests"
    || path === "/api/property-transfers" || path === "/api/my-quotes"
    || path === "/api/doc-shares" || path === "/api/inspections"
    || path === "/api/change-orders") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openNav = async (page, label) => {
  await page.evaluate((l) => [...document.querySelectorAll("nav button")]
    .find((b) => b.innerText.trim().toUpperCase().startsWith(l.toUpperCase()))?.click(), label);
  await wait(1200);
};
const panel = (page) => page.evaluate(() => {
  const p = document.querySelector(".sec-cw");
  if (!p) return null;
  const lines = [...p.querySelectorAll(".jr-card")].map((c) => ({
    title: c.querySelector(".jl-title")?.innerText || "",
    flag: c.querySelector(".jl-flag")?.innerText || "",
    tone: (c.querySelector(".jl-flag")?.className || "").replace("jl-flag", "").trim(),
    dot: !!c.querySelector(".jl-flag .act-dot"),
    bg: c.querySelector(".jl-flag") ? getComputedStyle(c.querySelector(".jl-flag")).backgroundColor : "",
  }));
  const dot = p.querySelector("h3 .act-dot");
  return { head: p.querySelector("h3")?.innerText || "", lines,
    headDot: !!dot, anim: dot ? getComputedStyle(dot, "::after").animationName : "",
    more: p.querySelector(".dash-more")?.innerText || "" };
});

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "cascade", webPort: WEB,
    seat: { userId: "u_ric", accountId: "acc_cas" }, viewport: { width: 1340, height: 2000 } });
  const logs = [];
  page.on("pageerror", (e) => logs.push("THROW " + String(e).slice(0, 200)));
  await wait(2800);

  console.log("\n-- the Dashboard --");
  const d = await panel(page);
  t.ck("a Work from your clients panel is on the dashboard", !!d, JSON.stringify(d));
  t.ck("headed as waiting on them, with the count", /2 waiting on you/i.test(d?.head || ""), d?.head);
  t.ck("with a pulsing dot on the heading", d?.headDot === true && d?.anim === "act-pulse", JSON.stringify(d));
  const paint = d?.lines.find((l) => /Paint is peeling/.test(l.title));
  const gate = d?.lines.find((l) => /side gate/.test(l.title));
  t.ck("Sound's paint job is on it", !!paint, JSON.stringify(d?.lines));
  t.ck("flagged Set a time, in the arrange tone, with a dot", paint && /Set a time/.test(paint.flag)
    && /jl-arrange/.test(paint.tone) && paint.dot, JSON.stringify(paint));
  t.ck("and the offer is on it too, flagged Reply with a dot", gate && /Reply/.test(gate.flag) && gate.dot, JSON.stringify(gate));
  t.ck("the offer comes before the unscheduled job", d && d.lines.indexOf(gate) < d.lines.indexOf(paint));
  t.ck("work already booked is not listed as waiting",
    !d?.lines.some((l) => /hallway drywall/.test(l.title)), JSON.stringify(d?.lines));
  t.ck("and the panel says how to see it", /1 more booked/.test(d?.more || ""), d?.more);
  // The colour: violet, not the amber that means "waiting" or the green that means booked.
  t.ck("assigned-no-time is violet, not the waiting amber",
    paint?.bg === "rgb(239, 233, 251)" && gate?.bg !== paint?.bg, `${paint?.bg} vs ${gate?.bg}`);

  console.log("\n-- answering from here --");
  await page.evaluate(() => [...document.querySelectorAll(".sec-cw .jr-card")]
    .find((c) => /side gate/.test(c.innerText))?.querySelector(".jl-btn")?.click());
  await wait(500);
  const offer = await page.evaluate(() => {
    const m = document.querySelector(".modal .jr-card");
    return { accept: !!m?.querySelector(".resp.accept"), goto: !!m?.querySelector(".resp.go"),
      client: m?.querySelector(".jr-client")?.innerText || "" };
  });
  t.ck("the offer opens with Accept, not a Go to Sound door", offer.accept && !offer.goto, JSON.stringify(offer));
  t.ck("and still says whose job it is", /Sound Property Management/.test(offer.client), offer.client);
  await page.evaluate(() => document.querySelector(".modal .resp.accept")?.click());
  await wait(700);
  t.ck("Accept goes through our own account",
    posts.some((p) => p.path === "/api/my-work/wo_gate/respond" && p.body?.status === "accepted"),
    JSON.stringify(posts));

  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => document.querySelector(".modal-backdrop")?.click());
  await wait(400);
  await page.evaluate(() => [...document.querySelectorAll(".sec-cw .jr-card")]
    .find((c) => /Paint is peeling/.test(c.innerText))?.querySelector(".jl-btn")?.click());
  await wait(500);
  const arr = await page.evaluate(() => {
    const m = document.querySelector(".modal .jr-card");
    return { head: m?.querySelector(".jr-notime .vans-head")?.innerText || "",
      q: m?.querySelector(".jr-notime .vans-q")?.innerText || "",
      btn: [...(m?.querySelectorAll(".jr-notime button") || [])].map((b) => b.innerText) };
  });
  t.ck("the unscheduled job says it is assigned with a time to be arranged",
    /Assigned — time to be arranged/.test(arr.head), JSON.stringify(arr));
  t.ck("and names who is waiting", /Sound Property Management is waiting on you/.test(arr.q), arr.q);
  t.ck("with Propose a time on it", arr.btn.some((b) => /Propose a time/.test(b)), JSON.stringify(arr.btn));
  await page.evaluate(() => [...document.querySelectorAll(".modal .jr-notime button")]
    .find((b) => /Propose a time/.test(b.innerText))?.click());
  await wait(500);
  const day = DAY(3);
  await page.evaluate((dd) => {
    const set = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      d.set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const ms = [...document.querySelectorAll(".modal")];
    const m = ms[ms.length - 1];
    set(m.querySelector("input[type=date]"), dd);
    set(m.querySelectorAll("input[type=time]")[0], "09:00");
  }, day);
  await wait(200);
  await page.evaluate(() => {
    const ms = [...document.querySelectorAll(".modal")];
    [...ms[ms.length - 1].querySelectorAll("button.btn-solid")].pop()?.click();
  });
  await wait(800);
  const prop = posts.find((p) => p.path === "/api/my-work/wo_paint/visits");
  t.ck("Propose a time goes through our own account", !!prop && prop.body?.date === day, JSON.stringify(posts));
  t.ck("and nothing tried Sound's own routes", !posts.some((p) => !p.path.startsWith("/api/my-work/")));

  await page.reload(); await wait(2600);
  console.log("\n-- the Jobs screen --");
  await openNav(page, "Jobs");
  const j = await panel(page);
  t.ck("the same panel is on the Jobs screen", !!j && /waiting on you/i.test(j.head), JSON.stringify(j));

  console.log("\n-- My Jobs --");
  await openNav(page, "My Jobs");
  const mj = await page.evaluate(() => {
    const s = [...document.querySelectorAll(".dash-sec.sec-yt")].find((x) => /Waiting on you/i.test(x.innerText));
    return { head: s?.querySelector("h3")?.innerText || "",
      titles: s ? [...s.querySelectorAll(".jl-title")].map((x) => x.innerText) : [] };
  });
  t.ck("My Jobs lists the unscheduled job under Waiting on you",
    mj.titles.some((x) => /Paint is peeling/.test(x)), JSON.stringify(mj));
  t.ck("headed as setting a time", /set a time/i.test(mj.head), mj.head);
  const navCount = await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^My Jobs/.test(b.innerText.trim()))?.innerText.replace(/\s+/g, " ") || "");
  t.ck("the My Jobs nav entry counts both things waiting", /My Jobs\s*2/.test(navCount), navCount);

  t.ck("nothing threw", logs.length === 0 && crashes.length === 0, [...logs, ...crashes].join(" | "));
  await ctx.close().catch(() => {});

  console.log("\n-- a property manager has no company, so no panel --");
  KIND = "property_manager";
  const pm = await visitApp(browser, { host: "cascade", webPort: WEB,
    seat: { userId: "u_ric", accountId: "acc_cas" }, viewport: { width: 1340, height: 1600 } });
  await wait(2600);
  const pmv = await pm.page.evaluate(() => ({
    hello: !!document.querySelector(".ss-main .dash-hello"),
    panel: !!document.querySelector(".sec-cw"),
  }));
  t.ck("the dashboard rendered", pmv.hello, JSON.stringify(pmv));
  t.ck("and carries no client-work panel", pmv.hello && !pmv.panel, JSON.stringify(pmv));
  await pm.ctx.close().catch(() => {});
} catch (e) {
  t.ck("the suite ran without throwing", false, e?.stack || String(e));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
