// "NO DATE" OVER A JOB SOMEBODY HAD PROPOSED A SATURDAY MORNING FOR.
//
// Driven in a browser because every claim here is only true as drawn, and the
// static half passes over exactly this bug: `/api/my-work` can carry the visit
// perfectly while the card goes on reading `job.date`, which is what it did.
//
//   THE WINDOW IS ON THE CARD. Not "the component mentions workWhen" -- the
//   rendered text, on the card this company is asked to accept.
//
//   PROPOSED AND CONFIRMED DO NOT READ THE SAME. Two states reading the same
//   pixels is the chip bug this project already paid for: correct markup,
//   nothing on screen, no mutation able to see it. Only computed colour can.
//
//   THE SCHEDULE PANEL IS REALLY THERE, with the right day on it and the
//   fortnight strip marking it.
//
//   AND A JOB WITH NOTHING ANYWHERE STILL SAYS SO. Making a field optional
//   makes every screen that prints it unconditionally a screen with a hole.
////   061: THE WINDOW CAN BE ANSWERED FROM HERE. Confirm it, or offer another --
//   the half the contractor had no way to say at all, since the only answers
//   on their card were accept or decline the WORK, and a time that does not
//   suit is not a reason to turn a job down. Driven rather than asserted
//   statically, because the gate is on a value that only exists at runtime and
//   a check that the component MENTIONS it passes with the button never wired.
//
//   AND ONCE WE HAVE ANSWERED THERE IS NO BUTTON, only who is still owed. A
//   Confirm on a window you confirmed an hour ago is a button that does
//   nothing.
//
//   node --no-warnings scripts/work-when-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-workwhen-test");
const WEB = 5329, API = 9027;
const t = tally();

// Dates relative to today, so the suite does not go stale and the strip has
// something on it whenever it runs.
const day = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const SOON = day(2), LATER = day(5);

const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_juan", name: "Juan Soto", email: "juan@pacificam.test", role: "contractor" },
};
const SUB = {
  id: "cmp_pac", company: "Pacific apartment maintenance", engagementId: "en_pac",
  accountId: "acc_pm", contact: "Juan Soto", email: "juan@pacificam.test", phone: null,
  categories: ["electrical", "plumbing"], caps: [], crews: [], propertyIds: [], zips: [],
  notify: {}, rating: null, bond: true, insurance: true, contract: true, w9: true,
  hasPortal: true, license: "", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {}, engagedAs: "handyman",
};

// Three rows, each a different answer to "when". The whole suite turns on
// their being different: a fixture where every row has the same kind of time
// cannot tell the three apart.
const WORK = () => ({ work: [
  { woId: "wo_brk", wo: "WO-209115", jobId: "job_brk", trade: "electrical",
    accountId: "acc_pm", accountName: "Sound Property Management",
    accountSubdomain: "soundpm", accountKind: "property_manager", here: true,
    status: "accepted", auto: false, responseWindow: null, respondBy: null, respondedAt: null,
    title: "Sparking breaker", address: "4915 North Highland ST", area: "Ruston", zip: "98407",
    propertyName: null, date: null, time: null, severity: null, jobStatus: "active",
    completedAt: null, tradeScope: null, crewName: null, payKind: "fixed", value: "100",
    rate: "", capHours: null, signedWO: null, issuedAt: null, updatedAtIso: null,
    // The reported case: no date on the job, a proposed window on the visit.
    visit: { id: "v1", date: SOON, startTime: "11:00", endTime: "13:15",
      status: "proposed", note: "Gate code 4417",
      // 064. WHOSE TURN IT IS, as the server works it out. The crew is first
      // in the chain, so this is the row the panel is drawn on.
      turn: "contractor", waitingOn: ["contractor", "manager", "tenant"] } },
  { woId: "wo_sink", wo: "WO-745746", jobId: "job_sink", trade: "plumbing",
    accountId: "acc_pm", accountName: "Sound Property Management",
    accountSubdomain: "soundpm", accountKind: "property_manager", here: true,
    status: "accepted", auto: false, responseWindow: null, respondBy: null, respondedAt: null,
    title: "Press Apartments - leaking sink", address: "1620 Belmont Ave", area: "Seattle",
    zip: "98122", propertyName: null, date: day(-9), time: "07:00", severity: null,
    jobStatus: "active", completedAt: null, tradeScope: null, crewName: null,
    payKind: "fixed", value: "100", rate: "", capHours: null, signedWO: null,
    issuedAt: null, updatedAtIso: null,
    // A job date in the PAST and a confirmed visit ahead of it: the only
    // fixture that can show which of the two the screen is reading.
    visit: { id: "v2", date: LATER, startTime: "14:00", endTime: "16:00",
      status: "confirmed", note: null },
    // 073. HOW THEY GET IN, as the server shapes it for this crew: the tenant
    // who is letting them in, by first name and mobile, and their own row.
    accessPlan: { kind: "tenant", how: "Meet at the front door", howFrom: "tenant", live: true,
      when: { date: LATER, startTime: "14:00", endTime: "16:00", status: "confirmed" },
      people: [{ side: "tenant", firstName: "John", phone: "2065550111", bestTime: "after 9am" },
        { side: "crew", company: "Pacific apartment maintenance", firstName: "Juan",
          phone: "2065550122", you: true }] } },
  // 061. A window WE have already agreed and the tenant has not. The only row
  // that can tell "offer a Confirm" apart from "say who is left", and without
  // it a card that always drew the buttons would pass.
  { woId: "wo_gate", wo: "WO-777", jobId: "job_gate", trade: "plumbing",
    accountId: "acc_pm", accountName: "Sound Property Management",
    accountSubdomain: "soundpm", accountKind: "property_manager", here: true,
    status: "accepted", auto: false, responseWindow: null, respondBy: null, respondedAt: null,
    title: "Unit 12 shower", address: "1620 Belmont Ave", area: "Seattle", zip: "98122",
    propertyName: null, date: null, time: null, severity: null, jobStatus: "active",
    completedAt: null, tradeScope: null, crewName: null, payKind: "fixed", value: "100",
    rate: "", capHours: null, signedWO: null, issuedAt: null, updatedAtIso: null,
    access: "tenant",
    visit: { id: "v4", date: LATER, startTime: "08:00", endTime: "10:00",
      status: "proposed", note: null, contractorAt: "2026-10-02T09:00:00.000Z",
      // TWO PARTIES STILL OWED, not one, and that is what makes the line
      // discriminating: with only the tenant left, a hard-coded "the tenant"
      // -- which is what 061 shipped -- gives the same answer as reading the
      // row, so the fixture would be covering for the guard.
      turn: "manager", waitingOn: ["manager", "tenant"] } },
  // 064. A WINDOW WE HAVE NOT ANSWERED AND IT IS NOT OUR TURN, because the
  // work order is still PENDING -- somebody who has not said yes to the JOB
  // is not a party to the TIME. The only row that can tell the turn gate
  // apart from 061's "have we answered": the old rule offers Confirm here,
  // the route refuses it with `not_your_turn`, and nothing awaited the
  // refusal.
  { woId: "wo_wait", wo: "WO-888", jobId: "job_wait", trade: "electrical",
    accountId: "acc_pm", accountName: "Sound Property Management",
    accountSubdomain: "soundpm", accountKind: "property_manager", here: true,
    status: "pending", auto: false, responseWindow: "24h",
    respondBy: new Date(Date.now() + 36e5).toISOString(), respondedAt: null,
    title: "Basement sump", address: "4915 North Highland ST", area: "Ruston", zip: "98407",
    propertyName: null, date: null, time: null, severity: null, jobStatus: "active",
    completedAt: null, tradeScope: null, crewName: null, payKind: "fixed", value: "100",
    rate: "", capHours: null, signedWO: null, issuedAt: null, updatedAtIso: null,
    visit: { id: "v5", date: LATER, startTime: "09:00", endTime: "10:00",
      status: "proposed", note: null, turn: "manager", waitingOn: ["manager", "tenant"] } },
  // AND A ROW AT ANOTHER CLIENT, with a time waiting on us. Answering is an
  // account-scoped write so it cannot be done from here -- but the time still
  // has to be answered, and a card that says so and offers nothing is a dead
  // end on the one screen where it costs a missed appointment.
  { woId: "wo_away", wo: "WO-999", jobId: "job_away", trade: "plumbing",
    accountId: "acc_cas", accountName: "Cascade Management",
    accountSubdomain: "cascade", accountKind: "property_manager", here: false,
    status: "accepted", auto: false, responseWindow: null, respondBy: null, respondedAt: null,
    title: "Elliott Court - stack leak", address: "90 Elliott Ave", area: "Seattle",
    zip: "98121", propertyName: null, date: day(9), time: "08:00", severity: null,
    jobStatus: "active", completedAt: null, tradeScope: null, crewName: null,
    payKind: "fixed", value: "100", rate: "", capHours: null, signedWO: null,
    issuedAt: null, updatedAtIso: null,
    visit: { id: "v6", date: LATER, startTime: "13:00", endTime: "14:00",
      status: "proposed", note: null, turn: "contractor", waitingOn: ["contractor"] } },
  { woId: "wo_none", wo: "WO-111", jobId: "job_none", trade: "electrical",
    accountId: "acc_pm", accountName: "Sound Property Management",
    accountSubdomain: "soundpm", accountKind: "property_manager", here: true,
    status: "accepted", auto: false, responseWindow: null, respondBy: null, respondedAt: null,
    title: "Hallway light", address: "4915 North Highland ST", area: "Ruston", zip: "98407",
    propertyName: null, date: null, time: null, severity: null, jobStatus: "active",
    completedAt: null, tradeScope: null, crewName: null, payKind: "fixed", value: "100",
    rate: "", capHours: null, signedWO: null, issuedAt: null, updatedAtIso: null,
    visit: null },
  // A TARGET DATE WITH NO HOUR ON IT, on a day that already has work -- so it
  // changes neither the strip count nor the undated tally, and is the only row
  // that can show what the time line says when there is no time to say.
  // At Cascade, which is already a client -- so this adds a row without
  // adding a company, and `here: false` is what puts it on the schedule at
  // all: a row on THIS account arrives through /api/jobs instead.
  { woId: "wo_tgt", wo: "WO-222", jobId: "job_tgt", trade: "painting",
    accountId: "acc_cas", accountName: "Cascade Management",
    accountSubdomain: "cascade", accountKind: "property_manager", here: false,
    status: "accepted", auto: false, responseWindow: null, respondBy: null, respondedAt: null,
    title: "Repaint the lobby", address: "1620 Belmont Ave", area: "Seattle", zip: "98122",
    propertyName: null, date: LATER, time: null, severity: null, jobStatus: "active",
    completedAt: null, tradeScope: null, crewName: null, payKind: "fixed", value: "100",
    rate: "", capHours: null, signedWO: null, issuedAt: null, updatedAtIso: null,
    visit: null,
    // At another client, opened by the office: the crew is given the office.
    accessPlan: { kind: "manager", how: null, howFrom: null, live: true, when: null,
      people: [{ side: "manager", firstName: "Dana", phone: "2065550133" },
        { side: "crew", company: "Pacific apartment maintenance", firstName: "Juan",
          phone: "2065550122", you: true }] } },
] });

// THE ROWS AS /api/jobs SERVES THEM, which is where the card for the account
// you are standing in actually comes from. `myWork` is the cross-account half;
// the reported screenshot is the local one, so that is the path driven here --
// and it is the path where the visit has to arrive through `myVisits` rather
// than off the row itself.
const assign = (trade, wo) => ({ [trade]: {
  id: wo, wo, subId: "cmp_pac", status: "accepted", auto: false,
  responseWindow: null, respondBy: null, respondedAt: null, value: "100",
  payKind: "fixed", rate: "", capHours: null, tradeScope: null, crewName: null,
  signedWO: null, rating: null,
} });
const job = (over) => ({
  id: over.id, accountId: "acc_pm", propertyId: null, title: over.title,
  status: "active", date: over.date || null, time: over.time || null,
  address: over.address || "4915 North Highland ST", area: "Ruston", zip: "98407",
  trades: [over.trade], assignments: assign(over.trade, over.wo), notes: "",
  createdAt: "2026-10-01", photos: [], severity: null, client: null,
  sqft: null, stories: null, scope: "",
});
const JOBS = () => [
  job({ id: "job_brk", title: "Sparking breaker", trade: "electrical", wo: "WO-209115" }),
  job({ id: "job_gate", title: "Unit 12 shower", trade: "plumbing", wo: "WO-777",
    address: "1620 Belmont Ave" }),
  job({ id: "job_sink", title: "Press Apartments - leaking sink", trade: "plumbing",
    wo: "WO-745746", date: day(-9), time: "07:00", address: "1620 Belmont Ave" }),
  job({ id: "job_none", title: "Hallway light", trade: "electrical", wo: "WO-111" }),
  // The pending-work-order row, which is where the turn gate is visible. Its
  // assignment has to be pending HERE too, or the card is drawn from an
  // accepted one and the fixture stops discriminating.
  { ...job({ id: "job_wait", title: "Basement sump", trade: "electrical", wo: "WO-888" }),
    assignments: { electrical: { id: "WO-888", wo: "WO-888", subId: "cmp_pac",
      status: "pending", auto: false, responseWindow: "24h",
      respondBy: new Date(Date.now() + 36e5).toISOString(), respondedAt: null,
      value: "100", payKind: "fixed", rate: "", capHours: null, tradeScope: null,
      crewName: null, signedWO: null, rating: null } } },
];

// 061. What actually reached the server. "A button is on screen" is not the
// property under test -- it could render and the request never go, which is
// the shape this project records about a modal that appears while the removal
// fires anyway.
const answers = [];
const proposals = [];
// What the propose route answers, when a block wants it to refuse. Null is the
// ordinary 201.
let proposeReply = null;

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (/^\/api\/visits\/[^/]+\/respond$/.test(path) && method === "POST") {
    answers.push({ id: path.split("/")[3], ...body });
    return [200, { id: path.split("/")[3], jobId: "job_brk", date: SOON,
      startTime: "11:00", endTime: "13:15", status: "proposed",
      contractorAt: new Date().toISOString(), parties: ["tenant", "contractor"],
      waitingOn: ["tenant"] }];
  }
  if (/^\/api\/jobs\/[^/]+\/visits$/.test(path) && method === "POST") {
    if (proposeReply) return proposeReply;
    proposals.push({ jobId: path.split("/")[3], ...body });
    return [201, { id: "v9", jobId: path.split("/")[3], date: body.date,
      startTime: body.startTime, endTime: body.endTime, status: "proposed",
      contractorAt: new Date().toISOString(), parties: ["tenant", "contractor"],
      waitingOn: ["tenant"] }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/account-users") return [200, [
    { id: "u_juan", name: "Juan Soto", email: "juan@pacificam.test", phone: null,
      role: "contractor", subId: "cmp_pac", propertyIds: [], unit: null,
      hasLogin: true, inviteSentAt: null, hasAvatar: false },
  ]];
  if (path === "/api/my-work") return [200, WORK()];
  if (path === "/api/jobs") return [200, JOBS()];
  if (path === "/api/properties" || path === "/api/invites"
    || path === "/api/clients" || path === "/api/my-connect-requests"
    || path === "/api/connect-requests" || path === "/api/property-transfers"
    || path === "/api/visits" || path === "/api/my-quotes"
    || path === "/api/doc-shares" || path === "/api/inspections") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

// Every card on the dashboard, as the browser drew it.
const cards = (page) => page.evaluate(() => [...document.querySelectorAll(".jr-card")].map((el) => {
  const when = el.querySelector(".jr-when");
  const note = el.querySelector(".jr-whennote");
  const cs = note ? getComputedStyle(note) : null;
  return {
    title: (el.querySelector("h3")?.innerText || "").trim(),
    when: (when?.innerText || "").replace(/\s+/g, " ").trim(),
    note: (note?.innerText || "").replace(/\s+/g, " ").trim(),
    bg: cs ? cs.backgroundColor : null,
    // The proposer's note. On a window waiting on us it rides inside the
    // panel, beside the window it is about, rather than in the line under the
    // card's status -- which is where it was when the status line was there.
    msg: (el.querySelector(".jr-whenmsg")?.innerText
      || el.querySelector(".vans-note")?.innerText || "").trim(),
    // 061/064. What can be done about the time from here. The chip row became
    // a block -- `.vans` -- because the person it is aimed at could not see
    // it: a 12.5px question and two inline buttons in a card with five other
    // rows of small bold text.
    ask: (el.querySelector(".vans-q")?.innerText || "").replace(/\s+/g, " ").trim(),
    lead: (el.querySelector(".vans-head")?.innerText || "").replace(/\s+/g, " ").trim(),
    big: (el.querySelector(".vans-when")?.innerText || "").replace(/\s+/g, " ").trim(),
    bigPx: el.querySelector(".vans-when")
      ? parseFloat(getComputedStyle(el.querySelector(".vans-when")).fontSize) : null,
    panelBg: el.querySelector(".vans")
      ? getComputedStyle(el.querySelector(".vans")).backgroundColor : null,
    btns: [...el.querySelectorAll(".vacts .vact")].map((b) => b.innerText.trim()),
    // THE SIZE IS THE FEATURE, so it is measured rather than described. The
    // request was "very clear and well designed large buttons"; the row these
    // replaced rendered the same words at the card's own small size, so every
    // assertion about the WORDS above passes over the control that was
    // reported as hidden. Kind as well as geometry, because what paints a
    // button is what says which of the three acts it is.
    acts: [...el.querySelectorAll(".vacts .vact")].map((b) => {
      const r = b.getBoundingClientRect();
      const row = b.closest(".vacts").getBoundingClientRect();
      return {
        label: b.innerText.trim(),
        kind: [...b.classList].find((k) => k.startsWith("vact-"))?.slice(5) || null,
        h: Math.round(r.height), px: parseFloat(getComputedStyle(b).fontSize),
        wide: row.width ? r.width / row.width : 0,
      };
    }),
    wait: (el.querySelector(".jr-vis-wait")?.innerText || "").replace(/\s+/g, " ").trim(),
    access: (el.querySelector(".jr-access")?.innerText || "").replace(/\s+/g, " ").trim(),
  };
}));

const sched = (page) => page.evaluate(() => {
  const el = document.querySelector(".my-sched");
  if (!el) return { panel: false };
  return {
    panel: true,
    head: (el.querySelector(".sh-head h3")?.innerText || "").trim(),
    next: (el.querySelector(".sh-next")?.innerText || "").replace(/\s+/g, " ").trim(),
    rows: [...el.querySelectorAll(".mys-row")].map((r) => (r.innerText || "").replace(/\s+/g, " ").trim()),
    // The two halves of the when column, read separately: a check on the row's
    // whole text passes with the day and the time run together, and the fault
    // this is about is a column that said one and not the other.
    when: [...el.querySelectorAll(".mys-row")].map((r) => ({
      day: (r.querySelector(".mysd-day")?.innerText || "").trim(),
      time: (r.querySelector(".mysd-time")?.innerText || "").trim(),
      title: (r.querySelector(".mys-title")?.innerText || "").trim(),
    })),
    marked: [...el.querySelectorAll(".shs-day.has")].length,
    soft: [...el.querySelectorAll(".shs-day.soft")].length,
    undated: (el.querySelector(".sh-undated")?.innerText || "").replace(/\s+/g, " ").trim(),
  };
});

try {
  console.log("\n-- the card finally says when --");
  const { ctx, page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_juan", accountId: "acc_pm" }, viewport: { width: 1340, height: 1600 } });
  await wait(2900);
  await openCards(page);

  const all = await cards(page);
  t.ck("the portal rendered its cards", all.length >= 3, JSON.stringify(all.map((c) => c.title)));
  const brk = all.find((c) => /Sparking breaker/i.test(c.title));
  const sink = all.find((c) => /leaking sink/i.test(c.title));
  const none = all.find((c) => /Hallway light/i.test(c.title));

  // THE WHOLE REPORT. This card read "No date".
  t.ck("a proposed window is on the card", !!brk && /11 AM/.test(brk.when) && /1:15 PM/.test(brk.when),
    JSON.stringify(brk));
  t.ck("and it is not drawn as having no date", !!brk && !/No date/i.test(brk.when), brk?.when);
  // Said, not left to the colour: the difference is whether you get in the van.
  // On a window waiting on US that sentence is the panel's, which leads the
  // card -- the status line under it is off while the panel is up.
  t.ck("it says a time has been proposed",
    !!brk && /proposed/i.test(brk.lead), brk?.lead);
  // A gate code is exactly what a contractor needs and nothing else carried
  // it -- and it has to survive the move into the panel, which is the one
  // place it is read on the way to the job.
  t.ck("the proposer's note rides along", !!brk && /4417/.test(brk.msg), brk?.msg);

  // THE DISCRIMINATING ROW: the job says nine days ago, the confirmed visit
  // says five days out. Reading the job column passes the assertion above.
  t.ck("a confirmed visit beats the job's own date",
    !!sink && /2 PM/.test(sink.when) && /4 PM/.test(sink.when), JSON.stringify(sink));
  // 061 changed this sentence deliberately: the tenant is no longer the only
  // party and on plenty of jobs is not a party at all, so the line says
  // whether it is SETTLED rather than naming one of the two sides.
  t.ck("and says it is agreed by everybody who has to be there",
    !!sink && /everybody who has to be there/i.test(sink.note), sink?.note);

  // Two states reading the same pixels is the bug this project already paid
  // for. Only the computed value can see it.
  //
  // WHAT DRAWS THE DIFFERENCE MOVED. The proposed card's status LINE is off
  // while the answer panel is up -- "Proposed, not confirmed yet" over a block
  // saying the same thing in bigger type is the line that makes somebody stop
  // reading both -- so the panel's own background is what carries it now, and
  // the confirmed card has no panel at all.
  t.ck("a proposed window is drawn as a panel, a confirmed one is not",
    !!brk?.panelBg && !sink?.panelBg, `${brk?.panelBg} vs ${sink?.panelBg}`);
  t.ck("and the confirmed card still says so in its own line",
    !!sink?.bg && /everybody who has to be there/i.test(sink.note || ""),
    `${sink?.bg} | ${sink?.note}`);

  // A hole where an optional field used to be interpolated is the shape this
  // project records about a dangling em dash.
  t.ck("nothing anywhere still says so", !!none && /No date yet/i.test(none.when), none?.when);
  t.ck("and names it as the problem it is",
    !!none && /no visit time proposed/i.test(none.note), none?.note);

  console.log("\n-- and they have a schedule of their own --");
  const s = await sched(page);
  t.ck("the panel is on the dashboard", s.panel === true, JSON.stringify(s));
  t.ck("headed as theirs", /your schedule/i.test(s.head || ""), s.head);
  // Ordered by the time that actually applies, so the proposed one two days
  // out leads the confirmed one five days out.
  t.ck("the next thing up is the nearer appointment",
    /Sparking breaker/i.test(s.next || ""), s.next);
  t.ck("and it says that one is not confirmed",
    /Not confirmed/i.test(s.next || ""), s.next);
  t.ck("what is after it is listed", (s.rows || []).some((r) => /leaking sink/i.test(r)),
    JSON.stringify(s.rows));
  t.ck("marked as confirmed, which the one above is not",
    (s.rows || []).some((r) => /leaking sink/i.test(r) && /Confirmed/.test(r)),
    JSON.stringify(s.rows));
  // The fortnight. Both days land on it; only one of them is settled.
  t.ck("both days are marked on the strip", s.marked === 2, String(s.marked));
  t.ck("and the unconfirmed one is drawn softer", s.soft === 1, String(s.soft));
  // The one thing a calendar can never show, and the most useful thing this
  // panel can report to somebody trying to fill a week.
  t.ck("the job with no time at all is counted, not hidden",
    /1 job has no date/i.test(s.undated || ""), s.undated);

  console.log("\n-- and every row says its date and its time --");
  {
    // Reported with four rows of this panel circled, all four reading
    // **Wednesday** and nothing else: *"Add date / time on these jobs too."*
    // The fixture is that case -- four jobs land on one day -- which is the
    // only shape where the fault is visible at all.
    const same = s.when.filter((r) => r.day === s.when[0]?.day);
    t.ck("several rows really do land on one day", same.length >= 3,
      JSON.stringify(s.when.map((r) => r.day)));
    // THE FIX: the day is no longer the whole of what a row says.
    t.ck("each of them carries a time",
      same.every((r) => !!r.time), JSON.stringify(same));
    // AND THE TIMES TELL THEM APART, which is the point rather than the
    // presence of a string: a column printing the same hour on every row
    // would pass the check above and leave the panel exactly as it was.
    const hours = same.map((r) => r.time).filter((x) => x !== "No time set");
    t.ck("and they are not all the same time",
      new Set(hours).size === hours.length && hours.length >= 2, JSON.stringify(hours));
    // THE DATE, not only the weekday. Past a week `relDay` answers "In 70
    // days", which is the one thing somebody reading a schedule cannot use --
    // so the day line carries a real date on everything but today and
    // tomorrow.
    t.ck("the day line names a date, not just a weekday",
      same.every((r) => /\d/.test(r.day)), JSON.stringify(same.map((r) => r.day)));
    t.ck("with the weekday still on it, which is what gets scanned",
      same.every((r) => /^[A-Z][a-z]{2}\b/.test(r.day)), JSON.stringify(same.map((r) => r.day)));
    // A WINDOW, not a bare start. How long they have got is the other half of
    // a time, and the card below is not where somebody plans a day from.
    t.ck("a window is drawn as a window",
      s.when.some((r) => /\u2013/.test(r.time)), JSON.stringify(s.when.map((r) => r.time)));
    // AND A ROW WITH NO HOUR SAYS SO. A blank there reads as a line that
    // failed to draw, which is the opposite of the fact it is reporting.
    const tgt = s.when.find((r) => /Repaint the lobby/i.test(r.title));
    t.ck("a job with a date and no hour says there is no time set",
      tgt?.time === "No time set", JSON.stringify(tgt));
    t.ck("and still says which day it is on", /\d/.test(tgt?.day || ""), JSON.stringify(tgt));

    // AND IT STILL FITS ON A PHONE, which is the one thing no static check
    // can see: a wider when column squeezing the title is how this fix would
    // pay for itself in the wrong place. Measured rather than asserted on the
    // CSS, because `white-space:nowrap` means a time that does not fit
    // overflows the row silently instead of wrapping.
    await page.setViewport({ width: 390, height: 1600 });
    await wait(500);
    const fit = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".my-sched .mys-row")];
      return rows.map((r) => {
        const box = r.getBoundingClientRect();
        const t = r.querySelector(".mysd-time")?.getBoundingClientRect();
        const ttl = r.querySelector(".mys-title")?.getBoundingClientRect();
        const when = r.querySelector(".mys-when")?.getBoundingClientRect();
        const cs = ttl ? getComputedStyle(r.querySelector(".mys-title")) : null;
        return {
          ws: cs?.whiteSpace,
          // Does the time run past the COLUMN it is in, which is the box that
          // can actually be too narrow -- the row's own right edge is 200px
          // away and an assertion against it could not fail.
          over: t && when ? Math.round(t.right - when.right) : null,
          title: ttl ? Math.round(ttl.width) : null,
          rows: ttl ? Math.round(ttl.height) : null,
          lines: t ? Math.round(t.height) : null };
      });
    });
    t.ck("no row's time runs past its own column at 390px",
      fit.every((r) => r.over !== null && r.over <= 1), JSON.stringify(fit));
    t.ck("the time stays on one line", fit.every((r) => r.lines <= 20), JSON.stringify(fit));
    // AND THE TITLE IS STILL A TITLE. A when column that took the row would
    // leave the thing somebody is actually looking for ellipsed to nothing --
    // the same failure the dashboard's request titles already record.
    // AND THE TITLE GETS A SECOND LINE RATHER THAN AN ELLIPSIS. Read as the
    // COMPUTED value, because only that knows whether the rule fired -- the
    // first version of it sat above the base `.mys-title` in the same
    // stylesheet, where a media query does not raise specificity and the later
    // of two identical selectors wins whatever the query says. Nothing about
    // the source looked wrong and the measured height said one line.
    t.ck("the title may wrap at 390px", fit.every((r) => r.ws === "normal"),
      JSON.stringify(fit.map((r) => r.ws)));
    // And it really does: a title too long for the column takes two lines
    // rather than being cut to about twelve characters. Not every row -- a
    // short one legitimately fits on one, and requiring two everywhere would
    // be an assertion about the fixture's titles.
    t.ck("and a long one takes two of them", fit.some((r) => r.rows >= 30),
      JSON.stringify(fit.map((r) => r.rows)));
    await page.setViewport({ width: 1340, height: 1600 });
    await wait(400);
    // SCOPED TO THE PHONE, not a blanket change: on a wide screen the row is
    // one line and an ellipsis is the right answer there.
    const wide = await page.evaluate(() => [...document.querySelectorAll(".my-sched .mys-title")]
      .map((e) => getComputedStyle(e).whiteSpace));
    t.ck("and is back to one line on a wide screen",
      wide.length > 0 && wide.every((w) => w === "nowrap"), JSON.stringify(wide));
  }

  console.log("\n-- 061/064: the window can be answered from here, loudly --");
  {
    const open = all.find((c) => /Sparking breaker/i.test(c.title));
    const mine = all.find((c) => /Unit 12 shower/i.test(c.title));
    const set = all.find((c) => /leaking sink/i.test(c.title));
    const nodate = all.find((c) => /Hallway light/i.test(c.title));
    const notmine = all.find((c) => /Basement sump/i.test(c.title));
    const away = all.find((c) => /stack leak/i.test(c.title));

    // THE HALF THE CONTRACTOR HAD NO WAY TO SAY. Accept or decline the WORK
    // was the whole of it, and a time that does not suit is not a reason to
    // turn a job down.
    t.ck("an open window asks whether we can make it",
      /can you make it/i.test(open?.ask || ""), open?.ask);
    // AND IT IS THE LOUDEST THING ON THE CARD, which is the whole of this
    // change: *"there should be big call to action on each one"*. 061 shipped
    // the control as a 12.5px chip row in a card with five other rows of
    // small bold text. Measured rather than described -- a static check that
    // the panel exists passes over one drawn at 12px in the old place.
    t.ck("the window is drawn at a size somebody reads at arm's length",
      (open?.bigPx || 0) >= 16, String(open?.bigPx));
    t.ck("and it carries the window itself", /11 AM/.test(open?.big || ""), open?.big);
    t.ck("offering to confirm it",
      (open?.btns || []).some((b) => /I'll be there/i.test(b)), JSON.stringify(open?.btns));
    t.ck("to offer another",
      (open?.btns || []).some((b) => /Propose a different time/i.test(b)),
      JSON.stringify(open?.btns));
    // DECLINE, which the request asked for and the route has always taken.
    // Two answers out of three is a screen that makes somebody turn the JOB
    // down to say no to a Tuesday.
    t.ck("and to say they cannot make it",
      (open?.btns || []).some((b) => /Can't make it/i.test(b)), JSON.stringify(open?.btns));

    // ONCE WE HAVE ANSWERED THERE IS NOTHING TO PRESS. A Confirm on a window
    // you confirmed an hour ago is a button that does nothing, and the honest
    // thing to draw is who is still owed.
    t.ck("a window we already agreed offers no buttons",
      (mine?.btns || []).length === 0 && !mine?.ask, JSON.stringify(mine?.btns));
    // WHO, read off the row rather than named on the card: 061 said "the
    // tenant" whatever the parties were.
    t.ck("and says who it is waiting on",
      /you confirmed this time/i.test(mine?.wait || "")
        && /the hiring side/i.test(mine?.wait || "") && /the tenant/i.test(mine?.wait || ""),
      mine?.wait);
    // 060's sentence, which was reading the RAW column off /api/jobs and so
    // rendered for almost nobody.
    t.ck("and who will open the door", /tenant will let you in/i.test(mine?.access || ""),
      mine?.access);

    // 064. NOT OUR TURN IS NOT THE SAME AS ALREADY ANSWERED. This row's work
    // order is still pending, so this company is not a party to the time at
    // all -- 061's gate ("have we answered") offers Confirm here, the route
    // refuses it with `not_your_turn`, and nothing awaited the refusal. The
    // only row either rule can be told apart on.
    t.ck("a window whose turn is somebody else's offers nothing",
      !notmine?.panelBg && (notmine?.btns || []).length === 0,
      `${notmine?.panelBg} | ${JSON.stringify(notmine?.btns)}`);
    // AND IT MUST NOT CLAIM WE CONFIRMED IT. `jr-vis-wait` is gated on our own
    // leg, not merely on the panel being down.
    t.ck("nor claims we confirmed it", !/you confirmed/i.test(notmine?.wait || ""),
      notmine?.wait);
    // The card is really there, or the two assertions above pass on a row
    // that never rendered.
    t.ck("and the card is really there", !!notmine, JSON.stringify(all.map((c) => c.title)));

    // A SETTLED WINDOW IS NOT ASKED AGAIN, and a job with no window has
    // nothing to answer -- asserting only the open row passes with the block
    // drawn on every card.
    t.ck("a confirmed window is not asked about", (set?.btns || []).length === 0,
      JSON.stringify(set?.btns));
    // A JOB THAT IS THEIRS WITH NO TIME ON IT IS NOT "NOTHING TO ANSWER" --
    // that was the old rule, and it is the card reported as auto-scheduled
    // with no day and nothing to press. It has nothing to CONFIRM, and one
    // thing to do: say when they can come.
    t.ck("a job with no time at all offers only a way to propose one",
      JSON.stringify(nodate?.btns || []) === JSON.stringify(["Propose a time"]),
      JSON.stringify(nodate?.btns));

    // A ROW AT ANOTHER CLIENT. Answering is an account-scoped write, so it
    // cannot be answered here -- but being TOLD is the whole point, and a
    // card that says so and offers nothing is a dead end on the one screen
    // where it costs a missed appointment. For a subcontractor ACCOUNT's own
    // admin every row arrives this way, which is why it matters.
    t.ck("a row at another client still shows the time", !!away?.panelBg,
      `${away?.panelBg} | ${away?.big}`);
    t.ck("and names where it has to be answered",
      /Cascade Management/.test(away?.ask || "") || /Cascade Management/.test((away?.btns || []).join(" ")),
      `${away?.ask} | ${JSON.stringify(away?.btns)}`);
    t.ck("rather than offering an answer it cannot post",
      !(away?.btns || []).some((b) => /I'll be there|Can't make it/i.test(b)),
      JSON.stringify(away?.btns));

    // THE CONTROLS ARE LARGE, AND THE SIZE IS WHAT WAS WRONG. The words were
    // already right; the row rendered them at the card's own 12.5px with two
    // inline chips, which is why it was reported as hidden on the one screen
    // where a missed press is a missed appointment. 44px is the smallest
    // target anybody recommends for a thumb and this is used on a phone at a
    // kerb, so the floor is asserted rather than the exact value -- a bound
    // the design may exceed and must not go under.
    const acts = (open?.acts || []);
    t.ck("there are controls to measure", acts.length === 3, JSON.stringify(acts));
    t.ck("every control is at least 44px high",
      acts.length === 3 && acts.every((a) => a.h >= 44),
      JSON.stringify(acts.map((a) => [a.label, a.h])));
    t.ck("and reads at 15px or more",
      acts.length === 3 && acts.every((a) => a.px >= 15),
      JSON.stringify(acts.map((a) => [a.label, a.px])));

    // EXACTLY ONE COMMITMENT PER ROW. `kind` carries the meaning so a caller
    // cannot pick colours, and the one thing that must never happen is a
    // decline wearing the commitment's green -- somebody tapping the solid
    // button to say no. Pinned in both directions: one `yes`, and no `no`
    // painted as one.
    t.ck("exactly one control is the commitment",
      acts.filter((a) => a.kind === "yes").length === 1,
      JSON.stringify(acts.map((a) => [a.label, a.kind])));
    t.ck("and the refusal is not painted as one",
      acts.some((a) => a.kind === "no" && /Can't make it/i.test(a.label)),
      JSON.stringify(acts.map((a) => [a.label, a.kind])));

    // AND ON A NARROW SCREEN EACH ONE TAKES THE ROW. Three controls sharing
    // 330px is three 100px targets side by side, which is the row this
    // replaced wearing a bigger font -- *"make it easy to select propose a
    // new time"*. Read as the DRAWN width, because the stack is a media
    // query and a rule written above the base one in the same stylesheet does
    // nothing while looking exactly like one that fired.
    //
    // MEASURED AT 540px AND NOT AT 390px, which is the whole of why this
    // assertion means anything. `min-width:168px` plus `flex-wrap` already
    // stacks them under about 345px, so at phone width the media query and
    // no media query at all draw the identical row -- deleting the query is a
    // mutation that SURVIVES there. 540 is the one band where the two differ:
    // two buttons fit side by side and the query is the only thing that stops
    // them pairing up. Choosing the narrower viewport would have been
    // choosing the width that flatters it.
    await page.setViewport({ width: 540, height: 1800 });
    await wait(500);
    const narrow = (await cards(page)).find((c) => /Sparking breaker/i.test(c.title));
    t.ck("every control takes the row on a narrow screen",
      (narrow?.acts || []).length === 3
        && narrow.acts.every((a) => a.wide > 0.9),
      JSON.stringify((narrow?.acts || []).map((a) => [a.label, a.wide.toFixed(2)])));
    t.ck("and is still at least 44px high there",
      (narrow?.acts || []).length === 3 && narrow.acts.every((a) => a.h >= 44),
      JSON.stringify((narrow?.acts || []).map((a) => [a.label, a.h])));
    await page.setViewport({ width: 1340, height: 1800 });
    await wait(500);

    // THE DECLINE PATH ASKS FOR A REASON FIRST, then posts it. A bare
    // "declined" tells the manager a window is dead and nothing about why,
    // which is a telephone call.
    await page.evaluate(() => [...document.querySelectorAll(".jr-card")]
      .find((el) => /Sparking breaker/i.test(el.querySelector("h3")?.innerText || ""))
      ?.querySelector(".vacts .vact-no")?.click());
    await wait(400);
    const why = await page.evaluate(() => {
      const card = [...document.querySelectorAll(".jr-card")]
        .find((el) => /Sparking breaker/i.test(el.querySelector("h3")?.innerText || ""));
      return !!card?.querySelector(".vans-why");
    });
    // Nothing is posted by opening it: a decline somebody backed out of is
    // not a decline.
    t.ck("saying no asks why first", why === true);
    t.ck("and posts nothing until it is sent", answers.length === 0, JSON.stringify(answers));
    // Back out of it, or the Confirm press below is looking for a button the
    // decline pane has replaced -- which would read as the panel being gone.
    await page.evaluate(() => [...document.querySelectorAll(".jr-card")]
      .find((el) => /Sparking breaker/i.test(el.querySelector("h3")?.innerText || ""))
      ?.querySelector(".vacts .vact-quiet")?.click());
    await wait(400);

    // AND PRESSING IT REACHES THE SERVER. The button could render and the
    // request never go.
    t.ck("nothing has been answered yet", answers.length === 0, JSON.stringify(answers));
    await page.evaluate(() => [...document.querySelectorAll(".jr-card")]
      .find((el) => /Sparking breaker/i.test(el.querySelector("h3")?.innerText || ""))
      ?.querySelector(".vacts .vact-yes")?.click());
    await wait(900);
    t.ck("confirming posts exactly one answer", answers.length === 1, JSON.stringify(answers));
    t.ck("and it says confirmed", answers[0]?.status === "confirmed",
      JSON.stringify(answers[0]));

    // AND CONFIRMING IS NOT A FORM. Wiring that button to the modal would
    // pass every assertion above and quietly make agreeing a window into
    // re-proposing it, which is a different act with a different record.
    t.ck("confirming did not open a form instead",
      await page.evaluate(() => !document.querySelector(".modal .visit-form")));

    // THE COUNTER-PROPOSAL IS THE SAME FORM THE MANAGER USES, in a modal,
    // and it names the job -- a date form with no subject is a date form
    // somebody fills in for the wrong job.
    await page.evaluate(() => [...document.querySelectorAll(".jr-card")]
      .find((el) => /stack leak/i.test(el.querySelector("h3")?.innerText || ""))
      ?.querySelector(".vacts .vact-alt")?.click());
    await wait(400);
    t.ck("a row at another client cannot even open the form",
      await page.evaluate(() => !document.querySelector(".modal .visit-form")));
    await page.evaluate(() => [...document.querySelectorAll(".jr-card")]
      .find((el) => /Unit 12 shower/i.test(el.querySelector("h3")?.innerText || ""))
      ?.querySelector(".vacts .vact-alt")?.click());
    await wait(400);
    t.ck("nor can a window we have already agreed",
      await page.evaluate(() => !document.querySelector(".modal .visit-form")));


    // A REFUSED PROPOSAL SAYS WHY. Reported as "tried to propose a time but
    // couldn't" over "Couldn't propose that. Try again in a moment." -- the
    // answer to every refusal but two, and trying again fixes none of them. The
    // one that caught it was a staff sign-in that had run out after thirty
    // minutes, refused with impersonation_expired and drawn as a blip.
    const proposeAs = async (reply) => {
      proposeReply = reply;
      await page.evaluate(() => document.querySelector(".modal .btn-ghost")?.click());
      await wait(300);
      await page.evaluate(() => {
        const card = [...document.querySelectorAll(".jr-card")]
          .find((el) => /Hallway light/i.test(el.querySelector("h3")?.innerText || ""));
        [...(card?.querySelectorAll("button") || [])]
          .find((b) => /^Propose a time$/.test(b.innerText.trim()))?.click();
      });
      await wait(400);
      const opened = await page.evaluate((d) => {
        const inp = document.querySelector(".modal .visit-form input[type=date]");
        if (!inp) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(inp, d);
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }, LATER);
      await wait(200);
      await page.evaluate(() => document.querySelector(".modal .visit-form .btn-solid")?.click());
      await wait(700);
      return page.evaluate((o) => ({
        opened: o,
        open: !!document.querySelector(".modal .visit-form"),
        err: (document.querySelector(".modal .visit-form .fld-err")?.innerText || "").trim(),
      }), opened);
    };
    const lapsed = await proposeAs([401, { error: "impersonation_expired" }]);
    t.ck("the propose form really opened", lapsed.opened === true, JSON.stringify(lapsed));
    t.ck("a lapsed staff sign-in says so, not 'try again'",
      /ran out/i.test(lapsed.err) && /30 minutes/.test(lapsed.err) && !/try again in a moment/i.test(lapsed.err),
      lapsed.err);
    t.ck("and the form stays open over what was not saved", lapsed.open === true);
    const noWo = await proposeAs([403, { error: "forbidden" }]);
    t.ck("losing the work order is named as that", /work order/i.test(noWo.err), noWo.err);
    const odd = await proposeAs([500, { error: "boom_unknown" }]);
    // An unknown refusal names its code: "try again" over something nobody
    // recognised is how the reported one stayed a mystery.
    t.ck("an unknown refusal names its code", /boom_unknown/.test(odd.err), odd.err);
    const before = proposals.length;
    const ok = await proposeAs(null);
    t.ck("and an accepted one closes the form", ok.open === false && proposals.length === before + 1,
      JSON.stringify({ ok, n: proposals.length - before }));
  }

  console.log("\n-- 073: who lets the crew in, and how to reach them --");
  {
    await page.evaluate(() => document.querySelector(".modal .btn-ghost")?.click());
    await wait(300);
    const accOf = (re) => page.evaluate((rs) => {
      const card = [...document.querySelectorAll(".jr-card")]
        .find((el) => new RegExp(rs, "i").test(el.querySelector("h3")?.innerText || ""));
      if (!card) return { card: false };
      const p = card.querySelector(".acc-panel");
      return {
        card: true, panel: !!p,
        text: (p?.innerText || "").replace(/\s+/g, " ").trim(),
        tel: [...(p?.querySelectorAll("a[href^='tel:']") || [])].map((a) => a.getAttribute("href")),
        line: (card.querySelector(".jr-access")?.innerText || "").trim(),
        edit: !!p?.querySelector(".acc-change"),
      };
    }, re.source);
    const sink = await accOf(/leaking sink/);
    t.ck("an accepted job carries an Access panel", sink.card && sink.panel, JSON.stringify(sink));
    t.ck("which says the tenant lets them in, by first name",
      /John \(the tenant\) lets you in\./.test(sink.text), sink.text);
    t.ck("where to meet and when", /Meet at the front door/.test(sink.text) && /said by the tenant/.test(sink.text),
      sink.text);
    t.ck("the tenant's mobile, with one tap to call",
      /\(206\)555-0111/.test(sink.text) && JSON.stringify(sink.tel) === JSON.stringify(["tel:2065550111"]),
      JSON.stringify(sink));
    t.ck("and the best time to reach them", /after 9am/.test(sink.text), sink.text);
    t.ck("the crew cannot rewrite where to meet", sink.edit === false);
    t.ck("and the old one-line sentence is gone where the panel is", sink.line === "", sink.line);
    const lobby = await accOf(/Repaint the lobby/);
    t.ck("a job the office opens names the office, not the tenant",
      /Dana from the office lets you in/.test(lobby.text) && !/2065550111|555-0111/.test(lobby.text), lobby.text);
    const wait_ = await accOf(/Basement sump/);
    t.ck("an offer not yet accepted carries no panel", wait_.card && !wait_.panel, JSON.stringify(wait_));
  }

  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
