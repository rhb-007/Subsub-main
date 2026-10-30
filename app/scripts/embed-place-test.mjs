// Where the paste-it-on-your-website form lives, and who can reach it.
//
// It used to sit on the Contractors screen. That screen has the MOTIVE -- it is
// where somebody thinks about who works for them -- but not the artifact: the
// form's colours, its preview and its live address are all in Account ->
// Company, and the snippet is the fourth item in that list. So the panel moved
// there and the Contractors screen keeps a pointer.
//
// Two things this test exists to stop, both of which a build passes happily:
//
//   THE PANEL MUST NOT BECOME SCALE-ONLY. The branding panel it now sits beside
//   is gated on PLANS[plan].branding, and dropping the snippet inside that
//   branch would have made the cheapest growth lever a paid feature.
//   POST /api/apply/:subdomain checks no plan, and embedNudgeSweep emails Basic
//   accounts about it, so the snippet has to render on Basic.
//
//   AND THE HOSTED LINK MUST NOT BE OFFERED WHERE IT 404s. <sub>.subsub.work
//   only resolves once the custom hostname is active, which IS Scale-only. A
//   screen offering a link that will not load is the screen lying -- the same
//   rule QuickSend's W-9 line follows.
//
// Plus the standing guard: no \uXXXX surviving into what the reader sees.
//
//   node scripts/embed-place-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-embedplace-test");
const WEB = 5249, API = 8961;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

// An admin seat, because that is who puts things on the company website. The
// nudge email goes to admins only for the same reason.
const mkAccount = (plan, hostnameStatus) => ({
  id: "acc_gc", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan, billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active", hostnameStatus,
  user: { id: "u_ada", name: "Ada Wynn", email: "ada@outerhome.test", role: "admin" },
});

const SUBS = [{
  id: "cmp_ridge", company: "Ridge Roofing", engagementId: "en1", accountId: "acc_gc",
  contact: "Sam Ridge", email: "sam@ridge.test", phone: null, categories: ["roofing"],
  caps: [], crews: [], propertyIds: [], zips: [], notify: {}, rating: null,
  bond: true, insurance: true, contract: true, w9: true, hasPortal: true,
  license: null, licenseCheck: null, available: true, unavailableDays: [],
  docReview: {}, coverage: {},
}];

let ACCOUNT = mkAccount("scale", "active");

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (path === "/api/account-users") return [200, [
    { id: "u_ada", name: "Ada Wynn", email: "ada@outerhome.test", phone: null, role: "admin",
      subId: null, propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false },
  ]];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/subs") return [200, SUBS];
  if (path === "/api/jobs" || path === "/api/properties" || path === "/api/invites"
    || path === "/api/clients" || path === "/api/my-connect-requests"
    || path === "/api/connect-requests" || path === "/api/property-transfers"
    || path === "/api/doc-shares" || path === "/api/tenants") return [200, []];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/my-quotes") return [200, []];
  return undefined;
} });

const browser = await launch();

const open = async () => {
  const v = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "u_ada", accountId: "acc_gc" }, viewport: { width: 1280, height: 1100 } });
  await wait(2900);
  return v;
};

// Account -> Branding, through the nav the user actually has. The panel moved
// off Company with the branding studio: the snippet is a thing OTHER people
// see, and its colours, its preview and its live address are all on that tab.
const toCompany = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("nav button, .nav-item, header button")]
    .find((b) => /My account|Account/i.test(b.innerText || ""))?.click());
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => b.innerText.trim() === "Branding")?.click());
  await wait(700);
};

// Branding is two halves now, the way Pack & Passport is. The forms used to
// sit at the foot of the branding page, under the logo, the colors and two
// previews, and were reported as buried.
const half = (page, label) => page.evaluate((l) => [...document.querySelectorAll(".acct-subtabs button")]
  .find((b) => b.innerText.trim() === l)?.click(), label).then(() => wait(500));
const toForms = (page) => half(page, "Website forms");
const toLook = (page) => half(page, "Look and address");
const signupBody = (page) => page.evaluate(() =>
  document.querySelector(".embed-strip:not(.embed-signin) .embed-body")?.innerText.replace(/\s+/g, " ").trim() || null);
const signin = (page) => page.evaluate(() => {
  const el = document.querySelector(".embed-signin");
  return el ? { text: el.innerText.replace(/\s+/g, " ").trim(),
    link: el.querySelector(".embed-link")?.innerText.trim() || null } : null;
});

const panel = (page) => page.evaluate(() => {
  const el = document.querySelector(".embed-strip");
  return el ? { head: el.innerText.replace(/\s+/g, " ").trim().slice(0, 90) } : null;
});

try {
  console.log("\n-- it is in Account -> Branding, beside the branded form --");
  {
    ACCOUNT = mkAccount("scale", "active");
    const { ctx, page, crashes } = await open();
    await toCompany(page);

    t.ck("Branding opens on the look half, with the logo and colors",
      await page.evaluate(() => !!document.querySelector(".brand-preview")));
    t.ck("which no longer carries the forms at its foot", !(await panel(page)));
    await toForms(page);
    t.ck("the forms are their own half of Branding", !!(await panel(page)));
    const tabs = await page.evaluate(() => ({
      top: [...document.querySelectorAll(".acct-tabs button.on")].map((b) => b.innerText.trim()),
      sub: [...document.querySelectorAll(".acct-subtabs button.on")].map((b) => b.innerText.trim()),
      look: !!document.querySelector(".brand-preview"),
    }));
    t.ck("with Branding still lit and Website forms selected",
      tabs.top.join() === "Branding" && tabs.sub.join() === "Website forms" && !tabs.look, JSON.stringify(tabs));

    const body = await signupBody(page);
    t.ck("the sign-up form is open, with no disclosure to press", !!body
      && await page.evaluate(() => !document.querySelector(".embed-head")));
    t.ck("with the hosted link, because the address resolves",
      /outerhome\.subsub\.work/.test(body || ""), (body || "").slice(0, 120));
    t.ck("and the code to paste", /Copy the code/.test(body || ""));
    // Eighty lines of markup used to sit inline here, which is most of why the
    // tab scrolled forever. Nobody reads pasted HTML on a page -- they copy it
    // -- so the code is one tap away, from the Sign up form preview it draws.
    t.ck("the markup is not dumped on the page",
      await page.evaluate(() => !document.querySelector(".embed-code")));
    // View code sits beside Copy on BOTH cards (asked for by the owner), and
    // each opens the modal with its OWN markup: the sign-up card's form, the
    // sign-in card's button. Reading the code tab is what tells the two apart.
    const viewCode = async (sel) => {
      const pressed = await page.evaluate((s) => {
        const b = document.querySelector(s + " .embed-view-code");
        if (!b) return false; b.click(); return true;
      }, sel);
      if (!pressed) return { pressed };
      await new Promise((r) => setTimeout(r, 300));
      await page.evaluate(() => [...document.querySelectorAll(".ecm [role=tab]")]
        .find((b) => /code/i.test(b.textContent))?.click());
      await new Promise((r) => setTimeout(r, 200));
      const got = await page.evaluate(() => {
        const m = document.querySelector(".ecm");
        return m ? { title: m.querySelector("h2")?.innerText || "",
          code: m.querySelector(".ecm-code")?.innerText || "" } : null;
      });
      await page.evaluate(() => document.querySelector(".modal-backdrop")?.click());
      await new Promise((r) => setTimeout(r, 200));
      return { pressed, got };
    };
    const vApply = await viewCode(".embed-strip:not(.embed-signin)");
    t.ck("the sign-up card has View code beside Copy", vApply.pressed);
    t.ck("which opens the form's markup",
      /subsub-apply/.test(vApply.got?.code || "") && !/subsub-signin/.test(vApply.got?.code || ""),
      JSON.stringify(vApply.got).slice(0, 160));
    const vSign = await viewCode(".embed-signin");
    t.ck("the sign-in card has View code beside Copy", vSign.pressed);
    t.ck("which opens the button's markup, under its own title",
      /subsub-signin/.test(vSign.got?.code || "") && /sign-in button/i.test(vSign.got?.title || ""),
      JSON.stringify(vSign.got).slice(0, 160));
    const si = await signin(page);
    t.ck("and the sign-in button sits beside it", !!si, JSON.stringify(si));
    t.ck("which opens the live branded sign-in page", si?.link === "https://outerhome.subsub.work/", si?.link);
    t.ck("and says passwords are never typed on their website", /never on your website/i.test(si?.text || ""));
    const side = await page.evaluate(() => {
      const a = document.querySelector(".embed-strip:not(.embed-signin)")?.getBoundingClientRect();
      const b = document.querySelector(".embed-signin")?.getBoundingClientRect();
      return a && b ? { sameRow: Math.abs(a.top - b.top) < 4, apart: b.left > a.right - 1 } : null;
    });
    t.ck("side by side on a wide screen", side?.sameRow && side?.apart, JSON.stringify(side));

    await toLook(page);
    t.ck("the Sign up form block is titled",
      await page.evaluate(() => /hosted sign up form/i.test(
        document.querySelector(".sf-head h5")?.innerText || "")),
      await page.evaluate(() => document.querySelector(".sf-head h5")?.innerText || ""));
    // A title on its own says what the block IS and nothing about why anybody
    // would use it. The description is the only place that says an entry here
    // lands on the roster rather than in an inbox -- and that nothing has to
    // be hosted, which is the objection somebody reading "hosted" will have.
    const sfNote = await page.evaluate(() =>
      document.querySelector(".sf-note")?.innerText.replace(/\s+/g, " ").trim() || "");
    t.ck("and it says where an entry lands", /directly into SubSub/i.test(sfNote), sfNote);
    t.ck("and what they can do with one",
      /compliance pack/i.test(sfNote) && /availability/i.test(sfNote) && /schedule/i.test(sfNote),
      sfNote);
    t.ck("and answers the hosting question", /nothing here needs hosting/i.test(sfNote), sfNote);
    // The heading, the description and the picture are one block. The rule
    // that spaced them was `.sf-head + .theme-preview`, which stopped matching
    // the moment a paragraph came between them.
    const sfGap = await page.evaluate(() => {
      const n = document.querySelector(".sf-note");
      const p = document.querySelector(".sf-note + .theme-preview");
      return n && p ? { note: getComputedStyle(n).marginBottom, prev: getComputedStyle(p).marginTop } : null;
    });
    t.ck("the description sits above the preview", !!sfGap, String(sfGap));
    t.ck("and nothing left a default gap behind it",
      sfGap && sfGap.note === "0px" && sfGap.prev === "10px", JSON.stringify(sfGap));
    // The address on the preview is the address of the thing it previews.
    t.ck("and its address bar is the form's own URL",
      await page.evaluate(() => /\/\?apply=1$/.test(
        document.querySelector(".theme-preview .tp-bar span")?.innerText.trim() || "")),
      await page.evaluate(() => document.querySelector(".theme-preview .tp-bar span")?.innerText.trim() || ""));
    await page.evaluate(() => document.querySelector(".sf-head .embed-code-btn")?.click());
    await wait(500);
    const modal = await page.evaluate(() => {
      const m = document.querySelector(".ecm");
      if (!m) return null;
      return { tabs: [...m.querySelectorAll("[role=tab]")].map((b) => b.innerText.trim()),
        form: !!m.querySelector(".ecm-prev"), code: !!m.querySelector(".ecm-code"),
        copy: /Copy the code/.test(m.innerText) };
    });
    t.ck("the icon opens a modal", !!modal, String(modal));
    t.ck("showing the form by default", modal?.form === true, JSON.stringify(modal));
    t.ck("with a tab for the code", (modal?.tabs || []).some((x) => /code/i.test(x)),
      JSON.stringify(modal?.tabs));
    t.ck("and one for the form", (modal?.tabs || []).some((x) => /form/i.test(x)),
      JSON.stringify(modal?.tabs));
    t.ck("and you can copy from in there", modal?.copy === true, JSON.stringify(modal));
    await page.evaluate(() => [...document.querySelectorAll(".ecm [role=tab]")]
      .find((b) => /code/i.test(b.innerText))?.click());
    await wait(300);
    t.ck("the code tab shows the actual markup",
      await page.evaluate(() => /subsub-apply/.test(
        document.querySelector(".ecm-code")?.innerText || "")));
    await page.evaluate(() => document.querySelector(".modal-close")?.click());
    await wait(300);
    // The panel moved, so the sentence naming where applications land had to
    // stop saying "this screen".
    t.ck("it names the screen applications land on",
      /on the (Sub)?contractors screen/i.test(body || ""), (body || "").slice(-200));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));

    // The standing guard, scoped past the code block. A \\uXXXX in JSX text is
    // six literal characters and has shipped twice -- but this panel DISPLAYS
    // source for copying, and the snippet's own script legitimately contains
    // "Sending\\u2026": that escape is processed by the browser that runs the
    // snippet on somebody else's site, not by us. So the code block and the
    // link are excluded, and everything the panel says in its own voice is not.
    const seen = await page.evaluate(() => {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll(".embed-code, .embed-link, .embed-prev, .ecm-code, .ecm-prev")
        .forEach((n) => n.remove());
      return clone.innerText;
    });
    const leak = seen.match(/.{0,50}\\u[0-9a-f]{4}.{0,50}/i);
    t.ck("no escape sequence in anything the panel says", !leak, leak ? leak[0] : "");
    await ctx?.close?.();
  }

  console.log("\n-- on Basic it is still there, and honest about the link --");
  {
    // The whole point. Branding is Scale-only; this is not.
    ACCOUNT = mkAccount("basic", null);
    const { ctx, page, crashes } = await open();
    await toCompany(page);

    const upsell = await page.evaluate(() =>
      /Branding comes with Scale/.test(document.body.innerText));
    t.ck("the look half carries the branding upsell", upsell);
    await toForms(page);
    t.ck("the forms half renders on Basic", !!(await panel(page)));

    const body = await signupBody(page);
    t.ck("the code to paste is offered", /Copy the code/.test(body || ""),
      (body || "").slice(0, 140));
    // The form posts to the API, which checks no plan. The hosted URL does not
    // resolve until the custom hostname is active.
    t.ck("but the hosted link is not", !/Copy link/.test(body || ""), (body || "").slice(0, 140));
    t.ck("and it says why", /needs your own sign-in address/.test(body || ""),
      (body || "").slice(0, 200));
    const si = await signin(page);
    t.ck("the sign-in button works on Basic too, through app.subsub.work",
      si?.link === "https://app.subsub.work/", si?.link);
    t.ck("and says so", /until outerhome\.subsub\.work is live/i.test(si?.text || ""), (si?.text || "").slice(-160));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx?.close?.();
  }

  console.log("\n-- the Contractors screen points at it rather than repeating it --");
  {
    ACCOUNT = mkAccount("scale", "active");
    const { ctx, page, crashes } = await open();
    await page.evaluate(() => [...document.querySelectorAll("nav button, .nav-item")]
      // The nav entry, which starts with the word (a count may follow): the
      // profile menu's "Recruiting QR for subcontractors" matched a bare
      // /Contractors/ first and opened that instead.
      .find((b) => /^(Sub)?contractors\b/i.test((b.innerText || "").trim()))?.click());
    await wait(900);

    const ptr = await page.evaluate(() =>
      document.querySelector(".embed-ptr")?.innerText.replace(/\s+/g, " ").trim() || null);
    t.ck("the pointer is on the contractors screen", !!ptr, String(ptr));
    t.ck("it says what the form does", /apply from your own website/i.test(ptr || ""), String(ptr));
    // One implementation. Two copies would be two components holding the same
    // clipboard state.
    t.ck("and the panel itself is not duplicated here", !(await panel(page)));

    await page.evaluate(() => document.querySelector(".embed-ptr .lnk")?.click());
    await wait(1100);
    t.ck("following it lands on the panel", !!(await panel(page)));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" | "));
    await ctx?.close?.();
  }
} finally {
  await browser.close(); web.close(); api.close();
}

t.done();
