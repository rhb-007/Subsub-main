// The screen where a CRM's words become trades.
//
// The routes and the rules shipped before this did, so the whole feature was
// the shape this product keeps producing and refusing: correct pieces with no
// way in. Rules could only be created by API, which for the person who runs a
// roofing company means not at all.
//
// What this covers:
//
//   THE WORK QUEUE COMES FIRST. A job whose words map to nothing still
//   arrives, so the account has jobs it cannot assign and one unanswered
//   word explaining all of them. That is the only part of this screen with
//   anything to DO in it, so it is above the rules rather than below them.
//
//   AND IT SAYS THE JOBS ARE SAFE. "These meant nothing to SubSub" reads as
//   "they were rejected" unless the screen says otherwise, and somebody who
//   believes that goes looking in their CRM instead of on their Jobs screen.
//
//   A PROJECT MANAGER SEES IT. `/api/crm-rules` is requireRole("admin","pm")
//   and a screen stricter than its route is the same lie as a looser one.
//
//   ANSWERING ONE CLEARS IT, so the queue keeps meaning "still to do".
//
//   node scripts/crm-map-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-crmmap-test");
const WEB = 5273, API = 8973;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

let ROLE = "admin";
let PLAN = "scale";
let RULES = { rules: [], unmapped: [] };
const saved = [];
const removed = [];

const ACCOUNT = () => ({
  id: "acc_gc", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: PLAN, billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["roofing"], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_rae", name: "Rae", email: "rae@outerhome.test", role: ROLE },
});

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT()];
  if (path === "/api/account") return [200, ACCOUNT()];
  if (path === "/api/crm-rules" && method === "POST") {
    saved.push(body);
    // The server clears an answered word from the queue; the stub does the
    // same, or the test would prove nothing about the screen reloading.
    RULES = {
      rules: [...RULES.rules, { id: `r${saved.length}`, source: "jobnimbus",
        match: body.match, value: body.value, trades: body.trades }],
      unmapped: RULES.unmapped.filter((u) =>
        !(u.match === body.match && u.value.toLowerCase() === String(body.value).toLowerCase())),
    };
    return [200, { ok: true }];
  }
  if (path.startsWith("/api/crm-rules/") && method === "DELETE") {
    removed.push(path.split("/").pop());
    RULES = { ...RULES, rules: RULES.rules.filter((r) => r.id !== removed[removed.length - 1]) };
    return [200, { ok: true }];
  }
  if (path === "/api/crm-rules") return [200, RULES];
  if (path === "/api/api-tokens") return [200, []];
  if (path === "/api/my-company") return [200, { companyId: "cmp_own_acc_gc", company: "Outerhome",
    contact: "Rae", email: "rae@outerhome.test", docs: {}, sharesSent: 0, openToHire: true }];
  if (path === "/api/subs") return [200, []];
  if (path === "/api/jobs") return [200, []];
  if (path === "/api/weather") return [200, {}];
  if (path === "/api/account-users") return [200, [
    { id: "u_rae", name: "Rae", email: "rae@outerhome.test", phone: null, role: ROLE,
      subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  return undefined;
} });

const browser = await launch();

// Opens Account -> Profile, where the panel lives beside the API token.
const openPanel = async () => {
  const r = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "u_rae", accountId: "acc_gc" }, viewport: { width: 1200, height: 1600 } });
  await r.page.evaluate(() => document.querySelector(".um-chip, .user-chip, header .avatar")?.click());
  await wait(400);
  await r.page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^My account$/i.test(b.innerText.trim()))?.click());
  for (let n = 0; n < 40; n++) {
    await wait(200);
    if (await r.page.$(".seg-tabs, nav.tabs")) break;
  }
  await r.page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => b.innerText.trim() === "Profile")?.click());
  for (let n = 0; n < 40; n++) { await wait(200); if (await r.page.$(".crm-list, .crm-add, .portal-panel")) break; }
  await wait(600);
  return r;
};

const panelOf = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll(".portal-panel")]
    .find((p) => /What your CRM calls things/i.test(p.textContent || ""));
  return el ? {
    text: el.innerText.replace(/\s+/g, " ").trim(),
    gaps: [...el.querySelectorAll(".crm-row.gap")].map((r) => r.innerText.replace(/\s+/g, " ").trim()),
    rows: [...el.querySelectorAll(".crm-row")].map((r) => r.innerText.replace(/\s+/g, " ").trim()),
    // Where the queue sits relative to the rules, measured rather than assumed.
    gapY: el.querySelector(".crm-row.gap")?.getBoundingClientRect().top ?? null,
    ruleY: [...el.querySelectorAll(".crm-row:not(.gap)")][0]?.getBoundingClientRect().top ?? null,
  } : null;
});

try {
  console.log("\n-- with nothing set up, it says what it is for --");
  {
    RULES = { rules: [], unmapped: [] };
    const { ctx, page, crashes } = await openPanel();
    const p = await panelOf(page);
    t.ck("the panel is there", !!p, String(p));
    t.ck("and there is one of it",
      await page.evaluate(() => [...document.querySelectorAll(".portal-panel")]
        .filter((x) => /What your CRM calls things/i.test(x.textContent || "")).length) === 1);
    t.ck("it explains what a rule does", /say once what each one means/i.test(p.text), p.text.slice(0, 120));
    t.ck("and does not pretend there is work to do", !/Waiting on you/i.test(p.text));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- an unanswered word is the first thing on the screen --");
  {
    RULES = { rules: [{ id: "r0", source: "jobnimbus", match: "type", value: "Roof Replacement", trades: ["roofing"] }],
      unmapped: [{ id: "g1", source: "jobnimbus", match: "type", value: "Siding Job", hits: 3, lastSeen: "2026-09-28" }] };
    const { ctx, page, crashes } = await openPanel();
    const p = await panelOf(page);
    t.ck("the queue is shown", p.gaps.length === 1, JSON.stringify(p.gaps));
    t.ck("naming the word", /Siding Job/.test(p.gaps[0]), p.gaps[0]);
    // A count is what makes it worth answering: one job is a curiosity,
    // three is a pattern.
    t.ck("and how many jobs it has cost", /3 jobs/.test(p.gaps[0]), p.gaps[0]);
    t.ck("it is headed as waiting on them", /waiting on you \(1\)/i.test(p.text), p.text.slice(0, 200));

    // ABOVE the rules, because it is the only part with anything to do in it.
    t.ck("and it sits ABOVE the rules list",
      p.gapY !== null && p.ruleY !== null && p.gapY < p.ruleY, `${p.gapY} vs ${p.ruleY}`);

    // "meant nothing to SubSub" reads as "rejected" unless the screen says
    // otherwise, and somebody who believes that goes hunting in their CRM.
    t.ck("it says the jobs are safe", /jobs are safe/i.test(p.text), p.text);
    t.ck("and where they are", /Jobs screen/i.test(p.text), p.text);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("-- and answering it takes one tap --");
  {
    RULES = { rules: [], unmapped: [{ id: "g1", source: "jobnimbus", match: "type", value: "Siding Job", hits: 3 }] };
    saved.length = 0;
    const { ctx, page, crashes } = await openPanel();
    await page.evaluate(() => [...document.querySelectorAll(".crm-row.gap button")]
      .find((b) => /What is it/i.test(b.innerText))?.click());
    await wait(400);
    t.ck("a trade picker opens", await page.evaluate(() => !!document.querySelector(".crm-pick")));

    // Dead until something is picked, and it says why -- a disabled control
    // with no reason beside it is indistinguishable from a broken one.
    const before = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".crm-pick button")].find((x) => /means this/i.test(x.innerText));
      return { disabled: b?.disabled, hint: document.querySelector(".crm-pick .cov-hint")?.innerText || "" };
    });
    t.ck("saving is held until a trade is picked", before.disabled === true, String(before.disabled));
    t.ck("and it says so", /at least one trade/i.test(before.hint), before.hint);

    await page.evaluate(() => [...document.querySelectorAll(".crm-pick .pick")]
      .find((b) => /^Siding$/i.test(b.innerText.trim()))?.click());
    await wait(200);
    await page.evaluate(() => [...document.querySelectorAll(".crm-pick button")]
      .find((x) => /means this/i.test(x.innerText))?.click());
    for (let n = 0; n < 30 && !saved.length; n++) await wait(150);

    t.ck("it saves", saved.length === 1, JSON.stringify(saved));
    t.ck("on the field it arrived on", saved[0]?.match === "type", JSON.stringify(saved[0]));
    t.ck("with their exact word", saved[0]?.value === "Siding Job", JSON.stringify(saved[0]));
    t.ck("and the trade picked", (saved[0]?.trades || []).join(",") === "siding", JSON.stringify(saved[0]));

    await wait(700);
    const after = await panelOf(page);
    // Leaving an answered word in the queue is how a queue stops meaning
    // "still to do".
    t.ck("and it leaves the queue", after.gaps.length === 0, JSON.stringify(after.gaps));
    t.ck("appearing as a rule instead", after.rows.some((r) => /Siding Job/.test(r)),
      JSON.stringify(after.rows));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a rule can be added without waiting for a job --");
  {
    RULES = { rules: [], unmapped: [] };
    saved.length = 0;
    const { ctx, page, crashes } = await openPanel();
    await page.evaluate(() => [...document.querySelectorAll(".portal-panel button")]
      .find((b) => /Add a rule/i.test(b.innerText))?.click());
    await wait(300);
    t.ck("the form opens", await page.evaluate(() => !!document.querySelector(".crm-add")));
    // Whole-value matching is surprising unless said, because somebody typing
    // "Roof" expects it to catch "Roof Replacement".
    t.ck("and warns that matching is whole-value",
      await page.evaluate(() => /will not match/i.test(document.querySelector(".crm-add")?.innerText || "")));

    await page.evaluate(() => {
      const i = document.querySelector(".crm-add input");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(i, "Gutter Only");
      i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".crm-pick .pick")]
      .find((b) => /^Gutters$/i.test(b.innerText.trim()))?.click());
    await wait(150);
    await page.evaluate(() => [...document.querySelectorAll(".crm-pick button")]
      .find((x) => /Save rule/i.test(x.innerText))?.click());
    for (let n = 0; n < 30 && !saved.length; n++) await wait(150);
    t.ck("it saves", saved.length === 1 && saved[0].value === "Gutter Only", JSON.stringify(saved));
    t.ck("with the trade", (saved[0]?.trades || []).join(",") === "gutters", JSON.stringify(saved[0]));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a project manager gets the same screen --");
  {
    // /api/crm-rules is requireRole("admin","pm"). Hiding this from a pm
    // would make the screen stricter than the route.
    ROLE = "pm";
    RULES = { rules: [], unmapped: [{ id: "g1", source: "jobnimbus", match: "tag", value: "steep", hits: 1 }] };
    const { ctx, page, crashes } = await openPanel();
    const p = await panelOf(page);
    t.ck("a project manager sees the panel", !!p, String(p));
    t.ck("and the queue on it", (p?.gaps || []).length === 1, JSON.stringify(p?.gaps));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
    ROLE = "admin";
  }

  console.log("\n-- and nothing renders as an escape --");
  {
    RULES = { rules: [{ id: "r0", source: "jobnimbus", match: "type", value: "Roof Replacement", trades: ["roofing", "gutters"] }],
      unmapped: [{ id: "g1", source: "jobnimbus", match: "status", value: "Approved", hits: 2 }] };
    const { ctx, page, crashes } = await openPanel();
    // A \uXXXX in JSX text is six literal characters, and it has shipped twice.
    t.ck("no \\uXXXX survives into the page",
      await page.evaluate(() => !/\\u[0-9a-fA-F]{4}/.test(document.body.innerText)));
    const p = await panelOf(page);
    t.ck("a rule reads as their word to our trades",
      /Roof Replacement/.test(p.text) && /Roofing/.test(p.text) && /Gutters/.test(p.text), p.text);
    // Which field it matched on, or the same word on two fields is one row
    // somebody cannot tell apart.
    t.ck("and names the field it matches on", /Job type/i.test(p.text), p.text);
    t.ck("the queue names its field too", /Status/i.test(p.text), p.text);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close(); web.close(); api.close();
}

t.done();
