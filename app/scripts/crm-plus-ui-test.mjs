// 113. THE REST OF THE CRM, DRAWN, against a stubbed API: ticking leads and
// changing them at once, importing a list, finding duplicates, a proposal
// written and emailed, the insurance claim, files, tags, the lead routing
// setting, commission on Reports, a text reminder on an estimate, and the
// homeowner's page where a proposal is signed.
//
//   node --no-warnings scripts/crm-plus-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-crmplusui-test");
const WEB = 5641, API = 9341;
const t = tally();

const pad = (n) => String(n).padStart(2, "0");
const key = (off) => { const d = new Date(); d.setDate(d.getDate() + off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const GC = {
  id: "acc_gc", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor", plan: "scale",
  billing: "monthly", useDefaultMark: true, theme: null, trades: [], logoKey: null,
  subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_admin", name: "Richard Braun", email: "rb@outerhome.test", role: "admin" },
};
const SEAT = { userId: "u_admin", accountId: "acc_gc", role: "admin" };
const REPS = [{ id: "u_admin", name: "Richard Braun", role: "admin" }, { id: "u_sm", name: "Sam Seller", role: "sales" }];
const PTOKEN = "a".repeat(32);

const appt = (id, extra = {}) => ({ id, status: "scheduled", direction: "inbound", source: "Google", services: ["roofing"],
  details: { roofing: { material: "Asphalt shingle", age: "Over 20 years", leaks: "Yes", stories: "2" } },
  home: { owns: "Yes", timeline: "Within 3 months" },
  homeowner: { firstName: "Dana", lastName: "Ruiz", phone: "2535550142", email: "dana@home.test" },
  address: { street: "1204 N Pine St", city: "Tacoma", state: "WA", zip: "98406" }, second: null,
  date: key(3), time: "10:00", minutes: 90, repId: "u_sm", repName: "Sam Seller", notes: null, outcomeNote: null, jobId: null,
  createdAt: `${key(-5)} 09:00:00`, updatedAt: `${key(-5)} 09:00:00`, statusAt: `${key(-5)} 09:00:00`,
  consent: { email: true, phone: true, text: true, record: null }, deal: null, ...extra });
const APPTS = [appt("ap_open")];
const lead = (id, extra = {}) => ({ id, stage: "opportunity", firstName: "Dana", lastName: "Ruiz", phone: "2535550142", email: "dana@home.test",
  address: { street: "1204 N Pine St", city: "Tacoma", state: "WA", zip: "98406" }, services: ["roofing"], source: "website",
  notes: null, ownerId: "u_sm", ownerName: "Sam Seller", createdBy: "u_admin", createdByName: "Richard Braun",
  createdAt: `${key(-6)} 09:00:00`, updatedAt: `${key(0)} 09:00:00`, stageAt: `${key(0)} 09:00:00`,
  appointments: [{ id: "ap_open", status: "scheduled", date: key(3), time: "10:00" }],
  consent: { email: true, phone: true, text: true, record: null, capturedAt: "2026-11-01T00:00:00Z" },
  optOut: null, enrollment: null, tags: [], custom: {}, ...extra });
const LEADS = [lead("ld_dana", { tags: ["Storm"] }), lead("ld_dup", { firstName: "Danielle", stage: "lead", appointments: [], email: "" }),
  lead("ld_ben", { firstName: "Ben", lastName: "Ode", phone: "2065550101", email: "ben@x.test", appointments: [], stage: "lead" })];
const posts = { bulk: [], import: [], proposal: [], send: [], claim: [], settings: [], meta: [], sign: [], jobs: [] };
let PROPS = [];
let PUB = { account: { name: "Outerhome" }, homeowner: "Dana Ruiz", address: "1204 N Pine St, Tacoma, WA", title: "Roof replacement",
  items: [{ label: "Tear off and replace", qty: 1, unitCents: 1400000 }, { label: "Gutters", qty: 2, unitCents: 40000 }],
  totalCents: 1480000, notes: "Lifetime shingle warranty.", status: "sent", expiresAt: "2099-01-01T00:00:00Z", block: null,
  // 114: what a sales estimate carries beyond the lines.
  number: "EST-AB12CD", rep: "Sam Seller", createdAt: "2026-11-20T10:00:00Z", sentAt: "2026-11-21T10:00:00Z",
  projectType: "residential", targetStart: "2027-05-20", byCategory: { materials: 1400000, labor: 80000, other: 0 },
  details: [{ label: "Roof size", value: "27.5 SQ" }], logo: null,
  schedule: [{ label: "Material order", start: "2027-05-06", end: "2027-05-06", status: "complete" }, { label: "Install", start: "2027-05-21", end: "2027-05-22", status: "planned" }] };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, GC];
  if (path === "/api/account") return [200, GC];
  if (path === "/api/appointments" && method === "GET") return [200, { appointments: APPTS, reps: REPS, team: REPS, crmReady: true, dealsReady: true }];
  if (/^\/api\/appointments\/[^/]+\/activities$/.test(path)) return [200, { activities: [], consent: null, crmReady: true }];
  if (path === "/api/sales-followups") return [200, { followUps: [] }];
  if (path === "/api/sales-leads" && method === "GET") return [200, { leads: LEADS, owners: REPS, sellingReady: true, plusReady: true }];
  if (path === "/api/sales-leads/bulk") { posts.bulk.push(body); return [200, { ok: true, changed: body.ids.length, of: body.ids.length }]; }
  if (path === "/api/sales-leads/import") { posts.import.push(body); return [201, { created: body.rows.length, skipped: [] }]; }
  if (path === "/api/crm-inbox") return [200, { messages: [] }];
  if (path === "/api/crm-library") return [200, { templates: [], sequences: [] }];
  if (path === "/api/crm-views") return [200, { views: [] }];
  if (path === "/api/crm-settings" && method === "GET") return [200, { ready: true, routingMode: "none", routingReps: [], marketReps: {}, cursor: 0,
    alertNewLeads: true, reviewUrl: null, reviewDelayDays: 3, repeatMonths: 11, commissionBps: 500, repCommissionBps: {}, commissionBasis: "sale",
    customFields: [{ key: "roof_age", label: "Roof age", type: "number" }] }];
  if (path === "/api/crm-settings" && method === "PUT") { posts.settings.push(body); return [200, { ready: true, routingMode: body.routingMode || "none",
    routingReps: body.routingReps || [], marketReps: {}, cursor: 0, alertNewLeads: true, reviewDelayDays: 3, repeatMonths: 11,
    commissionBps: 500, repCommissionBps: {}, commissionBasis: "sale", customFields: [] }]; }
  if (path === "/api/markets") return [200, { markets: [] }];
  if (/\/meta$/.test(path)) { posts.meta.push(body); return [200, { tags: body.tags || [], custom: body.custom || {} }]; }
  const mm = path.match(/^\/api\/sales-leads\/([^/]+)\/messages$/);
  if (mm) return [200, { messages: [], consent: LEADS[0].consent, optOut: null, enrollment: null, blocks: {}, canReply: true }];
  if (/\/sales-leads\/[^/]+\/proposals$/.test(path) && method === "GET") return [200, { proposals: PROPS }];
  if (/\/sales-leads\/[^/]+\/proposals$/.test(path) && method === "POST") {
    posts.proposal.push(body);
    const p = { id: "pr1", leadId: "ld_dana", appointmentId: body.appointmentId, title: body.title, items: body.items.map((i) => ({ ...i, unitCents: Math.round(Number(i.unit) * 100) })),
      totalCents: 1480000, notes: body.notes, status: "draft", createdByName: "Richard Braun", createdAt: key(0), number: "EST-AB12CD",
      projectType: body.projectType, targetStart: body.targetStart, details: body.details, schedule: body.schedule, tasks: body.tasks,
      costCents: 1258000, margin: 0.15, byCategory: { materials: 1400000, labor: 80000, other: 0 }, showLogo: true };
    PROPS = [p];
    return [201, { proposal: p }];
  }
  if (path === "/api/proposals/pr1/send") { posts.send.push(1); PROPS = [{ ...PROPS[0], status: "sent", sentAt: key(0), link: `https://app.subsub.work/proposal/${PTOKEN}` }];
    return [200, { proposal: PROPS[0], emailed: { ok: true, to: "dana@home.test" } }]; }
  if (path === "/api/estimate-branding") return [200, { logo: null, from: null, canSet: true }];
  if (/\/claim$/.test(path) && method === "GET") return [200, { claim: null }];
  if (/\/claim$/.test(path) && method === "PUT") { posts.claim.push(body); return [200, { claim: { status: body.status, carrier: body.carrier, updatedAt: key(0) } }]; }
  if (/\/files$/.test(path)) return [200, { files: [] }];
  if (path === "/api/companycam/status") return [200, { connected: false }];
  if (path === "/api/crm-commissions") return [200, { ready: true, settings: { commissionBps: 500, repCommissionBps: {}, commissionBasis: "sale" },
    report: [{ repId: "u_sm", repName: "Sam Seller", sales: 1, valueCents: 1480000, owedCents: 74000, paidCents: 0, unpriced: 0,
      rows: [{ appointmentId: "ap_sold", who: "Dana Ruiz", date: key(-3), bps: 500, valueCents: 1480000, valueSource: "proposal", amountCents: 74000, paid: null }] }] }];
  if (path === `/api/public/proposal/${PTOKEN}` && method === "GET") return [200, PUB];
  if (path === `/api/public/proposal/${PTOKEN}/sign`) { posts.sign.push(body); PUB = { ...PUB, status: "signed", signerName: body.name, signedAt: new Date().toISOString() }; return [200, PUB]; }
  if (path === "/api/account-users") return [200, [{ id: SEAT.userId, name: "Richard Braun", email: "rb@outerhome.test", phone: null,
    role: SEAT.role, subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/google-calendar") return [200, { configured: false }];
  if (path === "/api/jobs" && method === "POST") { posts.jobs.push(body); return [201, { id: "j_new", requested: false, job: null, fromEstimate: { id: body.fromEstimate, linked: true } }]; }
  if (path.startsWith("/api/")) return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();
const click = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); return !!el; }, sel);
const setVal = (page, sel, v) => page.evaluate((s, val) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  return true;
}, sel, v);
const closeModal = async (page) => { await page.evaluate(() => { const m = [...document.querySelectorAll(".modal-backdrop")].pop(); m?.click(); }); await wait(300); };

try {
  const { page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB, seat: SEAT });
  for (let n = 0; n < 40; n++) { await wait(200); if (await page.$("[data-ws='crm']")) break; }
  await click(page, "[data-ws='crm']");
  for (let n = 0; n < 20; n++) { await wait(200); if (await page.$(".appt-view")) break; }

  console.log("\n-- the leads list --");
  await click(page, '[data-crm-nav="leads"]');
  await wait(400);
  const tools = await page.evaluate(() => ({ dupes: document.querySelector("[data-find-dupes]")?.innerText || "",
    imp: !!document.querySelector("[data-import-leads]"), views: !!document.querySelector("[data-saved-views]"),
    picks: document.querySelectorAll("[data-pick]").length, tag: !!document.querySelector(".lead-row .lead-tag") }));
  t.ck("each lead can be ticked, and the tools are there", tools.picks === 3 && tools.imp && tools.views, JSON.stringify(tools));
  t.ck("the duplicates button counts the pair with one phone", /\(1\)/.test(tools.dupes), tools.dupes);
  t.ck("a lead's tag rides on its row", tools.tag);
  await click(page, '[data-pick="ld_dana"]');
  await click(page, '[data-pick="ld_ben"]');
  await wait(200);
  const bar = await page.evaluate(() => document.querySelector("[data-bulk-count]")?.innerText || "");
  t.ck("ticking leads opens the bar to change them at once", bar === "2 ticked", bar);
  await setVal(page, "[data-bulk-value]", "Spring");
  await wait(100);
  await click(page, "[data-bulk-go]");
  await wait(400);
  t.ck("and it sends exactly those leads", posts.bulk.length === 1 && posts.bulk[0].action === "tag" && posts.bulk[0].tag === "Spring"
    && posts.bulk[0].ids.join() === "ld_dana,ld_ben", JSON.stringify(posts.bulk));
  await click(page, "[data-find-dupes]");
  await wait(300);
  t.ck("the duplicates window lists the pair, with a merge", (await page.$$("[data-dupe-group]")).length === 1 && !!(await page.$('[data-merge="ld_dup"]')));
  await closeModal(page);
  await click(page, "[data-import-leads]");
  await wait(300);
  await setVal(page, "[data-import-paste]", "Name,Phone,Email,Tags\nAl Bo,206-555-0110,al@x.test,Hot\n\"Lee, Jr Cy\",206-555-0111,,\n");
  await wait(300);
  const cnt = await page.evaluate(() => document.querySelector("[data-import-count]")?.innerText || "");
  t.ck("a pasted list is read and matched to fields", /^2 rows/.test(cnt), cnt);
  await click(page, "[data-import-go]");
  await wait(400);
  const imp = posts.import[0];
  t.ck("and imported with names split and tags read", imp?.rows?.length === 2 && imp.rows[0].firstName === "Al" && imp.rows[0].lastName === "Bo"
    && imp.rows[0].tags?.[0] === "Hot" && imp.rows[0].phone === "206-555-0110", JSON.stringify(imp));
  t.ck("and the window says how many were added", /Added 2 leads/.test(await page.evaluate(() => document.querySelector("[data-import-result]")?.innerText || "")));
  await closeModal(page);

  console.log("\n-- a lead's proposals, claim and files --");
  await click(page, '[data-lead="ld_dana"]');
  await wait(400);
  const tabs = await page.evaluate(() => [...document.querySelectorAll("[data-lead-tab]")].map((b) => b.dataset.leadTab));
  t.ck("a lead has Proposals, Insurance claim and Files tabs", ["proposals", "claim", "files"].every((x) => tabs.includes(x)), tabs.join(","));
  // 115. Where the sale stands, on the Overview: booked, so the estimate is next.
  t.ck("the Overview says the estimate is next", await page.evaluate(() => document.querySelector("[data-sale-progress]")?.dataset.saleProgress === "write"
    && !!document.querySelector('[data-sale-act="write"]')));
  t.ck("and its Overview has its custom field", !!(await page.$('[data-custom-field="roof_age"]')));
  await setVal(page, "[data-tag-input]", "Hail");
  await wait(100);
  await click(page, "[data-tag-add]");
  await wait(300);
  t.ck("a tag is added from the lead", posts.meta.some((m) => (m.tags || []).join() === "Storm,Hail"), JSON.stringify(posts.meta));
  await click(page, '[data-lead-tab="proposals"]');
  await wait(400);
  await click(page, "[data-new-proposal]");
  await wait(200);
  t.ck("the estimate offers the company logo", !!(await page.$("[data-est-logo-row] [data-est-logo-upload]")));
  t.ck("and opens on the phases and details a roof needs", await page.evaluate(() => document.querySelectorAll("[data-est-phase]").length === 5
    && [...document.querySelectorAll("[data-est-detail] input[aria-label=Detail]")].map((i) => i.value).includes("Roof size")));
  await setVal(page, '[data-prop-line="0"] input[aria-label="Description"]', "Tear off and replace");
  await setVal(page, '[data-prop-line="0"] input[aria-label="Price each"]', "14000");
  await setVal(page, '[data-prop-line="1"] input[aria-label="Description"]', "Gutters");
  await setVal(page, '[data-prop-line="1"] input[aria-label="Quantity"]', "2");
  await setVal(page, '[data-prop-line="1"] input[aria-label="Price each"]', "400");
  await setVal(page, '[data-est-detail="0"] input[aria-label="Value"]', "27.5 SQ");
  await setVal(page, '[data-est-phase="3"] input[aria-label="Start"]', "2027-05-21");
  await setVal(page, "[data-est-cost]", "12580");
  await wait(200);
  const tot = await page.evaluate(() => document.querySelector("[data-prop-total]")?.innerText || "");
  t.ck("the estimate totals its lines as they are typed, by what they are for", /Total \$14,800/.test(tot) && /Materials \$14,000/.test(tot) && /Labor \$800/.test(tot), tot);
  t.ck("the office sees its margin as it types the cost", (await page.evaluate(() => document.querySelector("[data-est-margin-out]")?.innerText || "")) === "15.0%");
  await click(page, "[data-est-preview]");
  await wait(300);
  const pv = await page.evaluate(() => {
    const d = document.querySelector(".est-modal [data-estimate-doc]");
    return d ? { total: d.querySelector("[data-est-total]")?.innerText, margin: d.querySelector("[data-est-margin]")?.innerText || "",
      phases: d.querySelectorAll("[data-est-schedule] tbody tr").length, detail: d.querySelector("[data-est-details]")?.innerText || "",
      overflow: d.scrollWidth > d.clientWidth + 1 } : null;
  });
  t.ck("View estimate draws it before it is saved, margin included for the office", pv?.total === "$14,800" && /15\.0%/.test(pv.margin) && pv.phases === 5
    && /27\.5 SQ/.test(pv.detail) && !pv.overflow, JSON.stringify(pv));
  await closeModal(page);
  await click(page, "[data-prop-save]");
  await wait(400);
  const pb = posts.proposal[0];
  t.ck("saving sends the lines, the schedule, the details, the tasks and the cost", pb?.items?.length === 2 && pb.items[1].qty === 2 && pb.items[1].category === "labor"
    && pb.appointmentId === "ap_open" && pb.schedule?.[3]?.start === "2027-05-21" && pb.details?.[0]?.value === "27.5 SQ" && pb.tasks?.length === 4 && pb.cost === "12580",
    JSON.stringify(pb).slice(0, 400));
  const row = await page.evaluate(() => {
    const r = document.querySelector('[data-proposal="pr1"] .prop-row-main');
    const chip = r?.querySelector("[data-proposal-status]")?.getBoundingClientRect(), v = r?.querySelector("[data-view-estimate]")?.getBoundingClientRect();
    return { chip: !!chip, view: !!v, beside: !!chip && !!v && Math.abs(chip.top - v.top) < 24 && v.left > chip.left };
  });
  t.ck("View estimate sits next to Draft", row.chip && row.view && row.beside, JSON.stringify(row));
  await click(page, '[data-proposal="pr1"] [data-view-estimate]');
  await wait(300);
  t.ck("and opens the estimate", !!(await page.$(".est-modal [data-estimate-doc] [data-est-schedule]")));
  await closeModal(page);
  await click(page, "[data-send-proposal]");
  await wait(400);
  const sent = await page.evaluate(() => ({ st: document.querySelector('[data-proposal-status]')?.dataset.proposalStatus,
    link: document.querySelector(".prop-link code")?.innerText || "", flash: document.querySelector(".appt-flash")?.innerText || "" }));
  t.ck("emailing it says where it went and shows the link", posts.send.length === 1 && sent.st === "sent" && sent.link.includes(PTOKEN)
    && /Emailed to dana@home.test/.test(sent.flash), JSON.stringify(sent));
  t.ck("a sent estimate offers no job yet", !(await page.$("[data-est-create-job]")));
  await click(page, '[data-lead-tab="overview"]');
  await wait(300);
  const waiting = await page.evaluate(() => ({ step: document.querySelector("[data-sale-progress]")?.dataset.saleProgress,
    sign: document.querySelector('[data-sale-act="sign-now"]')?.getAttribute("href") || "", job: !!document.querySelector('[data-sale-act="create-job"]'),
    cust: document.querySelector('[data-move="customer"]')?.disabled }));
  t.ck("then it waits on their signature, with a way to sign at the table, and no job and no Customer yet",
    waiting.step === "awaiting_signature" && waiting.sign.includes(PTOKEN) && !waiting.job && waiting.cust === true, JSON.stringify(waiting));
  // They sign. The lead opens again on the sale.
  PROPS = [{ ...PROPS[0], status: "signed", signedAt: new Date().toISOString(), signerName: "Dana Ruiz" }];
  await closeModal(page);
  await click(page, '[data-lead="ld_dana"]');
  await wait(500);
  const sold = await page.evaluate(() => ({ step: document.querySelector("[data-sale-progress]")?.dataset.saleProgress,
    text: document.querySelector("[data-sale-progress]")?.innerText || "", cust: document.querySelector('[data-move="customer"]')?.disabled }));
  t.ck("once signed it reads Sold, names who signed, and offers the job", sold.step === "create_job" && /Dana Ruiz signed Roof replacement for \$14,800/.test(sold.text)
    && sold.cust === false, JSON.stringify(sold));
  await click(page, '[data-lead-tab="proposals"]');
  await wait(300);
  t.ck("the signed estimate offers Create the job too", !!(await page.$('[data-proposal="pr1"] [data-est-create-job]')));
  await click(page, '[data-lead-tab="overview"]');
  await wait(200);
  await click(page, '[data-sale-act="create-job"]');
  for (let n = 0; n < 20; n++) { await wait(200); if (await page.$(".modal input")) break; }
  const jf = await page.evaluate(() => {
    const val = (re) => { const l = [...document.querySelectorAll(".modal label")].find((x) => re.test(x.innerText || ""));
      return l?.querySelector("input, textarea")?.value || ""; };
    return { title: val(/^Job name/i), client: val(/Homeowner|client/i), zip: val(/^ZIP/i) };
  });
  t.ck("Create the job opens the job form from what they signed", /Roof replacement — Dana Ruiz/.test(jf.title) && /Dana Ruiz/.test(jf.client) && jf.zip === "98406", JSON.stringify(jf));
  for (let n = 0; n < 8 && !posts.jobs.length; n++) {
    await page.evaluate(() => {
      const el = document.querySelector('.modal input[type="date"]');
      if (el && !el.value) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "2027-05-20"); el.dispatchEvent(new Event("input", { bubbles: true })); }
    });
    await wait(150);
    const pressed = await page.evaluate(() => {
      const bs = [...document.querySelectorAll(".modal .form-actions button, .modal button.btn-solid")];
      const save = bs.find((b) => /^(Create job|Create|Save job)/i.test(b.innerText.trim()) && !b.disabled);
      if (save) { save.click(); return "save"; }
      const nx = bs.find((b) => /^Next/i.test(b.innerText.trim()) && !b.disabled);
      if (nx) { nx.click(); return "next"; }
      return "none";
    });
    await wait(400);
    if (pressed === "none") break;
  }
  const jp = posts.jobs[0] || {};
  t.ck("and saving it sends the estimate with the job, without its price", jp.fromEstimate === "pr1" && jp.trades?.join() === "roofing"
    && /Tear off and replace/.test(jp.scope || "") && !/14,?000|\$/.test(jp.scope || ""), JSON.stringify(jp).slice(0, 300));
  await closeModal(page);
  if (!(await page.$("[data-crm-nav]"))) { await click(page, '[data-ws="crm"]'); await wait(300); }
  await click(page, '[data-crm-nav="leads"]');
  await wait(300);
  await click(page, '[data-lead="ld_dana"]');
  await wait(400);
  await click(page, '[data-lead-tab="claim"]');
  await wait(400);
  await setVal(page, "[data-claim-status]", "approved");
  await setVal(page, "[data-claim-carrier]", "State Farm");
  await setVal(page, "[data-claim-approved]", "12000");
  await setVal(page, '[data-lead-claim] input[placeholder="$0"]:not([data-claim-approved])', "1000");
  await wait(150);
  const net = await page.evaluate(() => document.querySelector("[data-claim-net]")?.innerText || "");
  t.ck("the claim says what insurance pays after the deductible", /Insurance pays \$11,000/.test(net), net);
  await click(page, "[data-claim-save]");
  await wait(300);
  t.ck("the claim saves", posts.claim[0]?.status === "approved" && posts.claim[0].carrier === "State Farm" && posts.claim[0].approved === "12000", JSON.stringify(posts.claim));
  await click(page, '[data-lead-tab="files"]');
  await wait(400);
  t.ck("the files tab offers an upload and what kind it is", !!(await page.$("[data-file-input]")) && !!(await page.$("[data-file-kind]")));
  await closeModal(page);

  console.log("\n-- a text reminder on an estimate --");
  await click(page, '[data-crm-nav="appointments"]');
  await wait(300);
  await click(page, '[data-appt="ap_open"]');
  await wait(400);
  const href = await page.evaluate(() => document.querySelector("[data-text-reminder]")?.getAttribute("href") || "");
  t.ck("an estimate with a yes to texts offers a reminder from this phone", href.startsWith("sms:+12535550142") && /reminder/.test(decodeURIComponent(href)), href.slice(0, 80));
  await closeModal(page);

  console.log("\n-- setup and reports --");
  await click(page, '[data-crm-nav="setup"]');
  await wait(300);
  await click(page, '[data-setup-tab="routing"]');
  await wait(400);
  await setVal(page, "[data-routing-mode]", "round_robin");
  await wait(200);
  await page.evaluate(() => document.querySelectorAll("[data-routing-reps] input")[1]?.click());
  await wait(100);
  await click(page, "[data-save-routing]");
  await wait(300);
  t.ck("routing saves the mode and who takes turns", posts.settings[0]?.routingMode === "round_robin" && posts.settings[0].routingReps.join() === "u_sm",
    JSON.stringify(posts.settings));
  const setupTabs = await page.evaluate(() => [...document.querySelectorAll("[data-setup-tab]")].map((b) => b.dataset.setupTab));
  t.ck("Setup has reviews, commission and custom fields", ["aftercare", "commission", "fields"].every((x) => setupTabs.includes(x)), setupTabs.join(","));
  await click(page, '[data-crm-nav="reports"]');
  await wait(500);
  const comm = await page.evaluate(() => document.querySelector('[data-comm-rep="u_sm"]')?.innerText || "");
  t.ck("Reports carries each sales manager's commission", /Sam Seller/.test(comm) && /\$740/.test(comm), comm);
  t.ck("and an admin can mark one paid", !!(await page.$("[data-pay-comm]")));
  t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));

  console.log("\n-- the homeowner signs --");
  const pubCtx = await browser.createBrowserContext();
  const pp = await pubCtx.newPage();
  const pubCrashes = [];
  pp.on("pageerror", (e) => pubCrashes.push(e.message));
  await pp.setViewport({ width: 390, height: 844 });
  await pp.goto(`http://app.subsub.work:${WEB}/proposal/${PTOKEN}`, { waitUntil: "domcontentloaded" });
  for (let n = 0; n < 30; n++) { await wait(200); if (await pp.$("[data-est-title]")) break; }
  const view = await pp.evaluate(() => ({ title: document.querySelector("[data-est-title]")?.innerText || "",
    total: document.querySelector("[data-est-total]")?.innerText || "", rows: document.querySelectorAll("[data-est-items] tbody tr").length,
    disabled: document.querySelector("[data-sign-go]")?.disabled, scroll: document.documentElement.scrollWidth }));
  t.ck("the homeowner sees the lines and the total, with no account", view.title === "Roof replacement" && view.total === "$14,800" && view.rows === 2, JSON.stringify(view));
  const doc = await pp.evaluate(() => ({ text: document.querySelector("[data-estimate-doc]")?.innerText || "",
    phases: document.querySelectorAll("[data-est-schedule] tbody tr").length, facts: document.querySelector("[data-est-facts]")?.innerText || "",
    margin: !!document.querySelector("[data-est-margin]"), tasks: !!document.querySelector("[data-est-tasks]") }));
  t.ck("the homeowner sees the schedule, the project and who the rep is", doc.phases === 2 && /Sam Seller/.test(doc.facts) && /Residential/.test(doc.facts)
    && /27\.5 SQ/.test(doc.text), JSON.stringify({ phases: doc.phases, facts: doc.facts }));
  t.ck("and never the margin or the tasks", !doc.margin && !doc.tasks && !/Profit margin|office only/i.test(doc.text));
  t.ck("and Sign waits for them to agree", view.disabled === true);
  t.ck("and the page fits a phone", view.scroll <= 390, String(view.scroll));
  await pp.evaluate(() => document.querySelector("[data-sign-agree]")?.click());
  await wait(100);
  await pp.evaluate(() => document.querySelector("[data-sign-go]")?.click());
  await wait(500);
  t.ck("signing sends their name and their agreement", posts.sign[0]?.name === "Dana Ruiz" && posts.sign[0].agree === true, JSON.stringify(posts.sign));
  t.ck("and the page says it is signed", /Signed by Dana Ruiz/.test(await pp.evaluate(() => document.querySelector("[data-proposal-signed]")?.innerText || "")));
  t.ck("and nothing crashed there either", pubCrashes.length === 0, pubCrashes.join(" | "));
} catch (err) {
  console.error(err);
  t.ck("the suite ran", false, String(err?.message || err));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
