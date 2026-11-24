// Sales appointments: a homeowner booked for an estimate, before anything is
// a job. Migration 105.
//
// A call-center seat (role `callcenter`) takes the call, inbound or outbound,
// and walks a script: which replacement the homeowner is considering, the
// questions that matter for each, who they are and who else decides, and when
// the sales manager can come out. Closing the sale happens on site, so what is
// booked here is NOT a job: no trade slot, no work order, nothing a contractor
// can see. An admin or project manager moves it through the sales outcome and,
// once sold, turns it into a job, which is then assigned like any other.
//
// The route, the screen and the tests all read this module, so the script, the
// rules for a complete booking and the outcome states cannot disagree.

// The four replacements the call flow starts from. `trade` is the SubSub trade
// a sold appointment becomes, so converting one is a lookup rather than a guess.
export const SERVICES = [
  { id: "roofing", label: "Roof replacement", trade: "roofing" },
  { id: "siding", label: "Siding replacement", trade: "siding" },
  { id: "windows", label: "Window replacement", trade: "windows_doors" },
  { id: "gutters", label: "Gutter replacement", trade: "gutters" },
];
export const SERVICE_IDS = SERVICES.map((s) => s.id);
export const serviceLabel = (id) => SERVICES.find((s) => s.id === id)?.label || id;
export const serviceTrade = (id) => SERVICES.find((s) => s.id === id)?.trade || null;

const STORIES = ["1", "2", "3+"];
const AGE = ["Under 10 years", "10-20 years", "Over 20 years", "Not sure"];
const YN = ["Yes", "No", "Not sure"];

// What to ask about each replacement. A question is {id, label, type, options,
// required}. `choice` is one answer, `multi` any number, `number` a count, and
// `text` a short answer. Required ones are the facts a sales manager needs
// before driving out; everything else is nice to know and never blocks a
// booking, because a call center that cannot book without an answer the
// homeowner does not have loses the appointment.
export const SERVICE_QUESTIONS = {
  roofing: [
    { id: "material", label: "What is on the roof now?", type: "choice", required: true,
      options: ["Asphalt shingle", "Metal", "Tile", "Cedar shake", "Flat / low slope", "Not sure"] },
    { id: "age", label: "How old is the roof?", type: "choice", required: true, options: AGE },
    { id: "leaks", label: "Any leaks or water spots inside?", type: "choice", required: true, options: YN },
    { id: "stories", label: "How many stories is the home?", type: "choice", required: true, options: STORIES },
    { id: "storm", label: "Is this storm or insurance-related damage?", type: "choice", options: YN },
    { id: "wanted", label: "Material they are interested in", type: "choice",
      options: ["Asphalt shingle", "Metal", "Tile", "Undecided"] },
  ],
  siding: [
    { id: "material", label: "What siding is on the home now?", type: "choice", required: true,
      options: ["Vinyl", "Wood", "Fiber cement", "Aluminum", "Stucco", "Brick", "Not sure"] },
    { id: "scope", label: "Whole home or part of it?", type: "choice", required: true,
      options: ["Whole home", "One or two sides", "Repair only", "Not sure"] },
    { id: "issues", label: "What problems are they seeing?", type: "multi",
      options: ["Rot", "Cracking", "Warping", "Fading", "Pest damage", "Just dated"] },
    { id: "stories", label: "How many stories is the home?", type: "choice", required: true, options: STORIES },
    { id: "wanted", label: "Material they are interested in", type: "choice",
      options: ["Vinyl", "Fiber cement", "Wood", "Undecided"] },
  ],
  windows: [
    { id: "count", label: "About how many windows?", type: "number", required: true },
    { id: "frame", label: "What are the frames now?", type: "choice", required: true,
      options: ["Wood", "Vinyl", "Aluminum", "Mixed", "Not sure"] },
    { id: "issues", label: "What problems are they seeing?", type: "multi",
      options: ["Drafts", "Fogging between panes", "Hard to open or close", "Rot", "Noise", "Energy bills"] },
    { id: "doors", label: "Any patio or sliding doors too?", type: "choice", options: YN },
    { id: "age", label: "How old are the windows?", type: "choice", options: AGE },
  ],
  gutters: [
    { id: "scope", label: "Whole home or part of it?", type: "choice", required: true,
      options: ["Whole home", "Part of the home", "Not sure"] },
    { id: "material", label: "What gutters are on the home now?", type: "choice",
      options: ["Aluminum", "Vinyl", "Steel", "Copper", "None", "Not sure"] },
    { id: "issues", label: "What problems are they seeing?", type: "multi",
      options: ["Overflowing", "Leaking seams", "Sagging", "Pulling away", "Clogging"] },
    { id: "guards", label: "Interested in gutter guards?", type: "choice", options: YN },
    { id: "stories", label: "How many stories is the home?", type: "choice", required: true, options: STORIES },
  ],
};

// Asked once, whatever the services. `owns` is the gate every home-improvement
// sales team asks first: a renter cannot buy a roof.
export const HOME_QUESTIONS = [
  { id: "owns", label: "Do they own the home?", type: "choice", required: true, options: ["Yes", "No"] },
  { id: "yearBuilt", label: "About what year was the home built?", type: "number" },
  { id: "hoa", label: "Is the home in an HOA?", type: "choice", options: YN },
  { id: "timeline", label: "When are they hoping to do the work?", type: "choice", required: true,
    options: ["As soon as possible", "Within 3 months", "3 to 6 months", "Just researching"] },
  { id: "financing", label: "Interested in financing?", type: "choice", options: YN },
];

export const SOURCES = ["Referral", "Website", "Google", "Facebook / Instagram", "Yard sign",
  "Door knocking", "Mailer", "Home show", "Repeat customer", "Other"];

export const DIRECTIONS = ["inbound", "outbound"];

// Where an appointment is in the sales process. The call center books and may
// confirm, reschedule or cancel; the outcome (sat, sold, lost, no show) is the
// sales side's to record. `converted` is set when the sold appointment has
// become a job and is never written by a status change.
export const STATUSES = {
  scheduled: { label: "Scheduled", open: true },
  confirmed: { label: "Confirmed", open: true },
  sat: { label: "Ran, no decision yet", open: true },
  sold: { label: "Sold", open: false },
  lost: { label: "Not sold", open: false },
  no_show: { label: "No show", open: false },
  cancelled: { label: "Canceled", open: false },
};
export const STATUS_IDS = Object.keys(STATUSES);
// What a call-center seat may set. The outcome of the visit is not theirs.
export const CALLCENTER_STATUSES = ["scheduled", "confirmed", "cancelled"];

export const DEFAULT_MINUTES = 90;

// The roles that book and the roles that run the outcome.
export const BOOKING_ROLES = ["admin", "pm", "callcenter"];
export const SALES_ROLES = ["admin", "pm"];

// The account kinds that sell replacements to homeowners. A property manager
// hires contractors for their own buildings and has no homeowner to call, so a
// call-center seat and the appointments screen are offered only here.
export const APPOINTMENT_KINDS = ["general_contractor", "subcontractor"];
export const takesAppointments = (kind) => APPOINTMENT_KINDS.includes(kind);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const digits = (v) => String(v ?? "").replace(/\D/g, "");
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);

function cleanAnswer(q, v) {
  if (v == null || v === "") return null;
  if (q.type === "choice") return q.options.includes(v) ? v : undefined;
  if (q.type === "multi") {
    if (!Array.isArray(v)) return undefined;
    const kept = [...new Set(v.filter((x) => q.options.includes(x)))];
    return kept.length === v.length ? (kept.length ? kept : null) : undefined;
  }
  if (q.type === "number") {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 10000 ? n : undefined;
  }
  return str(v, 300) || null;
}

function cleanAnswers(questions, given, missing, where) {
  const out = {};
  const src = given && typeof given === "object" ? given : {};
  for (const q of questions) {
    const v = cleanAnswer(q, src[q.id]);
    if (v === undefined) return { error: "bad_answer", field: `${where}.${q.id}` };
    if (v !== null) out[q.id] = v;
    else if (q.required) missing.push(`${where}.${q.id}`);
  }
  return { value: out };
}

const cleanPerson = (p) => {
  const o = p && typeof p === "object" ? p : {};
  return {
    firstName: str(o.firstName, 80), lastName: str(o.lastName, 80),
    phone: digits(o.phone).slice(-10), email: str(o.email, 200).toLowerCase(),
  };
};

// The whole booking, checked. Returns {ok:true, value, missing:[]} or
// {ok:false, error, field}. `missing` lists required answers left blank; a
// booking with any is refused as `incomplete`, naming the first, because the
// screen walks the same list and should never have offered Book with one.
export function validAppointment(b) {
  const body = b && typeof b === "object" ? b : {};
  const missing = [];
  const direction = DIRECTIONS.includes(body.direction) ? body.direction : null;
  if (!direction) return { ok: false, error: "bad_direction", field: "direction" };
  const services = Array.isArray(body.services) ? [...new Set(body.services)] : [];
  if (!services.length) return { ok: false, error: "services_required", field: "services" };
  if (services.some((s) => !SERVICE_IDS.includes(s))) return { ok: false, error: "bad_service", field: "services" };

  const details = {};
  for (const s of services) {
    const r = cleanAnswers(SERVICE_QUESTIONS[s], body.details?.[s], missing, s);
    if (r.error) return { ok: false, ...r };
    details[s] = r.value;
  }
  const home = cleanAnswers(HOME_QUESTIONS, body.home, missing, "home");
  if (home.error) return { ok: false, ...home };

  const homeowner = cleanPerson(body.homeowner);
  if (!homeowner.firstName) missing.push("homeowner.firstName");
  if (!homeowner.lastName) missing.push("homeowner.lastName");
  if (homeowner.phone.length !== 10) missing.push("homeowner.phone");
  if (homeowner.email && !EMAIL_RE.test(homeowner.email)) return { ok: false, error: "bad_email", field: "homeowner.email" };

  const a = body.address && typeof body.address === "object" ? body.address : {};
  const address = { street: str(a.street, 200), city: str(a.city, 100),
    state: str(a.state, 2).toUpperCase(), zip: digits(a.zip).slice(0, 5) };
  if (!address.street) missing.push("address.street");
  if (!address.city) missing.push("address.city");
  if (!/^[A-Z]{2}$/.test(address.state)) missing.push("address.state");
  if (address.zip.length !== 5) missing.push("address.zip");

  // The second person who decides. Optional as a whole -- a homeowner who
  // decides alone says so -- but a name given needs a relationship, and
  // `attends` is asked whenever there is somebody, because both decision
  // makers present is the single biggest predictor of a sale on the day.
  const s2 = body.second && typeof body.second === "object" ? body.second : null;
  let second = null;
  if (s2 && (str(s2.firstName) || str(s2.lastName) || digits(s2.phone))) {
    second = { ...cleanPerson(s2), relationship: str(s2.relationship, 60),
      attends: s2.attends === true ? true : s2.attends === false ? false : null };
    if (!second.firstName) missing.push("second.firstName");
    if (!second.relationship) missing.push("second.relationship");
    if (second.attends === null) missing.push("second.attends");
    if (second.phone && second.phone.length !== 10) return { ok: false, error: "bad_phone", field: "second.phone" };
    if (second.email && !EMAIL_RE.test(second.email)) return { ok: false, error: "bad_email", field: "second.email" };
  }
  const soleDecider = !second;

  const date = DATE_RE.test(body.date || "") ? body.date : null;
  const time = TIME_RE.test(body.time || "") ? body.time : null;
  if (!date) missing.push("date");
  if (!time) missing.push("time");
  const minutes = Number(body.minutes || DEFAULT_MINUTES);
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 480) return { ok: false, error: "bad_minutes", field: "minutes" };

  if (missing.length) return { ok: false, error: "incomplete", field: missing[0], missing };
  return {
    ok: true,
    missing: [],
    value: {
      direction, source: SOURCES.includes(body.source) ? body.source : null,
      services, details, home: home.value, homeowner, address, second, soleDecider,
      date, time, minutes, repId: str(body.repId, 80) || null, notes: str(body.notes, 2000) || null,
    },
  };
}

// The minutes since midnight a "HH:MM" names.
const mins = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };

// Appointments on the same rep and day whose windows overlap this one. The
// screen warns and the route refuses (`rep_double_booked`) unless the booker
// says to book anyway, because a sales manager can sometimes run two back to
// back and the call center does not always know.
export function repClashes(rows, { repId, date, time, minutes, exceptId = null }) {
  if (!repId || !date || !time) return [];
  const start = mins(time), end = start + (minutes || DEFAULT_MINUTES);
  return (rows || []).filter((r) => r.id !== exceptId && r.repId === repId && r.date === date
    && STATUSES[r.status]?.open
    && mins(r.time) < end && mins(r.time) + (r.minutes || DEFAULT_MINUTES) > start);
}

// What a sold appointment becomes on the job form: a lookup, never a guess.
export function jobSeedFromAppointment(a) {
  const name = [a.homeowner?.firstName, a.homeowner?.lastName].filter(Boolean).join(" ");
  const services = (a.services || []).map(serviceLabel);
  const lines = [];
  for (const s of a.services || []) {
    const qs = SERVICE_QUESTIONS[s] || [];
    const parts = qs.filter((q) => a.details?.[s]?.[q.id] != null)
      .map((q) => `${q.label.replace(/\?$/, "")}: ${[].concat(a.details[s][q.id]).join(", ")}`);
    lines.push(`${serviceLabel(s)}${parts.length ? ` — ${parts.join("; ")}` : ""}`);
  }
  return {
    title: `${services.join(" + ")}${name ? ` — ${name}` : ""}`,
    trades: [...new Set((a.services || []).map(serviceTrade).filter(Boolean))],
    address: [a.address?.street, a.address?.city, a.address?.state].filter(Boolean).join(", "),
    area: a.address?.city || "",
    zip: a.address?.zip || "",
    client: name,
    scope: [`From the sales appointment on ${a.date}.`, ...lines, a.notes ? `Notes: ${a.notes}` : ""]
      .filter(Boolean).join("\n"),
  };
}

// The short line a list row reads: who, which work, where.
export function appointmentSummary(a) {
  const who = [a.homeowner?.firstName, a.homeowner?.lastName].filter(Boolean).join(" ") || "Homeowner";
  return `${who} · ${(a.services || []).map(serviceLabel).join(", ")} · ${a.address?.city || ""}`.replace(/ · $/, "");
}

// "Tuesday, December 2 at 10:00 AM", from the stored date and wall-clock time.
// Read at noon UTC, so no timezone can move the date under it.
export function apptWhenText(date, time) {
  if (!date) return "";
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  if (!time) return day;
  const [h, m] = time.split(":").map(Number);
  const t = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return `${day} at ${t}`;
}
