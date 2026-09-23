// Booking a demo, for real.
//
// The page at book-a-demo.html had a working month grid, a slot picker, a
// two-step form and a confirmation screen reading "You're booked. We've sent
// a calendar invite to you@company.com." It sent nothing. No request, no
// form action, not even a mailto -- the submit handler swapped two divs and
// stopped. Every person who used it believed a meeting existed.
//
// That is the thing being fixed. Everything below is in service of one rule:
// the confirmation screen appears if and only if a booking was created.
//
// ---------------------------------------------------------------------
// A note on the Cal API version, and on honesty about what is verified.
//
// Cal's v2 API is versioned per endpoint through a `cal-api-version` header,
// and the two used here were written from documentation rather than against
// a live key -- there was none when this was built, and this sandbox cannot
// reach cal.com. The shapes are handled defensively for that reason: the
// slot parser accepts either of the two documented arrangements, and
// anything unrecognised is logged in full here and reported to the browser
// as "we could not load times" rather than guessed at.
//
// `npm run cal:check` takes a real key and prints what each endpoint
// actually returns against what this file expects. Run it once when the key
// exists. It is a five-second confirmation, and it is the difference between
// believing this works and knowing it.
// ---------------------------------------------------------------------

// Overridable for local work, the same way RESEND_API_BASE and
// TWILIO_API_BASE are: the tests stand a stub in front of it rather than
// mocking fetch, so what is exercised is the real request this file builds.
const calBase = (env) => env.CAL_API_BASE || "https://api.cal.com/v2";
const SLOTS_VERSION = "2024-09-04";
const BOOKINGS_VERSION = "2024-08-13";
export const CAL_VERSIONS = { slots: SLOTS_VERSION, bookings: BOOKINGS_VERSION };

export const calConfigured = (env) => !!(env.CAL_API_KEY && env.CAL_EVENT_TYPE_ID);

async function callCal(env, path, { method = "GET", version, body } = {}) {
  const res = await fetch(`${calBase(env)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.CAL_API_KEY}`,
      "cal-api-version": version,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON; `text` is the record */ }
  return { ok: res.ok, status: res.status, data, text };
}

// Cal has described the slots payload two ways across versions: keyed by
// date, and as one flat list. Both are read here rather than betting on
// which one a given deployment answers with -- the cost is six lines, and
// the cost of being wrong is a booking page that shows no times at all.
export function parseSlots(data) {
  const body = data?.data ?? data;
  if (!body) return null;
  const out = {};
  const add = (iso) => {
    const day = String(iso).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    (out[day] ||= []).push(iso);
  };
  if (Array.isArray(body)) {
    body.forEach((s) => add(typeof s === "string" ? s : s?.start ?? s?.time));
  } else if (typeof body === "object") {
    Object.entries(body).forEach(([day, list]) => {
      if (!Array.isArray(list)) return;
      list.forEach((s) => add(typeof s === "string" ? s : s?.start ?? s?.time ?? day));
    });
  } else {
    return null;
  }
  Object.values(out).forEach((l) => l.sort());
  return out;
}

export async function fetchSlots(env, { start, end, timeZone }) {
  const q = new URLSearchParams({
    eventTypeId: String(env.CAL_EVENT_TYPE_ID), start, end, timeZone,
  });
  const r = await callCal(env, `/slots?${q}`, { version: SLOTS_VERSION });
  if (!r.ok) {
    console.error("[demo] Cal refused the slots request:", r.status, r.text.slice(0, 400));
    return { ok: false, reason: "upstream" };
  }
  const slots = parseSlots(r.data);
  if (!slots) {
    // Logged whole, because this is the case the version note above is
    // about, and a shape nobody expected is not something to paper over.
    console.error("[demo] Cal answered with a slots shape this does not know:", r.text.slice(0, 600));
    return { ok: false, reason: "shape" };
  }
  return { ok: true, slots };
}

export async function createBooking(env, { start, name, email, timeZone, company, phone, role, subs, notes }) {
  const r = await callCal(env, "/bookings", {
    method: "POST",
    version: BOOKINGS_VERSION,
    body: {
      start,
      eventTypeId: Number(env.CAL_EVENT_TYPE_ID),
      attendee: { name, email, timeZone, language: "en" },
      // Everything the form asks for travels with the booking, so whoever
      // takes the call has it in front of them instead of in a second system.
      metadata: {
        company: company || "", phone: phone || "", role: role || "",
        subcontractors: subs || "", source: "book-a-demo",
      },
      ...(notes ? { bookingFieldsResponses: { notes } } : {}),
    },
  });
  if (!r.ok) {
    console.error("[demo] Cal refused the booking:", r.status, r.text.slice(0, 400));
    // The one refusal worth telling apart: somebody else took the slot while
    // this person was filling the form in. "Try again" is wrong advice for
    // that; "pick another time" is right.
    const taken = r.status === 409 || /no_available_users|already booked|not available/i.test(r.text);
    return { ok: false, reason: taken ? "taken" : "upstream" };
  }
  const uid = r.data?.data?.uid || r.data?.uid || null;
  return { ok: true, uid };
}
