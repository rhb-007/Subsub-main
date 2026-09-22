// A white screen must never be the whole message.
//
// This app has shipped one twice. Both times the page was blank, the cause
// was found by hand, and the person who hit it was told nothing: not what
// broke, not whether it was their fault, not what to try. The second time,
// the only description available was "it's blank", which fits every possible
// cause equally well and narrows nothing.
//
// There are two ways to end up with an empty page and they need different
// nets:
//
//   a render throws -- React unmounts the entire tree, so one bad value in
//   one row empties the whole window. The boundary in src/main.tsx catches
//   that.
//
//   the app never starts -- a script that 404s or throws while it is still
//   being evaluated leaves React nothing to mount. A boundary cannot catch
//   that, because the boundary is in the file that did not run. The inline
//   script in index.html is the net for it.
//
// Both are asserted here, and so is the thing that matters most: that
// neither of them appears on a page that is working.
//
//   node scripts/whitescreen-test.mjs

import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";
const HOST = "app.subsub.work";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

// Each one gets its own context: the Supabase session lives in localStorage,
// and a page that opens already signed in is not the page being tested.
async function open({ before, killBundle, signIn, settle = 4000 }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1000, height: 1300 });
  if (before) await page.evaluateOnNewDocument(before);
  if (killBundle) {
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      try {
        if (/\/assets\/index-.*\.js$/.test(new URL(r.url()).pathname)) return r.abort();
      } catch { /* fall through */ }
      r.continue().catch(() => {});
    });
  }
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
  if (signIn) {
    await page.waitForSelector("input[type=password]", { timeout: 15000 });
    await wait(1200);
    await page.type("input[type=email]", "pm@example.test");
    await page.type("input[type=password]", "correct horse battery");
    await page.waitForSelector(".login-btn", { timeout: 15000 });
    await page.click(".login-btn");
  }
  await wait(settle);
  const out = await page.evaluate(() => ({
    text: document.body.innerText.trim(),
    kids: document.getElementById("root")?.childElementCount ?? -1,
  }));
  await page.close();
  await ctx.close();
  return out;
}

try {
  console.log("\n-- a working page is left completely alone --");
  const ok = await open({ signIn: true, settle: 7000 });
  ck("it signs in", /Good to see you/.test(ok.text), ok.text.slice(0, 80));
  ck("no crash notice", !/hit a problem/i.test(ok.text));
  ck("no start-up notice", !/could not start/i.test(ok.text));

  console.log("\n-- a render that throws says so instead of emptying the page --");
  // Dates are formatted in the middle of rendering a job row, so this throws
  // where a real bad value would: inside React's render, after mount.
  const crashed = await open({
    before: () => { Date.prototype.toLocaleDateString = function () { throw new Error("ZZ render blew up"); }; },
    signIn: true, settle: 8000,
  });
  ck("the page is not blank", crashed.kids > 0 && crashed.text.length > 40, `${crashed.kids} children, ${crashed.text.length} chars`);
  ck("it says what happened, in plain words", /hit a problem and stopped/i.test(crashed.text), crashed.text.slice(0, 90));
  ck("and shows the error itself", /ZZ render blew up/.test(crashed.text), crashed.text.slice(0, 200));
  ck("it says it was not their fault", /nothing you did/i.test(crashed.text));
  ck("there is a way out", /Reload the page/.test(crashed.text) && /Sign out and start over/.test(crashed.text));

  console.log("\n-- an app that never starts says that instead --");
  // The bundle is refused outright, which is what a half-finished deploy or
  // a bad cache looks like from the browser. The boundary cannot catch this;
  // it is in the file that did not load.
  const dead = await open({ killBundle: true, settle: 14000 });
  ck("the page is not blank", dead.kids > 0 && dead.text.length > 40, `${dead.kids} children, ${dead.text.length} chars`);
  ck("it says the app did not start", /could not start/i.test(dead.text), dead.text.slice(0, 90));
  ck("and names the file that did not load", /Could not load index-.*\.js/.test(dead.text), dead.text.slice(0, 220));
  ck("with a way to try again", /Reload the page/.test(dead.text));
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
