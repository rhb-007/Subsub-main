// 077. THE SUB PASSPORT, through the real Worker.
//
// What is pinned is what a later pass would undo, or get wrong quietly:
//
//   THE BADGE CLAIMS ONLY WHAT WAS CHECKED. A licence counts when the register
//   SubSub reads said ACTIVE, or when the state licenses nobody for that work
//   (Texas roofing yes, Texas plumbing no). A typed number nobody checked, a
//   failed check, and a certificate with no date or a past one never earn it.
//
//   THE PUBLIC PAGE CARRIES WHAT THE SUB CHOSE TO PUBLISH, the business
//   contact included (it is their QR code now, read like a business card). Unpublished, unknown and malformed slugs
//   are one 404, and every reply says noindex.
//
//   CONNECTING IS THE APPROVAL. A connected account opens all four documents
//   and the agreement; ending the engagement ends it. An account that is not
//   connected opens only what a request covers, and only once approved.
//
//   A LICENCE REMINDER GOES AT 30, 7 AND 0 DAYS, once each, off the register's
//   own date.
//
//   node --no-warnings scripts/passport-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { mintSlug, isSlug, slugBase, passportPathSlug, passportBadge, validPassportEdit, accessMove,
  publicPassport, yearsText, noStateLicenseFor, PASSPORT_CTA, openableKinds, passportGaps } from "../shared/passport.js";
import { addDaysIso } from "../shared/docs.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const TODAY = new Date().toISOString().slice(0, 10);
const day = (n) => addDaysIso(TODAY, n);

const sent = { mail: [] };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("resend")) { sent.mail.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ id: "em_1" })); }
  return new Response("{}");
};

// ---- the rules, on their own -----------------------------------------------------
console.log("\nthe rules");
const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const slug = mintSlug("Bay Roofing & Gutters, LLC", bytes);
ck("a slug is the name plus a random suffix", /^bay-roofing-and-gutters-llc-[2-9a-z]{5}$/.test(slug), slug);
ck("a slug is recognised", isSlug(slug));
ck("a bare name is never a slug", !isSlug("bay-roofing"));
ck("an empty name still makes an address", slugBase("") === "sub");
ck("/p/<slug> is read off the path", passportPathSlug(`/p/${slug}`) === slug);
ck("/p/<name> without a suffix is not", passportPathSlug("/p/bay-roofing") === null);

const curIns = { onFile: true, expiresOn: day(200) };
const waActive = { found: true, status: "ACTIVE", expirationDate: day(300) };
let b = passportBadge({ state: "WA", licenseNumber: "BAYROR*123", check: waActive, trades: ["roofing"], insurance: curIns });
ck("WA, register ACTIVE, certificate current: verified", b.verified && b.name === "SubSub Verified", b.line);
ck("and the line says which register and the date", /Washington L&I registration active/.test(b.line) && /Insurance on file through/.test(b.line), b.line);
b = passportBadge({ state: "TX", licenseNumber: "", check: null, trades: ["roofing"], insurance: curIns });
ck("Texas roofing with current cover: verified, because Texas licenses no general contractor", b.verified, b.line);
ck("and the line says so in words", /Texas issues no state contractor license/.test(b.line), b.line);
b = passportBadge({ state: "TX", licenseNumber: "", check: null, trades: ["roofing", "plumbing"], insurance: curIns });
ck("Texas plumbing is licensed by the state, so no badge", !b.verified && /Plumbing license not verified/.test(b.line), b.line);
ck("noStateLicenseFor refuses a never-exempt trade", !noStateLicenseFor("TX", ["electrical"]) && noStateLicenseFor("TX", ["painting"]));
b = passportBadge({ state: "OR", licenseNumber: "12345", check: null, trades: ["roofing"], insurance: curIns });
ck("a typed number SubSub cannot check never earns it", !b.verified && /not verified by SubSub/.test(b.line), b.line);
b = passportBadge({ state: "WA", licenseNumber: "X", check: { status: "CHECK_FAILED" }, trades: ["roofing"], insurance: curIns });
ck("a failed check never earns it", !b.verified);
b = passportBadge({ state: "WA", licenseNumber: "X", check: { found: true, status: "SUSPENDED" }, trades: ["roofing"], insurance: curIns });
ck("a register that answered not-active never earns it, whatever the state", !b.verified && /not active/.test(b.line));
b = passportBadge({ state: "WA", licenseNumber: "X", check: waActive, trades: ["roofing"], insurance: { onFile: true, expiresOn: day(-1) } });
ck("an expired certificate never earns it", !b.verified && /expired/.test(b.line));
b = passportBadge({ state: "WA", licenseNumber: "X", check: waActive, trades: ["roofing"], insurance: { onFile: true, expiresOn: null } });
ck("a certificate with no date never earns it", !b.verified && /no expiry date/.test(b.line));
b = passportBadge({ state: "WA", licenseNumber: "X", check: waActive, trades: ["roofing"], insurance: { onFile: false } });
ck("no certificate never earns it", !b.verified);

let v = validPassportEdit({ about: "  Roofs since 2010  " }, 2026);
ck("an edit returns only the keys sent", v.ok && Object.keys(v.value).join() === "about" && v.value.about === "Roofs since 2010");
ck("a trade that is not one is refused", validPassportEdit({ trades: ["roofing", "lasers"] }).error === "invalid_trades");
ck("a year in the future is refused", validPassportEdit({ foundedYear: 2099 }, 2026).error === "invalid_year");
ck("the years are worked out on read", yearsText(2014, "2026-10-10") === "In business since 2014 · 12 years");
ck("no founding year says nothing, never \"since null · 2026 years\"", yearsText(null, "2026-10-10") === null && yearsText("", "2026-10-10") === null && yearsText(undefined, "2026-10-10") === null);
ck("approve and decline from pending; revoke from approved only",
  accessMove("pending", "approve").to === "approved" && accessMove("pending", "decline").to === "declined"
  && accessMove("approved", "revoke").to === "revoked" && !accessMove("declined", "approve").ok
  && !accessMove("pending", "revoke").ok && !accessMove("approved", "approve").ok);
const pub = publicPassport({ passport: { slug, trades: ["roofing", "nope"] },
  company: { company: "Bay", contact: "Rae Bay", email: "rae@bay.test", phone: "2065550100", state: "WA", license: "X",
    licenseCheck: waActive, coverage: { mode: "cities", cities: ["Tacoma"] } },
  docs: { insurance: { fileName: "coi.pdf", expiresOn: day(200), issuer: "Acme Mutual" }, w9: { fileName: "w9.pdf" } } });
const pubText = JSON.stringify(pub);
ck("the public shape carries the business contact", pub.contact === "Rae Bay" && pub.email === "rae@bay.test" && pub.phone === "2065550100", pubText);
ck("a UBI only for a Washington company", publicPassport({ passport: { slug }, company: { company: "T", state: "TX", ubi: "123" } }).ubi === null
  && publicPassport({ passport: { slug }, company: { company: "W", state: "WA", ubi: "604" } }).ubi === "604");
ck("connecting opens all four; an approved request two; nothing otherwise",
  openableKinds({ connected: true }).join() === "insurance,bond,w9,contract"
  && openableKinds({ approved: true }).join() === "insurance,w9" && openableKinds({}).length === 0);
const gapKeys = passportGaps({ name: "X" }).map((g) => g.key);
ck("an empty Passport names every gap", ["contact", "phone", "email", "trades", "license", "insurance", "w9", "photos"].every((k) => gapKeys.includes(k)), gapKeys.join());
ck("and a full one names none", passportGaps({ ...pub, city: "Tacoma", foundedYear: 2012, about: "x", photos: [{ id: 1 }] }).length === 0,
  passportGaps({ ...pub, city: "Tacoma", foundedYear: 2012, about: "x", photos: [{ id: 1 }] }).map((g) => g.key).join());
ck("and says a W-9 is on file without carrying it", pub.w9 === true && !/w9\.pdf/.test(pubText));
ck("and names the insurer and the date", pub.insurance.carrier === "Acme Mutual" && pub.insurance.expiresOn === day(200));
ck("and drops a trade that is not one", pub.trades.length === 1);
ck("the CTA is the words asked for", PASSPORT_CTA === "Manage your whole sub network like this");

// ---- through the Worker ----------------------------------------------------------
const files = new Map();
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_gc','Outerhome','outerhome','general_contractor','scale'),
      ('acc_sub','Bay Roofing','bayroof','subcontractor','basic'),
      ('acc_sub2','Cedar Paint','cedarpaint','subcontractor','basic'),
      ('acc_pm','Sound PM','soundpm','property_manager','scale'),
      ('acc_other','Cascade','cascade','general_contractor','basic');
    INSERT INTO companies(id,company,contact,email,phone,city,state,license,license_check) VALUES
      ('cmp_bay','Bay Roofing','Rae Bay','rae@bay.test','2065550100','Tacoma','WA','BAYROR*123',
        '{"found":true,"status":"ACTIVE","expirationDate":"${day(7)}"}'),
      ('cmp_cedar','Cedar Paint','Cy','cy@cedar.test',NULL,'Austin','TX',NULL,NULL),
      ('cmp_gc','Outerhome','Dana','dana@outerhome.test',NULL,'Seattle','WA',NULL,NULL),
      ('cmp_pac','Pacific Maintenance','Juan','juan@pac.test',NULL,'Tacoma','WA','PACMA*1',
        '{"found":true,"status":"ACTIVE","expirationDate":"${day(25)}"}'),
      ('cmp_far','Far Out','F','f@far.test',NULL,'Spokane','WA','FAR*1',
        '{"found":true,"status":"ACTIVE","expirationDate":"${day(90)}"}'),
      ('cmp_gone','Long Gone','G','g@gone.test',NULL,'Yakima','WA','GONE*1',
        '{"found":true,"status":"ACTIVE","expirationDate":"${day(-40)}"}'),
      ('cmp_nf','Not Found','N','n@nf.test',NULL,'Yakima','WA','NF*1',
        '{"found":false,"status":"NOT_FOUND","expirationDate":"${day(3)}"}');
    UPDATE accounts SET company_id = 'cmp_bay' WHERE id = 'acc_sub';
    UPDATE accounts SET company_id = 'cmp_cedar' WHERE id = 'acc_sub2';
    UPDATE accounts SET company_id = 'cmp_gc' WHERE id = 'acc_gc';
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_bay','acc_gc','cmp_bay','active','["roofing","gutters"]'),
      ('en_pac','acc_gc','cmp_pac','active','["painting"]');
    INSERT INTO users(id,name,email) VALUES
      ('u_gc','Dana Ruiz','dana@outerhome.test'), ('u_sub','Rae Bay','rae@bay.test'),
      ('u_sub2','Cy Cedar','cy@cedar.test'), ('u_pm','Pat Pm','pat@soundpm.test'),
      ('u_juan','Juan Soto','juan@pac.test'), ('u_ten','Tia Tenant','tia@flat.test'),
      ('u_other','Otto Other','otto@cascade.test');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_gc','u_gc','acc_gc','admin',NULL), ('m_sub','u_sub','acc_sub','admin',NULL),
      ('m_sub2','u_sub2','acc_sub2','admin',NULL), ('m_pm','u_pm','acc_pm','admin',NULL),
      ('m_juan','u_juan','acc_gc','contractor','cmp_pac'), ('m_ten','u_ten','acc_gc','tenant',NULL),
      ('m_other','u_other','acc_other','admin',NULL);
    INSERT INTO company_docs(id,company_id,kind,file_key,file_name,issuer,expires_on) VALUES
      ('d_old','cmp_bay','insurance','acc_sub/insurance/old-coi.pdf','old-coi.pdf','Old Mutual','${day(-30)}'),
      ('d_ins','cmp_bay','insurance','acc_sub/insurance/coi.pdf','coi.pdf','Acme Mutual','${day(200)}'),
      ('d_w9','cmp_bay','w9','acc_sub/w9/w9.pdf','w9.pdf',NULL,NULL),
      ('d_bond','cmp_bay','bond','acc_sub/bond/bond.pdf','bond.pdf','Surety Co','${day(200)}');
    -- The superseded row is the NEWER upload here, which is the only order in
    -- which reading it by date instead of by superseded_at could be told apart.
    UPDATE company_docs SET superseded_at = CURRENT_TIMESTAMP, uploaded_at = '2099-01-01' WHERE id = 'd_old';
    UPDATE companies SET insurance = 1, w9 = 1, bond = 1 WHERE id = 'cmp_bay';
  `);
  files.clear();
  for (const k of ["acc_sub/insurance/coi.pdf", "acc_sub/insurance/old-coi.pdf", "acc_sub/w9/w9.pdf", "acc_sub/bond/bond.pdf"]) {
    files.set(k, { bytes: `BYTES:${k}`, type: "application/pdf" });
  }
  const obj = (k) => {
    const f = files.get(k);
    return f ? { body: f.bytes, httpMetadata: { contentType: f.type } } : null;
  };
  const env = { DB: makeD1(db),
    FILES: { put: async (k, body, o) => { files.set(k, { bytes: "uploaded", type: o?.httpMetadata?.contentType }); },
      get: async (k) => obj(k), head: async (k) => obj(k) },
    RESEND_API_KEY: "re_x", MAIL_FROM: "SubSub <hi@subsub.work>", RESEND_API_BASE: "https://resend.test",
    CRON_SECRET: "cron" };
  return { db, env };
};
const call = (env, path, { method = "GET", body, who = "u_sub", acct = "acc_sub", ip = "1.1.1.1", headers = {} } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers,
      ...(who ? { "X-User-Id": who, "X-Account-Id": acct } : {}) },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

const { db, env } = seed();

console.log("\nthe sub's own page");
let [s, mine] = await json(await call(env, "/api/my-passport"));
ck("the sub's admin opens their Passport", s === 200 && isSlug(mine.passport?.slug), JSON.stringify(mine).slice(0, 200));
const SLUG = mine.passport.slug;
// Published from the moment it is made: waiting on a Publish press was the
// bottleneck. Taking it down is still the sub's word, tested below.
ck("it is made published", mine.passport.published === true);
ck("its trades start from what clients engage them for", JSON.stringify(mine.passport.trades) === '["roofing","gutters"]', JSON.stringify(mine.passport.trades));
ck("the preview carries the badge", mine.preview?.badge?.verified === true, mine.preview?.badge?.line);
let [s2, again] = await json(await call(env, "/api/my-passport"));
ck("the slug is stamped once", s2 === 200 && again.passport.slug === SLUG);
[s, mine] = await json(await call(env, "/api/my-passport", { who: "u_juan", acct: "acc_gc" }));
ck("a contractor seat opens its own company's Passport", s === 200 && /^pacific-maintenance-/.test(mine.passport?.slug), mine.passport?.slug);
[s] = await json(await call(env, "/api/my-passport", { who: "u_pm", acct: "acc_pm" }));
ck("a property manager has no Passport to open", s === 409);
[s] = await json(await call(env, "/api/my-passport", { who: "u_ten", acct: "acc_gc" }));
ck("a tenant is refused", s === 403);

console.log("\nthe public page");
[s, mine] = await json(await call(env, "/api/my-passport", { method: "PUT", body: { published: false } }));
ck("taking it down is one word", s === 200 && mine.passport.published === false);
let r = await call(env, `/api/public/passport/${SLUG}`, { who: null });
ck("unpublished, it is a 404", r.status === 404);
[s2, again] = await json(await call(env, "/api/my-passport"));
ck("and a Passport somebody took down stays down when opened again", s2 === 200 && again.passport.published === false);
[s, mine] = await json(await call(env, "/api/my-passport", { method: "PUT", body: { about: "Roofs and gutters." } }));
ck("saving the note does not publish", s === 200 && mine.passport.published === false);
ck("and does not wipe the trades", JSON.stringify(mine.passport.trades) === '["roofing","gutters"]');
[s] = await json(await call(env, "/api/my-passport", { method: "PUT", body: { trades: ["roofing", "lasers"] } }));
ck("a trade that is not one is refused", s === 400);
[s, mine] = await json(await call(env, "/api/my-passport", { method: "PUT", body: { published: true, foundedYear: 2012 } }));
ck("publishing is a word the sub says", s === 200 && mine.passport.published === true);
r = await call(env, `/api/public/passport/${SLUG}`, { who: null });
const page = await r.json();
ck("published, anybody holding the link reads it", r.status === 200 && page.name === "Bay Roofing");
ck("and the reply says noindex", r.headers.get("X-Robots-Tag") === "noindex");
ck("it carries the business contact", page.contact === "Rae Bay" && page.email === "rae@bay.test" && page.phone === "2065550100");
ck("and says whether a bond is on file", page.bond === true);
ck("it carries the current certificate's insurer, not the superseded one", page.insurance?.carrier === "Acme Mutual");
ck("it says a W-9 is on file and nothing more", page.w9 === true && !/w9\.pdf/.test(JSON.stringify(page)));
ck("the badge is earned and its line rides with it", page.badge?.verified && /Washington L&I/.test(page.badge.line));
ck("it carries the sub's referral code for the CTA", /^[2-9A-Z]{8}$/.test(page.refCode || ""), page.refCode);
ck("the years are worked out", /since 2012/.test(page.years || ""));
const views = db.prepare(`SELECT view_count FROM passports WHERE slug = ?`).get(SLUG).view_count;
ck("a view is counted", views === 1, String(views));
r = await call(env, `/api/public/passport/bay-roofing-zzzzz`, { who: null });
ck("an unknown slug is the same 404", r.status === 404);
r = await call(env, `/api/public/passport/Bay%20Roofing`, { who: null });
ck("a malformed slug is the same 404", r.status === 404);

console.log("\nphotos");
// A real object under ANOTHER account's prefix -- the only key the prefix check
// alone can refuse, because one that was never uploaded fails the head too.
const theirs = await (await call(env, "/api/uploads/passport-photo/x.jpg", { ...{ who: "u_gc", acct: "acc_gc" },
  method: "PUT", body: "jpeg", headers: { "Content-Type": "image/jpeg" } })).json();
[s] = await json(await call(env, "/api/my-passport/photos", { method: "POST", body: { key: theirs.key } }));
ck("a key under somebody else's prefix is refused", s === 400 && theirs.key?.startsWith("acc_gc/"), theirs.key);
[s] = await json(await call(env, "/api/my-passport/photos", { method: "POST", body: { key: "acc_sub/passport-photo/missing.jpg" } }));
ck("a key that was never uploaded is refused", s === 400);
r = await call(env, "/api/uploads/passport-photo/roof.jpg", { method: "PUT", body: "jpegbytes", headers: { "Content-Type": "image/jpeg" } });
const up = await r.json();
ck("the upload kind is checked like a report photo", r.status === 200 && up.key.startsWith("acc_sub/passport-photo/"), JSON.stringify(up));
r = await call(env, "/api/uploads/passport-photo/x.exe", { method: "PUT", body: "MZ", headers: { "Content-Type": "application/x-msdownload" } });
ck("a file that is not an image is refused", r.status === 415);
let photo;
[s, photo] = await json(await call(env, "/api/my-passport/photos", { method: "POST", body: { key: up.key, caption: "New roof, Tacoma" } }));
ck("a photo is attached", s === 201 && photo.id);
r = await call(env, `/api/public/passport/${SLUG}/photo/${photo.id}`, { who: null });
ck("and served on the public page", r.status === 200);
r = await call(env, `/api/public/passport/${SLUG}`, { who: null });
ck("the public page lists it with its caption", (await r.json()).photos?.[0]?.caption === "New roof, Tacoma");
[s] = await json(await call(env, `/api/my-passport/photos/${photo.id}`, { method: "DELETE" }));
r = await call(env, `/api/public/passport/${SLUG}/photo/${photo.id}`, { who: null });
ck("a photo taken off stops being served", s === 200 && r.status === 404);
ck("and is kept, not deleted", !!db.prepare(`SELECT removed_at FROM passport_photos WHERE id = ?`).get(photo.id).removed_at);
for (let i = 0; i < 12; i++) {
  db.prepare(`INSERT INTO passport_photos (id, company_id, file_key, position) VALUES (?, 'cmp_bay', ?, ?)`).run(`ph${i}`, `k${i}`, i);
}
[s] = await json(await call(env, "/api/my-passport/photos", { method: "POST", body: { key: up.key } }));
ck("a thirteenth photo is refused", s === 409);

console.log("\nasking for the files");
const GC = { who: "u_gc", acct: "acc_gc" };
// The asker is NOT connected: a connected account needs no request at all.
const ASKER = { who: "u_pm", acct: "acc_pm" };
let acc;
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/access`, ASKER));
ck("a hiring account sees it has not asked", s === 200 && acc.status === "none" && acc.mayRequest, JSON.stringify(acc));
r = await call(env, `/api/passport/${SLUG}/documents/insurance/file`, ASKER);
ck("before asking, the certificate does not open", r.status === 403);
sent.mail.length = 0;
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/access`, { ...ASKER, method: "POST", body: { message: "For the Pine St job" } }));
ck("asking is a request", s === 201 && acc.status === "pending");
ck("the sub is emailed, with no file attached", sent.mail.length === 1 && sent.mail[0].to?.includes?.("rae@bay.test") !== false
  && /asked to see your insurance and W-9/.test(sent.mail[0].subject) && !sent.mail[0].attachments, JSON.stringify(sent.mail[0] || {}).slice(0, 200));
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/access`, { ...ASKER, method: "POST", body: {} }));
ck("asking twice is one request", s === 409 && acc.error === "already_asked");
r = await call(env, `/api/passport/${SLUG}/documents/insurance/file`, ASKER);
ck("pending, the certificate still does not open", r.status === 403);
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/access`, { who: "u_sub", acct: "acc_sub" }));
ck("the sub's own account is told it is their own", acc.status === "own" && !acc.mayRequest);
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/access`, { who: "u_sub2", acct: "acc_sub2", method: "POST", body: {} }));
ck("an account that does not hire cannot ask", s === 409 && acc.error === "not_a_hiring_account");
r = await call(env, `/api/passport/${SLUG}/access`, { who: "u_ten", acct: "acc_gc", method: "POST", body: {} });
ck("a tenant on a hiring account cannot ask", r.status === 403);
r = await call(env, `/api/passport/${SLUG}/access`, { who: "u_juan", acct: "acc_gc", method: "POST", body: {} });
ck("a contractor seat cannot ask", r.status === 403);

[s, mine] = await json(await call(env, "/api/my-passport"));
const req = mine.access?.find((a) => a.accountId === "acc_pm");
ck("the sub sees who asked, by company and person", req?.status === "pending" && req.accountName === "Sound PM" && req.requesterName === "Pat Pm");
[s] = await json(await call(env, `/api/my-passport/access/${req.id}`, { method: "POST", body: { action: "revoke" } }));
ck("a pending request cannot be revoked", s === 409);
[s] = await json(await call(env, `/api/my-passport/access/${req.id}`, { who: "u_sub2", acct: "acc_sub2", method: "POST", body: { action: "approve" } }));
ck("another sub cannot answer it", s === 404);
sent.mail.length = 0;
[s, acc] = await json(await call(env, `/api/my-passport/access/${req.id}`, { method: "POST", body: { action: "approve" } }));
ck("the sub approves", s === 200 && acc.status === "approved");
ck("the person who asked is told", sent.mail.some((m) => /shared their insurance and W-9/.test(m.subject)));
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/access`, ASKER));
ck("the hiring account now lists the two files", acc.status === "approved" && acc.files.map((f) => f.kind).join() === "insurance,w9", JSON.stringify(acc.files));
r = await call(env, `/api/passport/${SLUG}/documents/insurance/file`, ASKER);
ck("the CURRENT certificate opens", r.status === 200 && (await r.text()) === "BYTES:acc_sub/insurance/coi.pdf");
ck("and never into a shared cache", r.headers.get("Cache-Control") === "private, no-store");
r = await call(env, `/api/passport/${SLUG}/documents/w9/file`, ASKER);
ck("the W-9 opens", r.status === 200);
r = await call(env, `/api/passport/${SLUG}/documents/bond/file`, ASKER);
ck("the bond is not covered by the request", r.status === 403);
r = await call(env, `/api/passport/${SLUG}/documents/insurance/file`, { who: "u_other", acct: "acc_other" });
ck("another hiring account cannot open it on the first one's yes", r.status === 403);
[s] = await json(await call(env, `/api/my-passport/access/${req.id}`, { method: "POST", body: { action: "decline" } }));
ck("an approved request cannot be declined, only revoked", s === 409);
[s] = await json(await call(env, `/api/my-passport/access/${req.id}`, { method: "POST", body: { action: "revoke" } }));
r = await call(env, `/api/passport/${SLUG}/documents/insurance/file`, ASKER);
ck("revoked, it stops opening", s === 200 && r.status === 403);
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/access`, { ...ASKER, method: "POST", body: {} }));
ck("after a revoke a fresh request can be sent", s === 201);
let list;
[s, list] = await json(await call(env, "/api/passport-access", ASKER));
ck("the hiring account lists what it asked for", s === 200 && list.length === 2 && list[0].company === "Bay Roofing");

// Said rather than asserted: the answer route also guards its UPDATE on the
// status it is moving FROM, so two presses at once move a request once. A
// sequential test cannot reach that -- accessMove refuses the second press
// before the UPDATE runs -- so deleting that half changes no outcome here.

console.log("\nconnected is the approval");
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/access`, GC));
ck("a connected account is told it is connected", s === 200 && acc.status === "connected" && !acc.mayRequest, JSON.stringify(acc).slice(0, 200));
ck("and lists every document on file, the bond included", acc.files.map((f) => f.kind).join() === "insurance,bond,w9", JSON.stringify(acc.files));
r = await call(env, `/api/passport/${SLUG}/documents/bond/file`, GC);
ck("the bond opens with no request ever made", r.status === 200 && (await r.text()) === "BYTES:acc_sub/bond/bond.pdf");
r = await call(env, `/api/passport/${SLUG}/documents/insurance/file`, GC);
ck("the CURRENT certificate, not the superseded one", r.status === 200 && (await r.text()) === "BYTES:acc_sub/insurance/coi.pdf");
r = await call(env, `/api/passport/${SLUG}/agreement.txt`, GC);
ck("with no agreement issued there is none to download", r.status === 404);
[s] = await json(await call(env, "/api/subs/cmp_bay/agreement", { ...GC, method: "POST", body: { source: "subsub_standard" } }));
[s2, acc] = await json(await call(env, `/api/passport/${SLUG}/access`, GC));
ck("an issued SubSub agreement rides with the documents", s === 200 && /SubSub Standard Subcontractor Agreement/.test(acc.agreement?.document?.title || ""),
  `${s} ${acc.agreement?.document?.title}`);
r = await call(env, `/api/passport/${SLUG}/agreement.txt`, GC);
const agrText = await r.text();
ck("and downloads as text", r.status === 200 && /SubSub Standard Subcontractor Agreement/.test(agrText)
  && /attachment/.test(r.headers.get("Content-Disposition") || ""), agrText.slice(0, 80));
r = await call(env, `/api/passport/${SLUG}/agreement.txt`, ASKER);
ck("an account that is not connected cannot download it", r.status === 404);
db.prepare(`UPDATE engagements SET status = 'ended' WHERE id = 'en_bay'`).run();
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/access`, GC));
ck("ending the engagement ends the access", acc.status !== "connected", acc.status);
r = await call(env, `/api/passport/${SLUG}/documents/bond/file`, GC);
ck("and the bond stops opening", r.status === 403);
db.prepare(`UPDATE engagements SET status = 'active' WHERE id = 'en_bay'`).run();

console.log("\nconnecting from the Passport");
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/access`, ASKER));
ck("an account not connected is offered Connect", acc.mayConnect === true && acc.connectPending === false, JSON.stringify(acc).slice(0, 200));
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/connect`, { ...ASKER, method: "POST", body: { message: "Pine St" } }));
ck("Connect sends a request to connect", s === 201 && acc.status === "pending", `${s} ${JSON.stringify(acc).slice(0, 120)}`);
const cr = db.prepare(`SELECT via, message FROM connect_requests WHERE account_id = 'acc_pm' AND company_id = 'cmp_bay'`).get();
ck("recorded as the scanned-code door, with the note", cr?.via === "code" && cr?.message === "Pine St", JSON.stringify(cr));
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/connect`, { ...ASKER, method: "POST", body: {} }));
ck("pressing it twice is one request", s === 409 && acc.error === "already_requested");
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/access`, ASKER));
ck("and the page then says it is waiting", acc.connectPending === true && acc.mayConnect === false);
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/connect`, { ...GC, method: "POST", body: {} }));
ck("an account already connected is told so", s === 409 && acc.error === "already_engaged");
[s, acc] = await json(await call(env, `/api/passport/${SLUG}/connect`, { who: "u_sub", acct: "acc_sub", method: "POST", body: {} }));
ck("the sub cannot connect with themselves", s === 409 && acc.error === "own_company");
r = await call(env, `/api/passport/${SLUG}/connect`, { who: "u_ten", acct: "acc_gc", method: "POST", body: {} });
ck("a tenant seat cannot connect", r.status === 403);

console.log("\nthe QR code is the Passport");
[s, acc] = await json(await call(env, "/api/connect/code"));
ck("My QR code carries the published Passport", s === 200 && acc.passport?.url === `https://app.subsub.work/p/${SLUG}` && acc.passport.published === true,
  JSON.stringify(acc));
ck("and still has its connect code underneath", /^[0-9A-Z]{10}$/.test(acc.code || ""));
const CODE = acc.code;
[s, acc] = await json(await call(env, `/api/public/connect/${CODE}`, { who: null }));
ck("an old printed code names the Passport to a stranger", s === 200 && acc.slug === SLUG);
[s] = await json(await call(env, "/api/public/connect/ZZZZZZZZZZ", { who: null }));
ck("an unknown code is a 404", s === 404);
[s] = await json(await call(env, "/api/public/connect/bad", { who: null }));
ck("a malformed code is the same 404", s === 404);
// Pacific's own seat opened its Passport above, which now publishes it, so it
// is taken down here: the case under test is a company with none published.
db.prepare(`UPDATE passports SET published_at = NULL WHERE company_id = 'cmp_pac'`).run();
let subsList;
[s, subsList] = await json(await call(env, "/api/subs", GC));
ck("the roster carries the contractor's Passport", subsList.find((x) => x.id === "cmp_bay")?.passportUrl === `https://app.subsub.work/p/${SLUG}`,
  JSON.stringify(subsList.map((x) => [x.id, x.passportUrl])));
ck("and nothing for one with no published Passport", subsList.find((x) => x.id === "cmp_pac")?.passportUrl === null);

console.log("\nunpublishing");
await call(env, "/api/my-passport", { method: "PUT", body: { published: false } });
r = await call(env, `/api/public/passport/${SLUG}`, { who: null });
ck("taken down, the page is a 404 again", r.status === 404);
r = await call(env, `/api/public/connect/${CODE}`, { who: null });
ck("and an old printed code no longer names it", r.status === 404);
r = await call(env, `/api/passport/${SLUG}/documents/insurance/file`, GC);
ck("and nothing opens through it", r.status === 404);
await call(env, "/api/my-passport", { method: "PUT", body: { published: true } });

console.log("\nlicence reminders");
sent.mail.length = 0;
let sweep = await (await call(env, "/api/cron/license-reminders", { who: null, headers: { Authorization: "Bearer cron" } })).json();
const rem = db.prepare(`SELECT company_id, days_out FROM license_reminders ORDER BY company_id`).all();
const by = Object.fromEntries(rem.map((x) => [x.company_id, x.days_out]));
ck("seven days out sends the 7", by.cmp_bay === 7, JSON.stringify(by));
ck("twenty-five days out sends the 30", by.cmp_pac === 30, JSON.stringify(by));
ck("ninety days out sends nothing", !("cmp_far" in by));
ck("a licence that lapsed weeks ago is not chased nightly", !("cmp_gone" in by));
ck("a register that answered not-found is not chased", !("cmp_nf" in by));
ck("the email says which register and the date", sent.mail.some((m) => /Washington L&I/.test(m.text) && m.text.includes(day(7))));
ck("and is marked emailed", db.prepare(`SELECT emailed FROM license_reminders WHERE company_id = 'cmp_bay'`).get().emailed === 1);
sent.mail.length = 0;
sweep = await (await call(env, "/api/cron/license-reminders", { who: null, headers: { Authorization: "Bearer cron" } })).json();
ck("a second night sends nothing", sweep.sent === 0 && sent.mail.length === 0, JSON.stringify(sweep));
db.prepare(`UPDATE companies SET license_check = ? WHERE id = 'cmp_bay'`).run(JSON.stringify({ found: true, status: "ACTIVE", expirationDate: TODAY }));
sweep = await (await call(env, "/api/cron/license-reminders", { who: null, headers: { Authorization: "Bearer cron" } })).json();
ck("the day it runs out sends the 0", db.prepare(`SELECT COUNT(*) AS n FROM license_reminders WHERE company_id='cmp_bay' AND days_out=0`).get().n === 1);
r = await call(env, "/api/cron/license-reminders", { who: null, headers: { Authorization: "Bearer nope" } });
ck("the cron route needs its secret", r.status === 403);

console.log("\nthe invariants");
let chk = runCheck(db);
ck("m077_inv_guessable_slug reads 0", chk.m077_inv_guessable_slug === 0, String(chk.m077_inv_guessable_slug));
ck("m077_inv_decided_undated reads 0", chk.m077_inv_decided_undated === 0, String(chk.m077_inv_decided_undated));
// A column check reads how many of its named columns are there, so each must
// read the whole of its list; a table missing a column reads one short.
ck("the did-I-run-it rows find every column they name", chk.m077_passports === 7 && chk.m077_passport_photos === 6
  && chk.m077_passport_access === 5 && chk.m077_license_reminders === 4 && chk.m077_access_live_unique === 1,
  [chk.m077_passports, chk.m077_passport_photos, chk.m077_passport_access, chk.m077_license_reminders].join());
db.prepare(`INSERT INTO passports (company_id, slug) VALUES ('cmp_far', 'far-out')`).run();
db.prepare(`INSERT INTO passport_access (id, company_id, account_id, status) VALUES ('pa_x','cmp_cedar','acc_gc','approved')`).run();
chk = runCheck(db);
ck("a slug with no random suffix is counted", chk.m077_inv_guessable_slug === 1);
ck("a decision with no date is counted", chk.m077_inv_decided_undated === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
