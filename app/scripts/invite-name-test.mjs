// Typing a company name into the invite form did nothing.
//
// Reported as "company name is not activating a search of an existing
// contractor". It was not broken: the lookup in that form matches on a whole
// email, a whole mobile or a whole licence number and on nothing else, and
// deliberately so. A name search across every company on SubSub is a
// directory of the platform, and any account could walk it one prefix at a
// time. That stays as it is.
//
// What a name can be matched against is the account's OWN contractors and
// its own outstanding invites -- its own data, disclosing nothing, and the
// thing that catches the mistake that actually happens: inviting a company
// you already work with, or inviting the same one twice in a week.
//
// Half of this is the normaliser, which is where it will quietly go wrong:
// "Enterprise Roofing", "Enterprise Roofing LLC" and "enterprise roofing,
// inc." are one company to everybody except a string comparison. It is
// lifted out of App.tsx at runtime so a copy here cannot drift from it.
//
//   node scripts/invite-name-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const t = tally();

// ---- the normaliser, not a copy of it ---------------------------------
{
  const src = readFileSync(join(app, "src", "App.tsx"), "utf8");
  const from = src.indexOf("const NAME_NOISE =");
  const to = src.indexOf(".trim();", from) + ".trim();".length;
  t.ck("the normaliser was found in App.tsx", from > 0 && to > from, `${from}..${to}`);
  // eslint-disable-next-line no-new-func
  const nameKey = new Function(`${src.slice(from, to)}; return nameKey;`)();

  console.log("\n-- one company, however it is typed --");
  const same = (a, b) => nameKey(a) === nameKey(b) && nameKey(a) !== "";
  for (const [a, b] of [
    ["Enterprise Roofing", "Enterprise Roofing LLC"],
    ["Enterprise Roofing", "enterprise roofing, inc."],
    ["Enterprise Roofing", "  ENTERPRISE   ROOFING  "],
    ["Cascade Roofworks Co.", "Cascade Roofworks"],
    ["The Gutter Guys", "Gutter Guys"],
    ["Smith & Sons", "Smith and Sons"],
    ["Acme Corp", "Acme Corporation"],
  ]) t.ck(`${a} = ${b}`, same(a, b), `${nameKey(a)} | ${nameKey(b)}`);

  // Punctuation becomes a space rather than nothing, so "A-1" and "A1" are
  // two different keys. Deliberate: collapsing instead would make
  // "Smith-Jones" and "Smithjones" the same and "Smith Jones" different from
  // both, which is the worse trade. This panel only SUGGESTS, so a miss
  // costs a suggestion nobody sees and a false hit costs a glance.
  t.ck("a hyphen splits, and that is the choice being made",
    nameKey("A-1 Plumbing") === "a 1 plumbing", nameKey("A-1 Plumbing"));
  t.ck("so a hyphen and a space agree",
    nameKey("Smith-Jones Roofing") === nameKey("Smith Jones Roofing"), nameKey("Smith-Jones Roofing"));

  console.log("\n-- and two companies that are not --");
  for (const [a, b] of [
    ["Enterprise Roofing", "Enterprise Plumbing"],
    ["Cascade Roofworks", "Cascade Exteriors"],
    ["Northwest Glass", "Northwest Glazing"],
  ]) t.ck(`${a} ≠ ${b}`, !same(a, b), `${nameKey(a)} | ${nameKey(b)}`);

  console.log("\n-- a name that is nothing but noise --");
  for (const junk of ["LLC", "Inc.", "  ", "The", "the", "Ltd", "Corp."]) {
    t.ck(`"${junk}" keys to nothing, so it matches nobody`, nameKey(junk) === "", `"${nameKey(junk)}"`);
  }
  // "&" reads as "and", which is a real word inside a real name
  // ("Smith & Sons"), so it is not thrown away. On its own it is three
  // characters somebody would have to type on purpose.
  t.ck("an ampersand is a word, not noise", nameKey("&") === "and", nameKey("&"));
}

// ---- and the form ------------------------------------------------------
const OUT = join(app, "dist-boot-test");
const WEB = 5204, API = 8916;
console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const ACCOUNT = {
  id: "acc_outer", name: "Outerhome", subdomain: "outerhome", kind: "general_contractor",
  plan: "scale", billing: "monthly", useDefaultMark: true, theme: null, trades: [],
  logoKey: null, subscriptionStatus: "active",
  user: { id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", role: "admin" },
};
// engagementId and accountId matter: the roster is split into a company and
// an engagement on the way in, and a row without them lands nowhere.
const SUBS = [
  { id: "cmp_ent", engagementId: "eng_ent", accountId: "acc_outer",
    company: "Enterprise Roofing LLC", contact: "Dana Poole", status: "active",
    categories: [], caps: [], docReview: {}, trades: [], coverage: { mode: "cities", cities: [], radii: [] }, crews: [], rating: null, ratedJobs: 0 },
  { id: "cmp_cas", engagementId: "eng_cas", accountId: "acc_outer",
    company: "Cascade Roofworks", contact: "Miguel Alvarez", status: "active",
    categories: [], caps: [], docReview: {}, trades: [], coverage: { mode: "cities", cities: [], radii: [] }, crews: [], rating: null, ratedJobs: 0 },
];
const INVITES = [{ id: "inv1", status: "open", companyName: "Northwest Glass", label: "Northwest Glass",
  contact: null, email: "nw@example.test", phone: null, sentAt: new Date(Date.now() - 2 * 86400_000).toISOString() }];

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/account") return [200, ACCOUNT];
  if (path === "/api/subs") return [200, SUBS];
  if (path === "/api/invites") return [200, INVITES];
  if (path === "/api/account-users") {
    return [200, [{ id: "usr_richard", name: "Richard Braun", email: "rb@outerhome.co", phone: null,
      role: "admin", subId: null, propertyIds: [], unit: null, hasLogin: true, inviteSentAt: null, hasAvatar: false }]];
  }
  return undefined;
} });

const browser = await launch();
const openInvite = async () => {
  const r = await visitApp(browser, { host: "outerhome", webPort: WEB,
    seat: { userId: "usr_richard", accountId: "acc_outer" }, viewport: { width: 1200, height: 1100 } });
  await wait(1800);
  // Contractors -> Invite. Retried rather than waited on a fixed delay: the
  // list hydrates in the background and the button is not there until it has.
  await r.page.evaluate(() => {
    [...document.querySelectorAll("nav.tabs button")].find((b) => /contractors/i.test(b.innerText))?.click();
  });
  for (let n = 0; n < 12; n++) {
    await wait(400);
    const opened = await r.page.evaluate(() => {
      if (document.querySelector(".inv-panel")) return true;
      const b = [...document.querySelectorAll("button")].find((x) => /^invite$/i.test(x.innerText.trim()));
      if (b) b.click();
      return !!b;
    });
    if (opened && await r.page.$(".inv-panel")) return r;
  }
  throw new Error("could not open the invite form: "
    + (await r.page.evaluate(() => document.querySelector("pre")?.innerText || document.body.innerText.replace(/\s+/g," ").slice(0,300))));
};
const typeName = async (page, v) => {
  await page.evaluate((val) => {
    const input = [...document.querySelectorAll(".inv-make input")][0];
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(input, val);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, v);
  await wait(350);
};
const hit = (page) => page.evaluate(() => {
  const el = document.querySelector(".inv-name-hit");
  return el ? el.innerText.replace(/\s+/g, " ").trim() : null;
});

try {
  console.log("\n-- typing a name you already work with --");
  {
    const { ctx, page, crashes } = await openInvite();
    t.ck("nothing is claimed before anything is typed", (await hit(page)) === null);

    await typeName(page, "En");
    t.ck("two letters is too little to guess from", (await hit(page)) === null, String(await hit(page)));

    await typeName(page, "Enterprise");
    const said = await hit(page);
    t.ck("the contractor is surfaced", /Enterprise Roofing/i.test(said || ""), String(said));
    t.ck("it says where the match came from",
      /your own contractors/i.test(said || "") && /not a search of subsub/i.test(said || ""), String(said));
    t.ck("and offers to open them", /open/i.test(said || ""), String(said));

    // The suffix is the whole point of the normaliser.
    await typeName(page, "enterprise roofing llc");
    t.ck("the suffix and the case make no difference",
      /Enterprise Roofing/i.test((await hit(page)) || ""), String(await hit(page)));

    await typeName(page, "Enterprise Plumbing");
    t.ck("a different company is not offered", (await hit(page)) === null, String(await hit(page)));

    // Opening them has to actually go somewhere.
    await typeName(page, "Cascade");
    await page.click(".inv-name-hit .btn-solid");
    await wait(600);
    const after = await page.evaluate(() => ({
      modalGone: !document.querySelector(".inv-panel"),
      open: document.body.innerText.includes("Cascade Roofworks"),
    }));
    t.ck("Open closes the invite form", after.modalGone, JSON.stringify(after));
    t.ck("and lands on that contractor", after.open, JSON.stringify(after));
    t.ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }

  console.log("\n-- and a name you already invited --");
  {
    const { ctx, page, crashes } = await openInvite();
    await typeName(page, "Northwest Glass");
    const said = await hit(page);
    t.ck("the outstanding invite is surfaced", /Northwest Glass/i.test(said || ""), String(said));
    t.ck("with when it went and that it is unfinished",
      /invited/i.test(said || "") && /not finished/i.test(said || ""), String(said));
    t.ck("and it does not pretend sending another is dangerous",
      /harmless/i.test(said || ""), String(said));

    await page.evaluate(() => {
      [...document.querySelectorAll(".inv-name-hit button")].find((b) => /not them/i.test(b.innerText))?.click();
    });
    await wait(200);
    t.ck("it can be dismissed and stays dismissed", (await hit(page)) === null);
    t.ck("nothing threw", crashes.length === 0, crashes.join(" ; "));
    await ctx.close();
  }

  console.log("\n-- the name is never sent anywhere to be looked up --");
  {
    api.calls.length = 0;
    const { ctx, page } = await openInvite();
    api.calls.length = 0;
    await typeName(page, "Enterprise Roofing");
    await wait(900);
    t.ck("no lookup request was made for a name",
      !api.calls.some((p) => p.startsWith("/api/connect/lookup")), api.calls.join(" ") || "(none)");
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
