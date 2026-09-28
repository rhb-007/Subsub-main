// Scheduled jobs arriving from somebody else's CRM.
//
// The shape of the loop: a job gets scheduled in JobNimbus (or whatever the
// account runs on), their CRM posts it here, and it lands in SubSub as a job
// with unassigned trade slots -- which is the dashboard's "Unassigned trade
// slots" tile and the thing the account opens SubSub to do. Nothing about
// finding or assigning a contractor happens here: this is the arrival, and a
// person still picks who does the work.
//
// This module is the one place the rules live, because three things have to
// agree about them and they are written by different hands at different
// times: the route that accepts the post, the published documentation, and
// the tests. A field required by the route and optional in the docs is an
// integration that fails at 2am against a page that says it should work.
//
// WHAT IS REQUIRED, and why each one rather than "all of them".
//
// The instinct is to require every column a job has. That is wrong in the
// direction this file already refuses elsewhere: sqft, stories and the
// material supplier are optional on the screen a person uses, and an API
// stricter than the form makes an integration fail over a number no CRM
// holds. Required here means "a job without this cannot do the thing it was
// sent here to do":
//
//   externalId  The CRM's own id for the job. Not for us -- for RETRIES. A
//               webhook that does not get a 200 sends again, and without a
//               key to recognise the second one by, one scheduled job becomes
//               four jobs on somebody's roster and four contractors asked to
//               show up. This is the field nobody asks for and every
//               integration needs, so it is required and it is first.
//   title       The job has to be called something; jobs.title is NOT NULL.
//   trades      What work it is. A job with no trades has no slots, so it
//               arrives and there is nothing to assign -- it would land
//               nowhere and look like the post failed.
//   date        The whole premise is a SCHEDULED job. Without the date it is
//               a lead, and this endpoint is not for leads.
//   where       An address, or a propertyId for an account that runs
//               buildings. A contractor cannot be sent to a job with no
//               location, and discovering that at assignment time means
//               somebody has to go back to the CRM for it.
//
// Everything else a job can carry is accepted and optional.

export const INGEST_VERSION = "v1";

// Named sources, so the ingest path can be reported per CRM and a future one
// can be added without the column meaning something different. `other` is
// deliberate: somebody's in-house system is a real answer and refusing it
// would push them to lie about which CRM they use.
export const SOURCES = ["jobnimbus", "acculynx", "servicetitan", "housecall_pro", "roofsnap", "other"];

export const REQUIRED_FIELDS = ["externalId", "title", "trades", "date"];

// Optional, and listed rather than inferred so the documentation and the
// route cannot drift: a field the route quietly accepts but nothing
// documents is a field that disappears in the next refactor.
export const OPTIONAL_FIELDS = [
  "source", "client", "address", "area", "zip", "propertyId", "time", "scope",
  "sqft", "stories", "materialSource", "materialSupplier", "materialBranch",
  "materialsPaidBy", "notes",
];

// A CRM id is somebody else's string and we store it as given. Bounded
// because it is indexed, and rejected rather than truncated: two jobs whose
// ids differ only past the cut would collapse into one, which is the exact
// failure the id exists to prevent.
export const EXTERNAL_ID_MAX = 200;
export const TITLE_MAX = 200;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const str = (v) => (typeof v === "string" ? v.trim() : "");

// A real calendar day, not just four digits and two dashes. `2026-02-31`
// passes the regex and is not a date, and a job scheduled for it would sit in
// a calendar nobody can reach.
function realDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Errors are per-field and carry a machine-readable code, because the caller
// is a program. "invalid request" tells an integrator to read their whole
// payload again; `{field: "trades", code: "unknown_trade"}` tells them what
// to fix. The message is for the human who ends up reading the log.
const bad = (field, code, message) => ({ field, code, message });

// `tradeIds` is passed in rather than imported so the Worker's list stays the
// single source of truth: a second copy here would be a second opinion about
// what trades exist, and the route would accept what this module refused.
export function validateIngest(body, { tradeIds }) {
  const errors = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: [bad(null, "invalid_body", "The request body must be a JSON object.")] };
  }

  const externalId = str(body.externalId);
  if (!externalId) {
    errors.push(bad("externalId", "required",
      "Your own id for this job, so a retry updates it rather than creating a second one."));
  } else if (externalId.length > EXTERNAL_ID_MAX) {
    errors.push(bad("externalId", "too_long", `externalId must be ${EXTERNAL_ID_MAX} characters or fewer.`));
  }

  const title = str(body.title);
  if (!title) errors.push(bad("title", "required", "A name for the job."));
  else if (title.length > TITLE_MAX) {
    errors.push(bad("title", "too_long", `title must be ${TITLE_MAX} characters or fewer.`));
  }

  let trades = null;
  if (!Array.isArray(body.trades) || body.trades.length === 0) {
    errors.push(bad("trades", "required",
      "At least one trade. This is what becomes the unassigned slots you fill."));
  } else {
    trades = [];
    for (const raw of body.trades) {
      const id = str(raw);
      if (!tradeIds.has(id)) {
        errors.push(bad("trades", "unknown_trade", `"${id}" is not a trade SubSub knows.`));
        trades = null;
        break;
      }
      if (!trades.includes(id)) trades.push(id);
    }
  }

  const date = str(body.date);
  if (!date) errors.push(bad("date", "required", "The scheduled date, as YYYY-MM-DD."));
  else if (!realDate(date)) errors.push(bad("date", "invalid", "date must be a real calendar day, as YYYY-MM-DD."));

  const time = str(body.time);
  if (time && !TIME_RE.test(time)) {
    errors.push(bad("time", "invalid", "time must be 24-hour HH:MM."));
  }

  // One or the other. A propertyId says "a building you already run", an
  // address says "here is where it is" -- and an account with no buildings
  // has only the second.
  const address = str(body.address);
  const propertyId = str(body.propertyId);
  if (!address && !propertyId) {
    errors.push(bad("address", "required",
      "Either address, or propertyId for a building already on your account."));
  }

  const source = str(body.source).toLowerCase();
  if (source && !SOURCES.includes(source)) {
    errors.push(bad("source", "unknown_source", `source must be one of: ${SOURCES.join(", ")}.`));
  }

  const num = (v, field, max) => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > max) {
      errors.push(bad(field, "invalid", `${field} must be a number between 0 and ${max}.`));
      return null;
    }
    return Math.round(n);
  };
  const sqft = num(body.sqft, "sqft", 10_000_000);
  const stories = num(body.stories, "stories", 200);

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    job: {
      externalId, title, trades, date,
      source: source || "other",
      time: time || "07:00",
      address: address || null,
      propertyId: propertyId || null,
      client: str(body.client) || null,
      area: str(body.area) || null,
      zip: str(body.zip) || null,
      scope: str(body.scope) || null,
      notes: str(body.notes) || null,
      materialsPaidBy: str(body.materialsPaidBy) || null,
      materialSource: str(body.materialSource) || null,
      materialSupplier: str(body.materialSupplier) || null,
      materialBranch: str(body.materialBranch) || null,
      sqft, stories,
    },
  };
}
