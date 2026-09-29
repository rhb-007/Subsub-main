// Reading a compliance document back.
//
// Uploading has worked since the start and NOTHING could read one back. The
// only route that ever served a compliance document's bytes was
// `/api/pack/:token/file/:docId` -- the PUBLIC one, keyed by an emailed
// token. So a stranger holding a forwarded certificate could see it, and the
// account being asked to APPROVE that certificate could not.
//
// What the review screen offered instead was a generated .txt file listing
// the checks it wanted somebody to perform, carrying the line "Placeholder
// preview -- wired to object storage in production". Both Open and Download
// handed that out. A reviewer attesting to a coverage limit and an expiry
// date was doing it from memory of a file the screen would not show them,
// which is the screen-that-lies rule pointed at the one screen whose entire
// job is reading a document.
//
// What this covers:
//
//   THE BYTES COME BACK to an account that hires them, to the contractor
//   themselves, and to a hireable account reading its own row.
//
//   THE W-9 IS SERVED HERE. `inLink` keeps a taxpayer number out of an
//   emailed link precisely because this door exists; refusing it here too
//   would leave the W-9 readable by nobody at all.
//
//   A STRANGER GETS NOTHING, and a refusal is indistinguishable from a
//   company that is not there, so a derived id cannot be probed.
//
//   AN ENDED ENGAGEMENT IS NOT A KEY THEY KEEP, matching the write rule.
//
//   THE CURRENT ROW, NOT A SUPERSEDED ONE -- last year's certificate is kept
//   for the dispute, not served as though it were cover.
//
//   NO FILE IS ITS OWN ANSWER. An upload made before 037 recorded the R2 key
//   has nothing to serve, and that is not the same as "not your company".
//
//   AND THE PLACEHOLDER IS GONE from the browser bundle.
//
//   node --no-warnings scripts/docview-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;

const COI = "ACORD 25 -- Cascade Mutual -- CGL-99812 -- expires 2027-03-01";
const W9 = "FORM W-9 -- TIN 12-3456789";
const LEGACY = "LEGACY SIDING -- the copy whose key nobody wrote down";

// Alder hires Bay Roofing. Sound PM's engagement with Bay is ended. Outerhome
// is a hireable account with a company row of its own and no client at all.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M031] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc_a','Alder Construction','alder','general_contractor'),
      ('acc_s','Sound PM','sound','property_manager'),
      ('acc_out','Outerhome','outerhome','general_contractor');
    INSERT INTO companies(id,company,insurance,w9,doc_files) VALUES
      ('cmp_bay','Bay Roofing',1,1,'{"insurance":"bay-coi-2026.pdf","w9":"bay-w9.pdf"}'),
      ('cmp_old','Legacy Siding',1,0,'{"insurance":"legacy-coi.pdf"}'),
      ('cmp_own_acc_out','Outerhome',1,0,'{"insurance":"outerhome-coi.pdf"}');
    UPDATE accounts SET company_id = 'cmp_own_acc_out' WHERE id = 'acc_out';
    INSERT INTO users(id,name,email) VALUES
      ('u_alder','Pat Alder','pat@alder.test'),
      ('u_sound','Sam Sound','sam@sound.test'),
      ('u_out','Robin Outer','robin@outerhome.test'),
      ('u_bay','Rae Bay','rae@bayroofing.test');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m1','u_alder','acc_a','admin',NULL),
      ('m2','u_sound','acc_s','admin',NULL),
      ('m3','u_bay','acc_a','contractor','cmp_bay'),
      ('m4','u_out','acc_out','admin',NULL);
    INSERT INTO engagements(id,account_id,company_id,status) VALUES
      ('en_bay','acc_a','cmp_bay','active'),
      ('en_old','acc_a','cmp_old','active'),
      ('en_done','acc_s','cmp_bay','ended');
    INSERT INTO company_docs(id,company_id,kind,file_key,file_name,uploaded_at) VALUES
      -- Last year's, kept for the dispute. Must never be what gets served.
      ('cd_old','cmp_bay','insurance','k/bay-coi-2025.pdf','bay-coi-2025.pdf','2025-01-02'),
      ('cd_coi','cmp_bay','insurance','k/bay-coi-2026.pdf','bay-coi-2026.pdf','2026-01-02'),
      ('cd_w9','cmp_bay','w9','k/bay-w9.pdf','bay-w9.pdf','2026-01-02'),
      ('cd_own','cmp_own_acc_out','insurance','k/outerhome-coi.pdf','outerhome-coi.pdf','2026-02-02'),
      -- Uploaded before 037 had anywhere to put the key. The file is in the
      -- bucket and nothing records where.
      ('cd_nokey','cmp_old','insurance',NULL,'legacy-coi.pdf','2024-05-05');
    UPDATE company_docs SET superseded_at = '2026-01-02' WHERE id = 'cd_old';`);

  const files = new Map([
    ["k/bay-coi-2026.pdf", COI],
    ["k/bay-coi-2025.pdf", "LAST YEAR -- expired 2026-03-01"],
    ["k/bay-w9.pdf", W9],
    ["k/outerhome-coi.pdf", "OUTERHOME OWN COI"],
    // Legacy Siding's certificate, in the bucket under the key the upload
    // route builds, with NOTHING in company_docs recording it. This is what a
    // database that never ran 037 looks like for every document it holds.
    ["acc_a/insurance/aaaa1111-legacy-coi.pdf", "LEGACY OLD COPY"],
    ["acc_a/insurance/bbbb2222-legacy-coi.pdf", LEGACY],
    // A same-named file under ANOTHER account's prefix, which must never be
    // reachable from this one.
    ["acc_s/insurance/cccc3333-legacy-coi.pdf", "SOMEBODY ELSE'S BUCKET"],
    // And a DIFFERENT contractor's certificate under the SAME prefix, because
    // one account's insurance/ folder holds one of these per company on its
    // roster. Nothing but the trailing filename tells them apart, so this is
    // what the suffix match is actually for.
    ["acc_a/insurance/dddd4444-bay-coi-2026.pdf", "BAY ROOFING, NOT LEGACY"],
  ]);
  const uploadedAt = new Map([
    ["acc_a/insurance/aaaa1111-legacy-coi.pdf", "2024-05-05T00:00:00Z"],
    ["acc_a/insurance/bbbb2222-legacy-coi.pdf", "2026-04-04T00:00:00Z"],
    // Deliberately the NEWEST of the three. The first version of this fixture
    // left it undated, so newest-wins picked the right file anyway and the
    // prefix scoping could be deleted with every assertion still passing --
    // the two guards were covering for each other. Now only the prefix keeps
    // this one out.
    ["acc_s/insurance/cccc3333-legacy-coi.pdf", "2026-09-09T00:00:00Z"],
    // Newer than Legacy's, so without the suffix match it wins and one
    // contractor's certificate is served as another's.
    ["acc_a/insurance/dddd4444-bay-coi-2026.pdf", "2026-08-08T00:00:00Z"],
  ]);
  return { db, env: {
    DB: makeD1(db),
    FILES: {
      get: async (k) => files.has(k)
        ? { body: files.get(k), httpMetadata: { contentType: "application/pdf" } } : null,
      // The bucket can be listed by prefix, which is how a file whose key was
      // never recorded is found again.
      list: async ({ prefix }) => ({
        objects: [...files.keys()].filter((k) => k.startsWith(prefix))
          .map((k) => ({ key: k, uploaded: uploadedAt.get(k) || "2026-01-01T00:00:00Z" })),
        truncated: false,
      }),
    },
  } };
};

const get = (env, who, acct, path) => worker.fetch(
  new Request(`https://api.subsub.work/api${path}`, {
    headers: { "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const body = async (r) => (r.status === 200 ? await r.text() : "");

console.log("\n-- the account being asked to approve it can read it --");
{
  const { env } = seed();
  const r = await get(env, "u_alder", "acc_a", "/subs/cmp_bay/documents/insurance/file");
  ck("the hiring account gets 200", r.status === 200, String(r.status));
  const t = await body(r);
  ck("and the actual uploaded bytes", t === COI, JSON.stringify(t.slice(0, 40)));
  ck("not a generated placeholder", !/placeholder/i.test(t));
  ck("the content type comes off the stored object",
    r.headers.get("Content-Type") === "application/pdf", String(r.headers.get("Content-Type")));
  ck("the filename rides along",
    (r.headers.get("Content-Disposition") || "").includes("bay-coi-2026.pdf"),
    String(r.headers.get("Content-Disposition")));
  ck("and no intermediary may keep a copy",
    /no-store/.test(r.headers.get("Cache-Control") || ""), String(r.headers.get("Cache-Control")));
}

console.log("\n-- the current certificate, never the superseded one --");
{
  const { env } = seed();
  const t = await body(await get(env, "u_alder", "acc_a", "/subs/cmp_bay/documents/insurance/file"));
  ck("this year's is what comes back", t === COI);
  // Serving last year's would read as cover on a screen that says "Verified".
  ck("last year's is not served", !t.includes("LAST YEAR"));
}

console.log("\n-- the W-9 is served HERE, which is what the link refusing it assumes --");
{
  const { env } = seed();
  const r = await get(env, "u_alder", "acc_a", "/subs/cmp_bay/documents/w9/file");
  ck("the hiring account may read a W-9", r.status === 200, String(r.status));
  ck("and it is the real one", (await body(r)) === W9);
  // `inLink` keeps it out of an emailed pack precisely because this exists.
  // Refusing it in both places would leave it readable by nobody at all.
}

console.log("\n-- a stranger gets nothing, and cannot tell what is real --");
{
  const { env } = seed();
  const real = await get(env, "u_sound", "acc_s", "/subs/cmp_bay/documents/insurance/file");
  const fake = await get(env, "u_sound", "acc_s", "/subs/cmp_nope/documents/insurance/file");
  ck("an ended engagement is refused", real.status === 404, String(real.status));
  ck("a company that is not there answers the same", fake.status === real.status,
    `${fake.status} vs ${real.status}`);
  ck("so a derived id cannot be probed for being real", real.status === fake.status);
  ck("and no bytes came back", (await body(real)) === "");
}

console.log("\n-- the contractor reads their own, and so does a hireable account --");
{
  const { env } = seed();
  const mine = await get(env, "u_bay", "acc_a", "/subs/cmp_bay/documents/insurance/file");
  ck("the contractor seat reads its own certificate", mine.status === 200, String(mine.status));
  ck("and gets the bytes", (await body(mine)) === COI);

  // Outerhome has no client at all -- the send-your-pack account. The
  // engagement check cannot answer for them; seatCompany is what does.
  const own = await get(env, "u_out", "acc_out", "/subs/cmp_own_acc_out/documents/insurance/file");
  ck("an account with no client reads its OWN row", own.status === 200, String(own.status));
  ck("and gets those bytes", (await body(own)) === "OUTERHOME OWN COI");
}

console.log("\n-- a key nobody recorded is still found in the bucket --");
{
  // The case that matters most in practice. The upload route puts the file in
  // R2 FIRST and writes company_docs second, inside a try/catch that swallows
  // a missing table -- so a database that never ran 037 has every document in
  // the bucket and not one row saying where. Giving up here would report a
  // whole roster of real certificates as unopenable.
  const { env } = seed();
  const r = await get(env, "u_alder", "acc_a", "/subs/cmp_old/documents/insurance/file");
  ck("it is served", r.status === 200, String(r.status));
  ck("and it is the real document", (await body(r)) === LEGACY);
}

console.log("\n-- the newest matching object wins --");
{
  const { env } = seed();
  const t = await body(await get(env, "u_alder", "acc_a", "/subs/cmp_old/documents/insurance/file"));
  // A replaced document keeps its old object under the same prefix and the
  // same trailing name, so "any match" would serve whichever the bucket
  // listed first -- last year's certificate, drawn as current cover.
  ck("not the older copy of the same name", t !== "LEGACY OLD COPY", t.slice(0, 40));
  ck("the current one", t === LEGACY);
}

console.log("\n-- and the search never leaves the caller's own prefix --");
{
  const { env } = seed();
  // Sound PM holds an object with the identical trailing filename. Alder must
  // not reach it, and the prefix comes off the SESSION, never the URL.
  const t = await body(await get(env, "u_alder", "acc_a", "/subs/cmp_old/documents/insurance/file"));
  ck("another account's bucket is not searched", t !== "SOMEBODY ELSE'S BUCKET", t.slice(0, 40));
  // And within our own prefix, the name is the only thing separating one
  // contractor's certificate from the next one's.
  ck("nor another contractor's certificate from our own folder",
    t !== "BAY ROOFING, NOT LEGACY", t.slice(0, 40));
  const stranger = await get(env, "u_sound", "acc_s", "/subs/cmp_old/documents/insurance/file");
  ck("and a stranger still gets nothing at all", stranger.status === 404, String(stranger.status));
  const sj = await stranger.json().catch(() => ({}));
  ck("answered as not_found, before any lookup", sj.error === "not_found", JSON.stringify(sj));
}

console.log("\n-- a row with no file anywhere says no_file, and is not a 'not yours' --");
{
  const { db, env } = seed();
  // Nothing in company_docs, nothing in doc_files, nothing in the bucket.
  db.exec(`UPDATE companies SET doc_files = '{}' WHERE id = 'cmp_old';`);
  const r = await get(env, "u_alder", "acc_a", "/subs/cmp_old/documents/insurance/file");
  ck("it is a 404", r.status === 404, String(r.status));
  const j = await r.json().catch(() => ({}));
  // The two need telling apart: one is a permission answer and the other is a
  // file nobody can produce, and only the second one means "upload it again".
  ck("but the reason is no_file", j.error === "no_file", JSON.stringify(j));
  const stranger = await get(env, "u_sound", "acc_s", "/subs/cmp_old/documents/insurance/file");
  const sj = await stranger.json().catch(() => ({}));
  ck("where a stranger asking the same thing gets not_found", sj.error === "not_found",
    JSON.stringify(sj));
}

console.log("\n-- a kind that is not a kind is refused as one, not answered as one --");
{
  const { env } = seed();
  // The FIRST version of this asserted only the 404 and passed with the
  // DOC_KINDS guard deleted -- an unknown kind matches no row and 404s on the
  // way past anyway, so the assertion could not fail. What the guard actually
  // decides is WHICH 404: without it, `bogus` falls through to the no-row
  // branch and answers `no_file`, which says "that is a real kind of document
  // and this company has not uploaded one". It is neither.
  const r = await get(env, "u_alder", "acc_a", "/subs/cmp_bay/documents/bogus/file");
  ck("an unknown kind is a 404", r.status === 404, String(r.status));
  const j = await r.json().catch(() => ({}));
  ck("and it is not_found, not no_file", j.error === "not_found", JSON.stringify(j));
}

console.log("\n-- and the placeholder is gone from the bundle --");
{
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  ck("no 'Placeholder preview' text survives", !/Placeholder preview/i.test(app));
  ck("nothing builds a text/plain blob for a document",
    !/text\/plain[^]{0,400}-preview\.txt/.test(app));
  // Scoped to each component's own body. A bare /<DocFileView/ found whichever
  // of the two existed and passed either way -- deleting it from the review
  // modal left MyDocRow's copy satisfying the check, which is the same
  // found-whichever-exists trap as the embed panel's code button.
  const slice = (name) => {
    const at = app.indexOf(`function ${name}(`);
    if (at < 0) return "";
    const next = app.indexOf("\nfunction ", at + 1);
    return app.slice(at, next < 0 ? app.length : next);
  };
  ck("the review modal mounts the real viewer", /<DocFileView\b/.test(slice("DocReview")),
    "DocReview");
  ck("and so does the contractor's own documents row",
    /<DocFileView\b/.test(slice("MyDocRow")), "MyDocRow");
  ck("which fetches through the authenticated client",
    /api\.documentBlob\(/.test(slice("DocFileView")), "DocFileView");
  // The blob is made before the press, not during it: a press that awaits a
  // round trip has lost its user gesture and iOS Safari blocks the tab.
  ck("the viewer fetches on mount rather than on the press",
    /useEffect\([^]{0,600}api\.documentBlob\(/.test(slice("DocFileView")));
  ck("and revokes what it made", /revokeObjectURL/.test(slice("DocFileView")));

  // The bug that produced a row with no file. SubForm's document rows took
  // `e.target.files[0].name` and put it in local state; `build()` then PATCHed
  // the filename and the boolean onto the shared company row, so picking a
  // file recorded a certificate that had never been uploaded -- and marked the
  // contractor compliant and assignable on the strength of it.
  ck("SubForm no longer records a filename in place of a file",
    !/uploadDoc\(\s*k\s*,\s*e\.target\.files\[0\]\.name\s*\)/.test(app));
  ck("and its build() no longer writes the document columns",
    !/rating:\s*Number\(f\.rating\)\s*\|\|\s*0,\s*docFiles:\s*f\.docFiles/.test(app));
  ck("the upload goes through the same route every other one does",
    /onUploadDoc=\{\(k, file\) => uploadSubDoc\(editing\.id, k, file\)\}/.test(app));
  // And the bytes land before anything claims they did.
  const up = app.slice(app.indexOf("const uploadSubDoc"), app.indexOf("const deleteSubDoc"));
  ck("uploadSubDoc uploads before it patches state",
    up.indexOf("api.uploadDocument") < up.indexOf("patchCompany"),
    `${up.indexOf("api.uploadDocument")} vs ${up.indexOf("patchCompany")}`);
  ck("and no longer swallows the failure", !/uploadSubDoc failed/.test(up));

  const api = readFileSync(new URL("../src/lib/api.js", import.meta.url), "utf8");
  ck("and the client hits the file route",
    /documents\/\$\{kind\}\/file/.test(api), "api.js");
  // An <a href> cannot carry an Authorization header, which is the whole
  // reason this is a fetch-to-blob rather than a link.
  ck("with auth headers on it", /documentBlob[^]{0,400}authHeaders\(\)/.test(api));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
