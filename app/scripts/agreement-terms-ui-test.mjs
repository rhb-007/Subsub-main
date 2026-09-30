// The agreement's terms are editable for one contractor, and the preview agrees.
//
// WHY THIS HAS TO BE A BROWSER TEST. `mergeTerms(stored.terms, body.terms)` has
// taken a per-subcontractor override since the issue route was written, and the
// panel has been posting `terms` on issue since then -- so every static check
// of both halves passed. The only thing that ever WROTE `terms` was the load,
// so every send carried the account's standing terms straight back. Correct
// pieces with no way in, which is only visible by driving the screen.
//
// Four properties, and the last is the one that is easy to lose:
//
//   IT IS EDITABLE AT ALL, on the contractor, which is what was asked for.
//
//   A NUMBER CARRIES ITS UNIT. "Warranty on the work: 36" does not say months,
//   and this grid already held five fields measured in days, months and years
//   with nothing on any of them saying which.
//
//   WHAT IS CHANGED IS COUNTED ON THE TOGGLE. The section is folded, because
//   most accounts use one set for everybody and that case must stay one press
//   -- so a modified set has to say so while it is shut.
//
//   AND THE PREVIEW SHOWS WHAT SEND WOULD PRODUCE. `data.preview` is the
//   server's render of the STANDING terms, so a warranty changed here would
//   have previewed at three years and sent at two: the screen-that-lies rule
//   pointed at the one screen whose whole job is showing somebody what they
//   are about to sign.
//
//   node --no-warnings scripts/agreement-terms-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-agrterms-test");
const WEB = 5291, API = 8991;
const t = tally();

const { TERM_FIELDS, defaultTerms } = await import("../shared/agreement.js");

const ACCOUNT = {
  id: "acc_out", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["roofing"], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_rb", name: "Richard Braun", email: "rb@outerhome.test", role: "admin" },
};

const SUB = {
  id: "cmp_bay", engagementId: "eng_bay", accountId: "acc_out",
  company: "Bay Roofing", contact: "Rae Ortiz", phone: "2065550002", email: "rae@bay.test",
  city: "Tacoma", state: "WA", zip: "98402", license: "BAY*112", ubi: "",
  categories: ["roofing"], caps: [], crews: [], coverage: { mode: "cities", cities: ["Tacoma"], radii: [] },
  propertyIds: [], rating: 0, ratedJobs: 0, accepted: 0, declined: 0,
  bond: true, insurance: true, contract: false, available: true, notes: "",
  docFiles: {}, docReview: {}, status: "active", autoSchedule: 0,
  notify: { email: true, sms: false }, hasPortal: false, answersForItself: false,
};

const PARTIES = {
  kind: "general_contractor",
  hiring: { name: "Outerhome LLC", street: "1 Pike St", city: "Seattle", state: "WA", zip: "98101" },
  sub: { name: "Bay Roofing", street: "", city: "Tacoma", state: "WA", zip: "98402", license: "BAY*112" },
};

// The account's STANDING terms, which is what the override is measured against.
const STANDING = { ...defaultTerms(), governingState: "WA" };

let issued = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === `/api/subs/${SUB.id}/agreement` && method === "POST") {
    issued.push(body); return [200, { ok: true }];
  }
  if (path === `/api/subs/${SUB.id}/agreement`) {
    return [200, {
      agreement: null,
      // Deliberately the SERVER's render of the standing terms, exactly as the
      // route sends it. If the modal drew this rather than re-rendering, the
      // preview would not move when a term does -- which is the bug.
      preview: {
        templateId: "subsub-standard-subcontract", templateVersion: "1.1.0",
        title: "SubSub Standard Subcontractor Agreement",
        partyTerms: { hiring: "Contractor", hired: "Subcontractor" }, reviewed: null,
        sections: [{ id: "warranty", heading: "9. Warranty",
          paragraphs: ["This warranty runs for 3 years from the date the work under a work order is completed."] }],
      },
      previewTerms: STANDING, parties: PARTIES, requireByDefault: false, fields: TERM_FIELDS,
    }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/subs") return [200, [SUB]];
  if (path === "/api/jobs" || path === "/api/properties" || path === "/api/invites"
    || path === "/api/connect-requests" || path === "/api/my-connect-requests"
    || path === "/api/clients") return [200, []];
  if (path === "/api/account-users") return [200, [
    { id: "u_rb", name: "Richard Braun", email: "rb@outerhome.test", phone: null, role: "admin",
      subId: null, propertyIds: [], jobIds: [], unit: null, hasLogin: true,
      inviteSentAt: null, hasAvatar: false },
  ]];
  if (path === "/api/payouts/status") return [200, { status: "none", ready: false, requirements: [], configured: false }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openCard = async (page) => {
  await page.evaluate(() => [...document.querySelectorAll("nav.tabs button")]
    .find((b) => /^(Sub)?contractors/i.test(b.innerText))?.click());
  for (let n = 0; n < 30; n++) { await wait(250); if (await page.$(".grid .card")) break; }
  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".grid .card")].find((c) => /Bay Roofing/i.test(c.innerText));
    card?.click();
  });
  for (let n = 0; n < 40; n++) { await wait(250); if (await page.$(".agr-panel")) break; }
  await wait(400);
};

const overrideBox = (page) => page.evaluate(() => {
  const el = document.querySelector(".agr-over");
  if (!el) return null;
  const tog = el.querySelector(".agr-over-tog");
  return {
    toggle: (tog?.innerText || "").replace(/\s+/g, " ").trim(),
    open: !!el.querySelector(".agr-fields"),
    fields: [...el.querySelectorAll(".agr-field")].map((f) => ({
      label: (f.querySelector("span")?.innerText || "").trim(),
      unit: (f.querySelector(".agr-unit")?.innerText || "").trim(),
      value: f.querySelector("input")?.value ?? null,
    })),
    reset: [...el.querySelectorAll("button")].some((b) => /standard terms/i.test(b.innerText)),
  };
});

const setField = (page, label, value) => page.evaluate(([lab, v]) => {
  const f = [...document.querySelectorAll(".agr-over .agr-field")]
    .find((x) => (x.querySelector("span")?.innerText || "").trim() === lab);
  const i = f?.querySelector("input");
  if (!i) return false;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(i, String(v));
  i.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, [label, value]);

try {
  console.log("\n-- the terms are editable on the contractor --");
  {
    issued = [];
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_out" }, viewport: { width: 1280, height: 1600 } });
    await wait(2200);
    await openCard(page);

    // WITHOUT THIS EVERY ASSERTION BELOW IS ONE THAT CANNOT FAIL: "no editor"
    // on a card that never opened reads identically to an editor that is
    // missing.
    t.ck("the agreement panel is on the card, so the rest of this can fail",
      await page.evaluate(() => /Subcontractor agreement/i.test(
        document.querySelector(".agr-panel")?.innerText || "")),
      (await page.evaluate(() => (document.querySelector(".agr-panel")?.innerText || "").slice(0, 90))));

    let box = await overrideBox(page);
    t.ck("the override section is there", !!box, String(box));
    // Folded: most accounts use one set for everybody and that must stay one
    // press.
    t.ck("and starts folded", box?.open === false, JSON.stringify(box?.toggle));
    t.ck("naming the contractor it is for", /Bay Roofing/.test(box?.toggle || ""), box?.toggle);
    t.ck("with nothing changed, it says nothing", !/changed/i.test(box?.toggle || ""), box?.toggle);

    await page.evaluate(() => document.querySelector(".agr-over-tog")?.click());
    await wait(350);
    box = await overrideBox(page);
    t.ck("it opens", box?.open === true);
    t.ck("the warranty is one of the fields, at three years",
      box?.fields.some((f) => /Warranty on the work/i.test(f.label) && f.value === "36"),
      JSON.stringify(box?.fields.filter((f) => /warranty/i.test(f.label))));
    // A NUMBER WITH NO UNIT IS NOT AN EDITABLE VALUE.
    t.ck("and says months, rather than leaving 36 to be guessed at",
      box?.fields.find((f) => /Warranty on the work/i.test(f.label))?.unit === "months",
      JSON.stringify(box?.fields.find((f) => /Warranty on the work/i.test(f.label))));
    t.ck("the response clock is there too, in business hours",
      box?.fields.some((f) => /Respond to a warranty call/i.test(f.label)
        && f.value === "48" && f.unit === "business hours"),
      JSON.stringify(box?.fields.filter((f) => /respond/i.test(f.label))));
    // Offered only when there is something to reset: a control that does
    // nothing is a control somebody presses to find out.
    t.ck("and no reset while nothing is changed", box?.reset === false);
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- changing one is counted, previewed, and sent --");
  {
    issued = [];
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_out" }, viewport: { width: 1280, height: 1600 } });
    await wait(2200);
    await openCard(page);
    await page.evaluate(() => document.querySelector(".agr-over-tog")?.click());
    await wait(350);

    t.ck("the warranty field can be typed into", await setField(page, "Warranty on the work", 24));
    await wait(350);
    let box = await overrideBox(page);
    // THE COUNT IS WHAT MAKES FOLDING SAFE: a modified set must never be
    // silently modified.
    t.ck("the toggle counts what is different from the standing terms",
      /1 changed/.test(box?.toggle || ""), box?.toggle);
    t.ck("and a reset appears now there is something to reset", box?.reset === true);

    // The preview has to move with it. This is the assertion the whole
    // livePreview memo exists for -- the stub's own preview says three years,
    // so a modal drawing `data.preview` would still say three.
    await page.evaluate(() => [...document.querySelectorAll(".agr-panel button")]
      .find((b) => /Read the SubSub agreement/i.test(b.innerText))?.click());
    for (let n = 0; n < 30; n++) { await wait(200); if (await page.$(".agr-doc")) break; }
    const doc = await page.evaluate(() => (document.querySelector(".agr-doc")?.innerText || "").replace(/\s+/g, " "));
    t.ck("the preview shows the document", /Warranty/i.test(doc), doc.slice(0, 80));
    t.ck("and it runs for two years, not the account's three",
      /runs for 2 years/.test(doc) && !/runs for 3 years/.test(doc),
      (doc.match(/runs for [^.]*/) || [])[0]);
    // Rendered from the shared template, so the rest of the document is there
    // too -- proof it is a real render and not the stub's one-section preview.
    t.ck("rendered in full from the shared template, not the stub's stub",
      /Indemnity/i.test(doc) && /Governing law/i.test(doc), doc.slice(0, 60));

    await page.evaluate(() => [...document.querySelectorAll(".modal button, .modal .btn-ghost")]
      .find((b) => /Close|Cancel/i.test(b.innerText))?.click());
    await page.keyboard.press("Escape").catch(() => {});
    await wait(500);

    await page.evaluate(() => [...document.querySelectorAll(".agr-panel button")]
      .find((b) => /Send SubSub's agreement/i.test(b.innerText))?.click());
    for (let n = 0; n < 40 && !issued.length; n++) await wait(150);
    // THE HALF THAT WAS BROKEN. The body posted the standing terms back
    // unchanged, because nothing could write them.
    t.ck("issuing sends the changed term", issued[0]?.terms?.warrantyMonths === 24,
      JSON.stringify(issued[0]?.terms?.warrantyMonths));
    t.ck("and leaves the rest of the account's terms alone",
      issued[0]?.terms?.paymentDays === STANDING.paymentDays
        && issued[0]?.terms?.warrantyResponseHours === STANDING.warrantyResponseHours,
      JSON.stringify(issued[0]?.terms));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and reset puts it back --");
  {
    issued = [];
    const { ctx, page, crashes } = await visitApp(browser, { host: "outerhome", webPort: WEB,
      seat: { userId: "u_rb", accountId: "acc_out" }, viewport: { width: 1280, height: 1600 } });
    await wait(2200);
    await openCard(page);
    await page.evaluate(() => document.querySelector(".agr-over-tog")?.click());
    await wait(350);
    await setField(page, "Respond to a warranty call within", 12);
    await wait(350);
    t.ck("a change is counted", /1 changed/.test((await overrideBox(page))?.toggle || ""));
    await page.evaluate(() => [...document.querySelectorAll(".agr-over button")]
      .find((b) => /standard terms/i.test(b.innerText))?.click());
    await wait(350);
    const box = await overrideBox(page);
    t.ck("reset clears the count", !/changed/i.test(box?.toggle || ""), box?.toggle);
    t.ck("and puts the value back", box?.fields.some((f) =>
      /Respond to a warranty call/i.test(f.label) && f.value === "48"),
      JSON.stringify(box?.fields.filter((f) => /respond/i.test(f.label))));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
