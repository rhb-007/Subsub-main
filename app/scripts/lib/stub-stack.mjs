// A production build of the app, served, with the API answered here.
//
// Written for the tests that are about what the BROWSER does -- the first
// paint, a menu, a piece of chrome -- where standing up the worker, D1 and
// Supabase buys nothing and costs a stack that has to be running before the
// test can. These build the real bundle against stub hostnames, serve it,
// and answer its calls from a table in the test.
//
// It is not a substitute for the suites that run against the real worker.
// Anything about what the SERVER decides belongs there; this only knows
// what it is told to say.

import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function tally() {
  const t = { pass: 0, fail: 0 };
  t.ck = (n, ok, d = "") => {
    ok ? t.pass++ : t.fail++;
    console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`);
  };
  t.done = () => {
    console.log(`\n${t.pass} passed, ${t.fail} failed`);
    process.exit(t.fail ? 1 : 0);
  };
  return t;
}

// The bundle, built the way production builds it: an absolute API base on
// another origin, and Supabase configured, so the code paths under test are
// the deployed ones rather than the dev-stub ones.
// `platform: true` builds the staff console instead of the customer app --
// same source, same bundle, VITE_BUILD picks which one boots. Without it the
// console had no self-contained browser test at all: the only one that
// existed needed a hand-started local stack and the platform bundle built by
// hand first, so in practice it did not run, and a console screen could
// report a number that was structurally impossible without anybody noticing.
export function buildApp({ outDir, apiPort, platform = false }) {
  execSync(`npx vite build --outDir ${outDir} --emptyOutDir`, {
    cwd: app, stdio: "pipe",
    env: { ...process.env,
      ...(platform ? { VITE_BUILD: "platform" } : {}),
      VITE_API_BASE: `http://127.0.0.1:${apiPort}/api`,
      VITE_SUPABASE_URL: "http://127.0.0.1:8907",
      VITE_SUPABASE_ANON_KEY: "stub-anon-key" },
  });
  return join(outDir, "index.html");
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

export function serveApp({ dir, port }) {
  return createServer((req, res) => {
    const path = decodeURIComponent(req.url.split("?")[0]);
    const file = join(dir, normalize(path).replace(/^(\.\.[/\\])+/, ""));
    if (existsSync(file) && path !== "/") {
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
      return res.end(readFileSync(file));
    }
    // SPA fallback for a route, a 404 for a missing FILE. Falling back for
    // everything meant the blank page used to seed storage -- /favicon.ico,
    // which the build does not emit -- served the app and booted a whole
    // second copy of it. Every call the test counted was then doubled, and
    // an assertion about how many times something was fetched was measuring
    // the harness.
    if (extname(path)) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(readFileSync(join(dir, "index.html")));
  }).listen(port);
}

// `routes` answers a path, or returns undefined to fall through to []. The
// server records every path it was asked for, which is how a test says "and
// it did not ask twice".
export function serveApi({ port, routes, delay = 0 }) {
  const calls = [];
  const cors = { "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    // PATCH and DELETE are not CORS-safelisted, so without this header the
    // browser rejects the preflight and the app sees "Failed to fetch" --
    // never reaching the stub, which then reports no call and looks like a
    // button that does nothing. GET and POST are safelisted and worked
    // without it, which is why nothing noticed until a PATCH was tested.
    "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    "Content-Type": "application/json" };
  const server = createServer(async (req, res) => {
    const path = req.url.split("?")[0];
    // The preflight is not a call. Counting it made every cross-origin
    // request look like two, and "it was fetched once" fail against an app
    // that had fetched it once -- an hour spent looking for a double mount
    // that was never there.
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    calls.push(path);
    if (delay) await wait(delay);
    // The body too, for the routes where what was SENT is the thing being
    // checked -- a toggle that draws itself correctly and posts the opposite
    // value is the bug a UI test is there to catch, and a stub that throws
    // the body away cannot see it. Third argument, so every caller written
    // against routes(path, method) keeps working untouched.
    let sent = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const raw = await new Promise((res2) => {
        let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => res2(b));
      });
      if (raw) { try { sent = JSON.parse(raw); } catch { sent = raw; } }
    }
    const hit = routes(path, req.method, sent);
    const [status, body] = hit === undefined ? [200, []] : hit;
    res.writeHead(status, cors);
    res.end(JSON.stringify(body));
  }).listen(port);
  server.calls = calls;
  return server;
}

export const launch = () => puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

// A visit to the account's own address, with or without a seat already in
// the browser. Storage has to exist before the bundle runs, so when there is
// a seat it is written on a blank page of the same origin first.
export async function visitApp(browser, { host, webPort, seat, viewport, onNewDocument }) {
  return signedInPage(browser, { host, webPort, viewport, onNewDocument,
    userId: seat?.userId, accountId: seat?.accountId });
}

export async function signedInPage(browser, { host, webPort, userId, accountId, viewport, onNewDocument }) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport || { width: 1100, height: 1000 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  if (onNewDocument) await page.evaluateOnNewDocument(onNewDocument);
  if (!userId) {
    await page.goto(`http://${host}.subsub.work:${webPort}/`, { waitUntil: "domcontentloaded" });
    return { ctx, page, crashes };
  }
  await page.goto(`http://${host}.subsub.work:${webPort}/seed.txt`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.evaluate((a) => {
    localStorage.setItem("subsub.auth", JSON.stringify({ userId: a.userId, accountId: a.accountId }));
    localStorage.setItem("sb-stub-auth-token", JSON.stringify({
      access_token: "stub", refresh_token: "stub", token_type: "bearer",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: a.userId, email: "someone@example.test" },
    }));
  }, { userId, accountId });
  await page.goto(`http://${host}.subsub.work:${webPort}/`, { waitUntil: "domcontentloaded" });
  return { ctx, page, crashes };
}
