// Taking a contractor off a roster.
//
// There was NO WAY TO DO THIS AT ALL. `engagements.status` has carried `ended`
// since the schema was written, eleven reads in the Worker guard on it, and
// nothing anywhere ever wrote one -- so the only way to stop working with a
// contractor was to leave them on the roster and not pick them.
//
// What this covers is the handful of properties no screen can report:
//
//   NOTHING IS DELETED. `companies` is a shared row read by every account that
//   engages them; the jobs, the work orders and the releases are what answer
//   "were they insured on the day of that job"; and their certificates are
//   their own records. Ending it writes a status and nothing else.
//
//   THE GATE IS ON THE SERVER. A removed contractor being off the roster
//   screen is not the same as being unassignable. POST /api/jobs/:jobId/assign
//   read the engagement with no status check at all, so the browser hid them
//   and the route issued the work order anyway.
//
//   PAUSED MEANS SOMETHING. It is refused by the same gate as ended, which is
//   what makes offering the control honest: a state nothing reads is a state
//   the screen lies about.
//
//   THE SEAT GOES AND THE PERSON DOES NOT. Access is a membership; a person is
//   global and holds seats in other accounts.
//
//   LIVE WORK DOES NOT BLOCK. Same call the building handover makes: a repair
//   going nowhere is very often WHY somebody is being removed. It is named on
//   the way out instead.
//
//   IT IS REVERSIBLE, and a stranger's company reads as missing rather than
//   forbidden so this cannot be walked to find out which ids are real.
//
//   AND PATCH IS NOT A SECOND DOOR. Writing the column without taking the seat
//   and the auto-schedule flag with it would leave a standing permission
//   nobody is watching.
//
//   node --no-warnings scripts/remove-sub-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const R = await import("../shared/roster.js");

const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const WORKER = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");

const GC = "acc_gc", SUB_CO = "cmp_bay", OTHER_CO = "cmp_stranger";

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO companies(id,company,contact,email,phone,mail_street,city,state,zip,license,insurance,bond,contract,w9,doc_files) VALUES
      ('cmp_gc','Outerhome LLC','Dana','dana@outerhome.test','2065550001','1 Pike St','Seattle','WA','98101','OUTERH*111',1,1,1,1,'{}'),
      ('${SUB_CO}','Bay Roofing Inc','Rae','rae@bay.test','2065550002','9 Dock Rd','Tacoma','WA','98402','BAYRR*222',1,1,1,1,
       '{"insurance":"coi.pdf","bond":"bond.pdf","contract":"agr.pdf","w9":"w9.pdf"}'),
      ('${OTHER_CO}','Somebody Elses Roofer','Kit','kit@else.test','2065550009','2 Elm','Olympia','WA','98501',NULL,1,1,1,1,'{}');
    INSERT INTO accounts(id,name,subdomain,kind,plan,company_id) VALUES
      ('${GC}','Outerhome','outerhome','general_contractor','scale','cmp_gc'),
      ('acc_other','Cascade Management','cascade','property_manager','scale',NULL);
    -- Every document verified, so nothing but the roster status can be what
    -- refuses an assignment below.
    INSERT INTO engagements(id,account_id,company_id,status,categories,auto_schedule,doc_review) VALUES
      ('en1','${GC}','${SUB_CO}','active','["roofing"]',1,
       '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}');
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en2','acc_other','${OTHER_CO}','active','["roofing"]');
    INSERT INTO properties(id,account_id,owner_account_id,name,address,city,state,zip) VALUES
      ('p1','${GC}','${GC}','Cedar Park','5 Cedar','Seattle','WA','98101');
    INSERT INTO jobs(id,account_id,property_id,title,date,trades,status) VALUES
      ('j1','${GC}','p1','Reroof unit 3','2026-11-02','["roofing"]','active'),
      ('j2','${GC}','p1','Gutters','2026-11-20','["roofing"]','active');
    INSERT INTO users(id,name,email) VALUES
      ('u_gc','Dana Ruiz','dana@outerhome.test'),
      ('u_pm','Pat Lee','pat@outerhome.test'),
      ('u_sub','Rae Okafor','rae@bay.test'),
      ('u_sub2','Sam Ojo','sam@bay.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_gc','u_gc','${GC}','admin'),
      ('m_pm','u_pm','${GC}','pm');
    -- Two contractor seats, so "the seat goes" is not satisfied by there
    -- being nothing to remove.
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_s1','u_sub','${GC}','contractor','${SUB_CO}'),
      ('m_s2','u_sub2','${GC}','contractor','${SUB_CO}');
  `);
  return db;
};

const ENV = (db) => ({ DB: makeD1(db) });
const GC_SEAT = { u: "u_gc", a: GC };
const PM_SEAT = { u: "u_pm", a: GC };

const call = async (env, path, { method = "GET", seat = GC_SEAT, body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    headers: { "X-User-Id": seat.u, "X-Account-Id": seat.a, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const assign = (env, jobId = "j1", companyId = SUB_CO) => call(env, `/api/jobs/${jobId}/assign`, {
  method: "POST", body: { trade: "roofing", companyId, value: 400000, responseWindow: 48 },
});

// ---------------------------------------------------------------------------
console.log("-- the rule: which states are off the roster, and which are not --");
{
  ck("invited is ON the roster", R.onRoster("invited"));
  ck("active is ON the roster", R.onRoster("active"));
  ck("paused is OFF", !R.onRoster("paused"));
  ck("ended is OFF", !R.onRoster("ended"));
  // Missing means active. Every engagement written before this carries
  // `invited` or `active`, and a row read from an older shape must not vanish
  // off somebody's roster because a column did not come back.
  ck("and a missing status is ON, not off", R.onRoster(null) && R.onRoster(undefined) && R.onRoster(""));

  // One record, so the SQL guard and the browser's filter cannot disagree.
  const sql = R.onRosterSql("en.status");
  ck("the SQL guard names every off-roster state and no other",
    R.OFF_ROSTER.every((s) => sql.includes(`'${s}'`))
      && !sql.includes("'invited'") && !sql.includes("'active'"), sql);
  ck("and it is built from the list rather than written out beside it",
    sql === `en.status NOT IN (${R.OFF_ROSTER.map((s) => `'${s}'`).join(", ")})`, sql);
}

console.log("\n-- ending it writes a status and DELETES NOTHING --");
{
  const db = seed(); const env = ENV(db);
  const before = {
    company: db.prepare(`SELECT * FROM companies WHERE id = ?`).get(SUB_CO),
    engagements: db.prepare(`SELECT COUNT(*) n FROM engagements`).get().n,
  };
  const r = await call(env, `/api/subs/${SUB_CO}/end`, { method: "POST", body: { status: "ended" } });
  ck("ending it answers ok", r.status === 200 && r.body.ok === true && r.body.status === "ended",
    JSON.stringify(r.body));

  const after = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(SUB_CO);
  ck("the COMPANY row is untouched -- it is shared with every other account that hires them",
    !!after && after.company === before.company.company && after.contact === before.company.contact
      && after.email === before.company.email && after.license === before.company.license);
  ck("and so are their document booleans and filenames -- a certificate is THEIR record",
    after.insurance === 1 && after.bond === 1 && after.contract === 1 && after.w9 === 1
      && after.doc_files === before.company.doc_files, String(after.doc_files));

  ck("the engagement is not deleted, only ended",
    db.prepare(`SELECT COUNT(*) n FROM engagements`).get().n === before.engagements
      && db.prepare(`SELECT status FROM engagements WHERE id='en1'`).get().status === "ended");
  ck("the jobs are untouched",
    db.prepare(`SELECT COUNT(*) n FROM jobs WHERE account_id = ?`).get(GC).n === 2);
  // The review is the account's own verdict on their paperwork and is part of
  // the record: clearing it would make re-adding them look like a contractor
  // nobody had ever read a certificate for.
  ck("and this account's document verdicts survive",
    (db.prepare(`SELECT doc_review FROM engagements WHERE id='en1'`).get().doc_review || "")
      .includes("verified"));
}

console.log("\n-- the gate is on the SERVER, not on the roster screen --");
{
  const db = seed(); const env = ENV(db);
  // The control: with everything verified and the engagement active, this
  // assignment goes through. Without it, the refusals below would prove
  // nothing -- they could be any of the four document gates.
  const ok = await assign(env, "j1");
  ck("an active engagement with verified documents CAN be assigned",
    ok.status < 300, `${ok.status} ${JSON.stringify(ok.body)}`);

  await call(env, `/api/subs/${SUB_CO}/end`, { method: "POST", body: { status: "ended" } });
  const no = await assign(env, "j2");
  ck("an ENDED engagement cannot be assigned, and reads as not engaged",
    no.status === 404 && no.body.error === "not_engaged", `${no.status} ${JSON.stringify(no.body)}`);
  ck("and no work order was written for it",
    db.prepare(`SELECT COUNT(*) n FROM work_orders WHERE job_id='j2'`).get().n === 0);
}

console.log("\n-- PAUSED is refused by the same gate, which is what makes offering it honest --");
{
  const db = seed(); const env = ENV(db);
  const r = await call(env, `/api/subs/${SUB_CO}/end`, { method: "POST", body: { status: "paused" } });
  ck("pausing answers ok", r.status === 200 && r.body.status === "paused", JSON.stringify(r.body));
  ck("the column says paused rather than ended -- they are different words to a person",
    db.prepare(`SELECT status FROM engagements WHERE id='en1'`).get().status === "paused");
  const no = await assign(env, "j1");
  ck("a PAUSED contractor cannot be given work either",
    no.status === 404 && no.body.error === "not_engaged", `${no.status} ${JSON.stringify(no.body)}`);
  // Pausing is "not right now", so the relationship survives it: their
  // paperwork is still this account's to read and an agreement is still
  // theirs to issue. Those checks guard `!= 'ended'` on purpose and are
  // deliberately NOT the roster gate.
  const doc = await call(env, `/api/subs/${SUB_CO}/documents/insurance/file`);
  ck("but they are still this account's contractor -- their documents stay readable",
    doc.body.error !== "not_found", `${doc.status} ${JSON.stringify(doc.body)}`);
  // And they KEEP THEIR LOGIN. That is what separates the two: taking access
  // away over something reversible costs them their history with this account
  // for a season, and un-pausing could not give it back, because re-issuing a
  // login silently would hand somebody a key without anybody deciding to.
  ck("and they keep their login, which is what makes pausing the cheap one",
    db.prepare(`SELECT COUNT(*) n FROM memberships
                 WHERE account_id=? AND company_id=? AND role='contractor'`).get(GC, SUB_CO).n === 2);
  ck("only auto-schedule goes, because that writes to their calendar unasked",
    db.prepare(`SELECT auto_schedule FROM engagements WHERE id='en1'`).get().auto_schedule === 0);
  ck("and it reports no seats removed", r.body.seatsRemoved === 0, String(r.body.seatsRemoved));

  // The half that makes the assertion above mean anything: ENDED is where the
  // relationship stops, and the document routes have guarded `!= 'ended'` all
  // along. Without this, `no_file` over a closed relationship would read the
  // same as `no_file` over a live one.
  await call(env, `/api/subs/${SUB_CO}/end`, { method: "POST", body: { status: "ended" } });
  const gone = await call(env, `/api/subs/${SUB_CO}/documents/insurance/file`);
  ck("whereas ENDING it does close their paperwork to this account",
    gone.body.error === "not_found", `${gone.status} ${JSON.stringify(gone.body)}`);
}

console.log("\n-- the SEAT goes; the PERSON does not --");
{
  const db = seed(); const env = ENV(db);
  const r = await call(env, `/api/subs/${SUB_CO}/end`, { method: "POST", body: { status: "ended" } });
  ck("it reports how many people lost access", r.body.seatsRemoved === 2, String(r.body.seatsRemoved));
  ck("both contractor seats are gone -- that is what access is",
    db.prepare(`SELECT COUNT(*) n FROM memberships
                 WHERE account_id=? AND company_id=? AND role='contractor'`).get(GC, SUB_CO).n === 0);
  ck("and the PEOPLE are still there, because a person is global and holds seats elsewhere",
    db.prepare(`SELECT COUNT(*) n FROM users WHERE id IN ('u_sub','u_sub2')`).get().n === 2);
  ck("the account's own admin and pm seats are untouched",
    db.prepare(`SELECT COUNT(*) n FROM memberships WHERE account_id=? AND role IN ('admin','pm')`)
      .get(GC).n === 2);
  // A flag left on against an ended engagement is a standing permission to
  // write to somebody's calendar that nobody is watching.
  ck("and auto-schedule is off",
    db.prepare(`SELECT auto_schedule FROM engagements WHERE id='en1'`).get().auto_schedule === 0);
}

console.log("\n-- live work is NAMED and never blocks --");
{
  const db = seed(); const env = ENV(db);
  await assign(env, "j1");
  await assign(env, "j2");
  const chk = await call(env, `/api/subs/${SUB_CO}/end-check`);
  ck("the check names what is still booked, before anybody presses",
    chk.status === 200 && (chk.body.liveWork || []).length === 2, JSON.stringify(chk.body));
  ck("and how many people would lose access", chk.body.seats === 2, String(chk.body.seats));

  const r = await call(env, `/api/subs/${SUB_CO}/end`, { method: "POST", body: { status: "ended" } });
  ck("removing them with two jobs booked is NOT refused -- a repair going nowhere is often why",
    r.status === 200 && r.body.ok === true, `${r.status} ${JSON.stringify(r.body)}`);
  ck("it says what was still open instead", (r.body.liveWork || []).length === 2);
  // The work orders stay with their jobs: the outgoing contractor issued them,
  // the money is owed on them, and voiding them here would silently cancel
  // work somebody may already be on site for.
  ck("and the work orders are still there, not voided",
    db.prepare(`SELECT COUNT(*) n FROM work_orders WHERE voided_at IS NULL AND company_id=?`)
      .get(SUB_CO).n === 2);
}

console.log("\n-- it is reversible, which is the whole reason it is a status --");
{
  const db = seed(); const env = ENV(db);
  const seats = () => db.prepare(`SELECT COUNT(*) n FROM memberships
     WHERE account_id=? AND company_id=? AND role='contractor'`).get(GC, SUB_CO).n;
  const hadSeats = seats();
  await call(env, `/api/subs/${SUB_CO}/end`, { method: "POST", body: { status: "ended" } });
  const lostThem = seats() === 0;
  const back = await call(env, `/api/subs/${SUB_CO}/end`, { method: "POST", body: { status: "active" } });
  ck("adding them back answers ok", back.status === 200 && back.body.status === "active");
  ck("the column is active again",
    db.prepare(`SELECT status FROM engagements WHERE id='en1'`).get().status === "active");
  const ok = await assign(env, "j1");
  ck("and they are assignable again straight away",
    ok.status < 300, `${ok.status} ${JSON.stringify(ok.body)}`);
  // Access is not restored by adding them back, and it should not be: the
  // seat was a person's login and re-issuing it silently would hand somebody
  // back a key without anybody deciding to.
  ck("their seats are NOT silently restored -- an invite is how somebody gets a login",
    hadSeats === 2 && lostThem && seats() === 0, `${hadSeats} -> ${lostThem} -> ${seats()}`);

  const again = await call(env, `/api/subs/${SUB_CO}/end`, { method: "POST", body: { status: "active" } });
  ck("and asking for the state it is already in is a no-op rather than an error",
    again.status === 200 && again.body.unchanged === true, JSON.stringify(again.body));
}

console.log("\n-- a stranger's contractor reads as missing, not as forbidden --");
{
  const db = seed(); const env = ENV(db);
  const other = await call(env, `/api/subs/${OTHER_CO}/end`, { method: "POST", body: { status: "ended" } });
  const nobody = await call(env, `/api/subs/cmp_does_not_exist/end`, { method: "POST", body: { status: "ended" } });
  ck("somebody else's contractor and one that does not exist give the SAME answer",
    other.status === nobody.status && other.status === 404
      && JSON.stringify(other.body) === JSON.stringify(nobody.body),
    `${other.status} ${JSON.stringify(other.body)} vs ${nobody.status} ${JSON.stringify(nobody.body)}`);
  ck("and the other account's engagement is untouched",
    db.prepare(`SELECT status FROM engagements WHERE id='en2'`).get().status === "active");

  const chk = await call(env, `/api/subs/${OTHER_CO}/end-check`);
  ck("the check says the same, so it cannot be walked either",
    chk.status === 404 && chk.body.error === "not_found", `${chk.status} ${JSON.stringify(chk.body)}`);
}

console.log("\n-- a project manager may do it, because that is what the route allows --");
{
  const db = seed(); const env = ENV(db);
  const r = await call(env, `/api/subs/${SUB_CO}/end`, { method: "POST", seat: PM_SEAT, body: { status: "ended" } });
  ck("a pm can remove a contractor", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  // The screen is gated on can("contractors"), which is admin+pm, and NOT on
  // the admin-only canManage: a screen stricter than its route is the same lie
  // as one that is looser.
  ck("and the screen is gated to match, not on the admin-only gate",
    /canManage=\{can\("contractors"\)\}/.test(APP));
  ck("the route allows exactly those two roles",
    /app\.post\("\/api\/subs\/:companyId\/end",\s*requireRole\("admin",\s*"pm"\)/.test(WORKER));
}

console.log("\n-- PATCH is not a second door to the same column --");
{
  const db = seed(); const env = ENV(db);
  const r = await call(env, `/api/subs/${SUB_CO}`, { method: "PATCH", body: { status: "ended" } });
  ck("PATCHing the status does not write it",
    db.prepare(`SELECT status FROM engagements WHERE id='en1'`).get().status === "active",
    `${r.status} -> ${db.prepare(`SELECT status FROM engagements WHERE id='en1'`).get().status}`);
  // Which matters because a PATCH that wrote the word would leave the seat and
  // the auto-schedule flag exactly as they were.
  ck("so the seat and the auto-schedule flag cannot be left behind",
    db.prepare(`SELECT COUNT(*) n FROM memberships
                 WHERE account_id=? AND company_id=? AND role='contractor'`).get(GC, SUB_CO).n === 2
      && db.prepare(`SELECT auto_schedule FROM engagements WHERE id='en1'`).get().auto_schedule === 1);
  ck("and `status` is off the patchable column list",
    !/const SUB_ENGAGEMENT_COL = \{[^}]*status: "status"/s.test(WORKER));
}

console.log("\n-- an unrecognised target is refused rather than guessed at --");
{
  const db = seed(); const env = ENV(db);
  await call(env, `/api/subs/${SUB_CO}/end`, { method: "POST", body: { status: "banished" } });
  ck("a word nothing understands falls back to the default the button says",
    db.prepare(`SELECT status FROM engagements WHERE id='en1'`).get().status === "ended");
}

console.log("\n-- the browser half: off the list, off every count, with a way back --");
{
  // The roster filter, the counts and the picker all have to read the same
  // predicate -- three opinions about who is on a roster is how a tab says
  // thirty over a list of twenty-nine.
  ck("the roster list drops anybody off the roster", /if \(!onRoster\(s\.status\)\) return false;/.test(APP));
  ck("and the two memos beside it read the same rule rather than a second opinion",
    /const offRoster = useMemo\(\(\) => subs\.filter\(\(s\) => !onRoster\(s\.status\)\)/.test(APP)
      && /const liveSubs = useMemo\(\(\) => subs\.filter\(\(s\) => onRoster\(s\.status\)\)/.test(APP));
  ck("the nav count and the page head read the live list, not every row",
    /\{liveSubs\.length\}/.test(APP) && /liveSubs\.filter\(/.test(APP));

  // A reversible act with nowhere to reverse it from is a delete wearing a
  // softer word. This is the door.
  ck("removed contractors are kept in a section of their own",
    /\{offRoster\.length > 0 && can\("contractors"\) && \([\s\S]{0,200}className="offroster"/.test(APP));
  ck("with an Add back button on each row",
    /className="or-row"[\s\S]{0,700}endEngagement\(s\.id, "active"\)[\s\S]{0,200}Add back/.test(APP));
  ck("and it starts folded, like every other secondary panel here",
    /const \[offRosterOpen, setOffRosterOpen\] = useState\(false\)/.test(APP));
  ck("the count rides on the toggle, which is what makes closing it safe",
    /or-toggle[\s\S]{0,400}\{offRoster\.length\}/.test(APP));

  // The remove control itself.
  ck("the card carries the control", /<EndEngagement sub=\{sub\}/.test(APP));
  ck("and it asks first rather than firing off the button",
    /<ConfirmRemove[\s\S]{0,600}consequence=\{endConsequence\(/.test(APP));
  ck("and it is AGREEING that does it -- the button only opens the modal",
    /onConfirm=\{async \(\) => \{ await onEnd\(asking\); setAsking\(null\); \}\}/.test(APP)
      && /onClick=\{\(\) => ask\("ended"\)\}/.test(APP));
  ck("the check runs BEFORE the modal opens, so the consequence can be filled in",
    /api\.engagementEndCheck\(sub\.id\)[\s\S]{0,200}setAsking\(status\)/.test(APP));
}

console.log("\n-- what the modal SAYS, since that is the whole of the confirmation --");
{
  const one = R.endConsequence({ status: "ended", word: "subcontractor", liveWork: [1], seats: 1 });
  ck("it says the record survives, which is the thing somebody hesitates over",
    /jobs, work orders, payments and document history stay/.test(one), one);
  ck("it names how many people lose access", /The one person who can sign in/.test(one), one);
  ck("it names what is still booked", /still booked on 1 job/.test(one), one);
  ck("and it says it can be undone, because it can", /add them back/.test(one), one);

  const two = R.endConsequence({ status: "ended", word: "contractor", liveWork: [1, 2], seats: 3 });
  ck("and it counts rather than saying 1 jobs", /3 people/.test(two) && /2 jobs/.test(two), two);

  const none = R.endConsequence({ status: "ended", word: "contractor" });
  ck("with nobody to lose access and nothing booked it does not invent either",
    !/sign in/.test(none) && !/booked/.test(none), none);

  const paused = R.endConsequence({ status: "paused", word: "contractor", seats: 1 });
  ck("pausing says a DIFFERENT thing -- they stay, and nothing booked changes",
    /stay on your roster/.test(paused) && /Nothing already booked changes/.test(paused), paused);
  ck("and it does NOT claim somebody loses their login, because pausing does not take one",
    !/loses that access/.test(paused), paused);
  ck("and the two are not the same sentence with a word swapped",
    paused !== one.replace(/subcontractor/g, "contractor"));

  // Ended is final and paused is not, and that is the ONLY difference between
  // them -- so the words have to carry it, because the effect does not.
  ck("the two states read differently on the card",
    R.offRosterText("ended") !== R.offRosterText("paused")
      && /Removed/.test(R.offRosterText("ended")) && /Paused/.test(R.offRosterText("paused")));
  ck("and a state that is ON the roster says nothing", R.offRosterText("active") === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
