// Who is asking -- and the line that keeps it from being a directory.
//
// Accept and Decline with nothing but a name was a decision made blind: the
// card says these people will be able to send you work orders and read your
// compliance documents, and gave no way at all to find out who they are.
//
// Answering that is not the same as building a directory, and the difference
// is structural rather than a matter of care:
//
//   It is keyed by the REQUEST, not the account. There is no route that takes
//   an account id and describes it, so there is nothing to walk. The only way
//   to see any of this is for that account to have asked YOU.
//
//   It is open only while the question is. A declined request is finished
//   business and an accepted one means they are already working together.
//
//   It is COUNTS AND AREAS, never lists -- the same line the lien-waiver
//   roll-up draws. How many buildings and which towns, never an address. How
//   much work, never which jobs. Their contractor roster is not in it at all:
//   that is their book, and it tells the answering side nothing about whether
//   to say yes.
//
// The principle is the one overflow already runs on: answering a post makes
// you known to the account that posted it, because you chose to answer.
// Asking to connect makes you known to the account you asked, for the same
// reason and for exactly as long as the question is open.
//
//   node scripts/connect-asker-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M030 = readFileSync(new URL("../worker/migrations/030_connect_requests.sql", import.meta.url), "utf8");
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;

// Cascade, a managing agent with a portfolio, has asked Outerhome -- a general
// contractor, and therefore a company somebody can answer for -- to connect.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M030, M031] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,trades,created_at) VALUES
      ('acc_pm','Cascade Management','cascade','property_manager','["siding","roofing"]','2025-03-14 09:00:00'),
      ('acc_oh','Outerhome','outerhome','general_contractor',NULL,'2026-01-05 09:00:00'),
      ('acc_x','Someone Else','elsewhere','general_contractor',NULL,'2026-02-02 09:00:00');
    INSERT INTO companies(id,company,contact,city,state) VALUES
      ('cmp_oh','Outerhome','Richard Braun','Seattle','WA'),
      ('cmp_x','Someone Else','Nobody','Tacoma','WA');
    UPDATE accounts SET company_id='cmp_oh' WHERE id='acc_oh';
    UPDATE accounts SET company_id='cmp_x' WHERE id='acc_x';
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_priya','Priya Manager','priya@cascade.test','auth_priya'),
      ('u_rb','Richard Braun','rb@outerhome.test','auth_rb'),
      ('u_x','Other Admin','other@elsewhere.test','auth_x');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_priya','u_priya','acc_pm','admin'),
      ('m_rb','u_rb','acc_oh','admin'),
      ('m_x','u_x','acc_x','admin');
    -- Cascade's portfolio. The COUNT and the TOWNS may cross; the addresses
    -- are the thing that must not.
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('p1','acc_pm','12 Cedar St','12 Cedar St','Seattle','WA','98101'),
      ('p2','acc_pm','40 Elm Ave','40 Elm Ave','Bellevue','WA','98004'),
      ('p3','acc_pm','9 Birch Ln','9 Birch Ln','Tacoma','WA','98402');
    -- Work they have run. A count, never a list.
    INSERT INTO jobs(id,account_id,title,status,property_id) VALUES
      ('j1','acc_pm','Roof replaced','completed','p1'),
      ('j2','acc_pm','Gutter clean','active','p2');
    -- Their roster. NONE of this may appear.
    INSERT INTO companies(id,company,contact,email,phone) VALUES
      ('cmp_ridge','Ridge Roofing','Sam Ridge','sam@ridge.test','2065550100');
    INSERT INTO engagements(id,account_id,company_id,status,categories)
      VALUES ('en1','acc_pm','cmp_ridge','active','["roofing"]');
    INSERT INTO connect_requests(id,account_id,company_id,status,via,requested_by,message)
      VALUES ('cr1','acc_pm','cmp_oh','pending','lookup','u_priya','We have siding work in Ballard.');
  `);
  return { db, env: { DB: makeD1(db) } };
};

const call = (env, who, acct, path, opts = {}) => worker.fetch(
  new Request(`https://api.subsub.work/api${path}`, { ...opts,
    headers: { "Content-Type": "application/json", "X-User-Id": who,
               "X-Account-Id": acct, ...(opts.headers || {}) } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

console.log("\n-- the account being asked can see who is asking --");
{
  const { env } = seed();
  const [s, b] = await json(await call(env, "u_rb", "acc_oh", "/my-connect-requests/cr1/asker"));
  ck("it answers the company the request was sent to", s === 200, `${s} ${JSON.stringify(b).slice(0, 80)}`);
  ck("naming the account asking", b.account === "Cascade Management", String(b.account));
  ck("and what kind of outfit they are", b.kind === "property_manager", String(b.kind));
  ck("how long they have been here", /2025-03-14/.test(String(b.since)), String(b.since));
  ck("who actually asked", b.askedBy === "Priya Manager", String(b.askedBy));
  ck("and what they wrote", /siding work in Ballard/.test(b.message || ""), String(b.message));

  // COUNTS AND AREAS.
  ck("how many buildings", b.buildings === 3, String(b.buildings));
  ck("and which towns", JSON.stringify(b.towns) === '["Bellevue, WA","Seattle, WA","Tacoma, WA"]',
    JSON.stringify(b.towns));
  ck("how much work has gone through", b.jobs === 2, String(b.jobs));
  ck("and what they hire for", JSON.stringify(b.trades) === '["siding","roofing"]', JSON.stringify(b.trades));

  // NEVER LISTS. This is the whole line.
  const wire = JSON.stringify(b);
  ck("no building address crosses", !/12 Cedar St|40 Elm Ave|9 Birch Ln/.test(wire), wire);
  ck("nor a postcode", !/98101|98004|98402/.test(wire), wire);
  ck("no job of theirs is named", !/Roof replaced|Gutter clean/.test(wire), wire);
  // Their contractor book is the thing this product refuses everywhere else.
  ck("and not one of their contractors", !/Ridge Roofing|sam@ridge/.test(wire), wire);
  ck("nor a count of them", !/"contractors"|"roster"/.test(wire), wire);
}

console.log("\n-- and nobody else can see it --");
{
  const { env } = seed();
  // A company the request was not sent to. Same request id, guessed or shared.
  const [s, b] = await json(await call(env, "u_x", "acc_x", "/my-connect-requests/cr1/asker"));
  ck("a company it was not sent to gets nothing", s === 404, `${s} ${JSON.stringify(b)}`);
  // The asking account cannot read its own request back through this door --
  // it is the answering side's screen. A managing agent is not a company here
  // at all, so it never gets as far as the request: seatCompany has nothing to
  // resolve and the answer is "you have no company on SubSub", which is the
  // more accurate refusal of the two.
  const [s2] = await json(await call(env, "u_priya", "acc_pm", "/my-connect-requests/cr1/asker"));
  ck("and neither can the account that sent it", s2 === 403, String(s2));
  // A general contractor DOES have a company, so it gets as far as the lookup
  // and is refused there instead -- the request is not addressed to them.
  const [s3, b3] = await json(await call(env, "u_x", "acc_x", "/my-connect-requests/cr1/asker"));
  ck("and a company with a seat is refused at the request, not the door",
    s3 === 404 && b3.error === "not_found", `${s3} ${b3.error}`);
}

console.log("\n-- it is open only while the question is --");
{
  const { db, env } = seed();
  db.exec(`UPDATE connect_requests SET status='declined' WHERE id='cr1'`);
  const [s, b] = await json(await call(env, "u_rb", "acc_oh", "/my-connect-requests/cr1/asker"));
  ck("an answered request closes it", s === 409 && b.error === "already_answered", `${s} ${b.error}`);

  const { db: db2, env: env2 } = seed();
  db2.exec(`UPDATE connect_requests SET status='accepted' WHERE id='cr1'`);
  const [s2] = await json(await call(env2, "u_rb", "acc_oh", "/my-connect-requests/cr1/asker"));
  ck("and so does an accepted one", s2 === 409, String(s2));
}

console.log("\n-- and there is no way to walk it --");
{
  // THE STRUCTURAL GUARANTEE. Every route that describes an account is keyed
  // by something the caller was given, never by an account id they could
  // iterate. A route taking :accountId would be a directory whatever it
  // returned, so the assertion is on the shape rather than on the payload.
  const src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  const askers = [...src.matchAll(/app\.get\(\s*"([^"]*asker[^"]*)"/g)].map((m) => m[1]);
  ck("there is exactly one route that describes an asking account",
    askers.length === 1, JSON.stringify(askers));
  ck("and it is keyed by the request", askers[0] === "/api/my-connect-requests/:id/asker",
    String(askers[0]));
  ck("never by an account", !/:accountId/.test(askers[0]), String(askers[0]));

  // And it is scoped to the seat's own company before anything is read.
  const at = src.indexOf(`app.get("/api/my-connect-requests/:id/asker"`);
  const body = src.slice(at, at + 900);
  ck("the seat's company is resolved first", /seatCompany\(c\)/.test(body));
  ck("and the request is matched against it",
    /cr\.id = \? AND cr\.company_id = \?/.test(body), body.slice(0, 200));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
