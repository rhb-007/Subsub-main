// THE CONTRACTOR CARD IS TABBED, AND ITS AGREEMENT TAB SAYS WHEN IT WENT AND
// CAN SEND IT AGAIN.
//
// Reported as "too long of a scrolling modal" and "should be able to resend
// subsub agreement, view agreement ... annotate when it was originally sent".
// Driven in a browser because both halves are only true as drawn:
//
//   WHO THEY ARE AND WHETHER THEY CAN WORK STAY ON EVERY TAB. A tab bar that
//   hid "Not assignable yet" behind Compliance would make the card's most
//   important line a thing somebody has to go looking for.
//
//   ONE PANE AT A TIME. Measured as drawn (offsetParent), because the panes are
//   hidden rather than unmounted and a DOM query finds all of them either way.
//
//   THE SENT DATE AND RESEND ARE ON THE AGREEMENT TAB, AND RESEND POSTS.
//   A button that renders and is wired to nothing passes every other check.
//
//   node --no-warnings scripts/sub-tabs-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-subtabs-test");
const WEB = 5601, API = 9301;
const t = tally();

const acct = () => ({
  id: "acc_x", name: "Sound Property Management", subdomain: "soundpm", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "usr_r", name: "Christopher Lane", email: "chris@x.test", role: "admin" },
});
const USERS = () => [{ id: "usr_r", name: "Christopher Lane", email: "chris@x.test", phone: null,
  role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }];

const SUB = () => ({
  id: "cmp_h", engagementId: "en_h", accountId: "acc_x",
  company: "Pike Roofing", contact: "Dale Ruiz", phone: "(206)555-0144",
  email: "dale@pike.test", city: "Seattle", state: "WA", zip: "98101", license: "",
  licenseCheck: null, crews: [], coverage: { mode: "cities", cities: ["Seattle"] },
  available: true, unavailableDays: [], warranty: null,
  insurance: 0, bond: 0, contract: 0, w9: 0, docFiles: {},
  notify: { email: true, sms: false }, docReview: {},
  categories: ["roofing"], caps: [], rating: null, ratedJobs: 0, accepted: 0, declined: 0,
  notes: "", status: "active", propertyIds: [], hasPortal: false, answersForItself: false,
  autoSchedule: false, engagedAs: null, docs: {},
  docState: "missing", docAssignable: false, docSoonest: null,
  agreement: { id: "ag1", status: "sent", source: "subsub_standard", waitingOn: "sub_sign",
    inForce: false, issuedAt: "2026-10-03 15:00:00" },
});

const DOC = { title: "SubSub Standard Subcontractor Agreement", templateId: "subsub-standard",
  templateVersion: "1.2.0", reviewed: null,
  sections: [{ id: "s1", heading: "1. Parties", paragraphs: ["Sound Property Management and Pike Roofing."] }] };
let SENDS = [{ kind: "issued", at: "2026-10-03 15:00:00", by: "Christopher Lane", to: "dale@pike.test", emailed: true }];
const AGREEMENT = () => ({
  agreement: { id: "ag1", status: "sent", source: "subsub_standard", waitingOn: "sub_sign",
    inForce: false, issuedAt: "2026-10-03 15:00:00", document: DOC, sends: SENDS },
  previous: null, preview: DOC, previewTerms: {}, parties: {}, fields: [],
});

const calls = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/account-users") return [200, USERS()];
  if (path === "/api/subs") return [200, [SUB()]];
  if (path === "/api/subs/cmp_h/agreement" && method === "GET") return [200, AGREEMENT()];
  if (path === "/api/agreements/ag1/resend" && method === "POST") {
    calls.push("resend");
    SENDS = [...SENDS, { kind: "resent", at: "2026-10-20 15:00:00", by: "Christopher Lane", to: "dale@pike.test", emailed: true }];
    return [200, { ok: true, to: "dale@pike.test", agreement: AGREEMENT().agreement }];
  }
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  if (path === "/api/jobs" || path === "/api/invites" || path === "/api/properties"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/tenants" || path === "/api/clients" || path === "/api/visits") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const shown = (page) => page.evaluate(() => {
  const m = document.querySelector(".modal .detail");
  if (!m) return null;
  const vis = (el) => !!el && el.offsetParent !== null;
  return {
    tabs: [...m.querySelectorAll(".sd-tabs [role=tab]")].map((b) => ({
      id: b.dataset.tab, on: b.getAttribute("aria-selected") === "true",
      count: (b.querySelector(".sd-tab-count")?.innerText || "").trim() })),
    // A pane is display:contents when shown, so it has no box of its own:
    // its computed display is what says whether it is drawn.
    panes: [...m.querySelectorAll("[data-pane]")].filter((p) => getComputedStyle(p).display !== "none").map((p) => p.dataset.pane),
    name: vis(m.querySelector(".detail-id h2")),
    block: vis(m.querySelector(".detail-doc-block")),
    assign: vis([...m.querySelectorAll("button")].find((b) => /Assign to a job/.test(b.innerText || ""))),
    docRows: [...m.querySelectorAll(".doc-row")].filter(vis).length,
    agr: vis(m.querySelector(".agr-panel")),
    sends: [...m.querySelectorAll(".agr-sends li")].filter(vis).map((li) => (li.innerText || "").replace(/\s+/g, " ").trim()),
    acts: [...m.querySelectorAll(".agr-actions button")].filter(vis).map((b) => (b.innerText || "").replace(/\s+/g, " ").trim()),
    note: (m.querySelector(".agr-note")?.innerText || "").trim(),
    height: m.closest(".modal")?.scrollHeight || 0,
    // The chips row sits right above Capabilities; measured, because a
    // missing margin reads as a design choice in the source.
    // The invite box sat touching the trades row under it (reported).
    invGap: (() => {
      const inv = m.querySelector(".portal-inv");
      if (!inv || inv.offsetParent === null) return null;
      let n = inv.nextElementSibling;
      while (n && (n.offsetParent === null || !n.getBoundingClientRect().height)) n = n.nextElementSibling;
      if (!n) return null;
      return Math.round(n.getBoundingClientRect().top - inv.getBoundingClientRect().bottom);
    })(),
    chipGap: (() => {
      const ch = m.querySelector(".di-chips");
      const h4 = [...m.querySelectorAll("section h4")].find((x) => /Capabilities/i.test(x.innerText || ""));
      if (!ch || !h4 || ch.offsetParent === null) return null;
      return Math.round(h4.getBoundingClientRect().top - ch.getBoundingClientRect().bottom);
    })(),
  };
});
const tab = (page, id) => page.evaluate((x) => document.querySelector(`.modal .sd-tabs [data-tab="${x}"]`)?.click(), id);

try {
  const { ctx, page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 1180, height: 820 } });
  await wait(2600);
  await page.evaluate(() => [...document.querySelectorAll("nav button")]
    .find((b) => /^(Sub)?contractors/i.test((b.innerText || "").trim()))?.click());
  await wait(700);
  await page.evaluate(() => {
    const c = [...document.querySelectorAll(".grid .card")].find((x) => /Pike Roofing/.test(x.innerText || ""));
    if (c) c.click();
  });
  await wait(1000);

  const a = await shown(page);
  t.ck("the contractor card opened", !!a, JSON.stringify(a));
  t.ck("it has five tabs, Overview first and selected",
    a?.tabs.map((x) => x.id).join(",") === "overview,compliance,agreement,crews,notes" && a.tabs[0].on,
    JSON.stringify(a?.tabs));
  t.ck("the invite box has room under it", a?.invGap != null && a.invGap >= 12, String(a?.invGap));
  t.ck("only one pane is drawn", JSON.stringify(a?.panes) === '["overview"]', JSON.stringify(a?.panes));
  t.ck("the compliance tab counts what is outstanding", Number(a?.tabs?.[1]?.count) > 0, a?.tabs?.[1]?.count);
  t.ck("documents are not drawn on Overview", a?.docRows === 0, String(a?.docRows));
  t.ck("the chips row does not touch the Capabilities heading", a?.chipGap >= 14, String(a?.chipGap));

  await tab(page, "compliance"); await wait(300);
  const c = await shown(page);
  t.ck("Compliance draws the document rows", c?.docRows === 4, String(c?.docRows));
  t.ck("and only that pane", JSON.stringify(c?.panes) === '["compliance"]', JSON.stringify(c?.panes));
  t.ck("the name stays above the tabs", c?.name === true);
  t.ck("and so does whether they can work, and Assign", c?.block === true && c?.assign === true,
    JSON.stringify({ b: c?.block, a: c?.assign }));

  await tab(page, "agreement"); await wait(800);
  const g = await shown(page);
  t.ck("Agreement draws the agreement panel", g?.agr === true && JSON.stringify(g?.panes) === '["agreement"]',
    JSON.stringify(g?.panes));
  t.ck("it says when it was first sent, by whom and where",
    g?.sends?.length === 1 && /^Sent Oct 3/.test(g.sends[0]) && /Christopher Lane/.test(g.sends[0])
      && /emailed to dale@pike\.test/.test(g.sends[0]), JSON.stringify(g?.sends));
  t.ck("it offers View agreement and Resend",
    g?.acts.some((x) => /View agreement/.test(x)) && g?.acts.some((x) => /^Resend/.test(x)),
    JSON.stringify(g?.acts));

  await page.evaluate(() => [...document.querySelectorAll(".modal .agr-actions button")]
    .find((b) => /View agreement/.test(b.innerText || ""))?.click());
  await wait(500);
  const viewed = await page.evaluate(() => (document.querySelector(".agr-doc .agr-doc-title")?.innerText || "").trim());
  t.ck("View agreement opens the document", /SubSub Standard Subcontractor Agreement/i.test(viewed), viewed);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const ms = [...document.querySelectorAll(".modal")];
    if (ms.length > 1) ms[ms.length - 1].closest(".modal-backdrop")?.querySelector(".modal-x, .modal-close")?.click();
  });
  await wait(400);

  await page.evaluate(() => [...document.querySelectorAll(".modal .agr-actions button")]
    .find((b) => /^Resend/.test((b.innerText || "").trim()))?.click());
  await wait(900);
  const r = await shown(page);
  t.ck("Resend posts to the resend route", calls.includes("resend"), JSON.stringify(calls));
  t.ck("and says where it went", /Emailed to dale@pike\.test again/.test(r?.note || ""), r?.note);
  t.ck("and the resend is listed under the first send",
    r?.sends?.length === 2 && /^Resent Oct 20/.test(r.sends[1]), JSON.stringify(r?.sends));

  await tab(page, "notes"); await wait(300);
  const n = await shown(page);
  t.ck("Notes draws only the notes", JSON.stringify(n?.panes) === '["notes"]'
    && await page.evaluate(() => document.querySelector(".modal .notes-area")?.offsetParent !== null));
  await ctx.close();

  // THE STEP BAR ON A PHONE. Reported with the Add form on step 2: three
  // equal thirds left "Trades & coverage" ellipsed beside a tick and a 3.
  // The current step's name must be shown whole, measured as drawn.
  {
    const { ctx: pc, page: pp } = await visitApp(browser, { host: "soundpm", webPort: WEB,
      seat: { userId: "usr_r", accountId: "acc_x" }, viewport: { width: 390, height: 844 } });
    await wait(2600);
    await pp.evaluate(() => {
      const nb = document.querySelector(".nav-burger, .hamburger, [aria-label='Menu']");
      if (nb) nb.click();
    });
    await wait(300);
    await pp.evaluate(() => [...document.querySelectorAll("nav button, .drawer button")]
      .find((b) => /^(Sub)?contractors/i.test((b.innerText || "").trim()))?.click());
    await wait(800);
    await pp.evaluate(() => [...document.querySelectorAll(".grid .card")].find((x) => /Pike Roofing/.test(x.innerText || ""))?.click());
    await wait(900);
    await pp.evaluate(() => [...document.querySelectorAll(".modal button")].find((b) => /^Edit$/.test((b.innerText || "").trim()))?.click());
    await wait(700);
    await pp.evaluate(() => [...document.querySelectorAll(".sf-steps button")][1]?.click());
    await wait(400);
    const sb = await pp.evaluate(() => {
      const now = document.querySelector('.sf-steps button[data-state="now"]');
      if (!now) return null;
      const bar = now.parentElement.getBoundingClientRect();
      return { text: (now.innerText || "").trim(), clipped: now.scrollWidth > now.clientWidth + 1,
        share: Math.round(now.getBoundingClientRect().width / bar.width * 100) };
    });
    t.ck("on a phone the current step's name is shown whole",
      !!sb && /Trades/.test(sb.text) && !sb.clipped, JSON.stringify(sb));
    t.ck("and it takes most of the bar", !!sb && sb.share >= 55, JSON.stringify(sb));
    await pc.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
