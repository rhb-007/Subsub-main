import { readFileSync } from "node:fs";
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

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-boot-test");
const WEB = 5194, API = 8908;
// Long enough that a flash would be unmissable on screen. Real networks on a
// phone are worse than this.
const DELAY = 600;

const t = tally();
const ck = t.ck;

console.log("\n-- building against stub hostnames --");
const page_file = buildApp({ outDir: OUT, apiPort: API });
ck("the build produced a page", readFileSync(page_file, "utf8").includes("<div id=\"root\""));

const ACCOUNT = {
  id: "acc_outer", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "usr_richard", name: "Richard Braun", email: "richard@example.test", role: "admin" },
};

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, delay: DELAY, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/auth/me") return [200, { user: ACCOUNT.user, memberships: [] }];
  return undefined;
} });

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

const browser = await launch();

const visit = async (seat) => {
  const r = await visitApp(browser, { host: "outerhome", webPort: WEB, onNewDocument: RECORDER,
    seat: seat ? { userId: "usr_richard", accountId: "acc_outer" } : null,
    viewport: { width: 900, height: 1000 } });
  await wait(DELAY * 4 + 1500);
  return { ...r, frames: await r.page.evaluate(() => window.__frames) };
};

try {
  // ---- coming back with a session ------------------------------------
  console.log("\n-- coming back to the tab already signed in --");
  {
    api.calls.length = 0;
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
    ck("the account was actually asked for", api.calls.includes("/api/account"), api.calls.join(" "));
    await ctx.close();
  }

  // ---- arriving signed out -------------------------------------------
  console.log("\n-- arriving on the address signed out --");
  {
    api.calls.length = 0;
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
      api.calls.some((p) => p.startsWith("/api/account-by-subdomain/")), api.calls.join(" "));
    // Nobody's seat is stored, so there is nothing to resume and no reason
    // to have called for one.
    ck("and no account was fetched for a session that does not exist",
      !api.calls.includes("/api/account"), api.calls.join(" "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
