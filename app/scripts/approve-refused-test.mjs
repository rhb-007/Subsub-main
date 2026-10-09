// Approving a work request is awaited, and a refused one SAYS SO.
//
// Reported from a property manager's dashboard: "I already approved this job
// and it's still there." Approve patched the row off the screen first and
// handed the request to `persist`, which only logs -- so a refusal from the
// server took the row away, kept the request waiting, and put it back on the
// next reload, reading as an approve that had not stuck. The modal's own
// catch could never fire either, because the function it awaited returned
// before the request did.
//
// Three properties, each measured on the drawn dashboard:
//   - a refused approve LEAVES THE ROW and names the reason beside it;
//   - a successful one takes it off, and only after the server answered;
//   - a read-only row (work on ANOTHER account -- a building this one owns
//     and somebody else runs) is never offered, because Approve there can
//     only ever be refused.
//
//   node --no-warnings scripts/approve-refused-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-approveref-test");
const WEB = 5401, API = 9101;
const t = tally();

const acct = {
  id: "acc_x", name: "Sound Property Management", subdomain: "x", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Richard Braun", email: "rb@x.test", role: "admin" },
};
const USERS = [
  { id: "usr_r", name: "Richard Braun", email: "rb@x.test", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "usr_t", name: "John Smith", email: "js@x.test", phone: null, role: "tenant",
    subId: null, propertyIds: ["prop_1"], unit: "53", hasLogin: true, inviteSentAt: null, hasAvatar: false },
];
const base = {
  accountId: "acc_x", client: "", address: "12 Cedar St", area: "Seattle", zip: "98101",
  sqft: null, stories: null, time: null, scope: "", materialSource: null,
  materialSupplier: null, materialBranch: null, materialsPaidBy: null, measurementDocs: [],
  photos: [], notes: "", approvedAt: null, withdrawnAt: null, declinedAt: null, severity: null,
  createdAtIso: "2026-10-01T00:00:00Z", readOnly: false, inherited: false, atOwnedProperty: false,
  propertyId: "prop_1", trades: ["windows_doors"], assignments: {}, status: "requested",
  requestedBy: "usr_t", date: null, createdAt: "Oct 1",
};
const REFUSED = { ...base, id: "job_no", title: "Bedrooom window frame seems to be bent" };
const OK = { ...base, id: "job_ok", title: "Front door will not lock" };
// Work at a building this account OWNS and somebody else RUNS: the row lives
// on the other account, so this account can watch it and never approve it.
const ELSEWHERE = { ...base, id: "job_ro", accountId: "acc_y", title: "Lift out of order on another account",
  readOnly: true, atOwnedProperty: true };

const asked = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct];
  if (path === "/api/account") return [200, acct];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, [REFUSED, OK, ELSEWHERE]];
  if (path === "/api/jobs/job_no/approve" && method === "POST") { asked.push("job_no"); return [404, { error: "job_not_found" }]; }
  if (path === "/api/jobs/job_ok/approve" && method === "POST") { asked.push("job_ok"); return [200, { ok: true }]; }
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_x",
    name: "North Highland LLC", address: "12 Cedar St", city: "Seattle", state: "WA", zip: "98101",
    units: 60, notes: "", ownedByAnother: false, ownerDeclared: false }]];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/subs" || path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/tenants"
    || path === "/api/clients" || path === "/api/visits") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const rows = (page) => page.evaluate(() => [...document.querySelectorAll(".dash-sec.sec-top .dash-row")]
  .map((r) => ({ title: r.querySelector(".dr-title")?.innerText || "",
    err: r.querySelector(".dash-row-err")?.innerText || null })));
const press = (page, title) => page.evaluate((tt) => {
  const r = [...document.querySelectorAll(".dash-sec.sec-top .dash-row")]
    .find((x) => (x.querySelector(".dr-title")?.innerText || "") === tt);
  const b = r && [...r.querySelectorAll("button")].find((x) => /Approve/.test(x.innerText));
  if (b) b.click(); return !!b;
}, title);

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "x", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1300 } });
  await wait(2600);
  // The dashboard shows one row a section and the rest behind "See all",
  // which opens the whole list as a page. Open it, or the second request is
  // deliberately not drawn and every assertion below reads half the list.
  t.ck("the panel offers the rest of its list",
    await page.evaluate(() => {
      const b = document.querySelector(".dash-sec.sec-top .dash-more");
      if (b) b.click(); return !!b;
    }));
  await wait(300);
  let r = await rows(page);
  // The positive first: an absence below means nothing on a panel that never drew.
  t.ck("the work requests panel is on screen with both requests",
    r.some((x) => x.title === REFUSED.title) && r.some((x) => x.title === OK.title), JSON.stringify(r));
  t.ck("a request on ANOTHER account is not offered for approval",
    !r.some((x) => /Lift out of order/.test(x.title)), JSON.stringify(r));

  console.log("\n-- a refused approve --");
  t.ck("its Approve is pressed", await press(page, REFUSED.title));
  await wait(700);
  r = await rows(page);
  const no = r.find((x) => x.title === REFUSED.title);
  t.ck("the request reached the server", asked.includes("job_no"), JSON.stringify(asked));
  t.ck("the row is STILL there", !!no, JSON.stringify(r));
  t.ck("and says why, not 'try again'", /isn't on this account/.test(no?.err || ""), String(no?.err));

  console.log("\n-- one the server takes --");
  t.ck("its Approve is pressed", await press(page, OK.title));
  await wait(700);
  r = await rows(page);
  t.ck("the request reached the server", asked.includes("job_ok"), JSON.stringify(asked));
  t.ck("and the row is gone", !r.some((x) => x.title === OK.title), JSON.stringify(r));
  t.ck("the refused one is still there with its reason", r.some((x) => x.title === REFUSED.title && x.err),
    JSON.stringify(r));
  t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} catch (e) {
  t.ck("the suite ran without throwing", false, e?.stack || String(e));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
