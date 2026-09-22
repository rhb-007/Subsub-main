// "When is somebody coming?"
//
// That is the one question a tenant opens this page to answer, and the
// answer was the fourth row down, in a list where every other line also
// began "Reported Sep 21". A confirmed visit is the only thing on the page
// with a date on it; it belongs at the top, on its own.
//
// Only a confirmed one. A time the manager has proposed and the tenant has
// not answered is not a plan, and putting it under a heading that says
// somebody is coming would be telling them something nobody has agreed to.
//
//   node scripts/tenant-scheduled-test.mjs

import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const HOST = "cascademanagement.subsub.work";
const ACCOUNT = "acc_pm";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;

// ---- a tenant with three reports, one of them booked in -----------------
const S = Date.now().toString(36);
const EMAIL = `booked.${S}@example.test`;
const pm = await tok("pm@example.test");
const H = { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
await fetch(`${API}/account`, { method: "PATCH", headers: H, body: JSON.stringify({ emergencyCompanyId: null }) });
await fetch(`${API}/tenants`, { method: "POST", headers: H,
  body: JSON.stringify({ propertyId: "p1", firstName: "Orla", lastName: "Beck", email: EMAIL, unit: "9A", channels: ["email"] }) });
const sent = await (await fetch("http://127.0.0.1:8904/__sent")).json();
const inv = sent[sent.length - 1]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
await fetch(`${API}/tenant-invite/${inv}`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "correct horse battery" }) });
const tn = await tok(EMAIL);
const tH = { Authorization: `Bearer ${tn}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };

const report = async (title) => (await (await fetch(`${API}/jobs`, { method: "POST", headers: tH,
  body: JSON.stringify({ title, propertyId: "p1", address: "101 Main St", trades: ["roofing"],
    reportDetail: { problem: "A faucet is dripping", started: "Today", words: "", unit: "9A" } }) })).json()).id;

const BOOKED = `Booked one ${S}`;
const WAITING = `Waiting one ${S}`;
const PLAIN = `Plain one ${S}`;
const jBooked = await report(BOOKED);
const jWaiting = await report(WAITING);
const jPlain = await report(PLAIN);
for (const id of [jBooked, jWaiting]) {
  await fetch(`${API}/jobs/${id}/approve`, { method: "POST", headers: H });
  await fetch(`${API}/jobs/${id}/assign`, { method: "POST", headers: H,
    body: JSON.stringify({ trade: "roofing", companyId: "cmp_r", value: "150", responseWindow: "24h" }) });
}
// One visit proposed and confirmed, one proposed and left unanswered.
const vB = await (await fetch(`${API}/jobs/${jBooked}/visits`, { method: "POST", headers: H,
  body: JSON.stringify({ date: "2026-11-04", startTime: "10:00", endTime: "11:00" }) })).json();
await fetch(`${API}/visits/${vB.id}/respond`, { method: "POST", headers: tH, body: JSON.stringify({ status: "confirmed" }) });
await fetch(`${API}/jobs/${jWaiting}/visits`, { method: "POST", headers: H,
  body: JSON.stringify({ date: "2026-11-05", startTime: "14:00", endTime: "15:00" }) });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1300 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));

const sections = () => page.evaluate(() => [...document.querySelectorAll(".tn-sec")].map((s) => ({
  title: s.querySelector(".tn-sec-title")?.textContent.trim(),
  count: s.querySelector(".sec-count")?.textContent.trim(),
  rows: [...s.querySelectorAll(".tn-row-title")].map((t) => t.textContent.trim()),
  top: Math.round(s.getBoundingClientRect().top),
})));

try {
  console.log("\n-- signing in --");
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await (await page.$("input[type=email]")).type(EMAIL);
  await (await page.$("input[type=password]")).type("correct horse battery");
  await page.click(".login-btn");
  await wait(3200);
  ck("the tenant is in", /Hello, Orla/.test(await page.evaluate(() => document.body.innerText)));

  console.log("\n-- the booked one has its own section, first --");
  let secs = await sections();
  ck("there is a section for it", secs.some((x) => /somebody is coming/i.test(x.title || "")),
    secs.map((x) => x.title).join(" | "));
  const sched = secs.find((x) => /somebody is coming/i.test(x.title || ""));
  const rest = secs.find((x) => /everything else|what you/i.test(x.title || ""));
  ck("it is above everything else", sched.top < rest.top, `${sched.top} vs ${rest.top}`);
  ck("and holds the booked report", sched.rows.includes(BOOKED), sched.rows.join(" | "));
  ck("only that one", sched.rows.length === 1 && sched.count === "1", `${sched.rows.length} rows, count ${sched.count}`);

  console.log("\n-- a time nobody has answered is not a plan --");
  ck("the one still waiting on the tenant stays below",
    rest.rows.includes(WAITING), rest.rows.join(" | "));
  ck("and so does the one with no visit at all", rest.rows.includes(PLAIN), rest.rows.join(" | "));
  ck("the other section renames itself so the two do not both claim everything",
    /everything else/i.test(rest.title), rest.title);

  console.log("\n-- the row says when, once --");
  const booked = await page.evaluate((t) => {
    const r = [...document.querySelectorAll(".tn-row")].find((x) => x.innerText.includes(t));
    return { text: r?.innerText.replace(/\n/g, " · ") || "", chip: r?.querySelector(".tn-chip")?.textContent.trim() || "" };
  }, BOOKED);
  ck("the chip carries the date and time", /Scheduled/.test(booked.chip) && /10 AM/.test(booked.chip), booked.chip);
  // It used to appear in the meta line as well, which wrapped one row onto
  // three lines saying the same thing twice.
  ck("and the meta line does not repeat it", !/visit Nov/i.test(booked.text), booked.text.slice(0, 110));

  console.log("\n-- confirming a time moves a report up --");
  const vW = (await (await fetch(`${API}/visits`, { headers: tH })).json()).find((v) => v.jobId === jWaiting);
  await fetch(`${API}/visits/${vW.id}/respond`, { method: "POST", headers: tH, body: JSON.stringify({ status: "confirmed" }) });
  await page.reload({ waitUntil: "networkidle0" });

  await wait(3000);
  secs = await sections();
  const sched2 = secs.find((x) => /somebody is coming/i.test(x.title || ""));
  ck("it joins the section above", sched2.rows.includes(WAITING), sched2.rows.join(" | "));
  ck("which now holds both", sched2.rows.length === 2 && sched2.count === "2", `${sched2.rows.length}, count ${sched2.count}`);
  // Soonest first: the next visit is the one being asked about.
  ck("soonest first", sched2.rows[0] === BOOKED, sched2.rows.join(" → "));
  const rest2 = secs.find((x) => /everything else|what you/i.test(x.title || ""));
  ck("and leaves the list below", !rest2.rows.includes(WAITING), rest2.rows.join(" | "));

  console.log("\n-- and folds away like any other section --");
  await page.evaluate(() => document.querySelectorAll(".tn-sec-head")[0]?.click());
  await wait(500);
  ck("it closes", (await sections())[0].rows.length === 0);
  await page.reload({ waitUntil: "networkidle0" });
  await wait(3000);
  ck("and stays closed", (await sections())[0].rows.length === 0);

  ck("nothing threw along the way", crashes.length === 0, crashes.join(" ; "));
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
  await page.screenshot({ path: "/tmp/claude-0/sched-fail.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
