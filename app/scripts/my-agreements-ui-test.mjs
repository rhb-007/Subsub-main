// A subcontractor's agreements are one per company, each on that company's
// own row, under a sentence that says so plainly.
//
// Reported with the Compliance pack tab on screen: "An agreement is between
// you and one company, so each of them asks separately -- and plenty never
// ask at all..." was "too complicated and doesn't make any sense", and "each
// agreement should be attached to the subcontractor". So: the grid no longer
// carries a single generic "Signed subcontractor agreement" row, each
// agreement names its company and its form, and the signed copy of a
// company's own paper is uploaded on that company's row.
//
//   node --no-warnings scripts/my-agreements-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-myagr-test");
const WEB = 5791, API = 9311;
const t = tally();

const acct = () => ({
  id: "acc_sub", name: "Pacific Roofing", subdomain: "pacific",
  kind: "subcontractor", plan: "basic", billing: "monthly", useDefaultMark: true, theme: null,
  trades: ["roofing"], logoKey: null, subscriptionStatus: null,
  user: { id: "u_p", name: "Pat Lane", email: "pat@pacific.test", role: "admin" },
});
let docs = { insurance: true, bond: false, w9: true };
const company = () => ({
  companyId: "cmp_sub", company: "Pacific Roofing", contact: "Pat Lane",
  email: "pat@pacific.test", phone: "2065550101", license: "", ubi: "",
  city: "Tacoma", state: "WA", zip: "98402",
  coverage: { mode: "cities", cities: ["Tacoma"], radii: [] },
  docs: Object.fromEntries(Object.entries(docs).filter(([, v]) => v).map(([k]) => [k, { fileName: `${k}.pdf` }])),
  findable: true, code: "cmp_own_acc_sub", openToHire: true, openAnswered: true, url: null, sharesSent: 0,
});
let uploaded = false;
const uploads = [];
const agreements = () => [
  { id: "agr_cascade", accountId: "acc_c", companyId: "cmp_sub", source: "subsub_standard", status: "signed",
    waitingOn: "hiring_countersign", inForce: false, accountName: "Cascade Apartment Services",
    signedAt: "2026-11-01 10:00:00", signedByName: "Pat Lane", document: null },
  { id: "agr_ridge", accountId: "acc_r", companyId: "cmp_sub", source: "uploaded",
    status: uploaded ? "signed" : "sent", waitingOn: uploaded ? "hiring_countersign" : "sub_upload",
    inForce: false, accountName: "Ridge Builders", document: null },
];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method) => {
  if (method === "PUT" && path.startsWith("/api/uploads/contract/")) return [200, { key: "acc_sub/contract/x-signed.pdf" }];
  if (method === "POST" && path === "/api/subs/cmp_sub/documents/contract") {
    uploads.push(path); uploaded = true; docs = { ...docs, contract: true };
    return [200, { ok: true }];
  }
  if (path === "/api/my-agreements") return [200, agreements()];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, acct()];
  if (path === "/api/account") return [200, acct()];
  if (path === "/api/my-company") return [200, company()];
  if (path === "/api/my-work") return [200, { work: [] }];
  if (path === "/api/account-users") return [200, [
    { id: "u_p", name: "Pat Lane", email: "pat@pacific.test", phone: null, role: "admin", subId: null,
      propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (["/api/jobs", "/api/subs", "/api/properties", "/api/invites", "/api/clients", "/api/visits",
    "/api/my-connect-requests", "/api/connect-requests", "/api/property-transfers", "/api/my-quotes",
    "/api/doc-shares", "/api/inspections", "/api/change-orders", "/api/my-waivers"].includes(path)) return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const read = (page) => page.evaluate(() => {
  const panel = document.querySelector(".agr-panel");
  return {
    gridRows: [...document.querySelectorAll(".mydocs .mydoc b")].map((b) => b.innerText.trim()),
    note: panel?.querySelector(".cx-sub")?.innerText || "",
    rows: [...document.querySelectorAll(".agr-panel .agr-row")].map((r) => ({
      text: r.innerText.replace(/\s+/g, " ").trim(),
      upload: !!r.querySelector(".agr-upload input[type=file]"),
    })),
  };
});

try {
  const { ctx, page, crashes } = await visitApp(browser, { host: "pacific", webPort: WEB,
    seat: { userId: "u_p", accountId: "acc_sub" }, viewport: { width: 1024, height: 1300 } });
  await wait(2000);
  await page.evaluate(() => document.querySelector(".user-btn")?.click()); await wait(400);
  await page.evaluate(() => document.querySelector(".user-menu .um-account")?.click()); await wait(700);
  await page.evaluate(() => [...document.querySelectorAll(".acct-tabs button")].find((b) => b.innerText.trim() === "Pack & Passport")?.click());
  await wait(1200);
  let s = await read(page);
  t.ck("the compliance pack opened", s.gridRows.length >= 3, JSON.stringify(s));
  t.ck("no single 'Signed subcontractor agreement' row in the documents when none is on file",
    s.gridRows.length >= 3 && !s.gridRows.some((x) => /agreement/i.test(x)), JSON.stringify(s.gridRows));
  t.ck("the agreements note is short and plain",
    /Each one is with that company only/.test(s.note) && !/plenty never ask/.test(s.note), s.note);
  const cascade = s.rows.find((r) => /Cascade Apartment Services/.test(r.text));
  const ridge = s.rows.find((r) => /Ridge Builders/.test(r.text));
  t.ck("each agreement is a row named for its company", !!cascade && !!ridge, JSON.stringify(s.rows));
  t.ck("and says which agreement it is", /SubSub Standard Subcontractor Agreement/.test(cascade?.text || "")
    && /Their own agreement/.test(ridge?.text || ""), JSON.stringify(s.rows));
  t.ck("a company's own paper is uploaded on that company's row", !!ridge?.upload && !cascade?.upload, JSON.stringify(s.rows));
  t.ck("nothing points at a row above that is no longer there", !s.rows.some((r) => /signed agreement above/.test(r.text)));

  const input = await page.$(".agr-panel .agr-upload input[type=file]");
  await input?.uploadFile(join(app, "package.json"));
  await wait(1500);
  s = await read(page);
  t.ck("uploading on the row files it as the signed agreement", uploads.length === 1, JSON.stringify(uploads));
  const ridge2 = s.rows.find((r) => /Ridge Builders/.test(r.text));
  t.ck("and the row then waits on them to countersign", !!ridge2 && !ridge2.upload && /countersign/i.test(ridge2.text), ridge2?.text);
  t.ck("a signed copy on file shows in the documents again", s.gridRows.some((x) => /agreement/i.test(x)), JSON.stringify(s.gridRows));
  t.ck("no page error", crashes.length === 0, crashes.join(" | "));
  await ctx.close();
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
