// GOOGLE CALENDAR: what SubSub puts on somebody's calendar, and when their
// calendar says they cannot be booked.
//
// Every field name here is from Google's own discovery document for Calendar
// API v3 (https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest), read
// from this environment the day this was written -- the developer site is
// blocked here, the discovery document is not, and it is the source the
// developer site is generated from.
//
// The rules live here so the Worker, the screen and the tests describe one
// thing. Talking to Google is worker/gcal.js.

// THE NARROWEST TWO SCOPES THAT DO THE JOB. `calendar.app.created` lets SubSub
// make one calendar of its own and write to that calendar only -- never to an
// event somebody made themselves. `calendar.freebusy` answers "busy from 9 to
// 11" and nothing else: no titles, no attendees, no places. `openid email` is
// how the panel can say which Google account is connected.
export const GCAL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.freebusy",
];
// The two that matter. A person can untick either on Google's consent screen,
// and a connection missing one would push nothing or block nothing while the
// panel said it was connected.
export const GCAL_REQUIRED_SCOPES = GCAL_SCOPES.slice(2);

export const GCAL_CALENDAR_NAME = "SubSub Jobs";
export const GCAL_SUMMARY_PREFIX = "SubSub Job";

// How far back and ahead a calendar is kept in step. Back a week so a job
// that just happened does not vanish from the day it happened on; ahead four
// months because nobody books further than that.
export const GCAL_PAST_DAYS = 7;
export const GCAL_AHEAD_DAYS = 120;
// How far ahead the auto-scheduler reads somebody's busy times.
export const GCAL_BUSY_DAYS = 90;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// A time zone Intl knows, or null. Taken from the browser at connect, because
// a visit is a wall-clock time with no zone of its own and the person's own
// zone is the one their calendar shows it in.
export function validTimeZone(tz) {
  const s = String(tz || "").trim();
  if (!s || s.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s }).format(0);
    return s;
  } catch { return null; }
}

// The offset of `tz` from UTC at instant `ms`, in minutes.
function offsetAt(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return (asUtc - Math.floor(ms / 1000) * 1000) / 60000;
}

// A wall-clock date and time in `tz`, as epoch milliseconds. Two passes,
// because the offset that applies is the offset AT the answer, and a
// daylight-saving change between the guess and the answer moves it by an hour.
export function wallToUtc(dayKey, hhmm, tz) {
  if (!DAY_RE.test(String(dayKey || ""))) return null;
  const [h, m] = TIME_RE.test(String(hhmm || "")) ? hhmm.split(":").map(Number) : [0, 0];
  const [y, mo, d] = dayKey.split("-").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, m);
  const zone = validTimeZone(tz) || "UTC";
  let ms = naive - offsetAt(naive, zone) * 60000;
  ms = naive - offsetAt(ms, zone) * 60000;
  return ms;
}

const addDays = (k, n) => {
  const d = new Date(`${k}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// THE EVENT FOR ONE VISIT. A proposed time is on the calendar too -- somebody
// has to know Tuesday was asked for -- but it says so in its title and is
// TRANSPARENT, so it does not show them busy for a time nobody has agreed.
// A visit with no time on it is an all-day event on its day.
//
// Deliberately carried: the job's title, the trade, the address and who it is
// for. Deliberately not: anybody's phone number, the tenant's name, the price.
// A calendar is shared with a spouse, a dispatcher and an assistant far more
// often than a SubSub login is, so it carries what the work IS and not who
// the people are -- that is one tap away in SubSub.
export function eventFor(item, tz) {
  const zone = validTimeZone(tz) || "UTC";
  const proposed = item.status !== "confirmed";
  const summary = `${GCAL_SUMMARY_PREFIX}: ${String(item.title || "Job").slice(0, 160)}`
    + (proposed ? " (proposed)" : "");
  const lines = [];
  if (item.trades?.length) lines.push(`Trade: ${item.trades.join(", ")}`);
  if (item.client) lines.push(`For: ${item.client}`);
  lines.push(proposed
    ? "Proposed time -- not confirmed yet. Answer it in SubSub."
    : "Confirmed in SubSub.");
  if (item.link) lines.push(item.link);
  lines.push("Added by SubSub. Changes made here are replaced the next time SubSub syncs.");
  const timed = TIME_RE.test(String(item.start || ""));
  const start = timed
    ? { dateTime: `${item.date}T${item.start}:00`, timeZone: zone }
    : { date: item.date };
  const endTime = TIME_RE.test(String(item.end || "")) && item.end > item.start ? item.end : null;
  const end = timed
    ? { dateTime: `${item.date}T${endTime || plusHour(item.start)}:00`, timeZone: zone }
    : { date: addDays(item.date, 1) };
  const ev = {
    summary,
    description: lines.join("\n"),
    start, end,
    transparency: proposed ? "transparent" : "opaque",
    extendedProperties: { private: { subsubVisit: String(item.visitId) } },
  };
  if (item.address) ev.location = String(item.address).slice(0, 300);
  return ev;
}

function plusHour(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(h * 60 + m + 60, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// What decides whether an event needs writing again. Key order is fixed by
// construction in `eventFor`, so the same visit always gives the same string.
export function eventFingerprint(ev) {
  const s = JSON.stringify(ev);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Is [startMs, endMs) inside any of one person's busy periods?
export function busyDuring(periods, startMs, endMs) {
  return (periods || []).some((p) => {
    const a = Date.parse(p?.start); const b = Date.parse(p?.end);
    return Number.isFinite(a) && Number.isFinite(b) && a < endMs && b > startMs;
  });
}

// A COMPANY IS BUSY ONLY WHEN EVERYBODY CONNECTED THERE IS. The same rule
// `offDays` runs on for crews: one crew on holiday is not the company on
// holiday, and one person's dentist appointment is not the company booked.
// For the one-person handyman, which is most of them, it is the same answer.
//
// `people` is [{tz, busy: [{start, end}]}] -- only the people whose calendar
// could be read. Nobody readable answers false: a Google outage, or nobody
// having connected, must never stop a job being scheduled.
export function companyBusyAt(people, dayKey, start, end) {
  if (!people?.length) return false;
  return people.every((p) => {
    const s = wallToUtc(dayKey, TIME_RE.test(String(start || "")) ? start : "00:00", p.tz);
    const e = TIME_RE.test(String(end || "")) && end > (start || "")
      ? wallToUtc(dayKey, end, p.tz)
      : TIME_RE.test(String(start || "")) ? s + 3600000 : wallToUtc(addDays(dayKey, 1), "00:00", p.tz);
    return busyDuring(p.busy, s, e);
  });
}

// A JOB THAT TAKES SEVERAL DAYS IS CHECKED ON EVERY ONE OF THEM. Checking
// only the first day books a crew on day three of a roof straight over the
// appointment their calendar already shows -- over-booking them, which is the
// one thing this check exists to stop. On a multi-day job the crew is on site
// for the working day, not only for the arrival window, so day one is checked
// from the proposed start to the end of the working day and every later day
// for the whole working day. A single day is exactly the window, as before.
export const WORK_DAY_START = "08:00";
export const WORK_DAY_END = "17:00";

// The first day of `dates` it clashes on, or null. `dates` is the job's
// working days in order (spanDates), the first being the visit's own day.
export function companyBusyOnSpan(people, dates, { start, end } = {}) {
  const list = (dates || []).filter((d) => DAY_RE.test(String(d)));
  if (!people?.length || !list.length) return null;
  if (list.length === 1) return companyBusyAt(people, list[0], start, end) ? list[0] : null;
  for (let i = 0; i < list.length; i += 1) {
    const from = i === 0 && TIME_RE.test(String(start || "")) ? start : WORK_DAY_START;
    const to = i === 0 && TIME_RE.test(String(end || "")) && end > WORK_DAY_END ? end : WORK_DAY_END;
    if (companyBusyAt(people, list[i], from, to)) return list[i];
  }
  return null;
}

// The days in [from, from + days) a window from `start` to `end` cannot go,
// for the auto-scheduler's list of busy days.
export function companyBusyDays(people, { from, days = GCAL_BUSY_DAYS, start, end }) {
  if (!people?.length || !DAY_RE.test(String(from || ""))) return [];
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const k = addDays(from, i);
    if (companyBusyAt(people, k, start, end)) out.push(k);
  }
  return out;
}

// Did Google give us both scopes we asked for? The token reply lists what
// was actually granted, space-separated.
export function scopesGranted(scopeText) {
  const got = new Set(String(scopeText || "").split(/\s+/).filter(Boolean));
  return GCAL_REQUIRED_SCOPES.every((s) => got.has(s));
}

// Where Google may send somebody back to. SubSub's own addresses only: an
// emailed or pasted link plus an unchecked return address is an open redirect.
export function gcalReturnTo(url) {
  const m = /^(https:\/\/(?:[a-z0-9-]+\.)*subsub\.work)(\/[^?#]*)?(?:[?#].*)?$/i.exec(String(url || ""));
  return m ? `${m[1]}${m[2] || "/"}` : null;
}

// The words a connection's state comes back to the screen as.
export const GCAL_RETURN = {
  connected: "Google Calendar is connected. Your SubSub jobs will appear on a calendar called SubSub Jobs.",
  denied: "Google Calendar was not connected. You can try again whenever you like.",
  missing_scope: "Google Calendar needs both permissions ticked: making the SubSub Jobs calendar and seeing when you're busy. Try again and leave both ticked.",
  no_refresh: "Google didn't give SubSub lasting access. Remove SubSub from your Google account's third-party access, then connect again.",
  expired: "That took too long, so the link expired. Press Connect again.",
  failed: "Google Calendar could not be connected just now. Try again in a minute.",
  not_configured: "Google Calendar isn't set up on SubSub yet.",
};
