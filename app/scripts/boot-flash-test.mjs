// What is on screen between the page loading and the app knowing who you are.
//
// Two bugs were reported as separate things and were one thing:
//
//   "every time I leave outerhome.subsub.work it logs me out and I have to
//    login every time I return"
//   "going to a subdomain flashes the SubSub logo / login before redirecting
//    to the proper one"
//
// loggedIn starts false and resumeSession() is a round trip, so the first
// paint was the sign-in screen -- under SubSub's own branding, because the
// account behind the subdomain is a second round trip. Someone coming back
// to a tab was handed a working sign-in form by a browser that was still
// signed in, and signed in again. It was never a session that expired.
//
// So this measures the frames, not the end state: an observer installed
// before any of the app's own code runs records every distinct thing the
// page shows, and the test reads the record back afterwards. Polling would
// miss a flash by definition -- the whole complaint is about something that
// is gone by the time you look.
//
// Self-contained: it builds the app against stub hostnames, serves it, and
// answers the two API calls itself with a deliberate delay. No worker, no
// database, no Supabase.
//
//   node scripts/boot-flash-test.mjs

import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = fileURLToPath(new URL(".", import.meta.url));
const app = join(here, "..");
const OUT = join(app, "dist-boot-test");
const WEB = 5194, API = 8908;
// Long enough that a flash would be unmissable on screen. Real networks on a
// phone are worse than this.
const DELAY = 600;

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a build that thinks it is in production --------------------------
console.log("\n-- building against stub hostnames --");
execSync(`npx vite build --outDir ${OUT} --emptyOutDir`, {
  cwd: app, stdio: "pipe",
  env: { ...process.env,
    VITE_API_BASE: `http://127.0.0.1:${API}/api`,
    VITE_SUPABASE_URL: "http://127.0.0.1:8907",
    VITE_SUPABASE_ANON_KEY: "stub-anon-key" },
});
const bundle = readFileSync(join(OUT, "index.html"), "utf8");
ck("the build produced a page", bundle.includes("<div id=\"root\""), bundle.slice(0, 80));

const ACCOUNT = {
  id: "acc_outer", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "usr_richard", name: "Richard Braun", email: "richard@example.test", role: "admin" },
};

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

const web = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  let file = join(OUT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  if (!existsSync(file) || path === "/") file = join(OUT, "index.html");
  res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(WEB);

const cors = { "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*", "Content-Type": "application/json" };
let apiCalls = [];
const api = createServer(async (req, res) => {
  const path = req.url.split("?")[0];
  apiCalls.push(path);
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  await wait(DELAY);
  const send = (code, body) => { res.writeHead(code, cors); res.end(JSON.stringify(body)); };
  if (path.startsWith("/api/account-by-subdomain/")) return send(200, ACCOUNT);
  if (path === "/api/account") return send(200, ACCOUNT);
  if (path === "/api/auth/me") return send(200, { user: ACCOUNT.user, memberships: [] });
  return send(200, []);
}).listen(API);

// Everything the app shows before it settles, recorded as it happens.
const RECORDER = () => {
  window.__frames = [];
  const look = () => {
    const root = document.getElementById("root");
    if (!root) return;
    const text = (root.innerText || "").replace(/\s+/g, " ").trim();
    const f = {
      splash: !!root.querySelector(".boot-wait"),
      password: !!root.querySelector("input[type=password]"),
      subsubBrand: /SubSub/i.test(text) && !/Powered by/i.test(text.replace(/SubSub/gi, "")),
      saysSubSub: /\bSubSub\b/.test(text),
      saysOuterhome: /\bOuterhome\b/.test(text),
      text: text.slice(0, 120),
    };
    const last = window.__frames[window.__frames.length - 1];
    const key = (x) => x && `${x.splash}|${x.password}|${x.saysSubSub}|${x.saysOuterhome}|${x.text}`;
    if (key(f) !== key(last)) window.__frames.push(f);
  };
  // document, not documentElement: this runs before the parser has made one,
  // and observe() throws on undefined.
  new MutationObserver(look).observe(document,
    { childList: true, subtree: true, characterData: true });
  look();
  document.addEventListener("DOMContentLoaded", look);
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

const visit = async (seed) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 900, height: 1000 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.evaluateOnNewDocument(RECORDER);
  if (seed) {
    // Storage has to exist before the bundle runs, so put it there on a
    // blank page of the same origin and then load the app for real.
    await page.goto(`http://outerhome.subsub.work:${WEB}/favicon.ico`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.evaluate((s) => {
      localStorage.setItem("subsub.auth", JSON.stringify({ userId: "usr_richard", accountId: "acc_outer" }));
      localStorage.setItem("sb-stub-auth-token", JSON.stringify(s));
    }, { access_token: "stub", refresh_token: "stub", token_type: "bearer",
         expires_at: Math.floor(Date.now() / 1000) + 3600,
         user: { id: "usr_richard", email: "richard@example.test" } });
  }
  await page.goto(`http://outerhome.subsub.work:${WEB}/`, { waitUntil: "domcontentloaded" });
  await wait(DELAY * 4 + 1500);
  const frames = await page.evaluate(() => window.__frames);
  return { ctx, page, frames, crashes };
};

try {
  // ---- coming back with a session ------------------------------------
  console.log("\n-- coming back to the tab already signed in --");
  {
    apiCalls = [];
    const { ctx, frames, crashes } = await visit(true);
    const shown = frames.map((f) => f.text).filter(Boolean);
    ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    ck("a sign-in form was never offered",
      !frames.some((f) => f.password), JSON.stringify(shown.slice(0, 4)));
    ck("and SubSub's own name was never put on the page",
      !frames.some((f) => f.saysSubSub && !f.saysOuterhome),
      JSON.stringify(frames.filter((f) => f.saysSubSub).map((f) => f.text)));
    ck("the wait was shown instead", frames.some((f) => f.splash), JSON.stringify(shown.slice(0, 4)));
    ck("and it ended on the account, not the splash",
      !frames[frames.length - 1].splash && frames[frames.length - 1].saysOuterhome,
      JSON.stringify(frames[frames.length - 1]));
    ck("the account was actually asked for", apiCalls.includes("/api/account"), apiCalls.join(" "));
    await ctx.close();
  }

  // ---- arriving signed out -------------------------------------------
  console.log("\n-- arriving on the address signed out --");
  {
    apiCalls = [];
    const { ctx, frames, crashes } = await visit(false);
    ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    ck("the wrong company's name never appeared",
      !frames.some((f) => f.saysSubSub && !f.saysOuterhome),
      JSON.stringify(frames.filter((f) => f.saysSubSub).map((f) => f.text)));
    const first = frames.find((f) => f.password);
    ck("a sign-in form was eventually offered", !!first, JSON.stringify(frames.map((f) => f.text)));
    ck("and the first one already wore the account's name",
      !!first && first.saysOuterhome, JSON.stringify(first));
    ck("the brand was asked for before anything was drawn",
      apiCalls.some((p) => p.startsWith("/api/account-by-subdomain/")), apiCalls.join(" "));
    // Nobody's seat is stored, so there is nothing to resume and no reason
    // to have called for one.
    ck("and no account was fetched for a session that does not exist",
      !apiCalls.includes("/api/account"), apiCalls.join(" "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
