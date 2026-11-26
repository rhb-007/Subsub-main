// 113. The rest of the CRM: proposals a homeowner signs from a link,
// insurance claims on a roofing lead, routing new leads to a sales manager,
// tags, custom fields, saved views, bulk changes, merging duplicates, files
// on a lead, importing a list, review requests and repeat-business reminders,
// and commission per sales manager. Read by the Worker, the screen and the
// tests, so the three cannot disagree.

import { dollarsToCents, MAX_DEAL_CENTS, centsText } from "./crmsales.js";
import { STAGE_IDS, SOURCE_IDS } from "./leads.js";

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const digits = (v) => String(v ?? "").replace(/\D/g, "");
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const realDay = (d) => {
  if (!DAY_RE.test(String(d || ""))) return false;
  const t = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

// ---------------------------------------------------------------------------
// 6. Proposals. A proposal is line items, a total and a token. The homeowner
// opens it from a link with no account and signs it with their typed name;
// signing marks the estimate sold and its deal amount the proposal's total.
// The total is worked out here and never taken from the request.
// ---------------------------------------------------------------------------

export const PROPOSAL_STATUSES = {
  draft: { label: "Draft" },
  sent: { label: "Sent" },
  viewed: { label: "Opened" },
  signed: { label: "Signed" },
  declined: { label: "Declined" },
  void: { label: "Withdrawn" },
};
export const PROPOSAL_OPEN = ["sent", "viewed"];
export const MAX_PROPOSAL_ITEMS = 40;
export const PROPOSAL_DAYS = 30;
export const PROPOSAL_TOKEN_RE = /^[a-z0-9]{32}$/;

export function proposalTotal(items = []) {
  return items.reduce((t, it) => t + Math.round(Number(it.qty) * it.unitCents), 0);
}

// One proposal, checked. Answers {ok, value} or {ok:false, error, field}.
export function validProposal(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const title = str(o.title, 120);
  if (!title) return { ok: false, error: "title_required", field: "title" };
  const list = Array.isArray(o.items) ? o.items : [];
  if (!list.length) return { ok: false, error: "items_required", field: "items" };
  if (list.length > MAX_PROPOSAL_ITEMS) return { ok: false, error: "too_many_items", field: "items" };
  const items = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i] || {};
    const label = str(it.label, 200);
    if (!label) return { ok: false, error: "item_label_required", field: `items.${i}` };
    const qty = Number(it.qty ?? 1);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100000 || Math.round(qty * 100) !== qty * 100) {
      return { ok: false, error: "bad_qty", field: `items.${i}` };
    }
    const unitCents = "unitCents" in it ? Number(it.unitCents) : dollarsToCents(it.unit);
    if (unitCents === undefined || unitCents === null || !Number.isInteger(unitCents) || unitCents < 0) {
      return { ok: false, error: "bad_price", field: `items.${i}` };
    }
    items.push({ label, qty, unitCents });
  }
  const totalCents = proposalTotal(items);
  if (totalCents <= 0) return { ok: false, error: "total_required", field: "items" };
  if (totalCents > MAX_DEAL_CENTS) return { ok: false, error: "too_large", field: "items" };
  const days = o.expiresDays == null ? PROPOSAL_DAYS : Number(o.expiresDays);
  if (!Number.isInteger(days) || days < 1 || days > 180) return { ok: false, error: "bad_expiry", field: "expiresDays" };
  return { ok: true, value: { title, items, totalCents, notes: str(o.notes, 4000) || null, expiresDays: days } };
}

// What the homeowner was shown, as one text. The signature's hash is of this,
// recomputed from the stored row at signing, never taken from the request.
export function proposalText(p, { accountName = "", homeowner = "" } = {}) {
  const lines = [`${accountName} proposal: ${p.title}`, `For: ${homeowner}`, ""];
  for (const it of p.items || []) lines.push(`${it.label} | ${it.qty} x ${centsText(it.unitCents)} = ${centsText(Math.round(it.qty * it.unitCents))}`);
  lines.push("", `Total: ${centsText(p.totalCents)}`);
  if (p.notes) lines.push("", p.notes);
  return lines.join("\n");
}

// Whether it can still be signed. Answers null, or the reason.
export function proposalSignBlock(p, nowIso = new Date().toISOString()) {
  if (!p) return "not_found";
  if (p.status === "signed") return "already_signed";
  if (p.status === "declined") return "declined";
  if (p.status === "void") return "withdrawn";
  if (p.status === "draft") return "not_sent";
  if (p.expiresAt && String(p.expiresAt) < nowIso) return "expired";
  return null;
}

// A signature is a typed full name, two words at least.
export function validSignature(raw) {
  const name = str(raw?.name, 120).replace(/\s+/g, " ");
  if (name.split(" ").filter(Boolean).length < 2) return { ok: false, error: "full_name_required" };
  if (raw?.agree !== true) return { ok: false, error: "agree_required" };
  return { ok: true, value: { name } };
}

// ---------------------------------------------------------------------------
// 7. An insurance claim on a roofing (or siding) lead.
// ---------------------------------------------------------------------------

export const CLAIM_STATUSES = [
  { id: "not_filed", label: "Not filed yet" },
  { id: "filed", label: "Filed" },
  { id: "adjuster_scheduled", label: "Adjuster scheduled" },
  { id: "approved", label: "Approved" },
  { id: "supplement", label: "Supplement requested" },
  { id: "denied", label: "Denied" },
  { id: "paid", label: "Paid" },
];
export const CLAIM_STATUS_IDS = CLAIM_STATUSES.map((s) => s.id);
export const claimStatusLabel = (id) => CLAIM_STATUSES.find((s) => s.id === id)?.label || "Not filed yet";
const MEETING_RE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?$/;

export function validClaim(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const status = o.status ? String(o.status) : "not_filed";
  if (!CLAIM_STATUS_IDS.includes(status)) return { ok: false, error: "bad_status", field: "status" };
  const phone = digits(o.adjusterPhone);
  const adjusterPhone = phone.length === 11 && phone.startsWith("1") ? phone.slice(1) : phone;
  if (adjusterPhone && adjusterPhone.length !== 10) return { ok: false, error: "bad_phone", field: "adjusterPhone" };
  let meeting = null;
  if (o.adjusterMeeting) {
    const m = MEETING_RE.exec(String(o.adjusterMeeting));
    if (!m || !realDay(m[1]) || (m[2] && (Number(m[2]) > 23 || Number(m[3]) > 59))) return { ok: false, error: "bad_date", field: "adjusterMeeting" };
    meeting = m[2] ? `${m[1]}T${m[2]}:${m[3]}` : m[1];
  }
  const money = (k) => {
    if (!(k in o)) return null;
    const c = dollarsToCents(o[k]);
    if (c === undefined || (c !== null && (c < 0 || c > MAX_DEAL_CENTS))) return undefined;
    return c;
  };
  const approvedCents = money("approved");
  if (approvedCents === undefined) return { ok: false, error: "bad_amount", field: "approved" };
  const deductibleCents = money("deductible");
  if (deductibleCents === undefined) return { ok: false, error: "bad_amount", field: "deductible" };
  if (status === "approved" && approvedCents == null) return { ok: false, error: "approved_amount_required", field: "approved" };
  return { ok: true, value: {
    status, carrier: str(o.carrier, 120) || null, claimNumber: str(o.claimNumber, 60) || null,
    adjusterName: str(o.adjusterName, 120) || null, adjusterPhone: adjusterPhone || null,
    adjusterMeeting: meeting, approvedCents, deductibleCents, notes: str(o.notes, 2000) || null,
  } };
}

// Services a claim makes sense for: storm damage is roofs and siding.
export const CLAIM_SERVICES = ["roof", "siding", "gutters"];

// ---------------------------------------------------------------------------
// 8. Routing a new lead to a sales manager, and telling the office it came.
// ---------------------------------------------------------------------------

export const ROUTING_MODES = [
  { id: "none", label: "Leave new leads unassigned" },
  { id: "round_robin", label: "Take turns between sales managers" },
  { id: "market", label: "By market (where the lead is)" },
];
export const ROUTING_MODE_IDS = ROUTING_MODES.map((m) => m.id);

// Who a new lead goes to. `reps` are the people who may own leads now, so a
// person taken off the account is skipped rather than handed work. Answers
// {ownerId, cursor} (cursor is the round robin's next position).
export function routeLead(settings, { marketId = null, reps = [] } = {}) {
  const live = new Set(reps);
  const s = settings || {};
  const cursor = Number.isInteger(s.cursor) ? s.cursor : 0;
  if (s.mode === "market") {
    const id = marketId && s.marketReps ? s.marketReps[marketId] : null;
    if (id && live.has(id)) return { ownerId: id, cursor };
    // A market with nobody named falls back to taking turns, so a lead in a
    // new area still reaches somebody.
  }
  if (s.mode === "round_robin" || s.mode === "market") {
    const pool = (s.reps || []).filter((r) => live.has(r));
    if (!pool.length) return { ownerId: null, cursor };
    const at = ((cursor % pool.length) + pool.length) % pool.length;
    return { ownerId: pool[at], cursor: cursor + 1 };
  }
  return { ownerId: null, cursor };
}

// ---------------------------------------------------------------------------
// 9. Tags, custom fields, saved views, bulk changes, merging.
// ---------------------------------------------------------------------------

export const MAX_TAGS = 12;
export function cleanTags(list) {
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    const v = str(t, 30).replace(/\s+/g, " ");
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out.slice(0, MAX_TAGS);
}

export const CUSTOM_TYPES = ["text", "number", "date", "select", "yesno"];
export const MAX_CUSTOM_FIELDS = 20;
const KEY_RE = /^[a-z][a-z0-9_]{0,29}$/;
export const fieldKey = (label) => str(label, 60).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 30);

export function validCustomFields(raw) {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_CUSTOM_FIELDS) return { ok: false, error: "too_many_fields" };
  const out = [];
  for (const f of list) {
    const label = str(f?.label, 60);
    if (!label) return { ok: false, error: "label_required" };
    const key = f?.key ? String(f.key) : fieldKey(label);
    if (!KEY_RE.test(key)) return { ok: false, error: "bad_key", key };
    if (out.some((x) => x.key === key)) return { ok: false, error: "duplicate_field", key };
    const type = CUSTOM_TYPES.includes(f?.type) ? f.type : null;
    if (!type) return { ok: false, error: "bad_type", key };
    const options = type === "select" ? cleanTags(f.options).slice(0, 12) : [];
    if (type === "select" && options.length < 2) return { ok: false, error: "options_required", key };
    out.push({ key, label, type, ...(type === "select" ? { options } : {}) });
  }
  return { ok: true, value: out };
}

// A lead's custom values against the account's fields. A key the account has
// no field for is refused by name, because it would be stored and never shown.
export function validCustomValues(defs = [], raw = {}) {
  const o = raw && typeof raw === "object" ? raw : {};
  const value = {};
  for (const [k, v] of Object.entries(o)) {
    const d = defs.find((x) => x.key === k);
    if (!d) return { ok: false, error: "unknown_field", key: k };
    if (v === null || v === "") continue;
    if (d.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) return { ok: false, error: "bad_value", key: k };
      value[k] = n;
    } else if (d.type === "date") {
      if (!realDay(v)) return { ok: false, error: "bad_value", key: k };
      value[k] = String(v);
    } else if (d.type === "select") {
      if (!d.options.includes(String(v))) return { ok: false, error: "bad_value", key: k };
      value[k] = String(v);
    } else if (d.type === "yesno") {
      if (typeof v !== "boolean") return { ok: false, error: "bad_value", key: k };
      value[k] = v;
    } else value[k] = str(v, 300);
  }
  return { ok: true, value };
}

export const VIEW_FILTERS = ["stage", "source", "owner", "tag", "q"];
export function validView(raw) {
  const name = str(raw?.name, 60);
  if (!name) return { ok: false, error: "name_required" };
  const f = raw?.filters && typeof raw.filters === "object" ? raw.filters : {};
  const filters = {};
  for (const k of VIEW_FILTERS) if (f[k]) filters[k] = str(f[k], 120);
  if (filters.stage && !STAGE_IDS.includes(filters.stage)) return { ok: false, error: "bad_filter", key: "stage" };
  if (filters.source && !SOURCE_IDS.includes(filters.source)) return { ok: false, error: "bad_filter", key: "source" };
  return { ok: true, value: { name, filters } };
}

export const BULK_ACTIONS = ["owner", "stage", "tag", "untag", "dnc"];
export const MAX_BULK = 500;
export function validBulk(raw, { role }) {
  const ids = [...new Set((Array.isArray(raw?.ids) ? raw.ids : []).map(String))];
  if (!ids.length) return { ok: false, error: "nothing_selected" };
  if (ids.length > MAX_BULK) return { ok: false, error: "too_many" };
  const action = BULK_ACTIONS.includes(raw?.action) ? raw.action : null;
  if (!action) return { ok: false, error: "bad_action" };
  // Moving leads between people, between stages or out of contact is the
  // office's. Tags are anybody's.
  if (["owner", "stage", "dnc"].includes(action) && !["admin", "pm"].includes(role)) return { ok: false, error: "office_only" };
  const value = { ids, action };
  if (action === "owner") value.ownerId = raw.ownerId ? String(raw.ownerId) : null;
  if (action === "stage") {
    if (!STAGE_IDS.includes(raw.stage)) return { ok: false, error: "bad_stage" };
    value.stage = raw.stage;
  }
  if (action === "tag" || action === "untag") {
    const t = cleanTags([raw.tag])[0];
    if (!t) return { ok: false, error: "tag_required" };
    value.tag = t;
  }
  if (action === "dnc") {
    value.reason = str(raw.reason, 300);
    if (!value.reason) return { ok: false, error: "reason_required" };
  }
  return { ok: true, value };
}

// Two leads that are probably one person: the same phone, the same email, or
// the same name at the same street.
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
export function duplicateGroups(leads = []) {
  const parent = new Map(leads.map((l) => [l.id, l.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  const seen = new Map();
  for (const l of leads) {
    const keys = [];
    const p = digits(l.phone).slice(-10);
    if (p.length === 10) keys.push(`p:${p}`);
    if (l.email) keys.push(`e:${norm(l.email)}`);
    const name = norm([l.firstName, l.lastName].join(" "));
    if (name && l.address?.street) keys.push(`n:${name}|${norm(l.address.street)}`);
    for (const k of keys) { if (seen.has(k)) join(seen.get(k), l.id); else seen.set(k, l.id); }
  }
  const groups = new Map();
  for (const l of leads) { const r = find(l.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(l); }
  return [...groups.values()].filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
}

// What the kept lead looks like after a merge: its own answers stand, and the
// other lead only fills what it left blank.
const STAGE_RANK = { lead: 0, prospect: 1, opportunity: 2, former: 3, customer: 4 };
export function mergedLead(keep, drop) {
  const pick = (a, b) => (a ? a : b || "");
  return {
    firstName: pick(keep.firstName, drop.firstName), lastName: pick(keep.lastName, drop.lastName),
    phone: pick(keep.phone, drop.phone), email: pick(keep.email, drop.email),
    address: keep.address?.street ? keep.address : (drop.address?.street ? drop.address : keep.address),
    services: [...new Set([...(keep.services || []), ...(drop.services || [])])],
    notes: [keep.notes, drop.notes].filter(Boolean).join("\n\n") || null,
    ownerId: keep.ownerId || drop.ownerId || null,
    stage: (STAGE_RANK[drop.stage] ?? 0) > (STAGE_RANK[keep.stage] ?? 0) ? drop.stage : keep.stage,
    tags: cleanTags([...(keep.tags || []), ...(drop.tags || [])]),
  };
}

// ---------------------------------------------------------------------------
// 10. Files on a lead.
// ---------------------------------------------------------------------------

export const MAX_LEAD_FILES = 60;
export const LEAD_FILE_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif",
  "application/pdf", "text/csv", "application/zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/msword",
];
export const LEAD_FILE_KINDS = [
  { id: "photo", label: "Damage photo" },
  { id: "measurement", label: "Measurement report" },
  { id: "estimate", label: "Estimate or quote" },
  { id: "insurance", label: "Insurance paperwork" },
  { id: "other", label: "Other" },
];
export const LEAD_FILE_KIND_IDS = LEAD_FILE_KINDS.map((k) => k.id);

// ---------------------------------------------------------------------------
// 12. Importing a list. Parsed in the browser, checked again on the server.
// ---------------------------------------------------------------------------

export const MAX_IMPORT = 1000;

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export const IMPORT_FIELDS = [
  { id: "firstName", label: "First name", match: ["first name", "first", "firstname", "given name"] },
  { id: "lastName", label: "Last name", match: ["last name", "last", "lastname", "surname", "family name"] },
  { id: "fullName", label: "Full name", match: ["name", "full name", "fullname", "customer", "homeowner", "contact"] },
  { id: "phone", label: "Phone", match: ["phone", "mobile", "cell", "phone number", "telephone"] },
  { id: "email", label: "Email", match: ["email", "e-mail", "email address"] },
  { id: "street", label: "Street", match: ["street", "address", "address 1", "address line 1", "street address"] },
  { id: "city", label: "City", match: ["city", "town"] },
  { id: "state", label: "State", match: ["state", "st", "province"] },
  { id: "zip", label: "ZIP", match: ["zip", "zip code", "zipcode", "postal code", "postcode"] },
  { id: "notes", label: "Notes", match: ["notes", "note", "comments", "comment"] },
  { id: "tags", label: "Tags", match: ["tags", "tag", "labels"] },
];

export function guessMapping(headers = []) {
  const map = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    const f = IMPORT_FIELDS.find((x) => x.match.includes(n));
    if (f && !(f.id in map)) map[f.id] = i;
  });
  return map;
}

// One row as a lead body for validLead. Tags are split on ; or |.
export function importRow(cells = [], mapping = {}) {
  const at = (k) => (mapping[k] == null ? "" : String(cells[mapping[k]] ?? "").trim());
  let firstName = at("firstName"), lastName = at("lastName");
  if (!firstName && !lastName && at("fullName")) {
    const parts = at("fullName").split(/\s+/);
    lastName = parts.length > 1 ? parts.pop() : "";
    firstName = parts.join(" ");
  }
  return {
    firstName, lastName, phone: at("phone"), email: at("email"),
    address: { street: at("street"), city: at("city"), state: at("state").toUpperCase().slice(0, 2), zip: at("zip").slice(0, 5) },
    notes: at("notes") || null, tags: at("tags") ? at("tags").split(/[;|]/) : [],
  };
}

// ---------------------------------------------------------------------------
// 13. After the job: a review request, and a reminder to come back.
// ---------------------------------------------------------------------------

export const REVIEW_DELAY_DAYS = 3;
export const REPEAT_MONTHS = 11;

export function validReviewUrl(v) {
  const s = str(v, 400);
  if (!s) return null;
  try {
    const u = new globalThis.URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    if (!u.hostname.includes(".") || u.username || u.password) return undefined;
    return u.toString();
  } catch { return undefined; }
}

// The day a review request is due for a sale finished on `doneDay`, and the
// day the repeat-business reminder is.
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export function addMonths(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0, 12)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 14. Commission. A rate per sales manager (or the account's default) times
// what the job was actually worth.
// ---------------------------------------------------------------------------

export const MAX_COMMISSION_BPS = 5000; // 50%
// What a sale is worth for commission, in order: the work orders accepted on
// the job made from it (what SubSub knows it cost to deliver), then the signed
// proposal, then the deal amount somebody typed.
export const COMMISSION_SOURCES = {
  proposal: "Signed proposal",
  deal: "Deal amount",
  job: "Job value",
};
export function saleValue({ proposalCents = null, dealCents = null, jobCents = null, basis = "sale" } = {}) {
  if (basis === "job" && jobCents) return { cents: jobCents, source: "job" };
  if (proposalCents) return { cents: proposalCents, source: "proposal" };
  if (dealCents) return { cents: dealCents, source: "deal" };
  if (jobCents) return { cents: jobCents, source: "job" };
  return { cents: null, source: null };
}
export const commissionCents = (valueCents, bps) =>
  (valueCents == null || !bps ? 0 : Math.round((valueCents * bps) / 10000));

export function pctToBps(v) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).replace(/[%\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const bps = Math.round(Number(s) * 100);
  return bps > MAX_COMMISSION_BPS ? undefined : bps;
}
export const bpsText = (b) => (b == null ? "" : `${(b / 100).toFixed(b % 100 ? 2 : 0)}%`);

// The account's CRM settings, checked. Every key optional.
export function validCrmSettings(raw, { reps = [], markets = [] } = {}) {
  const o = raw && typeof raw === "object" ? raw : {};
  const v = {};
  if ("routingMode" in o) {
    if (!ROUTING_MODE_IDS.includes(o.routingMode)) return { ok: false, error: "bad_routing_mode" };
    v.routingMode = o.routingMode;
  }
  if ("routingReps" in o) {
    const list = [...new Set((Array.isArray(o.routingReps) ? o.routingReps : []).map(String))];
    if (list.some((id) => !reps.includes(id))) return { ok: false, error: "bad_rep" };
    v.routingReps = list;
  }
  if ("marketReps" in o) {
    const m = o.marketReps && typeof o.marketReps === "object" ? o.marketReps : {};
    const out = {};
    for (const [mk, rep] of Object.entries(m)) {
      if (!rep) continue;
      if (!markets.includes(mk)) return { ok: false, error: "bad_market" };
      if (!reps.includes(String(rep))) return { ok: false, error: "bad_rep" };
      out[mk] = String(rep);
    }
    v.marketReps = out;
  }
  if ("alertNewLeads" in o) v.alertNewLeads = !!o.alertNewLeads;
  if ("reviewUrl" in o) {
    const u = validReviewUrl(o.reviewUrl);
    if (u === undefined) return { ok: false, error: "bad_review_url" };
    v.reviewUrl = u;
  }
  if ("reviewDelayDays" in o) {
    const n = Number(o.reviewDelayDays);
    if (!Number.isInteger(n) || n < 0 || n > 60) return { ok: false, error: "bad_review_delay" };
    v.reviewDelayDays = n;
  }
  if ("repeatMonths" in o) {
    const n = o.repeatMonths === null || o.repeatMonths === "" ? null : Number(o.repeatMonths);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 60)) return { ok: false, error: "bad_repeat_months" };
    v.repeatMonths = n;
  }
  if ("commissionPct" in o) {
    const b = pctToBps(o.commissionPct);
    if (b === undefined) return { ok: false, error: "bad_commission" };
    v.commissionBps = b;
  }
  if ("repCommissionPct" in o) {
    const m = o.repCommissionPct && typeof o.repCommissionPct === "object" ? o.repCommissionPct : {};
    const out = {};
    for (const [rep, pct] of Object.entries(m)) {
      if (!reps.includes(rep)) return { ok: false, error: "bad_rep" };
      const b = pctToBps(pct);
      if (b === undefined) return { ok: false, error: "bad_commission" };
      if (b != null) out[rep] = b;
    }
    v.repCommissionBps = out;
  }
  if ("commissionBasis" in o) {
    if (!["sale", "job"].includes(o.commissionBasis)) return { ok: false, error: "bad_commission_basis" };
    v.commissionBasis = o.commissionBasis;
  }
  if ("customFields" in o) {
    const f = validCustomFields(o.customFields);
    if (!f.ok) return f;
    v.customFields = f.value;
  }
  return { ok: true, value: v };
}

export const DEFAULT_CRM_SETTINGS = {
  routingMode: "none", routingReps: [], marketReps: {}, cursor: 0, alertNewLeads: true,
  reviewUrl: null, reviewDelayDays: REVIEW_DELAY_DAYS, repeatMonths: REPEAT_MONTHS,
  commissionBps: null, repCommissionBps: {}, commissionBasis: "sale", customFields: [],
};

// Commission per sales manager over the sales the list holds.
export function commissionReport(sales = [], settings = DEFAULT_CRM_SETTINGS) {
  const by = new Map();
  for (const s of sales) {
    if (!s.repId) continue;
    const bps = s.paid ? s.paid.bps : (settings.repCommissionBps?.[s.repId] ?? settings.commissionBps ?? 0);
    const val = s.paid ? { cents: s.paid.valueCents, source: s.paid.valueSource }
      : saleValue({ ...s, basis: settings.commissionBasis || "sale" });
    const amount = s.paid ? s.paid.amountCents : commissionCents(val.cents, bps);
    if (!by.has(s.repId)) by.set(s.repId, { repId: s.repId, repName: s.repName || "", sales: 0, valueCents: 0, owedCents: 0, paidCents: 0, unpriced: 0, rows: [] });
    const r = by.get(s.repId);
    r.sales++;
    if (val.cents == null) r.unpriced++;
    r.valueCents += val.cents || 0;
    if (s.paid) r.paidCents += amount; else r.owedCents += amount;
    r.rows.push({ ...s, bps, valueCents: val.cents, valueSource: val.source, amountCents: amount });
  }
  return [...by.values()].sort((a, b) => b.valueCents - a.valueCents);
}

// The homeowner's link: /proposal/<token>, a path for the reason a claim link
// is one -- it is read off an email on a phone.
export function proposalPathToken(path) {
  const m = /^\/proposal\/([a-z0-9]{32})\/?$/.exec(String(path || ""));
  return m ? m[1] : null;
}

// What a refused CRM change is called on the screen, in the route's words.
export const CRM_PLUS_TEXT = {
  title_required: "Give the proposal a title.",
  items_required: "Add at least one line.",
  item_label_required: "Every line needs a description.",
  bad_qty: "A quantity must be a number above zero.",
  bad_price: "A price must be dollars and cents.",
  total_required: "The total has to be more than $0.",
  too_large: "That total is too large to be right.",
  bad_expiry: "A proposal is good for 1 to 180 days.",
  not_a_draft: "It has already gone out. Withdraw it and make a new one to change it.",
  needs_email: "Add an email address to the lead to send it.",
  do_not_contact: "They're marked Do not contact.",
  already_signed: "It has already been signed.",
  bad_appointment: "That appointment isn't one of this lead's.",
  appointment_closed: "That appointment was canceled or a no-show.",
  approved_amount_required: "Add the amount the insurer approved.",
  bad_phone: "That phone number needs 10 digits.",
  bad_date: "That date doesn't look right.",
  bad_amount: "An amount must be dollars and cents.",
  office_only: "Only an admin or project manager can do that.",
  nothing_selected: "Pick some leads first.",
  tag_required: "Type a tag.",
  reason_required: "Say why, so the next person knows.",
  bad_value: "That value doesn't fit the field.",
  unknown_field: "That field isn't set up on this account.",
  not_uploaded: "That file didn't upload. Try again.",
  too_many_files: `A lead can hold up to ${MAX_LEAD_FILES} files.`,
  bad_rep: "That person can't own leads here.",
  bad_commission: "A commission is a percent between 0 and 50.",
  bad_review_url: "That review link isn't a web address.",
  no_value: "There's no value on this sale yet: sign a proposal or set the deal amount.",
  no_rate: "Set a commission rate first.",
  already_paid: "It's already marked paid.",
  no_rep: "Nobody is the sales manager on this sale.",
  same_lead: "Pick two different leads.",
  nothing_to_import: "There are no rows to import.",
  too_many: "That's too many at once.",
};
