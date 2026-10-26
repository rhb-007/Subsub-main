// A document verdict is saved before the screen says so. Reported as
// "reviewing subcontractor docs, adding answers, saving, but it's not saving,
// keeps prompting me to review the same document": the review patched the row
// to verified and closed the window, and a refused request was only logged, so
// the next reload put the document back in Documents to verify.
//
//   node scripts/doc-verdict-ui-test.mjs
//
// (Fixture shared in shape with doc-draft-ui-test.)
// The promise of a paused review, proved by driving it.
//
// The server suite pins that a draft is stored and is not a verdict. What it
// cannot show is the thing the feature exists for: that a reviewer who comes
// back finds the figures they typed, in the boxes they typed them in. A
// static check that the component MENTIONS the draft passes even when the
// form ignores it -- which is exactly what happened on the first attempt, so
// this exists.
//
//   node scripts/doc-draft-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-docverdict-test");
const WEB = 5963, API = 8963;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const ACCOUNT = {
  id: "acc_outer", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};

// Four coverage lines in, a carrier, a policy number, and a note about why
// they stopped. The umbrella line and the expiry are deliberately absent:
// this is a review that CANNOT be verified yet, which is the whole case.
const DRAFT = {
  limits: { cgl_occ: "1000000", cgl_agg: "2000000", prod_comp: "2000000", auto: "1000000" },
  checks: { named: true, primary: true },
  issuer: "Cascade Mutual", policyNo: "CGL-99812",
  note: "waiting on the umbrella page",
  overrides: {},
};

const SUB = {
  id: "cmp_sj", engagementId: "en_sj", accountId: "acc_outer",
  company: "San Juan Exteriors", contact: "Richard Braun", phone: "(206)555-0100",
  email: "rb@sanjuan.test", city: "Seattle", state: "WA", zip: "98101",
  license: "SANJU123456",
  licenseCheck: { found: true, status: "ACTIVE", suspendDate: null, expirationDate: iso(500) },
  crews: [{ id: "c1", name: "Crew 1", available: true, unavailableDays: [], members: [] }],
  coverage: { mode: "cities", cities: ["Seattle"] }, available: true, unavailableDays: [],
  warranty: null, insurance: 1, bond: 1, contract: 1, w9: 1,
  docFiles: { insurance: "coi.pdf", bond: "bond.pdf", contract: "msa.pdf", w9: "w9.pdf" },
  notify: { email: true, sms: false },
  // Pending, with somebody's half-read pass parked on it.
  docReview: { insurance: { status: "pending" }, contract: { status: "pending" } },
  categories: ["roofing"], caps: [], rating: 4.5, ratedJobs: 4, accepted: 4, declined: 0,
  notes: "", status: "active", propertyIds: [], hasPortal: true, autoSchedule: false,
  docs: {
    insurance: { fileName: "coi.pdf", expiresOn: null },
    bond: { fileName: "bond.pdf", expiresOn: null },
    contract: { fileName: "msa.pdf", expiresOn: null },
    w9: { fileName: "w9.pdf", expiresOn: null },
  },
  docState: "pending", docAssignable: false, docSoonest: null,
};


let REFUSE = true;
const reviews = [];
let reviewed = false;
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (/\/documents\/[^/]+\/file$/.test(path) && method === "GET") {
    return [200, null, { raw: "%PDF-1.4\nACORD\n%%EOF", type: "application/pdf" }];
  }
  const rv = /^\/api\/subs\/([^/]+)\/documents\/([^/]+)\/review$/.exec(path);
  if (rv && method === "POST") {
    reviews.push({ kind: rv[2], body });
    if (REFUSE) return [500, { error: "boom" }];
    reviewed = true;
    return [200, { ok: true }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/subs") {
    const s = reviewed ? { ...SUB, docReview: { ...SUB.docReview, contract: { status: "verified", verifiedBy: "Richard Braun", verifiedAt: iso(0) } } } : SUB;
    return [200, [s]];
  }
  if (path === "/api/jobs") return [200, []];
  if (path === "/api/invites" || path === "/api/connect-requests") return [200, []];
  if (path === "/api/account-users") {
    return [200, [{ id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false }]];
  }
  return undefined;
} });

const browser = await launch();

const toCard = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^(Sub)?contractors/i.test(b.innerText.trim().split("\n")[0]))?.click());
  await wait(800);
  await page.evaluate(() => {
    const c = [...document.querySelectorAll(".grid .card")]
      .find((x) => x.querySelector("h3")?.innerText.trim() === "San Juan Exteriors");
    c?.click();
  });
  await wait(800);
};
const contractRow = (page) => page.evaluate(() => {
  const r = [...document.querySelectorAll(".doc-row")].find((x) => /subcontractor agreement/i.test(x.innerText));
  return r ? r.innerText.replace(/\s+/g, " ") : null;
});
const reviewOpen = (page) => page.evaluate(() =>
  !![...document.querySelectorAll(".modal .form")].find((x) => /^Review /i.test(x.innerText)));

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_richard", accountId: "acc_outer" }, viewport: { width: 1340, height: 1800 } });
  await wait(2500);
  await toCard(page);
  t.ck("the agreement awaits review", /awaiting review/i.test((await contractRow(page)) || ""), await contractRow(page));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".doc-row")].find((r) => /subcontractor agreement/i.test(r.innerText));
    row?.querySelectorAll("button")[0]?.click();
  });
  await wait(1200);
  t.ck("the review opened", await reviewOpen(page));
  // Confirm every line, which is all an agreement asks.
  await page.evaluate(() => document.querySelectorAll(".modal .rv-fbtn.ok").forEach((b) => b.click()));
  await wait(300);
  const btn = await page.evaluate(() => {
    const b = document.querySelector(".modal .rv-verify");
    return b ? { disabled: b.disabled, text: b.innerText.trim() } : null;
  });
  t.ck("Verify is pressable once every line is confirmed", btn && !btn.disabled, JSON.stringify(btn));

  console.log("\n-- a refused verdict stays on screen with the reason --");
  await page.click(".modal .rv-verify");
  await wait(1200);
  t.ck("the verdict was asked for", reviews.length === 1 && reviews[0].body?.status === "verified", JSON.stringify(reviews));
  t.ck("refused, the window stays open", await reviewOpen(page));
  const err = await page.evaluate(() => document.querySelector(".modal .rv-decide-err")?.innerText || "");
  t.ck("and says it was not saved", /not saved/i.test(err) && /boom/.test(err), err);
  t.ck("the answers are still ticked", await page.evaluate(() =>
    document.querySelectorAll(".modal .rv-fbtn.ok.on").length > 0));
  await page.keyboard.press("Escape").catch(() => {});

  console.log("\n-- pressed again, it saves and the row says so --");
  REFUSE = false;
  await page.click(".modal .rv-verify");
  await wait(1500);
  t.ck("the second press was sent", reviews.length === 2, String(reviews.length));
  t.ck("the window closes once it is saved", !(await reviewOpen(page)));
  if (!(await contractRow(page))) await toCard(page);
  const after = await contractRow(page);
  t.ck("and the agreement reads verified", /verified/i.test(after || "") && !/awaiting review/i.test(after || ""), String(after));
  t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
  t.done();
}
