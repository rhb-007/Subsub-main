// The properties screen as something you can scan.
//
// "The large boxes/cards are taking too much space. They should be tighter
// columns, and then open details into a larger modal."
//
// They were: every card carried the vendor chips, the owners panel with its
// invite chasing, the whole handover conversation, the notes and four buttons.
// A portfolio of eight buildings was several screens of scrolling, and the
// question a portfolio is actually opened to answer -- which of these has
// something waiting on me -- was below the fold on card two.
//
// So the tile carries what you scan FOR: the name, the address, who runs it if
// that is somebody else, and the counts. Everything else opens in a panel.
//
// The counts stay ON the tile and stay followable, which is deliberate: "five
// open jobs" with nowhere to go was the original complaint about this screen
// (see property-links-test), and burying the numbers one tap deeper to make
// room would have undone that fix to pay for this one.
//
//   node scripts/property-tile-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-proptile-test");
const WEB = 5223, API = 8935;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const PM = {
  id: "acc_pm", name: "Cascade Management", subdomain: "cascade", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "u_pm", name: "Priya Manager", email: "priya@cascade.test", role: "admin" },
};

// Eight buildings, which is the size at which the old screen became a problem.
const PROPS = Array.from({ length: 8 }, (_, i) => ({
  id: `p${i}`, accountId: "acc_pm", name: `${10 + i} Cedar St`, address: `${10 + i} Cedar St`,
  city: "Seattle", state: "WA", zip: "98101", units: 4 + i,
  notes: i === 0 ? "Gate code 4821. Bins out Tuesday." : "",
}));
const SUBS = [
  { id: "s1", company: "Ridge Roofing", engagementId: "en1", accountId: "acc_pm",
    categories: ["roofing"], propertyIds: ["p0"], crews: [], bond: true, insurance: true,
    contract: true, hasPortal: false, notify: {}, rating: null, zips: [] },
  { id: "s2", company: "Cascade Plumbing", engagementId: "en2", accountId: "acc_pm",
    categories: ["plumbing"], propertyIds: ["p0"], crews: [], bond: true, insurance: false,
    contract: true, hasPortal: false, notify: {}, rating: null, zips: [] },
];
const JOBS = [
  { id: "j1", accountId: "acc_pm", title: "Roof leak", propertyId: "p0", trades: ["roofing"],
    assignments: {}, status: "active", date: null, time: null, photos: [],
    createdAt: new Date().toISOString().slice(0, 10) },
  { id: "j2", accountId: "acc_pm", title: "Gutter clean", propertyId: "p0", trades: ["roofing"],
    assignments: {}, status: "completed", date: null, time: null, photos: [],
    createdAt: new Date().toISOString().slice(0, 10) },
];
const USERS = [
  { id: "u_pm", name: "Priya Manager", email: "priya@cascade.test", phone: null, role: "admin",
    subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
  { id: "u_dana", name: "Dana Reyes", email: "dana@owner.test", phone: null, role: "owner",
    subId: null, propertyIds: ["p0"], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false },
];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/properties") return [200, PROPS];
  if (path === "/api/subs") return [200, SUBS];
  if (path === "/api/jobs") return [200, JOBS];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/property-transfers") return [200, []];
  if (path === "/api/invites" || path === "/api/connect-requests") return [200, []];
  return undefined;
} });

const browser = await launch();
const toProperties = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^(Properties|Buildings)/.test(b.innerText.trim().split("\n")[0]))?.click());
  await wait(1100);
};

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "cascade", webPort: WEB,
    seat: { userId: "u_pm", accountId: "acc_pm" }, viewport: { width: 1280, height: 1000 } });
  await wait(2600);
  await toProperties(page);

  console.log("\n-- the tiles --");
  {
    const tiles = await page.evaluate(() => [...document.querySelectorAll(".prop-card")].map((c) => ({
      name: c.querySelector("h3")?.innerText.trim(),
      height: Math.round(c.getBoundingClientRect().height),
      top: Math.round(c.getBoundingClientRect().top),
      left: Math.round(c.getBoundingClientRect().left),
      statTags: [...c.querySelectorAll(".prop-stats > *")].map((x) => x.tagName),
      // What must NOT be on a tile any more.
      vendors: !!c.querySelector(".prop-vendors"),
      owners: !!c.querySelector(".prop-owners"),
      handover: !!c.querySelector(".prop-handover"),
      cta: !!c.querySelector(".prop-cta"),
      notes: !!c.querySelector(".prop-notes"),
      opener: !!c.querySelector(".pt-open"),
    })));
    t.ck("all eight are drawn", tiles.length === 8, String(tiles.length));

    // TIGHTER COLUMNS. Three or four across at 1280, where 330px columns gave
    // three at most and each one was tall enough to push the rest under.
    const rowTop = tiles[0].top;
    const perRow = tiles.filter((x) => x.top === rowTop).length;
    // Exactly four at this viewport, which is what discriminates: 330px columns
    // -- what this screen had -- give three, and "three or four" would have
    // passed on the layout being replaced.
    t.ck("four to a row at 1280", perRow === 4, String(perRow));
    // The real measure of the complaint: how much screen one building costs.
    // Set just above what the tile actually measures, so anything moving back
    // onto it -- a vendor list, the handover panel, a button row -- trips this
    // rather than quietly costing another screenful.
    const tall = Math.max(...tiles.map((x) => x.height));
    t.ck("and no tile is more than 120px tall", tall <= 120, `${tall}px`);
    // Eight buildings inside two screens rather than five.
    const lastBottom = Math.max(...tiles.map((x) => x.top + x.height));
    t.ck("eight buildings fit within two screens", lastBottom < 2000, `${lastBottom}px`);

    // WHAT IS LEFT ON IT: the name, and the counts, still followable.
    t.ck("every tile opens from its name", tiles.every((x) => x.opener),
      JSON.stringify(tiles.map((x) => x.opener)));
    const first = tiles.find((x) => /^10 Cedar/.test(x.name));
    t.ck("units stays plain text", first.statTags[0] === "SPAN", JSON.stringify(first.statTags));
    t.ck("and the two counts stay buttons on the tile",
      first.statTags.filter((x) => x === "BUTTON").length === 2, JSON.stringify(first.statTags));

    // WHAT IS GONE FROM IT.
    t.ck("no vendor chips on a tile", tiles.every((x) => !x.vendors));
    t.ck("no owners panel on a tile", tiles.every((x) => !x.owners));
    t.ck("no handover conversation on a tile", tiles.every((x) => !x.handover));
    t.ck("no button row on a tile", tiles.every((x) => !x.cta));
    t.ck("and the notes are not on a tile either", tiles.every((x) => !x.notes));
  }

  console.log("\n-- and the panel has all of it --");
  {
    await page.evaluate(() => {
      const c = [...document.querySelectorAll(".prop-card")]
        .find((x) => /10 Cedar St/.test(x.innerText));
      c.querySelector(".pt-open").click();
    });
    await wait(800);
    const d = await page.evaluate(() => {
      const el = document.querySelector(".prop-detail");
      if (!el) return null;
      return { name: el.querySelector("h2")?.innerText.trim(),
        addr: el.querySelector(".prop-addr")?.innerText.trim(),
        stats: el.querySelector(".pd-stats")?.innerText.replace(/\s+/g, " ").trim(),
        vendors: [...el.querySelectorAll(".prop-vendor")].map((b) => b.innerText.trim()),
        owners: el.querySelector(".prop-owners")?.innerText.replace(/\s+/g, " ").trim() || null,
        handover: !!el.querySelector(".prop-handover"),
        notes: el.querySelector(".prop-notes")?.innerText.trim() || null,
        acts: [...el.querySelectorAll(".pd-acts button")].map((b) => b.innerText.trim()),
        wide: !!document.querySelector(".modal-wide") };
    });
    t.ck("the panel opens on the building that was clicked", d?.name === "10 Cedar St", String(d?.name));
    t.ck("it is the wide modal, not a column", d.wide === true, String(d.wide));
    t.ck("the address is there", /10 Cedar St, Seattle/.test(d.addr || ""), d.addr);
    t.ck("the counts are spelled out", /1 open job/.test(d.stats || ""), d.stats);
    t.ck("and what is finished as well", /1 finished/.test(d.stats || ""), d.stats);
    t.ck("the vendors are listed", d.vendors.length === 2, JSON.stringify(d.vendors));
    t.ck("the owners panel is here", /dana/i.test(d.owners || ""), d.owners);
    t.ck("so is the handover conversation", d.handover === true);
    t.ck("the notes are readable at last", /Gate code 4821/.test(d.notes || ""), d.notes);
    // Every action the card used to carry, in one place.
    t.ck("editing is offered", d.acts.some((b) => /edit/i.test(b)), JSON.stringify(d.acts));
    t.ck("removing is offered", d.acts.some((b) => /remove/i.test(b)), JSON.stringify(d.acts));
    t.ck("assigning vendors is offered", d.acts.some((b) => /assign vendors/i.test(b)),
      JSON.stringify(d.acts));
    t.ck("and raising work is the primary one",
      d.acts.some((b) => /new job here/i.test(b)), JSON.stringify(d.acts));

    // Closing it leaves the list where it was.
    await page.evaluate(() => document.querySelector(".modal-close")?.click());
    await wait(500);
    t.ck("it closes", await page.evaluate(() => !document.querySelector(".prop-detail")));
    t.ck("and the tiles are still there",
      await page.evaluate(() => document.querySelectorAll(".prop-card").length) === 8);
  }

  console.log("\n-- a building with nothing on it --");
  {
    // The panel must be honest about an empty building rather than blank.
    await page.evaluate(() => {
      const c = [...document.querySelectorAll(".prop-card")]
        .find((x) => /17 Cedar St/.test(x.innerText));
      c.querySelector(".pt-open").click();
    });
    await wait(800);
    const d = await page.evaluate(() => {
      const el = document.querySelector(".prop-detail");
      return { stats: el?.querySelector(".pd-stats")?.innerText.replace(/\s+/g, " ").trim(),
        none: el?.querySelector(".prop-none")?.innerText.trim() || null,
        notes: !!el?.querySelector(".prop-notes"),
        finished: /finished/.test(el?.querySelector(".pd-stats")?.innerText || "") };
    });
    t.ck("it says nobody is scoped rather than showing an empty row",
      /no vendors scoped here yet/i.test(d.none || ""), d.none);
    t.ck("zero open jobs is still stated", /0 open jobs/.test(d.stats || ""), d.stats);
    // Nothing finished, so nothing claiming to be.
    t.ck("and a building with no history does not claim any", d.finished === false, d.stats);
    t.ck("no notes section when there are no notes", d.notes === false);
    await page.evaluate(() => document.querySelector(".modal-close")?.click());
  }

  t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
