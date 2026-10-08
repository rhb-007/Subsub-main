// 072. The tenant's dashboard, server side: their contact details, the
// notices posted to their building, and the weather where it is.
//
// What is pinned, and why each is here rather than assumed:
//
//   CONTACT DETAILS ARE THE CALLER'S OWN ROW ON THIS ACCOUNT. No id in the
//   path, keyed by (account, person), so a second landlord reads nothing the
//   first one was told -- and only a person who rents from TWO accounts can
//   tell that from a row keyed by person alone.
//
//   A PREFERENCE NOBODY CAN ACT ON IS REFUSED: "text me" with no number, an
//   emergency contact with a name and no number, a number that will not text.
//   And a refused save moves nothing, the number on users included.
//
//   A NOTICE IS PER BUILDING. A tenant of the other building on the same
//   account is the only fixture that can tell scoping from "every notice on
//   the account"; a project manager narrowed to the other building is the
//   only one that can tell the write check from none.
//
//   EMAIL FOLLOWS THEIR OWN CHOICE. A tenant who switched email off is not
//   emailed by the back door of a notice, and one with no real address is
//   counted as not emailed rather than silently skipped.
//
//   THE WEATHER IS THEIR BUILDING'S, not the account's commonest town -- and
//   a tenant gets one at all, which before this they did not: the route was
//   not on their allowlist, so every tenant got a 403.
//
//   node --no-warnings scripts/tenant-home-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { validNotice, noticeLive, sortNotices, contactLine, emergencyLine } from "../shared/tenanthome.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const today = new Date().toISOString().slice(0, 10);
const shift = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// acc1 runs two buildings: p1 in Tacoma (two of its three are Tacoma) and p3
// in Olympia. t1 and t3 and t4 live at p1, t2 at p3. u_t1 also rents from acc2.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc1','Cascade Management','cascade','property_manager'),
      ('acc2','Sound PM','sound','property_manager');
    INSERT INTO properties(id,account_id,owner_account_id,name,city,state) VALUES
      ('p1','acc1','acc1','Rainier Apartments','Tacoma','WA'),
      ('p2','acc1','acc1','Pacific Court','Tacoma','WA'),
      ('p3','acc1','acc1','Harbor House','Olympia','WA'),
      ('p9','acc2','acc2','Elsewhere Flats','Spokane','WA');
    INSERT INTO users(id,name,email,phone,notify) VALUES
      ('u_admin','Ann Admin','admin@cascade.test',NULL,NULL),
      ('u_pm3','Pat Narrow','pm3@cascade.test',NULL,NULL),
      ('u_t1','Tess Tenant','tess@home.test',NULL,NULL),
      ('u_t2','Olly Olympia','olly@home.test',NULL,NULL),
      ('u_t3','Quiet Quinn','quinn@home.test',NULL,'{"email":false,"sms":false}'),
      ('u_t4','Noemail Ned','ned@no-email.invalid','(206)555-0144',NULL),
      ('u_sub','Sam Sub','sam@sub.test',NULL,NULL),
      ('u_far','Far Admin','far@sound.test',NULL,NULL);
    INSERT INTO companies(id,company) VALUES ('cmp1','Sam Plumbing');
    INSERT INTO memberships(id,user_id,account_id,role,company_id,unit) VALUES
      ('m_admin','u_admin','acc1','admin',NULL,NULL),
      ('m_pm3','u_pm3','acc1','pm',NULL,NULL),
      ('m_t1','u_t1','acc1','tenant',NULL,'4B'),
      ('m_t2','u_t2','acc1','tenant',NULL,'1'),
      ('m_t3','u_t3','acc1','tenant',NULL,'2'),
      ('m_t4','u_t4','acc1','tenant',NULL,'3'),
      ('m_sub','u_sub','acc1','contractor','cmp1',NULL),
      ('m_far','u_far','acc2','admin',NULL,NULL),
      ('m_t1b','u_t1','acc2','tenant',NULL,'9');
    INSERT INTO membership_properties(membership_id,property_id) VALUES
      ('m_pm3','p3'),
      ('m_t1','p1'),('m_t2','p3'),('m_t3','p1'),('m_t4','p1'),('m_t1b','p9');
  `);
  return db;
};

// Every outbound call is recorded. Resend and Open-Meteo are the two hosts.
const calls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  calls.push({ url, body: init.body ? String(init.body) : "" });
  const j = (o) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
  if (url.includes("resend.test")) return j({ id: "em_" + calls.length });
  if (url.includes("geocoding-api.open-meteo.com")) return j({ results: [{ latitude: 47, longitude: -122.9 }] });
  if (url.includes("api.open-meteo.com/v1/forecast")) {
    return j({ current: { temperature_2m: 61.2, weather_code: 2 },
      daily: { temperature_2m_max: [66.4], temperature_2m_min: [48.1] } });
  }
  return j({});
};

const envOf = (db, mail = false) => ({ DB: makeD1(db),
  ...(mail ? { RESEND_API_KEY: "re_test", MAIL_FROM: "SubSub <no-reply@subsub.work>", RESEND_API_BASE: "https://resend.test" } : {}) });
const call = async (env, who, acc, path, opts = {}) => {
  const r = await worker.fetch(new Request(`https://api.subsub.work/api${path}`, {
    ...opts, headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acc },
  }), env);
  return [r.status, await r.json().catch(() => ({}))];
};
const put = (env, who, acc, body) => call(env, who, acc, "/me/contact", { method: "PUT", body: JSON.stringify(body) });
const post = (env, who, acc, body) => call(env, who, acc, "/notices", { method: "POST", body: JSON.stringify(body) });

console.log("\n-- the rules, before any of it reaches a database --");
{
  ck("a notice needs a headline", validNotice({ title: "  " }).error === "title_required");
  ck("a last day already gone is refused", validNotice({ title: "x", endsOn: "2020-01-01" }, today).error === "date_past");
  ck("31 February is not a day", validNotice({ title: "x", endsOn: "2099-02-31" }, today).error === "bad_date");
  ck("a last day is inclusive", noticeLive({ endsOn: today }, today) === true);
  ck("and the day after it is gone", noticeLive({ endsOn: shift(-1) }, today) === false);
  ck("a removed notice is gone whatever its date", noticeLive({ removed_at: "x" }, today) === false);
  const sorted = sortNotices([{ id: "a", createdAt: "2026-10-08" }, { id: "b", important: true, createdAt: "2026-10-01" }]);
  ck("important outranks newer", sorted[0].id === "b");
  ck("nothing chosen says nothing", contactLine({}) === null && emergencyLine({ emergencyName: "Jo" }) === null);
  ck("a contact line reads", contactLine({ prefer: "text", bestTime: "After 5" }) === "Prefers a text · After 5");
}

console.log("\n-- a tenant's contact details --");
{
  const db = seed(); const env = envOf(db);
  let [st, b] = await call(env, "u_t1", "acc1", "/me/contact");
  ck("a tenant reads their own (empty) details", st === 200 && b.prefer === null && b.email === "tess@home.test", JSON.stringify(b));

  [st, b] = await put(env, "u_t1", "acc1", { prefer: "text" });
  ck("text me with no number is refused", st === 400 && b.error === "phone_required", JSON.stringify(b));

  [st, b] = await put(env, "u_t1", "acc1", { prefer: "text", phone: "555-01" });
  ck("a number that will not text is refused", st === 400 && b.error === "bad_phone");
  ck("and the refused save moved nothing",
    db.prepare("SELECT phone FROM users WHERE id='u_t1'").get().phone == null
    && db.prepare("SELECT COUNT(*) n FROM tenant_contacts").get().n === 0);

  [st, b] = await put(env, "u_t1", "acc1", { prefer: "text", phone: "2065550199", emergencyName: "Jo Tenant" });
  ck("an emergency name with no number is refused", st === 400 && b.error === "emergency_incomplete");

  [st, b] = await put(env, "u_t1", "acc1", { prefer: "text", phone: "206 555 0199", bestTime: "After 5pm",
    emergencyName: "Jo Tenant", emergencyRelation: "sister", emergencyPhone: "(253) 555-0111" });
  ck("a whole answer saves", st === 200 && b.prefer === "text" && b.emergencyPhone === "(253)555-0111", JSON.stringify(b));
  ck("their number is the one texts go to, normalised",
    db.prepare("SELECT phone FROM users WHERE id='u_t1'").get().phone === "(206)555-0199");

  [st, b] = await call(env, "u_t1", "acc2", "/me/contact");
  ck("their other landlord was told none of it", st === 200 && b.prefer === null && b.emergencyName === null, JSON.stringify(b));

  [st, b] = await put(env, "u_t4", "acc1", { prefer: "email" });
  ck("email me, with no real address, is refused", st === 400 && b.error === "email_required");

  [st] = await call(env, "u_admin", "acc1", "/me/contact");
  ck("it is a tenant's route, not a manager's", st === 403);

  [st, b] = await call(env, "u_admin", "acc1", "/tenants");
  const t1 = (b || []).find?.((t) => t.userId === "u_t1");
  const t2 = (b || []).find?.((t) => t.userId === "u_t2");
  ck("the manager's tenant list carries what Tess said",
    t1?.contact?.prefer === "text" && t1?.contact?.emergencyName === "Jo Tenant", JSON.stringify(t1?.contact));
  ck("and nothing for somebody who said nothing", t2 && t2.contact === null);
  [st, b] = await call(env, "u_far", "acc2", "/tenants");
  const t1b = (b || []).find?.((t) => t.userId === "u_t1");
  ck("the other landlord's list does not", t1b && t1b.contact === null, JSON.stringify(t1b?.contact));
}

console.log("\n-- notices, per building --");
{
  const db = seed(); const env = envOf(db);
  let [st, b] = await post(env, "u_admin", "acc1", { propertyId: "p1", title: "Water off Tuesday", body: "9am to 1pm." });
  ck("a manager posts one", st === 201 && b.notice?.title === "Water off Tuesday", JSON.stringify(b));
  [st] = await post(env, "u_admin", "acc1", { propertyId: "p1", title: "Lift out", important: true });
  [st] = await post(env, "u_admin", "acc1", { propertyId: "p3", title: "Car park resurfacing" });

  [st, b] = await call(env, "u_t1", "acc1", "/notices");
  const titles = (b.notices || []).map((n) => n.title);
  ck("a tenant sees their building's", st === 200 && titles.includes("Water off Tuesday"), JSON.stringify(titles));
  ck("important first", titles[0] === "Lift out", JSON.stringify(titles));
  ck("and not the other building's", !titles.includes("Car park resurfacing"));
  [st, b] = await call(env, "u_t2", "acc1", "/notices");
  ck("the other building's tenant sees only theirs",
    JSON.stringify((b.notices || []).map((n) => n.title)) === JSON.stringify(["Car park resurfacing"]));

  [st] = await call(env, "u_sub", "acc1", "/notices");
  ck("a contractor seat does not read what residents are told", st === 403);
  [st] = await post(env, "u_t1", "acc1", { propertyId: "p1", title: "Party at mine" });
  ck("a tenant cannot post", st === 403);
  [st, b] = await post(env, "u_pm3", "acc1", { propertyId: "p1", title: "Not mine to post" });
  ck("a manager narrowed to another building cannot post here", st === 404, JSON.stringify(b));
  [st, b] = await post(env, "u_far", "acc2", { propertyId: "p1", title: "Somebody else's building" });
  ck("nor can another account", st === 404);
  [st, b] = await post(env, "u_admin", "acc1", { propertyId: "p1", title: "x", endsOn: shift(-5) });
  ck("a last day already gone is refused on the route", st === 400 && b.error === "date_past");

  // One that ran out, one that runs out today -- written directly, because
  // the route refuses to post the first.
  db.exec(`INSERT INTO building_notices(id,account_id,property_id,title,ends_on) VALUES
    ('n_old','acc1','p1','Old news','${shift(-3)}'),('n_today','acc1','p1','Last day','${today}')`);
  [st, b] = await call(env, "u_t1", "acc1", "/notices");
  const t2s = (b.notices || []).map((n) => n.title);
  ck("one past its last day is gone", !t2s.includes("Old news"));
  ck("one on its last day is still up", t2s.includes("Last day"));

  const id = db.prepare("SELECT id FROM building_notices WHERE title='Water off Tuesday'").get().id;
  [st] = await call(env, "u_pm3", "acc1", `/notices/${id}`, { method: "DELETE" });
  ck("the narrowed manager cannot take it down either", st === 404);
  [st] = await call(env, "u_admin", "acc1", `/notices/${id}`, { method: "DELETE" });
  ck("its own manager can", st === 200);
  ck("taken down, never deleted", db.prepare("SELECT removed_at FROM building_notices WHERE id=?").get(id).removed_at != null);
  [st, b] = await call(env, "u_t1", "acc1", "/notices");
  ck("and the tenant no longer sees it", !(b.notices || []).some((n) => n.id === id));
  ck("both acts are in the activity feed",
    db.prepare("SELECT COUNT(*) n FROM activity WHERE kind IN ('notice_posted','notice_removed')").get().n === 4);
}

console.log("\n-- emailing a notice follows each tenant's own choice --");
{
  const db = seed(); const env = envOf(db, true);
  calls.length = 0;
  const [st, b] = await post(env, "u_admin", "acc1", { propertyId: "p1", title: "Water off Tuesday",
    body: "9am to 1pm.", important: true, email: true });
  const mails = calls.filter((x) => x.url.includes("resend.test"));
  ck("posted", st === 201, JSON.stringify(b));
  ck("emailed the one tenant here who takes email", b.emailed === 1 && mails.length === 1, JSON.stringify({ e: b.emailed, n: mails.length }));
  ck("to Tess", mails[0] && JSON.parse(mails[0].body).to[0] === "tess@home.test");
  ck("and the notice itself is the message",
    mails[0] && /Water off Tuesday/.test(JSON.parse(mails[0].body).text) && /9am to 1pm/.test(JSON.parse(mails[0].body).text));
  ck("an important one says so in the subject", mails[0] && /^Important: /.test(JSON.parse(mails[0].body).subject));
  ck("the one who switched email off, and the one with no address, are counted", b.notEmailed === 2, String(b.notEmailed));
  ck("nobody at the other building was mailed",
    !mails.some((m) => /olly@home/.test(m.body)));
  ck("and the count is on the row", db.prepare("SELECT emailed FROM building_notices").get().emailed === 1);

  calls.length = 0;
  const [, b2] = await post(env, "u_admin", "acc1", { propertyId: "p1", title: "No email please" });
  ck("not asking to email sends nothing", calls.filter((x) => x.url.includes("resend.test")).length === 0 && b2.emailed === 0);
}

console.log("\n-- the weather is their building's --");
{
  const db = seed(); const env = envOf(db);
  calls.length = 0;
  let [st, b] = await call(env, "u_t2", "acc1", "/weather");
  ck("a tenant gets a reading at all", st === 200 && b.tempF === 61.2, JSON.stringify(b));
  ck("for their own town, not the account's commonest", b.place === "Olympia", String(b.place));
  ck("with today's high and low", b.hiF === 66.4 && b.loF === 48.1);
  ck("what left was a town and a state",
    calls.some((x) => /name=Olympia/.test(x.url)) && !calls.some((x) => /Harbor|olly/i.test(x.url)));
  [st, b] = await call(env, "u_admin", "acc1", "/weather");
  ck("the manager still gets the portfolio's commonest town", b.place === "Tacoma", String(b.place));

  // A building typed in with a ZIP and no town. The tenant's weather must not
  // fall back to the account's other buildings -- that is somebody else's
  // weather -- so the ZIP stands in, and it is this building's.
  db.exec(`INSERT INTO properties(id,account_id,owner_account_id,name,city,state,zip) VALUES
      ('p4','acc1','acc1','Zip Only Flats',NULL,NULL,'98501-1234');
    INSERT INTO memberships(id,user_id,account_id,role,unit) VALUES ('m_t5','u_t3','acc2','tenant','5');
    UPDATE memberships SET user_id = 'u_t3' WHERE id = 'm_t5';
    DELETE FROM membership_properties WHERE membership_id = 'm_t3';
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_t3','p4');`);
  calls.length = 0;
  [st, b] = await call(env, "u_t3", "acc1", "/weather");
  ck("a building with only a ZIP still gets its own reading", st === 200 && b.tempF === 61.2, JSON.stringify(b));
  ck("asked for by that ZIP, not by the account's commonest town",
    calls.some((x) => /name=98501&countryCode=US/.test(x.url)) && !calls.some((x) => /name=Tacoma/.test(x.url)),
    calls.map((x) => x.url).join(" | "));
}

console.log("\n-- a database without 072 --");
{
  const db = seed(); const env = envOf(db);
  db.exec("DROP TABLE building_notices; DROP TABLE tenant_contacts;");
  let [st, b] = await call(env, "u_t1", "acc1", "/notices");
  ck("the notices read answers empty and names the file", st === 200 && b.notices?.length === 0 && b.migration === "072_tenant_home", JSON.stringify(b));
  [st, b] = await post(env, "u_admin", "acc1", { propertyId: "p1", title: "x" });
  ck("posting one names the file", st === 503 && b.migration === "072_tenant_home", JSON.stringify(b));
  // With a number in it, because the number is the half that lives on
  // another table: a save refused for want of 072 must not have moved it.
  [st, b] = await put(env, "u_t1", "acc1", { prefer: "email", phone: "2065550123" });
  ck("saving contact details names the file", st === 503 && b.migration === "072_tenant_home");
  ck("and moved nothing, the number included", db.prepare("SELECT phone FROM users WHERE id='u_t1'").get().phone == null);
  [st, b] = await call(env, "u_admin", "acc1", "/tenants");
  ck("the manager's tenant list still lists them", st === 200 && Array.isArray(b) && b.length === 4, `${st} ${Array.isArray(b) ? b.length : JSON.stringify(b)}`);
  [st, b] = await call(env, "u_t1", "acc1", "/me/contact");
  ck("and a tenant's details read the number on file", st === 200 && b.migration === "072_tenant_home");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
