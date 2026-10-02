// The screen the walk actually happens on.
//
// Used standing in an empty unit holding a phone, so what matters is that
// every control is on screen and one tap deep. Driven in a browser because a
// static check that `InspectionsView` exists passes with the verdict buttons
// never rendering, and because the two things most worth pinning — the
// standard room list being a SUGGESTION rather than a constraint, and a
// disabled Finish having a reason beside it — are only true as drawn.
//
//   node --no-warnings scripts/inspection-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-inspection-test");
const WEB = 5313, API = 9013;
const t = tally();

const acct = (kind) => ({
  id: "acc_x", name: "Sound Property Management", subdomain: "soundpm", kind,
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Christopher Lane", email: "chris@x.test", role: "admin" },
});
const USERS = (role) => [{ id: "usr_r", name: "Christopher Lane", email: "chris@x.test", phone: null,
  role, subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];

let KIND = "property_manager";
let ROLE = "admin";
// One draft, mid-walk: a room marked OK, one flagged, one nobody has got to.
let DETAIL = {
  id: "insp_1", propertyId: "prop_1", unit: "3B", kind: "move_out",
  tenantName: "Tess Nguyen", inspectedOn: "2026-10-02", status: "draft",
  finishedAt: null, jobId: null, createdAt: "2026-10-02 00:00:00",
  rooms: [
    { id: "r1", name: "Kitchen", status: "ok", note: "", position: 0, photos: [] },
    { id: "r2", name: "Walls and floors", status: "follow_up",
      note: "Nail hole repair and paint", position: 1, photos: [] },
    { id: "r3", name: "Bathroom 1", status: "unchecked", note: "", position: 2, photos: [] },
  ],
};
const LIST = () => [{ id: "insp_1", propertyId: "prop_1", unit: "3B", kind: "move_out",
  tenantName: "Tess Nguyen", inspectedOn: "2026-10-02", status: DETAIL.status,
  jobId: DETAIL.jobId, createdAt: "2026-10-02 00:00:00",
  rooms: DETAIL.rooms.length,
  flagged: DETAIL.rooms.filter((r) => r.status === "follow_up" || r.status === "fail").length,
  unchecked: DETAIL.rooms.filter((r) => r.status === "unchecked").length }];

const sent = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === "/api/inspections" && method === "GET") return [200, LIST()];
  if (path === "/api/inspections/insp_1" && method === "GET") return [200, DETAIL];
  const room = /^\/api\/inspections\/insp_1\/rooms\/(r\d)$/.exec(path);
  if (room && method === "PATCH") {
    sent.push({ path, body });
    DETAIL = { ...DETAIL, rooms: DETAIL.rooms.map((r) => r.id === room[1] ? { ...r, ...body } : r) };
    return [200, { ok: true, rooms: DETAIL.rooms }];
  }
  if (path === "/api/inspections/insp_1/rooms" && method === "POST") {
    sent.push({ path, body });
    DETAIL = { ...DETAIL, rooms: [...DETAIL.rooms,
      { id: `r${DETAIL.rooms.length + 1}`, name: body.name, status: "unchecked", note: "", photos: [] }] };
    return [201, { ok: true, rooms: DETAIL.rooms }];
  }
  if (path === "/api/inspections/insp_1" && method === "PATCH") {
    sent.push({ path, body });
    DETAIL = { ...DETAIL, status: "finished" };
    return [200, DETAIL];
  }
  if (path === "/api/inspections/insp_1/job" && method === "POST") {
    sent.push({ path, body });
    DETAIL = { ...DETAIL, jobId: "job_new" };
    return [201, { ok: true, jobId: "job_new", flagged: 1 }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct(KIND)];
  if (path === "/api/account") return [200, acct(KIND)];
  if (path === "/api/account-users") return [200, USERS(ROLE)];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_x",
    name: "Press Apartments", address: "1620 Belmont Ave", city: "Seattle", state: "WA",
    zip: "98122", units: 141, notes: "", ownedByAnother: false, ownerDeclared: false }]];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/jobs" || path === "/api/subs" || path === "/api/invites"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/tenants" || path === "/api/clients" || path === "/api/visits") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const nav = (page) => page.evaluate(() => [...document.querySelectorAll("nav button")]
  .map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()));
const go = (page, re) => page.evaluate((r) => [...document.querySelectorAll("nav button")]
  .find((b) => new RegExp(r, "i").test((b.innerText || "").trim()))?.click(), re);
const read = (page) => page.evaluate(() => {
  const rooms = [...document.querySelectorAll(".insp-room")].map((el) => ({
    name: el.querySelector(".insp-name")?.value ?? (el.querySelector(".insp-name")?.innerText || "").trim(),
    cls: el.className,
    on: [...el.querySelectorAll(".insp-v")].filter((b) => b.classList.contains("on"))
      .map((b) => b.innerText.replace(/\s+/g, " ").trim()),
    verdicts: [...el.querySelectorAll(".insp-v")].map((b) => b.innerText.replace(/\s+/g, " ").trim()),
    note: el.querySelector(".insp-note")?.value ?? (el.querySelector(".insp-note-ro")?.innerText || ""),
    canEdit: !!el.querySelector(".insp-note"),
  }));
  const acts = [...document.querySelectorAll(".pd-acts button")].map((b) => ({
    label: (b.innerText || "").replace(/\s+/g, " ").trim(), off: b.disabled }));
  return {
    rooms, acts,
    stats: (document.querySelector(".pd-stats")?.innerText || "").replace(/\s+/g, " ").trim(),
    note: (document.querySelector(".insp-detail .fld-note")?.innerText || "").replace(/\s+/g, " ").trim(),
    // The standard list is offered through a datalist, which is a suggestion
    // a reader can type past -- a <select> would be a constraint.
    suggestions: [...document.querySelectorAll("#insp-rooms option")].map((o) => o.value),
    addIsFreeText: !!document.querySelector(".insp-add input[list='insp-rooms']"),
  };
});

const open = async () => {
  const { ctx, page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1300 } });
  await wait(2600);
  return { ctx, page };
};
const openOne = async () => {
  const r = await open();
  await go(r.page, "^inspections");
  await wait(900);
  await r.page.evaluate(() => document.querySelector(".insp-row")?.click());
  await wait(900);
  return r;
};

try {
  console.log("\n-- it is there for an account that keeps buildings --");
  {
    const { ctx, page } = await open();
    t.ck("Inspections is in the nav",
      (await nav(page)).some((x) => /^inspections/i.test(x)), JSON.stringify(await nav(page)));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- and not for one that has no units to walk --");
  {
    // A general contractor works job to job and has no building list, so
    // there is nothing to inspect. Gated the same way Properties is, through
    // `hasProperties` rather than the role alone.
    KIND = "general_contractor";
    const { ctx, page } = await open();
    t.ck("a general contractor does not get it",
      !(await nav(page)).some((x) => /^inspections/i.test(x)), JSON.stringify(await nav(page)));
    await ctx.close().catch(() => {});
    KIND = "property_manager";
  }

  console.log("\n-- walking one --");
  {
    const { ctx, page } = await openOne();
    let v = await read(page);
    t.ck("all three rooms are drawn", v.rooms.length === 3, JSON.stringify(v.rooms.map((r) => r.name)));
    // THREE BUTTONS, NOT A DROPDOWN: every answer readable without opening
    // anything, which is what a phone in an empty flat needs.
    t.ck("each carries all three verdicts",
      v.rooms.every((r) => r.verdicts.length === 3), JSON.stringify(v.rooms[0]?.verdicts));
    t.ck("and the one that was marked shows which",
      v.rooms[0].on.join("") === "OK" && v.rooms[1].on.join("") === "Follow-up",
      JSON.stringify(v.rooms.map((r) => r.on)));
    // THE FOURTH STATE IS DRAWN AS NONE OF THE THREE, and the row is plain
    // rather than tinted: not got to yet is a to-do, not a problem.
    t.ck("an unwalked room has none of them on", v.rooms[2].on.length === 0,
      JSON.stringify(v.rooms[2].on));
    t.ck("and is drawn plain rather than as a fault",
      /st-unchecked/.test(v.rooms[2].cls) && !/st-fail|st-follow_up/.test(v.rooms[2].cls),
      v.rooms[2].cls);
    t.ck("while a flagged one is tinted", /st-follow_up/.test(v.rooms[1].cls), v.rooms[1].cls);

    t.ck("the tally names what is left rather than only counting",
      /not checked/i.test(v.stats) && /flagged/i.test(v.stats), v.stats);

    // A DISABLED CONTROL WITH NO REASON BESIDE IT is indistinguishable from a
    // broken one, which this repository has already paid for once.
    const finish = v.acts.find((a) => /finish/i.test(a.label));
    t.ck("Finish is dead while a room is unwalked", finish && finish.off === true, JSON.stringify(finish));
    t.ck("and the reason is on the screen beside it",
      /still to mark/i.test(v.note), v.note);

    // The suggested list is a datalist on a free-text box: offered, never
    // imposed, because every building has a room the list has not heard of.
    t.ck("the standard rooms are suggested", v.suggestions.includes("Walls and floors")
      && v.suggestions.includes("Bathroom 1"), String(v.suggestions.length));
    t.ck("on a box somebody can type anything into", v.addIsFreeText === true);

    // Marking the last room: one tap, and the request carries the status.
    sent.length = 0;
    await page.evaluate(() => {
      const row = document.querySelectorAll(".insp-room")[2];
      [...row.querySelectorAll(".insp-v")].find((b) => /^OK$/i.test(b.innerText.trim()))?.click();
    });
    await wait(900);
    t.ck("one tap sends one patch", sent.length === 1, JSON.stringify(sent));
    t.ck("carrying the verdict", sent[0]?.body?.status === "ok", JSON.stringify(sent[0]));
    v = await read(page);
    t.ck("and Finish comes alive", v.acts.find((a) => /finish/i.test(a.label))?.off === false,
      JSON.stringify(v.acts));
    t.ck("with the reason gone from beside it", !/still to mark/i.test(v.note), v.note);
    await ctx.close().catch(() => {});
  }

  console.log("\n-- adding a room the list has never heard of --");
  {
    DETAIL = { ...DETAIL, rooms: DETAIL.rooms.slice(0, 3) };
    const { ctx, page } = await openOne();
    sent.length = 0;
    await page.evaluate(() => {
      const el = document.querySelector(".insp-add input");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, "Boat shed");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".insp-add button")]
      .find((b) => /add room/i.test(b.innerText))?.click());
    await wait(900);
    t.ck("it is sent as typed", sent[0]?.body?.name === "Boat shed", JSON.stringify(sent[0]));
    const v = await read(page);
    t.ck("and lands unchecked rather than OK",
      v.rooms[3] && v.rooms[3].on.length === 0, JSON.stringify(v.rooms[3]));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- raising the work --");
  {
    const { ctx, page } = await openOne();
    sent.length = 0;
    await page.evaluate(() => [...document.querySelectorAll(".pd-acts button")]
      .find((b) => /raise a job/i.test(b.innerText))?.click());
    await wait(700);
    const modal = await page.evaluate(() => ({
      open: !!document.querySelector(".modal"),
      // It names the rooms rather than counting them: "2 flagged" does not
      // say which two, and which two is what decides the trade.
      flagged: [...document.querySelectorAll(".insp-flagged li")]
        .map((li) => li.innerText.replace(/\s+/g, " ").trim()),
      // Nothing reaches a contractor until somebody assigns one, said on the
      // screen that raises it.
      note: (document.querySelector(".modal .panel-note")?.innerText || "").replace(/\s+/g, " ").trim(),
      go: [...document.querySelectorAll(".modal .form-actions button")]
        .map((b) => ({ label: b.innerText.trim(), off: b.disabled })),
    }));
    t.ck("the modal opens", modal.open === true, JSON.stringify(modal));
    t.ck("naming the flagged room", modal.flagged.some((x) => /Walls and floors/.test(x)),
      JSON.stringify(modal.flagged));
    t.ck("and saying nothing reaches a contractor yet",
      /nothing reaches a contractor until you assign/i.test(modal.note), modal.note);
    t.ck("and it will not go without a trade",
      modal.go.find((b) => /raise the job/i.test(b.label))?.off === true, JSON.stringify(modal.go));
    t.ck("and nothing has been sent", sent.length === 0, JSON.stringify(sent));

    await page.evaluate(() => [...document.querySelectorAll(".modal .chip")]
      .find((b) => /plumbing/i.test(b.innerText))?.click());
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")]
      .find((b) => /raise the job/i.test(b.innerText))?.click());
    await wait(1200);
    t.ck("picking a trade and pressing sends one request",
      sent.filter((x) => /\/job$/.test(x.path)).length === 1, JSON.stringify(sent));
    t.ck("carrying the trade", sent.find((x) => /\/job$/.test(x.path))?.body?.trades?.includes("plumbing"),
      JSON.stringify(sent.find((x) => /\/job$/.test(x.path))));
    // It lands on the Jobs screen, which is where the work now is.
    t.ck("and it lands on Jobs",
      await page.evaluate(() => !!document.querySelector(".ss-main")
        && /jobs/i.test(document.querySelector("nav button.on")?.innerText || "")),
      await page.evaluate(() => document.querySelector("nav button.on")?.innerText));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- a finished one is readable and not writable --");
  {
    DETAIL = { ...DETAIL, status: "finished", finishedAt: "2026-10-02 01:00:00",
      rooms: DETAIL.rooms.map((r) => ({ ...r, status: r.status === "unchecked" ? "ok" : r.status })) };
    const { ctx, page } = await openOne();
    const v = await read(page);
    t.ck("every room is still shown", v.rooms.length >= 3, String(v.rooms.length));
    t.ck("with its verdict", v.rooms[1].on.join("") === "Follow-up", JSON.stringify(v.rooms[1].on));
    // AN INSPECTION IS EVIDENCE MONTHS LATER. A record that can be edited
    // afterwards is one the other side can say was edited afterwards.
    t.ck("but nothing on it can be typed into",
      v.rooms.every((r) => r.canEdit === false), JSON.stringify(v.rooms.map((r) => r.canEdit)));
    t.ck("and the note it carried is still readable",
      /Nail hole repair/.test(v.rooms[1].note), v.rooms[1].note);
    t.ck("there is no Finish button on it",
      !v.acts.some((a) => /finish/i.test(a.label)), JSON.stringify(v.acts));
    t.ck("and no Add room box", !v.addIsFreeText, String(v.addIsFreeText));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- nothing threw --");
  {
    const { ctx, page } = await openOne();
    t.ck("no \\uXXXX escape reached the page",
      !/\\u[0-9a-fA-F]{4}/.test(await page.evaluate(() => document.body.innerText)));
    await ctx.close().catch(() => {});
  }

} finally {
  await browser.close().catch(() => {});
  web.close(); api.close();
}

t.done();
