// The console's Revenue chart and Health lights, in a real browser.
//
// Asked for as: the MRR-by-month table should be a revenue graph; the API
// integrations on Health should be thin bars that open when needed; and three
// boxes with a green, yellow or red light for admin., api. and app.subsub.work.
// Measured, because a bar that exists in the markup can still be drawn at zero.
//
//   node scripts/console-revhealth-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-console-revhealth-test");
const WEB = 5381, API = 9081;
const t = tally();

console.log("\n-- building the console --");
buildApp({ outDir: OUT, apiPort: API, platform: true });

const now = new Date();
const THIS_MONTH = now.toISOString().slice(0, 7);
const acct = (id, name, kind, plan, extra = {}) => ({ id, name, subdomain: id, kind, plan,
  billing: "monthly", comped: false, compNote: null, trades: [], hostnameStatus: "active",
  subscriptionStatus: plan === "scale" ? "active" : null, createdAt: "2026-01-04", status: "active",
  lastActive: "2026-10-05", ...extra });

// Events in February, March and May, with April deliberately silent: a month
// nothing happened in still happened, and the chart must draw it.
const BOOT = {
  accounts: [
    acct("acc_gc", "Outerhome", "general_contractor", "scale"),
    acct("acc_pm", "Sound Property Management", "property_manager", "scale"),
    acct("acc_b", "Harbor Portfolio", "portfolio_manager", "basic"),
  ],
  users: [{ id: "u1", createdAt: "2026-01-04", name: "Rae", email: "r@x.test", phone: null }],
  memberships: [{ userId: "u1", accountId: "acc_gc", role: "admin", companyId: null }],
  companies: [], engagements: [], jobs: [], activity: [], smsDaily: [],
  subEvents: [
    { id: "e0", accountId: "acc_gc", kind: "created", at: "2026-02-02T09:00:00Z", mrrDelta: 0 },
    { id: "e1", accountId: "acc_gc", kind: "upgraded", fromPlan: "basic", at: "2026-02-03T09:00:00Z", mrrDelta: 9900 },
    { id: "e2", accountId: "acc_pm", kind: "upgraded", fromPlan: "basic", at: "2026-03-01T09:00:00Z", mrrDelta: 9900 },
    { id: "e3", accountId: "acc_b", kind: "upgraded", fromPlan: "basic", at: "2026-03-05T09:00:00Z", mrrDelta: 9900 },
    { id: "e4", accountId: "acc_b", kind: "downgraded", at: "2026-05-10T09:00:00Z", mrrDelta: -9900 },
    // One upgrade on the 1st of THIS month, so the headline has growth to
    // report: $198 at the start of the month, $297 now, +$99 (+50%).
    { id: "e5", accountId: "acc_b", kind: "upgraded", fromPlan: "basic", at: THIS_MONTH + "-01T00:00:00Z", mrrDelta: 9900 },
  ],
};
const monthsBetween = (a, b) => {
  const [ay, am] = a.split("-").map(Number), [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
};
const EXPECT_MONTHS = Math.min(12, monthsBetween("2026-02", THIS_MONTH));

const SETUP = {
  groups: [
    { id: "auth", label: "Customer sign-in (Supabase)", state: "ok", matters: "m",
      vars: [{ name: "SUPABASE_URL", set: true }, { name: "SUPABASE_ANON_KEY", set: true }] },
    { id: "mail", label: "Email (Resend)", state: "partial", matters: "Mail matters.",
      vars: [{ name: "RESEND_API_KEY", set: false, suggestion: { name: "RESEND_APIKEY" } }, { name: "MAIL_FROM", set: true }] },
    { id: "sms", label: "Text messages (Twilio)", state: "off", matters: "Texts matter.",
      vars: [{ name: "TWILIO_SID", set: false }] },
  ],
  unused: [],
};
let HEALTH = {
  checkedAt: new Date().toISOString(),
  hosts: [
    { id: "admin", host: "admin.subsub.work", label: "Staff console", light: "green", say: "Answered in 80 ms.", status: 302, ms: 80 },
    { id: "api", host: "api.subsub.work", label: "API", light: "amber", say: "Answered in 2.1 seconds, which is slow.", status: 200, ms: 2100,
      db: { ok: true, ms: 4 } },
    { id: "app", host: "app.subsub.work", label: "Customer app", light: "red", say: "Answered with an error (502).", status: 502, ms: 40 },
  ],
};
let healthFails = false;
// Supabase works, Resend's half configured (red by the settings alone), and
// Twilio is not set up (grey). Added: Stripe on a TEST key (amber).
SETUP.groups.push({ id: "billing", label: "Billing (Stripe)", state: "ok", matters: "b",
  vars: [{ name: "STRIPE_SECRET_KEY", set: true }] });
SETUP.groups.push({ id: "cron", label: "Scheduled jobs", state: "ok", matters: "c",
  vars: [{ name: "CRON_SECRET", set: true }] });
const INTEGRATIONS = { checkedAt: new Date().toISOString(), probes: {
  auth: { ms: 120, say: "Supabase answered and accepted the key." },
  billing: { warn: true, ms: 200, say: "Stripe accepted the key, but it is a TEST-mode key: no real payment can be taken." },
} };
let healthAsks = 0;

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path === "/api/platform/me") return [200, { userId: "u_staff", name: "Staff", email: "s@subsub.test",
    role: "superadmin", finance: true, impersonate: true }];
  if (path === "/api/platform/bootstrap") return [200, BOOT];
  if (path === "/api/platform/companies") return [200, []];
  if (path === "/api/platform/stuck-subs") return [200, { mailConfigured: true, rows: [], summary: { total: 0 } }];
  if (path === "/api/platform/setup-check") return [200, SETUP];
  if (path === "/api/platform/integration-health") return [200, INTEGRATIONS];
  if (path === "/api/platform/system-health") {
    healthAsks++;
    return healthFails ? [502, { error: "bad_gateway" }] : [200, HEALTH];
  }
  if (path.startsWith("/api/platform/activity/")) return [200, []];
  if (path === "/api/notify/log") return [200, []];
  return undefined;
} });

const browser = await launch();
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 1280, height: 1400 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));
const nav = (label) => page.evaluate((l) => [...document.querySelectorAll(".pf-nav button")]
  .find((b) => b.innerText.trim() === l)?.click(), label);

try {
  await page.goto(`http://127.0.0.1:${WEB}/`, { waitUntil: "domcontentloaded" });
  await wait(2600);
  const gotIn = await page.evaluate(() => !!document.querySelector(".pf-main"));
  t.ck("the console loaded past its sign-in", gotIn);
  if (!gotIn) throw new Error("console never opened");

  console.log("\n-- Revenue: a headline, then one chart at a time --");
  await nav("Revenue");
  await wait(500);
  const rev = () => page.evaluate(() => {
    const p = document.querySelector(".pf-mrr");
    if (!p) return null;
    const box = (el) => { const r = el.getBoundingClientRect(); return { h: r.height, top: r.top, bottom: r.bottom }; };
    return {
      title: p.querySelector("h3")?.innerText.trim(),
      svgs: p.querySelectorAll("svg").length,
      view: p.querySelector("svg")?.dataset.view,
      tabs: [...p.querySelectorAll(".pf-mrr-tabs [role=tab]")].map((b) => ({ id: b.dataset.view, on: b.getAttribute("aria-selected") === "true" })),
      now: p.querySelector(".pf-mrr-now")?.innerText.trim(),
      hero: p.querySelector(".pf-mrr-hero")?.innerText.replace(/\s+/g, " "),
      delta: p.querySelector(".pf-mrr-delta")?.innerText.replace(/\s+/g, " "),
      deltaCls: p.querySelector(".pf-mrr-delta")?.className,
      bars: [...p.querySelectorAll(".pf-mrr-bar")].map((r) => ({ m: r.dataset.month, ...box(r) })),
      nets: [...p.querySelectorAll(".pf-mrr-net-bar")].map((r) => ({ m: r.dataset.month, v: Number(r.dataset.value), cls: r.getAttribute("class"), ...box(r) })),
      zeroY: (() => { const l = [...p.querySelectorAll("svg line")].find((x) => x.getAttribute("opacity") === "0.5"); return l ? l.getBoundingClientRect().top : null; })(),
      vals: [...p.querySelectorAll(".pf-mrr-val")].map((t) => t.textContent),
      parts: Object.fromEntries([...p.querySelectorAll(".pf-mrr-break li")].map((li) => [li.dataset.part, li.querySelector("b")?.innerText.trim()])),
      breakHd: p.querySelector(".pf-mrr-break-hd")?.innerText.trim(),
      table: !!p.querySelector("table"),
      oldTwoPlots: !!p.querySelector(".pf-mrr-move, .pf-mrr-end"),
      tip: document.querySelector(".pf-mrr-tip")?.innerText.replace(/\s+/g, " "),
    };
  });
  let r = await rev();
  t.ck("the panel is there, called what it is", r?.title === "Recurring revenue", r?.title);
  t.ck("ONE chart on screen, not two stacked plots", r?.svgs === 1 && !r.oldTwoPlots, JSON.stringify({ svgs: r?.svgs, old: r?.oldTwoPlots }));
  t.ck("two tabs, Revenue chosen first", JSON.stringify(r?.tabs) === JSON.stringify([{ id: "revenue", on: true }, { id: "growth", on: false }]),
    JSON.stringify(r?.tabs));
  t.ck("the headline says MRR now", r?.now === "$297", r?.now);
  t.ck("and what that is a year", /\$3,564 a year/.test(r?.hero || ""), r?.hero);
  t.ck("and this month's growth in money and percent", /\+\$99/.test(r?.delta || "") && /\(\+50%\)/.test(r?.delta || ""), r?.delta);
  t.ck("growth is drawn as growth", /t-up/.test(r?.deltaCls || ""), r?.deltaCls);
  t.ck("from what it started the month at", /from \$198 at the start of the month/.test(r?.hero || ""), r?.hero);

  t.ck(`one MRR bar per month, quiet months included (${EXPECT_MONTHS})`, r?.bars.length === EXPECT_MONTHS,
    JSON.stringify(r?.bars.map((e) => e.m)));
  t.ck("April, which had no events, is on the axis", r?.bars.some((e) => e.m === "2026-04"));
  const bar = (m) => r?.bars.find((e) => e.m === m)?.h || 0;
  t.ck("drawn to scale: March ($297) is three times February ($99)",
    bar("2026-03") > bar("2026-02") * 2.5 && bar("2026-03") < bar("2026-02") * 3.5, `${bar("2026-02")} ${bar("2026-03")}`);
  t.ck("April carries March's MRR forward", Math.abs(bar("2026-04") - bar("2026-03")) < 0.5);
  t.ck("May drops after the downgrade", bar("2026-05") < bar("2026-04"));
  t.ck("only the latest month carries a number", r?.vals.length === 1 && r.vals[0] === "$297", JSON.stringify(r?.vals));

  const mayBox = await page.evaluate(() => {
    const b = document.querySelector('.pf-mrr-bar[data-month="2026-05"]')?.getBoundingClientRect();
    return b ? { x: b.left + b.width / 2, y: b.top + 4 } : null;
  });
  if (mayBox) { await page.mouse.move(mayBox.x, mayBox.y); await wait(200); }
  r = await rev();
  t.ck("pointing at a month shows its figures", /May 2026/.test(r?.tip || "") && /MRR \$198/.test(r?.tip || "")
    && /Net new −\$99/.test(r?.tip || ""), r?.tip);
  await page.mouse.move(5, 5);

  await page.evaluate(() => document.querySelector('.pf-mrr-tabs [data-view="growth"]')?.click());
  await wait(250);
  r = await rev();
  t.ck("Growth swaps the chart rather than adding one", r?.svgs === 1 && r.view === "growth" && r.bars.length === 0,
    JSON.stringify({ svgs: r?.svgs, view: r?.view, bars: r?.bars.length }));
  t.ck("one net-new bar per month", r?.nets.length === EXPECT_MONTHS);
  const nb = (m) => r?.nets.find((e) => e.m === m);
  t.ck("a month that added is drawn up, in the brand colour", /pos/.test(nb("2026-03")?.cls || "") && nb("2026-03").bottom <= r.zeroY + 1,
    JSON.stringify(nb("2026-03")));
  t.ck("a month that lost is drawn DOWN, in red", /neg/.test(nb("2026-05")?.cls || "") && nb("2026-05").top >= r.zeroY - 1,
    JSON.stringify({ may: nb("2026-05"), zero: r?.zeroY }));
  t.ck("a quiet month is a sliver on the line, not a gap", /zero/.test(nb("2026-04")?.cls || "") && nb("2026-04").h < 3);
  t.ck("the breakdown names the latest month", r?.breakHd === "October 2026", r?.breakHd);
  t.ck("and splits it into new, expansion, contraction, churn and net",
    r?.parts.newMrr === "+$99" && r.parts.expansion === "—" && r.parts.contraction === "—" && r.parts.churn === "—" && r.parts.net === "+$99",
    JSON.stringify(r?.parts));
  const may2 = await page.evaluate(() => {
    const b = document.querySelector('.pf-mrr-net-bar[data-month="2026-05"]')?.getBoundingClientRect();
    return b ? { x: b.left + b.width / 2, y: b.top + 2 } : null;
  });
  if (may2) { await page.mouse.move(may2.x, may2.y); await wait(200); }
  r = await rev();
  t.ck("pointing at a month moves the breakdown to it", r?.breakHd === "May 2026" && r.parts.contraction === "−$99"
    && r.parts.net === "−$99", JSON.stringify({ hd: r?.breakHd, parts: r?.parts }));
  await page.mouse.move(5, 5);

  await page.evaluate(() => [...document.querySelectorAll(".pf-mrr button")].find((b) => /table/.test(b.innerText))?.click());
  await wait(200);
  const rows = await page.evaluate(() => [...document.querySelectorAll(".pf-mrr table tbody tr")].map((tr) => tr.innerText.split("\t")[0].trim()));
  t.ck("the exact figures are still one press away, newest first", rows.length === EXPECT_MONTHS && rows[0] === THIS_MONTH,
    JSON.stringify(rows));

  console.log("\n-- Health: three lights above the integrations --");
  await nav("Health");
  await wait(700);
  const hl = () => page.evaluate(() => {
    const sys = document.querySelector(".pf-sys");
    const setup = document.querySelector(".pf-setup-list");
    const light = (el) => getComputedStyle(el.querySelector(".pf-sys-light")).backgroundColor;
    return {
      boxes: [...document.querySelectorAll(".pf-sys-box")].map((b) => ({
        host: b.querySelector(".pf-sys-host")?.innerText.trim(), cls: b.className, color: light(b),
        word: b.querySelector(".pf-sys-label em")?.innerText.trim(), top: b.getBoundingClientRect().top })),
      sysTop: sys?.getBoundingClientRect().top, setupTop: setup?.getBoundingClientRect().top,
      bars: [...document.querySelectorAll(".pf-setup")].map((s) => ({
        id: s.dataset.group, open: s.querySelector(".pf-setup-bar")?.getAttribute("aria-expanded") === "true",
        text: s.querySelector(".pf-setup-bar")?.innerText.replace(/\s+/g, " ").trim(),
        h: s.getBoundingClientRect().height, w: s.getBoundingClientRect().width,
        vars: s.querySelectorAll(".pf-setup-vars span").length })),
      panelW: setup?.getBoundingClientRect().width,
    };
  });
  let h = await hl();
  t.ck("three boxes, one per host, in order",
    h.boxes.map((b) => b.host).join() === "admin.subsub.work,api.subsub.work,app.subsub.work", JSON.stringify(h.boxes.map((b) => b.host)));
  t.ck("side by side on a wide screen", h.boxes.length === 3 && Math.abs(h.boxes[0].top - h.boxes[2].top) < 2);
  t.ck("the lights sit above the integrations", h.sysTop < h.setupTop, `${h.sysTop} ${h.setupTop}`);
  const cols = h.boxes.map((b) => b.color);
  t.ck("green, amber and red are three different colours", new Set(cols).size === 3, JSON.stringify(cols));
  t.ck("and each says so in a word", h.boxes.map((b) => b.word).join() === "Up,Slow,Down", JSON.stringify(h.boxes.map((b) => b.word)));
  t.ck("the green one is green", /rgb\(47, 158, 95\)/.test(cols[0]), cols[0]);
  t.ck("the red one is red", /rgb\(200, 67, 44\)/.test(cols[2]), cols[2]);

  const lights = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".pf-setup")].map((sx) => [
    sx.dataset.group, { cls: sx.querySelector(".pf-int-light")?.className || "",
      color: sx.querySelector(".pf-int-light") ? getComputedStyle(sx.querySelector(".pf-int-light")).backgroundColor : null,
      word: sx.querySelector(".pf-int-word")?.innerText.trim() }])));
  t.ck("every integration bar carries a light", Object.values(lights).length === 5 && Object.values(lights).every((l) => l.color),
    JSON.stringify(lights));
  t.ck("a provider that answered is green, Working", /l-green/.test(lights.auth?.cls) && /working/i.test(lights.auth?.word || ""));
  t.ck("a test-mode Stripe key is amber", /l-amber/.test(lights.billing?.cls));
  t.ck("half configured is red", /l-red/.test(lights.mail?.cls) && /half configured/i.test(lights.mail?.word || ""));
  t.ck("not set up is grey, not red", /l-off/.test(lights.sms?.cls) && /not set up/i.test(lights.sms?.word || ""));
  t.ck("nothing to test reads Configured, never Working", /l-green/.test(lights.cron?.cls) && /^configured$/i.test(lights.cron?.word || ""),
    JSON.stringify(lights.cron));
  t.ck("green, amber and red are drawn differently",
    new Set([lights.auth?.color, lights.billing?.color, lights.mail?.color]).size === 3);
  h.bars = h.bars.filter((b) => ["auth", "mail", "sms"].includes(b.id));
  t.ck("every integration is a closed bar", h.bars.length === 3 && h.bars.every((b) => !b.open && b.vars === 0),
    JSON.stringify(h.bars));
  t.ck("each bar is thin", h.bars.every((b) => b.h <= 56), JSON.stringify(h.bars.map((b) => b.h)));
  t.ck("and runs the width of the panel", h.bars.every((b) => b.w > h.panelW - 4));
  const mail = h.bars.find((b) => b.id === "mail");
  t.ck("a bar carries its state and count", /Email \(Resend\)/.test(mail?.text || "") && /1 of 2 set/.test(mail?.text || "")
    && /Half configured/i.test(mail?.text || ""), mail?.text);
  t.ck("and flags a misspelled name while closed", /looks misspelled/.test(mail?.text || ""));
  t.ck("a healthy bar raises no flag", !/misspelled/.test(h.bars.find((b) => b.id === "auth")?.text || ""));

  await page.evaluate(() => document.querySelector('.pf-setup[data-group="mail"] .pf-setup-bar').click());
  await wait(150);
  h = await hl();
  const openMail = h.bars.find((b) => b.id === "mail");
  t.ck("pressing a bar opens it to the names", openMail?.open && openMail.vars === 2);
  const hint = await page.evaluate(() => document.querySelector('.pf-setup[data-group="mail"] .pf-setup-hint')?.innerText);
  const billSay = await page.evaluate(() => {
    document.querySelector('.pf-setup[data-group="billing"] .pf-setup-bar').click();
    return new Promise((res) => setTimeout(() => res(document.querySelector('.pf-setup[data-group="billing"] .pf-int-say')?.innerText), 150));
  });
  t.ck("opening a bar says what its light means", /TEST-mode/.test(billSay || ""), billSay);
  await page.evaluate(() => document.querySelector('.pf-setup[data-group="billing"] .pf-setup-bar').click());
  await wait(100);
  t.ck("with the misspelling explained", /RESEND_APIKEY/.test(hint || ""), hint);
  t.ck("and only that one opens", h.bars.filter((b) => b.open).length === 1);

  // The check itself failing: the API light is red, the other two unknown.
  healthFails = true;
  const before = healthAsks;
  await page.evaluate(() => [...document.querySelectorAll(".pf-sys-hd button")][0]?.click());
  await wait(500);
  h = await hl();
  t.ck("Re-check asks again", healthAsks > before);
  t.ck("a failed check is red for the API and unknown for the rest, not three reds",
    /l-unknown/.test(h.boxes[0]?.cls) && /l-red/.test(h.boxes[1]?.cls) && /l-unknown/.test(h.boxes[2]?.cls),
    JSON.stringify(h.boxes.map((b) => b.cls)));

  console.log("\n-- a phone --");
  healthFails = false;
  await page.setViewport({ width: 390, height: 1200 });
  await wait(400);
  h = await hl();
  t.ck("the boxes stack on a phone", h.boxes.length === 3 && h.boxes[1].top > h.boxes[0].top + 20);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  t.ck("and nothing scrolls sideways", sideways <= 1, String(sideways));
  await nav("Revenue");
  await wait(500);
  const revSide = await page.evaluate(() => ({
    side: document.documentElement.scrollWidth - window.innerWidth,
    svgW: document.querySelector(".pf-mrr svg")?.getBoundingClientRect().width,
    panelW: document.querySelector(".pf-mrr")?.getBoundingClientRect().width,
  }));
  t.ck("the chart fits a phone", revSide.side <= 1 && revSide.svgW <= revSide.panelW, JSON.stringify(revSide));

  t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
} catch (e) {
  t.ck("the suite ran to the end", false, e.stack || String(e));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
