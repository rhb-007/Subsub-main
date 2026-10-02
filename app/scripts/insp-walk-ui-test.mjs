// THE INSPECTION SCREEN AS A WALKTHROUGH, AND THE HANDYMAN PICKER THAT GOES
// WITH IT.
//
// Driven in a browser because every claim worth making here is only true as
// drawn, and each of them passes a static check:
//
//   THE STRIP IS VISIBLE AS THREE STATES. The chip bug this project already
//   paid for was markup saying `on` with no stylesheet rule behind it --
//   correct source, invisible state, and only computed pixels can see it. Done,
//   current and still-to-come have to differ in pixels or the strip says
//   nothing.
//
//   THE CARD'S BUTTON DOES THE NEXT THING. An assertion that the component
//   mentions the step passes with the control wired to nothing. Pressing it is
//   the only proof.
//
//   AND IT POINTS RATHER THAN GATES, which is the central claim: this screen
//   is used standing in an empty flat, so a walkthrough that took a control
//   away would be worse than the sentence it replaced. With no rooms yet,
//   every one of them is still there and still enabled. That is only
//   checkable by reading what is on screen.
//
//   THE HANDYMAN PICKER IS REACHABLE. `roleLocked` made two pickers
//   unreachable for every seat on every account kind while the static
//   assertions on both of them passed the entire time -- so the two account
//   branches are driven, in the same place, because a fix checked on one
//   branch is the diagonal coverage that left `hiresLabel` half-wired.
//
//   node --no-warnings scripts/insp-walk-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";
import { INSPECTION_STEPS } from "../shared/inspection.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-inspwalk-test");
const WEB = 5319, API = 9017;
const t = tally();

// The knobs each block sets before opening the screen.
let KIND = "property_manager";
let ROOMS = [];
let STATUS = "draft";
let JOB_ID = null;
let OWNERS = [];     // the recipients the server would answer with
let SENDS = [];

const acct = () => ({
  id: "acc_x", name: "Sound Property Management", subdomain: "soundpm", kind: KIND,
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Christopher Lane", email: "chris@x.test", role: "admin" },
});
const USERS = () => [{ id: "usr_r", name: "Christopher Lane", email: "chris@x.test", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];

const verified = { status: "verified", checks: {}, limits: {} };
const SUB = () => ({
  id: "cmp_h", engagementId: "en_h", accountId: "acc_x",
  company: "Pike Maintenance", contact: "Dale Ruiz", phone: "(206)555-0144",
  email: "dale@pike.test", city: "Seattle", state: "WA", zip: "98101", license: "",
  licenseCheck: null, crews: [], coverage: { mode: "cities", cities: ["Seattle"] },
  available: true, unavailableDays: [], warranty: null,
  insurance: 0, bond: 0, contract: 0, w9: 1, docFiles: { w9: "w9.pdf" },
  notify: { email: true, sms: false }, docReview: { w9: verified },
  categories: ["plumbing"], caps: [], rating: null, ratedJobs: 0, accepted: 0, declined: 0,
  notes: "", status: "active", propertyIds: [], hasPortal: false, answersForItself: false,
  autoSchedule: false, engagedAs: "subcontractor",
  docs: { w9: { fileName: "w9.pdf", expiresOn: null } },
  docState: "missing", docAssignable: false, docSoonest: null,
});

const DETAIL = () => ({
  id: "insp_1", propertyId: "prop_1", unit: "3B", kind: "move_out",
  tenantName: "Tess Nguyen", inspectedOn: "2026-10-02", status: STATUS,
  finishedAt: STATUS === "finished" ? "2026-10-02 00:00:00" : null,
  jobId: JOB_ID, createdAt: "2026-10-02 00:00:00", aiDrafts: false,
  recipients: OWNERS, sends: SENDS, rooms: ROOMS,
});

const calls = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === "/api/inspections" && method === "GET") {
    return [200, [{ id: "insp_1", propertyId: "prop_1", unit: "3B", kind: "move_out",
      tenantName: "Tess Nguyen", inspectedOn: "2026-10-02", status: STATUS, jobId: JOB_ID,
      createdAt: "2026-10-02 00:00:00", rooms: ROOMS.length,
      flagged: ROOMS.filter((r) => r.status === "fail" || r.status === "follow_up").length,
      unchecked: ROOMS.filter((r) => !r.status).length, sent: SENDS.length }]];
  }
  if (path === "/api/inspections/insp_1" && method === "GET") return [200, DETAIL()];
  if (path === "/api/inspections/insp_1" && method === "PATCH") {
    calls.push({ what: "patch", body });
    if (body && body.finish) STATUS = "finished";
    return [200, { ok: true, ...DETAIL() }];
  }
  if (path === "/api/inspections/insp_1/rooms" && method === "POST") {
    calls.push({ what: "addRoom", body });
    ROOMS = [...ROOMS, { id: `r${ROOMS.length + 1}`, name: body.name, status: null,
      note: "", position: ROOMS.length, photos: [] }];
    return [200, { ok: true, rooms: ROOMS }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/account-users") return [200, USERS()];
  if (path === "/api/subs") return [200, [SUB()]];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_x",
    name: "Press Apartments", address: "1620 Belmont Ave", city: "Seattle", state: "WA",
    zip: "98122", units: 141, notes: "", ownedByAnother: false, ownerDeclared: false }]];
  if (path === "/api/payouts/status") {
    return [200, { status: "none", ready: false, requirements: [], configured: false }];
  }
  if (path === "/api/jobs" || path === "/api/invites"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/tenants" || path === "/api/clients" || path === "/api/visits") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openScreen = async (tab) => {
  const { ctx, page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1500 } });
  await wait(2600);
  await page.evaluate((want) => [...document.querySelectorAll("nav button")]
    .find((b) => new RegExp(`^${want}`, "i").test((b.innerText || "").trim()))?.click(), tab);
  await wait(700);
  return { ctx, page };
};
const openInspection = async () => {
  const { ctx, page } = await openScreen("Inspections");
  await page.evaluate(() => [...document.querySelectorAll(".insp-row")][0]?.click());
  await wait(900);
  return { ctx, page };
};

// THE STRIP, AS THE BROWSER COMPUTED IT. Reading the class alone is the chip
// bug: the state has to be visible, so the badge's own colours come back too.
const strip = (page) => page.evaluate(() => [...document.querySelectorAll(".insp-steps li")].map((li) => {
  const n = li.querySelector(".insp-step-n");
  const cs = n ? getComputedStyle(n) : null;
  return {
    label: (li.querySelector(".insp-step-l")?.innerText || "").trim(),
    state: li.classList.contains("is-done") ? "done"
      : li.classList.contains("is-now") ? "now" : "todo",
    bg: cs ? cs.backgroundColor : null,
    border: cs ? cs.borderTopColor : null,
    fg: cs ? cs.color : null,
  };
}));
const card = (page) => page.evaluate(() => {
  const el = document.querySelector(".insp-next:not(.is-extra)");
  if (!el) return null;
  return {
    head: (el.querySelector("strong")?.innerText || "").trim(),
    note: (el.querySelector("p")?.innerText || "").replace(/\s+/g, " ").trim(),
    acts: [...el.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()),
  };
});
const nudge = (page) => page.evaluate(() => {
  const el = document.querySelector(".insp-next.is-extra");
  if (!el) return null;
  return {
    head: (el.querySelector("strong")?.innerText || "").trim(),
    note: (el.querySelector("p")?.innerText || "").replace(/\s+/g, " ").trim(),
    acts: [...el.querySelectorAll("button")].map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()),
  };
});
const press = (page, label) => page.evaluate((want) => {
  const b = [...document.querySelectorAll(".insp-next button")]
    .find((x) => new RegExp(want, "i").test(x.innerText || ""));
  if (!b) return false;
  b.click(); return true;
}, label);
// Whether something is ringed, read as a box-shadow rather than as a class.
const ringed = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return "no such element";
  const sh = getComputedStyle(el).boxShadow;
  return { shadow: sh, on: !!sh && sh !== "none" };
}, sel);

try {
  console.log("\n-- an empty inspection says where to start --");
  {
    KIND = "property_manager"; ROOMS = []; STATUS = "draft"; JOB_ID = null; OWNERS = []; SENDS = [];
    const { ctx, page } = await openInspection();
    const st = await strip(page);
    t.ck("the strip is drawn", st.length >= 4, JSON.stringify(st.map((x) => x.label)));
    // SEND IS ABSENT WITH NO OWNER ON THE BUILDING. A step that can never be
    // ticked is the permanently-amber failure wearing a fifth number.
    t.ck("and send is not one of its steps", !st.some((x) => /Send/i.test(x.label)),
      JSON.stringify(st.map((x) => x.label)));
    t.ck("rooms is the current step", st[0]?.state === "now", JSON.stringify(st[0]));
    t.ck("and nothing is done yet", st.every((x) => x.state !== "done"), JSON.stringify(st));
    // THREE STATES, VISIBLY. Two of them reading the same pixels is the chip
    // bug: correct markup, nothing on screen.
    t.ck("the current badge does not look like one still to come",
      st[0].bg !== st[1].bg || st[0].border !== st[1].border, JSON.stringify([st[0], st[1]]));

    const c = await card(page);
    t.ck("the card says to get started", /get started/i.test(c?.head || ""), JSON.stringify(c));
    t.ck("and names the first room as the thing to add", /first room/i.test(c?.head || ""), c?.head);
    t.ck("its note says what counts as a room", /Bathroom 1|Walls and floors/.test(c?.note || ""), c?.note);
    t.ck("and there is one button on it", (c?.acts || []).length === 1, JSON.stringify(c?.acts));

    // IT POINTS RATHER THAN GATES, which is the whole claim. With no rooms
    // yet, every control this screen has is still on it and still live.
    const open = await page.evaluate(() => ({
      chips: [...document.querySelectorAll(".insp-suggest .chip")].length,
      chipsOff: [...document.querySelectorAll(".insp-suggest .chip")].filter((b) => b.disabled).length,
      addBox: !!document.querySelector(".insp-add input"),
      addBtn: !!document.querySelector(".insp-add button") && !document.querySelector(".insp-add button").disabled,
      head: !!document.querySelector(".insp-head-edit"),
      kinds: [...document.querySelectorAll(".insp-head-edit .insp-kind button")].length,
    }));
    t.ck("the tap-to-add chips are all still there", open.chips > 10 && open.chipsOff === 0, JSON.stringify(open));
    t.ck("so is the free-text box and its button", open.addBox && open.addBtn, JSON.stringify(open));
    t.ck("and so is the header form, move-in and move-out included",
      open.head && open.kinds === 2, JSON.stringify(open));
    // AND THE OLD SENTENCE IS GONE. Two things saying "add a room below" is
    // how somebody concludes there are two places to do it.
    t.ck("the empty-rooms paragraph is not said a second time",
      !(await page.evaluate(() => !!document.querySelector(".insp-rooms .prop-none"))));

    console.log("\n-- and its button takes you to the box --");
    t.ck("the button presses", await press(page, "Add the first room"));
    await wait(500);
    const r = await ringed(page, ".insp-add");
    t.ck("the add row is ringed", r.on === true, JSON.stringify(r));
    t.ck("and the cursor is in the box",
      await page.evaluate(() => document.activeElement === document.querySelector(".insp-add input")));
    await ctx.close();
  }

  console.log("\n-- a room nobody has marked is the walk --");
  {
    ROOMS = [{ id: "r1", name: "Bathroom 1", status: null, note: "", position: 0, photos: [] },
      { id: "r2", name: "Kitchen", status: "ok", note: "", position: 1, photos: [] }];
    const { ctx, page } = await openInspection();
    const st = await strip(page);
    t.ck("rooms reads done", st[0]?.state === "done", JSON.stringify(st[0]));
    t.ck("and the walk is current", st[1]?.state === "now", JSON.stringify(st[1]));
    const c = await card(page);
    t.ck("the card counts what is left", /1 room still to mark/i.test(c?.head || ""), c?.head);
    // NAMED, NOT COUNTED. "3 to mark" does not say which three, and which is
    // the only thing worth knowing while standing in the unit.
    t.ck("and names the one to go to", /Bathroom 1/.test((c?.acts || []).join(" ")), JSON.stringify(c?.acts));
    t.ck("pressing it works", await press(page, "Go to Bathroom 1"));
    await wait(500);
    const r = await ringed(page, ".insp-room");
    t.ck("the room is ringed", r.on === true, JSON.stringify(r));
    // Still not a gate: marking any room, and photographing it, stays open.
    const live = await page.evaluate(() => {
      const rooms = [...document.querySelectorAll(".insp-room")];
      return { rooms: rooms.length,
        verdicts: rooms.map((x) => [...x.querySelectorAll(".insp-verdict button")]
          .filter((b) => !b.disabled).length),
        shots: rooms.map((x) => !!x.querySelector(".ph-add, input[type=file]")) };
    });
    t.ck("every room still offers all three verdicts",
      live.verdicts.length === 2 && live.verdicts.every((n) => n === 3), JSON.stringify(live));
    t.ck("and a photograph can still go on either of them",
      live.shots.every(Boolean), JSON.stringify(live));
    await ctx.close();
  }

  console.log("\n-- something flagged is the work, and the trades are recommended --");
  {
    ROOMS = [{ id: "r1", name: "Bathroom 1", status: "fail", note: "Basin cracked and the trim is split",
      position: 0, photos: [] }];
    JOB_ID = null;
    const { ctx, page } = await openInspection();
    const st = await strip(page);
    t.ck("the work is current", st.find((x) => /work/i.test(x.label))?.state === "now", JSON.stringify(st));
    // AND IT COMES BEFORE FINISHING. The leak does not wait for the paperwork,
    // which is why Raise a job is offered on a draft at all.
    t.ck("and finishing is not", st.find((x) => /Finish/i.test(x.label))?.state === "todo", JSON.stringify(st));
    const c = await card(page);
    t.ck("the card names what was flagged", /1 flagged/i.test(c?.head || ""), c?.head);
    t.ck("and says the trades are recommended", /recommend/i.test(c?.note || ""), c?.note);
    // THE BUTTON OPENS THE RAISE FORM, with the trades already ticked -- which
    // is the second half of the request and the thing a static check on
    // `suggestTrades` cannot see from here.
    t.ck("pressing it opens the form", await press(page, "Raise a job"));
    await wait(700);
    const raise = await page.evaluate(() => {
      const pane = document.querySelector(".modal .form-pane");
      if (!pane) return null;
      return {
        head: (pane.querySelector("h2")?.innerText || "").trim(),
        on: [...pane.querySelectorAll(".chips .chip.on")].map((b) => (b.innerText || "").trim()),
        said: (pane.querySelector(".insp-sugg")?.innerText || "").replace(/\s+/g, " ").trim(),
        go: !pane.querySelector(".form-actions .btn-solid")?.disabled,
      };
    });
    t.ck("it is the raise form", /Raise a job/i.test(raise?.head || ""), JSON.stringify(raise));
    t.ck("trades are already ticked from what was written",
      (raise?.on || []).length > 0, JSON.stringify(raise?.on));
    t.ck("and it says where each came from", /Suggested from/i.test(raise?.said || ""), raise?.said);
    t.ck("so the job can be raised without picking anything", raise?.go === true, JSON.stringify(raise));
    await ctx.close();
  }

  console.log("\n-- a raised job is nudged, never gated --");
  {
    JOB_ID = "job_1";
    const { ctx, page } = await openInspection();
    const st = await strip(page);
    t.ck("the work step reads done", st.find((x) => /work/i.test(x.label))?.state === "done",
      JSON.stringify(st));
    const n = await nudge(page);
    // THE LAST THING THE REQUEST NAMES: "assign sub contractors or handyman or
    // later". Both words, because a manager hires both.
    t.ck("the nudge offers somebody for the job", /Put somebody on the job/i.test(n?.head || ""),
      JSON.stringify(n));
    t.ck("and names a subcontractor and a handyman", /subcontractor/i.test(n?.note || "")
      && /handyman/i.test(n?.note || ""), n?.note);
    t.ck("and says it can be left for later", /later/i.test(n?.note || ""), n?.note);
    // NO LATER BUTTON. Doing nothing is already later, and a control that does
    // nothing is a control that lies.
    t.ck("there is one button and it opens the job",
      (n?.acts || []).length === 1 && /Open the job/i.test((n?.acts || [])[0] || ""),
      JSON.stringify(n?.acts));
    await ctx.close();
  }

  console.log("\n-- every room marked offers finishing, and another room --");
  {
    ROOMS = [{ id: "r1", name: "Bathroom 1", status: "fail", note: "Basin cracked", position: 0, photos: [] }];
    JOB_ID = "job_1"; STATUS = "draft";
    const { ctx, page } = await openInspection();
    const c = await card(page);
    t.ck("the card says every room is marked", /Every room is marked/i.test(c?.head || ""), JSON.stringify(c));
    // "ADD ANOTHER ROOM?" -- the request's own words, at the moment it is
    // actually the question.
    t.ck("it asks whether there is anything else to walk", /Anything else to walk/i.test(c?.note || ""), c?.note);
    t.ck("and offers both: another room, and finishing",
      (c?.acts || []).some((x) => /Add another room/i.test(x))
      && (c?.acts || []).some((x) => /Finish inspection/i.test(x)), JSON.stringify(c?.acts));
    t.ck("another room points at the box", await press(page, "Add another room"));
    await wait(450);
    t.ck("which is ringed", (await ringed(page, ".insp-add")).on === true);

    // AND FINISH ACTUALLY FINISHES. A card that merely mentions finishing
    // passes with the button wired to nothing.
    const before = calls.filter((x) => x.what === "patch" && x.body && x.body.finish).length;
    t.ck("finish presses", await press(page, "Finish inspection"));
    await wait(900);
    const after = calls.filter((x) => x.what === "patch" && x.body && x.body.finish).length;
    t.ck("and it sends the finish", after === before + 1, `${before} -> ${after}`);
    await ctx.close();
  }

  console.log("\n-- a finished walk with an owner on the building is sent --");
  {
    ROOMS = [{ id: "r1", name: "Bathroom 1", status: "fail", note: "Basin cracked", position: 0, photos: [] }];
    STATUS = "finished"; JOB_ID = "job_1";
    OWNERS = [{ id: "usr_o", name: "Dana Reyes", email: "dana@owner.test" }]; SENDS = [];
    const { ctx, page } = await openInspection();
    // NOT ON A FINISHED ONE. Every step is either done or nobody's to take,
    // and the screen is read-only, so a card telling somebody to act would be
    // pointing at controls that are gone.
    t.ck("the walkthrough is not drawn on a finished inspection",
      (await strip(page)).length === 0 && (await card(page)) === null);
    t.ck("but the send panel is", await page.evaluate(() => !!document.querySelector(".insp-send")));
    t.ck("and it names the owner",
      await page.evaluate(() => /Dana Reyes/.test(document.querySelector(".insp-send")?.innerText || "")));
    await ctx.close();
  }

  console.log("\n-- the strip's labels are the shared list --");
  {
    ROOMS = []; STATUS = "draft"; JOB_ID = null;
    OWNERS = [{ id: "usr_o", name: "Dana Reyes", email: "dana@owner.test" }]; SENDS = [];
    const { ctx, page } = await openInspection();
    const st = await strip(page);
    t.ck("with an owner there are five steps", st.length === INSPECTION_STEPS.length,
      JSON.stringify(st.map((x) => x.label)));
    t.ck("and they are the shared labels in the shared order",
      st.map((x) => x.label).join("|") === INSPECTION_STEPS.map((x) => x.label).join("|"),
      st.map((x) => x.label).join("|"));
    await ctx.close();
  }

  // ---------------------------------------------------------------------
  // THE HANDYMAN PICKER, which shipped with a server suite and no proof that
  // anybody could reach the control. `roleLocked` is the precedent: route,
  // migration, picker and note all correct, and the picker unreachable for
  // every seat on every account kind, with the static assertions passing.
  console.log("\n-- what somebody is engaged AS, on a managing agent --");
  const openSubEdit = async () => {
      // THE ROSTER NOUN FOLLOWS THE ACCOUNT KIND -- a general contractor's nav
    // reads "Subcontractors" and a managing agent's reads "Contractors", which
    // is `hiresLabel` doing its job. Matching only one of them opened nothing
    // on the other kind, and "no picker is drawn" then passed over a screen
    // that had never rendered: the could-not-fail shape, caught by the
    // assertion beside it rather than by reasoning.
    const { ctx, page } = await openScreen("(Sub)?contractors");
    await page.evaluate(() => {
      const c = [...document.querySelectorAll(".grid .card")]
        .find((x) => /Pike Maintenance/.test(x.innerText || ""));
      if (c) c.click();
    });
    await wait(800);
    await page.evaluate(() => [...document.querySelectorAll(".modal button")]
      .find((b) => /^Edit$/i.test((b.innerText || "").trim()))?.click());
    await wait(800);
    // Step 2 is where the question lives. On an existing contractor every step
    // is reachable, which is what makes this one click.
    await page.evaluate(() => [...document.querySelectorAll(".sf-steps button")][1]?.click());
    await wait(500);
    return { ctx, page };
  };
  const picker = (page) => page.evaluate(() => {
    const g = [...document.querySelectorAll(".insp-kind.seg")]
      .find((x) => /Working relationship/i.test(x.getAttribute("aria-label") || ""));
    if (!g) return null;
    const bs = [...g.querySelectorAll("button")];
    return {
      labels: bs.map((b) => (b.innerText || "").trim()),
      on: bs.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => (b.innerText || "").trim()),
      note: (g.parentElement?.querySelector(".fld-note")?.innerText || "").replace(/\s+/g, " ").trim(),
      trades: [...document.querySelectorAll(".pick-grid .pick")].length,
    };
  });
  {
    KIND = "property_manager";
    const { ctx, page } = await openSubEdit();
    const p = await picker(page);
    t.ck("the form opens on the step that asks it", !!p, String(p));
    t.ck("and offers both answers", (p?.labels || []).join("|") === "Subcontractor|Handyman",
      JSON.stringify(p?.labels));
    // EXACTLY ONE IS TRUE AND EXACTLY ONE CAN BE, which is why it is a
    // segmented pair and not two loose chips -- reported on the inspection
    // screen as not being able to tell which was picked.
    t.ck("exactly one is pressed", (p?.on || []).length === 1, JSON.stringify(p?.on));
    t.ck("and it is the one the row says", (p?.on || [])[0] === "Subcontractor", JSON.stringify(p?.on));
    // THE NOTE UNDER IT IS THE WHOLE EXPLANATION, so it is read on the
    // SELECTED answer rather than looked for anywhere on the screen. The first
    // version of this matched /licen|insur/ against whichever note happened to
    // be showing and passed on the subcontractor's -- "Carries their own
    // insurance and bond" -- which is the opposite claim. An assertion that
    // passes on either answer is not an assertion about the answer.
    t.ck("the subcontractor's note says they carry their own cover",
      /carries their own/i.test(p?.note || ""), p?.note);

    // AND PICKING HANDYMAN NARROWS THE TRADES, which is the half of the
    // feature a static check on the grid cannot see.
    const all = p.trades;
    await page.evaluate(() => [...document.querySelectorAll(".insp-kind.seg button")]
      .find((b) => /Handyman/i.test(b.innerText || ""))?.click());
    await wait(400);
    const after = await picker(page);
    t.ck("handyman becomes the pressed one", (after?.on || [])[0] === "Handyman", JSON.stringify(after?.on));
    t.ck("and the trade grid gets shorter", after.trades > 0 && after.trades < all,
      `${all} -> ${after.trades}`);
    t.ck("and the note now says a handyman has no contractor licence",
      /no contractor licen/i.test(after?.note || ""), after?.note);
    t.ck("and that insurance is not required of one",
      /insurance is not required/i.test(after?.note || ""), after?.note);

    // AND WHAT THAT MEANS WHERE THEY WORK, which is the figure half of the
    // same decision. Asserted HERE because this is the form that opens the
    // picker, and the lesson `roleLocked` taught is that a static check on a
    // control passes while nothing can reach it -- the second call site of
    // `handymanCapCheck` needs the same proof the first one got.
    const cap = await page.evaluate(() => {
      const el = document.querySelector(".hcap");
      if (!el) return null;
      return {
        tone: el.classList.contains("hcap-warn") ? "warn" : "note",
        head: (el.querySelector("strong")?.innerText || "").trim(),
        body: [...el.querySelectorAll("p")].map((x) => (x.innerText || "").replace(/\s+/g, " ").trim()),
        rules: [...el.querySelectorAll(".hcap-rules li")].map((x) => (x.innerText || "").trim()),
      };
    });
    t.ck("the state's handyman ceiling is drawn on the picker", !!cap, JSON.stringify(cap));
    // Pike Maintenance is a Washington company, so this is Washington's figure
    // -- the company's own state, which is deliberately NOT the building's
    // state the assign form reads: there is no job here to have a building.
    t.ck("naming their state and its figure",
      /Washington/.test(cap?.head || "") && /\$500/.test(cap?.head || ""), cap?.head);
    t.ck("with no job to compare, so no verdict about one",
      cap?.tone === "note", JSON.stringify(cap?.tone));
    // The rules that hold wherever there is a figure, said once rather than
    // per state -- and the permit one is the half no dataset can answer for a
    // particular job.
    t.ck("and the rules that hold everywhere", (cap?.rules || []).length === 4,
      JSON.stringify(cap?.rules));
    t.ck("including the one about splitting invoices",
      (cap?.rules || []).some((r) => /splitting/i.test(r)), JSON.stringify(cap?.rules));
    t.ck("and the one about permits",
      (cap?.rules || []).some((r) => /permit/i.test(r)), JSON.stringify(cap?.rules));
    // AND IT IS NOT THERE FOR A SUBCONTRACTOR, asserted by going back -- the
    // same place, so a block drawn for everybody cannot pass.
    await page.evaluate(() => [...document.querySelectorAll(".insp-kind.seg button")]
      .find((b) => /Subcontractor/i.test(b.innerText || ""))?.click());
    await wait(400);
    t.ck("and it goes when they are a subcontractor again",
      await page.evaluate(() => !document.querySelector(".hcap")));
    await ctx.close();
  }

  console.log("\n-- and not on a general contractor, where there is no such thing --");
  {
    // A GC holds the prime contract, so everybody under it is a
    // subcontractor; a handyman is a managing agent's maintenance worker.
    // Asserted in the SAME PLACE as the other branch, because a rule checked
    // on one branch is the diagonal coverage that left `hiresLabel`
    // half-wired.
    KIND = "general_contractor";
    const { ctx, page } = await openSubEdit();
    const p = await picker(page);
    t.ck("no working-relationship picker is drawn", p === null, JSON.stringify(p));
    // And the form still works: the step it is on is the real one, so the
    // absence above is an absence rather than a screen that failed to open.
    t.ck("while the step itself opened", await page.evaluate(() =>
      !!document.querySelector(".pick-grid .pick")));
    t.ck("with the whole trade list on it", await page.evaluate(() =>
      [...document.querySelectorAll(".pick-grid .pick")].length > 20));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
