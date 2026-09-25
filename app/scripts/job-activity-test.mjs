// A job that has just moved, at the top.
//
// Jobs were only ever ordered by when they were created, so one that had
// just been assigned, replied to, scheduled or corrected sat wherever it
// first landed. A list of three hundred buries the six that changed today,
// which is the opposite of what a list is for.
//
// There was nothing to sort by -- created_at was the only timestamp a job
// carried -- so this checks the new one is touched by every route that
// moves a job, not just the one that writes the jobs row.
//
//   node scripts/job-activity-test.mjs

const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const ACCOUNT = "acc_pm";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;
const pm = await tok("pm@example.test");
const H = { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
const call = async (path, opts = {}) => {
  const r = await fetch(API + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};
const S = Date.now().toString(36);
const mk = async (title, trades = ["roofing"]) => (await call("/jobs", { method: "POST", body: JSON.stringify({
  title, propertyId: "p1", address: "101 Main St", zip: "98101", trades }) })).body.id;
const row = async (id) => (await call("/jobs")).body.find((j) => j.id === id);
const stampOf = async (id) => (await row(id))?.updatedAtIso || null;
const pause = () => new Promise((r) => setTimeout(r, 1100));

console.log("\n-- a new job starts with a timestamp --");
const a = await mk(`Older ${S}`);
await pause();
const b = await mk(`Newer ${S}`);
ck("both carry one", !!(await stampOf(a)) && !!(await stampOf(b)), `${await stampOf(a)} / ${await stampOf(b)}`);
const order1 = (await call("/jobs")).body.map((j) => j.id);
ck("the newer one is above the older", order1.indexOf(b) < order1.indexOf(a),
  `newer at ${order1.indexOf(b)}, older at ${order1.indexOf(a)}`);

console.log("\n-- and touching the older one lifts it above --");
const before = await stampOf(a);
await pause();
await call(`/jobs/${a}/assign`, { method: "POST", body: JSON.stringify({
  trade: "roofing", companyId: "cmp_r", value: "200", responseWindow: "24h" }) });
const after = await stampOf(a);
ck("assigning moves its clock on", after > before, `${before} → ${after}`);
const order2 = (await call("/jobs")).body.map((j) => j.id);
ck("and it is now above the newer one", order2.indexOf(a) < order2.indexOf(b),
  `older at ${order2.indexOf(a)}, newer at ${order2.indexOf(b)}`);
ck("in fact it is first", order2[0] === a, `first is ${order2[0] === a ? "it" : "something else"}`);

console.log("\n-- every route that moves a job says so --");
// The point of the whole exercise: "moved" has to mean what a person means
// by it, not "the jobs row happened to be written to". Each of these lives
// in a different table.
const steps = [
  ["a contractor replying", async () => {
    const j = await row(a);
    const woId = Object.values(j.assignments)[0]?.id;
    await call(`/work-orders/${woId}/respond`, { method: "POST", body: JSON.stringify({ status: "accepted" }) });
  }],
  ["proposing a visit", async () => {
    await call(`/jobs/${a}/visits`, { method: "POST", body: JSON.stringify({ date: "2026-11-02", startTime: "09:00" }) });
  }],
  ["marking it complete", async () => { await call(`/jobs/${a}/complete`, { method: "POST" }); }],
  ["reopening it", async () => { await call(`/jobs/${a}/reopen`, { method: "POST" }); }],
];
for (const [what, go] of steps) {
  const was = await stampOf(a);
  await pause();
  await go();
  const now = await stampOf(a);
  ck(`${what} moves it`, now > was, `${was} → ${now}`);
}

console.log("\n-- a tenant's own doing counts too --");
const EMAIL = `mover.${S}@example.test`;
await call("/tenants", { method: "POST", body: JSON.stringify({ propertyId: "p1", firstName: "Nel", lastName: "Fry", email: EMAIL, unit: "3C", channels: ["email"] }) });
const sent = await (await fetch("http://127.0.0.1:8904/__sent")).json();
const inv = sent[sent.length - 1]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
await fetch(`${API}/tenant-invite/${inv}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "correct horse battery" }) });
const tn = await tok(EMAIL);
const tH = { Authorization: `Bearer ${tn}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
const rep = await (await fetch(`${API}/jobs`, { method: "POST", headers: tH,
  body: JSON.stringify({ title: `Tenant ${S}`, propertyId: "p1", address: "101 Main St", trades: [],
    reportDetail: { problem: "A faucet is dripping", started: "Today", words: "first go", unit: "3C" } }) })).json();
const was = await stampOf(rep.id);
await pause();
await fetch(`${API}/jobs/${rep.id}/report`, { method: "PATCH", headers: tH,
  body: JSON.stringify({ title: `Tenant ${S} corrected` }) });
ck("correcting their own report moves it", (await stampOf(rep.id)) > was, `${was} → ${await stampOf(rep.id)}`);
const wasD = await stampOf(rep.id);
await pause();
await call(`/jobs/${rep.id}/decline`, { method: "POST", body: JSON.stringify({ note: "not ours to fix" }) });
ck("and so does turning it down", (await stampOf(rep.id)) > wasD, `${wasD} → ${await stampOf(rep.id)}`);

console.log("\n-- one format, because the column is sorted as text --");
// created_at is "2026-09-22 19:28:16" and an ISO string carries a T where
// that has a space. "T" sorts above every digit, so a job updated at one in
// the morning would have outranked one created at eleven at night.
const stamps = (await call("/jobs")).body.map((j) => j.updatedAtIso).filter(Boolean);
ck("no movement timestamp is in ISO form", !stamps.some((t) => t.includes("T")),
  stamps.find((t) => t.includes("T")) || `${stamps.length} checked`);
ck("they all look like SQLite's own", stamps.every((t) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(t)),
  stamps.find((t) => !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(t)) || "");
// And the thing that actually matters: text order equals time order.
const asTime = (t) => new Date(t.replace(" ", "T") + "Z").getTime();
const listed = (await call("/jobs")).body.map((j) => j.updatedAtIso).filter(Boolean);
ck("so the list really is in newest-first order",
  listed.every((t, i) => i === 0 || asTime(listed[i - 1]) >= asTime(t)),
  listed.slice(0, 3).join(" | "));

console.log("\n-- what was there before --");
// Rows written before any of this existed must not all claim to have moved
// at once, or never to have moved at all.
const old = (await call("/jobs")).body.filter((j) => !/[A-Za-z]+ ${S}/.test(j.title));
ck("every job has a movement timestamp", old.every((j) => !!j.updatedAtIso),
  `${old.filter((j) => !j.updatedAtIso).length} without one`);
ck("and none of them is in the future",
  old.every((j) => asTime(String(j.updatedAtIso)) <= Date.now() + 60000),
  old.filter((j) => asTime(String(j.updatedAtIso)) > Date.now() + 60000).length + " ahead of the clock");

console.log("\n-- and on the screen --");
// The badge is only worth anything if it is not on everything. Checked
// against each job's own timestamp rather than against a fixture, so this
// holds whatever state the local database has drifted into.
const puppeteer = (await import("puppeteer-core")).default;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true, args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1100 });
  await page.goto(`${process.env.APP_BASE || "http://127.0.0.1:5191"}/`, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await (await page.$("input[type=email]")).type("pm@example.test");
  await (await page.$("input[type=password]")).type("x");
  await page.click(".login-btn");
  await new Promise((r) => setTimeout(r, 3500));
  await page.evaluate(() => [...document.querySelectorAll("button,a")].find((e) => /^Jobs/.test(e.textContent.trim()))?.click());
  await new Promise((r) => setTimeout(r, 2200));
  // Keyed by id, not by title: the seed data is full of jobs sharing a
  // title, and matching on those compared a badge against some other job's
  // timestamp.
  const cards = await page.evaluate(() => [...document.querySelectorAll(".job-card")].map((c) => ({
    id: c.getAttribute("data-job-id"),
    title: c.querySelector("h3")?.textContent.trim(),
    badge: !!c.querySelector(".job-moved"),
    lit: c.classList.contains("just-moved") })));
  ck("the list rendered", cards.length > 0, `${cards.length} cards`);
  ck("and each card says which job it is", cards.every((c) => !!c.id), "some have no id");
  const all = (await call("/jobs")).body;
  const byId = new Map(all.map((j) => [j.id, j]));
  const SIX_H = 6 * 60 * 60 * 1000;
  const wrong = cards.filter((c) => {
    const j = byId.get(c.id);
    if (!j) return false;
    // The same fallback the badge itself uses. A job that has never been
    // touched has no updated_at, and movedAgo() falls back to created_at on
    // purpose; comparing against updatedAtIso alone gave NaN and called a
    // correct badge wrong -- which only showed up once two runs landed
    // inside the six-hour window.
    return c.badge !== (Date.now() - asTime(j.updatedAtIso || j.createdAtIso) <= SIX_H);
  });
  ck("every badge matches whether that job actually moved recently",
    wrong.length === 0, wrong.slice(0, 3).map((w) => `${w.title}: badge=${w.badge}`).join(" ; "));
  ck("and the badge and the highlight agree with each other",
    cards.every((c) => c.badge === c.lit), cards.filter((c) => c.badge !== c.lit).length + " disagree");
  // Compared against the jobs this tab actually shows, which is the active
  // ones -- the newest movement overall may be on a completed job.
  const newestShown = cards
    .map((c) => byId.get(c.id)).filter(Boolean)
    .reduce((best, j) => !best || asTime(j.updatedAtIso) > asTime(best.updatedAtIso) ? j : best, null);
  ck("the most recently moved of them is first",
    cards[0]?.id === newestShown?.id,
    `first is ${byId.get(cards[0]?.id)?.updatedAtIso}, newest shown is ${newestShown?.updatedAtIso}`);
} finally {
  await browser.close();
  // Take the jobs away again. Without this every run left two behind, and
  // within six hours of each other the leftovers are inside the badge
  // window and get asserted over by the next run -- which is how this file
  // came to fail only when the whole suite ran.
  try {
    const { execFileSync } = await import("node:child_process");
    execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db", "--config=./wrangler.toml",
      "--local", "--command", `DELETE FROM jobs WHERE id IN ('${a}', '${b}')`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) { console.log("cleanup:", String(e.message).slice(0, 80)); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
