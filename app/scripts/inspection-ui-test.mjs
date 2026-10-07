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

const PARA = "Nail-hole repair and paint through the walls and floors.";
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

// Who the finished report may be sent to, and who has had it. Held apart
// from DETAIL because the server hands these two fields to a TEAM seat only
// -- who else was told is the account's own record and not an owner's to
// collect -- so the stub has to be able to withhold them the way the route
// does.
// Whether there is a model key at all. Held apart from DETAIL so the suite
// can drive the no-key branch, where the button must not be drawn: a press
// that answers 503 is a dead end with no explanation on it.
let AI = true;
// A rewrite the server refuses, with the key still in place. Held apart from
// AI because no key means no button at all, so it cannot produce the state
// this is for: the paragraph still up with the reason on it.
let SUMFAIL = false;
let RECIPIENTS = [
  { id: "u_own", name: "Marion Oakes", email: "marion@oakes.test" },
  { id: "u_own2", name: "Rhys Vance", email: "rhys@vance.test" },
];
let SENDS = [];

const sent = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === "/api/inspections" && method === "GET") return [200, LIST()];
  if (path === "/api/inspections/insp_1" && method === "GET") {
    // The route gives an owner the inspection and nothing about the audience.
    // `aiDrafts` is "SubSub has a model key", which is one fact and is read by
    // the summary button as well as the drafting one. A second field with the
    // same value in it would be two records of one.
    return [200, ROLE === "owner" ? DETAIL
      : { ...DETAIL, recipients: RECIPIENTS, sends: SENDS, aiDrafts: AI }];
  }
  if (path === "/api/inspections/insp_1/send" && method === "POST") {
    sent.push({ path, body });
    const to = RECIPIENTS.filter((u) => (body.userIds || []).includes(u.id));
    if (!to.length) return [400, { error: "no_recipients" }];
    SENDS = [...to.map((u) => ({ userId: u.id, at: new Date().toISOString(), emailed: true })), ...SENDS];
    return [200, { ok: true, sent: to.map((u) => ({ userId: u.id, name: u.name, emailed: true })),
      recipients: RECIPIENTS, sends: SENDS }];
  }
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
    DETAIL = body.finish ? { ...DETAIL, status: "finished" } : { ...DETAIL, ...body };
    return [200, DETAIL];
  }
  if (path === "/api/inspections/insp_1/job" && method === "POST") {
    sent.push({ path, body });
    // The raise writes the summary itself -- *"combine the comments and
    // summarize automatically"* -- so there is no press for the first one.
    // Driven as a FAILED write here, because that is the state the panel
    // exists for and the state the suite can then press out of.
    DETAIL = { ...DETAIL, jobId: "job_new" };
    return [201, { ok: true, jobId: "job_new", flagged: 1,
      summary: null, summaryError: "ai_unavailable" }];
  }
  if (path === "/api/inspections/insp_1/summary" && method === "POST") {
    sent.push({ path, body });
    if (!AI) return [503, { error: "ai_not_configured" }];
    if (SUMFAIL) return [502, { error: "ai_unavailable" }];
    DETAIL = { ...DETAIL, summary: { text: PARA, model: "claude-haiku-4-5",
      writtenAt: "2026-10-02T09:00:00.000Z", stale: false } };
    return [200, { ok: true, summary: DETAIL.summary }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct(KIND)];
  if (path === "/api/account") return [200, acct(KIND)];
  if (path === "/api/account-users" && method === "POST") {
    // The real route writes the seat and its property scope immediately, so
    // the stub does too -- an owner is a recipient before they have set a
    // password, which is the whole reason the button can be pressed here.
    sent.push({ path, body });
    RECIPIENTS = [{ id: "u_new", name: body.name, email: body.email }];
    return [201, { id: "u_new", name: body.name, email: body.email, role: "owner",
      propertyIds: body.propertyIds || [], hasLogin: false }];
  }
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
    // THE WALK IS DONE AND A ROOM IS FLAGGED, so the next step is the job,
    // not the finish: Raise a job is the one way on and Finish is not drawn.
    // This used to assert Finish came alive here, which was the old rule.
    t.ck("the next step is raising the job, so Finish is not drawn",
      !v.acts.some((a) => /finish/i.test(a.label)) && v.acts.some((a) => /Raise a job/.test(a.label)),
      JSON.stringify(v.acts));
    t.ck("and the screen says why", /Raise the job for the flagged room/.test(v.note), v.note);
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

  // The three blocks below rewrite the fixture, so it is put back afterwards
  // — a suite whose later assertions depend on what an earlier one left is a
  // suite that fails for the wrong reason.
  const FIXTURE = JSON.parse(JSON.stringify(DETAIL));

  console.log("\n-- THE HEADER IS EDITABLE WHILE IT IS A DRAFT --");
  {
    // `PATCH /api/inspections/:id` has taken the kind, the unit, the name and
    // the date since it was written, and nothing in the browser ever sent one
    // — only `{finish:true}`. So a move-out picked by mistake, or a unit typed
    // wrong, could only be fixed by deleting the inspection. Reported as "does
    // not allow me to select move in or out" and "doesn't allow me to edit
    // once I've created", which are the same missing form.
    DETAIL = { ...DETAIL, status: "draft", kind: "move_out", unit: "5c" };
    const { ctx, page } = await openOne();
    let h = await page.evaluate(() => ({
      kinds: [...document.querySelectorAll(".insp-kind button")]
        .map((b) => ({ label: b.innerText.trim(), on: b.classList.contains("on") })),
      fields: [...document.querySelectorAll(".insp-facts input")].map((i) => i.value),
    }));
    t.ck("both walks are offered", h.kinds.length === 2, JSON.stringify(h.kinds));
    t.ck("with the one it is marked", h.kinds.filter((k) => k.on).length === 1
      && h.kinds.find((k) => k.on).label === "Move-out", JSON.stringify(h.kinds));
    t.ck("and the unit, the name and the date are all there",
      h.fields.length === 3 && h.fields[0] === "5c", JSON.stringify(h.fields));

    sent.length = 0;
    await page.evaluate(() => [...document.querySelectorAll(".insp-kind button")]
      .find((b) => /move-in/i.test(b.innerText))?.click());
    await wait(900);
    t.ck("tapping the other walk sends it",
      sent.length === 1 && sent[0].body.kind === "move_in", JSON.stringify(sent));
    h = await page.evaluate(() => [...document.querySelectorAll(".insp-kind button")]
      .map((b) => ({ label: b.innerText.trim(), on: b.classList.contains("on") })));
    t.ck("and the screen follows", h.find((k) => k.on)?.label === "Move-in", JSON.stringify(h));

    // Typed fields save on blur, not per keystroke.
    sent.length = 0;
    await page.evaluate(() => {
      const el = document.querySelectorAll(".insp-facts input")[0];
      el.focus();
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, "5C"); el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    t.ck("typing alone sends nothing", sent.length === 0, JSON.stringify(sent));
    await page.evaluate(() => document.querySelectorAll(".insp-facts input")[0].blur());
    await wait(900);
    t.ck("leaving the box saves it", sent.length === 1 && sent[0].body.unit === "5C",
      JSON.stringify(sent));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- AND A ROOM CAN BE ADDED WITHOUT TYPING --");
  {
    // A `datalist` is not a list on an iPad: the copy said "pick one from the
    // list" over an `<input list=…>`, which iOS Safari offers nothing for. On
    // the one device this product is run from, the screen promised something
    // that was not there.
    DETAIL = { ...DETAIL, status: "draft", kind: "move_out",
      rooms: [{ id: "r1", name: "Kitchen", status: "ok", note: "", position: 0, photos: [] }] };
    const { ctx, page } = await openOne();
    let v = await page.evaluate(() => ({
      chips: [...document.querySelectorAll(".insp-suggest .chip")]
        .map((b) => b.innerText.replace(/\s+/g, " ").trim()),
      box: !!document.querySelector(".insp-add input"),
      addOff: document.querySelector(".insp-add button")?.disabled,
    }));
    t.ck("the standard rooms are tappable", v.chips.length > 10, String(v.chips.length));
    t.ck("and a room already walked is not offered again",
      !v.chips.some((c) => /^\+?\s*Kitchen$/i.test(c)), JSON.stringify(v.chips.slice(0, 6)));
    t.ck("the free-text box is still there for anything else", v.box === true);

    sent.length = 0;
    await page.evaluate(() => [...document.querySelectorAll(".insp-suggest .chip")]
      .find((b) => /Bathroom 1/.test(b.innerText))?.click());
    await wait(1000);
    t.ck("ONE tap adds it", sent.length === 1 && sent[0].body.name === "Bathroom 1",
      JSON.stringify(sent));
    v = await page.evaluate(() => [...document.querySelectorAll(".insp-suggest .chip")]
      .map((b) => b.innerText.replace(/\s+/g, " ").trim()));
    t.ck("and it comes off the list", !v.some((c) => /Bathroom 1/.test(c)),
      JSON.stringify(v.slice(0, 6)));

    // A DEAD BUTTON WITH NOTHING BESIDE IT is indistinguishable from a broken
    // one, which is exactly how the empty box read: press, nothing, silence.
    t.ck("Add room is not disabled over an empty box",
      (await page.evaluate(() => document.querySelector(".insp-add button")?.disabled)) === false);
    sent.length = 0;
    await page.evaluate(() => document.querySelector(".insp-add button").click());
    await wait(600);
    const said = await page.evaluate(() => ({
      err: (document.querySelector(".insp-detail .billing-err")?.innerText || "").trim(),
      focused: document.activeElement === document.querySelector(".insp-add input"),
    }));
    t.ck("pressing it empty says what it wants", /type a room name/i.test(said.err), said.err);
    t.ck("and puts the cursor in the box", said.focused === true, JSON.stringify(said));
    t.ck("without sending anything", sent.length === 0, JSON.stringify(sent));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- AND BACK CLOSES THE INSPECTION RATHER THAN LEAVING SUBSUB --");
  {
    // The detail view is state, not a route, so Back walked out of the app —
    // on an iPad the first thing anybody reaches for, landing on whatever the
    // tab held before. Reported as "can't go back", with a Cloudflare consent
    // screen attached.
    DETAIL = { ...DETAIL, status: "draft" };
    const { ctx, page } = await openOne();
    t.ck("the inspection is open", await page.evaluate(() => !!document.querySelector(".insp-detail")));
    await page.goBack();
    await wait(1000);
    const after = await page.evaluate(() => ({
      detail: !!document.querySelector(".insp-detail"),
      list: !!document.querySelector(".insp-list, .dash-empty"),
      here: location.host,
    }));
    t.ck("Back shuts it", after.detail === false, JSON.stringify(after));
    t.ck("and lands on the list rather than out of SubSub",
      after.list === true && /soundpm/.test(after.here), JSON.stringify(after));
    await ctx.close().catch(() => {});
  }

  DETAIL = JSON.parse(JSON.stringify(FIXTURE));

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
    // IT OPENS READY NOW, which is the change: the note on the flagged room
    // reads "Nail hole repair and paint", so Painting is already ticked and
    // the button is live. That it will not go with NOTHING ticked is pinned
    // in the suggestion block below, where the grid can be emptied -- here
    // the property is that the suggestion did not also PRESS anything.
    t.ck("the note already picked a trade, so it opens ready",
      modal.go.find((b) => /raise the job/i.test(b.label))?.off === false, JSON.stringify(modal.go));
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
    // 062, SECOND PASS. *"A move in doesn't necessarily need a tenant in the
    // unit, only if required"* -- so the walk pre-answers who has to be there
    // and this form settles it. Asserted on the BODY, because the picker can
    // draw perfectly and the answer never leave the screen, which is the
    // whole shape of the bug this suite exists to catch one field along.
    t.ck("and the access answer the form settled",
      ["tenant", "manager", "none"].includes(
        sent.find((x) => /\/job$/.test(x.path))?.body?.access),
      JSON.stringify(sent.find((x) => /\/job$/.test(x.path))?.body));
    // It lands on the Jobs screen, which is where the work now is.
    t.ck("and it lands on Jobs",
      await page.evaluate(() => !!document.querySelector(".ss-main")
        && /jobs/i.test(document.querySelector("nav button.on")?.innerText || "")),
      await page.evaluate(() => document.querySelector("nav button.on")?.innerText));
    await ctx.close().catch(() => {});
  }

  console.log("\n-- the summary the work order carries, and the way out of a failed one --");
  {
    // THE PANEL IS NOT DRAWN BEFORE THERE IS A JOB TO CARRY IT. Asserted in
    // the SAME place as the positive case: raising the job writes the
    // summary, so a Write-one button beforehand would be a control for a
    // document that does not exist yet -- and a check written only after the
    // raise cannot tell that from a panel drawn always.
    DETAIL = JSON.parse(JSON.stringify(FIXTURE));
    const read = (page) => page.evaluate(() => {
      const el = document.querySelector(".insp-sum");
      if (!el) return null;
      const btn = [...el.querySelectorAll("button")].map((b) => b.innerText.trim());
      const tone = (sel) => {
        const n = el.querySelector(sel);
        return n ? getComputedStyle(n).color : null;
      };
      return {
        text: (el.querySelector(".insp-sumt")?.innerText || "").trim(),
        none: (el.querySelector(".prop-none")?.innerText || "").replace(/\s+/g, " ").trim(),
        // SCOPED. `.fld-note` is the generic hint class and other blocks on
        // this screen are read by it, so a bare selector here finds whichever
        // exists -- the trap this project keeps paying for. A mutation run
        // showed this panel's blurb satisfying an assertion about the Finish
        // hint the moment the panel appeared where it should not.
        notes: [...el.querySelectorAll(".insp-sumnote")].map((n) => n.innerText.replace(/\s+/g, " ").trim()),
        // ITS OWN CLASS AND ITS OWN COLOUR. `fld-err` is red and means "this
        // did not work", which the save error below uses; a paragraph that is
        // only behind the notes is amber.
        stale: (el.querySelector(".insp-sumstale")?.innerText || "").replace(/\s+/g, " ").trim(),
        staleTone: tone(".insp-sumstale"),
        err: (el.querySelector(".fld-err")?.innerText || "").replace(/\s+/g, " ").trim(),
        errTone: tone(".fld-err"),
        btn,
      };
    });
    {
      const { ctx, page } = await openOne();
      t.ck("the inspection really opened",
        await page.evaluate(() => !!document.querySelector(".insp-detail")));
      t.ck("and with no job raised there is no summary panel",
        (await read(page)) === null, JSON.stringify(await read(page)));
      await ctx.close().catch(() => {});
    }

    // THE FAILED WRITE, which is the state the panel exists for: the raise
    // answered `summaryError`, so the work order carries the rooms and no
    // paragraph, and without a way back it would stay that way for ever.
    DETAIL = { ...JSON.parse(JSON.stringify(FIXTURE)), jobId: "job_new" };
    {
      const { ctx, page } = await openOne();
      sent.length = 0;
      const before = await read(page);
      t.ck("a raised job with no summary draws the panel", !!before, JSON.stringify(before));
      // SAYING WHEN ONE ARRIVES RATHER THAN REPORTING AN ABSENCE. The old
      // copy read *"No summary was written. The work order carries the
      // rooms, the notes and the photos as usual"* and came off on request:
      // it is an explanation of a non-event, and it was wrong besides, since
      // one is written when the WALK is finished now and not only when a job
      // is raised.
      t.ck("the empty state does not report a non-event",
        !/No summary was written/i.test(before?.none || ""), before?.none);
      // It names the next thing instead. This fixture is still a DRAFT, so
      // the honest answer is that finishing writes one -- which is the half
      // the old copy had wrong as well: it said a summary arrives when a job
      // is raised, and the walk being finished is the earlier moment.
      t.ck("it names when one arrives", /finish the inspection/i.test(before?.none || ""),
        before?.none);
      // AND THE BLURB IS GONE, on request: *"remove this language which
      // doesn't make any sense"*. Three clauses of mechanism in front of
      // somebody who can see the paragraph itself directly below it.
      //
      // Both halves are pinned, because a later pass reading the guarantee in
      // the second one would want to restore it. The guarantee is REAL and is
      // kept where it is checkable -- `contractorInspectionShape` drops the
      // drafts and `test:inspectsummary` asserts they never reach the wire,
      // on all three doors that write a paragraph. A screen does not owe the
      // reader an account of how a thing was made.
      t.ck("no blurb explains what the paragraph is for",
        !(before?.notes || []).some((n) => /before the room-by-room list/i.test(n)),
        JSON.stringify(before?.notes));
      t.ck("nor recites the drafts guarantee at them",
        !(before?.notes || []).some((n) => /never from a draft nobody kept/i.test(n)),
        JSON.stringify(before?.notes));
      t.ck("with one press to write it", (before?.btn || []).join() === "Write one",
        JSON.stringify(before?.btn));

      await page.evaluate(() => [...document.querySelectorAll(".insp-sum button")]
        .find((b) => /write one/i.test(b.innerText))?.click());
      await wait(900);
      t.ck("pressing it asks the server once",
        sent.filter((x) => /\/summary$/.test(x.path)).length === 1, JSON.stringify(sent));
      const after = await read(page);
      t.ck("and the paragraph is drawn", after?.text === PARA, after?.text);
      t.ck("with the press now offering a rewrite rather than a write",
        (after?.btn || []).join() === "Rewrite it", JSON.stringify(after?.btn));
      await ctx.close().catch(() => {});
    }

    // STALE IS SAID, NOT QUIETLY REWRITTEN. A job can be raised from an
    // unfinished inspection, so the notes move on; re-asking on every read
    // would spend money on a press nobody made and change a document somebody
    // may already have quoted from.
    DETAIL = { ...JSON.parse(JSON.stringify(FIXTURE)), jobId: "job_new",
      summary: { text: PARA, model: "claude-haiku-4-5",
        writtenAt: "2026-10-02T09:00:00.000Z", stale: true } };
    {
      const { ctx, page } = await openOne();
      const v = await read(page);
      t.ck("a stale summary is still shown", v?.text === PARA, v?.text);
      t.ck("and says the notes have changed since it was written",
        /notes have changed/i.test(v?.stale || ""), v?.stale);
      t.ck("and which of the two is current",
        /rooms are current/i.test(v?.stale || ""), v?.stale);
      t.ck("with the press offering a rewrite", (v?.btn || []).join() === "Rewrite it",
        JSON.stringify(v?.btn));

      // A REFUSED REWRITE LEAVES THE PARAGRAPH UP WITH THE REASON ON IT.
      // Closing on a failure, or blanking what is there, would read as a
      // success -- the rule `ConfirmRemove` follows.
      SUMFAIL = true;
      await page.evaluate(() => [...document.querySelectorAll(".insp-sum button")]
        .find((b) => /rewrite/i.test(b.innerText))?.click());
      await wait(900);
      const bad = await read(page);
      t.ck("a refused rewrite keeps the paragraph that is there", bad?.text === PARA, bad?.text);
      t.ck("and says why, in SubSub's own words",
        /Couldn't reach the summarising service/i.test(bad?.err || ""), bad?.err);
      // AND THE TWO MESSAGES ARE NOT ONE COLOUR. Both are on screen here, so
      // this is the only state either can be compared against the other in --
      // a check with one of them absent passes whatever the colours are.
      t.ck("and a stale paragraph is not drawn as a failure",
        !!bad?.staleTone && !!bad?.errTone && bad.staleTone !== bad.errTone,
        `${bad?.staleTone} vs ${bad?.errTone}`);
      SUMFAIL = false;
      await ctx.close().catch(() => {});
    }

    // NO KEY, NO BUTTON. A press that answers 503 is a dead end with no
    // explanation on it -- and withholding one that would have worked is the
    // same lie, which is why both branches are driven here.
    AI = false;
    {
      const { ctx, page } = await openOne();
      const v = await read(page);
      t.ck("with no model key the panel is still drawn", !!v, JSON.stringify(v));
      t.ck("but offers no press at all", (v?.btn || []).length === 0, JSON.stringify(v?.btn));
      t.ck("and says why instead",
        (v?.notes || []).some((n) => /isn't switched on/i.test(n)), JSON.stringify(v?.notes));
      await ctx.close().catch(() => {});
    }
    AI = true;

    // NOTHING TO COMBINE is the ordinary state of a half-walked inspection
    // rather than a problem, so it is named rather than drawn as a dead
    // button -- a disabled control with nothing beside it is
    // indistinguishable from a broken one, which this project has paid for.
    DETAIL = { ...JSON.parse(JSON.stringify(FIXTURE)), jobId: "job_new",
      rooms: [{ id: "r1", name: "Kitchen", status: "fail", note: "", position: 0, photos: [] }] };
    {
      const { ctx, page } = await openOne();
      const v = await read(page);
      t.ck("a flagged room with nothing written on it offers no press",
        !!v && (v.btn || []).length === 0, JSON.stringify(v));
      t.ck("and says what to write first",
        (v?.notes || []).some((n) => /nothing to combine yet/i.test(n)), JSON.stringify(v?.notes));
      await ctx.close().catch(() => {});
    }
    DETAIL = JSON.parse(JSON.stringify(FIXTURE));
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

  console.log("\n-- sending the finished report to the building's owner --");
  {
    // READ THE PANEL rather than looking for the component. A static check
    // that `InspectionSend` is mounted passes with the names never drawn and
    // the button never wired, which is the assertion-that-cannot-fail shape
    // this repository keeps paying for.
    const panel = (page) => page.evaluate(() => {
      const el = document.querySelector(".insp-send");
      if (!el) return null;
      return {
        heading: (el.querySelector(".form-sec")?.innerText || "").replace(/\s+/g, " ").trim(),
        note: (el.querySelector(".panel-note")?.innerText || "").replace(/\s+/g, " ").trim(),
        who: [...el.querySelectorAll(".insp-to li")].map((li) => ({
          name: (li.querySelector("b")?.innerText || "").trim(),
          email: (li.querySelector(".dr-meta")?.innerText || "").trim(),
          ticked: !!li.querySelector("input[type=checkbox]")?.checked,
          state: (li.querySelector(".tn-chip")?.innerText || "").replace(/\s+/g, " ").trim(),
        })),
        button: (el.querySelector(".insp-send-act button")?.innerText || "").replace(/\s+/g, " ").trim(),
        buttonOff: !!el.querySelector(".insp-send-act button")?.disabled,
        notes: [...el.querySelectorAll(".fld-note")].map((n) => n.innerText.replace(/\s+/g, " ").trim()),
      };
    });

    // A DRAFT GOES NOWHERE, and the panel is not there at all rather than
    // being there with a dead button: a half-walked document says nothing
    // while looking like it says everything.
    DETAIL = JSON.parse(JSON.stringify(FIXTURE));
    SENDS = [];
    {
      const { ctx, page } = await openOne();
      t.ck("a draft offers no send at all", (await panel(page)) === null);
      await ctx.close().catch(() => {});
    }

    const finished = () => {
      DETAIL = { ...JSON.parse(JSON.stringify(FIXTURE)), status: "finished",
        finishedAt: "2026-10-02 01:00:00" };
      DETAIL.rooms = DETAIL.rooms.map((r) => ({ ...r, status: r.status === "unchecked" ? "ok" : r.status }));
    };

    {
      finished(); SENDS = []; sent.length = 0;
      const { ctx, page } = await openOne();
      let v = await panel(page);
      t.ck("a finished one offers it", !!v, JSON.stringify(v));
      t.ck("named for what it does", /send it to the owner/i.test(v.heading), v.heading);
      // WHAT SENDING ACTUALLY DOES. The owner can already open a finished
      // report from their own seat, so the email is the telling and not the
      // access -- and nothing is attached, because a copy starts going stale
      // the moment it is sent.
      t.ck("and it says they read it in their own account",
        /own account/i.test(v.note) && /link/i.test(v.note), v.note);
      t.ck("both owners of the building are listed",
        v.who.map((w) => w.name).join("|") === "Marion Oakes|Rhys Vance",
        JSON.stringify(v.who.map((w) => w.name)));
      t.ck("with the address each would go to",
        v.who[0].email === "marion@oakes.test", JSON.stringify(v.who[0]));
      // DEFAULTED TO WHOEVER HAS NOT HAD IT, which is the press somebody
      // opened this to make.
      t.ck("nobody has had it, so everybody is ticked",
        v.who.every((w) => w.ticked === true), JSON.stringify(v.who.map((w) => w.ticked)));
      t.ck("and each row says so", v.who.every((w) => /not sent/i.test(w.state)),
        JSON.stringify(v.who.map((w) => w.state)));
      t.ck("the button offers a first send", /send the report/i.test(v.button), v.button);

      // A PANEL APPEARING IS NOT THE PROPERTY UNDER TEST. Nothing may leave
      // until somebody presses, so the requests are counted either side.
      t.ck("nothing has been sent by drawing it",
        sent.filter((x) => /\/send$/.test(x.path)).length === 0, JSON.stringify(sent));
      await page.evaluate(() => document.querySelector(".insp-send-act button")?.click());
      await wait(1400);
      t.ck("pressing it sends exactly one request",
        sent.filter((x) => /\/send$/.test(x.path)).length === 1, JSON.stringify(sent));
      t.ck("carrying both ids",
        (sent.find((x) => /\/send$/.test(x.path))?.body?.userIds || []).sort().join(",") === "u_own,u_own2",
        JSON.stringify(sent.find((x) => /\/send$/.test(x.path))?.body));

      // AND IT RE-READS THE INSPECTION rather than patching the row in place.
      // Who has it and when is the server's answer -- a locally invented
      // "Sent" disagrees with it the moment a mail fails.
      v = await panel(page);
      t.ck("both rows now read as sent", v.who.every((w) => /^sent/i.test(w.state)),
        JSON.stringify(v.who.map((w) => w.state)));
      t.ck("and the button offers it again rather than a first send",
        /again/i.test(v.button), v.button);
      t.ck("it names who it went to", v.notes.some((n) => /Marion Oakes/.test(n) && /Rhys Vance/.test(n)),
        JSON.stringify(v.notes));
      await ctx.close().catch(() => {});
    }

    {
      // ONE ALREADY HAS IT. The default is the one who does not, because
      // re-sending to somebody who has it is not what this press is for --
      // and the row that has it says when.
      finished();
      SENDS = [{ userId: "u_own", at: "2026-10-02 02:00:00", emailed: true }];
      const { ctx, page } = await openOne();
      const v = await panel(page);
      t.ck("the one who has it is not ticked", v.who.find((w) => w.name === "Marion Oakes").ticked === false,
        JSON.stringify(v.who));
      t.ck("the one who has not is", v.who.find((w) => w.name === "Rhys Vance").ticked === true,
        JSON.stringify(v.who));
      t.ck("and the sent row says when", /^sent /i.test(v.who[0].state), v.who[0].state);
      await ctx.close().catch(() => {});
    }

    {
      // A MAIL THAT DID NOT GO SAYS SO. A row reading "Sent" over an owner
      // who was never told is how somebody says they never got it while the
      // screen says they did.
      finished();
      SENDS = [{ userId: "u_own", at: "2026-10-02 02:00:00", emailed: false }];
      const { ctx, page } = await openOne();
      const v = await panel(page);
      t.ck("a failed mail is not drawn as sent",
        /not emailed/i.test(v.who[0].state) && !/^sent/i.test(v.who[0].state), v.who[0].state);
      await ctx.close().catch(() => {});
    }

    {
      // NOT A DISABLED SEND. With nobody to send to there is nothing to send,
      // and a dead Send says neither what is wrong nor what to do -- so the
      // one button there is, is the one that fixes it. This block used to pin
      // "no button at all" over a sentence pointing at another screen, which
      // is the dead end the block below now drives end to end; the property
      // that survives is that nothing offers to SEND.
      finished(); SENDS = []; RECIPIENTS = [];
      const { ctx, page } = await openOne();
      const v = await panel(page);
      t.ck("with no owner on the building the panel is still there", !!v, JSON.stringify(v));
      t.ck("nobody is listed, so nothing offers to send", v.who.length === 0
        && !/send/i.test(v.button), JSON.stringify({ who: v.who.length, b: v.button }));
      t.ck("and the one control is the way out of it",
        /add an owner/i.test(v.button), JSON.stringify(v.button));
      await ctx.close().catch(() => {});
      RECIPIENTS = [
        { id: "u_own", name: "Marion Oakes", email: "marion@oakes.test" },
        { id: "u_own2", name: "Rhys Vance", email: "rhys@vance.test" },
      ];
    }

    {
      // UNTICKING EVERYBODY NAMES THE REASON. The disabled condition is
      // wider than nothing, so it is said rather than left to be pressed.
      finished(); SENDS = [];
      const { ctx, page } = await openOne();
      await page.evaluate(() => [...document.querySelectorAll(".insp-to input[type=checkbox]")]
        .forEach((b) => { if (b.checked) b.click(); }));
      await wait(500);
      const v = await panel(page);
      t.ck("Send is dead with nobody ticked", v.buttonOff === true, JSON.stringify(v.button));
      t.ck("and the reason is beside it", v.notes.some((n) => /tick who/i.test(n)),
        JSON.stringify(v.notes));
      await ctx.close().catch(() => {});
    }

    console.log("\n-- and an owner reads it without a single write on the screen --");
    {
      // THE SCREEN FOLLOWS THE ROUTE. Every write route behind this screen is
      // admin/pm, so an owner offered Finish, Raise a job, Send or a room
      // form is a screen looser than the route -- the same lie as stricter,
      // paid for in a 403 after the press.
      finished(); SENDS = [{ userId: "u_own", at: "2026-10-02 02:00:00", emailed: true }];
      ROLE = "owner";
      const { ctx, page } = await openOne();
      const v = await read(page);
      t.ck("they can read every room", v.rooms.length >= 3, String(v.rooms.length));
      t.ck("with the verdicts and the notes",
        /Nail hole repair/.test(v.rooms[1].note), v.rooms[1].note);
      t.ck("and nothing on it can be typed into",
        v.rooms.every((r) => r.canEdit === false), JSON.stringify(v.rooms.map((r) => r.canEdit)));
      // SAID RATHER THAN CLAIMED: the next three are true of any FINISHED
      // inspection, so they hold for an admin too and `canEdit` cannot be
      // what makes them pass -- mutating it back leaves all three green. They
      // are here because this is the screen somebody reads, and the three
      // that do pin `canEdit` are Raise a job, the send panel and New
      // inspection below, each of which a finished inspection still offers.
      t.ck("no Finish", !v.acts.some((a) => /finish/i.test(a.label)), JSON.stringify(v.acts));
      t.ck("no Raise a job", !v.acts.some((a) => /raise a job/i.test(a.label)), JSON.stringify(v.acts));
      t.ck("no Add room", v.addIsFreeText === false);
      // AND NOT THE SEND PANEL, which is the one this change added: sending
      // the report on is the account's act, and who else was told is their
      // record rather than this owner's to read.
      t.ck("and no send panel", (await panel(page)) === null);
      t.ck("Close is still there, so it is not a dead end",
        v.acts.some((a) => /close/i.test(a.label)), JSON.stringify(v.acts));
      await ctx.close().catch(() => {});
    }

    {
      // The list is theirs to read and not theirs to add to.
      const { ctx, page } = await open();
      await go(page, "^inspections");
      await wait(900);
      const head = await page.evaluate(() => ({
        rows: document.querySelectorAll(".insp-row").length,
        add: [...document.querySelectorAll(".add-btn")].map((b) => b.innerText.trim()),
        blurb: (document.querySelector(".dash-hello p")?.innerText || "").replace(/\s+/g, " ").trim(),
      }));
      t.ck("an owner sees the inspection in the list", head.rows === 1, JSON.stringify(head));
      t.ck("and is not offered a new one", !head.add.some((x) => /new inspection/i.test(x)),
        JSON.stringify(head.add));
      await ctx.close().catch(() => {});
      ROLE = "admin";
    }

    {
      // AND THE SAME PLACE SAYS THE OTHER BRANCH, because a rule checked on
      // one branch is the diagonal coverage that left `hiresLabel` half
      // wired: a fix that hid the button from everybody would pass the
      // assertion above.
      const { ctx, page } = await open();
      await go(page, "^inspections");
      await wait(900);
      const add = await page.evaluate(() => [...document.querySelectorAll(".add-btn")]
        .map((b) => b.innerText.trim()));
      t.ck("a manager still gets New inspection", add.some((x) => /new inspection/i.test(x)),
        JSON.stringify(add));
      await ctx.close().catch(() => {});
    }
  }

  console.log("\n-- with no owner on the building it is not a dead end --");
  {
    // Reported against the sentence this replaces: "Add the owner on the
    // building in Properties and the finished report can go to them" is
    // directions, and directions with no control beside them are a dead end
    // wearing instructions -- the no-way-in failure this repository records
    // over and over, here in its smallest form.
    DETAIL = JSON.parse(JSON.stringify(FIXTURE));
    DETAIL = { ...DETAIL, status: "finished", finishedAt: "2026-10-02 01:00:00" };
    DETAIL.rooms = DETAIL.rooms.map((r) => ({ ...r, status: r.status === "unchecked" ? "ok" : r.status }));
    SENDS = []; RECIPIENTS = [];

    const { ctx, page } = await openOne();
    const empty = await page.evaluate(() => {
      const el = document.querySelector(".insp-send");
      return {
        note: (el?.querySelector(".panel-note")?.innerText || "").replace(/\s+/g, " ").trim(),
        btn: (el?.querySelector(".insp-send-act button")?.innerText || "").replace(/\s+/g, " ").trim(),
        rows: el ? el.querySelectorAll(".insp-to li").length : -1,
      };
    });
    t.ck("there is nobody to send to", empty.rows === 0, JSON.stringify(empty));
    t.ck("and a control rather than directions", /add an owner/i.test(empty.btn), JSON.stringify(empty));
    // AND IT DOES NOT SEND THEM SOMEWHERE ELSE TO DO IT. The old sentence
    // named another screen; naming one at all is the thing being fixed.
    t.ck("the copy no longer points at another screen",
      !/in Properties/i.test(empty.note), empty.note);
    t.ck("it says what adding them buys", /finished report/i.test(empty.note), empty.note);

    // PRESSING IT OPENS THE FORM, prefilled with the building and the role --
    // the two things pressing it has already said.
    sent.length = 0;
    await page.evaluate(() => document.querySelector(".insp-send-act button")?.click());
    await wait(700);
    const form = await page.evaluate(() => {
      const m = document.querySelector(".modal");
      return { open: !!m, heading: (m?.querySelector("h2")?.innerText || "").trim(),
        roles: [...(m?.querySelectorAll(".role-pick button") || [])]
          .map((b) => ({ label: b.innerText.replace(/\s+/g, " ").trim(), on: b.classList.contains("on") })) };
    });
    t.ck("the form opens", form.open === true, JSON.stringify(form));
    t.ck("nothing has been written by opening it", sent.length === 0, JSON.stringify(sent));
    t.ck("and the role is already owner",
      form.roles.some((r) => r.on && /owner/i.test(r.label)), JSON.stringify(form.roles));

    // ADD ONE, AND THE PANEL BEHIND IT CATCHES UP RATHER THAN STILL SAYING
    // NOBODY OWNS THIS BUILDING.
    await page.evaluate(() => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const ins = [...document.querySelectorAll(".modal input")];
      const fill = (el, v) => { if (!el) return; el.focus(); set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
      fill(ins[0], "Marion Oakes");
      fill(ins.find((i) => i.type === "email") || ins[1], "marion@oakes.test");
    });
    await wait(400);
    // The submit reads "Create user" -- the first version of this matched
    // Add/Save/Invite and silently clicked nothing, which reported as the
    // feature not working rather than as the selector being wrong.
    await page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")]
      .find((b) => /create user/i.test(b.innerText))?.click());
    await wait(1600);
    const after = await page.evaluate(() => {
      const el = document.querySelector(".insp-send");
      return {
        modal: !!document.querySelector(".modal"),
        who: [...(el?.querySelectorAll(".insp-to li") || [])].map((li) => ({
          name: (li.querySelector("b")?.innerText || "").trim(),
          ticked: !!li.querySelector("input[type=checkbox]")?.checked })),
        btn: (el?.querySelector(".insp-send-act button")?.innerText || "").replace(/\s+/g, " ").trim(),
        off: !!el?.querySelector(".insp-send-act button")?.disabled,
      };
    });
    t.ck("the owner was written", sent.some((x) => /account-users/.test(x.path)), JSON.stringify(sent));
    t.ck("and the panel now lists them", after.who.length === 1 && /Marion/.test(after.who[0]?.name || ""),
      JSON.stringify(after));
    // THE WHOLE POINT OF THE PRESS: add owner AND send, without a second
    // decision in between. A newcomer landing un-ticked would leave Send dead
    // over the person somebody had just added in order to send to.
    t.ck("ticked, because that is what the press was for", after.who[0]?.ticked === true,
      JSON.stringify(after.who));
    t.ck("and Send is live", after.off === false && /send the report/i.test(after.btn),
      JSON.stringify(after));
    await ctx.close().catch(() => {});

    RECIPIENTS = [
      { id: "u_own", name: "Marion Oakes", email: "marion@oakes.test" },
      { id: "u_own2", name: "Rhys Vance", email: "rhys@vance.test" },
    ];
    DETAIL = JSON.parse(JSON.stringify(FIXTURE));
  }

  console.log("\n-- you can see which ones are picked --");
  {
    // MEASURED, NOT READ OFF THE MARKUP. The class was in the JSX the whole
    // time and the stylesheet had no rule for it, so every static assertion
    // about `.chip.on` passed over a chip that looked exactly like its
    // neighbour. Only the computed pixels can tell the two apart.
    const look = (page, sel) => page.evaluate((s) => {
      const els = [...document.querySelectorAll(s)];
      return els.map((el) => {
        const cs = getComputedStyle(el);
        return { text: (el.innerText || "").replace(/\s+/g, " ").trim(),
          on: el.classList.contains("on"), bg: cs.backgroundColor, fg: cs.color,
          border: cs.borderTopColor, style: cs.borderTopStyle,
          pressed: el.getAttribute("aria-pressed") };
      });
    }, sel);

    DETAIL = JSON.parse(JSON.stringify(FIXTURE));
    DETAIL.rooms = [
      { id: "r1", name: "Dining room", status: "follow_up",
        note: "Messy a lot of people, dirt floors, trim needs to be repaired...",
        position: 0, photos: [] },
      { id: "r2", name: "Kitchen", status: "ok", note: "Looks great", position: 1, photos: [] },
    ];
    SENDS = [];

    {
      const { ctx, page } = await openOne();
      // THE KIND PICKER IS ONE CONTROL WITH TWO HALVES.
      const seg = await look(page, ".insp-kind.seg button");
      t.ck("move-in and move-out are two halves of one control", seg.length === 2,
        JSON.stringify(seg.map((x) => x.text)));
      const on = seg.find((x) => x.on), off = seg.find((x) => !x.on);
      t.ck("exactly one is picked", !!on && !!off, JSON.stringify(seg.map((x) => x.on)));
      t.ck("and it does not look like the other",
        on.bg !== off.bg && on.fg !== off.fg,
        JSON.stringify({ on: [on.bg, on.fg], off: [off.bg, off.fg] }));
      t.ck("the picked one is filled rather than merely tinted",
        on.bg !== "rgba(0, 0, 0, 0)" && on.fg === "rgb(255, 255, 255)",
        JSON.stringify([on.bg, on.fg]));
      // NOT COLOUR ALONE. About one man in twelve cannot read a green against
      // a grey, and this is pressed on a phone in daylight.
      // NOT COLOUR ALONE, and `innerText` cannot see an icon -- the first
      // version of this assertion compared string lengths and failed over a
      // tick that was there, which is a test measuring the wrong thing.
      const ticks = await page.evaluate(() => [...document.querySelectorAll(".insp-kind.seg button")]
        .map((b) => ({ on: b.classList.contains("on"), icon: !!b.querySelector("svg") })));
      t.ck("and it carries a tick as well as a colour",
        ticks.find((x) => x.on).icon === true && ticks.find((x) => !x.on).icon === false,
        JSON.stringify(ticks));
      t.ck("it says so to a screen reader too", on.pressed === "true" && off.pressed === "false",
        JSON.stringify([on.pressed, off.pressed]));

      // THE TRADES GRID, which is where this was reported.
      await page.evaluate(() => [...document.querySelectorAll(".pd-acts button")]
        .find((b) => /raise a job/i.test(b.innerText))?.click());
      await wait(700);
      const chips = await look(page, ".modal .chips .chip");
      t.ck("every trade is offered", chips.length >= 25, String(chips.length));
      const picked = chips.filter((c) => c.on), spare = chips.filter((c) => !c.on);
      t.ck("some are picked and some are not", picked.length > 0 && spare.length > 0,
        JSON.stringify({ on: picked.length, off: spare.length }));
      t.ck("a picked trade does not look like an unpicked one",
        picked[0].bg !== spare[0].bg && picked[0].fg !== spare[0].fg,
        JSON.stringify({ on: [picked[0].bg, picked[0].fg], off: [spare[0].bg, spare[0].fg] }));
      t.ck("and carries a tick",
        picked.every((c) => c.text.length > 0) && picked[0].pressed === "true",
        JSON.stringify(picked.map((c) => c.text)));

      // THE SUGGESTION ITSELF, from the reported note.
      t.ck("the notes picked the trades, so the grid opens with work in it",
        picked.map((c) => c.text.replace(/^.*?([A-Z])/, "$1")).join("|").length > 0
          && picked.length === 3, JSON.stringify(picked.map((c) => c.text)));
      t.ck("and they are the three the words name",
        ["Flooring", "Finish Carpentry", "Final Clean"]
          .every((n) => picked.some((c) => c.text.includes(n))),
        JSON.stringify(picked.map((c) => c.text)));

      // SAID OUT LOUD, with the word, because a tick nobody can account for
      // is one nobody will trust enough to leave on.
      const note = await page.evaluate(() =>
        (document.querySelector(".insp-sugg")?.innerText || "").replace(/\s+/g, " ").trim());
      t.ck("the screen says the ticks came from the notes", /suggested from your notes/i.test(note), note);
      t.ck("and names a word it read", /trim/i.test(note) && /floors/i.test(note), note);
      t.ck("and says they can be changed", /change/i.test(note), note);

      // IT IS A SUGGESTION AND NOT AN ANSWER: every one comes off.
      t.ck("nothing to reset while it matches the suggestion",
        await page.evaluate(() => !document.querySelector(".insp-reset")));
      await page.evaluate(() => {
        const c = [...document.querySelectorAll(".modal .chips .chip")].find((b) => b.classList.contains("on"));
        c?.click();
      });
      await wait(400);
      const after = await look(page, ".modal .chips .chip");
      t.ck("a suggested trade can be un-ticked",
        after.filter((c) => c.on).length === 2, JSON.stringify(after.filter((c) => c.on).map((c) => c.text)));
      // AND IT IS STILL VISIBLE AS A SUGGESTION once removed, so putting it
      // back does not mean re-reading the paragraph.
      const dropped = after.find((c) => !c.on && c.style === "dashed");
      t.ck("and still reads as one the notes asked for", !!dropped, JSON.stringify(dropped));
      t.ck("the way back appears once it differs",
        await page.evaluate(() => !!document.querySelector(".insp-reset")));
      await page.evaluate(() => document.querySelector(".insp-reset")?.click());
      await wait(400);
      t.ck("and puts the three back",
        (await look(page, ".modal .chips .chip")).filter((c) => c.on).length === 3);

      // A DEAD BUTTON WITH NO REASON BESIDE IT is indistinguishable from a
      // broken one -- which is what the screenshot showed, Raise the job pale
      // with nothing saying why.
      await page.evaluate(() => [...document.querySelectorAll(".modal .chips .chip")]
        .forEach((b) => { if (b.classList.contains("on")) b.click(); }));
      await wait(500);
      const dead = await page.evaluate(() => {
        const b = [...document.querySelectorAll(".modal .form-actions button")]
          .find((x) => /raise the job/i.test(x.innerText));
        return { off: !!b?.disabled,
          why: (document.querySelector(".insp-need")?.innerText || "").replace(/\s+/g, " ").trim() };
      });
      t.ck("with nothing ticked the button is dead", dead.off === true);
      t.ck("and the reason is beside it", /at least one trade/i.test(dead.why), dead.why);
      await ctx.close().catch(() => {});
    }

    {
      // THE OTHER BRANCH, in the same place: a note the rules do not
      // recognise suggests nothing and says nothing, rather than apologising
      // for itself on a screen somebody is trying to get through.
      DETAIL = JSON.parse(JSON.stringify(FIXTURE));
      DETAIL.rooms = [{ id: "r1", name: "Hallway", status: "fail", note: "needs attention",
        position: 0, photos: [] }];
      const { ctx, page } = await openOne();
      await page.evaluate(() => [...document.querySelectorAll(".pd-acts button")]
        .find((b) => /raise a job/i.test(b.innerText))?.click());
      await wait(700);
      const v = await page.evaluate(() => ({
        on: [...document.querySelectorAll(".modal .chips .chip.on")].length,
        sugg: !!document.querySelector(".insp-sugg"),
        reset: !!document.querySelector(".insp-reset"),
        why: (document.querySelector(".insp-need")?.innerText || "").trim(),
      }));
      t.ck("nothing recognised ticks nothing", v.on === 0, JSON.stringify(v));
      t.ck("and claims no reading it did not do", v.sugg === false, JSON.stringify(v));
      t.ck("nor offers a way back to a suggestion that was not made", v.reset === false);
      t.ck("and the empty grid still says what it wants", /at least one trade/i.test(v.why), v.why);
      await ctx.close().catch(() => {});
      DETAIL = JSON.parse(JSON.stringify(FIXTURE));
    }
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
