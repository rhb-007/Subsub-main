// INVITING A HANDYMAN PRODUCED A SUBCONTRACTOR, and nothing anywhere said so.
//
// Reported as *"when I go to signup a new user I don't see any settings for a
// handyman"*. 058 put the relationship on `engagements` and the picker for it
// on the add-a-contractor form. That form is one of two doors. The other is
// the blank invite, and it creates NO engagement at all -- there is nothing
// but a `sub_invites` row until somebody opens the link, at which point
// `createApplication` writes the company, the engagement and the seat in one
// go, with no word to write.
//
// So the door used for the person who has no SubSub account -- which is
// exactly the person most likely to be a handyman -- could only produce a
// subcontractor, whose own portal then demanded a certificate of insurance
// and a surety bond he will never hold, and who could not be given a job
// until somebody noticed and edited his card. The permanently-amber failure
// `docs.js` exists to prevent, reached through the commonest door.
//
// What this pins, and each line is one mutation:
//
//   THE WORD RIDES ON THE INVITE and is applied to the engagement at
//   redemption. Both halves, because either alone is a feature that stores
//   an answer nobody reads or reads an answer nobody stored.
//
//   IT IS THE ACCOUNT'S WORD, NEVER THE APPLICANT'S. `wantAs` comes off the
//   invite row the account created; `body` is typed by whoever opened the
//   link, and a contractor naming themselves a handyman would be excusing
//   their own insurance.
//
//   NEVER OVER AN EXISTING ENGAGEMENT. A company already on this roster has a
//   relationship somebody set, and an invite raised afterwards must not
//   silently reclassify it.
//
//   REFUSED ON AN ACCOUNT KIND THAT MAY NOT ENGAGE ONE, rather than defaulted
//   -- silence is only safe when nothing was asked.
//
//   CORRECTABLE UNTIL THEY ACCEPT, and changing it does NOT reissue the link:
//   nothing went to the wrong person, the form simply asks different
//   questions.
//
//   AND THE FORM THEY LAND ON FOLLOWS. `GET /api/invite/:token` carries the
//   word so the signup screen can stop asking a maintenance worker for a
//   contractor licence and stop offering him sixteen trades `mayCover`
//   refuses at the work order -- the screen looser than the route, on the one
//   form whose reader cannot find that out.
//
//   node --no-warnings scripts/invite-engaged-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { TRADES } from "../shared/trades.js";
import { HANDYMAN_TRADES } from "../shared/engaged.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

// Resend and Supabase are stubbed at `fetch`, the same boundary every other
// suite here uses. Redeeming an invite mints a login, so without this the
// whole second half of the loop is unreachable.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes("api.resend.com")) return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
  if (/supabase/.test(u)) return new Response("{}", { status: 200 });
  return realFetch(url, opts);
};

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      -- A managing agent: has buildings, so it has handyman work.
      ('acc1','Sound Property Management','property_manager','soundpm','scale'),
      -- A general contractor: works job to job under a prime contract, so the
      -- word is refused. The discriminating half of every kind assertion.
      ('acc2','Outerhome','general_contractor','outerhome','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_admin','Christopher Lane','chris@soundpm.test'),
      ('u_pm','Dana Pine','dana@soundpm.test'),
      ('u_gc','Ray Beck','ray@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m1','u_admin','acc1','admin'),
      ('m2','u_pm','acc1','pm'),
      ('m3','u_gc','acc2','admin');
  `);
  return { db, env: { DB: makeD1(db), RESEND_API_KEY: "re_stub",
    MAIL_FROM: "SubSub <no-reply@subsub.work>", APP_DOMAIN: "subsub.work" } };
};

const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const make = (env, body, who = "u_admin", acct = "acc1") => worker.fetch(
  new Request("https://api.subsub.work/api/invites", {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const patch = (env, id, body, who = "u_admin", acct = "acc1") => worker.fetch(
  new Request(`https://api.subsub.work/api/invites/${id}`, {
    method: "PATCH", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const look = (env, token) => worker.fetch(
  new Request(`https://api.subsub.work/api/invite/${token}`), env);
const redeem = (env, token, body) => worker.fetch(
  new Request(`https://api.subsub.work/api/invite/${token}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }), env);
const tokenOf = (db, id) => db.prepare(`SELECT token FROM sub_invites WHERE id = ?`).get(id)?.token;
const rowOf = (db, id) => db.prepare(`SELECT * FROM sub_invites WHERE id = ?`).get(id);
const engagement = (db, co) =>
  db.prepare(`SELECT * FROM engagements WHERE account_id='acc1' AND company_id = ?`).get(co);

// What whoever opens the link types. A real application: company, contact,
// address, trades.
const application = (extra = {}) => ({
  company: "Pacific apartment maintenance", contact: "Juan Soto",
  email: "juan@pacificam.test", phone: "2067778899",
  city: "Seattle", state: "WA", zip: "98101",
  categories: ["plumbing"], notifyEmail: true,
  ...extra,
});

try {
  // -------------------------------------------------------------------------
  console.log("\n-- the word rides on the invite --");
  {
    const { db, env } = seed();
    const [s, b] = await json(await make(env,
      { companyName: "Pacific apartment maintenance", contact: "Juan Soto",
        email: "juan@pacificam.test", engagedAs: "handyman" }));
    ck("a handyman invite is accepted", s === 201, `${s} ${JSON.stringify(b)}`);
    // Stored, not merely echoed. The reply could be right over a column that
    // never took the value, which is the half that matters at redemption.
    const row = db.prepare(`SELECT * FROM sub_invites WHERE account_id='acc1'`).get();
    ck("and it is written to the column", row?.engaged_as === "handyman", String(row?.engaged_as));
    ck("and comes back on the row shape", b.engagedAs === "handyman", String(b.engagedAs));
    ck("and the account is told it was recorded", b.engagedAsRecorded === true,
      String(b.engagedAsRecorded));
  }

  {
    // NULL means subcontractor. Writing the word would be a second spelling
    // of the ordinary state, and it is also the value that lets an invite be
    // created on a database without 059 at all.
    const { db, env } = seed();
    await make(env, { companyName: "Cascade Roofworks", email: "ops@cascade.test" });
    const row = db.prepare(`SELECT * FROM sub_invites WHERE account_id='acc1'`).get();
    ck("an ordinary invite stores nothing", row?.engaged_as === null, String(row?.engaged_as));
    const [, b] = await json(await look(env, row.token));
    ck("and reads back as a subcontractor", b.engagedAs === "subcontractor", String(b.engagedAs));
  }

  {
    // A link to hand over in person writes the same engagement when it is
    // opened, so leaving the word off that door would make the relationship
    // depend on which button was pressed.
    const { db, env } = seed();
    await make(env, { companyName: "Pacific apartment maintenance", engagedAs: "handyman" });
    const row = db.prepare(`SELECT * FROM sub_invites WHERE account_id='acc1'`).get();
    ck("a link-only invite carries it too", row?.engaged_as === "handyman", String(row?.engaged_as));
  }

  // -------------------------------------------------------------------------
  console.log("\n-- and is applied when they arrive --");
  {
    const { db, env } = seed();
    const [, made] = await json(await make(env,
      { companyName: "Pacific apartment maintenance", contact: "Juan Soto",
        email: "juan@pacificam.test", engagedAs: "handyman" }));
    const token = db.prepare(`SELECT token FROM sub_invites WHERE id = ?`).get(made.id).token;

    const [s, b] = await json(await redeem(env, token, application()));
    ck("the invite is redeemed", s === 200, `${s} ${JSON.stringify(b)}`);
    const co = db.prepare(`SELECT id FROM companies WHERE company LIKE 'Pacific%'`).get()?.id;
    ck("a company row exists", !!co, String(co));
    const en = engagement(db, co);
    // THE WHOLE POINT. Without this the picker stores an answer nobody reads.
    ck("and the engagement says handyman", en?.engaged_as === "handyman", String(en?.engaged_as));
  }

  {
    // AND THE KIND IS RE-ASKED AT REDEMPTION, which is what caught the column
    // this suite's first run found missing: `lookupInvite` selected six
    // columns of `accounts` and `kind` was not one, so `mayEngageHandyman`
    // answered false for every account and the word was dropped on the way
    // in -- correctly, quietly, and for the wrong reason.
    //
    // An account that has stopped being the kind that may engage one since
    // the invite went out is the case the check exists for, and it is the only
    // fixture either behaviour can be told apart on.
    const { db, env } = seed();
    const [, made] = await json(await make(env,
      { companyName: "Pacific apartment maintenance", email: "juan@pacificam.test",
        engagedAs: "handyman" }));
    db.prepare(`UPDATE accounts SET kind = 'general_contractor' WHERE id = 'acc1'`).run();
    const token = db.prepare(`SELECT token FROM sub_invites WHERE id = ?`).get(made.id).token;
    await redeem(env, token, application());
    const co = db.prepare(`SELECT id FROM companies WHERE company LIKE 'Pacific%'`).get()?.id;
    ck("a kind that may no longer engage one drops the word",
      engagement(db, co)?.engaged_as === null, String(engagement(db, co)?.engaged_as));
  }

  {
    // The other branch, in the same place: a fix that wrote "handyman" onto
    // every redemption would pass every assertion above.
    const { db, env } = seed();
    const [, made] = await json(await make(env,
      { companyName: "Cascade Roofworks", contact: "Mia Cross",
        email: "mia@cascade.test" }));
    const token = db.prepare(`SELECT token FROM sub_invites WHERE id = ?`).get(made.id).token;
    await redeem(env, token, application({ company: "Cascade Roofworks",
      contact: "Mia Cross", email: "mia@cascade.test", categories: ["roofing"] }));
    const co = db.prepare(`SELECT id FROM companies WHERE company='Cascade Roofworks'`).get()?.id;
    ck("an ordinary invite still joins as a subcontractor",
      engagement(db, co)?.engaged_as === null, String(engagement(db, co)?.engaged_as));
  }

  {
    // IT IS THE ACCOUNT'S WORD, NEVER THE APPLICANT'S. Whoever opens the link
    // types the body; letting it carry this would let a contractor excuse
    // their own insurance and bond on somebody else's roster.
    const { db, env } = seed();
    const [, made] = await json(await make(env,
      { companyName: "Cascade Roofworks", email: "mia@cascade.test" }));
    const token = db.prepare(`SELECT token FROM sub_invites WHERE id = ?`).get(made.id).token;
    await redeem(env, token, application({ company: "Cascade Roofworks",
      contact: "Mia Cross", email: "mia@cascade.test", engagedAs: "handyman" }));
    const co = db.prepare(`SELECT id FROM companies WHERE company='Cascade Roofworks'`).get()?.id;
    ck("the applicant cannot name themselves a handyman",
      engagement(db, co)?.engaged_as === null, String(engagement(db, co)?.engaged_as));
  }

  {
    // NEVER OVER AN EXISTING ENGAGEMENT. The relationship on a company already
    // on this roster is one somebody set, and an invite raised afterwards --
    // to give them a login they never got -- must not silently reclassify it.
    const { db, env } = seed();
    db.exec(`
      INSERT INTO companies(id,company,contact,email) VALUES
        ('cmp_pac','Pacific apartment maintenance','Juan Soto','juan@pacificam.test');
      INSERT INTO engagements(id,account_id,company_id,status,categories,engaged_as)
        VALUES ('en_pac','acc1','cmp_pac','active','["plumbing"]','subcontractor');
    `);
    const [, made] = await json(await make(env,
      { companyName: "Pacific apartment maintenance", email: "juan@pacificam.test",
        engagedAs: "handyman" }));
    const token = db.prepare(`SELECT token FROM sub_invites WHERE id = ?`).get(made.id).token;
    await redeem(env, token, application());
    ck("an engagement that already exists keeps its own answer",
      engagement(db, "cmp_pac")?.engaged_as === "subcontractor",
      String(engagement(db, "cmp_pac")?.engaged_as));
  }

  // -------------------------------------------------------------------------
  console.log("\n-- which accounts may say it --");
  {
    const { env } = seed();
    const [s, b] = await json(await make(env,
      { companyName: "Somebody", email: "x@y.test", engagedAs: "handyman" },
      "u_gc", "acc2"));
    // REFUSED, not defaulted. A rule filed against an account that cannot act
    // on it is a control whose save is thrown away.
    ck("a general contractor cannot invite a handyman",
      s === 403 && b.error === "not_a_handyman_account", `${s} ${JSON.stringify(b)}`);
  }
  {
    const { env } = seed();
    const [s, b] = await json(await make(env,
      { companyName: "Somebody", email: "x@y.test" }, "u_gc", "acc2"));
    ck("but may still invite a subcontractor", s === 201, `${s} ${JSON.stringify(b)}`);
  }
  {
    const { env } = seed();
    const [s, b] = await json(await make(env,
      { companyName: "Somebody", email: "x@y.test", engagedAs: "plumber" }));
    // A word nothing recognises is refused rather than read as the default.
    // Silence is only safe when nothing was asked; here something was.
    ck("an unrecognised relationship is refused",
      s === 400 && b.error === "bad_engaged_as", `${s} ${JSON.stringify(b)}`);
  }
  {
    const { env } = seed();
    const [s] = await json(await make(env,
      { companyName: "Pacific apartment maintenance", email: "juan@pacificam.test",
        engagedAs: "handyman" }, "u_pm"));
    // Same seats as creating any other invite. A project manager chasing a
    // contractor is exactly who meets the handyman on site.
    ck("a project manager may do it", s === 201, String(s));
  }

  // -------------------------------------------------------------------------
  console.log("\n-- correctable until they accept --");
  {
    const { db, env } = seed();
    const [, made] = await json(await make(env,
      { companyName: "Pacific apartment maintenance", email: "juan@pacificam.test" }));
    const before = tokenOf(db, made.id);
    const [s, b] = await json(await patch(env, made.id, { engagedAs: "handyman" }));
    ck("it saves", s === 200, `${s} ${JSON.stringify(b)}`);
    ck("and the column moves", rowOf(db, made.id).engaged_as === "handyman",
      String(rowOf(db, made.id).engaged_as));
    // CHANGING IT IS NOT CHANGING AN ADDRESS. Nothing went to the wrong
    // person, so killing the link already in somebody's inbox would cost them
    // their invitation to fix a classification.
    ck("the link is untouched", tokenOf(db, made.id) === before);
    ck("and the reply does not claim otherwise", b.reissued === false, String(b.reissued));
  }
  {
    // Back again, and it stores NULL rather than the word -- or there would be
    // two spellings of the ordinary state and `engagedAs()` would be reading
    // one of them by luck.
    const { db, env } = seed();
    const [, made] = await json(await make(env,
      { companyName: "Pacific apartment maintenance", email: "juan@pacificam.test",
        engagedAs: "handyman" }));
    const [s] = await json(await patch(env, made.id, { engagedAs: "subcontractor" }));
    ck("switching back saves", s === 200, String(s));
    ck("and stores NULL, not the word", rowOf(db, made.id).engaged_as === null,
      String(rowOf(db, made.id).engaged_as));
  }
  {
    const { env } = seed();
    const [, made] = await json(await make(env,
      { companyName: "Somebody", email: "x@y.test" }, "u_gc", "acc2"));
    const [s, b] = await json(await patch(env, made.id, { engagedAs: "handyman" },
      "u_gc", "acc2"));
    // The same refusal the create route gives, from the same predicate. A
    // screen that could set it by one door and not the other would be two
    // answers to one question.
    ck("and the kind is checked here too",
      s === 403 && b.error === "not_a_handyman_account", `${s} ${JSON.stringify(b)}`);
  }
  {
    const { env } = seed();
    const [, made] = await json(await make(env,
      { companyName: "Pacific apartment maintenance", email: "juan@pacificam.test" }));
    const [s, b] = await json(await patch(env, made.id, { engagedAs: "plumber" }));
    ck("an unrecognised word is refused on the way in too",
      s === 400 && b.error === "bad_engaged_as", `${s} ${JSON.stringify(b)}`);
  }
  {
    // Editing is bounded at acceptance, and this is what makes correcting the
    // relationship a decision rather than a rewrite of somebody's record.
    const { db, env } = seed();
    const [, made] = await json(await make(env,
      { companyName: "Pacific apartment maintenance", email: "juan@pacificam.test" }));
    db.prepare(`UPDATE sub_invites SET used_at = '2026-09-30 10:00:00' WHERE id = ?`).run(made.id);
    const [s, b] = await json(await patch(env, made.id, { engagedAs: "handyman" }));
    ck("once accepted it is their card's answer, not the invite's",
      s === 409 && b.error === "already_accepted", `${s} ${JSON.stringify(b)}`);
  }

  // -------------------------------------------------------------------------
  console.log("\n-- and the form they land on follows --");
  {
    const { db, env } = seed();
    const [, made] = await json(await make(env,
      { companyName: "Pacific apartment maintenance", email: "juan@pacificam.test",
        engagedAs: "handyman" }));
    const token = tokenOf(db, made.id);
    const [s, b] = await json(await look(env, token));
    ck("the public lookup answers", s === 200, `${s} ${JSON.stringify(b)}`);
    // Without this the signup screen cannot know, so it asks a maintenance
    // worker for a WA L&I number over a line promising to check it against
    // the state registry, and offers him sixteen trades this account can
    // never assign him.
    ck("and carries the relationship", b.engagedAs === "handyman", String(b.engagedAs));
  }

  // The trade list the form narrows to is the one the work order is refused
  // on, not a second copy of it -- which is the only thing that makes the
  // screen agree with the route.
  ck("the lighter list is a strict subset of the trades",
    HANDYMAN_TRADES.every((t) => TRADES.some((x) => x.id === t))
      && HANDYMAN_TRADES.length < TRADES.length,
    `${HANDYMAN_TRADES.length} of ${TRADES.length}`);

  // -------------------------------------------------------------------------
  console.log("\n-- the screens read the one rule --");
  {
    const src = readFileSync(join(app, "src", "App.tsx"), "utf8");
    // Both doors, and the gate is the same predicate the route reads. A
    // picker on an account kind the server refuses is a control whose save is
    // thrown away; one missing from an account that may use it is this bug.
    const mounts = (src.match(/canEngageHandyman=\{mayEngageHandyman\(kindOf\(account\)\)\}/g) || []).length;
    ck("every form that can set it reads the same gate", mounts >= 4, String(mounts));
    // The invite panel is the one that was missing. Named rather than counted,
    // because a count is satisfied by four mounts on the wrong components.
    ck("the invite form has the picker",
      /<InviteLinks[\s\S]{0,400}?canEngageHandyman=/.test(src));
    ck("and so does the outstanding-invite panel",
      /<InvitedPanel[\s\S]{0,400}?canEngageHandyman=/.test(src));
    // The signup form narrows the grid rather than rendering CATEGORIES flat,
    // which is what it did and is why picking Roofing produced a slot nobody
    // could fill.
    ck("the signup form narrows its trade grid",
      /\{applyTrades\.map\(/.test(src) && !/\{CATEGORIES\.map\(\(c\) => \(\s*<button key=\{c\.id\} type="button"\s*className=\{`wl-pick/.test(src));
  }

  // -------------------------------------------------------------------------
  console.log("\n-- the migration is recorded where an operator looks --");
  {
    const chk = readFileSync(join(app, "worker", "migrations", "CHECK.sql"), "utf8");
    ck("CHECK.sql asks whether 059 ran", /m059_invite_engaged_as/.test(chk));
    // Counted on the invite as well as the engagement: a bad value sitting on
    // an unredeemed invite shows up today, and on `engagements` the day
    // somebody opens the link.
    ck("and counts the two faults one table earlier",
      /m059_inv_unknown_engaged_as/.test(chk) && /m059_inv_handyman_wrong_kind/.test(chk));
    // COMMENTS STRIPPED FIRST. The migration's own prose explains that
    // `ALTER TABLE ... ADD COLUMN` is the statement that cannot be run twice,
    // which reads to a substring count exactly like two more of them -- the
    // trap this repository has now paid for five times, and the first version
    // of this assertion duly failed on the explanation.
    const sql = readFileSync(join(app, "worker", "migrations", "059_invite_engaged_as.sql"), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    ck("and 059 is one ALTER TABLE, which is one paste",
      (sql.match(/ALTER TABLE/gi) || []).length === 1,
      String((sql.match(/ALTER TABLE/gi) || []).length));
  }
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
