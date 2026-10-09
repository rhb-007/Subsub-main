// 075. THE CONSOLE'S REFERRALS SCREEN, in a browser.
//
//   THE METRIC IS DRAWN: new hiring accounts per existing one, by week and by
//   metro, off the route's own figures.
//
//   THE LEDGER MOVES BY HAND: Approve, then Mark paid -- which asks how it was
//   paid before it posts -- and the body is read. Without finance access the
//   buttons are not drawn at all, asserted in the same suite.
//
//   node --no-warnings scripts/referral-console-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-refconsole-test");
const WEB = 5455, API = 9155;
const t = tally();

console.log("\n-- building the console --");
buildApp({ outDir: OUT, apiPort: API, platform: true });

let STAFF = { userId: "u_staff", name: "Staff Person", email: "staff@subsub.test",
  role: "superadmin", finance: true, impersonate: true };
const BOOT = { accounts: [], users: [], memberships: [], companies: [], engagements: [],
  jobs: [], subEvents: [], activity: [], smsDaily: [] };
let REWARDS = [
  { id: "rw1", kind: "sub_cash", beneficiary: "referrer", status: "pending", amountCents: 10000, code: "K7Q2MXRB",
    referredName: "Outerhome", to: "Bay Roofing", toEmail: "rae@bay.test", createdAt: "2026-10-02 10:00:00" },
  { id: "rw2", kind: "gc_credit", beneficiary: "referrer", status: "applied", amountCents: 9900, code: "GC4R7TQZ",
    referredName: "Cedar Builders", to: "Sound PM", createdAt: "2026-10-03 10:00:00" },
];
const ACQ = { weeks: ["2026-09-28", "2026-10-05"],
  overall: [{ week: "2026-09-28", existing: 10, newGc: 2, referredByGc: 0, referredBySub: 1, perExisting: 0.2, referredPerExisting: 0 },
    { week: "2026-10-05", existing: 12, newGc: 3, referredByGc: 1, referredBySub: 1, perExisting: 0.25, referredPerExisting: 0.08 }],
  byMetro: [{ metro: "Tacoma, WA", total: 6, newInRange: 3,
    rows: [{ week: "2026-09-28", existing: 4, newGc: 1, referredByGc: 0, referredBySub: 1, perExisting: 0.25 },
      { week: "2026-10-05", existing: 5, newGc: 2, referredByGc: 1, referredBySub: 0, perExisting: 0.4 }] }] };
const moves = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === "/api/platform/me") return [200, STAFF];
  if (path === "/api/platform/bootstrap") return [200, BOOT];
  if (path === "/api/platform/companies") return [200, []];
  if (path === "/api/platform/stuck-subs") return [200, { rows: [], mail: { configured: true } }];
  if (path === "/api/platform/referrals") return [200, { rewards: REWARDS,
    referrers: [{ code: "K7Q2MXRB", kind: "sub", name: "Bay Roofing", referred: 2, paying: 1, opens: 9, invites: 4 }] }];
  if (path.startsWith("/api/platform/referrals/acquisition")) return [200, ACQ];
  if (path.startsWith("/api/platform/referrals/rewards/") && method === "POST") {
    moves.push({ path, body });
    const id = path.split("/").pop();
    const to = { approve: "approved", pay: "paid", void: "void" }[body.action];
    REWARDS = REWARDS.map((r) => (r.id === id ? { ...r, status: to, reference: body.reference || r.reference } : r));
    return [200, { ok: true, status: to }];
  }
  if (path === "/api/notify/log") return [200, []];
  return undefined;
} });

const browser = await launch();
async function openReferrals() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1400, height: 1700 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://127.0.0.1:${WEB}/`, { waitUntil: "domcontentloaded" });
  await wait(2600);
  await page.evaluate(() => [...document.querySelectorAll("button, a")]
    .find((b) => /^\s*referrals\s*$/i.test(b.innerText || ""))?.click());
  await wait(1200);
  return { ctx, page, crashes };
}
const row = (page, id) => page.evaluate((i) => {
  const li = document.querySelector(`[data-reward="${i}"]`);
  return li ? { text: li.innerText.replace(/\s+/g, " "), buttons: [...li.querySelectorAll("button")].map((b) => b.innerText.trim()),
    input: !!li.querySelector("input") } : null;
}, id);
const press = (page, id, label) => page.evaluate(({ i, l }) => {
  const b = [...document.querySelectorAll(`[data-reward="${i}"] button`)].find((x) => x.innerText.trim() === l);
  b?.click(); return !!b;
}, { i: id, l: label });

try {
  console.log("\n-- finance staff --");
  {
    const { ctx, page, crashes } = await openReferrals();
    const head = await page.evaluate(() => document.querySelector(".pf-referrals h2")?.innerText || "");
    t.ck("Referrals is a screen in the console", head === "Referrals", head);
    const kpis = await page.evaluate(() => (document.querySelector(".pf-referrals .pf-kpis")?.innerText || "").replace(/\s+/g, " "));
    t.ck("this week's new GCs per existing GC is drawn", /3 New this week/.test(kpis) && /0\.25 Per existing GC/.test(kpis), kpis);
    t.ck("and the sub payouts owed", /1 Sub payouts owed \$100/.test(kpis), kpis);
    const metro = await page.evaluate(() => (document.querySelector(".pf-metro")?.innerText || "").replace(/\s+/g, " "));
    t.ck("by metro", /Tacoma, WA/.test(metro) && /0\.40/.test(metro), metro);
    let r = await row(page, "rw1");
    t.ck("a sub's pending $100 can be approved or voided", r && r.buttons.includes("Approve") && r.buttons.includes("Void"), JSON.stringify(r));
    r = await row(page, "rw2");
    t.ck("money that has moved offers nothing", r && r.buttons.length === 0, JSON.stringify(r));
    await press(page, "rw1", "Approve"); await wait(900);
    t.ck("Approve posts the move", moves.length === 1 && moves[0].body.action === "approve", JSON.stringify(moves));
    r = await row(page, "rw1");
    t.ck("and it now offers Mark paid", r?.buttons.includes("Mark paid"), JSON.stringify(r));
    await press(page, "rw1", "Mark paid"); await wait(500);
    r = await row(page, "rw1");
    t.ck("Mark paid asks how it was paid before anything posts", r?.input && moves.length === 1, JSON.stringify(r));
    t.ck("and will not record it blank", await page.evaluate(() =>
      [...document.querySelectorAll('[data-reward="rw1"] button')].find((b) => /Record payment/.test(b.innerText))?.disabled === true));
    await page.evaluate(() => {
      const el = document.querySelector('[data-reward="rw1"] input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "Check 1043");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press(page, "rw1", "Record payment"); await wait(900);
    t.ck("the payment posts with its reference",
      moves.length === 2 && moves[1].body.action === "pay" && moves[1].body.reference === "Check 1043", JSON.stringify(moves));
    t.ck("no page error", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
  console.log("\n-- staff without finance access --");
  STAFF = { ...STAFF, role: "standard", finance: false };
  REWARDS = REWARDS.map((r) => (r.id === "rw1" ? { ...r, status: "pending" } : r));
  {
    const { ctx, page, crashes } = await openReferrals();
    const head = await page.evaluate(() => document.querySelector(".pf-referrals h2")?.innerText || "");
    t.ck("they still see the screen", head === "Referrals");
    const r = await row(page, "rw1");
    t.ck("but no button that moves money", r && r.buttons.length === 0, JSON.stringify(r));
    t.ck("and are told why", /Approving and paying need finance access/.test(await page.evaluate(() => document.querySelector(".pf-referrals")?.innerText || "")));
    t.ck("no page error", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
