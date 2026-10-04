// ENDING A JOB, AS DRAWN.
//
// The server half is `job-end-test.mjs`. Everything here is only true as
// drawn, and the static half passes over each of it: whether the card offers
// the way in at all, whether the modal names who gets stood down before
// somebody presses, whether the three live-work readers stop counting a job
// on hold, and whether the empty trade slot shuts.
//
// What is pinned:
//
//   THE WAY IN EXISTS, beside the one button that records work. A job arrived
//   through four doors and left through *Mark job complete*, so tidying
//   anything up meant saying the work had been done.
//
//   WHO GETS STOOD DOWN IS NAMED BEFORE THE PRESS, from the pre-flight the
//   server answers -- the roster's own rule: *the consequence can name what
//   is booked, rather than putting the question above an empty space.*
//
//   MONEY IS SAID, NOT DISCOVERED. The route refuses a cancellation against
//   funded money, and a dead button with no reason beside it is
//   indistinguishable from a broken one.
//
//   A HOLD COMES OFF THE SCHEDULE, THE OVERDUE COUNT AND THE STRIP. A held
//   job is deliberately NOT closed, so `isClosed` answers no to it -- and
//   every one of those readers would have gone on calling it work still to
//   come. *"1 job is past its date"* about work somebody deliberately put off
//   is the red number that never clears.
//
//   AND THE EMPTY SLOT SHUTS, with its own sentence. All three routes refuse
//   a held job, so buttons there would be looser than the route.
//
//   node --no-warnings scripts/job-end-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-jobend-test");
const WEB = 5341, API = 9039;
const t = tally();

const day = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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
const USERS = [{ id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test",
  phone: null, role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
  inviteSentAt: null, hasAvatar: false }];

const job = (id, title, over = {}) => ({
  id, accountId: "acc_pm", propertyId: "prop_1", title, status: "active",
  date: null, time: "09:00", address: "1620 Belmont Ave", area: "Seattle", zip: "98122",
  trades: ["plumbing"], assignments: {}, notes: "", createdAt: "2026-09-20",
  photos: [], severity: null, client: null, sqft: null, stories: null, scope: "",
  measurementDocs: [], materialSource: null, materialsPaidBy: null,
  requestedBy: null, approvedAt: "2026-09-20", declinedAt: null, withdrawnAt: null,
  completedAt: null, access: null, accessEffective: "manager", accessUserId: null,
  reportDetail: null, propertyName: "Press Apartments", visit: null, ...over,
});

// FOUR JOBS, AND EACH IS A BRANCH THE OTHERS CANNOT SHOW.
const JOBS = () => [
  // The one being ended. Dated in the past, so it is what the overdue count
  // is about -- and that count is the reader a hold has to come off.
  job("job_live", "Press Apartments - leaking sink", { date: day(-3) }),
  // ALREADY ON HOLD, with a date ahead. The only row that can show the
  // schedule, the strip and the overdue count dropping it, and the empty slot
  // shutting -- `isClosed` answers NO to this, which is the whole trap.
  job("job_held", "Rewire unit 12", { date: day(-2),
    endingKind: "deferred", endingUntil: day(21), endingNote: "owner's budget",
    endingAt: "2026-10-01T09:00:00.000Z" }),
  // A HOLD WHOSE DATE HAS GONE. Live again by itself, which is what makes the
  // date mean anything -- and only a fixture with both can tell the two apart.
  job("job_lapsed", "Replace the extractor", { date: day(-1),
    endingKind: "deferred", endingUntil: day(-1),
    endingAt: "2026-09-01T09:00:00.000Z" }),
  // CANCELLED, with the reason on it. A cancellation with no words on the
  // card is indistinguishable from a mis-press.
  job("job_cancelled", "Repaint the lobby", { date: day(-4),
    endingKind: "cancelled", endingNote: "tenant had it fixed privately",
    endingAt: "2026-10-01T09:00:00.000Z" }),
];

// What the pre-flight says. Two jobs, two answers: one with people booked and
// nothing funded, one with money on it -- the only pair that can show the
// modal naming a consequence AND refusing for money.
const CHECKS = {
  job_live: { booked: ["plumbing"], accepted: ["plumbing"], openQuotes: 1,
    openOverflow: 0, hasVisit: true, fundedCents: 0,
    blocked: { cancelled: null, deferred: null, no_work: null }, onHold: false },
  job_lapsed: { booked: [], accepted: [], openQuotes: 0, openOverflow: 0,
    hasVisit: false, fundedCents: 150000,
    blocked: { cancelled: "money_funded", deferred: null, no_work: "money_funded" },
    onHold: false },
};

const ended = [];
const resumed = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, JOBS()];
  if (path === "/api/visits") return [200, []];
  const ec = path.match(/^\/api\/jobs\/([^/]+)\/end-check$/);
  if (ec) return [200, CHECKS[ec[1]] || { booked: [], accepted: [], openQuotes: 0,
    openOverflow: 0, hasVisit: false, fundedCents: 0,
    blocked: { cancelled: null, deferred: null, no_work: null }, onHold: false }];
  const en = path.match(/^\/api\/jobs\/([^/]+)\/end$/);
  if (en && method === "POST") { ended.push({ id: en[1], ...body }); return [200, { ok: true }]; }
  const rs = path.match(/^\/api\/jobs\/([^/]+)\/resume$/);
  if (rs && method === "POST") { resumed.push(rs[1]); return [200, { ok: true }]; }
  if (/^\/api\/work-orders\/[^/]+\/plan$/.test(path))
    return [200, { valueCents: 0, milestones: [], releases: [], retainageBps: 0 }];
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
const browser = await launch();

// EVERY FIELD DEFAULTED, because a missing card must be one honest failure
// rather than a crash. The first version returned `{missing:true}` and the
// block below read `.slotBtns.length` off it -- so it THREW on exactly the
// case it exists to catch, taking every assertion after it down. The
// read-through-`link?.` lesson, for the sixth time in this repository.
const cardOf = (page, title) => page.evaluate((tt) => {
  const blank = { missing: true, phase: "", held: "", resume: false, why: "",
    shut: "", slotBtns: [], footBtns: [] };
  const card = [...document.querySelectorAll(".job-card")]
    .find((el) => (el.querySelector("h3")?.innerText || "").toUpperCase().includes(tt.toUpperCase()));
  if (!card) return blank;
  return {
    missing: false,
    phase: (card.querySelector(".job-phase")?.innerText || "").trim(),
    held: (card.querySelector(".job-held")?.innerText || "").replace(/\s+/g, " ").trim(),
    resume: !!card.querySelector(".jh-resume"),
    why: (card.querySelector(".job-withdrawn")?.innerText || "").replace(/\s+/g, " ").trim(),
    shut: (card.querySelector(".trade-shut")?.innerText || "").replace(/\s+/g, " ").trim(),
    slotBtns: [...card.querySelectorAll(".trade-actions button")].map((b) => b.innerText.trim()),
    footBtns: [...card.querySelectorAll(".job-footer button")].map((b) => b.innerText.trim()),
  };
}, title);

const openEnd = async (page, title) => {
  await page.evaluate((tt) => {
    const card = [...document.querySelectorAll(".job-card")]
      .find((el) => (el.querySelector("h3")?.innerText || "").toUpperCase().includes(tt.toUpperCase()));
    [...(card?.querySelectorAll(".job-footer button") || [])]
      .find((b) => /cancel or hold/i.test(b.innerText))?.click();
  }, title);
  await wait(900);
};
const modal = (page) => page.evaluate(() => {
  const m = document.querySelector(".modal");
  if (!m) return { missing: true };
  return {
    picks: [...m.querySelectorAll(".endj-pick")].map((b) => ({
      label: (b.querySelector(".endj-label")?.innerText || "").trim(),
      on: b.classList.contains("on"),
    })),
    stands: [...m.querySelectorAll(".cc-loose li")].map((l) => l.innerText.replace(/\s+/g, " ").trim()),
    blocked: (m.querySelector(".endj-blocked")?.innerText || "").replace(/\s+/g, " ").trim(),
    warn: (m.querySelector(".endj-warn")?.innerText || "").replace(/\s+/g, " ").trim(),
    hasDate: !!m.querySelector('input[type="date"]'),
    hasWhy: !!m.querySelector("textarea"),
    go: (() => {
      const b = [...m.querySelectorAll(".form-actions button")]
        .find((x) => !/leave it alone/i.test(x.innerText));
      return b ? { text: b.innerText.trim(), off: b.disabled } : null;
    })(),
  };
});

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1340, height: 2600 } });
  const logs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/i.test(m.text())) logs.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => logs.push("THROW " + String(e).slice(0, 200)));
  await wait(2600);

  console.log("\n-- a hold comes off every live-work reader --");
  {
    // THE DASHBOARD FIRST, because the overdue count is the loudest of them
    // and "1 job is past its date" about work somebody deliberately put off
    // is the red number that never clears.
    const sh = await page.evaluate(() => {
      const el = document.querySelector(".sh-late");
      return {
        late: (el?.querySelector(".shl-lede")?.innerText || "").replace(/\s+/g, " ").trim(),
        rows: [...(el?.querySelectorAll(".shl-title") || [])].map((x) => x.innerText.trim()),
        marked: [...document.querySelectorAll(".shs-day.has")].length,
      };
    });
    // Three jobs are dated in the past; one is on hold, one is cancelled, so
    // two are genuinely late -- the live one and the lapsed hold.
    t.ck("the overdue count counts the live ones only",
      /2 jobs are past their date/.test(sh.late), sh.late);
    t.ck("and names them", sh.rows.some((r) => /leaking sink/i.test(r))
      && sh.rows.some((r) => /extractor/i.test(r)), JSON.stringify(sh.rows));
    // THE DISCRIMINATING PAIR: the held one is out, the lapsed one is in.
    // A fix that dropped both, or neither, passes a check written against one.
    t.ck("the job on hold is not called late",
      !sh.rows.some((r) => /Rewire unit 12/i.test(r)), JSON.stringify(sh.rows));
    t.ck("nor is the cancelled one",
      !sh.rows.some((r) => /Repaint the lobby/i.test(r)), JSON.stringify(sh.rows));
  }

  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^jobs/i.test(b.innerText.trim()))?.click());
  await wait(1500);
  // ALL, not Active. A cancelled job IS closed, so the Active tab correctly
  // hides it -- which is the phase filter doing its job and is itself worth
  // asserting before switching.
  t.ck("Active hides the cancelled one",
    await page.evaluate(() => ![...document.querySelectorAll(".job-card h3")]
      .some((h) => /Repaint the lobby/i.test(h.innerText))));
  t.ck("and keeps the one on hold, which is not closed",
    await page.evaluate(() => [...document.querySelectorAll(".job-card h3")]
      .some((h) => /Rewire unit 12/i.test(h.innerText))));
  await page.evaluate(() => [...document.querySelectorAll(".seg-tabs.sm button")]
    .find((b) => /^All/i.test(b.innerText.trim()))?.click());
  await wait(900);
  t.ck("the Jobs screen opened",
    await page.evaluate(() => document.querySelectorAll(".job-card").length >= 4),
    String(await page.evaluate(() => document.querySelectorAll(".job-card").length)));

  console.log("\n-- the card says what happened to it --");
  {
    const held = await cardOf(page, "Rewire unit 12");
    // `.job-phase` is uppercased by CSS and Chrome's `innerText` applies it,
    // so a case-sensitive compare here is a test of the stylesheet -- a trap
    // this repository has recorded twice.
    t.ck("a held job says it is on hold", /^on hold$/i.test(held.phase), held.phase);
    t.ck("with the date it comes back", /until/i.test(held.held) && /budget/.test(held.held),
      held.held);
    t.ck("and the way back off it", held.resume === true);
    // THE EMPTY SLOT SHUTS. All three routes refuse a held job, so buttons
    // here would be looser than the route -- and what that costs is a
    // contractor committed to work somebody deliberately put off.
    t.ck("the empty trade slot offers nothing", held.slotBtns.length === 0,
      JSON.stringify(held.slotBtns));
    t.ck("and says why, with the date", /on hold/i.test(held.shut), held.shut);
    t.ck("rather than the closed sentence", !/nothing to assign/i.test(held.shut), held.shut);
  }
  {
    const can = await cardOf(page, "Repaint the lobby");
    t.ck("the cancelled card is there", !can.missing, can.phase);
    t.ck("a cancelled job says cancelled", /^cancelled$/i.test(can.phase), can.phase);
    // A cancellation with no words on the card is indistinguishable from a
    // mis-press.
    t.ck("and carries the reason somebody typed",
      /fixed privately/.test(can.why), can.why);
    t.ck("its slot offers nothing either", can.slotBtns.length === 0, JSON.stringify(can.slotBtns));
    t.ck("and says it is cancelled, not on hold",
      /cancelled/i.test(can.shut) && !/on hold/i.test(can.shut), can.shut);
  }
  {
    // THE LAPSED HOLD IS LIVE AGAIN, which is what makes the date mean
    // anything -- and only this row can tell it from a permanent hold.
    const lap = await cardOf(page, "extractor");
    t.ck("a lapsed hold reads as active", /^active$/i.test(lap.phase), lap.phase);
    t.ck("with no hold banner", !lap.held, lap.held);
    t.ck("and its slot works again",
      lap.slotBtns.some((b) => /Assign/i.test(b)), JSON.stringify(lap.slotBtns));
  }

  console.log("\n-- the way in is beside the one that records work --");
  {
    const liveCard = await cardOf(page, "leaking sink");
    t.ck("the card offers an ending", liveCard.footBtns.some((b) => /Cancel or hold/i.test(b)),
      JSON.stringify(liveCard.footBtns));
    t.ck("beside marking it complete",
      liveCard.footBtns.some((b) => /Mark job complete/i.test(b)),
      JSON.stringify(liveCard.footBtns));
  }

  console.log("\n-- and it names who gets stood down before the press --");
  {
    await openEnd(page, "leaking sink");
    const m = await modal(page);
    t.ck("the modal opens", !m.missing, JSON.stringify(m).slice(0, 160));
    t.ck("offering the three", m.picks.length === 3, JSON.stringify(m.picks.map((p) => p.label)));
    // Nothing preselected: a guess here is a preselection mistaken for a
    // choice, which this project has already paid for on the trade grid.
    t.ck("with nothing chosen for them", m.picks.every((p) => !p.on),
      JSON.stringify(m.picks));
    t.ck("and the button says to choose", /choose one/i.test(m.go?.text || "")
      && m.go?.off === true, JSON.stringify(m.go));

    await page.evaluate(() => [...document.querySelectorAll(".modal .endj-pick")]
      .find((b) => /Cancel this job/i.test(b.innerText))?.click());
    await wait(400);
    const c = await modal(page);
    // NAMED, NOT COUNTED. The whole reason the pre-flight runs before the
    // modal opens rather than after somebody has chosen.
    t.ck("it names the contractor who accepted",
      c.stands.some((l) => /Plumbing/i.test(l) && /accepted/i.test(l)), JSON.stringify(c.stands));
    t.ck("the agreed time coming off",
      c.stands.some((l) => /nobody is scheduled to arrive/i.test(l)), JSON.stringify(c.stands));
    t.ck("and the open quote request",
      c.stands.some((l) => /quote request/i.test(l)), JSON.stringify(c.stands));
    // A reason is required on the two terminal ones.
    t.ck("a reason is asked for", c.hasWhy === true);
    t.ck("and the button is dead until there is one", c.go?.off === true, JSON.stringify(c.go));

    await page.evaluate(() => {
      const el = document.querySelector(".modal textarea");
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      set.call(el, "the tenant had it fixed privately");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(400);
    t.ck("and live once it is typed", (await modal(page)).go?.off === false);

    ended.length = 0;
    await page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")]
      .find((b) => !/leave it alone/i.test(b.innerText))?.click());
    await wait(1000);
    t.ck("it posts exactly one ending", ended.length === 1, JSON.stringify(ended));
    t.ck("at the right job, with the kind and the reason",
      ended[0]?.id === "job_live" && ended[0]?.kind === "cancelled"
        && /fixed privately/.test(ended[0]?.note || ""), JSON.stringify(ended[0]));
  }

  console.log("\n-- a hold asks for a date and warns what it costs --");
  {
    await page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")]
      .find((b) => /leave it alone/i.test(b.innerText))?.click());
    await wait(500);
    // ON THE JOB WITH PEOPLE BOOKED, because the warning is about standing
    // them down -- on a job nobody is on there is nothing to re-issue and
    // nothing to warn about, which is right and is what the first version of
    // this assertion read.
    await openEnd(page, "leaking sink");
    await page.evaluate(() => [...document.querySelectorAll(".modal .endj-pick")]
      .find((b) => /on hold/i.test(b.innerText))?.click());
    await wait(400);
    const h = await modal(page);
    t.ck("a hold asks when it comes back", h.hasDate === true, JSON.stringify(h).slice(0, 120));
    // Taking it off hold does not re-issue anything, and somebody deciding
    // has to know that before they press -- not afterwards.
    t.ck("and warns the work orders do not come back",
      /does not re-issue/i.test(h.warn), h.warn);
    // No reason needed: the date is usually the whole story.
    t.ck("with no reason required", h.go?.off === false, JSON.stringify(h.go));
    // AND THE WARNING IS NOT ON A CANCELLATION, which is terminal -- "taking
    // it off hold" is a sentence about something that cannot happen there.
    await page.evaluate(() => [...document.querySelectorAll(".modal .endj-pick")]
      .find((b) => /Cancel this job/i.test(b.innerText))?.click());
    await wait(400);
    t.ck("and not on a cancellation", !/does not re-issue/i.test((await modal(page)).warn));
  }

  console.log("\n-- money is said, not discovered --");
  {
    await page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")]
      .find((b) => /leave it alone/i.test(b.innerText))?.click());
    await wait(500);
    // The job with money on it. Only a fixture where one job is funded and
    // another is not can show the refusal rather than a blanket one.
    await openEnd(page, "extractor");
    await page.evaluate(() => [...document.querySelectorAll(".modal .endj-pick")]
      .find((b) => /Cancel this job/i.test(b.innerText))?.click());
    await wait(400);
    const mb = await modal(page);
    // The route refuses it, and a dead button with nothing beside it is
    // indistinguishable from a broken one.
    t.ck("cancelling against funded money is refused on the screen",
      /is funded against this job/i.test(mb.blocked), mb.blocked);
    t.ck("naming the figure", /1,500/.test(mb.blocked), mb.blocked);
    t.ck("and saying a hold is still fine", /hold spends nothing/i.test(mb.blocked), mb.blocked);
    t.ck("the button is dead", mb.go?.off === true, JSON.stringify(mb.go));
    // The reason box is off while it is blocked: asking somebody to justify a
    // press that cannot happen is the form that wastes their time.
    t.ck("and no reason is asked for", mb.hasWhy === false);
    ended.length = 0;
    await page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")]
      .find((b) => !/leave it alone/i.test(b.innerText))?.click());
    await wait(700);
    t.ck("and nothing is posted", ended.length === 0, JSON.stringify(ended));
  }

  console.log("\n-- taking a hold off is one press --");
  {
    await page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")]
      .find((b) => /leave it alone/i.test(b.innerText))?.click());
    await wait(500);
    resumed.length = 0;
    await page.evaluate(() => {
      const card = [...document.querySelectorAll(".job-card")]
        .find((el) => /Rewire unit 12/i.test(el.querySelector("h3")?.innerText || ""));
      card?.querySelector(".jh-resume")?.click();
    });
    await wait(900);
    t.ck("it posts a resume", resumed.join() === "job_held", JSON.stringify(resumed));
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
