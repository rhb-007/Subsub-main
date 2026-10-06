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

  console.log("\n-- Revenue: the month table is a chart --");
  await nav("Revenue");
  await wait(500);
  const rev = () => page.evaluate(() => {
    const p = document.querySelector(".pf-mrr");
    if (!p) return null;
    const box = (el) => { const r = el.getBoundingClientRect(); return { h: r.height, w: r.width }; };
    return {
      title: p.querySelector("h3")?.innerText.trim(),
      ends: [...p.querySelectorAll(".pf-mrr-end")].map((r) => ({ m: r.dataset.month, ...box(r) })),
      parts: [...p.querySelectorAll(".pf-mrr-move rect")].map((r) => ({ part: r.dataset.part, m: r.closest("g").dataset.month, ...box(r) })),
      nets: p.querySelectorAll(".pf-mrr-net").length,
      legend: [...p.querySelectorAll(".pf-mrr-legend li")].map((li) => li.innerText.replace(/\s+/g, " ").trim()),
      table: !!p.querySelector("table"),
      oldTable: [...document.querySelectorAll(".pf-panel h3")].some((h) => /MRR movement by month/.test(h.innerText)),
      tip: document.querySelector(".pf-mrr-tip")?.innerText.replace(/\s+/g, " "),
    };
  });
  let r = await rev();
  t.ck("the panel is a chart, not the old table", !!r && !r.table && !r.oldTable, JSON.stringify(r && { table: r.table, old: r.oldTable }));
  t.ck(`one ending-MRR bar per month, quiet months included (${EXPECT_MONTHS})`, r?.ends.length === EXPECT_MONTHS,
    JSON.stringify(r?.ends.map((e) => e.m)));
  t.ck("April, which had no events, is on the axis", r?.ends.some((e) => e.m === "2026-04"));
  const end = (m) => r?.ends.find((e) => e.m === m)?.h || 0;
  t.ck("ending MRR is drawn to scale: March ($297) is taller than February ($99)",
    end("2026-03") > end("2026-02") * 2.5 && end("2026-03") < end("2026-02") * 3.5, `${end("2026-02")} ${end("2026-03")}`);
  t.ck("April carries March's MRR forward", Math.abs(end("2026-04") - end("2026-03")) < 0.5);
  t.ck("May drops after the downgrade", end("2026-05") < end("2026-04"));
  t.ck("new MRR is a bar above the line in February", r?.parts.some((p) => p.m === "2026-02" && p.part === "newMrr" && p.h > 5));
  t.ck("the downgrade is a contraction bar in May", r?.parts.some((p) => p.m === "2026-05" && p.part === "contraction" && p.h > 5));
  t.ck("no movement bar on a silent month", !r?.parts.some((p) => p.m === "2026-04"));
  t.ck("a net tick per month", r?.nets === EXPECT_MONTHS);
  t.ck("the legend names the four parts and the total", r?.legend.length === 5 && /New \+\$297/.test(r.legend.join("|"))
    && /Contraction −\$99/.test(r.legend.join("|")), JSON.stringify(r?.legend));

  // Point at May: the detail the table used to carry is in the tooltip.
  const mayBox = await page.evaluate(() => {
    const el = document.querySelector('.pf-mrr-end[data-month="2026-05"]');
    const b = el?.getBoundingClientRect();
    return b ? { x: b.left + b.width / 2, y: b.top + 4 } : null;
  });
  if (mayBox) { await page.mouse.move(mayBox.x, mayBox.y); await wait(200); }
  r = await rev();
  t.ck("pointing at a month shows its figures", /May 2026/.test(r?.tip || "") && /Contraction −\$99/.test(r?.tip || "")
    && /Ending MRR \$198/.test(r?.tip || ""), r?.tip);

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
