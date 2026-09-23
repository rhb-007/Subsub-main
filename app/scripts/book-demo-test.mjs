// "You're booked" must mean somebody is booked.
//
// The page said it unconditionally. A month grid, a slot picker, a two-step
// form, a confirmation reading "We've sent a calendar invite to
// you@company.com" -- and a submit handler that swapped two divs and
// stopped. No request, no form action, not even a mailto. Everybody who
// used it went away believing a meeting existed, and none did.
//
// So the assertions are arranged around one rule: the confirmation appears
// if and only if a booking was created. Every failure has to keep the form
// on screen and say what happened, because the alternative is the bug that
// was there.
//
// The times are real too. It used to offer the same eight hours on every
// weekday whether or not anyone was free, so half of what it promised could
// not have been kept.
//
//   node scripts/book-demo-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const SITE = process.env.SITE_PORT || "5193";
const API = process.env.API_BASE || "http://127.0.0.1:8787/api";
const CAL = process.env.CAL_STUB || "http://127.0.0.1:8906";
// A second Worker, started with no CAL_API_KEY: the state this ships in.
const UNCONFIGURED = process.env.UNCONFIGURED_API || "http://127.0.0.1:8788/api";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await fetch(`${CAL}/__reset`);
// Both endpoints are rate limited per address, which is right for a public
// form and makes this file stateful across runs: the sixth run would fail
// on the limit rather than on anything it is testing. Clear this test's own
// buckets, and only those.
execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db", "--config=./wrangler.toml", "--local",
  "--command", "DELETE FROM rate_limits WHERE bucket LIKE 'demo-%';"], { stdio: ["ignore", "pipe", "pipe"] });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});

// The page reads window.SUBSUB_API if something set it first, which is how
// the real deployment points at its own API and how this points at a local
// one. Nothing is patched inside the page itself.
async function openPage(apiBase = API) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1200, height: 1500 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.evaluateOnNewDocument((b) => { window.SUBSUB_API = b; }, apiBase);
  await page.goto(`http://127.0.0.1:${SITE}/book-a-demo.html`, { waitUntil: "domcontentloaded" });
  await wait(2500);
  return { ctx, page, crashes };
}

const days = (page) => page.evaluate(() => [...document.querySelectorAll(".cal-day")]
  .map((b) => ({ n: b.textContent.trim(), on: !b.disabled })));
const note = (page) => page.evaluate(() => document.getElementById("pickNote")?.textContent.trim() || "");
const slots = (page) => page.evaluate(() => [...document.querySelectorAll(".slot")]
  .map((b) => ({ label: b.textContent.trim(), start: b.getAttribute("data-start") })));
const done = (page) => page.evaluate(() => ({
  on: document.getElementById("done")?.classList.contains("on") || false,
  text: document.getElementById("doneWhen")?.textContent.trim() || "",
  formGone: document.getElementById("demoForm")?.classList.contains("hide") || false,
  err: document.getElementById("bookErr")?.textContent.trim() || "",
}));

const fill = async (page, email) => {
  await page.type("#name", "Dana Whitfield");
  await page.type("#company", "Cascade Exteriors");
  await page.type("#email", email);
  await page.type("#phone", "206-555-0100");
};

try {
  console.log("\n-- the times on the page are the times in the calendar --");
  {
    const { ctx, page, crashes } = await openPage();
    const d = await days(page);
    ck("some days are open", d.some((x) => x.on), JSON.stringify(d.slice(0, 8)));
    ck("and some are not, which is the point", d.some((x) => !x.on));
    // Weekends are closed in the stub, so a page showing every weekday open
    // would mean it is still inventing them.
    ck("it is not offering every day regardless",
      d.filter((x) => x.on).length < d.length - 2, `${d.filter((x) => x.on).length} of ${d.length}`);

    await page.evaluate(() => [...document.querySelectorAll(".cal-day")].find((b) => !b.disabled).click());
    await wait(700);
    const s = await slots(page);
    ck("picking a day shows its times", s.length > 0, JSON.stringify(s.slice(0, 3)));
    ck("each carries the exact instant, not a label to re-parse",
      s.every((x) => /^\d{4}-\d{2}-\d{2}T/.test(x.start || "")), JSON.stringify(s[0]));
    ck("and the times are named in a zone", /in [A-Z]/.test(await note(page)), await note(page));
    ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- booking one actually books it --");
  let bookedStart = "";
  {
    const { ctx, page } = await openPage();
    await page.evaluate(() => [...document.querySelectorAll(".cal-day")].find((b) => !b.disabled).click());
    await wait(700);
    bookedStart = (await slots(page))[0].start;
    await page.evaluate(() => document.querySelector(".slot").click());
    await wait(900);
    await fill(page, "dana@cascadeexteriors.test");
    await page.click("#stepDetails button[type=submit]");
    await wait(3000);

    const d = await done(page);
    ck("the confirmation is shown", d.on === true, JSON.stringify(d).slice(0, 160));
    ck("and the form is put away", d.formGone === true);
    ck("it names the address the invite went to", /dana@cascadeexteriors\.test/.test(d.text), d.text);

    // The half that used to be missing entirely.
    const made = await (await fetch(`${CAL}/__booked`)).json();
    ck("a booking exists at the other end", made.length === 1, `${made.length} bookings`);
    ck("for the instant that was picked", made[0]?.start === bookedStart, `${made[0]?.start} vs ${bookedStart}`);
    ck("with the attendee on it", made[0]?.attendee?.email === "dana@cascadeexteriors.test",
      JSON.stringify(made[0]?.attendee));
    // Whoever takes the call should not have to go and find these.
    ck("and what the form asked for travels with it",
      made[0]?.metadata?.company === "Cascade Exteriors" && made[0]?.metadata?.phone === "206-555-0100",
      JSON.stringify(made[0]?.metadata));
    await ctx.close();
  }

  console.log("\n-- when it cannot be booked, nobody is told it was --");
  {
    // The slot goes while the form is being filled in.
    const { ctx, page } = await openPage();
    await page.evaluate(() => [...document.querySelectorAll(".cal-day")].find((b) => !b.disabled).click());
    await wait(700);
    const s = (await slots(page))[0].start;
    await page.evaluate(() => document.querySelector(".slot").click());
    await wait(900);
    await fill(page, "late@example.test");
    await fetch(`${CAL}/__take?start=${encodeURIComponent(s)}`);
    await page.click("#stepDetails button[type=submit]");
    await wait(3000);
    const d = await done(page);
    ck("no confirmation", d.on === false);
    ck("the form is still there", d.formGone === false);
    ck("and it says the time went, not 'try again'",
      /taken while you were filling this in/i.test(d.err), d.err);
    await ctx.close();
  }
  {
    // The API cannot be reached at all -- a wrong hostname, or it is down.
    const { ctx, page } = await openPage("http://127.0.0.1:9/api");
    ck("the page says it could not load times",
      /couldn.t load available times/i.test(await note(page)), await note(page));
    ck("rather than showing hours nobody can keep",
      (await days(page)).every((x) => !x.on), "");
    await ctx.close();
  }
  {
    const bad = await fetch(`${API}/demo/slots?start=next%20tuesday&end=whenever&timeZone=UTC`);
    ck("a range that is not a range is refused", bad.status === 400, `HTTP ${bad.status}`);
    const ok = await fetch(`${API}/demo/slots?start=2026-10-01&end=2026-10-02&timeZone=UTC`);
    const body = await ok.json();
    ck("and a real one answers only the days it was asked about",
      Object.keys(body.slots || {}).every((d) => d >= "2026-10-01" && d <= "2026-10-02"),
      Object.keys(body.slots || {}).join(", "));
  }

  console.log("\n-- and when nobody has switched it on --");
  {
    // The state this ships in, against a Worker with no Cal key at all.
    // It must not look like "no times available": that is the same lie as
    // before in a quieter voice, and it would send somebody away thinking
    // SubSub has no availability for six weeks.
    const r = await fetch(`${UNCONFIGURED}/demo/slots?start=2026-10-01&end=2026-10-31&timeZone=UTC`);
    ck("the API says so plainly", r.status === 503, `HTTP ${r.status}`);
    ck("and names the reason", (await r.json()).error === "not_configured");

    const { ctx, page, crashes } = await openPage(UNCONFIGURED);
    const n = await note(page);
    ck("the page says booking is not switched on yet", /isn.t switched on yet/i.test(n), n);
    ck("and offers a human instead", /hello@subsub\.work/.test(n), n);
    ck("no day is offered", (await days(page)).every((x) => !x.on));
    ck("and no confirmation can be reached", (await done(page)).on === false);
    ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the server is the one that decides --");
  {
    // A booking request that skips the page entirely still has to be sane:
    // this endpoint is public, so it is the last line rather than the first.
    const bad = async (body) => (await fetch(`${API}/demo/book`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status;
    ck("no name is refused", await bad({ email: "a@b.co", start: "2026-10-01T15:00:00.000Z" }) === 400);
    ck("a bad address is refused", await bad({ name: "A", email: "nope", start: "2026-10-01T15:00:00.000Z" }) === 400);
    ck("a day with no time is refused", await bad({ name: "A", email: "a@b.co", start: "2026-10-01" }) === 400);
  }
  console.log("\n-- the limit is real, and is the last thing tested --");
  {
    // Deliberately spent here, at the end, because everything above shares
    // the same bucket.
    const hit = async () => (await fetch(`${API}/demo/book`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({}) })).status;
    let sawLimit = false;
    for (let i = 0; i < 20 && !sawLimit; i++) if (await hit() === 429) sawLimit = true;
    ck("a script gets turned away eventually", sawLimit);
  }
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
