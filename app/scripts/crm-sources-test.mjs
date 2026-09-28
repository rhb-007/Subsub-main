// Adding a CRM should be a row, not a release.
//
// The JobNimbus receiver was written by hand and had to be. Writing the next
// four that way costs four builds, four test suites and four sets of quirks
// found by hitting them -- two of JobNimbus's three were only found because a
// test failed. So the translation is DATA: a preset says where the record
// sits, which of their fields is which of ours, and how their dates are
// written.
//
// What this covers:
//
//   THE ENGINE REPRODUCES BOTH JOBNIMBUS BUGS. Epoch seconds read as
//   milliseconds land in 1970; an address line 2 with no line 1 is "Unit B",
//   which satisfies a has-a-location check with nowhere to send anybody.
//   Those were real, and a generic engine that lost either would be a
//   regression dressed as a refactor.
//
//   A SECOND SOURCE COSTS NO ROUTE. `generic` exists for anything that can
//   POST JSON but cannot set a header, and it is an entry in the same file.
//
//   AND NO PRESET IS INVENTED. A preset for a CRM whose payload nobody has
//   seen would look supported, fail on first contact, and fail in the way
//   that is hardest to debug -- silently, against docs saying it works. Same
//   rule the licensing dataset runs on.
//
//   node --no-warnings scripts/crm-sources-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { SOURCE_PRESETS, isSource, unwrap, translate, toDate, atPath } from "../shared/crmsources.js";
import { SOURCES } from "../shared/ingest.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M048 = readFileSync(new URL("../worker/migrations/048_api.sql", import.meta.url), "utf8");
const M049 = readFileSync(new URL("../worker/migrations/049_crm_mapping.sql", import.meta.url), "utf8");

console.log("\n-- dates, by how the source writes them --");
{
  // The one that bites. 1791936000 seconds is 2026-10-14; read as ms it is
  // three weeks after the Unix epoch, and the job sits in a calendar nobody
  // will ever scroll to.
  ck("epoch seconds", toDate(1791936000, "epoch_s") === "2026-10-14", toDate(1791936000, "epoch_s"));
  ck("and milliseconds are a different answer",
    toDate(1791936000, "epoch_ms") === "1970-01-21", toDate(1791936000, "epoch_ms"));
  ck("iso", toDate("2026-10-14T08:00:00Z", "iso") === "2026-10-14");
  ck("us month-first", toDate("3/14/2026", "us") === "2026-03-14", toDate("3/14/2026", "us"));
  ck("and zero-padded us", toDate("03/04/2026", "us") === "2026-03-04", toDate("03/04/2026", "us"));
  // Named per source rather than sniffed: guessing day-first vs month-first
  // wrong puts a crew on site nine months early and nothing looks wrong
  // until they arrive.
  ck("a day-first date is NOT silently reinterpreted",
    toDate("14/03/2026", "us") === null, String(toDate("14/03/2026", "us")));
  // Two checks guard this and they are not interchangeable. The range check
  // catches month 14; only the calendar round-trip catches a day that does
  // not exist in the month it names. Asserting month 14 alone passes with the
  // round-trip deleted, which is a test that cannot fail for the half that
  // does the harder work.
  ck("a day that does not exist is refused", toDate("2/31/2026", "us") === null,
    String(toDate("2/31/2026", "us")));
  ck("and the ISO spelling of it too", toDate("2026-02-31", "iso") === null,
    String(toDate("2026-02-31", "iso")));
  ck("while the last real day of February is fine",
    toDate("2026-02-28", "iso") === "2026-02-28", String(toDate("2026-02-28", "iso")));
  ck("nonsense is null, not a guess", toDate("next tuesday", "iso") === null);
  ck("and zero is not 1970", toDate(0, "epoch_s") === null);
}

console.log("\n-- nested payloads --");
{
  ck("a dotted path reads down", atPath({ a: { b: { c: 7 } } }, "a.b.c") === 7);
  ck("a missing branch is undefined, not a throw",
    atPath({ a: 1 }, "a.b.c") === undefined);
  ck("and so is a null one", atPath({ a: null }, "a.b") === undefined);
}

console.log("\n-- unwrapping the record --");
{
  const JN = SOURCE_PRESETS.jobnimbus;
  ck("a wrapped record is found", unwrap({ event: "x", data: { jnid: "a" } }, JN)?.jnid === "a");
  ck("a bare one is used as-is", unwrap({ jnid: "b" }, JN)?.jnid === "b");
  ck("an array is refused", unwrap([{ jnid: "c" }], JN) === null);
  ck("and so is a string", unwrap("nope", JN) === null);
}

console.log("\n-- the engine keeps both JobNimbus bug fixes --");
{
  const JN = SOURCE_PRESETS.jobnimbus;
  const full = translate({
    jnid: "a1", name: "Okafor — Reroof", date_start: 1791936000,
    address_line1: "14 Alder Way", address_line2: "Unit B",
    city: "Seattle", zip: "98101", display_name: "M. Okafor", description: "Tear off",
  }, JN);
  ck("a whole record translates", full.missing.length === 0, JSON.stringify(full.missing));
  ck("with the date read as seconds", full.job.date === "2026-10-14", full.job.date);
  ck("and both address lines", full.job.address === "14 Alder Way, Unit B", full.job.address);

  // "Unit B" with no street is not somewhere a contractor can be sent.
  const unit = translate({ jnid: "b", name: "x", date_start: 1791936000, address_line2: "Unit B" }, JN);
  ck("a unit number with no street is nowhere",
    unit.missing.includes("address_line1"), JSON.stringify(unit.missing));

  // Named in THEIR vocabulary: the integrator knows `jnid`, not `externalId`.
  const bare = translate({}, JN);
  ck("and what is missing is named in their words",
    bare.missing.includes("jnid") && bare.missing.includes("date_start"),
    JSON.stringify(bare.missing));
  ck("never in ours", !JSON.stringify(bare.missing).includes("externalId"),
    JSON.stringify(bare.missing));

  // A job is often named only by its customer.
  const noName = translate({ jnid: "c", first_name: "Mo", last_name: "Okafor",
    date_start: 1791936000, city: "Seattle" }, JN);
  ck("a missing name falls back to the customer", noName.job.title === "Mo Okafor", noName.job.title);
}

console.log("\n-- a second source is an entry in a file, not a route --");
{
  const G = SOURCE_PRESETS.generic;
  const r = translate({
    externalId: "OWN-1", title: "Reroof", date: "2026-10-14",
    address: "14 Alder Way", city: "Seattle", zip: "98101",
    customer: "M. Okafor", description: "Tear off",
  }, G);
  ck("our own field names translate", r.missing.length === 0, JSON.stringify(r.missing));
  ck("with the right date", r.job.date === "2026-10-14", r.job.date);
  ck("and the client", r.job.client === "M. Okafor", r.job.client);
  // snake_case and camelCase both, because an in-house script will use one
  // or the other and neither is worth refusing a job over.
  const snake = translate({ external_id: "OWN-2", name: "Job", scheduled_date: "2026-10-15",
    address: "1 Pine", postal_code: "98101" }, G);
  ck("snake_case works too", snake.missing.length === 0 && snake.job.date === "2026-10-15",
    JSON.stringify(snake.missing));
}

console.log("\n-- and no preset is invented --");
{
  // A preset for a CRM whose real payload nobody has seen would look
  // supported and fail on first contact, silently, against documentation
  // saying it works. Same rule the licensing dataset runs on.
  const names = Object.keys(SOURCE_PRESETS);
  ck("every preset claims to be verified",
    names.every((n) => SOURCE_PRESETS[n].verified === true), names.join(","));
  ck("and every one has a label a person would recognise",
    names.every((n) => typeof SOURCE_PRESETS[n].label === "string" && SOURCE_PRESETS[n].label),
    names.map((n) => SOURCE_PRESETS[n].label).join(" | "));
  // Every preset must name the five fields the receiver cannot work without.
  ck("and names every field the receiver needs",
    names.every((n) => ["externalId", "title", "date", "address"]
      .every((f) => SOURCE_PRESETS[n].fields[f])), names.join(","));
  // Two lists that look interchangeable and are not: SOURCES is what a job's
  // provenance may be CALLED, SOURCE_PRESETS is what SubSub can TRANSLATE.
  // A preset whose name the provenance list refuses would create jobs tagged
  // with something the rest of the system rejects.
  ck("every preset name is a valid provenance label",
    names.every((n) => SOURCES.includes(n)), `${names.join(",")} vs ${SOURCES.join(",")}`);
  ck("isSource only knows the ones that exist",
    isSource("jobnimbus") && isSource("generic") && !isSource("acculynx") && !isSource(""));
}

console.log("\n-- through the route --");
{
  const db = freshDb({ base: SCHEMA, migrations: [M048, M049] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_gc','Outerhome','outerhome','general_contractor','scale');
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_ad','u_ad','acc_gc','admin');`);
  const env = { DB: makeD1(db) };
  const seat = { "X-User-Id": "u_ad", "X-Account-Id": "acc_gc", "Content-Type": "application/json" };
  const tok = await worker.fetch(new Request("https://api.subsub.work/api/api-tokens",
    { method: "POST", headers: seat, body: JSON.stringify({ name: "Ours" }) }), env)
    .then((r) => r.json()).then((b) => b.token);

  const hook = async (source, payload) => {
    const res = await worker.fetch(new Request(
      `https://api.subsub.work/api/v1/hooks/${source}/${tok}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload) }), env);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  await worker.fetch(new Request("https://api.subsub.work/api/crm-rules", { method: "POST",
    headers: seat, body: JSON.stringify({ source: "generic", match: "type", value: "Reroof", trades: ["roofing"] }) }), env);

  const g = await hook("generic", { externalId: "OWN-1", title: "Reroof", type: "Reroof",
    date: "2026-10-14", address: "14 Alder Way" });
  ck("the generic source creates a job", g.status === 201, `${g.status} ${JSON.stringify(g.body)}`);
  ck("naming which source it came from", g.body.source === "generic", g.body.source);
  ck("and its rules are the generic ones", g.body.trades.join(",") === "roofing",
    JSON.stringify(g.body.trades));
  ck("recorded against that source",
    db.prepare("SELECT source FROM job_sources WHERE external_id='OWN-1'").get().source === "generic");

  // Rules are per source, so the same word on two CRMs is two questions.
  const j = await hook("jobnimbus", { jnid: "JN-1", name: "Reroof", type: "Reroof",
    date_start: 1791936000, address_line1: "9 Pine" });
  ck("the same word on another source does not borrow its rule",
    j.body.trades.length === 0, JSON.stringify(j.body.trades));
  ck("and is queued as its own question",
    db.prepare("SELECT COUNT(*) AS n FROM crm_unmapped WHERE source='jobnimbus'").get().n > 0);

  // A rule naming a CRM with no receiver is refused, not quietly filed under
  // JobNimbus. `acculynx` is a valid PROVENANCE label and not a preset, which
  // is exactly the gap a wider check would wave through.
  const rule = await worker.fetch(new Request("https://api.subsub.work/api/crm-rules",
    { method: "POST", headers: seat,
      body: JSON.stringify({ source: "acculynx", match: "type", value: "X", trades: ["roofing"] }) }), env);
  ck("a rule for a CRM with no receiver is refused", rule.status === 400, String(rule.status));
  ck("and nothing was stored under another source",
    db.prepare("SELECT COUNT(*) AS n FROM crm_trade_rules WHERE match_value='X'").get().n === 0);
  // Omitted is different from wrong: nothing was asked, so the default stands.
  const noSrc = await worker.fetch(new Request("https://api.subsub.work/api/crm-rules",
    { method: "POST", headers: seat,
      body: JSON.stringify({ match: "type", value: "Defaulted", trades: ["roofing"] }) }), env);
  ck("but omitting it still defaults", noSrc.status === 200, String(noSrc.status));
  ck("to jobnimbus",
    db.prepare("SELECT source FROM crm_trade_rules WHERE match_value='Defaulted'").get().source === "jobnimbus");

  // A typo in a pasted URL should say so, not 404 into silence.
  const bad = await hook("acculynx", { id: "1" });
  ck("an unknown source is named", bad.status === 404 && bad.body.error === "unknown_source",
    `${bad.status} ${JSON.stringify(bad.body)}`);
  ck("and lists what IS supported",
    (bad.body.supported || []).includes("jobnimbus"), JSON.stringify(bad.body.supported));

  // The source is read before the token, so a typo does not read as a bad key.
  const badBoth = await worker.fetch(new Request(
    "https://api.subsub.work/api/v1/hooks/acculynx/ssk_madeup",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), env);
  ck("a typo'd source with a bad token still says unknown_source",
    (await badBoth.json()).error === "unknown_source", String(badBoth.status));

  // And the token is still the token.
  const noTok = await worker.fetch(new Request(
    "https://api.subsub.work/api/v1/hooks/generic/ssk_madeup",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), env);
  ck("a real source with a made-up token is 401", noTok.status === 401, String(noTok.status));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
