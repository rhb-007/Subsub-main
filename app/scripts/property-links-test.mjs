// Following a number on a property card.
//
// "5 open jobs" and "0 assigned vendors" were the answer to a question and
// no way to ask the next one. Both now lead to the list they are counting,
// narrowed to that building -- and the list says so, because a filtered
// list that does not admit it is filtered is how somebody concludes they
// have three contractors when they have thirty.
//
//   node scripts/property-links-test.mjs

import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const ACCOUNT = "acc_pm";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;

// ---- a building with jobs of its own, and one with none ------------------
const S = Date.now().toString(36);
const pm = await tok("pm@example.test");
const H = { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
const props = await (await fetch(`${API}/properties`, { headers: H })).json();
const A = props[0], B = props[1];
if (!A || !B) { console.error("need at least two properties in the fixture"); process.exit(1); }
// One vendor scoped to A and none to B, so both halves of the vendors
// count are exercised in the same run: a real number that leads to a
// filtered list, and a zero that leads to the way to fix it.
await fetch(`${API}/subs/cmp_r/properties`, { method: "PUT", headers: H,
  body: JSON.stringify({ propertyIds: [A.id] }) });
await fetch(`${API}/subs/cmp_s/properties`, { method: "PUT", headers: H,
  body: JSON.stringify({ propertyIds: [] }) });

const MINE = `Link job ${S}`;
for (let i = 0; i < 2; i++) {
  await fetch(`${API}/jobs`, { method: "POST", headers: H,
    body: JSON.stringify({ title: `${MINE} ${i}`, propertyId: A.id, address: A.address || "1 Way", trades: ["roofing"] }) });
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true, args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1250, height: 1100 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));

const card = (name) => page.evaluate((n) => {
  const c = [...document.querySelectorAll(".prop-card")].find((x) => x.querySelector("h3")?.textContent.trim() === n);
  if (!c) return null;
  return { stats: [...c.querySelectorAll(".prop-stats > *")].map((x) => ({
    tag: x.tagName, text: x.textContent.replace(/\s+/g, " ").trim() })) };
}, name);
const clickStat = (name, re) => page.evaluate((n, rs) => {
  const c = [...document.querySelectorAll(".prop-card")].find((x) => x.querySelector("h3")?.textContent.trim() === n);
  const b = [...(c?.querySelectorAll(".stat-link") || [])].find((x) => new RegExp(rs, "i").test(x.textContent));
  if (!b) return null; b.click(); return b.textContent.replace(/\s+/g, " ").trim();
}, name, re.source);

try {
  console.log("\n-- the property page --");
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await (await page.$("input[type=email]")).type("pm@example.test");
  await (await page.$("input[type=password]")).type("x");
  await page.click(".login-btn");
  await wait(3500);
  await page.evaluate(() => [...document.querySelectorAll("button,a")].find((e) => /^Properties/.test(e.textContent.trim()))?.click());
  await wait(1800);
  const c = await card(A.name);
  ck("the card is there", !!c, A.name);
  ck("units is still plain text, since nothing is behind it",
    c.stats.find((x) => /units/.test(x.text))?.tag === "SPAN", JSON.stringify(c.stats.map((x) => x.tag)));
  ck("the two counts are buttons", c.stats.filter((x) => x.tag === "BUTTON").length === 2,
    JSON.stringify(c.stats));

  console.log("\n-- following the jobs count --");
  const jobsBtn = await clickStat(A.name, /open job/);
  ck("the jobs count can be followed", !!jobsBtn, jobsBtn || "no stat-link matched");
  await wait(1600);
  const scoped = await page.evaluate(() => document.querySelector(".scoped-to")?.innerText.replace(/\n/g, " ") || "");
  ck("it lands on the jobs list", await page.evaluate(() => !!document.querySelector(".jobs-list")));
  ck("and the list says which building it is showing",
    scoped.includes(A.name), scoped || "nothing said");
  const titles = await page.evaluate(() => [...document.querySelectorAll(".job-card h3")].map((h) => h.textContent.trim()));
  // Checked against what the API says rather than against the titles looking
  // plausible: the count matching is the whole point of the filter.
  const apiJobs = await (await fetch(`${API}/jobs`, { headers: H })).json();
  const openHere = apiJobs.filter((j) => j.propertyId === A.id && j.status !== "completed"
    && !j.withdrawnAt && !j.declinedAt);
  const elsewhere = apiJobs.filter((j) => j.propertyId !== A.id).map((j) => j.title);
  ck("the list holds exactly the open jobs at that building",
    titles.length === openHere.length, `${titles.length} shown, ${openHere.length} expected`);
  ck("and not one from anywhere else",
    !titles.some((t) => elsewhere.includes(t)), `${elsewhere.length} elsewhere to exclude`);
  ck("the tab counts agree with the list",
    await page.evaluate(() => {
      const n = Number(document.querySelector(".seg-tabs .seg-n")?.textContent || "-1");
      return n === document.querySelectorAll(".job-card").length;
    }));

  console.log("\n-- and clearing it --");
  await page.evaluate(() => document.querySelector(".scoped-to button")?.click());
  await wait(1200);
  ck("the banner goes", await page.evaluate(() => !document.querySelector(".scoped-to")));
  const all = await page.evaluate(() => document.querySelectorAll(".job-card").length);
  ck("and the whole account's jobs come back", all > titles.length, `${titles.length} → ${all}`);

  console.log("\n-- following a vendors count that is not zero --");
  await page.evaluate(() => [...document.querySelectorAll("button,a")].find((e) => /^Properties/.test(e.textContent.trim()))?.click());
  await wait(1600);
  // Matches the word rather than the phrase: the tile shortened this to
  // "N vendors" when the detail moved into its own panel, and which adjective
  // the label carries is not what this test is about.
  const vBtn = await clickStat(A.name, /vendor/);
  ck("the vendors count can be followed", !!vBtn, vBtn || "no stat-link matched");
  await wait(1600);
  const onVendors = await page.evaluate(() => ({
    scoped: document.querySelector(".scoped-to")?.innerText.replace(/\n/g, " ") || "",
    list: !!document.querySelector(".searchbar"),
  }));
  // With nobody scoped to the building, the count is 0 and the useful thing
  // is the assign panel rather than a filtered list of nobody.
  ck("the count is not zero, so there is a list to see", !/^0 /.test(vBtn.trim()), vBtn);
  ck("it lands on the contractor list", onVendors.list === true);
  ck("narrowed to that building, and saying so", onVendors.scoped.includes(A.name), onVendors.scoped);
  // Somebody scoped to nothing works everywhere, so they belong in every
  // building's list. Saying so is the difference between a filter that
  // looks broken and one that is explained.
  ck("and explains that account-wide vendors are included",
    /every building/i.test(onVendors.scoped), onVendors.scoped);
  const names = await page.evaluate(() =>
    [...document.querySelectorAll(".card .name-row")].map((x) => x.innerText.split("\n")[0].trim()));
  // Asserted on a found list, not on an empty one: `names.length === 0 ||`
  // would have made this pass by finding nothing, which it was doing.
  ck("the list actually rendered contractors", names.length > 0, `${names.length} cards`);
  ck("and the one scoped to this building is among them",
    names.some((n) => /Rainier/i.test(n)), names.slice(0, 6).join(" | "));

  console.log("\n-- and a zero one offers the way to fix it --");
  await page.evaluate(() => [...document.querySelectorAll("button,a")].find((e) => /^Properties/.test(e.textContent.trim()))?.click());
  await wait(1600);
  const zBtn = await clickStat(B.name, /vendor/);
  ck("the zero count can be followed too", !!zBtn && /^0 /.test(zBtn.trim()), zBtn || "not found");
  await wait(1200);
  const panel = await page.evaluate(() =>
    [...document.querySelectorAll(".portal-panel h4")].map((h) => h.textContent.trim())
      .find((t) => /^Vendors at /.test(t)) || "");
  ck("and opens the scoping panel rather than an empty list",
    panel.includes(B.name), panel || "no scoping panel opened");

  ck("nothing threw along the way", crashes.length === 0, crashes.join(" ; "));
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
  await page.screenshot({ path: "/tmp/claude-0/prop-fail.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
