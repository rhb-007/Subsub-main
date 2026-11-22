// The console's Notifications screen, drawn.
//
// test:notices proves the routes and that saved words are what is sent. This
// proves the screen can be reached from the console's nav, lists every email
// grouped by area with how many went and failed, opens one in a window that
// previews the words as they are typed, waits for a reason before it saves,
// sends what was typed, and shows a standard staff member the same window
// with nothing they can change.
//
//   node --no-warnings scripts/notices-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-notices-test");
const WEB = 5802, API = 8966;
const t = tally();

console.log("\n-- building the console --");
buildApp({ outDir: OUT, apiPort: API, platform: true });

let STAFF = { userId: "u_staff", name: "Staff Person", email: "staff@subsub.test",
  role: "superadmin", finance: true, impersonate: true };
const BOOT = { accounts: [], users: [], memberships: [], companies: [], engagements: [],
  jobs: [], subEvents: [], activity: [], smsDaily: [] };
const notice = (over) => ({
  key: "roster_joined", label: "Somebody joined your roster", group: "Joining and invites",
  audience: "Hiring account's admins and project managers", when: "A contractor applies.",
  required: false, recorded: true, placeholders: ["firstName", "companyName", "account.name", "link"],
  sampleVars: { firstName: "Richard", companyName: "T&V Sons Construction", "account.name": "Outerhome", link: "https://x" },
  standard: { subject: "T&V Sons Construction applied to join your roster", text: "Hi Richard,\n\nT&V Sons Construction applied." },
  enabled: true, subject: null, body: null, updatedAt: null, updatedBy: null,
  last30: { sent: 4, failed: 2, off: 0, lastSent: "2026-11-20T10:00:00Z",
    lastError: { error: "send_failed: domain not verified", at: "2026-11-19T10:00:00Z" } },
  ...over,
});
let LIST = [
  notice(),
  notice({ key: "sub_invite", label: "Invitation to join a roster", required: true,
    last30: { sent: 9, failed: 0, off: 0, lastSent: null, lastError: null } }),
  notice({ key: "doc_expiry", label: "Document expiring", group: "Compliance pack", enabled: false,
    last30: { sent: 0, failed: 0, off: 3, lastSent: null, lastError: null } }),
  notice({ key: "demo_booked", label: "Demo booked", group: "Signup and account", recorded: false,
    last30: { sent: 0, failed: 0, off: 0, lastSent: null, lastError: null } }),
];
const saved = [];
const previews = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === "/api/platform/me") return [200, STAFF];
  if (path === "/api/platform/bootstrap") return [200, BOOT];
  if (path === "/api/platform/companies") return [200, []];
  if (path.startsWith("/api/platform/activity/")) return [200, []];
  if (path === "/api/platform/notices") return [200, { notices: LIST, migrated: true, mailConfigured: true }];
  if (path === "/api/platform/notices/roster_joined/preview") {
    previews.push(body);
    const fill = (s) => String(s || "").replace(/\{\{\s*companyName\s*\}\}/g, "T&V Sons Construction");
    return [200, { subject: body.subject ? fill(body.subject) : LIST[0].standard.subject,
      text: body.body ? fill(body.body) : LIST[0].standard.text, unknown: [] }];
  }
  if (path === "/api/platform/notices/roster_joined" && method === "PUT") {
    saved.push(body);
    LIST = LIST.map((n) => n.key === "roster_joined" ? { ...n, subject: body.subject, body: body.body } : n);
    return [200, { ok: true }];
  }
  if (path.endsWith("/preview")) return [200, { subject: "s", text: "t", unknown: [] }];
  if (path === "/api/notify/log") return [200, []];
  return undefined;
} });

const browser = await launch();

async function openScreen() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1180, height: 1400 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://127.0.0.1:${WEB}/`, { waitUntil: "domcontentloaded" });
  await wait(2600);
  await page.evaluate(() => [...document.querySelectorAll("button, a")]
    .find((b) => /^\s*notifications\s*$/i.test(b.innerText || ""))?.click());
  await wait(900);
  return { ctx, page, crashes };
}
const setVal = (page, sel, v) => page.evaluate((s, val) => {
  const el = document.querySelector(s);
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, sel, v);

try {
  console.log("\n-- a superadmin --");
  {
    const { ctx, page, crashes } = await openScreen();
    const list = await page.evaluate(() => ({
      head: document.querySelector(".pf-head h2")?.innerText || "",
      groups: [...document.querySelectorAll(".pf-notice-h")].map((h) => h.innerText.trim().toLowerCase()),
      rows: [...document.querySelectorAll("[data-notice]")].map((r) => ({
        key: r.dataset.notice, text: r.innerText.replace(/\s+/g, " "), muted: r.classList.contains("muted"),
        warn: r.classList.contains("warn") })),
    }));
    t.ck("Notifications is in the console's nav and opens the screen", list.head === "Notifications", list.head);
    t.ck("every email is listed", list.rows.length === 4, JSON.stringify(list.rows.map((r) => r.key)));
    t.ck("grouped by area", list.groups.includes("joining and invites") && list.groups.includes("compliance pack"),
      JSON.stringify(list.groups));
    const rj = list.rows.find((r) => r.key === "roster_joined");
    t.ck("a row says how many went and failed in 30 days", /4 sent/.test(rj?.text) && /2 failed/.test(rj?.text), rj?.text);
    t.ck("and one with failures is marked", rj?.warn === true);
    const off = list.rows.find((r) => r.key === "doc_expiry");
    t.ck("a switched-off one says Off and is grayed", /\bOff\b/.test(off?.text) && off?.muted === true, off?.text);
    t.ck("one not in the mail log says so rather than showing zeros",
      /Not in the mail log/.test(list.rows.find((r) => r.key === "demo_booked")?.text || ""));

    await page.click('[data-notice="roster_joined"]');
    await wait(900);
    const win = await page.evaluate(() => {
      const m = document.querySelector(".notice-modal");
      return m ? { text: m.innerText.replace(/\s+/g, " "),
        save: m.querySelector("[data-notice-save]")?.disabled,
        chips: [...m.querySelectorAll(".notice-ph-list .chip")].map((c) => c.innerText),
        preview: m.querySelector("[data-notice-preview]")?.innerText || "" } : null;
    });
    t.ck("pressing a row opens it in a window", !!win, JSON.stringify(win));
    t.ck("which says the last failure and its error", /domain not verified/.test(win?.text || ""), win?.text);
    t.ck("and previews the standard words", /applied to join your roster/.test(win?.preview || ""), win?.preview);
    t.ck("it lists the values the words can use", win?.chips?.includes("{{companyName}}"), JSON.stringify(win?.chips));
    t.ck("Save waits until something changes", win?.save === true);

    await page.click("[data-notice-start]");
    await wait(200);
    const started = await page.evaluate(() => document.querySelector(".notice-modal textarea")?.value || "");
    t.ck("Start from the standard words puts them in the box", /T&V Sons Construction applied/.test(started), started);

    await setVal(page, ".notice-modal .notice-edit input", "{{companyName}} wants in");
    await setVal(page, ".notice-modal textarea", "New: {{companyName}}");
    await wait(900);
    const pv = await page.evaluate(() => document.querySelector("[data-notice-preview]")?.innerText || "");
    t.ck("the preview follows what is typed, filled in",
      /T&V Sons Construction wants in/.test(pv) && /New: T&V Sons Construction/.test(pv), pv);
    const before = await page.evaluate(() => document.querySelector("[data-notice-save]")?.disabled);
    t.ck("and Save still waits for a reason", before === true);
    await setVal(page, ".notice-foot input", "Clearer wording");
    await wait(200);
    await page.click("[data-notice-save]");
    await wait(900);
    t.ck("Save sends what was typed, with the reason",
      saved[0]?.subject === "{{companyName}} wants in" && saved[0]?.body === "New: {{companyName}}"
        && saved[0]?.reason === "Clearer wording" && saved[0]?.enabled === true, JSON.stringify(saved[0]));
    const after = await page.evaluate(() => document.querySelector(".notice-modal [role=status]")?.innerText || "");
    t.ck("and says it saved", /Saved/.test(after), after);
    await page.evaluate(() => document.querySelector(".modal-backdrop")?.click());
    await wait(500);
    const tag = await page.evaluate(() => document.querySelector('[data-notice="roster_joined"]')?.innerText || "");
    t.ck("the row now says it has new words", /new words/i.test(tag), tag);

    await page.click('[data-notice="sub_invite"]');
    await wait(700);
    const req = await page.evaluate(() => ({
      box: document.querySelector(".notice-switch input")?.disabled,
      text: document.querySelector(".notice-switch")?.innerText || "" }));
    t.ck("an invite cannot be switched off, and says why", req.box === true && /only way in/.test(req.text), JSON.stringify(req));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a standard staff member --");
  {
    STAFF = { ...STAFF, role: "standard", finance: false, impersonate: false };
    const { ctx, page, crashes } = await openScreen();
    await page.click('[data-notice="roster_joined"]');
    await wait(800);
    const r = await page.evaluate(() => ({
      ro: !!document.querySelector("[data-notice-readonly]"),
      save: !!document.querySelector("[data-notice-save]"),
      inputs: [...document.querySelectorAll(".notice-modal input, .notice-modal textarea")].every((i) => i.disabled),
    }));
    t.ck("they see the window", r.ro === true, JSON.stringify(r));
    t.ck("with nothing to change and no Save", r.save === false && r.inputs === true, JSON.stringify(r));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} catch (err) {
  t.ck("the suite ran to the end", false, err?.stack || String(err));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
