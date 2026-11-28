// 114. ESTIMATES: what a sales estimate carries beyond its lines, and the
// line between what the homeowner sees and what the office keeps.
//
// What is pinned:
//   - each line keeps its category, and the breakdown adds up to the total;
//   - project details, the schedule, tasks and the cost are checked: a phase
//     cannot end before it starts, a date must be a real day, an empty row is
//     left behind rather than refused;
//   - the office sees the margin and the tasks; the homeowner's page never
//     carries the tasks, the cost or the margin, in any field;
//   - the details and the schedule are in what the signature's hash is of,
//     and an estimate with none of them hashes exactly as a 113 proposal did;
//   - the homeowner's part changes only on a draft, the office's (tasks, cost)
//     on a sent estimate too;
//   - the estimate logo is the account's own, set by the office, checked as an
//     upload of this account, served by the token only while shown;
//   - without 114 an estimate still saves and sends, and the reply names the
//     file.
//
//   node --no-warnings scripts/estimates-test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { makeD1, makeR2, freshDb } from "./lib/d1-sqlite.mjs";
import { validEstimateExtras, categoryTotals, marginOf, marginText, extrasText, homeownerExtras, presetPhases, presetDetails, estimateNumber }
  from "../shared/estimate.js";
import { validProposal, proposalText } from "../shared/crmplus.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

// --- the rules -----------------------------------------------------------------
const p = validProposal({ title: "Roof", items: [{ label: "Shingles", unit: "8250", category: "materials" },
  { label: "Crew", unit: "7900", category: "labor" }, { label: "Dumpster", unit: "2500" }, { label: "Odd", unit: "1", category: "nope" }] });
ck("each line keeps its category, an unknown one is other", p.ok && p.value.items.map((i) => i.category).join() === "materials,labor,other,other", JSON.stringify(p.value?.items));
const by = categoryTotals(p.value.items);
ck("the breakdown adds up to the total", by.materials === 825000 && by.labor === 790000 && by.other === 250100
  && by.materials + by.labor + by.other === p.value.totalCents, JSON.stringify(by));
ck("the margin is the share of the price left after cost", marginText(marginOf(1865000, 1581525)) === "15.2%", marginText(marginOf(1865000, 1581525)));
ck("no cost is no margin, never a number", marginOf(100, null) === null && marginOf(0, 0) === null);
ck("a phase cannot end before it starts", validEstimateExtras({ schedule: [{ label: "Install", start: "2027-05-21", end: "2027-05-20" }] }).error === "phase_ends_before_start");
ck("a date must be a real day", validEstimateExtras({ targetStart: "2027-02-30" }).error === "bad_date"
  && validEstimateExtras({ tasks: [{ label: "x", due: "2027-13-01" }] }).error === "bad_date");
const ex = validEstimateExtras({ details: [{ label: "Roof size", value: "27.5 SQ" }, { label: "", value: "" }],
  schedule: [{ label: "Tear off", start: "2027-05-20" }, { label: "", start: "", end: "" }], tasks: [{ label: "" }, { label: "Order", done: true }], cost: "$15,815.25" });
ck("empty rows are left behind, a one-day phase ends when it starts", ex.ok && ex.value.details.length === 1 && ex.value.schedule[0].end === "2027-05-20"
  && ex.value.tasks.length === 1 && ex.value.costCents === 1581525, JSON.stringify(ex));
ck("only the keys sent are returned", Object.keys(validEstimateExtras({ tasks: [] }).value).join() === "tasks");
ck("a detail with a value and no name is refused", validEstimateExtras({ details: [{ label: "", value: "x" }] }).error === "detail_label_required");
ck("a bad project type is refused", validEstimateExtras({ projectType: "castle" }).error === "bad_project_type");
ck("the presets follow the services", presetPhases(["roofing"]).map((x) => x.label).join() === "Material order,Delivery,Tear off,Install,Inspection"
  && presetDetails(["roofing", "gutters"]).filter((d) => d.label === "Warranty").length === 1);
const shown = homeownerExtras({ details: [{ label: "Pitch", value: "" }, { label: "Stories", value: "1" }], tasks: [{ label: "x" }], costCents: 5 });
ck("the homeowner's part has no tasks or cost, and no empty detail", !("tasks" in shown) && !("costCents" in shown) && shown.details.length === 1, JSON.stringify(shown));
ck("nothing extra adds nothing to the signed text", extrasText({}) === "" && extrasText({ details: [], schedule: [] }) === "");
ck("the schedule is in the signed text", /Tear off \| 2027-05-20 to 2027-05-20 \| Planned/.test(extrasText(ex.value)) && !/Order/.test(extrasText(ex.value)), extrasText(ex.value));
ck("an estimate has a number", /^EST-[A-Z0-9]{6}$/.test(estimateNumber("ab12cd34-ef")));

// --- the routes ----------------------------------------------------------------
const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
globalThis.fetch = async () => new Response(JSON.stringify({ id: "em_1" }), { headers: { "Content-Type": "application/json" } });
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES ('acc_gc','Outerhome','general_contractor','outerhome','basic');
    INSERT INTO users(id,name,email) VALUES ('u_admin','Richard Braun','rb@o.test'),('u_sm','Alex Johnson','alex@o.test'),('u_cc','Cara Call','cara@o.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m1','u_admin','acc_gc','admin'),('m2','u_sm','acc_gc','sales'),('m3','u_cc','acc_gc','callcenter');
  `);
  return { db, env: { DB: makeD1(db), FILES: makeR2(), RESEND_API_KEY: "re_t", MAIL_FROM: "x@subsub.work", RESEND_API_BASE: "https://mail.test" } };
};
const { db, env } = seed();
const call = (path, { method = "GET", body, who = "u_admin", raw = null, type = "application/json" } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, { method, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    headers: { "Content-Type": type, "X-User-Id": who, "X-Account-Id": "acc_gc" } }), env);
const pub = (path, { method = "GET", body } = {}) => worker.fetch(new Request(`https://api.subsub.work${path}`,
  { method, body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", "CF-Connecting-IP": "9.9.9.9" } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

let [s, b] = await json(await call("/api/sales-leads", { method: "POST", who: "u_sm", body: { firstName: "Dwayne", lastName: "Johnson", email: "dj@home.test",
  address: { street: "123 Maple St", city: "Windcreek", state: "CA", zip: "90771" }, services: ["roofing"] } }));
const lead = b.lead?.id;
ck("a lead to write it for", s === 201 && !!lead, `${s} ${JSON.stringify(b).slice(0, 200)}`);
const BODY = { title: "Full Roof Replacement", projectType: "residential", targetStart: "2027-05-20",
  items: [{ label: "Shingles and underlayment", unit: "8250", category: "materials" }, { label: "Install crew", unit: "7900", category: "labor" },
    { label: "Dumpster and permit", unit: "2500", category: "other" }],
  details: [{ label: "Roof size", value: "27.5 SQ" }, { label: "Stories", value: "1" }],
  schedule: [{ label: "Material order", start: "2027-05-06", status: "complete" }, { label: "Install", start: "2027-05-21", end: "2027-05-22" }],
  tasks: [{ label: "Confirm insurance claim", due: "2027-05-03", who: "Alex J." }], cost: "15815.25" };
[s, b] = await json(await call(`/api/sales-leads/${lead}/proposals`, { method: "POST", who: "u_sm", body: BODY }));
const est = b.proposal;
ck("the sales manager writes it, extras and all", s === 201 && est.schedule?.length === 2 && est.details?.length === 2 && est.tasks?.length === 1
  && est.projectType === "residential" && est.targetStart === "2027-05-20", `${s} ${JSON.stringify(b).slice(0, 300)}`);
ck("the office sees the breakdown and the margin", est.byCategory?.labor === 790000 && marginText(est.margin) === "15.2%" && est.costCents === 1581525, JSON.stringify({ by: est.byCategory, m: est.margin }));
ck("and its number", /^EST-/.test(est.number || ""));
[s, b] = await json(await call(`/api/sales-leads/${lead}/proposals`, { method: "POST", who: "u_sm", body: { ...BODY, schedule: [{ label: "x", start: "2027-05-22", end: "2027-05-01" }] } }));
ck("a bad schedule refuses the whole estimate", s === 400 && b.error === "phase_ends_before_start");
[s, b] = await json(await call(`/api/sales-leads/${lead}/proposals`));
ck("the list carries them", s === 200 && b.proposals.length === 1 && b.proposals[0].tasks.length === 1);
[s, b] = await json(await call(`/api/sales-leads/${lead}/proposals`, { who: "u_cc" }));
ck("a contact center seat reads it", s === 200);

[s, b] = await json(await call(`/api/proposals/${est.id}/send`, { method: "POST", who: "u_sm" }));
const token = b.proposal?.link?.split("/proposal/")[1];
ck("it sends", s === 200 && /^[a-z0-9]{32}$/.test(token || ""), `${s} ${JSON.stringify(b).slice(0, 200)}`);
[s, b] = await json(await call(`/api/proposals/${est.id}`, { method: "PATCH", who: "u_sm", body: { schedule: [] } }));
ck("once sent, the homeowner's part cannot change", s === 409 && b.error === "not_a_draft");
[s, b] = await json(await call(`/api/proposals/${est.id}`, { method: "PATCH", who: "u_sm", body: { tasks: [{ label: "Confirm insurance claim", done: true }], cost: "16000" } }));
ck("the office's part still can", s === 200 && b.proposal.tasks[0].done === true && b.proposal.costCents === 1600000 && b.proposal.schedule.length === 2,
  `${s} ${JSON.stringify(b).slice(0, 200)}`);

[s, b] = await json(await pub(`/api/public/proposal/${token}`));
const flat = JSON.stringify(b);
ck("the homeowner sees the project, the schedule and the breakdown", s === 200 && b.schedule?.length === 2 && b.details?.length === 2
  && b.address === "123 Maple St, Windcreek, CA" && b.byCategory?.materials === 825000 && b.projectType === "residential" && b.rep === "Alex Johnson" && /^EST-/.test(b.number), flat.slice(0, 300));
ck("and never the tasks, the cost or the margin", !("tasks" in b) && !("costCents" in b) && !("margin" in b) && !/insurance claim|1600000/i.test(flat), flat.slice(0, 300));
ck("no logo on file is no logo", b.logo === null);

// The logo: uploaded, set, and served by the token.
let r = await call("/api/uploads/estimate-logo/logo.png", { method: "PUT", raw: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), type: "image/png" });
[s, b] = await json(r);
const key = b.key;
ck("a logo uploads as a checked image", s === 200 && key?.startsWith("acc_gc/estimate-logo/"), `${s} ${JSON.stringify(b)}`);
r = await call("/api/uploads/estimate-logo/x.html", { method: "PUT", raw: "<script>", type: "text/html" });
ck("and nothing that is not an image does", r.status === 415);
[s, b] = await json(await call("/api/estimate-branding", { method: "PUT", body: { logoKey: "acc_x/estimate-logo/theirs.png" } }));
ck("a key from another account is refused", s === 400 && b.error === "logo_not_uploaded");
[s, b] = await json(await call("/api/estimate-branding", { method: "PUT", who: "u_sm", body: { logoKey: key } }));
ck("a sales manager cannot set it", s === 403);
[s, b] = await json(await call("/api/estimate-branding", { method: "PUT", body: { logoKey: key } }));
ck("the office sets it", s === 200 && b.from === "estimate" && b.logo === "/api/estimate-logo/acc_gc", JSON.stringify(b));
[s, b] = await json(await call("/api/estimate-branding", { who: "u_sm" }));
ck("everybody on the CRM reads it", s === 200 && b.from === "estimate" && b.canSet === false, JSON.stringify(b));
[s, b] = await json(await pub(`/api/public/proposal/${token}`));
ck("the homeowner's page carries it, by the token", b.logo === `/api/public/proposal/${token}/logo`, String(b.logo));
r = await pub(`/api/public/proposal/${token}/logo`);
ck("and it is served, nosniff", r.status === 200 && r.headers.get("content-type") === "image/png" && r.headers.get("x-content-type-options") === "nosniff");
ck("the office's copy is served by the account", (await pub("/api/estimate-logo/acc_gc")).status === 200);
// A draft that says not to show it.
[s, b] = await json(await call(`/api/sales-leads/${lead}/proposals`, { method: "POST", who: "u_sm", body: { ...BODY, title: "No logo", showLogo: false } }));
const quiet = b.proposal;
[s, b] = await json(await call(`/api/proposals/${quiet.id}/send`, { method: "POST", who: "u_sm" }));
const qtoken = b.proposal.link.split("/proposal/")[1];
[s, b] = await json(await pub(`/api/public/proposal/${qtoken}`));
ck("an estimate set not to show it carries none", b.logo === null && (await pub(`/api/public/proposal/${qtoken}/logo`)).status === 404);

// Signing: the hash is of what they were shown, schedule included.
[s, b] = await json(await pub(`/api/public/proposal/${token}/sign`, { method: "POST", body: { name: "Dwayne Johnson", agree: true } }));
ck("they sign it", s === 200 && b.status === "signed", `${s} ${JSON.stringify(b).slice(0, 160)}`);
const row = db.prepare(`SELECT signed_hash FROM sales_proposals WHERE id = ?`).get(est.id);
const shownItems = JSON.parse(db.prepare(`SELECT items FROM sales_proposals WHERE id = ?`).get(est.id).items);
const want = createHash("sha256").update(proposalText({ title: BODY.title, items: shownItems, totalCents: 1865000, notes: null },
  { accountName: "Outerhome", homeowner: "Dwayne Johnson" }) + extrasText({ projectType: "residential", targetStart: "2027-05-20",
  details: BODY.details, schedule: [{ label: "Material order", start: "2027-05-06", end: "2027-05-06", status: "complete" },
    { label: "Install", start: "2027-05-21", end: "2027-05-22", status: "planned" }] })).digest("hex");
ck("the hash covers the schedule and the details", row.signed_hash === want, `${row.signed_hash} vs ${want}`);

// Without 114: still saves and sends, and says which file.
db.exec(`DROP TABLE sales_estimate_extras; DROP TABLE estimate_branding;`);
[s, b] = await json(await call(`/api/sales-leads/${lead}/proposals`, { method: "POST", who: "u_sm", body: BODY }));
ck("without 114 it still saves, naming the file", s === 201 && b.extrasMigration === "114_estimates_mirror" && b.proposal.schedule.length === 0, `${s} ${JSON.stringify(b).slice(0, 200)}`);
[s, b] = await json(await call(`/api/sales-leads/${lead}/proposals`));
ck("and the list loads, saying so", s === 200 && b.extrasMigration === "114_estimates_mirror" && b.proposals.length === 3);
[s, b] = await json(await call(`/api/proposals/${b.proposals[0].id}/send`, { method: "POST", who: "u_sm" }));
ck("and it sends", s === 200 && b.proposal.status === "sent");
[s, b] = await json(await call("/api/estimate-branding"));
ck("the logo read says which file", s === 200 && b.migration === "114_estimates_mirror");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
