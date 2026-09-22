// A request, from the side of the person deciding on it.
//
// The dashboard row was a title, a building and two buttons, and the two
// buttons were the whole decision. Which unit, what they picked from the
// list, when it started, what they wrote, and the photographs they sent had
// nowhere to appear -- so Approve or Decline was being chosen on a headline,
// and the photos a tenant had just been given a way to send were visible to
// everyone except the one person whose job it is to look at them.
//
// Needs the local stack -- worker on 8787, stubs, dist on 5191.
//
//   node scripts/request-detail-test.mjs

import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const ACCOUNT = "acc_pm";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// ---- a tenant, and a report with everything on it ------------------------
const S = Date.now().toString(36);
const EMAIL = `look.${S}@example.test`;
const TITLE = `Ceiling stain ${S}`;
const WORDS = `Brown ring over the bed, about a foot across, and it grew after Tuesday's rain ${S}`;
const pm = await tok("pm@example.test");
const H = (t) => ({ Authorization: `Bearer ${t}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" });
await fetch(`${API}/tenants`, { method: "POST", headers: H(pm),
  body: JSON.stringify({ propertyId: "p1", firstName: "Ivo", lastName: "Sand", email: EMAIL, unit: "11C", channels: ["email"] }) });
const sent = await (await fetch("http://127.0.0.1:8904/__sent")).json();
const inv = sent[sent.length - 1]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
await fetch(`${API}/tenant-invite/${inv}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "correct horse battery" }) });
const tn = await tok(EMAIL);

const up = await (await fetch(`${API}/uploads/report-photo/stain.png`, { method: "PUT",
  headers: { Authorization: `Bearer ${tn}`, "X-Account-Id": ACCOUNT, "Content-Type": "image/png" }, body: PNG })).json();
const made = await (await fetch(`${API}/jobs`, { method: "POST", headers: H(tn),
  body: JSON.stringify({ title: TITLE, propertyId: "p1", address: "101 Main St", trades: ["roofing"],
    photos: [{ key: up.key, name: "stain.png", type: "image/png", size: PNG.length }],
    reportDetail: { problem: "Water stain on the ceiling", started: "A week or two ago", words: WORDS, unit: "11C" } }) })).json();
ck("the fixture report exists", !!made.id, made.id || JSON.stringify(made));
ck("with a photo on it", (made.job?.photos || []).length === 1, String((made.job?.photos || []).length));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true, args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 1100 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));
const body = () => page.evaluate(() => document.body.innerText);
const modal = () => page.evaluate(() => document.querySelector(".tn-detail")?.innerText || "");

try {
  console.log("\n-- the manager's dashboard --");
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await (await page.$("input[type=email]")).type("pm@example.test");
  await (await page.$("input[type=password]")).type("x");
  await page.click(".login-btn");
  await wait(3500);
  ck("the request is waiting on them", (await body()).includes(TITLE), TITLE);

  const openable = await page.evaluate((t) => {
    const row = [...document.querySelectorAll(".dash-row")].find((r) => r.innerText.includes(t));
    const btn = row?.querySelector(".dash-row-open");
    if (!btn) return null;
    btn.click();
    return true;
  }, TITLE);
  ck("the row opens", openable === true, openable ? "" : "no .dash-row-open on that row");
  await wait(2000);

  console.log("\n-- what they can finally see --");
  const m = await modal();
  ck("the modal is on the right request", m.includes(TITLE), m.split("\n")[0]);
  ck("it names who asked, and that they are a tenant", /Ivo Sand/.test(m) && /tenant/i.test(m),
    m.split("\n").find((l) => /Ivo/.test(l)) || "");
  ck("the unit", /11C/.test(m), m.match(/UNIT[\s\S]{0,14}/)?.[0]);
  ck("what they picked from the list", /Water stain on the ceiling/i.test(m));
  ck("when it started", /A week or two ago/i.test(m), m.match(/STARTED[\s\S]{0,26}/)?.[0]);
  ck("their own words, in full", m.includes(WORDS), WORDS.slice(0, 40) + "…");
  ck("and the photo they sent, loaded",
    await page.evaluate(() => [...document.querySelectorAll(".tn-detail .ph-thumb img")].some((i) => i.naturalWidth > 0)));

  console.log("\n-- and can act on it there --");
  const acts = await page.evaluate(() =>
    [...document.querySelectorAll(".tn-detail .form-actions button")].map((b) => b.textContent.trim()));
  ck("Approve is in the modal", acts.some((a) => /^Approve/i.test(a)), acts.join(" | "));
  ck("so is Decline", acts.some((a) => /Decline/i.test(a)), acts.join(" | "));

  console.log("\n-- declining from inside it still needs a reason --");
  await page.evaluate(() => [...document.querySelectorAll(".tn-detail .form-actions button")].find((b) => /Decline/i.test(b.textContent))?.click());
  await wait(700);
  ck("it asks why", /Why not\?/i.test(await modal()), (await modal()).split("\n").find((l) => /why/i.test(l)) || "");
  await page.evaluate(() => [...document.querySelectorAll(".tn-detail button")].find((b) => /Decline and tell them why/i.test(b.textContent))?.click());
  await wait(800);
  ck("and refuses an empty one", /Say why/i.test(await modal()), (await modal()).split("\n").find((l) => /say why/i.test(l)) || "");

  console.log("\n-- approving from inside it --");
  await page.evaluate(() => [...document.querySelectorAll(".tn-detail button")].find((b) => /^Cancel$/i.test(b.textContent.trim()))?.click());
  await wait(600);
  await page.evaluate(() => [...document.querySelectorAll(".tn-detail .form-actions button")].find((b) => /^Approve/i.test(b.textContent.trim()))?.click());
  await wait(2500);
  ck("the modal closes", await page.evaluate(() => !document.querySelector(".tn-detail")));
  // Scoped to the section, not the page: the title reappears lower down as
  // work needing a contractor, so reading the whole body would pass either way.
  const stillWaiting = await page.evaluate((t) => {
    const sec = [...document.querySelectorAll(".dash-sec")]
      .find((x) => /asked for by owners and tenants|waiting on approval/i.test(x.querySelector("h3")?.textContent || ""));
    return sec ? sec.innerText.includes(t) : false;
  }, TITLE);
  ck("it leaves the waiting list", stillWaiting === false, stillWaiting ? "still in that section" : "gone from it");
  const nowWork = await page.evaluate((t) => {
    const sec = [...document.querySelectorAll(".dash-sec")]
      .find((x) => /needs a contractor/i.test(x.querySelector("h3")?.textContent || ""));
    return sec ? sec.innerText.includes(t) : false;
  }, TITLE);
  ck("and turns up as work needing a contractor", nowWork === true, nowWork ? "" : "not in that section either");

  // The API is the record, not the screen.
  const saved = (await (await fetch(`${API}/jobs`, { headers: H(pm) })).json()).find((j) => j.id === made.id);
  ck("the approval really was written down", !!saved?.approvedAt, saved?.approvedAt || "not approved");

  ck("nothing threw along the way", crashes.length === 0, crashes.join(" ; "));
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
  await page.screenshot({ path: "/tmp/claude-0/req-fail.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
