// Materials come from a list now, not a text box.
//
// The field was free text, so one account held "ABC", "abc supply", "ABC
// Supply Ballard" and "ABC - ballard" for a single yard. Nothing could be
// counted, compared, or later handed to that supplier's own system, and the
// work order said whichever of the four the person typed that day.
//
// Four things are asserted, and the last two are the ones that matter:
//
//   the chooser offers the four named suppliers and still takes a local
//   yard, because a closed list would be a lie;
//
//   the line a contractor reads is composed by the Worker from the shared
//   list, so it is the same every time regardless of what a client sends;
//
//   a value written before the list existed survives being looked at -- a
//   control that cannot show its own starting value rewrites it the first
//   time somebody opens an old record and saves;
//
//   and a database that has not had 026 yet still takes a job. That
//   migration adds the counting, not the feature, and refusing to create
//   work over a reporting column would be a far worse failure than the one
//   it guards.
//
//   node scripts/supplier-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { SUPPLIERS, OTHER, materialLine, parseMaterialSource } from "../shared/suppliers.js";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const HOST = "cascademanagement.subsub.work";
const ACCOUNT = "acc_pm";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const d1 = (sql) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const pm = await tok("pm@example.test");
const H = { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
const S = Date.now().toString(36);

const makeJob = (body) => fetch(`${API}/jobs`, { method: "POST", headers: H,
  body: JSON.stringify({ propertyId: "p1", address: "101 Main St", trades: ["roofing"], ...body }) });

console.log("\n-- reading an old value back into the chooser --");
// Every job written before today holds free text. None of it may be lost.
const cases = [
  ["ABC Supply — Ballard", { supplier: "abc", branch: "Ballard", other: "" }],
  ["ABC Supply", { supplier: "abc", branch: "", other: "" }],
  ["SRS Building Materials — Kent", { supplier: "srs", branch: "Kent", other: "" }],
  ["abc supply — ballard", { supplier: "abc", branch: "ballard", other: "" }],
  ["Ballard Lumber", { supplier: OTHER, branch: "", other: "Ballard Lumber" }],
  ["abc - ballard", { supplier: OTHER, branch: "", other: "abc - ballard" }],
  ["", { supplier: "", branch: "", other: "" }],
];
cases.forEach(([text, want]) => {
  const got = parseMaterialSource(text);
  ck(`"${text || "(empty)"}"`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
});
// The one that would be silent data loss: nothing recognisable is discarded.
ck("an unrecognised value is kept verbatim, never dropped",
  parseMaterialSource("Ballard Lumber").other === "Ballard Lumber");
ck("and it round-trips unchanged",
  materialLine(parseMaterialSource("Ballard Lumber")) === "Ballard Lumber");
ck("a recognised one round-trips too",
  materialLine(parseMaterialSource("ABC Supply — Ballard")) === "ABC Supply — Ballard");

console.log("\n-- the Worker composes the line, not the client --");
let r = await (await makeJob({ title: `Sup A ${S}`, materialSupplier: "abc", materialBranch: "Ballard" })).json();
ck("named supplier and branch", r.job?.materialSource === "ABC Supply — Ballard", r.job?.materialSource);
ck("the id is stored beside it", r.job?.materialSupplier === "abc", r.job?.materialSupplier);
ck("and the branch", r.job?.materialBranch === "Ballard", r.job?.materialBranch);

r = await (await makeJob({ title: `Sup B ${S}`, materialSupplier: "qxo" })).json();
ck("no branch is fine", r.job?.materialSource === "QXO", r.job?.materialSource);

r = await (await makeJob({ title: `Sup C ${S}`, materialSupplier: OTHER, materialOther: "Ballard Lumber" })).json();
ck("a local yard is recorded as a supplier", r.job?.materialSupplier === OTHER, r.job?.materialSupplier);
ck("under its own name", r.job?.materialSource === "Ballard Lumber", r.job?.materialSource);

// The point of composing server-side: a client cannot put its own words on
// a work order by claiming a supplier it likes the look of.
r = await (await makeJob({ title: `Sup D ${S}`, materialSupplier: "abc",
  materialSource: "Totally Different Co" })).json();
ck("a client's own string loses to the list", r.job?.materialSource === "ABC Supply", r.job?.materialSource);
r = await (await makeJob({ title: `Sup E ${S}`, materialSupplier: "not-a-supplier" })).json();
ck("an id that is not on the list is refused", !r.job?.materialSupplier, String(r.job?.materialSupplier));

console.log("\n-- an older client still works --");
r = await (await makeJob({ title: `Sup F ${S}`, materialSource: "Some Old Yard" })).json();
ck("plain materialSource is still taken", r.job?.materialSource === "Some Old Yard", r.job?.materialSource);

console.log("\n-- the chooser on the form --");
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 1500 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));
try {
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(1200);
  await page.type("input[type=email]", "pm@example.test");
  await page.type("input[type=password]", "correct horse battery");
  await page.waitForSelector(".login-btn", { timeout: 15000 });
  await page.click(".login-btn");
  await wait(6000);

  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^New job$/i.test(b.textContent.trim()))?.click());
  await wait(1500);

  const sel = await page.evaluate(() => {
    const label = [...document.querySelectorAll("label.fld")]
      .find((l) => /Material source/i.test(l.textContent));
    const s = label?.querySelector("select");
    return { found: !!s, options: [...(s?.options || [])].map((o) => o.textContent.trim()) };
  });
  ck("it is a chooser, not a text box", sel.found, JSON.stringify(sel));
  SUPPLIERS.forEach((sp) => ck(`offers ${sp.name}`, sel.options.includes(sp.name), sel.options.join(" | ")));
  ck("and somewhere else", sel.options.some((o) => /somewhere else/i.test(o)), sel.options.join(" | "));

  // Picking one shows the branch field and the line it will write.
  await page.evaluate(() => {
    const label = [...document.querySelectorAll("label.fld")].find((l) => /Material source/i.test(l.textContent));
    const s = label.querySelector("select");
    s.value = "abc";
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await wait(600);
  let shown = await page.evaluate(() => ({
    branch: !!([...document.querySelectorAll("label.fld")].find((l) => /^Branch/i.test(l.textContent.trim()))),
    hint: [...document.querySelectorAll(".cov-hint")].map((p) => p.textContent).find((t) => /work order will say/i.test(t)) || "",
  }));
  ck("picking one asks which branch", shown.branch);
  ck("and shows what will be written", /ABC Supply/.test(shown.hint), shown.hint);

  // "Somewhere else" swaps the branch field for a name field.
  await page.evaluate((other) => {
    const label = [...document.querySelectorAll("label.fld")].find((l) => /Material source/i.test(l.textContent));
    const s = label.querySelector("select");
    s.value = other;
    s.dispatchEvent(new Event("change", { bubbles: true }));
  }, OTHER);
  await wait(600);
  shown = await page.evaluate(() => ({
    which: !!([...document.querySelectorAll("label.fld")].find((l) => /Which supplier/i.test(l.textContent))),
    branch: !!([...document.querySelectorAll("label.fld")].find((l) => /^Branch/i.test(l.textContent.trim()))),
  }));
  ck("somewhere else asks for a name", shown.which);
  ck("and stops asking for a branch", !shown.branch);
  ck("nothing threw", crashes.length === 0, crashes.join(" | "));

  console.log("\n-- a database still waiting on 026 --");
  d1("ALTER TABLE jobs DROP COLUMN material_supplier; ALTER TABLE jobs DROP COLUMN material_branch;");
  try {
    const res = await makeJob({ title: `Sup G ${S}`, materialSupplier: "srs", materialBranch: "Kent" });
    const body = await res.json();
    ck("the job is still created", res.status === 201, `HTTP ${res.status} ${JSON.stringify(body).slice(0, 120)}`);
    ck("and the contractor still reads the right line",
      body.job?.materialSource === "SRS Building Materials — Kent", body.job?.materialSource);
    ck("only the counting is missing", !body.job?.materialSupplier, String(body.job?.materialSupplier));
  } finally {
    d1("ALTER TABLE jobs ADD COLUMN material_supplier TEXT; ALTER TABLE jobs ADD COLUMN material_branch TEXT;");
  }
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
