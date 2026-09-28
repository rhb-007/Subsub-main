// The door for the company that gets HIRED.
//
// The send-your-compliance-pack loop is aimed at subcontractors, and in a
// product with no directory it is the only flywheel there is: supply brings
// demand in. A roofer following it -- off a licensing page, or off the pack
// page itself -- landed on get-started.html, which opened on a plan priced in
// contractor seats and asked them to pick from four ways to describe a
// business, all four of which HIRE. "General contractor" was the only one that
// produced a hireable account, so that is what they had to choose, and from
// then on the console, the account switcher and their own branded sign-in page
// all called a roofing company a general contractor.
//
// Then the rest of the form asked them about a business they do not run:
// "trades you work with -- pick everything you hire out", and a whole step for
// inviting their subcontractors.
//
// What this covers:
//
//   THE KIND EXISTS AND IS HIREABLE, in the browser's list and the Worker's,
//   and the two agree. A kind the app renders and the API rejects is an account
//   nobody can make; a kind the API accepts and the app cannot render is an
//   account nobody can open.
//
//   IT IS HIREABLE, so 031 mints it a company row. Leaving it out of
//   HIREABLE_KINDS would give a subcontractor nothing to be hired AS, which is
//   the only thing they came for.
//
//   THE FORM RE-LABELS ITSELF rather than leaving them to work out which boxes
//   are for them -- and drops the invite step, because a subcontractor has
//   nobody to invite and offering the step with a "Skip for now" button is
//   asking a question in order to wave it away.
//
//   AND THE STEP NUMBERS FOLLOW. They are markup, not a counter, so hiding the
//   third item leaves a bar reading 1, 2, 4.
//
//   node scripts/sub-signup-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveApp, launch, tally, wait } from "./lib/stub-stack.mjs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const root = join(app, "..");
const t = tally();
const SITE = 5257;

// ---- the two lists, and that they agree -------------------------------
{
  console.log("\n-- the kind, on both sides --");
  const worker = readFileSync(join(app, "worker", "index.js"), "utf8");
  const ui = readFileSync(join(app, "src", "App.tsx"), "utf8");

  const listOf = (src, name) => {
    const m = src.match(new RegExp("const " + name + " = \\[([^\\]]*)\\]"));
    return m ? m[1].split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : null;
  };
  const kinds = listOf(worker, "ACCOUNT_KINDS");
  const hireable = listOf(worker, "HIREABLE_KINDS");
  const withProps = listOf(worker, "ACCOUNT_KINDS_WITH_PROPERTIES");
  t.ck("the Worker's list was found", Array.isArray(kinds), JSON.stringify(kinds));
  t.ck("subcontractor is a kind the API will accept",
    kinds.includes("subcontractor"), JSON.stringify(kinds));
  // The whole point. Without this 031 mints no company row and there is
  // nothing for anybody to hire.
  t.ck("and it is hireable", hireable.includes("subcontractor"), JSON.stringify(hireable));
  t.ck("with no buildings, so no tenant or owner can be attached to one",
    !withProps.includes("subcontractor"), JSON.stringify(withProps));

  // The browser's copy. A kind the API accepts and the app cannot render is an
  // account nobody can open.
  const block = ui.slice(ui.indexOf("const ACCOUNT_KINDS = {"),
    ui.indexOf("const hasTenants"));
  t.ck("the app renders it too", /subcontractor:\s*{/.test(block), block.slice(0, 60));
  t.ck("labelled as one", /label: "Subcontractor"/.test(block), "");
  t.ck("hireable there as well",
    /subcontractor:[\s\S]*?hireable: true/.test(block), "");
  t.ck("and with no properties",
    /subcontractor:[\s\S]*?properties: false/.test(block), "");

  // Every kind the Worker will store has to be renderable, or an account lands
  // on a screen that calls it the default.
  for (const k of kinds) {
    t.ck(`${k} is renderable`, new RegExp(`\\b${k}:\\s*{`).test(block), k);
  }

  // The invariant counts hireable accounts, not general contractors. A literal
  // there would flag every subcontractor as an illegal company row AND let one
  // with no company be hired as.
  console.log("\n-- and CHECK.sql's invariant follows the same set --");
  const check = readFileSync(join(app, "worker", "migrations", "CHECK.sql"), "utf8");
  t.ck("it no longer names one kind",
    !/kind = 'general_contractor' AND company_id IS NULL/.test(check), "");
  t.ck("it counts every hireable kind with no company",
    /m031_hireable_without/.test(check), "");
  for (const k of hireable) {
    t.ck(`${k} is in the invariant's list`,
      new RegExp(`IN \\([^)]*'${k}'`).test(check), k);
  }
  // Named outright as well as derived. The loop above reads its list out of
  // HIREABLE_KINDS, so dropping a kind from BOTH places would leave it
  // passing -- which is the one change this section exists to catch.
  t.ck("and subcontractor is named there outright",
    /IN \('general_contractor','subcontractor'\)/.test(check), "");
  t.ck("on both halves of it",
    (check.match(/'general_contractor','subcontractor'/g) || []).length === 2,
    String((check.match(/'general_contractor','subcontractor'/g) || []).length));
}

// ---- what the API actually writes --------------------------------------
// The lists agreeing is not the same as the row existing. 031's whole point is
// that an account which can be hired HAS a company row for somebody to hire --
// leaving `subcontractor` out of HIREABLE_KINDS would sail past every check
// above and produce an account with nothing to be hired as, which is the only
// thing a subcontractor came here for.
{
  console.log("\n-- and a subcontractor signup gets a company of its own --");
  const { default: worker } = await import("../worker/index.js");
  const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    // No Supabase and no mail in here. Signing up has to survive both being
    // unreachable anyway -- the account is written either way.
    if (/supabase|resend/.test(u)) return new Response("{}", { status: 200 });
    return realFetch(url, opts);
  };
  try {
    const signup = async (kind, subdomain) => {
      // Redundant now that schema.sql is current, and kept as a statement of
      // what this needs. It was load-bearing when written: without
      // `accounts.company_id` the signup route treats the missing column as "a
      // database without 031" and moves on quietly, so the company row was
      // simply absent and read as a bug in the route rather than a gap in the
      // harness. That is the failure mode test:schemadrift now prevents.
      const db = freshDb({ base: SCHEMA, migrations: [
        "ALTER TABLE accounts ADD COLUMN hostname_status TEXT;",
        "ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);",
      ] });
      const env = { DB: makeD1(db), APP_DOMAIN: "subsub.work" };
      const r = await worker.fetch(new Request("https://api.subsub.work/api/signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, company: "Ridge Roofing", name: "Sam Ridge",
          email: `sam+${subdomain}@ridge.test`, password: "hunter2hunter2",
          subdomain, plan: "basic", trades: ["roofing"],
          license: "RIDGE123AB", ubi: "601234567",
          city: "Seattle", state: "WA", zip: "98101" }),
      }), env);
      const body = await r.json().catch(() => ({}));
      const acct = db.prepare("SELECT * FROM accounts WHERE subdomain = ?").get(subdomain);
      const co = acct?.company_id
        ? db.prepare("SELECT * FROM companies WHERE id = ?").get(acct.company_id)
        : null;
      return { status: r.status, body, acct, co };
    };

    const sub = await signup("subcontractor", "ridgeroofing");
    t.ck("the account is created", sub.status === 201, `${sub.status} ${JSON.stringify(sub.body).slice(0, 90)}`);
    t.ck("stored as a subcontractor, not silently as a GC",
      sub.acct?.kind === "subcontractor", String(sub.acct?.kind));
    // THE POINT.
    t.ck("it has a company row, so there is something to hire",
      !!sub.co, String(sub.acct?.company_id));
    t.ck("carrying the licence they just typed, not a name and nothing else",
      sub.co?.license === "RIDGE123AB" && sub.co?.company === "Ridge Roofing"
      && sub.co?.state === "WA", JSON.stringify(sub.co && {
        company: sub.co.company, license: sub.co.license, state: sub.co.state }));

    // And the kinds that only ever hire still get none, which is the other
    // half of the same invariant.
    const pm = await signup("property_manager", "cascademgmt");
    t.ck("a property manager still gets none", pm.status === 201 && !pm.acct?.company_id,
      `${pm.status} ${String(pm.acct?.company_id)}`);

    // An unknown kind falls back rather than storing something unrenderable.
    const junk = await signup("roofer", "someoneelse");
    t.ck("and an unknown kind falls back to the default",
      junk.acct?.kind === "general_contractor", String(junk.acct?.kind));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---- the whole point, end to end --------------------------------------
// The reason this kind exists: a subcontractor can sign up, put their
// compliance pack together and send it to a general contractor WITHOUT being
// invited by anybody first. Every other way into SubSub needs the hiring side
// to already be here.
//
// Six different gates stand between signing up and a pack landing in somebody's
// inbox, and each reads a different thing. Any one of them reverting to a
// `general_contractor` literal breaks the loop silently, so this walks the lot
// rather than testing them one at a time.
{
  console.log("\n-- a subcontractor signs up and sends a pack, uninvited --");
  const { default: worker } = await import("../worker/index.js");
  const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
  const { makeD1: mk, freshDb: fresh } = await import("./lib/d1-sqlite.mjs");

  const mails = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("api.resend.com")) {
      const b = (() => { try { return JSON.parse(opts.body || "{}"); } catch { return {}; } })();
      mails.push({ to: [].concat(b.to || []), html: b.html || b.text || "" });
      return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
    }
    if (/supabase/.test(u)) return new Response("{}", { status: 200 });
    return realFetch(url, opts);
  };

  try {
    // These are no-ops now that schema.sql carries everything the migrations
    // add -- freshDb swallows "already there" and nothing else. They are left
    // in because they say what this test depends on, and because the migration
    // FILES are read rather than restated: a hand-copied CREATE goes stale the
    // first time somebody adds a column.
    const mig = (f) => readFileSync(join(app, "worker", "migrations", f), "utf8");
    const db = fresh({ base: SCHEMA, migrations: [
      "ALTER TABLE accounts ADD COLUMN hostname_status TEXT;",
      "ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);",
      mig("030_connect_requests.sql"),
      mig("037_document_detail.sql"),
      mig("041_doc_shares.sql"),
    ] });
    const env = { DB: mk(db), RESEND_API_KEY: "re_stub",
      MAIL_FROM: "SubSub <no-reply@subsub.work>", APP_DOMAIN: "subsub.work" };

    // 1. Sign up. Nobody invited them; there is no invite token in this flow.
    const signup = await worker.fetch(new Request("https://api.subsub.work/api/signup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "subcontractor", company: "Ridge Roofing",
        name: "Sam Ridge", email: "sam@ridge.test", password: "hunter2hunter2",
        subdomain: "ridgeroofing", plan: "basic", trades: ["roofing"],
        license: "RIDGE123AB", city: "Seattle", state: "WA", zip: "98101" }),
    }), env);
    const made = await signup.json().catch(() => ({}));
    t.ck("1. they get an account", signup.status === 201,
      `${signup.status} ${JSON.stringify(made)}`);
    if (signup.status !== 201) throw new Error("signup failed: " + JSON.stringify(made));

    const seat = { "X-User-Id": made.userId, "X-Account-Id": made.accountId,
      "Content-Type": "application/json" };
    const call = (path, opts = {}) => worker.fetch(new Request(
      `https://api.subsub.work/api${path}`,
      { ...opts, headers: { ...seat, ...(opts.headers || {}) } }), env);

    // 2. Their company row is readable by their own admin seat. This is the
    //    gate that answers not_hireable for a property manager.
    const mine = await call("/my-company");
    const mineBody = await mine.json().catch(() => ({}));
    t.ck("2. they can read their own company", mine.status === 200,
      `${mine.status} ${JSON.stringify(mineBody).slice(0, 80)}`);
    t.ck("   with the licence they typed at signup",
      mineBody.license === "RIDGE123AB", String(mineBody.license));
    // The route answers `companyId`, not `id`.
    const myCompanyId = mineBody.companyId;
    t.ck("   and names the row that is theirs",
      typeof myCompanyId === "string" && myCompanyId.startsWith("cmp_own_"),
      String(myCompanyId));

    // 3. Upload. THE ONE THAT WAS BROKEN. mayWriteCompanyDocs asked "do I hire
    //    this company", and for yourself the answer is always no -- so a
    //    hireable account nobody had hired yet got a 404 uploading its own
    //    certificate, with the panel rendered and the button dead.
    const nobodyHiresThem = db.prepare(
      "SELECT COUNT(*) AS n FROM engagements WHERE account_id = ?").get(made.accountId).n;
    t.ck("3. nobody has engaged them, which is the whole case",
      nobodyHiresThem === 0, String(nobodyHiresThem));
    const up = await call(`/subs/${myCompanyId}/documents/insurance`, {
      method: "POST",
      body: JSON.stringify({ fileKey: "k1", fileName: "coi.pdf",
        issuer: "Cascade Mutual", policyNo: "POL-1",
        coverageCents: 200000000, expiresOn: "2027-06-30" }),
    });
    t.ck("   they can upload their own insurance", up.status < 300,
      `${up.status} ${(await up.clone().text()).slice(0, 80)}`);
    t.ck("   and it is on the company row",
      db.prepare("SELECT insurance FROM companies WHERE id = ?").get(myCompanyId).insurance === 1);

    // 4. Send it. This is the growth loop: the recipient needs no account.
    const share = await call("/doc-shares", {
      method: "POST",
      body: JSON.stringify({ toEmail: "priya@cascade.test", kinds: ["insurance"] }),
    });
    const shareBody = await share.json().catch(() => ({}));
    t.ck("4. they can send the pack", share.status < 300,
      `${share.status} ${JSON.stringify(shareBody).slice(0, 90)}`);
    t.ck("   and it went to the address they typed",
      mails.some((m) => m.to.includes("priya@cascade.test")),
      JSON.stringify(mails.map((m) => m.to)));

    // 5. And the recipient reads it with no account at all, which is what
    //    makes this supply-brings-demand rather than another invite.
    const token = db.prepare("SELECT token FROM doc_shares WHERE company_id = ?")
      .get(myCompanyId)?.token;
    t.ck("5. a share token exists", !!token, String(token));
    const pack = await worker.fetch(new Request(
      `https://api.subsub.work/api/pack/${token}`), env);
    const packBody = await pack.json().catch(() => ({}));
    t.ck("   the pack page opens with no session", pack.status === 200, String(pack.status));
    t.ck("   naming the company", packBody.company === "Ridge Roofing", String(packBody.company));
    t.ck("   and carrying the expiry, which an attached PDF cannot",
      (packBody.docs || []).some((d) => d.kind === "insurance" && d.expiresOn === "2027-06-30"),
      JSON.stringify(packBody.docs));

    // And the line that must not move while fixing the above: somebody else's
    // company is still not writable. The hole this check was added to close is
    // that cmp_own_<accountId> is derivable from a public route.
    db.exec(`INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc_other','Someone Else','elsewhere','general_contractor');
      INSERT INTO companies(id,company) VALUES ('cmp_own_acc_other','Someone Else');
      UPDATE accounts SET company_id='cmp_own_acc_other' WHERE id='acc_other';`);
    const hack = await call("/subs/cmp_own_acc_other/documents/insurance", {
      method: "POST", body: JSON.stringify({ fileKey: "k2", fileName: "x.pdf" }),
    });
    t.ck("6. and another account's company is still not theirs to write",
      hack.status === 404, String(hack.status));
    t.ck("   answering not_found, so derived ids cannot be confirmed",
      (await hack.json().catch(() => ({}))).error === "not_found");
    t.ck("   and nothing was written",
      db.prepare("SELECT insurance FROM companies WHERE id='cmp_own_acc_other'").get().insurance === 0);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---- 046, the migration most databases must not run --------------------
// `accounts.kind` was added by migration 003 as PLAIN TEXT, deliberately: "the
// CHECK constraint is deliberately omitted: adding one to an existing table
// needs a full table rebuild". So a database grown through the migrations
// accepts the new kind with nothing run at all, while one built from schema.sql
// carries the CHECK and refuses it -- surfacing as `signup_conflict`, a 409, and
// no account, silent until the first subcontractor tries.
//
// CHECK.sql has to say WHICH of those is in front of whoever is reading it,
// because the remedy is a table rebuild and running one that is not needed is
// strictly worse than doing nothing.
{
  console.log("\n-- CHECK.sql says whether 046 is needed --");
  const { DatabaseSync } = await import("node:sqlite");
  const check = readFileSync(join(app, "worker", "migrations", "CHECK.sql"), "utf8");
  const probe = check.match(/\(SELECT CASE[\s\S]*?AS m046_kind_check/);
  t.ck("the probe was found in CHECK.sql", !!probe, "");

  const shapeOf = (ddl) => {
    const db = new DatabaseSync(":memory:");
    db.exec(ddl);
    // Just the probe, against just the table it reads. CHECK.sql as a whole
    // runs against a migrated database and schema.sql is not one.
    const sql = `SELECT ${probe[0].replace(/ AS m046_kind_check$/, "")} AS v`;
    return db.prepare(sql).get().v;
  };

  const migrated = `CREATE TABLE accounts (id TEXT PRIMARY KEY, subdomain TEXT UNIQUE,
    kind TEXT NOT NULL DEFAULT 'general_contractor');`;
  const oldCheck = `CREATE TABLE accounts (id TEXT PRIMARY KEY, subdomain TEXT UNIQUE,
    kind TEXT NOT NULL DEFAULT 'general_contractor'
      CHECK (kind IN ('general_contractor','property_manager',
                      'building_owner','portfolio_manager')));`;
  const widened = `CREATE TABLE accounts (id TEXT PRIMARY KEY, subdomain TEXT UNIQUE,
    kind TEXT NOT NULL DEFAULT 'general_contractor'
      CHECK (kind IN ('general_contractor','subcontractor','property_manager',
                      'building_owner','portfolio_manager')));`;

  t.ck("a migrated database reads 0, so nothing is run", shapeOf(migrated) === 0,
    String(shapeOf(migrated)));
  t.ck("one carrying the old constraint reads 1, so the rebuild is run",
    shapeOf(oldCheck) === 1, String(shapeOf(oldCheck)));
  t.ck("and a widened one reads 2, so it is not run twice",
    shapeOf(widened) === 2, String(shapeOf(widened)));

  // And the three shapes really do behave the way the probe claims, which is
  // the thing the number is a proxy for.
  const stores = (ddl) => {
    const db = new DatabaseSync(":memory:");
    db.exec(ddl);
    try {
      db.exec("INSERT INTO accounts (id, subdomain, kind) VALUES ('a','a','subcontractor');");
      return true;
    } catch { return false; }
  };
  t.ck("0 really does accept the kind", stores(migrated) === true);
  t.ck("1 really does refuse it", stores(oldCheck) === false);
  t.ck("2 really does accept it", stores(widened) === true);

  // schema.sql is the shape a FRESH database gets, so it has to be the widened
  // one or a new install is born unable to make the account this kind exists for.
  const schema = readFileSync(join(app, "worker", "schema.sql"), "utf8");
  const accounts = schema.slice(schema.indexOf("CREATE TABLE accounts"),
    schema.indexOf("CREATE TABLE", schema.indexOf("CREATE TABLE accounts") + 10));
  t.ck("and schema.sql itself carries the widened list",
    /CHECK \(kind IN \([^)]*'subcontractor'/s.test(accounts), accounts.slice(0, 40));

  // The rebuild drops every index with the table, and one of them is not
  // optional: every branded page load looks an account up by subdomain.
  const m046 = readFileSync(join(app, "worker", "migrations", "046_subcontractor_kind.sql"), "utf8");
  t.ck("046 puts the subdomain index back",
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_subdomain/.test(m046), "");
  t.ck("and says outright that most databases run none of it",
    /MOST DATABASES NEED NOTHING/.test(m046), "");
  t.ck("naming the reading that means run it", /m046_kind_check/.test(m046), "");
}

// ---- and the form -----------------------------------------------------
const site = serveApp({ dir: root, port: SITE });
const browser = await launch();
const open = async (qs) => {
  const page = await browser.newPage();
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.setViewport({ width: 1100, height: 1400 });
  await page.goto(`http://127.0.0.1:${SITE}/get-started.html${qs || ""}`,
    { waitUntil: "domcontentloaded" });
  await wait(600);
  return { page, crashes };
};
const seen = (page) => page.evaluate(() => ({
  role: document.querySelector('input[name="role"]:checked')?.value || null,
  roles: [...document.querySelectorAll('input[name="role"]')].map((r) => r.value),
  creds: !document.getElementById('gcCreds')?.classList.contains('hide'),
  pill: !document.querySelector('.planpill')?.classList.contains('hide'),
  invStep: !document.getElementById('barInvites')?.classList.contains('hide'),
  doneN: document.getElementById('barDoneN')?.textContent.trim() || null,
  trades: document.getElementById('tradesLabel')?.textContent.trim() || null,
  hint: document.getElementById('tradesHint')?.textContent.trim() || null,
  pricing: [...document.querySelectorAll('a[href="pricing.html"]')]
    .filter((a) => !a.classList.contains('hide')).length,
}));
const pick = async (page, value) => {
  await page.evaluate((v) => {
    const r = [...document.querySelectorAll('input[name="role"]')].find((x) => x.value === v);
    if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
  }, value);
  await wait(250);
};

try {
  console.log("\n-- the role is on the form at all --");
  {
    const { page, crashes } = await open();
    const s = await seen(page);
    t.ck("Subcontractor is one of the choices",
      s.roles.includes("Subcontractor"), JSON.stringify(s.roles));
    // The default must not move: a general contractor is still who this page is
    // mostly for, and a changed default is a silent change to every signup.
    t.ck("and it is not the default", s.role === "General contractor", String(s.role));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await page.close();
  }

  console.log("\n-- and choosing it changes the questions --");
  {
    const { page, crashes } = await open();
    const gc = await seen(page);
    await pick(page, "Subcontractor");
    const sub = await seen(page);

    // The licence is the thing that makes them hireable, which is why they are
    // here at all -- so it is asked, as it is of a general contractor.
    t.ck("the licence pair is still asked", sub.creds === true, String(sub.creds));
    // And these are the three that were describing somebody else's business.
    t.ck("the plan pill goes, because every limit on it counts contractors",
      gc.pill === true && sub.pill === false, `${gc.pill} -> ${sub.pill}`);
    t.ck("so do the ways back to a price list that prices contractor seats",
      gc.pricing > 0 && sub.pricing === 0, `${gc.pricing} -> ${sub.pricing}`);
    t.ck("the invite step goes, because they have nobody to invite",
      gc.invStep === true && sub.invStep === false, `${gc.invStep} -> ${sub.invStep}`);
    // Markup, not a counter: hiding the third item leaves 1, 2, 4.
    t.ck("and the last step renumbers rather than reading 4 of 3",
      gc.doneN === "4" && sub.doneN === "3", `${gc.doneN} -> ${sub.doneN}`);

    t.ck("trades are what they DO, not what they hire out",
      /work in/i.test(sub.trades || ""), String(sub.trades));
    t.ck("and the hint stops talking about their subcontractors",
      !/your subcontractors/i.test(sub.hint || ""), String(sub.hint));
    t.ck("the general contractor's wording is untouched",
      /work with/i.test(gc.trades || "") && /hire out/i.test(gc.hint || ""),
      `${gc.trades} / ${gc.hint}`);

    // Reversible: somebody who mis-taps must get the whole form back.
    await pick(page, "General contractor");
    const back = await seen(page);
    t.ck("changing back restores every one of them",
      back.pill === true && back.invStep === true && back.doneN === "4"
      && /work with/i.test(back.trades || "") && back.pricing > 0,
      JSON.stringify(back));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await page.close();
  }

  console.log("\n-- and a trade can actually be picked --");
  {
    // Not a subcontractor question at all in the end, which is why it is worth
    // a test rather than a fix: #trades carried a DELEGATED click handler
    // toggling aria-pressed, and each chip carried its own doing the same. Both
    // ran on one click, so every selection toggled twice and netted to nothing.
    // Step 2 refuses to continue without at least one trade, so public signup
    // was blocked -- for every account kind, since the first version of this
    // page. It surfaced on the subcontractor flow only because that is the
    // screen somebody was looking at.
    const { page, crashes } = await open("?as=subcontractor");
    const pressed = () => page.evaluate(() =>
      [...document.querySelectorAll('#trades button[aria-pressed="true"]')]
        .map((b) => b.getAttribute("data-trade")));
    const tap = (trade) => page.evaluate((t) =>
      document.querySelector(`#trades button[data-trade="${t}"]`).click(), trade);

    t.ck("nothing is picked to begin with", (await pressed()).length === 0);
    await tap("roofing"); await wait(120);
    t.ck("one tap selects it", JSON.stringify(await pressed()) === '["roofing"]',
      JSON.stringify(await pressed()));
    await tap("gutters"); await wait(120);
    t.ck("and a second adds rather than replaces",
      (await pressed()).length === 2, JSON.stringify(await pressed()));
    // A double handler would also break DEselecting, in the other direction.
    await tap("roofing"); await wait(120);
    t.ck("tapping again removes just that one",
      JSON.stringify(await pressed()) === '["gutters"]', JSON.stringify(await pressed()));

    // And the thing the selection is FOR: step 2 will not continue without one.
    t.ck("exactly one handler is bound to the chips, not two",
      await page.evaluate(() => {
        // Count how far one synthetic click moves it. Two handlers cancel out.
        const b = document.querySelector('#trades button[data-trade="siding"]');
        const was = b.getAttribute("aria-pressed");
        b.click();
        const now = b.getAttribute("aria-pressed");
        b.click();
        return was !== now;
      }));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await page.close();
  }

  console.log("\n-- and Scale is not sold to somebody it cannot help --");
  {
    // "On Basic your SUBCONTRACTORS sign in through SubSub" -- they have none,
    // and what Scale sells (unlimited subcontractors, users and jobs, branding
    // for a roster they do not keep) answers no question they have.
    const { page, crashes } = await open();
    const locked = () => page.evaluate(() =>
      !document.getElementById("brandLocked")?.classList.contains("hide"));
    t.ck("a general contractor on Basic is still told about it", (await locked()) === true);
    await pick(page, "Subcontractor");
    t.ck("a subcontractor is not", (await locked()) === false);
    await pick(page, "General contractor");
    t.ck("and it comes back if they change their mind", (await locked()) === true);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await page.close();
  }

  console.log("\n-- arriving from a page written for subcontractors --");
  {
    // The licensing CTA says "Set up your compliance pack" to somebody who has
    // already told us what they are. Opening on "General contractor" and asking
    // them to correct it is asking a question twice.
    const { page, crashes } = await open("?as=subcontractor");
    const s = await seen(page);
    t.ck("the role is already picked", s.role === "Subcontractor", String(s.role));
    t.ck("and the form is already theirs",
      s.pill === false && s.invStep === false && /work in/i.test(s.trades || ""),
      JSON.stringify(s));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await page.close();
  }

  console.log("\n-- and it asks for the password once, not three times --");
  {
    // Signing up used to take a password, and then the confirmation link asked
    // for a new one twice -- three boxes for one password, and the first was
    // never used. Confirming the address is the step that cannot be skipped, so
    // the password is set on the screen that link lands on.
    const { page, crashes } = await open();
    t.ck("the signup form has no password field",
      await page.evaluate(() => !document.getElementById("pw")));
    t.ck("nor any password input at all on step 1",
      await page.evaluate(() =>
        document.querySelectorAll('.step[data-step="1"] input[type=password]').length === 0));
    // And it must not silently require one it no longer shows.
    await page.evaluate(() => {
      document.getElementById("name").value = "Jason";
      document.getElementById("email").value = "jason@orcas.test";
      document.querySelector("#f1 button[type=submit]").click();
    });
    await wait(400);
    const on = await page.evaluate(() => [...document.querySelectorAll(".step")]
      .filter((x) => x.hasAttribute("data-on")).map((x) => x.dataset.step));
    t.ck("step 1 completes without one", on.includes("2"), JSON.stringify(on));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await page.close();
  }

  console.log("\n-- and the confirmation says what the account is for --");
  {
    // Driven all the way to step 4 with the API stubbed, because the points are
    // written by the success handler and a test that never submits never sees
    // them. Reading the rendered list, not the source.
    const { page, crashes } = await open("?as=subcontractor");
    // The form posts cross-origin to api.subsub.work, so the PREFLIGHT has to be
    // answered as well -- a stub that only handles the POST gets "blocked by
    // CORS policy" and the page shows "we could not reach the server", which
    // looks exactly like the form being broken.
    const CORS = { "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      if (!/\/api\/signup$/.test(r.url())) return r.continue();
      if (r.method() === "OPTIONS") return r.respond({ status: 204, headers: CORS });
      return r.respond({ status: 201, contentType: "application/json", headers: CORS,
        body: JSON.stringify({ ok: true, accountId: "acc_x", userId: "u_x",
          subdomain: "orcas", kind: "subcontractor",
          signInUrl: "https://app.subsub.work", needsConfirmation: true }) });
    });
    await page.evaluate(() => {
      document.getElementById("name").value = "Jason";
      document.getElementById("email").value = "jason@orcas.test";
      document.querySelector("#f1 button[type=submit]").click();
    });
    await wait(500);
    await page.evaluate(() => {
      document.getElementById("company").value = "Orcas Roofing";
      document.querySelector('#trades button[data-trade="roofing"]').click();
      document.querySelector("#f2 button[type=submit]").click();
    });
    for (let n = 0; n < 40; n++) {
      await wait(150);
      const on = await page.evaluate(() => [...document.querySelectorAll(".step")]
        .filter((x) => x.hasAttribute("data-on")).map((x) => x.dataset.step));
      if (on.includes("4")) break;
    }
    const points = await page.evaluate(() =>
      [...document.querySelectorAll('.step[data-step="4"] .ticks li')]
        .map((li) => li.innerText.replace(/\s+/g, " ").trim()));
    const onStep = await page.evaluate(() => [...document.querySelectorAll(".step")]
      .filter((x) => x.hasAttribute("data-on")).map((x) => x.dataset.step));
    // Asserted properly: the step-4 list is in the DOM whether or not it is
    // SHOWN, so "there are list items" passes without ever getting there.
    t.ck("it reached the confirmation", onStep.includes("4"),
      JSON.stringify(onStep) + " " + JSON.stringify(
        await page.evaluate(() => [...document.querySelectorAll("[role=alert],.field-err")]
          .map((e) => e.textContent.trim()).slice(0, 2))));
    t.ck("more than the two it shipped with", points.length >= 5, String(points.length));

    const all = points.join(" | ");
    t.ck("the paperwork loop is there", /one link/i.test(all) && /expiry/i.test(all), all.slice(0, 80));
    t.ck("work arriving is there", /work order/i.test(all) && /accept or decline/i.test(all));
    t.ck("the calendar is there", /crew/i.test(all) && /book/i.test(all));
    t.ck("and that they can hire too", /hiring|sub out/i.test(all) && /second account/i.test(all));

    // THE LOAD-BEARING NEGATIVE. ContractorPortal is behind can("portal") and
    // ROLES.admin does not include it, so the cross-client list does not exist
    // for the person reading this page. Promising it here would be the
    // screen-that-lies failure at its most expensive: on the page where
    // somebody decided to trust us.
    t.ck("it does NOT promise every client in one list",
      !/(all|every).{0,24}client.{0,24}(one|single) (list|place|screen)/i.test(all), all);
    t.ck("nor a dashboard of work it cannot open",
      !/one list of (your )?work/i.test(all), all);

    // And overflow is phrased as earned, because ELIGIBILITY makes it so:
    // ninety days, five completed jobs, 4.0 over three rated ones.
    const of = points.find((p) => /did not go looking|reach you/i.test(p)) || "";
    t.ck("overflow is offered as earned, not immediate",
      /once/i.test(of) && /(finished|completed)/i.test(of), of);
    t.ck("and never as a listing somebody buys", !/pay for|listing to pay/i.test(of) || /no listing/i.test(of), of);

    // A general contractor's confirmation is untouched.
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await page.close();
  }

  console.log("\n-- a link with a typo in it falls back rather than breaking --");
  {
    // Matched against the radios' own values, so a marketing link that says
    // something we do not have picks the default instead of writing a kind
    // nothing renders.
    const { page, crashes } = await open("?as=roofer");
    const s = await seen(page);
    t.ck("the default stands", s.role === "General contractor", String(s.role));
    t.ck("and the page is the ordinary one", s.pill === true && s.invStep === true,
      JSON.stringify(s));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await page.close();
  }

  console.log("\n-- the kind it would actually send --");
  {
    const { page } = await open("?as=subcontractor");
    // Read the map off the page rather than restating it here: a test with its
    // own copy of the mapping cannot catch the two drifting apart.
    const kind = await page.evaluate(() => {
      const src = [...document.querySelectorAll("script")]
        .map((s) => s.textContent).find((x) => /var KINDS = \{/.test(x || ""));
      const m = src.match(/'Subcontractor':\s*'([a-z_]+)'/);
      return m ? m[1] : null;
    });
    t.ck("Subcontractor maps to the kind the Worker accepts",
      kind === "subcontractor", String(kind));
    await page.close();
  }

  console.log("\n-- and the licensing pages send them through it --");
  {
    const render = readFileSync(join(root, "content", "licensing", "render.mjs"), "utf8");
    const sub = render.slice(render.indexOf("const SUB_CTA"), render.indexOf("const GC_CTA"));
    const gc = render.slice(render.indexOf("const GC_CTA"));
    t.ck("the subcontractor's CTA names the role",
      /get-started\.html\?as=subcontractor/.test(sub), "");
    // The hiring reader is a general contractor or a manager and must NOT be
    // pushed down the subcontractor path.
    t.ck("and the hiring one does not",
      /get-started\.html">/.test(gc) && !/as=subcontractor/.test(gc.slice(0, 900)), "");
  }
} finally {
  await browser.close();
  site.close();
}

t.done();
