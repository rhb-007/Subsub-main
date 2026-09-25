// An account is a company too.
//
// A general contractor was a tenant of SubSub and nothing else. There was no
// company row of theirs, so the connect lookup could not match them, they had
// no QR code, and a bigger general contractor who wanted them for a roof had
// to type them in from scratch -- guessing at a licence number that was
// already in the database, on a profile with crews and coverage already on it.
//
// Which is wrong about the trade. The same outfit sells siding to a property
// manager on Tuesday and subs its gutters out on Wednesday, and is somebody
// else's subcontractor the moment a bigger contractor calls.
//
// Migration 031 gives every account a company row. This drives the whole of
// what that buys: a profile to fill in, a code to show, a lookup that finds
// you, a request you can accept, and -- the part that is easy to get wrong --
// your whole team seated in the account that hired you.
//
// Needs the local stack (worker 8787, supa stub 8902, mail stub 8904) and
// migration 031 run against the local database.
//
//   node scripts/account-company-test.mjs

import { execFileSync } from "node:child_process";

const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const rows = (out) => JSON.parse(out.slice(out.indexOf("["))) [0]?.results || [];

// Writing to the local D1 file from outside bounces the dev server, and a
// request landing in that half second fails at the socket rather than
// answering. This file seeds through D1 between sections, so a connection
// failure is retried instead of reported as a broken feature. Anything the
// server actually answers, error included, passes straight through.
const rawFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  for (let attempt = 0; ; attempt++) {
    try { return await rawFetch(...args); }
    catch (err) {
      if (attempt >= 5) throw err;
      await wait(800);
    }
  }
};

const S = Date.now().toString(36);

// ---- two accounts: a hirer, and a general contractor who can be hired ----
// Seeded directly, because signing two accounts up through the API would be
// testing the signup form rather than this.
const GC = `acc_gc_${S}`, HIRER = `acc_hire_${S}`;
const GC_OWNER = `usr_gco_${S}`, GC_PM = `usr_gcpm_${S}`, GC_TENANT = `usr_gct_${S}`;
const HIRE_ADMIN = `usr_ha_${S}`;
const gcEmail = `boss.${S}@sanjuan.test`, gcPmEmail = `pm.${S}@sanjuan.test`;
const gcTenantEmail = `renter.${S}@sanjuan.test`, hireEmail = `hire.${S}@bigco.test`;
const GC_NAME = `San Juan Exteriors ${S}`;
const LICENSE = `SJX${S.toUpperCase().slice(0, 7)}`;

const seed = () => {
  d1(`INSERT INTO accounts (id, name, subdomain, kind) VALUES
      ('${GC}', '${GC_NAME}', 'sanjuan${S}', 'general_contractor'),
      ('${HIRER}', 'Bigger Roofing ${S}', 'bigger${S}', 'general_contractor');`);
  d1(`INSERT INTO users (id, name, email) VALUES
      ('${GC_OWNER}', 'Rosa Vela', '${gcEmail}'),
      ('${GC_PM}', 'Dana Cole', '${gcPmEmail}'),
      ('${GC_TENANT}', 'Nobody Special', '${gcTenantEmail}'),
      ('${HIRE_ADMIN}', 'Marcus Webb', '${hireEmail}');`);
  d1(`INSERT INTO memberships (id, user_id, account_id, role) VALUES
      ('mem_a_${S}', '${GC_OWNER}', '${GC}', 'admin'),
      ('mem_b_${S}', '${GC_PM}', '${GC}', 'pm'),
      ('mem_c_${S}', '${GC_TENANT}', '${GC}', 'tenant'),
      ('mem_d_${S}', '${HIRE_ADMIN}', '${HIRER}', 'admin');`);
};
const cleanup = () => {
  const accts = `'${GC}','${HIRER}'`;
  const us = `'${GC_OWNER}','${GC_PM}','${GC_TENANT}','${HIRE_ADMIN}'`;
  for (const sql of [
    `DELETE FROM connect_requests WHERE account_id IN (${accts}) OR company_id LIKE 'cmp_own_acc_%${S}';`,
    `DELETE FROM engagements WHERE account_id IN (${accts}) OR company_id LIKE 'cmp_own_acc_%${S}';`,
    `DELETE FROM activity WHERE account_id IN (${accts}) OR user_id IN (${us});`,
    `DELETE FROM email_log WHERE account_id IN (${accts}) OR sent_by IN (${us});`,
    `DELETE FROM memberships WHERE account_id IN (${accts}) OR user_id IN (${us});`,
    `DELETE FROM accounts WHERE id IN (${accts});`,
    `DELETE FROM companies WHERE id LIKE 'cmp_own_acc_%${S}';`,
    `DELETE FROM users WHERE id IN (${us});`,
  ]) { try { d1(sql); } catch (e) { console.log("cleanup:", String(e.message).split("\n").find((l) => /ERROR/.test(l))?.slice(0, 90)); } }
};

seed();
const H = async (email, accountId) => ({
  Authorization: `Bearer ${await tok(email)}`, "X-Account-Id": accountId, "content-type": "application/json",
});
const gcH = await H(gcEmail, GC);
const gcPmH = await H(gcPmEmail, GC);
const tenantH = await H(gcTenantEmail, GC);
const hireH = await H(hireEmail, HIRER);

try {
  console.log("\n-- every account has a company of its own --");
  {
    // Seeded rows have no company_id: they were inserted after 031 ran, the
    // same way an account created by a code path that forgot would be. The
    // first touch is what fixes them.
    const before = rows(d1(`SELECT company_id FROM accounts WHERE id = '${GC}'`));
    ck("the seeded account starts without one", !before[0]?.company_id, String(before[0]?.company_id));
    const r = await fetch(`${API}/my-company`, { headers: gcH });
    const me = await r.json();
    ck("asking for it mints one", r.status === 200, `${r.status} ${JSON.stringify(me).slice(0, 80)}`);
    ck("named after the account", me.company === GC_NAME, me.company);
    ck("and it is derived, not random", me.companyId === `cmp_own_${GC}`, me.companyId);
    const after = rows(d1(`SELECT company_id FROM accounts WHERE id = '${GC}'`));
    ck("the account now points at it", after[0]?.company_id === me.companyId, String(after[0]?.company_id));
    // Asking twice must not make a second one.
    await fetch(`${API}/my-company`, { headers: gcPmH });
    const many = rows(d1(`SELECT COUNT(*) AS n FROM companies WHERE id LIKE 'cmp_own_${GC}'`));
    ck("asking again does not make another", Number(many[0]?.n) === 1, String(many[0]?.n));
  }

  console.log("\n-- but a name alone is findable by nobody --");
  {
    const me = await (await fetch(`${API}/my-company`, { headers: gcH })).json();
    ck("and it says so", me.findable === false, `findable=${me.findable}`);
    const r = await fetch(`${API}/connect/lookup?email=${encodeURIComponent(gcEmail)}`, { headers: hireH });
    const found = await r.json();
    ck("a search for them turns up nothing yet", found.found === false, JSON.stringify(found));
  }

  console.log("\n-- who may fill it in --");
  {
    const r = await fetch(`${API}/my-company`, { method: "PATCH", headers: tenantH,
      body: JSON.stringify({ company: "Hijacked" }) });
    ck("a tenant cannot", r.status === 403, `${r.status}`);
    const still = await (await fetch(`${API}/my-company`, { headers: gcH })).json();
    ck("and nothing moved when they tried", still.company === GC_NAME, still.company);
  }
  {
    const r = await fetch(`${API}/my-company`, { method: "PATCH", headers: gcH,
      body: JSON.stringify({ email: "not-an-address" }) });
    ck("a bad email is refused", r.status === 400, `${r.status}`);
    const r2 = await fetch(`${API}/my-company`, { method: "PATCH", headers: gcH,
      body: JSON.stringify({ company: "" }) });
    ck("and so is clearing the name", r2.status === 400, `${r2.status}`);
  }
  {
    // The licence column is the dedupe key for the whole table, so two
    // accounts claiming one is a real collision -- and a 500 from a unique
    // index is a worse way to be told than a sentence.
    const mine = await fetch(`${API}/my-company`, { method: "PATCH", headers: hireH,
      body: JSON.stringify({ license: LICENSE }) });
    ck("the hiring account takes a licence number first", mine.status === 200, `${mine.status}`);
    const r = await fetch(`${API}/my-company`, { method: "PATCH", headers: gcH,
      body: JSON.stringify({ license: LICENSE }) });
    const b = await r.json();
    ck("and the second account is refused by name",
      r.status === 409 && b.error === "license_taken", `${r.status} ${b.error}`);
    // Give it back, so the rest of the run can use it.
    await fetch(`${API}/my-company`, { method: "PATCH", headers: hireH, body: JSON.stringify({ license: "" }) });
    const freed = await (await fetch(`${API}/my-company`, { headers: hireH })).json();
    ck("clearing it releases the number", !freed.license, JSON.stringify(freed.license));
  }

  console.log("\n-- filled in, they can be found --");
  {
    const r = await fetch(`${API}/my-company`, { method: "PATCH", headers: gcPmH,
      body: JSON.stringify({ contact: "Rosa Vela", email: gcEmail, phone: "206-555-0142",
        license: LICENSE, city: "Anacortes", state: "WA", zip: "98221" }) });
    const me = await r.json();
    ck("a project manager may save it", r.status === 200, `${r.status}`);
    ck("and it now says it is findable", me.findable === true, `findable=${me.findable}`);

    const byEmail = await (await fetch(`${API}/connect/lookup?email=${encodeURIComponent(gcEmail)}`, { headers: hireH })).json();
    ck("a search by email finds them", byEmail.found === true, JSON.stringify(byEmail).slice(0, 90));
    ck("as a company with a name", byEmail.match?.company === GC_NAME, byEmail.match?.company);
    ck("and somewhere to be", byEmail.match?.where === "Anacortes, WA", byEmail.match?.where);
    // The whole point of companyHasLogin: a row nobody can answer for is not
    // offered. An account's people are admins, not contractor seats, so this
    // is exactly the case that used to read "nobody on SubSub matches that".
    ck("not as a row with nobody behind it", byEmail.reason !== "no_account", byEmail.reason || "—");

    const byLicense = await (await fetch(`${API}/connect/lookup?license=${encodeURIComponent(LICENSE)}`, { headers: hireH })).json();
    ck("a search by licence finds them too", byLicense.found === true, JSON.stringify(byLicense).slice(0, 80));
  }

  console.log("\n-- and cannot find themselves --");
  {
    const r = await (await fetch(`${API}/connect/lookup?email=${encodeURIComponent(gcEmail)}`, { headers: gcH })).json();
    ck("their own address is not a match", r.found === false && r.reason === "own_company", JSON.stringify(r));
    const code = (await (await fetch(`${API}/connect/code`, { headers: gcH })).json()).code;
    const byCode = await (await fetch(`${API}/connect/code/${code}`, { headers: gcH })).json();
    ck("nor is their own code", byCode.found === false && byCode.reason === "own_company", JSON.stringify(byCode));
    const req = await fetch(`${API}/connect-requests`, { method: "POST", headers: gcH,
      body: JSON.stringify({ code }) });
    const b = await req.json();
    ck("and they cannot hire themselves", req.status === 409 && b.error === "own_company", `${req.status} ${b.error}`);
    const mine = rows(d1(`SELECT COUNT(*) AS n FROM engagements WHERE account_id = '${GC}' AND company_id = 'cmp_own_${GC}'`));
    ck("so they are not on their own roster", Number(mine[0]?.n) === 0, String(mine[0]?.n));
  }

  console.log("\n-- they carry a QR code --");
  {
    const r = await fetch(`${API}/connect/code`, { headers: gcH });
    const code = await r.json();
    ck("an admin on their own account gets one", r.status === 200 && /^[0-9A-Z]{10}$/.test(code.code || ""), JSON.stringify(code));
    ck("with a link that opens it", /\/\?connect=/.test(code.url || ""), code.url);
    const again = await (await fetch(`${API}/connect/code`, { headers: gcPmH })).json();
    ck("the same one for everybody at the company", again.code === code.code, `${again.code} vs ${code.code}`);
    const rotated = await (await fetch(`${API}/connect/code/rotate`, { method: "POST", headers: gcH })).json();
    ck("and it can be changed", rotated.code && rotated.code !== code.code, `${code.code} → ${rotated.code}`);
    const dead = await (await fetch(`${API}/connect/code/${code.code}`, { headers: hireH })).json();
    ck("which stops the old one working", dead.found === false, JSON.stringify(dead));
    const tR = await fetch(`${API}/connect/code`, { headers: tenantH });
    ck("a tenant has no code at all", tR.status === 403, `${tR.status}`);
  }

  console.log("\n-- being hired --");
  let requestId = null;
  {
    const code = (await (await fetch(`${API}/connect/code`, { headers: gcH })).json()).code;
    const r = await fetch(`${API}/connect-requests`, { method: "POST", headers: hireH,
      body: JSON.stringify({ code, message: "Roof on Fidalgo, three weeks out" }) });
    const made = await r.json();
    requestId = made.id;
    ck("a bigger contractor can ask", r.status === 201, `${r.status} ${JSON.stringify(made).slice(0, 80)}`);
    ck("and it reaches them", made.emailed === true, `emailed=${made.emailed} err=${made.emailError}`);

    const inbox = await (await fetch(`${API}/my-connect-requests`, { headers: gcH })).json();
    ck("it is waiting on their side", inbox.some((x) => x.id === requestId), `${inbox.length} requests`);
    const asked = inbox.find((x) => x.id === requestId);
    ck("saying who asked", /Bigger Roofing/.test(asked?.account || ""), asked?.account);
    ck("and how", asked?.via === "code", asked?.via);
    // Nothing exists until they say yes. That is the whole reason it is a
    // request rather than a button the hiring account presses.
    const early = rows(d1(`SELECT COUNT(*) AS n FROM engagements WHERE account_id = '${HIRER}'`));
    ck("with no engagement created yet", Number(early[0]?.n) === 0, String(early[0]?.n));
  }

  console.log("\n-- accepting seats the whole team --");
  {
    const r = await fetch(`${API}/my-connect-requests/${requestId}/respond`, { method: "POST", headers: gcH,
      body: JSON.stringify({ accept: true }) });
    const out = await r.json();
    ck("an admin can answer for their account", r.status === 200 && out.status === "accepted", `${r.status} ${out.status}`);

    const eng = rows(d1(`SELECT status, company_id FROM engagements WHERE account_id = '${HIRER}'`));
    ck("the engagement is made", eng.length === 1, `${eng.length}`);
    ck("against the account's own company", eng[0]?.company_id === `cmp_own_${GC}`, eng[0]?.company_id);
    ck("and active, not invited", eng[0]?.status === "active", eng[0]?.status);

    // The part that is easy to get wrong. A general contractor has no
    // contractor seats of their own -- their people are admins and PMs on
    // their own subdomain -- so the old "seat everyone at the company" query
    // would have found nobody and seated only whoever tapped yes.
    const seats = rows(d1(`SELECT user_id, role, company_id FROM memberships
      WHERE account_id = '${HIRER}' AND role = 'contractor'`));
    const seated = seats.map((x) => x.user_id).sort();
    ck("both the admin and the project manager are seated",
      seated.length === 2 && seated.includes(GC_OWNER) && seated.includes(GC_PM), seated.join(", "));
    // Guarded: the two below are .every() over this list, and an empty one
    // passes both without looking at anything.
    ck("as contractors, against their company",
      seats.length > 0 && seats.every((x) => x.company_id === `cmp_own_${GC}`),
      seats.map((x) => x.company_id).join(", ") || "no seats at all");
    // And not the tenant. A guest of the accepting account has no business
    // in a stranger's.
    ck("and the tenant is not", seats.length > 0 && !seated.includes(GC_TENANT),
      seated.join(", ") || "no seats at all");

    const onList = await (await fetch(`${API}/subs`, { headers: hireH })).json();
    ck("they are on the hiring account's roster", onList.some((x) => x.company === GC_NAME),
      onList.map((x) => x.company).join(" | ").slice(0, 90));
  }

  console.log("\n-- and the console can tell a customer from a contractor --");
  {
    const staffId = `usr_st_${S}`;
    d1(`INSERT INTO users (id, name, email) VALUES ('${staffId}', 'Staff', 'st.${S}@subsub.test');`);
    d1(`INSERT INTO superadmins (user_id, role, finance, impersonate) VALUES ('${staffId}', 'superadmin', 1, 0);`);
    const st = await tok(`st.${S}@subsub.test`);
    const list = await (await fetch(`${API}/platform/companies`, { headers: { Authorization: `Bearer ${st}` } })).json();
    const mine = list.find((x) => x.id === `cmp_own_${GC}`);
    ck("the account's company is in the registry", !!mine, `${list.length} companies`);
    ck("marked as an account", mine?.accountName === GC_NAME, String(mine?.accountName));
    // Not everything is. A plain contractor row must not be mislabelled.
    const plain = list.find((x) => x.id === "cmp_r");
    ck("and an ordinary contractor is not", plain && plain.accountName === null,
      `${plain?.company} → ${String(plain?.accountName)}`);
    d1(`DELETE FROM superadmins WHERE user_id = '${staffId}'`);
    d1(`DELETE FROM users WHERE id = '${staffId}'`);
  }
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
} finally {
  cleanup();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
