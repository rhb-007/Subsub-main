// 077. THE SUB PASSPORT, drawn in a browser.
//
// What is pinned is what the server suite cannot see:
//
//   THE PUBLIC PAGE IS A PHONE PAGE: no sideways scroll at 390px, the badge
//   with its own line under it, the trades, the license, the insurer and its
//   date, "W-9 On file" and nothing more, a QR code of its own address, and
//   share by text, email and copy.
//
//   THE BADGE IS DRAWN ONLY WHEN THE SERVER SAYS IT IS EARNED -- a page that
//   is not verified says so rather than wearing the badge.
//
//   THE CTA SAYS THE WORDS ASKED FOR and carries the sub's own code with the
//   passport channel, which is what credits the sub.
//
//   ONE DESIGN WITH THE COMPLIANCE PACK PAGE: SubSub's logo outside the card,
//   top left; the headline with the city and state; the QR code and share
//   icons top right; then one column -- the documents as rows, the BBB card,
//   the connect box.
//
//   CONNECTING IS THE APPROVAL: signed out, the page offers sign-in and a free
//   signup credited to the sub; a hiring admin connects and the POST goes;
//   connected, every document and the agreement open.
//
//   THE SUB'S OWN SCREEN publishes, and answers a request in one press.
//
//   node --no-warnings scripts/passport-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-passport-test");
const WEB = 5461, API = 9161;
const t = tally();

const SLUG = "bay-roofing-k7q2m";
const NOT_CONNECTED = () => ({ status: "none", mayRequest: true, mayConnect: true, connectPending: false, files: [] });
const S = { verified: true, wallet: true, access: NOT_CONNECTED(), kind: "general_contractor",
  published: false, posts: [], pendingReq: true, bbb: true,
  myBbb: { linked: false, live: true } };
const PAGE = () => ({
  slug: SLUG, name: "Bay Roofing", city: "Tacoma", state: "WA", place: "Tacoma, WA 98407",
  trades: [{ id: "roofing", label: "Roofing" }, { id: "gutters", label: "Gutters" }],
  area: "Tacoma, Seattle", foundedYear: 2012, years: "In business since 2012 · 14 years",
  about: "Residential re-roofs, two crews.",
  contact: "Rae Bay", contactTitle: "Owner", phone: "2065550100", email: "rae@bay.test", zip: "98407", ubi: "604123456", bond: true,
  license: { number: "BAYROR*123", text: S.verified ? "Washington L&I registration active" : "License not verified by SubSub", ok: S.verified },
  insurance: { carrier: "Acme Mutual", expiresOn: "2027-03-04", text: "Insurance on file through Mar 4, 2027" },
  w9: true, photos: [{ id: "ph1", caption: "New roof, Tacoma" }, { id: "ph2", caption: "Gutters, Bellevue" },
    { id: "ph3", caption: "Siding, Kent" }],
  badge: S.verified
    ? { verified: true, name: "SubSub Verified", line: "Washington L&I registration active · Insurance on file through Mar 4, 2027" }
    : { verified: false, name: null, line: "License not verified by SubSub · Insurance on file through Mar 4, 2027" },
  refCode: "K7Q2MXRB",
  bbb: S.bbb === "link" ? { url: "https://www.bbb.org/us/wa/tacoma/profile/roofing/bay-roofing-1296-1000123456",
    rating: null, accredited: false, checkedOn: null }
    : S.bbb ? { url: "https://www.bbb.org/us/wa/tacoma/profile/roofing/bay-roofing-1296-1000123456",
    rating: "A+", accredited: true, checkedOn: "2026-10-15" } : null,
});
const acct = () => ({
  id: "acc_x", name: S.kind === "subcontractor" ? "Bay Roofing" : "Outerhome", subdomain: "bayroof", kind: S.kind,
  plan: "basic", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"], logoKey: null,
  subscriptionStatus: "active", user: { id: "u_rb", name: "R Braun", email: "rb@x.test", role: S.role || "admin" },
});
const MINE = () => ({
  passport: { slug: SLUG, url: `https://app.subsub.work/p/${SLUG}`, published: S.published, trades: ["roofing"],
    foundedYear: 2012, about: "Residential re-roofs.", viewCount: 3 },
  preview: PAGE(), photos: [], bbb: S.myBbb, wallet: S.wallet,
  access: S.pendingReq ? [{ id: "pa1", accountId: "acc_gc", accountName: "Outerhome", requesterName: "Dana Ruiz",
    message: "For the Pine St job", status: "pending", requestedAt: "2026-10-09 10:00:00" }]
    : [{ id: "pa1", accountId: "acc_gc", accountName: "Outerhome", status: "approved", requestedAt: "2026-10-09 10:00:00" }],
});

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === `/api/public/passport/${SLUG}`) return [200, PAGE()];
  if (path.startsWith("/api/public/passport/")) return [404, { error: "not_found" }];
  if (path === `/api/passport/${SLUG}/access` && method === "GET") return [200, S.access];
  if (path === `/api/passport/${SLUG}/connect` && method === "POST") {
    S.posts.push({ path, body }); S.access = { ...S.access, connectPending: true, mayConnect: false };
    return [201, { id: "cr1", status: "pending" }];
  }
  if (path === `/api/passport/${SLUG}/access` && method === "POST") {
    S.posts.push({ path, body }); S.access = { status: "pending", mayRequest: false, files: [] };
    return [201, { ok: true, status: "pending" }];
  }
  if (path === "/api/my-passport" && method === "GET") return [200, MINE()];
  if (path === "/api/connect/code") return [200, { code: "ABCD234567", url: "https://app.subsub.work/?connect=ABCD234567",
    passport: { slug: SLUG, url: `https://app.subsub.work/p/${SLUG}`, published: S.published } }];
  if (path === "/api/my-passport" && method === "PUT") {
    S.posts.push({ path, body }); if (typeof body.published === "boolean") S.published = body.published;
    return [200, { passport: MINE().passport }];
  }
  if (path === "/api/my-passport/bbb" && method === "PUT") {
    S.posts.push({ path, body });
    S.myBbb = { linked: true, live: true, url: body.url, rating: "A", accredited: false, checkedOn: "2026-10-17", shown: true, why: null };
    return [200, { bbb: S.myBbb, checked: { ok: true, error: null } }];
  }
  if (path === "/api/my-passport/access/pa1" && method === "POST") {
    S.posts.push({ path, body }); S.pendingReq = false; return [200, { ok: true, status: "approved" }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/my-company") return S.kind === "subcontractor" ? [200, { companyId: "cmp_bay", company: "Bay Roofing",
    contact: "R", email: "rb@x.test", phone: "", license: "", ubi: "", city: "Tacoma", state: "WA", zip: "98407",
    coverage: { mode: "cities", cities: [], radii: [] }, docs: {}, findable: true, code: "c", openToHire: true,
    openAnswered: true, url: null, sharesSent: 0, crews: [] }] : [200, { companyId: "cmp_gc", company: "Outerhome",
    contact: "", email: "", phone: "", license: "", ubi: "", city: "", state: "", zip: "", coverage: { mode: "cities", cities: [], radii: [] },
    docs: {}, findable: false, code: "c", openToHire: true, openAnswered: true, url: null, sharesSent: 0, crews: [] }];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/account-users") return [200, [{ id: "u_rb", name: "R Braun", email: "rb@x.test",
    phone: null, role: S.role || "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (["/api/jobs", "/api/subs", "/api/properties", "/api/invites", "/api/clients", "/api/visits",
    "/api/my-connect-requests", "/api/connect-requests", "/api/property-transfers", "/api/my-quotes",
    "/api/doc-shares", "/api/inspections", "/api/change-orders", "/api/tenants", "/api/agreements"].includes(path)) return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();
const PHONE = { width: 390, height: 844 };

const readPage = (page) => page.evaluate(() => {
  const c = document.querySelector(".pp-card");
  const cta = c?.querySelector(".pp-cta a");
  const share = [...(c?.querySelectorAll(".pp-head-side .pp-share a, .pp-head-side .pp-share button") || [])];
  return {
    there: !!c, h1: c?.querySelector("h1")?.innerText || "",
    badge: c?.querySelector(".pp-badge-name")?.innerText.trim() || "",
    badgeOn: !!c?.querySelector(".pp-badge.on"),
    line: c?.querySelector(".pp-badge-line")?.innerText || "",
    trades: [...(c?.querySelectorAll(".pp-trades li") || [])].map((l) => l.innerText),
    facts: (c?.querySelector(".pp-docs")?.innerText || "").replace(/\s+/g, " "),
    lic: (() => { const l = c?.querySelector(".pp-docs .pack-lic"); return l ? { ok: l.classList.contains("ok"), t: l.innerText.replace(/\s+/g, " ") } : null; })(),
    qr: !!c?.querySelector("svg.qr"),
    head: (() => {
      const hd = c?.querySelector(".pp-head"), b = hd?.querySelector(".pp-head-cta, .pp-head-chip"), h = hd?.querySelector("h1");
      if (!b || !h) return null;
      const r = b.getBoundingClientRect(), hr = hd.getBoundingClientRect();
      return { t: b.innerText.trim(), chip: b.classList.contains("pp-head-chip"),
        right: hr.right - r.right < 4, top: r.top < h.getBoundingClientRect().bottom };
    })(),
    order: (() => {
      const y = (sel) => c?.querySelector(sel)?.getBoundingClientRect().top ?? null;
      return { box: y(".pp-access"), facts: y(".pp-facts"), photos: y(".pp-photos"), contact: y(".pp-contact") };
    })(),
    share: share.map((x) => ({ t: x.getAttribute("aria-label") || "", tip: x.getAttribute("title") || "", words: x.innerText.trim(),
      href: x.getAttribute("href"), h: x.getBoundingClientRect().height })),
    side: (() => {
      const hd = c?.querySelector(".pp-head"), q = hd?.querySelector(".pp-head-side svg.qr"),
        b = hd?.querySelector(".pp-head-cta, .pp-head-chip"), h = hd?.querySelector("h1");
      if (!hd || !q || !b || !h) return null;
      const qr = q.getBoundingClientRect(), br = b.getBoundingClientRect(), hr = hd.getBoundingClientRect();
      return { qrLeft: qr.left - hr.left < 8, qrRight: hr.right - qr.right < 8, qrTop: qr.top < h.getBoundingClientRect().bottom,
        nameRightOfQr: h.getBoundingClientRect().left >= qr.right - 1,
        ctaBelowQr: br.top >= qr.bottom - 1, ctaRight: hr.right - br.right < 8,
        // On the left under the name and the lede, inside the who column.
        ctaLeft: !!b.closest(".pp-head-who") && Math.abs(br.left - h.getBoundingClientRect().left) < 2
          && br.left >= qr.right - 1,
        ctaUnderLede: br.top >= (hd.querySelector(".pack-lede")?.getBoundingClientRect().bottom ?? 0) - 1 };
    })(),
    place: c?.querySelector(".pp-head .pack-place")?.innerText.trim() || "",
    cols: (() => {
      // One column, the compliance pack page's: the documents, then the BBB
      // card, then the connect box, each the card's full width.
      const d = c?.querySelector(".pp-docs"), a = c?.querySelector(".pp-access"), bb = c?.querySelector(".pp-bbb");
      if (!d || !a) return null;
      const dr = d.getBoundingClientRect(), ar = a.getBoundingClientRect();
      return { oneCol: Math.abs(dr.left - ar.left) < 4 && Math.abs(dr.width - ar.width) < 8 && dr.bottom <= ar.top + 1,
        bbbBetween: !bb || (bb.getBoundingClientRect().top >= dr.bottom - 1 && bb.getBoundingClientRect().bottom <= ar.top + 1),
        noCols: !c.querySelector(".pp-cols, .pp-left"),
        rows: [...d.querySelectorAll(".pack-doc")].map((x) => x.innerText.replace(/\s+/g, " ").trim()),
        what: d.querySelector(".pack-what")?.innerText || "",
        docsHold: !!d.querySelector(".pp-badge") && !!d.querySelector(".pp-facts"),
        docsTitle: d.querySelector("h3")?.textContent.trim() || "",
        emptyBottom: (() => {
          const kids = [...a.children].filter((k) => k.getBoundingClientRect().height > 0);
          const last = kids[kids.length - 1];
          return last ? Math.round(ar.bottom - last.getBoundingClientRect().bottom) : 999;
        })(),
        perkGaps: (() => {
          const li = [...a.querySelectorAll(".pp-perks li")].map((x) => x.getBoundingClientRect());
          const g = li.slice(1).map((r, i) => r.top - li[i].bottom);
          return g.length ? Math.round(Math.max(...g) - Math.min(...g)) : null;
        })(),
        ctaLast: !!a.lastElementChild?.classList.contains("pp-acc-cta") };
    })(),
    cta: cta ? { t: cta.innerText.trim(), href: cta.getAttribute("href") } : null,
    access: (c?.querySelector(".pp-access")?.innerText || "").replace(/\s+/g, " "),
    signup: c?.querySelector(".pp-access a")?.getAttribute("href") || null,
    powered: (() => {
      // SubSub's mark sits outside the card, top LEFT, the compliance pack
      // page's frame; the card opens on a kicker and the company's name.
      const top = document.querySelector(".pack-page > .pack-top"), logo = top?.querySelector(".pack-brand svg.ss-logo");
      const cr = c?.getBoundingClientRect(), lr = logo?.getBoundingClientRect();
      if (!top || !logo || !cr) return null;
      return { mark: logo.querySelectorAll("path").length > 3, outside: !c.contains(logo),
        left: Math.abs(lr.left - cr.left) < 4, above: lr.bottom <= cr.top + 1,
        kicker: c.querySelector(".pp-head .pack-kicker")?.innerText.trim() || "",
        suffix: top.querySelector(".pack-brand .pack-brand-suffix")?.innerText.trim() || "",
        inCardLockup: !!c.querySelector(".pp-powered"),
        h1px: parseFloat(getComputedStyle(c.querySelector("h1")).fontSize) };
    })(),
    contact: (c?.querySelector(".pp-contact")?.innerText || "").replace(/\s+/g, " "),
    tel: c?.querySelector('.pp-contact a[href^="tel:"]')?.getAttribute("href") || null,
    photos: c?.querySelectorAll(".pp-photo img").length || 0,
    bbb: (() => {
      const b = c?.querySelector(".pp-bbb"), box = c?.querySelector(".pp-docs"), facts = c?.querySelector(".pp-docs .pp-facts");
      if (!b) return null;
      const br = b.getBoundingClientRect(), xr = box?.getBoundingClientRect(), fr = facts?.getBoundingClientRect();
      const a = b.querySelector("a.pp-bbb-link");
      return { t: b.innerText.replace(/\s+/g, " ").trim(), href: a?.getAttribute("href") || null,
        target: a?.getAttribute("target"), rel: a?.getAttribute("rel"),
        grade: b.querySelector(".pp-bbb-grade")?.textContent.trim() || "",
        // Its own card, NOT inside the Compliance pack box: under it, in the
        // same column, with a border of its own.
        inBox: !!box && box.contains(b), belowBox: !!xr && br.top >= xr.bottom - 1,
        ownBorder: parseFloat(getComputedStyle(b).borderTopWidth) >= 1 && parseFloat(getComputedStyle(b).borderBottomWidth) >= 1,
        sep: /Separate from the compliance pack/i.test(b.innerText),
        inCard: br.right <= c.getBoundingClientRect().right + 1,
        notInPhotos: !b.closest(".pp-photos") };
    })(),
    width: Math.round(c?.getBoundingClientRect().width || 0),
    wide: document.documentElement.scrollWidth > window.innerWidth + 1,
    robots: document.querySelector('meta[name="robots"]')?.content || "",
    text: (c?.innerText || "").replace(/\s+/g, " "),
  };
});

try {
  console.log("\n-- the public page, signed out, on a phone --");
  {
    const { ctx, page, crashes } = await visitApp(browser, { host: "app", webPort: WEB, viewport: PHONE, path: `/p/${SLUG}` });
    await wait(2000);
    const r = await readPage(page);
    t.ck("the page opens on the sub", r.there && r.h1 === "Bay Roofing", r.h1);
    t.ck("the badge is drawn, with what it rests on under it",
      r.badgeOn && /SubSub Verified/.test(r.badge) && /Washington L&I registration active/.test(r.line) && /through Mar 4, 2027/.test(r.line), r.line);
    t.ck("the trades", r.trades.join() === "Roofing,Gutters", r.trades.join());
    t.ck("the license, the insurer and the W-9 as Yes",
      /BAYROR\*123/.test(r.facts) && /Acme Mutual/.test(r.facts) && /W-9 On file/.test(r.facts), r.facts);
    t.ck("SubSub's logo sits outside the card, top left, like the compliance pack page",
      !!r.powered?.mark && r.powered.outside && r.powered.left && r.powered.above && !r.powered.inCardLockup, JSON.stringify(r.powered));
    t.ck("the card opens on a kicker and a big headline", /^subcontractor$/i.test(r.powered?.kicker || "") && r.powered.h1px >= 28, JSON.stringify(r.powered));
    t.ck("the license is the green box at a glance", r.lic?.ok && /License verified/.test(r.lic.t) && /BAYROR\*123/.test(r.lic.t), JSON.stringify(r.lic));
    t.ck("the header's CTA names the sub", r.head?.t === "Sign in to add Bay Roofing" && !r.head.chip, JSON.stringify(r.head));
    t.ck("a QR code of its own address in the header", !!r.qr && !!r.side, JSON.stringify(r.side));
    t.ck("the CTA is on the left, under the name and the lede", !!r.side?.ctaUnderLede && !!r.side.ctaLeft, JSON.stringify(r.side));
    t.ck("one column: the documents, the BBB card, then the connect box",
      !!r.cols?.oneCol && r.cols.bbbBetween && r.cols.noCols && r.cols.docsHold, JSON.stringify(r.cols));
    t.ck("the city and state are part of the headline", r.place === "Tacoma, WA 98407", r.place);
    t.ck("a row per document, as on the pack page",
      r.cols?.rows.length === 3 && /Acme Mutual/.test(r.cols.rows[0]) && r.cols.rows.every((x) => /On file/.test(x)), JSON.stringify(r.cols?.rows));
    t.ck("and what is in the pack, named", /certificate of insurance/.test(r.cols?.what || ""), r.cols?.what);
    t.ck("the connect box is above the photos", r.order.box < r.order.photos, JSON.stringify(r.order));
    t.ck("no contact block, and no name, phone or email anywhere on the page, even when the reply carries them",
      r.order.contact === null && !r.tel && !/Rae Bay|rae@bay\.test|2065550100/.test(r.text), r.contact);
    t.ck("the code sits top LEFT, beside the name, on a phone too", !!r.side?.qrLeft && r.side.qrTop && r.side.nameRightOfQr, JSON.stringify(r.side));
    t.ck("the bond, the UBI and where they are based",
      /Surety bond On file/.test(r.facts) && /UBI 604123456/.test(r.facts) && /98407/.test(r.facts), r.facts);
    t.ck("the logo reads SubSub | Passport", r.powered?.suffix === "Passport", JSON.stringify(r.powered));
    t.ck("the ZIP is said once, not twice", (r.facts.match(/98407/g) || []).length === 1, r.facts);
    t.ck("never a file name", !/\.pdf/.test(r.text), r.text);
    t.ck("share by text, email and copy, as icons under the code",
      r.share.some((s) => s.t === "Text" && s.href?.startsWith("sms:?&body=") && decodeURIComponent(s.href).includes(`/p/${SLUG}`))
      && r.share.some((s) => s.t === "Email" && s.href?.startsWith("mailto:?subject="))
      && r.share.some((s) => s.t === "Copy link"), JSON.stringify(r.share));
    t.ck("icons only, each with its word as a tooltip",
      r.share.length >= 3 && r.share.every((s) => s.words === "" && s.tip === s.t), JSON.stringify(r.share));
    t.ck("no Hire subcontractors box at the foot", r.cta === null && !/Hire subcontractors\?/.test(r.text), r.cta?.t);
    t.ck("signed out, connecting is offered behind a sign-in", /Sign in to add Bay Roofing/.test(r.access) && /Add Bay Roofing to your roster/.test(r.access) && !/Certificate of insurance/.test(r.access), r.access);
    t.ck("and a free signup credited to this sub", r.signup === "https://subsub.work/gc?ref=K7Q2MXRB&via=passport", r.signup);
    t.ck("photos of their work", r.photos === 3);
    t.ck("the BBB rating is drawn with the grade, accreditation and where it came from",
      /BBB rating/i.test(r.bbb?.t) && /A\+/.test(r.bbb.t) && /Accredited Business/.test(r.bbb.t) && /Rating from BBB/.test(r.bbb.t) && /checked Oct 15/.test(r.bbb.t), r.bbb?.t);
    t.ck("and links the sub's BBB profile in a new tab", /bbb\.org\/.*1296-1000123456$/.test(r.bbb?.href || "") && r.bbb.target === "_blank" && /noopener/.test(r.bbb.rel), JSON.stringify(r.bbb));
    t.ck("it is its own card under the Compliance pack, not part of it",
      !!r.bbb && !r.bbb.inBox && r.bbb.belowBox && r.bbb.ownBorder && r.bbb.notInPhotos && r.bbb.inCard, JSON.stringify(r.bbb));
    t.ck("and says it is separate from the pack", !!r.bbb?.sep, r.bbb?.t);
    t.ck("no sideways scroll at 390px", !r.wide);
    t.ck("noindex on the page", r.robots === "noindex");
    // Every document row asks, as the compliance pack page's Open does.
    const btns = await page.evaluate(() => [...document.querySelectorAll(".pp-docs .pack-doc")].map((d) => d.querySelector(".pp-doc-open")?.innerText.trim() || null));
    t.ck("every document row has a button", btns.length === 3 && btns.every((b) => b === "Open"), JSON.stringify(btns));
    await page.evaluate(() => document.querySelectorAll(".pp-docs .pp-doc-open")[1]?.click());
    await wait(500);
    const g = await page.evaluate(() => {
      const m = document.querySelector(".pp-doc-gate");
      if (!m) return null;
      const a = [...m.querySelectorAll(".pgm-actions a, .pgm-actions button")];
      return { h: m.querySelector("h3")?.innerText, acts: a.map((x) => x.innerText.trim()), href: a[0]?.getAttribute("href") };
    });
    t.ck("pressing one opens a modal to sign in or create an account",
      g?.h === "Sign in to open Surety bond" && g.acts.join() === "Create account,Sign in", JSON.stringify(g));
    t.ck("and Create account is the signup credited to this sub", g?.href === "https://subsub.work/gc?ref=K7Q2MXRB&via=passport", g?.href);
    await page.evaluate(() => [...document.querySelectorAll(".pp-doc-gate button")].find((b) => b.innerText.trim() === "Sign in")?.click());
    await wait(600);
    t.ck("its Sign in remembers to come back here",
      await page.evaluate(() => sessionStorage.getItem("ss_after_login")) === `/p/${"bay-roofing-k7q2m"}`);
    await page.evaluate(() => sessionStorage.removeItem("ss_after_login"));
    await page.goto(new URL(`/p/${SLUG}`, page.url()).href, { waitUntil: "domcontentloaded" }).catch(() => {});
    await wait(2000);
    await page.evaluate(() => document.querySelector(".pp-head-cta")?.click());
    await wait(800);
    t.ck("the header's Connect signs in and remembers where to come back to",
      await page.evaluate(() => sessionStorage.getItem("ss_after_login")) === `/p/${"bay-roofing-k7q2m"}`);
    t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the public page on a wide screen --");
  {
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, viewport: { width: 1180, height: 900 }, path: `/p/${SLUG}` });
    await wait(2000);
    const r = await readPage(page);
    t.ck("the code sits at the top left, level with the name", !!r.side?.qrLeft && r.side.qrTop && r.side.nameRightOfQr && !r.side.qrRight, JSON.stringify(r.side));
    t.ck("the CTA is on the left under the name, not under the code", !!r.side?.ctaLeft && r.side.ctaUnderLede && !r.side.ctaRight, JSON.stringify(r.side));
    t.ck("still one column on a wide screen, the pack page's width",
      !!r.cols?.oneCol && r.cols.noCols && r.width <= 640, JSON.stringify({ ...r.cols, w: r.width }));
    t.ck("the box is called Compliance pack", r.cols?.docsTitle === "Compliance pack", r.cols?.docsTitle);
    t.ck("the connect box ends on its CTA", !!r.cols?.ctaLast && r.cols.emptyBottom <= 30, JSON.stringify(r.cols));
    t.ck("what connecting gives is listed, evenly spaced", r.cols?.perkGaps !== null && r.cols.perkGaps <= 2, JSON.stringify(r.cols));
    t.ck("the BBB card sits under the Compliance pack, outside it", !!r.bbb && !r.bbb.inBox && r.bbb.belowBox, JSON.stringify(r.bbb));
    t.ck("no sideways scroll", !r.wide);
    // The photos open as a set: previous, next and a count, not one picture
    // with nothing to press but close.
    const lb = () => page.evaluate(() => {
      const b = document.querySelector(".ph-lightbox");
      return b ? { count: (b.querySelector(".phl-count")?.innerText || "").trim(),
        name: (b.querySelector(".phl-name")?.innerText || "").trim(),
        arrows: b.querySelectorAll(".phl-nav").length } : null;
    });
    await page.evaluate(() => document.querySelectorAll(".pp-photo")[1]?.click());
    await wait(300);
    let l = await lb();
    t.ck("tapping the second photo opens it as 2 of 3", l?.count === "2 of 3" && l.name === "Gutters, Bellevue", JSON.stringify(l));
    t.ck("with a previous and a next", l?.arrows === 2, JSON.stringify(l));
    await page.evaluate(() => document.querySelector('.ph-lightbox [aria-label="Next photo"]')?.click());
    await wait(200);
    l = await lb();
    t.ck("Next moves on", l?.count === "3 of 3" && l.name === "Siding, Kent", JSON.stringify(l));
    await page.evaluate(() => document.querySelector('.ph-lightbox [aria-label="Previous photo"]')?.click());
    await page.evaluate(() => document.querySelector('.ph-lightbox [aria-label="Previous photo"]')?.click());
    await wait(200);
    l = await lb();
    t.ck("Previous goes back", l?.count === "1 of 3" && l.name === "New roof, Tacoma", JSON.stringify(l));
    await page.keyboard.press("ArrowLeft");
    await wait(150);
    t.ck("and the arrow keys walk it too, wrapping at the ends", (await lb())?.count === "3 of 3");
    await page.keyboard.press("Escape");
    await wait(150);
    t.ck("Escape closes it", (await lb()) === null);
    await ctx.close();
  }

  console.log("\n-- not verified --");
  {
    S.verified = false; S.bbb = "link";
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, viewport: PHONE, path: `/p/${SLUG}` });
    await wait(1800);
    const r = await readPage(page);
    t.ck("the page is there", r.there);
    t.ck("it does not wear the badge", !r.badgeOn && !/SubSub Verified/.test(r.badge) && /Not verified yet/.test(r.badge), r.badge);
    t.ck("and still says what is and is not on file", /License not verified by SubSub/.test(r.line), r.line);
    // BBB offers no public API, so a linked profile with no live reading is a
    // LINK to bbb.org, and the card claims no grade of its own.
    t.ck("a linked BBB profile with no reading is a link to it, in its own card",
      !!r.bbb && !r.bbb.inBox && /BBB profile/.test(r.bbb.t) && /See BBB profile/.test(r.bbb.t)
      && /1296-1000123456$/.test(r.bbb.href || "") && r.bbb.target === "_blank", JSON.stringify(r.bbb));
    t.ck("and it claims no grade", r.bbb?.grade === "" && !/A\+|Accredited|checked|coming soon|—/.test(r.bbb?.t || "x"), r.bbb?.t);
    S.bbb = false;
    await page.reload(); await wait(1800);
    const r2 = await readPage(page);
    t.ck("with nothing linked there is no BBB card at all", r2.there && r2.bbb === null, JSON.stringify(r2.bbb));
    S.verified = true; S.bbb = true;
    await ctx.close();
  }

  console.log("\n-- an unknown address --");
  {
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, viewport: PHONE, path: "/p/nobody-here-zzzzz" });
    await wait(1600);
    const txt = await page.evaluate(() => document.body.innerText);
    t.ck("it says so", /couldn't find that Passport/.test(txt), txt.slice(0, 200));
    await ctx.close();
  }

  console.log("\n-- a hiring admin asks --");
  {
    S.kind = "general_contractor";
    const { ctx, page, crashes } = await visitApp(browser, { host: "app", webPort: WEB, viewport: PHONE,
      seat: { userId: "u_rb", accountId: "acc_x" }, path: `/p/${SLUG}` });
    await wait(2400);
    let r = await readPage(page);
    t.ck("signed in, the page offers to add them to the roster", /Add Bay Roofing to your roster/.test(r.access) && !/Ask to see/.test(r.access), r.access);
    await page.evaluate(() => {
      const i = document.querySelector(".pp-access input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "For the Pine St job");
      i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const before = S.posts.length;
    await page.evaluate(() => [...document.querySelectorAll(".pp-access button")].find((b) => b.innerText.trim() === "Add to your roster")?.click());
    await wait(900);
    const sent = S.posts.slice(before);
    t.ck("connecting posts to the connect route with the note",
      sent.length === 1 && sent[0].path.endsWith("/connect") && sent[0].body.message === "For the Pine St job", JSON.stringify(sent));
    r = await readPage(page);
    t.ck("and then says it is waiting", /You asked to add Bay Roofing to your roster/.test(r.access), r.access);
    t.ck("and the header says Requested rather than Connect", r.head?.chip && r.head.t === "Requested", JSON.stringify(r.head));
    S.access = NOT_CONNECTED();
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(2200);
    const before2 = S.posts.length;
    await page.evaluate(() => document.querySelector(".pp-head-cta")?.click());
    await wait(1200);
    const sent2 = S.posts.slice(before2);
    t.ck("the header's Connect connects in one press", sent2.length === 1 && sent2[0].path.endsWith("/connect"), JSON.stringify(sent2));
    r = await readPage(page);
    t.ck("and rings the box it sends you to", await page.evaluate(() => document.querySelector(".pp-access")?.classList.contains("ring")));
    S.access = NOT_CONNECTED();
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(2200);
    await page.evaluate(() => document.querySelector(".pp-docs .pp-doc-open")?.click());
    await wait(500);
    const g2 = await page.evaluate(() => {
      const m = document.querySelector(".pp-doc-gate");
      return m ? { h: m.querySelector("h3")?.innerText, acts: [...m.querySelectorAll(".pgm-actions button")].map((x) => x.innerText.trim()) } : null;
    });
    t.ck("signed in, a document row says connecting opens it, with Connect", g2?.h === "Add Bay Roofing to open Certificate of insurance"
      && g2.acts.join() === "Add Bay Roofing to your roster", JSON.stringify(g2));
    await page.evaluate(() => document.querySelector(".pp-doc-gate .modal-close, .pp-doc-gate [aria-label=Close]")?.click());
    // A reader who cannot connect sees the same offer, greyed out, with the
    // reason under it -- not a bare sentence where the offer was.
    S.access = { status: "none", reason: "not_a_hiring_account", mayRequest: false, mayConnect: false, connectPending: false, files: [] };
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(2200);
    const bl = await page.evaluate(() => {
      const box = document.querySelector(".pp-access"), head = document.querySelector(".pp-head-cta");
      const btn = [...(box?.querySelectorAll("button") || [])].find((b) => b.innerText.trim() === "Add to your roster");
      return { t: (box?.innerText || "").replace(/\s+/g, " "), perks: box?.querySelectorAll(".pp-perks li").length || 0,
        btn: !!btn, btnOff: !!btn?.disabled, inputOff: !!box?.querySelector(".pp-blocked input")?.disabled,
        btnBg: btn ? getComputedStyle(btn).backgroundColor : null,
        head: !!head, headOff: !!head?.disabled, headT: head?.innerText.trim() || "",
        headBg: head ? getComputedStyle(head).backgroundColor : null };
    });
    t.ck("a reader who cannot connect still sees the whole offer", bl.perks === 4 && /Add Bay Roofing to your roster/.test(bl.t) && bl.btn, JSON.stringify(bl));
    t.ck("with the box's Connect and note greyed out", bl.btnOff && bl.inputOff && /211, 214, 209/.test(bl.btnBg || ""), JSON.stringify(bl));
    t.ck("and the reason under it", /Only an account that hires can connect/.test(bl.t), bl.t);
    t.ck("the header's Connect is there and greyed out too", bl.head && bl.headOff && /Add Bay Roofing to your roster/.test(bl.headT) && /211, 214, 209/.test(bl.headBg || ""), JSON.stringify(bl));
    const before3 = S.posts.length;
    await page.evaluate(() => { document.querySelector(".pp-head-cta")?.click(); [...document.querySelectorAll(".pp-access button")].find((b) => b.innerText.trim() === "Add to your roster")?.click(); });
    await wait(800);
    t.ck("and pressing either sends nothing", S.posts.length === before3, JSON.stringify(S.posts.slice(before3)));
    // The reported case: signed in, but not a seat that can connect at all.
    S.role = "tenant"; S.access = NOT_CONNECTED();
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(2400);
    const nt = await page.evaluate(() => {
      const box = document.querySelector(".pp-access"), head = document.querySelector(".pp-head-cta");
      const btn = [...(box?.querySelectorAll("button") || [])].find((b) => b.innerText.trim() === "Add to your roster");
      return { t: (box?.innerText || "").replace(/\s+/g, " "), perks: box?.querySelectorAll(".pp-perks li").length || 0,
        btnOff: !!btn?.disabled, headOff: !!head?.disabled };
    });
    t.ck("a seat that cannot connect sees the offer greyed out with the reason",
      nt.perks === 4 && nt.btnOff && nt.headOff && /Only an admin or a project manager/.test(nt.t), JSON.stringify(nt));
    S.role = "admin";
    S.access = { status: "connected", mayRequest: false, mayConnect: false, files: [
      { kind: "insurance", fileName: "coi.pdf" }, { kind: "bond", fileName: "bond.pdf" }, { kind: "w9", fileName: "w9.pdf" },
      { kind: "contract", fileName: "signed.pdf" }],
      agreement: { status: "countersigned", document: { title: "SubSub Standard Subcontractor Agreement",
        sections: [{ id: "s1", heading: "1. Parties", paragraphs: ["Outerhome and Bay Roofing."] }] } } };
    await page.reload({ waitUntil: "domcontentloaded" });
    await wait(2200);
    r = await readPage(page);
    t.ck("connected, every document opens with nothing asked",
      ["Certificate of insurance", "Surety bond", "W-9", "Signed agreement"].every((w) => r.access.includes(w))
      && /Bay Roofing is on your roster/.test(r.access) && !/Add Bay Roofing to/.test(r.access)
      && !/\bConnect\b(?! ?ed)/.test(r.access.replace(/Connected/g, "")), r.access);
    t.ck("connected, the header says so instead of offering Connect", r.head?.chip && r.head.t === "On your roster", JSON.stringify(r.head));
    t.ck("and the SubSub agreement is there to read and download",
      /SubSub Standard Subcontractor Agreement/.test(r.access) && /Read the agreement/.test(r.access) && /Download/.test(r.access), r.access);
    await page.evaluate(() => [...document.querySelectorAll(".pp-access button")].find((b) => /Read the agreement/.test(b.innerText))?.click());
    await wait(400);
    r = await readPage(page);
    t.ck("reading it draws the document", /1\. Parties/.test(r.access) && /Outerhome and Bay Roofing/.test(r.access), r.access);
    t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the sub's own screen --");
  {
    S.kind = "subcontractor"; S.published = false; S.pendingReq = true;
    const { ctx, page, crashes } = await visitApp(browser, { host: "bayroof", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_x" }, viewport: { width: 1200, height: 1700 } });
    await wait(2600);
    await page.evaluate(() => [...document.querySelectorAll("nav button")].find((b) => /^(My account|Account)$/.test(b.innerText.trim()))?.click());
    await wait(900);
    const tabs = await page.evaluate(() => [...document.querySelectorAll(".pane-tabs button, .acc-tabs button, .tabs button")].map((b) => b.innerText.trim()));
    const hasTab = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === "Passport");
      if (b) b.click();
      return !!b;
    });
    t.ck("Account has a Passport tab", hasTab, JSON.stringify(tabs));
    await wait(1200);
    const edit = await page.evaluate(() => ({
      there: !!document.querySelector(".pp-edit"),
      url: document.querySelector(".pp-url")?.innerText || "",
      pub: [...document.querySelectorAll(".pp-pub button")].map((b) => b.innerText.trim()),
      req: (document.querySelector(".pp-requests")?.innerText || "").replace(/\s+/g, " "),
    }));
    t.ck("it opens the editor with the address", edit.there && edit.url.endsWith(`/p/${SLUG}`), JSON.stringify(edit));
    t.ck("private until published", edit.pub.some((x) => /Publish my Passport/.test(x)));
    t.ck("a waiting request names who asked and why", /Outerhome/.test(edit.req) && /Dana Ruiz/.test(edit.req) && /Pine St/.test(edit.req), edit.req);
    let before = S.posts.length;
    await page.evaluate(() => [...document.querySelectorAll(".pp-pub button")].find((b) => /Publish/.test(b.innerText))?.click());
    await wait(900);
    let sent = S.posts.slice(before);
    t.ck("publishing posts published:true", sent.some((p) => p.path === "/api/my-passport" && p.body.published === true), JSON.stringify(sent));
    // The Apple Wallet card: offered once published and only when the server
    // can sign one. Before publishing the route answers 404, so no button.
    const walletHref = () => page.evaluate(() => document.querySelector(".pp-wallet-btn")?.getAttribute("href") || null);
    const wBefore = edit.pub.some((x) => /Publish my Passport/.test(x));
    const wAfter = await walletHref();
    t.ck("once published, Add to Apple Wallet links the signed pass",
      wBefore && wAfter && wAfter.endsWith(`/public/passport/${SLUG}/wallet.pkpass`), String(wAfter));
    // The server could sign here, so only the taking down hides the button.
    await page.evaluate(() => [...document.querySelectorAll(".pp-pub button")].find((b) => /Take it down/.test(b.innerText))?.click());
    await wait(900);
    t.ck("taken down, there is no card to add", (await walletHref()) === null);
    S.wallet = false;
    await page.evaluate(() => [...document.querySelectorAll(".pp-pub button")].find((b) => /Publish/.test(b.innerText))?.click());
    await wait(900);
    t.ck("published but the server cannot sign: no button onto a refusal", (await walletHref()) === null
      && await page.evaluate(() => !!document.querySelector(".pp-pub")));
    S.wallet = true;
    before = S.posts.length;
    await page.evaluate(() => [...document.querySelectorAll(".pp-requests button")].find((b) => /Share them/.test(b.innerText))?.click());
    await wait(900);
    sent = S.posts.slice(before);
    t.ck("sharing is one press, and it approves", sent.length === 1 && sent[0].path === "/api/my-passport/access/pa1"
      && sent[0].body.action === "approve", JSON.stringify(sent));
    const after = await page.evaluate(() => (document.querySelector(".pp-edit")?.innerText || "").replace(/\s+/g, " "));
    t.ck("and then it can be stopped", /Stop sharing/.test(after), after.slice(-300));
    const bb = await page.evaluate(() => (document.querySelector(".pp-bbb-panel")?.innerText || "").replace(/\s+/g, " "));
    t.ck("the Passport tab offers a BBB profile link", /Your BBB profile address/.test(bb), bb);
    before = S.posts.length;
    await page.evaluate(() => {
      const i = document.querySelector(".pp-bbb-form input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "https://www.bbb.org/us/wa/t/profile/r/bay-1296-1000123456");
      i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(200);
    await page.evaluate(() => [...document.querySelectorAll(".pp-bbb-form button")].find((b) => /Link profile/.test(b.innerText))?.click());
    await wait(900);
    sent = S.posts.slice(before);
    const bb2 = await page.evaluate(() => (document.querySelector(".pp-bbb-panel")?.innerText || "").replace(/\s+/g, " "));
    t.ck("linking sends the address and then says what shows", sent.length === 1 && sent[0].path === "/api/my-passport/bbb"
      && /1296-1000123456/.test(sent[0].body.url) && /Showing A/.test(bb2) && /Remove/.test(bb2), JSON.stringify(sent) + " " + bb2);
    t.ck("what is still blank is named", /Fill these in/.test(after) && /Photos of your work/.test(after), after.slice(0, 600));
    // My Passport QR, on Profile, is the Passport now.
    await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === "Profile")?.click());
    await wait(1200);
    const qr = await page.evaluate(() => ({
      url: document.querySelector(".cx-code-url")?.innerText || "",
      code: document.querySelector(".cx-code-txt")?.innerText || "",
      svg: !!document.querySelector(".cx-code svg"),
    }));
    t.ck("My Passport QR is the Passport's address", qr.svg && qr.url === `https://app.subsub.work/p/${SLUG}` && !qr.code, JSON.stringify(qr));
    t.ck("and nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close(); web.close(); api.close();
}
t.done();
