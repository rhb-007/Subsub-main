// THE TENANT PICKER ON THE CREATE-JOB FORM, drawn and driven.
//
// Asked for as a "Tenant" drop-down beside Homeowner / client, listing the
// tenants of whichever building was picked. What is pinned:
//
//   ONLY THE PICKED BUILDING'S TENANTS ARE OFFERED, and picking another
//   building forgets the one chosen -- a tenant belongs to a building.
//
//   NAMING ONE PRE-ANSWERS WHO LETS THEM IN, visibly on step 2, and the save
//   sends both the tenant and that answer.
//
//   A BUILDING WITH NO TENANTS SAYS SO, rather than a drop-down with nothing
//   in it.
//
//   node scripts/job-tenant-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-job-tenant-test");
const WEB = 5477, API = 9177;
const t = tally();

const ACCOUNT = () => ({
  id: "acc_pm", name: "Sound Property Management", subdomain: "soundpm",
  kind: "property_manager", plan: "scale", billing: "monthly", useDefaultMark: true,
  theme: null, trades: [], logoKey: null, subscriptionStatus: "active", hostnameStatus: "active",
  user: { id: "u_mgr", name: "Christopher Lane", email: "chris@soundpm.test", role: "admin" },
});
const prop = (id, name, address) => ({ id, accountId: "acc_pm", name, address, city: "Seattle",
  state: "WA", zip: "98107", units: 10, notes: "", ownedByAnother: false, ownerDeclared: false });
const PROPS = [prop("p_ballard", "Ballard Apts", "2028 NW 59th St"), prop("p_press", "Press Apartments", "1620 Belmont Ave"),
  prop("p_empty", "Empty Block", "9 Nowhere St")];
const ten = (userId, name, unit, propertyId) => ({ userId, name, email: `${userId}@t.test`, phone: null,
  unit, propertyId, propertyName: null, addedAt: "2026-10-01", status: "active", contact: null });
const TENANTS = [ten("u_john", "John Smith", "10A", "p_ballard"), ten("u_ann", "Ann Lee", "2B", "p_ballard"),
  ten("u_mary", "Mary Press", "3B", "p_press")];
const sent = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (method !== "GET") sent.push({ path, method, body });
  if (path === "/api/auth/me") return [200, { user: ACCOUNT().user, memberships: [
    { accountId: "acc_pm", accountName: "Sound Property Management", subdomain: "soundpm", kind: "property_manager",
      role: "admin", companyId: null, plan: "scale", billing: "monthly",
      theme: null, trades: [], logoKey: null, useDefaultMark: true }] }];
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT()];
  if (path === "/api/account") return [200, ACCOUNT()];
  if (path === "/api/properties") return [200, PROPS];
  if (path === "/api/tenants") return [200, TENANTS];
  if (path === "/api/account-users") return [200, [{ id: "u_mgr", name: "Christopher Lane",
    email: "chris@soundpm.test", phone: null, role: "admin", subId: null, propertyIds: [], unit: null,
    hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  if (path === "/api/jobs" && method === "POST") return [201, { id: "j_new", requested: false, job: null }];
  if (["/api/jobs", "/api/subs", "/api/invites", "/api/clients", "/api/connect-requests", "/api/my-connect-requests",
    "/api/doc-shares", "/api/property-transfers", "/api/overflow-posts", "/api/inspections", "/api/my-quotes",
    "/api/visits", "/api/change-orders"].includes(path)) return [200, []];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();

const selectVal = (page, sel, v) => page.evaluate(([s, val]) => {
  const el = document.querySelector(s);
  if (!el) return false;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(el, val);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}, [sel, v]);
const setInput = (page, sel, v) => page.evaluate(([s, val]) => {
  const el = document.querySelector(s);
  if (!el) return false;
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, val);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, [sel, v]);
// The selects on step 1, found by their own label text rather than position.
const selectFor = (label) => `.modal label.fld[data-q="${label}"] select`;
const tagSelects = (page) => page.evaluate(() => {
  for (const l of document.querySelectorAll(".modal label.fld")) {
    const own = [...l.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim();
    if (/^Property/.test(own)) l.setAttribute("data-q", "property");
    if (/^Tenant/.test(own)) l.setAttribute("data-q", "tenant");
  }
});
const tenantField = (page) => page.evaluate(() => {
  const l = [...document.querySelectorAll(".modal label.fld")].find((x) =>
    /^Tenant/.test([...x.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim()));
  if (!l) return null;
  const s = l.querySelector("select");
  return { options: s ? [...s.options].map((o) => o.textContent.trim()) : null, value: s?.value ?? null,
    hint: l.querySelector(".job-no-tenant")?.innerText.trim() || null };
});
const next = (page) => page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")]
  .find((b) => /^Next/.test(b.innerText.trim()))?.click());

try {
  const { page } = await visitApp(browser, { host: "soundpm", webPort: WEB,
    seat: { userId: "u_mgr", accountId: "acc_pm" }, viewport: { width: 1180, height: 1500 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  await wait(2800);
  await page.evaluate(() => document.querySelector(".ss-header .add-btn")?.click());
  await wait(400);
  await page.evaluate(() => [...document.querySelectorAll(".add-menu button")]
    .find((b) => /^Job/.test((b.innerText || "").trim()))?.click());
  await wait(800);
  const open = await page.evaluate(() => /Create job/.test(document.querySelector(".modal h2")?.innerText || ""));
  t.ck("the create-job form is open", open);

  console.log("\n-- nothing is asked before a building is picked --");
  t.ck("no tenant field with no building", (await tenantField(page)) === null);

  console.log("\n-- only that building's tenants --");
  await tagSelects(page);
  await selectVal(page, selectFor("property"), "p_ballard");
  await wait(600);
  const f1 = await tenantField(page);
  t.ck("a Tenant field appears once a building is picked", !!f1?.options, JSON.stringify(f1));
  t.ck("it lists that building's tenants, with their unit",
    !!f1?.options && f1.options.includes("John Smith · unit 10A") && f1.options.includes("Ann Lee · unit 2B"),
    JSON.stringify(f1?.options));
  t.ck("and not another building's", !!f1?.options && !f1.options.some((o) => /Mary/.test(o)), JSON.stringify(f1?.options));
  t.ck("leaving it empty is a choice offered in words", f1?.options?.[0] === "No tenant on this job", JSON.stringify(f1?.options));

  await tagSelects(page);
  await selectVal(page, selectFor("tenant"), "u_john");
  await wait(300);
  t.ck("a tenant can be picked", (await tenantField(page))?.value === "u_john");

  await tagSelects(page);
  await selectVal(page, selectFor("property"), "p_press");
  await wait(300);
  const f2 = await tenantField(page);
  t.ck("another building forgets the tenant picked", f2?.value === "", JSON.stringify(f2));
  t.ck("and lists its own", !!f2?.options && f2.options.includes("Mary Press · unit 3B")
    && !f2.options.some((o) => /John/.test(o)), JSON.stringify(f2?.options));
  // A drop-down reads blank over a value that is not one of its options, so
  // the select alone cannot tell "forgotten" from "still held and hidden".
  // Step 2 can: a tenant still held keeps "the tenant needs to be in" offered
  // and chosen, and that is what would be sent.
  await next(page);
  await wait(300);
  const acc2 = await page.evaluate(() => [...document.querySelectorAll(".modal .acc-grid .pick")]
    .map((b) => ({ label: b.innerText.trim(), on: b.classList.contains("on") })));
  t.ck("and the answer that came with them goes too",
    acc2.length > 0 && !acc2.some((a) => /tenant needs to be in/i.test(a.label)) && !acc2.some((a) => a.on),
    JSON.stringify(acc2));
  await page.evaluate(() => [...document.querySelectorAll(".modal .job-steps button")]
    .find((b) => /Where/.test(b.innerText))?.click());
  await wait(300);

  await tagSelects(page);
  await selectVal(page, selectFor("property"), "p_empty");
  await wait(300);
  const f3 = await tenantField(page);
  t.ck("a building with no tenants says so instead of an empty drop-down",
    f3?.options === null && /No tenants on this building yet/.test(f3?.hint || ""), JSON.stringify(f3));

  console.log("\n-- naming one pre-answers who lets them in, and the save sends both --");
  await tagSelects(page);
  await selectVal(page, selectFor("property"), "p_ballard");
  await wait(300);
  await tagSelects(page);
  await selectVal(page, selectFor("tenant"), "u_john");
  await wait(300);
  await next(page);
  await wait(400);
  const acc = await page.evaluate(() => [...document.querySelectorAll(".modal .acc-grid .pick")]
    .map((b) => ({ label: b.innerText.trim(), on: b.classList.contains("on") })));
  t.ck("step 2 offers 'The tenant needs to be in' once a tenant is named",
    acc.some((a) => /tenant needs to be in/i.test(a.label)), JSON.stringify(acc));
  t.ck("and it is the answer already chosen", acc.find((a) => a.on)?.label === "The tenant needs to be in",
    JSON.stringify(acc));
  await setInput(page, ".modal input[type='date']", "2027-11-04");
  await wait(200);
  await next(page);
  await wait(400);
  await page.evaluate(() => [...document.querySelectorAll(".modal .pick-grid .chip, .modal .pick-grid button")]
    .find((b) => /Painting/i.test(b.innerText))?.click());
  await wait(200);
  await next(page);
  await wait(400);
  await page.evaluate(() => [...document.querySelectorAll(".modal .form-actions button")]
    .find((b) => /Create job/i.test(b.innerText))?.click());
  await wait(900);
  const post = [...sent].reverse().find((x) => x.path === "/api/jobs" && x.method === "POST");
  t.ck("the job was sent", !!post, JSON.stringify(sent.map((x) => x.path)));
  t.ck("naming the tenant", post?.body?.accessUserId === "u_john", JSON.stringify(post?.body?.accessUserId));
  t.ck("with the access answer that came with them", post?.body?.access === "tenant", JSON.stringify(post?.body?.access));
  t.ck("and nothing threw on the way", errs.length === 0, errs.join(" | "));
} catch (e) {
  t.ck("the suite ran to the end", false, e?.stack || String(e));
} finally {
  await browser.close(); web.close(); api.close();
}
t.done();
