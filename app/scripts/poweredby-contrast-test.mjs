// "Powered by SubSub" on a background we do not own.
//
// It sits on the page, not on the card, so it cannot take the customer's
// text colour -- Outerhome's page is black, its card white, its text dark,
// and the footer vanished. The rule is binary on purpose: white or black,
// whichever measures better against their background, and the mark goes
// monochrome with it. A brand orange is worth nothing on a page that might
// make it invisible, and a muted white is just grey.
//
// This reads the colours the browser actually painted, on real branded
// hosts, rather than trusting the stylesheet to have meant it.
//
//   node scripts/poweredby-contrast-test.mjs

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const PORT = process.env.APP_PORT || "5191";
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (cmd) => execFileSync("npx", ["wrangler", "d1", "execute", "subsub-db",
  "--config=./wrangler.toml", "--local", "--command", cmd], { stdio: ["ignore", "ignore", "ignore"] });

const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const isWhite = (c) => c[0] === 255 && c[1] === 255 && c[2] === 255;
const isBlack = (c) => c[0] === 0 && c[1] === 0 && c[2] === 0;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  // So a branded hostname reaches the local static server.
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

// What the browser actually painted for the footer lockup.
const measure = async (page) => page.evaluate(() => {
  const a = document.querySelector(".powered-by");
  if (!a) return null;
  const cs = getComputedStyle(a);
  // What is actually painted behind it: the nearest ancestor that paints at
  // all. Reading document.body instead gives the app's default paper colour
  // on a themed page, and quietly compares the footer against a colour no
  // one can see.
  let host = a.parentElement, background = null, on = null;
  while (host) {
    const c = getComputedStyle(host).backgroundColor;
    if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { background = c; on = host.className; break; }
    host = host.parentElement;
  }
  const svg = a.querySelector("svg");
  return {
    text: cs.color,
    opacity: Number(cs.opacity),
    background, paintedBy: String(on || ""),
    paths: [...(svg?.querySelectorAll("path") || [])].map((p) => getComputedStyle(p).fill),
    pathCount: svg?.querySelectorAll("path").length || 0,
  };
});

const check = async (label, sub, expect, path = "/") => {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1000 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://${sub}.subsub.work:${PORT}${path}`, { waitUntil: "networkidle0" });
  await wait(2200);
  const m = await measure(page);
  console.log(`\n-- ${label} --`);
  if (!m) { ck("the footer is on the page at all", false, "no .powered-by found"); await page.close(); return; }
  const fg = rgb(m.text), bg = rgb(m.background);
  ck("the page background is the customer's", `rgb(${bg.join(", ")})` === expect.bg, `${m.background} from .${m.paintedBy}`);
  ck(`the wording is ${expect.name}`, expect.name === "white" ? isWhite(fg) : isBlack(fg), m.text);
  ck("at full strength, not a muted grey", m.opacity === 1, String(m.opacity));
  ck("the whole lockup matches it, mark included",
    m.pathCount > 0 && m.paths.every((f) => rgb(f).join() === fg.join()),
    [...new Set(m.paths)].join(" / ") || "no paths");
  ck("no orange left on a page we do not control",
    !m.paths.some((f) => /227,\s*155,\s*50/.test(f) || /e39b32/i.test(f)), [...new Set(m.paths)].join(" / "));
  const r = ratio(fg, bg);
  ck("and it clears the readable-text bar comfortably", r >= 4.5, `${r.toFixed(1)}:1`);
  ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${sub}-${label.split(" ")[1]}-${path === "/" ? "signin" : "apply"}.png` });
  await page.close();
};

const themes = {
  black: '{"bg":"#000000","surface":"#FFFFFF","text":"#12211C","accent":"#111111","btnText":"#FFFFFF"}',
  nearWhite: '{"bg":"#F4F6F4","surface":"#FFFFFF","text":"#12211C","accent":"#1F6B4A","btnText":"#FFFFFF"}',
  navy: '{"bg":"#101A2E","surface":"#FFFFFF","text":"#12211C","accent":"#2E5AAC","btnText":"#FFFFFF"}',
  mustard: '{"bg":"#F2C744","surface":"#FFFFFF","text":"#12211C","accent":"#8A6A00","btnText":"#FFFFFF"}',
};
const before = { acc_test: themes.black, acc_pm: themes.nearWhite };

try {
  await check("a black page (Outerhome, the one it vanished on)", "outerhome", { bg: "rgb(0, 0, 0)", name: "white" });
  await check("a near-white page (Cascade)", "cascademanagement", { bg: "rgb(244, 246, 244)", name: "black" });

  // The two ends are the easy cases. The rule earns its keep in between.
  // The sign-up form is the other page it was invisible on.
  sql(`UPDATE accounts SET theme = '${themes.black}' WHERE id = 'acc_test'`);
  await check("the application form on that same black page", "outerhome", { bg: "rgb(0, 0, 0)", name: "white" }, "/?apply=1");

  sql(`UPDATE accounts SET theme = '${themes.navy}' WHERE id = 'acc_test'`);
  await check("a dark navy page", "outerhome", { bg: "rgb(16, 26, 46)", name: "white" });
  sql(`UPDATE accounts SET theme = '${themes.mustard}' WHERE id = 'acc_test'`);
  await check("a bright mustard page, which is light despite being loud", "outerhome", { bg: "rgb(242, 199, 68)", name: "black" });
} finally {
  for (const [id, th] of Object.entries(before)) sql(`UPDATE accounts SET theme = '${th}' WHERE id = '${id}'`);
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
