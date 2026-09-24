// The stylesheet is a JavaScript template literal, and that has a trap in it.
//
// A backtick anywhere inside ends the literal. The build does not complain --
// it produces a working bundle, the app runs, every other rule applies -- and
// the only symptom is that one rule is quietly missing from the stylesheet.
// It cost a round of "why is this paragraph still 16px" to find, with the
// rule visibly present in the source and visibly present in the built file,
// and absent from the browser's own CSSOM.
//
// Two guards, because the first one alone would not have caught it in the
// form it arrived in: no backticks in the block at all, and every class the
// file actually styles is a class the browser ends up with.
//
//   node scripts/css-block-test.mjs

import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";
const HOST = "app.subsub.work";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const src = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8").split("\n");
const start = src.findIndex((l) => l === "const CSS = `");
const end = src.findIndex((l, i) => i > start && l === "`;");

console.log("\n-- the block itself --");
ck("the stylesheet block is where it is expected", start > 0 && end > start, `${start + 1}..${end + 1}`);
const block = src.slice(start + 1, end);
const offenders = block
  .map((l, i) => (l.includes("`") ? `line ${start + 2 + i}: ${l.trim().slice(0, 60)}` : null))
  .filter(Boolean);
ck("no backticks anywhere in it", offenders.length === 0, offenders.join(" | "));

// Every selector the file defines, so the count can be compared against what
// the browser accepted. A rule swallowed by a broken comment shows up here
// as a difference rather than as a mystery three weeks later.
const defined = new Set();
for (const line of block) {
  const m = line.match(/^([.#][A-Za-z][\w-]*)/);
  if (m) defined.add(m[1]);
}
ck("it defines a plausible number of classes", defined.size > 300, `${defined.size}`);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});
try {
  console.log("\n-- and what the browser ended up with --");
  const page = await browser.newPage();
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("style", { timeout: 15000 });

  await wait(1500);
  const live = await page.evaluate(() => {
    const sheet = document.querySelector("style")?.sheet;
    if (!sheet) return null;
    const out = new Set();
    const walk = (rules) => {
      for (const r of rules) {
        if (r.selectorText) r.selectorText.split(",").forEach((s) => {
          const m = s.trim().match(/^([.#][A-Za-z][\w-]*)/);
          if (m) out.add(m[1]);
        });
        if (r.cssRules) walk(r.cssRules);
      }
    };
    walk(sheet.cssRules);
    return [...out];
  });
  ck("the stylesheet parsed", Array.isArray(live) && live.length > 0, `${live?.length} selectors`);

  const missing = [...defined].filter((c) => !live.includes(c));
  // This is the assertion that would have caught it: the rule was in the
  // source and in the bundle, and not in the browser.
  ck("every class the file styles reached the browser", missing.length === 0,
    missing.slice(0, 8).join(", "));
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
