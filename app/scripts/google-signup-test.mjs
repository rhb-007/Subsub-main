// Signing up with Google: the address comes off the token Google's sign-in
// left, never off the form, and nothing needs confirming.
//
//   node --no-warnings scripts/google-signup-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { tally, launch, wait } from "./lib/stub-stack.mjs";
import { pathToFileURL } from "node:url";

const t = tally();
const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

// Three Google logins, as Supabase would describe them.
const TOKENS = {
  g_new: { id: "auth_g_new", email: "New.Person@gmail.test", email_confirmed_at: "2026-10-01",
    user_metadata: { full_name: "Nia Person" } },
  g_old: { id: "auth_g_old", email: "old@gmail.test", email_confirmed_at: "2026-10-01", user_metadata: {} },
  g_unconf: { id: "auth_g_unconf", email: "who@gmail.test", user_metadata: {} },
};
let signups = 0;
const mail = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const ok = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
  if (u.includes("resend.test")) { mail.push(JSON.parse(init.body)); return ok({ id: "em" }); }
  if (u.endsWith("/auth/v1/signup")) { signups += 1; return ok({ id: "auth_pw", email: "x", identities: [{}] }); }
  if (u.endsWith("/auth/v1/user")) {
    const tok = String(init.headers?.Authorization || "").replace("Bearer ", "");
    return TOKENS[tok] ? ok(TOKENS[tok]) : ok({ msg: "bad" }, 401);
  }
  return ok({});
};

const db = freshDb({ base: SCHEMA, migrations: [] });
db.exec(`INSERT INTO users(id,name,email,auth_id) VALUES ('u_old','Old','someone@else.test','auth_g_old');`);
const env = { DB: makeD1(db), SUPABASE_URL: "http://supa.test", SUPABASE_ANON_KEY: "anon",
  RESEND_API_KEY: "re", MAIL_FROM: "hi@subsub.work", RESEND_API_BASE: "https://resend.test" };
let ip = 0;
const call = async (path, { method = "GET", body } = {}) => {
  ip += 1;
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, headers: { "Content-Type": "application/json", "CF-Connecting-IP": `10.3.0.${ip}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const base = (extra) => ({ name: "Nia Person", company: "Nia Roofing", subdomain: `nia${ip + 1}`,
  email: "typed@somewhere.test", kind: "subcontractor", plan: "basic", trades: [], ...extra });

console.log("\n-- starting the trip --");
{
  const s = await call(`/api/signup/google?return=${encodeURIComponent("https://subsub.work/get-started.html?plan=scale")}`);
  t.ck("it hands back Supabase's Google address", s.status === 200 && /\/auth\/v1\/authorize\?provider=google/.test(s.body.url), JSON.stringify(s.body));
  t.ck("and returns to the page it came from", s.body.url?.includes(encodeURIComponent("https://subsub.work/get-started.html?plan=scale")));
  const bad = await call(`/api/signup/google?return=${encodeURIComponent("https://evil.test/x")}`);
  t.ck("a return address off subsub.work is refused", bad.status === 400 && bad.body.error === "bad_return", JSON.stringify(bad.body));
  const look = await call(`/api/signup/google?return=${encodeURIComponent("https://subsub.work.evil.test/")}`);
  t.ck("and so is one that only starts like it", look.status === 400);
  const plain = await call(`/api/signup/google?return=${encodeURIComponent("http://subsub.work/")}`);
  t.ck("and plain http", plain.status === 400);
}

console.log("\n-- who came back --");
{
  const w = await call("/api/signup/google-identity", { method: "POST", body: { token: "g_new" } });
  t.ck("the address and the name come back", w.status === 200 && w.body.email === "new.person@gmail.test"
    && w.body.name === "Nia Person" && w.body.hasAccount === false, JSON.stringify(w.body));
  const o = await call("/api/signup/google-identity", { method: "POST", body: { token: "g_old" } });
  t.ck("a Google login already tied to SubSub says so", o.body.hasAccount === true, JSON.stringify(o.body));
  const bad = await call("/api/signup/google-identity", { method: "POST", body: { token: "nope" } });
  t.ck("a token Supabase does not know is refused", bad.status === 401 && bad.body.error === "google_expired");
  const un = await call("/api/signup/google-identity", { method: "POST", body: { token: "g_unconf" } });
  t.ck("an address nobody confirmed is refused", un.body.error === "google_unverified", JSON.stringify(un.body));
}

console.log("\n-- making the account --");
{
  const r = await call("/api/signup", { method: "POST", body: base({ googleToken: "g_new" }) });
  t.ck("the account is made", r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  t.ck("nothing needs confirming", r.body.needsConfirmation === false && r.body.viaGoogle === true, JSON.stringify(r.body));
  const u = db.prepare(`SELECT email, auth_id FROM users WHERE id = ?`).get(r.body.userId);
  t.ck("the address is Google's, not the one typed", u?.email === "new.person@gmail.test", JSON.stringify(u));
  t.ck("and the login is the Google one", u?.auth_id === "auth_g_new", JSON.stringify(u));
  t.ck("no password login was made beside it", signups === 0, String(signups));
  const welcome = mail.find((m) => /Welcome/.test(m.subject));
  t.ck("the welcome email says to use Google", /Continue with Google/.test(welcome?.text || ""), welcome?.text);

  const again = await call("/api/signup", { method: "POST", body: base({ googleToken: "g_new", subdomain: "niatwo" }) });
  t.ck("the same Google login cannot make a second account", again.status === 409 && again.body.error === "email_in_use", JSON.stringify(again.body));
  const tied = await call("/api/signup", { method: "POST", body: base({ googleToken: "g_old", subdomain: "oldone" }) });
  t.ck("nor can one already tied to a SubSub user", tied.status === 409 && tied.body.error === "email_in_use", JSON.stringify(tied.body));
  const dead = await call("/api/signup", { method: "POST", body: base({ googleToken: "nope", subdomain: "deadone" }) });
  t.ck("an expired token makes nothing", dead.status === 401 && dead.body.error === "google_expired"
    && !db.prepare(`SELECT 1 FROM accounts WHERE subdomain = 'deadone'`).get(), JSON.stringify(dead.body));
}

console.log("\n-- the form --");
{
  const html = readFileSync(new URL("../../get-started.html", import.meta.url), "utf8");
  t.ck("the form offers Continue with Google", /id="gBtn"[\s\S]{0,1200}Continue with Google/.test(html));
  t.ck("it sends the token with the signup", /googleToken:\s*googleToken/.test(html));
  t.ck("and takes the token off the address bar", /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/.test(html));
}

console.log("\n-- the form, in a browser --");
{
  const PAGE = pathToFileURL(new URL("../../get-started.html", import.meta.url).pathname).href;
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 1200 });
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    const asked = [];
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const u = req.url();
      const json = (b) => req.respond({ status: 200, contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" }, body: JSON.stringify(b) });
      if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: { "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST" } });
      if (u.includes("/api/signup/google?")) { asked.push(u); return json({ url: `${PAGE}?back=1#access_token=g_new&token_type=bearer` }); }
      if (u.includes("/api/signup/google-identity")) {
        asked.push(u + " " + req.postData());
        return json({ email: "new.person@gmail.test", name: "Nia Person", hasAccount: false });
      }
      return req.continue();
    });
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    await wait(200);
    await page.evaluate(() => {
      const r = [...document.querySelectorAll('input[name="role"]')].find((x) => x.value === "Subcontractor");
      r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("phone").value = "(206)555-0100";
    });
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}), page.click("#gBtn")]);
    await page.waitForFunction(() => !document.getElementById("gDone").classList.contains("hide"), { timeout: 5000 }).catch(() => {});
    const r = await page.evaluate(() => ({
      email: document.getElementById("email").value, ro: document.getElementById("email").readOnly,
      name: document.getElementById("name").value, hash: location.hash,
      role: document.querySelector('input[name="role"]:checked')?.value, phone: document.getElementById("phone").value,
      btnHidden: document.getElementById("gBtn").classList.contains("hide"),
      done: document.getElementById("gDone").innerText,
    }));
    t.ck("the button asks the server where to send them, returning here", /return=file/.test(asked[0] || ""), asked[0]);
    t.ck("back from Google, the token is handed over", /google-identity .*g_new/.test(asked[1] || ""), asked[1]);
    t.ck("and taken off the address bar", r.hash === "", r.hash);
    t.ck("the email is Google's and locked", r.email === "new.person@gmail.test" && r.ro === true, JSON.stringify(r));
    t.ck("the name is filled in from Google", r.name === "Nia Person", r.name);
    t.ck("what they chose before leaving is kept", r.role === "Subcontractor" && r.phone === "(206)555-0100", JSON.stringify(r));
    t.ck("the page says it is Google, with a way out", r.btnHidden && /Signed up with Google as new.person@gmail.test/.test(r.done)
      && /Use a different email/.test(r.done), r.done);
    await page.click("#gUndo");
    const u = await page.evaluate(() => ({ ro: document.getElementById("email").readOnly, v: document.getElementById("email").value,
      btn: !document.getElementById("gBtn").classList.contains("hide") }));
    t.ck("using a different email unlocks the box", !u.ro && u.v === "" && u.btn, JSON.stringify(u));
    t.ck("nothing crashed", errs.length === 0, errs.join(" | "));
  } finally { await browser.close(); }
}
t.done();
