// "What's scheduled" answers with everything booked, not with one job.
//
// Reported as the dead space, with a red box drawn round it: one card, then a
// couple of inches of nothing, then the fortnight strip -- on an account with
// a job on the 12th and another on the 10th of the following month. The second
// job existed, was on the Jobs screen, and was in "Needs a contractor" lower
// down the same page. The one panel whose entire subject is *when* said
// nothing about it.
//
// The strip could not carry it either: fourteen days by design, so anything
// past a fortnight is invisible there and the gap was all that stood in for it.
//
// What the assertions have to be careful about:
//
//   A STATIC CHECK CANNOT SEE A GAP. The rows are derived from jobs that only
//   exist at runtime and the slack comes from the height of the card BESIDE
//   this one, so the only proof is to render it and measure. Asserting that
//   the source mentions `rest` passes with the value never used.
//
//   AND "THE ROW IS PRESENT" IS NOT THE PROPERTY. The row could render and
//   still leave the gap, so the distance from the last thing in the panel to
//   the fortnight strip is measured directly.
//
//   BOTH BRANCHES. One job and nothing after it leaves the same dead air, so
//   that case says so in words -- and pinning only the many-jobs case passes
//   with the single-job branch deleted.
//
//   node --no-warnings scripts/schedule-rest-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-schedrest-test");
const WEB = 5297, API = 8997;
const t = tally();

const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = new Date(); today.setHours(12, 0, 0, 0);
const plus = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

// 11 days out and 40 days out: the reported shape. The second is past the
// fortnight strip, which is the whole reason the panel has to name it.
const SOON = key(plus(11)), FAR = key(plus(40));

const ACCOUNT = {
  id: "acc_x", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};
const USERS = [{ id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];

const job = (id, title, date, assignments = {}) => ({
  id, accountId: "acc_x", title, address: "14 Alder Way", area: "Seattle", zip: "98101",
  trades: ["roofing", "gutters"], assignments, date, time: "07:00", status: "open",
  propertyId: null, scope: "", notes: "", createdAtIso: new Date().toISOString(),
  updatedAtIso: new Date().toISOString(),
});

let JOBS = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/subs" || path === "/api/properties" || path === "/api/invites"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/tenants" || path === "/api/clients") return [200, []];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const readPanel = (page) => page.evaluate(() => {
  const p = document.querySelector(".sched-hero");
  if (!p) return null;
  const strip = p.querySelector(".sh-strip");
  // The last thing above the strip, whatever it is -- the measurement has to
  // be of the GAP, not of a selector that happens to exist.
  const above = [...p.children].filter((el) => !el.classList.contains("sh-strip")
    && !el.classList.contains("sh-head"));
  const last = above[above.length - 1];
  return {
    rows: [...p.querySelectorAll(".shr-row")].map((r) => (r.innerText || "").replace(/\s+/g, " ").trim()),
    only: p.querySelector(".sh-only")?.textContent?.trim() || null,
    more: p.querySelector(".shr-more")?.textContent?.trim() || null,
    // px between the bottom of the last block and the top of the fortnight.
    gap: strip && last
      ? Math.round(strip.getBoundingClientRect().top - last.getBoundingClientRect().bottom)
      : null,
    text: (p.innerText || "").replace(/\s+/g, " ").trim(),
  };
});

try {
  // ---- the reported case --------------------------------------------------
  console.log("\n-- a job past the fortnight is named, not left to the gap --");
  {
    JOBS = [job("j_soon", "Queen Anne Roofing", SOON), job("j_far", "Zapier connection test", FAR)];
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
    await wait(2400);
    const g = await readPanel(page);
    t.ck("the panel is drawn, so the rest of this can fail", !!g, String(g));
    t.ck("the next job still leads", /Queen Anne Roofing/.test(g.text), g.text.slice(0, 80));
    t.ck("and the one after it is listed", g.rows.some((r) => /Zapier connection test/.test(r)),
      JSON.stringify(g.rows));
    // Which is the point: the strip is 14 days, so 40 days out cannot be on it.
    t.ck("carrying how far off it is", g.rows.some((r) => /day/i.test(r)), JSON.stringify(g.rows));
    // A row that read the same assigned or not would make the list decoration.
    t.ck("and that nobody is on it", g.rows.some((r) => /0\/2/.test(r)), JSON.stringify(g.rows));
    // THE PROPERTY UNDER TEST: the dead air is gone.
    t.ck("the space above the fortnight is closed up", g.gap !== null && g.gap < 40, `${g.gap}px`);
    await ctx.close().catch(() => {});
  }

  // ---- one job, nothing after it ------------------------------------------
  console.log("\n-- and one job with nothing after it says so --");
  {
    JOBS = [job("j_soon", "Queen Anne Roofing", SOON)];
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
    await wait(2400);
    const g = await readPanel(page);
    t.ck("the panel is drawn", !!g, String(g));
    t.ck("there are no rows to show", g.rows.length === 0, JSON.stringify(g.rows));
    t.ck("so it says nothing else is booked", /Nothing else booked in/i.test(g.only || ""), String(g.only));
    t.ck("rather than leaving the gap", g.gap !== null && g.gap < 40, `${g.gap}px`);
    await ctx.close().catch(() => {});
  }

  // ---- the cap ------------------------------------------------------------
  console.log("\n-- a long book is capped, with the rest one press away --");
  {
    JOBS = [job("j0", "Lead job", SOON),
      ...Array.from({ length: 7 }, (_, i) => job(`j${i + 1}`, `Later job ${i + 1}`, key(plus(20 + i))))];
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
    await wait(2400);
    const g = await readPanel(page);
    // A panel that grows with the book stops being a summary.
    t.ck("it shows a fixed few", g.rows.length === 4, `${g.rows.length}`);
    t.ck("and counts what it is holding back", /and 3 more/i.test(g.more || ""), String(g.more));
    await ctx.close().catch(() => {});
  }
} catch (err) {
  t.fail++;
  console.log("FAIL  the run itself  --", err.message);
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
