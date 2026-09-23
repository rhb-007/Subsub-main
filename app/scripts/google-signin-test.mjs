// Signing in with Google.
//
// The button is the easy half. The half that decides whether it works is
// what happens on the way back.
//
// Every other way into this app ends in a form submit, and the rest of
// signing in hangs off that submit: handleLogin() asks the API who this
// session belongs to, enterAccount() writes the small key that resumeSession()
// reads on later loads. A provider sign-in has no submit. The browser leaves
// for Google and returns with a session already in place, and if nothing
// looks for it, a fully authenticated person is shown the sign-in screen
// again -- which from the outside is indistinguishable from the button
// doing nothing.
//
// That is what is asserted hardest here, and it is asserted the only way it
// can be without a real Google: sign in properly, throw away the small key
// while keeping the session, and reload. That is the exact state a first
// Google sign-in lands in.
//
//   node scripts/google-signin-test.mjs

import puppeteer from "puppeteer-core";

const PORT = process.env.APP_PORT || "5191";
const AUTH = process.env.AUTH_BASE || "http://127.0.0.1:8902/auth/v1/token";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--host-resolver-rules=MAP *.subsub.work 127.0.0.1"],
});

const open = async (host) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1000, height: 1300 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://${host}:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=password]", { timeout: 15000 });
  await wait(1400);
  return { ctx, page, crashes };
};

const signIn = async (page, email) => {
  await page.type("input[type=email]", email);
  await page.type("input[type=password]", "correct horse battery");
  await page.waitForSelector(".login-btn", { timeout: 15000 });
  await page.click(".login-btn");
  await wait(6000);
};

try {
  console.log("\n-- the button is on the sign-in page, branded and not --");
  for (const host of ["app.subsub.work", "cascademanagement.subsub.work"]) {
    const { ctx, page } = await open(host);
    const b = await page.evaluate(() => {
      const el = document.querySelector(".btn-google");
      if (!el) return null;
      const form = document.querySelector(".login-form");
      const email = document.querySelector("input[type=email]");
      return {
        text: el.innerText.trim(),
        colours: [...el.querySelectorAll("svg path")].map((p) => p.getAttribute("fill")),
        aboveEmail: el.getBoundingClientRect().top < email.getBoundingClientRect().top,
        divider: (form?.innerText || "").includes("or use your email"),
        width: Math.round(el.getBoundingClientRect().width),
        formWidth: Math.round(form.getBoundingClientRect().width),
      };
    });
    ck(`${host}: the button is there`, !!b, String(b));
    ck(`${host}: worded the way Google requires`, b?.text === "Continue with Google", b?.text);
    ck(`${host}: their mark, their four colours`,
      b?.colours.join(",") === "#4285F4,#34A853,#FBBC05,#EA4335", (b?.colours || []).join(","));
    ck(`${host}: offered before the typing`, b?.aboveEmail === true);
    ck(`${host}: and says the email box is the same door`, b?.divider === true);
    // On a branded page it sits under somebody else's logo, so it has to be
    // the same width as everything else rather than a foreign object.
    ck(`${host}: full width, like the rest of the form`,
      Math.abs(b.width - b.formWidth) < 3, `${b.width} vs ${b.formWidth}`);
    await ctx.close();
  }

  console.log("\n-- pressing it goes to Google, and says where to come back to --");
  {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    let authorize = "";
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      try {
        if (r.url().includes("/auth/v1/authorize")) { authorize = r.url(); return r.abort(); }
      } catch { /* fall through */ }
      r.continue().catch(() => {});
    });
    await page.goto(`http://cascademanagement.subsub.work:${PORT}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".btn-google", { timeout: 15000 });
    await wait(1200);
    await page.click(".btn-google");
    await wait(2500);
    ck("it asks the provider for google", /provider=google/.test(authorize), authorize || "(no request)");
    // The whole point of the branded hostname: somebody who starts at their
    // own company's address must not be handed back to the shared one.
    const back = decodeURIComponent((authorize.match(/redirect_to=([^&]+)/) || [])[1] || "");
    ck("and to come back to the address they started on",
      back === "http://cascademanagement.subsub.work:5191", back || "(none)");
    await ctx.close();
  }

  console.log("\n-- coming back with a session and nothing else --");
  {
    // The state a first Google sign-in lands in, reproduced exactly: a live
    // Supabase session, and none of the keys the app writes when it signs
    // somebody in itself.
    const { ctx, page, crashes } = await open("cascademanagement.subsub.work");
    await signIn(page, "pm@example.test");
    const keys = await page.evaluate(() => {
      const before = Object.keys(localStorage);
      localStorage.removeItem("subsub.auth");
      return { before, after: Object.keys(localStorage) };
    });
    ck("the session is kept, the app's own key is gone",
      keys.after.some((k) => /^sb-/.test(k)) && !keys.after.includes("subsub.auth"), keys.after.join(", "));

    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(7000);
    const after = await page.evaluate(() => ({
      text: document.body.innerText,
      onLoginScreen: !!document.querySelector("input[type=password]"),
      restored: localStorage.getItem("subsub.auth"),
    }));
    ck("they are signed in, not shown the form again", !after.onLoginScreen,
      after.text.split("\n").slice(0, 4).join(" / "));
    ck("and land in their account", /Good to see you/.test(after.text), after.text.slice(0, 80));
    ck("the app's key is written back, so later loads are ordinary", !!after.restored, String(after.restored));
    ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a Google account nobody has invited --");
  {
    const { ctx, page } = await open("cascademanagement.subsub.work");
    // A real login for an address with no membership anywhere. Signing in
    // this way leaves the same session a returning Google user has.
    const t = await (await fetch(AUTH, { method: "POST",
      body: JSON.stringify({ email: `nobody.${Date.now().toString(36)}@example.test` }) })).json();
    await page.evaluate((tok) => {
      const key = Object.keys(localStorage).find((k) => /^sb-/.test(k)) || "sb-127-auth-token";
      localStorage.setItem(key, JSON.stringify({
        access_token: tok.access_token, refresh_token: tok.refresh_token, token_type: "bearer",
        expires_at: tok.expires_at, expires_in: tok.expires_in, user: tok.user,
      }));
      localStorage.removeItem("subsub.auth");
    }, t);
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(7000);
    const shown = await page.evaluate(() => ({
      text: document.body.innerText,
      escape: [...document.querySelectorAll("button")].some((b) => /different Google account/i.test(b.textContent)),
    }));
    // The failure that matters: being bounced back to a form with no reason
    // given, having just signed in successfully.
    ck("they are told why they are looking at a form again",
      /isn't on a SubSub account|not a member of any account/i.test(shown.text),
      shown.text.split("\n").filter(Boolean).slice(0, 6).join(" / "));
    ck("and told the likeliest reason", /different address/i.test(shown.text), "");
    ck("with a way out, so it is not a permanent dead end", shown.escape);
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
