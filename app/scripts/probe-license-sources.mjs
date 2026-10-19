// Reads what the state license registries actually answer, from somewhere that
// can reach them (a GitHub runner; the build container cannot). Read-only:
// metadata and a couple of sample rows per dataset, printed as JSON.
//
//   node scripts/probe-license-sources.mjs
//
// Two halves. The datasets the Worker already reads (SOCRATA_STATES), so their
// field mappings can be checked against real column names; and a catalog search
// for every other state contractor-license dataset on Socrata, so new states
// can be added from evidence rather than guessed.

const CONFIGURED = {
  WA: ["data.wa.gov", ["m8qx-ubtq", "ciwg-agsx", "bzff-4fmt"]],
  OR: ["data.oregon.gov", ["g77e-6bhs"]],
  CT: ["data.ct.gov", ["5r9m-qgni"]],
  IA: ["data.iowa.gov", ["dpf3-iz94"]],
  IL: ["data.illinois.gov", ["pzzh-kp68"]],
  TX: ["data.texas.gov", ["7358-krk7"]],
};
const QUERIES = ["contractor license", "contractor registration", "licensed contractors",
  "home improvement contractor", "electrical contractor license", "plumbing license", "building contractor"];

const get = async (url) => {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: text.slice(0, 300) }; }
  } catch (e) { return { status: 0, body: String(e.message || e) }; }
};

const out = { configured: {}, catalog: [] };
for (const [st, [domain, ids]] of Object.entries(CONFIGURED)) {
  out.configured[st] = [];
  for (const id of ids) {
    const meta = await get(`https://${domain}/api/views/${id}.json`);
    const rows = await get(`https://${domain}/resource/${id}.json?$limit=3`);
    out.configured[st].push({
      id, metaStatus: meta.status, name: meta.body?.name, updated: meta.body?.rowsUpdatedAt,
      columns: Array.isArray(meta.body?.columns) ? meta.body.columns.map((c) => c.fieldName) : meta.body,
      rowsStatus: rows.status, sample: Array.isArray(rows.body) ? rows.body : rows.body,
    });
  }
}
// What kinds of licence each multi-profession dataset holds, and the exact
// query shape the Worker sends, run against a number the sample rows carry.
const GROUPS = [
  ["IL", "data.illinois.gov", "pzzh-kp68", "license_type"],
  ["TX", "data.texas.gov", "7358-krk7", "license_type"],
  ["CT", "data.ct.gov", "5r9m-qgni", "credentialtype"],
  ["OR", "data.oregon.gov", "g77e-6bhs", "license_type"],
  ["ORBCD", "data.oregon.gov", "vhbr-cuaq", "lictype"],
];
out.groups = {};
for (const [st, domain, id, field] of GROUPS) {
  const r = await get(`https://${domain}/resource/${id}.json?$select=${field},count(*)&$group=${field}&$limit=400`);
  out.groups[st] = r.body;
}
out.samples = {};
const one = async (key, url) => { out.samples[key] = (await get(url)).body; };
await one("IL_roof", "https://data.illinois.gov/resource/pzzh-kp68.json?$where=upper(license_type) like '%25ROOF%25'&$limit=3");
await one("TX_elec", "https://data.texas.gov/resource/7358-krk7.json?$where=upper(license_type) like '%25ELECTRIC%25'&$limit=3");
await one("ORBCD", "https://data.oregon.gov/resource/vhbr-cuaq.json?$limit=3");
await one("OR_byNumber", "https://data.oregon.gov/resource/g77e-6bhs.json?license_number=100215");
await one("CT_byNumber", "https://data.ct.gov/resource/5r9m-qgni.json?credentialnumber=631057");
await one("OR_count", "https://data.oregon.gov/resource/g77e-6bhs.json?$select=count(*)");
const seen = new Set();
for (const q of QUERIES) {
  const r = await get(`https://api.us.socrata.com/api/catalog/v1?q=${encodeURIComponent(q)}&only=dataset&limit=100`);
  for (const x of r.body?.results || []) {
    const key = `${x.metadata?.domain}/${x.resource?.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.catalog.push({ domain: x.metadata?.domain, id: x.resource?.id, name: x.resource?.name,
      updated: x.resource?.data_updated_at, columns: x.resource?.columns_field_name });
  }
}
console.log("PROBE_JSON_BEGIN");
console.log(JSON.stringify(out));
console.log("PROBE_JSON_END");
