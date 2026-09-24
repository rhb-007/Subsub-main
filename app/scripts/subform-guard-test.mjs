// Why the Add-subcontractor form won't go on.
//
// Step 2 used to answer that with "Pick at least one trade, one capability,
// and set a coverage area" whatever was actually wrong, under a greyed-out
// Continue. Choose six trades and the capability group is forty-odd chips
// long; with none of them chosen it reads as finished, and the only clue is
// a line that names all three requirements every time. A real manager filled
// the whole form in and could not get past it.
//
// So: the unmet rule is named on its own, and marked at the section it
// belongs to. This walks the four states one at a time.
//
// Needs the local stack -- see addsub-from-assign-test.mjs for what.
//
//   node scripts/subform-guard-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const APP = process.env.APP_BASE || "http://127.0.0.1:5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const EMAIL = "admin@example.test";
const ACCOUNT = "acc_test";
const JOB_MARK = "Guard probe";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (cmd) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", cmd], { stdio: ["ignore", "ignore", "ignore"] });
const scrub = () => sql(`DELETE FROM jobs WHERE account_id = '${ACCOUNT}' AND title LIKE '${JOB_MARK}%'`);

scrub();
const t = (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: EMAIL }) })).json()).access_token;
await fetch(`${API}/jobs`, { method: "POST",
  headers: { Authorization: `Bearer ${t}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" },
  body: JSON.stringify({ title: `${JOB_MARK} ${Date.now().toString(36)}`, address: "1 Way", zip: "98101", trades: ["roofing"] }) });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1200 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));

// What the form is telling the user right now.
const say = () => page.evaluate(() => {
  const cont = [...document.querySelectorAll(".form-actions button")].find((x) => /Continue/i.test(x.textContent));
  const group = (re) => [...document.querySelectorAll(".fld")].find((f) => re.test(f.innerText));
  const errIn = (re) => group(re)?.querySelector(".fld-err")?.innerText.trim() || null;
  return {
    blocked: !!cont?.disabled,
    bottom: [...document.querySelectorAll(".cov-hint")].map((h) => h.innerText.trim()).slice(-1)[0] || "",
    onTrades: errIn(/^Categories/), onCaps: errIn(/^Capabilities/), onCoverage: errIn(/^Coverage/),
  };
});
const pickIn = (re, label) => page.evaluate((rs, l) => {
  const g = [...document.querySelectorAll(".fld")].find((f) => new RegExp(rs).test(f.innerText));
  const b = [...(g?.querySelectorAll(".pick") || [])].find((x) => !l || x.textContent.trim() === l);
  if (!b) return null; b.click(); return b.textContent.trim();
}, re.source, label || "");

try {
  await page.goto(APP + "/", { waitUntil: "networkidle0" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await (await page.$("input[type=email]")).type(EMAIL);
  await (await page.$("input[type=password]")).type("x");
  await page.click(".login-btn");
  await wait(2500);
  await page.evaluate(() => [...document.querySelectorAll("button,a")].find((e) => /^Jobs/.test(e.textContent.trim()))?.click());
  await wait(1200);
  await page.evaluate(() => document.querySelector(".trade-assign")?.click());
  await wait(900);
  await page.evaluate(() => [...document.querySelectorAll(".empty button")].find((b) => /Subcontractor/i.test(b.textContent))?.click());
  await wait(900);
  // Adding opens on the are-they-already-on-SubSub gate now. This file is
  // about the step guards behind it, so it goes straight past -- the gate
  // has its own suite in connect-test.mjs.
  await page.evaluate(() => [...document.querySelectorAll(".cx-gate .form-actions button")]
    .find((b) => /add them myself|^continue$/i.test(b.innerText))?.click());
  await wait(900);
  const ty = async (ph, v) => { const e = await page.$(`input[placeholder="${ph}"]`); await e.click({ clickCount: 3 }); await e.type(v); };
  await ty("Company name", "Guard Co"); await ty("Primary contact", "Ana"); await ty("name@company.com", "a@b.test");
  await wait(300);
  await page.evaluate(() => [...document.querySelectorAll(".form-actions button")].find((x) => /Continue/i.test(x.textContent))?.click());
  await wait(700);

  console.log("\n-- arriving on step 2 with nothing chosen --");
  let s = await say();
  ck("it will not go on", s.blocked);
  ck("it names the trade and the coverage, and nothing else",
    s.bottom === "Still to do: pick a trade and set a coverage area.", s.bottom);
  ck("the trades group is marked", /pick at least one trade/i.test(s.onTrades || ""), s.onTrades);
  ck("the coverage group is marked", /at least one city/i.test(s.onCoverage || ""), s.onCoverage);
  ck("and no capability is demanded before a trade exists", s.onCaps === null, s.onCaps);

  console.log("\n-- six trades in, which is where the capability list gets long --");
  for (const l of ["Electrical", "Painting", "HVAC", "Insulation", "Plumbing", "Gutters"]) await pickIn(/^Categories/, l);
  await wait(500);
  s = await say();
  ck("the trade is no longer asked for", s.onTrades === null);
  ck("the capability now is, on the group itself",
    /this is what jobs are matched on/i.test(s.onCaps || ""), s.onCaps);
  ck("and the bottom line names both that and the coverage",
    s.bottom === "Still to do: pick a capability and set a coverage area.", s.bottom);

  console.log("\n-- one capability --");
  const cap = await pickIn(/^Capabilities/);
  await wait(400);
  s = await say();
  ck(`picking ${cap} clears that group`, s.onCaps === null, s.onCaps);
  ck("leaving only the coverage", s.bottom === "Still to do: set a coverage area.", s.bottom);
  ck("still blocked, because it is", s.blocked);

  console.log("\n-- a ZIP radius needs both halves --");
  await page.evaluate(() => [...document.querySelectorAll(".cov-toggle button")].find((x) => /ZIP radius/i.test(x.textContent))?.click());
  await wait(400);
  s = await say();
  ck("an empty radius says what a radius needs",
    /needs both a ZIP and a distance/i.test(s.onCoverage || ""), s.onCoverage);
  const zip = await page.$(".radius-row input");
  await zip.click({ clickCount: 3 }); await zip.type("98121");
  await wait(400);
  s = await say();
  ck("a ZIP with the stock distance is enough", s.onCoverage === null && !s.blocked,
    JSON.stringify({ onCoverage: s.onCoverage, blocked: s.blocked }));
  ck("and the form stops nagging", !/Still to do/.test(s.bottom), s.bottom);

  console.log("\n-- named cities instead --");
  await page.evaluate(() => [...document.querySelectorAll(".cov-toggle button")].find((x) => /Specific cities/i.test(x.textContent))?.click());
  await wait(400);
  s = await say();
  ck("switching back to cities with none chosen blocks again", s.blocked && /at least one city/i.test(s.onCoverage || ""), s.onCoverage);
  const city = await pickIn(/^Coverage/);
  await wait(400);
  s = await say();
  ck(`one city (${city}) is enough`, !s.blocked && s.onCoverage === null);

  ck("nothing threw along the way", crashes.length === 0, crashes.join(" ; "));
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
} finally {
  await browser.close();
  scrub();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
