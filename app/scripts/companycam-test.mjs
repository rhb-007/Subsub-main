// CompanyCam: connecting by token, the token sealed at rest, browsing a
// project, and importing its documents and photos as a job's measurement
// documents. CompanyCam is stubbed at fetch with the shapes in its published
// OpenAPI spec (Core API v2), so the requests the Worker actually makes are
// what gets asserted.
//
//   node --no-warnings scripts/companycam-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { sealSecret, openSecret } from "../worker/secretbox.js";
import { cleanCcImport, ccHttps, ccImageUrl, ccPhotoUsable, ccAddressLine } from "../shared/companycam.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const GOOD = "cc_live_token_abcdef123456";
const KEY = "a-long-random-sealing-key-for-tests-0001";
const BASE = "https://cc.test/v2";

// ---- CompanyCam, as its spec describes it ---------------------------------
const PDF = new TextEncoder().encode("%PDF-1.4 measurements");
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const projects = [
  { id: "9001", name: "Lee residence", status: "active",
    address: { street_address_1: "14 Alder Way", city: "Seattle", state: "WA", postal_code: "98101" },
    featured_image: [{ type: "thumbnail", uri: "https://static.cc.test/p9001s.jpg" }], updated_at: 1790000000 },
  { id: "9002", name: "Other job", status: "active", address: {}, featured_image: [] },
];
const docs = {
  "9001": [
    { id: "d1", project_id: "9001", name: "roof-measurements.pdf", url: "https://static.cc.test/d1.pdf", content_type: "application/pdf", byte_size: PDF.length },
    { id: "d2", project_id: "9001", name: "page.html", url: "https://static.cc.test/d2.html", content_type: "text/html", byte_size: 6 },
  ],
  "9002": [
    { id: "d9", project_id: "9002", name: "elsewhere.pdf", url: "https://static.cc.test/d9.pdf", content_type: "application/pdf" },
  ],
};
const photos = {
  p1: { id: "p1", project_id: "9001", status: "active", processing_status: "processed", description: "North slope",
    uris: [{ type: "original", uri: "https://static.cc.test/p1.jpg" }, { type: "thumbnail", uri: "https://static.cc.test/p1s.jpg" }] },
  p2: { id: "p2", project_id: "9001", status: "active", processing_status: "pending",
    uris: [{ type: "original", uri: "https://static.cc.test/p2.jpg" }] },
  p9: { id: "p9", project_id: "9002", status: "active", processing_status: "processed",
    uris: [{ type: "original", uri: "https://static.cc.test/p9.jpg" }] },
};
const files = {
  "https://static.cc.test/d1.pdf": { body: PDF, type: "application/octet-stream" },
  "https://static.cc.test/d2.html": { body: new TextEncoder().encode("<html>"), type: "text/html" },
  "https://static.cc.test/d9.pdf": { body: PDF, type: "application/pdf" },
  "https://static.cc.test/p1.jpg": { body: JPG, type: "image/jpeg" },
  "https://static.cc.test/p9.jpg": { body: JPG, type: "image/jpeg" },
};

const sent = [];
let ccDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const auth = init.headers?.Authorization || init.headers?.authorization || null;
  sent.push({ url, auth });
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (url.startsWith(BASE)) {
    if (ccDown) return json(503, { errors: ["down"] });
    if (auth !== `Bearer ${GOOD}`) return json(401, { errors: ["Unauthorized: token invalid"] });
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v2/, "");
    if (path === "/company") return json(200, { id: "c77", name: "Outerhome Roofing" });
    if (path === "/projects") {
      const q = (u.searchParams.get("query") || "").toLowerCase();
      return json(200, projects.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.address.street_address_1 || "").toLowerCase().includes(q)));
    }
    let m;
    if ((m = path.match(/^\/projects\/(\w+)$/))) {
      const p = projects.find((x) => x.id === m[1]);
      return p ? json(200, p) : json(404, { errors: ["Record not found"] });
    }
    if ((m = path.match(/^\/projects\/(\w+)\/documents$/))) return json(200, docs[m[1]] || []);
    if ((m = path.match(/^\/projects\/(\w+)\/photos$/))) return json(200, Object.values(photos).filter((p) => p.project_id === m[1]));
    if ((m = path.match(/^\/photos\/(\w+)$/))) return photos[m[1]] ? json(200, photos[m[1]]) : json(404, { errors: ["Record not found"] });
    return json(404, { errors: ["no route"] });
  }
  if (files[url]) {
    const f = files[url];
    return new Response(f.body, { status: 200, headers: { "Content-Type": f.type, "Content-Length": String(f.body.length) } });
  }
  if (realFetch && !url.startsWith("https://")) return realFetch(input, init);
  return new Response("nope", { status: 404 });
};

const stored = new Map();
const seed = (withConn = true) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_gc','Outerhome','outerhome','general_contractor','scale'),
      ('acc_sub','Bay Roofing','bay','subcontractor','scale');
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','r@o.test'), ('u_pm','Pat','p@o.test'),
      ('u_c','Cy','c@roof.test'), ('u_bay','Bo','bo@bay.test');
    INSERT INTO companies(id,company) VALUES ('co_roof','Roof Co');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m1','u_ad','acc_gc','admin',NULL), ('m2','u_pm','acc_gc','pm',NULL),
      ('m3','u_c','acc_gc','contractor','co_roof'), ('m4','u_bay','acc_sub','admin',NULL);
    INSERT INTO jobs(id,account_id,title,trades) VALUES ('j1','acc_gc','Reroof','["roofing"]');
  `);
  return db;
};
let DB = seed();
let env = { DB: makeD1(DB), INTEGRATION_SECRET_KEY: KEY, COMPANYCAM_API_BASE: BASE, FILES: {
  put: async (k, body, opts) => { stored.set(k, { body: new Uint8Array(body), type: opts?.httpMetadata?.contentType }); },
  get: async (k) => (stored.has(k) ? { body: stored.get(k).body } : null),
} };
const AD = { u: "u_ad", a: "acc_gc" }, PM = { u: "u_pm", a: "acc_gc" }, CON = { u: "u_c", a: "acc_gc" };
const call = async (path, { method = "GET", seat = AD, body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work/api${path}`, {
    method: body !== undefined && method === "GET" ? "POST" : method,
    headers: { "Content-Type": "application/json", "X-User-Id": seat.u, "X-Account-Id": seat.a },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

console.log("\n-- the rules --");
{
  const sealed = await sealSecret({ INTEGRATION_SECRET_KEY: KEY }, GOOD);
  ck("a sealed token is not the token", !sealed.includes(GOOD) && sealed.startsWith("v1:"), sealed);
  ck("it opens with the key", (await openSecret({ INTEGRATION_SECRET_KEY: KEY }, sealed)) === GOOD);
  ck("and not with another key", (await openSecret({ INTEGRATION_SECRET_KEY: KEY + "x" }, sealed)) === null);
  ck("a tampered row opens to nothing", (await openSecret({ INTEGRATION_SECRET_KEY: KEY }, sealed.slice(0, -4) + "AAAA")) === null);
  ck("two seals of one token differ (random IV)", sealed !== await sealSecret({ INTEGRATION_SECRET_KEY: KEY }, GOOD));
  ck("an http link is not used", ccHttps("http://static.cc.test/a.jpg") === "");
  ck("an https one is", ccHttps("https://static.cc.test/a.jpg") === "https://static.cc.test/a.jpg");
  ck("the original variant is preferred", ccImageUrl(photos.p1.uris) === "https://static.cc.test/p1.jpg");
  ck("a pending photo is not importable", !ccPhotoUsable(photos.p2) && ccPhotoUsable(photos.p1));
  ck("an address reads as one line", ccAddressLine(projects[0].address) === "14 Alder Way, Seattle, WA 98101");
  ck("an import names a project", cleanCcImport({ photos: ["p1"] }).error === "project_required");
  ck("and picks something", cleanCcImport({ projectId: "9001" }).error === "nothing_picked");
  ck("a URL is not an id", cleanCcImport({ projectId: "9001", photos: ["https://evil.test/x"] }).error === "nothing_picked");
  ck("more than 20 is refused", cleanCcImport({ projectId: "9001", photos: Array.from({ length: 21 }, (_, i) => `p${i}`) }).error === "too_many");
}

console.log("\n-- connecting --");
{
  const before = await call("/integrations");
  const row = (before.body.integrations || []).find((i) => i.id === "companycam");
  ck("CompanyCam is listed, not soon, not connected", row && !row.soon && row.connect === "token" && !row.connection, JSON.stringify(row));
  const pmTry = await call("/integrations/companycam/connection", { method: "PUT", seat: PM, body: { token: GOOD } });
  ck("a project manager cannot connect it", pmTry.status === 403, String(pmTry.status));
  const bad = await call("/integrations/companycam/connection", { method: "PUT", body: { token: "not-the-right-token" } });
  ck("a token CompanyCam refuses is refused, with their words", bad.status === 400 && bad.body.error === "token_refused" && /invalid/.test(bad.body.detail || ""), JSON.stringify(bad.body));
  ck("and nothing was stored", DB.prepare("SELECT COUNT(*) n FROM account_connections").get().n === 0);
  const blank = await call("/integrations/companycam/connection", { method: "PUT", body: { token: "short" } });
  ck("a blank or short token is refused by name", blank.status === 400 && blank.body.error === "token_required");
  const keyless = { ...env, INTEGRATION_SECRET_KEY: "" };
  const saved = env; env = keyless;
  const nk = await call("/integrations/companycam/connection", { method: "PUT", body: { token: GOOD } });
  env = saved;
  ck("with no sealing key it is refused, not stored in the clear", nk.status === 503 && nk.body.error === "not_configured", JSON.stringify(nk.body));
  ck("still nothing stored", DB.prepare("SELECT COUNT(*) n FROM account_connections").get().n === 0);
  const hov = await call("/integrations/hover/connection", { method: "PUT", body: { token: GOOD } });
  ck("Hover cannot be connected", hov.status === 404);

  const ok = await call("/integrations/companycam/connection", { method: "PUT", body: { token: GOOD } });
  const cc = (ok.body.integrations || []).find((i) => i.id === "companycam");
  ck("a good token connects, labeled with CompanyCam's company name", ok.status === 200 && cc?.connection?.label === "Outerhome Roofing", JSON.stringify(cc));
  const r = DB.prepare("SELECT secret_enc FROM account_connections WHERE account_id='acc_gc'").get();
  ck("the stored value is sealed", r && !r.secret_enc.includes(GOOD) && r.secret_enc.startsWith("v1:"));
  ck("the token never comes back in the reply", !JSON.stringify(ok.body).includes(GOOD));
  ck("the probe sent the token to CompanyCam's /company", sent.some((s) => s.url === `${BASE}/company` && s.auth === `Bearer ${GOOD}`));
}

console.log("\n-- browsing --");
{
  const st = await call("/companycam/status", { seat: PM });
  ck("a project manager sees it connected", st.body.connected === true && st.body.label === "Outerhome Roofing", JSON.stringify(st.body));
  const cst = await call("/companycam/status", { seat: CON });
  ck("a contractor seat is refused", cst.status === 403, String(cst.status));
  sent.length = 0;
  const pr = await call("/companycam/projects?q=Alder", { seat: PM });
  ck("projects are searched", pr.status === 200 && pr.body.projects?.length === 1 && pr.body.projects[0].id === "9001", JSON.stringify(pr.body));
  const asked = sent.find((s) => s.url.startsWith(`${BASE}/projects?`));
  ck("with CompanyCam's own query parameter and active only",
    asked && new URL(asked.url).searchParams.get("query") === "Alder" && new URL(asked.url).searchParams.get("status") === "active", asked?.url);
  ck("a project carries a name and a place, nothing else", Object.keys(pr.body.projects[0]).sort().join() === "address,deleted,id,name,thumb,updatedAt", Object.keys(pr.body.projects[0]).join());
  const one = await call("/companycam/projects/9001", { seat: PM });
  ck("a project lists its documents and photos", one.status === 200 && one.body.documents?.length === 2 && one.body.photos?.length === 2, JSON.stringify(one.body).slice(0, 200));
  ck("a pending photo is marked not usable", one.body.photos.find((p) => p.id === "p2")?.usable === false);
  ck("no CompanyCam file URL reaches the browser except thumbnails",
    !JSON.stringify(one.body).includes("d1.pdf") && !JSON.stringify(one.body).includes("p1.jpg"), JSON.stringify(one.body));
  const nf = await call("/companycam/projects/nope", { seat: PM });
  ck("an unknown project is not found", nf.status === 404);
}

console.log("\n-- importing --");
{
  stored.clear(); sent.length = 0;
  const r = await call("/companycam/import", { seat: PM, body: { projectId: "9001", documents: ["d1", "d2", "d9"], photos: ["p1", "p2", "p9"] } });
  ck("the import answers", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  const docsBack = r.body.docs || [];
  ck("the PDF and the photo are copied", docsBack.length === 2 && docsBack.some((d) => d.name === "roof-measurements.pdf") && docsBack.some((d) => /^CompanyCam-North-slope-p1\.jpg$/.test(d.name)), JSON.stringify(docsBack));
  ck("stored under this account's measurement-doc prefix", docsBack.every((d) => d.key.startsWith("acc_gc/measurement-doc/") && stored.has(d.key)));
  ck("an octet-stream PDF takes the API's own content type", docsBack.find((d) => d.name.endsWith(".pdf"))?.type === "application/pdf");
  const why = Object.fromEntries((r.body.skipped || []).map((s) => [s.id, s.why]));
  ck("an HTML document is skipped as not a document", why.d2 === "not_a_document", JSON.stringify(r.body.skipped));
  ck("a document from another project is skipped", why.d9 === "not_in_project");
  ck("a photo from another project is skipped", why.p9 === "not_in_project");
  ck("a photo still processing is skipped", why.p2 === "not_ready");
  ck("the other project's file was never downloaded", !sent.some((s) => s.url.includes("d9.pdf") || s.url.includes("p9.jpg")));
  ck("the token is never sent to the file host", sent.filter((s) => s.url.startsWith("https://static.cc.test")).every((s) => !s.auth));
  const evil = await call("/companycam/import", { seat: PM, body: { projectId: "9001", documents: ["https://evil.test/x.pdf"] } });
  ck("a URL in the body is not a document", evil.status === 400 && evil.body.error === "nothing_picked");

  const save = await call("/jobs/j1", { method: "PATCH", seat: PM, body: { measurementDocs: docsBack } });
  ck("the imported entries save onto the job", save.status === 200, `${save.status} ${JSON.stringify(save.body)}`);
  const onJob = JSON.parse(DB.prepare("SELECT measurement_docs FROM jobs WHERE id='j1'").get().measurement_docs || "[]");
  ck("and the job holds them", onJob.length === 2 && onJob.every((d) => d.key), JSON.stringify(onJob));
}

console.log("\n-- switched off, refused, disconnected --");
{
  const off = await call("/integrations/companycam", { method: "PUT", body: { enabled: false } });
  ck("the switch turns it off", off.status === 200);
  const p = await call("/companycam/projects", { seat: PM });
  ck("browsing is refused while off", p.status === 409 && p.body.error === "integration_paused", JSON.stringify(p.body));
  const i = await call("/companycam/import", { seat: PM, body: { projectId: "9001", photos: ["p1"] } });
  ck("and so is importing", i.status === 409 && i.body.error === "integration_paused");
  const st = await call("/companycam/status", { seat: PM });
  ck("the job form is told not to offer it", st.body.connected === false && st.body.reason === "integration_paused");
  await call("/integrations/companycam", { method: "PUT", body: { enabled: true } });

  ccDown = true;
  const down = await call("/companycam/projects", { seat: PM });
  ccDown = false;
  ck("CompanyCam being down is unreachable, not refused", down.status === 502 && down.body.error === "provider_unreachable", JSON.stringify(down.body));

  // The token is revoked on CompanyCam's side: rotate what "good" means.
  DB.prepare("UPDATE account_connections SET secret_enc = ? WHERE account_id='acc_gc'")
    .run(await sealSecret({ INTEGRATION_SECRET_KEY: KEY }, "cc_revoked_token_000000"));
  const ref = await call("/companycam/projects", { seat: PM });
  ck("a revoked token answers by name", ref.status === 409 && ref.body.error === "companycam_refused", JSON.stringify(ref.body));
  const list = await call("/integrations");
  ck("and the panel says so next time", list.body.integrations.find((x) => x.id === "companycam")?.connection?.lastError === "token_refused");

  const rekey = { ...env, INTEGRATION_SECRET_KEY: KEY + "-rotated" };
  const saved = env; env = rekey;
  const nk = await call("/companycam/status", { seat: PM });
  env = saved;
  ck("a row the key cannot open is not connected", nk.body.connected === false && nk.body.reason === "not_connected");

  const dis = await call("/integrations/companycam/connection", { method: "DELETE" });
  ck("disconnecting deletes the token", dis.status === 200 && DB.prepare("SELECT COUNT(*) n FROM account_connections").get().n === 0);
  const after = await call("/companycam/projects", { seat: PM });
  ck("and nothing can be read afterwards", after.status === 409 && after.body.error === "not_connected");
}

console.log("\n-- a subcontractor account, and a database without 091 --");
{
  const sub = await call("/integrations/companycam/connection", { method: "PUT", seat: { u: "u_bay", a: "acc_sub" }, body: { token: GOOD } });
  ck("a subcontractor account is refused by name", sub.body.error === "not_a_hiring_account", JSON.stringify(sub.body));
  DB.exec("DROP TABLE account_connections");
  const l = await call("/integrations");
  ck("the list still loads and names 091", l.status === 200 && l.body.connMigration === "091_account_connections", JSON.stringify(l.body.connMigration));
  const c = await call("/integrations/companycam/connection", { method: "PUT", body: { token: GOOD } });
  ck("connecting names the migration", c.status === 503 && c.body.migration === "091_account_connections", JSON.stringify(c.body));
  const st = await call("/companycam/status", { seat: PM });
  ck("and the job form just does not offer it", st.status === 200 && st.body.connected === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
