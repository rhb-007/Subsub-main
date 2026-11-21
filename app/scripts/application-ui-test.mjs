// 102. An application through the form waits for a yes, drawn and pressed.
//
// What this pins:
//   a pending applicant is listed under "Applications to review" on the
//   dashboard and the roster page, and NOT under "Not on your roster";
//   Accept is awaited, then opens the offer to send the SubSub Standard
//   Subcontractor Agreement, and sending posts it;
//   Decline asks once more, then posts the decline;
//   a refusal keeps the row and names why.
//
//   node --no-warnings scripts/application-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TERM_FIELDS, defaultTerms } from "../shared/agreement.js";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-application-test");
const WEB = 5463, API = 9163;
const t = tally();

const acct = {
  id: "acc_out", name: "Outerhome", subdomain: "x", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Richard Braun", email: "rb@x.test", role: "admin" },
};
const SUB = {
  accountId: "acc_out", contact: "Rae Ortiz", phone: "2065550002", email: "rae@bay.test",
  city: "Tacoma", state: "WA", zip: "98402", license: "", ubi: "",
  categories: ["roofing"], caps: [], crews: [], coverage: { mode: "cities", cities: ["Tacoma"], radii: [] },
  propertyIds: [], rating: 0, ratedJobs: 0, accepted: 0, declined: 0,
  bond: false, insurance: false, contract: false, available: true, notes: "",
  docFiles: {}, docReview: {}, status: "paused", autoSchedule: 0,
  notify: { email: true, sms: false }, hasPortal: true, answersForItself: true,
  appliedVia: "form", applicationSeenAt: null, application: "pending",
};
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const mk = (id, company, extra) => ({ ...SUB, id, company, engagementId: `en_${id}`, appliedAt: ago(2), ...extra });
const SUBS = [
  mk("cmp_bay", "Bay Roofing"),
  mk("cmp_nope", "Nope Paint"),
  mk("cmp_bad", "Refused Siding"),
  mk("cmp_paused", "Paused Gutters", { application: null, appliedAt: null, appliedVia: null }),
  mk("cmp_on", "On Roster Tile", { status: "active", application: "accepted" }),
];

const asked = [];
let agreementBody = null;
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct];
  if (path === "/api/account") return [200, acct];
  if (path === "/api/account-users") return [200, [{ id: "usr_r", name: "Richard Braun", email: "rb@x.test",
    phone: null, role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/subs") return [200, SUBS];
  let m = path.match(/^\/api\/subs\/([^/]+)\/application$/);
  if (m && method === "POST") {
    const d = (typeof body === "string" ? JSON.parse(body || "{}") : body || {}).decision;
    asked.push(`${m[1]}:${d}`);
    if (m[1] === "cmp_bad") return [409, { error: "not_pending", state: "declined" }];
    return [200, { ok: true, status: d === "accept" ? "active" : "ended", application: d === "accept" ? "accepted" : "declined", emailed: true }];
  }
  m = path.match(/^\/api\/subs\/([^/]+)\/agreement$/);
  if (m && method === "POST") {
    asked.push(`${m[1]}:agreement`);
    agreementBody = typeof body === "string" ? JSON.parse(body || "{}") : body || {};
    return [201, { ok: true, agreement: { id: "ag1", status: "sent" }, emailed: true, to: "ops@bayroofing.test" }];
  }
  if (m) return [200, { agreement: null, previous: null, fields: TERM_FIELDS,
    previewTerms: { ...defaultTerms(), paymentDays: 45, governingState: "WA" } }];
  if (path === "/api/notify/documents" && method === "POST") { asked.push("docreq"); return [200, { ok: true }]; }
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (["/api/jobs", "/api/invites", "/api/connect-requests", "/api/my-connect-requests",
    "/api/clients", "/api/visits", "/api/properties"].includes(path)) return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const panel = (page) => page.evaluate(() => {
  const sec = document.querySelector(".sec-apps:not(.sec-apps-one)");
  if (!sec) return null;
  return { head: sec.querySelector("h3")?.innerText || "", note: sec.querySelector(".apps-note")?.innerText || "",
    rows: [...sec.querySelectorAll(".app-row")].map((r) => r.querySelector(".dr-title")?.innerText || ""),
    err: sec.querySelector(".form-err")?.innerText || "" };
});
const press = (page, title, label) => page.evaluate((tt, lb) => {
  const r = [...document.querySelectorAll(".sec-apps .app-row")]
    .find((x) => (x.querySelector(".dr-title")?.innerText || "") === tt);
  const b = r && [...r.querySelectorAll("button")].find((x) => x.innerText.trim() === lb);
  if (b) b.click(); return !!b;
}, title, label);

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "x", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_out" }, viewport: { width: 1180, height: 1300 } });
  await wait(2600);
  let s = await panel(page);
  t.ck("the dashboard lists applications to review", !!s && /Applications to review/i.test(s.head), JSON.stringify(s));
  t.ck("all three pending ones, and nobody else",
    JSON.stringify((s?.rows || []).slice().sort()) === JSON.stringify(["Bay Roofing", "Nope Paint", "Refused Siding"]), JSON.stringify(s?.rows));
  t.ck("it says they are not on the roster until accepted, and names the agreement",
    /not on your roster until you accept/i.test(s?.note || "") && /SubSub Standard Subcontractor Agreement/.test(s?.note || ""), s?.note);
  t.ck("a pending applicant is not in New on your roster", await page.evaluate(() =>
    ![...document.querySelectorAll(".sec-joined .dr-title")].some((x) => /Bay Roofing/.test(x.innerText))));

  console.log("\n-- a refused decision --");
  t.ck("Accept is pressed on Refused Siding", await press(page, "Refused Siding", "Accept"));
  await wait(600); s = await panel(page);
  t.ck("the row stays", (s?.rows || []).includes("Refused Siding"), JSON.stringify(s?.rows));
  t.ck("and the reason is named", /already declined/.test(s?.err || ""), s?.err);

  console.log("\n-- Accept, then the agreement --");
  t.ck("Accept is pressed", await press(page, "Bay Roofing", "Accept"));
  await wait(700);
  t.ck("the accept reached the server", asked.includes("cmp_bay:accept"), JSON.stringify(asked));
  s = await panel(page);
  t.ck("the row is gone", !(s?.rows || []).includes("Bay Roofing"), JSON.stringify(s?.rows));
  const modal = await page.evaluate(() => document.querySelector(".accepted-app")?.innerText || "");
  t.ck("the offer to send the agreement opens", /Bay Roofing is on your roster/.test(modal) && /SubSub Standard Subcontractor Agreement/.test(modal), modal);
  t.ck("it asks which agreement first", await page.evaluate(() =>
    !!document.querySelector(".accepted-app [data-act=use-standard]") && !!document.querySelector(".accepted-app [data-act=use-custom]")
    && !document.querySelector(".accepted-app [data-act=send-standard]")));
  t.ck("and offers sending your own separately", /Sending yours separately/.test(modal), modal);
  await page.evaluate(() => document.querySelector(".accepted-app [data-act=use-standard]")?.click());
  await wait(300);
  const grid = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".accepted-app .agr-field")].find((f) => /Pay approved invoices within/.test(f.innerText));
    return el ? el.querySelector("input")?.value : null;
  });
  t.ck("the terms are shown in place, with the account's standing value", grid === "45", String(grid));
  await page.evaluate(() => {
    const el = [...document.querySelectorAll(".accepted-app .agr-field")].find((f) => /Pay approved invoices within/.test(f.innerText));
    const inp = el.querySelector("input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(inp, "20");
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait(200);
  t.ck("an edited term counts as changed", await page.evaluate(() => /1 changed/.test(document.querySelector(".accepted-app .agr-over")?.innerText || "")));
  await page.evaluate(() => document.querySelector(".accepted-app [data-act=send-standard]")?.click());
  await wait(900);
  t.ck("sending posts the agreement", asked.includes("cmp_bay:agreement"), JSON.stringify(asked));
  t.ck("with the edited term", agreementBody?.terms?.paymentDays === 20, JSON.stringify(agreementBody?.terms));
  t.ck("and says it went", await page.evaluate(() => /emailed to ops@bayroofing.test/.test(document.querySelector(".accepted-app")?.innerText || "")));
  await page.evaluate(() => [...document.querySelectorAll(".accepted-app button")].find((b) => b.innerText === "Done")?.click());
  await wait(300);

  console.log("\n-- Decline asks first --");
  t.ck("Decline is pressed", await press(page, "Nope Paint", "Decline"));
  await wait(300);
  t.ck("nothing is sent yet", !asked.some((a) => a.startsWith("cmp_nope")), JSON.stringify(asked));
  t.ck("it asks", await press(page, "Nope Paint", "Yes, decline"));
  await wait(600);
  t.ck("the decline reached the server", asked.includes("cmp_nope:decline"), JSON.stringify(asked));
  s = await panel(page);
  t.ck("and the row is gone", !(s?.rows || []).includes("Nope Paint"), JSON.stringify(s?.rows));
  t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
  await ctx.close();

  console.log("\n-- the roster page --");
  {
    const v = await visitApp(browser, { host: "x", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_out" }, viewport: { width: 1180, height: 1300 } });
    await wait(2600);
    await v.page.evaluate(() => [...document.querySelectorAll("nav button, .nav button, button")]
      .find((b) => /^(Sub)?contractors\b/i.test(b.innerText.trim()))?.click());
    await wait(900);
    const got = await v.page.evaluate(() => ({
      head: [...document.querySelectorAll("main h1, main h2")].map((h) => h.innerText).join(" | "),
      apps: [...document.querySelectorAll(".sec-apps .app-row .dr-title")].map((x) => x.innerText),
      off: (() => {
        document.querySelector(".or-toggle")?.click();
        return [...document.querySelectorAll(".or-name")].map((x) => x.innerText);
      })(),
    }));
    await wait(300);
    const off = await v.page.evaluate(() => [...document.querySelectorAll(".or-name")].map((x) => x.innerText));
    t.ck("the roster page is open", /Subcontractors/i.test(got.head), got.head);
    t.ck("it lists the applications too", got.apps.includes("Bay Roofing"), JSON.stringify(got.apps));
    t.ck("a paused contractor is under Not on your roster", off.includes("Paused Gutters"), JSON.stringify(off));
    t.ck("and an applicant is not", !off.includes("Bay Roofing"), JSON.stringify(off));

    // Their card says so and carries the same answers.
    await v.page.evaluate(() => [...document.querySelectorAll(".sec-apps .app-row .dash-row-open")]
      .find((b) => /Bay Roofing/.test(b.innerText))?.click());
    await wait(800);
    const card = await v.page.evaluate(() => {
      const m = document.querySelector(".modal .sec-apps-one");
      return m ? { text: m.innerText, btns: [...m.querySelectorAll("button")].map((b) => b.innerText.trim()) } : null;
    });
    t.ck("their card leads with the application", /Applied to join your roster/i.test(card?.text || ""), JSON.stringify(card));
    t.ck("with Accept and Decline", (card?.btns || []).includes("Accept") && (card?.btns || []).includes("Decline"), JSON.stringify(card));
    await v.ctx.close();
  }
} catch (e) {
  t.ck("the suite ran without throwing", false, e?.stack || String(e));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
