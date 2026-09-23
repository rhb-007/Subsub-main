// Does Cal actually answer the way worker/demo.js expects?
//
// That file was written from documentation, not against a live key -- there
// was none when it was built, and the sandbox it was built in cannot reach
// cal.com. Two things are therefore assumed rather than known: the
// cal-api-version each endpoint wants, and the shape of what comes back.
//
// This asks. It makes one real slots request and, only if you pass --book,
// one real booking, and prints what arrived against what demo.js expects.
// Five seconds, once, and the difference between believing this works and
// knowing it.
//
//   CAL_API_KEY=cal_live_... CAL_EVENT_TYPE_ID=123 node scripts/cal-check.mjs
//   CAL_API_KEY=... CAL_EVENT_TYPE_ID=... node scripts/cal-check.mjs --book you@example.com
//
// The key is read from the environment and never printed.

import { parseSlots, CAL_VERSIONS } from "../worker/demo.js";

const KEY = process.env.CAL_API_KEY;
const EVENT = process.env.CAL_EVENT_TYPE_ID;
const BASE = process.env.CAL_API_BASE || "https://api.cal.com/v2";
const TZ = process.env.CAL_TZ || "America/Los_Angeles";

if (!KEY || !EVENT) {
  console.error("Set CAL_API_KEY and CAL_EVENT_TYPE_ID first. Neither is printed by this script.");
  process.exit(2);
}

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const call = async (path, { method = "GET", version, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "cal-api-version": version,
      ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* keep the text */ }
  return { status: res.status, ok: res.ok, data, text };
};

let bad = 0;
const say = (ok, line) => { if (!ok) bad++; console.log(`${ok ? "  ok  " : "FAIL  "}${line}`); };

console.log(`\nAsking ${BASE} about event type ${EVENT}`);
console.log(`Versions demo.js sends: slots ${CAL_VERSIONS.slots}, bookings ${CAL_VERSIONS.bookings}\n`);

console.log("-- slots --");
const s = await call(`/slots?${new URLSearchParams({ eventTypeId: String(EVENT),
  start: day(1), end: day(14), timeZone: TZ })}`, { version: CAL_VERSIONS.slots });
say(s.ok, `HTTP ${s.status}`);
if (!s.ok) {
  console.log("  Cal said:", s.text.slice(0, 500));
  if (s.status === 400 || s.status === 404) {
    console.log("\n  A 400 or 404 here usually means the cal-api-version is wrong for this");
    console.log("  endpoint, or the event type id does not belong to this key. Both are one");
    console.log("  line to change: CAL_VERSIONS in worker/demo.js, or the variable.");
  }
} else {
  const parsed = parseSlots(s.data);
  say(!!parsed, parsed ? "demo.js can read the shape it answered with"
    : "demo.js does NOT recognise this shape — see below and fix parseSlots()");
  if (parsed) {
    const dates = Object.keys(parsed);
    say(dates.length > 0, `${dates.length} day(s) with times, e.g. ${dates[0]} → ${parsed[dates[0]]?.[0]}`);
    say(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)), "the keys are plain dates, which the page groups by");
    const first = parsed[dates[0]]?.[0];
    say(!first || !Number.isNaN(Date.parse(first)), `the times are instants the browser can format (${first})`);
  } else {
    console.log("\n  What came back, trimmed:\n", s.text.slice(0, 800));
  }
}

if (process.argv.includes("--book")) {
  const email = process.argv[process.argv.indexOf("--book") + 1];
  if (!email || !email.includes("@")) {
    console.error("\n--book needs an email address to book under. Use one you can cancel.");
    process.exit(2);
  }
  const parsed = s.ok ? parseSlots(s.data) : null;
  const start = parsed && parsed[Object.keys(parsed)[0]]?.[0];
  if (!start) {
    console.log("\n-- bookings -- skipped: no slot to book");
  } else {
    console.log(`\n-- bookings -- this creates a REAL booking at ${start}; cancel it afterwards`);
    const b = await call("/bookings", { method: "POST", version: CAL_VERSIONS.bookings,
      body: { start, eventTypeId: Number(EVENT),
        attendee: { name: "SubSub setup check", email, timeZone: TZ, language: "en" },
        metadata: { source: "cal-check" } } });
    say(b.ok, `HTTP ${b.status}`);
    if (!b.ok) console.log("  Cal said:", b.text.slice(0, 500));
    else {
      const uid = b.data?.data?.uid || b.data?.uid;
      say(!!uid, uid ? `booking created, uid ${uid} — cancel it in Cal` : "created, but no uid where demo.js looks for one");
    }
  }
} else {
  console.log("\n(Booking not attempted. Add --book you@example.com to check that half too.)");
}

console.log(bad ? `\n${bad} thing(s) need a look.` : "\nAll good — demo.js matches what Cal answers.");
process.exit(bad ? 1 : 0);
