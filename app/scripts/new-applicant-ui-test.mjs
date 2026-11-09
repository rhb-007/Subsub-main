// "New on your roster" on the dashboard, drawn and pressed.
//
// A contractor who joined through the public form or an accepted invite is a
// row at the top of the dashboard until somebody looks. What this pins:
//   only unseen (or seen before applying), recent joiners are listed;
//   Open opens their card AND records it as seen;
//   Dismiss records it as seen and the row goes, only after the server said so;
//   a refused Dismiss keeps the row and says why.
//
//   node --no-warnings scripts/new-applicant-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-newapplicant-test");
const WEB = 5437, API = 9137;
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
  docFiles: {}, docReview: {}, status: "invited", autoSchedule: 0,
  notify: { email: true, sms: false }, hasPortal: true, answersForItself: true,
};
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const mk = (id, company, extra) => ({ ...SUB, id, company, engagementId: `en_${id}`, ...extra });
const SUBS = [
  mk("cmp_bay", "Bay Roofing", { appliedAt: ago(2), appliedVia: "form", applicationSeenAt: null }),
  mk("cmp_inv", "Invited Gutters", { appliedAt: ago(26), appliedVia: "invite", applicationSeenAt: ago(200) }),
  mk("cmp_bad", "Refused Siding", { appliedAt: ago(30), appliedVia: "form", applicationSeenAt: null }),
  mk("cmp_seen", "Already Seen Paint", { appliedAt: ago(40), appliedVia: "form", applicationSeenAt: ago(39) }),
  mk("cmp_old", "Last Spring Fence", { appliedAt: ago(24 * 45), appliedVia: "form", applicationSeenAt: null }),
  mk("cmp_typed", "Typed In Tile", { appliedAt: null, appliedVia: null, applicationSeenAt: null }),
];

const asked = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct];
  if (path === "/api/account") return [200, acct];
  if (path === "/api/account-users") return [200, [{ id: "usr_r", name: "Richard Braun", email: "rb@x.test",
    phone: null, role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/subs") return [200, SUBS];
  const m = path.match(/^\/api\/subs\/([^/]+)\/application-seen$/);
  if (m && method === "POST") {
    asked.push(m[1]);
    if (m[1] === "cmp_bad") return [500, { error: "boom" }];
    return [200, { ok: true, seenAt: new Date().toISOString() }];
  }
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (["/api/jobs", "/api/invites", "/api/connect-requests", "/api/my-connect-requests",
    "/api/clients", "/api/visits", "/api/properties"].includes(path)) return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const rows = (page) => page.evaluate(() => {
  const sec = document.querySelector(".dash-sec.sec-joined");
  if (!sec) return null;
  return { head: sec.querySelector("h3")?.innerText || "",
    rows: [...sec.querySelectorAll(".joined-row")].map((r) => ({
      title: r.querySelector(".dr-title")?.innerText || "", meta: r.querySelector(".dr-meta")?.innerText || "" })),
    err: sec.querySelector(".form-err")?.innerText || "",
    more: !!sec.querySelector(".dash-more") };
});
const press = (page, title, label) => page.evaluate((tt, lb) => {
  const r = [...document.querySelectorAll(".sec-joined .joined-row")]
    .find((x) => (x.querySelector(".dr-title")?.innerText || "") === tt);
  const b = r && [...r.querySelectorAll("button")].find((x) => x.innerText.trim() === lb);
  if (b) b.click(); return !!b;
}, title, label);

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "x", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_out" }, viewport: { width: 1180, height: 1300 } });
  await wait(2600);
  let s = await rows(page);
  t.ck("the New on your roster section is drawn", !!s, "missing");
  t.ck("headed with the count of three", /New on your roster/i.test(s?.head || "") && /3/.test(s?.head || ""), s?.head);
  // Two rows and More, the dashboard rule; open it to read them all.
  if (s?.more) {
    await page.evaluate(() => document.querySelector(".sec-joined .dash-more")?.click());
    await wait(500); s = await rows(page);
  }
  const titles = (s?.rows || []).map((r) => r.title);
  t.ck("the newest first: Bay, then Invited, then Refused",
    JSON.stringify(titles) === JSON.stringify(["Bay Roofing", "Invited Gutters", "Refused Siding"]), JSON.stringify(titles));
  t.ck("seen, old and never-applied rows are not listed",
    !titles.some((x) => /Already Seen|Last Spring|Typed In/.test(x)), JSON.stringify(titles));
  t.ck("a form application says it applied",
    /Applied to join your roster/.test(s?.rows?.[0]?.meta || ""), s?.rows?.[0]?.meta);
  t.ck("an accepted invite says so",
    /Accepted your invite/.test(s?.rows?.[1]?.meta || ""), s?.rows?.[1]?.meta);

  console.log("\n-- a refused dismiss --");
  t.ck("Dismiss is pressed", await press(page, "Refused Siding", "Dismiss"));
  await wait(600); s = await rows(page);
  t.ck("the request reached the server", asked.includes("cmp_bad"), JSON.stringify(asked));
  t.ck("the row stays", (s?.rows || []).some((r) => r.title === "Refused Siding"), JSON.stringify(s));
  t.ck("and the reason is said", /Couldn't mark Refused Siding/.test(s?.err || ""), s?.err);

  console.log("\n-- Dismiss --");
  t.ck("Dismiss is pressed", await press(page, "Invited Gutters", "Dismiss"));
  await wait(600); s = await rows(page);
  t.ck("the request reached the server", asked.includes("cmp_inv"), JSON.stringify(asked));
  t.ck("and the row is gone", !(s?.rows || []).some((r) => r.title === "Invited Gutters"), JSON.stringify(s));

  console.log("\n-- Open --");
  t.ck("Open is pressed", await press(page, "Bay Roofing", "Open"));
  await wait(800);
  t.ck("their card opens", await page.evaluate(() =>
    [...document.querySelectorAll(".modal")].some((m) => /Bay Roofing/.test(m.innerText))));
  t.ck("and it is recorded as seen", asked.includes("cmp_bay"), JSON.stringify(asked));
  t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} catch (e) {
  t.ck("the suite ran without throwing", false, e?.stack || String(e));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
