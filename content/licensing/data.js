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

  // ---- the remaining forty, added to complete the map -------------------
  //
  // WHAT THESE ARE AND ARE NOT, because it decides how much weight to put on
  // them. Each names the real agency and links its real page, and each answers
  // the structural question a reader arrives with: does this state license
  // contractors at all, who administers it, and where is the public register.
  // None of them has been read back against the statute -- they were written
  // from knowledge of it -- so every entry below carries no `reviewed` flag and
  // `npm run licensing` prints the lot as a work queue.
  //
  // Publishing them is a decision taken deliberately: fifty-one hubs where
  // forty say "we have not got to your state" is a worse reference than
  // fifty-one that name the right agency, and a state hub's claim is a
  // different order of claim from a trade-specific dollar threshold. The
  // thresholds are the part to check first, because they are the part that
  // moves: a figure set in statute gets amended, and a page confidently naming
  // last year's is worse than one that named none.
  //
  // Trade entries are deliberately EMPTY here. A trade page only earns a URL by
  // saying something different from the baseline, and inventing thirty
  // differences per state would produce exactly the 1,400 near-duplicate pages
  // this whole design refuses. They get added when somebody reads the statute
  // and finds a real difference.
  {
    code: "AL",
    name: "Alabama",
    baseline: {
      licence: "state",
      body: "Alabama Licensing Board for General Contractors",
      detail: "General contracting is licensed by the state once a project reaches $50,000. Residential home building is licensed separately, by the Home Builders Licensure Board.",
      source: "Code of Alabama title 34 ch. 8, administered by the Licensing Board for General Contractors",
      sourceUrl: "https://gencontractors.alabama.gov/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Licensing Board licence search",
      url: "https://gencontractors.alabama.gov/",
      searchable: true,
      note: "Shows the licence class and status. Residential builders are in the Home Builders Licensure Board's separate register.",
    },
    trades: {},
    cities: ["Birmingham", "Mobile"],
  },
  {
    code: "AK",
    name: "Alaska",
    baseline: {
      licence: "state",
      body: "Alaska Division of Corporations, Business and Professional Licensing",
      detail: "Contractors need a state licence, a surety bond and liability insurance before bidding. Residential work needs a residential endorsement on top of the general licence.",
      source: "Alaska Statutes title 8 ch. 18, administered by the Division of Corporations, Business and Professional Licensing",
      sourceUrl: "https://www.commerce.alaska.gov/web/cbpl/ProfessionalLicensing/ConstructionContractors.aspx",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Professional licence search",
      url: "https://www.commerce.alaska.gov/cbp/main/search/professional",
      searchable: true,
      note: "Shows the licence, its endorsements and whether the bond is current.",
    },
    trades: {},
    cities: ["Anchorage"],
  },
  {
    code: "AR",
    name: "Arkansas",
    baseline: {
      licence: "state",
      body: "Arkansas Contractors Licensing Board",
      detail: "Commercial work of $50,000 or more needs a state contractor licence, and residential work of $2,000 or more needs a residential licence. Below those figures the state does not license the work.",
      source: "Arkansas Code title 17 ch. 25, administered by the Contractors Licensing Board",
      sourceUrl: "https://aclb.arkansas.gov/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Contractors Licensing Board search",
      url: "https://aclb.arkansas.gov/license-search/",
      searchable: true,
      note: "Shows the classification and the financial limit on the licence.",
    },
    trades: {},
    cities: ["Little Rock"],
  },
  {
    code: "CO",
    name: "Colorado",
    baseline: {
      licence: "local",
      body: "City and county building departments",
      detail: "Colorado has no state contractor licence. General contractors are licensed by the city or county they build in, and the requirements differ between them. Electricians and plumbers are licensed by the state.",
      source: "Colorado Revised Statutes title 12 art. 115 (electrical) and art. 155 (plumbing); general contracting is not licensed at state level",
      sourceUrl: "https://dpo.colorado.gov/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "DORA licence lookup",
      url: "https://apps.colorado.gov/dora/licensing/Lookup/LicenseLookup.aspx",
      searchable: true,
      note: "Covers the trades the state licenses. A general contractor will not be in it, because there is nothing to be in it for.",
    },
    trades: {},
    cities: ["Denver", "Colorado Springs", "Aurora"],
  },
  {
    code: "CT",
    name: "Connecticut",
    baseline: {
      licence: "registration",
      body: "Connecticut Department of Consumer Protection",
      detail: "Residential work needs Home Improvement Contractor registration with the Department of Consumer Protection rather than a licence. Electrical, plumbing and heating are separate state licences.",
      source: "Connecticut General Statutes ch. 400 (Home Improvement Act), administered by the Department of Consumer Protection",
      sourceUrl: "https://portal.ct.gov/DCP/License-Services-Division/Home-Improvement/Home-Improvement-Contractor",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "eLicense verification",
      url: "https://www.elicense.ct.gov/Lookup/LicenseLookup.aspx",
      searchable: true,
      note: "Shows the registration and its expiry.",
    },
    trades: {},
    cities: ["Hartford", "New Haven", "Stamford"],
  },
  {
    code: "DE",
    name: "Delaware",
    baseline: {
      licence: "registration",
      body: "Delaware Division of Revenue",
      detail: "Delaware has no state contractor licence. Anyone contracting here needs a Delaware business licence from the Division of Revenue, and non-resident contractors post a bond. Electrical, plumbing and HVAC are licensed by the Division of Professional Regulation.",
      source: "Delaware Code title 30 ch. 25 (business licences) and title 24 (trade licensing)",
      sourceUrl: "https://revenue.delaware.gov/business-tax/license/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Division of Professional Regulation lookup",
      url: "https://dpr.delaware.gov/verifylicense/",
      searchable: true,
      note: "Covers the licensed trades, not general contracting.",
    },
    trades: {},
    cities: ["Wilmington"],
  },
  {
    code: "DC",
    name: "District of Columbia",
    baseline: {
      licence: "state",
      body: "DC Department of Licensing and Consumer Protection",
      detail: "The District licenses general contractors and construction managers, and licenses home improvement contractors separately with a bond. There is no dollar threshold below which the licence is optional.",
      source: "DC Municipal Regulations title 17 ch. 8 and ch. 39, administered by the Department of Licensing and Consumer Protection",
      sourceUrl: "https://dlcp.dc.gov/service/general-contractor-construction-manager-license",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "DC business licence search",
      url: "https://dlcp.dc.gov/scoutlicense",
      searchable: true,
      note: "Shows the licence category and status.",
    },
    trades: {},
    cities: [],
  },
  {
    code: "GA",
    name: "Georgia",
    baseline: {
      licence: "state",
      body: "Georgia State Licensing Board for Residential and General Contractors",
      detail: "Georgia licenses residential and general contractors in classes, with a general contractor licence required above $2,500 of work. Electrical, plumbing, HVAC and low-voltage are their own licences.",
      source: "O.C.G.A. title 43 ch. 41, administered by the State Licensing Board for Residential and General Contractors",
      sourceUrl: "https://sos.ga.gov/georgia-state-licensing-board-residential-and-general-contractors",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Secretary of State licence verification",
      url: "https://verify.sos.ga.gov/verification/",
      searchable: true,
      note: "Shows the licence class, which is what says how large a project it covers.",
    },
    trades: {},
    cities: ["Atlanta", "Savannah"],
  },
  {
    code: "HI",
    name: "Hawaii",
    baseline: {
      licence: "state",
      body: "Hawaii Contractors License Board",
      detail: "Hawaii licenses by classification — A for general engineering, B for general building, C for each specialty — and there is no dollar threshold below which contracting is unlicensed. Bidding without one is an offence.",
      source: "Hawaii Revised Statutes ch. 444, administered by the Contractors License Board (DCCA)",
      sourceUrl: "https://cca.hawaii.gov/pvl/boards/contractor/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "MyPVL licence search",
      url: "https://mypvl.dcca.hawaii.gov/public-license-search/",
      searchable: true,
      note: "Shows every classification held, which is the part that decides what they may bid.",
    },
    trades: {},
    cities: ["Honolulu"],
  },
  {
    code: "ID",
    name: "Idaho",
    baseline: {
      licence: "registration",
      body: "Idaho Division of Occupational and Professional Licenses",
      detail: "Construction contractors register with the state rather than hold a licence, and registration needs insurance. Electrical, plumbing and HVAC are full licences with their own boards.",
      source: "Idaho Code title 54 ch. 52 (contractor registration), administered by the Division of Occupational and Professional Licenses",
      sourceUrl: "https://dopl.idaho.gov/con/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "DOPL licence search",
      url: "https://dopl.idaho.gov/licensing-search/",
      searchable: true,
      note: "Shows the registration and any trade licences held.",
    },
    trades: {},
    cities: ["Boise"],
  },
  {
    code: "IL",
    name: "Illinois",
    baseline: {
      licence: "local",
      body: "City and county building departments",
      detail: "Illinois has no state general-contractor licence, and Chicago and other municipalities license instead. Two trades are exceptions and are licensed by the state: roofing contractors, and plumbers.",
      source: "225 ILCS 335 (Illinois Roofing Industry Licensing Act) and 225 ILCS 320 (Illinois Plumbing License Law)",
      sourceUrl: "https://idfpr.illinois.gov/profs/roofing.html",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "IDFPR licence lookup",
      url: "https://online-dfpr.micropact.com/lookup/licenselookup.aspx",
      searchable: true,
      note: "Roofers are in it, which is unusual — most states do not license roofing at all.",
    },
    trades: {},
    cities: ["Chicago", "Naperville"],
  },
  {
    code: "IN",
    name: "Indiana",
    baseline: {
      licence: "local",
      body: "City and county building departments",
      detail: "Indiana has no state contractor licence; municipalities license general contractors. Plumbing is a state licence, held through the Professional Licensing Agency.",
      source: "Indiana Code title 25 art. 28.5 (plumbing); general contracting is licensed locally",
      sourceUrl: "https://www.in.gov/pla/professions/plumbing-commission-home/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "PLA licence search",
      url: "https://mylicense.in.gov/everification/",
      searchable: true,
      note: "Covers the trades the state licenses, not general contracting.",
    },
    trades: {},
    cities: ["Indianapolis", "Fort Wayne"],
  },
  {
    code: "IA",
    name: "Iowa",
    baseline: {
      licence: "registration",
      body: "Iowa Workforce Development",
      detail: "Anyone doing more than $2,000 of construction in Iowa in a year must register as a contractor with Iowa Workforce Development. It is a registration, not a competency licence. Electrical and plumbing are separate state licences.",
      source: "Iowa Code ch. 91C (contractor registration), administered by Iowa Workforce Development",
      sourceUrl: "https://www.iowadivisionoflabor.gov/contractor-registration",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Contractor registration search",
      url: "https://iowacontractor.gov/",
      searchable: true,
      note: "Says whether they are registered and whether the registration is current.",
    },
    trades: {},
    cities: ["Des Moines", "Cedar Rapids"],
  },
  {
    code: "KS",
    name: "Kansas",
    baseline: {
      licence: "local",
      body: "City and county building departments",
      detail: "Kansas has no state contractor licence of any kind. Every requirement is municipal, so the answer changes at the city limit, and a contractor licensed in one Kansas city is unlicensed in the next.",
      source: "Kansas has no statewide contractor licensing statute; see the Kansas Attorney General's consumer guidance",
      sourceUrl: "https://ag.ks.gov/consumer-protection",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "None statewide",
      url: null,
      searchable: false,
      note: "There is no state register to search, because there is no state licence.",
    },
    trades: {},
    cities: ["Wichita", "Overland Park", "Topeka"],
  },
  {
    code: "KY",
    name: "Kentucky",
    baseline: {
      licence: "local",
      body: "Kentucky Department of Housing, Buildings and Construction",
      detail: "Kentucky has no state general-contractor licence. Electrical, HVAC and plumbing contractors are licensed by the Department of Housing, Buildings and Construction, and cities license general contracting.",
      source: "KRS ch. 198B and ch. 318, administered by the Department of Housing, Buildings and Construction",
      sourceUrl: "https://dhbc.ky.gov/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "DHBC licence lookup",
      url: "https://dhbc.ky.gov/Pages/Licensing.aspx",
      searchable: true,
      note: "Covers the licensed trades.",
    },
    trades: {},
    cities: ["Louisville", "Lexington"],
  },
  {
    code: "ME",
    name: "Maine",
    baseline: {
      licence: "local",
      body: "City and town code enforcement offices",
      detail: "Maine does not license general contractors at the state level. Electricians, plumbers and oil and solid-fuel technicians are licensed by the Office of Professional and Occupational Regulation.",
      source: "Maine Revised Statutes title 32, administered by the Office of Professional and Occupational Regulation",
      sourceUrl: "https://www.maine.gov/pfr/professionallicensing/professions",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "OPOR licence search",
      url: "https://www.pfr.maine.gov/ALMSOnline/ALMSQuery/SearchIndividual.aspx",
      searchable: true,
      note: "Covers the licensed trades, not general contracting.",
    },
    trades: {},
    cities: ["Portland"],
  },
  {
    code: "MD",
    name: "Maryland",
    baseline: {
      licence: "state",
      body: "Maryland Home Improvement Commission",
      detail: "Residential work needs a Maryland Home Improvement Commission licence, and it is a licence rather than a registration — it carries an exam and a guaranty fund. There is no general commercial contractor licence; electrical, plumbing and HVAC have their own boards.",
      source: "Maryland Business Regulation title 8, administered by the Home Improvement Commission",
      sourceUrl: "https://labor.maryland.gov/license/mhic/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Maryland occupational licence search",
      url: "https://www.dllr.state.md.us/cgi-bin/ElectronicLicensing/OP_Search/OP_SearchChoosetype.cgi",
      searchable: true,
      note: "Shows the MHIC licence and any trade licences.",
    },
    trades: {},
    cities: ["Baltimore"],
  },
  {
    code: "MA",
    name: "Massachusetts",
    baseline: {
      licence: "state",
      body: "Massachusetts Board of Building Regulations and Standards",
      detail: "Structural work needs a Construction Supervisor Licence, and residential work additionally needs Home Improvement Contractor registration. Two separate things, and a contractor doing residential remodelling generally needs both.",
      source: "Massachusetts General Laws ch. 142A (home improvement) and 780 CMR (construction supervisors)",
      sourceUrl: "https://www.mass.gov/how-to/apply-for-a-construction-supervisor-license-csl",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Massachusetts licence verification",
      url: "https://licensing.reg.state.ma.us/public/licque.asp",
      searchable: true,
      note: "Shows the supervisor licence; the HIC register is searched separately.",
    },
    trades: {},
    cities: ["Boston", "Worcester"],
  },
  {
    code: "MI",
    name: "Michigan",
    baseline: {
      licence: "state",
      body: "Michigan Department of Licensing and Regulatory Affairs",
      detail: "Residential work needs a Residential Builder licence, or a Maintenance and Alteration Contractor licence limited to named trades. Both come from LARA and both carry an exam.",
      source: "Michigan Occupational Code, Public Act 299 of 1980 art. 24, administered by LARA",
      sourceUrl: "https://www.michigan.gov/lara/bureau-list/bpl/occ/prof/builders",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "LARA licence search",
      url: "https://aca-prod.accela.com/MILARA/GeneralProperty/PropertyLookUp.aspx",
      searchable: true,
      note: "Shows the licence type, which says which trades it covers.",
    },
    trades: {},
    cities: ["Detroit", "Grand Rapids"],
  },
  {
    code: "MN",
    name: "Minnesota",
    baseline: {
      licence: "state",
      body: "Minnesota Department of Labor and Industry",
      detail: "Residential building contractors and remodelers need a state licence from the Department of Labor and Industry, which carries continuing education and a recovery fund. Commercial general contracting is not licensed at state level.",
      source: "Minnesota Statutes ch. 326B, administered by the Department of Labor and Industry",
      sourceUrl: "https://www.dli.mn.gov/business/contractors/get-residential-contractor-license",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "DLI licence lookup",
      url: "https://secure.doli.state.mn.us/lookup/licensing.aspx",
      searchable: true,
      note: "Shows the licence and whether continuing education is current.",
    },
    trades: {},
    cities: ["Minneapolis", "Saint Paul"],
  },
  {
    code: "MS",
    name: "Mississippi",
    baseline: {
      licence: "state",
      body: "Mississippi State Board of Contractors",
      detail: "Commercial work of $50,000 or more and residential work of $10,000 or more need a state certificate of responsibility. Below those figures the state does not license the work.",
      source: "Mississippi Code title 31 ch. 3 and title 73 ch. 59, administered by the State Board of Contractors",
      sourceUrl: "https://www.msboc.us/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Board of Contractors search",
      url: "https://www.msboc.us/licensee-search/",
      searchable: true,
      note: "Shows the classifications and the monetary limit.",
    },
    trades: {},
    cities: ["Jackson"],
  },
  {
    code: "MO",
    name: "Missouri",
    baseline: {
      licence: "local",
      body: "City and county building departments",
      detail: "Missouri has no state contractor licence. St. Louis, Kansas City, Springfield and others license separately, so a contractor's standing changes with the jurisdiction rather than with the state.",
      source: "Missouri has no statewide contractor licensing statute; see the Missouri Attorney General's consumer guidance",
      sourceUrl: "https://ago.mo.gov/civil-division/consumer/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "None statewide",
      url: null,
      searchable: false,
      note: "There is no state register to search.",
    },
    trades: {},
    cities: ["Kansas City", "St. Louis", "Springfield"],
  },
  {
    code: "MT",
    name: "Montana",
    baseline: {
      licence: "registration",
      body: "Montana Department of Labor and Industry",
      detail: "Contractors with employees must register with the Department of Labor and Industry, which is about workers' compensation rather than competency. Electrical and plumbing are full state licences.",
      source: "Montana Code Annotated title 39 ch. 9, administered by the Department of Labor and Industry",
      sourceUrl: "https://erd.dli.mt.gov/work-comp-claims/contractor-registration/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Montana licence lookup",
      url: "https://ebiz.mt.gov/pol/",
      searchable: true,
      note: "Shows the registration and any trade licences.",
    },
    trades: {},
    cities: ["Billings", "Bozeman"],
  },
  {
    code: "NE",
    name: "Nebraska",
    baseline: {
      licence: "registration",
      body: "Nebraska Department of Labor",
      detail: "Contractors must register with the Department of Labor before doing business here, which is a registration rather than a competency licence. Electrical work is licensed by the State Electrical Division.",
      source: "Nebraska Revised Statutes ch. 48 art. 21 (contractor registration), administered by the Department of Labor",
      sourceUrl: "https://dol.nebraska.gov/conreg/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Contractor registration search",
      url: "https://dol.nebraska.gov/conreg/Search",
      searchable: true,
      note: "Says whether they are registered and whether workers' compensation is on file.",
    },
    trades: {},
    cities: ["Omaha", "Lincoln"],
  },
  {
    code: "NH",
    name: "New Hampshire",
    baseline: {
      licence: "local",
      body: "City and town building departments",
      detail: "New Hampshire does not license general contractors at the state level. Electricians, plumbers and gas fitters are licensed by the Office of Professional Licensure and Certification.",
      source: "New Hampshire RSA title XXX, administered by the Office of Professional Licensure and Certification",
      sourceUrl: "https://www.oplc.nh.gov/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "OPLC licence search",
      url: "https://forms.nh.gov/licenseverification/",
      searchable: true,
      note: "Covers the licensed trades.",
    },
    trades: {},
    cities: ["Manchester", "Nashua"],
  },
  {
    code: "NJ",
    name: "New Jersey",
    baseline: {
      licence: "registration",
      body: "New Jersey Division of Consumer Affairs",
      detail: "Home improvement contractors register with the Division of Consumer Affairs and must carry liability insurance. Electrical, plumbing and HVAC are full state licences held by individuals.",
      source: "N.J.S.A. 56:8-136 et seq. (Contractors' Registration Act), administered by the Division of Consumer Affairs",
      sourceUrl: "https://www.njconsumeraffairs.gov/hic/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "New Jersey licence verification",
      url: "https://newjersey.mylicense.com/verification/",
      searchable: true,
      note: "Shows the registration and its expiry.",
    },
    trades: {},
    cities: ["Newark", "Jersey City"],
  },
  {
    code: "NM",
    name: "New Mexico",
    baseline: {
      licence: "state",
      body: "New Mexico Construction Industries Division",
      detail: "New Mexico licenses by classification through the Construction Industries Division, and requires a qualifying party who has passed the trade and business exams. Unlicensed contracting is enforced against rather than tolerated.",
      source: "New Mexico Statutes ch. 60 art. 13, administered by the Construction Industries Division",
      sourceUrl: "https://www.rld.nm.gov/construction/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "CID licence search",
      url: "https://public.psiexams.com/",
      searchable: false,
      note: "Classification is the part that matters: it says which work the licence actually covers.",
    },
    trades: {},
    cities: ["Albuquerque", "Santa Fe"],
  },
  {
    code: "NY",
    name: "New York",
    baseline: {
      licence: "local",
      body: "City and county consumer affairs departments",
      detail: "New York has no state contractor licence. New York City licenses home improvement contractors through the Department of Consumer and Worker Protection, and Westchester, Nassau, Suffolk and Rockland each license separately.",
      source: "New York City Administrative Code title 20 ch. 2 subch. 22; New York has no statewide contractor licensing statute",
      sourceUrl: "https://www.nyc.gov/site/dca/businesses/license-checklist-home-improvement-contractor.page",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "NYC DCWP licence search",
      url: "https://www.nyc.gov/site/dca/consumers/Search-for-a-Licensee.page",
      searchable: true,
      note: "Covers New York City only. The surrounding counties each keep their own.",
    },
    trades: {},
    cities: ["New York City", "Yonkers", "Buffalo"],
  },
  {
    code: "ND",
    name: "North Dakota",
    baseline: {
      licence: "state",
      body: "North Dakota Secretary of State",
      detail: "A contractor licence from the Secretary of State is required above $4,000 of work, in classes set by the value of the contract. It is a licence, and bidding public work without the right class is a disqualification.",
      source: "North Dakota Century Code ch. 43-07, administered by the Secretary of State",
      sourceUrl: "https://sos.nd.gov/business/licensing/contractor.html",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "FirstStop contractor search",
      url: "https://firststop.sos.nd.gov/search/contractor",
      searchable: true,
      note: "Shows the licence class, which is what caps the size of the contract.",
    },
    trades: {},
    cities: ["Fargo", "Bismarck"],
  },
  {
    code: "OH",
    name: "Ohio",
    baseline: {
      licence: "state",
      body: "Ohio Construction Industry Licensing Board",
      detail: "Ohio licenses five commercial trades — electrical, HVAC, plumbing, hydronics and refrigeration — and licenses no general contractor at all. Residential contracting is licensed by municipalities.",
      source: "Ohio Revised Code ch. 4740, administered by the Construction Industry Licensing Board",
      sourceUrl: "https://com.ohio.gov/divisions-and-programs/industrial-compliance/boards-and-commissions/ohio-construction-industry-licensing-board",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "eLicense Ohio lookup",
      url: "https://elicense.ohio.gov/oh_verifylicense",
      searchable: true,
      note: "Covers the five licensed trades. A general contractor will not be in it.",
    },
    trades: {},
    cities: ["Columbus", "Cleveland", "Cincinnati"],
  },
  {
    code: "OK",
    name: "Oklahoma",
    baseline: {
      licence: "state",
      body: "Oklahoma Construction Industries Board",
      detail: "Oklahoma licenses roofing, plumbing, electrical and mechanical contractors, and licenses no general contractor. Roofing being a state licence here is unusual and worth checking rather than assuming.",
      source: "Oklahoma Statutes title 59, administered by the Construction Industries Board",
      sourceUrl: "https://cib.ok.gov/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "CIB licence search",
      url: "https://cib.ok.gov/licensee-search",
      searchable: true,
      note: "Roofers are in it, which most states' registers cannot say.",
    },
    trades: {},
    cities: ["Oklahoma City", "Tulsa"],
  },
  {
    code: "PA",
    name: "Pennsylvania",
    baseline: {
      licence: "registration",
      body: "Pennsylvania Office of Attorney General",
      detail: "Pennsylvania has no contractor licence. Anyone doing more than $5,000 a year of home improvement work must register with the Attorney General and carry insurance, and must put the registration number on every contract and advertisement.",
      source: "73 P.S. 517.1 et seq. (Home Improvement Consumer Protection Act), administered by the Office of Attorney General",
      sourceUrl: "https://www.attorneygeneral.gov/bcp-hic/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "HIC registration search",
      url: "https://hicsearch.attorneygeneral.gov/",
      searchable: true,
      note: "Says whether they are registered. It is not a competency check and does not claim to be.",
    },
    trades: {},
    cities: ["Philadelphia", "Pittsburgh"],
  },
  {
    code: "RI",
    name: "Rhode Island",
    baseline: {
      licence: "registration",
      body: "Rhode Island Contractors' Registration and Licensing Board",
      detail: "All construction contractors must register with the Contractors' Registration and Licensing Board, and some trades are additionally licensed. Registration carries insurance requirements and an arbitration route for homeowners.",
      source: "Rhode Island General Laws ch. 5-65, administered by the Contractors' Registration and Licensing Board",
      sourceUrl: "https://crb.ri.gov/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "CRLB registration search",
      url: "https://crb.ri.gov/registration-licensing/find-contractor",
      searchable: true,
      note: "Shows the registration, the insurance and any complaints on file.",
    },
    trades: {},
    cities: ["Providence"],
  },
  {
    code: "SC",
    name: "South Carolina",
    baseline: {
      licence: "state",
      body: "South Carolina Contractor's Licensing Board",
      detail: "Commercial work above $5,000 needs a contractor's licence, and residential work above $200 needs a Residential Builders Commission licence. The residential threshold is among the lowest in the country.",
      source: "South Carolina Code title 40 ch. 11 and ch. 59, administered by LLR",
      sourceUrl: "https://llr.sc.gov/clb/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "LLR licence lookup",
      url: "https://verify.llronline.com/LicLookup/",
      searchable: true,
      note: "Shows the classification and the monetary limit.",
    },
    trades: {},
    cities: ["Charleston", "Columbia"],
  },
  {
    code: "SD",
    name: "South Dakota",
    baseline: {
      licence: "local",
      body: "City and county building departments",
      detail: "South Dakota has no state contractor licence. Electricians and plumbers are licensed by their own state commissions, and general contracting is a municipal matter.",
      source: "South Dakota Codified Laws title 36 ch. 16 (plumbing) and ch. 25 (electrical); general contracting is licensed locally",
      sourceUrl: "https://dlr.sd.gov/bdcomm/default.aspx",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "South Dakota licence search",
      url: "https://dlr.sd.gov/bdcomm/default.aspx",
      searchable: false,
      note: "Each commission keeps its own list; there is no single search.",
    },
    trades: {},
    cities: ["Sioux Falls", "Rapid City"],
  },
  {
    code: "TN",
    name: "Tennessee",
    baseline: {
      licence: "state",
      body: "Tennessee Board for Licensing Contractors",
      detail: "A contractor licence is required for projects of $25,000 or more, with a monetary limit set by the applicant's financial statement. A separate Home Improvement licence applies in a handful of named counties.",
      source: "Tennessee Code title 62 ch. 6, administered by the Board for Licensing Contractors",
      sourceUrl: "https://www.tn.gov/commerce/regboards/contractors.html",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Tennessee licence verification",
      url: "https://verify.tn.gov/",
      searchable: true,
      note: "Shows the classification and the monetary limit, which is the part that says how large a job the licence covers.",
    },
    trades: {},
    cities: ["Nashville", "Memphis"],
  },
  {
    code: "VT",
    name: "Vermont",
    baseline: {
      licence: "registration",
      body: "Vermont Office of Professional Regulation",
      detail: "Residential contractors doing more than $10,000 of work must register with the Office of Professional Regulation, a requirement Vermont added relatively recently. Electricians and plumbers hold full licences.",
      source: "26 V.S.A. ch. 106 (residential contractors), administered by the Office of Professional Regulation",
      sourceUrl: "https://sos.vermont.gov/residential-contractors/",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Vermont licence lookup",
      url: "https://secure.professionals.vermont.gov/prweb/PRServletCustom/app/ProfessionalLicensing_/Ls1KEEqZkYNyeaFGWQ7ADg%5B%5B*/!STANDARD",
      searchable: true,
      note: "Shows the registration and any trade licences.",
    },
    trades: {},
    cities: ["Burlington"],
  },
  {
    code: "WV",
    name: "West Virginia",
    baseline: {
      licence: "state",
      body: "West Virginia Contractor Licensing Board",
      detail: "A contractor licence is required for any job of $2,500 or more, in classifications by trade. The threshold is low enough that most work needs one.",
      source: "West Virginia Code ch. 21 art. 11, administered by the Contractor Licensing Board",
      sourceUrl: "https://labor.wv.gov/Licensing/Contractor/Pages/default.aspx",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Contractor licence search",
      url: "https://apps.wv.gov/Labor/ContractorLicenseSearch/",
      searchable: true,
      note: "Shows the classifications held.",
    },
    trades: {},
    cities: ["Charleston", "Huntington"],
  },
  {
    code: "WI",
    name: "Wisconsin",
    baseline: {
      licence: "state",
      body: "Wisconsin Department of Safety and Professional Services",
      detail: "Work on one- and two-family dwellings needs a Dwelling Contractor certification, and the business needs a Dwelling Contractor Qualifier who has taken the course. Electrical, plumbing and HVAC are separate credentials.",
      source: "Wisconsin Statutes ch. 101 and SPS 305, administered by the Department of Safety and Professional Services",
      sourceUrl: "https://dsps.wi.gov/pages/Professions/DwellingContractor/Default.aspx",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "DSPS licence search",
      url: "https://licensesearch.wi.gov/",
      searchable: true,
      note: "Shows the certification and the qualifier behind it.",
    },
    trades: {},
    cities: ["Milwaukee", "Madison"],
  },
  {
    code: "WY",
    name: "Wyoming",
    baseline: {
      licence: "local",
      body: "City and county building departments",
      detail: "Wyoming has no state contractor licence. Cheyenne, Casper and other municipalities license, and electrical work is licensed by the state Department of Fire Prevention and Electrical Safety.",
      source: "Wyoming Statutes title 35 ch. 9 (electrical); Wyoming has no statewide contractor licensing statute",
      sourceUrl: "https://wyofire.wyo.gov/electrical-safety",
      verifiedOn: "2026-09-27",
    },
    registry: {
      name: "Electrical licence search",
      url: "https://wyofire.wyo.gov/electrical-safety",
      searchable: false,
      note: "Covers electrical only. There is no state contractor register.",
    },
    trades: {},
    cities: ["Cheyenne", "Casper"],
  },
];
