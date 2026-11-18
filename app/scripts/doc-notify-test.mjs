// THE HIRING SIDE IS EMAILED WHEN A COMPANY ON ITS ROSTER ADDS TO ITS
// COMPLIANCE PACK, AND EACH ITEM HAS ITS OWN SWITCH (ON BY DEFAULT).
//
// Asked for as "email notifications to hiring general contractors for any
// compliance pack item that is uploaded, ie. Insurance, surety, W9, License #,
// agreement returned/signed (and should prompt contractor to countersign) --
// these should all be editable (turn on (default)/off) via the admin under
// notifications".
//
//   node --no-warnings scripts/doc-notify-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { docNotifyOn, cleanDocNotify, docNotifyKind, DOC_NOTIFY_KINDS } from "../shared/docnotify.js";
import { docUploadedEmail } from "../worker/mail.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d && !ok ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M052 = readFileSync(new URL("../worker/migrations/052_agreements.sql", import.meta.url), "utf8");

console.log("\n-- the rule --");
ck("five items", JSON.stringify(DOC_NOTIFY_KINDS.map((k) => k.id)) === '["insurance","bond","w9","license","agreement"]');
ck("a person with no setting is told about everything", DOC_NOTIFY_KINDS.every((k) => docNotifyOn({}, k.id)));
ck("an item turned off is not", !docNotifyOn({ docUploads: { bond: false } }, "bond") && docNotifyOn({ docUploads: { bond: false } }, "w9"));
ck("an unknown item is never on", !docNotifyOn({}, "nonsense"));
ck("the stored shape keeps known keys as booleans only",
  JSON.stringify(cleanDocNotify({ bond: 0, w9: true, junk: false })) === '{"bond":false,"w9":true}');
ck("cleanDocNotify reads false as off", cleanDocNotify({ bond: false }).bond === false);
ck("the agreement is stored as the contract document", docNotifyKind("contract") === "agreement" && docNotifyKind("w9") === "w9");

const db = freshDb({ base: SCHEMA, migrations: [M052] });
db.exec(`
  INSERT INTO companies(id,company,city,state,zip,doc_files) VALUES
    ('cmp_gc','Outerhome LLC','Seattle','WA','98101','{}'),
    ('cmp_bay','Bay Roofing Inc','Tacoma','WA','98402','{}');
  INSERT INTO accounts(id,name,subdomain,kind,plan,company_id) VALUES
    ('acc_gc','Outerhome','outerhome','general_contractor','scale','cmp_gc'),
    ('acc_sub','Bay Roofing','bay','subcontractor','basic','cmp_bay'),
    ('acc_pm','Cascade Management','cascade','property_manager','scale',NULL),
    ('acc_old','Old Client','oldc','general_contractor','scale',NULL);
  INSERT INTO engagements(id,account_id,company_id,status) VALUES
    ('en1','acc_gc','cmp_bay','active'), ('en2','acc_pm','cmp_bay','active'),
    ('en3','acc_old','cmp_bay','ended');
  INSERT INTO users(id,name,email) VALUES
    ('u_gc','Dana Ruiz','dana@outerhome.test'), ('u_gcpm','Pat Lee','pat@outerhome.test'),
    ('u_sub','Rae Okafor','rae@bay.test'), ('u_pm','Jo Kim','jo@cascade.test'),
    ('u_old','Old Admin','old@oldc.test');
  INSERT INTO users(id,name,email,notify) VALUES
    ('u_off','Off Person','off@outerhome.test','{"email":false}'),
    ('u_quiet','Quiet Person','quiet@outerhome.test','{"email":true,"docUploads":{"insurance":false}}');
  INSERT INTO memberships(id,user_id,account_id,role) VALUES
    ('m_gc','u_gc','acc_gc','admin'), ('m_gcpm','u_gcpm','acc_gc','pm'),
    ('m_off','u_off','acc_gc','admin'), ('m_quiet','u_quiet','acc_gc','pm'),
    ('m_sub','u_sub','acc_sub','admin'), ('m_pm','u_pm','acc_pm','admin'),
    ('m_old','u_old','acc_old','admin');
`);
const mails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://mail.test/")) {
    mails.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "m" + mails.length }), { status: 200 });
  }
  return realFetch(url, init);
};
const env = { DB: makeD1(db), RESEND_API_KEY: "k", MAIL_FROM: "hello@subsub.work", RESEND_API_BASE: "https://mail.test" };
const call = async (path, { method = "GET", as = "u_sub", acct = "acc_sub", body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, headers: { "Content-Type": "application/json", "X-User-Id": as, "X-Account-Id": acct },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env, { waitUntil() {} });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const sentFor = (re) => { const out = mails.filter((m) => re.test(m.subject)).map((m) => m.to[0].toLowerCase()).sort(); return out; };
const drain = () => mails.splice(0, mails.length);

console.log("\n-- the subcontractor uploads a certificate of insurance --");
{
  drain();
  const up = await call("/api/subs/cmp_bay/documents/insurance", { method: "POST", body: { fileKey: "acc_sub/insurance/coi.pdf", fileName: "coi.pdf" } });
  ck("the upload is accepted", up.status === 200, JSON.stringify(up));
  const to = sentFor(/uploaded their certificate of insurance/);
  ck("every hiring account's admin and pm is emailed", to.includes("dana@outerhome.test") && to.includes("pat@outerhome.test") && to.includes("jo@cascade.test"), JSON.stringify(to));
  ck("somebody with email off is not", !to.includes("off@outerhome.test"), JSON.stringify(to));
  ck("somebody who switched insurance off is not", !to.includes("quiet@outerhome.test"), JSON.stringify(to));
  ck("an account that no longer engages them is not", !to.includes("old@oldc.test"), JSON.stringify(to));
  ck("the subcontractor is not told about their own upload", !to.includes("rae@bay.test"), JSON.stringify(to));
  const m = mails.find((x) => x.to[0] === "dana@outerhome.test");
  ck("it names the company and greets by first name", /^Bay Roofing Inc uploaded/.test(m?.subject || "") && /^Hi Dana,/.test(m?.text || ""), m?.text);
  ck("it links to their card", /outerhome\.subsub\.work\/\?open=sub&id=cmp_bay|app\.subsub\.work\/\?open=sub&id=cmp_bay/.test(m?.text || ""), m?.text);
  const logged = db.prepare("SELECT COUNT(*) n FROM email_log WHERE kind = 'doc_uploaded_insurance'").get().n;
  ck("each send is logged", logged === 3, String(logged));
}

console.log("\n-- a hiring account uploads on their behalf --");
{
  drain();
  const up = await call("/api/subs/cmp_bay/documents/w9", { method: "POST", as: "u_gc", acct: "acc_gc", body: { fileKey: "acc_gc/w9/w9.pdf", fileName: "w9.pdf" } });
  ck("the upload is accepted", up.status === 200, JSON.stringify(up));
  const to = sentFor(/IRS Form W-9/);
  ck("the other hiring account is told", to.includes("jo@cascade.test"), JSON.stringify(to));
  ck("the account that pressed it is not", !to.includes("dana@outerhome.test") && !to.includes("pat@outerhome.test"), JSON.stringify(to));
}

console.log("\n-- switching one item off --");
{
  const before = await call("/api/me", { method: "PATCH", as: "u_gcpm", acct: "acc_gc", body: { notify: { docUploads: { bond: false } } } });
  ck("the setting saves", before.status === 200 && before.body.notify?.docUploads?.bond === false, JSON.stringify(before));
  ck("and leaves their email setting as it was", before.body.notify?.email === true && before.body.notify?.statusChanges === true, JSON.stringify(before.body));
  const keep = await call("/api/me", { method: "PATCH", as: "u_gcpm", acct: "acc_gc", body: { notify: { email: true, sms: false, statusChanges: true } } });
  ck("a panel that saves only its own keys keeps the switch", keep.body.notify?.docUploads?.bond === false, JSON.stringify(keep.body));
  drain();
  await call("/api/subs/cmp_bay/documents/bond", { method: "POST", body: { fileKey: "acc_sub/bond/b.pdf", fileName: "b.pdf" } });
  const to = sentFor(/surety bond/);
  ck("they are no longer emailed about a bond", !to.includes("pat@outerhome.test"), JSON.stringify(to));
  ck("their colleague still is", to.includes("dana@outerhome.test"), JSON.stringify(to));
  drain();
  await call("/api/subs/cmp_bay/documents/insurance", { method: "POST", body: { fileKey: "acc_sub/insurance/c2.pdf", fileName: "c2.pdf" } });
  ck("and they are still told about insurance", sentFor(/insurance/).includes("pat@outerhome.test"));
}

console.log("\n-- a license number added or changed --");
{
  drain();
  const r = await call("/api/my-company", { method: "PATCH", body: { license: "BAYRR*222" } });
  ck("the company saves its license", r.status === 200, JSON.stringify(r));
  const to = sentFor(/added their license number/);
  ck("the hiring accounts are told", to.includes("dana@outerhome.test") && to.includes("jo@cascade.test"), JSON.stringify(to));
  const m = mails.find((x) => x.to[0] === "jo@cascade.test");
  ck("the number is in the email", /BAYRR\*222/.test(m?.text || ""), m?.text);
  drain();
  await call("/api/my-company", { method: "PATCH", body: { license: "BAYRR*222", city: "Tacoma" } });
  ck("saving the same number again sends nothing", sentFor(/license/).length === 0, JSON.stringify(sentFor(/license/)));
}

console.log("\n-- the agreement signed, asking for a countersignature --");
{
  const made = await call("/api/subs/cmp_bay/agreement", { method: "POST", as: "u_gc", acct: "acc_gc", body: {} });
  ck("an agreement is issued", made.status === 200 || made.status === 201, JSON.stringify(made));
  const id = made.body.agreement?.id || made.body.id;
  drain();
  const signed = await call(`/api/my-agreements/${id}/sign`, { method: "POST", body: { typedName: "Rae Okafor" } });
  ck("the subcontractor signs it", signed.status === 200, JSON.stringify(signed));
  const to = sentFor(/signed your agreement/);
  ck("the account it is with is told", to.includes("dana@outerhome.test") && to.includes("pat@outerhome.test"), JSON.stringify(to));
  ck("nobody else is (the agreement is between two parties)", !to.includes("jo@cascade.test"), JSON.stringify(to));
  const m = mails.find((x) => x.to[0] === "dana@outerhome.test" && /signed your agreement/.test(x.subject));
  ck("it asks them to countersign", /countersign/.test(m?.subject || "") && /not in force until you countersign/.test(m?.text || ""), m?.text);
}

console.log("\n-- their own signed copy uploaded, on their own paper --");
{
  db.exec(`INSERT INTO agreements(id,account_id,company_id,source,status) VALUES ('ag_paper','acc_pm','cmp_bay','uploaded','sent')`);
  drain();
  await call("/api/subs/cmp_bay/documents/contract", { method: "POST", body: { fileKey: "acc_sub/contract/a.pdf", fileName: "a.pdf" } });
  const to = sentFor(/signed your agreement/);
  ck("the account whose agreement it was is told to countersign", to.includes("jo@cascade.test"), JSON.stringify(to));
  ck("an account that sent no paper agreement is not", !to.includes("dana@outerhome.test"), JSON.stringify(to));
  drain();
  await call("/api/subs/cmp_bay/documents/contract", { method: "POST", body: { fileKey: "acc_sub/contract/b.pdf", fileName: "b.pdf" } });
  ck("a second upload with nothing left to sign tells nobody", sentFor(/agreement/).length === 0, JSON.stringify(sentFor(/agreement/)));
}

console.log("\n-- the email --");
{
  const words = (t) => t.split("\n\nThis is an automated")[0].split(/\s+/).filter(Boolean).length;
  for (const kind of ["insurance", "bond", "w9", "license", "agreement"]) {
    const e = docUploadedEmail({ firstName: "Dana", companyName: "Bay Roofing Inc", kind, label: kind, link: "https://x/" });
    ck(`the ${kind} email is short`, words(e.text) <= 100, String(words(e.text)));
  }
}

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
