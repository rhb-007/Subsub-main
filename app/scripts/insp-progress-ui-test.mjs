// THE INSPECTION ROW SAYS WHERE THE JOB GOT TO, drawn.
//
// Reported with the flagged rows circled: *"details or status of the
// inspection of ones that were flagged for follow up should have the status
// updated from job raised to what's happening currently — job scheduled for
// specific date"*.
//
// The server half is pinned in `insp-progress-test.mjs`. What only a browser
// can see is the half that was actually wrong: the WORDS on the row, the
// colour behind them, and whether the date somebody asked for is on it. A
// static check that the component reads `i.job` passes with the value never
// rendered, and the old chip's own class set no background at all -- it drew
// as loose text, which is the chip bug this project has already paid for once
// in the inspection trade grid.
//
//   node --no-warnings scripts/insp-progress-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-insp-progress-test");
const WEB = 5343, API = 9041;
const t = tally();

const acct = {
  id: "acc_x", name: "Sound Property Management", subdomain: "soundpm", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Christopher Lane", email: "chris@x.test", role: "admin" },
};

// Dates that move with the clock, so the fixture never goes stale -- and
// deliberately not today or tomorrow, which `rowDay` answers in words rather
// than with a date, and the date is the whole of what was asked for.
const key = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const SOON = key(5);

// ONE ROW PER STATE. Every one of these read "Job raised" before, which is
// the whole report -- so a suite driving one of them cannot tell the fix from
// the bug it replaced.
const ROWS = [
  { id: "i_none", unit: "12", job: { id: "unassigned", tone: "wait", label: "Needs a contractor" } },
  { id: "i_off", unit: "13", job: { id: "offered", tone: "wait", label: "Waiting on a contractor" } },
  { id: "i_sch", unit: "14", job: { id: "scheduled", tone: "ok", label: "Scheduled", date: SOON } },
  { id: "i_prop", unit: "15", job: { id: "proposed", tone: "wait", label: "Time proposed", date: SOON } },
  { id: "i_can", unit: "16", job: { id: "cancelled", tone: "plain", label: "Cancelled" } },
  // AND ONE THE SERVER COULD NOT ANSWER FOR, which is a database behind the
  // code: the row still has to say a job was raised rather than drawing
  // nothing, or the screen loses a fact it already held.
  { id: "i_old", unit: "17", job: null },
  // AND ONE WITH NO JOB AT ALL, so "every row gets a chip" is not what is
  // being asserted.
  { id: "i_raw", unit: "18", job: null, noJob: true },
];

const LIST = () => ROWS.map((r) => ({
  id: r.id, propertyId: "prop_1", unit: r.unit, kind: "move_out",
  tenantName: "Tess Nguyen", inspectedOn: key(-2), status: "finished",
  jobId: r.noJob ? null : `job_${r.id}`, job: r.job || undefined,
  createdAt: "2026-10-02 00:00:00", rooms: 2, flagged: 2, unchecked: 0,
}));

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (path === "/api/account" && method === "GET") return [200, acct];
  if (path === "/api/account-users" && method === "GET") {
    return [200, [{ id: "usr_r", name: "Christopher Lane", email: "chris@x.test", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false }]];
  }
  if (path === "/api/properties" && method === "GET") {
    return [200, [{ id: "prop_1", accountId: "acc_x", name: "North Highland LLC",
      address: "1620 Belmont Ave", city: "Seattle", state: "WA", zip: "98122",
      units: 12, notes: "", vendorIds: [], ownerIds: [], tenantIds: [],
      ownerAccountId: "acc_x", ownedNotOperated: false, readOnly: false }]];
  }
  if (path === "/api/inspections" && method === "GET") return [200, LIST()];
  if (path.startsWith("/api/inspections/") && method === "GET") {
    const id = path.split("/")[3];
    const row = ROWS.find((r) => r.id === id) || ROWS[0];
    return [200, { id, propertyId: "prop_1", unit: row.unit, kind: "move_out",
      tenantName: "Tess Nguyen", inspectedOn: key(-2), status: "finished",
      finishedAt: "2026-10-02 00:00:00", jobId: row.noJob ? null : `job_${id}`,
      job: row.job || undefined, createdAt: "2026-10-02 00:00:00", aiDrafts: false,
      recipients: [], sends: [],
      rooms: [{ id: "r1", name: "Walls and floors", status: "fail", note: "Scuffed",
        position: 0, photos: [] }] }];
  }
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

// Every inspection row, as the browser drew it: the words on its chips, the
// computed colour behind each one, and where its right edge lands.
const rows = (page) => page.evaluate(() => [...document.querySelectorAll(".insp-row")].map((el) => ({
  title: (el.querySelector(".dr-title")?.innerText || "").replace(/\s+/g, " ").trim(),
  chips: [...el.querySelectorAll(".tn-chip")].map((c) => ({
    text: c.innerText.replace(/\s+/g, " ").trim(),
    bg: getComputedStyle(c).backgroundColor,
    cls: [...c.classList].filter((k) => k !== "tn-chip").join(" "),
  })),
  right: Math.round(el.getBoundingClientRect().right),
  titleRight: Math.round(el.querySelector(".dr-title")?.getBoundingClientRect().right || 0),
})));

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1340, height: 1600 } });
  // THE PAGE'S OWN CONSOLE, not only the harness's crash list. A throw inside
  // a child leaves the harness's list empty while the screen is blank, so
  // "nothing crashed" passes loudest at the moment the subject disappeared --
  // which this project has already paid for twice.
  const logs = [];
  page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  await wait(2600);
  // Inspections is its own nav entry on an account with buildings.
  await page.evaluate(() => [...document.querySelectorAll("button,a")]
    .find((b) => /^Inspections/i.test(b.innerText || ""))?.click());
  await wait(800);

  const all = await rows(page);
  t.ck("the inspections list drew", all.length === 7, String(all.length));
  const by = {};
  for (const r of all) by[(r.title.match(/unit (\d+)/i) || [])[1]] = r;
  const chip = (unit) => (by[unit]?.chips || []).map((c) => c.text).join(" | ");

  // THE REPORTED ASK, drawn. "Scheduled" AND the date, because the request
  // was for the date and a stem on its own answers nothing about when.
  t.ck("a booked job says scheduled on the row",
    /Scheduled/.test(chip("14")), chip("14"));
  t.ck("and carries the date it is booked for",
    /\b\d{1,2}\b/.test((by["14"]?.chips || []).find((c) => /Scheduled/.test(c.text))?.text || ""),
    chip("14"));

  // EVERY OTHER STATE IS ITS OWN SENTENCE. All five of these read "Job
  // raised" before, so a change that drew one new word everywhere passes a
  // check written against the scheduled row alone.
  t.ck("a job with nobody on it says so", /Needs a contractor/.test(chip("12")), chip("12"));
  t.ck("an unanswered one says it is waiting", /Waiting on a contractor/.test(chip("13")), chip("13"));
  t.ck("a proposed window says proposed", /Time proposed/.test(chip("15")), chip("15"));
  t.ck("and a cancelled job says cancelled", /Cancelled/.test(chip("16")), chip("16"));
  t.ck("none of them still says \"Job raised\"",
    !["12", "13", "14", "15", "16"].some((u) => /Job raised/.test(chip(u))),
    ["12", "13", "14", "15", "16"].map(chip).join(" // "));

  // THE OLD WORDS SURVIVE WHERE THE SERVER COULD NOT ANSWER. A database
  // behind the code must cost the progress line and never the fact that a job
  // exists, which is the degradation the route is written for.
  t.ck("a row the server could not answer for still says a job was raised",
    /Job raised/.test(chip("17")), chip("17"));
  t.ck("and an inspection with no job gets no job chip at all",
    !/Job raised|Scheduled|contractor/.test(chip("18")), chip("18"));

  // THE COLOUR IS PART OF THE ANSWER, and it is the half no static check can
  // see: the chip class the old one wore sets no background, so it drew as
  // loose text rather than as a chip. Read as computed pixels, because a
  // class that nothing downstream styles reads exactly right in the source --
  // the trade-grid bug this project has already paid for.
  const bgOf = (unit, re) => (by[unit]?.chips || []).find((c) => re.test(c.text))?.bg || "";
  const booked = bgOf("14", /Scheduled/);
  const waiting = bgOf("13", /Waiting/);
  const gone = bgOf("16", /Cancelled/);
  t.ck("every progress chip has a background of its own",
    [booked, waiting, gone].every((b) => b && !/rgba\(0, 0, 0, 0\)/.test(b)),
    JSON.stringify([booked, waiting, gone]));
  // AND THE THREE TONES ARE THREE COLOURS. Two states reading the same pixels
  // is the whole of what was wrong, in a new form.
  t.ck("and booked, waiting and finished-with are three different ones",
    new Set([booked, waiting, gone]).size === 3,
    JSON.stringify([booked, waiting, gone]));
  t.ck("the old row's plain chip is the one that was styleless",
    /plain/.test((by["17"]?.chips || []).find((c) => /Job raised/.test(c.text))?.cls || ""),
    JSON.stringify(by["17"]?.chips));

  // AND IT MUST NOT BE PAID FOR OUT OF THE TITLE. The chip is wider than the
  // two words it replaced, and a nowrap chip in a fixed row squeezes the one
  // thing somebody is scanning for.
  await page.setViewport({ width: 390, height: 1800 });
  await wait(500);
  const narrow = await rows(page);
  t.ck("no row runs off the screen at 390px",
    narrow.every((r) => r.right <= 391), JSON.stringify(narrow.map((r) => r.right)));
  // The title keeps a real share of the row rather than being ellipsed to
  // nothing, which is what a chip row that refuses to wrap costs.
  const schRow = narrow.find((r) => /unit 14/i.test(r.title));
  t.ck("and the title still has room on the booked row",
    !!schRow && schRow.titleRight > 200, JSON.stringify(schRow));
  t.ck("with its chip still on screen",
    /Scheduled/.test((schRow?.chips || []).map((c) => c.text).join(" ")),
    JSON.stringify(schRow?.chips));

  // THE FILTER BAR ON TOP OF THE LIST. "Flagged, no job raised" is the one
  // question this list is opened to answer, so it is asserted on the one row
  // that should match and the six that should not.
  const sels = await page.evaluate(() => [...document.querySelectorAll(".fbar select")].map((x) => x.getAttribute("aria-label")));
  t.ck("the inspections list has the filter bar", sels.includes("Inspections") && sels.includes("Kinds"), JSON.stringify(sels));
  t.ck("with no property filter over one building", !sels.includes("Properties"), JSON.stringify(sels));
  await page.evaluate(() => {
    const sel = [...document.querySelectorAll(".fbar select")].find((x) => x.getAttribute("aria-label") === "Inspections");
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    set.call(sel, "nojob"); sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await wait(300);
  const nojob = await rows(page);
  t.ck("Flagged, no job raised lists exactly that one",
    nojob.length === 1 && /unit 18/i.test(nojob[0]?.title || ""), JSON.stringify(nojob.map((r) => r.title)));
  await page.evaluate(() => {
    document.querySelector(".fbar-clear")?.click();
  });
  await wait(300);
  await page.evaluate(() => {
    const i = document.querySelector(".fbar input");
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(i, "16"); i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait(300);
  const found = await rows(page);
  t.ck("and the search finds a unit", found.length === 1 && /unit 16/i.test(found[0]?.title || ""),
    JSON.stringify(found.map((r) => r.title)));
  await page.evaluate(() => document.querySelector(".fbar-clear")?.click());
  await wait(300);
  t.ck("Clear brings every inspection back", (await rows(page)).length === 7);

  // THE DETAIL SCREEN SAYS THE SAME THING, beside the button into the job.
  // One rule, two screens: a second derivation is how the list and the thing
  // it opens come to disagree about one job.
  await page.setViewport({ width: 1340, height: 1600 });
  await wait(400);
  await page.evaluate(() => [...document.querySelectorAll(".insp-row")]
    .find((el) => /unit 14/i.test(el.innerText || ""))?.click());
  await wait(800);
  const detail = await page.evaluate(() => {
    const el = document.querySelector(".insp-detail") || document.querySelector(".modal");
    if (!el) return { missing: true };
    return {
      chips: [...el.querySelectorAll(".tn-chip")].map((c) => c.innerText.replace(/\s+/g, " ").trim()),
      opens: [...el.querySelectorAll("button")].map((b) => b.innerText.trim())
        .filter((x) => /Open the job/i.test(x)),
    };
  });
  t.ck("the inspection opened", detail.missing !== true, JSON.stringify(detail));
  t.ck("and says where its job got to, beside the way into it",
    (detail.chips || []).some((x) => /Scheduled/.test(x)) && (detail.opens || []).length === 1,
    JSON.stringify(detail));

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
