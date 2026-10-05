// DASHBOARD ROWS OPEN THEIR JOB BEFORE ANYBODY PRESSES ASSIGN.
//
// Reported with sixteen "Needs a contractor" rows circled: each was a title,
// a trade and a ZIP code beside a solid Assign, so the only way to find out
// what the work was meant committing somebody to it. The row now opens
// `JobPeek`; the row's own button still does what it did.
//
// What this pins, each against something only a drawn screen can show:
//   - pressing the row opens the details and does NOT open the assign form;
//   - the details carry THAT trade's scope, and the inspection rooms that trade
//     was suggested from -- the plumbing row shows the bathroom and not the
//     living room, which is the only fixture either reading can be told apart
//     on;
//   - the modal's Assign opens the assign form for that same trade;
//   - the row's own Assign still opens it straight away, untaxed;
//   - "Open the inspection" lands on that inspection, not on the list.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-dash-peek-test");
const WEB = 5357, API = 9053;
const t = tally();

const PM = {
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", role: "admin" },
};
const SUB = {
  id: "cmp_pac", company: "Pacific apartment maintenance", engagementId: "en_pac",
  accountId: "acc_pm", contact: "Juan Soto", email: "juan@pacific.test", phone: null,
  categories: ["plumbing", "painting"], caps: [], crews: [], propertyIds: [], zips: [],
  notify: {}, rating: 0, ratedJobs: 0, bond: true, insurance: true, contract: true, w9: true,
  hasPortal: true, license: "", licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {}, engagedAs: "subcontractor",
};
const USERS = [{ id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
  inviteSentAt: null, hasAvatar: false }];
const JOB = {
  id: "job_14", accountId: "acc_pm", propertyId: "prop_1", title: "Move-out work — unit 14",
  status: "active", date: null, time: null, address: "1620 Belmont Ave", area: "Seattle", zip: "98122",
  trades: ["plumbing", "painting"], assignments: {}, notes: "Keys in the lockbox", createdAt: "2026-10-05",
  photos: [], severity: null, client: null, sqft: null, stories: null,
  scope: "From the move-out inspection of unit 14: the whole walk",
  measurementDocs: [], materialSource: null, materialsPaidBy: null,
  requestedBy: null, approvedAt: "2026-10-05", declinedAt: null, withdrawnAt: null,
  completedAt: null, access: null, accessEffective: "manager", accessUserId: null,
  reportDetail: null, propertyName: "Press Apartments", visit: null,
};
const ROOMS = [
  { id: "r1", name: "Bathroom", status: "fail", note: "Toilet leaks at the base", position: 0, photos: [] },
  { id: "r2", name: "Living room", status: "follow_up", note: "Scuffed wall needs repainting", position: 1, photos: [] },
  { id: "r3", name: "Kitchen", status: "ok", note: "", position: 2, photos: [] },
];
const INSP = { id: "insp_14", propertyId: "prop_1", unit: "14", kind: "move_out",
  tenantName: "", inspectedOn: "2026-10-05", status: "finished", finishedAt: "2026-10-05 10:00:00",
  jobId: "job_14", createdAt: "2026-10-05 09:00:00" };

const asks = [];
const writes = [];
let reopened = false;
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, PM];
  if (path === "/api/account") return [200, PM];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/jobs") return [200, [JOB]];
  if (path === "/api/properties") return [200, [{ id: "prop_1", accountId: "acc_pm", name: "Press Apartments",
    address: "1620 Belmont Ave", city: "Seattle", state: "WA", zip: "98122", units: 20, notes: "",
    vendorIds: [], ownerIds: [], tenantIds: [], ownerAccountId: "acc_pm", ownedNotOperated: false, readOnly: false }]];
  if (path === "/api/inspections" && method === "GET") {
    return [200, [{ ...INSP, rooms: 3, flagged: 2, unchecked: 0 }]];
  }
  if (path === "/api/inspections/insp_14" && method === "GET") {
    asks.push(path);
    return [200, { ...INSP, ...(reopened ? { status: "draft", finishedAt: null } : {}),
      rooms: ROOMS, aiDrafts: false, recipients: [], sends: [],
      reopens: reopened ? [{ at: "2026-10-05 16:00:00", by: "Christopher Lane",
        reason: "Missed the balcony", finishedAt: "2026-10-05 10:00:00" }] : [] }];
  }
  if (path === "/api/inspections/insp_14/reopen" && method === "POST") {
    writes.push({ path, body });
    reopened = true;
    return [200, { ...INSP, status: "draft", finishedAt: null, rooms: ROOMS, reopens: [] }];
  }
  if (path === "/api/jobs/job_14" && method === "PATCH") {
    writes.push({ path, body });
    return [200, { ok: true, rescheduled: null }];
  }
  if (path === "/api/jobs/job_14/trade-scope") {
    return [200, { scopes: {
      plumbing: "From the move-out inspection of unit 14:\n• Bathroom — Fail: Toilet leaks at the base",
      painting: "From the move-out inspection of unit 14:\n• Living room — Follow-up: Scuffed wall needs repainting",
    } }];
  }
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openRows = (page) => page.evaluate(() => {
  const sec = [...document.querySelectorAll(".dash-sec")]
    .find((s) => /Needs a contractor/i.test(s.querySelector("h3")?.innerText || ""));
  return sec ? [...sec.querySelectorAll(".dash-row")].map((r) => r.innerText.replace(/\s+/g, " ").trim()) : null;
});
const state = (page) => page.evaluate(() => {
  const jp = document.querySelector(".jp");
  const modals = [...document.querySelectorAll(".modal")];
  const picker = modals.find((m) => !m.querySelector(".jp") && /Pacific apartment maintenance/.test(m.innerText));
  return {
    peek: !!jp,
    eyebrow: jp?.querySelector(".jp-eyebrow")?.innerText || "",
    said: jp ? [...jp.querySelectorAll(".tn-said")].map((s) => s.innerText.replace(/\s+/g, " ").trim()) : [],
    rooms: jp ? [...jp.querySelectorAll(".jp-rooms li")].map((li) => li.innerText) : [],
    trades: jp ? [...jp.querySelectorAll(".jp-trades li")].map((li) => li.innerText.replace(/\s+/g, " ")) : [],
    buttons: jp ? [...jp.querySelectorAll(".form-actions button")].map((b) => b.innerText.trim()) : [],
    picker: !!picker,
    detail: !!document.querySelector(".insp-detail"),
  };
});
const clickRow = (page, trade) => page.evaluate((trade) => {
  const sec = [...document.querySelectorAll(".dash-sec")]
    .find((s) => /Needs a contractor/i.test(s.querySelector("h3")?.innerText || ""));
  const row = [...(sec?.querySelectorAll(".dash-row") || [])].find((r) => r.innerText.includes(trade));
  row?.querySelector(".dash-row-open")?.click();
  return !!row;
}, trade);
const press = (page, label) => page.evaluate((label) => {
  const b = [...document.querySelectorAll(".jp .form-actions button")].find((x) => x.innerText.includes(label));
  b?.click(); return !!b;
}, label);
const closeAll = (page) => page.evaluate(() => {
  for (const b of document.querySelectorAll(".modal-close")) b.click();
});

try {
  const { page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1180, height: 1500 } });
  const logs = [];
  page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  await wait(2600);

  const rows = await openRows(page);
  t.ck("the dashboard lists both open slots", rows?.length === 2, JSON.stringify(rows));

  console.log("\n-- pressing the row opens the job, not the assign form --");
  t.ck("the plumbing row is there", await clickRow(page, "Plumbing"));
  await wait(700);
  let s = await state(page);
  t.ck("the details open", s.peek, JSON.stringify(s));
  t.ck("and nothing has been assigned yet -- no assign form", !s.picker, JSON.stringify(s));
  t.ck("it says which trade it is about", /Plumbing/i.test(s.eyebrow), s.eyebrow);
  t.ck("it carries that trade's own scope, not the whole walk",
    s.said.some((x) => /Toilet leaks at the base/.test(x)) && !s.said.some((x) => /the whole walk/.test(x)),
    JSON.stringify(s.said));
  t.ck("it reads the inspection behind the job", asks.length >= 1, String(asks.length));
  t.ck("and shows the rooms the plumbing came from",
    s.rooms.length === 1 && /Bathroom/.test(s.rooms[0]), JSON.stringify(s.rooms));
  t.ck("not the rooms another trade came from",
    !s.rooms.some((r) => /Living room/.test(r)), JSON.stringify(s.rooms));
  t.ck("it lists every trade on the job", s.trades.length === 2, JSON.stringify(s.trades));
  t.ck("and the notes", s.said.some((x) => /Keys in the lockbox/.test(x)), JSON.stringify(s.said));
  t.ck("it offers Assign, Open in Jobs and the inspection",
    ["Assign", "Open in Jobs", "Open the inspection"].every((l) => s.buttons.some((b) => b.includes(l))),
    JSON.stringify(s.buttons));

  console.log("\n-- the modal's Assign is the row's Assign --");
  t.ck("Assign is pressable", await press(page, "Assign"));
  await wait(700);
  s = await state(page);
  t.ck("the details close", !s.peek, JSON.stringify(s));
  t.ck("and the assign form opens", s.picker, JSON.stringify(s));
  await closeAll(page); await wait(400);

  console.log("\n-- the row's own button is not taxed --");
  const direct = await page.evaluate(() => {
    const sec = [...document.querySelectorAll(".dash-sec")]
      .find((x) => /Needs a contractor/i.test(x.querySelector("h3")?.innerText || ""));
    const row = [...(sec?.querySelectorAll(".dash-row") || [])].find((r) => r.innerText.includes("Painting"));
    row?.querySelector(".dash-row-btn")?.click(); return !!row;
  });
  await wait(700);
  s = await state(page);
  t.ck("the row's Assign opens the form straight away", direct && s.picker && !s.peek, JSON.stringify(s));
  await closeAll(page); await wait(400);

  console.log("\n-- and the inspection is one press away --");
  await clickRow(page, "Painting"); await wait(700);
  s = await state(page);
  t.ck("the painting row shows the living room instead",
    s.rooms.length === 1 && /Living room/.test(s.rooms[0]), JSON.stringify(s.rooms));
  t.ck("Open the inspection is pressable", await press(page, "Open the inspection"));
  await wait(1200);
  s = await state(page);
  t.ck("it lands on that inspection, opened", s.detail, JSON.stringify(s));

  console.log("\n-- a finished inspection can be reopened, on the record --");
  const reopenBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".insp-reopen button")].find((x) => /Reopen to edit/.test(x.innerText));
    b?.click(); return !!b;
  });
  t.ck("a finished inspection offers Reopen to edit", reopenBtn);
  await wait(400);
  const form = await page.evaluate(() => {
    const box = document.querySelector(".insp-reopen.open");
    const go = [...(box?.querySelectorAll("button") || [])].find((x) => /Reopen it/.test(x.innerText));
    return { open: !!box, says: box?.innerText || "", disabled: go ? go.disabled : null };
  });
  t.ck("it says what reopening does before the press",
    form.open && /owner/i.test(form.says) && /why/i.test(form.says), form.says.slice(0, 200));
  t.ck("and will not go without a reason", form.disabled === true, JSON.stringify(form));
  await page.evaluate(() => {
    const ta = document.querySelector(".insp-reopen.open textarea");
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    set.call(ta, "Missed the balcony");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait(200);
  await page.evaluate(() => [...document.querySelectorAll(".insp-reopen.open button")]
    .find((x) => /Reopen it/.test(x.innerText))?.click());
  await wait(900);
  const sentReopen = writes.find((w) => w.path.endsWith("/reopen"));
  t.ck("the reason goes to the server", sentReopen?.body?.reason === "Missed the balcony", JSON.stringify(sentReopen));
  const after = await page.evaluate(() => ({
    chip: [...document.querySelectorAll(".insp-detail .tn-chip")].map((c) => c.innerText)[0] || "",
    record: [...document.querySelectorAll(".insp-reopens li")].map((li) => li.innerText),
  }));
  t.ck("it reads as a draft again", /Draft/.test(after.chip), JSON.stringify(after));
  t.ck("and the reopen is listed, with who and why",
    after.record.length === 1 && /Christopher Lane/.test(after.record[0]) && /Missed the balcony/.test(after.record[0]),
    JSON.stringify(after.record));

  console.log("\n-- an unbooked trade comes off from its own row --");
  await page.evaluate(() => [...document.querySelectorAll("button,a")]
    .find((b) => /^Jobs/i.test((b.innerText || "").trim()))?.click());
  await wait(900);
  const drops = await page.evaluate(() => [...document.querySelectorAll(".trade-drop")].length);
  t.ck("each unbooked trade row offers Remove", drops === 2, String(drops));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".trade-drop")]
      .find((b) => /Painting/.test(b.closest("[class*=trade]")?.parentElement?.innerText || ""))
      || document.querySelectorAll(".trade-drop")[1];
    row?.click();
  });
  await wait(500);
  const ask = await page.evaluate(() => document.querySelector(".modal")?.innerText || "");
  t.ck("it asks first, naming the trade and how to undo it",
    /Remove/.test(ask) && /add it back/i.test(ask), ask.slice(0, 200));
  t.ck("and nothing has been sent yet", !writes.some((w) => w.path === "/api/jobs/job_14"));
  await page.evaluate(() => [...document.querySelectorAll(".modal .btn-danger")][0]?.click());
  await wait(800);
  const patchW = writes.find((w) => w.path === "/api/jobs/job_14");
  t.ck("agreeing sends the job's trades without that one",
    JSON.stringify(patchW?.body?.trades) === JSON.stringify(["plumbing"]), JSON.stringify(patchW));
  t.ck("and the row is gone from the card",
    (await page.evaluate(() => [...document.querySelectorAll(".trade-drop")].length)) === 0,
    "a job's last trade offers no Remove");

  t.ck("and nothing crashed", logs.filter((l) => !/favicon|404/.test(l)).length === 0, logs.join(" | "));
} catch (err) {
  t.ck("threw", false, err?.stack || String(err));
} finally {
  await browser.close().catch(() => {});
  web.close(); api.close();
}
t.done();
