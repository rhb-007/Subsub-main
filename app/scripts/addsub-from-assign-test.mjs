// The assign screen with nobody to assign.
//
// It used to say "No contractors cover roofing." and stop there: a dead end
// on the one screen where the manager already knows what they need. This
// drives the real browser through the whole way out -- the button, the
// three-step form, and the return to the job they were in the middle of --
// because the return trip is the part that is easy to write and easy to get
// silently wrong.
//
// Needs the local stack: worker on 8787 (with the Supabase stand-in on 8902
// as SUPABASE_URL), dist served on 5191, built with VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY pointing at that stand-in.
//
//   node scripts/addsub-from-assign-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const APP = process.env.APP_BASE || "http://127.0.0.1:5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const EMAIL = "admin@example.test";          // Richard Braun, admin on Outerhome
const ACCOUNT = "acc_test";                  // which has no subcontractors
const TRADE = "roofing";
const MARK = "Harbour Roofing";     // every company this test makes
const JOB_MARKS = ["Ridge cap lift", "Porch post rot"];  // every job it makes

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The whole point of the screen is an account with nobody on it, so the run
// has to leave the account exactly as it found it -- otherwise the second run
// tests a different screen than the first and quietly passes. There is no
// delete endpoint for either, by design, so this goes at the database.
// Retried, because the local D1 file is shared with a dev server that
// reloads whenever a source file changes, and a statement landing in that
// window fails on a lock rather than on anything about the statement. A
// scrub that dies there takes the whole run with it and reads as a broken
// feature. A statement that keeps failing still throws.
const sql = (cmd) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
        "--config=./wrangler.toml", "--local", "--command", cmd], { stdio: ["ignore", "ignore", "ignore"] });
    } catch (err) {
      if (attempt >= 3) throw err;
      execFileSync("sleep", ["1"]);
    }
  }
};
const scrub = () => {
  // In reference order. Adding a contractor now also creates a login for
  // them -- a users row, a seat, and an invite to set a password, because
  // adding somebody and telling them nothing was the last silent way into
  // an account. All of that points at the company, so the company cannot go
  // first without tripping a foreign key.
  sql(`DELETE FROM user_invites WHERE user_id IN (SELECT user_id FROM memberships
        WHERE company_id IN (SELECT id FROM companies WHERE company LIKE '${MARK}%'))`);
  sql(`DELETE FROM users WHERE id IN (SELECT user_id FROM memberships
        WHERE company_id IN (SELECT id FROM companies WHERE company LIKE '${MARK}%'))`);
  sql(`DELETE FROM memberships WHERE company_id IN (SELECT id FROM companies WHERE company LIKE '${MARK}%')`);
  sql(`DELETE FROM engagements WHERE company_id IN (SELECT id FROM companies WHERE company LIKE '${MARK}%')`);
  sql(`DELETE FROM companies WHERE company LIKE '${MARK}%'`);
  for (const m of JOB_MARKS) sql(`DELETE FROM jobs WHERE account_id = '${ACCOUNT}' AND title LIKE '${m}%'`);
};

// ---- fixture: one job with an unfilled roofing slot ----------------------
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
scrub();                             // in case an earlier run died mid-way
const t = await tok(EMAIL);
const S = Date.now().toString(36);
const TITLE = `Ridge cap lift ${S}`;
const makeJob = async (title, trade) => {
  const r = await fetch(`${API}/jobs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" },
    body: JSON.stringify({ title, address: "44 Harbour Way", zip: "98101", trades: [trade] }),
  });
  if (!r.ok) { console.error("could not make the fixture job:", r.status, await r.text()); process.exit(1); }
  return r.json();
};
await makeJob(TITLE, TRADE);

// ---- browser -------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true, args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1100 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));

// Click the first element matching `sel` whose text matches `re`.
const hit = (re, sel = "button,a") => page.evaluate((rs, s) => {
  const r = new RegExp(rs, "i");
  const el = [...document.querySelectorAll(s)].find((e) => r.test(e.textContent || ""));
  if (!el) return null;
  el.click();
  return (el.textContent || "").trim();
}, re.source, sel);
const body = () => page.evaluate(() => document.body.innerText);
const seen = async (re) => re.test(await body());
const type = async (sel, v) => { const el = await page.$(sel); if (!el) return false; await el.click({ clickCount: 3 }); await el.type(v); return true; };

try {
  console.log("\n-- signing in --");
  await page.goto(APP + "/", { waitUntil: "networkidle0" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await type("input[type=email]", EMAIL);
  await type("input[type=password]", "correct horse battery");
  await page.click(".login-btn");
  await page.waitForSelector(".ss-header, .tab-bar, nav", { timeout: 15000 });
  await wait(1500);
  ck("signed in as the account's admin", await seen(/Richard Braun/));
  ck("and the account genuinely has no subcontractors", await seen(/Contractors\s*\n?0/));

  console.log("\n-- getting to the assign screen --");
  await hit(/^Jobs/, "button,a");
  await wait(1200);
  ck("the fixture job is on the jobs list", await seen(new RegExp(TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")), TITLE);
  const assignBtn = await hit(/Assign/, ".trade-assign");
  await wait(1000);
  ck("its roofing slot offers to assign", !!assignBtn, assignBtn || "no .trade-assign button");

  console.log("\n-- the empty state --");
  const emptyText = await page.evaluate(() => document.querySelector(".empty")?.innerText || "");
  ck("it says the roster is empty, not that a trade is uncovered",
    /no subcontractors on this account yet/i.test(emptyText), emptyText.split("\n").filter(Boolean)[0]);
  const offered = await page.evaluate(() =>
    [...document.querySelectorAll(".empty button")].map((b) => b.textContent.trim()));
  ck("and offers + Subcontractor", offered.some((x) => /^Subcontractor$/i.test(x)), JSON.stringify(offered));

  console.log("\n-- the way out --");
  await page.evaluate(() => [...document.querySelectorAll(".empty button")]
    .find((b) => /Subcontractor/i.test(b.textContent))?.click());
  await wait(900);
  ck("which opens the add-a-contractor form", await seen(/Add subcontractor/i));
  ck("and the assign screen is out of the way", !(await seen(/No subcontractors on this account yet/i)));

  // Adding now opens on a question -- "are they already on SubSub?" -- with
  // three boxes and nothing else, so that nobody types a whole profile that
  // was already on file. This account is adding somebody genuinely new, so
  // the way through is the way past it. See connect-test.mjs for the gate
  // itself.
  console.log("\n-- past the are-they-already-here gate --");
  ck("it opens on the gate rather than the form", await seen(/already on SubSub\?/i));
  await page.evaluate(() => [...document.querySelectorAll(".cx-gate .form-actions button")]
    .find((b) => /add them myself|^continue$/i.test(b.innerText))?.click());
  await wait(900);
  ck("and skipping it lands on the form", await seen(/Step 1 of 3/));

  // The step asked for thirteen things and needed four of them. The other
  // nine -- two licence numbers, two addresses, a status that defaults to
  // the right answer and a rating for somebody who has not done any work
  // yet -- are behind one tap now.
  console.log("\n-- step 1 asks for what it needs, and offers the rest --");
  {
    const shown = await page.evaluate(() => ({
      labels: [...document.querySelectorAll(".form .fld")]
        .map((f) => f.innerText.trim().split("\n")[0].trim()).filter(Boolean),
      more: !!document.querySelector(".sf-more"),
      open: document.querySelector(".sf-more")?.getAttribute("aria-expanded") === "true",
    }));
    for (const need of ["Company", "Contact", "Phone", "Email", "Notifications"]) {
      ck(`${need} is asked for straight away`, shown.labels.some((l) => l.startsWith(need)),
        shown.labels.join(" | "));
    }
    ck("the licence is not, to begin with", !shown.labels.some((l) => /license/i.test(l)),
      shown.labels.join(" | "));
    ck("nor either address", !shown.labels.some((l) => /^City|^Mailing/i.test(l)), shown.labels.join(" | "));
    ck("nor a rating for somebody who has done no work", !shown.labels.some((l) => /rating/i.test(l)),
      shown.labels.join(" | "));
    ck("there is a way to the rest of it", shown.more && shown.open === false);

    await page.evaluate(() => document.querySelector(".sf-more")?.click());
    await wait(500);
    const opened = await page.evaluate(() => [...document.querySelectorAll(".form .fld")]
      .map((f) => f.innerText.trim().split("\n")[0].trim()));
    ck("and opening it brings back every one of them",
      opened.some((l) => /license/i.test(l)) && opened.some((l) => /^Mailing/i.test(l))
      && opened.some((l) => /rating/i.test(l)), opened.join(" | "));
    await page.evaluate(() => document.querySelector(".sf-more")?.click());
    await wait(400);
  }

  console.log("\n-- step 1: who they are --");
  const COMPANY = `Harbour Roofing ${S}`;
  ck("the form starts on step 1 of 3", await seen(/Step 1 of 3/));
  await type("input[placeholder='Company name']", COMPANY);
  await type("input[placeholder='Primary contact']", "Pat Rowe");
  await type("input[placeholder='name@company.com']", `pat.${S}@example.test`);
  await wait(300);
  ck("step 1 goes on", await page.evaluate(() => {
    const b = [...document.querySelectorAll(".form-actions button")].find((x) => /Continue/i.test(x.textContent));
    if (!b || b.disabled) return false; b.click(); return true;
  }));
  await wait(600);

  console.log("\n-- step 2: what they do --");
  const pick = (label) => page.evaluate((l) => {
    const b = [...document.querySelectorAll(".pick")].find((x) => x.textContent.trim() === l);
    if (!b) return false; b.click(); return true;
  }, label);
  ck("the trades step offers Roofing", await pick("Roofing"));
  await wait(400);
  // Capabilities only appear once a category is chosen.
  const firstCap = await page.evaluate(() => {
    const flds = [...document.querySelectorAll(".fld")];
    const cap = flds.find((f) => /^Capabilities/.test(f.innerText));
    const b = cap?.querySelector(".pick");
    if (!b) return null; b.click(); return b.textContent.trim();
  });
  ck("and a capability under it", !!firstCap, firstCap || "no Capabilities group");
  const city = await page.evaluate(() => {
    const flds = [...document.querySelectorAll(".fld")];
    const cov = flds.find((f) => /^Coverage/.test(f.innerText));
    const b = cov?.querySelector(".pick-grid .pick");
    if (!b) return null; b.click(); return b.textContent.trim();
  });
  ck("and a coverage area", !!city, city || "no coverage picks");
  await wait(300);
  ck("step 2 goes on", await page.evaluate(() => {
    const b = [...document.querySelectorAll(".form-actions button")].find((x) => /Continue/i.test(x.textContent));
    if (!b || b.disabled) return false; b.click(); return true;
  }), await page.evaluate(() => document.querySelector(".cov-hint:last-of-type")?.innerText || ""));
  await wait(600);

  console.log("\n-- step 3: who turns up --");
  ck("a crew is already started", await page.evaluate(() => !!document.querySelector(".crew-name-input")));
  await type(".member-row input", "Dane Whitlock");
  await wait(300);
  const submitted = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".form-actions button")].find((x) => /Add subcontractor/i.test(x.textContent));
    if (!b || b.disabled) return false; b.click(); return true;
  });
  ck("the last step submits", submitted,
    submitted ? "" : await page.evaluate(() => document.querySelector(".form-actions ~ .cov-hint")?.innerText || "Add button disabled"));
  await wait(1800);

  console.log("\n-- back where they were --");
  // Scoped to the modal on purpose: the job's title is on the page behind it
  // too, so reading the whole body would call a dropped manager a success.
  const modal = await page.evaluate(() => document.querySelector(".modal .form, [class*=modal] .form")?.innerText || "");
  ck("the assign screen is open again", /^Assign roofing contractor/im.test(modal),
    modal.split("\n").filter(Boolean)[0] || "no modal");
  ck("on the same job", modal.includes(TITLE), modal.split("\n").filter(Boolean)[1] || "");
  ck("the add form is gone", !/Step \d of 3/.test(modal));
  const listed = await page.evaluate(() =>
    [...document.querySelectorAll(".pick-list .pick-row, .pick-list li, .pick-list > *")].map((e) => e.textContent).join(" | "));
  ck("with the new subcontractor now assignable", listed.includes(COMPANY), listed.slice(0, 160) || "empty pick list");

  console.log("\n-- the other reason the list is empty --");
  // A roster with nobody for this trade is a different problem from no roster
  // at all, and used to get the same four words. The sub just added covers
  // roofing and nothing else, so a framing job reaches the second branch.
  const TITLE2 = `Porch post rot ${S}`;
  await makeJob(TITLE2, "framing");
  await page.reload({ waitUntil: "networkidle0" });
  await wait(2000);
  await hit(/^Jobs/, "button,a");
  await wait(1200);
  await page.evaluate((title) => {
    const card = [...document.querySelectorAll(".job-card")].find((c) => c.innerText.includes(title));
    card?.querySelector(".trade-assign")?.click();
  }, TITLE2);
  await wait(1000);
  const empty2 = await page.evaluate(() => document.querySelector(".empty")?.innerText || "");
  ck("it counts the roster it has rather than claiming there is none",
    /none of your 1 subcontractor covers framing/i.test(empty2), empty2.split("\n").filter(Boolean)[0] || "no empty state");
  ck("and says the other way out too", /edit the job's trades/i.test(empty2));
  ck("with the same button", await page.evaluate(() =>
    [...document.querySelectorAll(".empty button")].some((b) => /^Subcontractor$/i.test(b.textContent.trim()))));

  ck("nothing threw along the way", crashes.length === 0, crashes.join(" ; "));
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
  await page.screenshot({ path: "/tmp/claude-0/addsub-fail.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  scrub();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
