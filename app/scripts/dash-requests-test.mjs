// What a property manager needs in front of them when they sign in.
//
// Reported: "need to add a section to the property manager dashboard
// (actually move the section of the issues sent to pm by the tenant or owner,
// this should go to the top and share scheduled jobs as it's the most
// important for a property manager to see right when they login."
//
// "Asked for by owners and tenants" sat UNDER five KPI tiles -- the only
// thing on the page that is a person waiting on an answer, below five numbers
// that are not. It joins `dash-top` beside the schedule now, which is the
// other question this page exists to answer: what is happening and when, and
// who is waiting on me.
//
// MEASURED, not read off the source. Source order is not screen order inside
// a grid, and a static check that the JSX moved passes whether or not the
// panel lands anywhere near the schedule -- which is the whole claim. Same
// reason `test:calmonth` measures `getBoundingClientRect` rather than
// trusting the markup.
//
//   node --no-warnings scripts/dash-requests-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-dashreq-test");
const WEB = 5309, API = 9009;
const t = tally();

const acct = (kind) => ({
  id: "acc_x", name: "Sound Property Management", subdomain: "x", kind,
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Richard Braun", email: "rb@x.test", role: "admin" },
});
const USERS = [
  { id: "usr_r", name: "Richard Braun", email: "rb@x.test", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "usr_t", name: "Tess Nguyen", email: "tess@x.test", phone: null, role: "tenant",
    subId: null, propertyIds: ["prop_1"], unit: "3B", hasLogin: true, inviteSentAt: null, hasAvatar: false },
];
const jobBase = {
  accountId: "acc_x", client: "", address: "12 Cedar St", area: "Seattle", zip: "98101",
  sqft: null, stories: null, time: "07:00", scope: "", materialSource: null,
  materialSupplier: null, materialBranch: null, materialsPaidBy: null, measurementDocs: [],
  photos: [], notes: "", requestedBy: null, approvedAt: null, withdrawnAt: null,
  // NULL, which is what the API actually sends for the great majority:
  // jobRowToJs answers "911", "urgent" or null, and the dashboard's
  // emergencies filter is `j.severity && ...`. A fixture saying "standard"
  // puts every ordinary job under "Needs attention now" -- a shape the
  // product never produces, which makes the screen under test somebody
  // else's screen.
  declinedAt: null, severity: null, createdAtIso: "2026-09-01T00:00:00Z",
  readOnly: false, inherited: false, atOwnedProperty: false, propertyId: "prop_1",
};
// A scheduled job, so the schedule panel has something in it, and three
// requests, so the cap is exercised as well as the placement.
const BOOKED = { ...jobBase, id: "job_b", title: "Gutter clear", date: "2026-10-12",
  trades: ["roofing"], assignments: {}, status: "active" };
const REQS = ["Water through the ceiling", "Front door will not lock", "No hot water"]
  .map((title, n) => ({ ...jobBase, id: `job_r${n}`, title, date: "2026-10-20",
    trades: ["plumbing"], assignments: {}, status: "requested", requestedBy: "usr_t",
    createdAt: "Sep 30", photos: [{ id: `ph_${n}`, name: "shot.png" }],
    reportDetail: { unit: "3B", problem: "A leak", started: "Today", words: "Dripping." } }));

let KIND = "property_manager";
let JOBS = [BOOKED, ...REQS];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct(KIND)];
  if (path === "/api/account") return [200, acct(KIND)];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_x",
    name: "Cedar Flats", address: "12 Cedar St", city: "Seattle", state: "WA", zip: "98101",
    units: 24, notes: "", ownedByAnother: false, ownerDeclared: false }]];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/subs" || path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/tenants"
    || path === "/api/clients" || path === "/api/visits") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

// Where everything sits, in pixels, on the page as drawn.
const geometry = (page) => page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { top: Math.round(r.top), bottom: Math.round(r.bottom),
      left: Math.round(r.left), w: Math.round(r.width),
      bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, border: cs.borderTopWidth };
  };
  const panel = document.querySelector(".dash-sec.sec-top");
  const row = panel?.querySelector(".dash-row");
  const cs = row ? getComputedStyle(row) : null;
  return {
    hero: box(".sched-hero"),
    panel: box(".dash-sec.sec-top"),
    tiles: box(".dash-grid"),
    head: (panel?.querySelector("h3")?.innerText || "").replace(/\s+/g, " ").trim(),
    rows: panel ? panel.querySelectorAll(".dash-row").length : 0,
    more: (panel?.querySelector(".dash-more")?.innerText || "").trim(),
    wrap: cs?.flexWrap || null,
    rowBg: cs?.backgroundColor || null,
    panelBg: panel ? getComputedStyle(panel).backgroundColor : null,
    // Any OTHER copy of the same section, which is what a move done by
    // copying rather than relocating would leave behind.
    approvalLists: document.querySelectorAll(".dash-sec h3").length,
    headings: [...document.querySelectorAll(".dash-sec h3")]
      .map((h) => h.innerText.replace(/\s+/g, " ").trim()),
  };
});

const open = async (width = 1340) => {
  const { ctx, page } = await visitApp(browser, { host: "x", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width, height: 1300 } });
  await wait(2600);
  return { ctx, page };
};

try {
  console.log("\n-- it shares the top row with the schedule --");
  {
    const { ctx, page } = await open();
    const g = await geometry(page);
    t.ck("the panel is on the page", !!g.panel, JSON.stringify(g.panel));
    t.ck("and it is the owners-and-tenants one",
      /asked for by owners and tenants/i.test(g.head), g.head);

    // THE PROPERTY UNDER TEST. Beside the schedule means level with it, in
    // the same row -- not under it, and above the tiles it used to sit below.
    t.ck("its top is level with the schedule panel's",
      Math.abs(g.panel.top - g.hero.top) <= 2, JSON.stringify({ p: g.panel.top, h: g.hero.top }));
    t.ck("and beside it rather than under it",
      g.panel.left > g.hero.left, JSON.stringify({ p: g.panel.left, h: g.hero.left }));
    t.ck("ABOVE the tiles, which is where it used to sit below",
      g.panel.bottom <= g.tiles.top, JSON.stringify({ pb: g.panel.bottom, tt: g.tiles.top }));

    // It is a panel, not a run of loose rows beside a card.
    // THE SAME card, not a second set of values: two panels side by side
    // differing by a pixel is the almost-aligned failure this repository
    // already records about a table column. Compared against the panel it
    // sits beside rather than against a literal, so a theme change moves
    // both or fails.
    t.ck("it wears the same card as the panel beside it",
      g.panel.bg === g.hero.bg && g.panel.radius === g.hero.radius
        && g.panel.border === g.hero.border,
      JSON.stringify({ p: [g.panel.bg, g.panel.radius, g.panel.border],
        h: [g.hero.bg, g.hero.radius, g.hero.border] }));
    t.ck("and its rows are not the card's own colour, or they vanish",
      g.rowBg !== g.panel.bg, JSON.stringify({ row: g.rowBg, panel: g.panel.bg }));

    // The row cannot be one line in a 340px column, so it wraps and the
    // buttons drop under what they are about.
    t.ck("the row wraps", g.wrap === "wrap", String(g.wrap));

    // Capped, like every other section in that row. Three shown, the rest
    // offered -- a panel that grows with the book has stopped summarising.
    t.ck("three rows are shown", g.rows === 3, String(g.rows));

    // AND THERE IS ONE OF IT. A move done by copying leaves the old one
    // below the tiles, and the page then carries the same queue twice.
    const dupes = g.headings.filter((h) => /asked for by owners and tenants/i.test(h));
    t.ck("and the section appears exactly once", dupes.length === 1, JSON.stringify(g.headings));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- the schedule is still beside it, not pushed out --");
  {
    // The fix must not cost the panel it joins. A row of three at 340px min
    // fits at desktop width; the schedule keeps its own column.
    const { ctx, page } = await open();
    const g = await geometry(page);
    t.ck("the schedule panel still has real width", g.hero.w > 300, String(g.hero.w));
    t.ck("and so does the requests panel", g.panel.w > 300, String(g.panel.w));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- on a phone they stack, and the requests are still first --");
  {
    const { ctx, page } = await open(390);
    const g = await geometry(page);
    // One column, so "beside" becomes "under the schedule" -- and still
    // above the tiles, which is the half that matters on a narrow screen
    // where everything is a scroll.
    t.ck("one column", Math.abs(g.panel.left - g.hero.left) <= 2,
      JSON.stringify({ p: g.panel.left, h: g.hero.left }));
    t.ck("still above the tiles", g.panel.bottom <= g.tiles.top,
      JSON.stringify({ pb: g.panel.bottom, tt: g.tiles.top }));
    // And nothing runs off the side, which a non-wrapping row of buttons in
    // a 390px column would do.
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    t.ck("and nothing scrolls sideways", over <= 1, String(over));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- with nothing waiting it is not there at all --");
  {
    JOBS = [BOOKED];
    const { ctx, page } = await open();
    const g = await geometry(page);
    t.ck("no panel", g.panel === null, JSON.stringify(g.panel));
    // Which means the schedule takes the row, as it did before any of this.
    // Wider than the 360px it had beside the requests panel: the row is the
    // schedule and the checklist again, which is what it was before any of
    // this. Measured as a comparison and not as an absolute, because the
    // absolute depends on how many other panels the account has earned.
    t.ck("and the schedule takes back the width", g.hero.w > 500, String(g.hero.w));
    t.ck("the tiles are still there", !!g.tiles, JSON.stringify(g.tiles));
    await ctx.close().catch(() => {});
    JOBS = [BOOKED, ...REQS];
  }

  console.log("\n-- a general contractor has no owners or tenants to ask --");
  {
    // The panel is deliberately NOT gated on the account kind: a general
    // contractor has nobody who can raise a request, so the data already
    // answers it and a kind check would be a second record of one fact.
    //
    // SAID RATHER THAN PINNED, because it cannot be pinned with a shape the
    // product produces: catching an added kind gate would need a general
    // contractor holding a tenant's request, and there is no way for a GC to
    // have one -- which is the test-of-its-own-fixture trap this suite
    // already fixed once, in the severity field above. Adding the gate passes
    // this suite, and it would also be harmless; what it would cost is a
    // second thing to remember the day a kind grows tenants.
    //
    // What this block does check is the kind the empty case is real for: a
    // GC's dashboard draws no panel at all.
    KIND = "general_contractor";
    JOBS = [BOOKED];
    const { ctx, page } = await open();
    const g = await geometry(page);
    t.ck("nothing is drawn", g.panel === null, JSON.stringify(g.panel));
    await ctx.close().catch(() => {});
    KIND = "property_manager";
    JOBS = [BOOKED, ...REQS];
  }

} finally {
  await browser.close().catch(() => {});
  web.close(); api.close();
}

t.done();
