// A registration check that found nothing must not take the page down.
//
// This is the bug that produced a white screen for a real account's admin,
// reported only as "it's blank". The error, once the page could show one,
// was:
//
//   undefined is not an object (evaluating 'A.licenseCheck.status.toLowerCase')
//
// A check that ran against a state registry and found no such number is
// stored as { found: false } -- no `status` field, because there is no
// registration to have a status. Three screens read `.status.toLowerCase()`
// straight off it, and one of them is the admin dashboard's "Registration
// problems" section, whose entire purpose is to list the contractors whose
// checks did not come back clean. So the one screen guaranteed to render
// that value was the one guaranteed to crash on it, and React unmounts the
// whole tree when a render throws: not a broken row, an empty window.
//
// Every shape a stored check can really have is driven through the admin
// dashboard here. The account's own data does the talking -- no stubbing --
// and the company is put back as it was in the `finally`.
//
//   node scripts/license-shape-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const PORT = process.env.APP_PORT || "5191";
const HOST = "cascademanagement.subsub.work";
const COMPANY = "cmp_r";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const q = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const setCheck = (license, check) =>
  d1(`UPDATE companies SET license = ${q(license)}, license_check = ${q(check)} WHERE id = '${COMPANY}';`);

const before = JSON.parse(d1(`SELECT license, license_check FROM companies WHERE id = '${COMPANY}';`)
  .match(/"results":\s*(\[[\s\S]*?\])/)[1])[0];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

async function dashboard() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1100, height: 1500 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(1200);
  await page.type("input[type=email]", "pm@example.test");
  await page.type("input[type=password]", "correct horse battery");
  await page.waitForSelector(".login-btn", { timeout: 15000 });
  await page.click(".login-btn");
  await wait(7000);
  const out = await page.evaluate(() => {
    const sec = [...document.querySelectorAll(".dash-sec")]
      .find((s) => /Registration problems/i.test(s.querySelector("h3")?.textContent || ""));
    return {
      text: document.body.innerText.trim(),
      boundary: /hit a problem and stopped/i.test(document.body.innerText),
      row: [...(sec?.querySelectorAll(".dash-row") || [])]
        .map((r) => r.innerText.replace(/\n/g, " · ")).find((t) => /Rainier/.test(t)) || "",
    };
  });
  await page.close();
  await ctx.close();
  return { ...out, crashes };
}

try {
  // The exact row that was in the account: a number on file, a check that
  // ran, and no registration behind it.
  console.log("\n-- a check that found nothing (the one that went white) --");
  setCheck("TESTLIC123AB", JSON.stringify({ found: false, fieldMappingVerified: false }));
  let d = await dashboard();
  ck("the page does not crash", !d.boundary && d.crashes.length === 0, d.crashes.join(" | ") || (d.boundary ? "boundary shown" : ""));
  ck("the admin still gets their dashboard", /Good to see you/.test(d.text), d.text.slice(0, 70));
  ck("and the contractor is listed as a problem", /Rainier/.test(d.row), d.row || "(not listed)");
  ck("in words, not a status code", /not found in the state registry/i.test(d.row), d.row);

  console.log("\n-- a check the registry could not answer --");
  setCheck("TESTLIC123AB", JSON.stringify({ found: false, status: "CHECK_FAILED", error: "502 from lni.wa.gov" }));
  d = await dashboard();
  ck("still no crash", !d.boundary && d.crashes.length === 0, d.crashes.join(" | "));
  ck("and it says so rather than blaming the contractor",
    /could not be checked/i.test(d.row), d.row);

  console.log("\n-- a state nobody has wired up yet --");
  setCheck("TESTLIC123AB", JSON.stringify({ found: false, status: "UNSUPPORTED_STATE" }));
  d = await dashboard();
  ck("still no crash", !d.boundary && d.crashes.length === 0, d.crashes.join(" | "));
  ck("and says which kind of nothing it is", /not checkable in that state/i.test(d.row), d.row);

  console.log("\n-- found, but the mapper gave no status --");
  // Five of the six wired states have unverified field mappings, so a found
  // record with a missing status is a shape that can really arrive.
  setCheck("TESTLIC123AB", JSON.stringify({ found: true, expirationDate: "2020-01-01" }));
  d = await dashboard();
  ck("still no crash", !d.boundary && d.crashes.length === 0, d.crashes.join(" | "));
  ck("it says unknown rather than throwing", /unknown/i.test(d.row), d.row);

  console.log("\n-- an empty object, which is what a bad write leaves --");
  setCheck("TESTLIC123AB", "{}");
  d = await dashboard();
  ck("still no crash", !d.boundary && d.crashes.length === 0, d.crashes.join(" | "));
  ck("the dashboard is whole", /Good to see you/.test(d.text), d.text.slice(0, 70));

  console.log("\n-- and a good one still reads like a good one --");
  setCheck("TESTLIC123AB", JSON.stringify({ found: true, status: "EXPIRED", expirationDate: "2024-03-02" }));
  d = await dashboard();
  ck("still no crash", !d.boundary && d.crashes.length === 0, d.crashes.join(" | "));
  ck("expired is still called expired", /expired/i.test(d.row), d.row);
  ck("with the date it ran out", /2024-03-02/.test(d.row), d.row);
} finally {
  setCheck(before.license, before.license_check);
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
