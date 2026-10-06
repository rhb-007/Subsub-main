// THE PICTURES, ON THE WORK ORDER, AS DRAWN.
//
// The server half has its own suite (`test:inspectjob`). This is the half a
// static check passes over: the route can answer perfectly while the panel is
// mounted in the wrong place, keyed on the wrong id, or absent -- which is the
// shape this project has paid for repeatedly, most recently where the markup
// said `on` and no stylesheet had heard of the class.
//
//   IT IS IN THE WORK ORDER MODAL, with the flagged rooms, their notes and
//   the photographs.
//
//   THE CAPTION IS UNDER THE PICTURE, because the one thing a photograph
//   cannot say is which mark somebody meant.
//
//   AND IT RENDERS NOTHING ON AN ORDINARY JOB. The route answers 404 for a
//   job no inspection raised, which is most of them, so a heading over "no
//   photos" on every work order in the product would be noise that teaches
//   people to stop reading the modal. Asserted in the SAME place as the
//   positive case, because a panel that never draws passes every absence
//   check ever written.
//
//   node --no-warnings scripts/wo-inspection-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait, openCards } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-woinsp-test");
const WEB = 5331, API = 9029;
const t = tally();

const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active",
  user: { id: "u_juan", name: "Juan Soto", email: "juan@pacificam.test", role: "contractor" },
};
const SUB = {
  id: "cmp_pac", company: "Pacific apartment maintenance", engagementId: "en_pac",
  accountId: "acc_pm", contact: "Juan Soto", email: "juan@pacificam.test", phone: null,
  categories: ["plumbing"], caps: [], crews: [], propertyIds: [], zips: [],
  notify: {}, rating: null, bond: true, insurance: true, contract: true, w9: true,
  hasPortal: true, license: "", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {},
};
const assign = (wo) => ({ plumbing: {
  id: wo, wo, subId: "cmp_pac", status: "accepted", auto: false,
  responseWindow: null, respondBy: null, respondedAt: null, value: "400",
  payKind: "fixed", rate: "", capHours: null, tradeScope: null, crewName: null,
  signedWO: null, rating: null,
} });
const job = (id, title, wo) => ({
  id, accountId: "acc_pm", propertyId: null, title, status: "active",
  date: "2026-10-09", time: "09:00", address: "1620 Belmont Ave", area: "Seattle", zip: "98122",
  trades: ["plumbing"], assignments: assign(wo), notes: "", createdAt: "2026-10-01",
  photos: [], severity: null, client: null, sqft: null, stories: null, scope: "",
  // A JOB'S WHOLE SHAPE, because the work order document reads several of
  // these unconditionally: a partial fixture throws inside the modal, which
  // leaves no modal at all and reads exactly like a button that does nothing.
  // An hour went on that once already, on a missing `accountId`.
  measurementDocs: [], materialSource: null, materialsPaidBy: null,
  requestedBy: null, approvedAt: "2026-10-01", declinedAt: null, withdrawnAt: null,
  completedAt: null, access: null, accessEffective: null, accessUserId: null,
  reportDetail: null, propertyName: null, visit: null,
});
// Two jobs: one an inspection raised, one not. The second is what makes the
// absence assertion mean anything.
// The second job has NO address at all, which is the only fixture the
// null branch can be seen on: a Directions button that opens an empty map is
// worse than no button, and with an address on every row that guard never
// runs. `jobs.address` really is nullable -- an API-ingested job or one raised
// against a property that has none arrives exactly like this.
const JOBS = () => [job("job_insp", "Move-out work - unit 3B", "WO-1"),
  // Two more inspection-raised jobs, because the summary has three states and
  // two of them cannot be seen on one fixture: one whose notes have moved on
  // since the paragraph was written, and one that has no paragraph at all --
  // which is every job on a database without 063 and every one whose
  // automatic write failed.
  job("job_stale", "Move-out work - unit 4A", "WO-2"),
  job("job_nosum", "Move-out work - unit 9C", "WO-3"),
  { ...job("job_plain", "Repaint hallway", "WO-9"), address: "", area: "", zip: "" }];

// What the route answers for the raised job. Flagged rooms only, captions and
// no drafts -- the shape `contractorInspectionShape` builds, which the server
// suite pins on its own.
const PARA = "Repainting in the hallway and one cracked basin in the shower room.";
const INSP = {
  kind: "move_out", unit: "3B", inspectedOn: "2026-10-01",
  // THE ONE PARAGRAPH READ FIRST. `source` is deliberately absent, which is
  // what the server answers: it is the notes, which the same reader has in
  // full underneath, so carrying it would be the record sent twice.
  summary: { text: PARA, model: "claude-haiku-4-5", writtenAt: "2026-10-02T09:00:00.000Z", stale: false },
  rooms: [
    { id: "r_bath", name: "Shower and bath", status: "fail",
      note: "Cracked basin, chip to the enamel",
      photos: [{ id: "ph_bath", name: "basin.jpg", type: "image/jpeg",
        caption: "Hairline crack across the basin" }] },
    { id: "r_wall", name: "Walls and floors", status: "follow_up",
      note: "Scuff to the wall left of the door",
      photos: [{ id: "ph_wall", name: "wall.jpg", type: "image/jpeg", caption: "" }] },
  ],
};
// A one-pixel PNG, so the thumbnail really loads rather than failing and
// drawing the "Couldn't load" state -- which would pass a check that only
// counted figures.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea735ed130000000049454e44ae426082",
  "hex");

const web = serveApp({ dir: OUT, port: WEB });
// EVERY ASK FOR THE INSPECTION, counted. The paragraph is drawn in one place
// and the rooms in another, so the thing that could go wrong without anything
// looking wrong is two components asking for one record -- two requests, two
// chances to disagree, and the duplicate-state trap this project already
// refuses for the compliance pack panel. Only the wire can see it.
const asks = [];
const api = serveApi({ port: API, routes: (path) => {
  if (/^\/api\/work-orders\/[^/]+\/inspection$/.test(path)) asks.push(path);
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/account-users") return [200, [
    { id: "u_juan", name: "Juan Soto", email: "juan@pacificam.test", phone: null,
      role: "contractor", subId: "cmp_pac", propertyIds: [], unit: null,
      hasLogin: true, inviteSentAt: null, hasAvatar: false },
  ]];
  if (path === "/api/jobs") return [200, JOBS()];
  // Keyed by the WORK ORDER. WO-9's job was raised by nobody, so the route
  // answers 404 and the panel must draw nothing at all.
  if (path === "/api/work-orders/WO-1/inspection") return [200, INSP];
  if (path === "/api/work-orders/WO-2/inspection")
    return [200, { ...INSP, unit: "4A", summary: { ...INSP.summary, stale: true } }];
  if (path === "/api/work-orders/WO-3/inspection")
    return [200, { ...INSP, unit: "9C", summary: null }];
  if (path.startsWith("/api/work-orders/") && /\/inspection$/.test(path))
    return [404, { error: "not_found" }];
  if (/\/inspection\/photo\//.test(path))
    return [200, null, { raw: PNG, type: "image/png" }];
  // The milestone plan the work order modal also mounts. `WorkOrderProgress`
  // reads `plan.milestones.filter(...)` unguarded, so answering the stub's
  // default empty array throws inside the modal -- which leaves NO modal and
  // reads exactly like a button that does nothing. The suite spent a round on
  // that, which is the fixture lesson this project already records.
  if (/^\/api\/work-orders\/[^/]+\/plan$/.test(path))
    return [200, { valueCents: 40000, milestones: [], releases: [], retainageBps: 0 }];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/properties" || path === "/api/invites"
    || path === "/api/clients" || path === "/api/my-connect-requests"
    || path === "/api/connect-requests" || path === "/api/property-transfers"
    || path === "/api/visits" || path === "/api/my-quotes"
    || path === "/api/doc-shares" || path === "/api/inspections"
    || path === "/api/change-orders") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openWO = async (page, title) => {
  await openCards(page);
  await page.evaluate((tt) => [...document.querySelectorAll(".jr-card")]
    .find((el) => (el.querySelector("h3")?.innerText || "").toUpperCase()
      .includes(tt.toUpperCase()))
    ?.querySelector(".wo-open-btn")?.click(), title);
  await wait(1400);
};
// Closing between work orders. Two presses because the modal offers two ways
// out and which one is mounted has moved before; whichever lands, the next
// `openWO` needs a clear screen.
const closeModal = async (page) => {
  await page.evaluate(() => document.querySelector(".modal-close, .modal-x")?.click());
  await wait(400);
  await page.evaluate(() => { const b = document.querySelector(".modal-backdrop"); if (b) b.click(); });
  await wait(600);
};
const panel = (page) => page.evaluate(() => {
  const el = document.querySelector(".woi");
  if (!el) return null;
  // THE SUMMARY IS NO LONGER INSIDE THE ROOMS BLOCK. It leads the modal,
  // above the work order document, which is what *"summary should be at the
  // top of the page / pictures of the work order"* asked for -- so it is
  // looked for at modal level and its position is measured against the
  // DOCUMENT as well as against the rooms.
  const sum = document.querySelector(".modal .woi-lede");
  const doc = document.querySelector(".modal .wo-doc");
  const room = el.querySelector(".woi-room");
  const cs = sum ? getComputedStyle(sum) : null;
  return {
    head: (el.querySelector(".woi-head")?.innerText || "").replace(/\s+/g, " ").trim(),
    // There must be exactly one of it on screen: two copies of one paragraph
    // is how somebody concludes there are two of them, and the one further
    // down is the one that goes stale.
    sums: document.querySelectorAll(".modal .woi-sumt").length,
    sum: sum ? {
      text: (sum.querySelector(".woi-sumt")?.innerText || "").trim(),
      why: (sum.querySelector(".woi-sumwhy")?.innerText || "").replace(/\s+/g, " ").trim(),
      lede: (sum.querySelector(".woi-ledeh")?.innerText || "").replace(/\s+/g, " ").trim(),
      stale: sum.classList.contains("is-stale"),
      rule: cs.borderLeftColor,
      // SOURCE ORDER IS NOT SCREEN ORDER, and the whole claim is that this is
      // read first. Measured rather than inferred from the JSX.
      top: Math.round(sum.getBoundingClientRect().top),
      docTop: doc ? Math.round(doc.getBoundingClientRect().top) : null,
      roomTop: room ? Math.round(room.getBoundingClientRect().top) : null,
    } : null,
    rooms: [...el.querySelectorAll(".woi-room")].map((r) => ({
      name: (r.querySelector("b")?.innerText || "").trim(),
      status: (r.querySelector(".woi-st")?.innerText || "").trim(),
      note: (r.querySelector(".woi-note")?.innerText || "").trim(),
      shots: r.querySelectorAll(".woi-shot img").length,
      caps: [...r.querySelectorAll(".woi-shot figcaption")].map((f) => f.innerText.trim()),
    })),
  };
});

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_juan", accountId: "acc_pm" }, viewport: { width: 1340, height: 1600 } });
  const logs = [];
  // A refused fetch is not a throw. The stub answers 404 for the ordinary
  // job's inspection deliberately -- that IS the behaviour under test -- so a
  // network line is filtered and everything else is kept.
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const txt = m.text();
    if (/Failed to load resource/i.test(txt)) return;
    logs.push(txt.slice(0, 200));
  });
  page.on("pageerror", (e) => logs.push("THROW " + String(e).slice(0, 200)));
  await wait(2900);

  console.log("\n-- the work order says what the inspection found --");
  await openWO(page, "Move-out work");
  const p1 = await panel(page);
  // The positive assertion FIRST, because "there is no panel" passes loudest
  // on a modal that never opened.
  t.ck("the panel is in the work order modal", !!p1, String(p1));
  t.ck("headed with the walk and the unit",
    /Move-out/i.test(p1?.head || "") && /3B/.test(p1?.head || ""), p1?.head);
  t.ck("and when it was walked", /2026-10-01/.test(p1?.head || ""), p1?.head);
  const names = (p1?.rooms || []).map((r) => r.name);
  t.ck("both flagged rooms are drawn",
    names.join() === "Shower and bath,Walls and floors", JSON.stringify(names));
  const bath = (p1?.rooms || []).find((r) => r.name === "Shower and bath");
  t.ck("with what is wrong with it", /Cracked basin/.test(bath?.note || ""), bath?.note);
  // The whole point of the request: the picture, not the paragraph.
  t.ck("and the photograph itself", bath?.shots === 1, String(bath?.shots));
  t.ck("with the caption under it",
    (bath?.caps || []).join() === "Hairline crack across the basin", JSON.stringify(bath?.caps));
  // A photo nobody wrote about draws no empty caption line.
  const wall = (p1?.rooms || []).find((r) => r.name === "Walls and floors");
  t.ck("a photo with nothing written about it has no caption line",
    (wall?.caps || []).length === 0, JSON.stringify(wall?.caps));
  // The status is said in words, not left to the tint -- two states reading
  // the same pixels is the chip bug this project already paid for.
  t.ck("each room says which kind of problem it is",
    bath?.status && wall?.status && bath.status !== wall.status,
    `${bath?.status} vs ${wall?.status}`);

  // THE LIGHTBOX WALKS THE WHOLE UNIT, not one room: a set of photographs is
  // one piece of evidence read in order.
  // THE SECOND room's photograph, deliberately. Tapping the first one gives
  // index 0 whether the index is computed across the set or hard-coded, so
  // the assertion could not tell the two apart -- which a mutation duly
  // proved by surviving.
  await page.evaluate(() => [...document.querySelectorAll(".woi-shot .ph-thumb")][1]?.click());
  await wait(500);
  const box = await page.evaluate(() => {
    const el = document.querySelector(".ph-lightbox");
    return el ? (el.innerText || "").replace(/\s+/g, " ").trim() : null;
  });
  t.ck("tapping a picture opens it larger", box !== null, String(box));
  t.ck("and says where in the whole set it is, not in the room",
    /2 of 2/.test(box || ""), String(box));

  console.log("\n-- and the summary of all of it, read first --");
  {
    const sum = p1?.sum;
    t.ck("the panel carries the summary", !!sum, String(sum));
    t.ck("which is the paragraph the server wrote", sum?.text === PARA, sum?.text);
    // IT SAYS IT WAS PUT TOGETHER AUTOMATICALLY, which is not modesty: the
    // reader is about to price this, and a paragraph read as the hiring
    // account's own instruction is one they will quote back.
    t.ck("and says it was put together automatically",
      /automatically/i.test(sum?.why || ""), sum?.why);
    t.ck("and points at the rooms as the record", /record/i.test(sum?.why || ""), sum?.why);
    // ABOVE THE ROOMS, measured. A summary printed under the list it
    // summarises has saved nobody any reading.
    t.ck("it sits above the room-by-room list",
      sum && sum.roomTop !== null && sum.top < sum.roomTop, `${sum?.top} vs ${sum?.roomTop}`);
    // AND ABOVE THE DOCUMENT ITSELF, which is the half that changed. Somebody
    // opening a work order is about to put a price on it, and what the work
    // IS belongs before the paperwork -- *"summary should be at the top of
    // the page"*. Only the drawn rectangle can see this: the JSX moving is
    // not the same as the paragraph landing above anything.
    t.ck("and above the work order document, at the top of the page",
      sum && sum.docTop !== null && sum.top < sum.docTop, `${sum?.top} vs ${sum?.docTop}`);
    // ONE COPY. It used to sit inside the rooms block; moving it without
    // removing it there would print the same paragraph twice on one screen.
    t.ck("and there is exactly one of it on screen", p1?.sums === 1, String(p1?.sums));
    // AND IT WAS ASKED FOR ONCE. Two mounts of one component would be two
    // fetches of one thing; the owner of the data is the modal and both
    // pieces read it.
    t.ck("the inspection was fetched once for the modal, not once per piece",
      asks.filter((a) => a.includes("WO-1")).length === 1, JSON.stringify(asks));
    // A bare paragraph as the first thing in a modal reads as a note somebody
    // left rather than as what the work is, so it carries its own title.
    t.ck("it says what it is", /inspection found/i.test(sum?.lede || ""), sum?.lede);
    t.ck("and a current one is not marked stale", sum?.stale === false, String(sum?.stale));
  }

  console.log("\n-- and the address has directions on it --");
  {
    const dir = await page.evaluate(() => {
      const a = document.querySelector(".modal .wd-dir");
      return a ? { href: a.getAttribute("href"), target: a.getAttribute("target"),
        rel: a.getAttribute("rel"), text: a.innerText.trim() } : null;
    });
    t.ck("the work order offers directions", !!dir, String(dir));
    // The documented universal form: no key, opens the Maps app where there
    // is one, and the ORIGIN IS OMITTED -- which is what makes it "from where
    // you are" rather than from an office somebody guessed at.
    t.ck("to Google's universal directions URL",
      /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/.test(dir?.href || ""),
      dir?.href);
    t.ck("carrying the job's own address",
      /1620%20Belmont%20Ave/.test(dir?.href || ""), dir?.href);
    t.ck("and naming no origin", !/[?&]origin=/.test(dir?.href || ""), dir?.href);
    // A new tab, because this leaves the app -- and `noopener` because the
    // page it opens must not get a handle on ours.
    t.ck("it opens away from the work order",
      dir?.target === "_blank" && /noopener/.test(dir?.rel || ""), JSON.stringify(dir));
  }

  console.log("\n-- a summary the notes have moved past says so --");
  {
    await closeModal(page);
    await openWO(page, "unit 4A");
    const ps = await panel(page);
    t.ck("the panel is there", !!ps?.sum, String(ps?.sum));
    // A STALE PARAGRAPH IS SHOWN RATHER THAN HIDDEN, because the rooms below
    // it are always live: what has to change is that it says it is behind.
    t.ck("the paragraph is still drawn", ps?.sum?.text === PARA, ps?.sum?.text);
    t.ck("and says the notes have changed since",
      /have changed/i.test(ps?.sum?.why || ""), ps?.sum?.why);
    t.ck("and points at the rooms as the current ones",
      /current/i.test(ps?.sum?.why || ""), ps?.sum?.why);
    // TWO STATES READING THE SAME PIXELS is the chip bug this project already
    // paid for -- correct markup, nothing on screen. So the computed rule is
    // read rather than the class alone.
    t.ck("and is drawn differently from a current one",
      !!ps?.sum?.rule && !!p1?.sum?.rule && ps.sum.rule !== p1.sum.rule,
      `${ps?.sum?.rule} vs ${p1?.sum?.rule}`);
  }

  console.log("\n-- and one with no summary draws no empty box --");
  {
    await closeModal(page);
    await openWO(page, "unit 9C");
    const pn = await panel(page);
    // THE POSITIVE HALF FIRST: an absence assertion passes loudest on a panel
    // that never rendered at all.
    t.ck("the rooms and photos still come through",
      (pn?.rooms || []).length === 2, String((pn?.rooms || []).length));
    // A blank box over the list would read as "nothing much wrong", which is
    // the one thing a summary must never say by accident.
    t.ck("and there is no summary block", pn?.sum === null, JSON.stringify(pn?.sum));
  }

  console.log("\n-- and an ordinary job gets no panel at all --");
  await closeModal(page);
  await openWO(page, "Repaint hallway");
  const p2 = await panel(page);
  // Asserted in the SAME place as the positive case. A fix that drew nothing
  // anywhere would pass this on its own.
  t.ck("the modal opened", await page.evaluate(() => !!document.querySelector(".wo-doc, .modal")));
  t.ck("and there is no inspection panel on it", p2 === null, JSON.stringify(p2));
  // AND NO DIRECTIONS EITHER, because there is nowhere to go. Asserted in the
  // same place as the positive case: a link rendered unconditionally passes
  // every assertion above and opens an empty map here.
  t.ck("nor a directions link with no address to go to",
    await page.evaluate(() => !document.querySelector(".modal .wd-dir")));

  // READ OFF THE PAGE'S OWN CONSOLE, not off the harness. A real TypeError in
  // the modal's subtree left `crashes` empty while the modal never rendered,
  // so that assertion passed loudest exactly when the subject had disappeared
  // -- which is the inverse-of-read-through-`link?.` shape this project keeps
  // catching. Both are checked now.
  t.ck("nothing threw on the page", logs.length === 0, logs.join(" | "));
  t.ck("and the harness saw no crash", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
