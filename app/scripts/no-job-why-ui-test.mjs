// An inspection with nothing flagged says why there is no Raise a job.
//
// Reported as "raise a job from an inspection has disappeared". It had not: it
// is offered only once a room is Follow-up or Fail, and a walk with both rooms
// marked OK -- one noted "need to refinished and polished" -- drew nothing in
// its place. Driven in a browser because the property is what is on screen:
// the reason, the room whose words describe work, and the one tap that brings
// the button back.
//
//   node --no-warnings scripts/no-job-why-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-no-job-why-test");
const WEB = 5393, API = 9093;
const t = tally();

const acct = {
  id: "acc_x", name: "Sound Property Management", subdomain: "soundpm", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["flooring"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Christopher Lane", email: "chris@x.test", role: "admin" },
};
const ROOMS = () => [
  { id: "r1", name: "Kitchen", status: "ok", note: "Arms on cement floor,need to refinished and polished", position: 0, photos: [] },
  // "Carpet." under an OK room is somebody saying the carpet is fine: a room
  // that is not flagged must name a fault itself, so this one is not named.
  { id: "r2", name: "Hallway", status: "ok", note: "Carpet.", position: 1, photos: [] },
];
let DETAIL;
const reset = (status) => {
  DETAIL = {
    id: "insp_1", propertyId: "prop_1", unit: "10B", kind: "move_out",
    tenantName: "", inspectedOn: "2026-10-06", status, finishedAt: status === "finished" ? "2026-10-06 10:00:00" : null,
    jobId: null, createdAt: "2026-10-06 00:00:00", aiDrafts: false, recipients: [], sends: [], reopens: [],
    rooms: ROOMS(),
  };
};
reset("draft");
const patches = [];
const api = serveApi({ port: API, delay: 60, routes: (path, method, body) => {
  if (path === "/api/inspections" && method === "GET") return [200, [{ id: "insp_1", propertyId: "prop_1",
    unit: "10B", kind: "move_out", status: DETAIL.status, rooms: 2, flagged: 0, unchecked: 0, createdAt: "2026-10-06" }]];
  if (path === "/api/inspections/insp_1" && method === "GET") return [200, DETAIL];
  const m = path.match(/^\/api\/inspections\/insp_1\/rooms\/(r\d)$/);
  if (m && method === "PATCH") {
    patches.push({ room: m[1], body });
    DETAIL = { ...DETAIL, rooms: DETAIL.rooms.map((r) => (r.id === m[1] ? { ...r, ...body } : r)) };
    return [200, { ok: true, rooms: DETAIL.rooms }];
  }
  if (path.startsWith("/api/account-by-subdomain/") || path === "/api/account") return [200, acct];
  if (path === "/api/account-users") return [200, [{ id: "usr_r", name: "Christopher Lane",
    email: "chris@x.test", role: "admin", propertyIds: [], hasLogin: true }]];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_x", name: "Press Apartments",
    address: "1620 Belmont Ave", city: "Seattle", state: "WA", zip: "98122", units: 141, notes: "" }]];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });
const web = serveApp({ dir: OUT, port: WEB });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const read = (page) => page.evaluate(() => {
  const box = document.querySelector(".insp-nojob");
  const raise = [...document.querySelectorAll(".pd-acts button")].find((b) => /Raise a job/.test(b.innerText || ""));
  return {
    open: !!document.querySelector(".insp-room, .insp-reopen, .pd-acts"),
    box: box ? box.innerText : null,
    rows: box ? [...box.querySelectorAll(".insp-nojob-room")].map((r) => ({
      text: r.innerText, btn: r.querySelector("button")?.innerText || null })) : [],
    raise: raise ? raise.innerText : null,
    reopenOpen: !!document.querySelector(".insp-reopen.open textarea"),
  };
});

const openIt = async (status) => {
  reset(status);
  const { ctx, page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1200, height: 1300 } });
  await wait(2600);
  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^inspections/i.test((b.innerText || "").trim()))?.click());
  await wait(900);
  await page.evaluate(() => document.querySelector(".insp-row")?.click());
  await wait(1200);
  return { ctx, page };
};

try {
  console.log("\n-- a draft with nothing flagged --");
  {
    const { ctx, page } = await openIt("draft");
    const s = await read(page);
    t.ck("the inspection opened", s.open, JSON.stringify(s));
    t.ck("there is no Raise a job, because nothing is flagged", s.raise === null, String(s.raise));
    t.ck("and the screen says why", /No job to raise/.test(s.box || "") && /Follow-up/.test(s.box || ""), String(s.box));
    t.ck("it names the room whose note describes work", s.rows.length === 1 && /Kitchen/.test(s.rows[0]?.text || ""),
      JSON.stringify(s.rows));
    t.ck("and quotes what the note says", /refinished and polished/.test(s.rows[0]?.text || ""));
    t.ck("but not the room whose note only names a thing", !/Hallway/.test(s.box || ""));
    t.ck("offering to mark it Follow-up", /Mark Kitchen Follow-up/.test(s.rows[0]?.btn || ""), String(s.rows[0]?.btn));

    await page.evaluate(() => document.querySelector(".insp-nojob-room button")?.click());
    await wait(900);
    const after = await read(page);
    t.ck("one press sends Follow-up for that room and no other",
      patches.length === 1 && patches[0].room === "r1" && patches[0].body?.status === "follow_up", JSON.stringify(patches));
    t.ck("and Raise a job appears", /Raise a job/.test(after.raise || ""), String(after.raise));
    t.ck("and the explanation goes", after.box === null, String(after.box));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- a finished walk with nothing flagged --");
  {
    patches.length = 0;
    const { ctx, page } = await openIt("finished");
    const s = await read(page);
    t.ck("the screen says why there is no Raise a job", /No job to raise/.test(s.box || "") && s.raise === null, String(s.box));
    t.ck("and offers Reopen rather than a write the route would refuse",
      /Reopen to mark it/.test(s.rows[0]?.btn || "") && !/Mark Kitchen/.test(s.box || ""), JSON.stringify(s.rows));
    await page.evaluate(() => document.querySelector(".insp-nojob-room button")?.click());
    await wait(500);
    const after = await read(page);
    t.ck("which opens the reopen form", after.reopenOpen);
    t.ck("and writes nothing on its own", patches.length === 0, JSON.stringify(patches));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- a walk with something flagged --");
  {
    reset("draft");
    const { ctx, page } = await openIt("draft");
    await page.evaluate(() => document.querySelector(".insp-nojob-room button")?.click());
    await wait(900);
    // Reopened fresh with Kitchen already flagged, which is the ordinary case.
    DETAIL = { ...DETAIL, rooms: DETAIL.rooms.map((r) => (r.id === "r1" ? { ...r, status: "fail" } : r)) };
    await ctx.close().catch(() => {});
    const again = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1200, height: 1300 } });
    await wait(2600);
    await again.page.evaluate(() => [...document.querySelectorAll("nav button")]
      .find((b) => /^inspections/i.test((b.innerText || "").trim()))?.click());
    await wait(900);
    await again.page.evaluate(() => document.querySelector(".insp-row")?.click());
    await wait(1200);
    const s = await read(again.page);
    t.ck("Raise a job is drawn", /Raise a job/.test(s.raise || ""), String(s.raise));
    t.ck("and no explanation sits beside it", s.box === null, String(s.box));
    await again.ctx.close().catch(() => {});
  }
} catch (e) {
  t.ck("the suite ran without throwing", false, e?.stack || String(e));
} finally {
  await browser.close().catch(() => {});
  web.close(); api.close();
}
t.done();
