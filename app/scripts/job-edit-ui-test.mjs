// THE FOUR THINGS ON THE JOBS SCREEN THAT CAN ONLY BE SEEN DRAWN.
//
// Reported together, with two screenshots:
//
//   *"when you click on a job card it should open to edit, so the entire job
//   can be edited and saved"*
//   *"trying to reschedule a job but I made it for October 6th, but it made
//   it for October 5th instead"*
//   *"if the start time is 1pm to a job the end time should automatically
//   adjust to an hour after"*
//   *"one of the times for a jobs says waiting on a contractor and a
//   contractor to confirm"*
//
// Every one of them is invisible to a static check. The date bug is a
// `new Date()` parsing rule; the end time is state that moves when another
// field moves; the duplicated label is a ternary that reads exactly as
// intended; and whether a card opens an edit form is a click.
//
// What is pinned here:
//
//   THE DATE SOMEBODY PICKED IS THE DATE SHOWN. `niceDay` was written for a
//   full ISO timestamp -- Stripe's period end -- and "2026-10-06" parses as
//   UTC MIDNIGHT, which renders as Oct 5 for every reader west of Greenwich.
//   Stored correctly the whole time; wrong on every screen that draws a date
//   key, all afternoon and evening in Seattle. Driven with the browser's own
//   clock in Los Angeles, because in UTC the bug cannot be reproduced at all.
//
//   THE END TIME FOLLOWS THE START, keeping the window length somebody has
//   already chosen rather than forcing an hour over it. The screenshot showed
//   From 11:00 AM / To 11:00 AM over a Propose button refusing the window for
//   ending before it starts -- the state this exists to make unreachable.
//
//   EACH PARTY IS NAMED ONCE. The three-party window is the only one either
//   behaviour can be told apart on: with two, a hand-written ternary and the
//   shared helper agree.
//
//   AND THE CARD OPENS THE JOB FOR EDIT, seeded with what is on it, saving
//   through PATCH -- with a trade somebody already holds a work order on
//   drawn as not removable, because the server refuses to drop it and a chip
//   whose removal the save rejects is a control that lies.
//
//   node --no-warnings scripts/job-edit-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-jobedit-test");
const WEB = 5339, API = 9037;
const t = tally();

const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", role: "admin" },
};
const SUB = {
  id: "cmp_pac", company: "Pacific apartment maintenance", engagementId: "en_pac",
  accountId: "acc_pm", contact: "Juan Soto", email: "juan@pacific.test", phone: null,
  categories: ["plumbing"], caps: [], crews: [], propertyIds: [], zips: [],
  notify: {}, rating: null, bond: true, insurance: true, contract: true, w9: true,
  hasPortal: true, license: "", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {},
};
const USERS = [
  { id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", phone: null,
    role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
    inviteSentAt: null, hasAvatar: false },
  { id: "u_ada", name: "John Smith", email: "john@t.test", phone: null,
    role: "tenant", subId: null, propertyIds: ["prop_1"], unit: "3B", hasLogin: true,
    inviteSentAt: null, hasAvatar: false },
];
const accepted = (wo) => ({ plumbing: {
  id: wo, wo, subId: "cmp_pac", status: "accepted", auto: false,
  responseWindow: null, respondBy: null, respondedAt: null, value: "400",
  payKind: "fixed", rate: "", capHours: null, tradeScope: null, crewName: null,
  signedWO: null, rating: null,
} });

// THE REPORTED JOB. Two trades, one of them holding an accepted work order --
// the only shape the cannot-drop-a-booked-trade rule can be seen on.
const JOBS = () => [{
  id: "job_1", accountId: "acc_pm", propertyId: "prop_1",
  title: "Press Apartments - leaking sink", status: "active",
  date: "2026-10-06", time: "11:00", address: "1620 Belmont Ave", area: "Seattle", zip: "98122",
  trades: ["plumbing", "roofing"], assignments: accepted("WO-100100"),
  notes: "", createdAt: "2026-09-20", photos: [], severity: null,
  client: "Acme Holdings", sqft: 900, stories: 3, scope: "Sink in unit 3B",
  measurementDocs: [], materialSource: null, materialsPaidBy: "Sound Property Management",
  requestedBy: "u_ada", approvedAt: "2026-09-20", declinedAt: null, withdrawnAt: null,
  completedAt: null, access: "tenant", accessEffective: "tenant", accessUserId: "u_ada",
  reportDetail: null, propertyName: "Press Apartments", visit: null,
}];

// A LIVE THREE-PARTY WINDOW. The contractor holds the work, the hiring side
// proposed it (so their leg is stamped), and the tenant has to be in -- which
// is the only arrangement where a two-branch label ternary and the shared
// helper give different answers.
const VISITS = () => [{
  id: "v1", jobId: "job_1", status: "proposed", date: "2026-10-06",
  startTime: "11:00", endTime: "13:15", note: "", tenantNote: null,
  respondedAt: null, contractorAt: null, contractorNote: null, managerAt: null,
  proposedBy: "u_mgr", createdAt: "2026-09-25",
}];

const patched = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, JOBS()];
  if (path === "/api/visits") return [200, VISITS()];
  if (/^\/api\/jobs\/[^/]+$/.test(path) && method === "PATCH") {
    patched.push({ path, body });
    return [200, { ok: true }];
  }
  if (/^\/api\/work-orders\/[^/]+\/plan$/.test(path))
    return [200, { valueCents: 40000, milestones: [], releases: [], retainageBps: 0 }];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_pm",
    name: "Press Apartments", address: "1620 Belmont Ave", city: "Seattle", state: "WA",
    zip: "98122", notes: "", vendors: {}, owners: [], ownerAccountId: "acc_pm" }]];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/invites" || path === "/api/clients" || path === "/api/my-connect-requests"
    || path === "/api/connect-requests" || path === "/api/property-transfers"
    || path === "/api/my-quotes" || path === "/api/doc-shares" || path === "/api/inspections"
    || path === "/api/change-orders") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
// LOS ANGELES, DELIBERATELY, AND SET BEFORE THE BROWSER STARTS. "2026-10-06"
// parsed as UTC midnight renders as Oct 5 only WEST of Greenwich -- in UTC the
// bug this suite exists to catch does not reproduce at all, so a run without
// this is a run that passes whichever rule is in force. Chromium takes the
// zone from its environment, so it goes in before launch rather than being
// emulated on a page that has already rendered.
process.env.TZ = "America/Los_Angeles";
const browser = await launch();

const setVal = (page, sel, value) => page.evaluate(([ss, vv]) => {
  const el = document.querySelector(ss);
  if (!el) return false;
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement : window.HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, vv);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, [sel, value]);

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1340, height: 2400 } });
  const logs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/i.test(m.text())) logs.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => logs.push("THROW " + String(e).slice(0, 200)));
  await wait(2600);
  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^jobs/i.test(b.innerText.trim()))?.click());
  await wait(1600);

  t.ck("the Jobs screen opened",
    await page.evaluate(() => document.querySelectorAll(".job-card").length > 0),
    String(await page.evaluate(() => document.querySelectorAll(".job-card").length)));

  console.log("\n-- the date somebody picked is the date drawn --");
  {
    const txt = await page.evaluate(() =>
      (document.querySelector(".visit-block .visit-state")?.innerText || "").replace(/\s+/g, " "));
    // The reported symptom, exactly: picked the 6th, drawn as the 5th.
    t.ck("the window reads Oct 6", /Oct 6, 2026/.test(txt), txt);
    t.ck("and not the day before", !/Oct 5/.test(txt), txt);
    // The browser's own clock is what makes that discriminating.
    t.ck("the clock really is west of Greenwich",
      await page.evaluate(() => new Date().getTimezoneOffset() > 0),
      String(await page.evaluate(() => new Date().getTimezoneOffset())));
  }

  console.log("\n-- each party is named once --");
  {
    const txt = await page.evaluate(() =>
      (document.querySelector(".visit-block .visit-state")?.innerText || "").replace(/\s+/g, " "));
    // Three parties: the crew, the hiring side and the tenant. "the
    // contractor and the contractor and John Smith" is what shipped.
    t.ck("the contractor is named once", txt.split("the contractor").length === 2, txt);
    t.ck("the hiring side has its own label", /the hiring side/.test(txt), txt);
    // AND THE TENANT CARRIES THEIR ROLE: *"who is John Smith?"*
    t.ck("and the tenant is named with their role", /the tenant \(John Smith\)/.test(txt), txt);
  }

  console.log("\n-- the end time follows the start --");
  {
    await page.evaluate(() => [...document.querySelectorAll(".visit-block button")]
      .find((b) => /propose/i.test(b.innerText))?.click());
    await wait(500);
    const before = await page.evaluate(() => {
      const f = document.querySelector(".visit-form");
      const ts = [...f.querySelectorAll("input[type=time]")];
      return { start: ts[0]?.value, end: ts[1]?.value };
    });
    // One hour is the DEFAULT, which is where the request came from.
    t.ck("it opens on a one-hour window",
      before.start === "09:00" && before.end === "10:00", JSON.stringify(before));
    await setVal(page, ".visit-form input[type=time]", "13:00");
    await wait(400);
    const after = await page.evaluate(() => {
      const ts = [...document.querySelectorAll(".visit-form input[type=time]")];
      return { start: ts[0]?.value, end: ts[1]?.value };
    });
    // THE REPORTED ASK, in the reported words: 1pm in, 2pm out.
    t.ck("1pm gives an end of 2pm",
      after.start === "13:00" && after.end === "14:00", JSON.stringify(after));
    // AND A WINDOW SOMEBODY HAS WIDENED KEEPS ITS LENGTH. Overwriting a
    // 2h15m window with an hour would be the screen deciding something they
    // had decided -- and only a non-default length can tell the two apart.
    await setVal(page, ".visit-form input[type=time] + *", "");
    await page.evaluate(() => {
      const ts = [...document.querySelectorAll(".visit-form input[type=time]")];
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(ts[1], "15:15");
      ts[1].dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    await setVal(page, ".visit-form input[type=time]", "08:00");
    await wait(400);
    const kept = await page.evaluate(() => {
      const ts = [...document.querySelectorAll(".visit-form input[type=time]")];
      return { start: ts[0]?.value, end: ts[1]?.value };
    });
    t.ck("a widened window keeps its length",
      kept.start === "08:00" && kept.end === "10:15", JSON.stringify(kept));
    // The state the screenshot was in -- From 11:00, To 11:00 -- is now
    // unreachable by setting the start, which is the point of the change
    // rather than a detail of it.
    t.ck("and the end is never left at or before the start",
      kept.end > kept.start, JSON.stringify(kept));
  }

  console.log("\n-- the card opens the job for edit --");
  {
    const opened = await page.evaluate(() => {
      const b = document.querySelector(".job-card .job-title-edit");
      if (!b) return false;
      b.click();
      return true;
    });
    t.ck("the job name is the way in", opened === true);
    await wait(700);
    const form = await page.evaluate(() => {
      const m = document.querySelector(".modal");
      if (!m) return { missing: "modal" };
      const val = (sel) => m.querySelector(sel)?.value ?? null;
      const labelled = (name) => {
        const l = [...m.querySelectorAll("label")].find((x) =>
          (x.childNodes[0]?.textContent || "").trim().toLowerCase().startsWith(name));
        return l?.querySelector("input,textarea,select")?.value ?? null;
      };
      return {
        heading: m.querySelector("h2")?.innerText.trim() || "",
        sub: (m.querySelector(".form-sub")?.innerText || "").replace(/\s+/g, " "),
        title: labelled("job name"), client: labelled("homeowner"),
        address: labelled("service address"), scope: labelled("overall scope"),
        date: val("input[type=date]"), time: val("input[type=time]"),
        on: [...m.querySelectorAll(".pick.on")].map((x) => x.innerText.trim()),
        lockedChips: [...m.querySelectorAll(".pick-locked")].map((x) => x.innerText.trim()),
        save: [...m.querySelectorAll(".form-actions button")].map((x) => x.innerText.trim()),
        // The access picker is asked beside the TIME on the card, so a second
        // one here would be a control whose value the save does not send.
        access: [...m.querySelectorAll(".acc-grid")].length,
      };
    });
    t.ck("it opens an edit form", form.heading === "Edit job", JSON.stringify(form).slice(0, 180));
    // SEEDED FROM THE JOB. An edit form that opens blank is a form that
    // silently clears everything somebody does not retype.
    t.ck("seeded with the job name", form.title === "Press Apartments - leaking sink", String(form.title));
    t.ck("the client", form.client === "Acme Holdings", String(form.client));
    t.ck("the address", form.address === "1620 Belmont Ave", String(form.address));
    t.ck("the scope", form.scope === "Sink in unit 3B", String(form.scope));
    t.ck("the date", form.date === "2026-10-06", String(form.date));
    t.ck("the time", form.time === "11:00", String(form.time));
    t.ck("and both trades ticked",
      form.on.includes("Plumbing") && form.on.includes("Roofing"), JSON.stringify(form.on));
    // WHAT EDITING DOES NOT DO, said before anything is typed.
    t.ck("it says the work orders keep their price",
      /keep their price/i.test(form.sub), form.sub);
    t.ck("and that moving an agreed visit is done on the card",
      /propose a new time/i.test(form.sub), form.sub);
    t.ck("the button says Save changes",
      form.save.some((x) => /Save changes/.test(x)), JSON.stringify(form.save));
    t.ck("and there is no second access picker", form.access === 0, String(form.access));

    // A TRADE SOMEBODY ALREADY HOLDS CANNOT COME OFF. The server refuses it,
    // so the screen agrees rather than offering a press the save rejects.
    t.ck("the booked trade is drawn as locked",
      form.lockedChips.join() === "Plumbing", JSON.stringify(form.lockedChips));
    // READ AFTER A TICK, NOT IN THE SAME EVALUATE. The first version returned
    // the chips in the call that clicked them, which is the state BEFORE
    // React has re-rendered -- so the negative case passed and the positive
    // one reported the press as having done nothing. A click and the DOM it
    // produces are two turns.
    const chipsOn = () => page.evaluate(() =>
      [...document.querySelectorAll(".modal .pick.on")].map((x) => x.innerText.trim()));
    const tap = (label) => page.evaluate((ll) => [...document.querySelectorAll(".modal .pick")]
      .find((x) => x.innerText.trim() === ll)?.click(), label);
    await tap("Plumbing"); await wait(350);
    const tried = await chipsOn();
    t.ck("and pressing it does nothing", tried.includes("Plumbing"), JSON.stringify(tried));
    // THE UNBOOKED ONE DOES come off, or this reads as "trades are frozen".
    await tap("Roofing"); await wait(350);
    const dropped = await chipsOn();
    t.ck("the unbooked trade comes off", !dropped.includes("Roofing"), JSON.stringify(dropped));
  }

  console.log("\n-- and saving sends what was typed --");
  {
    patched.length = 0;
    await page.evaluate(() => {
      const m = document.querySelector(".modal");
      const l = [...m.querySelectorAll("label")].find((x) =>
        (x.childNodes[0]?.textContent || "").trim().toLowerCase().startsWith("job name"));
      const el = l?.querySelector("input");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, "Press Apartments - leaking sink and basin");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")]
      .find((b) => /Save changes/.test(b.innerText))?.click());
    await wait(900);
    t.ck("it PATCHes the job once", patched.length === 1, JSON.stringify(patched));
    const body = patched[0]?.body || {};
    t.ck("at the job's own id", patched[0]?.path === "/api/jobs/job_1", String(patched[0]?.path));
    t.ck("carrying the new name",
      body.title === "Press Apartments - leaking sink and basin", String(body.title));
    t.ck("and the trades as they now stand",
      JSON.stringify(body.trades) === '["plumbing"]', JSON.stringify(body.trades));
    // THE COLUMNS THIS FORM DOES NOT KNOW ABOUT ARE NOT SENT. A form that
    // edits part of a record must not replace the whole of it, and the browser
    // half of that rule is what it puts in the body.
    t.ck("the access answer is not in the body", body.access === undefined, JSON.stringify(body.access));
    t.ck("nor the photos", body.photos === undefined, JSON.stringify(body.photos));
    t.ck("nor the severity", body.severity === undefined, JSON.stringify(body.severity));
    t.ck("nor who asked", body.requestedBy === undefined, JSON.stringify(body.requestedBy));
    // AWAITED, so a refusal cannot be hidden -- and the modal closes only on
    // a save that went through.
    t.ck("and the modal closed on success",
      await page.evaluate(() => !document.querySelector(".modal h2")?.innerText.includes("Edit job")));
  }

  console.log("\n-- nothing threw --");
  t.ck("no \\uXXXX escape reached the page",
    !/\\u[0-9a-fA-F]{4}/.test(await page.evaluate(() => document.body.innerText)));
  t.ck("the page's own console is clean", logs.length === 0, logs.join(" | "));
  t.ck("and the harness saw no crash", crashes.length === 0, crashes.join(" | "));
  await ctx.close().catch(() => {});
} finally {
  await browser.close().catch(() => {});
  web.close(); api.close();
}

t.done();
