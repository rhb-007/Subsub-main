// An invite that only needs a password should ask for a password.
//
// Cascade Management pressed Resend invite on San Juan Exteriors -- a
// contractor they had typed in themselves, with the company, the contact, the
// address, the licence and the trades all on the roster -- and the link landed
// on the three-step application form, asking that contractor to type all of it
// again. Being on a roster and being able to sign in are two different
// records, and the only thing missing from the second one is a password.
//
// Asking somebody to retype what the email they just opened was sent about is
// asking them to prove they read it, and it is where an invite gets abandoned.
//
// What this covers:
//
//   THE SHORT PATH RENDERS when the server says there is enough on file:
//   one screen, their own details shown back to them, one password box.
//
//   THE FULL FORM STILL RENDERS when there is not -- a cold applicant off a
//   customer's own website, and an invite raised from the old blank form,
//   which carries a name and an address and no record at all.
//
//   IT IS CORRECTABLE. The details are shown so that a wrong one can be
//   fixed, and "Fill it in yourself" drops through to the same full form
//   rather than to a dead end. Showing them and offering no way to change
//   them would be worse than not showing them.
//
//   AND IT POSTS THE SAME BODY the full form does, to the same route, so
//   there is one application flow and not two.
//
//   node scripts/invite-short-test.mjs

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, serveApp, serveApi, launch, visitApp, tally, wait } from "./lib/stub-stack.mjs";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const t = tally();
const OUT = join(app, "dist-inviteshort-test");
const WEB = 5255, API = 8967;

console.log("\n-- building --");
buildApp({ outDir: OUT, apiPort: API });

const ACCOUNT = {
  id: "acc_pm", name: "Cascade Management", subdomain: "cascademanagement",
  kind: "property_manager", plan: "scale", billing: "monthly",
  useDefaultMark: true, theme: null, trades: [], logoKey: null,
  subscriptionStatus: "active",
};

// What the two links answer. `known` is the record the account already holds;
// `knownEnough` is the server's verdict on whether there is a real profile
// there or a name somebody typed and nothing else -- decided in the Worker so
// the email and the screen cannot disagree about it.
const BOUND = {
  label: "San Juan Exteriors", invitedEmail: "r.hb@outlook.com",
  phone: "2065550100", contact: "Rob H", companyName: "San Juan Exteriors",
  known: {
    company: "San Juan Exteriors", contact: "Rob H", email: "r.hb@outlook.com",
    phone: "2065550100", license: "SANJUAN123AB", ubi: null,
    city: "Seattle", state: "WA", zip: "98101",
    categories: ["roofing", "gutters"],
  },
  knownEnough: true,
  account: { name: ACCOUNT.name, subdomain: ACCOUNT.subdomain, theme: null,
    logoKey: null, useDefaultMark: true, id: ACCOUNT.id },
};
// The same record, but the invite was mailed somewhere else -- a resend of an
// invite raised off the old blank form, adopted onto this company, addressed to
// an address the record does not carry.
const MOVED = {
  ...BOUND,
  invitedEmail: "rob@sanjuanexteriors.test",
};
const COLD = {
  label: "Someone New", invitedEmail: "new@sub.test", phone: null,
  contact: null, companyName: "Someone New",
  known: null, knownEnough: false,
  account: BOUND.account,
};

const posted = [];
const web = serveApp({ dir: OUT, port: WEB });
const api = serveApi({ port: API, routes: (path, method, sent) => {
  if (path.startsWith("/api/account-by-subdomain/")) return [200, ACCOUNT];
  if (path === "/api/invite/tok_bound") {
    if (method === "POST") { posted.push(sent); return [200, { ok: true, login: { created: true } }]; }
    return [200, BOUND];
  }
  if (path === "/api/invite/tok_moved") {
    if (method === "POST") { posted.push(sent); return [200, { ok: true, login: { created: true } }]; }
    return [200, MOVED];
  }
  if (path === "/api/invite/tok_cold") {
    if (method === "POST") { posted.push(sent); return [200, { ok: true, login: { created: true } }]; }
    return [200, COLD];
  }
  return undefined;
} });

const browser = await launch();
const openLink = async (token) => {
  // No seat: this is somebody holding a link, with no session at all.
  const r = await visitApp(browser, { host: "cascademanagement", webPort: WEB,
    viewport: { width: 900, height: 1200 } });
  await r.page.goto(`http://cascademanagement.subsub.work:${WEB}/?invite=${token}`,
    { waitUntil: "domcontentloaded" });
  for (let n = 0; n < 20; n++) {
    await wait(300);
    if (await r.page.$(".wl-card h1")) break;
  }
  return r;
};
const text = (page) => page.evaluate(() => document.body.innerText);
const buttons = (page) => page.evaluate(() =>
  [...document.querySelectorAll(".wl-card button")].map((b) => b.innerText.replace(/\s+/g, " ").trim()));

try {
  console.log("\n-- the link for somebody the account already holds --");
  {
    const { ctx, page, crashes } = await openLink("tok_bound");
    const body = await text(page);

    // THE POINT.
    t.ck("it asks for a password, not for an application",
      /Choose a password/i.test(body), body.split("\n").slice(0, 6).join(" / "));
    t.ck("and says why there is nothing else to do",
      /already has your details/i.test(body),
      body.split("\n").find((l) => /details/i.test(l)) || "");
    t.ck("the three-step bar is gone",
      await page.evaluate(() => !document.querySelector(".wl-steps")));
    t.ck("so is the heading that invites an application",
      !/Work with Cascade Management/i.test(body));
    t.ck("and so is the two-minutes promise",
      !/takes about two minutes/i.test(body));

    // Shown back to them, off the record, so a wrong one is visible.
    const known = await page.evaluate(() => [...document.querySelectorAll(".wl-known div")]
      .map((d) => d.innerText.replace(/\s+/g, " ").trim()));
    t.ck("their company is shown", known.some((l) => /San Juan Exteriors/.test(l)), known.join(" | "));
    t.ck("their name is shown", known.some((l) => /Rob H/.test(l)), known.join(" | "));
    t.ck("their address is shown", known.some((l) => /r\.hb@outlook\.com/.test(l)), known.join(" | "));
    t.ck("the trades the account hired them for are shown",
      known.some((l) => /Roofing/i.test(l)) && known.some((l) => /Gutter/i.test(l)), known.join(" | "));
    // Stored as ten digits; a bare 2065550100 in front of somebody is the
    // same field the form beside it formats as you type.
    t.ck("and the mobile is punctuated, not ten bare digits",
      known.some((l) => /\(206\)555-0100/.test(l)) && !known.some((l) => /\b2065550100\b/.test(l)),
      known.join(" | "));

    // One box.
    t.ck("exactly one input, and it is the password",
      await page.evaluate(() => {
        const ins = [...document.querySelectorAll(".wl-card input")];
        return ins.length === 1 && ins[0].type === "password";
      }), String(await page.evaluate(() => [...document.querySelectorAll(".wl-card input")].map((i) => i.type).join(","))));

    const bs = await buttons(page);
    t.ck("the button says what pressing it does",
      bs.some((b) => /Set password and sign in/i.test(b)), bs.join(" | "));
    t.ck("nothing says Continue", !bs.some((b) => /^Continue$/i.test(b)), bs.join(" | "));
    t.ck("nothing says Submit application",
      !bs.some((b) => /Submit application/i.test(b)), bs.join(" | "));
    t.ck("and somebody who already has a login can still say so",
      bs.some((b) => /I already have an account/i.test(b)), bs.join(" | "));

    t.ck("it will not send an empty password", await page.evaluate(() =>
      [...document.querySelectorAll(".wl-card button")]
        .find((b) => /Set password/i.test(b.innerText))?.disabled === true));

    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and it sends the record, not a blank form --");
  {
    const { ctx, page, crashes } = await openLink("tok_bound");
    posted.length = 0;
    await page.evaluate(() => {
      const i = document.querySelector(".wl-card input[type=password]");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(i, "hunter2hunter2");
      i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".wl-card button")]
      .find((b) => /Set password/i.test(b.innerText))?.click());
    for (let n = 0; n < 20 && !posted.length; n++) await wait(200);
    // The post landing is not the screen changing: the reply still has to come
    // back and the confirmation still has to render.
    for (let n = 0; n < 20; n++) {
      await wait(200);
      if (await page.$(".wl-done")) break;
    }

    const sent = posted[0] || {};
    // The same body the full form posts, to the same route: one application
    // flow, not two.
    t.ck("it posted", posted.length === 1, JSON.stringify(sent).slice(0, 120));
    t.ck("carrying the company off the record", sent.company === "San Juan Exteriors", String(sent.company));
    t.ck("the contact", sent.contact === "Rob H", String(sent.contact));
    t.ck("the address", sent.email === "r.hb@outlook.com", String(sent.email));
    t.ck("the licence", sent.license === "SANJUAN123AB", String(sent.license));
    t.ck("the trades", JSON.stringify(sent.categories) === '["roofing","gutters"]',
      JSON.stringify(sent.categories));
    t.ck("and the password they chose", sent.password === "hunter2hunter2", String(sent.password));

    const done = await text(page);
    // Not "thanks, we've got it, we'll review your details": nothing was
    // applied for and the account decided before the email went out. What is
    // new is the password.
    t.ck("and it confirms the password, not an application",
      /You're set/i.test(done) && /password is set/i.test(done),
      done.split("\n").slice(0, 5).join(" / "));
    t.ck("without promising a review that already happened",
      !/will review your details/i.test(done), done.replace(/\s+/g, " ").slice(0, 160));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- a wrong detail is correctable, not a dead end --");
  {
    const { ctx, page, crashes } = await openLink("tok_bound");
    t.ck("the way out is offered", await page.evaluate(() => !!document.querySelector(".wl-fix")));
    await page.evaluate(() => document.querySelector(".wl-fix")?.click());
    await wait(400);
    const body = await text(page);
    // The same state, rendered the long way -- not a second component with a
    // second copy of the form.
    t.ck("it drops through to the full form", /Work with Cascade Management/i.test(body),
      body.split("\n").slice(0, 5).join(" / "));
    t.ck("with the three steps back", await page.evaluate(() => !!document.querySelector(".wl-steps")));
    t.ck("and what the account typed still in the boxes, to be edited",
      await page.evaluate(() => {
        const v = (l) => [...document.querySelectorAll(".wl-fld")]
          .find((f) => new RegExp("^" + l, "i").test(f.innerText.trim()))?.querySelector("input")?.value;
        return v("Company name") === "San Juan Exteriors" && v("Your name") === "Rob H"
          && v("Email") === "r.hb@outlook.com" && v("Mobile") === "(206)555-0100";
      }));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- the login is made for the address the link went to --");
  {
    // Submitting creates the login for whatever is in that box, and the only
    // mailbox the holder of this link has demonstrably read is the one it was
    // mailed to. A record whose address has since changed would otherwise mint
    // a login at an inbox nobody can confirm -- and confirmation is what makes
    // the password work.
    const { ctx, page, crashes } = await openLink("tok_moved");
    const known = await page.evaluate(() => [...document.querySelectorAll(".wl-known div")]
      .map((d) => d.innerText.replace(/\s+/g, " ").trim()));
    t.ck("the invited address is the one shown",
      known.some((l) => /rob@sanjuanexteriors\.test/.test(l)), known.join(" | "));
    t.ck("not the stale one off the record",
      !known.some((l) => /r\.hb@outlook\.com/.test(l)), known.join(" | "));

    posted.length = 0;
    await page.evaluate(() => {
      const i = document.querySelector(".wl-card input[type=password]");
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(i, "hunter2hunter2");
      i.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await wait(300);
    await page.evaluate(() => [...document.querySelectorAll(".wl-card button")]
      .find((b) => /Set password/i.test(b.innerText))?.click());
    for (let n = 0; n < 20 && !posted.length; n++) await wait(200);
    t.ck("and it is the address that is posted",
      posted[0]?.email === "rob@sanjuanexteriors.test", String(posted[0]?.email));
    // Everything else still comes off the record, which is the point.
    t.ck("with the rest of the record unchanged",
      posted[0]?.company === "San Juan Exteriors" && posted[0]?.license === "SANJUAN123AB",
      JSON.stringify(posted[0]).slice(0, 110));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  console.log("\n-- and a link with no record behind it still asks everything --");
  {
    const { ctx, page, crashes } = await openLink("tok_cold");
    const body = await text(page);
    // Every invite raised before the contractor's card grew a button carries a
    // name, an address and no company at all. Those people really do have to
    // fill the form in.
    t.ck("it is the full application form", /Work with Cascade Management/i.test(body),
      body.split("\n").slice(0, 5).join(" / "));
    t.ck("with the three steps", await page.evaluate(() => !!document.querySelector(".wl-steps")));
    t.ck("and no claim that anything is on file",
      !/already has your details/i.test(body) && await page.evaluate(() => !document.querySelector(".wl-known")));
    t.ck("nothing crashed", crashes.length === 0, crashes.join(" | "));
    await ctx.close();
  }

  // The class of bug, not the instance: a \uXXXX escape in JSX text is six
  // literal characters, and it has shipped twice.
  console.log("\n-- and no escape survived into the page --");
  {
    const { ctx, page } = await openLink("tok_bound");
    const body = await text(page);
    t.ck("no \\uXXXX in front of anybody", !/\\u[0-9a-fA-F]{4}/.test(body),
      (body.match(/\\u[0-9a-fA-F]{4}/g) || []).join(" "));
    await ctx.close();
  }
} finally {
  await browser.close();
  web.close(); api.close();
}

t.done();
