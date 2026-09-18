# State Contractor Licensing Data Sources — 49-State Survey

Companion to the working Washington integration (`data.wa.gov`, Socrata datasets
`m8qx-ubtq` general / `ciwg-agsx` insurance / `bzff-4fmt` bond, joined on
`contractorlicensenumber`, no API key). This doc surveys the other 49 states + DC
for the same three questions: open API? public lookup tool? commercial aggregator
shortcut? and whether a state license even exists to look up.

## Methodology & a important caveat on verification

Research was done via web search (state agency pages, Socrata/CKAN/ArcGIS catalog
pages, and third-party guides cross-checked against official `.gov` sources where
they appeared in results). **Direct programmatic fetches to every cited URL were
not possible in this research session** — this sandbox's network egress policy
blocked outbound HTTPS to essentially all external hosts, including
`data.wa.gov`, `catalog.data.gov`, `api.us.socrata.com`, and even
`en.wikipedia.org` (confirmed via repeated `EGRESS_BLOCKED`/403 errors). All
dataset IDs, base URLs, and field lists below come from search-engine snippets and
cached page content, **not** from a live `curl`/response Claude inspected directly.

**Before wiring up any integration below, do the WA-style sanity check by hand:**
`curl` the dataset's `.json` endpoint (or open the ArcGIS/CKAN URL in a browser)
and confirm the ID, field names, and record count still match. Treat every dataset
ID in this doc as "reported, not verified" until that check is done.

Legend for the "State requires GC license?" column:
- **Y** — full state licensing system (exam/classification-based), general contracting broadly covered
- **Y-reg** — state requires *registration* only (no exam), lighter-weight than licensure
- **Y-partial** — state licenses/registers only a narrow slice (e.g. home-improvement, roofing, dwellings) — general commercial contracting itself is unregulated at the state level
- **County** — no state requirement; cities/counties regulate independently
- **N** — no meaningful state *or* local contractor-licensing regime found

---

## Summary table

| State | Open API? | Type | Public lookup tool? | Requires GC license? | Notes |
|---|---|---|---|---|---|
| Alabama | No | none | Yes — genconbd.alabama.gov roster search (legacy ASP, server-rendered) | Y (projects >$50k, via ALBGC) | Separate board for HVAC (igovsolution.net vendor) |
| Alaska | No | none | Yes — commerce.alaska.gov CBPL search; **official full-database CSV export offered** | Y | Closest to open data of the "no API" states — bulk CSV, not queryable API |
| Arizona | No | none | Yes — roc.az.gov/search (Salesforce Experience Cloud — likely JS-rendered); downloadable CSV extract also offered by ROC | Y (via Registrar of Contractors) | |
| Arkansas | No | none | Yes — aclb2.arkansas.gov/clbsearch.php (ColdFusion, server-rendered); **nightly full roster CSV** | Y | |
| California | No (bulk CSV only) | none | Yes — cslb.ca.gov/OnlineServices/CheckLicenseII (classic ASP.NET, server-rendered) | Y (via CSLB) | CSLB "Data Portal" (www2.cslb.ca.gov/onlineservices/dataportal) gives official downloadable lists by classification/county/master list — no live query API |
| Colorado | No | none | No statewide tool (regulated locally) | County | Electricians/plumbers are state-licensed; GC is not |
| Connecticut | **Yes** | Socrata | Yes — elicense.ct.gov (800+ license types) | Y-partial (Home Improvement + New Home Construction registration, not a classic "GC" trade) | Dataset reportedly omits name/address fields |
| Delaware | No | none | Yes — delpros.delaware.gov/OH_VerifyLicense | N | "License" is really a $75 Division-of-Revenue business registration, not a licensing board |
| District of Columbia | **Yes** | ArcGIS (Esri Feature Service) | Yes — DLCP BOSS Global Search | Y (Home Improvement Contractor license via DLCP) | Dataset is a general "Basic Business Licenses" registry, HIC is one of many categories — no contractor-specific bond/insurance fields |
| Florida | No | none | Yes — myfloridalicense.com/portalsearches/VerifyLicensee | Y (via DBPR/CILB) | No open-data portal found for DBPR/CILB records |
| Georgia | No | none | Yes — verify.sos.ga.gov (Secretary of State licensing division) | Y (via State Licensing Board for Residential & General Contractors) | |
| Hawaii | **Yes (unverified)** | CKAN | Yes — MyPVL search (pvl.ehawaii.gov) | Y (via DCCA Contractors License Board) | opendata.hawaii.gov lists a "PVL Search" dataset on CKAN — could not confirm the resource actually contains queryable records vs. just linking to the search tool |
| Idaho | No | none | Yes — dopl.idaho.gov | Y-reg (Contractor Registration Act, $2,000 threshold) | |
| Illinois | **Yes** | Socrata | Yes — IDFPR License Lookup (online-dfpr.micropact.com) | Y-partial (roofing only — no statewide GC license) | data.illinois.gov dataset covers 100+ IDFPR profession types incl. roofing contractors; needs filtering |
| Indiana | No | none | No statewide tool | County | Indianapolis, Ft. Wayne, Evansville license locally |
| Iowa | **Yes** | Socrata | Yes — DIAL contractor registration search | Y-reg | Dataset has no status/bond/insurance fields — registration list only |
| Kansas | No | none | No statewide GC tool | County | Roofing contractors register w/ the KS Attorney General (separate) |
| Kentucky | No | none | Local only for GC; dhbc.ky.gov for state trades | County | HBC licenses electricians/plumbers/HVAC statewide, not GC |
| Louisiana | No | none | Yes — arlspublic.lslbc.louisiana.gov/Public/Search (.NET WebForms, server-rendered) | Y (via LSLBC) | |
| Maine | No | none | Yes — pfr.maine.gov (OPOR) | Y-partial (HIC registration, $3k–$75k residential jobs only) | |
| Maryland | No | none | Yes — labor.maryland.gov/license/mhic | Y-partial (MHIC home-improvement license) | No statewide "general contractor" license |
| Massachusetts | No | none | Yes — two systems: HIC list (services.oca.state.ma.us, ASP.NET) + CSL via madpl.mylicense.com | Y-partial (HIC registration + Construction Supervisor License) | Two separate agencies/systems to reconcile |
| Michigan | No | none | Yes — val.apps.lara.state.mi.us (daily refresh); also Accela Citizen Access mirror | Y (Residential Builder license via LARA) | |
| Minnesota | No | none | Yes — secure.doli.state.mn.us/lookup (weekly refresh) | Y (via DLI) | |
| Mississippi | No | none | Yes — search.msboc.us/ConsolidatedSearch.cfm (ColdFusion) | Y (via MSBOC) | |
| Missouri | No | none | No statewide GC tool (new MOPRO portal covers other professions) | County | |
| Montana | No | none | Yes — erdcontractors.mt.gov (JSP) | Y-reg (Construction Contractor Registration + bond) | |
| Nebraska | No (unclear) | none confirmed | Yes — dol.nebraska.gov/conreg/Search | Y-reg (Contractor Registration Act) | "Nebraska.gov open data" hits were mostly unrelated GIS/ArcGIS content, not this dataset |
| Nevada | No | none | Yes — NSCB public search (exact board domain not independently confirmed this pass — verify at nscb.nv.gov) | Y (via NSCB) | |
| New Hampshire | No | none | Local only for GC; OPLC for state trades | County | Electricians/plumbers/gas fitters are state-licensed, GC is not |
| New Jersey | No | none | Yes — njconsumeraffairs.gov/hic + newjersey.mylicense.com | Y-reg (Home Improvement Contractor registration, no exam) | |
| New Mexico | No | none | Yes — RLD "Verifier" portal (rld.nm.gov), described as real-time | Y (via Construction Industries Division) | |
| New York | No | none | No statewide GC tool | County/city | NY licenses 35 occupations, GC isn't one; NYC DCWP issues its own local Home Improvement Contractor license (data on NYC's own Socrata portal, data.cityofnewyork.us — out of scope, city not state) |
| North Carolina | No | none | Yes — nclbgc.org lookup | Y (projects ≥$30k, via NCLBGC) | |
| North Dakota | No | none | Yes — FirstStop portal (firststop.sos.nd.gov) | Y (via Secretary of State) | |
| Ohio | No | none | Yes, but only for 5 trades — OCILB lookup | Y-partial (electrical/HVAC/hydronics/plumbing/refrigeration only, no GC license) | |
| Oklahoma | No | none | Yes — cibverify.ok.gov | Y-partial (trade-specific licenses via CIB: electrical, plumbing, mechanical, roofing/construction, fire suppression — no single "GC" license) | |
| Oregon | **Yes** | Socrata | Yes — search.ccb.state.or.us | Y (via CCB — nearly all contractors must register) | **Best match to the WA pattern** — dataset includes bond company/amount AND insurance company/amount fields |
| Pennsylvania | No | none | Yes — hicsearch.attorneygeneral.gov | Y-reg (HIC registration, $5k/yr threshold, via AG's office) | No statewide GC license |
| Rhode Island | Maybe (OpenGov portal, unconfirmed as true open data) | none confirmed | Yes — crb.ri.gov/search/contractor-search | Y (via CRLB) | ri-crlb.portal.opengov.com exists but wasn't confirmed as a queryable dataset vs. a transparency portal |
| South Carolina | No | none | Yes — verify.llronline.com (nightly refresh, ASP.NET) | Y (via SC LLR — separate Commercial and Residential systems) | |
| South Dakota | No | none | No statewide GC tool | County | Only electricians/plumbers/asbestos are state-licensed; "Excise Tax License" is a tax filing, not a contractor license |
| Tennessee | No (dashboard w/ download, not an API) | none | Yes — public dashboard, sortable/downloadable, at tn.gov/commerce | Y (via Board for Licensing Contractors) | Board mentions a Tyler "entellitrak" backend; no documented public REST access confirmed |
| Texas | **Yes** | Socrata | Yes — via TDLR | N (no GC license) — Y for TDLR-regulated trades | data.texas.gov "TDLR - All Licenses" (~962k rows) covers electricians/HVAC/etc., NOT general contractors (TX has none); plumbers are separately licensed by TSBPE, not in this dataset |
| Utah | No | none | Yes — secure.utah.gov/llv | Y (via DOPL) | |
| Vermont | No | none | Likely via OPR (vtprofessionals.org) — not independently confirmed | Y-reg (residential contractor registration ≥$10k since 2023) | No statewide GC license before that |
| Virginia | No | none | Yes — dpor.virginia.gov/LicenseLookup (real-time) | Y (Class A/B/C via DPOR Board for Contractors) | |
| West Virginia | No | none | Yes — wvclboard.wv.gov/verify | Y (via WV Contractor Licensing Board) | |
| Wisconsin | No | none | Yes — DSPS LicensE (license.wi.gov / licensesearch.wi.gov) | Y-partial (Dwelling Contractor certification, 1–2 family dwellings only) | |
| Wyoming | No | none | Local only for GC; WY Electrical Board for electricians | County | |

*(Washington itself is excluded — it's already live. See the intro.)*

---

## Tier 1 — genuine open API, ready to integrate like WA

All confirmed via search-engine snippets only (see caveat above) — verify live
before wiring up.

### Oregon — best WA-equivalent
- **Base URL:** `https://data.oregon.gov/resource/g77e-6bhs.json`
- **Dataset:** "CCB Active Licenses" (Construction Contractors Board), `g77e-6bhs`
- **Platform:** Socrata, no API key required
- **Fields (reported):** license number, business/DBA/principal name, license type & specialty/endorsement, status, issue/expiration dates, address/city/county/zip/phone, **bond company + bond amount**, **insurance company + insurance amount**, business type
- Data dictionary PDF exists at the same dataset page — pull it to confirm field names before mapping.
- This is the one state whose single dataset carries license + bond + insurance like WA's three-dataset join does in one table.

### Connecticut
- **Base URL:** `https://data.ct.gov/resource/5r9m-qgni.json`
- **Dataset:** "Home Improvement Contractor Licenses (Includes Active and Inactive)", `5r9m-qgni`
- **Platform:** Socrata, no key required
- **Scope caveat:** Home Improvement Contractor registration only — CT has a separate "New Home Construction Contractor" registration not confirmed to be on this same dataset. No insurance/bond fields; one search result noted the dataset "does not include person name or address fields."

### Iowa
- **Base URL:** `https://data.iowa.gov/resource/dpf3-iz94.json`
- **Dataset:** "Active Iowa Construction Contractor Registrations", `dpf3-iz94`
- **Platform:** Socrata, no key required
- **Fields (reported):** Registration #, Primary Activity, Business Name, First/Last Name, Email, Address 1/2, City, State, Zip, County, Phone, Issue Date, Expire Date
- **No status/bond/insurance fields** — this is a registration roster (Iowa requires registration, not full licensure), and it's filtered to active only.

### Illinois
- **Base URL:** `https://data.illinois.gov/resource/pzzh-kp68.json` (reported ID — unverified)
- **Dataset:** IDFPR statewide license dataset (Division of Professional Regulation + Real Estate + Financial Institutions), covers 100+ profession types including **Roofing Contractor**
- **Platform:** Socrata, no key required
- **Scope caveat:** Illinois has no statewide general-contractor license — this dataset is only useful for the roofing-contractor subset, filtered by profession/license-type field. ~1.2M records across all professions, so query with a `license_type`/profession filter, not a bulk pull.

### Texas
- **Base URL:** `https://data.texas.gov/resource/7358-krk7.json`
- **Dataset:** "TDLR - All Licenses", `7358-krk7`
- **Platform:** Socrata, no key required
- **Scope caveat:** Texas has **no** general-contractor license at all. TDLR regulates electricians, HVAC, and dozens of other trades but not GCs, and plumbers are licensed separately by TSBPE (not in this dataset). Useful only if SubSub needs TX electrical/HVAC sub-trade verification, not GC verification.
- ~962k rows reported, updated daily/weekly; fields include `license_status`, `expiration_date`, `original_issue_date`, `endorsement`.

### District of Columbia
- **Base URL (ArcGIS REST):** `https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/0/query`
- **Also on ArcGIS Hub / Open Data DC:** item id `85bf98d3915f412c8a4de706f2d13513`, "Basic Business Licenses"
- **Platform:** ArcGIS (Esri Feature Service), no key required for public queries (`f=json` GET requests)
- **Scope caveat:** general DLCP business-license registry (housing, motor-vehicle sales/service, **home improvement contractors**, etc.) — not a dedicated contractor board dataset, so no classification/bond/insurance fields; would need filtering by license-category field.

### Hawaii — flagged, not fully confirmed
- **Portal:** `opendata.hawaii.gov` runs CKAN, action API at `https://opendata.hawaii.gov/api/3/action/`
- **Dataset page:** `professional-and-vocational-licensing-pvl-search`
- Could not confirm from search results whether this CKAN dataset actually ships a queryable resource with contractor license rows, or is a metadata stub pointing at the MyPVL web tool (`pvl.ehawaii.gov`). **Check `package_show?id=professional-and-vocational-licensing-pvl-search` directly before counting on this one.**

---

## Tier 2 — public lookup tool exists, no open API

For each, the tool was located and its rendering technology noted where
observable from search results. **None of these were checked against their
Terms of Service for automated-access restrictions — that's a call for a human,
not an assumption to make from search snippets.** Where a tool looked like a
classic server-rendered ASP.NET/ColdFusion/JSP page, scraping is *technically*
more tractable than a JS-heavy SPA — that's a technical observation only, not
a recommendation to proceed without a ToS review.

**Likely server-rendered (classic ASP.NET/ColdFusion/JSP forms — more scrapable-looking, still verify ToS):**
Alabama (genconbd.alabama.gov), Arkansas (aclb2.arkansas.gov, ColdFusion), California (cslb.ca.gov, ASP.NET), Louisiana (arlspublic.lslbc.louisiana.gov, .NET WebForms), Massachusetts HIC list (services.oca.state.ma.us), Minnesota (secure.doli.state.mn.us), Mississippi (search.msboc.us, ColdFusion), Montana (erdcontractors.mt.gov, JSP), South Carolina (verify.llronline.com), Utah (secure.utah.gov/llv).

**Likely modern/JS-rendered or vendor-hosted (harder to scrape without a headless browser):**
Arizona (roc.az.gov — Salesforce Experience Cloud), Michigan (Accela Citizen Access mirror), New Jersey/Massachusetts CSL/many others (`*.mylicense.com` — a shared NIC/Thomson Reuters "MyLicense" vendor platform used by multiple states), New Mexico (rld.nm.gov "Verifier", described as real-time), North Dakota (FirstStop, .NET Core SOS platform).

**Everything else in this tier** (Florida, Georgia, Idaho, Maine, Maryland, Michigan LARA primary tool, Nebraska, Nevada, North Carolina, Oklahoma, Pennsylvania, Rhode Island, Tennessee, Virginia, West Virginia, Wisconsin) — rendering technology wasn't conclusively identified from search snippets; check each before assuming either way.

**Worth a special note — official bulk CSV/export offerings that go beyond a plain lookup box, even without a real API:**
- **California** — CSLB Data Portal offers official downloadable lists by classification, county, and a master list of all licensees.
- **Alaska** — full corporations/business/professional-licensing database downloadable in CSV.
- **Arkansas** — complete contractor roster regenerated and downloadable nightly as CSV.
- **Tennessee** — public dashboard is sortable and downloadable (format unconfirmed — likely a BI-tool export, not a REST endpoint).

These four are meaningfully better than a pure search-box state for a nightly-batch-import integration pattern, even though none expose a live queryable API.

---

## Tier 3 — no state-level licensing, or no data found

States where general contracting is **not regulated at the state level at all**
(regulation, if any, is local) — "no data" here means "no license required,"
not a research gap:

**Colorado, Delaware (in practice), Indiana, Kansas, Kentucky, Missouri, New
Hampshire, New York, Ohio, South Dakota, Wyoming.**

Several of these states *do* license specific trades statewide (electricians almost
everywhere; plumbers/HVAC in some) — see the summary table's Notes column — just
not a general/building contractor category. New York is the highest-value case
here for a national roadmap: no state GC license, but NYC itself publishes its
Home Improvement Contractor license data as open data on the city's own Socrata
portal (`data.cityofnewyork.us`) — a city integration, not a state one, and out of
scope for this survey, but worth flagging given NYC's market size.

No usable public data or tool was identified at all for: none — every state in
this tier at least has *some* local licensing that a human could point SubSub at
county-by-county; that's a much bigger, lower-ROI integration project than the
state-level ones above and is out of scope here.

---

## Commercial aggregators (possible shortcut for Tier 2/3 states)

Two genuine multi-state commercial products surfaced repeatedly in search
results, alongside a long tail of individual-developer scraper listings on Apify
(dozens of single-state "contractor license lookup" scraper actors — these are
not vendors in the compliance sense, just paid scrape jobs, and inherit whatever
ToS risk the underlying state site carries):

- **TradesAPI** (tradesapi.com) — claims all 50 states + DC plus 16 municipal
  boards (Atlanta, Chicago, Dallas, Denver, Detroit, Indianapolis, Las Vegas, LA,
  NYC, Philadelphia, Seattle, etc.), normalized JSON, disciplinary history,
  continuous monitoring + webhooks. **Published pricing:** 50 free verifications
  on signup, paid tiers from $99 (400 verifications) to $999 (5,000), monitoring
  from $99/mo for up to 50 contractors. Pricing as self-published on their site as
  of this research pass — not independently confirmed by a purchase or sales call.
- **CheckLicensed** (checklicensed.com) — claims real-time verification across
  all 50 states with bond and workers'-comp info in structured JSON, plus adjacent
  Secretary-of-State/court-records/lien data. **Published pricing:** from
  $0.25/lookup, free tier with no card required. Same caveat — self-published,
  not independently confirmed.

Both are effectively normalization/scraping layers over the same public state
sources cataloged above (including the same ToS questions for the states with no
official API), not primary-source data providers — the value they'd sell SubSub
is engineering time (one integration instead of 40+), not access to data SubSub
couldn't otherwise reach. Worth a build-vs-buy conversation once the state
priority list is set, but their coverage/accuracy claims should be spot-checked
against a handful of known license numbers before any commercial commitment.

Also noted: **Middesk** (middesk.com) offers broader business-verification/KYB
(entity status, good standing, beneficial ownership, sanctions) across all 50
states and mentions license checks, but no contractor-license-specific product
page or state coverage list was found — likely adjacent, not a direct fit.
**Certemy** (certemy.com) sells primary-source license verification/tracking
software aimed at internal workforce credentialing (e.g., a GC tracking its own
subs' licenses) rather than a data API a SaaS product would call — different
buyer, probably not the right shape for SubSub's use case.

Finally: a number of states' own official lookup tools are white-labeled builds
on the same third-party platform (`*.mylicense.com`, run by NIC/Thomson Reuters —
seen under New Jersey and the Massachusetts Construction Supervisor License) or
on Accela Citizen Access (seen under Michigan). This is a technical pattern, not
a data source in itself — worth knowing because a scraper built for one
`mylicense.com` state may be reusable for others on the same platform.
