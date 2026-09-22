// Icons in buttons, sitting where the words are.
//
// Two separate causes, both found by measuring rather than by squinting.
//
// The empty-state rules were written as descendant selectors -- `.empty svg`
// and `.dash-empty svg` -- so the decorative glyph's 8 to 12 pixels of
// bottom margin and half opacity also landed on the icon inside the button
// underneath. In a centred flex row half that margin lifts the icon, so the
// + on "New job" rode four pixels high and came out faded.
//
// And a ghost button was never a flex row at all, so its icon sat on the
// text baseline rather than beside it -- about three pixels high on every
// one that had an icon: Decline, All jobs, Withdraw, Cancel.
//
// Asserted as a measurement across the screens these buttons actually live
// on, because the next version of this will be a pixel or two and nobody
// will see it in review.
//
//   node scripts/button-align-test.mjs

import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

// Every button that pairs an icon with a word, and how far the icon's centre
// sits from the word's. Also whether the icon is wearing an opacity meant
// for something else.
const probe = () => {
  const out = [];
  for (const btn of document.querySelectorAll("button")) {
    const svg = btn.querySelector("svg");
    if (!svg) continue;
    const t = [...btn.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!t) continue;
    const r = document.createRange(); r.selectNodeContents(t);
    const tr = r.getBoundingClientRect(), sr = svg.getBoundingClientRect();
    if (!tr.height || !sr.height) continue;
    out.push({
      label: btn.textContent.trim().slice(0, 24),
      cls: btn.className,
      off: Math.round(((sr.top + sr.bottom) / 2 - (tr.top + tr.bottom) / 2) * 10) / 10,
      faded: Number(getComputedStyle(svg).opacity) < 1,
    });
  }
  return out;
};

const login = async (page, email) => {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle0" });
  await wait(1200);
  const pw = await page.$("input[type=password]");
  if (!pw) return;
  await (await page.$("input[type=email]")).type(email);
  await pw.type("x");
  await page.click(".login-btn");
  await wait(3000);
};

const screens = [
  ["the manager's dashboard", async (p) => login(p, "admin@example.test")],
  ["the jobs list", async (p) => { await login(p, "admin@example.test");
    await p.evaluate(() => [...document.querySelectorAll("button,a")].find((e) => /^Jobs/.test(e.textContent.trim()))?.click()); await wait(1500); }],
  ["the assign screen", async (p) => { await login(p, "admin@example.test");
    await p.evaluate(() => [...document.querySelectorAll("button,a")].find((e) => /^Jobs/.test(e.textContent.trim()))?.click()); await wait(1500);
    await p.evaluate(() => document.querySelector(".trade-assign")?.click()); await wait(1200); }],
  ["the new-job form", async (p) => { await login(p, "admin@example.test");
    await p.evaluate(() => [...document.querySelectorAll("button")].find((e) => /New job/.test(e.textContent))?.click()); await wait(1200); }],
  ["a branded sign-in", async (p) => { await p.goto(`http://cascademanagement.subsub.work:${PORT}/`, { waitUntil: "networkidle0" }); await wait(1500); }],
  ["the application form", async (p) => { await p.goto(`http://cascademanagement.subsub.work:${PORT}/?apply=1`, { waitUntil: "networkidle0" }); await wait(1500); }],
];

try {
  let seen = 0;
  for (const [label, go] of screens) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 1000 });
    await go(page);
    const rows = await page.evaluate(probe);
    seen += rows.length;
    const high = rows.filter((r) => Math.abs(r.off) >= 1);
    const dim = rows.filter((r) => r.faded);
    ck(`on ${label}, every icon sits with its word`, high.length === 0,
      high.map((r) => `${r.label} [${r.cls}] ${r.off}px`).join(" ; ") || `${rows.length} checked`);
    ck(`and none of them is faded by a rule meant for something else`, dim.length === 0,
      dim.map((r) => `${r.label} [${r.cls}]`).join(" ; "));
    await page.close();
  }
  // If a selector change ever emptied this out, the checks above would all
  // pass on nothing at all.
  ck("and there were buttons to check in the first place", seen >= 10, `${seen} icon buttons`);

  console.log("\n-- the word on the request row --");
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1000 });
  await login(page, "admin@example.test");
  const dash = await page.evaluate(() => document.body.innerText);
  ck("nothing says 'Not approving' any more", !/not approving/i.test(dash));
  await page.close();
} catch (err) {
  fail++;
  console.log("FAIL  the run itself  --", err.message);
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
