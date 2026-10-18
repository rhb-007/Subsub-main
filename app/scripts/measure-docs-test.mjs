// A job's measurement documents are FILES, not names. The old form kept the
// filename and uploaded nothing, so a work order listed a Hover report nobody
// could open. Covers: the checked upload kind, the save refusing a new bare
// name (and keeping an old one), and the read route serving bytes by position
// to the hiring side and the crew holding a live work order -- and nobody else.
//
//   node --no-warnings scripts/measure-docs-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const files = new Map();
const db = freshDb({ base: SCHEMA, migrations: [] });
db.exec(`
  INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
    ('acc_gc','Outerhome','outerhome','general_contractor','scale'),
    ('acc_x','Elsewhere','elsewhere','general_contractor','scale');
  INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','r@o.test'), ('u_c','Cy','c@roof.test'),
    ('u_v','Vi','v@void.test'), ('u_x','Xa','x@e.test');
  INSERT INTO companies(id,company) VALUES ('co_roof','Roof Co'), ('co_void','Void Co');
  INSERT INTO engagements(id,account_id,company_id,status) VALUES
    ('e1','acc_gc','co_roof','active'), ('e2','acc_gc','co_void','active');
  INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
    ('m1','u_ad','acc_gc','admin',NULL), ('m2','u_c','acc_gc','contractor','co_roof'),
    ('m3','u_v','acc_gc','contractor','co_void'), ('m4','u_x','acc_x','admin',NULL);
  INSERT INTO jobs(id,account_id,title,trades,measurement_docs) VALUES
    ('j1','acc_gc','Reroof','["roofing"]','["old-sketch.pdf"]');
  INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,voided_at) VALUES
    ('w1','WO-1','j1','roofing','co_roof','e1','accepted',NULL),
    ('w2','WO-2','j1','roofing','co_void','e2','accepted','2026-10-01');
`);
const env = { DB: makeD1(db), FILES: {
  put: async (k, body, opts) => { files.set(k, { body: new Uint8Array(body), type: opts?.httpMetadata?.contentType }); },
  get: async (k) => (files.has(k) ? { body: files.get(k).body } : null),
} };
const req = (path, { who = "u_ad", acct = "acc_gc", method = "GET", body, type } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work/api${path}`, { method,
    headers: { "Content-Type": type || "application/json", "X-User-Id": who, "X-Account-Id": acct },
    body: body === undefined ? undefined : (type ? body : JSON.stringify(body)) }), env);
const J = async (r) => [r.status, await r.json().catch(() => ({}))];

console.log("\n-- the upload kind is checked --");
const pdf = new TextEncoder().encode("%PDF-1.4 hover report");
let [st, up] = await J(await req("/uploads/measurement-doc/hover%20report.pdf", { method: "PUT", body: pdf, type: "application/pdf" }));
ck("a PDF is stored", st === 200 && /^acc_gc\/measurement-doc\//.test(up.key || ""), `${st} ${JSON.stringify(up)}`);
const [hs, hb] = await J(await req("/uploads/measurement-doc/x.html", { method: "PUT", body: new TextEncoder().encode("<script>"), type: "text/html" }));
ck("an HTML file is refused by name", hs === 415 && hb.error === "not_a_document", `${hs} ${JSON.stringify(hb)}`);
const [ss] = await J(await req("/uploads/measurement-doc/x.svg", { method: "PUT", body: new TextEncoder().encode("<svg/>"), type: "image/svg+xml" }));
ck("and so is an SVG", ss === 415);

console.log("\n-- saving --");
const entry = { key: up.key, name: "hover report.pdf", type: "application/pdf", size: pdf.length };
let [ps, pb] = await J(await req("/jobs/j1", { method: "PATCH", body: { measurementDocs: ["old-sketch.pdf", "new-name-only.pdf"] } }));
ck("a NEW bare name is refused", ps === 400 && pb.error === "measurement_doc_not_uploaded", `${ps} ${JSON.stringify(pb)}`);
[ps, pb] = await J(await req("/jobs/j1", { method: "PATCH", body: { measurementDocs: ["old-sketch.pdf", { ...entry, key: "acc_x/measurement-doc/stolen.pdf" }] } }));
ck("a key under another account's prefix is refused", ps === 400 && pb.error === "bad_measurement_doc", `${ps} ${JSON.stringify(pb)}`);
[ps, pb] = await J(await req("/jobs/j1", { method: "PATCH", body: { measurementDocs: ["old-sketch.pdf", entry] } }));
ck("an uploaded file is saved, and the old name kept", ps === 200, `${ps} ${JSON.stringify(pb)}`);
const stored = JSON.parse(db.prepare("SELECT measurement_docs FROM jobs WHERE id='j1'").get().measurement_docs);
ck("the row holds both", stored.length === 2 && stored[1].key === up.key, JSON.stringify(stored));
const [cs, cb] = await J(await req("/jobs", { method: "POST", body: { title: "T", trades: ["roofing"], measurementDocs: ["picked.pdf"] } }));
ck("a new job refuses a bare name too", cs === 400 && cb.error === "measurement_doc_not_uploaded", `${cs} ${JSON.stringify(cb)}`);

console.log("\n-- reading --");
let r = await req("/jobs/j1/measurements/1");
ck("the admin reads the file", r.status === 200 && (await r.text()).includes("hover report"), String(r.status));
ck("as its own type, never sniffed", r.headers.get("Content-Type") === "application/pdf" && r.headers.get("X-Content-Type-Options") === "nosniff");
r = await req("/jobs/j1/measurements/1", { who: "u_c" });
ck("the crew holding the work order reads it", r.status === 200, String(r.status));
r = await req("/jobs/j1/measurements/1", { who: "u_v" });
ck("a voided crew does not", r.status === 404, String(r.status));
r = await req("/jobs/j1/measurements/1", { who: "u_x", acct: "acc_x" });
ck("another account does not", r.status === 404, String(r.status));
let [ns, nb] = await J(await req("/jobs/j1/measurements/0"));
ck("a name never uploaded answers no_file", ns === 404 && nb.error === "no_file", JSON.stringify(nb));
[ns, nb] = await J(await req("/jobs/j1/measurements/7"));
ck("past the end is not_found", ns === 404 && nb.error === "not_found");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
