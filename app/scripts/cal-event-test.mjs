// CAL_EVENT_TYPE_ID takes the event's number OR its public name.
//
// Cal's newer screens stopped showing an event type's numeric id -- the
// address bar carries an opaque link id (1cF6tyYe1K7Ae7UjkQFNQt) that the API
// does not accept -- so the only identifier somebody setting this up on an
// iPad can actually find is the "username/slug" in the event's URL field.
// Both Cal endpoints take that pair in place of the id. This pins the parse
// and the two requests demo.js really builds, stubbed at fetch.
//
//   node scripts/cal-event-test.mjs

import { calEvent, calConfigured, fetchSlots, createBooking } from "../worker/demo.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const E = (v) => calEvent({ CAL_EVENT_TYPE_ID: v });
ck("a number is the id", eq(E("1234567"), { eventTypeId: 1234567 }));
ck("a number with spaces round it is still the id", eq(E(" 42 "), { eventTypeId: 42 }));
const slug = { username: "richard-braun-uvm0tg", eventTypeSlug: "subsub-demo" };
ck("username/slug is the name", eq(E("richard-braun-uvm0tg/subsub-demo"), slug));
ck("the URL field as shown (cal.com/…) works", eq(E("cal.com/richard-braun-uvm0tg/subsub-demo"), slug));
ck("a pasted https URL with a query works", eq(E("https://cal.com/richard-braun-uvm0tg/subsub-demo/?x=1"), slug));
ck("the opaque link id is refused, not sent", E("1cF6tyYe1K7Ae7UjkQFNQt") === null);
ck("an address-bar links URL is refused", E("https://app.cal.com/links/1cF6tyYe1K7Ae7UjkQFNQt?tabName=setup") === null);
ck("an old event-types address gives its number", eq(E("https://app.cal.com/event-types/1234567?tabName=setup"), { eventTypeId: 1234567 }));
ck("blank is not configured", E("") === null && !calConfigured({ CAL_API_KEY: "k", CAL_EVENT_TYPE_ID: "" }));
ck("an unreadable value reads as not configured", !calConfigured({ CAL_API_KEY: "k", CAL_EVENT_TYPE_ID: "1cF6tyYe1K7Ae7UjkQFNQt" }));
ck("a name with a key is configured", calConfigured({ CAL_API_KEY: "k", CAL_EVENT_TYPE_ID: "a/b" }));

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), init });
  if (String(url).includes("/slots")) {
    if (String(url).includes("refuse")) return new Response(JSON.stringify({ status: "error", error: { message: "Event type not found" } }), { status: 404 });
    return new Response(JSON.stringify({ status: "success", data: { "2026-10-20": [{ start: "2026-10-20T16:00:00.000Z" }] } }), { status: 200 });
  }
  return new Response(JSON.stringify({ status: "success", data: { uid: "bk_1" } }), { status: 201 });
};

const byName = { CAL_API_KEY: "k", CAL_EVENT_TYPE_ID: "cal.com/richard-braun-uvm0tg/subsub-demo", CAL_API_BASE: "https://cal.test/v2" };
const s1 = await fetchSlots(byName, { start: "2026-10-19", end: "2026-10-26", timeZone: "UTC" });
const q1 = new URL(sent[0].url).searchParams;
ck("slots by name sends username and eventTypeSlug", q1.get("username") === "richard-braun-uvm0tg" && q1.get("eventTypeSlug") === "subsub-demo");
ck("…and no eventTypeId", !q1.has("eventTypeId"));
ck("…and reads the times", s1.ok && s1.slots["2026-10-20"]?.length === 1);

await createBooking(byName, { start: "2026-10-20T16:00:00.000Z", name: "A", email: "a@b.co", timeZone: "UTC" });
const b1 = JSON.parse(sent[1].init.body);
ck("booking by name sends the pair", b1.username === "richard-braun-uvm0tg" && b1.eventTypeSlug === "subsub-demo" && !("eventTypeId" in b1));

const byId = { CAL_API_KEY: "k", CAL_EVENT_TYPE_ID: "987", CAL_API_BASE: "https://cal.test/v2" };
await fetchSlots(byId, { start: "2026-10-19", end: "2026-10-26", timeZone: "UTC" });
const q2 = new URL(sent[2].url).searchParams;
ck("slots by number sends eventTypeId only", q2.get("eventTypeId") === "987" && !q2.has("username"));
await createBooking(byId, { start: "2026-10-20T16:00:00.000Z", name: "A", email: "a@b.co", timeZone: "UTC" });
const b2 = JSON.parse(sent[3].init.body);
ck("booking by number sends a numeric eventTypeId", b2.eventTypeId === 987 && !("username" in b2));

const refused = await fetchSlots({ ...byName, CAL_EVENT_TYPE_ID: "refuse/me" }, { start: "2026-10-19", end: "2026-10-26", timeZone: "UTC" });
ck("a refusal carries Cal's own words for the Health light", refused.ok === false && /Event type not found/.test(refused.detail || ""), refused.detail);

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
