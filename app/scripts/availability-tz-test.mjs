// The availability grid, read at five in the afternoon in Seattle.
//
// Every cell PRINTED d.getDate(), which is local, and keyed itself on
// d.toISOString().slice(0,10), which is UTC. West of Greenwich those two
// agree all morning and disagree from late afternoon — so from about five
// o'clock every evening the column headed 23 was the 24th underneath.
//
// It was never only cosmetic:
//   - a contractor tapping "23" in their own calendar marked the 24th off,
//     so they stayed bookable on the day they had blocked;
//   - a booked job drew one column to the right of the day it is on;
//   - availableOn() asked about the wrong day;
//   - and clicking a free cell to assign passed that key straight into the
//     work order, so pressing Wednesday booked Thursday.
//
// The invariant is one line: the date a cell WRITES must be the date it
// SHOWS. That is what this checks, at an hour where the old code could not
// satisfy it — the clock is pinned to 18:30 in Los Angeles, which is 01:30
// the next day in UTC.
//
// Needs the local stack (worker 8787, supa stub 8902, app dist 5191).
//
//   node scripts/availability-tz-test.mjs

import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";
const ACCOUNT = "acc_pm";
const HOST = "cascademanagement.subsub.work";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = async (e) => (await (await fetch(AUTH, { method: "POST", body: JSON.stringify({ email: e }) })).json()).access_token;

// 18:30 in Los Angeles on 22 September 2026, which is 01:30 UTC on the 23rd.
// Everything below is checked against "22", because that is the day the
// person holding the phone is living in.
const TZ = "America/Los_Angeles";
const FIXED_MS = Date.UTC(2026, 8, 23, 1, 30, 0);
const LOCAL_DAY = "2026-09-22";

const admin = await tok("pm@example.test");
const H = { Authorization: `Bearer ${admin}`, "X-Account-Id": ACCOUNT, "content-type": "application/json" };
// The contractor whose own calendar is driven below. The seeded companies
// carry no crews, and availability is per crew, so one is lent to them for
// the run and taken back afterwards.
const CONTRACTOR_COMPANY = "cmp_r";
const subs = await (await fetch(`${API}/subs`, { headers: H })).json();
const mine = subs.find((s) => s.id === CONTRACTOR_COMPANY);
if (!mine) { console.log("FAIL  the fixture  -- cmp_r is not on this account"); process.exit(1); }
const before = JSON.parse(JSON.stringify(mine.crews || []));
const CREW = { id: `crew_tz_${Date.now().toString(36)}`, name: "Day Crew", available: true,
  unavailableDays: [], members: [{ name: "Ana Reyes", role: "Lead" }] };
await fetch(`${API}/subs/${mine.id}`, { method: "PATCH", headers: H,
  body: JSON.stringify({ crews: [...before, CREW] }) });
const restore = () => fetch(`${API}/subs/${mine.id}`, { method: "PATCH", headers: H,
  body: JSON.stringify({ crews: before }) }).catch(() => {});

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

// A page that believes it is half past six in the evening, Pacific time.
// Both halves matter: the timezone alone would not move the date, and the
// fixed clock alone would be read in UTC.
const eveningPage = async () => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1400, height: 1200 });
  await page.emulateTimezone(TZ);
  await page.evaluateOnNewDocument((ms) => {
    const Real = Date;
    class Pinned extends Real {
      constructor(...args) { if (args.length === 0) super(ms); else super(...args); }
      static now() { return ms; }
    }
    Pinned.parse = Real.parse; Pinned.UTC = Real.UTC;
    window.Date = Pinned;
  }, FIXED_MS);
  return { ctx, page };
};

const signIn = async (page, email) => {
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(900);
  await page.type("input[type=email]", email);
  await page.type("input[type=password]", "correct horse battery");
  await page.click(".login-btn");
  await wait(6500);
};
const goTab = async (page, label) => {
  await page.evaluate((l) => [...document.querySelectorAll("nav button")]
    .find((b) => new RegExp(`^${l}`, "i").test(b.innerText.trim()))?.click(), label);
  await wait(2200);
};

try {
  console.log("\n-- the clock really is pinned --");
  {
    const { ctx, page } = await eveningPage();
    await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
    await wait(1200);
    const clock = await page.evaluate(() => {
      const d = new Date();
      return { iso: d.toISOString(), localDate: d.getDate(), localHour: d.getHours(),
        utcDate: d.getUTCDate() };
    });
    // Without this the rest of the file would pass on any clock, which is
    // exactly how this bug survived: at ten in the morning there is nothing
    // wrong with the old code.
    ck("the page thinks it is the evening of the 22nd", clock.localDate === 22 && clock.localHour === 18,
      `${clock.localHour}:xx on the ${clock.localDate}`);
    ck("while UTC has already rolled to the 23rd", clock.utcDate === 23, clock.iso);
    await ctx.close();
  }

  console.log("\n-- the hiring account's grid --");
  {
    const { ctx, page } = await eveningPage();
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(e.message));
    await signIn(page, "pm@example.test");
    await goTab(page, "Availability");
    const grid = await page.evaluate(() => {
      const heads = [...document.querySelectorAll(".cal-dayhead")].map((h) => ({
        day: h.getAttribute("data-day"), shown: h.querySelector(".dom")?.textContent.trim(),
      }));
      const cells = [...document.querySelectorAll(".cal-cell")].map((c) => c.getAttribute("data-day"));
      return { heads, first: cells[0], cellCount: cells.length,
        distinct: [...new Set(cells)].length };
    });
    ck("the grid drew", grid.heads.length === 14 && grid.cellCount > 0,
      `${grid.heads.length} heads, ${grid.cellCount} cells`);
    // The invariant, on the column headings.
    ck("every column's key is the date printed on it",
      grid.heads.every((h) => h.day && h.day.slice(8) === String(h.shown).padStart(2, "0")),
      grid.heads.filter((h) => h.day?.slice(8) !== String(h.shown).padStart(2, "0"))
        .map((h) => `${h.shown} → ${h.day}`).join(", ") || "all agree");
    // And it starts on the day the person is actually in.
    ck("and the first column is today, locally", grid.heads[0]?.day === LOCAL_DAY, grid.heads[0]?.day);
    ck("fourteen distinct days, no repeats", grid.distinct === 14, `${grid.distinct}`);
    ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }

  console.log("\n-- the contractor's own calendar, which is what writes --");
  {
    const { ctx, page } = await eveningPage();
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(e.message));
    await signIn(page, "ana@rainier.test");
    // Job Settings in the left nav, then the Availability tab inside it.
    await page.evaluate(() => [...document.querySelectorAll("nav button")]
      .find((b) => /^Job Settings/i.test(b.innerText.trim()))?.click());
    await wait(1800);
    await page.evaluate(() => [...document.querySelectorAll(".seg-tabs button")]
      .find((b) => /^Availability$/i.test(b.innerText.trim()))?.click());
    await wait(2500);
    const cal = await page.evaluate(() => {
      const days = [...document.querySelectorAll(".mc-day")].map((b) => ({
        day: b.getAttribute("data-day"), shown: b.querySelector(".mc-num")?.textContent.trim(),
        disabled: b.disabled,
      }));
      return { days, first: days[0] };
    });
    ck("the calendar drew", cal.days.length === 28, `${cal.days.length} days`);
    ck("every square's key is the date printed on it",
      cal.days.every((d) => d.day && d.day.slice(8) === String(d.shown).padStart(2, "0")),
      cal.days.filter((d) => d.day?.slice(8) !== String(d.shown).padStart(2, "0"))
        .map((d) => `${d.shown} → ${d.day}`).join(", ") || "all agree");
    ck("and it starts on today, locally", cal.first?.day === LOCAL_DAY, cal.first?.day);

    // The round trip. Marking a day off has to store the day that was
    // tapped -- this is the one that left contractors bookable on days they
    // had blocked, and no screen would ever have shown them why.
    const target = cal.days.find((d) => !d.disabled && d.day > LOCAL_DAY);
    ck("there is a free day to mark off", !!target, JSON.stringify(target));
    const crewName = await page.evaluate(() =>
      document.querySelector(".portal-panel .picks .on, .portal-panel select")?.textContent?.trim() || null);
    await page.evaluate((day) => document.querySelector(`.mc-day[data-day="${day}"]`)?.click(), target.day);
    await wait(2000);
    const marked = await page.evaluate((day) => {
      const b = document.querySelector(`.mc-day[data-day="${day}"]`);
      return { off: b?.classList.contains("off"), shown: b?.querySelector(".mc-num")?.textContent.trim() };
    }, target.day);
    ck("the square that was tapped is the square that went off",
      marked.off === true && marked.shown === String(Number(target.day.slice(8))), JSON.stringify(marked));

    // And what the database now holds, read back from outside the browser
    // where no clock is being faked.
    const after = await (await fetch(`${API}/subs`, { headers: H })).json();
    const me = after.find((s) => s.id === mine.id) || after.find((s) => (s.crews || []).length);
    const allOff = (me?.crews || []).flatMap((c) => c.unavailableDays || []);
    // Compared against the NUMBER ON THE SQUARE, not against the key that
    // was read off it. Key-to-store agrees even when both are a day out --
    // that is precisely what the old code did -- so the only honest end of
    // this round trip is the digit the contractor's thumb was over.
    ck("the stored day is the day printed on the square",
      allOff.some((d) => d.slice(8) === String(target.shown).padStart(2, "0")),
      `${JSON.stringify(allOff)} for a square reading ${target.shown}${crewName ? ` (${crewName})` : ""}`);
    ck("and that is the key it used", allOff.includes(target.day),
      `${JSON.stringify(allOff)} should hold ${target.day}`);
    // The specific old failure: one day later than the one tapped.
    const nextDay = new Date(Date.UTC(...target.day.split("-").map((n, i) => i === 1 ? Number(n) - 1 : Number(n))) + 86400000)
      .toISOString().slice(0, 10);
    ck("and not the day after it", !allOff.includes(nextDay), `${nextDay} is in ${JSON.stringify(allOff)}`);

    // Tapping again frees it, which only works if the key round-trips.
    await page.evaluate((day) => document.querySelector(`.mc-day[data-day="${day}"]`)?.click(), target.day);
    await wait(2000);
    const after2 = await (await fetch(`${API}/subs`, { headers: H })).json();
    const me2 = after2.find((s) => s.id === mine.id) || after2.find((s) => (s.crews || []).length);
    ck("and tapping it again frees the same day",
      !(me2?.crews || []).flatMap((c) => c.unavailableDays || []).includes(target.day),
      JSON.stringify((me2?.crews || []).flatMap((c) => c.unavailableDays || [])));
    ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }

  console.log("\n-- and it is still right in the morning --");
  {
    // The fix must not trade an evening bug for a morning one. Ten o'clock
    // in London: local and UTC agree, which is the case the old code got
    // right and the new one must not break.
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.emulateTimezone("Europe/London");
    await page.evaluateOnNewDocument((ms) => {
      const Real = Date;
      class Pinned extends Real {
        constructor(...args) { if (args.length === 0) super(ms); else super(...args); }
        static now() { return ms; }
      }
      Pinned.parse = Real.parse; Pinned.UTC = Real.UTC;
      window.Date = Pinned;
    }, Date.UTC(2026, 8, 22, 9, 15, 0));
    await signIn(page, "pm@example.test");
    await goTab(page, "Availability");
    const heads = await page.evaluate(() => [...document.querySelectorAll(".cal-dayhead")]
      .map((h) => ({ day: h.getAttribute("data-day"), shown: h.querySelector(".dom")?.textContent.trim() })));
    ck("the columns still agree with themselves",
      heads.length === 14 && heads.every((h) => h.day?.slice(8) === String(h.shown).padStart(2, "0")),
      heads.slice(0, 3).map((h) => `${h.shown}→${h.day}`).join(", "));
    ck("and it starts on the 22nd there too", heads[0]?.day === LOCAL_DAY, heads[0]?.day);
    await ctx.close();
  }
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
} finally {
  await browser.close();
  await restore();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
