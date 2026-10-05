// The payment-fee panel in the staff console, drawn.
//
// test:feeterms proves the routes. This proves the panel can be REACHED on an
// account, takes a rate as a percent and sends basis points, says what a
// $10,000 payment would cost before the save, waits for a reason, and shows
// support the terms with nothing to press.
//
//   node --no-warnings scripts/fee-terms-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-feeterms-test");
const WEB = 5355, API = 9051;
const t = tally();

console.log("\n-- building the console --");
buildApp({ outDir: OUT, apiPort: API, platform: true });

let STAFF = { userId: "u_staff", name: "Staff Person", email: "staff@subsub.test",
  role: "superadmin", finance: true, impersonate: true };
const BOOT = {
  accounts: [{ id: "acc1", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
    plan: "scale", billing: "monthly", comped: false, compNote: null, trades: [],
    hostnameStatus: "active", subscriptionStatus: "active", createdAt: "2026-01-04", status: "active" }],
  users: [], memberships: [], companies: [], engagements: [],
  jobs: [], subEvents: [], activity: [], smsDaily: [],
};
let TERMS = { terms: { bps: 50, capCents: 50000, freeCents: 5_000_000 },
  defaults: { bps: 50, capCents: 50000, freeCents: 5_000_000 }, custom: false, note: null,
  processedCents: 2_000_000, freeLeftCents: 3_000_000 };
const sent = [];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === "/api/platform/me") return [200, STAFF];
  if (path === "/api/platform/bootstrap") return [200, BOOT];
  if (path === "/api/platform/companies") return [200, []];
  if (path.startsWith("/api/platform/activity/")) return [200, []];
  if (path === "/api/platform/accounts/acc1/fee-terms" && method === "GET") return [200, TERMS];
  if (path === "/api/platform/accounts/acc1/fee-terms" && method === "PUT") {
    sent.push(body);
    TERMS = body.reset ? { ...TERMS, terms: TERMS.defaults, custom: false, note: null }
      : { ...TERMS, terms: { bps: body.bps, capCents: body.capCents, freeCents: body.freeCents },
          custom: true, note: body.note };
    return [200, { ok: true }];
  }
  if (path === "/api/notify/log") return [200, []];
  return undefined;
} });

const browser = await launch();

async function openAccount() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1400, height: 1600 });
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message));
  await page.goto(`http://127.0.0.1:${WEB}/`, { waitUntil: "domcontentloaded" });
  await wait(2600);
  await page.evaluate(() => [...document.querySelectorAll("button, a")]
    .find((b) => /^\s*accounts\s*$/i.test(b.innerText || ""))?.click());
  await wait(700);
  await page.evaluate(() => [...document.querySelectorAll(".pfc-top")]
    .find((c) => /Outerhome/.test(c.innerText))?.click());
  await wait(1200);
  return { ctx, page, crashes };
}
const read = (page) => page.evaluate(() => {
  const p = document.querySelector(".pf-fee");
  return p ? {
    text: p.innerText,
    inputs: [...p.querySelectorAll("input")].map((i) => i.value),
    example: p.querySelector(".pf-fee-example")?.innerText || "",
    save: (() => { const b = [...p.querySelectorAll("button")].find((x) => /Save fee terms/.test(x.innerText));
      return b ? { disabled: b.disabled } : null; })(),
    buttons: [...p.querySelectorAll("button")].map((b) => b.innerText.trim()),
  } : null;
});
const typeIn = (page, idx, v) => page.evaluate((i, val) => {
  const el = document.querySelectorAll(".pf-fee input")[i];
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(el, val); el.dispatchEvent(new Event("input", { bubbles: true }));
}, idx, v);

try {
  console.log("\n-- a superadmin sets an account's fee --");
  {
    const { ctx, page, crashes } = await openAccount();
    let r = await read(page);
    t.ck("the panel is on the account", !!r, JSON.stringify(r));
    t.ck("it says the standard terms and how much of the free amount is used",
      /The standard terms: 0\.5% of each payment, at most \$500 a payment, after the first \$50,000 free/.test(r?.text || "")
      && /\$20,000\.00 sent through SubSub so far, \$30,000\.00 of the free amount left/.test(r?.text || ""), r?.text);
    t.ck("the boxes are in percent and dollars", JSON.stringify(r?.inputs) === JSON.stringify(["0.5", "500", "50000"]),
      JSON.stringify(r?.inputs));
    t.ck("Save waits until something changes", r?.save?.disabled === true);

    await typeIn(page, 0, "0.25");
    await typeIn(page, 1, "250");
    await typeIn(page, 2, "0");
    await wait(300);
    r = await read(page);
    // 0.25% of $10,000 is $25 -- said in a form nobody can misread.
    t.ck("it says what a $10,000 payment would cost before the save",
      /A \$10,000 payment past the free amount would cost them \$25\.00/.test(r.example), r.example);
    t.ck("and waits for a reason", r.save?.disabled === true && r.inputs.length === 4, JSON.stringify(r));
    await typeIn(page, 3, "Design partner — agreed with RB");
    await wait(200);
    r = await read(page);
    t.ck("with a reason, Save is live", r.save?.disabled === false);
    await page.evaluate(() => [...document.querySelectorAll(".pf-fee button")]
      .find((x) => /Save fee terms/.test(x.innerText))?.click());
    await wait(900);
    t.ck("it sends BASIS POINTS and CENTS -- 0.25% is 25, $250 is 25000",
      sent[0]?.bps === 25 && sent[0]?.capCents === 25000 && sent[0]?.freeCents === 0
      && sent[0]?.note === "Design partner — agreed with RB", JSON.stringify(sent[0]));
    r = await read(page);
    t.ck("and reads back as the account's own terms",
      /Their own terms: 0\.25% of each payment, at most \$250 a payment/.test(r.text), r.text);
    t.ck("with a way back to standard", r.buttons.includes("Back to standard terms"), r.buttons.join(","));
    await page.evaluate(() => [...document.querySelectorAll(".pf-fee button")]
      .find((x) => /Back to standard terms/.test(x.innerText))?.click());
    await wait(900);
    t.ck("which resets them", sent[1]?.reset === true, JSON.stringify(sent[1]));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- support sees the terms and nothing to press --");
  {
    STAFF = { ...STAFF, role: "standard", finance: false, impersonate: false };
    const { ctx, page, crashes } = await openAccount();
    const r = await read(page);
    t.ck("the terms are shown", /0\.5% of each payment/.test(r?.text || ""), r?.text);
    t.ck("with no boxes and no buttons", r && r.inputs.length === 0 && r.buttons.length === 0, JSON.stringify(r));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }
} catch (err) {
  t.ck("the suite ran to the end", false, err?.stack || String(err));
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
