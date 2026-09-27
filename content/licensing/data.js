// The facts the licensing pages are generated from.
//
// THIS FILE IS THE PRODUCT. The generator is thirty minutes of work; deciding
// what is true in fifty-one jurisdictions, and standing behind it, is the rest.
// So the schema makes the expensive part explicit rather than letting it be
// skipped: no entry publishes without `source`, `sourceUrl` and `verifiedOn`,
// and the generator counts what it refused.
//
// HOW TO ADD A STATE
//
//   baseline  what the state says about a trade it does not single out. Most
//             states license a handful of trades and are silent on the rest,
//             so this is the answer for most of the twenty-nine.
//   trades    only the ones that DIFFER from the baseline. A row repeating the
//             baseline earns nothing and is skipped as same_as_baseline -- the
//             state hub already said it.
//   cities    where municipalities add rules on top. Names only; each one is a
//             page somebody has to research before it is worth linking.
//
// Every one of those three needs its own source and date. A baseline that was
// checked does not vouch for a trade entry that was not: one verified fact
// standing in for twenty-eight unverified ones is the failure mode that makes
// programmatic content worthless.
//
// WHAT IS SEEDED HERE, AND WHY ONLY THIS MUCH
//
// Six states plus DC are wired to their own open licence data in
// `app/worker/index.js` (SOCRATA_STATES), so the existence of a searchable
// state registry is established by code that runs against it. That is the
// honest seed: registry facts come from there, and the requirement facts below
// are the ones worth a first pass.
//
// Everything else is deliberately absent rather than guessed. Add a state when
// somebody has read the statute, not before -- `npm run licensing` will tell
// you exactly what is still missing.

export const SEARCHABLE_REGISTRY = ["WA", "OR", "CT", "IA", "IL", "TX", "DC"];

export const STATES = [
  {
    code: "TX",
    name: "Texas",
    // Texas licenses specific trades and is silent on construction generally:
    // there is no state general-contractor or roofing licence at all.
    baseline: {
      licence: "none",
      body: null,
      detail: "Texas does not license construction contractors at the state level. "
        + "There is no state general contractor licence and no state registration.",
      source: "Texas Department of Licensing & Regulation — programme list",
      sourceUrl: "https://www.tdlr.texas.gov/LicenseSearch/",
      verifiedOn: "2026-09-12",
    },
    registry: {
      name: "TDLR licence search",
      url: "https://www.tdlr.texas.gov/LicenseSearch/",
      searchable: true,
      note: "Covers the trades TDLR licenses. A roofer will not be in it, because "
        + "there is nothing to be in it for.",
    },
    quirk: {
      title: "Workers' compensation is optional here",
      body: "Texas is the only state where a private employer may opt out of workers' "
        + "compensation entirely. A subcontractor who has opted out is legal and "
        + "uninsured for injury, which is why hiring contractors ask about it directly "
        + "rather than assuming.",
      source: "Texas Department of Insurance, Division of Workers' Compensation",
      sourceUrl: "https://www.tdi.texas.gov/wc/employer/index.html",
      verifiedOn: "2026-09-12",
    },
    trades: {
      electrical: {
        licence: "state",
        body: "Texas Department of Licensing & Regulation",
        detail: "Electricians are licensed by TDLR. Contractors hold an electrical "
          + "contractor licence; individuals hold journeyman or master licences.",
        source: "Texas Occupations Code ch. 1305, administered by TDLR",
        sourceUrl: "https://www.tdlr.texas.gov/electricians/",
        verifiedOn: "2026-09-12",
      },
      plumbing: {
        licence: "state",
        body: "Texas State Board of Plumbing Examiners",
        detail: "Plumbing is licensed separately from TDLR's trades, by the TSBPE.",
        source: "Texas State Board of Plumbing Examiners",
        sourceUrl: "https://tsbpe.texas.gov/",
        verifiedOn: "2026-09-12",
      },
      hvac: {
        licence: "state",
        body: "Texas Department of Licensing & Regulation",
        detail: "Air conditioning and refrigeration contractors are licensed by TDLR, "
          + "in Class A or Class B by equipment size.",
        source: "Texas Occupations Code ch. 1302, administered by TDLR",
        sourceUrl: "https://www.tdlr.texas.gov/acr/acr.htm",
        verifiedOn: "2026-09-12",
      },
    },
    cities: ["Houston", "Dallas", "San Antonio", "Austin", "Fort Worth", "El Paso"],
  },

  {
    code: "WA",
    name: "Washington",
    // The opposite shape from Texas: the state registers EVERY contractor, so
    // the baseline is the strict answer and few trades differ from it.
    baseline: {
      licence: "registration",
      body: "Washington State Department of Labor & Industries",
      detail: "Every construction contractor must register with L&I before bidding or "
        + "advertising, and registration requires a surety bond and general liability "
        + "insurance. There is no exam for general registration.",
      source: "RCW 18.27, administered by Washington State L&I",
      sourceUrl: "https://lni.wa.gov/licensing-permits/contractors/",
      verifiedOn: "2026-09-12",
    },
    registry: {
      name: "L&I Verify a Contractor",
      url: "https://secure.lni.wa.gov/verify/",
      searchable: true,
      note: "Shows registration status, the bond and the insurance behind it. "
        + "SubSub checks this one directly.",
    },
    quirk: {
      title: "Registration is not a competence test",
      body: "General registration in Washington proves a bond and a policy exist, not "
        + "that anybody passed an exam. Electricians and plumbers are separately "
        + "licensed and do sit exams; everyone else is registered only.",
      source: "RCW 18.27, administered by Washington State L&I",
      sourceUrl: "https://lni.wa.gov/licensing-permits/contractors/",
      verifiedOn: "2026-09-12",
    },
    trades: {
      electrical: {
        licence: "state",
        body: "Washington State Department of Labor & Industries",
        detail: "Electrical contractors hold a separate L&I electrical contractor "
          + "licence on top of general registration, and electricians are certified "
          + "individually.",
        source: "RCW 19.28, administered by Washington State L&I",
        sourceUrl: "https://lni.wa.gov/licensing-permits/electrical/",
        verifiedOn: "2026-09-12",
      },
      plumbing: {
        licence: "state",
        body: "Washington State Department of Labor & Industries",
        detail: "Plumbers are certified individually by L&I, in addition to the "
          + "contractor registration the business holds.",
        source: "RCW 18.106, administered by Washington State L&I",
        sourceUrl: "https://lni.wa.gov/licensing-permits/plumbing/",
        verifiedOn: "2026-09-12",
      },
    },
    cities: ["Seattle", "Spokane", "Tacoma", "Vancouver", "Bellevue"],
  },

  {
    code: "OR",
    name: "Oregon",
    baseline: {
      licence: "registration",
      body: "Oregon Construction Contractors Board",
      detail: "Anyone doing construction work for compensation must hold a CCB licence, "
        + "which requires a bond, liability insurance and pre-licence training.",
      source: "ORS 701, administered by the Oregon CCB",
      sourceUrl: "https://www.oregon.gov/ccb/Pages/index.aspx",
      verifiedOn: "2026-09-12",
    },
    registry: {
      name: "CCB licence search",
      url: "https://search.ccb.state.or.us/search/",
      searchable: true,
      note: "SubSub checks this one directly.",
    },
    trades: {
      electrical: {
        licence: "state",
        body: "Oregon Building Codes Division",
        detail: "Electrical contractors are licensed by the Building Codes Division "
          + "rather than the CCB, and hold both.",
        source: "ORS 479, administered by the Oregon Building Codes Division",
        sourceUrl: "https://www.oregon.gov/bcd/licensing/Pages/electrical.aspx",
        verifiedOn: "2026-09-12",
      },
      plumbing: {
        licence: "state",
        body: "Oregon Building Codes Division",
        detail: "Plumbing contractors are licensed by the Building Codes Division as "
          + "well as holding a CCB licence.",
        source: "ORS 447, administered by the Oregon Building Codes Division",
        sourceUrl: "https://www.oregon.gov/bcd/licensing/Pages/plumbing.aspx",
        verifiedOn: "2026-09-12",
      },
    },
    cities: ["Portland", "Eugene", "Salem", "Bend"],
  },
];
