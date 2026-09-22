// What a database that is one migration behind should look like.
//
// It should not look like an empty company. That is what it looked like: a
// three-statement migration script was submitted as one block, D1 stopped at
// its first already-applied line, and the two migrations below it never ran.
// The Worker then ordered the jobs list by a column that was not there, the
// query failed, the browser's hydrate -- which turns a failed call into an
// empty list, because a REFUSED call really is empty -- drew a dashboard
// reading "No jobs yet", and a company with 655 jobs was told it had none.
//
// Nothing about that was visible. No error, no banner, no clue. So two
// things are asserted here:
//
//   the app keeps working when a migration is pending (the ordering is a
//   nicety, the list is the page), and where it genuinely cannot, it says
//   which file to run;
//
//   and a load that BROKE is never drawn as a load that came back empty.
//   403 means "not yours to see" and an empty list is the honest answer.
//   500 means we do not know, and the page has to say so.
//
// The database surgery is real: it drops the 024 and 025 columns, asserts,
// and puts them back in the `finally`. It runs against the local D1 only.
// Re-adding jobs.updated_at re-derives it from approved_at/created_at, the
// same as the migration does, so a run costs nothing but that.
//
//   node scripts/migration-gap-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const HOST = "app.subsub.work";
const ACCOUNT = "acc_pm";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;

const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const DROP_025 = `DROP INDEX IF EXISTS idx_jobs_updated; ALTER TABLE jobs DROP COLUMN updated_at;`;
const ADD_025 = `ALTER TABLE jobs ADD COLUMN updated_at TEXT;
  UPDATE jobs SET updated_at = COALESCE(approved_at, created_at) WHERE updated_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_jobs_updated ON jobs(account_id, updated_at);`;
const DROP_024 = `ALTER TABLE work_orders DROP COLUMN pay_kind;
  ALTER TABLE work_orders DROP COLUMN rate_cents; ALTER TABLE work_orders DROP COLUMN cap_hours;`;
const ADD_024 = `ALTER TABLE work_orders ADD COLUMN pay_kind TEXT NOT NULL DEFAULT 'fixed';
  ALTER TABLE work_orders ADD COLUMN rate_cents INTEGER; ALTER TABLE work_orders ADD COLUMN cap_hours REAL;`;

const pm = await tok("pm@example.test");
const H = { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

// Sign in and hand back what the shell says, with /api/<route> answered by
// `fake` instead of the Worker when one is given. Interception rather than
// breaking the server: this is a test of what the browser does with an
// answer, and the answer is the input.
async function dashboard({ route, fake } = {}) {
  // Its own browser context, because the Supabase session lives in
  // localStorage: a second call in the same one opens already signed in and
  // there is no form to fill. That cost an hour of "the email field is gone".
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1100, height: 1400 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  if (route) {
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      // Anything thrown in here is a request that is never answered and a
      // page that never loads, so the whole body is guarded and the default
      // is always to let it through.
      try {
        if (r.url().startsWith("http") && new URL(r.url()).pathname === `/api/${route}`) {
          return r.respond({ status: fake.status, contentType: "application/json", body: JSON.stringify(fake.body) });
        }
      } catch { /* fall through to continue() */ }
      r.continue().catch(() => {});
    });
  }
  // domcontentloaded, not networkidle0: with request interception on, the
  // idle never arrives and the wait below is the real readiness check anyway.
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  // The form draws once before the app has settled and again after, so each
  // field is looked up by selector at the moment it is used rather than held
  // across a re-render that throws the handle away.
  await wait(1200);
  await page.type("input[type=email]", "pm@example.test");
  await page.type("input[type=password]", "correct horse battery");
  await page.waitForSelector(".login-btn", { timeout: 15000 });
  await page.click(".login-btn");
  await wait(6000);
  const out = await page.evaluate(() => ({
    banner: document.querySelector(".load-err")?.innerText.replace(/\n/g, " ").trim() || "",
    body: document.body.innerText,
    jobCount: [...document.querySelectorAll(".nav-item, nav a")]
      .map((n) => n.innerText).find((t) => /Jobs/.test(t)) || "",
  }));
  await page.close();
  await ctx.close();
  return { ...out, crashes };
}

// Start from a migrated database whatever the last run left behind, so a
// failed run does not quietly change what the next one is testing.
try { d1(ADD_025); } catch { /* already applied */ }
try { d1(ADD_024); } catch { /* already applied */ }

try {
  console.log("\n-- a pending 025: the list is the page, the order is a nicety --");
  d1(DROP_025);
  const jobs = await fetch(`${API}/jobs`, { headers: H });
  ck("the jobs list still answers", jobs.status === 200, `HTTP ${jobs.status}`);
  const rows = jobs.ok ? await jobs.json() : [];
  ck("and it still has the jobs in it", rows.length > 0, `${rows.length} rows`);
  // The whole point: newest first is still true, just from created_at. The
  // distinct count is asserted too -- seeded rows share a second, and an
  // ordering check over one repeated timestamp would pass on anything.
  const iso = (j) => j.createdAtIso || "";
  const distinct = new Set(rows.map(iso)).size;
  ck("the timestamps actually differ, so the next check means something", distinct > 2, `${distinct} distinct`);
  ck("still newest first", rows.length > 1 && rows.every((j, i) => i === 0 || iso(rows[i - 1]) >= iso(j)),
    `${iso(rows[0])} then ${iso(rows[rows.length - 1])}`);

  const d = await dashboard();
  ck("the dashboard shows them rather than 'No jobs yet'",
    !/No jobs yet/.test(d.body) && /jobs ·/.test(d.body), d.body.split("\n").slice(0, 6).join(" / "));
  ck("and says nothing alarming, because nothing is wrong", d.banner === "", d.banner);
  ck("nothing threw", d.crashes.length === 0, d.crashes.join(" | "));

  console.log("\n-- a pending 024: what cannot work names the file --");
  d1(ADD_025); d1(DROP_024);
  const jobId = rows[0]?.id;
  if (!jobId) throw new Error("no job to assign -- the list above came back empty");
  const res = await fetch(`${API}/jobs/${jobId}/assign`, { method: "POST", headers: H,
    body: JSON.stringify({ trade: "roofing", companyId: "cmp_r", value: "150", responseWindow: "24h" }) });
  const body = await res.json();
  ck("assigning is refused, not broken", res.status === 503, `HTTP ${res.status}`);
  ck("it says a migration is needed", body.error === "migration_needed", JSON.stringify(body));
  ck("and names which one", body.migration === "024_hourly_work_orders", body.migration);

  console.log("\n-- a broken load is never drawn as an empty one --");
  d1(ADD_024);
  const broke = await dashboard({ route: "properties", fake: { status: 500, body: { error: "server_error" } } });
  ck("the page says so", /Couldn't load/.test(broke.banner), broke.banner || "(no banner)");
  ck("it names what is missing", /properties/.test(broke.banner), broke.banner);
  ck("and the status, which is the part that narrows it down", /500/.test(broke.banner), broke.banner);

  const migration = await dashboard({ route: "jobs",
    fake: { status: 503, body: { error: "migration_needed", migration: "025_job_activity" } } });
  ck("a pending migration is named by its file", /025_job_activity\.sql/.test(migration.banner), migration.banner);
  ck("in words that say the page is incomplete", /incomplete/.test(migration.banner), migration.banner);

  console.log("\n-- but a refusal is not a breakage --");
  // A building owner is refused several of these outright. An empty list is
  // the true answer there, and a red banner over it would be a lie.
  const refused = await dashboard({ route: "properties", fake: { status: 403, body: { error: "forbidden" } } });
  ck("403 stays quiet", refused.banner === "", refused.banner);
  ck("and the rest of the page still draws", /Good to see you/.test(refused.body),
    refused.body.split("\n").slice(0, 4).join(" / "));
} finally {
  // Whatever happened above, the database goes back as it was.
  try { d1(ADD_025); } catch { /* already there */ }
  try { d1(ADD_024); } catch { /* already there */ }
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
