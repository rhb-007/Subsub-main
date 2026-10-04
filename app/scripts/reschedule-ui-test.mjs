// RESCHEDULING A JOB THAT HAS BEEN AND GONE, as drawn.
//
// Reported with a screenshot of the dashboard: *"1 job is past its date —
// Press Apartments — leaking sink"*, and *"rescheduling this past appointment
// is still an issue, can't edit it… need to be able to simply open and edit
// this and have it resend out to contractor or handyman to be approved and
// scheduled"*.
//
// The machinery was all there. 061 made proposing a time supersede the live
// window and made the contractor a party who has to confirm, so a new time
// already goes back out for approval rather than being imposed. What was
// missing was the WAY IN: the whole scheduling block was gated on
// `j.requestedBy`, so it existed only on a job a tenant or an owner had asked
// for. A job the account raised itself -- which is most of them -- had no way
// to set a date, no way to move one, and nothing on the card saying when
// anybody was coming.
//
// What is pinned here is the handful of decisions a later pass would undo:
//
//   IT IS ON ANY OPEN, APPROVED JOB, and the requested one still has it --
//   asserted in the same place, because a fix that drew the block everywhere
//   and a fix that drew it nowhere both pass a check written against one.
//
//   AN UNAPPROVED REQUEST STILL HAS NONE. Scheduling one would book work
//   nobody has agreed to do.
//
//   THE PARTY IS THE CONTRACTOR when there is no tenant in the loop, in the
//   words on the card and in who the note is addressed to. It read "the
//   tenant" on a job with no tenant at all.
//
//   node --no-warnings scripts/reschedule-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-resched-test");
const WEB = 5335, API = 9033;
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
  docReview: {}, coverage: {}, engagedAs: "subcontractor",
};
// AND A HANDYMAN ON THE SAME ROSTER. 058 put the relationship on
// `engagements`, so one account's handyman and its subcontractor sit side by
// side -- which is the only fixture either word can be told apart on.
const HANDY = {
  ...SUB, id: "cmp_hdy", company: "Ballard odd jobs", engagementId: "en_hdy",
  contact: "Dee Rivas", email: "dee@ballard.test", engagedAs: "handyman",
  bond: false, insurance: false,
};
const USERS = [
  { id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", phone: null,
    role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
    inviteSentAt: null, hasAvatar: false },
  { id: "u_ada", name: "Ada Threeby", email: "ada@t.test", phone: null,
    role: "tenant", subId: null, propertyIds: ["prop_1"], unit: "3B", hasLogin: true,
    inviteSentAt: null, hasAvatar: false },
];
// An ACCEPTED work order, because a company that has not said yes to the job
// cannot be waited on for the time -- which is what makes the contractor a
// party at all.
const accepted = (wo, subId = "cmp_pac") => ({ plumbing: {
  id: wo, wo, subId, status: "accepted", auto: false,
  responseWindow: null, respondBy: null, respondedAt: null, value: "400",
  payKind: "fixed", rate: "", capHours: null, tradeScope: null, crewName: null,
  signedWO: null, rating: null,
} });
const job = (id, title, extra = {}, subId = "cmp_pac") => ({
  id, accountId: "acc_pm", propertyId: "prop_1", title, status: "active",
  date: "2026-10-01", time: "09:00", address: "1620 Belmont Ave", area: "Seattle", zip: "98122",
  trades: ["plumbing"], assignments: accepted(`WO-${id}`, subId), notes: "", createdAt: "2026-09-20",
  photos: [], severity: null, client: null, sqft: null, stories: null, scope: "",
  measurementDocs: [], materialSource: null, materialsPaidBy: null,
  requestedBy: null, approvedAt: "2026-09-20", declinedAt: null, withdrawnAt: null,
  completedAt: null, access: null, accessEffective: "manager", accessUserId: null,
  reportDetail: null, propertyName: "Press Apartments", visit: null, ...extra,
});

// Four jobs, and each one is a branch that cannot be seen on the others.
const JOBS = () => [
  // The reported one: raised by the account, past its date, nobody requested it.
  job("mine", "Press Apartments - leaking sink"),
  // A tenant's request, which is the branch that already worked.
  job("asked", "Bathroom extractor dead",
    { requestedBy: "u_ada", accessEffective: "tenant", accessUserId: "u_ada" }),
  // A request nobody has approved. Scheduling it would book work nobody has
  // agreed to do.
  job("pending", "Repaint the lobby", { requestedBy: "u_ada", approvedAt: null }),
  // Raised from an inspection: no requester at all, and the tenant of the unit
  // named on `accessUserId`. Before 062 this block read `requestedBy` and so
  // named nobody.
  job("insp", "Move-out work - unit 3B",
    { accessEffective: "tenant", accessUserId: "u_ada" }),
  // THE SAME SHAPE AS THE FIRST, held by a HANDYMAN. Everything else about it
  // is identical, so the only thing the sentences can differ by is the
  // engagement.
  job("handy", "Ballard - tap washer", {}, "cmp_hdy"),
];

// A live window on the reported job, so the propose form is a REPLACEMENT
// rather than a first booking -- which is the actual ask.
const VISITS = () => [{
  id: "v1", jobId: "mine", status: "proposed", date: "2026-10-01",
  startTime: "09:00", endTime: "11:00", note: "", tenantNote: null,
  respondedAt: null, contractorAt: null, contractorNote: null,
  proposedBy: "u_mgr", createdAt: "2026-09-25",
}];

const sent = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/subs") return [200, [SUB, HANDY]];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, JOBS()];
  if (path === "/api/visits") return [200, VISITS()];
  if (/^\/api\/jobs\/[^/]+\/visits$/.test(path) && method === "POST") {
    sent.push({ path, body });
    return [201, { ok: true, status: "proposed" }];
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
const browser = await launch();

// The card bodies render inline, so this only has to find the card -- but it
// clicks the head when the block is absent, because a card that collapses
// later must not turn every assertion below into a silent "not there".
const openCard = (page, title) => page.evaluate((tt) => {
  const card = [...document.querySelectorAll(".job-card")]
    .find((el) => (el.querySelector("h3")?.innerText || "").toUpperCase().includes(tt.toUpperCase()));
  if (!card) return false;
  if (!card.querySelector(".visit-block")) {
    (card.querySelector(".job-card-head") || card.querySelector("h3") || card).click();
  }
  return true;
}, title);

const cardBlock = (page, title) => page.evaluate((tt) => {
  const card = [...document.querySelectorAll(".job-card")]
    .find((el) => (el.querySelector("h3")?.innerText || "").toUpperCase().includes(tt.toUpperCase()));
  if (!card) return { missing: "card" };
  const el = card.querySelector(".visit-block");
  if (!el) return null;
  return {
    state: (el.querySelector(".visit-state")?.innerText || "").replace(/\s+/g, " ").trim(),
    noteLabel: [...el.querySelectorAll("label")].map((l) => l.innerText.replace(/\s+/g, " ").trim())
      .find((x) => /^Note for/.test(x)) || "",
    buttons: [...el.querySelectorAll("button")].map((b) => b.innerText.trim()),
    hasForm: !!el.querySelector("input[type=date]"),
  };
}, title);

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1340, height: 2200 } });
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

  console.log("\n-- a job the account raised itself can be scheduled --");
  await openCard(page, "leaking sink");
  await wait(600);
  const mine = await cardBlock(page, "leaking sink");
  t.ck("the scheduling block is on it", !!mine && !mine.missing, JSON.stringify(mine));
  // WAITING ON THE CONTRACTOR, not on a tenant who is not in the loop.
  t.ck("and it is waiting on the contractor to confirm",
    /waiting on the contractor/i.test(mine?.state || ""), mine?.state);
  t.ck("rather than on a tenant nobody asked",
    !/waiting on the tenant/i.test(mine?.state || ""), mine?.state);

  console.log("\n-- and the time can be replaced, which goes back out for approval --");
  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".job-card")]
      .find((el) => /leaking sink/i.test(el.querySelector("h3")?.innerText || ""));
    [...(card?.querySelectorAll(".visit-block button") || [])]
      .find((b) => /propose|time|change/i.test(b.innerText))?.click();
  });
  await wait(500);
  const form = await cardBlock(page, "leaking sink");
  t.ck("the propose form opens on it", form?.hasForm === true, JSON.stringify(form));
  // THE NOTE GOES TO WHOEVER ATTENDS. It said "Note for the tenant" on a job
  // with no tenant in the loop at all -- the wrong word on the one field that
  // tells a crew how to get in.
  t.ck("and the note is addressed to the contractor",
    /Note for the contractor/i.test(form?.noteLabel || ""), form?.noteLabel);

  sent.length = 0;
  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".job-card")]
      .find((el) => /leaking sink/i.test(el.querySelector("h3")?.innerText || ""));
    const el = card?.querySelector(".visit-block");
    const d = el?.querySelector("input[type=date]");
    if (d) {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(d, "2026-10-20");
      d.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await wait(300);
  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".job-card")]
      .find((el) => /leaking sink/i.test(el.querySelector("h3")?.innerText || ""));
    [...(card?.querySelectorAll(".visit-block button") || [])]
      .find((b) => /send|propose|save/i.test(b.innerText) && !/cancel/i.test(b.innerText))?.click();
  });
  await wait(900);
  t.ck("sending it asks the server once",
    sent.filter((x) => /\/visits$/.test(x.path)).length === 1, JSON.stringify(sent));
  t.ck("carrying the new date",
    sent.find((x) => /\/visits$/.test(x.path))?.body?.date === "2026-10-20",
    JSON.stringify(sent.find((x) => /\/visits$/.test(x.path))?.body));

  console.log("\n-- and a tenant's request still has one, in the same place --");
  await openCard(page, "extractor dead");
  await wait(600);
  const asked = await cardBlock(page, "extractor dead");
  // THE BRANCH THAT ALREADY WORKED. A fix that drew the block nowhere passes
  // every assertion above on its own; this is what tells the two apart.
  t.ck("the block is on a tenant-requested job too", !!asked && !asked.missing, JSON.stringify(asked));
  t.ck("and it names the tenant by name",
    /Ada Threeby/.test(asked?.state || "") || /Note for Ada Threeby/.test(asked?.noteLabel || ""),
    `${asked?.state} | ${asked?.noteLabel}`);

  console.log("\n-- an inspection-raised job names the tenant of the unit --");
  await openCard(page, "Move-out work");
  await wait(600);
  const insp = await cardBlock(page, "Move-out work");
  t.ck("the block is on it", !!insp && !insp.missing, JSON.stringify(insp));
  // 062 PUT THE TENANT ON `accessUserId` AND THIS BLOCK READ `requestedBy`,
  // which an inspection-raised job does not have -- so it named nobody.
  t.ck("and names them rather than falling back to \"the tenant\"",
    /Ada Threeby/.test(`${insp?.state} ${insp?.noteLabel}`),
    `${insp?.state} | ${insp?.noteLabel}`);

  console.log("\n-- and the party is called what this roster calls them --");
  await openCard(page, "tap washer");
  await wait(600);
  const handy = await cardBlock(page, "tap washer");
  t.ck("the block is on the handyman's job", !!handy && !handy.missing, JSON.stringify(handy));
  // Reported as *"it should actually say handyman since pacific is a
  // handyman"*. `VISIT_PARTIES.contractor.label` was a flat constant, so every
  // handyman on every roster was called the contractor on the one line that
  // says who an appointment is waiting on.
  t.ck("the party on it is the handyman",
    /the handyman/i.test(handy?.state || ""), handy?.state);
  t.ck("rather than \"the contractor\"",
    !/the contractor/i.test(handy?.state || ""), handy?.state);
  // THE NOTE IS ADDRESSED THE SAME WAY, which is the one field that tells
  // whoever turns up how to get in.
  t.ck("and the note is addressed to the handyman",
    /Note for the handyman/i.test(handy?.noteLabel || ""), handy?.noteLabel);
  // AND THE HIRING SIDE KEEPS ITS OWN LABEL beside it: a change that painted
  // every party with the word would pass both checks above.
  t.ck("while the hiring side is still the hiring side",
    /the hiring side/i.test(handy?.state || ""), handy?.state);
  // AND THE SUBCONTRACTOR'S JOB ON THE SAME ROSTER STILL SAYS CONTRACTOR,
  // asserted in the same place: a change that renamed every party "handyman"
  // would pass every assertion above, and the account kind decides that word.
  const stillSub = await cardBlock(page, "leaking sink");
  t.ck("while a subcontractor's job keeps the roster word",
    /the contractor/i.test(stillSub?.state || ""), stillSub?.state);
  t.ck("and is not called a handyman",
    !/handyman/i.test(stillSub?.state || ""), stillSub?.state);

  console.log("\n-- and an unapproved request still gets none --");
  await openCard(page, "Repaint the lobby");
  await wait(600);
  const pending = await cardBlock(page, "Repaint the lobby");
  t.ck("the card is there", pending?.missing !== "card", JSON.stringify(pending));
  // Scheduling a request nobody has approved would book work nobody has
  // agreed to do. Asserted in the same place as the positive cases.
  t.ck("but no scheduling block on it", pending === null, JSON.stringify(pending));

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
