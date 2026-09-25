// What happens to a visit after its window has been and gone.
//
// A confirmed visit is the only thing on a tenant's dashboard with a date on
// it, and until now nothing ever collected on it. The window passed and the
// row went on reading "Scheduled -- Sep 22" under a heading that said
// "Somebody is coming", two days after the afternoon in question. That is
// the one line on the page that can be read and be flatly untrue, and it
// stayed that way until somebody closed the job, which could be weeks.
//
// So: a booked time that has passed leaves that section, says "Was due"
// instead of "Scheduled", and asks the one person who knows for certain the
// only question that settles it. Neither answer moves the job -- "yes"
// leaves the manager to close it, "no" leaves them to propose the next time.
//
// Needs the local stack (worker 8787, supa stub 8902, mail stub 8904,
// app dist 5191).
//
//   node scripts/visit-after-test.mjs

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

// Dates relative to the day the suite runs, so it does not rot the way a
// pinned 2026-11-04 would.
const day = (delta) => {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
};
const YESTERDAY = day(-1), LAST_WEEK = day(-7), NEXT_WEEK = day(7);

// ---- a tenant with four reports ----------------------------------------
const S = Date.now().toString(36);
const EMAIL = `after.${S}@example.test`;
const OTHER = `bystander.${S}@example.test`;
const pm = await tok("pm@example.test");
const H = { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };

const newTenant = async (email, first) => {
  await fetch(`${API}/tenants`, { method: "POST", headers: H,
    body: JSON.stringify({ propertyId: "p1", firstName: first, lastName: "Vance", email, unit: "3C", channels: ["email"] }) });
  const sent = await (await fetch(`${MAIL}/__sent`)).json();
  const inv = sent[sent.length - 1]?.text.match(/\/\?tenant=([0-9a-f]{64})/)?.[1];
  await fetch(`${API}/tenant-invite/${inv}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "correct horse battery" }) });
  const t = await tok(email);
  return { Authorization: `Bearer ${t}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
};
const tH = await newTenant(EMAIL, "Marin");
const oH = await newTenant(OTHER, "Dale");

const report = async (headers, title) => (await (await fetch(`${API}/jobs`, { method: "POST", headers,
  body: JSON.stringify({ title, propertyId: "p1", address: "101 Main St", trades: ["roofing"],
    reportDetail: { problem: "The gutter is coming away", started: "Today", words: "", unit: "3C" } }) })).json()).id;

// A booked time and a confirmed answer to it.
const booked = async (headers, title, date, times = { startTime: "10:00", endTime: "11:00" }) => {
  const id = await report(headers, title);
  await fetch(`${API}/jobs/${id}/approve`, { method: "POST", headers: H });
  await fetch(`${API}/jobs/${id}/assign`, { method: "POST", headers: H,
    body: JSON.stringify({ trade: "roofing", companyId: "cmp_r", value: "150", responseWindow: "24h" }) });
  const v = await (await fetch(`${API}/jobs/${id}/visits`, { method: "POST", headers: H,
    body: JSON.stringify({ date, ...times }) })).json();
  await fetch(`${API}/visits/${v.id}/respond`, { method: "POST", headers, body: JSON.stringify({ status: "confirmed" }) });
  return { id, visit: v };
};

const GONE = `Gone one ${S}`;         // yesterday, nobody came
const OLD = `Old one ${S}`;           // last week, somebody came
const SOON = `Soon one ${S}`;         // next week, still ahead
const THEIRS = `Someone else's ${S}`; // another tenant's, yesterday
const gone = await booked(tH, GONE, YESTERDAY);
const old = await booked(tH, OLD, LAST_WEEK);
const soon = await booked(tH, SOON, NEXT_WEEK);
const theirs = await booked(oH, THEIRS, YESTERDAY);

const say = (headers, id, body) => fetch(`${API}/visits/${id}/outcome`, { method: "POST", headers, body: JSON.stringify(body) });
const statusOf = async (headers, jobId) =>
  (await (await fetch(`${API}/visits`, { headers })).json()).filter((v) => v.jobId === jobId);

console.log("\n-- who may answer, and when --");
{
  const r = await say(H, gone.visit.id, { happened: false });
  ck("a manager cannot answer for the tenant", r.status === 403, `${r.status}`);
}
{
  // The one thing this route must not be: a way to read or write another
  // tenant's repairs. Same account, same building, different person.
  const r = await say(oH, gone.visit.id, { happened: false });
  ck("nor can another tenant in the same building", r.status === 403, `${r.status}`);
  const still = await statusOf(tH, gone.id);
  ck("and it is left alone when they try", still[0]?.status === "confirmed", still[0]?.status);
}
{
  const r = await say(tH, soon.visit.id, { happened: false });
  const b = await r.json();
  ck("a visit that has not happened yet is refused", r.status === 409 && b.error === "not_yet", `${r.status} ${b.error}`);
}
{
  const r = await say(tH, gone.visit.id, {});
  ck("and so is an answer that says neither yes nor no", r.status === 400, `${r.status}`);
  const still = await statusOf(tH, gone.id);
  ck("nothing was written on the way past", still[0]?.status === "confirmed", still[0]?.status);
}
{
  const r = await say(tH, `vis_${S}_nope`, { happened: true });
  ck("an id that is not a visit is a 404", r.status === 404, `${r.status}`);
}

console.log("\n-- nobody came --");
{
  const r = await say(tH, gone.visit.id, { happened: false, note: "I waited in all morning" });
  const v = await r.json();
  ck("the answer is taken", r.status === 200, `${r.status}`);
  ck("and the visit reads as missed", v.status === "missed", v.status);
  ck("with what they said kept", v.tenantNote === "I waited in all morning", v.tenantNote);
  ck("and the moment they said it", !!v.respondedAt, v.respondedAt);
  // The repair is still needed. Only the appointment is over.
  const job = (await (await fetch(`${API}/jobs`, { headers: tH })).json()).find((j) => j.id === gone.id);
  ck("the report itself is untouched", job && job.status !== "completed" && !job.withdrawnAt,
    `${job?.status} withdrawn=${job?.withdrawnAt}`);
  const log = d1(`SELECT kind, text FROM activity WHERE kind = 'visit_missed' AND text LIKE '%${GONE}%'`);
  ck("the account is told, in the log", /visit_missed/.test(log) && /Nobody came/.test(log),
    log.split("\n").filter((l) => /Nobody|kind/.test(l)).slice(0, 2).join(" / "));
}
{
  const r = await say(tH, gone.visit.id, { happened: true });
  const b = await r.json();
  ck("answering twice is refused", r.status === 409 && b.error === "not_open", `${r.status} ${b.error}`);
  const still = await statusOf(tH, gone.id);
  ck("and the first answer stands", still[0]?.status === "missed", still[0]?.status);
}

console.log("\n-- somebody came --");
{
  const r = await say(tH, old.visit.id, { happened: true });
  const v = await r.json();
  ck("that answer is taken too", r.status === 200 && v.status === "happened", `${r.status} ${v.status}`);
  const log = d1(`SELECT kind FROM activity WHERE kind = 'visit_happened' AND text LIKE '%${OLD}%'`);
  ck("and logged as its own kind", /visit_happened/.test(log), log.split("\n").slice(0, 3).join(" / "));
}

console.log("\n-- and the next time supersedes the last --");
{
  await fetch(`${API}/jobs/${gone.id}/visits`, { method: "POST", headers: H,
    body: JSON.stringify({ date: NEXT_WEEK, startTime: "09:00", endTime: "10:00" }) });
  const mine = await statusOf(tH, gone.id);
  // Without this the missed row keeps coming back from GET /visits alongside
  // the new proposal, and the client takes whichever is newest -- so the old
  // answer would sit in the list forever, one reordering away from winning.
  ck("the missed one is retired", mine.length === 1, mine.map((v) => v.status).join(", "));
  ck("leaving the new proposal", mine[0]?.status === "proposed" && mine[0]?.date === NEXT_WEEK,
    `${mine[0]?.status} ${mine[0]?.date}`);
}

// ---- and what the tenant actually sees ---------------------------------
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1400 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));

const sections = () => page.evaluate(() => [...document.querySelectorAll(".tn-sec")].map((s) => ({
  title: s.querySelector(".tn-sec-title")?.textContent.trim(),
  count: s.querySelector(".sec-count")?.textContent.trim(),
  rows: [...s.querySelectorAll(".tn-row-title")].map((t) => t.textContent.trim()),
  top: Math.round(s.getBoundingClientRect().top),
})));
const rowFor = (title) => page.evaluate((t) => {
  const r = [...document.querySelectorAll(".tn-row")].find((x) => x.innerText.includes(t));
  if (!r) return null;
  return {
    chip: r.querySelector(".tn-chip")?.textContent.trim() || "",
    asks: !!r.querySelector(".tn-after"),
    needsYou: r.classList.contains("needs-you"),
    buttons: [...r.querySelectorAll(".tn-after button")].map((b) => b.textContent.trim()),
    text: r.innerText.replace(/\n/g, " · "),
  };
}, title);

// A fourth report, booked for yesterday and not yet answered, is what the
// screen is checked against.
const STILL = `Still open ${S}`;
const still = await booked(tH, STILL, YESTERDAY, { startTime: "13:00", endTime: "15:00" });

try {
  console.log("\n-- the dashboard --");
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "networkidle0" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await (await page.$("input[type=email]")).type(EMAIL);
  await (await page.$("input[type=password]")).type("correct horse battery");
  await page.click(".login-btn");
  await wait(3500);
  ck("the tenant is in", /Hello, Marin/.test(await page.evaluate(() => document.body.innerText)));

  const secs = await sections();
  const overdue = secs.find((x) => /did they come/i.test(x.title || ""));
  const coming = secs.find((x) => /somebody is coming/i.test(x.title || ""));
  ck("a booked time that has passed gets its own section", !!overdue, secs.map((x) => x.title).join(" | "));
  ck("and it holds the one that has", overdue.rows.includes(STILL), overdue.rows.join(" | "));
  // The whole complaint: this is what used to say "Somebody is coming".
  ck("which no longer claims somebody is coming",
    !coming || !coming.rows.includes(STILL), coming?.rows.join(" | "));
  ck("the one still ahead stays there", coming?.rows.includes(SOON), coming?.rows.join(" | "));
  ck("the section that asks something is above the one that does not",
    overdue.top < coming.top, `${overdue.top} vs ${coming.top}`);

  console.log("\n-- the row itself --");
  const r = await rowFor(STILL);
  ck("the chip says it was due, not that it is scheduled",
    /^Was due/.test(r.chip) && !/Scheduled/.test(r.chip), r.chip);
  ck("and still carries the date and window", /1 PM/.test(r.chip), r.chip);
  ck("it is marked as wanting something from the reader", r.needsYou === true);
  ck("and asks the question", r.asks === true && /Did somebody come\?/.test(r.text), r.text.slice(0, 150));
  ck("with both answers offered",
    r.buttons.some((b) => /nobody came/i.test(b)) && r.buttons.some((b) => /they came/i.test(b)),
    r.buttons.join(" | "));

  console.log("\n-- answering it --");
  await page.evaluate(() => [...document.querySelectorAll(".tn-after button")]
    .find((b) => /yes, they came/i.test(b.textContent))?.click());
  await wait(2500);
  const after = await sections();
  const overdue2 = after.find((x) => /did they come/i.test(x.title || ""));
  ck("the row leaves the section once it is answered",
    !overdue2 || !overdue2.rows.includes(STILL), overdue2?.rows.join(" | "));
  const r2 = await rowFor(STILL);
  ck("and reads as visited", /^Visited/.test(r2.chip), r2.chip);
  ck("with nothing left to answer", r2.asks === false);

  console.log("\n-- and it is not asked of the wrong person --");
  ck("another tenant's overdue visit is nowhere on this page",
    !(await page.evaluate(() => document.body.innerText)).includes(THEIRS));

  ck("nothing threw along the way", crashes.length === 0, crashes.join(" ; "));
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
  await page.screenshot({ path: "/tmp/claude-0/visit-after-fail.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

// ---- clean up, in reference order --------------------------------------
//
// D1 stops a script at the first statement that fails and does not roll back
// the ones before it, and every one of these rows is pointed at by another
// table. So: the jobs first (visits and work orders cascade off them), then
// everything that names these two users, then the users. Getting the order
// wrong here is not a failed cleanup, it is a half-deleted tenant left in
// the local database for the next suite to trip over.
try {
  const ids = [gone.id, old.id, soon.id, still.id, theirs.id].map((i) => `'${i}'`).join(",");
  const who = `SELECT id FROM users WHERE email IN ('${EMAIL}','${OTHER}')`;
  d1(`DELETE FROM jobs WHERE id IN (${ids})`);
  d1(`DELETE FROM activity WHERE user_id IN (${who})`);
  d1(`DELETE FROM email_log WHERE sent_by IN (${who})`);
  d1(`DELETE FROM tenant_invites WHERE user_id IN (${who}) OR created_by IN (${who})`);
  d1(`DELETE FROM user_invites WHERE user_id IN (${who}) OR created_by IN (${who})`);
  d1(`DELETE FROM memberships WHERE user_id IN (${who})`);
  d1(`DELETE FROM users WHERE email IN ('${EMAIL}','${OTHER}')`);
} catch (e) {
  fail++;
  console.log("FAIL  cleanup  --", e.message.split("\n").find((l) => /ERROR|constraint/i.test(l)) || e.message);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
