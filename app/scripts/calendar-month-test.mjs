// The calendar opens where the work is, not on today's month.
//
// Reported from the dashboard, which is where it costs most. "What's
// scheduled" names the next job however far ahead it is -- a job on 10
// November, read on 1 October -- and then "Open the calendar" landed on an
// empty October grid. The screen you came from had just told you where the
// work was and the screen you arrived at could not show it. That is the same
// failure as a count that routes you somewhere unable to display what it
// counted, which this file already refuses elsewhere.
//
// What the assertions have to be careful about:
//
//   A STATIC CHECK HERE CANNOT FAIL. The aim is computed from `jobs`, which
//   only exist at runtime, and the month label is rendered from it -- so the
//   only proof is to drive the grid and read the heading back. Checking that
//   the source mentions `aim` passes with the value never used, which is the
//   trap this repo keeps recording.
//
//   AND IT MUST NOT MOVE WHEN THIS MONTH HAS WORK IN IT. A fix that always
//   jumped to the next job would yank somebody to December past three jobs
//   earlier this month. Both branches are asserted, because pinning one
//   passes with the other inverted.
//
//   node --no-warnings scripts/calendar-month-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-calmonth-test");
const WEB = 5293, API = 8993;
const t = tally();

// Local dates, read the way the app reads them. toISOString() is UTC and west
// of Greenwich that is a different day for a good part of the evening.
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthName = (d) => d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
const today = new Date(); today.setHours(12, 0, 0, 0);

// Two months out, on the 10th: far enough that no fortnight strip reaches it
// and no off-by-one in the month arithmetic can land on it by accident.
const far = new Date(today.getFullYear(), today.getMonth() + 2, 10, 12);
// And something in THIS month, for the branch that must stay put.
//
// IT HAS TO BE IN THE PAST, and that is the whole of why this is computed
// rather than written down. A current-month job dated today or later is also
// the next job AHEAD, so "stay on a month with work in it" and "jump to the
// next job" give the same answer and the assertion passes whichever rule is
// in force -- which is exactly what the first version of this file did, and
// mutation is what caught it.
//
// Five days back, floored at the 1st. On the 1st of a month there is no
// earlier day in it, so no fixture can tell the two rules apart; the suite
// says so out loud rather than reporting a green that means nothing.
const near = new Date(today.getFullYear(), today.getMonth(), Math.max(1, today.getDate() - 5), 12);
const nearIsPast = key(near) < key(today);

const ACCOUNT = {
  id: "acc_x", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};
const USERS = [{ id: "usr_r", name: "Richard Braun", email: "rb@outerhome.co", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];

const job = (id, title, date) => ({
  id, accountId: "acc_x", title, address: "14 Alder Way", area: "Seattle", zip: "98101",
  trades: ["roofing"], assignments: {}, date, time: null, status: "open",
  propertyId: null, scope: "", notes: "", createdAtIso: new Date().toISOString(),
  updatedAtIso: new Date().toISOString(),
});

// Swapped between the two cases without rebuilding: the bundle is the same,
// only what the API says differs.
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

// Jobs -> the calendar toggle. Matching either roster noun, because this
// suite's subject is the grid and not what the roster is called.
const openCalendar = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^Jobs/i.test((b.innerText || "").trim()))?.click());
  await wait(1200);
  await page.evaluate(() => [...document.querySelectorAll(".jv-seg button")]
    .find((b) => /calendar/i.test(b.innerText || ""))?.click());
  await wait(1000);
};

const readGrid = (page) => page.evaluate(() => {
  const c = document.querySelector(".jcal");
  if (!c) return null;
  return {
    month: c.querySelector(".jcal-month strong")?.textContent.trim() || null,
    count: c.querySelector(".jcal-month span")?.textContent.trim() || null,
    marked: [...c.querySelectorAll(".jcal-cell.has .jc-dom")].map((x) => x.textContent.trim()),
    note: [...c.querySelectorAll(".jcal-undated")].map((x) => (x.innerText || "").replace(/\s+/g, " ")).join(" | "),
  };
});

try {
  // ---- the reported case --------------------------------------------------
  console.log("\n-- with nothing this month, it opens on the month that has the work --");
  {
    JOBS = [job("j_far", "Reroof the annexe", key(far))];
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
    await wait(2200);
    await openCalendar(page);
    const g = await readGrid(page);
    t.ck("the grid is drawn, so the rest of this can fail", !!g, String(g));
    t.ck("on the month the job is in, not today's",
      g.month === monthName(far), `${g.month} vs ${monthName(far)}`);
    // The month label alone could be right with the grid drawn for another
    // month, so the day has to be marked on it too.
    t.ck("with that day marked on the grid",
      g.marked.includes(String(far.getDate())), g.marked.join(", "));
    t.ck("and the heading counts it", /1 job/.test(g.count || ""), String(g.count));

    // Paging back pins the reader's place -- it must not bounce forward again.
    await page.evaluate(() => document.querySelector(".jcal-nav")?.click());
    await wait(700);
    const back = await readGrid(page);
    t.ck("paging back stays where it was put",
      back.month !== monthName(far), `${back.month}`);
    // An empty grid answers nothing, so it says where the work actually is.
    t.ck("and an empty month names the next job",
      /Nothing booked in/i.test(back.note) && /next job is on/i.test(back.note)
        && new RegExp(String(far.getDate())).test(back.note), back.note.slice(0, 120));
    t.ck("with one press to it", await page.evaluate(() =>
      [...document.querySelectorAll(".jcal-undated .sh-link")].some((b) => /Show it/i.test(b.innerText || ""))));
    await page.evaluate(() => [...document.querySelectorAll(".jcal-undated .sh-link")]
      .find((b) => /Show it/i.test(b.innerText || ""))?.click());
    await wait(700);
    const shown = await readGrid(page);
    t.ck("which goes there", shown.month === monthName(far), `${shown.month}`);
    await ctx.close().catch(() => {});
  }

  // ---- the branch that must NOT move --------------------------------------
  console.log("\n-- but a month with work in it is left alone --");
  {
    JOBS = [job("j_near", "Gutter clear", key(near)), job("j_far", "Reroof the annexe", key(far))];
    const { ctx, page } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
    await wait(2200);
    await openCalendar(page);
    const g = await readGrid(page);
    t.ck("the grid is drawn", !!g, String(g));
    // The whole conservatism of the fix: being yanked two months forward past
    // work in the month you are standing in is worse than the bug.
    if (!nearIsPast) {
      console.log("  note  today is the 1st: no job can sit earlier in this month,");
      console.log("        so this block cannot tell the two rules apart today.");
    }
    t.ck("it opens on this month", g.month === monthName(today), `${g.month} vs ${monthName(today)}`);
    t.ck("showing this month's job", g.marked.includes(String(near.getDate())), g.marked.join(", "));
    // And with something on the grid there is nothing to say about elsewhere.
    t.ck("and says nothing about a next job elsewhere",
      !/Nothing booked in/i.test(g.note), g.note.slice(0, 120));
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
