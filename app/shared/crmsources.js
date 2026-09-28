// Adding a CRM should be a row, not a release.
//
// The JobNimbus receiver was written by hand, and it had to be: their webhook
// cannot set a header, their field names are their own, and they have no
// concept of a trade. But writing the next four that way costs four builds,
// four test suites and four sets of quirks discovered by hitting them -- and
// two of JobNimbus's three quirks were only found because a test failed.
//
// So the translation is DATA. A source is a preset: where the record sits in
// the payload, which of their fields is which of ours, and how their dates
// are written. `/api/v1/hooks/:source/:token` reads the preset and does the
// rest, so a new CRM is an entry in SOURCE_PRESETS with a fixture beside it.
//
// WHAT IS DELIBERATELY NOT HERE, and it is the same rule the licensing
// dataset runs on: **no preset for a CRM whose real payload nobody has
// seen.** Inventing plausible field names for AccuLynx would produce an
// integration that looks supported, fails on first contact, and fails in the
// way that is hardest to debug -- silently, against documentation that says
// it should work. A preset is written when somebody has a payload in front of
// them, and `verified` records which ones that is true of.

// Reading `customer.name` out of a nested payload. CRMs nest differently and
// several wrap the record one level down; a path beats a special case per
// source.
export function atPath(obj, path) {
  if (!path) return undefined;
  let cur = obj;
  for (const key of String(path).split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

const str = (v) => (v == null ? "" : String(v).trim());

// Dates, by how the source writes them.
//
// `epoch_s` is the one that bites: read as milliseconds it lands in 1970 and
// the job sits in a calendar nobody will scroll to. That is not hypothetical
// -- it is JobNimbus, and it cost a failing test to find.
export function toDate(v, format) {
  if (v == null || v === "") return null;
  if (format === "epoch_s" || format === "epoch_ms") {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    const d = new Date(format === "epoch_s" ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = str(v);
  if (format === "us") {
    // 3/14/2026 and 03/14/2026. Ambiguous with day-first, which is why it is
    // named per source rather than sniffed: guessing wrong puts a crew on
    // site nine months early and nothing looks wrong until they arrive.
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (!m) return null;
    const [, mo, da, yr] = m;
    return realDay(Number(yr), Number(mo), Number(da));
  }
  // ISO, or anything starting with one.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? realDay(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

// Four digits and two slashes is not a date. `14/03/2026` read month-first is
// month fourteen, and passing it through produces `2026-14-03` -- a string
// that looks like a date, sorts like one, and puts a job in a calendar nobody
// can reach. Refusing it is how a day-first source announces itself as
// misconfigured instead of silently booking work nine months out.
function realDay(y, m, d) {
  if (!(y >= 1970 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Each of our fields, and how to get it. `from` is a list because CRMs put the
// same fact in different places depending on which screen created the record,
// and the first one that answers wins.
//
// `join` builds one value out of several (a first and last name); `street`
// is the one special case, and it exists because of a real bug: an address
// line 2 with no line 1 is "Unit B", which satisfies a has-a-location check
// with nowhere a contractor can be sent.
function pick(p, spec) {
  if (!spec) return "";
  if (typeof spec === "string") return str(atPath(p, spec));
  if (Array.isArray(spec)) {
    for (const one of spec) {
      const v = pick(p, one);
      if (v) return v;
    }
    return "";
  }
  if (spec.join) return spec.join.map((k) => str(atPath(p, k))).filter(Boolean).join(spec.sep || " ");
  if (spec.street) {
    const [firstKey, ...rest] = spec.street;
    const line1 = str(atPath(p, firstKey));
    if (!line1) return "";
    return [line1, ...rest.map((k) => str(atPath(p, k))).filter(Boolean)].join(", ");
  }
  return "";
}

// The record itself. Several CRMs wrap it — `{event, data}` — and some send it
// bare, so the preset names the candidates and a bare object is the fallback.
export function unwrap(body, preset) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  for (const key of preset?.wrap || []) {
    const inner = atPath(body, key);
    if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner;
  }
  return body;
}

// The whole translation, driven by the preset.
//
// Returns our shape plus `missing` — the THEIR-side names of anything we
// cannot do without, because an integrator reading an error needs the field
// they know about, not ours. Trades are deliberately absent from `missing`:
// an unmapped job still arrives, which is the rule the whole receiver is
// written around.
export function translate(record, preset) {
  const f = preset.fields;
  const title = pick(record, f.title).slice(0, 200) || preset.titleFallback || "Job";
  const out = {
    externalId: pick(record, f.externalId),
    title,
    date: pickDate(record, f.date, preset.dateFormat),
    address: pick(record, f.address) || null,
    area: pick(record, f.area) || null,
    zip: pick(record, f.zip) || null,
    client: pick(record, f.client) || null,
    scope: pick(record, f.scope) || null,
  };
  const missing = [];
  if (!out.externalId) missing.push(theirName(f.externalId));
  if (!out.date) missing.push(theirName(f.date));
  if (!out.address && !out.area) missing.push(theirName(f.address));
  return { job: out, missing };
}

// Dates get the same first-one-that-answers treatment as everything else: a
// scheduled date, falling back to a created date, is better than refusing a
// job over which column the CRM happened to fill in.
function pickDate(record, spec, format) {
  for (const key of Array.isArray(spec) ? spec : [spec]) {
    const d = toDate(atPath(record, key), format);
    if (d) return d;
  }
  return null;
}

// What to call the field in an error, in THEIR vocabulary.
function theirName(spec) {
  const k = Array.isArray(spec) ? spec[0] : spec;
  if (typeof k === "string") return k;
  if (k?.street) return k.street[0];
  if (k?.join) return k.join[0];
  return "field";
}

export const SOURCE_PRESETS = {
  // Verified against JobNimbus's documented job webhook fields.
  jobnimbus: {
    label: "JobNimbus",
    verified: true,
    wrap: ["data", "payload"],
    dateFormat: "epoch_s",
    titleFallback: "Job from JobNimbus",
    fields: {
      externalId: ["jnid", "number", "external_id"],
      // A JobNimbus job is often named only by its customer, so the display
      // name is the fallback rather than a generated string -- "Job 1041"
      // tells somebody less than "M. Okafor" does.
      title: ["name", "display_name", { join: ["first_name", "last_name"] }, "number"],
      date: ["date_start", "date_created"],
      address: [{ street: ["address_line1", "address_line2"] }],
      area: "city",
      zip: "zip",
      client: ["display_name", { join: ["first_name", "last_name"] }],
      scope: "description",
    },
  },

  // Our own field names, over a path token. For anything that can POST JSON
  // but cannot set an Authorization header -- which is most automation
  // builders' webhook step, and any in-house script.
  generic: {
    label: "Your own system",
    verified: true,
    wrap: ["data", "job", "payload"],
    dateFormat: "iso",
    titleFallback: "Job",
    fields: {
      externalId: ["externalId", "external_id", "id"],
      title: ["title", "name"],
      date: ["date", "scheduledDate", "scheduled_date"],
      address: ["address", { street: ["address_line1", "address_line2"] }],
      area: ["area", "city"],
      zip: ["zip", "postalCode", "postal_code"],
      client: ["client", "customer", "customerName"],
      scope: ["scope", "description", "notes"],
    },
  },
};

export const isSource = (s) => Object.prototype.hasOwnProperty.call(SOURCE_PRESETS, String(s || ""));
