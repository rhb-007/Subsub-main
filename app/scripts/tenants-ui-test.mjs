// Tenants is a screen of its own, and a row says what is waiting on them.
//
// Tenants lived on Account -> Tenants, an admin-only tab inside a settings
// screen, so a project manager -- who runs the buildings day to day -- had no
// way to see who lives in them, and an admin had to go into settings to find
// out who had not signed in. It is a top-level menu entry now, beside Users and
// not inside it: a tenant is somebody who lives in a building, not a member of
// the team.
//
// What the assertions are careful about:
//
//   BOTH BRANCHES OF THE GATE IN ONE PLACE. Admin and pm on a property
//   manager's account get it; a general contractor, which keeps no buildings,
//   does not. A fix that drew it for everybody passes every positive check.
//
//   ONE SCREEN, NOT TWO. The Account tab is gone, so the list is not reachable
//   from two places that would drift apart.
//
//   THE FLAG IS READ OFF THE ROW, AND A ROW WITH NOTHING WAITING HAS NONE. A
//   flag on every row is a flag nobody reads.
//
//   THE WINDOW'S JOB ROW IS THE WAY IN. Pressing it has to land on the job,
//   which is asserted by the Jobs screen opening with that job on it.
//
//   node --no-warnings scripts/tenants-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-tenantsui-test");
const WEB = 5495, API = 8941;
const t = tally();

const pad = (n) => String(n).padStart(2, "0");
const key = (off) => { const d = new Date(); d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_mgr", name: "Richard Braun", email: "rb@soundpm.test", role: "admin" },
};
const GC = { ...PM, id: "acc_gc", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor" };
let ACC = PM;
let SEAT = { userId: "u_mgr", accountId: "acc_pm", role: "admin" };

const USERS = [
  { id: "u_mgr", name: "Richard Braun", email: "rb@soundpm.test", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "u_pm", name: "Pat Lee", email: "pat@soundpm.test", phone: null, role: "pm",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
];
const tenant = (userId, name, unit, extra = {}) => ({ userId, name, email: `${userId}@t.test`,
  phone: null, unit, propertyId: "prop_1", propertyName: "Press Apartments", addedAt: "2026-09-01",
  status: "active", contact: null, ...extra });
const TENANTS = [
  // Asked to confirm a time: the chain has reached them.
  tenant("u_ann", "Ann Ortiz", "4", { contact: { prefer: "text", bestTime: "After 5pm",
    emergencyName: "Jo Ortiz", emergencyRelation: "sister", emergencyPhone: "(253)555-0111" } }),
  // A request this account has not approved yet.
  tenant("u_ben", "Ben Park", "7"),
  // An open repair with no question in it.
  tenant("u_cal", "Cal Moss", "9"),
  // Nothing open at all -- and the one job naming her is somebody else's, read-only.
  tenant("u_dee", "Dee Rao", "12", { status: "invited", lastSentAt: "2026-10-01T00:00:00Z" }),
];

const job = (id, title, extra = {}) => ({
  id, accountId: "acc_pm", propertyId: "prop_1", title, status: "active",
  date: key(4), time: "09:00", address: "1620 Belmont Ave", area: "Seattle", zip: "98122",
  trades: ["plumbing"], assignments: {}, notes: "", createdAt: "Oct 1",
  createdAtIso: "2026-10-01T00:00:00Z", photos: [], severity: null, client: null, sqft: null,
  stories: null, scope: "", measurementDocs: [], materialSource: null, materialsPaidBy: null,
  requestedBy: null, approvedAt: "2026-10-02", declinedAt: null, withdrawnAt: null,
  completedAt: null, access: null, accessEffective: "tenant", accessUserId: null,
  reportDetail: null, propertyName: "Press Apartments", readOnly: false, spans: {}, ...extra,
});
const JOBS = [
  job("j_ann", "Kitchen tap drips", { requestedBy: "u_ann", accessUserId: "u_ann" }),
  job("j_ben", "Bedroom window will not latch", { requestedBy: "u_ben", approvedAt: null }),
  job("j_cal", "Hall light flickers", { accessUserId: "u_cal", date: key(9) }),
  job("j_dee", "Old report under a previous manager", { requestedBy: "u_dee", readOnly: true }),
];
const T = "2026-10-10T12:00:00.000Z";
const VISITS = [
  { id: "v_ann", jobId: "j_ann", status: "proposed", date: key(3), startTime: "09:00", endTime: "10:00",
    note: "", tenantNote: null, respondedAt: null, contractorAt: T, contractorNote: null, managerAt: T,
    proposedBy: "u_mgr", createdAt: T, parties: ["contractor", "manager", "tenant"],
    turn: "tenant", waitingOn: ["tenant"] },
];
const PROP = { id: "prop_1", accountId: "acc_pm", name: "Press Apartments", address: "1620 Belmont Ave",
  city: "Seattle", state: "WA", zip: "98122", units: 60, notes: "", ownedByAnother: false, ownerDeclared: false };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACC];
  if (path === "/api/account") return [200, { ...ACC, user: { ...ACC.user, id: SEAT.userId, role: SEAT.role } }];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, ACC === PM ? JOBS : []];
  if (path === "/api/visits") return [200, ACC === PM ? VISITS : []];
  if (path === "/api/properties") return [200, ACC === PM ? [PROP] : []];
  if (path === "/api/tenants") return [200, TENANTS];
  const inv = path.match(/^\/api\/tenants\/([^/]+)\/invite$/);
  if (inv) {
    const x = TENANTS.find((y) => y.userId === inv[1]);
    return [200, { ...x, openInvite: x.status !== "active", draft: null }];
  }
  if (path === "/api/subs" || path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/clients" || path === "/api/notices")
    return [200, []];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const navLabels = (page) => page.evaluate(() =>
  [...document.querySelectorAll("nav.tabs button, nav button")].map((b) => (b.innerText || "").trim().split("\n")[0]));
const openTenants = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("nav.tabs button, nav button")]
    .find((b) => (b.innerText || "").trim().split("\n")[0] === "Tenants")?.click());
  for (let n = 0; n < 30; n++) { await wait(200); if (await page.$(".user-row")) break; }
};
const rowsOf = (page) => page.evaluate(() => [...document.querySelectorAll(".user-row")].map((r) => ({
  text: (r.innerText || "").replace(/\n/g, " "),
  flags: [...r.querySelectorAll(".tn-flag")].map((f) => f.innerText.trim()),
})));

try {
  console.log("\n-- an admin on a property manager's account --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB, seat: SEAT });
    for (let n = 0; n < 30; n++) { await wait(200); if ((await navLabels(page)).includes("Dashboard")) break; }
    const nav = await navLabels(page);
    t.ck("the menu has Tenants", nav.includes("Tenants"), nav.join(" | "));

    await openTenants(page);
    const head = await page.evaluate(() => document.querySelector(".ss-main .dash-hello h2")?.innerText || "");
    t.ck("it opens a page called Tenants", /^Tenants/.test(head.trim()), head);
    const rows = await rowsOf(page);
    t.ck("every tenant is listed", rows.length === 4, JSON.stringify(rows.map((r) => r.text)));
    const by = (n) => rows.find((r) => r.text.includes(n)) || { text: "", flags: [] };
    t.ck("Ann is flagged as asked to confirm a time",
      by("Ann Ortiz").flags.join() === "Asked to confirm a time", JSON.stringify(by("Ann Ortiz")));
    t.ck("Ben's unapproved request is flagged",
      by("Ben Park").flags.join() === "Request to approve", JSON.stringify(by("Ben Park")));
    t.ck("Cal's open repair is counted, quietly",
      by("Cal Moss").flags.join() === "1 open repair", JSON.stringify(by("Cal Moss")));
    t.ck("Dee has no flag: her only job is another account's, read-only",
      by("Dee Rao").text && by("Dee Rao").flags.length === 0, JSON.stringify(by("Dee Rao")));
    t.ck("and her status still says she has not signed in", /Invite sent/.test(by("Dee Rao").text), by("Dee Rao").text);

    // The window.
    await page.evaluate(() => [...document.querySelectorAll(".user-row")]
      .find((r) => /Ann Ortiz/.test(r.innerText))?.click());
    for (let n = 0; n < 30; n++) { await wait(200); if (await page.$(".tn-summary")) break; }
    const sum = await page.evaluate(() => {
      const s = document.querySelector(".modal .tn-summary");
      if (!s) return null;
      return {
        where: s.querySelector(".tn-sum-where")?.innerText || "",
        contact: s.querySelector(".tn-sum-contact")?.innerText || "",
        jobs: [...s.querySelectorAll(".tn-sum-job")].map((b) => ({
          title: b.querySelector(".tsj-title")?.innerText || "",
          when: b.querySelector(".tsj-when")?.innerText || "",
          stage: b.querySelector(".tn-chip")?.innerText || "",
          disabled: b.disabled })),
      };
    });
    t.ck("the window carries a summary", !!sum, "no .tn-summary in the modal");
    t.ck("it says where they live", /Press Apartments/.test(sum?.where || "") && /Unit 4/.test(sum?.where || ""), sum?.where);
    t.ck("how they want to be reached", /Prefers a text · After 5pm/.test(sum?.contact || ""), sum?.contact);
    t.ck("and who to call in an emergency", /Jo Ortiz \(sister\)/.test(sum?.contact || ""), sum?.contact);
    t.ck("their open job is listed with what it waits on",
      sum?.jobs?.length === 1 && sum.jobs[0].title === "Kitchen tap drips"
        && sum.jobs[0].stage === "Asked to confirm a time", JSON.stringify(sum?.jobs));
    t.ck("with the proposed time on it", /9(:00)?\s*AM/.test(sum?.jobs?.[0]?.when || ""), sum?.jobs?.[0]?.when);

    // The row is the way into the job.
    await page.evaluate(() => document.querySelector(".modal .tn-sum-job")?.click());
    await wait(1200);
    const after = await page.evaluate(() => ({
      modal: !!document.querySelector(".modal .tn-summary"),
      onJobs: [...document.querySelectorAll("nav button")].some((b) => b.classList.contains("on")
        && /^Jobs/.test((b.innerText || "").trim())),
      job: /Kitchen tap drips/.test(document.querySelector(".ss-main")?.innerText || ""),
    }));
    t.ck("pressing it closes the window", !after.modal, JSON.stringify(after));
    t.ck("and lands on that job in Jobs", after.onJobs && after.job, JSON.stringify(after));

    // One screen: the Account tab is gone.
    await page.evaluate(() => [...document.querySelectorAll("button, a, [role=button]")]
      .find((b) => /^My account$/.test((b.innerText || "").trim().split("\n")[0]))?.click());
    for (let n = 0; n < 20; n++) { await wait(200); if (await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Users"))) break; }
    const acctTabs = await page.evaluate(() => [...document.querySelectorAll(".ss-main button")]
      .map((b) => b.innerText.trim()));
    t.ck("the account screen really opened", acctTabs.includes("Users"), acctTabs.slice(0, 12).join(" | "));
    t.ck("and it has no Tenants tab of its own", !acctTabs.includes("Tenants"), acctTabs.slice(0, 12).join(" | "));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a project manager --");
  {
    SEAT = { userId: "u_pm", accountId: "acc_pm", role: "pm" };
    const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB, seat: SEAT });
    for (let n = 0; n < 30; n++) { await wait(200); if ((await navLabels(page)).includes("Dashboard")) break; }
    const nav = await navLabels(page);
    t.ck("a project manager has Tenants too", nav.includes("Tenants"), nav.join(" | "));
    await openTenants(page);
    t.ck("and it lists them", (await rowsOf(page)).length === 4);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a general contractor keeps no buildings --");
  {
    ACC = GC;
    SEAT = { userId: "u_mgr", accountId: "acc_gc", role: "admin" };
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB, seat: SEAT });
    for (let n = 0; n < 30; n++) { await wait(200); if ((await navLabels(page)).includes("Dashboard")) break; }
    const nav = await navLabels(page);
    t.ck("the menu really drew", nav.includes("Dashboard") && nav.includes("Jobs"), nav.join(" | "));
    t.ck("and has no Tenants", !nav.includes("Tenants"), nav.join(" | "));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} catch (e) {
  t.ck("the suite ran without throwing", false, e?.stack || String(e));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
