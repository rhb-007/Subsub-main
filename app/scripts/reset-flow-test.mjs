// Asking for a new password, on a branded sign-in page.
//
// The screen asked two questions at once. "Forgot password?" sent the email as
// a side effect of the link and changed nothing else: the password box stayed,
// the Sign in button stayed, and any error from a failed sign-in stayed. So
// somebody who pressed Sign in with no password and then pressed Forgot
// password was shown, together:
//
//     Enter your email and password.          (no longer true)
//     Check your email for a reset link.      (drawn in a RED box)
//
// above a form still demanding the password they had just been sent a link to
// replace. Both messages used .login-err, so the success wore the failure's
// red background with only its text colour overridden.
//
// What this covers:
//
//   ASKING IS ITS OWN SCREEN -- email only, no password, no Sign in button.
//   SWITCHING CLEARS THE OLD MESSAGE, because it is about a form that is gone.
//   A SUCCESS IS NOT AN ERROR IN A DIFFERENT COLOUR.
//   AND IT DOES NOT SAY WHETHER THE ADDRESS HAS AN ACCOUNT, because a reset
//   form that says "no account found" is a way to ask which of a list of
//   addresses is on SubSub.
//
// The link itself lands on AuthLanding, which already takes a new password
// twice and is not re-tested here.
//
//   node scripts/reset-flow-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-resetflow-test");
const WEB = 5253, API = 8965;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const ACCOUNT = {
  id: "acc_pm", name: "Cascade Management", subdomain: "cascade", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
};

// The ask now goes to the Worker, not to Supabase: only the server can tell a
// forgotten password from a users row with no login behind it from an invited
// subcontractor who never opened their link, and it answers the same for all
// three. password-help-test.mjs covers which branch runs; this covers what the
// screen does with the one reply it gets.
const asks = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/password-help" && method === "POST") {
    asks.push(body);
    return [200, { ok: true }];
  }
  return undefined;
} });

const browser = await launch();

// No seat is passed below: this is the signed-out sign-in page, which is the
// whole subject.
const shape = (page) => page.evaluate(() => {
  const form = document.querySelector(".login-form");
  const btns = [...document.querySelectorAll(".login-form button")]
    .map((b) => b.innerText.replace(/\s+/g, " ").trim()).filter(Boolean);
  return {
    passwords: document.querySelectorAll('.login-form input[type="password"]').length,
    emails: document.querySelectorAll('.login-form input[type="email"]').length,
    buttons: btns,
    errs: [...document.querySelectorAll(".login-err")].map((e) => e.innerText.trim()),
    oks: [...document.querySelectorAll(".login-ok")].map((e) => e.innerText.replace(/\s+/g, " ").trim()),
    text: form ? form.innerText.replace(/\s+/g, " ").trim() : null,
  };
});

const typeIn = (page, sel, value) => page.evaluate((s, v) => {
  const el = document.querySelector(s);
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, sel, value);

const click = (page, text) => page.evaluate((txt) =>
  [...document.querySelectorAll(".login-form button")]
    .find((b) => b.innerText.replace(/\s+/g, " ").trim().toLowerCase().includes(txt))?.click(), text);

try {
  console.log("\n-- the sign-in screen is unchanged --");
  const { ctx, page, crashes } = await visitApp(browser, { host: "cascade", webPort: WEB,
    viewport: { width: 900, height: 1200 } });
  await wait(2600);
  {
    const s = await shape(page);
    t.ck("it asks for a password", s.passwords === 1, JSON.stringify(s.buttons));
    t.ck("and offers the way out", /Forgot password\?/.test(s.text || ""), (s.text || "").slice(0, 120));
  }

  console.log("\n-- a failed sign-in, then asking for a reset --");
  {
    await typeIn(page, '.login-form input[type="email"]', "r.hb@outlook.com");
    await wait(200);
    await click(page, "sign in");
    await wait(600);
    const failed = await shape(page);
    // The exact state in the screenshot: Sign in pressed with no password.
    t.ck("it complains about the missing password",
      failed.errs.some((e) => /Enter your email and password/i.test(e)),
      JSON.stringify(failed.errs));

    await click(page, "forgot password");
    await wait(400);
    const s = await shape(page);
    t.ck("the password box is gone", s.passwords === 0, String(s.passwords));
    t.ck("the email box is not", s.emails === 1, String(s.emails));
    t.ck("and it keeps what they already typed",
      (await page.evaluate(() => document.querySelector('.login-form input[type="email"]').value))
        === "r.hb@outlook.com");
    t.ck("Sign in is not offered here",
      !s.buttons.some((b) => /^Sign in$/i.test(b)), JSON.stringify(s.buttons));
    t.ck("Send reset link is", s.buttons.some((b) => /Send reset link/i.test(b)),
      JSON.stringify(s.buttons));
    t.ck("and there is a way back", s.buttons.some((b) => /Back to sign in/i.test(b)),
      JSON.stringify(s.buttons));
    // THE BUG. The old message was about a form that is no longer on screen.
    t.ck("the sign-in error is cleared", s.errs.length === 0, JSON.stringify(s.errs));
  }

  console.log("\n-- sending, and what it says afterwards --");
  {
    asks.length = 0;
    await click(page, "send reset link");
    await wait(900);
    const s = await shape(page);

    t.ck("it reaches the server once", asks.length === 1, JSON.stringify(asks));
    t.ck("for the address they typed", asks[0]?.email === "r.hb@outlook.com",
      JSON.stringify(asks[0]));
    // So a branded page returns you to itself rather than the shared one. The
    // Worker refuses anything that is not a subsub.work address.
    t.ck("and says where to come back to",
      /cascade\.subsub\.work/.test(String(asks[0]?.origin)), String(asks[0]?.origin));
    t.ck("it confirms", s.oks.length === 1, JSON.stringify(s.oks));
    t.ck("and nothing is drawn as an error", s.errs.length === 0, JSON.stringify(s.errs));
    t.ck("no password box on the confirmation either", s.passwords === 0, String(s.passwords));
    // Enumeration. "If that address has an account" rather than "we sent it".
    // It has to be true for somebody who forgot a password AND for a
    // subcontractor who was invited and never opened the link -- so it names
    // both, every time, which is also what stops it saying which one ran.
    t.ck("it does not confirm the address has an account",
      /if we have anything for/i.test(s.oks[0] || ""), String(s.oks[0]));
    t.ck("it offers the reset reading", /password reset/i.test(s.oks[0] || ""), String(s.oks[0]));
    t.ck("and the invitation reading", /invitation/i.test(s.oks[0] || ""), String(s.oks[0]));

    // A success in a red box is a success nobody believes.
    const look = await page.evaluate(() => {
      const ok = document.querySelector(".login-ok");
      const cs = getComputedStyle(ok);
      const rgb = (v) => v.match(/\d+/g).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => {
        const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const a = lum(rgb(cs.color)), b = lum(rgb(cs.backgroundColor));
      return { bg: cs.backgroundColor,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
    // #faece7 is the error box. Anything but that.
    t.ck("the confirmation is not wearing the error's background",
      look.bg !== "rgb(250, 236, 231)", look.bg);
    t.ck("and its text is readable on it", look.ratio >= 4.5, look.ratio.toFixed(2));
  }

  console.log("\n-- going back --");
  {
    await click(page, "back to sign in");
    await wait(400);
    const s = await shape(page);
    t.ck("the password box returns", s.passwords === 1, String(s.passwords));
    t.ck("Sign in returns with it", s.buttons.some((b) => /^Sign in$/i.test(b)),
      JSON.stringify(s.buttons));
    t.ck("and the confirmation does not follow them back", s.oks.length === 0,
      JSON.stringify(s.oks));
  }

  console.log("\n-- with no address typed --");
  {
    await click(page, "forgot password");
    await wait(300);
    await typeIn(page, '.login-form input[type="email"]', "");
    await wait(200);
    asks.length = 0;
    await click(page, "send reset link");
    await wait(600);
    const s = await shape(page);
    t.ck("nothing is sent", asks.length === 0, JSON.stringify(asks));
    t.ck("it asks for one", s.errs.some((e) => /Enter your email address/i.test(e)),
      JSON.stringify(s.errs));
    t.ck("and does not claim it sent anything", s.oks.length === 0, JSON.stringify(s.oks));
  }

  t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
  const seen = await page.evaluate(() => document.body.innerText);
  t.ck("no escape sequence on screen", !/\\u[0-9a-f]{4}/i.test(seen), "");
  await ctx?.close?.();
} finally {
  await browser.close(); web.close(); api.close();
}

t.done();
