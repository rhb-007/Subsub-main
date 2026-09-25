// The connect code, one tap from anywhere.
//
// It lived four taps deep -- My account, Company, the subcontractor panel,
// scroll to it -- which is three taps too many when the whole point of a
// code rather than an email address is that somebody is standing in front
// of you waiting. It is now an expandable item at the top of the user menu,
// and of the drawer on a phone, which is where it will actually be used.
//
// Four things have to hold, and three of them are easy to get wrong:
//
//   the drawer closes on any button inside it, which is right for a nav
//   item and wrong for this -- opening the code must not shut the drawer
//   over it, and neither must Copy link;
//
//   the code is fetched once, not on every open, because the second open
//   happens with somebody waiting;
//
//   it is not offered to a seat that has no company, which would be a menu
//   item that answers 403;
//
//   and rotating the code is NOT in here. A "Change code" button a
//   thumb-width from "Copy link" is a way to break the code you are in the
//   middle of showing somebody.
//
//   node scripts/qr-menu-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, signedInPage, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-boot-test");
const WEB = 5195, API = 8909;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const CODE = { code: "K7F2-9QX1", url: "https://outerhome.subsub.work/?connect=K7F2-9QX1" };
const account = (kind) => ({
  id: "acc_outer", name: "Outerhome", subdomain: "outerhome", kind,
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "usr_richard", name: "Richard Braun", email: "r@example.test", role: "admin" },
});

// The seat, which is what decides both the chrome and whether a code is
// offered at all. It reaches the app through the roster, the same way it
// does in production -- hydrateAccount() builds memberships from it.
let kind = "general_contractor";
let seatRole = "admin";
let codeAnswer = () => [200, CODE];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, account(kind)];
  if (path === "/api/account") return [200, account(kind)];
  if (path === "/api/connect/code") return codeAnswer();
  if (path === "/api/my-company") {
    return [200, { companyId: "cmp_own_acc1", company: "Outerhome", contact: "", email: "r@example.test",
      phone: "", license: "", ubi: "", city: "", state: "", zip: "",
      findable: true, code: CODE.code, url: CODE.url }];
  }
  if (path === "/api/account-users") {
    return [200, [{ id: "usr_richard", name: "Richard Braun", email: "r@example.test",
      role: seatRole, subId: seatRole === "contractor" ? "cmp_sub1" : null, propertyIds: [] }]];
  }
  return undefined;
} });

const browser = await launch();
const open = async (viewport) => {
  const r = await signedInPage(browser, { host: "outerhome", webPort: WEB,
    userId: "usr_richard", accountId: "acc_outer", viewport });
  await wait(1800);
  return r;
};
const text = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.innerText.trim()));

// Counted from inside the page, installed once the app is up.
//
// The server's own tally cannot answer this: booting draws the account,
// the roster, the jobs and the rest, and in this harness some of that
// happens more than once. Wrapping fetch AFTER the first render counts only
// what the clicks below cause, which is the thing being asserted.
const countFetches = (page) => page.evaluate(() => {
  window.__codeFetches = 0;
  const real = window.fetch;
  // apply against window, not `this`: the app calls fetch bare, so `this`
  // is undefined and an unbound call throws "Illegal invocation" -- which
  // takes out the app rather than the measurement.
  window.fetch = function (...args) {
    if (String(args[0]).includes("/connect/code")) window.__codeFetches++;
    return real.apply(window, args);
  };
});
const fetches = (page) => page.evaluate(() => window.__codeFetches);

try {
  // ---- the menu on a laptop -------------------------------------------
  console.log("\n-- the user menu --");
  {
    api.calls.length = 0;
    const { ctx, page, crashes } = await open({ width: 1200, height: 1000 });
    await page.click(".user-btn");
    await wait(250);

    await countFetches(page);
    const items = await text(page, ".user-menu button");
    t.ck("the code is offered", items.some((x) => /My QR code/i.test(x)), items.join(" | "));
    t.ck("and it is the first thing in the menu", /My QR code/i.test(items[0] || ""), items[0]);
    t.ck("nothing is drawn before it is asked for",
      (await page.$(".qrp")) === null && (await fetches(page)) === 0, String(await fetches(page)));

    await page.click(".um-qr");
    await page.waitForSelector(".qrp .qr", { timeout: 4000 });
    const shown = await page.evaluate(() => ({
      squares: document.querySelectorAll(".user-menu .qrp svg.qr path").length,
      code: document.querySelector(".user-menu .qrp-code")?.textContent,
      acts: [...document.querySelectorAll(".user-menu .qrp button")].map((b) => b.innerText.trim()),
      menuStillOpen: !!document.querySelector(".user-menu"),
      // The drawer holds a copy of the same item for the phone. On a wide
      // screen it is in the markup and must not be on the screen, or the
      // code is drawn twice on one page.
      drawerCopyShown: !!document.querySelector(".drawer-qr")?.offsetParent,
    }));
    t.ck("the squares are drawn", shown.squares === 1, JSON.stringify(shown));
    t.ck("and the phone's copy of the item stays off a wide screen",
      shown.drawerCopyShown === false, JSON.stringify(shown));
    t.ck("with the code in words too", shown.code === CODE.code, String(shown.code));
    t.ck("one Copy link, not two",
      shown.acts.filter((x) => /copy link/i.test(x)).length === 1, shown.acts.join(" | "));
    t.ck("Copy link is there", shown.acts.some((x) => /Copy link/i.test(x)), shown.acts.join(" | "));
    t.ck("and Change code is NOT", !shown.acts.some((x) => /change code/i.test(x)), shown.acts.join(" | "));
    t.ck("the menu stayed open over it", shown.menuStillOpen);
    t.ck("it was fetched once", (await fetches(page)) === 1, String(await fetches(page)));

    // Closing and reopening is the case somebody hits with a stranger
    // waiting, so it must not go back to the network for it.
    await page.click(".um-qr");
    await wait(200);
    t.ck("it collapses again", (await page.$(".qrp")) === null);
    await page.click(".um-qr");
    await page.waitForSelector(".qrp .qr", { timeout: 4000 });
    t.ck("and comes back without asking twice", (await fetches(page)) === 1, String(await fetches(page)));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }

  // ---- big enough to actually scan ------------------------------------
  // The inline code is for recognising. Pointing a camera at something that
  // size means holding the phone close enough that it cannot focus, so the
  // one that gets scanned is the full-screen one.
  console.log("\n-- held up to be scanned --");
  {
    const { ctx, page, crashes } = await open({ width: 390, height: 844 });
    // Through the drawer, which is what a phone actually gets.
    await page.click(".nav-burger");
    await wait(300);
    await page.click(".drawer-qr .um-qr");
    await page.waitForSelector(".drawer-qr .qrp .qr", { timeout: 4000 });
    const small = await page.$eval(".drawer-qr svg.qr", (n) => n.getBoundingClientRect().width);
    t.ck("the small code is on screen to be tapped", small > 0, String(small));

    await page.click(".drawer-qr .qrp-tap");
    await page.waitForSelector(".qrf", { timeout: 4000 });
    const big = await page.evaluate(() => {
      const box = document.querySelector(".qrf");
      const svg = document.querySelector(".qrf svg.qr");
      const r = svg.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height),
        vw: window.innerWidth, vh: window.innerHeight,
        bg: getComputedStyle(box).backgroundColor,
        // It has to escape the menu it was opened from, which has its own
        // scrolling box and would clip it.
        parentIsBody: box.parentElement === document.body,
        onTopOfMenu: getComputedStyle(box).position === "fixed",
        dialog: box.getAttribute("role") + "/" + box.getAttribute("aria-modal"),
        acts: [...document.querySelectorAll(".qrf-btn")].map((b) => b.innerText.trim()),
        codeShown: document.querySelector(".qrf-txt")?.textContent,
        fitsOnScreen: r.width <= window.innerWidth && r.height <= window.innerHeight,
      };
    });
    t.ck("it is far bigger than the inline one", big.w > small * 1.8, `${big.w} vs ${Math.round(small)}`);
    t.ck("it fills most of the width", big.w > big.vw * 0.7, `${big.w} of ${big.vw}`);
    t.ck("and still fits on the screen", big.fitsOnScreen, JSON.stringify(big));
    t.ck("it is square", Math.abs(big.w - big.h) <= 1, `${big.w} x ${big.h}`);
    t.ck("on white, whatever the theme is doing",
      big.bg === "rgb(255, 255, 255)", big.bg);
    t.ck("it escaped the menu that opened it", big.parentIsBody && big.onTopOfMenu, JSON.stringify(big));
    t.ck("it is a dialog", big.dialog === "dialog/true", big.dialog);
    t.ck("the code is readable out loud too", big.codeShown === CODE.code, String(big.codeShown));
    t.ck("with a way out", big.acts.some((x) => /done/i.test(x)), big.acts.join(" | "));
    t.ck("and a way through when the camera will not play",
      big.acts.some((x) => /copy link/i.test(x)), big.acts.join(" | "));

    // Escape, because it covers the whole screen and a phone user who
    // cannot find Done is stuck looking at a QR code.
    await page.keyboard.press("Escape");
    await wait(250);
    t.ck("Escape closes it", (await page.$(".qrf")) === null);
    t.ck("and the page scrolls again",
      await page.evaluate(() => document.body.style.overflow !== "hidden"));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }

  // ---- and the settings panel, which did not move ---------------------
  // The ask was to leave the settings where they are and make the code
  // itself easier to get at. So: the full panel is still reached the way it
  // always was, still has the things a settings page is for, and has gained
  // the same tap-to-scan.
  console.log("\n-- the settings panel, where it always was --");
  {
    const { ctx, page, crashes } = await open({ width: 1200, height: 1000 });
    await page.click(".user-btn");
    await wait(250);
    await page.click(".um-account");
    await page.waitForSelector(".seg-tabs", { timeout: 5000 });
    const panes = await page.$$eval(".seg-tabs button", (b) => b.map((x) => x.innerText.trim()));
    t.ck("My account still has its Company pane", panes.some((x) => /company/i.test(x)), panes.join(" | "));
    await page.evaluate(() => {
      [...document.querySelectorAll(".seg-tabs button")].find((b) => /company/i.test(b.innerText))?.click();
    });
    await page.waitForSelector(".cx-code", { timeout: 6000 });
    const panel = await page.evaluate(() => ({
      acts: [...document.querySelectorAll(".cx-code-acts button")].map((b) => b.innerText.trim()),
      tappable: !!document.querySelector(".cx-code .qrp-tap"),
      squares: document.querySelectorAll(".cx-code svg.qr path").length,
    }));
    t.ck("rotating the code is still here, not in the menu",
      panel.acts.some((x) => /change code/i.test(x)), panel.acts.join(" | "));
    t.ck("and so is Copy link", panel.acts.some((x) => /copy link/i.test(x)), panel.acts.join(" | "));
    t.ck("the code is drawn", panel.squares === 1, JSON.stringify(panel));
    t.ck("and it got the same tap-to-scan", panel.tappable, JSON.stringify(panel));

    await page.click(".cx-code .qrp-tap");
    await page.waitForSelector(".qrf", { timeout: 4000 });
    t.ck("which opens the same full-screen code",
      (await page.$eval(".qrf-txt", (n) => n.textContent)) === CODE.code);
    await page.keyboard.press("Escape");
    await wait(200);
    t.ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }

  // ---- the drawer on a phone ------------------------------------------
  console.log("\n-- the drawer on a phone, where it will actually be used --");
  {
    api.calls.length = 0;
    const { ctx, page, crashes } = await open({ width: 390, height: 900 });
    await page.click(".nav-burger");
    await wait(300);
    t.ck("the drawer opened", await page.$eval(".tabs", (n) => n.classList.contains("open")));

    await page.click(".drawer-qr .um-qr");
    await page.waitForSelector(".drawer-qr .qrp .qr", { timeout: 4000 });
    t.ck("the drawer did NOT shut over it",
      await page.$eval(".tabs", (n) => n.classList.contains("open")));

    // The second half of the same trap: the drawer closes on any button,
    // and Copy link is a button.
    await page.click(".drawer-qr .qrp button");
    await wait(250);
    const after = await page.evaluate(() => ({
      open: document.querySelector(".tabs").classList.contains("open"),
      stillThere: !!document.querySelector(".drawer-qr .qrp .qr"),
    }));
    t.ck("nor over Copy link", after.open && after.stillThere, JSON.stringify(after));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }

  // ---- a seat with no company -----------------------------------------
  console.log("\n-- an account that hires but is not hired --");
  {
    kind = "property_manager";
    api.calls.length = 0;
    const { ctx, page } = await open({ width: 1200, height: 1000 });
    await page.click(".user-btn");
    await wait(250);
    const items = await text(page, ".user-menu button");
    t.ck("is not offered a code it cannot have",
      !items.some((x) => /My QR code/i.test(x)), items.join(" | "));
    t.ck("and nothing went looking for one",
      !api.calls.includes("/api/connect/code"), api.calls.join(" "));
    t.ck("nor is the phone's copy in the markup",
      (await page.$(".drawer-qr")) === null);
    t.ck("My account is still there", items.some((x) => /My account/i.test(x)), items.join(" | "));
    await ctx.close();
    kind = "general_contractor";
  }

  // ---- and when the call fails ----------------------------------------
  console.log("\n-- when the code cannot be fetched --");
  {
    codeAnswer = () => [503, { error: "migration_needed", migration: "030_connect_requests" }];
    const { ctx, page, crashes } = await open({ width: 1200, height: 1000 });
    await page.click(".user-btn");
    await wait(250);
    await page.click(".um-qr");
    await wait(900);
    const said = await page.$eval(".qrp", (n) => n.innerText);
    t.ck("it says which migration, not 'loading' for ever",
      /030_connect_requests/.test(said), said.replace(/\s+/g, " ").slice(0, 120));
    t.ck("and offers a retry", /try again/i.test(said), said.replace(/\s+/g, " ").slice(0, 120));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
    codeAnswer = () => [200, CODE];
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
