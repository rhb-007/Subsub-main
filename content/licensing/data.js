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
  {
    code: "CA",
    name: "California",
    baseline: {
      licence: "state",
      body: "Contractors State License Board",
      detail: "Any job where labour and materials together come to $500 or more needs a "
        + "CSLB licence. Classifications are A (engineering), B (general building) and "
        + "the C-series specialties; each is a separate exam, and a bond is required.",
      source: "California Business & Professions Code \u00a77000 et seq., administered by CSLB",
      sourceUrl: "https://www.cslb.ca.gov/About_Us/Library/Licensing_Classifications/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "CSLB Check a License",
      url: "https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/CheckLicense.aspx",
      searchable: true,
      note: "Shows the classification, the bond, the workers' compensation status and "
        + "any disciplinary history.",
    },
    quirk: {
      title: "The classification is the licence",
      body: "A B licence does not let somebody re-roof a house on its own. California ties "
        + "scope to the classification letter, so \u201clicensed\u201d is only half the "
        + "question \u2014 the other half is licensed for what.",
      source: "California Business & Professions Code \u00a77000 et seq., administered by CSLB",
      sourceUrl: "https://www.cslb.ca.gov/About_Us/Library/Licensing_Classifications/",
      verifiedOn: "2026-09-27",
    },
    trades: {
      electrical: {
        licence: "state",
        body: "Contractors State License Board",
        detail: "C-10 Electrical. Individual electricians are separately certified by the "
          + "Division of Labor Standards Enforcement.",
        source: "CSLB classification C-10; electrician certification under Labor Code \u00a73099",
        sourceUrl: "https://www.cslb.ca.gov/About_Us/Library/Licensing_Classifications/",
        verifiedOn: "2026-09-27",
      },
      plumbing: {
        licence: "state",
        body: "Contractors State License Board",
        detail: "C-36 Plumbing, a separate classification and a separate exam.",
        source: "CSLB classification C-36",
        sourceUrl: "https://www.cslb.ca.gov/About_Us/Library/Licensing_Classifications/",
        verifiedOn: "2026-09-27",
      },
      roofing: {
        licence: "state",
        body: "Contractors State License Board",
        detail: "C-39 Roofing. California licenses roofing specifically, which most states "
          + "do not.",
        source: "CSLB classification C-39",
        sourceUrl: "https://www.cslb.ca.gov/About_Us/Library/Licensing_Classifications/",
        verifiedOn: "2026-09-27",
      },
      hvac: {
        licence: "state",
        body: "Contractors State License Board",
        detail: "C-20 Warm-Air Heating, Ventilating and Air-Conditioning.",
        source: "CSLB classification C-20",
        sourceUrl: "https://www.cslb.ca.gov/About_Us/Library/Licensing_Classifications/",
        verifiedOn: "2026-09-27",
      },
    },
    cities: ["Los Angeles", "San Francisco", "San Diego"],
  },
  {
    code: "FL",
    name: "Florida",
    baseline: {
      licence: "state",
      body: "Florida Department of Business & Professional Regulation",
      detail: "Construction contractors are licensed by DBPR through the Construction "
        + "Industry Licensing Board, either CERTIFIED (valid statewide) or REGISTERED "
        + "(valid only where the local jurisdiction has licensed them).",
      source: "Florida Statutes ch. 489, administered by DBPR",
      sourceUrl: "https://www2.myfloridalicense.com/construction-industry/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "DBPR licensee search",
      url: "https://www.myfloridalicense.com/wl11.asp",
      searchable: true,
      note: "Says which of the two a licence is, which decides where it is good.",
    },
    quirk: {
      title: "Certified and registered are not the same licence",
      body: "A registered contractor may work only in the jurisdiction that licensed them. "
        + "Asking for the licence number is not enough in Florida \u2014 the type decides "
        + "whether it covers the county your job is in.",
      source: "Florida Statutes ch. 489, administered by DBPR",
      sourceUrl: "https://www2.myfloridalicense.com/construction-industry/",
      verifiedOn: "2026-09-27",
    },
    trades: {
      electrical: {
        licence: "state",
        body: "Florida Electrical Contractors' Licensing Board",
        detail: "Electrical contractors are licensed by their own board, separate from the "
          + "Construction Industry Licensing Board.",
        source: "Florida Statutes ch. 489 part II, administered by DBPR",
        sourceUrl: "https://www2.myfloridalicense.com/electrical-contractors/",
        verifiedOn: "2026-09-27",
      },
      roofing: {
        licence: "state",
        body: "Florida Department of Business & Professional Regulation",
        detail: "Roofing is its own certified or registered category in Florida, which "
          + "matters more here than almost anywhere because of windstorm work.",
        source: "Florida Statutes ch. 489, administered by DBPR",
        sourceUrl: "https://www2.myfloridalicense.com/construction-industry/",
        verifiedOn: "2026-09-27",
      },
    },
    cities: ["Miami-Dade", "Broward", "Hillsborough"],
  },
  {
    code: "AZ",
    name: "Arizona",
    baseline: {
      licence: "state",
      body: "Arizona Registrar of Contractors",
      detail: "Almost all construction work needs an ROC licence. The handyman exemption "
        + "is narrow: one job under $1,000 that needs no building permit.",
      source: "Arizona Revised Statutes title 32 ch. 10, administered by the ROC",
      sourceUrl: "https://roc.az.gov/licensing",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "ROC licence search",
      url: "https://azroc.my.site.com/AZRoc/s/contractor-search",
      searchable: true,
      note: "Shows the classification, the bond and any complaints filed.",
    },
    quirk: {
      title: "Residential and commercial are separate licences",
      body: "Arizona splits its classifications by residential, commercial and dual. A "
        + "licence good for houses does not cover a commercial fit-out.",
      source: "Arizona Revised Statutes title 32 ch. 10, administered by the ROC",
      sourceUrl: "https://roc.az.gov/licensing",
      verifiedOn: "2026-09-27",
    },
    trades: {},
    cities: ["Phoenix", "Tucson"],
  },
  {
    code: "NV",
    name: "Nevada",
    baseline: {
      licence: "state",
      body: "Nevada State Contractors Board",
      detail: "A licence is required for any work of $1,000 or more, or any work needing a "
        + "building permit. Each licence carries a monetary limit on the size of job it "
        + "may take.",
      source: "Nevada Revised Statutes ch. 624, administered by the NSCB",
      sourceUrl: "https://www.nvcontractorsboard.com/licensing/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "NSCB licence search",
      url: "https://www.nvcontractorsboard.com/verify-a-license/",
      searchable: true,
      note: "Shows the classification and, unusually, the monetary limit on the licence.",
    },
    quirk: {
      title: "The licence has a dollar ceiling",
      body: "Nevada caps how large a single job a given licence may take. A contractor can "
        + "be properly licensed and still not be allowed to bid your project.",
      source: "Nevada Revised Statutes ch. 624, administered by the NSCB",
      sourceUrl: "https://www.nvcontractorsboard.com/licensing/",
      verifiedOn: "2026-09-27",
    },
    trades: {},
    cities: ["Las Vegas", "Reno"],
  },
  {
    code: "NC",
    name: "North Carolina",
    baseline: {
      licence: "state",
      body: "North Carolina Licensing Board for General Contractors",
      detail: "A general contractor licence is required for any project costing $40,000 or "
        + "more. Below that threshold the state requires none, though the trades below "
        + "are licensed at any value.",
      source: "North Carolina General Statutes ch. 87 art. 1, administered by NCLBGC",
      sourceUrl: "https://nclbgc.org/licensing/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "NCLBGC licence search",
      url: "https://nclbgc.org/licensee-search/",
      searchable: true,
      note: "General contractors only. The trade boards below keep their own registers.",
    },
    quirk: {
      title: "A threshold, not a blanket rule",
      body: "Under $40,000 there is no state general contractor licence to check. That is "
        + "not a contractor cutting corners \u2014 it is the statute.",
      source: "North Carolina General Statutes ch. 87 art. 1, administered by NCLBGC",
      sourceUrl: "https://nclbgc.org/licensing/",
      verifiedOn: "2026-09-27",
    },
    trades: {
      electrical: {
        licence: "state",
        body: "North Carolina State Board of Examiners of Electrical Contractors",
        detail: "Electrical contractors are licensed by their own board at any job value, "
          + "with no threshold.",
        source: "North Carolina General Statutes ch. 87 art. 4",
        sourceUrl: "https://www.ncbeec.org/",
        verifiedOn: "2026-09-27",
      },
      plumbing: {
        licence: "state",
        body: "North Carolina State Board of Examiners of Plumbing, Heating and Fire Sprinkler Contractors",
        detail: "Plumbing and heating contractors are licensed by their own board at any "
          + "job value.",
        source: "North Carolina General Statutes ch. 87 art. 2",
        sourceUrl: "https://www.nclicensing.org/",
        verifiedOn: "2026-09-27",
      },
    },
    cities: ["Charlotte", "Raleigh"],
  },
  {
    code: "VA",
    name: "Virginia",
    baseline: {
      licence: "state",
      body: "Virginia Department of Professional & Occupational Regulation",
      detail: "Contractors are licensed in three classes by the value of work they may "
        + "take: Class C up to $10,000 per job, Class B up to $120,000, Class A "
        + "unlimited.",
      source: "Code of Virginia title 54.1 ch. 11, administered by DPOR",
      sourceUrl: "https://www.dpor.virginia.gov/Boards/Contractors/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "DPOR licence lookup",
      url: "https://www.dpor.virginia.gov/LicenseLookup/",
      searchable: true,
      note: "Shows the class, which is what decides the size of job they may take.",
    },
    quirk: {
      title: "The class is a spending limit",
      body: "A Class C contractor is properly licensed and may not take a $200,000 job. "
        + "Check the class against the contract value, not just that a licence exists.",
      source: "Code of Virginia title 54.1 ch. 11, administered by DPOR",
      sourceUrl: "https://www.dpor.virginia.gov/Boards/Contractors/",
      verifiedOn: "2026-09-27",
    },
    trades: {},
    cities: ["Virginia Beach", "Richmond", "Arlington"],
  },
  {
    code: "UT",
    name: "Utah",
    baseline: {
      licence: "state",
      body: "Utah Division of Professional Licensing",
      detail: "Construction trades are licensed by DOPL, with general building (B100) and "
        + "residential (R100) as the broad classifications and specialty licences below "
        + "them.",
      source: "Utah Code title 58 ch. 55, administered by DOPL",
      sourceUrl: "https://dopl.utah.gov/contractor/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "DOPL licence search",
      url: "https://secure.utah.gov/llv/search/index.html",
      searchable: true,
      note: "Shows the classification and status.",
    },
    trades: {},
    cities: ["Salt Lake City"],
  },
  {
    code: "LA",
    name: "Louisiana",
    baseline: {
      licence: "state",
      body: "Louisiana State Licensing Board for Contractors",
      detail: "A commercial licence is required at $50,000 or more, and a residential "
        + "licence at $75,000 or more. Below those, the state requires none.",
      source: "Louisiana Revised Statutes title 37 ch. 24, administered by LSLBC",
      sourceUrl: "https://lslbc.louisiana.gov/contractors/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "LSLBC licence search",
      url: "https://lslbc.louisiana.gov/contractor-search/",
      searchable: true,
      note: "Commercial and residential are separate licences with separate thresholds.",
    },
    quirk: {
      title: "Two thresholds, not one",
      body: "Commercial work crosses the line at $50,000 and residential at $75,000, so "
        + "the same contractor can need a licence for one job and not the next.",
      source: "Louisiana Revised Statutes title 37 ch. 24, administered by LSLBC",
      sourceUrl: "https://lslbc.louisiana.gov/contractors/",
      verifiedOn: "2026-09-27",
    },
    trades: {},
    cities: ["New Orleans", "Baton Rouge"],
  },
];
