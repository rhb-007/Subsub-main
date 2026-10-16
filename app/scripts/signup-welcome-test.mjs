// What a new signup is sent, and the first line of its subscription history.
//
// Reported from A&L Contracting, a Basic signup: no welcome email, no
// confirmation they could see, a console reading "Nothing has been sent to
// this account yet", and "Subscription history: No events recorded".
//
//   SIGNUP SENDS A WELCOME EMAIL OF OUR OWN, through Resend, logged like every
//   other mail, and it says how to get in -- the confirmation link when
//   Supabase is confirming, "Forgot password?" when it is not (the form takes
//   no password, so nobody knows the one Supabase was given).
//
//   THE CONFIRMATION IS LOGGED AS HANDED TO SUPABASE, because SubSub never
//   sees whether Supabase's own sender delivered it.
//
//   A SIGNUP WRITES A 'created' EVENT, at zero MRR, on the plan it chose; so
//   does the console's own account create. Nothing ever wrote one.
//
//   NONE OF IT CAN FAIL A SIGNUP: no mail configured, or Resend refusing,
//   still answers 201.
//
//   node --no-warnings scripts/signup-welcome-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { tally } from "./lib/stub-stack.mjs";
import { runCheck } from "./lib/check-sql.mjs";

const t = tally();
const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M087 = readFileSync(new URL("../worker/migrations/087_account_created_events.sql", import.meta.url), "utf8");

const mail = [];
let resendStatus = 200;
let supaConfirms = true;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const ok = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
  if (u.includes("resend.test")) {
    mail.push(JSON.parse(init.body));
    return resendStatus === 200 ? ok({ id: "em_1" }) : ok({ message: "refused" }, resendStatus);
  }
  if (u.endsWith("/auth/v1/signup")) {
    const b = JSON.parse(init.body);
    const user = { id: `auth_${b.email}`, email: b.email, identities: [{ id: "x" }] };
    // Confirmation on: a user and no session. Off: a session straight away.
    return supaConfirms ? ok(user) : ok({ access_token: "tok", user });
  }
  if (u.endsWith("/auth/v1/user")) {
    const who = String(init.headers?.Authorization || "").replace("Bearer ", "");
    return who === "staff" ? ok({ id: "auth_staff", email: "staff@subsub.test" }) : ok({ msg: "bad" }, 401);
  }
  return ok({});
};

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`INSERT INTO users(id,name,email,auth_id) VALUES ('u_staff','Staff','staff@subsub.test','auth_staff');
           INSERT INTO superadmins(user_id,role,finance,impersonate) VALUES ('u_staff','superadmin',1,1);`);
  return db;
};
const ENV = (db, { mailOn = true } = {}) => ({
  DB: makeD1(db), SUPABASE_URL: "http://supa.test", SUPABASE_ANON_KEY: "anon", STAFF_ALLOW_PASSWORD: "1",
  ...(mailOn ? { RESEND_API_KEY: "re_x", MAIL_FROM: "SubSub <hi@subsub.work>", RESEND_API_BASE: "https://resend.test" } : {}),
});
let ip = 0;
const signup = async (env, body = {}) => {
  ip += 1;
  const res = await worker.fetch(new Request("https://api.subsub.work/api/signup", {
    method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": `10.1.0.${ip}` },
    body: JSON.stringify({ name: "McGowan Adams", company: "A&L Contracting", subdomain: `al${ip}x`,
      email: `mcg${ip}@icloud.test`, kind: "general_contractor", plan: "basic", trades: [], ...body }),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const logOf = (db, acc) => db.prepare(`SELECT kind, status, error, subject FROM email_log WHERE account_id = ? ORDER BY at`).all(acc);
const eventsOf = (db, acc) => db.prepare(`SELECT kind, from_plan, to_plan, cycle, mrr_delta_cents, source FROM subscription_events WHERE account_id = ?`).all(acc);

try {
  console.log("\n-- a Basic signup, with Supabase confirming --");
  {
    const db = seed(); const env = ENV(db); mail.length = 0; supaConfirms = true; resendStatus = 200;
    const r = await signup(env);
    t.ck("signs up", r.status === 201 && r.body.needsConfirmation === true, JSON.stringify(r));
    const w = mail.find((m) => /Welcome to SubSub/.test(m.subject));
    t.ck("a welcome email goes, to the address they gave", !!w && w.to?.[0] === `mcg${ip}@icloud.test`, JSON.stringify(mail.map((m) => m.subject)));
    t.ck("it names the company and the free plan", /A&L Contracting is set up on the Basic plan, which is free/.test(w?.text || ""), w?.text);
    t.ck("it says the confirmation email is the way in", /Confirm your signup/.test(w?.text || "") && /choose your password/.test(w?.text || ""));
    t.ck("and says what to do when that does not arrive", /Forgot password\?/.test(w?.text || "") && w.text.includes(`mcg${ip}@icloud.test`));
    t.ck("and to check Junk", /Junk/.test(w?.text || ""));
    t.ck("the HTML carries SubSub's logo, with SubSub as its alt text",
      (w?.html || "").includes('src="https://subsub.work/email-logo.png"') && /alt="SubSub"/.test(w?.html || ""));
    t.ck("no sentence is broken across a line", !/under the name\n/.test(w?.text || ""));
    const log = logOf(db, r.body.accountId);
    t.ck("the welcome is on the console's mail log", log.some((l) => l.kind === "welcome" && l.status === "sent"), JSON.stringify(log));
    t.ck("and so is the confirmation, as handed to Supabase",
      log.some((l) => l.kind === "signup_confirmation" && l.status === "sent" && /Supabase/.test(l.subject)), JSON.stringify(log));
    const ev = eventsOf(db, r.body.accountId);
    t.ck("the subscription history has its first line", ev.length === 1 && ev[0].kind === "created", JSON.stringify(ev));
    t.ck("on Basic, monthly, at no revenue", ev[0]?.to_plan === "basic" && ev[0]?.from_plan === null
      && ev[0]?.cycle === "monthly" && ev[0]?.mrr_delta_cents === 0 && ev[0]?.source === "system", JSON.stringify(ev));
    t.ck("CHECK.sql's invariant reads zero after a signup", runCheck(db).m087_inv_account_no_created === 0);
  }

  console.log("\n-- with Supabase not confirming, the way in is Forgot password --");
  {
    const db = seed(); const env = ENV(db); mail.length = 0; supaConfirms = false;
    const r = await signup(env);
    t.ck("signs up with no confirmation step", r.status === 201 && r.body.needsConfirmation === false, JSON.stringify(r.body));
    const w = mail.find((m) => /Welcome to SubSub/.test(m.subject));
    t.ck("the welcome says Forgot password, because nobody knows the password",
      /press "Forgot password\?"/.test(w?.text || "") && !/Confirm your signup/.test(w?.text || ""), w?.text);
    t.ck("and no confirmation is logged that was never sent",
      !logOf(db, r.body.accountId).some((l) => l.kind === "signup_confirmation"));
    supaConfirms = true;
  }

  console.log("\n-- a Scale signup's history starts on Scale --");
  {
    const db = seed(); const env = ENV(db);
    const r = await signup(env, { plan: "scale", billing: "annual" });
    const ev = eventsOf(db, r.body.accountId);
    t.ck("created on Scale, annual, still no revenue until it pays",
      ev.length === 1 && ev[0].to_plan === "scale" && ev[0].cycle === "annual" && ev[0].mrr_delta_cents === 0, JSON.stringify(ev));
  }

  console.log("\n-- the founder's note goes to a hiring account on Basic, and nobody else --");
  {
    const intro = () => mail.find((m) => /hello from SubSub's founder/.test(m.subject));
    const db = seed(); const env = ENV(db); mail.length = 0; resendStatus = 200;
    const r = await signup(env);
    const f = intro();
    t.ck("a Basic general contractor gets it", !!f, JSON.stringify(mail.map((m) => m.subject)));
    t.ck("from Richard by name, at SubSub's address", f?.from === "Richard Braun at SubSub <hi@subsub.work>", f?.from);
    t.ck("and replies reach him", f?.reply_to === "rb@subsub.work", f?.reply_to);
    t.ck("it links SubSub's demo booking page", (f?.text || "").includes("https://subsub.work/book-a-demo.html")
      && (f?.html || "").includes('href="https://subsub.work/book-a-demo.html'));
    t.ck("it names Scale's benefits and the Basic limits", /Scale starts at \$99 a month/.test(f?.text || "")
      && /recruiting QR code/.test(f?.text || "") && /Basic covers 3 subcontractors, 1 user and 5 jobs/.test(f?.text || ""));
    t.ck("it is signed, with the postal address", /Founder & CEO, SubSub/.test(f?.text || "") && /4616 25th Ave NE/.test(f?.text || ""));
    t.ck("the signature never draws an image that is not there", !/<img[^>]+alt="Richard Braun"/.test(f?.html || "") && /RB<\/div>/.test(f?.html || ""));
    t.ck("it is on the mail log", logOf(db, r.body.accountId).some((l) => l.kind === "founder_intro" && l.status === "sent"));

    mail.length = 0; const pm = await signup(env, { kind: "property_manager" });
    t.ck("a property manager signs up", pm.status === 201, JSON.stringify(pm.body));
    t.ck("a property manager's says contractors", /your own contractors/.test(intro()?.text || "") && !/subcontractor/.test(intro()?.text || ""), intro()?.text);

    mail.length = 0; await signup(env, { plan: "scale" });
    t.ck("a Scale signup does not get it", !intro() && mail.some((m) => /Welcome to SubSub/.test(m.subject)));

    mail.length = 0; await signup(env, { kind: "subcontractor" });
    t.ck("a subcontractor account does not get it", !intro() && mail.some((m) => /Welcome to SubSub/.test(m.subject)));
  }

  console.log("\n-- mail never fails a signup --");
  {
    const db = seed(); const env = ENV(db, { mailOn: false }); mail.length = 0;
    const r = await signup(env);
    t.ck("no mail configured: still 201", r.status === 201, JSON.stringify(r));
    t.ck("and the log says why nothing went",
      logOf(db, r.body.accountId).some((l) => l.kind === "welcome" && l.status === "failed" && /mail_not_configured/.test(l.error || "")));
    const db2 = seed(); const env2 = ENV(db2); resendStatus = 500;
    const r2 = await signup(env2);
    t.ck("Resend refusing: still 201", r2.status === 201, JSON.stringify(r2));
    t.ck("and logged as failed", logOf(db2, r2.body.accountId).some((l) => l.kind === "welcome" && l.status === "failed"));
    resendStatus = 200;
  }

  console.log("\n-- the console's own account create --");
  {
    const db = seed(); const env = ENV(db);
    const res = await worker.fetch(new Request("https://api.subsub.work/api/platform/accounts", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer staff" },
      body: JSON.stringify({ name: "Made By Staff", subdomain: "madebystaff", plan: "basic" }),
    }), env);
    const body = await res.json().catch(() => ({}));
    t.ck("staff create an account", res.status === 201, `${res.status} ${JSON.stringify(body)}`);
    const ev = eventsOf(db, body.id);
    t.ck("and its history starts too, marked as staff's", ev.length === 1 && ev[0].kind === "created"
      && ev[0].source === "platform_admin", JSON.stringify(ev));
  }

  console.log("\n-- 087 fills in the accounts that already exist --");
  {
    const db = seed();
    db.exec(`INSERT INTO accounts(id,name,subdomain,kind,plan,billing,created_at) VALUES
               ('a_basic','A&L','al','general_contractor','basic','monthly','2026-10-15 21:47:00'),
               ('a_up','Upgrader','up','property_manager','scale','monthly','2026-09-01 10:00:00'),
               ('a_has','Has one','has','general_contractor','basic','monthly','2026-08-01 10:00:00');
             INSERT INTO subscription_events(id,account_id,at,kind,from_plan,to_plan,cycle,mrr_delta_cents) VALUES
               ('e_up','a_up','2026-09-10','upgraded','basic','scale','monthly',9900),
               ('e_has','a_has','2026-08-01','created',NULL,'basic','monthly',0);`);
    t.ck("before the paste the invariant counts the two without one", runCheck(db).m087_inv_account_no_created === 2);
    db.exec(M087);
    const ev = (a) => db.prepare(`SELECT to_plan, at FROM subscription_events WHERE account_id = ? AND kind = 'created'`).all(a);
    t.ck("a Basic account starts on Basic, dated when it was created",
      ev("a_basic").length === 1 && ev("a_basic")[0].to_plan === "basic" && ev("a_basic")[0].at === "2026-10-15 21:47:00", JSON.stringify(ev("a_basic")));
    t.ck("an account that upgraded starts on what it upgraded from", ev("a_up")[0]?.to_plan === "basic", JSON.stringify(ev("a_up")));
    t.ck("one that already had a row is left alone", ev("a_has").length === 1);
    db.exec(M087);
    t.ck("running it twice adds nothing", ev("a_basic").length === 1 && ev("a_up").length === 1);
    t.ck("and the invariant reads zero", runCheck(db).m087_inv_account_no_created === 0);
  }
  console.log("\n-- every email wears the header, not only the welcome --");
  {
    const mailMod = await import("../worker/mail.js");
    const args = { company: { company: "Bay Roofing", email: "a@b.test" }, contact: "Rae",
      account: { name: "Acme", subdomain: "acme" }, job: { title: "Reroof", address: "1 Elm" },
      trade: "roofing", woNumber: "WO-1", link: "https://x.test/l", kind: "insurance", name: "Rae",
      role: "admin", firstName: "Rae", companyName: "Bay", lines: ["a"],
      threads: [{ who: "x", about: "y", last: "z", link: "https://x.test" }], body: "hi", who: "Dana",
      subject: "S", text: "T {link}", amount: 100, through: "2026-10-01", expiresOn: "2026-12-01",
      daysOut: 7, count: 2, days: 30, title: "T", stage: "approved", review: {}, jobs: [],
      accountName: "Acme", subdomain: "acme", subs: 12 };
    const composers = Object.entries(mailMod).filter(([k, f]) => /Email$/.test(k) && k !== "sendEmail" && typeof f === "function");
    const without = composers.filter(([, f]) => { try { return !f(args)?.html?.includes("email-logo.png"); } catch { return true; } })
      .map(([k]) => k);
    t.ck(`all ${composers.length} email composers carry the logo`, composers.length > 25 && without.length === 0, without.join(", "));

    const wrapped = "Hi Rae,\n\nThe quick brown\nfox jumps.\n\n  WO-1\n  Trade: x\n\nOpen it here:\n  https://x\n\n- one\n- two";
    const u = mailMod.unwrapProse(wrapped);
    t.ck("a sentence wrapped at 80 columns is one line in the HTML", u.includes("The quick brown fox jumps."), u);
    t.ck("indented detail rows, a link under a colon and list items keep their lines",
      u.includes("\n  WO-1\n  Trade: x") && u.includes("here:\n  https://x") && u.includes("- one\n- two"), u);
    // Read through a real email, not the helper: a helper that works and is
    // never called is the bug this checks for.
    const app = mailMod.applicationReceivedEmail({ companyName: "Bay", contact: "Rae", account: { name: "Acme", subdomain: "acme" } });
    t.ck("and a real email's HTML is unwrapped", /the next step is uploading/.test(app.html)
      && /the next step is\nuploading/.test(app.text), app.html.slice(0, 400));
    const msg = mailMod.messageEmail({ firstName: "Rae", who: "Dana", body: "Gate code 1234\nDog is friendly",
      link: "https://x.test/t", fromName: "Acme" });
    t.ck("a person's own message keeps every line break", msg.html.includes("Gate code 1234<br>Dog is friendly"), msg.html);
  }

  console.log("\n-- the logo the email points at is a real, published PNG --");
  {
    const png = readFileSync(new URL("../../email-logo.png", import.meta.url));
    t.ck("it is a PNG", png.subarray(1, 4).toString() === "PNG");
    t.ck("at twice the size it is drawn (176x40)", png.readUInt32BE(16) === 352 && png.readUInt32BE(20) === 80,
      `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
    const ignore = readFileSync(new URL("../../.assetsignore", import.meta.url), "utf8");
    t.ck("and the site publishes root PNGs", /^!\/\*\.png$/m.test(ignore));
  }
} finally {
  globalThis.fetch = realFetch;
}
// The From line always carries a name, so a mail app draws "SubSub" rather
// than an "N" for notifications@.
{
  const { fromWithName, sendEmail } = await import("../worker/mail.js");
  const seen = [];
  const keep = globalThis.fetch;
  globalThis.fetch = async (u, o) => { seen.push(JSON.parse(o.body)); return new Response('{"id":"x"}'); };
  await sendEmail({ RESEND_API_KEY: "k", MAIL_FROM: "notifications@subsub.work" }, { to: "a@b.co", subject: "s", text: "t" });
  globalThis.fetch = keep;
  t.ck("what Resend is sent names SubSub", seen[0]?.from === "SubSub <notifications@subsub.work>", seen[0]?.from);
  t.ck("a bare MAIL_FROM gets SubSub's name", fromWithName("notifications@subsub.work") === "SubSub <notifications@subsub.work>");
  t.ck("a named MAIL_FROM is used as set", fromWithName("Acme <a@b.co>") === "Acme <a@b.co>");
}
t.done();
