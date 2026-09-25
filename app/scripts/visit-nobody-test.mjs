// A visit with nobody booked for it.
//
// From a real screenshot: a job reading "0/1 trades — No contractor · no
// work order issued", and underneath it, in the same card, "Ricard Bond
// says somebody came on Sep 22, 2026 · 10 AM–11 AM". Nobody had ever been
// sent. The tenant's own screen had said "Somebody is coming" about that
// morning, so when it later asked whether somebody came, they answered the
// question they had been asked.
//
// A visit and a work order were two unconnected facts. Two ways into the
// same state:
//   - a time agreed with the tenant before anybody was hired, which is a
//     real way to work — find out when they can be in, then go looking;
//   - the only contractor withdrawn afterwards, which voids the work order
//     and left the agreed time standing.
//
// The rule now is that a visit only promises a person once somebody has
// accepted. Derived from the live work orders rather than stored, so it is
// already right about every row written before today — including that one.
//
// Needs the local stack (worker 8787, supa stub 8902, mail stub 8904,
// app dist 5191).
//
//   node scripts/visit-nobody-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const MAIL = process.env.MAIL_STUB || "http://127.0.0.1:8904";
const HOST = "cascademanagement.subsub.work";
const ACCOUNT = "acc_pm";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const YESTERDAY = key(day(-1)), NEXT_WEEK = key(day(7));

const S = Date.now().toString(36);
const EMAIL = `nobody.${S}@example.test`;
const pm = await tok("pm@example.test");
const H = { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };

await fetch(`${API}/tenants`, { method: "POST", headers: H,
  body: JSON.stringify({ propertyId: "p1", firstName: "Ricard", lastName: "Bond", email: EMAIL, unit: "512f", channels: ["email"] }) });
const sent = await (await fetch(`${MAIL}/__sent`)).json();
const inv = sent[sent.length - 1]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
await fetch(`${API}/tenant-invite/${inv}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "correct horse battery" }) });
const tH = { Authorization: `Bearer ${await tok(EMAIL)}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };

const report = async (title) => (await (await fetch(`${API}/jobs`, { method: "POST", headers: tH,
  body: JSON.stringify({ title, propertyId: "p1", address: "700 Bellevue Way", trades: ["roofing"],
    reportDetail: { problem: "There's no power in one room", started: "Today", words: "", unit: "512f" } }) })).json()).id;
const approve = (id) => fetch(`${API}/jobs/${id}/approve`, { method: "POST", headers: H });
const propose = async (id, date) => (await (await fetch(`${API}/jobs/${id}/visits`, { method: "POST", headers: H,
  body: JSON.stringify({ date, startTime: "10:00", endTime: "11:00" }) })).json());
const confirm = (vid) => fetch(`${API}/visits/${vid}/respond`, { method: "POST", headers: tH,
  body: JSON.stringify({ status: "confirmed" }) });
const assign = (id) => fetch(`${API}/jobs/${id}/assign`, { method: "POST", headers: H,
  body: JSON.stringify({ trade: "roofing", companyId: "cmp_r", value: "150", responseWindow: "24h" }) });

// ---- the state from the screenshot: agreed time, nobody hired ------------
const ORPHAN = `No power ${S}`;         // a time agreed, nobody ever assigned
const WITHDRAWN = `Withdrawn one ${S}`; // assigned, then the contractor pulled
const REAL = `Properly booked ${S}`;    // the way it is meant to look
const orphan = await report(ORPHAN);
const withdrawn = await report(WITHDRAWN);
const real = await report(REAL);
for (const id of [orphan, withdrawn, real]) await approve(id);

const vOrphan = await propose(orphan, YESTERDAY);
await confirm(vOrphan.id);

await assign(withdrawn);
const vWithdrawn = await propose(withdrawn, NEXT_WEEK);
await confirm(vWithdrawn.id);
await fetch(`${API}/jobs/${withdrawn}/unassign/roofing`, { method: "POST", headers: H });

await assign(real);
// Accepted, so somebody really is coming.
d1(`UPDATE work_orders SET status = 'accepted' WHERE job_id = '${real}'`);
const vReal = await propose(real, NEXT_WEEK);
await confirm(vReal.id);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});
const rowFor = (page, title) => page.evaluate((t) => {
  const r = [...document.querySelectorAll(".tn-row")].find((x) => x.innerText.includes(t));
  if (!r) return null;
  const sec = r.closest(".tn-sec");
  return {
    chip: r.querySelector(".tn-chip")?.textContent.trim() || "",
    section: sec?.querySelector(".tn-sec-title")?.textContent.trim() || "",
    asksOutcome: !!r.querySelector(".tn-after"),
    text: r.innerText.replace(/\n/g, " · "),
  };
}, title);

try {
  console.log("\n-- the API will not take an answer nobody was asked for --");
  {
    // The exact call the screenshot's row came from.
    const r = await fetch(`${API}/visits/${vOrphan.id}/outcome`, { method: "POST", headers: tH,
      body: JSON.stringify({ happened: true }) });
    const b = await r.json();
    ck("\"somebody came\" is refused when nobody was sent",
      r.status === 409 && b.error === "no_contractor", `${r.status} ${b.error}`);
    const v = (await (await fetch(`${API}/visits`, { headers: tH })).json()).find((x) => x.id === vOrphan.id);
    ck("and the visit is left alone", v?.status === "confirmed", v?.status);
  }
  {
    // Same for the one whose contractor was withdrawn: the work order is
    // voided, so there is nobody to have come.
    const past = await propose(withdrawn, YESTERDAY);
    await confirm(past.id);
    const r = await fetch(`${API}/visits/${past.id}/outcome`, { method: "POST", headers: tH,
      body: JSON.stringify({ happened: false }) });
    const b = await r.json();
    ck("and after the only contractor is withdrawn, too",
      r.status === 409 && b.error === "no_contractor", `${r.status} ${b.error}`);
    // Put the future time back: proposing supersedes, and the screens below
    // are about a visit that is still ahead.
    const again = await propose(withdrawn, NEXT_WEEK);
    await confirm(again.id);
  }
  {
    // But a real one still works, which is the assertion that stops this
    // being a blanket refusal.
    const past = await propose(real, YESTERDAY);
    await confirm(past.id);
    const r = await fetch(`${API}/visits/${past.id}/outcome`, { method: "POST", headers: tH,
      body: JSON.stringify({ happened: true }) });
    ck("a visit somebody was actually sent for still takes an answer", r.status === 200, `${r.status}`);
    // Put it back for the screens below.
    const again = await propose(real, NEXT_WEEK);
    await confirm(again.id);
  }

  console.log("\n-- proposing another time retires the one that was agreed --");
  {
    // Found by this file: the supersede list covered proposed, declined,
    // missed and happened -- but not confirmed. So "Propose a different
    // time", which is the button sitting under every agreed visit, left two
    // live visits on the job. The client takes the first row per job, and
    // created_at is second-granular, so which one a tenant saw came down to
    // the order two rows written in the same second came back in.
    const first = await propose(real, NEXT_WEEK);
    await confirm(first.id);
    const second = await propose(real, key(day(9)));
    const live = (await (await fetch(`${API}/visits`, { headers: tH })).json())
      .filter((v) => v.jobId === real);
    ck("one live visit per job, not two", live.length === 1,
      live.map((v) => `${v.date}:${v.status}`).join(", "));
    ck("and it is the new proposal", live[0]?.id === second.id && live[0]?.status === "proposed",
      `${live[0]?.date} ${live[0]?.status}`);
    // Back to a confirmed future visit for the screens below.
    await confirm(second.id);
  }

  console.log("\n-- and the tenant is not told somebody is coming --");
  const tCtx = await browser.createBrowserContext();
  const page = await tCtx.newPage();
  await page.setViewport({ width: 900, height: 1500 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await page.type("input[type=email]", EMAIL);
  await page.type("input[type=password]", "correct horse battery");
  await page.click(".login-btn");
  await wait(3800);
  ck("the tenant is in", /Hello, Ricard/.test(await page.evaluate(() => document.body.innerText)));

  const orphanRow = await rowFor(page, ORPHAN);
  const withdrawnRow = await rowFor(page, WITHDRAWN);
  const realRow = await rowFor(page, REAL);

  ck("the properly booked one does say somebody is coming",
    /vendor has been dispatched/i.test(realRow?.section || ""), realRow?.section);
  ck("with the time on the chip", /^Scheduled/.test(realRow?.chip || ""), realRow?.chip);

  // The whole point.
  ck("the one nobody was hired for does not",
    !/vendor has been dispatched/i.test(orphanRow?.section || ""), `${orphanRow?.section} / ${orphanRow?.chip}`);
  ck("and its chip says so instead",
    /lining up a vendor/i.test(orphanRow?.chip || ""), orphanRow?.chip);
  ck("it is not asked whether somebody came", orphanRow?.asksOutcome === false, orphanRow?.text.slice(0, 120));
  ck("the one whose contractor withdrew does not either",
    !/vendor has been dispatched/i.test(withdrawnRow?.section || ""), `${withdrawnRow?.section} / ${withdrawnRow?.chip}`);
  // Still ahead, so it reads as a plan rather than a failure.
  ck("and reads as a time waiting on a contractor",
    /lining up a vendor/i.test(withdrawnRow?.chip || ""), withdrawnRow?.chip);
  ck("nothing threw", crashes.length === 0, crashes.join(" ; "));

  console.log("\n-- and the manager is told, where they can fix it --");
  const mCtx = await browser.createBrowserContext();
  const mp = await mCtx.newPage();
  await mp.setViewport({ width: 1280, height: 1600 });
  const mCrashes = [];
  mp.on("pageerror", (e) => mCrashes.push(e.message));
  await mp.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await mp.waitForSelector("input[type=password]", { timeout: 15000 });
  await mp.type("input[type=email]", "pm@example.test");
  await mp.type("input[type=password]", "correct horse battery");
  await mp.click(".login-btn");
  await wait(6500);
  await mp.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^Jobs/i.test(b.innerText.trim()))?.click());
  await wait(2500);
  await mp.evaluate(() => [...document.querySelectorAll(".jv-seg button")]
    .find((b) => /list/i.test(b.innerText))?.click());
  await wait(1200);
  await mp.evaluate(() => [...document.querySelectorAll(".seg-tabs button")]
    .find((b) => /^All/i.test(b.innerText.trim()))?.click());
  await wait(2200);

  const warned = await mp.evaluate((t) => {
    const card = [...document.querySelectorAll(".job-card")].find((c) => c.innerText.includes(t));
    if (!card) return null;
    const w = card.querySelector(".visit-nobody");
    return { found: true, warn: w?.innerText.replace(/\n/g, " ") || null,
      hasButton: !!w?.querySelector("button") };
  }, ORPHAN);
  ck("the job card is there", !!warned?.found, String(warned));
  ck("it says nobody is scheduled to arrive",
    /nobody is scheduled to arrive/i.test(warned?.warn || ""), warned?.warn);
  ck("naming the actual problem", /no vendor\s+is assigned/i.test(warned?.warn || ""), warned?.warn);
  ck("with a way to fix it in the same breath", warned?.hasButton === true);

  const fine = await mp.evaluate((t) => {
    const card = [...document.querySelectorAll(".job-card")].find((c) => c.innerText.includes(t));
    return card ? !!card.querySelector(".visit-nobody") : null;
  }, REAL);
  // Not a banner on every job with a visit: that would be wallpaper.
  ck("and it is not shown on the one that is properly booked", fine === false, String(fine));
  ck("nothing threw on the manager's side", mCrashes.length === 0, mCrashes.slice(0, 2).join(" ; "));
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
} finally {
  await browser.close();
}

try {
  const ids = [orphan, withdrawn, real].map((i) => `'${i}'`).join(",");
  const who = `SELECT id FROM users WHERE email = '${EMAIL}'`;
  d1(`DELETE FROM jobs WHERE id IN (${ids})`);
  d1(`DELETE FROM activity WHERE user_id IN (${who})`);
  d1(`DELETE FROM email_log WHERE sent_by IN (${who})`);
  d1(`DELETE FROM tenant_invites WHERE user_id IN (${who}) OR created_by IN (${who})`);
  d1(`DELETE FROM memberships WHERE user_id IN (${who})`);
  d1(`DELETE FROM users WHERE email = '${EMAIL}'`);
} catch (e) {
  fail++;
  console.log("FAIL  cleanup  --", String(e.message).split("\n").find((l) => /ERROR/.test(l)) || e.message);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
