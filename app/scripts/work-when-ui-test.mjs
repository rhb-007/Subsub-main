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
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

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
      status: "proposed", note: "Gate code 4417" } },
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
      status: "confirmed", note: null } },
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
      status: "proposed", note: null, contractorAt: "2026-10-02T09:00:00.000Z" } },
  { woId: "wo_none", wo: "WO-111", jobId: "job_none", trade: "electrical",
    accountId: "acc_pm", accountName: "Sound Property Management",
    accountSubdomain: "soundpm", accountKind: "property_manager", here: true,
    status: "accepted", auto: false, responseWindow: null, respondBy: null, respondedAt: null,
    title: "Hallway light", address: "4915 North Highland ST", area: "Ruston", zip: "98407",
    propertyName: null, date: null, time: null, severity: null, jobStatus: "active",
    completedAt: null, tradeScope: null, crewName: null, payKind: "fixed", value: "100",
    rate: "", capHours: null, signedWO: null, issuedAt: null, updatedAtIso: null,
    visit: null },
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
];

// 061. What actually reached the server. "A button is on screen" is not the
// property under test -- it could render and the request never go, which is
// the shape this project records about a modal that appears while the removal
// fires anyway.
const answers = [];
const proposals = [];

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
    msg: (el.querySelector(".jr-whenmsg")?.innerText || "").trim(),
    // 061. What can be done about the time from here.
    ask: (el.querySelector(".jr-vis-q")?.innerText || "").replace(/\s+/g, " ").trim(),
    btns: [...el.querySelectorAll(".jr-vis button")].map((b) => b.innerText.trim()),
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
  t.ck("it says the time is not confirmed yet",
    !!brk && /not confirmed yet/i.test(brk.note), brk?.note);
  // A gate code is exactly what a contractor needs and nothing else carried it.
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
  t.ck("confirmed and proposed are drawn differently",
    !!brk && !!sink && brk.bg && sink.bg && brk.bg !== sink.bg,
    `${brk?.bg} vs ${sink?.bg}`);

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

  console.log("\n-- 061: and the window can be answered from here --");
  {
    const open = all.find((c) => /Sparking breaker/i.test(c.title));
    const mine = all.find((c) => /Unit 12 shower/i.test(c.title));
    const set = all.find((c) => /leaking sink/i.test(c.title));
    const nodate = all.find((c) => /Hallway light/i.test(c.title));

    // THE HALF THE CONTRACTOR HAD NO WAY TO SAY. Accept or decline the WORK
    // was the whole of it, and a time that does not suit is not a reason to
    // turn a job down.
    t.ck("an open window asks whether we can make it",
      /can you make this/i.test(open?.ask || ""), open?.ask);
    t.ck("and offers to confirm it",
      (open?.btns || []).some((b) => /Confirm this time/i.test(b)), JSON.stringify(open?.btns));
    t.ck("or to offer another",
      (open?.btns || []).some((b) => /Propose a different time/i.test(b)),
      JSON.stringify(open?.btns));

    // ONCE WE HAVE ANSWERED THERE IS NOTHING TO PRESS. A Confirm on a window
    // you confirmed an hour ago is a button that does nothing, and the honest
    // thing to draw is who is still owed.
    t.ck("a window we already agreed offers no buttons",
      (mine?.btns || []).length === 0 && !mine?.ask, JSON.stringify(mine?.btns));
    t.ck("and says who it is waiting on",
      /you confirmed this time/i.test(mine?.wait || "") && /tenant/i.test(mine?.wait || ""),
      mine?.wait);
    // 060's sentence, which was reading the RAW column off /api/jobs and so
    // rendered for almost nobody.
    t.ck("and who will open the door", /tenant will let you in/i.test(mine?.access || ""),
      mine?.access);

    // A SETTLED WINDOW IS NOT ASKED AGAIN, and a job with no window has
    // nothing to answer -- asserting only the open row passes with the block
    // drawn on every card.
    t.ck("a confirmed window is not asked about", (set?.btns || []).length === 0,
      JSON.stringify(set?.btns));
    t.ck("nor a job with no time at all", (nodate?.btns || []).length === 0,
      JSON.stringify(nodate?.btns));

    // AND PRESSING IT REACHES THE SERVER. The button could render and the
    // request never go.
    t.ck("nothing has been answered yet", answers.length === 0, JSON.stringify(answers));
    await page.evaluate(() => [...document.querySelectorAll(".jr-card")]
      .find((el) => /Sparking breaker/i.test(el.querySelector("h3")?.innerText || ""))
      ?.querySelector(".jr-vis button")?.click());
    await wait(900);
    t.ck("confirming posts exactly one answer", answers.length === 1, JSON.stringify(answers));
    t.ck("and it says confirmed", answers[0]?.status === "confirmed",
      JSON.stringify(answers[0]));

    // THE COUNTER-PROPOSAL IS THE SAME FORM THE MANAGER USES, in a modal,
    // and it names the job -- a date form with no subject is a date form
    // somebody fills in for the wrong job.
    // AND CONFIRMING IS NOT A FORM. Wiring the first button to the modal
    // would pass every assertion above and quietly make agreeing a window
    // into re-proposing it, which is a different act with a different record.
    t.ck("confirming did not open a form instead",
      await page.evaluate(() => !document.querySelector(".modal .visit-form")));

    await page.evaluate(() => [...document.querySelectorAll(".jr-card")]
      .find((el) => /Sparking breaker/i.test(el.querySelector("h3")?.innerText || ""))
      ?.querySelectorAll(".jr-vis button")[1]?.click());
    await wait(700);
    const m2 = await page.evaluate(() => {
      const el = document.querySelector(".modal .visit-form");
      if (!el) return null;
      return { dates: el.querySelectorAll("input[type=date]").length,
        times: el.querySelectorAll("input[type=time]").length,
        job: (document.querySelector(".modal .pw-job")?.innerText || "").trim() };
    });
    t.ck("offering another time opens the propose form", !!m2 && m2.dates === 1 && m2.times === 2,
      JSON.stringify(m2));
    t.ck("and it names the job", /Sparking breaker/i.test(m2?.job || ""), m2?.job);
  }

  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
