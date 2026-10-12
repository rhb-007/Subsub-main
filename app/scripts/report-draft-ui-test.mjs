// A TENANT'S REPORT FILLS ITSELF IN FROM THEIR PHOTOS.
//
// Asked for as "AI should be able to scan the image and automatically write a
// description of the issues in the picture ... fully automated on the tenant
// side". Driven in a browser because every claim is about what is DRAWN and
// what REACHES THE SERVER:
//
//   ADDING A PHOTO IS THE PRESS. No button: the photo goes up downscaled, and
//   the problem, the title and the description come back filled in.
//
//   WHAT THE DRAFT WROTE IS MARKED AS SUCH until they change it, and what they
//   typed is never overwritten by a later read.
//
//   WITH NO KEY, NOTHING SAYS IT IS HAPPENING -- the line about what leaves
//   is not drawn over a feature that cannot run.
//
//   node --no-warnings scripts/report-draft-ui-test.mjs

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-reportdraft-test");
// Named to match the ignored dist-*-test pattern.
const FIX = join(app, "dist-reportdraftfix-test");
const WEB = 5491, API = 9191;
const t = tally();

mkdirSync(FIX, { recursive: true });
// A 3000x2000 photo, so the downscale can be read back off the wire.
const PHOTO = join(FIX, "sink.png");
await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 90, g: 120, b: 160 } } })
  .png().toFile(PHOTO);
const PHOTO2 = join(FIX, "sink2.png");
await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 160, g: 120, b: 90 } } })
  .png().toFile(PHOTO2);

const acct = {
  id: "acc_x", name: "Sound Property Management", subdomain: "x", kind: "property_manager",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: ["plumbing"],
  logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
};
const PROP = { id: "prop_1", accountId: "acc_x", name: "North Highland LLC", address: "4915 North Highland St",
  city: "Ruston", state: "WA", zip: "98407", units: 60, notes: "", ownedByAnother: false, ownerDeclared: false };
const USERS = [
  { id: "usr_t", name: "John Smith", email: "john@x.test", phone: null, role: "tenant",
    subId: null, propertyIds: ["prop_1"], unit: "53", hasLogin: true, inviteSentAt: null, hasAvatar: false },
];

let configured = true;
const drafts = [];
let nextDraft = null;
const reports = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct];
  if (path === "/api/account") return [200, acct];
  if (path === "/api/account-users") return [200, USERS];
  if (path === "/api/properties") return [200, [PROP]];
  if (path === "/api/jobs" && method === "POST") { reports.push(body); return [201, { id: "job_new", ...body }]; }
  if (path === "/api/jobs") return [200, []];
  if (path === "/api/visits") return [200, []];
  if (path === "/api/report-draft" && method === "GET") return [200, { configured }];
  if (path === "/api/report-draft" && method === "POST") {
    drafts.push(body);
    return nextDraft ? [200, nextDraft] : [502, { error: "ai_unavailable" }];
  }
  if (path === "/api/my-manager") return [200, { company: "Sound Property Management", managers: [] }];
  if (path === "/api/notices") return [200, { notices: [] }];
  if (path === "/api/weather" || path === "/api/me/contact") return [200, {}];
  if (path === "/api/subs" || path === "/api/invites" || path === "/api/connect-requests"
    || path === "/api/my-connect-requests" || path === "/api/clients") return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const openForm = async () => {
  const { ctx, page, crashes } = await visitApp(browser, { host: "x", webPort: WEB,
    seat: { userId: "usr_t", accountId: "acc_x" }, viewport: { width: 1100, height: 1600 } });
  await wait(2400);
  await page.evaluate(() => document.querySelector(".tn-cta")?.click());
  await wait(800);
  return { ctx, page, crashes };
};
const read = (page) => page.evaluate(() => {
  const f = document.querySelector(".tn-form");
  if (!f) return null;
  const title = [...f.querySelectorAll("label.fld")].find((l) => /put it differently/.test(l.innerText))?.querySelector("input");
  const scope = f.querySelector("textarea");
  const phFld = [...f.querySelectorAll(".fld")].find((x) => x.querySelector(".ph-add, .ph-grid"));
  const prob = [...f.querySelectorAll(".fld")].find((x) => x.querySelector(".tn-chosen, .tn-search"));
  return {
    chosen: f.querySelector(".tn-chosen span")?.innerText || "",
    title: title?.value ?? null, titleDraft: !!title?.classList.contains("is-draft"),
    scope: scope?.value ?? null, scopeDraft: !!scope?.classList.contains("is-draft"),
    line: f.querySelector(".rd-line")?.innerText || "",
    hint: phFld?.querySelector(".fld-note")?.innerText || "",
    photosAbovePicker: !!(phFld && prob && (phFld.compareDocumentPosition(prob) & Node.DOCUMENT_POSITION_FOLLOWING)),
  };
});
const typeInto = (page, sel, text) => page.evaluate((s, v) => {
  const el = document.querySelector(s);
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, sel, text);

try {
  console.log("\n-- photos first, and adding one is the press --");
  nextDraft = { ok: true, problem: "My sink is leaking", title: "Water pooling under the kitchen sink",
    description: "There's water pooling on the cabinet floor under my kitchen sink.", unclear: false, urgent: false };
  let { ctx, page, crashes } = await openForm();
  let s = await read(page);
  t.ck("the report form opened", !!s, JSON.stringify(s));
  t.ck("the photos come before the problem list", !!s?.photosAbovePicker);
  t.ck("and it says what leaves before anything does", /read by an AI service/.test(s?.hint || ""), s?.hint);
  const input = await page.$(".tn-form input[type=file]");
  await input.uploadFile(PHOTO);
  await wait(2500);
  s = await read(page);
  t.ck("one read, with no button pressed", drafts.length === 1, String(drafts.length));
  const b64 = drafts[0]?.photos?.[0] || "";
  const meta = b64 ? await sharp(Buffer.from(b64, "base64")).metadata() : {};
  t.ck("the photo went downscaled, as a JPEG", meta.format === "jpeg" && Math.max(meta.width || 0, meta.height || 0) <= 1120,
    `${meta.format} ${meta.width}x${meta.height}`);
  t.ck("the problem is picked for them", s?.chosen === "My sink is leaking", s?.chosen);
  t.ck("the title is filled in and marked as a draft", s?.title === "Water pooling under the kitchen sink" && s?.titleDraft);
  t.ck("the description is filled in and marked as a draft", /cabinet floor/.test(s?.scope || "") && s?.scopeDraft);
  t.ck("and the line says where it came from", /Filled in from your photo/.test(s?.line), s?.line);

  console.log("\n-- their own words are theirs --");
  await typeInto(page, ".tn-form textarea", "It started Tuesday and it's getting worse.");
  await wait(300);
  nextDraft = { ...nextDraft, title: "Leak under the sink", description: "A second, different description." };
  const input2 = await page.$(".tn-form input[type=file]");
  await input2.uploadFile(PHOTO2);
  await wait(2500);
  s = await read(page);
  t.ck("a second photo reads the set again", drafts.length === 2 && drafts[1]?.photos?.length === 2, String(drafts.length));
  t.ck("what they typed is sent as context", /started Tuesday/.test(drafts[1]?.words || ""));
  t.ck("and is not overwritten", s?.scope === "It started Tuesday and it's getting worse." && !s?.scopeDraft, s?.scope);
  t.ck("the untouched title follows the new read", s?.title === "Leak under the sink" && s?.titleDraft, s?.title);

  console.log("\n-- and it sends as theirs --");
  await page.evaluate(() => [...document.querySelectorAll(".tn-form .btn-solid")].find((b) => /Send it/.test(b.innerText))?.click());
  await wait(1500);
  t.ck("the report carries the picked problem and their words", reports.length === 1
    && reports[0].reportDetail?.problem === "My sink is leaking"
    && /started Tuesday/.test(reports[0].reportDetail?.words || "") && reports[0].title === "Leak under the sink",
    JSON.stringify(reports[0] || {}).slice(0, 200));
  t.ck("nothing crashed", !crashes.length, crashes.join(" | "));
  await ctx.close();

  console.log("\n-- scan again brings the automated description back --");
  drafts.length = 0;
  nextDraft = { ok: true, problem: "My sink is leaking", title: "Water under the sink",
    description: "Water is pooling under my kitchen sink.", unclear: false, urgent: false };
  ({ ctx, page } = await openForm());
  await (await page.$(".tn-form input[type=file]")).uploadFile(PHOTO2);
  await wait(2500);
  const againBtn = () => page.evaluate(() => {
    const b = document.querySelector(".tn-form .rd-again-btn");
    return b ? { text: b.innerText.trim(), note: document.querySelector(".tn-form .rd-again-note")?.innerText || "" } : null;
  });
  let ag = await againBtn();
  t.ck("a settled read offers Scan photo again", !!ag && /Scan photo again/.test(ag.text), JSON.stringify(ag));
  t.ck("and says nothing about replacing while nothing was changed", ag && !ag.note, ag?.note);
  await typeInto(page, ".tn-form textarea", "My own words about it.");
  await wait(300);
  ag = await againBtn();
  t.ck("once they change it, it says it will replace that", /Replaces what you changed/.test(ag?.note || ""), ag?.note);
  nextDraft = { ...nextDraft, title: "Fresh title", description: "A fresh description from the photo." };
  const before = drafts.length;
  await page.evaluate(() => document.querySelector(".tn-form .rd-again-btn")?.click());
  await wait(2000);
  s = await read(page);
  t.ck("pressing it reads the photos again", drafts.length === before + 1, `${before} -> ${drafts.length}`);
  t.ck("without sending their own words as context", !drafts.at(-1)?.words, drafts.at(-1)?.words);
  t.ck("and replaces their words with the automated description",
    s?.scope === "A fresh description from the photo." && s?.scopeDraft, s?.scope);
  t.ck("and the title with the fresh one", s?.title === "Fresh title", s?.title);
  t.ck("and the line says it was read again", /again/.test(s?.line || ""), s?.line);
  await ctx.close();

  console.log("\n-- a read with no problem it can name still fills the report in --");
  nextDraft = { ok: true, problem: "Something else — I'll describe it", title: "Shelving pulled away",
    description: "The shelf in the closet has come away from the wall.", unclear: false, urgent: false };
  ({ ctx, page } = await openForm());
  await (await page.$(".tn-form input[type=file]")).uploadFile(PHOTO2);
  await wait(2500);
  s = await read(page);
  t.ck("Something else is picked", /Something else/.test(s?.chosen || ""), s?.chosen);
  t.ck("so the description is on screen", /closet/.test(s?.scope || ""), s?.scope);
  await ctx.close();

  console.log("\n-- an unreadable photo fills in nothing --");
  drafts.length = 0;
  nextDraft = { ok: true, problem: null, title: "", description: "The photo is too dark to see what is wrong.",
    unclear: true, urgent: false };
  ({ ctx, page } = await openForm());
  await (await page.$(".tn-form input[type=file]")).uploadFile(PHOTO2);
  await wait(2500);
  s = await read(page);
  t.ck("no problem is picked", !s?.chosen, s?.chosen);
  t.ck("and the line says why", /couldn't tell what's wrong/.test(s?.line) && /too dark/.test(s?.line), s?.line);
  await ctx.close();

  console.log("\n-- a failed read leaves the form to them --");
  nextDraft = null;
  ({ ctx, page } = await openForm());
  await (await page.$(".tn-form input[type=file]")).uploadFile(PHOTO2);
  await wait(2500);
  s = await read(page);
  t.ck("it says so, and the photo still goes", /Couldn't read your photos/.test(s?.line) && /still go/.test(s?.line), s?.line);
  await ctx.close();

  console.log("\n-- no key, no claim --");
  configured = false;
  drafts.length = 0;
  ({ ctx, page } = await openForm());
  s = await read(page);
  t.ck("the form is still there", !!s);
  t.ck("but says nothing about AI", !/AI/.test(s?.hint || ""), s?.hint);
  await (await page.$(".tn-form input[type=file]")).uploadFile(PHOTO2);
  await wait(1500);
  t.ck("and reads nothing", drafts.length === 0);
  await ctx.close();
} catch (e) { t.ck("threw", false, e?.stack || String(e)); }
await browser.close(); web.close(); api.close();
t.done();
