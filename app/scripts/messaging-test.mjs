// 081. Messages between an account and the people it already works with,
// server side.
//
// What is pinned, and why each is here rather than assumed:
//
//   NOT A DIRECTORY. A thread can only be started with somebody the caller
//   already works with: its own tenants, its own roster, the owners of its own
//   buildings -- or, from the other side, the office of the building or the
//   account that hires you. A company that is not on the roster, another
//   account's tenant, and a job the party is not on all answer not_found, the
//   same as an id that does not exist. The contacts list carries nothing else.
//
//   EACH SIDE READS ITS OWN. A tenant reads their own threads and never
//   another tenant's; a project manager narrowed to one building reads that
//   building's tenants and not the other's. Only a fixture with two buildings
//   and a narrowed manager can tell scoping from "every thread on the account".
//
//   A SUBCONTRACTOR ACCOUNT ANSWERS ITS CLIENT FROM HOME, through its own
//   company, with no seat on the client -- and stops being able to the moment
//   the engagement ends, while the client keeps the history read-only.
//
//   UNREAD IS PER PERSON AND PER SIDE. A teammate's message is not waiting on
//   you, and opening a thread reads it.
//
//   PHOTOS ARE CHECKED. A key under another account's prefix is refused, and
//   a photo is served only to somebody on the thread.
//
//   THE EMAIL GOES ONCE. After the wait, to whoever has not read it, honoring
//   their own email setting, and a second run sends nothing.
//
//   node --no-warnings scripts/messaging-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb, makeR2 } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { threadKey, partyShapeOk, sideOf, validMessage, mayEditMessage, owesEmail,
  NOTIFY_AFTER_MS, EDIT_WINDOW_MS, looksLikeTime, jobSeedFrom } from "../shared/messaging.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

// acc1 (Cascade, a property manager) runs p1 and p3, and p4, which acc4 owns.
// Tenants: t1 at p1 (reported j1), t2 at p3. pm3 is narrowed to p3. own1 is
// an owner seat on p1. Its roster: cmp1 (a contractor seat, sub1, holds a work
// order on j1), and cmp3, which is Pacific's own company (acc3, admin pac).
// acc2 (Sound) is somebody else entirely, with its own tenant x.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO companies(id,company) VALUES ('cmp1','Sam Plumbing'),('cmp3','Pacific Apartment Maintenance'),
      ('cmp_x','Stranger Roofing');
    INSERT INTO accounts(id,name,subdomain,kind,company_id) VALUES
      ('acc1','Cascade Management','cascade','property_manager',NULL),
      ('acc2','Sound PM','sound','property_manager',NULL),
      ('acc3','Pacific','pacific','subcontractor','cmp3'),
      ('acc4','Lake Owners','lake','building_owner',NULL);
    INSERT INTO properties(id,account_id,owner_account_id,name,city,state) VALUES
      ('p1','acc1','acc1','Rainier Apartments','Tacoma','WA'),
      ('p3','acc1','acc1','Harbor House','Olympia','WA'),
      ('p4','acc1','acc4','Lake House','Tacoma','WA'),
      ('p9','acc2','acc2','Elsewhere Flats','Spokane','WA');
    INSERT INTO users(id,name,email,notify) VALUES
      ('admin','Ann Admin','admin@cascade.test',NULL),
      ('pm3','Pat Narrow','pm3@cascade.test',NULL),
      ('t1','Tess Tenant','tess@home.test',NULL),
      ('t2','Olly Olympia','olly@home.test','{"email":false}'),
      ('own1','Owen Owner','owen@own.test',NULL),
      ('sub1','Sam Sub','sam@sub.test',NULL),
      ('pac','Juan Soto','juan@pacific.test',NULL),
      ('oa','Lena Lake','lena@lake.test',NULL),
      ('x','Xena Other','x@sound.test',NULL),
      ('farad','Far Admin','far@sound.test',NULL);
    INSERT INTO memberships(id,user_id,account_id,role,company_id,unit) VALUES
      ('m_admin','admin','acc1','admin',NULL,NULL),
      ('m_pm3','pm3','acc1','pm',NULL,NULL),
      ('m_t1','t1','acc1','tenant',NULL,'4B'),
      ('m_t2','t2','acc1','tenant',NULL,'1'),
      ('m_own1','own1','acc1','owner',NULL,NULL),
      ('m_sub1','sub1','acc1','contractor','cmp1',NULL),
      ('m_pac','pac','acc3','admin',NULL,NULL),
      ('m_oa','oa','acc4','admin',NULL,NULL),
      ('m_x','x','acc2','tenant',NULL,'9'),
      ('m_far','farad','acc2','admin',NULL,NULL);
    INSERT INTO membership_properties(membership_id,property_id) VALUES
      ('m_pm3','p3'),('m_t1','p1'),('m_t2','p3'),('m_own1','p1'),('m_x','p9');
    INSERT INTO engagements(id,account_id,company_id,status) VALUES
      ('e1','acc1','cmp1','active'),('e3','acc1','cmp3','active');
    INSERT INTO jobs(id,account_id,title,property_id,requested_by,status) VALUES
      ('j1','acc1','Leaking sink','p1','t1','active'),
      ('j2','acc1','Hall lights','p3',NULL,'active');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status) VALUES
      ('wo1','WO-1','j1','plumbing','cmp1','e1','pending');
  `);
  return db;
};

const sent = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input);
  if (url.includes("mail.test")) sent.push(JSON.parse(String(init.body || "{}")));
  return new Response(JSON.stringify({ id: "em_" + sent.length }), { headers: { "Content-Type": "application/json" } });
};
const envOf = (db) => ({ DB: makeD1(db), FILES: makeR2(), CRON_SECRET: "cron",
  RESEND_API_KEY: "re_test", MAIL_FROM: "SubSub <no-reply@subsub.work>", RESEND_API_BASE: "https://mail.test" });
const SEATS = { admin: "acc1", pm3: "acc1", t1: "acc1", t2: "acc1", own1: "acc1", sub1: "acc1",
  pac: "acc3", oa: "acc4", x: "acc2", farad: "acc2" };
const call = async (env, who, path, opts = {}) => {
  const r = await worker.fetch(new Request(`https://api.subsub.work/api${path}`, {
    ...opts, headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": SEATS[who], ...(opts.headers || {}) },
  }), env);
  return [r.status, await r.json().catch(() => ({}))];
};
const start = (env, who, body) => call(env, who, "/threads", { method: "POST", body: JSON.stringify(body) });
const say = (env, who, id, body) => call(env, who, `/threads/${id}/messages`, { method: "POST", body: JSON.stringify(typeof body === "string" ? { body } : body) });
const list = async (env, who) => (await call(env, who, "/threads"))[1];

console.log("\n-- the rules, before any of it reaches a database --");
{
  const k = (o) => threadKey({ accountId: "a", kind: "crew", partyCompanyId: "c", ...o });
  ck("one key per party, general and per job", k({}) !== k({ jobId: "j" }) && k({}) === k({}));
  ck("a user id and a company id cannot collide", threadKey({ accountId: "a", kind: "crew", partyCompanyId: "z" })
    !== threadKey({ accountId: "a", kind: "crew", partyUserId: "z" }));
  ck("an owner's general thread is per building", threadKey({ accountId: "a", kind: "owner", partyUserId: "o", propertyId: "p1" })
    !== threadKey({ accountId: "a", kind: "owner", partyUserId: "o", propertyId: "p2" }));
  ck("a thread names exactly the party its kind needs",
    partyShapeOk({ kind: "tenant", partyUserId: "u" }) && !partyShapeOk({ kind: "tenant", partyUserId: "u", partyCompanyId: "c" })
    && !partyShapeOk({ kind: "owner", partyUserId: "u", partyAccountId: "a", propertyId: "p" })
    && !partyShapeOk({ kind: "owner", partyUserId: "u" }));
  const t = { accountId: "acc1", kind: "tenant", partyUserId: "t1", propertyId: "p1" };
  ck("the running team is home", sideOf(t, { accountId: "acc1", role: "admin" }) === "home");
  ck("a manager narrowed to another building is neither", sideOf(t, { accountId: "acc1", role: "pm", propertyIds: ["p3"] }) === null);
  ck("the named tenant is the party", sideOf(t, { accountId: "acc1", role: "tenant", userId: "t1" }) === "party");
  ck("another tenant is neither", sideOf(t, { accountId: "acc1", role: "tenant", userId: "t2" }) === null);
  ck("a contractor seat cannot read a tenant thread", sideOf(t, { accountId: "acc1", role: "contractor", companyId: "cmp1" }) === null);
  const crew = { accountId: "acc1", kind: "crew", partyCompanyId: "cmp3" };
  ck("a company's own team is the party from home", sideOf(crew, { accountId: "acc3", role: "admin", ownCompanyId: "cmp3" }) === "party");
  ck("but not a tenant of that account", sideOf(crew, { accountId: "acc3", role: "tenant", ownCompanyId: "cmp3" }) === null);
  ck("a narrowed manager still reads a general crew thread", sideOf(crew, { accountId: "acc1", role: "pm", propertyIds: ["p3"] }) === "home");
  ck("an empty message is refused", validMessage({ body: "   " }).error === "empty");
  ck("a key outside the prefix is refused", validMessage({ photos: ["acc2/message-photo/x.jpg"] }, { keyPrefix: "acc1/message-photo/" }).error === "bad_photo");
  ck("a photo alone is a message", !validMessage({ photos: [{ key: "acc1/message-photo/a.jpg" }] }, { keyPrefix: "acc1/message-photo/" }).error);
  const now = Date.now();
  const m = { authorUserId: "u", createdAt: new Date(now - 60000).toISOString() };
  ck("the author may correct a typo", mayEditMessage(m, "u", now));
  ck("nobody else may", !mayEditMessage(m, "v", now));
  ck("and not after the window", !mayEditMessage({ ...m, createdAt: new Date(now - EDIT_WINDOW_MS - 1000).toISOString() }, "u", now));
  const old = new Date(now - NOTIFY_AFTER_MS - 1000).toISOString();
  ck("an unread message past the wait owes an email", owesEmail({ latestOtherAt: old, nowMs: now }));
  ck("not before the wait", !owesEmail({ latestOtherAt: new Date(now - 1000).toISOString(), nowMs: now }));
  ck("not once read", !owesEmail({ latestOtherAt: old, readAt: new Date(now).toISOString(), nowMs: now }));
  ck("not twice", !owesEmail({ latestOtherAt: old, notifiedAt: new Date(now).toISOString(), nowMs: now }));
}

console.log("\n-- a tenant and the office --");
{
  const db = seed(); const env = envOf(db);
  const [s1, r1] = await start(env, "t1", { kind: "tenant", partyUserId: "t1", body: "Is anyone coming about the sink?" });
  ck("a tenant writes to their building's office", s1 === 201 && !!r1.thread?.id, `${s1} ${JSON.stringify(r1).slice(0, 200)}`);
  ck("the thread sits at their building", r1.thread?.propertyId === "p1");
  const [s2] = await start(env, "t1", { kind: "tenant", partyUserId: "t2", body: "hi" });
  ck("a tenant cannot open a thread naming somebody else", s2 === 404, String(s2));
  const a = await list(env, "admin");
  const th = a.threads?.find((t) => t.id === r1.thread.id);
  ck("the office sees it, unread", th?.unread === 1 && th?.side === "home" && th?.partyName === "Tess Tenant", JSON.stringify(th));
  ck("with their unit and building", th?.unit === "4B" && th?.propertyName === "Rainier Apartments");
  const pm = await list(env, "pm3");
  ck("a manager narrowed to the other building does not", !pm.threads?.some((t) => t.id === r1.thread.id), JSON.stringify(pm));
  const [s3] = await call(env, "pm3", `/threads/${r1.thread.id}`);
  ck("and opening it by id answers not_found", s3 === 404, String(s3));
  const [s4] = await call(env, "t2", `/threads/${r1.thread.id}`);
  ck("another tenant cannot open it either", s4 === 404);
  const [s5, r5] = await call(env, "admin", `/threads/${r1.thread.id}`);
  ck("opening it reads it", s5 === 200 && r5.messages?.length === 1 && (await list(env, "admin")).threads.find((t) => t.id === r1.thread.id).unread === 0);
  await say(env, "admin", r1.thread.id, "Yes -- Sam is booked for Tuesday.");
  const tt = (await list(env, "t1")).threads?.find((t) => t.id === r1.thread.id);
  ck("the tenant now has one unread, from the office", tt?.unread === 1 && tt?.side === "party" && tt?.lastSide === "home", JSON.stringify(tt));
  ck("and their own message never counted against them", tt?.unread === 1);
  const [s6, r6] = await start(env, "t1", { kind: "tenant", partyUserId: "t1" });
  ck("starting again finds the same thread", s6 === 201 && r6.thread.id === r1.thread.id);
  const [s7] = await say(env, "t1", r1.thread.id, "   ");
  ck("an empty message is refused", s7 === 400);
  // A teammate's message is not waiting on you: pm3 reads Olly's building.
  const [, ro] = await start(env, "admin", { kind: "tenant", partyUserId: "t2", body: "Your package is at the desk." });
  const po = (await list(env, "pm3")).threads?.find((t) => t.id === ro.thread.id);
  ck("a teammate's message is not unread for you", po && po.unread === 0 && po.side === "home", JSON.stringify(po));
  ck("but it is for the tenant", (await list(env, "t2")).threads?.find((t) => t.id === ro.thread.id)?.unread === 1);
  const [sx] = await call(env, "x", `/threads/${r1.thread.id}`);
  ck("a tenant of another account cannot open it", sx === 404);
}

console.log("\n-- no directory --");
{
  const db = seed(); const env = envOf(db);
  const [s1] = await start(env, "admin", { kind: "crew", partyCompanyId: "cmp_x", body: "Want some work?" });
  ck("a company that is not on the roster cannot be written to", s1 === 404, String(s1));
  const [s2] = await start(env, "admin", { kind: "tenant", partyUserId: "x", body: "hello" });
  ck("nor another account's tenant", s2 === 404, String(s2));
  const [, c] = await call(env, "admin", "/message-contacts");
  const labels = (c.contacts || []).map((k) => k.label);
  ck("contacts are the account's own relationships", ["Tess Tenant", "Olly Olympia", "Sam Plumbing",
    "Pacific Apartment Maintenance", "Owen Owner", "Lake Owners"].every((l) => labels.includes(l)), JSON.stringify(labels));
  ck("and nobody else", !labels.includes("Stranger Roofing") && !labels.includes("Xena Other"), JSON.stringify(labels));
  const [, c3] = await call(env, "pm3", "/message-contacts");
  const l3 = (c3.contacts || []).filter((k) => k.kind === "tenant").map((k) => k.label);
  ck("a narrowed manager's tenants are their building's", l3.length === 1 && l3[0] === "Olly Olympia", JSON.stringify(l3));
  const [, ct] = await call(env, "t1", "/message-contacts");
  ck("a tenant's only contact is the office", ct.contacts?.length === 1 && ct.contacts[0].label === "Cascade Management");
}

console.log("\n-- jobs --");
{
  const db = seed(); const env = envOf(db);
  const [s1, r1] = await start(env, "admin", { kind: "tenant", partyUserId: "t1", jobId: "j1", body: "Can you send a photo?" });
  ck("a job thread with the tenant who reported it", s1 === 201 && r1.thread.jobId === "j1" && r1.thread.jobTitle === "Leaking sink");
  const [s2] = await start(env, "admin", { kind: "tenant", partyUserId: "t2", jobId: "j1", body: "?" });
  ck("not with a tenant who has nothing to do with it", s2 === 404);
  const [s3] = await start(env, "admin", { kind: "crew", partyCompanyId: "cmp1", jobId: "j1", body: "Parts in?" });
  ck("a job thread with the company holding its work order", s3 === 201);
  const [s4] = await start(env, "admin", { kind: "crew", partyCompanyId: "cmp3", jobId: "j1", body: "?" });
  ck("not with a roster company that is not on the job", s4 === 404, String(s4));
  const sub = await list(env, "sub1");
  ck("the contractor seat reads its own job thread", sub.threads?.length === 1 && sub.threads[0].jobId === "j1", JSON.stringify(sub));
  ck("and not the tenant's", !sub.threads?.some((t) => t.kind === "tenant"));
  const [s5] = await start(env, "t1", { kind: "tenant", partyUserId: "t1", jobId: "j2", body: "?" });
  ck("a tenant cannot open a thread on somebody else's job", s5 === 404);
}

console.log("\n-- a subcontractor account answers its client from home --");
{
  const db = seed(); const env = envOf(db);
  const [s1, r1] = await start(env, "admin", { kind: "crew", partyCompanyId: "cmp3", body: "Can you take Unit 2?" });
  ck("the client writes to Pacific", s1 === 201);
  const p = await list(env, "pac");
  const pt = p.threads?.find((t) => t.id === r1.thread.id);
  ck("Pacific's own admin sees it at home, as the party", pt?.side === "party" && pt?.unread === 1 && pt?.accountName === "Cascade Management", JSON.stringify(p));
  const [s2] = await say(env, "pac", r1.thread.id, "Yes, Thursday.");
  ck("and answers it with no seat on the client", s2 === 201, String(s2));
  const [, c] = await call(env, "pac", "/message-contacts");
  ck("its contacts are the clients that hire it", c.contacts?.some((k) => k.label === "Cascade Management" && k.start.accountId === "acc1"), JSON.stringify(c.contacts));
  db.exec(`UPDATE engagements SET status = 'ended' WHERE id = 'e3'`);
  const [s3] = await call(env, "pac", `/threads/${r1.thread.id}`);
  ck("once the engagement ends Pacific cannot open it", s3 === 404, String(s3));
  ck("or list it", !(await list(env, "pac")).threads?.some((t) => t.id === r1.thread.id));
  const [s4, r4] = await call(env, "admin", `/threads/${r1.thread.id}`);
  ck("the client keeps the history, read-only", s4 === 200 && r4.messages?.length === 2 && r4.partyGone === true && r4.canPost === false);
  const [s5, r5] = await say(env, "admin", r1.thread.id, "Hello?");
  ck("and cannot write into it", s5 === 409 && r5.error === "party_gone");
}

console.log("\n-- owners --");
{
  const db = seed(); const env = envOf(db);
  const [s1] = await start(env, "own1", { kind: "owner", partyUserId: "own1", propertyId: "p1", body: "How is the roof?" });
  ck("an owner seat writes about its building", s1 === 201, String(s1));
  const [s2] = await start(env, "own1", { kind: "owner", partyUserId: "own1", propertyId: "p3", body: "?" });
  ck("not about a building it does not own", s2 === 404, String(s2));
  const [s3, r3] = await start(env, "oa", { kind: "owner", accountId: "acc1", partyAccountId: "acc4", propertyId: "p4", body: "Any vacancies?" });
  ck("an owning account writes to the manager it appointed", s3 === 201, `${s3} ${JSON.stringify(r3)}`);
  const at = (await list(env, "admin")).threads?.find((t) => t.id === r3.thread?.id);
  ck("the manager sees it, from the owning account", at?.side === "home" && at?.partyName === "Lake Owners", JSON.stringify(at));
  const [s4] = await start(env, "oa", { kind: "owner", accountId: "acc1", partyAccountId: "acc4", propertyId: "p1", body: "?" });
  ck("not about a building it does not own", s4 === 404);
  const [s5] = await start(env, "farad", { kind: "owner", accountId: "acc1", partyAccountId: "acc4", propertyId: "p4", body: "?" });
  ck("and nobody can claim to be the owning account", s5 === 404, String(s5));
}

console.log("\n-- photos and corrections --");
{
  const db = seed(); const env = envOf(db);
  const up = await worker.fetch(new Request("https://api.subsub.work/api/uploads/message-photo/sink.jpg", {
    method: "PUT", body: new Uint8Array([1, 2, 3, 4]),
    headers: { "Content-Type": "image/jpeg", "X-User-Id": "t1", "X-Account-Id": "acc1" } }), env);
  const u = await up.json();
  ck("a tenant may upload a message photo", up.status === 200 && u.key?.startsWith("acc1/message-photo/"), JSON.stringify(u));
  const bad = await worker.fetch(new Request("https://api.subsub.work/api/uploads/message-photo/x.txt", {
    method: "PUT", body: "hello", headers: { "Content-Type": "text/plain", "X-User-Id": "t1", "X-Account-Id": "acc1" } }), env);
  ck("and it is the checked kind", bad.status === 415);
  const [s1, r1] = await start(env, "t1", { kind: "tenant", partyUserId: "t1", body: "Here it is", photos: [{ key: u.key, type: "image/jpeg", name: "sink.jpg" }] });
  ck("a message carries the photo", s1 === 201 && r1.message?.photos?.length === 1);
  const [s2] = await say(env, "t1", r1.thread.id, { body: "x", photos: [{ key: "acc2/message-photo/z.jpg" }] });
  ck("a key from another account is refused", s2 === 400);
  const ph = (who) => worker.fetch(new Request(`https://api.subsub.work/api/threads/${r1.thread.id}/photos/${r1.message.id}/0`,
    { headers: { "X-User-Id": who, "X-Account-Id": SEATS[who] } }), env);
  ck("the office can see the photo", (await ph("admin")).status === 200);
  ck("another tenant cannot", (await ph("t2")).status === 404);
  const [e1, er1] = await call(env, "t1", `/messages/${r1.message.id}`, { method: "PATCH", body: JSON.stringify({ body: "Here it is (under the sink)" }) });
  ck("the author corrects a typo", e1 === 200 && er1.message?.editedAt && er1.message.body.includes("under"));
  const [e2] = await call(env, "admin", `/messages/${r1.message.id}`, { method: "PATCH", body: JSON.stringify({ body: "changed" }) });
  ck("nobody else may", e2 === 404, String(e2));
  db.exec(`UPDATE messages SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = '${r1.message.id}'`);
  const [e3, er3] = await call(env, "t1", `/messages/${r1.message.id}`, { method: "PATCH", body: JSON.stringify({ body: "later" }) });
  ck("and not after ten minutes", e3 === 409 && er3.error === "edit_window_closed");
}

console.log("\n-- the email --");
{
  const db = seed(); const env = envOf(db);
  const [, r1] = await start(env, "t1", { kind: "tenant", partyUserId: "t1", body: "The water is coming through the ceiling" });
  const [, r2] = await start(env, "admin", { kind: "tenant", partyUserId: "t2", body: "Your package is at the desk." });
  const cron = async () => (await worker.fetch(new Request("https://api.subsub.work/api/cron/message-notify",
    { headers: { Authorization: "Bearer cron" } }), env)).json();
  sent.length = 0;
  let out = await cron();
  ck("nothing goes before the wait", sent.length === 0, JSON.stringify(out));
  const old = new Date(Date.now() - NOTIFY_AFTER_MS - 60000).toISOString();
  db.exec(`UPDATE messages SET created_at = '${old}'`);
  out = await cron();
  const toAdmin = sent.find((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes("admin@cascade.test"));
  ck("the office is told after the wait", !!toAdmin && /Tess Tenant/.test(toAdmin.subject) && /ceiling/.test(toAdmin.text), JSON.stringify(sent.map((m) => m.to)));
  ck("a tenant who switched email off is not", !sent.some((m) => String(m.to).includes("olly@home.test")), JSON.stringify(out));
  ck("the narrowed manager of the other building is not", !sent.some((m) => String(m.to).includes("pm3@")));
  ck("the email links to the thread", toAdmin?.text?.includes(`thread=${r1.thread.id}`));
  const n = sent.length;
  await cron();
  ck("a second run sends nothing", sent.length === n, String(sent.length));
  // Somebody who has read the thread before: their row exists, so the ledger
  // has to UPDATE it rather than insert one, or every run emails them again.
  await call(env, "admin", `/threads/${r1.thread.id}`);
  await say(env, "t1", r1.thread.id, "Still dripping.");
  db.exec(`UPDATE messages SET created_at = '${new Date(Date.now() - NOTIFY_AFTER_MS - 1000).toISOString()}' WHERE body = 'Still dripping.';
    UPDATE message_reads SET read_at = '${new Date(Date.now() - NOTIFY_AFTER_MS - 5000).toISOString()}', notified_at = '${new Date(Date.now() - NOTIFY_AFTER_MS - 5000).toISOString()}' WHERE user_id = 'admin';`);
  sent.length = 0;
  await cron();
  ck("a new message after reading is emailed once", sent.filter((m) => String(m.to).includes("admin@")).length === 1, String(sent.length));
  await cron();
  ck("and only once", sent.filter((m) => String(m.to).includes("admin@")).length === 1, String(sent.length));
}


console.log("\n-- 082: what a message is not --");
{
  ck("a day and a clock time looks like a time", looksLikeTime("Tuesday at 9 works for me"));
  ck("so does tomorrow, a date and a bare hour", looksLikeTime("can you come tomorrow") && looksLikeTime("10/14?") && looksLikeTime("around 3"));
  ck("sun damage and a saturated wall do not", !looksLikeTime("sun damage on the deck") && !looksLikeTime("the drywall is saturated"));
  ck("nor does a count", !looksLikeTime("I have 2 kids and a dog"));
  const msgs = [
    { id: "a", authorSide: "party", body: "Old leak, fixed already", photos: [{ index: 0 }], createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b", authorSide: "home", body: "Thanks", photos: [], createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "c", authorSide: "party", body: "Bathroom fan is rattling\nloud at night", photos: [{ index: 0 }, { index: 1 }], createdAt: "2026-02-01T00:00:00.000Z" },
  ];
  const seed = jobSeedFrom(msgs, "home", "2026-01-15T00:00:00.000Z");
  ck("a job seed is the other side's words since the last job", seed.title === "Bathroom fan is rattling" && !/Old leak/.test(seed.scope) && !/Thanks/.test(seed.scope), JSON.stringify(seed));
  ck("with their photos from then", seed.photos.length === 2 && seed.photos.every((p) => p.messageId === "c"));
  const mine = jobSeedFrom(msgs, "party");
  ck("a tenant's seed is their own words", /Old leak/.test(mine.scope) && /rattling/.test(mine.scope) && !/Thanks/.test(mine.scope));
}

console.log("\n-- 082: the job beside the conversation --");
{
  const db = seed(); const env = envOf(db);
  db.exec(`UPDATE jobs SET approved_at = '2026-10-01 10:00:00', created_at = '2026-10-01 09:00:00' WHERE id = 'j1';
    UPDATE work_orders SET status = 'accepted', issued_at = '2026-10-02 09:00:00', responded_at = '2026-10-02 12:00:00' WHERE id = 'wo1';
    INSERT INTO engagements(id,account_id,company_id,status) VALUES ('e9','acc1','cmp_x','active');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,issued_at)
      VALUES ('wo9','WO-9','j1','drywall','cmp_x','e9','pending','2026-10-03 09:00:00');
    INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,end_time,status,created_at)
      VALUES ('v1','acc1','j1','admin','2099-10-14','09:00','10:00','proposed','2026-10-01 09:30:00');`);
  const [, ta] = await start(env, "admin", { kind: "tenant", partyUserId: "t1", jobId: "j1", body: "Morning works?" });
  const [, ra] = await call(env, "admin", `/threads/${ta.thread.id}`);
  const cx = ra.context || {};
  ck("a job thread carries the job", cx.job?.title === "Leaking sink" && cx.job.approved === true, JSON.stringify(cx.job));
  ck("and its live window, with whose turn it is", cx.visit?.id === "v1" && Array.isArray(cx.visit.parties) && "turn" in cx.visit, JSON.stringify(cx.visit));
  const kinds = (cx.events || []).map((e) => e.kind);
  ck("and its history from the records", ["job_reported", "job_approved", "wo_issued", "wo_accepted", "visit_proposed"].every((k) => kinds.includes(k)), JSON.stringify(kinds));
  ck("in time order", (cx.events || []).every((e, i, a) => !i || a[i - 1].at <= e.at));
  ck("the office sees every work order", (cx.events || []).filter((e) => e.kind === "wo_issued").length === 2);
  ck("the office may propose a time", cx.canPropose === true && cx.viewerParty === "manager");
  ck("and a message is not an event", !(cx.events || []).some((e) => /Morning works/.test(JSON.stringify(e))));

  const [, tc] = await start(env, "sub1", { kind: "crew", jobId: "j1", body: "Parts in" });
  ck("a crew writing from its own side need not name its company", tc.thread?.partyCompanyId === "cmp1", JSON.stringify(tc));
  const [, rc] = await call(env, "sub1", `/threads/${tc.thread.id}`);
  const ce = rc.context?.events || [];
  ck("a crew sees its own work order", ce.some((e) => e.kind === "wo_issued" && e.company === "Sam Plumbing"), JSON.stringify(ce));
  ck("and not another company's", !ce.some((e) => e.company === "Stranger Roofing"), JSON.stringify(ce));
  ck("and may propose, with its work order to answer through", rc.context?.canPropose === true && rc.context.woId === "wo1" && rc.context.viewerParty === "contractor");

  const [, rt] = await call(env, "t1", `/threads/${ta.thread.id}`);
  const te = rt.context?.events || [];
  ck("the tenant is told who is booked", te.some((e) => e.kind === "wo_booked" && e.company === "Sam Plumbing"), JSON.stringify(te));
  ck("and nothing about work orders", !te.some((e) => /^wo_(issued|accepted|declined|voided)$/.test(e.kind) || e.wo));
  ck("and not a company only offered the job", !te.some((e) => e.company === "Stranger Roofing"));
  ck("the tenant who has to be let in may propose", rt.context?.canPropose === true && rt.context.viewerParty === "tenant");

  const [, to] = await start(env, "own1", { kind: "owner", partyUserId: "own1", jobId: "j1", body: "Any news?" });
  const [, ro] = await call(env, "own1", `/threads/${to.thread.id}`);
  ck("an owner proposes nothing", ro.context?.canPropose === false && ro.context.viewerParty === null, JSON.stringify(ro.context && { canPropose: ro.context.canPropose, vp: ro.context.viewerParty }));
}

console.log("\n-- 082: a job made from a conversation --");
{
  const db = seed(); const env = envOf(db);
  const up = await worker.fetch(new Request("https://api.subsub.work/api/uploads/message-photo/fan.jpg", {
    method: "PUT", body: new Uint8Array([1, 2, 3]),
    headers: { "Content-Type": "image/jpeg", "X-User-Id": "t1", "X-Account-Id": "acc1" } }), env);
  const u = await up.json();
  const [, g] = await start(env, "t1", { kind: "tenant", partyUserId: "t1", body: "The bathroom fan rattles", photos: [{ key: u.key, name: "fan.jpg" }] });
  const job = (extra) => ({ title: "Bathroom fan", propertyId: "p1", trades: ["electrical"], address: "1 Main", ...extra });
  const [sj, rj] = await call(env, "admin", "/jobs", { method: "POST", body: JSON.stringify(job({
    fromThread: { id: g.thread.id, photos: [{ messageId: g.message.id, index: 0 }] } })) });
  ck("the office makes a job from it", sj === 201 && rj.fromThread?.linked === true, `${sj} ${JSON.stringify(rj.fromThread)}`);
  ck("and the photo goes onto the job", rj.fromThread?.photos === 1 && (rj.job?.photos || []).length === 1, JSON.stringify(rj.job?.photos));
  const [, rg] = await call(env, "t1", `/threads/${g.thread.id}`);
  ck("the conversation says so, from the record", (rg.context?.events || []).some((e) => e.kind === "job_linked" && e.jobId === rj.id), JSON.stringify(rg.context));
  const [, rg2] = await call(env, "admin", `/threads/${g.thread.id}`);
  ck("and still no message was written for it", rg2.messages?.length === 1);

  const [, other] = await start(env, "admin", { kind: "tenant", partyUserId: "t2", body: "Hello Olly" });
  const [s2, r2] = await call(env, "t1", "/jobs", { method: "POST", body: JSON.stringify(job({
    reportDetail: { problem: "Fan", words: "rattles" }, fromThread: { id: other.thread.id } })) });
  ck("a tenant cannot link a report to somebody else's conversation", s2 === 201 && r2.fromThread?.linked === false, JSON.stringify(r2.fromThread));
  const [s3, r3] = await call(env, "t1", "/jobs", { method: "POST", body: JSON.stringify(job({
    reportDetail: { problem: "Fan", words: "rattles" }, fromThread: { id: g.thread.id } })) });
  ck("but can link their own report to their own", s3 === 201 && r3.fromThread?.linked === true, JSON.stringify(r3.fromThread));
  const [, jt] = await start(env, "t1", { kind: "tenant", partyUserId: "t1", jobId: "j1", body: "x",
    photos: [{ key: u.key, name: "fan.jpg" }] });
  const [, r4] = await call(env, "admin", "/jobs", { method: "POST", body: JSON.stringify(job({ fromThread: { id: jt.thread.id } })) });
  ck("a job thread is already about a job, so it links nothing", r4.fromThread?.linked === false);
  const [, r5] = await call(env, "admin", "/jobs", { method: "POST", body: JSON.stringify(job({
    fromThread: { id: g.thread.id, photos: [{ messageId: jt.message.id, index: 0 }] } })) });
  ck("a photo from outside the conversation is not carried", r5.fromThread?.linked === true && r5.fromThread.photos === 0, JSON.stringify(r5.fromThread));
  db.exec(`DROP TABLE thread_job_links`);
  const [s6, r6] = await call(env, "admin", "/jobs", { method: "POST", body: JSON.stringify(job({ fromThread: { id: g.thread.id } })) });
  ck("without 082 the job is still made, and the reply names the file", s6 === 201 && r6.fromThread?.linked === false
    && r6.fromThread.migration === "082_thread_job_links", `${s6} ${JSON.stringify(r6.fromThread)}`);
}

console.log("\n-- a database without 081 --");
{
  const db = seed(); db.exec(`DROP TABLE messages; DROP TABLE message_reads; DROP TABLE message_threads;`);
  const env = envOf(db);
  const [s, r] = await call(env, "admin", "/threads");
  ck("the inbox names the file to paste", s === 200 && r.migration === "081_messages", JSON.stringify(r));
  const [s2, r2] = await start(env, "t1", { kind: "tenant", partyUserId: "t1", body: "hi" });
  ck("and writing says so", s2 === 503 && r2.migration === "081_messages", `${s2} ${JSON.stringify(r2)}`);
}

console.log("\n-- CHECK.sql --");
{
  const db = seed(); const env = envOf(db);
  await start(env, "t1", { kind: "tenant", partyUserId: "t1", body: "hello" });
  ck("a clean database reads zero", runCheck(db).m081_inv_empty_message === 0 && runCheck(db).m081_inv_thread_party === 0);
  db.exec(`INSERT INTO messages(id,thread_id,author_side,body,photos,created_at)
    SELECT 'mbad', id, 'home', '  ', '[]', '2026-01-01T00:00:00.000Z' FROM message_threads LIMIT 1;
    INSERT INTO message_threads(id,thread_key,account_id,kind,party_user_id,party_company_id,created_at,last_at)
    VALUES ('tbad','k-bad','acc1','tenant','t1','cmp1','x','x');`);
  const r = runCheck(db);
  ck("an empty message is counted", r.m081_inv_empty_message === 1, JSON.stringify(r.m081_inv_empty_message));
  ck("a thread with two parties is counted", r.m081_inv_thread_party === 1, JSON.stringify(r.m081_inv_thread_party));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
