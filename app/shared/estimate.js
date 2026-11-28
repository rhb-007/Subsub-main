// 114. ESTIMATES: what the CRM called a proposal, renamed on screen and grown
// into a sales estimate. Read by the Worker, the screen and the tests, so the
// three cannot disagree about what a homeowner was shown.
//
// An estimate is still line items, a total and a token the homeowner signs
// from (shared/crmplus.js: validProposal, proposalText). What 114 adds:
//
//   - a CATEGORY on each line (materials, labor, other), so the estimate can
//     say what the money is for, the way a sales estimate does;
//   - PROJECT DETAILS: the project type, a target start, and label / value
//     rows (roof size, stories, pitch, warranty), seeded from the services the
//     homeowner asked about;
//   - a PROPOSED PRODUCTION SCHEDULE: phases with a start, an end and a status;
//   - TASKS: the office's own to-do list for this sale;
//   - the COST behind the price, so the office sees its margin;
//   - whether it wears the company's LOGO.
//
// WHAT THE HOMEOWNER SEES AND WHAT THEY DO NOT is the line everything here
// is drawn on. Details, the schedule and the breakdown by category are on
// their page and in the text they sign. Tasks, the cost and the margin are the
// office's and never leave it: a margin on a homeowner's estimate is the
// company's pricing handed to the customer.
//
// Stored identifiers keep the old word (sales_proposals, /proposal/<token>),
// because a renamed table is a migration and a renamed link breaks every one
// already in an inbox.

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (d) => {
  if (!DAY_RE.test(String(d || ""))) return false;
  const t = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

export const LINE_CATEGORIES = [
  { id: "materials", label: "Materials" },
  { id: "labor", label: "Labor" },
  { id: "other", label: "Other" },
];
export const LINE_CATEGORY_IDS = LINE_CATEGORIES.map((c) => c.id);
export const lineCategory = (c) => (LINE_CATEGORY_IDS.includes(c) ? c : "other");

export const PROJECT_TYPES = [
  { id: "residential", label: "Residential" },
  { id: "commercial", label: "Commercial" },
  { id: "multifamily", label: "Multifamily" },
];
export const projectTypeLabel = (id) => PROJECT_TYPES.find((p) => p.id === id)?.label || "";

export const PHASE_STATUSES = {
  planned: { label: "Planned" },
  scheduled: { label: "Scheduled" },
  complete: { label: "Complete" },
};
export const PHASE_STATUS_IDS = Object.keys(PHASE_STATUSES);

export const MAX_DETAILS = 20;
export const MAX_PHASES = 20;
export const MAX_TASKS = 40;

// What each service usually needs written down, offered as empty rows on a
// new estimate. Somebody types the values; nothing here is assumed.
export const DETAIL_PRESETS = {
  roofing: ["Roof size", "Stories", "Pitch", "Material", "Warranty"],
  siding: ["Wall area", "Material", "Color", "Warranty"],
  windows: ["Number of windows", "Frame", "Glass", "Warranty"],
  gutters: ["Linear feet", "Size", "Material", "Warranty"],
};
// The phases a job of that kind usually runs through, in order.
export const PHASE_PRESETS = {
  roofing: ["Material order", "Delivery", "Tear off", "Install", "Inspection"],
  siding: ["Material order", "Delivery", "Removal", "Install", "Walkthrough"],
  windows: ["Measure and order", "Delivery", "Install", "Walkthrough"],
  gutters: ["Material order", "Install", "Walkthrough"],
};
export const TASK_PRESETS = ["Confirm insurance claim", "Order materials", "Permit application", "Schedule the crew"];

export function presetDetails(services = []) {
  const seen = new Set(), out = [];
  for (const s of services || []) for (const l of DETAIL_PRESETS[s] || []) if (!seen.has(l)) { seen.add(l); out.push({ label: l, value: "" }); }
  return out;
}
export function presetPhases(services = []) {
  const seen = new Set(), out = [];
  for (const s of services || []) for (const l of PHASE_PRESETS[s] || []) if (!seen.has(l)) { seen.add(l); out.push({ label: l, start: "", end: "", status: "planned" }); }
  return out;
}

// Materials, labor and other, from the lines. Whole cents, and the three add
// up to the total because each line lands in exactly one.
export function categoryTotals(items = []) {
  const t = { materials: 0, labor: 0, other: 0 };
  for (const it of items) t[lineCategory(it.category)] += Math.round(Number(it.qty) * it.unitCents);
  return t;
}

// The margin on the price, as a share of the price. Null when either half is
// missing, never a number that pretends to know.
export function marginOf(totalCents, costCents) {
  if (!Number.isInteger(totalCents) || totalCents <= 0) return null;
  if (!Number.isInteger(costCents) || costCents < 0) return null;
  return (totalCents - costCents) / totalCents;
}
export const marginText = (m) => (m === null || m === undefined ? "" : `${(Math.round(m * 1000) / 10).toFixed(1)}%`);

// The extras, checked. Answers {ok, value} or {ok:false, error, field}. Only
// keys present are checked and returned, so a body that sends only the tasks
// changes only the tasks.
export function validEstimateExtras(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const v = {};
  if ("projectType" in o) {
    const p = o.projectType == null || o.projectType === "" ? null : String(o.projectType);
    if (p && !PROJECT_TYPES.some((x) => x.id === p)) return { ok: false, error: "bad_project_type", field: "projectType" };
    v.projectType = p;
  }
  if ("targetStart" in o) {
    const d = o.targetStart == null || o.targetStart === "" ? null : String(o.targetStart);
    if (d && !realDay(d)) return { ok: false, error: "bad_date", field: "targetStart" };
    v.targetStart = d;
  }
  if ("details" in o) {
    const list = Array.isArray(o.details) ? o.details : [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const label = str(list[i]?.label, 60), value = str(list[i]?.value, 160);
      if (!label && !value) continue; // an empty row is left behind, not refused
      if (!label) return { ok: false, error: "detail_label_required", field: `details.${i}` };
      out.push({ label, value });
    }
    if (out.length > MAX_DETAILS) return { ok: false, error: "too_many_details", field: "details" };
    v.details = out;
  }
  if ("schedule" in o) {
    const list = Array.isArray(o.schedule) ? o.schedule : [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i] || {};
      const label = str(p.label, 80);
      const start = p.start ? String(p.start) : "", end = p.end ? String(p.end) : "";
      if (!label && !start && !end) continue;
      if (!label) return { ok: false, error: "phase_label_required", field: `schedule.${i}` };
      if ((start && !realDay(start)) || (end && !realDay(end))) return { ok: false, error: "bad_date", field: `schedule.${i}` };
      if (start && end && end < start) return { ok: false, error: "phase_ends_before_start", field: `schedule.${i}` };
      const status = PHASE_STATUS_IDS.includes(p.status) ? p.status : "planned";
      out.push({ label, start: start || null, end: end || start || null, status });
    }
    if (out.length > MAX_PHASES) return { ok: false, error: "too_many_phases", field: "schedule" };
    v.schedule = out;
  }
  if ("tasks" in o) {
    const list = Array.isArray(o.tasks) ? o.tasks : [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i] || {};
      const label = str(t.label, 160);
      if (!label) continue;
      const due = t.due ? String(t.due) : "";
      if (due && !realDay(due)) return { ok: false, error: "bad_date", field: `tasks.${i}` };
      out.push({ label, due: due || null, who: str(t.who, 60) || null, done: t.done === true });
    }
    if (out.length > MAX_TASKS) return { ok: false, error: "too_many_tasks", field: "tasks" };
    v.tasks = out;
  }
  if ("costCents" in o || "cost" in o) {
    let c = "costCents" in o ? o.costCents : (o.cost === "" || o.cost == null ? null : Math.round(Number(String(o.cost).replace(/[$,\s]/g, "")) * 100));
    if (c === "" || c === undefined) c = null;
    if (c !== null && (!Number.isInteger(c) || c < 0 || c > 1e10)) return { ok: false, error: "bad_cost", field: "cost" };
    v.costCents = c;
  }
  if ("showLogo" in o) v.showLogo = o.showLogo !== false;
  return { ok: true, value: v };
}

// The extras a homeowner is shown, and is signing. Tasks and cost are never
// in it. Empty parts are dropped so an estimate without them reads as before.
export function homeownerExtras(x = {}) {
  return {
    projectType: x.projectType || null,
    targetStart: x.targetStart || null,
    details: (x.details || []).filter((d) => d.label && d.value),
    schedule: (x.schedule || []).filter((p) => p.label),
  };
}

// The lines the signature's hash covers, beyond the items: appended to
// proposalText only when there is something to append, so an estimate with
// none of 114's parts hashes exactly as a 113 proposal did.
export function extrasText(x = {}) {
  const h = homeownerExtras(x);
  const lines = [];
  if (h.projectType) lines.push(`Project type: ${projectTypeLabel(h.projectType)}`);
  if (h.targetStart) lines.push(`Target start: ${h.targetStart}`);
  for (const d of h.details) lines.push(`${d.label}: ${d.value}`);
  if (h.schedule.length) {
    lines.push("Proposed schedule:");
    for (const p of h.schedule) lines.push(`${p.label} | ${p.start || "TBD"} to ${p.end || p.start || "TBD"} | ${PHASE_STATUSES[p.status]?.label || "Planned"}`);
  }
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

// A short number to say on the phone and print on the page.
export const estimateNumber = (id) => `EST-${String(id || "").replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase()}`;

export const ESTIMATE_TEXT = {
  bad_project_type: "Pick a project type from the list.",
  bad_date: "That date isn't a real day.",
  detail_label_required: "Give each project detail a name.",
  too_many_details: `An estimate holds up to ${MAX_DETAILS} project details.`,
  phase_label_required: "Give each phase of the schedule a name.",
  phase_ends_before_start: "A phase can't end before it starts.",
  too_many_phases: `A schedule holds up to ${MAX_PHASES} phases.`,
  too_many_tasks: `An estimate holds up to ${MAX_TASKS} tasks.`,
  bad_cost: "The cost is a dollar amount, like 12500.",
  logo_not_uploaded: "That logo wasn't uploaded. Choose it again.",
};
