// Only a general contractor can be hired.
//
// A general contractor sells siding to a property manager on Tuesday and
// subs its gutters out on Wednesday, so they are on both sides of the
// arrangement. A property manager, a portfolio manager and a building owner
// only ever hire — a landlord is not somebody's subcontractor, and a QR code
// and a public listing for one is a thing that will never be used and one
// careless join from putting them on a roster.
//
// So the company row that 031 creates is for general contractors and nobody
// else, and every route that speaks for it says which of the two reasons it
// is refusing: not migrated, or not that kind of account.
//
// And a general contractor signing up is asked for the same proof they will
// ask of their own subcontractors — a licence number and a UBI — because
// otherwise the first thing a bigger contractor sees of them is a profile
// that cannot be verified.
//
// Needs the local stack and migration 031 run against the local database.
//
//   node scripts/gc-only-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const SITE = process.env.SITE_PORT || "5193";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const rows = (out) => JSON.parse(out.slice(out.indexOf("[")))[0]?.results || [];

const rawFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  for (let attempt = 0; ; attempt++) {
    try { return await rawFetch(...args); }
    catch (err) { if (attempt >= 5) throw err; await wait(800); }
  }
};

const S = Date.now().toString(36);
// One account of each kind, each with an admin.
const KINDS = ["general_contractor", "property_manager", "building_owner", "portfolio_manager"];
const acc = (k) => `acc_gc_${k.slice(0, 4)}_${S}`;
const usr = (k) => `usr_gc_${k.slice(0, 4)}_${S}`;
const mail = (k) => `${k.slice(0, 4)}.${S}@kinds.test`;
const seed = () => {
  for (const k of KINDS) {
    d1(`INSERT INTO accounts (id, name, subdomain, kind) VALUES ('${acc(k)}', '${k} ${S}', 'k${k.slice(0, 4)}${S}', '${k}');`);
    d1(`INSERT INTO users (id, name, email) VALUES ('${usr(k)}', 'Boss ${k}', '${mail(k)}');`);
    d1(`INSERT INTO memberships (id, user_id, account_id, role) VALUES ('mem_${k.slice(0, 4)}_${S}', '${usr(k)}', '${acc(k)}', 'admin');`);
  }
};
const cleanup = () => {
  const accs = KINDS.map((k) => `'${acc(k)}'`).join(",");
  const us = KINDS.map((k) => `'${usr(k)}'`).join(",");
  const signedUp = `SELECT id FROM users WHERE email LIKE '%.${S}@signup.test'`;
  for (const sql of [
    `DELETE FROM connect_requests WHERE account_id IN (${accs});`,
    `DELETE FROM engagements WHERE account_id IN (${accs});`,
    `DELETE FROM activity WHERE account_id IN (${accs}) OR user_id IN (${us});`,
    `DELETE FROM email_log WHERE account_id IN (${accs}) OR sent_by IN (${us});`,
    `DELETE FROM memberships WHERE account_id IN (${accs}) OR user_id IN (${us});`,
    `DELETE FROM accounts WHERE id IN (${accs});`,
    `DELETE FROM companies WHERE id LIKE 'cmp_own_acc_gc_%${S}';`,
    `DELETE FROM users WHERE id IN (${us});`,
    // The signup half, from the outside in. Every one of these points at a
    // user or an account, so deleting the user first is the FK error this
    // file spent three runs printing.
    `DELETE FROM activity WHERE user_id IN (${signedUp});`,
    `DELETE FROM email_log WHERE sent_by IN (${signedUp});`,
    `DELETE FROM user_invites WHERE user_id IN (${signedUp}) OR created_by IN (${signedUp});`,
    `DELETE FROM memberships WHERE user_id IN (${signedUp});`,
    `DELETE FROM accounts WHERE subdomain LIKE 'sgn%${S}';`,
    `DELETE FROM users WHERE email LIKE '%.${S}@signup.test';`,
    `DELETE FROM companies WHERE license LIKE 'GCLIC${S.toUpperCase()}%';`,
    "DELETE FROM rate_limits WHERE bucket LIKE 'signup-%';",
  ]) {
    try { d1(sql); }
    // Named, so a cleanup that fails says which statement did rather than a
    // bare constraint error with no way to find the row it is about.
    catch (e) {
      console.log("cleanup failed:", sql.slice(0, 70),
        "->", String(e.message).split("\n").find((l) => /ERROR/.test(l))?.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 70));
    }
  }
};

// Signup is rate limited to three creations an hour per IP, which is the
// right number for the internet and the wrong one for a file that signs up
// three times. Cleared for this IP before the run rather than worked around.
d1("DELETE FROM rate_limits WHERE bucket LIKE 'signup-%';");
seed();
const H = async (k) => ({ Authorization: `Bearer ${await tok(mail(k))}`,
  "X-Account-Id": acc(k), "content-type": "application/json" });

try {
  console.log("\n-- who gets a company of their own --");
  {
    // Touching the route is what mints one for an account created after the
    // migration ran. It must mint for exactly one of the four kinds.
    for (const k of KINDS) {
      const h = await H(k);
      const r = await fetch(`${API}/my-company`, { headers: h });
      const b = await r.json();
      if (k === "general_contractor") {
        ck(`${k}: has a company profile`, r.status === 200 && !!b.companyId, `${r.status} ${b.error || b.companyId}`);
      } else {
        ck(`${k}: has none, and is told why`, r.status === 409 && b.error === "not_hireable",
          `${r.status} ${b.error}`);
      }
    }
    const made = rows(d1(`SELECT a.kind, a.company_id FROM accounts a WHERE a.id LIKE 'acc_gc_%${S}'`));
    ck("the database agrees: one row, on the general contractor",
      made.filter((x) => x.company_id).length === 1
      && made.find((x) => x.company_id)?.kind === "general_contractor",
      made.map((x) => `${x.kind}=${x.company_id}`).join(" | "));
  }

  console.log("\n-- and who gets a QR code --");
  {
    for (const k of KINDS) {
      const h = await H(k);
      const r = await fetch(`${API}/connect/code`, { headers: h });
      const b = await r.json();
      if (k === "general_contractor") {
        ck(`${k}: has a code`, r.status === 200 && /^[0-9A-Z]{10}$/.test(b.code || ""), `${r.status} ${b.code || b.error}`);
      } else {
        // Refused, and refused with the reason rather than a bare forbidden:
        // a property manager is not missing a permission, they are a kind of
        // account this does not apply to.
        ck(`${k}: none, and told which kind of no it is`,
          r.status === 403 && b.error === "not_hireable", `${r.status} ${b.error}`);
      }
    }
    const rot = await fetch(`${API}/connect/code/rotate`, { method: "POST", headers: await H("property_manager") });
    ck("a property manager cannot rotate one either",
      rot.status === 403 && (await rot.json()).error === "not_hireable", `${rot.status}`);
  }

  console.log("\n-- and who a search can find --");
  {
    // Give the property manager an address on a company row by hand, the way
    // a stray row could exist, and confirm the lookup still will not offer
    // them: the account has no company_id, so there is nothing to connect to.
    const pmMail = `pm.${S}@kinds.test`;
    const gcH = await H("general_contractor");
    await fetch(`${API}/my-company`, { method: "PATCH", headers: gcH,
      body: JSON.stringify({ email: `gc.${S}@kinds.test`, city: "Tacoma", state: "WA" }) });
    const hirer = await H("property_manager");
    const found = await (await fetch(`${API}/connect/lookup?email=${encodeURIComponent(`gc.${S}@kinds.test`)}`,
      { headers: hirer })).json();
    ck("a general contractor can be found", found.found === true, JSON.stringify(found).slice(0, 90));
    const notFound = await (await fetch(`${API}/connect/lookup?email=${encodeURIComponent(pmMail)}`,
      { headers: gcH })).json();
    ck("a property manager cannot", notFound.found === false, JSON.stringify(notFound));
  }

  console.log("\n-- signing up as a general contractor --");
  {
    const base = (extra) => ({
      kind: "general_contractor", company: `Signup ${S}`, name: "Pat Signup",
      email: `gc.${S}@signup.test`, subdomain: `sgn${S}`, password: "correct horse battery",
      trades: ["roofing"], ...extra,
    });
    const post = (body) => fetch(`${API}/signup`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    let r = await post(base({}));
    let b = await r.json();
    ck("a licence number is required", r.status === 400 && b.error === "license_required", `${r.status} ${b.error}`);
    r = await post(base({ license: `GCLIC${S.toUpperCase()}` }));
    b = await r.json();
    ck("and so is a UBI", r.status === 400 && b.error === "ubi_required", `${r.status} ${b.error}`);

    // Neither is asked of the kinds that only hire.
    r = await post({ ...base({}), kind: "property_manager", subdomain: `sgnpm${S}`, email: `pm.${S}@signup.test` });
    ck("a property manager is not asked for either", r.status === 201 || r.status === 200, `${r.status}`);

    r = await post(base({ license: `GCLIC${S.toUpperCase()}`, ubi: "601 555 000",
      city: "Bellingham", state: "WA", zip: "98225" }));
    b = await r.json();
    ck("with both, the account is created", r.status === 201 || r.status === 200, `${r.status} ${b.error || ""}`);

    // And it is findable immediately, with what was typed -- not a name and
    // nothing else waiting for somebody to fill in a settings page.
    const made = rows(d1(`SELECT c.company, c.license, c.ubi, c.city, c.state FROM companies c
      JOIN accounts a ON a.company_id = c.id WHERE a.subdomain = 'sgn${S}'`));
    ck("carrying the licence that was typed", made[0]?.license === `GCLIC${S.toUpperCase()}`,
      JSON.stringify(made[0]));
    ck("and the UBI", made[0]?.ubi === "601 555 000", String(made[0]?.ubi));
    ck("and where they are, which the form always collected and always threw away",
      made[0]?.city === "Bellingham" && made[0]?.state === "WA", `${made[0]?.city}, ${made[0]?.state}`);

    // The licence is unique across every company row, so a second account
    // claiming one is refused by name rather than by constraint violation --
    // adopting the row would hand whoever knows a public number its
    // documents.
    r = await post(base({ license: `GCLIC${S.toUpperCase()}`, ubi: "601 555 001",
      subdomain: `sgn2${S}`, email: `gc2.${S}@signup.test` }));
    b = await r.json();
    ck("a licence already on file is refused, by name",
      r.status === 409 && b.error === "license_taken", `${r.status} ${b.error}`);
  }
  console.log("\n-- and the form asks, or does not, by role --");
  {
    // The marketing signup page, which is where nearly every account is
    // actually made. The pair of boxes belongs to the one role that can be
    // hired, and has to come and go with the radio rather than sit there
    // asking a landlord for a contractor's licence.
    const browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
      headless: true, args: ["--no-sandbox", "--disable-gpu"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1100, height: 1300 });
      const crashes = [];
      page.on("pageerror", (e) => crashes.push(e.message));
      await page.goto(`http://127.0.0.1:${SITE}/get-started.html`, { waitUntil: "domcontentloaded" });
      await wait(1500);
      const read = () => page.evaluate(() => {
        const box = document.getElementById("gcCreds");
        return {
          shown: !!box && !box.classList.contains("hide"),
          fields: [...(box?.querySelectorAll("input") || [])].map((i) => i.placeholder),
          role: document.querySelector('input[name="role"]:checked')?.value || null,
        };
      });
      const pick = async (role) => {
        await page.evaluate((v) => {
          const r = [...document.querySelectorAll('input[name="role"]')].find((x) => x.value === v);
          r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true }));
        }, role);
        await wait(350);
        return read();
      };
      const first = await read();
      ck("general contractor is the default, and is asked",
        first.role === "General contractor" && first.shown === true, JSON.stringify(first));
      ck("for a licence number and a UBI",
        first.fields.some((f) => /licen[cs]e/i.test(f)) && first.fields.some((f) => /ubi/i.test(f)),
        first.fields.join(" | "));
      for (const role of ["Property manager", "Building owner", "Commercial portfolio manager"]) {
        const r = await pick(role);
        ck(`${role} is not asked`, r.shown === false, JSON.stringify(r.shown));
      }
      const back = await pick("General contractor");
      ck("and it comes back on switching back", back.shown === true);
      ck("nothing threw on the signup page", crashes.length === 0, crashes.join(" ; "));
    } finally { await browser.close(); }
  }
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
} finally {
  cleanup();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
