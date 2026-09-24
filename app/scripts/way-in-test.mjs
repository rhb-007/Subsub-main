// Nobody joins this system without a way back into it.
//
// There are seven ways a person ends up with a seat on an account, and they
// were written at different times by different means. Four of them sent an
// invite. Three sent nothing at all: a users row, a membership, and silence
// -- a person who exists, is expected to do something, and has no password,
// no notification, and no way to find out either.
//
// Those three were the ones that mattered most:
//
//   * A customer account created by SubSub from the platform console. The
//     front door. An admin who had never heard of any of it.
//   * A person added to a customer account from the console.
//   * A subcontractor who applied through the public form and left the
//     optional password box empty.
//
// This file is the standing check. It walks every door and asserts that
// somebody comes out the other side able to get in. Add an eighth way in
// and add it here, or it will be the next silent one.
//
// Needs the local stack: worker on 8787 with STAFF_ALLOW_PASSWORD=1, and
// the mail stub on 8904.
//
//   node scripts/way-in-test.mjs

import { execFileSync } from "node:child_process";

const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const MAIL = process.env.MAIL_STUB || "http://127.0.0.1:8904";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const sentMail = async () => (await (await fetch(`${MAIL}/__sent`)).json());
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const S = Date.now().toString(36);
const ACCOUNT = "acc_test";

// Did an invite that can actually be used reach this address? Not "was a
// row written" -- the row is not the point. The point is a message with a
// link in it.
const invitedAt = async (email) => {
  const mail = (await sentMail()).filter((m) =>
    m.to === email || (m.to || []).includes?.(email) || (Array.isArray(m.to) && m.to[0] === email));
  const last = mail[mail.length - 1];
  return { got: !!last, subject: last?.subject || "", hasLink: /https?:\/\/[^\s]+\?(user|invite|tenant)=/.test(last?.text || "") };
};

// Staff, for the two console doors. The seed data has no superadmin, which
// is why nobody noticed these two were silent.
const staffEmail = `staff.${S}@subsub.test`;
const staffId = `usr_wi_${S}`;
d1(`INSERT INTO users (id, name, email) VALUES ('${staffId}', 'Test Staff ${S}', '${staffEmail}');`);
d1(`INSERT INTO superadmins (user_id, role, finance, impersonate) VALUES ('${staffId}', 'superadmin', 1, 0);`);

const cleanup = () => {
  const mine = `(SELECT id FROM users WHERE email LIKE '%${S}%')`;
  for (const sql of [
    `DELETE FROM user_invites WHERE email LIKE '%${S}%' OR user_id IN ${mine};`,
    `DELETE FROM sub_invites WHERE email LIKE '%${S}%' OR company_id IN (SELECT id FROM companies WHERE company LIKE '%${S}%');`,
    `DELETE FROM memberships WHERE user_id IN ${mine} OR company_id IN (SELECT id FROM companies WHERE company LIKE '%${S}%');`,
    `DELETE FROM engagements WHERE company_id IN (SELECT id FROM companies WHERE company LIKE '%${S}%');`,
    `DELETE FROM activity WHERE user_id IN ${mine} OR text LIKE '%${S}%';`,
    `DELETE FROM events WHERE account_id IN (SELECT id FROM accounts WHERE name LIKE '%${S}%');`,
    `DELETE FROM activity WHERE account_id IN (SELECT id FROM accounts WHERE name LIKE '%${S}%');`,
    `DELETE FROM memberships WHERE account_id IN (SELECT id FROM accounts WHERE name LIKE '%${S}%');`,
    `DELETE FROM superadmins WHERE user_id = '${staffId}';`,
    `DELETE FROM accounts WHERE name LIKE '%${S}%';`,
    `DELETE FROM companies WHERE company LIKE '%${S}%';`,
    `DELETE FROM users WHERE email LIKE '%${S}%';`,
  ]) { try { d1(sql); } catch (e) { console.log("cleanup:", String(e.message).slice(0, 70)); } }
};

try {
  const staffTok = await tok(staffEmail);
  const SH = { Authorization: `Bearer ${staffTok}`, "content-type": "application/json" };
  const admin = await tok("admin@example.test");
  const H = { Authorization: `Bearer ${admin}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };

  console.log("\n-- door 1: SubSub sets a customer up from the console --");
  {
    // The front door of the whole product, and it was the quietest one. An
    // account, a subdomain, and an admin who had never heard of any of it.
    const ownerEmail = `owner.${S}@newcustomer.test`;
    const r = await fetch(`${API}/platform/accounts`, { method: "POST", headers: SH,
      body: JSON.stringify({ name: `New Customer ${S}`, subdomain: `newcust${S}`.slice(0, 30),
        kind: "general_contractor", plan: "basic", ownerName: "Sam Owner", ownerEmail }) });
    const made = await r.json();
    ck("the account is created", r.status === 201, `${r.status} ${JSON.stringify(made).slice(0, 80)}`);
    ck("its admin is invited, not left to guess", made.ownerInvite?.invited === true,
      JSON.stringify(made.ownerInvite));
    const got = await invitedAt(ownerEmail);
    ck("an email really reached them", got.got, got.subject || "nothing sent");
    ck("carrying a link that sets a password", got.hasLink, got.subject);
  }

  console.log("\n-- door 2: SubSub adds somebody to a customer account --");
  {
    const email = `added.${S}@newcustomer.test`;
    const r = await fetch(`${API}/platform/accounts/${ACCOUNT}/users`, { method: "POST", headers: SH,
      body: JSON.stringify({ name: `Console Added ${S}`, email, role: "pm" }) });
    const made = await r.json();
    ck("the person is added", r.status === 201, `${r.status} ${JSON.stringify(made).slice(0, 80)}`);
    ck("and invited", made.invite?.invited === true, JSON.stringify(made.invite));
    const got = await invitedAt(email);
    ck("an email really reached them", got.got, got.subject || "nothing sent");
    ck("carrying a link that sets a password", got.hasLink, got.subject);
  }

  console.log("\n-- door 3: an applicant who skipped the password box --");
  {
    // The box is optional, and somebody who leaves it empty used to finish
    // the form with a company, an engagement, a seat, and no login --
    // holding an email that said "thanks, we've got it" and nothing else.
    const email = `applied.${S}@harbourroof.test`;
    d1("DELETE FROM rate_limits WHERE bucket LIKE 'apply:%';");
    const r = await fetch(`${API}/apply/outerhome`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ company: `Harbour Applied ${S}`, contact: "Pat Applied", email,
        phone: "2065550123", categories: ["roofing"], notifyEmail: true }) });
    const out = await r.json();
    ck("the application lands", out.ok === true, JSON.stringify(out).slice(0, 90));
    ck("no password was typed, so no login was made", !out.login?.created, JSON.stringify(out.login));
    ck("so an invite goes instead", out.invite?.invited === true, JSON.stringify(out.invite));
    const got = await invitedAt(email);
    ck("and it really reached them", got.got && got.hasLink, `${got.got} / ${got.hasLink} / ${got.subject}`);
  }

  console.log("\n-- door 4: an applicant who did type one --");
  {
    const email = `applied2.${S}@harbourroof.test`;
    const r = await fetch(`${API}/apply/outerhome`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ company: `Harbour Pwd ${S}`, contact: "Dale Applied", email,
        phone: "2065550124", categories: ["roofing"], notifyEmail: true,
        password: "correct horse battery" }) });
    const out = await r.json();
    ck("a login is made from the form", out.login?.created === true, JSON.stringify(out.login));
    // And no invite on top of it: "choose a password" to somebody who just
    // chose one is a phishing lesson in reverse.
    ck("and no choose-a-password mail on top of it",
      !out.invite || out.invite.invited === false, JSON.stringify(out.invite));
    const theirs = await tok(email);
    const me = await (await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${theirs}` } })).json();
    ck("they can sign in", !!me.user?.id && (me.memberships || []).length > 0,
      JSON.stringify({ user: !!me.user, seats: (me.memberships || []).length }));
  }

  console.log("\n-- door 5: a general contractor adds a subcontractor --");
  {
    const email = `sub.${S}@bayview.test`;
    const made = await (await fetch(`${API}/subs`, { method: "POST", headers: H,
      body: JSON.stringify({ company: `Bayview ${S}`, contact: "Jo Bay", email,
        categories: ["siding"], caps: [] }) })).json();
    ck("the contractor is added and invited", made.invite?.invited === true, JSON.stringify(made.invite));
    const got = await invitedAt(email);
    ck("an email really reached them", got.got && got.hasLink, got.subject || "nothing sent");
  }

  console.log("\n-- door 6: an account adds one of its own people --");
  {
    const email = `mgr.${S}@outerhome.test`;
    const made = await (await fetch(`${API}/account-users`, { method: "POST", headers: H,
      body: JSON.stringify({ name: `New Manager ${S}`, email, role: "pm" }) })).json();
    // This one spreads the invite over the answer rather than nesting it.
    ck("the person is added and invited", made.invited === true, JSON.stringify(made));
    const got = await invitedAt(email);
    ck("an email really reached them", got.got && got.hasLink, got.subject || "nothing sent");
  }

  console.log("\n-- door 7: signing up, which needs nobody's invitation --");
  {
    // The one door that must NOT send an invite: they are sitting there
    // choosing their own password. A "choose a password" mail to somebody
    // who just chose one teaches them to click links in mail that looks
    // like this.
    const email = `signup.${S}@brandnew.test`;
    const before = (await sentMail()).length;
    const r = await fetch(`${API}/signup`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ company: `Brand New ${S}`, name: "Alex New", email,
        subdomain: `brandnew${S}`.slice(0, 30), password: "correct horse battery",
        kind: "general_contractor", trades: ["roofing"] }) });
    const out = await r.json();
    ck("the account is made", r.status === 201 || out.ok === true || !!out.accountId,
      `${r.status} ${JSON.stringify(out).slice(0, 90)}`);
    const after = (await sentMail()).slice(before).filter((m) =>
      /choose a password|added you/i.test(m.subject || ""));
    ck("and no invite is sent, because they just set their own password",
      after.length === 0, after.map((m) => m.subject).join(" | "));
  }
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message, "\n", err.stack?.split("\n")[1] || "");
} finally {
  cleanup();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
