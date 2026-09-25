// "What is scheduled" — at the top, and honest about what has passed.
//
// The dashboard answered the question this page exists for last: a five-row
// list headed "Upcoming jobs", below registration problems and documents to
// verify, in the smallest type on the screen. And it called a job booked for
// two days ago upcoming, because the only test on it was "has a date and is
// not closed".
//
// And the jobs tab had no calendar at all. The list is ordered by whatever
// moved last, which answers "what needs me" and cannot answer "what is
// happening in October".
//
// Needs the local stack (worker 8787, supa stub 8902, mail stub 8904,
// app dist 5191).
//
//   node scripts/schedule-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

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

// Local dates, the same way the app reads them: toISOString() is UTC, and
// west of Greenwich that is a different day for a good part of the evening.
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const YESTERDAY = key(day(-1)), LAST_WEEK = key(day(-6)), TOMORROW = key(day(1)), AHEAD = key(day(9));

const S = Date.now().toString(36);
const pm = await tok("pm@example.test");
const H = { Authorization: `Bearer ${pm}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };

const make = async (title, date, time) => (await (await fetch(`${API}/jobs`, { method: "POST", headers: H,
  body: JSON.stringify({ title, address: "44 Pike St", area: "Bellevue", zip: "98004",
    trades: ["roofing"], date, time }) })).json()).id;

// Two behind, two ahead. The one tomorrow is the one the panel should lead
// with; the two behind are what used to be called "upcoming".
const LATE1 = `Late one ${S}`, LATE2 = `Late two ${S}`;
const NEXT = `Next one ${S}`, LATER = `Later one ${S}`;
const ids = [
  await make(LATE1, YESTERDAY, "09:00"),
  await make(LATE2, LAST_WEEK, "14:00"),
  await make(NEXT, TOMORROW, "08:30"),
  await make(LATER, AHEAD, "13:00"),
];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1500 });
const crashes = [];
page.on("pageerror", (e) => crashes.push(e.message));

const goTab = async (label) => {
  await page.evaluate((l) => [...document.querySelectorAll("nav button")]
    .find((b) => new RegExp(`^${l}`, "i").test(b.innerText.trim()))?.click(), label);
  await wait(2200);
};

try {
  console.log("\n-- signing in --");
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(900);
  await page.type("input[type=email]", "pm@example.test");
  await page.type("input[type=password]", "correct horse battery");
  await page.click(".login-btn");
  await wait(6500);
  ck("the dashboard is up", /Good to see you/.test(await page.evaluate(() => document.body.innerText)));

  console.log("\n-- the schedule is near the top, not near the bottom --");
  const place = await page.evaluate(() => {
    const hero = document.querySelector(".sched-hero");
    if (!hero) return null;
    const box = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().top + window.scrollY) : null; };
    // The named sections it used to sit below, found by their headings
    // rather than by order -- the first .dash-sec is the life-safety block,
    // which is meant to stay above everything.
    const under = [...document.querySelectorAll(".dash-sec h3")]
      .filter((h) => /documents|registration|not yet rated|attention/i.test(h.textContent))
      .map((h) => ({ what: h.textContent.trim().replace(/\s+/g, " "),
        top: Math.round(h.getBoundingClientRect().top + window.scrollY) }));
    return {
      top: Math.round(hero.getBoundingClientRect().top + window.scrollY),
      tiles: box(".dash-grid"),
      sos: box(".sec-sos"),
      sosRows: document.querySelectorAll(".sec-sos .em-row").length,
      under,
      pageHeight: Math.round(document.documentElement.scrollHeight),
    };
  });
  ck("there is a schedule panel", !!place, String(place));
  ck("above the counter tiles", place.tiles === null || place.top < place.tiles,
    `panel ${place.top}, tiles ${place.tiles}`);
  const below = place.under.filter((u) => !/attention/i.test(u.what) && u.top < place.top);
  ck("and above every section it used to sit under", below.length === 0,
    below.map((u) => `${u.what} at ${u.top}`).join(" | "));
  // Life safety stays first. That is the only thing allowed above it.
  ck("with only the life-safety block above it",
    place.sos === null || place.sos < place.top, `sos ${place.sos}, panel ${place.top}`);
  // Which is capped now. It drew every row it had, and this account carries
  // a few hundred open urgent reports -- fifty thousand pixels of them,
  // with the schedule below the bottom.
  ck("and that block is capped rather than endless", place.sosRows <= 6, `${place.sosRows} rows`);
  // It used to be the last block on a page this long.
  ck("in the first screenful or two", place.top < 1800, `${place.top} of ${place.pageHeight}`);

  console.log("\n-- it leads with the next one --");
  const next = await page.evaluate(() => {
    const n = document.querySelector(".sh-next");
    if (!n) return null;
    const cs = getComputedStyle(n.querySelector(".shn-day"));
    return { text: n.innerText.replace(/\n/g, " | "), daySize: parseFloat(cs.fontSize),
      lede: n.querySelector(".shn-lede")?.innerText.trim(),
      title: n.querySelector(".shn-title")?.innerText.trim() };
  });
  ck("there is a next-up card", !!next, String(next));
  ck("and it is tomorrow's job, not last week's", next.title.includes("Next one"), next.title);
  ck("said in words as well as a date", /tomorrow/i.test(next.lede), next.lede);
  ck("with the time on it", /8:30 AM/.test(next.text), next.text);
  // The complaint was that this was not prominent. A date set in the same
  // 13px as everything else is not prominence.
  ck("the date is set large", next.daySize >= 20, `${next.daySize}px`);

  console.log("\n-- and does not call a date that has passed upcoming --");
  const late = await page.evaluate(() => {
    const l = document.querySelector(".sh-late");
    return l ? { text: l.innerText.replace(/\n/g, " | "),
      rows: [...l.querySelectorAll(".shl-title")].map((x) => x.textContent.trim()) } : null;
  });
  ck("the ones behind get their own line", !!late, String(late));
  ck("counted honestly", /2 jobs are past their date/i.test(late.text), late.text.slice(0, 60));
  ck("and named", late.rows.some((t) => t.includes("Late one")) && late.rows.some((t) => t.includes("Late two")),
    late.rows.join(" | "));
  const heroText = await page.evaluate(() => document.querySelector(".sched-hero").innerText);
  ck("none of them is in the next-up card", !next.text.includes("Late one") && !next.text.includes("Late two"));
  ck("nothing in the panel calls them upcoming", !/upcoming/i.test(heroText),
    heroText.split("\n").slice(0, 2).join(" / "));

  console.log("\n-- the fortnight strip --");
  const strip = await page.evaluate(() => {
    const days = [...document.querySelectorAll(".shs-day")];
    return { n: days.length,
      today: days.filter((d) => d.classList.contains("today")).length,
      marked: days.filter((d) => d.classList.contains("has")).map((d) => d.innerText.replace(/\n/g, "")),
      next: days.filter((d) => d.classList.contains("is-next")).length };
  });
  ck("fourteen days of it", strip.n === 14, `${strip.n}`);
  ck("with today marked once", strip.today === 1, `${strip.today}`);
  ck("the next booked day highlighted", strip.next === 1, `${strip.next}`);
  ck("and the days with work on them marked", strip.marked.length >= 2, strip.marked.join(", "));

  console.log("\n-- the jobs tab has a calendar now --");
  await goTab("Jobs");
  const toggle = await page.evaluate(() => [...document.querySelectorAll(".jv-seg button")].map((b) => b.innerText.trim()));
  ck("there is a list/calendar switch", toggle.length === 2 && /calendar/i.test(toggle.join(" ")), toggle.join(" | "));
  await page.evaluate(() => [...document.querySelectorAll(".jv-seg button")]
    .find((b) => /calendar/i.test(b.innerText))?.click());
  await wait(1200);
  const cal = await page.evaluate(() => {
    const c = document.querySelector(".jcal");
    if (!c) return null;
    return {
      month: c.querySelector(".jcal-month strong")?.textContent.trim(),
      cells: c.querySelectorAll(".jcal-cell:not(.empty)").length,
      withWork: [...c.querySelectorAll(".jcal-cell.has")].map((x) => x.querySelector(".jc-dom")?.textContent.trim()),
      today: c.querySelectorAll(".jcal-cell.today").length,
      listGone: !document.querySelector(".job-card"),
      dows: [...c.querySelectorAll(".jcal-dows span")].map((x) => x.textContent),
    };
  });
  ck("the grid is drawn", !!cal, String(cal));
  ck("seven columns", cal.dows.length === 7, cal.dows.join(" "));
  ck("a whole month of days", cal.cells >= 28 && cal.cells <= 31, `${cal.cells}`);
  ck("today is on it", cal.today === 1, `${cal.today}`);
  ck("days with work are marked", cal.withWork.length > 0, cal.withWork.join(", "));
  ck("and the list is not also on screen", cal.listGone === true);

  console.log("\n-- picking a day, then a job --");
  const wanted = String(new Date(`${(() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })()}T12:00:00`).getDate());
  await page.evaluate((dom) => {
    [...document.querySelectorAll(".jcal-cell:not(.empty)")]
      .find((c) => c.querySelector(".jc-dom")?.textContent.trim() === dom)?.click();
  }, wanted);
  await wait(900);
  const dayPanel = await page.evaluate(() => {
    const d = document.querySelector(".jcal-day");
    return d ? { text: d.innerText.replace(/\n/g, " | "),
      rows: [...d.querySelectorAll(".jcd-title")].map((x) => x.textContent.trim()) } : null;
  });
  ck("the day opens below the grid", !!dayPanel, String(dayPanel));
  ck("holding that day's job", dayPanel.rows.some((t) => t.includes("Next one")), dayPanel.rows.join(" | "));
  ck("and saying which day in words", /tomorrow/i.test(dayPanel.text), dayPanel.text.slice(0, 70));

  await page.evaluate(() => [...document.querySelectorAll(".jcd-row")]
    .find((r) => /Next one/.test(r.innerText))?.click());
  await wait(1400);
  const landed = await page.evaluate(() => {
    const card = document.querySelector(".job-card.landed");
    return { onList: !!document.querySelector(".job-card"),
      gridGone: !document.querySelector(".jcal"),
      title: card?.querySelector("h3")?.textContent.trim() || null,
      ring: card ? getComputedStyle(card).boxShadow : null };
  });
  // The point of the grid is finding a job, not a second place to edit one.
  ck("it hands the job to the list", landed.onList && landed.gridGone);
  ck("with that job marked", landed.title && landed.title.includes("Next one"), landed.title);
  ck("and visibly so", !!landed.ring && landed.ring !== "none", landed.ring?.slice(0, 40));

  ck("nothing threw along the way", crashes.length === 0, crashes.join(" ; "));
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
  await page.screenshot({ path: "/tmp/claude-0/sched-fail.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

try {
  d1(`DELETE FROM jobs WHERE id IN (${ids.map((i) => `'${i}'`).join(",")})`);
} catch (e) {
  fail++;
  console.log("FAIL  cleanup  --", String(e.message).split("\n").find((l) => /ERROR/.test(l)) || e.message);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
