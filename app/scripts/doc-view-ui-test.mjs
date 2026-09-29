// The uploaded document, on the screen of somebody deciding about it.
//
// The review modal's Open and Download both called a function that built a
// text/plain Blob out of the reviewer's own checklist and handed it over as
// `<name>-preview.txt`, carrying the line "Placeholder preview -- wired to
// object storage in production". So the one screen whose entire job is
// reading a certificate was the one screen that would not show it, and a
// reviewer attesting to a coverage limit and an expiry date was doing it
// from memory of a file they had to leave the app to open.
//
// The server half is pinned in docview-test.mjs. This is the half that can
// only be seen in a browser:
//
//   THE DOCUMENT IS ON THE SCREEN, drawn as what it actually is -- an
//   <iframe> for a PDF and an <img> for a photograph, because a certificate
//   is as often a picture of one as it is a PDF.
//
//   OPEN AND DOWNLOAD ARE ANCHORS over a blob that already exists. A press
//   that has to await a round trip has lost its user gesture by the time it
//   opens a tab, which iOS Safari blocks as a popup -- and this product is
//   run from an iPad.
//
//   A FILE THAT CANNOT BE PRODUCED SAYS SO, rather than drawing an empty
//   frame. An upload made before 037 recorded the R2 key has nothing to
//   serve, and the only honest instruction is to ask for it again.
//
//   node scripts/doc-view-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-docview-test");
const WEB = 5275, API = 8975;
const t = tally();

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// A one-pixel PNG, so the image branch has something a browser will actually
// decode. A string pretending to be an image would load-fail and the <img>
// branch would look broken for a reason that is not the code's.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");
const PDF = "%PDF-1.4\nACORD 25 -- Cascade Mutual -- CGL-99812\n%%EOF";

const ACCOUNT = {
  id: "acc_outer", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["roofing"],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};

const verified = { status: "verified", checks: {}, limits: {} };
const SUB = {
  id: "cmp_sj", engagementId: "en_sj", accountId: "acc_outer",
  company: "San Juan Exteriors", contact: "Richard Braun", phone: "(206)555-0100",
  email: "rb@sanjuan.test", city: "Seattle", state: "WA", zip: "98101",
  license: "SANJU123456",
  licenseCheck: { found: true, status: "ACTIVE", suspendDate: null, expirationDate: iso(500) },
  crews: [{ id: "c1", name: "Crew 1", available: true, unavailableDays: [], members: [] }],
  coverage: { mode: "cities", cities: ["Seattle"] }, available: true, unavailableDays: [],
  warranty: null, insurance: 1, bond: 1, contract: 1, w9: 1,
  docFiles: { insurance: "coi.pdf", bond: "bond-photo.jpg", contract: "msa.pdf", w9: "w9.pdf" },
  notify: { email: true, sms: false },
  docReview: { insurance: verified, bond: verified, contract: verified, w9: verified },
  categories: ["roofing"], caps: [], rating: 4.5, ratedJobs: 4, accepted: 4, declined: 0,
  notes: "", status: "active", propertyIds: [], hasPortal: true, autoSchedule: false,
  docs: {
    insurance: { fileName: "coi.pdf", expiresOn: iso(200), issuer: "Cascade Mutual" },
    bond: { fileName: "bond-photo.jpg", expiresOn: iso(400) },
    // The pre-037 case: a filename and a boolean, and no key anywhere.
    contract: { fileName: "msa.pdf", expiresOn: null },
    w9: { fileName: "w9.pdf", expiresOn: null },
  },
  docState: "ok", docAssignable: true, docSoonest: iso(200),
};

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  const f = /^\/api\/subs\/([^/]+)\/documents\/([^/]+)\/file$/.exec(path);
  if (f && method === "GET") {
    const kind = f[2];
    if (kind === "insurance") return [200, null, { raw: PDF, type: "application/pdf" }];
    if (kind === "bond") return [200, null, { raw: PNG, type: "image/jpeg" }];
    // Uploaded before anything recorded where it went.
    if (kind === "contract") return [404, { error: "no_file" }];
    return [200, null, { raw: "W9", type: "application/pdf" }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/subs") return [200, [SUB]];
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

const openReview = async (page, re) => {
  await page.evaluate(() => [...document.querySelectorAll("button")]
    .find((b) => /^Contractors/.test(b.innerText.trim().split("\n")[0]))?.click());
  await wait(800);
  await page.evaluate(() => {
    const c = [...document.querySelectorAll(".grid .card")]
      .find((x) => x.querySelector("h3")?.innerText.trim() === "San Juan Exteriors");
    c?.click();
  });
  await wait(800);
  const label = re.source;
  await page.evaluate((src) => {
    const row = [...document.querySelectorAll(".doc-row")]
      .find((r) => new RegExp(src, "i").test(r.innerText));
    row?.querySelectorAll("button")[0]?.click();
  }, label);
  // The blob has to come back over the wire before the frame can have a src.
  await wait(1400);
};

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_richard", accountId: "acc_outer" }, viewport: { width: 1340, height: 1600 } });
  await wait(2500);

  console.log("\n-- a PDF certificate is on the screen, not described on it --");
  {
    await openReview(page, /certificate of insurance/);
    const v = await page.evaluate(() => {
      const w = document.querySelector(".dv-wrap");
      if (!w) return null;
      const frame = w.querySelector("iframe.dv-frame");
      const links = [...w.querySelectorAll(".dv-actions a")].map((a) => ({
        text: a.innerText.trim(), href: a.getAttribute("href") || "",
        download: a.hasAttribute("download"), target: a.getAttribute("target") || "",
        rel: a.getAttribute("rel") || "",
      }));
      return { hasFrame: !!frame, src: frame?.getAttribute("src") || "", links,
        height: frame ? Math.round(frame.getBoundingClientRect().height) : 0 };
    });
    t.ck("the viewer is on the review screen", !!v, JSON.stringify(v));
    if (v) {
      t.ck("a PDF is drawn in a frame", v.hasFrame);
      t.ck("over the bytes that came back", v.src.startsWith("blob:"), v.src.slice(0, 20));
      t.ck("tall enough to read a certificate header", v.height > 250, `${v.height}px`);
      // The header block of an ACORD 25 is where the carrier, the policy
      // number and both dates are -- which is every field the form below it
      // is about to ask for.
      t.ck("Open and Download are both there", v.links.length === 2, JSON.stringify(v.links.map((l) => l.text)));
      t.ck("they are anchors over a URL that already exists",
        v.links.every((l) => l.href.startsWith("blob:")), JSON.stringify(v.links.map((l) => l.href.slice(0, 12))));
      t.ck("Open goes to a new tab", v.links.some((l) => /open/i.test(l.text) && l.target === "_blank"));
      t.ck("Download asks to save it", v.links.some((l) => /download/i.test(l.text) && l.download));
      // And Download needs the new tab as much as Open does. `download` is
      // honoured on a desktop browser, but iOS Safari ignores it on a blob:
      // URL -- so without a target the anchor is an ordinary navigation and
      // REPLACES the page with the PDF, taking the half-filled review with
      // it. On the one screen this product is run from that is not a
      // download, it is a way out of the review.
      t.ck("and neither link can replace the page",
        v.links.every((l) => l.target === "_blank"),
        JSON.stringify(v.links.map((l) => ({ t: l.text, target: l.target }))));
      t.ck("with noopener on both",
        v.links.every((l) => /noopener/.test(l.rel || "")),
        JSON.stringify(v.links.map((l) => l.rel)));
    }
  }

  console.log("\n-- and the old placeholder is nowhere on it --");
  {
    const txt = await page.evaluate(() => document.body.innerText);
    t.ck("nothing says it is a placeholder", !/placeholder/i.test(txt));
    t.ck("and nothing says it is wired up in production", !/in production/i.test(txt));
  }

  console.log("\n-- a photographed certificate is drawn as a picture --");
  {
    await page.keyboard.press("Escape");
    await wait(500);
    await openReview(page, /surety bond/);
    const v = await page.evaluate(() => {
      const w = document.querySelector(".dv-wrap");
      const img = w?.querySelector(".dv-img img");
      return { hasImg: !!img, src: img?.getAttribute("src") || "",
        complete: img ? img.complete && img.naturalWidth > 0 : false,
        inFrame: !!w?.querySelector("iframe") };
    });
    t.ck("an image is drawn as an image", v.hasImg, JSON.stringify(v));
    t.ck("not in a PDF frame", !v.inFrame);
    t.ck("and the browser actually decoded it", v.complete, JSON.stringify(v));
  }

  console.log("\n-- a file nobody can produce says so, and says what to do --");
  {
    await page.keyboard.press("Escape");
    await wait(500);
    await openReview(page, /subcontractor agreement/);
    const v = await page.evaluate(() => {
      const gone = document.querySelector(".dv-frame.is-gone");
      return { gone: !!gone, text: gone?.innerText || "",
        offersDeadButtons: !!document.querySelector(".dv-actions") };
    });
    t.ck("the empty state renders", v.gone, JSON.stringify(v).slice(0, 160));
    t.ck("it says there is nothing to open", /no file to open/i.test(v.text), v.text.slice(0, 120));
    t.ck("and names the way out rather than only the problem",
      /upload it again/i.test(v.text), v.text.slice(0, 200));
    // It must NOT name a cause it cannot check. The first version blamed a
    // migration, and said so over a certificate uploaded that month.
    t.ck("without guessing at why", !/before SubSub recorded/i.test(v.text), v.text.slice(0, 200));
    // A button over a file that does not exist is the screen-that-lies rule.
    t.ck("no Open or Download is offered over nothing", !v.offersDeadButtons);
  }

  console.log("\n-- the app asked the file route for each of them --");
  {
    const asked = api.calls.filter((p) => /\/documents\/[^/]+\/file$/.test(p));
    t.ck("insurance was fetched", asked.some((p) => p.includes("/insurance/")), JSON.stringify(asked));
    t.ck("bond was fetched", asked.some((p) => p.includes("/bond/")));
    t.ck("contract was fetched", asked.some((p) => p.includes("/contract/")));
    t.ck("and it asked for the company on the card",
      asked.every((p) => p.includes("/subs/cmp_sj/")), JSON.stringify(asked));
  }

  console.log("\n-- nothing threw --");
  t.ck("no page errors", crashes.length === 0, crashes.join(" | "));
  await ctx?.close?.();
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
