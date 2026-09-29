// Connecting a Stripe account, on the screen of the person doing it.
//
// The server half is pinned in payout-onboard-test.mjs. These are the parts
// that can only be seen in a browser, and the first is the whole reason this
// file exists:
//
//   COMING BACK FROM STRIPE ASKS THE SERVER. Stripe returns somebody to
//   `?payouts=return` whether they finished the form or abandoned it on the
//   second screen, so the panel must POST /payouts/refresh and draw whatever
//   comes back. A static check that the component "mentions" refresh would
//   pass with the call never made -- which is exactly the assertion-that-
//   cannot-fail this repository keeps catching, so it is driven instead.
//
//   AND IT LANDS WHERE THE ANSWER IS. Returning to the dashboard would put
//   the one screen that can say whether it worked two taps away with nothing
//   pointing at it.
//
//   IT NAMES WHAT STRIPE IS WAITING FOR. "Not verified" is a state, not an
//   instruction.
//
//   node scripts/payout-setup-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-payout-test");
const WEB = 5279, API = 8979;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const ACCOUNT = {
  id: "acc_bay", name: "Bay Roofing", subdomain: "bay", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "usr_rae", name: "Rae Mills", email: "rae@bay.test", role: "admin" },
};

const MY_COMPANY = {
  id: "cmp_bay", company: "Bay Roofing", contact: "Rae Mills", email: "rae@bay.test",
  phone: "(206)555-0111", city: "Seattle", state: "WA", zip: "98101", license: "BAYRO123",
  crews: [], coverage: { mode: "cities", cities: ["Seattle"] },
  openToHire: true, openAnswered: true, docs: {}, connectCode: "BAY123", shareStats: null,
};

// What /payouts/status and /payouts/refresh answer. Swapped between cases.
let payout = { status: "none", ready: false, requirements: [], configured: true };
let refuseConnect = null;
let seen = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (path.startsWith("/api/payouts/")) {
    seen.push(`${method} ${path}`);
    if (path === "/api/payouts/connect") {
      if (refuseConnect) return [502, refuseConnect];
      return [200, { url: "https://connect.stripe.com/setup/e/abc" }];
    }
    return [200, payout];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/my-company") return [200, MY_COMPANY];
  if (path === "/api/subs") return [200, []];
  if (path === "/api/jobs") return [200, []];
  if (path === "/api/invites" || path === "/api/connect-requests") return [200, []];
  if (path === "/api/my-connect-requests") return [200, []];
  if (path === "/api/account-users") {
    return [200, [{ id: "usr_rae", name: "Rae Mills", email: "rae@bay.test", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false }]];
  }
  return undefined;
} });

const browser = await launch();

const goCompany = async (page) => {
  // "My account", not "Account" -- the nav says whose it is.
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^My account$/.test(b.innerText.trim().split("\n")[0]))?.click());
  await wait(700);
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => b.innerText.trim() === "Company")?.click());
  await wait(900);
};

// Case-INSENSITIVE, because `.portal-panel h4` is text-transform:uppercase
// and Chrome's innerText applies it. A case-sensitive assertion against a
// heading is a test of the stylesheet, which this repository has already
// recorded once.
const panel = (page) => page.evaluate(() => {
  const h = [...document.querySelectorAll(".portal-panel h4")]
    .find((x) => /^getting paid$/i.test(x.innerText.trim()));
  if (!h) return null;
  const box = h.closest(".portal-panel");
  const dot = box.querySelector(".pay-dot");
  return {
    text: box.innerText,
    state: box.querySelector(".pay-state")?.innerText.trim() || "",
    tone: dot ? [...dot.classList].find((c) => /^pay-(ok|wait|no|off)$/.test(c)) : null,
    due: [...box.querySelectorAll(".pay-due li")].map((li) => li.innerText.trim()),
    button: box.querySelector("button")?.innerText.trim() || "",
  };
});

try {
  // ---- nothing connected yet ---------------------------------------------
  {
    const { ctx, page } = await visitApp(browser, { host: "bay", webPort: WEB,
      seat: { userId: "usr_rae", accountId: "acc_bay" }, viewport: { width: 1340, height: 1800 } });
    await wait(2200);
    seen = [];
    await goCompany(page);

    console.log("\n-- with nothing connected --");
    const p = await panel(page);
    t.ck("the panel is on Account -> Company", !!p, p ? p.state : "no panel");
    t.ck("it says it is not set up", /Not set up yet/.test(p?.state || ""), p?.state);
    t.ck("and the never-started dot is hollow rather than red",
      p?.tone === "pay-off", String(p?.tone));
    t.ck("the button offers to start", /Connect a Stripe account/.test(p?.button || ""), p?.button);
    t.ck("it says Stripe asks for the bank details, not us",
      /never see your bank details/i.test(p?.text || ""));
    t.ck("it read the status rather than guessing",
      seen.some((s) => s === "GET /api/payouts/status"), seen.join(", "));
    t.ck("and it did NOT refresh, because nobody came back from anywhere",
      seen.length > 0 && !seen.some((s) => s.includes("refresh")), seen.join(", "));

    // Pressing it asks the server for a link. The link is minted per press
    // and followed immediately, so nothing about it is held on screen.
    seen = [];
    await page.evaluate(() => {
      const h = [...document.querySelectorAll(".portal-panel h4")]
        .find((x) => /^getting paid$/i.test(x.innerText.trim()));
      h?.closest(".portal-panel")?.querySelector("button")?.click();
    });
    await wait(900);
    t.ck("pressing it mints a link on the server",
      seen.some((s) => s === "POST /api/payouts/connect"), seen.join(", "));
    await ctx.close();
  }

  // ---- half way through ---------------------------------------------------
  {
    payout = { status: "pending", ready: false, configured: true,
      transfersActive: false, payoutsEnabled: false,
      requirements: [{ key: "individual.verification.document", label: "A photo ID" },
        { key: "external_account", label: "Your bank account" }] };
    const { ctx, page } = await visitApp(browser, { host: "bay", webPort: WEB,
      seat: { userId: "usr_rae", accountId: "acc_bay" }, viewport: { width: 1340, height: 1800 } });
    await wait(2200);
    await goCompany(page);

    console.log("\n-- half way through --");
    const p = await panel(page);
    t.ck("it says Stripe is still checking", /still checking/i.test(p?.state || ""), p?.state);
    t.ck("amber, not red", p?.tone === "pay-wait", String(p?.tone));
    t.ck("and it names what is wanted, in words rather than in Stripe's keys",
      (p?.due || []).join(" | ") === "A photo ID | Your bank account", (p?.due || []).join(" | "));
    // Every negative below requires the panel to BE there. `!/x/.test(p?.text
    // || "")` is satisfied by a missing panel, so it would report loudest
    // exactly when the subject had disappeared -- the inverse of the
    // read-through-`link?.` lesson, and just as quiet.
    t.ck("no Stripe requirement key is shown to a roofer",
      !!p && !/individual\.verification|external_account/.test(p.text));
    t.ck("the button carries on rather than starting again",
      /Finish setting it up/.test(p?.button || ""), p?.button);
    await ctx.close();
  }

  // ---- the one that matters: coming back from Stripe ----------------------
  {
    payout = { status: "pending", ready: false, configured: true,
      transfersActive: true, payoutsEnabled: false,
      requirements: [{ key: "external_account", label: "Your bank account" }] };
    seen = [];
    const { ctx, page } = await visitApp(browser, { host: "bay", webPort: WEB,
      seat: { userId: "usr_rae", accountId: "acc_bay" },
      path: "/?payouts=return", viewport: { width: 1340, height: 1800 } });
    await wait(2600);

    console.log("\n-- coming back from Stripe having given up half way --");
    const p = await panel(page);
    t.ck("it landed on the screen that can answer, not the dashboard",
      !!p, p ? "panel is on screen" : "no panel -- landed elsewhere");
    t.ck("and it ASKED rather than assuming the return meant success",
      seen.some((s) => s === "POST /api/payouts/refresh"), seen.join(", "));
    t.ck("so an abandoned setup is not drawn as finished",
      !!p && !/Ready to be paid/.test(p.text), p?.state);
    t.ck("it tells them the half that is done and the half that is not",
      /not your bank yet/i.test(p?.text || ""), p?.text?.slice(0, 120));
    t.ck("the marker is taken out of the address bar",
      !(await page.evaluate(() => window.location.search)).includes("payouts"),
      await page.evaluate(() => window.location.search));
    await ctx.close();
  }

  // ---- done ---------------------------------------------------------------
  {
    payout = { status: "verified", ready: true, configured: true,
      transfersActive: true, payoutsEnabled: true, requirements: [] };
    const { ctx, page } = await visitApp(browser, { host: "bay", webPort: WEB,
      seat: { userId: "usr_rae", accountId: "acc_bay" }, viewport: { width: 1340, height: 1800 } });
    await wait(2200);
    await goCompany(page);

    console.log("\n-- once Stripe has cleared them --");
    const p = await panel(page);
    t.ck("it says they are ready", /Ready to be paid/.test(p?.state || ""), p?.state);
    t.ck("green", p?.tone === "pay-ok", String(p?.tone));
    t.ck("nothing is still wanted", !!p && p.due.length === 0);
    t.ck("and the button is quiet rather than a call to action",
      /Manage it on Stripe/.test(p?.button || ""), p?.button);

    // The class rather than the instance: a \uXXXX escape in JSX text is six
    // literal characters, and it has shipped twice.
    const leaked = await page.evaluate(() => /\\u[0-9a-fA-F]{4}/.test(document.body.innerText));
    t.ck("no escape sequence reached the screen", !leaked);
    await ctx.close();
  }

  // ---- when Stripe refuses ------------------------------------------------
  {
    payout = { status: "none", ready: false, requirements: [], configured: true };
    refuseConnect = { error: "stripe_failed",
      detail: "Only Stripe Connect platforms can create accounts." };
    const { ctx, page } = await visitApp(browser, { host: "bay", webPort: WEB,
      seat: { userId: "usr_rae", accountId: "acc_bay" }, viewport: { width: 1340, height: 1800 } });
    await wait(2200);
    await goCompany(page);
    await page.evaluate(() => {
      const h = [...document.querySelectorAll(".portal-panel h4")]
        .find((x) => /^getting paid$/i.test(x.innerText.trim()));
      h?.closest(".portal-panel")?.querySelector("button")?.click();
    });
    await wait(900);

    console.log("\n-- and when Stripe refuses --");
    const p = await panel(page);
    t.ck("it says what Stripe actually said",
      !!p && /Only Stripe Connect platforms/.test(p.text),
      p?.text?.slice(0, 160));
    // The one that matters: a configuration Stripe will refuse every time
    // must not be drawn as something that fixes itself.
    t.ck("and does not tell them to wait for it to fix itself",
      !!p && !/Try again in a moment/.test(p.text), p?.text?.slice(0, 160));
    refuseConnect = null;
    await ctx.close();
  }

  // ---- payments not switched on at all ------------------------------------
  {
    payout = { status: "none", ready: false, requirements: [], configured: false };
    const { ctx, page } = await visitApp(browser, { host: "bay", webPort: WEB,
      seat: { userId: "usr_rae", accountId: "acc_bay" }, viewport: { width: 1340, height: 1800 } });
    await wait(2200);
    await goCompany(page);

    console.log("\n-- and when SubSub has no Stripe key at all --");
    const p = await panel(page);
    t.ck("it says there is nothing to do rather than offering a dead button",
      /aren't switched on/i.test(p?.text || "") && !p?.button, `${p?.text?.slice(0, 60)} btn=${p?.button}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
