// THE CLAIM PAGE, drawn in a browser at phone width.
//
// A "Sent via SubSub" link opens /claim/<token> on somebody's phone. What has
// to be true there is what the server suite cannot see:
//
//   THE WORK ORDER COMES FIRST, and it is the work order they were sent.
//   "FREE FOR SUBCONTRACTORS, FOREVER" IS ON THE PAGE, above the button.
//   TWO FIELDS, NOT A FORM: the email, then the emailed code, and nothing else.
//   A TEXTED CODE IS OFFERED ONLY WHEN THE SERVER SAYS IT CAN SEND ONE -- the
//   default today, with no SMS provider, is email alone.
//   A REFUSAL SAYS WHAT TO DO, and the page does not move on over one.
//   A COMPANY ALREADY ON SUBSUB IS SENT TO SIGN IN, not asked to sign up.
//   AND IT FITS: no sideways scroll at 390px, thumb-sized controls.
//
//   node --no-warnings scripts/claim-ui-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT = join(app, "dist-claim-test");
const WEB = 5431, API = 9131;
const t = tally();
const TOK = "e".repeat(64);
const GONE = "f".repeat(64);

const PAGE = (state = "claimable") => ({
  state, phoneLogin: S.phoneLogin, emailLogin: S.emailLogin,
  emailHint: "r•••@bay.test",
  company: { name: "Bay Roofing", contact: "Rae Bay" },
  phoneHint: "(•••) •••-0101",
  account: { id: "acc_gc", name: "Outerhome", subdomain: "outerhome", theme: null, logoKey: null,
    useDefaultMark: true, signIn: "https://outerhome.subsub.work/" },
  workOrder: { number: "WO-114617", trade: "roofing", title: "Reroof the Lee house",
    address: "12 Elm St", area: "Seattle", zip: "98101", date: "2026-11-20", time: "07:00",
    scope: "Tear off and reroof the north slope", payKind: "fixed", valueCents: 120000,
    rateCents: null, capHours: null, respondBy: "2026-11-10T17:00:00.000Z", status: "pending",
    autoScheduled: false, withdrawn: false },
});
const S = { state: "claimable", codes: [], verifies: [], noSms: false, phoneLogin: false, emailLogin: true };

const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, body) => {
  if (path === `/api/claim/${GONE}`) return [404, { error: "not_found" }];
  if (path === `/api/claim/${TOK}`) return [200, PAGE(S.state)];
  if (path === `/api/claim/${TOK}/code` && method === "POST") {
    S.codes.push(body);
    if (S.noSms) return [501, { error: "phone_login_unavailable" }];
    if (body?.email != null) {
      if (body.email.trim().toLowerCase() !== "rae@bay.test") return [409, { error: "email_mismatch", hint: "r•••@bay.test" }];
      return [200, { ok: true, sentTo: "r•••@bay.test" }];
    }
    if (String(body?.phone || "").replace(/\D/g, "").endsWith("0102"))
      return [409, { error: "phone_mismatch", hint: "(•••) •••-0101" }];
    return [200, { ok: true, sentTo: "(•••) •••-0101" }];
  }
  if (path === `/api/claim/${TOK}/verify` && method === "POST") {
    S.verifies.push(body);
    if (body?.code !== "123456") return [400, { error: "bad_code" }];
    return [200, { ok: true, attributed: true, userId: "u_rae", accountId: "acc_gc", subdomain: "outerhome",
      session: { access_token: "a", refresh_token: "r", expires_in: 3600 } }];
  }
  if (path.startsWith("/api/account-by-subdomain/")) return [404, { error: "not_found" }];
  return undefined;
} });

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });
const browser = await launch();
const PHONE = { width: 390, height: 844 };

const read = (page) => page.evaluate(() => {
  const card = document.querySelector(".claim-card, .pack-card");
  const box = document.querySelector(".claim-box");
  const btn = box?.querySelector("button.btn-solid, a.btn-solid");
  const inputs = [...(box?.querySelectorAll("input") || [])];
  return {
    text: (card?.innerText || "").replace(/\s+/g, " ").trim(),
    h1: (card?.querySelector("h1")?.innerText || "").trim(),
    box: (box?.innerText || "").replace(/\s+/g, " ").trim(),
    inputs: inputs.map((i) => ({ type: i.type, auto: i.autocomplete, h: i.getBoundingClientRect().height })),
    btn: btn ? { text: btn.innerText.trim(), h: btn.getBoundingClientRect().height,
      disabled: !!btn.disabled, href: btn.getAttribute("href") } : null,
    err: (box?.querySelector(".claim-err")?.innerText || "").trim(),
    sw: (box?.querySelector(".claim-switch")?.innerText || "").trim(),
    foot: (document.querySelector(".pack-foot")?.innerText || "").trim(),
    wide: document.documentElement.scrollWidth > window.innerWidth + 1,
    factsTop: document.querySelector(".claim-facts")?.getBoundingClientRect().top ?? null,
    boxTop: box?.getBoundingClientRect().top ?? null,
    auth: localStorage.getItem("subsub.auth"),
  };
});
const type = (page, sel, v) => page.evaluate(({ sel, v }) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, { sel, v });
const press = (page) => page.evaluate(() => document.querySelector(".claim-box button.btn-solid")?.click());

try {
  console.log("\n-- the work order, then a free login by email --");
  {
    S.state = "claimable"; S.phoneLogin = false; S.emailLogin = true;
    const { ctx, page, crashes } = await visitApp(browser, { host: "app", webPort: WEB,
      viewport: PHONE, path: `/claim/${TOK}` });
    await wait(2200);
    const r = await read(page);
    t.ck("the page opens on the work order", /Roofing/.test(r.h1) && /Reroof the Lee house/.test(r.h1), r.h1);
    t.ck("from the account that sent it", /Work order from Outerhome/i.test(r.text), r.text.slice(0, 120));
    t.ck("with where, when, pay and the scope",
      /12 Elm St/.test(r.text) && /Nov 20, 2026/.test(r.text) && /\$1,200/.test(r.text)
      && /Tear off and reroof the north slope/.test(r.text), r.text);
    t.ck("the work order comes before the sign-up", r.factsTop != null && r.boxTop != null && r.factsTop < r.boxTop);
    t.ck("it says subs are free, forever", /free for subcontractors, forever/i.test(r.box), r.box);
    t.ck("and names the address to use without printing it", /r•••@bay\.test/.test(r.box) && !/rae@bay/.test(r.text), r.box);
    t.ck("one field: an email box", r.inputs.length === 1 && r.inputs[0].type === "email"
      && r.inputs[0].auto === "email", JSON.stringify(r.inputs));
    t.ck("with no texting offered while it cannot send", r.sw === "" && !/text/i.test(r.btn?.text || ""), r.sw);
    t.ck("thumb-sized", r.inputs[0]?.h >= 44 && r.btn?.h >= 44, JSON.stringify([r.inputs[0]?.h, r.btn?.h]));
    t.ck("the button is dead until there is an address", r.btn?.disabled === true);
    t.ck("no sideways scroll at 390px", r.wide === false);
    t.ck("the footer says how it was sent", /Sent via SubSub/.test(r.foot), r.foot);

    // The wrong address is refused, said in words, and the page stays put.
    await type(page, ".claim-box input", "someone@else.test");
    await wait(150); await press(page); await wait(700);
    const r2 = await read(page);
    t.ck("the wrong address is refused in words", /Use the email address this work order was sent to/.test(r2.err), r2.err);
    t.ck("and the page does not move on to the code", r2.inputs[0]?.type === "email");

    await type(page, ".claim-box input", "Rae@Bay.test");
    await wait(150); await press(page); await wait(800);
    const r3 = await read(page);
    t.ck("the right address gets a code, and the page asks for it",
      /Enter the code/.test(r3.box) && r3.inputs[0]?.auto === "one-time-code", JSON.stringify(r3.inputs));
    t.ck("and says where it went, and to check spam", /emailed a code to r•••@bay\.test/.test(r3.box) && /spam/.test(r3.box), r3.box);
    t.ck("sent by email, not by phone", S.codes.at(-1)?.email === "Rae@Bay.test" && !("phone" in (S.codes.at(-1) || {})),
      JSON.stringify(S.codes.at(-1)));
    t.ck("the button says what it does, and that it is free", /Create my free account/.test(r3.btn?.text || ""), r3.btn?.text);

    await type(page, ".claim-box input", "999999");
    await wait(150); await press(page); await wait(700);
    const r4 = await read(page);
    t.ck("a wrong code is said in words", /didn't work/.test(r4.err), r4.err);
    t.ck("and nothing is stored", r4.auth === null);

    await type(page, ".claim-box input", "123456");
    await wait(150); await press(page); await wait(900);
    const r5 = await read(page);
    t.ck("the right code makes the login", /You're on SubSub/.test(r5.box), r5.box);
    t.ck("signed in to the account that sent it",
      JSON.parse(r5.auth || "{}").userId === "u_rae" && JSON.parse(r5.auth || "{}").accountId === "acc_gc", r5.auth);
    t.ck("with one press onward to the work order", r5.btn?.href === "/" && /Open my work order/.test(r5.btn?.text || ""));
    t.ck("verify carried the same address and the code",
      S.verifies.at(-1)?.email === "Rae@Bay.test" && S.verifies.at(-1)?.code === "123456", JSON.stringify(S.verifies.at(-1)));
    t.ck("no page error", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a reply that does not say whether texting works --");
  {
    // An older server, or a field dropped on the way: unknown is NOT on. A
    // phone box that can never send a code is the dead end this guards.
    S.state = "claimable"; S.phoneLogin = undefined;
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, viewport: PHONE, path: `/claim/${TOK}` });
    await wait(2000);
    const r = await read(page);
    t.ck("unknown reads as email only", r.inputs[0]?.type === "email" && r.sw === "", JSON.stringify([r.inputs, r.sw]));
    S.phoneLogin = false;
    await ctx.close();
  }

  console.log("\n-- once texting can send, it is offered beside email --");
  {
    S.state = "claimable"; S.phoneLogin = true;
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, viewport: PHONE, path: `/claim/${TOK}` });
    await wait(2000);
    const r = await read(page);
    t.ck("email is still the default", r.inputs[0]?.type === "email", JSON.stringify(r.inputs));
    t.ck("with a way to a texted code instead", /Text me a code instead/.test(r.sw), r.sw);
    await page.evaluate(() => document.querySelector(".claim-switch")?.click()); await wait(300);
    const r1 = await read(page);
    t.ck("pressed, it asks for the mobile it was sent to", r1.inputs[0]?.type === "tel" && /ending 0101/.test(r1.box), r1.box);
    await type(page, ".claim-box input", "206 555 0102");
    await wait(150); await press(page); await wait(700);
    const r2 = await read(page);
    t.ck("the wrong mobile is refused in words", /Use the mobile this work order was sent to/.test(r2.err), r2.err);
    await type(page, ".claim-box input", "(206) 555-0101");
    await wait(150); await press(page); await wait(800);
    const r3 = await read(page);
    t.ck("the right mobile gets a texted code", /We texted a code/.test(r3.box)
      && S.codes.at(-1)?.phone === "(206) 555-0101", JSON.stringify(S.codes.at(-1)));
    S.phoneLogin = false;
    await ctx.close();
  }

  console.log("\n-- a company already on SubSub is sent to sign in --");
  {
    S.state = "on_subsub";
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, viewport: PHONE, path: `/claim/${TOK}` });
    await wait(2000);
    const r = await read(page);
    t.ck("the work order is still there", /Reroof the Lee house/.test(r.h1));
    t.ck("it says they are on SubSub already", /already on SubSub/.test(r.box), r.box);
    t.ck("and offers sign-in, to the account that sent it", r.btn?.href === "https://outerhome.subsub.work/", r.btn?.href);
    t.ck("with no sign-up box", r.inputs.length === 0);
    await ctx.close();
  }

  console.log("\n-- a texted code Supabase turns out not to send --");
  {
    S.state = "claimable"; S.phoneLogin = true; S.noSms = true;
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, viewport: PHONE, path: `/claim/${TOK}` });
    await wait(2000);
    await page.evaluate(() => document.querySelector(".claim-switch")?.click()); await wait(300);
    await type(page, ".claim-box input", "(206) 555-0101");
    await wait(150); await press(page); await wait(800);
    const r = await read(page);
    t.ck("the dead phone box goes, back to email", r.inputs.length === 1 && r.inputs[0].type === "email", JSON.stringify(r.inputs));
    t.ck("and texting is no longer offered", r.sw === "", r.sw);
    t.ck("with no error left over a form that works", r.err === "", r.err);
    S.noSms = false; S.phoneLogin = false;
    await ctx.close();
  }

  console.log("\n-- no way in at all yet --");
  {
    S.state = "claimable"; S.phoneLogin = false; S.emailLogin = false;
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, viewport: PHONE, path: `/claim/${TOK}` });
    await wait(2000);
    const r = await read(page);
    t.ck("there is no box that can never send a code", r.inputs.length === 0, JSON.stringify(r.inputs));
    t.ck("the page says claiming is not open yet", /Claiming opens soon/.test(r.box), r.box);
    t.ck("and offers the account's sign-in", r.btn?.href === "https://outerhome.subsub.work/", r.btn?.href);
    t.ck("the work order is still there", /Reroof the Lee house/.test(r.h1));
    S.emailLogin = true;
    await ctx.close();
  }

  console.log("\n-- a link nobody recognises --");
  {
    const { ctx, page } = await visitApp(browser, { host: "app", webPort: WEB, viewport: PHONE, path: `/claim/${GONE}` });
    await wait(2000);
    const r = await read(page);
    t.ck("says it could not find it, and what to do", /couldn't find that work order/i.test(r.text)
      && /Open it again/.test(r.text), r.text);
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}
t.done();
