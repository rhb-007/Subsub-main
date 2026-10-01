# SubSub

## What this is, and what it is not

SubSub is for **running the subcontractors you already have**, and for
**adding the ones you meet in person**. A general contractor gets a roster
they control, documents that stay current, availability they can see, and a
QR code they hand to somebody on a job site.

**It is not a discovery engine, a directory, or a marketplace.** Nobody comes
here to browse for a roofer. There is no "find contractors near me", no
ranked list of companies a stranger can page through, and no feature that
answers "who is on SubSub?".

This is a product decision, not a missing feature. Read it as a standing
constraint on everything built here.

## The rule that follows from it

**No account may mine another account's subcontractors.**

Contractor names, contacts, phone numbers, addresses, documents, crews,
availability, rates and job history belong to the contractor and to the
accounts they have chosen to work with. Nothing built here may let anybody
else accumulate them.

Concretely, when adding or changing anything that reads the `companies`
table or anything hanging off it:

- **Scope to the caller's own engagements by default.** A query that reads
  company data and does not join `engagements` on the caller's `account_id`
  needs a specific reason, written down next to it.

- **Whole values only, never prefixes.** The connect lookup matches a
  complete email, a complete mobile or a complete licence number. No `LIKE`,
  no partial match, no "starts with", no fuzzy search across the table.
  A prefix search is a directory somebody can walk one letter at a time.

- **Answer the question, do not describe the company.** A lookup exists so
  you do not invite somebody who already has an account. It returns which
  company it is, so you ask the right one to connect — not their staff's
  names, not their licence number, not anything a caller with no
  relationship to them has a reason to hold.

- **Name matching is local only.** Matching a typed company name against the
  account's *own* contractors and its *own* outstanding invites is fine:
  that is its own data. Sending a name to the server to be matched across
  every company is not, and there is no endpoint that does it.

- **Rate-limit every lookup, per account.** Even whole-value matching is a
  confirm-and-enrich oracle for somebody holding a list of addresses.

- **A person's photograph is not a company logo.** Logos are public because
  they render on a login page. Avatars, documents and anything else about a
  person sit behind auth and behind a shared-account check.

- **Staff routes are staff routes.** `/api/platform/*` may read across every
  account because SubSub's own console needs to. It is gated by
  `requireStaff`. Never reach for one of those queries to serve a customer
  screen.

If a request seems to want a directory — "search all contractors", "show
similar companies nearby", "suggest subs for this trade" — stop and say so
before building it. It may still be the right thing to build, but it changes
what this product is and needs a decision, not an implementation.

## Decisions already made

These were settled deliberately. Changing one is a product decision, not a
refactor.

- **No state is hardcoded.** `app/shared/states.js` is the one list — fifty
  states and DC — imported by the Worker and the browser, with a hand copy in
  `get-started.html` (no build step there) that a test keeps in step.
  Territories are absent on purpose. No form defaults to a state and no
  placeholder names one: a pre-filled wrong answer is worse than an empty
  box.

- **Creating a job is what makes an account the hiring side, and it is the one
  thing a subcontractor account cannot do.** The two directions are not the same
  act: sending your compliance pack to somebody says *you work for them*;
  creating a job says *somebody works for you*. So that is the boundary, and it
  is the only one — a subcontractor account is otherwise a general contractor's,
  because `ROLES.admin` reaches Contractors, Jobs and Calendar whatever the
  kind.

  `HIRING_KINDS` in the Worker refuses `POST /api/jobs` with
  `not_a_hiring_account`, and `ACCOUNT_KINDS[kind].hires !== false` is the
  browser's copy. **Enforced on the server, not only by hiding the button**: a
  gate that lives in the browser is a suggestion. The refusal names the kind so
  the screen can offer the way out rather than just saying no.

  **So the screen asks a question, and is not an upgrade prompt in any part —
  including the parts that are not words.** *Do you want to hire subcontractors
  too?*, with what saying yes lets them do, and a yes/no. Not "you need a
  general contractor account", which announces a requirement to somebody who
  may simply not hire anybody.

  The first version said nothing about money and still read as an upsell,
  because it wore the upgrade gate's chrome: `up-badge` is the amber tint that
  means a limit has been hit, `up-buy` is the green box a price sits in, and
  between them sat a plan name and a line of plan limits. Somebody reading that
  shape has decided what the screen is before the first sentence. Hence `bh-*`:
  a neutral badge, a plain button row, and a test that fails if the form wears
  `up-form`, `up-badge`, `up-gets` or `up-buy`. **Copy is not the only thing
  that makes a screen an upsell**, which is the general form of this and the
  reason the guard is on the markup rather than only the words.

  **Naming the plan is the specific mistake, even to say it is included.** It
  cannot reassure without first raising the question it is reassuring about —
  the same reason the plan pill came off the subcontractor's signup, where a
  line reading "3 subcontractors" invited *am I about to be charged for sending
  a certificate*. One clause says there is nothing to pay; the words Basic,
  Scale, upgrade, plan, a `$` and any count of contractors, users or jobs appear
  nowhere, and a test pins each of those.

  Nothing is lost either — both kinds are hireable, so the company row, the
  documents, the licence, the QR code and every pack already sent survive
  untouched (`PATCH /api/account` only clears `company_id` when moving to a kind
  that *cannot* be hired, and then refuses with `hired_by_others` if anybody
  already hires them). What it *does* change is said plainly, because it changes
  their home screen: the checklist becomes the hiring one and their sign-in page
  stops calling them a subcontractor. Reversible in Account → Company, which is
  worth saying to somebody deciding whether to press a button that renames their
  business.

  The plan is a separate axis and stays one. Neither Basic nor Scale has
  anything to do with which direction the account faces, so neither belongs on
  this screen.

- **The pack card is where the pack is assembled, not a report on it.** Six rows
  naming what was missing, with nothing on any of them to do about it: the only
  route from *certificate of insurance — Not added* to a certificate on file was
  Account, Company, scroll. That is where a checklist item goes cold, and it is
  the same shape as every other entry in this file — a screen that knows the
  answer and offers no way in.

  Every row now carries its own control, and **what the control is follows what
  the row is**. The four documents take an upload, done in place, through the
  same two calls the Company panel makes so there is one upload path and not
  two. The licence and the UBI cannot: they are columns somebody types, not
  files, and a button reading *Upload* over a text field is the screen-that-lies
  rule pointed at a widget. Those say **Add** and go to the field. The tick in
  the row's ring is the confirmation — empty while it is missing, filled once it
  is on file — because one mark in one place reads at a glance, where a second
  badge has to be decoded.

  The upload **re-reads the company** rather than patching the row in place. The
  note is the expiry the *server* worked out, so a locally invented "On file"
  disagrees with it the moment a certificate carries a date. Removing the reload
  is what the test catches.

  **Send is a CTA that opens the form, and it appears from the FIRST document,
  not the fourth.** The always-open field made the card longer than the thing it
  summarises, so it is one button and a modal. But the gate stays where the
  server put it: `POST /api/doc-shares` refuses only `nothing_on_file`, and the
  moment this entire loop exists for is a general contractor asking for your
  **insurance** while you are standing on their site — a subcontractor holding
  exactly that and nothing else is the commonest state there is. Hiding the
  button until the other three arrive would refuse the one send the product was
  built to make, on a screen whose own header menu offers it anyway. What
  completeness changes is **prominence, not permission**: at four documents the
  CTA is the primary button and says everything is on file; below that it is
  quiet and names what is still to come. The general rule, and this is the third
  time it has been written here: **a screen must not be stricter than the route
  behind it, any more than it may be looser.**

- **The dot is a traffic light, and the amber is the whole point of it.** The
  pack card had two colours and hand-rolled its own `d.expiresOn < today`, so a
  certificate lapsing on Friday was drawn exactly like one good for another
  year. Green on file, **amber inside `WARN_DAYS`**, red expired or never added
  — and it comes from `docStatus` in `app/shared/docs.js` rather than a
  comparison written on the card, because a second opinion on "close" would make
  this card disagree with every roster in the product about the same document.

  **Every row carries its date.** "On file" is the claim an attached PDF already
  makes and cannot keep, and the live expiry is the one thing this product has
  that an emailed certificate does not. The year rides along only when it is not
  the current one, so the common row stays short enough to sit beside a button.

  Three things hold the colours honest. **Expired and never-added share red and
  are told apart by the words** — they are different problems, a missing
  certificate makes somebody ask and an expired one makes everybody stop asking,
  but neither is cover; the never-added dot is hollow, because a row nothing has
  been done to is a to-do rather than a failure. **A blank expiry is green**, not
  amber: `docs.js` has said since it was written that null means "does not
  expire", and treating it as doubt would put two thirds of every roster
  permanently amber until people learned to ignore the colour. And **the tick is
  green only** — amber is on file *and* needs renewing, so a tick over it reads
  as "nothing to do here".

  The CSS trap this caught: the tone rules sat above a later `.cpack-rows li.ok
  .cpr-dot{background:var(--brand)}` left from the previous pass, and `.ok` is
  still on amber rows. A colour set twice in one stylesheet is a colour decided
  by ordering, so nothing below the tone block may re-declare a dot background.

  **And on the Compliance pack tab the date gets a column of its own.** It was
  inside the status sentence, which is the one line nobody scans, and *when does
  this run out* is the question the whole pack exists to answer. Three things
  about it are decisions rather than layout. A blank expiry **says so in words**
  — an empty cell reads as missing data rather than as a document with no shelf
  life, which is the same mistake `docs.js` refuses in colour. It is **hidden
  under 620px**, because a 136px column on a phone is a column of wrapped
  fragments. And the status line beside it keeps only what the date cannot say:
  *Expired — send a replacement*, *Renew it — 9 days left*.

  **"Left-justify" is a claim about four rows, not about one.** `.mydoc` is
  `justify-content:space-between` with three children, so the free space is
  shared **between** the items: without `flex:1` on the label column every row
  put its label — and its date — at a different x, which is what "centred" looked
  like in the report. The label column is the one that grows; the date column and
  the action button are both fixed.

  The action button had to be fixed **width**, not just `flex:none`, because its
  label alternates between *Upload* and *Replace* — and a six-pixel difference in
  the **last** item of a `space-between` row moves the expiry column of that one
  row. A column that is almost aligned reads as a mistake rather than as a table.

  The test measures `getBoundingClientRect().left` across all four rows. Asserting
  `text-align` instead would have passed either way, since the default already
  computes to `start` — the rule is a guard, not the fix, and a test on it is a
  test that cannot fail. Which is what the first version of it was.

- **An agreement is between TWO PARTIES, which is why it is no longer a column
  on `companies`.** Insurance, a bond and a W-9 are the subcontractor's own
  records: one certificate answers every client, so a boolean on the shared
  company row is the right shape. `companies.contract` said "this company has
  signed an agreement" with **nobody named** — so a roofer who signed with
  Outerhome read as having a signed agreement on Cascade Management's roster
  too, for a document Cascade had never sent and could not produce. Quietly
  wrong since the start, and unmissable the moment SubSub offers a form with
  both parties' names printed in it.

  Migration 052, `agreements` keyed on the pair, `app/shared/agreement.js`.
  `companies.contract` stays for the uploads that predate this and stops being
  what decides anything.

  **Two parties means two signatures.** A form signed by one side is not a
  contract, and the side that wrote the terms is the side with the most reason
  to be bound by them. The subcontractor signs where they already are —
  submitting their documents — and the hiring account countersigns from the
  roster. `inForce` is `countersigned` alone: a form the sub signed and nobody
  countersigned is an offer that was never accepted, and it must not read as a
  document on file. Same two-party shape as handover, completion and connect,
  and `waitingOn` is one function so the two sides cannot both draw "waiting on
  them" and stall forever.

  **Requiring one is a choice that has to be made out loud, and issuing IS the
  choice.** `DOC_KINDS` counted an agreement against every subcontractor on
  every roster, so a sub whose client never sent one sat permanently short of
  complete over a document only the hiring account could produce — the exact
  permanently-amber failure `docs.js` exists to prevent, which is why
  `OPTIONAL_KINDS` already excused it on the sub's own screens and *could not*
  excuse it on the hiring side. `kindsFor` adds `contract` only when a live
  agreement exists. There is deliberately **no separate `required` flag**: a
  flag beside an agreement row is two records of one fact and they would
  disagree. This does change what existing rosters read — some subs go from
  amber to green — which was the accepted cost.

  **The hash is of what they were shown.** Recomputed at signature from the
  **stored** parties and terms, which are the same inputs the screen was
  rendered from. Never carried over from issue, and never taken from the
  request: a caller who could name the hash could sign one document and record
  another — the same rule `/fund/confirm` follows about an amount.

  **Everything is stamped, nothing is read live.** Template id *and version*,
  the merged terms, and both parties as they read at issue. A company gets
  renamed and an account changes its standard terms; a re-render that picked
  either up afterwards would no longer match its own hash. Same rule as
  `lien_waivers.governing_state`.

  **`TEMPLATES` is keyed by id AND version, and a miss throws.** Keyed by id
  alone, a version bump would silently re-render every agreement signed under
  the old text using the new one: a different document, under a heading saying
  it was signed. **The wrong contract still reads like a contract**, so nobody
  would catch it by looking. The price is that superseded versions are never
  deleted from `agreement-standard.js`.

  **`canonicalText` is its own function, not "whatever the screen drew."** The
  screen will grow a heading one day, and a hash that followed the layout would
  stop matching every agreement signed before it.

  **SubSub authors this one, and `waivers.js` still authors nothing.** The
  reasons differ and both are load-bearing. A lien waiver has statutorily
  prescribed wording in roughly a dozen states and a form that deviates can be
  void. A subcontract has the opposite problem: no form is mandated, and
  several of its most important clauses are **void by statute** in particular
  states — anti-indemnity rules vary enormously, pay-if-paid is unenforceable
  in many. So a clause that is ordinary in Washington can be unenforceable in
  California, silently, and the document still looks right.

  Two things follow. The **indemnity is deliberately narrow** — the sub's own
  negligence, expressly not the hiring party's — because broad-form indemnity
  is precisely what anti-indemnity statutes strike, so the widest version is
  the one most likely to be thrown out. And there is **no pay-if-paid clause**,
  which would also contradict the product's own stated reason for existing.

  **`reviewed` is not something anybody gets for free**, the same rule the
  licensing dataset runs on: an entry naming a real firm and a real date,
  written by somebody who did not read the statute, reads exactly like one that
  was read line by line. It is `null`, and **the flag is untouched by
  everything below**.

  **What the SCREEN says about it was cut back on request, and the two are
  deliberately not the same record.** The preview carried the whole case — that
  SubSub wrote the form, that no lawyer had read it, and that some subcontract
  clauses are limited or void by statute depending on the state — on the
  reasoning above: an unreviewed form reads exactly like a reviewed one, and
  this is the moment somebody decides whether to rely on it.

  It now says *A starting point, not legal advice. Have your own lawyer read it
  before you rely on it.* **The instruction is unchanged and only the argument
  for it is gone**, which is the distinction worth keeping: the screen still
  sends somebody to a lawyer, it just no longer argues against the product on
  the screen where they are about to use it. Two sentences naming our own form
  as unvetted, on the last page before somebody signs, is a paragraph that
  stops the send rather than informing it.

  Three things hold, and a later pass should not undo them to "restore" the
  warning. The box is **still gated on `reviewed`**, so the day a lawyer does
  read the text it comes off by itself rather than needing to be found and
  deleted. The flag stays **`null`** and `agreement-test.mjs` still pins it, so
  nothing downstream can start claiming the form was checked. And the copy that
  was removed is **recorded verbatim in the comment at the render site**, so
  putting it back is a paste rather than a rewrite.

  **Still open, and unchanged by any of this: a lawyer has not read the text.**
  Taking the sentence off a screen does not make it untrue, and this remains the
  one part of this feature a build cannot supply.

  **THE WARRANTY IS THREE YEARS, IT HAS A CLOCK ON IT, AND VERSION 1.1.0 IS THE
  FIRST TIME THE VERSIONING MACHINERY WAS ACTUALLY SPENT.** Section 9 said the
  work would be corrected *within a reasonable time* and nothing else, which
  cannot distinguish a subcontractor coming on Thursday from one who is never
  coming — and by the time it can, the leak has run for a fortnight. So it is
  **two obligations**: acknowledge the notice within `warrantyResponseHours`
  and say when you will attend, then correct within a reasonable time, which is
  the part that genuinely depends on what is wrong.

  **Business hours, and the document says what one is.** 48 clock hours from a
  Friday afternoon is a Sunday, and a term that lands on a weekend is one
  nobody meets and nobody enforces. It is the operative number, so *8am to 5pm
  on a day that is not a Saturday, a Sunday or a public holiday in the
  governing state* is in the clause rather than assumed.

  `warrantyMonths` moved from 12 to **36** and renders as **years** where it is
  a whole number of them: a warranty is quoted in years by everybody who sells
  one, so *36 months* is a number the reader has to convert on a document they
  are signing. A stored agreement carries its own terms, stamped at issue, so
  nothing already signed moved with the default.

  **`months()` IS A NEW HELPER RATHER THAN A CHANGE TO `plural`, and that is
  the whole lesson of this change.** `plural` is used by the frozen 1.0.0
  archive too, so teaching it about years would have rewritten section 9 of
  every agreement signed under that version — a different document, under a
  heading saying it was signed. **A version freezes its TEXT, not its section
  list**, and a shared helper is part of that text. The mutation that proves it
  is in the suite: teaching the archive's own `plural` about years fails the
  golden hash.

  **1.0.0 lives in `agreement-v1-0-0.js`, as a whole copy, and the copy is the
  point.** 1.1.0 changes one section out of fifteen, so deriving one from the
  other is the obvious move and it is refused in both directions: derive the
  current one from the archive and editing a clause means editing a frozen
  file; derive the archive from the current one and editing any **other** clause
  silently rewrites what somebody already signed. Only a full copy is safe by
  construction, which is the price this file had already accepted in words —
  now paid. Its own file rather than a second literal in the living one, so the
  current template stays one readable version; each superseded version gets a
  file and `TEMPLATES` imports them.

  **The guard is a HARD-CODED hash, not a re-render.** A re-render of the same
  file agrees with itself whatever the file says. `agreement-test.mjs` renders
  1.0.0 from fixed parties, fixed terms and a fixed date and compares the
  SHA-256 of `canonicalText` against a literal, so drift from any cause fails —
  a stray edit, a shared helper moving under it, a dependency changing. Four
  mutations fail it, including a one-word edit in a section nobody touched.

  **And that block catches its own throw.** Dropping 1.0.0 from `TEMPLATES` is
  exactly what it exists to catch, and `renderAgreement` answers it by throwing
  — which at the top level of a script kills the run and takes every assertion
  after it. One real failure reported as silence, which is the
  read-through-`link?.` lesson in a new place.

- **A per-subcontractor override that nothing could set.** `mergeTerms(stored,
  body.terms)` has taken one since the issue route was written, the panel has
  posted `terms` on issue since then, and **the only thing that ever wrote
  `terms` was the load** — so every send carried the account's standing terms
  straight back. Ninth time this file has recorded correct pieces with no way
  in, and every static check of both halves passed the whole time.

  It is on the **contractor**, folded, because most accounts use one set for
  everybody and that case must stay one press — with **the count of what
  differs on the toggle**, which is what makes closing it safe, the same rule
  the roster's filter panel follows. Measured against the **standing terms the
  server sent**, not `defaultTerms()`: an account that has set its own 60-day
  payment term has not changed anything by sending it. Reset appears only when
  there is something to reset.

  **`TermFields` is one component**, shared with Account → Your subcontractor
  agreement. Two field grids would be two things to keep in step with
  `TERM_FIELDS`, which is the whole reason that list is named rather than
  free-form — a term added there now appears on both screens with nothing
  edited.

  **A number with no unit is not an editable value.** The grid held five fields
  measured in days, months and years with nothing saying which, readable only
  to whoever wrote the list. The unit comes off `kind`, so it cannot disagree
  with what the server validates against. The trap it hit: wrapping every input
  to hang the unit off made `.agr-field.agr-bool span{order:2}` select two
  spans and the checkbox row reverse, so a bool is deliberately **not**
  wrapped.

  **And the preview had to follow, or the screen lies on the one page whose job
  is showing somebody what they are about to sign.** `data.preview` is the
  server's render of the standing terms, so a warranty changed to two years
  previewed at three and sent at two. It renders through **the same
  `renderAgreement`** the server uses rather than re-fetching: one
  implementation cannot disagree with itself, and a round trip per keystroke
  would make the preview lag the form it previews. A throw falls back to the
  server's copy — a preview one term stale beats an empty modal.

  One thing this uncovered a layer down: the plain-number branch passed
  `e.target.value` through, so days, months, years and hours reached the route
  as **strings**. Harmless in the end, because `validTerms` coerces on the way
  in, which is why nothing ever showed it — and still wrong, since a term held
  as `"24"` compares unequal to the `24` beside it in every comparison the
  screen makes about itself, the change count included.

  **Uploading a signed agreement IS signing it**, and without that the "I'll
  use my own paper" route was a dead end: the hiring account issued an
  `uploaded` agreement, the screen told the subcontractor to upload their
  signed copy, and nothing anywhere moved when they did. It sat at `sent` for
  ever. The `contract` upload route advances it to `signed` and records which
  file — **not** to in force, because the hiring account still has to say the
  paper they got back is the form they sent, which is the same second
  signature SubSub's own form takes.

  **Still open: a lawyer has not read the text.** That is the one part of this
  a build cannot supply.

  **It is SubSub's form and it says so, and the hiring company is a variable
  in it.** Whose document this is, is the first thing either party needs to
  know: a form headed with the hiring company's name reads as their own bespoke
  paper, which is the opposite of what it is. The title is *SubSub Standard
  Subcontractor Agreement*; the company appears as a party filled into clause
  1, and every screen leads with the document's title rather than the account's
  name.

  **And what the two parties are CALLED follows the account kind**, which is the
  same rule `hiresLabel` already draws on the roster, applied to the one place
  it matters most — a contract's defined terms. A general contractor holds the
  prime contract, so the people they engage work *under* it and *Subcontractor*
  is right. A property manager, a portfolio manager and a building owner engage
  a plumber directly: **nobody is sub to anything**, and a document calling them
  a subcontractor describes a chain that does not exist. So
  Contractor/Subcontractor for a GC (and for a subcontractor passing work
  further down, which is still a chain), Manager/Contractor for the two
  management kinds, Owner/Contractor for an owner, and a neutral *Hiring Party*
  for anything unrecognised — because a contract rendering with a blank where a
  party name belongs is worse than one using a slightly formal word.

  `PARTY_TERMS` lives **inside** the versioned template, not beside it: these
  words are part of the document, so changing one has to move the version with
  it. The account's `kind` is **stamped into `parties` at issue** like
  everything else, because an account may change kind afterwards and a signed
  document must not change with it.

  **A `${}` inside a plain string is five literal characters, not an
  interpolation** — the same class as a `\uXXXX` escape in JSX text. One
  heading here was a plain string when the defined terms became variables, so
  it rendered as *2. ${x.T.hired} status* on a document somebody was about to
  sign. Invisible in the source, obvious to the reader, and caught by nothing
  that only checks the document renders. The test asserts no rendered heading,
  paragraph or title contains `${`, for **every** kind, because only one of
  them was ever wrong.

  **And a customer's name was baked into the product elsewhere.** *Materials
  paid by* on the job form offered two options and one of them was the literal
  string `Outerhome` — the first customer's name, shipped as the default answer
  and as a picker option for every account in SubSub — while the other read
  *Subcontractor (reimbursed)*, which is the wrong noun for three of the five
  kinds, in the same control. Both now come off the account. `test:rosterword`
  pins it statically, and **strips comments before checking**, because a comment
  explaining what the literal used to be reads to a substring check exactly like
  the literal still being there: the first version of that assertion failed on
  its own explanation, which is the lesson `embed-test` already records about
  CSS selectors.

  **The panel renders for an admin or a project manager**, because that is what
  `requireRole("admin","pm")` allows on every one of its routes. Using the
  admin-only `canManage` — the obvious thing, since the panel beside it does —
  would make the screen stricter than the route, which this file has already
  called the same lie as looser.

  **`ux_agreement_live` is PARTIAL**, on `('sent','signed','countersigned')`,
  for the reason `ux_wo_transfer_live` is: a plain unique index would leave a
  relationship whose first agreement was declined unable to have another, and
  no index at all would let two arrive at once. The route's own pre-check
  covers the sequential case and answers `already_issued` rather than
  superseding a document the other party may be reading right now, so the index
  is asserted **directly**.

- **A signed subcontractor agreement is optional, because it is the hiring
  account's own paperwork.** Insurance, a bond and a W-9 are the subcontractor's
  own records and every client wants the same three. An agreement is the other
  party's form, on their terms, which plenty of general contractors never send at
  all — so a row demanding one is a to-do most subcontractors can never tick,
  which is the permanently-amber failure `docs.js` was written to prevent wearing
  a different colour.

  `OPTIONAL_KINDS` and `REQUIRED_KINDS` in `app/shared/docs.js`, named once so
  the card, the badge and the send gate cannot hold three opinions. It is **off
  the dashboard card entirely**, still uploadable in Account → Company where it
  is labelled *optional*, and still carried in a sent pack when there is one. The
  nav badge counts required kinds only — a red number that never clears is how
  people learn to stop reading badges, the same reason that badge already counts
  presence rather than approval.

  **What this deliberately does not change: the hiring side.** `DOC_KINDS` still
  drives roster compliance, assignment gating, the portal's "all four on file"
  and overflow eligibility, because whether a general contractor requires an
  agreement is *their* call — the same rule that makes verification each hiring
  account's own verdict. Making it optional there too would take a real signal
  away from the accounts that do require one. The right answer if it comes up is
  per-account, not a global default, and it is a product decision rather than a
  refactor.

- **Landing somewhere is not the same as pointing at something.** *Manage* on
  the pack card opens the panel it always did — one implementation, not a second
  copy — but a page that only scrolls has answered "here is your company
  profile" when the question was "what is still missing".

  So `openPane.focus` scrolls **and** highlights, and it highlights only what is
  **outstanding**. Ringing a certificate already on file points at the wrong
  thing; ringing all six when five are done buries the one that matters; and
  with nothing outstanding it rings nothing at all, which is the honest answer.
  `focus` takes four values because there are four ways in — `docs` from the nav,
  `license` and `ubi` from a row's *Add*, and `pack` from *Manage*, which is both
  halves of the page and so lands on the first of them.

  It lives in `HireablePanel` and **waits for `loaded`**, which is the part worth
  stating: "which of these is missing" is a question only the fetched row can
  answer, and running the effect before it arrives rings everything, every time,
  including the documents somebody has already uploaded. It keys off `focusN` as
  well as `focus`, so asking for the same place twice takes you there twice. And
  the ring is a `box-shadow` rather than a border, because a border that thickens
  moves everything beside it by a pixel and the whole panel appears to twitch.

- **Account is four tabs, because Company was ten panels.** It held the account
  kind, the whole twenty-nine-chip trades grid, the emergency contractor, the
  hireable profile, four documents, the send panel, a QR code, incoming connect
  requests, the branding studio and eighty lines of embed markup — and the two
  things people open it for most, their documents and their branding, were
  furthest down it.

  Split by **what the thing is**, not by length: **Company** is what this account
  *is* and how it hires; **Branding** is what other people *see*, which is why the
  application form lives there rather than with the account's own settings —
  its colours, its preview and its live address were already on that tab;
  **My documents** is the paperwork and sending it. It earns a tab because it is
  the screen a hireable account opens weekly and it was the fifth panel down
  inside another one.

  `HireablePanel` takes a `section` prop rather than being split into two
  components, and **only one section is ever mounted**, so there is still one
  fetch and one source of truth for the company row. Two components would be two
  of each, which is the duplicate-upload-state trap this file already refuses for
  My documents.

  The cost, stated because it is a real loss: `focus: "pack"` used to ring the
  documents *and* the licence and UBI, and those are now on different tabs, so
  one press cannot ring both. *Manage* lands on My documents and rings the
  documents; the licence and UBI rows on the pack card have their own **Add**
  buttons that go to Company and ring the field. Nothing is unreachable, but the
  single gesture that covered the whole pack is gone, and that was the price of
  the tab being readable.

- **The pasted form wears the account's colours, and only two of them.** A
  general contractor who has set their branding then pastes a green box into a
  blue page, which is the one thing that makes a snippet look like somebody
  else's software on your own website.

  The button, its hover and the focus ring take `accent`; the button label takes
  `btnText`; the confirmation tick takes both. **`bg`, `surface` and `text` are
  deliberately not applied.** This form lands inside somebody's existing layout
  and already inherits its font and colour, and a snippet that paints a
  background is the restyles-their-whole-website failure every rule in it is
  scoped under `#subsub-apply` to avoid. Inputs stay white on dark ink, because
  that is legible on any page — a customer's own surface/text pair is not, once
  it is somewhere they did not choose it for.

  The hover shade is **computed, not stored**: the editor asks for one accent,
  and a second colour to maintain is a second colour to get wrong.

  **A colour out of the database landing in a `<style>` block on a customer's
  website is an injection unless it is checked.** `hex()` takes six hex digits
  or returns the default — never the string it was given, so
  `accent: "red;}body{display:none"` paints nothing and changes nothing. Three
  tests pin it, and dropping the guard fails all three.

  It reads the theme off **`brand`, not `account`**, which looks like a
  violation of the rule two entries down and is the opposite: the colours *are*
  branding, and branding is Scale, so a Basic account gets SubSub's green — a
  real form rather than a broken one. The panel itself stays unplan-gated, which
  is the rule; only what it paints follows the plan.

  And the panel **says it is a copy**. A snippet pasted onto a website is frozen
  at the moment it was copied: change the colours afterwards and the form
  already on their site keeps the old ones until they paste it again. Nobody
  would guess that, and a panel that let them assume otherwise would be lying by
  omission.

- **And the hiring account has a code of its own, which is the mirror of that
  one.** The subcontractor's code hands over a compliance pack; this one hands
  over a place to apply. Both are the same kind of thing — give somebody your
  details without a conversation — and both exist because spelling out an email
  address on a roof is how a contact gets lost.

  It encodes the hosted application form, which already existed and which
  nobody could find. **The reason it needs `applyUrl` rather than building a URL
  on the panel is the whole design:** a custom hostname is Scale, so on Basic
  `<sub>.subsub.work` does not resolve — and **a QR code that fails while
  somebody is standing there holding a phone is worse than no code at all.**
  `liveHost` is the same flag the embed panel already withholds its hosted link
  behind, for the same reason.

  So the fallback names the account in the **query string** instead of the
  hostname: `app.subsub.work/?apply=<sub>`. That address belongs to nobody,
  which is exactly why the URL has to say whose form it is. **Withholding the
  code on Basic was the alternative and it is refused**, because
  `POST /api/apply/:subdomain` checks no plan and making the cheapest growth
  lever a paid feature is the mistake the embed panel records against itself.

  Which needed two things to follow. `openingApplication` required a real
  subdomain, so the fallback address would have loaded the **sign-in page** — a
  code that scans, loads, and shows the wrong screen, which is the worst of the
  three failures because it looks like it worked. And the brand lookup had to
  follow too, or the form wears SubSub's colours under the account's name.

  **Scoped to `?apply` deliberately.** A hostname that belongs to nobody
  wearing a company's colours because of a query parameter is the white-label
  failure this file already refuses, from a new direction. No new exposure:
  `GET /api/account-by-subdomain/:s` is already public and is what brands every
  login page.

  **The branded address is the point of the code, not a detail on it.** Now
  that it is Scale-only, the code encodes `<sub>.subsub.work/?apply=1` — the
  same address the Branding tab previews — so somebody scanning it lands with
  this account's name in the bar, its colours and its mark.
  `app.subsub.work/?apply=<sub>` renders the identical branded form, but the
  address bar says SubSub, and **on a code you hold up to a stranger that is
  the one thing it must not say.** The fallback is drawn only while the custom
  hostname is still being provisioned, and says exactly that.

  **The address is shown beside the code**, because a QR code is the one
  control on a screen whose destination cannot be read, and somebody about to
  point a stranger's camera at it is entitled to know where it goes.

  **It is Scale, and the snippet beside it is not.** That pair is gated
  differently on purpose and a later pass will want to harmonise them: the
  snippet is the cheapest growth lever and `POST /api/apply/:subdomain` checks
  no plan, while the code is the in-person gesture that goes with a branded
  address — and `<sub>.subsub.work` is itself Scale. Same form behind both,
  different reach. Both plan branches are asserted, because a component left on
  one answer is right for one plan and never checked for the other, and
  `test:embedplace` still guards the snippet against being dragged inside
  `canBrand`.

  The `?apply=<sub>` fallback stays even so: a Scale account whose custom
  hostname is still being provisioned gets a code that works rather than one
  that resolves to nothing.

  **Two ways in, one component.** The panel is on Branding, beside the form it
  is a code for; the add-a-contractor gate opens the same one, because *typing a
  company name off a business card while somebody waits* is exactly the moment
  it is for, and Branding is two taps and a tab away from where that question
  comes up. Two copies would be two components to keep in step — the rule the
  embed panel already records.

  **`applyLink` is defined in terms of `applyUrl`**, not beside it. Two
  functions building one URL is two records of one fact. `applyLink` always
  wants the account's own hostname, because it goes on their website where a
  link to `app.subsub.work` would read as sending their visitors elsewhere; and
  the test counts how many places in `embed.js` build that URL — **stripping
  whole comment lines first**, because a naive `//` stripper eats `https://`
  and the first version duly reported zero.

  **And one assertion could not fail, caught by mutation.** *A bare query
  parameter does not brand the sign-in page* looked for the apply form's
  heading, which is absent either way — `openingApplication` still requires
  `?apply`, so the form never renders for `?brand=`. What a widened lookup
  actually does is put another account's name and colours on SubSub's own front
  door, so the check has to read the branding rather than the form.

- **The QR code is on Profile, because it is not a company setting.** It was the
  seventh panel down inside Company, under the account kind, the trades grid and
  the hireable profile. It is the thing you hold up on a job site — and it
  already sits beside *Send my documents* in the header menu for exactly that
  reason: both are give-somebody-your-details-without-a-conversation, and Profile
  is where somebody looks for their own.

  The gate travelled with it. Still `canManage` and still a **hireable** account,
  because a code for a company nobody can hire is a code for nothing. The test
  for that had to prove the account screen actually opened first: "no QR code" on
  a screen that never rendered is an assertion that cannot fail, and the first
  version of it was exactly that.

  **It is called what the menu calls it, and it says what scanning it does.**
  The panel headed *Your code* over the entry headed *My QR code* is two names
  for one object, which is how somebody concludes there are two of them. And the
  note under it described the artifact rather than the reason to hold it up: it
  now names the compliance pack, the schedule and the jobs — the whole
  send-your-pack loop in one gesture, on somebody else's job site — because that
  is the sentence that makes anybody get their phone out.

- **The pasted form is the hosted form, or it is a different product.** The
  snippet was one flat box with a multi-select for trades; `/?apply=1` is two
  steps with chips, a city and a ZIP. Somebody who saw one and then followed a
  link to the other met a stranger, and the panel offering both as *the* way in
  had no answer for which was right.

  `applyFormHtml` now draws the same two steps — who you are, then what you do
  and where — with the same chips, and posts the same fields. Two deliberate
  differences, both already decisions here: **no password**, because the form
  never asks for one and whoever applies sets it from the email; and **no UBI**,
  because that is Washington's and a box nobody outside one state can fill in is
  the permanently-amber row wearing another hat. The licence is asked for, named
  generically, because the snippet does not know the state.

  Validation is **said on the step it is about**. Walking somebody to the end
  and then telling them the first box was wrong is how a form gets abandoned.

  And it carries **Powered by SubSub**, last and small, for the reason the
  hosted pages do: the name is not the customer's to remove.

  It is the **real mark, drawn inline**, not the word set in the customer's
  font. Two words in whatever typeface their page happens to use is not a logo,
  and this is the one place SubSub is seen by somebody who has never heard of
  it. **Still never an `<img>`** — that rule has not moved and is the whole
  reason the paths are pasted in: a snippet that fetches a logo file is a
  snippet with a dependency, and every rule in it exists to keep it from needing
  anything. `fill="currentColor"`, so it takes the colour of the page it lands
  on rather than importing a palette, and `aria-hidden` on the `svg` with the
  sentence on the link, because a decorative mark that also announces itself
  reads the name twice.

- **The greeting knows the hour, and the weather is decoration.** "Good to see
  you" was hand-typed into five dashboards and said the same thing at 6am and
  9pm. `greetingFor` in `app/shared/greeting.js` is the one rule; `Hello` is the
  one component, so a sixth screen cannot grow a sixth wording.

  The hour comes from the **reader's** clock, not the account's address: morning
  is a fact about where somebody is standing, and a project manager opening a
  laptop is not necessarily in the town the company is registered in. It is read
  at render rather than held in state, so a dashboard left open over lunch does
  not still say good morning.

  The weather is fetched **server-side** (`GET /api/weather`, Open-Meteo, no
  key), for three reasons: one cached call per account instead of one per tab;
  the browser never talks to a third party, so nothing about who is looking at
  SubSub leaves our origin; and an outbound host that goes down cannot take a
  dashboard with it. What leaves is a town and a state — never a customer, a
  person or a building.

  **Every failure answers `{}`**, including an account with no city on it, so
  callers never branch: no spinner, no error, no reserved space, and the
  greeting renders alone. A weather chip is worth exactly as much as it costs,
  and it must never cost a dashboard.

  **And that is what hid the bug for as long as it lasted.** The town was read
  off `accounts.company_id → companies.city` and nowhere else — a column only
  **hireable** kinds have, because 031 mints a company row for a general
  contractor and a subcontractor and `m031_others_with` actively forbids one
  for anybody else. So a property manager, a building owner and a portfolio
  manager never got a failed lookup; they got a join that could not match, on
  three of the five kinds. `{}` is the same reply for "nothing to show" and
  "this query is wrong", which is the right trade for a dashboard and the
  reason nothing on any screen could report it. Every browser test drove a
  subcontractor, and the route had no server test at all.

  `accountPlace` is the one place that decides now: the company row when there
  is one, otherwise the **buildings**. Which is the more honest answer for those
  three kinds anyway — a managing agent's weather is the weather where the work
  is. Most common town across the portfolio, **owned as well as operated**,
  because an owner who has appointed a manager still watches those buildings
  and watching them is the entire reason they are here.

  The tie-break (`ORDER BY n DESC, lower(TRIM(city)) ASC`) is there so one
  account produces one cache key rather than two answers. Asserting the winner
  against one fixture **passed with the whole `ORDER BY` deleted**, because
  SQLite's `GROUP BY` hands the groups back in key order anyway — an
  implementation detail, not a guarantee. The test seeds the same two towns in
  **opposite insertion orders** and requires them to agree, which is the
  property the clause actually buys.

  **The general rule, and this file keeps relearning it: `company_id` is what a
  hireable account has, not what an account has.** Anything reading it to answer
  a question about the *account* is answering it for two kinds out of five.

  Still open, and it needs a migration rather than a patch: **the city a
  non-hireable account types at signup is validated and then discarded.** There
  is no company row to put it in and no column on `accounts` to hold it, so a
  brand-new property manager with no buildings yet still has nowhere to get a
  town from. A backfill cannot help the accounts that already exist — the
  address was never stored — so the buildings fallback is the only thing that
  fixes them, and `accounts.city` / `.state` would only serve signups from the
  day it ships.

- **A preview's address bar is a claim, and it was the wrong one.** The Branding
  tab carries two previews. One is the sign-in page; the other is the form a
  subcontractor fills in — and it had no title, so it read as an unlabelled
  black box, with an address bar showing the bare subdomain. That is the
  SIGN-IN page's address. A preview whose address is not the address of the
  thing it previews is worse than one with no address at all, because it is
  read and believed.

  It is titled **Sign up form** now, its bar reads `<sub>.subsub.work/?apply=1`,
  and the `</>` that opens its markup sits in that header rather than in a
  second panel further down. The icon came **off** the embed panel in the same
  change: two buttons holding one modal is two places to keep in step, and the
  person wondering what the form is made of is looking at the picture of it. The
  embed panel keeps *Copy the code*, because its job is getting the snippet onto
  their website rather than explaining it.

  The markup is generated from **`th`, the editor's live theme**, not the saved
  one — it opens from the preview directly above it, and code that disagreed
  with the picture over it would be the worse of the two lies. It is memoised,
  because the colour pickers re-render on every drag and it walks thirty trades
  to build eighty lines.

  The test scopes its selectors (`.embed-strip .embed-code-btn`,
  `.sf-head .embed-code-btn`). A bare `.embed-code-btn` found whichever existed
  and passed either way — which it did, silently, the first time this moved.

  **It is titled *Hosted sign up form*, and the title is not the description.**
  A heading says what the block **is** and nothing about why anybody would use
  it, so the paragraph under it says where an entry lands — *directly into
  SubSub, where you can vet them, read their compliance packs, see their
  availability and schedule them for jobs* — and then answers the objection the
  word "hosted" raises, which is *nothing here needs hosting or a plugin*.

  **A selector that no longer selects anything is a gap that went back to the
  browser's default.** The spacing was `.sf-head + .theme-preview`, and the
  moment a paragraph came between the two the rule stopped matching — silently,
  because a wrong margin looks like a design choice. It is `.sf-head + .sf-note`
  and `.sf-note + .theme-preview` now, and the test reads the computed margins
  rather than the rule, because only the computed value knows whether the
  selector fired.

- **Nobody reads pasted HTML on a page; they copy it.** Eighty lines of markup
  sat inline in the embed panel, which was most of why the tab scrolled forever,
  with a separate toggle below it to preview the form. Both answered the same
  question — *what am I actually pasting* — in two places.

  One `Code2` icon beside **Copy the code** opens a modal with the form and the
  markup as **tabs**, because you want one or the other, not a stack. The preview
  is an iframe with `srcDoc` and no `allow-same-origin`, so it cannot inherit our
  stylesheet and lie about how it will look on somebody else's page.

  The `\uXXXX` guard and the CSS-scoping check both had to learn about it: the
  guard's clone now strips `.ecm-code` and `.ecm-prev` as well, because that
  block legitimately displays source, and `embed-test` strips CSS comments before
  reading selectors, since a comment above a rule was being read as part of it.

- **A confirmation replaces the form; it does not sit above a blank one.** The
  pasted form said *"Thanks — that's with Outerhome. Check your email."* and then
  called `form.reset()`, so an empty form sat under it. That reads as an
  invitation to send it again, which is how one applicant becomes three rows on
  somebody's roster — and the sentence said nothing about what actually happens.

  It is a centred panel now, with a tick, naming who has it, saying **a person
  reads every application and nobody joins a roster until they say so**, and
  where to watch. The form is hidden, so success is terminal; `embed-test` tests
  the refusal **first** for that reason, because anything after success would be
  driving a hidden form.

  Two traps, both already in this file and both hit again. **A backtick in a
  comment closes the template literal** — `embed.js` is one big template, so its
  comments cannot contain one. And **`[hidden]` is a UA rule at the weakest
  specificity**: `.ss-form` sets `display:flex`, which beats it, so the form
  stayed on screen under the confirmation until `.ss-form[hidden]{display:none}`
  said otherwise.

  **It does promise a confirmation, and the reason that is safe is worth
  writing down, because it was got wrong once here.** `applicantWayIn`
  deliberately sends nothing to somebody who already has a login — "choose a
  password" to a person who has one is a phishing lesson in reverse — and on
  that basis the first version of this copy refused to mention email at all.
  That was wrong: the send it was worried about is the **invite**, a second mail
  only a new login earns. `createApplication` mails *every* applicant whose body
  carried an address, before any of the login branches run. So the confirmation
  always goes, the sentence is true for everybody, and it reads the same either
  way — which is what stops it being an oracle for who is already on SubSub.

  That makes the copy depend on a server behaviour nothing was guarding, so
  `test:subsignup` now applies twice through `POST /api/apply/:subdomain` — once
  as a stranger, once after setting `auth_id` on that address — and requires a
  confirmation both times. Moving the send behind the login branch fails it.

  The words themselves are the account's, not ours. It opens *Submitted*, thanks
  them for asking, names the address, says to follow the link, and **names the
  three documents** — certificate of insurance, surety bond, W-9 — rather than
  saying "your documents", because somebody reading it is about to go and find
  files and three names is the difference between doing it now and doing it when
  asked again. Not the signed agreement, which is optional. And it signs off as
  **the account's team**, because the form is on their website and the applicant
  is writing to them; a confirmation in SubSub's voice would read as a third
  party butting into somebody else's hiring. A test pins that the word SubSub
  does not appear on it.

- **Being findable is something you say, not a side effect of filling a form
  in.** An email, a mobile or a licence on the `companies` row was all it took:
  any account typing one of those whole values could ask you to connect. Nobody
  was ever asked whether they wanted that, which is what the column is for.

  Migration 047 adds `companies.open_to_hire`, and it is the same shape as
  `scope_kind = 'labor_only'` and `owner_declared_at`: something somebody says
  out loud rather than an absence nobody recorded. **NULL means not answered**,
  never "no", and the effective default is **open, for every hireable kind** —
  so the column never needed a backfill guess. `openToHire` in the Worker is
  the one place that decides, and `/api/my-company` returns the **effective**
  value so the browser renders one answer instead of deriving a second.

  **The first version derived the default from the account kind and closed a
  general contractor**, on the reasoning that somebody who signed up to run a
  roster is not offering to work under anybody. That was the wrong way round,
  and it is worth keeping the reasoning next to the correction. Since 031 every
  hireable account **has** a company row precisely so it can be hired; the whole
  growth loop is a contractor being found by somebody who already holds their
  address; and a general contractor taking overflow from another general
  contractor is the ordinary case rather than the odd one. Defaulting them out
  meant the product quietly did not work for them until they found a switch
  nobody had told them about — which is the never-told-about-it failure this
  file catches in half a dozen other places, arrived at from the opposite
  direction. **A default that has to be discovered to be corrected is not a
  default, it is a trap.** Closing it is one tap and it is theirs to make.

  **It gates the lookup, not the code.** A QR code is somebody handing their
  details over, which is them asking; the switch is about strangers who hold
  your address. The screen says so, because otherwise turning it off reads as
  going dark everywhere.

  And a closed account answers **like an address nobody here has ever seen** — a
  bare `found: false`, no reason — rather than `no_account`. `no_account` says
  "this address is on SubSub and nobody can answer for it", which is untrue here
  and is a fact about them a stranger typing addresses has no business
  collecting. Not findable is not findable, and the test compares the two
  replies rather than trusting the wording.

- **Being findable and being matchable are two halves, and the account's own
  company row only ever had the first.** A hiring account looks for somebody by
  **trade and area**, and `coversJob` reads `companies.coverage` to decide. The
  roster has asked that of every contractor on it since the start — the panel,
  the column and the picker all exist. The one company row nobody was ever
  asked about is the account's own, so a hireable account could be looked up,
  connected to, and then matched to nothing.

  `MyCoverage` on Account → Company, **the same component the roster uses**, not
  a second one: an account's own coverage and a contractor they typed in are one
  record type. It saves **on its own** — it is its own question, and requiring
  the profile above it to be re-submitted to record where somebody works is the
  shape this file already refused for the open-to-hire switch, so
  `PATCH /api/my-company` takes `coverage` alone and must not trip
  `nothing_to_change` on the way past the profile fields.

  It is shown **only while the account is open to being hired**, because
  coverage on a company nobody can look up is a form nobody reads.

  Two traps, both of which the tests now pin. `validCoverage` runs on the way
  **in**, because this lands on a shared row and the roster reads the raw
  column: `{cities: "Seattle"}` stored as written makes `coverageLabel` call
  `.join()` on a string, which is a white screen on somebody else's screen. So
  the assertion has to read **the column**, not the route's own answer — the
  read path normalises too, and checking `/my-company` would report a clean
  shape over a stored one that is not.

  And the read path normalises rather than merely parsing, because the column
  is `TEXT NOT NULL DEFAULT '{}'`. `{}` is **truthy**, so every
  `coverage || <default>` downstream keeps it and the panel then indexes into
  `.cities` on an object that has none. Same rule as `inheritedShape`'s
  `assignments`: **empty, never absent, and never half a shape**.

- **A roster entry is two records, and only one of them is yours.** `companies`
  is shared — one name, one contact, one licence, one set of document booleans,
  read by *every* account that engages them. `engagements` is per-account: the
  trades you use them for, your capabilities, your rating, your notes, the
  buildings you scope them to.

  `PATCH /api/subs/:companyId` checked only that an engagement existed, then
  wrote both halves. So any account with somebody on its roster could rewrite
  that company's name, contact, email, phone, licence, crews and coverage —
  for everybody else who hires them. It also wrote `insurance`, `bond`,
  `contract` and `docFiles`, which are the columns `mayWriteCompanyDocs` guards
  on the document routes: **a plain PATCH was a back door round that check**,
  and without even its ended-engagement test.

  The rule: a hiring account may write the company row only when **nobody
  answers for it** — a record they typed in, no seat anywhere, no account of its
  own. `companyAnswersForItself` asks exactly that, and it is deliberately
  **not** the per-account seat count the roster and the auto-schedule branch
  use. Those ask "is there somebody *I* can ask?", which is scoped on purpose.
  This asks "does anybody answer for this company at all?", so a roofer whose
  only seat is on another general contractor's account is still protected from
  this one. Scoping it leaves precisely that hole, and the test fixture puts the
  seat on another account so a scoped check fails it.

  It **refuses** rather than quietly dropping the company half: a save that
  reports success and writes nothing is how somebody re-types the same
  correction three times.

  On the screen the form agrees rather than offering a save that would be
  thrown away. For a contractor with their own login the three-step form becomes
  one pane — *How you work with Acme Roofing* — carrying the engagement half and
  a line saying their details are theirs. This is the same shape as
  auto-schedule, which already said the hiring side cannot commit the other
  side's calendar; it was applied to one column and not to the row it sits in.

- **Seat scoping existed and did nothing for a general contractor.**
  `membership_properties` narrows a property manager to named buildings, and
  `ROLES.pm` already records why that is one role rather than two: a large
  managing agent assigns each manager to named buildings and a small one does
  not, which is the same job with or without a list. A general contractor has
  `properties: false` — **no buildings at all** — so the one account kind whose
  pm seat is actually called a *Project* manager had nothing to be scoped by,
  and a firm with six of them gave every one the whole book. The unit of work
  there is the **job**. Migration 053, `app/shared/jobscope.js`.

  **The asymmetry is copied deliberately, and it is what makes this safe to
  ship against a live database.** No rows means nobody narrowed them, so they
  see everything — which is what every pm seat is today, untouched by this
  existing. `null`, never `[]`: an empty array means *narrowed to nothing*,
  which is a different answer and the wrong one.

  **Owners and tenants are deliberately not job-scoped.** Their jobs already
  follow their buildings, and a second, empty list would narrow them to
  nothing — so `jobScopeFrom` answers null for every role but pm.

  **FILTERING THE LIST IS NOT ENFORCEMENT: the id is in the URL.** The guard
  goes in the middleware that already resolves a job, a work order or a
  service call for the property scope, because that is the one place all three
  arrive — twenty-odd routes load a job by id and eleven of them wrote
  `FROM jobs WHERE id = ? AND account_id = ?` by hand. A scope added to twenty
  places is a scope missing from the twenty-first, which is exactly how the
  work-order response route ended up answering *no, let them through* for a
  role that did not exist when it was written. That middleware now returns
  early only when a seat carries **neither** scope: checking `propertyIds`
  alone would have left the job scope enforced by the list endpoints, which is
  not enforcement.

  **It answers `not_found`, not `forbidden`, and the test is what caught
  that.** The first version returned 403 for a real job the seat was not on
  and 404 for one that does not exist — so a narrowed manager could tell
  which ids are real and walk the account's whole job list one guess at a
  time. The property branch beside it has answered 403 since it was written
  and has the same leak; changing that one is a separate decision about owner
  and tenant seats, with its own tests, and is **still open**.

  **A creator keeps what they made.** Without it a scoped manager creates a
  job and it vanishes on the next render: the screen worked, the job exists,
  and the person who made it cannot find or act on it. Creating something is
  the clearest possible statement that it is yours to run, and `POST
  /api/jobs` is the only place that statement is made. An *unnarrowed* pm is
  deliberately not given a list by creating one — that would narrow them to
  the single job they just made.

  **A job id in the body is a claim.** `INSERT ... SELECT ... WHERE id = ? AND
  account_id = ?` is the only thing that makes it true, and CHECK.sql counts
  both ways it can be wrong: a scope row against a role that is not job-scoped
  (which narrows nobody today and would start narrowing them the day that role
  joined `JOB_SCOPED_ROLES`, silently), and one pointing at another account's
  job.

  **And the test for that passed for the wrong reason.** *A job id that is not
  this account's is dropped* was answered by the **foreign key** rejecting an
  id that exists nowhere — so it tested SQLite rather than the scoping, and
  deleting the account check changed no outcome. The fixture gained a **real
  job on another account**, which is the only case either guard could be
  checked against. The two guards covering for each other, for the second time
  in this file.

  The picker is offered only where the buildings one is not, because two scope
  pickers on one form is two lists narrowing the same person by different axes
  and nothing downstream would say which had hidden a job. And `updateUser`
  had to name `jobIds` explicitly — the same drop-a-field-you-did-not-list
  shape that deleted a W-9 through `SubForm`.

  Fourth time a comment has read to a substring check exactly like the code it
  describes: 053's own comment says *there is no ALTER TABLE*, and the
  assertion checking for one duly failed on it.

- **AND NEITHER PICKER COULD BE OPENED, BECAUSE THE FORM ASKED FOR A
  CAPABILITY THAT DOES NOT EXIST.** The scoping above shipped complete —
  route, middleware, migration, invariants, picker, note — and the picker was
  unreachable. So was the buildings one beside it, which has existed since
  `membership_properties` did. Reported as *"I can't attach jobs to a project
  manager — when I edit them it only allows to edit name and email"*, which is
  exactly what the screen did.

  `UserForm`'s gate was `can("users")`. **There is no `"users"` capability.**
  `"users"` is a **pane** name in `AccountView`, gated there on `canManage`,
  and `can()` is `ROLES[role].can.includes(view)` — so an unknown view falls
  through and answers **false**. It answered false for an admin, for a project
  manager and for everybody else, on every account kind, since the pane was
  named. Two records of one fact with the records in different vocabularies,
  which is why neither looked wrong beside the other.

  What that cost is the whole form below the email box, because `roleLocked`
  hides four things: the role picker, the buildings picker, the jobs picker and
  the contractor link. **A general contractor could not scope a project manager
  to jobs and a managing agent could not scope one to buildings** — the two
  controls the gate exists to protect, unreachable by the one person allowed to
  use them. `PATCH /api/account-users/:userId` is `requireRole("admin")`
  throughout, so the screen was **stricter** than the route: the same lie as
  looser, now paid for in both directions.

  **The mechanism is worth more than the fix, and it is a new one for this
  file: a misspelt capability is indistinguishable from a refused one, it fails
  closed, and nothing anywhere reports it.** Every other assertion shape here
  is caught by mutation; this one cannot be, because the source reads exactly
  as intended. `test:seatgate` therefore pins the **class** — every `can("…")`
  string in `App.tsx` against a capability some role actually has, with the
  vocabulary read out of `ROLES` rather than listed in the test.

  **And the static assertions for both pickers passed the entire time.**
  `{scopeByJob && !roleLocked && (` is exactly what it should be; the bug was
  in what fed `roleLocked`. So `test:scopeedit` drives the modal in a browser
  and reads the pickers back — **on both account kinds in the same place**,
  because a fix checked on one branch is the diagonal coverage that left
  `hiresLabel` half-wired. Mutating `canManageUsers` back fails eleven
  assertions across the two.

  **Three more places dropped the list on the way to that form**, none of which
  any static check on the route could see: `hydrateAccount`'s membership write,
  `accountUsers`, and `updateUser`'s optimistic patch. Dropped anywhere on that
  trip the picker opens with nothing ticked — and **empty does not read as a
  lost field, it reads as *runs everything*, and the next save writes exactly
  that.** So the assertion is on the **ticked** state and on the body of the
  PATCH, never on the picker being present.

  The optimistic patch was wrong about the other list too. It kept
  `propertyIds` for `"owner"` alone; `setMembershipProperties` keeps one for a
  **pm** as well, so saving any edit to a scoped property manager blanked their
  buildings on screen while the server kept them, until a reload. **Which roles
  carry which list is the server's answer, and a patch that gives a different
  one is a save that looks like it lost something** — the shape this file
  records about `updateSub`, one field along. Re-opening the form and reading
  the ticks is what catches it; the PATCH body cannot, because that comes from
  the form rather than from state.

- **The screen asked the scoped question where the server enforces the
  unscoped one.** `companyAnswersForItself` was written *deliberately*
  unscoped — "does anybody answer for this company at all", never "is there
  somebody *I* can ask?" — and this file already says why: scoping it leaves a
  roofer whose only seat is on another general contractor's account editable
  by this one. The route closed that hole. **`SubForm`'s lock then read
  `hasPortal`, which is the scoped count**, so the form opened fully editable
  over exactly that contractor, and the server answered `company_not_yours` to
  a save the screen had already invited. The predicate was right, unscoped, in
  one of the two places that needed it.

  `/api/subs` now carries **both**, because they are two questions and each has
  its own consumer: `hasPortal` scoped, for the auto-schedule switch, which is
  about whether there is somebody here to ask; `answersForItself` unscoped, for
  whose record this is. A test asserts they **disagree on that one row**, which
  is the only case either could be checked against.

  It is `EXISTS`, never `COUNT`. A count of seats across every account is a
  count of how many other people hire them — their book, and nobody else's to
  collect. A bare yes/no is the whole of what drawing the right form needs.

  **And a refused save read as a save.** `updateSub` patched optimistically and
  closed the modal; `persist` only `console.error`s. So the edit sat on screen
  over a write that never happened, until a reload — which is *a save that
  reports success and writes nothing is how somebody re-types the same
  correction three times*, the failure the route itself refuses by answering
  rather than quietly dropping the company half, reintroduced one layer up. It
  awaits and **then** patches, the modal stays open with the reason on it, and
  closing clears it. The assertion is that `setEditing(null)` appears in the
  try and **not** in the catch: the first version matched the brace layout
  instead, which is a whitespace test that a reformat breaks and a
  `setEditing(null)` moved into the catch sails through.

  **What stays editable is a decision, not an oversight.** A contractor this
  account typed in — no login anywhere, no account of their own — is a record
  only this account holds, so refusing would leave a mistyped phone number
  nobody on earth can fix. That is the line: **you may correct a record you
  created, and you may never edit a business somebody else answers for.**

  And the SQL comment took the backtick trap for the fifth time: that query is
  a template literal, so naming `en_seats` in its own comment closed it and the
  whole Worker failed to parse.

- **AND `SUBFORM`'S LOCK HAD BEEN DEAD SINCE THE DAY IT WAS CORRECTED, BECAUSE
  THE FIELD IT READS NEVER REACHED THE BROWSER.** The entry above is the fix:
  `/api/subs` carries `answersForItself` unscoped, `hasPortal` scoped, and the
  form reads the first. `hydrateAccount` then dropped it — `splitSeed`'s two
  whitelists are `COMPANY_FIELDS` and `ENGAGEMENT_FIELDS`, and a field that is
  neither a `companies` column nor an `engagements` one is silently not carried,
  which is why `hasPortal` and `docs` are named there by hand. So
  `locked = !!existing?.answersForItself` was `!!undefined`: **permanently
  false, for every row, on every account.** The three-step form opened fully
  editable over exactly the contractor the predicate was corrected to protect,
  and the server answered `company_not_yours` to a save the screen had already
  invited — the screen-is-looser-than-the-route lie, reintroduced one layer up
  from where it was fixed.

  **No static check could see it.** The route is right, the component is right,
  and `locked = !!existing?.answersForItself` reads exactly as intended — the
  misspelt-capability shape, which this file already records as the one failure
  mode mutation cannot catch, in a new place: a field that is absent is
  indistinguishable from a field that is false, it fails closed in the direction
  that opens the form, and nothing anywhere reports it.

  **And `test:subedit` had been RED for just as long, which is worse than it
  being green.** Its fixture still set only `hasPortal`, so it was asking the
  *old* question of the new predicate — 21 passed, 10 failed, every failure
  reading as *the fix does not work* rather than as *the fixture asks the wrong
  thing*. A suite that is red for a stale reason is a suite nobody reads, and
  the one real bug in it was underneath. Both halves fixed: the field is carried
  in `hydrateAccount` beside `hasPortal`, and the fixture sets both predicates —
  `false/false` for the editable row, `true/true` for the locked one — because
  only a row they **disagree** on can tell the two apart at all.

- **An invited contractor who never arrived can be finished by hand, and the
  feature is NAMING what is blank.** `PortalInvite` could resend the link and
  that was the whole of it: a record somebody typed off a business card sat with
  no trades, no coverage and no documents, and the only way to find out which
  was to open the three-step form and read all three. A count would have been
  the same failure in one number — *2 of 6* does not say which two, which is the
  distinction the subcontractor's own checklist already earned.

  `app/shared/setup.js` is the one rule. `setupGaps` names what is missing and
  **which step each one is on**, so *Continue setup* opens the form where the
  work is rather than at step 1; `firstGapStep` is that choice, and `openStep`
  threads it through `SubForm` so there is one form and not a second copy of it.

  **The gate is `mayFinishSetup`, which reads `answersForItself` and never
  `hasPortal`.** That is the entry above, applied: filling a company's details
  in is a write to the shared `companies` row, so offering it over a contractor
  somebody else answers for is inviting a save the route refuses with
  `company_not_yours`. The scoped question — *is there somebody here to ask* —
  is the auto-schedule one and is the wrong one here, and the test fixture puts
  a seat on another account so a scoped check fails it.

  **Documents count by PRESENCE, never verification**, the same rule the send
  gate and the nav badge follow: nobody verifies their own paperwork, so asking
  whether this account has approved it would leave a row permanently blank after
  all four were uploaded. And it reads **`REQUIRED_KINDS`**, so the signed
  agreement is never a gap — it is the hiring account's own form, and a to-do
  nobody can tick is the permanently-amber failure `docs.js` exists to prevent.

  It is drawn on a **plain surface rather than amber**, because an unfinished
  record somebody is about to finish is a to-do and not a problem — the same
  distinction the never-added dot makes by being hollow.

  **And it forced one list too many out, for the fourth time.** `DOC_LABELS`
  lived in `App.tsx` and again in `worker/mail.js`, agreeing by luck — the shape
  `shared/trades.js` was created to close and `INSURANCE_LINES` was merged to
  close again. A rule module naming a document needs the words, and a third copy
  in the place where being wrong is least visible — an email naming a document
  by a word no screen uses, about a row the reader then cannot find — is what
  made the merge compulsory rather than tidy. It is in `shared/docs.js`, beside
  `DOC_KINDS`, which already decides what a kind *is*.

  **`export … from` re-exports without binding either name locally**, so
  `mail.js` loaded fine and `missingDocs` threw `DOC_KINDS is not defined` on
  the first email sent — a module that is correct until it is used. Imported and
  then re-exported. The assertion that caught it was an existing one that
  actually *calls* `docRequestEmail`; the two new ones name the cause, because a
  static check that only looks for the import passes on the broken form.

- **There was no way to take a contractor off a roster, and the answer is a
  status rather than a delete.** `engagements.status` has carried `ended` since
  the schema was written and nine reads across the Worker and its migrations
  guard on it. **Nothing anywhere ever wrote one.** So the only way to stop working with somebody was
  to leave them on the roster and not pick them — the eighth time this file has
  recorded correct pieces with no way in, and the first where the missing piece
  was a column that already existed.

  **A DELETE IS REFUSED, three times over, and every reason is already in this
  file.** `companies` is a shared row read by every account that engages them,
  so deleting it takes a contractor off somebody else's roster too. The job
  history has to survive, because *were they insured on the day of that job* is
  the question a dispute asks and the work orders, releases and completion
  events are what answer it — the same rule the building handover follows when
  it refuses to move a departing client's jobs. And their certificates are
  their own records, not this account's copy of them. So `POST
  /api/subs/:companyId/end` writes a word and nothing else, and that is what
  makes it **reversible**, which in turn is what decides the confirmation:
  `ConfirmRemove` names who and says what goes, and the staff console's
  typed-name modal stays for what cannot be undone.

  **The gate is on the server, and it was not there at all.** Hiding somebody
  from the roster screen is not the same as making them unassignable —
  `POST /api/jobs/:jobId/assign` read the engagement with **no status check**,
  so the browser would have hidden them and the route issued the work order
  anyway. That is the gate-lives-in-the-browser lie, found in the one place it
  costs a contractor turning up at a job nobody meant to give them. It answers
  the existing `not_engaged`, because they are not.

  **`paused` is offered only BECAUSE that gate refuses it too.** It was read by
  nothing — no assignment check, no roster filter, no screen — so offering a
  Pause button would have been offering a control whose state nothing acts on,
  which is the screen-that-lies rule pointed at a switch. `onRoster` in
  `app/shared/roster.js` is the one predicate, read by the assign route and by
  the roster filter, and `paused` and `ended` are both off it.

  **But only ending takes the login, and that is the whole difference between
  them.** Pausing is *not right now* — a season, a lapsed certificate, a
  falling-out that may mend — and taking somebody's seat away over something
  reversible costs them their history with this account for a document that
  renews next week, which un-pausing could not give back: **re-issuing a login
  silently would hand somebody a key without anybody deciding to**, so a seat
  never comes back by itself and an invite is the only way in. Ending is *we do
  not work with them*, and there access is the thing that has to stop.
  Auto-schedule goes for both, because a flag left on against somebody who is
  not being offered work is a standing permission to write to their calendar
  that nobody is watching.

  **Live work is named and never blocks.** Same call the handover makes for the
  same reason: a repair going nowhere is very often *why* somebody is being
  removed, and refusing until it is finished hands the party you are leaving a
  hostage. The work orders stay with their jobs rather than being voided —
  voiding them here would silently cancel work somebody may already be on site
  for. `/end-check` runs **before** the modal opens, so the consequence can name
  what is booked and how many people lose access; opening the modal first and
  filling it in afterwards puts the question in front of somebody above an empty
  space, and they answer it before it is finished.

  **`onRoster` is a DENY LIST on purpose.** The obvious
  `["invited","active"].includes(status)` drops every row whose status did not
  come back — an older shape, a projection that left the column out, a seeded
  fixture — silently off somebody's roster. Unknown means on. `invited` is not
  off it either: a contractor the account typed in and has not heard back from
  is the commonest row on any roster and is given work every day.

  **And `status` came OFF the patchable column list.** `PATCH
  /api/subs/:companyId` accepted it, which was a second door that wrote the word
  and left the seat and the auto-schedule flag exactly as they were — the
  back-door-round-the-check shape this file already records about
  `mayWriteCompanyDocs`. One door, and it does the whole job.

  **What is NOT the roster gate, and must not be harmonised with it:** the seven
  `!= 'ended'` checks on invites, company-document writes and issuing an
  agreement. Those ask *is there a relationship at all*, which a paused
  contractor answers yes to — they are still your contractor, their certificate
  is still yours to read. Two questions, deliberately two predicates, and
  `shared/roster.js` says so at the top.

  **Where a removal is undone is a collapsed section below the roster**, because
  a reversible act with nowhere to reverse it from is a delete wearing a softer
  word. Folded like every other secondary panel here, with the count on the
  toggle, which is what makes closing it safe.

  **AND FILTERING PER SCREEN WAS THE BUG, WHICH IS THIS FILE'S OLDEST LESSON
  ARRIVED AT AGAIN.** The first version filtered the roster list, the nav count
  and the page head — the three screens the report was about. A removed
  contractor then went on appearing in **Registration problems**, **Documents
  to verify** and **Awaiting documents** on the dashboard, because those read
  `subs` directly, and so did the plan-limit count, the assign picker, the
  quote picker, the availability calendar, every property's vendor list and the
  emergency-contractor panel. `subs` reaches about twenty components; a
  per-screen filter is twenty places to forget one, and *fixing only the
  reported screen would have been the bug* is already written here about the
  roster noun.

  So `allSubs` is every engagement and **`subs` is the roster**, filtered once
  where it is derived. Three places read `allSubs` and each says why: the
  removed list, the card opened from it, and — the one that matters —
  **`mySub`, because a paused contractor keeps their login** and reading the
  filtered list there is exactly the *"this contractor login isn't linked to a
  contractor record yet"* empty state this file already records. `liveSubs`
  is gone: two names for one list is how a later change picks the wrong one.

  **TWO THINGS GO ON POINTING AT SOMEBODY AFTER THEY LEAVE THE ROSTER, and
  neither is visible from the card.** Both are the standing-permission rule
  that already took auto-schedule off, found one layer out.

  `accounts.emergency_company_id` kept naming them. `dispatchEmergency` does
  check, so nothing wrong would have been *done* — but it refuses at the moment
  **a tenant is reporting a flood**, and the account finds out then or not at
  all. Worse, the panel draws nothing selected once they are off the roster, so
  the column pointed at a contractor the screen could not name. It is cleared
  on the way out, which turns automatic dispatch off — the honest default — and
  the feed says so, because that is a change to what happens at 2am. Both the
  setter and the dispatch also moved from `!== 'ended'` to `onRoster`: a paused
  contractor cannot be given work, so naming one as the tenant's-tap contractor
  is the screen-that-lies rule pointed at the most expensive switch in the
  product.

  And a **live invite is a way back in**. Redeeming one writes a `users` row and
  a contractor seat on this account — the seat the removal had just deleted —
  so somebody taken off a roster could let themselves back on by opening an
  email. Revoked on `ended` only, because a paused contractor keeps their login
  and that link is still the right one to be holding; and revoked rather than
  deleted, which is what the invite list already does, since *we invited them
  and then removed them* is a thing that happened.

  Both are **counted by `/end-check` and named in the modal**, because the
  whole reason that check runs before the modal opens is to say what pressing
  costs, and these are the two costs nothing else on the screen shows.

  Three assertions could not fail and mutation caught each one. A bare
  `/Add back/` found the card's own control and passed with the button deleted
  from the list — the `.embed-code-btn` trap again. `className="offroster"`
  survives inside `{false && (...)}`, so the assertion has to read the **gate**
  rather than the markup under it. And *it asks first* checked only that a modal
  was rendered, which is satisfied by a button that also ends the engagement —
  the property is that **agreeing** is what does it, so the assertion reads
  `onConfirm`.

  And one live bug the suite found on its first run: `engagementLiveWork`
  selected `w.number`, and the column is `wo_number`. The query threw,
  `missingSchema` recognised "no such column", and the catch — written so a
  database behind the code could not make removing somebody impossible —
  reported **zero booked jobs** on a contractor with two. *A catch wide enough
  to hide a real error is a catch that will*, for the fifth time, in a new
  place.

- **Removing somebody asks first, and a filter panel does not open itself.**

  **Two removals fired straight off a trash icon.** The row vanished, the
  request went, and the only way to find out you had hit the wrong row was that
  the wrong person was gone — a teammate's seat in Account → Users, and a tenant
  in Account → Tenants. A trash icon in a list is a one-pixel target beside
  every other row's, on a screen run from an iPad.

  `ConfirmRemove` is **not** the typed-name confirmation the staff console uses
  for deleting an account or a company, and the difference is the point: this
  takes away a *seat*, which can be given back by inviting them again, and
  making somebody type a colleague's name to do it would train them to type
  names. **Typed confirmation is for what cannot be undone.** What this owes
  them instead is naming who, and saying what actually goes — *remove user*
  does not say whether their jobs, reports and reviews go with them, and that
  is the thing somebody hesitates over. The tenant's names the **unit and the
  building**, because "remove tenant" on a portfolio screen does not say which
  home.

  A failure **leaves the modal open with the reason on it**. Closing on failure
  would read as success, which is the one outcome worse than the silent removal
  this replaces — and the tenant path used to remove the row optimistically and
  report failure into a note beside a list the person had already gone from.

  **"A modal appeared" is not the property under test.** The modal could appear
  *and* the request still go, so the test counts the API calls: zero until
  somebody agrees, one afterwards. And **Cancel has to leave them there** — a
  modal whose Cancel removes anyway is worse than no modal, because it was asked
  and answered. Both are mutation-checked.

  **And the filters start folded.** A panel that opens itself puts six controls
  between the search box and the first row, so the screen answers *how would you
  like to narrow this* before it has shown anybody what there is. The search box
  stays in both, because searching is what somebody came to do and it is one
  box. The **active count rides on the toggle**, which is what makes closing it
  safe: a narrowed list is never silently narrowed.

  The tenants panel had no toggle at all — always expanded, same cost with no
  way to pay it down — and folding it hit the trap this file already records:
  **`[hidden]` is a UA rule at the weakest specificity**, `.tn-filter-row` sets
  `display:flex`, so it needed `.tn-filter-row[hidden]{display:none}` *after*
  that rule. The test reads the **computed** display rather than the attribute,
  because only the computed value knows whether the override fired — and
  deleting it is a mutation that fails.

  Two test traps worth keeping. A `page.evaluate` returning a **DOM node** throws
  rather than returning a partial object, which reads exactly like the screen not
  having rendered. And the first line of a `.user-row` is the **avatar
  initials**, not the name, so a check on it found "RB" and reported a screen
  that had opened perfectly as not having opened.

  **Still open, and it needs a decision rather than a guess:** what should happen
  when the person removed is the last one who can answer for an account or a
  company. `DELETE /api/account-users/:userId` removes the *membership*, not the
  `users` row — a person is global and holds seats in many accounts — and it
  already refuses `cannot_remove_self` for an admin, so an account cannot reach
  zero admins through it. Cascading to delete the account or the company row is
  a different and much larger act, and getting the trigger wrong destroys
  customer data.


- **"THAT ACCOUNT HAS NOBODY ON IT TO SIGN IN AS", OVER A HEADER READING "1
  TEAM USERS".** Two queries disagreeing about one account, in front of
  somebody who could see both at once. The KPI counts `memberships WHERE role
  <> 'contractor'`; the impersonation route looked up
  `memberships WHERE account_id = ? AND role = 'admin'`. A project manager
  satisfies the first and not the second.

  **An account with no admin is not a rare shape, it is one the console makes.**
  `POST /api/platform/accounts` writes an admin membership only **inside
  `if (ownerEmail)`**, and `POST /api/platform/accounts/:id/users` defaults to
  `pm` (`["admin","pm","contractor"].includes(b.role) ? b.role : "pm"`). So an
  account created without an owner address and then given one person is exactly
  this, and **nobody could get into it to find out** — which is the only way
  anybody would have.

  **Widening the default gates nothing, and that is why it is the right fix
  rather than a relaxation.** The route has accepted a named `userId` for *any*
  role since support needed to see what a subcontractor sees — still a seat on
  that account, still read from `memberships`. So `role = 'admin'` was never a
  permission boundary; it only decided what happened when the caller named
  nobody. `app/shared/seats.js` picks admin, then pm, then owner, tenant,
  contractor.

  **It CHOOSES rather than taking the first row back.** acc3 in the fixture has
  a tenant as well as a pm, because taking the tenant would open a guest seat
  scoped to named buildings and call it the account — and a fixture with one
  seat on it passes whichever rule is in force. An **unrecognised role sorts
  last**, not first: ranking it zero would silently make it the default the day
  a role is added.

  **The restricted view says why it is restricted.** A pm seat cannot reach
  Account, billing or branding, so landing in one and finding half the nav gone
  reads as the console having failed. `fellBack` and `accountHasAdmin` come
  back on the reply and the banner says both — the seat, *and* that the account
  has no admin, which is the thing actually wrong and the customer's to fix.
  An admin sign-in says neither, because a banner that fires every time is a
  banner nobody reads.

  **And the error that remains is a different error.** `no_admin_on_account` is
  gone; `no_seat_on_account` fires only when there is genuinely nobody, and the
  screen names the way out — add a user — rather than stating a fact. The test
  pins that the browser no longer answers the **retired code**, because a screen
  left handling a code the server stopped sending falls through to a raw
  `e.message` and reads as an unexplained failure.

  **Still open, and a product decision rather than a refactor: an account can
  exist with no admin at all, and nothing tells its owner.** Three things point
  at it — the console's account INSERT skips the admin without an email, its
  add-user defaults to `pm`, and `DELETE /api/account-users/:userId` only
  refuses `cannot_remove_self`, which stops an account reaching zero admins
  through *that* door and not through the others. The console now says so while
  somebody is signed in as one; what it does not do is list such accounts, and
  that is where it belongs.

- **An empty modal is a child that threw.** There is no error boundary, so a
  throw during render blanks the whole page — except inside a modal, where what
  is left is a white box over an intact screen. I produced one in this very
  change: `STEPS[step - 1].label` with `STEPS` emptied for the locked form. It
  is worth knowing as a diagnosis, because it is what a "white modal" report
  means, and the cause is always an unguarded read in the modal's own subtree.

- **A disabled control with no reason beside it is indistinguishable from a
  broken one.** `SubForm`'s Save is gated on **all three** steps being complete;
  the hint under it was gated on **the current** step being incomplete. So
  standing on step three with step two unfinished, the button was dead and the
  screen said nothing at all — reported, correctly, as "won't let me edit".

  It is not an edge case. A contractor who arrives through the public
  application form has no capability and no coverage area, so step two can never
  be satisfied by accident, and the roster's own Edit button is the first thing
  anybody presses on them. The hint now fires on `!stepOk || (step === 3 &&
  !valid)`, names the step that is holding it and offers the way there. The
  general rule: **whenever a control's disabled condition is wider than the
  message beside it, there is a state where it is dead and silent** — and the
  test for it has to put the form in exactly that state, with the current step
  passing.

- **A form that edits part of a record must not replace the whole of it.**
  `SubForm` knows about three documents; `DOC_KINDS` has four. Its `docFiles`
  was built by listing `bond`, `insurance` and `contract` flat, and `build()`
  sends that object as the new value — so **saving any edit deleted the W-9
  reference** of anybody who had uploaded one. Their client's roster then read
  "not on file" for a document that was, and nothing had superseded it, because
  no upload happened. Silent, and only visible when somebody asked for it again.

  Spread the existing object first, then override what the form controls. The
  same shape guards every partial editor here, and the test asserts the W-9
  survives a save rather than asserting the three the form knows about.

- **A UBI is Washington's, so it is asked for in Washington and nowhere else.**
  The Unified Business Identifier does not exist in the other fifty
  jurisdictions. It is on the subcontractor's set-up checklist and on the
  compliance-pack card **only when `companies.state` is `WA`**, because a row
  nobody outside Washington can ever complete is a permanent to-do on their home
  screen — the same unanswerable question this file already refuses at signup,
  made worse by being undismissable.

  Confirmed as a decision rather than an oversight, so a later pass that notices
  the inconsistency and "fixes" it by showing the row everywhere is undoing
  something deliberate. The licence beside it takes the opposite treatment for
  the same reason: it is asked for everywhere, but **named** by state — *Add your
  Washington contractor license #* — because "contractor license" means a
  different document in each of them and the reader has exactly one in mind.

- **Signing up never requires a licence, a UBI or a document.** Several
  states have no state contractor licence at all, so it was a question a real
  general contractor could not answer, and it cost signups for nothing.
  Credentials are asked for **inside the account**, in the set-up checklist,
  where they buy something: being hireable, and later being eligible for work
  passed on by other accounts. "Add one myself" is the exception — there the
  hiring account is typing the record and has the card in front of them.

- **Gate at value delivery, not at the door.** Anything that asks a user for
  paperwork belongs at the moment the paperwork earns them something.

- **Documents carry carrier, policy number, coverage amount and expiry.** An
  expired certificate that still shows as approved is worse than a missing
  one. An expiry that lapses under an already-scheduled job does **not**
  block it — it raises an urgent request for a replacement.

  `app/shared/docs.js` is the status logic. Two rules there are load-bearing:
  **a blank expiry means "does not expire", never "unknown"** — a W-9 and a
  signed contract have no shelf life, and treating a missing date as doubt
  would put two thirds of every roster permanently amber until people learned
  to ignore the colour. And **the date that matters is the job's, not
  today's**: a certificate current now but lapsing Friday does not cover work
  booked for the Tuesday after, and assignment is the only moment anybody can
  act on that. Each upload is a row in `company_docs` and old ones are
  superseded rather than deleted, because the question in a dispute is "were
  they insured on the day of that job".

- **Auto-schedule is granted, not assigned.** An auto-scheduled job is
  written to the subcontractor's calendar as *accepted*, with no response
  window and no accept/decline buttons in their portal. That is a commitment,
  so the side paying for the work cannot switch it on for the side doing it.
  `app/shared/autoschedule.js` holds the rule and the API enforces it; the
  hiring side may ask, by email, and may always switch it **off** — taking it
  away costs a round trip and binds nobody.

  The one case where the hiring account sets it directly is a contractor with
  **no portal**: a record the account typed in, with no seat here and no
  SubSub account of their own. Nobody is going to press accept, so the
  response window just expires; turning it on is the account declining to
  wait for a reply that was never coming, not a promise extracted from
  anybody. The test for "is there somebody to ask?" is scoped to *this*
  account — a seat on some other account cannot reach this engagement's
  switch, so counting it would leave the flag settable by nobody at all.

- **A building can change hands, and it takes both parties.** A building owner
  invited onto their property manager's account is a guest there. Until 039,
  firing the manager cost them the building, its job history, its certificates
  and their own view of all three — and they could not even let themselves out,
  because the person they were leaving held the only button. That is the wrong
  answer to "what happens to my building if I change agent", and it is the same
  question a manager asks before putting a portfolio in here.

  `properties.account_id` now means **who operates it**; `owner_account_id`
  means **who owns it**. For every row that existed before 039 they are equal,
  which is the truthful backfill. `app/shared/handover.js` holds the rules.

  **Two-party, always.** One side asks, the other agrees, and the side that
  asked has already agreed by asking — so it is always the *other* side that
  decides. That rule reads the **requesting account off the row**, never from
  which side is "the owner": on a handover the owner is the `to` side, on an
  appointment they are the `from` side, so any rule phrased in owner/manager
  terms points at the requester for one of the two and moves a building on one
  signature. Note also that an owner asking is signed in to their *seat* on the
  manager's account, so the account a request arrives through is not the party
  making it.

  **The jobs do not move.** `jobs.account_id` is untouched, so the outgoing
  manager keeps every job they ran without anything being copied, and the owner
  reads their building's whole history across however many managers it has had
  (`GET /api/properties/:id/history`). Nothing is deleted to satisfy a departing
  client — a job the manager ran is a job the manager may later be asked to
  account for.

  **The roster does not move.** A manager's contractors are their own
  relationships. Only the building's *scoping* of them is cleared; the
  engagements stay. Handing a departing client their ex-manager's book is the
  accumulation this product refuses everywhere else.

  **Tenants follow the building**, because a tenant is a person who reports a
  leak at that address and their next report has to reach whoever manages it.
  Their seat, their unit and their property scope all move.

  And **a tenant keeps their own reports** across the move. Jobs never move, so
  without this a tenant who followed their building lost every report they had
  ever made about their own home — nothing on the new account, and a 403 from
  the old one, because their seat there is gone. Their own reports about their
  own home are the most personal record here and the least defensible thing to
  lose. Scoped hard: reported **by them**, at a property they are **still** a
  tenant of, read-only, with the account that handled it named — because "who
  did I report this to" is what somebody chasing an old repair is asking. Not
  the building's other repairs: sharing an address with somebody is not a reason
  to read their business.

  **An owner keeps watching a building they appointed out.** The property stays
  on their list *and* the work at it comes with them — `/api/properties` and
  `/api/jobs` both return rows for buildings the caller owns but does not
  operate, marked `ownedNotOperated` / `atOwnedProperty` and `readOnly`. Without
  the second half an owner sees a name, an address and nothing ever happening at
  it, which is being shown a card rather than seeing their building — and
  watching the property is the entire reason they are here. Every action on such
  a job is gated in one place, not per button. A guest seat never reaches any of
  it: an owner or tenant scoped to named buildings sees what that scope allows
  and nothing through a second door, including when their *host* account owns an
  appointed-out building.

  **And they may ask for work at it.** Watching is not enough on its own: an
  owner sees their own building, hears the boiler, and has no seat on the
  account that runs it, so the ordinary owner request is closed to them and the
  only remaining move is the telephone. `POST /api/jobs` therefore accepts a
  property the caller **owns but does not operate**, and writes the job to the
  **operating** account as a request — `jobs.account_id` is the manager's,
  `requested_by` is the owner, nothing is approved, and no work order can be
  issued until the manager approves it. Both feeds record it, because each side
  needs its own record of who asked. The manager is told **who** asked by name
  on the row: the person is not a member of their account, so their own users
  list will never name them, and "somebody asked for work" is not something
  anybody can act on. The property is the only thing that decides whose account
  the work lands on, and a building the caller neither owns nor operates gives
  the same `property_not_found` as one that does not exist. Scoped seats are
  unaffected — a guest still cannot reach past its own buildings.

  **And urgency is not a way round the approval.** `dispatchEmergency` approves
  the job and issues a work order against *the account's own* emergency
  contractor, so run on the owner's side of a cross-account request it would
  approve the manager's job from outside and engage the **owner's** contractor
  on it. A cross-account request therefore never auto-dispatches; the urgency is
  recorded for the manager, who holds the contractor, the money and the
  decision. Anything that later dispatches from a request has to answer the same
  question: whose account is the work on, and whose contractor is being spent?

  On the screen, what the form says follows **the building, not the role**. The
  owner is an admin of their own account, so the role says "create a job and
  find contractors" — a screen they will never be given for a building somebody
  else runs. So the form reads *Request work*, names the manager, and sends
  rather than creates; the picker marks which buildings are somebody else's to
  run before anything is sent. For the same reason, managing the *account* is
  not managing *that building*: the vendor affordances on such a card are gone,
  because scoping our contractor to their building answers a question that is
  not ours to ask.

  **Open repairs survive the move, without moving.** A building can change hands
  with a repair half done, and because jobs do not move the incoming manager saw
  *nothing*: no sign a contractor was due Tuesday, nobody to let them in, nobody
  to verify the work, and a tenant waiting on a leak the new manager had never
  heard of. The contractor turns up at a building whose manager has no record of
  them. That is the worst moment this product can produce and it happened
  silently.

  The answer is not to move the jobs — the outgoing manager issued the work
  order, owes the money, and is the party the contractor has an agreement with,
  and moving them would hand a departing client their ex-manager's book. So the
  incoming operator gets the **roll-up shape**: `inheritedShape` in
  `app/shared/handover.js` passes what is wrong with the building and when
  somebody is due, and withholds the company, the price, the crew and the work
  order number. A count, a trade and a date — the same line the waiver roll-up
  draws, for the same reason. No new column: a job is inherited when this
  account operates the property, the job sits on another account, and it is not
  finished, so it drops off by itself when the previous manager closes it out.

  This is deliberately *stricter* than what an **owner** sees of work at a
  building they appointed out, and the two must not be harmonised. The owner is
  the client: the contractor is working on their building and they may know who.
  The incoming manager is a rival firm, and a portfolio handover would hand them
  every contractor on it. Same read-only shape, different redaction, for a
  reason.

  `assignments` on that shape is **empty, not absent**. Every screen assumes a
  job has one (`j.trades.filter((t) => j.assignments[t])` in a dozen places) and
  handing them a job without it white-screened the jobs list. Empty is also the
  honest answer: this account has assigned nobody.

  Both sides are **told at the moment of transfer**, on the decision panel and
  in both feeds — silence there is exactly how a repair gets dropped between two
  companies that each assumed the other had it. It never *blocks* the transfer:
  a repair going nowhere is very often why somebody is changing agent, and
  refusing to release a building until the work is finished hands the outgoing
  manager a hostage.

  Two things this uncovered, both live before it. The panel promised that
  "its jobs ... become yours to run", which is the one thing a handover never
  does. And `canComplete` answers "may this **role** complete jobs", not "may
  they complete **this** job", so *Mark job complete* was offered on work
  another account was running — an owner could close out their manager's repair.
  Read-only means read-only, and the gate belongs with the other one, on
  `j.readOnly`.

  An owner then holding their building may **appoint** a manager — the same
  two-party rule in reverse, and the manager must accept, because a building
  appearing in a portfolio unannounced is work, liability and possibly a plan
  limit. An appointment moves **operation only**, so the owner never loses the
  right to move their building again.

  **Appointing is the owner's move, and the columns cannot say so on their own.**
  The API always checked ownership — but 039 backfilled
  `owner_account_id = account_id` for every row that already existed, which was
  the only safe backfill and also means every building a managing agent had
  typed in reads as theirs. So the ownership check waved an agent through to
  appoint a *client's* building onward. The missing distinction is already
  modelled in `ACCOUNT_KINDS`: a property manager's account **invites** owners,
  because somebody else owns the buildings; a building owner's account has none
  to invite, because they *are* the owner. `canAppoint` in
  `app/shared/handover.js` therefore also asks whether this **kind** of account
  is the owner or acts for one, and the API and the screen both read it.

  An agent is not stuck, and the screen says so rather than going blank: they
  add the owner, the owner takes the building (two-party, as ever), and the
  owner appoints whoever they like. That is the chain working, rather than an
  agent sub-contracting an instruction that was never theirs to move.

  **And a firm that really does own a building says so.** Account kind closed
  the backfill hole and closed it on a real case too: a management firm owning
  a building of its own. No reading of the columns separates that from a
  client's building, because 039 wrote the same value for both — so 040 adds a
  **declaration**, `properties.owner_declared_at` and `.owner_declared_by`. The
  same shape as `scope_kind = 'labor_only'`: something somebody says out loud,
  with a name and a date against it, rather than an absence nobody recorded.

  Three properties hold it in place. It is **per building**, never per account,
  or a firm with two hundred client buildings and two of its own would unlock
  all two hundred and two by declaring one. It **never outranks ownership** —
  `canAppoint` checks who owns the building first, so a declaration cannot be
  used to claim somebody else's, and one left on a row whose owner later changes
  stops counting. And it is **reversible**, because a claim somebody mis-tapped
  should cost nothing to withdraw. Declaring and withdrawing both write to the
  event log and the feed: claiming a building as your own firm's is the sort of
  thing that gets asked about later.

  **The two sides of a transfer get different counts of open work**, and they
  only coincide when there has been exactly one previous manager. What the
  outgoing side is told is *their own* open work — "1 stays yours to finish" —
  because the repairs a manager before them left are not theirs to chase. What
  the incoming side is told is every open repair at the building that will not
  be theirs, leftovers from earlier managers included, because that is what they
  are actually taking on. An earlier version answered both with the outgoing
  side's number for the sake of a matching figure, and quietly told somebody
  appointed to a building with two managers' leftovers about one of them. The manager is named by **whole
  subdomain**, and an unknown one and a real account that cannot manage
  buildings give the **same answer**, so this cannot be walked to find out who
  is on SubSub.

- **A portfolio is scanned, so the property tile carries only what you scan
  for.** Every card used to hold the vendor chips, the owners panel with its
  invite chasing, the whole handover conversation, the notes and four buttons, in
  330px columns. Eight buildings were several screens, and the question a
  portfolio is opened to answer — which of these needs me — was below the fold on
  card two. The tile is now the name, the address, who runs it when that is
  somebody else, and the counts; `.prop-detail` in a wide modal holds the rest.
  Roughly 97px and four to a row where it was 220px and three.

  **The counts stay on the tile and stay followable.** "Five open jobs" with
  nowhere to go was the original complaint about this screen, and burying the
  numbers a tap deeper to make room would have undone that fix to pay for this
  one. The name is the way in rather than the whole tile, because a button inside
  a button is not a thing and the counts have to keep working as buttons.

  The detail panel reads the property **out of props on every render**, not from
  the row it was opened with. Editing, adding an owner or answering a handover
  from inside it changes that row, and a panel still showing its opening copy is
  the stale-snapshot bug this file has grown twice before.

- **The side being asked may see who is asking.** Accept and Decline with
  nothing but a name is a decision made blind: the card says these people will
  be able to send you work orders and read your compliance documents, and gave
  no way at all to find out who they are. So a pending connect request opens a
  profile of the **asking** account.

  This is not the directory this product refuses, and the difference is
  structural rather than a matter of care. The route is keyed by the
  **request**, never by an account, so there is no endpoint that takes an
  account id and describes it and nothing to walk. It answers only the company
  the request was addressed to, and only while the request is still **pending**
  — a declined one is finished business and an accepted one means they are
  already working together. And it is **counts and areas, never lists**: how
  many buildings and which towns, never an address; how much work has gone
  through, never which jobs. Their contractor roster is not in it at all, and
  not as a count either — that is their book, and it tells the answering side
  nothing about whether to say yes.

  The principle is the one overflow already runs on: answering a post makes you
  known to the account that posted it, because you chose to answer. Asking to
  connect makes you known to the account you asked, for the same reason and for
  exactly as long as the question is open.

- **A two-party handshake has to be visible to the second party.** Since 031
  an account is a company too, so a hiring account can ask *another account* to
  connect. The request was written, the asking side showed "waiting on their
  answer", and the answering side showed nothing: the only screen rendering it
  was Account → Company, and the amber badge that would have pointed at it sits
  in the contractor portal's nav, inside `can("portal")` — which `ROLES.admin`
  does not include. So a request sat pending forever with nobody able to find
  it. The API was right the whole time; `/api/my-connect-requests` answers an
  admin seat correctly, and `companyHasLogin` already refuses to create a
  request nobody could answer.

  It is on the **dashboard** now, above "Waiting on contractors" — its exact
  mirror, one being who we are waiting on and the other who is waiting on us —
  with the count badged on the nav so it is findable from anywhere. The general
  rule this is an instance of: **whenever one side of a handshake is told it is
  waiting on somebody, find the screen where that somebody answers, and check a
  seat that role actually has.** Connect, handover, completion, overflow and job
  approval are all this shape, and the badge living behind a capability the
  answering role lacks is a silent way to break any of them.

- **Asking for a new password is a screen, not a side effect of a link.** The
  branded sign-in page asked two questions at once: *Forgot password?* sent the
  email and changed nothing else, so the password box, the *Sign in* button and
  whatever error the last attempt had left were all still there. Press Sign in
  with no password, then press Forgot password, and the page said **"Enter your
  email and password"** and **"Check your email for a reset link"** together —
  one of them no longer true — above a form still demanding the password a link
  had just been sent to replace.

  Both messages used `.login-err`, which has a red background and a red border;
  the success only overrode its text colour, so a sent link was drawn as a
  failure. `.login-ok` is the green one. **A success is not an error in a
  different colour** — overriding `color` on a box whose background and border
  carry the meaning changes the one part that was already fine.

  Reset is its own mode now: email only, *Send reset link*, *Back to sign in*,
  and switching clears whatever the sign-in attempt left, because that message
  is about a form that is no longer on screen. The reply is **the same whether
  or not the address has an account** — "if that address has an account here" —
  since a reset form answering "no account found" is a way to ask which of a
  list of addresses is on SubSub, which is the enumeration refused everywhere
  else. Supabase answers that way too; the screen only has to avoid undoing it.

  The link lands on `AuthLanding`, which already takes a new password twice and
  handles an expired one. That half was right; only the asking was wrong.

  **And the page had no way past it for somebody with no account.** Under
  *Forgot password?* there was a password box, a Google button and a dead end.
  Every other route into SubSub hands people a link — an invite, a pack, a QR
  code, a scanned code — so the one person this screen offered nothing to is the
  one who **typed the address in**, which is exactly the general contractor the
  whole marketing site is written for.

  *Don't have an account? See plans and sign up* → `subsub.work/pricing`. Two
  things about it are decisions rather than details. It is **only on SubSub's own
  front door** (`brand.isSubSub`): a customer's branded page has its own answer
  directly above it — *apply to work with them* — and a second call to action
  beside that competes with the one thing a branded sign-in page exists to do.
  And it **leaves the app**, because there is no signup form in this bundle at
  all; it goes to the plans rather than straight into setup because choosing one
  is the first question `get-started.html` asks.

  The general rule, which is what made this worth a test of its own: **a link
  from the app to the marketing site is a link across two origins, and nothing
  builds both.** It resolves or it 404s with nothing in between. `test:discover`
  now walks every `subsub.work/...` URL in `App.tsx` and checks it against the
  files in this repo and `_redirects`. `/pricing` gets an explicit redirect
  rather than resting on Cloudflare Pages' extensionless-URL default, because a
  platform behaviour that is not in this repo is not something the signup funnel
  should depend on — and a silent 404 there looks exactly like nobody wanting to
  sign up.

  **And the form behind it answers three different problems, not one.** The page
  called Supabase's `/auth/v1/recover` straight from the browser, which answers
  200 for an address it has never seen — deliberately, so it cannot be walked to
  find out who has an account. So "a reset link is on its way" was said in three
  situations and was true in one:

  1. A real login. It sends.
  2. A `users` row with `auth_id` null — added from the console, or an applicant
     who never finished. Nothing in Supabase to recover, so nothing arrives.
  3. **An invited subcontractor who never opened their link.** A sub invite is a
     token; the `users` row is written by `createApplication` when they *redeem*
     it. Before that there is no user, no password, and no amount of resetting
     makes one — what they need is the invitation again.

  Case 3 is not hypothetical: a roofer invited by a property manager, told a
  link was coming, with no way out but somebody at the hiring account noticing.
  Only the server can tell the three apart, so `POST /api/password-help` does —
  creating the missing login before recovering for case 2, resending the **same
  invite token** for case 3 (reissuing would kill the link already in their
  inbox) — and **says the same sentence for all of them**.

  Two properties hold it together and they pull against each other. It does the
  right thing per case, and it answers **one status and one body** whichever
  branch ran, because a form that replies differently for a known address is a
  way to ask which of a list of addresses is on SubSub. Even the failure path
  returns `{ok:true}`: a 500 on a known address and a 200 on an unknown one is
  the same oracle wearing a different hat.

  What makes it safe to expose at all: **every branch sends only to an address
  already on a row here** — a user, or an open invite an account addressed to
  them. An address SubSub holds nothing for gets nothing, so this cannot be
  pointed at a stranger's inbox. Rate-limited twice, per address and per IP: the
  first stops somebody mailbombing a person they know is here, the second stops
  a list being worked through. And `redirect_to` is validated against
  `*.subsub.work` rather than trusted, because an emailed link plus an unchecked
  return address is an open redirect.

  The confirmation names **both** readings every time — a password reset *or*
  the invitation again — because it has to be true for either, and naming only
  the one that applied would say which ran.

  **And staff can see who never arrived.** Being on a roster and being able to
  sign in are two different records: a `companies` row plus an `engagements` row
  is what an account gets the moment it adds or invites somebody, and it is what
  the Contractors screen draws. A login is a `users` row plus a `memberships`
  row with role `contractor`, written only when somebody opens the invite link
  and fills the form in. So an account can hold a roster of ten with nine unable
  to get in, and nothing said so — not to the customer, and not to staff, because
  the console reads accounts and their own users and carried sub invites
  nowhere. The only way to find the roofer was SQL against D1.

  `GET /api/platform/stuck-subs` and the console's **Not arrived** screen.
  `app/shared/stuck.js` decides what counts, so the route and the tests cannot
  disagree. Three populations, because they need three different actions: an
  **unredeemed invite** (resend, or re-issue an expired one), a **company with
  no seat behind it** (nobody can sign in as them at all), and a **seat never
  signed in to**.

  Two things carry the screen. **Ours is separated from theirs**: a send that
  failed, or one that never happened, is SubSub owing somebody an email, while
  an invite nobody has opened is a customer nudging a contractor — identical
  from the outside, different jobs, so ours sorts first and is tinted. And
  **one person is one row**: San Juan Exteriors had both an open invite and an
  `invited` engagement, and listing both reads as two problems and doubles every
  count.

  Whether mail is configured at all is reported once at the top rather than as
  fifteen identical row errors, because one cause explains all of them — and
  `mail_not_configured` means no invitation, reset or notification has ever left
  the building, which is the first thing to rule out before chasing anybody.
  Acting on a row still means opening the account: resend and re-issue live on
  its Contractors screen where the audit trail says who pressed them. This
  screen is for **finding** them.

  **And the account can finally act on one.** Finding them was only half of it:
  there was no way to get a contractor *from* the roster *to* a login. The
  Contractors screen drew a company with no seat behind it exactly like one with
  a seat; the only invite flow started from a blank form, so it meant retyping a
  name and an address the card was already showing, past a warning saying you
  already have a contractor with that name; and `password-help` could only
  resend an invite that already **existed**, which for a contractor nobody ever
  invited is nothing at all. Three dead ends for the same person.

  `POST /api/subs/:companyId/invite` is the missing step, started from the
  record: prefilled from the company row, no warning, and on the card itself —
  `PortalInvite` renders only when `!sub.hasPortal`, where somebody is standing
  when they notice.

  It writes `sub_invites.company_id` **at creation** rather than only on
  redemption — same column, one step earlier, no migration — and
  `createApplication` takes a `boundCompanyId` that outranks every guess below
  it. That is load-bearing: deduping by licence or email only lands back on the
  right row if the applicant retypes what the account already holds, and "close
  enough, usually" is how a roster grows a second copy of somebody. Removing the
  binding makes the test mint a second San Juan Exteriors.

  An invite already out is **resent, not replaced** — two live tokens for one
  contractor is two links in one inbox and a list that reads as two people, the
  same reason `/api/invites/:id/resend` reuses its token. Which is matched on
  the **address as well as the company id**: every invite raised before this
  route existed came off the blank form and carries no `company_id` at all, so
  looking only at that column missed all of them and minted a second live token
  for somebody who already had one — the exact thing the rule refuses. One found
  that way is **adopted** on the way past, so from then on it names the company
  it is for.

  The card distinguishes the two, because "Send invite" over a link already
  sitting in somebody's inbox reads as a first contact and hides the thing worth
  knowing: one went and nothing came back. Outstanding reads *Invited, not
  opened yet*, says when it last went, and the button says **Resend invite**. Somebody else's
  contractor and a company id that does not exist both answer `not_found`, so
  this cannot be walked to find out which ids are real.

  **And the link asks for the one thing that is missing.** Sending it was only
  half of the dead end. The token landed on the three-step application form —
  company, contact, address, licence, trades, crews — every field of which the
  account had already typed in, because raising the invite *from their card* is
  what says so. Asking somebody to retype what the email they just opened was
  sent about is asking them to prove they read it, and it is where an invite
  gets abandoned. Being on a roster and being able to sign in are two different
  records; the only thing missing from the second is a password.

  So `GET /api/invite/:token` now answers `known` — the bound company's own row,
  plus the trades off *this account's* engagement — and `knownEnough`, and the
  form has a second render: their details shown back to them and one password
  box. No new exposure: the token was emailed to that company and already lets
  its holder *become* them on that roster, which is strictly more than reading
  their own phone number back.

  Three things hold it together. The details are **shown, not assumed**, and
  *Fill it in yourself* drops through to the same full form with the same state
  seeded into it — showing somebody a wrong record with no way to change it is
  worse than not showing it, and a second component would be a second copy of
  the form. It posts **the same body to the same route**, so there is one
  application flow and `createApplication`'s `boundCompanyId` still lands the
  seat on the right row. And the **email and the screen read one predicate**
  (`inviteKnownEnough` in the Worker): an email promising "a few minutes: your
  company details, the trades you cover" over a link that opens a single
  password box has described a form they will never see, and one saying "takes
  seconds" over a blank three-step form is worse. The subject changes too,
  because *invited you to join* and *added you, choose a password* are different
  news.

  `knownEnough` wants a company, a contact **and** an address, not just a row: a
  record somebody started and abandoned would otherwise seed a screen saying
  "we already have your details" over two blanks.

- **The noun was decided in three places, and the two that were not the roster
  were both wrong.** `hiresLabel` on `ACCOUNT_KINDS` had it right. But
  `seatDescription` — the line under every name in the account switcher — said
  *you are their subcontractor* whatever kind of account was hiring, and the
  contractor's own dashboard said *Subcontracting for Cascade Management* when
  Cascade is a managing agent. **A subcontract implies a prime contract**, and a
  plumber engaged directly by a building's manager is under no such thing.

  `app/shared/hires.js` is the one rule now. `ACCOUNT_KINDS.hiresLabel` reads
  it, `seatDescription` takes the **hirer's** kind, and an unknown kind gets
  *contractor*: the neutral word is right more often than the specific one, and
  a word describing a chain that does not exist is the whole failure.

  **`workingForVerb` refuses to flatter a mixed list.** There is no verb that is
  right for *three companies* when one is a general contractor and two are
  managing agents, so a list that is not all one kind says *Working for* rather
  than *Subcontracting for*. `/api/my-work` carries `accountKind` for that, and
  for nothing else.

  **The agreement's `PARTY_TERMS` deliberately stays its own copy**, and a later
  pass will want to merge it into this. It must not: those words are a
  contract's **defined terms**, frozen inside the versioned template so that
  changing one moves the version and cannot rewrite what somebody already
  signed. This one is a UI label and is always current. Same fact, two
  lifetimes.

  **And "You work for" came off the roster screen.** It was a read-only strip —
  a name, a trade list and a work-order count, with nothing on any row to do —
  and the account switcher already names every account that hires you *and*
  says what you are to each one, which is strictly more than the strip said.
  Two places answering one question is how somebody concludes there are two
  lists. `GET /api/clients` stays, because it is the correct other half of a
  connection, and nothing reads it.

  The guard for all of this strips **JSX comments as well as `//` ones**, because
  the note recording that the strip was removed names the thing it removed —
  third time this file has paid for a comment reading, to a substring check,
  exactly like the code it describes.

- **A general contractor hires subcontractors; a property manager hires
  contractors.** The Add menu offered *Contractor* to a general contractor,
  which is the wrong noun for the one kind of account the whole product is
  written for. A GC holds the prime contract, so the people they engage work
  **under** it. A property manager, a building owner and a portfolio manager
  engage a plumber directly for their own building — nobody is sub to
  anything, and "subcontractor" there describes a chain that does not exist.

  `hiresLabel` on `ACCOUNT_KINDS`, read through `rosterWords(account)`. It
  sits beside `roleLabels` and is the same kind of thing: it renames what
  somebody is **called** without changing anything about what they are or
  what they may do. A subcontractor account gets *subcontractor* too, because
  passing work further down is still passing it down a chain — which is
  exactly what the lien waiver roll-up already models, at every tier.

  **Fixing only the reported screen would have been the bug.** The word is in
  the nav, the Add menu, the page title, the dashboard tile, the set-up
  checklist, the invite modal, the plan-limit gate and the embed panel's
  pointer — and a nav reading *Subcontractors* over a checklist reading
  *Bring your contractors in* is two names for one list, which is how
  somebody concludes there are two lists. So it is one rule read in every one
  of those places.

  **It was wrong in BOTH directions and the second half is easy to miss.** The
  plan-limit gate told a property manager they had reached *3 subcontractors*,
  and the set-up checklist said *Bring your subcontractors in* three inches
  under a nav saying Contractors.

  **And the test for it made exactly the mistake it was written to catch.**
  The first version checked the GC's nav and the PM's dashboard — so a
  component left on the default word was right for one of them and the
  assertions for the other were never written. `AdminDashboard` was duly left
  unwired, the general contractor's checklist went back to *Bring your
  contractors in*, and nothing failed. **When a rule has two branches, assert
  both branches in the same places**, or the coverage is diagonal and the hole
  is invisible.

  Two smaller things. Test navigation was coupled to the label — a dozen
  suites clicked `/^Contractors/` — and those now match either word, because
  their subject is what the screen does and not what the roster is called;
  `test:rosterword` is the one place the noun is pinned. And **JSX strips the
  newline between an expression and the text after it**, so
  `on the {words.Many}\n screen` rendered as *Subcontractorsscreen* — the
  space has to be `{" "}`.

  Deliberately unchanged: the `contractor` **seat role**, which is a person
  signing in to the portal rather than a company on a roster; *Signed
  subcontractor agreement*, which is the document's actual name; and the staff
  console, which describes SubSub's own data model across every account.

- **Completion is two-party and append-only.** The subcontractor marks work
  reached with evidence; an admin **or project manager** verifies it. Neither
  side can do both. Completion is an event log, not a status flag, because
  payment releases will depend on it and "who said this was done, and what
  did they show?" has to be answerable months later. Photos are nudged, never
  required.

- **Money is whole cents and every cut is cumulative.** `app/shared/money.js`
  is the arithmetic; nothing computes a percentage of money anywhere else. A
  rate rounded per release drifts — 5% of three $333.33 milestones is not 5%
  of $1,000 — so each cut is *what should have been taken by now, minus what
  was taken before*. Basis points, never floats, never a stored figure that
  could be derived from two others.

- **The ledger is written for a processor that does not exist yet.**
  `wo_releases.method` and `.reference` are the seam: today a cheque number
  typed in, later a transfer id, with nothing else changing shape. The fee
  rate is stamped onto each release at the moment it is made, so changing the
  rate next year cannot rewrite what was charged last year — it is zero until
  payment processing ships, which is the point of having the column from the
  first row.

  **`EASY-PAY.md` is the map of what ships into that seam**, written against
  this ledger rather than beside it: what already exists (most of it), the one
  thing that does not (money — there is no funded side at all), and the legal
  shape, which is the decision everything else hangs off. Its two load-bearing
  conclusions, recorded here because they are the ones a later pass would get
  wrong: **a trust account of our own is money transmission and fifty state
  licences**, so the funds sit with a licensed partner and we send
  instructions — though "we never hold them" does not survive the escrow
  requirement intact, and §10.3 says why: the only Stripe shape that holds
  money between funding and release leaves it in a Stripe balance attributed
  to the platform, with SubSub as merchant of record. That tension is the
  legal question rather than a detail under it. And **an instant-payout fee is only honest when
  it buys a genuinely faster rail.** If we are already holding the money
  against a verified milestone and a clear waiver, any wait is one we
  invented, and charging to remove it is a fee for nothing. Paying a sub
  before the GC has funded is not a speed fee at all; it is lending, and it is
  a different company.

  That was listed there as still open for a while, and it is closed: **payment
  is now gated on cover as well as on the waiver.** See the entry below.

- **Being paid starts with Stripe deciding who you are, and coming back from
  them does not mean it worked.** Migration 050, `app/shared/pay.js` and
  Account → Company's *Getting paid*. Onboarding only: a hireable company
  connects a Stripe connected account, Stripe collects the identity documents
  and the bank details, and `payout_accounts` remembers which account is
  theirs. No funding, no transfers, no payouts yet.

  It was far smaller than it looked, because `billing.js` has talked to Stripe
  over plain `fetch` since 008 — the Node SDK wants Node's `crypto` and `http`
  and a Worker has neither. `stripeCall` already took an idempotency key and
  `verifyStripeWebhook` already did HMAC over the raw bytes with a replay
  window. **Connect added paths and event types, not infrastructure**: one
  `account` option setting `Stripe-Account`, and a second webhook route.

  **`return_url` is reached by somebody who gave up on the second screen.**
  Stripe sends everybody back, finished or not, so the return can never be
  read as success — which is the one thing about this that no static assertion
  can prove. The panel POSTs `/payouts/refresh` on landing and draws whatever
  Stripe says; a check that the component merely *mentions* refresh passes
  with the call never made, so it is driven in a browser instead. Removing the
  call fails that test and nothing else.

  **An account link is single-use and expires in minutes**, so one is minted on
  every press and none is ever stored — a kept link is a dead button with
  nothing on screen saying why. And **payable is not a latch**: Stripe asks for
  more as volume grows, so every read re-derives and a row that said verified
  goes back to pending when Stripe withdraws it.

  **Payable needs two capabilities and they fail separately.** `transfers`
  active is money reaching their Stripe balance; `payouts_enabled` is money
  leaving it for their bank. Somebody with the first and not the second looks
  paid from the hiring side and unpaid from theirs, so `payoutsReady` wants
  both and the two are asserted separately — either alone passing would hide
  exactly that state. The screen says which half is missing rather than
  "not verified", and names Stripe's requirement keys in words: *a photo ID*,
  not `individual.verification.document`.

  **One connected account per company, held twice.** The idempotency key makes
  an ordinary double-press cost nothing; the unique index is what is correct
  when two requests arrive at once, which a pre-check cannot cover — the same
  pairing, for the same reason, as `ux_job_sources_external`.

  **And the key carries the controller's shape, because a refusal outlives the
  fix for it.** Stripe saves the status and body of the first request made
  under a key and replays them for 24 hours — an error as faithfully as a
  success. So when `losses.payments` was corrected and deployed, every press
  afterwards was still answered by the *previous* request, and the panel drew
  the identical sentence. That reads as the fix not having worked, and no
  amount of looking at the screen can tell the two apart: **a replayed 400 and
  a live one are the same words.**

  `payoutAccountKey` is `payout-acct:<companyId>:<controller shape>`, and both
  halves survive: same company and same controller give the same key, so two
  tabs still cannot mint two connected accounts; a changed controller gives a
  different one, which is exactly the case where the saved answer was given
  about terms no longer on offer. **Derived rather than a `v2` somebody
  bumps** — a version constant beside the controller is two records of one
  fact, and the next person to change the controller would get a cached answer
  about the old one, which is this bug again with nothing new to learn from it.
  Only the controller goes in, never the company's email: that changes for its
  own reasons and would mint a second account when it did. Sorted, so
  reordering the literal is not a change. `PAYOUT_CONTROLLER` lives in
  `shared/pay.js` beside the key for the same reason — the request and the key
  are one fact, and holding them apart is what let this happen.

  **And the shape in the key is only half of it, because half of what refuses
  this call is not ours.** A Stripe account setting, an API policy, a
  capability — fix one of those and the request is byte-identical, so the key
  does not move and the next press is still answered by the refusal from
  before the fix. A guaranteed day-long dead end on the one screen a
  subcontractor cannot get paid without, and it happened twice in two days:
  the controller, then Stripe closing Accounts v1 to new integrations.

  So **a replayed refusal is asked again under a fresh key**, and the reason
  that is safe is the whole of why it is allowed: *a refusal created nothing*.
  A 4xx means Stripe minted no account under that key, so a second key cannot
  duplicate one. A replayed **success** never reaches it — that is a 200, and
  it is exactly the double-press the key exists to absorb. A **fresh** refusal
  is not retried either: it is this attempt's own answer, and asking again
  would be two live creates for one press. The row is re-read first, because
  the press that got the refusal replayed to it may have been racing one that
  succeeded.

  **And a replay says so on the screen**, with Stripe's own words leading:
  they are the only actionable thing, and the first version buried them behind
  the caveat.

  The old assertion was `/^payout-acct:/`, which passes for either key: the
  could-not-fail shape this file keeps catching, on the one field that mattered.

  A rejected account is **refused rather than sent round the form again**, an
  `account.updated` for a connected account we hold no row for is accepted
  **quietly** (Stripe delivers for every account on the platform and a 4xx
  would make it retry forever), and the webhook **removes its own
  `stripe_events` row** before answering 500, or the retry it is asking for
  would be deduped away.

  The panel sits behind the same gate the route uses — `canManage` and a
  hireable kind — because a panel a project manager can open onto a 403 is the
  screen-that-lies rule pointed at a permission.

  **Nothing here is a bank detail.** `processor_account_id` is the whole of
  what is stored; account and routing numbers are Stripe's to hold.

  **And `STRIPE_API_BASE` finally got spent.** It was put in `billing.js` so
  Stripe's refusals could be tested "without making Stripe refuse something",
  and nothing had ever used it — there was no test for the billing integration
  at all. The payout suite stubs at `fetch`, which is the same boundary and
  lets the request shape be asserted: which call carries `Stripe-Account`,
  which carries the idempotency key, that `card_payments` is never requested.

  **Three traps this file already documents, all hit again in one change.** A
  backtick in a CSS comment closed the `CSS` template literal and the whole app
  rendered nothing behind one `dot is not defined`. `.portal-panel h4` is
  `text-transform:uppercase` and Chrome's `innerText` applies it, so a
  case-sensitive heading match was testing the stylesheet. And the first
  version's negative assertions (`!/x/.test(p?.text || "")`) were satisfied by
  a **missing** panel, so they reported loudest exactly when the subject had
  disappeared — the inverse of the read-through-`link?.` lesson.

  One thing the build changed outside itself: **adding an invariant to
  CHECK.sql used to mean remembering to edit a regex in
  `schema-drift-test.mjs`**, which classified must-be-zero invariants by a
  hand-kept list of name endings. The first new invariant since that test was
  written duly reported itself as an unrun migration. An invariant now says so
  in its own name (`_inv_`); the three older ones keep theirs because CLAUDE.md
  names them and they are read by hand.

- **Nobody connects anything, and nobody leaves SubSub.** Two decisions, and
  the first one is about shape rather than code.

  A screen offering *Connect a Stripe account* asks somebody to opt in to
  plumbing. A company that can be hired needs a payee record to be paid, and
  that is not a decision they get to make differently — so the connected
  account is minted the first time the screen is opened, and what is left for
  them is the only part they can answer: who they are and where the money
  goes. `POST /api/payouts/session` does both, and the panel calls it on
  mount.

  And the onboarding is **embedded**. The account link sent somebody to
  stripe.com, which is a second company appearing in the middle of getting
  paid by the first. An Account Session plus Stripe's own onboarding
  component renders that form inside our page; Connect.js loads by script tag
  exactly as Stripe.js already does, so the bundle gains no dependency.

  **`stripe_dashboard` is `none`, not `express`.** Express gives the
  subcontractor a Stripe-branded website to be sent to, which is the whole
  thing being avoided — and it follows that SubSub then owes them every
  screen, so the session also enables `account_management`, `payouts` and
  `notification_banner`. There is nowhere else those can be seen.

  **And that choice decides who carries the losses — it is not a free field.**
  This entry recorded `losses.payments: "application"` beside it, and Stripe
  refuses that combination outright: *"When `stripe_dashboard[type]=none` and
  `requirement_collection=stripe`, Stripe must be liable for negative balances
  or refunds and chargebacks."* So the panel was dead on arrival — the first
  press answered a refusal rather than an onboarding form.

  Three ways to satisfy it and two are refused in this file's own words:
  `requirement_collection: "application"` moves the compliance obligation onto
  SubSub with the disputes and negative balances, which is a different company;
  `stripe_dashboard: "express"` is the Stripe-branded website above. So
  **`losses.payments` is `stripe`**, which is the better trade anyway — Stripe
  carries the negative balances, the refunds and the chargebacks. `fees.payer`
  stays `application`: who pays Stripe's fee and who eats a chargeback are
  separate questions.

  **What let it ship is the shape worth remembering: the COMBINATION is what
  Stripe validates, and the test asserted the fields one at a time.**
  `requirement_collection` was pinned and `stripe_dashboard` was pinned, so the
  one field Stripe refuses was the one field nothing looked at — a green suite
  over a panel that could not work. The assertion is now the rule (no dashboard
  and Stripe collecting implies Stripe carries the loss) as well as the three
  values, because the rule is the shape of the thing that can be wrong. And no
  static assertion could have caught it: only Stripe knows which combinations
  it accepts, so the first real press was always going to be the test.

  **What cannot be removed, and it shaped everything above: whoever moves the
  money must verify the payee and hold their bank details.** That is KYC law
  rather than a Stripe setting, and no configuration deletes it. What is
  removable is every trace of it feeling like somebody else's product. The
  alternative — `requirement_collection: "application"`, our own forms — moves
  the compliance obligation onto SubSub along with disputes and negative
  balances, and that is a different company, not a nicer form.

  **The hosted link stays, and only as the fallback**, for the reason embedded
  checkout keeps a hosted attempt behind it: where the form is drawn is a
  preference, and being able to get paid is not. Both doors go through one
  `connectedAccount`, so they cannot mint accounts with different controller
  settings — two populations of subcontractor with different experiences,
  decided by which door happened to work that day.

  One real hole this uncovered: **with no publishable key the embedded
  component can never mount**, and the effect returned early — an empty box
  and no way forward, which is the dead end the panel exists to remove. It
  falls back instead, and the browser suite runs in exactly that state, so the
  fallback is the path that is actually exercised.

- **Managing the subscription is not a reason to leave either.** Stripe's
  billing portal is hosted-only — there is no embedded component for it — so
  *Manage billing* handed somebody to another company's website in the middle
  of their own account screen. What the portal does is three things: the card,
  the invoices, and cancelling. Cancelling was already here, so the other two
  are now as well.

  **The card number still never comes near us.** A SetupIntent is confirmed in
  the browser by Stripe's Payment Element, so it goes from the customer to
  Stripe and what comes back is an id.

  Two properties on `card-confirm`, which is the route that decides what an
  account gets charged on. It **reads the SetupIntent back from Stripe**
  rather than trusting a payment method id from the browser, which would
  otherwise point this account's billing at any card whose id somebody could
  name. And it sets **both** the customer's default and the subscription's:
  they are two settings, and changing only the first leaves the next invoice
  on the old card — one somebody believes they have replaced, failing a month
  later with nothing on any screen having said so.

  The invoice **PDF is still a Stripe link**, and that is deliberate: a
  document is not a product surface, and proxying somebody's own invoice
  through our origin buys nothing.

- **Why a GC would route payment through SubSub**, for anything customer-
  facing: the transfer is not the product. Releasing and signing the lien
  waiver as one event, refusing to pay a subcontractor whose insurance
  lapsed, paying against verified work rather than a text message, retainage
  that does not leak, and 1099s that are generated rather than reconstructed.
  The bank moves money for free; what is being bought is the reason to let
  it go.

- **Payment is gated on cover, and the date it asks about is the JOB'S.**
  `settle` checked the waiver chain and nothing else, so *refusing to pay a
  subcontractor whose insurance lapsed* — named two entries up as a reason to
  route payment through here at all — was enforced by nothing. A release
  against a company with no certificate on file went out exactly like one
  against a company fully covered, and no screen said a word.
  `app/shared/paygate.js` holds the rule.

  **The date is the job's, not today's, and getting that backwards is the whole
  trap.** It is the same rule `docs.js` has always stated, applied here rather
  than a second one invented beside it. A certificate that lapsed **after** the
  work does not make the work uninsured, and refusing to pay for it punishes
  somebody for a renewal that has nothing to do with this job. A certificate
  already lapsed **on the day of the work** is the real exposure: the hiring
  account has an uninsured job on their record, and the moment before the money
  goes is the last leverage they will ever have over it. Today's position is
  still **reported** — a lapsed certificate on somebody you are about to pay is
  the moment to ask for the renewal — and never blocks. The test asserts both
  directions, because pinning one of the two passes with the date swapped.

  **Three documents, each for its own reason.** Insurance and a bond are cover.
  A **W-9 is not cover at all** — it is the ability to report the payment, which
  is why the document-request mail has always said "we can't issue payment
  without it". And the **signed agreement is not a bar**, because it is
  `OPTIONAL_KINDS`: the hiring account's own form, on their terms, which plenty
  of them never send. Holding payment over a document they themselves never
  issued is the permanently-amber failure `docs.js` exists to prevent, wearing
  its most expensive hat. A test asserts the gate excludes it *because* it is
  optional rather than because somebody remembered to leave it off a list.

  **Verification counts here, unlike the send gate.** Sending is about whether
  the subcontractor has a certificate to send, so presence is the question
  there. This is the hiring account's own money against their own verdict: an
  unverified certificate is one nobody here has read.

  **Two gates, two overrides, two reasons, and they are deliberately not one.**
  A missing waiver and an uninsured job are different problems and somebody
  paying anyway is saying a different thing about each. One checkbox covering
  both would let a reason typed about the waiver stand as the recorded
  justification for paying against lapsed cover — the catch-wide-enough-to-hide
  -a-real-error shape pointed at the one place it costs most. Each is refused on
  its own and each writes its own event. Both are overridable, for the reason
  the waiver override already exists: refusing outright would have SubSub
  holding a subcontractor's money over a document the *hiring* account has not
  got round to reading.

  **Cover is asked FIRST, and that is a fact about the route rather than an
  accident.** With both outstanding it is the one reported, because it is the
  more serious of the two. Pinning it took two goes: the first version of the
  assertion passed a waiver override, which makes *both* orderings answer
  `cover_outstanding` — a restatement rather than a test. It needs both gates
  outstanding and neither overridden.

  **A database without 037 must not stop payment, and that was a real
  regression.** The gate reads `company_docs`, which is where an expiry lives —
  and on a database that never ran that migration there is no table, so the
  first version threw, which the route turned into `migration_needed`, which
  means *nobody could be paid at all*. Worse than the gap it reports. It falls
  back to the booleans on `companies` exactly as the document read path does:
  `docShapeWithLegacy` reads them and leaves `expiresOn` null, which `docs.js`
  treats as "does not expire". On such a database that is the honest limit of
  what is known, and presence plus this account's verdict is still strictly more
  than the nothing that was checked before. Narrow — only `missingSchema` —
  because a catch wide enough to hide a real error would hide it in front of
  money.

  **And `milestone-test.mjs`'s hand-written base schema earned its keep.** Its
  comment says *"if a route reaches for a column that is not here, that is worth
  knowing"*, and it duly reported that settling now reads `engagements.doc_review`,
  the document booleans on `companies` and `jobs.date`. Those are real columns on
  every real database, so the fixture gained them rather than the route gaining a
  catch. Its fixture also had to start satisfying cover, or every assertion in it
  about the *waiver* was answering a question about insurance instead.

- **Money actually moves, and the shape of that is a legal conclusion.**
  Migration 051, `app/shared/escrow.js`, `wo_funding` and `wo_transfers`. 033
  wrote this ledger for a processor that did not exist; this is the processor.
  Everything about releasing money was already there except the money.

  **Separate charges and transfers**, because it is the only Stripe arrangement
  that *holds* money between funding and release — which is what "pay against
  verified work" requires, since the whole point is that the money is already
  there when the milestone is met. `transfer_data` or `on_behalf_of` on the
  funding intent would make it a destination charge: money that arrives already
  spent, and so cannot be held against a milestone that has not been met. A test
  asserts their absence **on the request Stripe actually receives**, because that
  is the one place the claim is checkable. It follows, and EASY-PAY.md §10.3 says
  so, that the funds sit in a balance attributed to the platform with SubSub as
  merchant of record — still the question for counsel rather than a detail under
  it.

  **The fee is not a Stripe concept here at all.** The account funds the gross
  and the subcontractor is transferred the net; the difference stays where it
  already is. `application_fee_amount` belongs to destination charges. So
  `money.js`'s cumulative cut, stamped onto the release when it was made, *is*
  the fee with nothing further to compute — and `PLATFORM_FEE_BPS` is still
  zero, which is a pricing decision and not a route's to make. **Retainage is
  the same shape**: money funded and not yet transferred, which means held, for
  months, and that is the sharpest edge of the escrow question above.

  **`settle` and `pay` are two routes on purpose.** `settle` records money that
  moved somewhere else — a cheque, a bank transfer, whatever they already do —
  and `pay` moves it. Folding them together would make one route where a bug
  either records a payment that never happened or makes one that was only meant
  to be written down, which is the worst place in this codebase for that
  ambiguity. They share the gates and nothing else, and `/pay` re-runs both of
  them with the same two overrides: a second rail that skipped them would be a
  door round the cover gate rather than a way through it.

  **Nothing is believed from the browser.** `/fund/confirm` reads the
  PaymentIntent back from Stripe, and the **amount** with it — a caller who
  could name it could pay a dollar and claim five thousand, and every gate below
  reads that figure. Same property as `card-confirm` and a sharper reason. The
  transfer amount is likewise the release's `net_cents` and never the body's,
  which is the same rule as the draft route refusing `status`. The first version
  of the test did not pin that one and a mutation walked straight through it.

  **Money is never lent.** A transfer larger than what has been funded is SubSub
  advancing money on a general contractor's promise, which is credit and a
  different company — EASY-PAY.md's own words. `availableCents` is the whole of
  that guard, and it is not overridable by anybody: no reason makes an
  unverified payee reachable or makes unfunded money exist. Those facts are
  checked *before* the two paperwork gates, because asking somebody to justify
  paying without cover and only then telling them the money is not there is two
  decisions in the wrong order.

  **One live transfer per release, and a failed one is retryable.** Those pull
  against each other, which is why `ux_wo_transfer_live` is **partial**
  (`status <> 'failed'`): a plain unique index leaves somebody unpayable because
  a card bounced once, and no index at all pays the same milestone twice under a
  race. The sequential case is caught by the release already being `paid`, so
  the index is asserted **directly** — otherwise the half that matters under
  load could go with nothing noticing. Worth knowing for the next mutation run:
  `freshDb` applies `schema.sql` **and** the migrations a test names, so the
  index has two sources and removing it from one leaves the other. Mutating it
  means mutating both.

  **A reversal reopens the release.** A transfer that comes back weeks later has
  to stop the roster saying somebody was paid, or the money is in our balance
  and the only record of it says paid. It goes back to `due`, and the reversal is
  its own append-only line rather than an edit to the one that said it was paid.

  **Unspent money comes back, and retainage is not unspent.** Money in with no
  way out is a trap, so `refundableCents` is available minus owed — offering the
  balance back would be refunding your way out of a holdback. A partial refund
  across several charges reports what actually went, because saying "it failed"
  when some of it is already on its way has somebody press it again.

  **Both CHECK.sql invariants must read zero.** A release marked paid through
  `method = 'stripe'` with no transfer behind it is the original bug in a new
  place — somebody told their money went, and nothing carries it. A transfer
  marked paid against a release nothing says was paid is worse: money that left
  and cannot be reconciled. Scoped to Stripe-settled releases, because a cheque
  legitimately has no transfer row.

- **A review can say WHAT is wrong, because pass or fail could not.** Review was
  a verdict and a free-text note. The checklist looked like it carried the
  detail and it did not: **an unticked box meant "I have not got to this yet"
  and "I checked, and it is not there" with one mark**, and nothing anywhere
  could tell them apart. So the commonest correctable fault in construction
  compliance — the hiring account missing from the additional insured schedule —
  had one move: reject the whole certificate and type a paragraph. What then
  went to the subcontractor was `docRequestEmail`, the generic "upload your
  compliance documents" notice, **about a document they had already uploaded.**

  Three states per item in `app/shared/doccheck.js` — `unanswered`, `ok`,
  `wrong` — which is the same fix `docs.js` made in colour: expired and
  never-added are both red and are told apart by the words, because they are
  different problems needing different actions. The **unanswered** row is drawn
  plain, with no tint: "I have not looked at this yet" is not worth drawing
  attention to, and tinting it would make a half-read form look like a form full
  of problems.

  **`findings` is the record and `checks` is derived from it.** Two
  independently stored answers to one question is two answers, so the route
  overrides whatever `checks` the body sent. Which the test had to assert with a
  **disagreeing** `checks` in the body — sending none at all leaves the field
  undefined, which is caught too but for a weaker reason.

  **And the legacy read must not invent findings.** Every review written before
  this has a `checks` object where `false` means "the box was not ticked", not
  "found wrong" — that being the exact ambiguity this replaces. So it maps to
  `unanswered`, never to `wrong`: the alternative would retroactively put faults
  on documents that are already verified, which is the same bug inverted.

  **Each fault carries its own instruction, prefilled.** "Ask your agent to add
  Outerhome as an additional insured on the CGL" is something somebody forwards
  to their broker in one go; the same sentence inside a paragraph about three
  other things is a paragraph that gets re-read and half-actioned. It is
  prefilled because a reviewer who has to compose it will leave it blank, and a
  finding with no instruction is the disabled-control-with-no-reason failure
  pointed at somebody else's inbox. The standing text is per item in the shared
  module and a reviewer may overwrite it.

  **THERE WAS ONE LIST TOO MANY, and the merge was forced the same way
  `shared/trades.js` was.** `INSURANCE_LINES`, `INSURANCE_ATTEST` and
  `BOND_MIN` lived in `App.tsx` and again in `worker/mail.js`, agreeing by luck
  and by whoever last edited both. That stopped being survivable the moment the
  email has to name the **specific** line a reviewer marked wrong: two lists
  means an email naming a line the screen never asked about. One list, and the
  insurance path stopped being a second code path while it was at it — which is
  how it had ended up the only kind the email could not name a finding from.

  **`docFindingsEmail` says what was RIGHT as well as what was not.** A list of
  four faults with no mention of the eight lines that were fine reads as "start
  again", and the commonest answer to that is a telephone call asking what is
  actually wanted. It also **never says "rejected"**: the stored verdict still
  is, but a subcontractor reading that goes looking for a new policy when what
  is wanted is an endorsement. The subject counts the fixes, because a subject
  line decides whether this is opened today or next week.

  **THERE IS NO FOURTH STATUS, and the obvious move would cost more than it
  buys.** The difference between "rejected" and "three things to fix" is tone,
  and the findings carry the substance. A `changes` value in `status` would have
  to be answered by `docStatus`, `missingDocs`, `docsComplete`, the assignment
  gate, the nav badge and the send gate — and a document needing changes is not
  usable either way, so every one of them would answer exactly as it does for
  `rejected`. Eight places to get right for a word. So **the verdict stays a
  verdict and the words follow the findings**, on the roster row, in the modal's
  summary, in the panel heading and in the subject line.

  **The mail is chosen by the findings, not by the caller**, and the preview and
  the send pick it through one function — a preview that could be asked for the
  wrong template is a preview that disagrees with what gets sent. The route had
  to learn the **kind**: the bug at the heart of all this was that a rejection
  carried no answer to *which document*, so the generic notice was the only one
  it could ever compose. It is logged as its own `doc_findings` kind, because
  "we told them what was wrong with their certificate" and "we asked them for
  documents" are different events and the console counts both.

  **And a note is only required when nothing is marked.** The findings *are* the
  reason. Demanding a paragraph anyway would have a reviewer who has just named
  four specific faults retype them as prose.

  **Which broke the one screen the subcontractor acts on, and nearly shipped.**
  `MyDocRow` read *Needs a new copy — {note}*, and the note is optional now, so
  a certificate sent back with three named faults would have rendered a dangling
  em dash and nothing at all — on the screen somebody opens straight after
  reading the email about it. It counts the faults, lists them with each
  instruction, and keeps the old sentence without the dash when there are none.
  The general shape: **making a field optional makes every screen that prints it
  unconditionally a screen with a hole in it**, and the holes are wherever it was
  being interpolated after a dash or a colon.

  **And rejecting is recorded before the notify modal opens**, so closing that
  modal without sending leaves a contractor waiting on a job that will never be
  issued, over a fault nobody told them about — the same silent failure one
  screen along. The modal says so, at the moment of closing.

- **A lien waiver is a chain, and it rolls up as a status.** A waiver binds
  only the party that signs it, so one from your subcontractor does nothing
  about the supply house they still owe. The useful object is the chain:
  same row shape at every tier, a parent pointer, and a roll-up that is a
  **count and a date, never a list** — an account may know their
  subcontractor's chain is clear; they may not have that subcontractor's
  supplier list, which is their sources and by inference their margins.
  Nothing is ever "clear", only "clear through a date", because material
  delivered the next morning is not covered.

  Very often there is no chain at all: the hiring account buys the supplies
  and the subcontractor is labour. That is `scope_kind = 'labor_only'`, a
  declaration somebody signs rather than an absence nobody recorded — and it
  moves the exposure *up*, because then it is the hiring account's own supply
  house that can lien the owner.

  **SubSub authors no waiver document.** It requests, tracks, gates payment
  on, and stores what was signed with a hash of it. Generating the text is a
  separate decision with a lawyer attached: roughly a dozen states prescribe
  exact wording and a form that deviates can be void, and lien law follows
  the property's state, not the signer's.

- **A subcontractor is an account kind, because it is the one that gets hired.**
  Every kind before it hires. The send-your-compliance-pack loop is aimed at the
  company being *hired* — in a product with no directory it is the only flywheel
  there is — and a roofer following it arrived at a signup form offering four
  ways to describe a business, all four of which hire. `general_contractor` was
  the only one that produced a hireable account, so that is what they picked, and
  from then on the staff console, the account switcher and their own branded
  sign-in page all called a roofing company a general contractor.

  Structurally it is `general_contractor` without the buildings: `hireable`,
  `properties: false`, nothing to invite. It is a separate **value** rather than a
  label over the top because `kind` is what every screen reads to say what an
  account *is*, and nothing downstream could tell a misfiled roofer from a real
  GC.

  **Adding it means three lists, not one.** `ACCOUNT_KINDS` (what the API will
  store), `HIREABLE_KINDS` (what 031 mints a company row for — leave it out and
  the account has nothing to be hired *as*, which is the only thing they came
  for), and the browser's `ACCOUNT_KINDS` object. A kind the API accepts and the
  app cannot render is an account nobody can open; a kind the app renders and the
  API rejects is an account nobody can make.

  **And CHECK.sql's invariant is about being hireable, not about being a GC.**
  `m031_gcs_without` read `kind = 'general_contractor'` literally, so adding a
  kind would have flagged every subcontractor as an illegal company row *and* let
  one with no company be hired as. It is `m031_hireable_without` now, and its list
  has to stay in step with `HIREABLE_KINDS`.

  **The form re-labels itself rather than leaving them to guess.** Three things on
  `get-started.html` were asking a subcontractor about a business they do not run:
  a plan pill priced in contractor seats, "trades you work with — pick everything
  you hire out", and a whole step for inviting their subcontractors. That step is
  not one they *skip* — it does not exist for them, and offering it with a "Skip
  for now" button is asking a question in order to wave it away. The step numbers
  are markup rather than a counter, so dropping the third item means renumbering
  the fourth: a bar reading 1, 2, 4 is worse than no bar. `?as=subcontractor` on
  the licensing CTA preselects the role they have already told us, matched against
  the radios' own values so a typo in a marketing link falls back to the default
  instead of writing a kind nothing renders.

  Their plan is Basic and stays Basic: every limit on it counts subcontractors,
  users and jobs, and they use none of the three. A plan pill saying "3
  subcontractors" invites the one question this flow cannot afford — *am I about
  to be charged for sending a certificate.*

  **And the whole point is that they never have to be invited.** Every other way
  into SubSub needs the hiring side to already be here. A subcontractor signs up,
  puts their pack together and sends it — no invite, no roster, no client. Six
  gates stand between signing up and a pack landing in somebody's inbox and each
  reads a different thing, so `test:subsignup` walks the lot end to end rather
  than testing them one at a time. Two of them were shut.

  **`mayWriteCompanyDocs` asked "do I hire this company", and for yourself the
  answer is always no.** The security fix that added it was right — `companies`
  is a shared row and `cmp_own_<accountId>` is derivable from a public route —
  but the relationship it checks is an engagement, and an account nobody has
  hired yet has none. So a hireable account could not upload its own
  certificate: the panel rendered and the button answered `404`. It now accepts
  the caller's **own** company row, resolved through `seatCompany` so the read
  and write paths cannot disagree about which row is "mine", and read off the
  **session's** account id rather than the URL — deriving somebody else's still
  gets nowhere, because it cannot equal your own.

  **And signing up refused without a licence and a UBI.** The form has said
  *optional … never required to sign up* the whole time, so the screen promised
  one thing and the server did another. A UBI is Washington's Unified Business
  Identifier: there is no such number to give in the other fifty jurisdictions,
  so the gate was unsatisfiable for most of the country rather than merely
  annoying — the same shape as the state-licence question this product already
  decided against twice.

  It survived because **`test:states` only ever read `get-started.html`**, and
  the one test that did assert the server asserted the *old* rule. Both now
  check the Worker. The general lesson, which is this file's oldest: when a
  decision changes what a form says, find the route that enforces it — a screen
  and an API disagreeing is not a smaller bug than either being wrong.

  **Migration 046 is the one migration most databases must not run.** 003 added
  `accounts.kind` as plain TEXT on purpose ("adding a CHECK to an existing table
  needs a full table rebuild, and the API validates the value anyway"), so a
  database grown through the migrations accepts the new kind with nothing run at
  all. One built from `schema.sql` carries the CHECK and **refuses** it — which
  surfaces to whoever is signing up as `signup_conflict`, a 409 and no account,
  silent until the first subcontractor tries. So `m046_kind_check` reads the
  *shape* rather than asking whether a column arrived: `0` nothing to do, `1` run
  the rebuild, `2` already widened. A rebuild that is not needed is strictly worse
  than doing nothing.

  The rebuild is `CREATE TABLE ... AS SELECT`, which keeps every column and row
  and drops every constraint — deliberately, because restating the whole
  `accounts` table in a migration file means a stale copy silently dropping
  columns it had not heard about. 003 already chose that side of the trade. But
  the **index is not a constraint and is not optional**:
  `GET /api/account-by-subdomain/:s` is on the public route list and runs on every
  branded page load, so 046 puts it back and CHECK.sql counts it.

  **`schema.sql` has drifted from the migrations and is not a safe fresh install.**
  It is missing at least `accounts.company_id` (031) and
  `properties.owner_account_id` (039), so CHECK.sql cannot even be run against a
  database built from it. That is why the Worker tests here pass the columns they
  need in `freshDb`'s `migrations` array, and why the signup route treats a
  missing `company_id` as "a database without 031" and moves on quietly — which
  is also how a missing company row reads as a bug in the route rather than a gap
  in the harness.

- **A subcontractor may send their own paperwork, and that is the growth
  loop.** Every other way into SubSub needs the hiring side to already be here:
  they look a contractor up, or they scan a code, and both need an account
  first. So supply could never bring demand in — which, in a product with no
  directory, is the only flywheel available.

  A subcontractor is asked for the same four documents several times a month,
  nearly always by a general contractor who is not on SubSub, and answers by
  attaching PDFs that start going stale the moment they are sent. `POST
  /api/doc-shares` is that same act done once: they type the address of
  somebody who just asked, and that person gets a page with the carrier, the
  policy number, the coverage and — the part an attachment can never do — the
  expiry, live. Migration 041 holds `doc_shares`; `app/shared/docshare.js`
  holds the rules.

  **The W-9 is not in the link.** It carries a TIN, and for a sole proprietor
  that is their social security number; email gets forwarded, sits in shared
  inboxes and turns up in the archive of whoever leaves next year. The page
  says a W-9 is on file and reading it needs an account. That is the one piece
  of deliberate friction in the flow, placed where the recipient is already
  getting the thing they asked for. Changing it is a decision about somebody
  else's identity documents, not a tweak to a share feature.

  **The link is not a public URL.** One 32-byte random token per recipient,
  never derived from anything about the company or the clock, expiring in
  `SHARE_DAYS`, revocable, and replaced rather than duplicated when the same
  address is sent to twice. The file route is pinned three ways: the token
  names the share, the share names the company, and the document must be a
  current row of *that* company of a kind the link may carry.

  This is the one addition to the public-route exemption list that serves a
  compliance document, and the comment there now carries both halves. The rule
  it does not break is the real one: a route that serves a document by an
  account or company id serves it to anybody who can guess an id. Nothing here
  is addressable by an id.

  **A connection has two ends and only one was ever drawn.** Accepting a
  request writes an engagement on the *other* account and seats this team over
  there — so the hiring side gains a contractor and this side gains nothing it
  can see. Every engagement read in the Worker is `account_id = mine`, which is
  "the contractors I hire"; nothing read `company_id = mine`, which is "the
  accounts that hire me". So a general contractor who said yes to a property
  manager could find them in the account switcher and nowhere else, and had no
  answer at all to "who do we work for". `GET /api/clients` is that list, on
  the Contractors screen above the roster: the list below is who works for us
  and this is who we work for. Nothing new crosses — these accounts chose to
  engage this company and this company's people already hold a seat in each of
  them. What it adds is the sentence, not the access.

  **And a hireable account needs somewhere to keep its own paperwork.** Since
  031 an account is a company, so it can be asked for the same four documents
  as any subcontractor — but uploading one lived only in the contractor portal,
  behind `can("portal")`, which `ROLES.admin` does not include. An account that
  could be hired therefore had nowhere to put a certificate and nothing to
  send. Both now sit in Account → Company beside the hireable profile, which is
  where being hireable already lives. This is the same root as the connect
  badge, and it is worth stating as a rule: **anything 031 made true of an
  account-as-company has to have a home outside the contractor portal**, because
  the seat that runs an account never has one.

  **And the switcher says what you are over there.** Accepting a request seats
  your whole team in *their* account as a **contractor** — so the menu grew an
  entry reading "Switch to Cascade Management", which sounds like taking the
  place over when it is the exact opposite: it is where they hire you.
  `seatDescription` in `app/shared/handover.js` puts the relationship under the
  name — *you are their subcontractor*, *you own a building they run*, *you
  rent from them* — because where you land and what you can do there both
  follow from the role, and the role was the half the menu never said.

  **A subcontractor's work is one list, not one account at a time.** The whole
  point of that loop is to put a subcontractor on more rosters, and the portal
  answered "does anybody need me" for exactly one of them. `/api/jobs` is
  `WHERE j.account_id = ?`, and both the portal's job list and its amber badge
  were derived from it — so a roofer on twenty-five GCs' rosters found out by
  switching account twenty-five times, and could have four jobs waiting on a yes
  behind a clean nav. That is not a long menu, it is missed work, and it gets
  worse the better the growth loop works.

  `GET /api/my-work` is every slot assigned to **this company**, across every
  account that engaged it, with the client named. It is the shape the tenant's
  own reports use, for the same reason: their own work, read-only, with the
  account it belongs to named, because "who is this for" is the whole question
  when the answer is a different company every row. The counts, the schedule and
  the booked value are all across the lot — a figure for one client out of
  twenty-five answers nothing.

  Scoped **by the work order, not the job**: `w.company_id = mine` is the only
  thing that selects a row, so it cannot be widened into a client's job list.
  And it never carries **the other trades on the same job** — a job holds three
  work orders and the other two name other companies on that account's roster,
  so telling a roofer which electrician the GC uses is the accumulation refused
  everywhere else.

  **`/api/jobs` now holds the same line, and did not before.** `scopeClause`
  narrows an owner and a tenant by property and contributes nothing for a
  contractor, so that list was **every job on the account**, each carrying every
  trade's assignment: which company, its crew, its work order number and its
  value. `stripMoney` redacts owners and tenants only, so the rates went too.
  Accepting one connect request was enough to read a general contractor's whole
  book — who they use for each trade, at which address, for how much.

  It takes **both** halves, and either alone still leaks. `woScope` limits the
  list to jobs the caller's company holds a live work order on; `stripOtherTrades`
  then keeps only their own trades on the jobs that survive. Redacted on the way
  out of the API rather than hidden in the page, for the reason `stripMoney`
  gives: a value the browser is sent is a value the browser can be made to show.
  `assignments` stays an object when it empties out, never absent — the same
  white-screen rule `inheritedShape` follows.

  **Read-only means every write, not the obvious one.** Accepting, declining and
  requesting a change all post to the account the seat is on, and the work-order
  modal reads that account's job — so on a row belonging elsewhere every one of
  them would reach the wrong company. The card says whose the work is, keeps the
  countdown (the entire reason to surface it), and offers one tap to get there.

  And the fix must not tax the common case: at one client there is no strip, no
  tint, and the same sentence as before. `clientCount` is what decides, so the
  screen only changes shape once there is a second company to distinguish.

  **The who-am-I bar is reversed out**, because a seat in somebody else's account
  looks exactly like your own — same nav, same greeting, same layout — and
  `.who-bar` is the only thing on the screen saying which company you are and who
  is hiring you. As a white card on a near-white page it was the one thing you
  could miss. Ink rather than black, so it reads as part of the product. Its text
  colours are literals and not the page's tokens: `--ink-soft` is the muted grey
  for a *light* surface and lands at about 1.3:1 here, which is the trap of
  carrying a token across a reversed surface. A test pins both ratios.

  **And the switcher itself has a threshold.** A flat list with the relationship
  under each name is right at two or three seats and is what the drawer does. At
  twenty-five it is around 1,100px of two-line buttons below every nav item with
  *Sign out* pushed off the screen, and `seatDescription` reads identically on
  twenty-four of the rows — so the line that *was* the fix distinguishes nothing
  at exactly the point where distinguishing matters most.

  Past `SWITCHER_THRESHOLD` (in `app/shared/handover.js`) the list becomes one
  entry opening a panel: grouped by relationship so the **heading** carries what
  the rows were repeating, searchable over the account's own memberships, and
  ordered by **what is waiting on you there** — alphabetical alone is the order
  that makes somebody read all twenty-five. Under the threshold nothing changes
  at all, and that is the design: a fix for the twenty-five case that taxes the
  two case has made the common thing worse to improve the rare one. The same
  ordering applies to the flat list, which has the same problem in miniature.

  `seatGroup` sends an unrecognised role to the staff group rather than dropping
  it. A seat that renders nowhere is worse than one in the wrong group: it is a
  place somebody holds a seat and cannot reach.

  **Two things this uncovered.** Signing in goes through `handleLogin`, which
  calls `getMe()` and gets every seat; `resumeSession` never did, and
  `hydrateAccount` writes memberships for the **current account only**. So the
  switcher was correct immediately after signing in and **empty after a
  refresh** — the demo seed the state starts from is keyed to ids no real user
  has. A way out of an account that exists until you reload the page is not a way
  out. `reloadAccounts()` runs on resume now, and **before** `hydrateAccount`,
  because it replaces every row for that user and `getMe()` carries no
  `propertyIds` or `unit` — running it second would strip a scoped owner or
  tenant seat of the buildings it is scoped to.

  And there were two ways into another account doing different amounts of work:
  the header's user menu switched properly, while the drawer set
  `currentAccountId` and stopped — so nothing re-fetched and the new account
  rendered with the old one's jobs, properties and roster. Both go through
  `goToSeat` now, which also lands on a screen the new seat's role actually has.

  What that looked like is worth recording, because it did not look like stale
  data. A general contractor who had accepted a property manager's request to
  connect switched to them and got **“This contractor login isn't linked to a
  contractor record yet.”** Nothing was wrong on the server: the engagement and
  the contractor seat were both written correctly. `mySub` looks for the seat's
  own company in `subs`, `subs` was still the *previous* account's roster, and a
  general contractor's roster does not contain themselves — so it found nothing
  and drew the empty state. The branding, the name and the nav had all followed
  the switch, which is exactly what made it read as a broken account rather than
  a page that had not reloaded. **When a screen says a record is missing, check
  what account the data in state belongs to before looking for the record.**

  **`companies` is a shared row, so writing to it needs a relationship.** One
  certificate, one set of booleans, read by every account that engages them — so
  `POST` and `DELETE /api/subs/:companyId/documents/:kind` are not writes to your
  own data. Both checked the contractor and nobody else, which left an admin or a
  project manager able to upload against, and delete from, **any company id**.

  Reachable, not theoretical: `GET /api/account-by-subdomain/:s` is on the public
  exemption list and answers with the account id, `ownCompanyId` derives
  `cmp_own_<accountId>` from it, and `DELETE` then runs
  `UPDATE companies SET insurance = 0` on a general contractor nobody involved has
  any relationship with. `missingDocs` and `docsComplete` read those booleans, so
  that takes them off every roster they are on and their clients are told they
  cannot be assigned work; `supersedeDoc` on the `POST` side retires the row that
  answers "were they insured on the day of that job".

  `mayWriteCompanyDocs` is the check the **review** route three functions up
  already did. Two deliberate differences. An **ended** engagement does not carry
  the right to edit their paperwork afterwards — review may keep accepting any
  engagement, because it writes its own account's verdict on its own row and
  reaches nothing shared. And it answers **`not_found`, before the company is
  looked up**, so a company that exists and one that does not give the same
  reply: a `403` would confirm which derived ids are real, which is the oracle
  the handover subdomain lookup already refuses to be.

  **And it sends in one field, from the menu.** The panel on My Documents is for
  *managing* what has been sent — the list, the view counts, revoking. That is
  not the moment this loop is for: a general contractor asks for your insurance
  while you are standing on their site, and the answer should be six seconds
  long. So `QuickSend` sits beside **My QR code**, in the header menu and the
  mobile drawer, because the two are the same kind of thing — give somebody your
  details without a conversation. The code is how they add you; this is how they
  get your paperwork.

  One field, deliberately. No name, no note: every extra box is a reason to do
  it later, and later is when people go back to attaching PDFs. The W-9 line is
  on the form *before* they send rather than discovered after, and it is hidden
  entirely when there is nothing on file, because the server refuses that with
  `nothing_on_file` and a screen that offers a button the server will refuse is
  a screen that lies.

  **Sending is gated on a document being uploaded, not verified.** Verification
  is each hiring account's own verdict and says nothing about whether the
  contractor has one to send — the common case is that they upload and somebody
  else asks before the first account has reviewed it. The server and the screen
  both gate on presence, and they must not disagree.

- **The growth loop is automated in three places, and the rails are the
  feature.** Supply brings demand in, which in a product with no directory is
  the only flywheel available. Three sweeps and a snippet run it without anybody
  doing anything, and every rule below exists to keep them a service rather than
  a mailing list.

  **A renewal re-reaches the people already sent that document.** The pack page
  promises it stays current — and the link expires in `SHARE_DAYS`, so a year
  later, when the certificate actually renews, every recipient is holding a dead
  URL and the promise went quietly unkept. `retouchSweep` mints a fresh link and
  sends it. This is the cheapest recurring reach SubSub has: wanted (they asked
  for that document), annual per recipient per document, and landing on a general
  contractor who mostly has no account at the moment they are reminded they have
  a compliance problem.

  `app/shared/retouch.js` holds every rule; migration 044 holds the ledger.
  Load-bearing: it is **once per recipient per document row** (keyed on the row,
  not the kind, so next year's certificate earns another send and a re-run of the
  sweep earns none); **one email per recipient per `RETOUCH_QUIET_DAYS`** however
  many documents renewed that week; only documents that **expire**, because "we
  renewed our W-9" is not news; never a **revoked** share, which would undo a
  decision the subcontractor made about their own paperwork; and never an expiry
  already in the past. The **suppression row is written before the send**, because
  a send that succeeds against a ledger row that does not is how somebody gets
  the same email every night.

  **The way out is the pack page itself**, keyed by the share token the recipient
  already holds. No second secret to mint and leak, and no endpoint taking an
  email address — which would let anybody unsubscribe anybody. An unknown token
  answers exactly as a real one does, so it cannot be used to test whether a
  token exists. Stopping one subcontractor is not stopping all of them, and both
  are offered.

  **The application form is something you paste, not a URL you remember.**
  `/?apply=1` has existed since the start and nobody knew it was there.
  `applyFormHtml` in `app/shared/embed.js` generates a self-contained snippet: no
  dependencies, every CSS rule scoped under `#subsub-apply` so it cannot restyle
  somebody's website, the account name escaped so it cannot close the script tag,
  and a `<noscript>` route through. `embedNudgeSweep` tells an account it exists
  **once, ever**, at `EMBED_NUDGE_AT` contractors — a growth email that repeats is
  a growth email people filter — and to admins only, because a project manager
  does not put things on the company website. The email points at the panel
  rather than pasting eighty lines of HTML nobody can copy cleanly on a phone.

  **And the demand side finally pulls.** Every other half of this loop pushes:
  a subcontractor sends, an account scans a code, a sweep emails. A general
  contractor who had been sent packs by three subcontractors held three
  unrelated links, each expiring on its own schedule, and the value of having
  them together grew with every new one while nothing added them up — so the
  person with the most reason to want SubSub had the least reason to notice it
  existed.

  `GET /api/inbox/:token` is that page, and claiming it writes the
  subcontractors onto the claiming account as engagements. **That is the cold
  start solved by the people who wanted to be on it**: the subs did the data
  entry, and a roster nobody typed is the thing every vertical SaaS fails to
  get. They arrive as `invited`, not `active` — a document share is agreement to
  be *hireable* by this person, not agreement to have been hired — and this is
  not the accumulation the product refuses, because each one chose to send their
  paperwork to that address.

  **Reaching it costs a second email, and that is the whole design.** A share
  token proves somebody holds one link that was emailed to an address; it does
  **not** prove they control that address now. Certificates get forwarded — that
  is most of what they are for — so linking straight through from a share would
  let a forwarded certificate open every pack ever sent to the forwarder. So
  `POST /api/pack/:token/inbox` names no address: it is read off the share and
  the link goes there, because an endpoint that takes an address is an endpoint
  that mails anybody's inbox to anybody. Neither the reply nor the screen ever
  says **where** it went, for the same reason. An unknown token answers exactly
  as a real one does. One live inbox link per address, `INBOX_DAYS` rather than
  `SHARE_DAYS` because this one opens all of them, and claiming burns it.

  **And the funnel is visible at last.** `doc_shares.view_count` has been written
  since 041 and nothing added it up, so whether any of this works was unknowable.
  The send panel now shows sent, opened and how many companies — the one number
  that says whether sending paperwork this way is working at all, without which
  the renewal emails are going into the dark.

  **And the claim could not be pressed.** `GET /api/inbox/:token` returns above
  the logged-in gate, which is right — somebody opened a link to read what was
  sent them, not to sign in — and it is also why the whole thing was inert. The
  page was public to *everybody*, a signed-in admin included, so the one button
  on it linked to `/?signup=1`, which **nothing in the bundle has ever handled**;
  it fell through to the sign-in form, a password box in front of somebody who
  had just said they have no account. `POST /api/inbox/:token/claim`, migration
  045's table and the page all shipped, and no screen could reach the route.
  Same shape as the connect badge behind `can("portal")` and the embed panel
  behind `brand.subdomain`: three correct pieces and no way in.

  The session is passed into the page, which stays public. Three people press
  that button and they need three different things: an **admin** claims in place,
  because they have an account and a signup form would ask them for a second one;
  **another seat** — a project manager, a contractor, a tenant — cannot write
  engagements, so it names who can rather than offering a button the server will
  refuse; and **nobody at all** goes to `get-started.html`, because the account
  has to exist before anything can be written to it.

  The token travels in the **query string** the whole way, never this browser's
  storage: signing up is two pages on another origin, and the token is what knows
  *which* contractors are being claimed. `get-started.html` reads it, validates
  its shape rather than trusting it, says on its last screen that the claim is
  still waiting, and points *Sign in and add them* back at `/?inbox=<token>` —
  not at a dashboard, which has no idea this person was mid-claim. And the
  success state has to offer the way on, because claiming sets `claimed_at`: the
  link is spent the moment it works, so coming back answers "already claimed".

  `?signup=1` is now a redirect to the marketing form, and it stands down when
  an inbox token is present — an admin holding the old link claims in place
  rather than being bounced off the origin that knows what they came for.

  **And the snippet lives beside the form it is a copy of.** It sat on the
  Contractors screen, which has the motive — that is where somebody thinks about
  who works for them — but not the artifact: the form's colours, its preview and
  its live address are all in Account → Company, and the snippet is the fourth
  item in that list. So the panel is there and the Contractors screen keeps a
  pointer. One implementation, two ways in; two copies would be two components
  holding the same clipboard state.

  It sits **outside** the `canBrand` branch it now neighbours, and that is
  load-bearing rather than incidental. Branding is Scale-only; this is not,
  because `POST /api/apply/:subdomain` looks an account up by subdomain and
  checks no plan. Dropping the snippet inside that branch would have made the
  cheapest growth lever a paid feature.

  Which uncovered the thing that was already broken. `brand` is stripped on
  Basic — `subdomain: "app"`, so a downgrade cannot print an address with no
  certificate behind it — and the old gate read `brand.subdomain !== "app"`. So
  **the embed panel had never once rendered for a Basic account**, while
  `embedNudgeSweep` emailed those same accounts to tell them it existed. Same
  shape as the connect badge behind `can("portal")`: told about something, with
  no screen to find it on. The account row keeps its reserved subdomain either
  way, so `applySubdomain={account.subdomain}` is what the panel reads. The
  general rule: **`brand` is what gets shown, `account` is what is true — a
  feature that is not plan-gated must not read its identity off `brand`.**

  `liveHost` is the half that really is plan-dependent. `<sub>.subsub.work` only
  resolves once the custom hostname is active, so on Basic the *hosted link* is
  dead while the pasted form is fine — the link is withheld and the reason
  given, because a screen offering a link that will not load is the same lie
  QuickSend's W-9 line exists to avoid.

- **A document nobody can read is a document nobody uploaded.** Uploading has
  worked since the start and *nothing signed in could read one back*. The only
  route that ever served a compliance document's bytes was
  `GET /api/pack/:token/file/:docId` — the **public** one, keyed by an emailed
  token. So a stranger holding a forwarded certificate could open it and the
  account being asked to **approve** that certificate could not.

  What the review screen offered instead was `openFile`, which built a
  `text/plain` Blob out of the reviewer's own checklist and downloaded it as
  `<name>-preview.txt`, carrying the line *Placeholder preview — wired to
  object storage in production*. **Open and Download were the same function.**
  So a reviewer attesting to a coverage limit, a carrier, a policy number and
  an expiry was doing it from memory of a file the screen would not show them
  — the screen-that-lies rule pointed at the one screen whose entire job is
  reading a document. The contractor's own My documents panel was the same
  dead end from the other side: a filename, Replace and Delete, and no way to
  see what was on file. **Replace was the only way to find out what you had
  uploaded.**

  `GET /api/subs/:companyId/documents/:kind/file` is the missing door, pinned
  the same three ways the pack route is: the caller has a relationship with
  the company, the row belongs to that company, and it is the **current** row
  of that kind. Serving a superseded one would draw last year's certificate
  under a heading reading *Verified*.

  **The W-9 is served here, and that is the point rather than an oversight.**
  `inLink` keeps a taxpayer number out of an emailed link *because* this door
  exists — the pack page says a W-9 is on file and that reading it needs an
  account. Refusing it in both places would leave it readable by nobody at
  all, which is not friction, it is a dead record.

  It reuses **`mayWriteCompanyDocs`** rather than growing a read predicate
  beside it. Somebody who may *replace* their certificate may certainly read
  it, and the two populations are identical — so a second rule could only ever
  be wrong in one direction or the other.

  **A key nobody recorded does not mean a file nobody has.** The upload route
  puts the file in R2 **first** and writes `company_docs` **second**, inside a
  try/catch that swallows a missing table — so on a database that never ran
  037 every document is in the bucket and not one row says where. Giving up
  there reports a whole roster of real certificates as unopenable, which is
  what the first version of this did.

  `findUploadedObject` is the recovery, and it works because the key the
  upload built is `<accountId>/<kind>/<uid>-<fileName>` while
  `companies.doc_files[kind]` holds that same `fileName`: the random id in the
  middle is not derivable but the object is findable by **suffix**. Three
  things hold it. The prefix is the **caller's own account**, read off the
  session and never the URL, so it cannot reach into another account's space
  and at worst fails closed on a file somebody uploaded while seated
  elsewhere. The **suffix must match the name recorded on the company row** —
  one account's `insurance/` folder holds a certificate per company on its
  roster, and without that check the newest of them is served as whichever one
  was asked for. And the **newest match wins**, because a replaced document
  keeps its old object under the same name and "any match" draws last year's
  certificate as current cover.

  Two of those three were only pinned properly on the second attempt: the
  fixture gave the other account's object an older date and the same folder
  held nothing but copies of one file, so deleting the prefix scoping or the
  suffix match changed no outcome and **the two guards covered for each
  other**. The dated, differently-named fixtures are the test.

  **`no_file` is its own answer and is not `not_found`**, for a row where
  nothing can be produced at all. A caller who got that far already knows the
  company exists, so naming the difference gives nothing away, and only one of
  the two means "upload it again". A stranger still gets `not_found`, so the
  oracle stays shut.

  **And the empty state must not name a cause it cannot check.** The first
  version said the file was "uploaded before SubSub recorded where files were
  stored" — a guess at one of several ways a row loses its file, printed as
  fact, and reported on a certificate uploaded that month, where it read as
  nonsense. It says what is true and what to do, which is the same instruction
  whichever cause it was.

  On the screen it is **fetched on mount, never on the press**, and that is
  not a preload-for-speed decision: the bytes need an `Authorization` header,
  so neither an `<a href>`, an `<img src>` nor an `<iframe src>` can carry one
  — same as `reportPhotoBlob`. A press that has to *await* a round trip has
  lost its user gesture by the time it opens a tab, **which iOS Safari blocks
  as a popup**, and this product is run from an iPad. Having the blob in hand
  first is what makes Open and Download ordinary anchors that work.

  **Download needs `target="_blank"` as much as Open does, and for a reason
  that only shows up on the device this product is run from.** `download` is
  honoured by a desktop browser — the file saves and no tab opens — but iOS
  Safari **ignores it on a `blob:` URL**, so the anchor falls back to an
  ordinary navigation and replaces the page with the PDF. The reviewer loses
  the half-filled form they were standing in; on an iPad that is not a
  download, it is a way out of the review. Reported as exactly that. The
  attribute is free on desktop, where `download` still wins.

  And it is drawn as **what it actually is**: an `<img>` for an image, an
  `<iframe>` for a PDF, a download offer for anything else. A certificate is
  as often a **photograph** of one as a PDF — somebody holds their phone over
  the page in a site office — and a photo in a PDF frame is a broken-plugin
  box.

  Two assertions in the first version of the test **could not fail**, both
  caught by mutation and both the shapes this file already records. A bare
  `/<DocFileView/` over the whole of `App.tsx` found whichever of the two
  mounts existed, so deleting it from the review modal left `MyDocRow`'s copy
  satisfying the check — the `.embed-code-btn` trap exactly. And *an unknown
  kind is refused* asserted only the 404, which an unknown kind produces
  anyway by matching no row; what the `DOC_KINDS` guard actually decides is
  **which** 404, since without it `bogus` falls through and answers `no_file`,
  claiming that is a real kind of document this company has not uploaded.

  Still open, and it is the same shape one layer along: **a signed work order
  is uploaded and equally unreadable.** `work_orders.signed_file_key` is
  written by `PUT /api/work-orders/:id/signed`, the filename is shown on the
  assignment row, and no route anywhere serves it back.

- **Verifying is one press; reading an ACORD 25 is not.** Six coverage lines,
  a carrier, a policy number, two dates and five things to confirm on the
  document — and a reviewer four lines in who finds the sixth missing has to
  stop and ask the contractor. Closing the modal threw all of it away, so the
  next attempt started from an **empty form over a certificate they had
  already read once**. The work this product asks for is the reading, and the
  only thing it saved was the verdict.

  `PUT /api/subs/:companyId/documents/:kind/draft`, and the first property is
  the one that matters:

  **A draft is not a verdict.** It is stored *beside* `status`, never as one,
  so `docStatus` keeps answering "pending" and `missingDocs`, `docsComplete`,
  the assignment gate and every badge are untouched. A half-finished review
  that granted compliance would be the expired-certificate failure arrived at
  from a new direction, and **worse, because it would read as a decision
  somebody made**. The route also refuses to take `status` from the body: it
  is reachable by every seat the review route is, so a status there would be a
  verdict wearing a draft's name.

  **It belongs to the account, not the person.** It lives on `engagements`,
  which is already where the verdict lives and already per-account, so a
  reviewer who runs out of day is picked up by a colleague — and another
  account reviewing the same shared certificate never sees it, because a
  half-read pass is as much theirs alone as the verdict is. `draftBy` names
  who left it, since a form somebody else half-filled has to say so.

  **A decision clears it**, or a draft outlives the answer and reopens over a
  finished review — the queue-row-that-survives-being-answered shape. The
  review route replaces the whole entry, which does it by construction; the
  deletes are written out anyway, because a later change that carried the old
  entry forward would resurrect it silently.

  Three things on the screen. The banner **says it is unfinished**, because a
  form that quietly arrives pre-filled reads as a record of what the document
  says, and somebody would carry on from figures they had not checked. Save is
  **not gated on `canVerify`** — the whole reason to pause is that the form is
  incomplete, so gating it would offer it only once it was no longer needed.
  And the roster row carries a **Review started** chip beside the unchanged
  status, because a draft invisible from the roster is unfinished work nobody
  finds, which is the no-way-in failure this file has now recorded six times.

  **It is every document, not the insurance one**, because the Save button
  lives in the single action row all four forms share — and the bond, the
  agreement and the W-9 have different confirmations, no coverage grid, and
  two of them do not expire at all, so the only way to know is to press it on
  each. Wrapping that button in `isIns` fails fifteen assertions.

  **The static assertion for the central promise could not fail, and a browser
  test is what caught it.** Checking that `DocReview` *mentions* the draft
  passed with the form ignoring it completely — the variable was declared and
  never used to seed anything. Driving the modal and reading the input values
  back is the only proof that a reviewer gets their figures returned, and it
  immediately caught a second thing besides: the server suite had been storing
  invented field ids (`addl_insured`, `prod_agg`) and passing, because the
  server keeps the draft as an opaque blob and cannot know what a real one
  holds. **A test that stores a shape the product never produces is a test of
  its own fixture.**

- **Closing a half-read review asks, and three coverage lines are optional.**
  Three things about the review modal, all of them the same shape: the screen
  was stricter, or quieter, than what it was actually doing.

  **EVERY WAY OUT THREW THE WORK AWAY.** Reading an ACORD 25 is the labour this
  product asks for — six coverage lines, a carrier, a policy number, two dates
  and five confirmations — and the X, the backdrop and a link literally reading
  *Close without deciding* all discarded it without a word. *Save and finish
  later* was sitting right there in the action row and had to be **chosen in
  advance**, which is not how anybody closes a window. The draft feature was
  built precisely so a reviewer who runs out of day is picked up by a
  colleague, and the commonest way to run out of day is to close the tab.

  It asks now: **Save and close**, **Close and lose them**, **Keep reviewing**.
  Dirtiness is derived by comparing what `collect()` builds against what it
  built on mount, **not a `touched` flag set by two dozen onChange handlers** —
  a flag is a second record of one fact and one field always gets missed. It
  also makes typing a figure and typing it back correctly *not* dirty.

  **An untouched review closes with no question at all**, which is half the
  design: a confirmation on a screen somebody changed nothing on is the dialog
  that teaches people to dismiss dialogs unread, and then they dismiss this one.

  The X and the backdrop belong to `Modal`, which knows nothing about whatever
  form is inside it, so the review hands a guard **up** through a ref the parent
  checks: true means *I have taken the question*, false — every other modal, and
  this one when clean — lets the close happen. A failure **leaves the panel up
  with the reason on it**, the same rule `ConfirmRemove` follows and for a
  sharper reason: closing on a failed save reads as success and loses exactly
  what it promised to keep.

  **AUTO LIABILITY AND EMPLOYER'S LIABILITY JOIN UMBRELLA AS OPTIONAL**, each
  for a real reason rather than as a relaxation. A sub who brings tools in their
  own car and hires nothing has no commercial auto policy to name. Washington's
  workers' comp is a **state monopoly fund**, so there is no private employer's
  liability coverage part on a certificate here, and a sole proprietor with no
  employees has nothing to show on it anywhere. Umbrella is larger crews only.
  A line nobody can ever fill in makes a certificate nobody can ever verify —
  the permanently-amber failure `docs.js` exists to prevent, reached through the
  coverage grid — and a reviewer facing one either invents a number or gives up
  on the screen. The three CGL lines stay required: they are the cover the work
  runs on and every subcontractor doing it has them.

  **`optional` means the line may be BLANK, never that any figure will do.** A
  number typed below the minimum is still short and still needs a reason
  recorded against it. Both directions are asserted, because pinning only the
  blank case passes with the short-line check deleted.

  The footnote under the requirements table **named one line while three carry
  an asterisk**, so it explained a third of the marks above it. It reads
  `OPTIONAL_LINES` now. The document-request email already drove off the flag
  per line, so it carried the change with nothing to edit — which is what the
  flag is for, and why the footnote was the thing that was wrong.

  **AND SENDING IT BACK WAS BEHIND THE WORD MOST LIKELY TO STOP SOMEBODY.** The
  send-back pane — each fault named, an instruction per fault, a mail saying
  *everything else on it is fine, you do not need to start again* — was
  reachable only by pressing a red button reading **Reject**. A reviewer who has
  just marked three lines wrong is looking for *send this back*; Reject reads as
  ending the relationship, so the one action the whole findings pass was built
  for sat behind the one word that refuses it. Same button, same pane: with
  faults marked it says **Send back 3 to fix** and is amber-outlined; with none
  marked it really is a plain refusal and keeps the red and the word. **The
  state of the form decides which of the two it is, because that is what is
  actually true of it** — two buttons would be two doors into one screen to keep
  in step. Outlined rather than filled because it sits beside a solid green
  Verify, and two filled buttons of equal weight make somebody stop and read
  both.

- **The record goes in before the flags, because the other order is how a
  database ends up asserting documents it holds nothing about.** The upload
  route wrote `insurance = 1` and the filename, and *then* wrote the
  `company_docs` row inside a try/catch that swallowed anything
  `missingSchema` recognised. A detail write that failed therefore left the
  booleans already set: a roster reading *certificate of insurance — awaiting
  review*, with no record of what the certificate says, no expiry to chase,
  and nothing superseded. Which is the whole of what 037 exists for, silently
  not happening.

  It is not hypothetical. A live database was found with **every document
  flagged on file and `company_docs` completely empty** — the files in the
  bucket, the flags set, and not one row describing any of them. Nothing on
  any screen could report it, and the nightly expiry sweep had nothing to
  sweep.

  So the row is written first and a real failure **refuses before anything is
  written**, leaving the upload to be retried rather than half-recorded: the
  bytes are already in R2 and the same call repeated lands the same row, so a
  retry is safe. The one tolerated failure stays tolerated — the table not
  being there at all is a database behind the code, and documented — but it
  is **said rather than assumed**, in `detail` on the reply, so `recorded`
  and `not_migrated` can be told apart by the caller instead of both reading
  as success.

  The general form, and this file has now recorded it at four layers of the
  same feature: **a catch wide enough to hide a real error is a catch that
  will.** `missingSchema` is deliberately broad, which is right where it
  decides what to *tell* somebody and wrong where it decides whether to carry
  on writing.

- **Picking a file is not uploading one, and one form only did the first
  half.** `SubForm` — the roster's three-step Edit — took
  `e.target.files[0].name`, put it in local state, and `build()` then PATCHed
  that filename and the boolean onto the shared company row. **No bytes were
  ever sent.** So choosing a certificate recorded one that does not exist;
  `missingDocs` and `docsComplete` read those booleans, so the contractor went
  compliant and **assignable on the strength of a file nothing had stored**.
  In a product whose whole claim is that an expired certificate is worse than
  a missing one, this quietly manufactured the worst case of all: cover
  asserted over nothing. The only symptom arrived later and somewhere else —
  a document that would not open.

  It also drove a PATCH at the four columns `mayWriteCompanyDocs` guards,
  which is the back door that check exists to close, found again in a second
  caller.

  The rows upload through the **same two calls every other upload on this
  screen makes**, immediately rather than on Save, because a document is not
  part of the draft this form edits: it has its own routes, its own permission
  check and its own supersede-rather-than-overwrite rule. `build()` no longer
  sends `bond`, `insurance`, `contract` or `docFiles` at all.

  **On the add path the control cannot work and is gone.** A document attaches
  to a company row and there is not one yet, so four upload buttons with
  nothing behind them were offered; it says where they go instead of taking a
  file and dropping it.

  And **the bytes land before anything claims they did.** `uploadSubDoc` used
  to patch the row present and fire the two calls off unawaited, swallowing
  whatever they said — so a failed upload left the screen reading *awaiting
  review* over a file that never arrived. Every other optimistic patch here is
  recoverable by reloading; this one asserts cover. It uploads, then patches,
  then throws, and both callers show a busy state — which is what the optimism
  was buying — and say so when it fails.

- **The hero crew is six puppets now, and swapping it is four files, not one.**
  `hero-crew` is a `<picture>`: a WebP and a PNG, each at 1x and 2x, and every
  one of them has to carry a real alpha channel. `test:hero` already pinned
  that, because a supplied image once had **no alpha at all** — what looked
  like transparency was a picture OF a checkerboard, baked in, which on the
  dark forest hero would have rendered as a pale chequered rectangle with
  nothing in the build saying a word.

  **PNG: quantise, or ship 3.4MB.** Written with `palette:false` the 2x came out
  at 3,466KB against the previous 609KB — and this is the `fetchpriority="high"`
  LCP element on the front page. `palette:true` puts it back to 632KB with the
  alpha intact (alpha lives in `tRNS`, and the corner and clear/solid checks
  confirm it survives). Chrome takes the WebP, so the heavy PNG is only the
  fallback — which is exactly why nobody would have noticed.

  **Never upscale to keep the old descriptors.** The new file is 1535x1024, so
  1x is 768 and 2x is 1535; the `srcset` widths and the `width`/`height`
  attributes follow the files rather than the numbers that were there.

  **Two ways to get this wrong that the rendering assertions cannot see**, both
  found by mutation on this swap and both now pinned statically. A typo'd
  `srcset` filename passes every drawing check, because the browser quietly
  picks another candidate out of the set — and Chrome takes the
  `<source type="image/webp">` branch, so the PNG srcset, which is what an older
  browser gets, is never exercised at all. And wrong `width`/`height` attributes
  pass too, because the drawn box follows the CSS and the natural aspect
  whatever the attributes claim; what they actually buy is the space reserved
  **before** the image loads, so getting them wrong is invisible in a test and a
  layout shift in front of a reader.

  The alt text is part of the swap. It said *Five* sock-puppet subcontractors,
  and the new picture has six.

  **And the alignment had to reverse with it.** The crew was bottom-aligned with
  a -62px overrun into the hero's padding, so it "stood in" the hero — written
  for a 1.75-aspect picture. At 1.50 the same rule dropped it **176px below the
  headline** and finished it **114px above the last line of copy**, at 0.73 of
  the copy's height: a separate thing floating beside the text rather than the
  other half of the same block. It is top-aligned now, level with the h1 and
  finishing within 43px of the fine print.

  **The width is what makes that possible, and it is a real constraint.** A 1.50
  picture as tall as a ~530px column of copy needs about 750px, which is more
  than the column holds — hence the wider grid share (`1fr 1.2fr`), the overrun
  past the wrap, and `overflow-x:hidden` on `.hero` so a narrow desktop gets a
  clipped plank rather than a horizontal scrollbar. The left edge may sit
  slightly inside the widest line of text, which is fine because the cutout
  carries ~6% transparent margin of its own.

  Two things about the test for it. The no-sideways-scroll assertion **can no
  longer fail on this image** now that the hero clips, so a proportional
  right-clip bound replaces it — the tip of a plank is fine, half a puppet is
  not. And the first version of that bound was checked **only at the two widths
  that passed**, which is choosing the evidence: 1024 has a 30px page margin and
  really does clip. It is tested at 1024 too, and the height and bottom bounds
  are set where they hold across the whole desktop range rather than at the
  width that flatters them — still far from the bottom-aligned numbers they
  exist to catch.

- **The licensing reference publishes what it can stand behind, which is far
  fewer pages than the grid has cells.** Fifty-one jurisdictions times
  twenty-nine trades is 1,479 combinations, and the obvious move — generate all
  of them — produces 1,400 pages differing only in a state's name. That is the
  shape search engines demote and readers stop trusting, and it would be the
  loudest thing on the marketing site saying this product does not know what it
  is talking about.

  `app/shared/licensing.js` holds the rules and `content/licensing/data.js` holds
  the facts, with `app/scripts/build-licensing.mjs` between them. Two rules do
  the work.

  **A combination earns a URL only when its answer differs from the state's
  baseline.** `baseline` is what the state says about a trade it does not single
  out, which for most states is most of the twenty-nine; `trades` carries only
  the ones that differ. Everything else is `same_as_baseline` and points at the
  state hub, which says the baseline once. `specific` means the entry says
  something **different**, not that an entry exists — an early version checked
  only whether the key was present, so a row restating the baseline in other
  words counted as a difference and earned exactly the duplicate page this
  refuses.

  **Nothing publishes without a named source, a URL and a date it was checked**,
  and the trade entry needs its **own** — not the baseline's. Spreading the
  baseline's verification over the trade rows would let one checked fact vouch
  for twenty-eight unchecked ones, which is the failure mode that makes
  programmatic content worthless. `unverified` is the default, `STALE_AFTER_DAYS`
  retires an answer that has gone quiet, and the generator **prints what it
  skipped as a work queue** rather than shipping it: the skip report is how
  anybody knows which statute still needs reading. So the expensive half is the
  dataset, not the generator, and the schema makes that explicit.

  A state hub publishes even where no trade differs, because "nothing here needs
  a state licence" is a real answer people search for and it is the page every
  skipped combination points at. A trade hub needs **more than one** state
  saying something specific — below that it is a page listing one link.

  **All fifty-one publish, because a partial map reads as an abandoned one.** At
  eleven states the reader whose state was missing concluded the whole reference
  was unreliable — and applied that to the forty that *were* there. So every
  jurisdiction earns a hub, checked against `app/shared/states.js` rather than a
  hand-kept count, and a state whose hub would skip is a reader sent to a 404
  from the index.

  Which forces a distinction the schema did not previously make. An entry naming
  a real agency and a real URL, dated today, written by somebody who **did not
  open the statute** reads exactly like one that was read line by line. That
  difference cannot live in a commit message, so it lives in the data:
  `reviewed` is a per-entry flag nobody gets for free (`reviewed: "yes"` does not
  count — a truthy value is somebody guessing at the schema), `reviewQueue()`
  collects what is still owed a read, and `npm run licensing` prints it beside
  the skip report. Today that queue is the **whole dataset**, which is the honest
  reading: nothing in it has been checked back against its source, the original
  three included.

  It deliberately does **not** gate publishing, and the reason is a judgement
  about what kind of claim each field is. *Does this state license contractors,
  and which agency administers it* is a structural fact that is stable and cheap
  to get right. *Work over $25,000 needs a licence* is a figure set in statute
  that gets amended, and a page confidently naming last year's is worse than one
  that named none — so the generator says to check thresholds first. What
  unreviewed never means is **unsourced**: every published entry still carries a
  source, a URL and a date, every state that licenses or registers names who
  administers it, and a register claimed searchable has somewhere to search.

  Trade entries on the forty new states are deliberately **empty**. A trade page
  earns a URL only by saying something different from the baseline, and inventing
  thirty differences per state would produce exactly the 1,400 near-duplicate
  pages this design exists to refuse. They get added when somebody reads the
  statute and finds a real difference.

  **The offer comes before the lists, and both doors go to SIGNING UP.** The
  index led with two directories and put the CTA at the bottom, which spends the
  persuasion the page the reader arrived from had already done. And both CTAs
  pointed at `app.subsub.work`, which is the **sign-in** form — so a
  subcontractor who read the page, wanted the thing, and tapped the button was
  asked for a password they had never set. The whole point of these pages is
  reaching people with no account; sending them to a login is a dead end at the
  exact moment they were convinced. Both go to `get-started.html` now.

  The four documents are the **compliance pack**, which is what a general
  contractor calls them when they ask.

  **And "Get started" lands on the PLANS, wherever it is said.** It is the
  site's one call to action, in the header of every page and the body of
  several, and choosing a plan is the first question `get-started.html` asks —
  so a button that skips it drops somebody into a form whose first field is
  the thing the page they just left was helping them decide. Same reasoning
  the app's own sign-in card already follows. `developers.html` was the one
  that got it wrong, sending a reader who had just finished an API reference
  straight into setup. The one exception is **pricing.html itself**, where the
  reader has already chosen and the button is the way onward; a Get started
  there pointing back at the page it sits on is a button that does nothing.
  `test:discover` reads it off disk rather than from a list, so a page that
  grows a Get started tomorrow is in scope the moment it exists.

  **Two doors, because two people land on the same facts with opposite
  problems.** A subcontractor checking what they need, and a hiring contractor
  checking what to ask for. `ASKED_ANYWAY` is the bridge between them: the four
  documents every hiring account asks for whatever the state requires, which is
  the only reason either reader does anything. The subcontractor's door is the
  send-your-paperwork loop; the hiring contractor's is a roster. Neither is a
  directory — these pages answer a question about the law, and nothing on them
  names a company on SubSub.

  The pages reuse the marketing site's own chrome rather than copying it:
  `content/licensing/chrome.mjs` slices the header, footer and stylesheet out of
  `for-general-contractors.html` and rewrites relative links for depth, so the
  site's nav cannot drift away from 2,000 generated pages. `PAGE_CSS` is appended
  and every rule is prefixed `lic-`. `licensing/` is generated output — wiped and
  rewritten by `npm run licensing`, never hand-edited — and `sitemap.xml` is
  written from the same `plan()` the pages are, so it cannot list a page that
  does not exist.

  **And "on every page" has to mean every page.** The footer's Resources column
  carries the licensing hub and the API documentation, and `test:discover`
  checked it against a **hand-kept list of pages** — one that named nine and
  carried a comment saying `get-started.html` and `404.html` have no footer.
  Both do. So the two pages the list left out were exactly the two missing the
  column, and the test reported every page as correct. A list that decides what
  to check, written by whoever added the thing being checked, is the same record
  twice. It reads the directory now: any root page containing
  `<footer class="site">` is in scope the moment it exists.

  Adding the column to those two then broke their layout, which the same run
  caught: `.foot` was still `1.4fr 1fr 1fr` there, so a fourth `<div>` wrapped
  under the brand blurb and read as an orphan. The column count and the number
  of columns are a third pair of records, and the existing assertion on the grid
  was already pinning it — for the nine pages the list knew about.

  The generated pages take the footer from the chrome slice, so the site reaches
  all seventy-one of them — but only after `npm run licensing`. Forgetting that
  leaves two thirds of the site on last month's footer, silently, and those are
  the pages search engines send people to. The link is relative and rewritten
  for depth, and the first version of that check **recomputed the depth itself**
  and got it wrong for every state hub, reporting seventy-one correct pages as
  broken. It resolves the href against the file it sits in now: a test that
  recomputes what the generator already computed is a second implementation to
  keep in step.

  **Pages nobody links are pages nobody reads.** All thirteen shipped orphaned:
  absent from the root `sitemap.xml`, with `licensing/sitemap.xml` never declared
  in `robots.txt`, and nothing on subsub.work pointing at the directory. Every
  page rendered correctly and no crawler could reach one — a wiring bug whose
  only symptom is traffic that never arrives, which is why it has a test of its
  own (`test:discover`). A Resources column in the footer, which the chrome slice
  carries onto the generated pages at their own depth for free; the hub in the
  root sitemap; the generated sitemap **declared beside** it rather than merged
  into it, because it is written from `plan()` and a hand-kept copy would go
  stale the first time a state is added; and a contextual link from each of the
  four audience pages, where the anchor text can say what is on the other end.

  **The markup answers the question the page is.** A trade page's H1 *is* the
  search query, so each page carries `FAQPage`, plus a `WebPage` with
  `dateModified` and the source as a `citation` — the "Checked <date>" line was
  visible but not machine-readable, and currency is the entire claim these pages
  make. The rule that keeps it safe: **every marked-up answer must be text the
  reader can see.** Each pair is assembled from the same values the body renders,
  and the test checks every answer word by word against the page's own visible
  text — not verbatim, because the body puts "Who administers it" in a table cell
  while the answer says "X administers it", but a fabricated answer scores 2/13
  and fails. Where a state publishes no register that question is omitted rather
  than answered thinly, and the index gets one pair rather than four
  manufactured ones.

  `JSON.stringify` does not escape `<`, and `data.js` is hand-edited prose, so a
  source name containing `</script>` would have closed the block and turned the
  rest of the page into markup. Everything goes through `ldJson`. The
  `\uXXXX` guard is scoped past `<script>` blocks and past the embed panel's
  code block for the same reason: both legitimately contain escapes, and the
  guard is about an escape showing up as six characters in front of somebody.

- **You may ask your own roster to price a job before you commit.** Part of
  "pre-award" already existed and nobody noticed: a work order with
  `status = 'pending'` **is** a pre-award view — the subcontractor sees the job,
  the scope and the price, and accepts or declines before anything is
  committed. What did not exist is the case where the account does not know the
  price yet and wants two or three of its own roofers to quote the same trade
  first. Work orders cannot express that: issuing one commits to a number, and
  issuing three for one trade collides on the live-WO index.

  So this is **overflow's shape pointed at the account's own roster**. Ask
  several, they answer with a price and a date, you pick, and picking issues the
  work order. `app/shared/quotes.js` holds the rules; migration 043 holds the
  tables. **None of overflow's gates apply** — no opt-in, no three months, no
  rating floor, no fee — because these are already your contractors, which is the
  product. The precondition is overflow's exactly inverted: overflow is refused
  when you *have* somebody of your own, and this is only available then.

  Three things are load-bearing:

  **Nothing travels sideways.** An invited company never learns who else was
  asked, what they quoted, or who won. These are competing bids and one of them
  is the price the account is about to pay — a sharper version of the reason
  `overflow_invites` is server-side only. After an award each side is told about
  **itself**: the winner that they won, everybody else that they did not, never
  by whom or for how much.

  **A quote request is a key to one job, never to the list.** It must not become
  a second door into what the `/api/jobs` scoping closed. `quoteJobShape` passes
  the job, the address, the date and the one trade they are pricing, and
  withholds the other trades' assignments, the account's notes and the tenant's
  report. `assignments` is empty, not absent — the same white-screen rule
  `inheritedShape` follows, and the honest answer besides: nobody is assigned,
  which is why they are being asked.

  **Awarding issues the work order at the number they gave**, which is the whole
  point of having asked, and it is still `pending` — they accept or decline it
  like any other. Awarding to somebody who never answered is refused: that would
  issue a work order at a price nobody agreed to.

  On the screen it sits beside *Assign* and *Overflow* on a trade row with
  nobody in it, because those are the three ways to fill a slot and they differ
  by what you know: assign when you know who and what; ask for quotes when you
  know who but not what; overflow when you do not have anybody. The
  subcontractor's card is deliberately **not** shaped like a job request — no
  countdown, no accept, no decline, because nothing is on offer yet. And a
  spread is only shown once two people have answered: one quote is a price, not
  a comparison, and "lowest of 1" invites reading it as one.

- **A CRM posts the job; a person still picks who does it.** A general
  contractor schedules work in JobNimbus, and until now retyped it into SubSub
  or did not use SubSub for it. `POST /api/v1/jobs` is that job arriving by
  itself, landing with its **trades unassigned** — which is the *Unassigned
  trade slots* tile already on the dashboard, and the thing an account opens
  SubSub to clear. Nothing about finding or assigning a contractor happens on
  the API, and that is the line: this is the arrival, not the hiring.

  `app/shared/ingest.js` holds the field rules, because three things have to
  agree about them and they get written by different hands at different times —
  the route, the published documentation, and the tests. A field required by
  the route and optional in the docs is an integration that fails at 2am
  against a page saying it should work.

  **Required means five fields, not every column a job has.** The instinct is
  to require the lot. That is wrong in the direction this file refuses
  elsewhere: `sqft`, `stories` and the material supplier are optional on the
  screen a person uses, and an API stricter than the form makes an integration
  fail over a number no CRM holds. Required is `externalId`, `title`, `trades`,
  `date`, and a location — each one a thing the job cannot work without.
  `trades` because it is what becomes the slots, so a job without them arrives
  and lands nowhere; `date` because the whole premise is a *scheduled* job and
  without it this is a lead endpoint, which it is not.

  **`externalId` is the one nobody asks for and every integration needs.** A
  webhook that does not get a 200 sends again, and one scheduled job becoming
  four is four contractors asked to show up on a Tuesday — discovered when they
  do. So the CRM's own id is required, and a second delivery answers **200 with
  `duplicate: true`** and the id of the job that already exists, rather than
  201 and another row.

  Two mechanisms hold that and **they are not interchangeable**. The route asks
  before inserting, which makes the ordinary retry cheap and hands back the job
  id; `ux_job_sources_external` is what is correct when two deliveries arrive at
  **once**, which the pre-check cannot cover by construction. Removing either
  one alone leaves a sequential retry test passing, so the unique constraint is
  asserted **directly** — otherwise the half that matters under load could go
  with nothing noticing. Scoped to the account as well as the source, because
  two customers on JobNimbus will both have a job numbered 1041.

  **The token is never stored.** `api_tokens.token_hash` is a SHA-256, the way
  a password would be, so a copy of that table is not a working key to every
  customer's integration. It follows that it can be shown exactly once, and the
  panel says so **while the token is on screen** rather than in help text read
  afterwards, which is too late to act on. `prefix` is kept in the clear
  because it is the only way somebody holding three tokens can tell which row
  is which without reading any of them.

  **Revoked, not deleted.** The jobs a token created are real work somebody may
  already be booked for, so the row stays and the list keeps showing it dimmed:
  "where did these jobs come from" has to survive somebody turning the key off.

  **Scale is checked on every call, not only at minting** — otherwise it is a
  thing you buy once and keep. And a **revoked token answers exactly as a
  made-up one does**: a separate `token_revoked` reply tells somebody holding a
  stolen key that it was real and whose account it belonged to, which is the
  same oracle the connect lookup and the handover subdomain lookup both refuse
  to be. The test compares the two replies rather than trusting the wording.

  A subcontractor account cannot take one, for the reason it cannot create a
  job on the screen: it has nobody to assign, so the slots could never be
  filled. `/api/v1/*` is on the public-route exemption list and does its whole
  check inline — **exempt from the session middleware is not the same as
  unauthenticated**, and a test posts a signed-in seat's headers at it to prove
  they are not a way in.

  `created_by` is deliberately **NULL**: no person created it. Nothing reads
  that column, and naming the token's owner would put a sentence in the audit
  trail saying somebody did a thing they did not do. Provenance lives on
  `job_sources`, where it is true.

  Migration 048 is **one paste and no `ALTER TABLE`.** The obvious shape was two
  columns on `jobs`, and `ADD COLUMN` is the one statement that cannot be run
  twice — so it would need its own paste and an operator who gets the order
  right. A separate table also reads correctly: where a job came from is a fact
  about how it arrived, not about the work. Every statement is `IF NOT EXISTS`,
  so running the file again does nothing.

  The docs are `developers.html`, built from the site's **own** header, footer
  and stylesheet through `content/licensing/chrome.mjs` rather than a copy, so
  the nav cannot drift. It is a hand-written page committed to the repo, not
  generated output — the body is prose about an API and regenerating it on
  every build would mean it could not be edited without a script. `/developers`
  needs **no `_redirects` entry**: Pages already serves it from the file, and
  the extensionless rules in there loop. `test:discover` walks it, which was
  checked by pointing the link at a page that does not exist and watching it
  fail.

- **JobNimbus cannot call the generic endpoint, and the reason is not a
  rename.** `/api/v1/jobs` is for somebody writing code. Three things stop a
  CRM being that somebody. Its automation Webhook action takes a **URL and
  nothing else** — no field for a header, so `Authorization: Bearer` cannot be
  set. It sends **its own field names** (`jnid`, `date_start`,
  `address_line1`). And it has **no concept of a trade**: nothing in the
  payload says `roofing`.

  Two of those are translation. The third is an account decision, and it is
  what `app/shared/crmmap.js` and migration 049 exist for.

  The token therefore travels in the **path** —
  `/api/v1/hooks/jobnimbus/:token` — which is the same shape and the same
  reasoning as `/api/pack/:token`: a 32-byte random value either way, and the
  only door a system that cannot set a header can come through.
  `apiCallerByPathToken` shares every check with the header route rather than
  being a lighter one, and a test drives a downgraded account at it to prove
  the plan gate still fires.

  **A job whose words map to nothing still ARRIVES, and that is the whole
  design.** Refusing it is the worst answer available: the webhook does not
  get a 200, so it retries, so it keeps not getting one — and **nobody is
  told**. The job never lands, the account never learns it did not, and the
  only symptom is work quietly missing from SubSub. So it lands with no
  trades, the reply says `needsTrades` while whoever is setting it up is still
  looking at the screen, and the unrecognised words are **counted** in
  `crm_unmapped`. "Three jobs arrived with type Roof Replacement" is a
  question somebody answers in one tap; "some jobs had no trades" is a
  mystery. Answering it **clears the row**, because a queue that keeps
  answered work in it stops meaning anything.

  Three properties of the matching, each mutation-tested. It is **union, not
  first-match**: a job tagged both roof and gutters needs both trades, and
  picking one silently drops a slot discovered when the gutter crew never
  turns up. It is **whole-value and case-insensitive, never a prefix** — a
  rule for `Roofing` catching `Roofing Inspection — no work` is how a roofer
  ends up on a job nobody is roofing, which is the same instinct the connect
  lookup follows for a different reason. And a rule matches **one named
  field**, never a sweep of the payload, so somebody can read their own rules
  back and know what each does.

  Two traps in their data. `date_start` is **epoch seconds**; read as
  milliseconds it lands in 1970 and the job sits in a calendar nobody will
  scroll to. And `address_line2` is an **addition to a street, never a street**
  — "Unit B" with no line1 would otherwise satisfy the has-a-location check
  with nothing a contractor can be sent to.

  `ingestJob` is **one implementation**, shared by the generic endpoint and
  every CRM-shaped receiver. Two copies of an insert carrying duplicate
  protection this specific is two places for the guard to rot.

  Worth recording because it decides the architecture: JobNimbus **API access
  is gated to their ~$550/month tier**, while automations and webhooks are
  available on the ~$225 one. A webhook receiver therefore reaches far more of
  their customers than a pull integration using their API key would — and we
  never hold somebody's CRM credential.

- **One CRM is the first one, not the subject.** Every user-facing string this
  feature shipped with named JobNimbus — the token panel's note, the mapping
  screen's note, the token-name placeholder — because it was the only receiver
  when they were written. Many systems will post here, and a screen naming one
  of them tells everybody else the feature is not for them: the same reading
  error as *you need a general contractor account*, arrived at from a different
  direction, and it costs the integration nobody sets up.

  The panel is **Connect your CRM**, and the general answer is **named rather
  than gestured at** — Zapier, Make, n8n, your own script — because "works with
  any CRM" is true and useless: somebody has to know their tool's step is called
  a webhook before they can go and look for it. One CRM's name still belongs in
  exactly one place, the list of systems SubSub translates for, where it is a
  fact rather than a claim about who the feature is for. So the test asserts on
  the **headings and the notes** and deliberately not on the picker.

  **And the screen now hands over the thing somebody actually pastes.** The
  panel minted a secret and stopped, leaving them to assemble
  `/api/v1/hooks/<source>/<token>` out of the developer docs — which
  documented the header endpoint and **not the hook route at all**, so the half
  that answers "does this work with my CRM" was the undocumented half. Fifth
  time this file has recorded correct pieces with no way in. The address is in
  the minted box, with a picker that rewrites it, because it **cannot be added
  later for that token**: the token is hashed the moment the box closes.

  Three strings per preset, because they go three places with different jobs and
  one field doing all three produced *This Your own system record is missing
  externalId* in a refusal. `label` is a noun inside a sentence, `short` is a
  name inside a row, `pick` is the option somebody chooses and has to teach.
  `short` falls back to `label` and `pick` to `short`, so a named CRM needs only
  `label`.

- **A rule belongs to the account, not to a CRM, and getting that backwards was
  a rule that fired for nobody.** `crm_trade_rules.source` was required, the
  screen sent none, and the route defaulted to `jobnimbus` — so every rule an
  account saved was filed against a CRM they might not use. It was accepted,
  listed back to them, and matched nothing. The queue row was not cleared
  either, because that `DELETE` was scoped the same way, so the same button
  could be pressed forever. Both halves silent, which is the only kind of bug
  this screen can have: nothing on it can tell you a rule did not fire.

  Adding a *which CRM is this for* selector would have fixed the mechanism and
  kept the mistake. The premise was wrong: the words are the **account's own**,
  typed into their own system, and "Roof Replacement" means roofing whichever
  system sends it. A per-source dictionary is the same dictionary retyped per
  CRM with a silently dead rule as the price of forgetting.

  So `ANY_SOURCE` (`'*'`) is the default and the common case, the receiver reads
  `source = ? OR source = '*'`, and a named source still narrows for the account
  that really does run two systems disagreeing about a word. **No migration**:
  the column was always `TEXT NOT NULL` and `'*'` is a value, so 049 is
  unchanged apart from a comment that no longer lies about what it means.

  Three things the screen does with it. An any-CRM rule carries **no qualifier**,
  because "every CRM" on every row is noise on the common case to label the rare
  one; a narrowed rule says **JobNimbus only**, because that is the reason it
  does not fire elsewhere; and the queue row keeps **where the word arrived
  from**, because that is a fact about the job rather than about the rule — the
  difference between *our CRM is mis-set-up* and *that Zapier run is*.

  Answering a word clears it **wherever it arrived from** when the answer applies
  everywhere, and only its own copy when narrowed. A queue row that survives
  being answered is a button somebody presses again, and again.

- **`shared/ingest.js` exists so three records agree, and only two were ever
  checked.** The route, the tests and the **published page** all describe the
  same fields, written by different hands at different times — a field required
  by the route and optional on the page is an integration that fails at 2am
  against documentation saying it should work. Nothing read the page.

  It found the real gap on its first run: `developers.html` documented the
  header endpoint and **not the hook route at all**, so the half that answers
  *does this work with my CRM* — the path-token address every automation
  builder and every CRM webhook step actually uses — was undocumented while the
  panel sent people there to read about it. Also two optional fields the route
  accepts and the page never named.

  Two things about the assertions themselves. **A field is documented when it
  has a row somebody can read, not when the string appears on the page**:
  deleting the `generic` row from the receivers table left the word in two
  paragraphs of prose below it and the check passed, which is the class of
  assertion mutation keeps catching here. It reads the `<td>` cells now. And the
  **first attempt at that was wrong in the other direction** — it matched three
  shapes a row can take and missed `address` *or* `propertyId`, reporting a
  documented field as missing, which would send somebody to add a row that is
  already there.

  It also pins that the panel the docs name by heading is a heading the app
  actually has. Renaming a panel silently turns a set of directions into a
  dead end on the reader's own screen.

  **And the page itself went by three names.** *Developer tools* in the footer
  of every page, *SubSub API — post scheduled jobs from your CRM* in the tab,
  and *Post scheduled jobs into SubSub* as its own heading. Three names for
  one page is how somebody concludes there are three pages — the same trap as
  a panel headed *Your code* under a menu entry reading *My QR code*.

  **And *Developer tools* was the one of the three that could not be kept.**
  The page says *no SDK* in its first paragraph and names Zapier, Make and
  n8n in the one after, so it is for anybody connecting a CRM; filing it under
  Developer tools tells a general contractor setting up a Zapier step that it
  is not for them — the same reading error as naming a screen after one CRM,
  and it costs the integration nobody sets up. It is **Connect your CRM**
  everywhere now, which is also what the panel in the app is called, so the
  page and the thing it sends you to share a name.

  The URL stays `/developers`: a URL is not a heading, the recorded decision
  about it is about routing, and moving it would break every link to it for
  nothing.

  `test:discover` reads the name **off the destination's own H1** rather than
  holding a fourth copy of it, so the footer and the page cannot drift and a
  rename is made in one place. It also pins that the H1 is a **name rather
  than a sentence** (four words or fewer) and that the tab leads with it, or a
  row of open tabs names the page a fourth way.

- **A regex over somebody else's file is a second copy of their shape, kept by
  hand.** `build-licensing.mjs` read the trade list by matching
  `const CATEGORIES = [...]` out of `App.tsx`, because at the time that array
  was the only place ids and labels sat together and it carried a React icon
  per entry that could not cross into a build script. Both halves stopped
  being true the moment `shared/trades.js` became the one list and the icons
  moved to being attached by id — and the regex then matched nothing, so the
  generator **threw on startup** and the 71 generated pages could not be
  rebuilt at all.

  Silently, because nothing runs `npm run licensing` in CI. What caught it was
  `test:discover` noticing those pages still carried the PREVIOUS footer: the
  output going stale is observable where the generator refusing to start is
  not. It imports now, which removes the failure mode rather than repairing
  it.

- **The mapping screen leads with the queue, not the rules.** `crm_trade_rules`
  shipped with routes, tests and no way in — the fourth time this file has
  recorded correct pieces nobody could reach, and for the person who runs a
  roofing company "create it by API" means not at all.

  What decides the layout is that **only one half of this screen has work in
  it**. A list of rules somebody already wrote is reference. The unanswered
  words are jobs sitting on the Jobs screen that cannot be assigned, each one
  explained by a single word nobody has translated yet. So the queue is
  **above** the rules, counted (`3 jobs so far`, because one is a curiosity and
  three is a pattern), and answered in place — press *What is it?*, pick the
  trades, done. The test measures `getBoundingClientRect().top` on both rather
  than trusting source order.

  **It says the jobs are safe, and that sentence is load-bearing.** "These
  arrived and meant nothing to SubSub" reads as *they were rejected*, and
  somebody who believes that goes hunting in their CRM instead of looking at
  their own Jobs screen. The copy names where the jobs actually are.

  It rendered for an **admin or a project manager**, because that is what
  `requireRole("admin", "pm")` allowed on the route — and `canManage` is
  admin-only, so using it here would have made the screen stricter than the
  route, which this file has already called the same lie as looser.
  **Both halves are admin now, and the narrowing was the route's rather than
  the screen's.** The old reasoning was not silly and is kept because it is the
  reasoning a later pass would arrive at again: answering *Roof Replacement
  means roofing* is trade knowledge, which a project manager has more of than
  an admin. What it missed is what a rule **is** — the dictionary the receiver
  reads to decide what arrives on the account, from then on, for every job from
  every CRM. That is the same account-level decision as the key that creates
  those jobs, and the token panel directly above it has been admin-only since
  it shipped. So a project manager held **half of one integration**, which is
  the worst of the three available answers. The queue an admin now owns is
  still work either way, and the jobs it is about are on the Jobs screen —
  which is the sentence that panel leads with.

  It sits directly below the API token panel so setting a CRM up is one story
  on one tab. A half-configured integration is what you get when the second
  half is somewhere else.

  And the form **says matching is whole-value** where somebody is typing, not
  in help text: a person entering `Roof` reasonably expects it to catch
  `Roof Replacement`, and finding out otherwise costs a week of jobs arriving
  unmapped.

  One test trap worth keeping: `.form-sec` is `text-transform: uppercase`, and
  Chrome's `innerText` applies it. A case-sensitive assertion against a
  heading is testing the stylesheet.

- **Adding a CRM is a row, not a release.** The JobNimbus receiver was written
  by hand and had to be. Writing the next four that way costs four builds,
  four test suites and four sets of quirks found by hitting them — and **two of
  JobNimbus's three were only found because a test failed**, which is not a
  process that scales by repetition.

  So the translation is **data**. `app/shared/crmsources.js` holds a preset per
  source: where the record sits in the payload, which of their fields is which
  of ours, and how their dates are written. `/api/v1/hooks/:source/:token`
  reads it. The whole hand-written JobNimbus translator is gone and its 47
  assertions passed unchanged against the engine, which is the only evidence
  that mattered.

  **No preset for a CRM whose real payload nobody has seen.** Inventing
  plausible field names for AccuLynx would produce an integration that looks
  supported, fails on first contact, and fails in the way that is hardest to
  debug — silently, against documentation saying it works. Same rule the
  licensing dataset runs on, and `verified` records which presets it is true
  of. Today that is JobNimbus and `generic`.

  `generic` is our own field names over a path token, for anything that can
  POST JSON but cannot set a header — most automation builders' webhook step,
  and any in-house script.

  **Dates are named per source, never sniffed.** `epoch_s` read as
  milliseconds lands in 1970; `3/14/2026` and `14/03/2026` are the same shape
  and nine months apart, and guessing wrong puts a crew on site early with
  nothing looking wrong until they arrive. Two checks guard a date and they
  are **not interchangeable**: the range check catches month 14, and only the
  calendar round-trip catches 31 February. Asserting month 14 alone passed
  with the round-trip deleted, so both cases are pinned.

  **Errors name THEIR field, not ours.** An integrator reading
  `jnid is missing` knows what to do; `externalId is missing` names something
  they have never heard of.

  **Two lists exist that look interchangeable and are not.** `SOURCES` in
  `ingest.js` is what a job's *provenance* may be called; `SOURCE_PRESETS` is
  what SubSub can *translate*, which is smaller. The rules route validated
  against the wider one, which silently stored a `generic` rule as a JobNimbus
  one — where it failed to fire for its owner and fired on somebody else's
  words. Rules are only ever read by a receiver, so they validate against the
  presets, and a test pins that every preset name is a valid provenance label
  so the two cannot drift.

  And an unrecognised source on a rule is **refused, not defaulted**. Falling
  back to JobNimbus files a rule somebody believes is for AccuLynx against a
  CRM it will fire on. Silence is only safe when nothing was asked; here
  something was, and it was not understood.

  **AND THE MARKETING SITE ANSWERS *WILL IT WORK WITH MINE* IN THREE TIERS,
  BECAUSE THEY ARE THREE DIFFERENT PROMISES.** The index never answered it at
  all, which is a top-three objection for a general contractor — and the
  receivers table that does answer it sits halfway down a page about field
  names. A flat wall of logos was the obvious move and it is refused for this
  entry's own reason, one layer out: **a name on a marketing page is a stronger
  claim than a field map**, because nobody reads the caveat under a row of
  names. A ServiceTitan logo is a promise that ServiceTitan works.

  So: **Built in** (SubSub reads their fields — JobNimbus), **Through an
  automation tool** (Zapier, Make, n8n — a claim about the sender, true today
  and always was), and **Everything else** (a webhook address). Only the first
  is a claim about SubSub, and the page says so in those words.

  **The first tier is pinned to `SOURCE_PRESETS`, exactly and in both
  directions.** Each name carries `data-src`, and `test:discover` requires
  those ids to equal the `verified` presets with `generic` excluded. A preset
  missing from the page is a receiver nobody is told about; a name on the page
  with no preset is the looks-supported-fails-silently failure with better
  typography. **Checking one direction passes with "ServiceTitan" sitting in
  that list**, which is the mutation that proves it.

  Hand-written in both pages rather than generated, because the marketing site
  has no build step — the same trade `get-started.html`'s copy of the states
  list already makes, with a test keeping it honest rather than a generator.
  The two pages are also required to use the **same three tier names in the
  same order**: somebody arrives at the developer page from the index, and a
  second vocabulary for one fact reads as two different answers.

  **Logos are deliberately not shipped**, and that is a decision rather than a
  gap. Text names carry nearly all of the recognition at none of the trademark
  question — reproducing somebody's mark is governed by their brand guidelines,
  which is a lawyer's five minutes and not a build's.

  One layout note worth keeping, because it is this file's oldest shape in a
  new place: the three paragraphs are different lengths, so the name chips sat
  at three different heights. The card is a flex column with the names pushed
  down by `margin:auto 0 0`, and **a row that is almost aligned reads as a
  mistake rather than as a table** — the same sentence the compliance pack's
  date column earned. Asserted as the mechanism rather than the position,
  because this suite is static and both halves are needed for either to work.

  **Still open, and pre-existing:** `developers.html` scrolls sideways at
  390px — the field tables and the long webhook URLs overflow, measured at 541px
  against a 390px viewport with none of this change applied. It matters slightly
  more now that the index links to it.


- **The comparison pages name OTHER COMPANIES' prices, which is what makes them
  different from every other page here.** Everything else on this site describes
  SubSub, where being wrong is embarrassing. Seven of these describe a
  competitor, where being wrong is a reader quoting a figure at a salesperson
  who corrects them — and two of the seven, Buildertrend and Procore, publish no
  pricing at all, so those are ranges read off somebody's page on a particular
  day.

  So **the review date is data, not a line in a README.** `updated:` is in each
  file's frontmatter, rendered where a reader can weigh it, and `test:compare`
  fails once a page is past `STALE_AFTER_DAYS` — a quarter plus a fortnight to
  act on it. It **names the pages**, because a count is not a work queue. Same
  rule the licensing dataset runs on, and for the same reason: *re-check
  quarterly* written in a README is a thing nobody does.

  **Three claims were checked against the product rather than against memory,
  and two were wrong.**

  The **licence** one is the sharp one. `SOCRATA_STATES` wires seven states and
  exactly one — WA — carries `fieldMappingVerified: true`; the comment above it
  says the other six have never been exercised against a live response, and the
  whole marketing site says WA L&I. A page saying *verified against the state
  registry* reads as true to a Texas GC and is not. The guard reads the
  **Worker** for the count rather than holding a second copy of it, and requires
  any page using that phrase to name Washington.

  **Payment** has not shipped — the site says *Coming soon* in three places —
  and the hub listed `pay` among what SubSub does. **And the guard for it could
  not fail.** The first version kept only sentence fragments containing the word
  "SubSub", on the reasoning that the rest are about competitors; every one of
  these pages is about SubSub throughout, so the subject is usually in the
  *previous* sentence. The mutation that proved it — changing the hub to read
  *"…dispatch, warranty and paying your subcontractors"* — sailed straight
  through. It is an **allow list** now: every use of the word is flagged and the
  senses that are legitimately not a claim about shipped functionality are
  struck out by name, so unknown means flag it.

  **And the hub had no disclosure at all** — seven comparisons written by the
  company being compared, recommended from a page that did not say so. The test
  found it, which is the only reason it is there.

- **These are generated, and the three traps they hit are all already in this
  file.** `content/compare/pages/*.md` is the source, `npm run compare` writes
  `compare/` and `blog/`. Generated rather than nine hand-written files for the
  reason the licensing pages are: the header, footer and stylesheet are sliced
  out of a real page at build time, so changing the nav cannot leave nine pages
  wearing last month's — which is silent, and they are the pages a search engine
  sends people to. Markdown rather than a data structure because these are
  **prose**, and prose edited as a JavaScript object is prose nobody edits.

  **`readChrome().css` is a whole `<style>` block, not its contents.** Wrapping
  it in another `<style>` closed it at the inner tag, so four kilobytes of the
  site's stylesheet rendered **to the page as text** on an unstyled page. Every
  static assertion passed while it did: the header was present, the footer was
  present, every heading was present. *Present in the source* and *in force in a
  browser* are different questions and only the second is the one anybody cares
  about, so `test:compare` loads a built page and asserts the stylesheet parsed,
  that no CSS leaks as text, and that the page's own rules applied. The slice
  now says what it returns, where the next caller reads it.

  **The backtick trap, for the seventh time**, in a comment explaining a CSS
  rule inside `PAGE_CSS`. The one-line guard this file prescribes is beside it.

  **And not scrolling sideways was only half of the phone fix.** The first
  version put each table in an overflow box: the page was fine and the table
  clipped its last column mid-word — *Mid-size to enterprise commercial
  constructio* — which reads as a broken page rather than as a table with more
  to the right, and a scroll shadow is too quiet to argue otherwise. At 560px
  the rows **stack**, each answer carrying its column's heading from `data-h`,
  because two bare values under one label say nothing about which product is
  which. The markup does not change, so it is still a table to a crawler and on
  a wide screen. The assertions measure **cells**, not the page.

  **Every marked-up answer is text the reader can see.** The FAQ pairs are read
  out of the body rather than written a second time beside it, and each is
  checked word by word against the page's own visible text — a fabricated answer
  scores near zero. Same rule, and same test shape, as the licensing pages.

  Still open and unchanged: `developers.html` scrolls sideways at 390px.

- **The Zapier app buys no capability, and that is the honest way to describe
  it.** `/api/v1/hooks/generic/<token>` already worked from a *Webhooks by
  Zapier* step. What the app adds is three things worth having anyway: the
  token lives in a Zapier **connection** rather than in a URL somebody
  screenshots; *Trades* is a **dropdown** instead of a text box where a typo is
  a job arriving with a slot nobody can fill, discovered when the crew does not
  turn up; and "SubSub" in Zapier's directory is a door, where a URL in our
  documentation is not. The docs say exactly that, including the sentence that
  a webhook step does the same job today.

  It uses the **header** endpoint, not the path-token one, because Zapier can
  set an `Authorization` header. The path token exists for systems that cannot,
  and reaching for it here would put a secret in a field for no reason.

  `zapier/` is Platform **CLI** source committed to this repo rather than an app
  built in their Visual Builder, because a Visual Builder app is configuration
  nobody outside that console can read, review or test. Pushing it needs a
  Zapier account and a terminal; neither is a SubSub credential, and the API
  token belongs to whoever connects it.

  Three things in it are decisions. The auth test is a **read**
  (`GET /api/v1/me`), because Zapier re-runs it whenever a call 401s and
  testing a key by creating a job would put a test row on somebody's Jobs
  screen every time. `duplicate: true` is a **success**, since a webhook that
  does not get a 200 retries and treating a retry as a failure is how one job
  becomes four. And `afterResponse` turns a refusal into a sentence: left
  alone, Zapier shows "Got 400" and buries which field was wrong, so somebody
  rebuilds a working Zap looking for a mistake that was reported and not shown
  — and a 401 must throw `RefreshAuthError` or they are told their Zap is
  broken rather than their connection needs reconnecting.

- **The Zapier app deploys from Actions, because the alternative is impossible
  here rather than merely inconvenient.** `zapier push` runs from a terminal and
  whoever runs this repository has a browser on an iPad, so the terminal is a
  runner, the credential is `ZAPIER_DEPLOY_KEY` in repository secrets, and the
  person presses Run workflow like they do for the other three. The deploy key
  is **not a SubSub credential**: it authorises publishing to Zapier's account,
  and the API token a customer connects with is theirs and never seen there.

  **Registering is an explicit press, not something a deploy does when it
  notices a file is missing.** `zapier register` creates the integration and
  writes `.zapierapprc`; run it twice and there are two integrations, with this
  repository pushing to the second while customers are connected to the first.
  So it is a `workflow_dispatch` input defaulting to false, the workflow
  **commits `.zapierapprc` back** on that path, and it prints the id as well —
  if the commit fails, that print is the only remaining record of which
  integration was created.

  **`--category` and `--role` are deliberately not baked in.** They are choice
  lists Zapier serves from its own API — `register --help` itself fetches them —
  so a value guessed here is a first press that fails. They are empty inputs,
  appended only when given, and the step says to re-run with whatever the error
  named. Guessing would have been the confident-and-wrong answer this file
  keeps recording.

  And a push is **uploaded, not live**: a pushed version serves nobody until it
  is promoted, and promoting moves real Zaps onto it. The summary says that
  rather than implying more.

  **AND THE STEP THAT KEEPS THE APP ID COMMITTED NOTHING, GREENLY.** The press
  that registered created integration **247047**, pushed version 1.0.0, and
  every step reported success — while `.zapierapprc` never reached the
  repository. `git diff --quiet` compares **tracked** files, the file had never
  been in the repo, so a brand-new untracked file has nothing to compare and
  exits 0. The step printed *"unchanged; nothing to commit"*, which reads like
  an ordinary no-op on a re-run, and the one record that stops the next press
  creating a **second** integration went with the runner.

  So `git add -f` runs **first** and the question is asked of the **index**,
  which is the only thing that knows about a new file — and then the step
  **proves it from the repository**: `git ls-files --error-unmatch` after the
  push, because every command above it can succeed and leave the file
  untracked, which is exactly what happened. Same rule `deploy-app.yml` already
  followed about its own bundle — *prove it from the artifact, never from the
  variable* — applied to the thing beside it, for the second time.

  **Only `id` is written by hand, and only because the log carried it.** The
  CLI writes `{ id, key }` and reads **`id` alone** — `key` is never read back
  — so recovering the row needed one value that the run had printed, not a
  remembered one. A `key` invented to complete the shape would be the broken-052
  mistake in a smaller place; the next `register` merges its own in.

  **The registration values are two boxes and the form orders them the other
  way round.** Category is above role on the dispatch form, and every
  instruction about them reads role-then-category, so filling top to bottom
  puts each word in the other box. Both descriptions said *"Required with
  register"* — the same sentence twice, saying nothing about which word belongs
  in which. Each box names its own values now, and the register step refuses a
  swap **by name**, because the two lists share nothing: left to the CLI it
  costs two presses, since it reports the first wrong value and stops.

- **Two things about the Zapier package were wrong, and `zapier validate` is
  what found both — not reasoning about them.** Running it locally cost one
  command and caught what would otherwise have been a failed first press.

  **`zapier-platform-core` must be pinned EXACTLY.** `^15.5.1` is refused
  outright, and the reason is better than the rule: that version decides which
  Lambda runtime Zapier runs the app on, so a range means "whatever npm
  resolved on the machine that pushed". Pinned at 19.1.0, with a test that the
  lockfile agrees — `index.js` reports `platformVersion` off the installed core,
  so a lockfile disagreeing with `package.json` publishes under a version nobody
  declared.

  **`.zapierapprc` is committed.** It was gitignored on the reasoning that the
  app id belongs to Zapier's account rather than this repository. Wrong twice:
  Zapier's own documentation says commit it, and without it nothing remembers
  which integration to push to — which is the double-registration trap above.
  It is an identifier; the secret is the deploy key, which lives in GitHub.

  **And `require()` cannot read it.** `.zapierapprc` has no `.json` extension,
  so `require` loads it as JavaScript and throws. Read it and `JSON.parse` it —
  the workflow did the wrong one in three places before it was ever run.

- **Two endpoints exist because an integration builder needs them, and they are
  not a lighter door.** `GET /api/v1/me` names the account a token belongs to,
  which is the only way a Zapier connection can be labelled — with two SubSub
  accounts connected, "SubSub" twice is picked by guessing. `GET /api/v1/trades`
  fills the dropdown. Both go through `apiCaller`, so the Scale gate, the hash
  lookup and revoked-reads-as-invalid are the ones the POST makes; a test drives
  a downgraded account at a **read** to prove the plan gate is on every call
  rather than only on minting.

  `/me` answers the **account and never a person**, for the reason
  `job_sources.created_by` is NULL: no person made the call, and naming the
  token's owner would put a sentence in front of somebody saying they did a
  thing they did not do.

  **And `GET /api/v1/properties` is the third, because `propertyId` was a UUID
  in a text box.** The field has been offered since the API shipped and could
  only be used by going to look an id up — and a wrong one is a job refused as
  `property_not_found`, which an integrator reads as a broken Zap. Exactly the
  typing-`windows_doors` failure the trades dropdown exists to prevent, on the
  one field whose value nobody can possibly hold in their head.

  **It offers precisely what `ingestJob` accepts**, which is why the clause is
  `account_id = ?` and nothing more: that route takes a building this account
  **operates** and no other, deliberately unlike `POST /api/jobs` on the
  screen, which also takes one the caller owns and somebody else runs. Wider
  and the picker offers a building the route refuses; narrower and it hides one
  the route would take. Both are the screen-that-lies rule pointed at a picker,
  and **only a fixture holding another account's building can check either
  direction** — the two-guards-covering-for-each-other shape this file keeps
  recording.

  **The label is assembled by the server, not by the Zapier app.** Two callers
  would name one building two ways. Name plus address, because two buildings
  called *Building A* are told apart by where they are.

  **And it is PAGED, which is both halves or neither.** Zapier shows the first
  page of a dropdown and says nothing about there being more, so a building
  past it is indistinguishable from a building that is not on the account —
  which is the typo this removes, arrived at from the other side.
  `canPaginate` is what makes Zapier ask for page 1; passing `bundle.meta.page`
  is what makes the answer different. Each is asserted, because either alone
  passes.

- **Three of Zapier's listing checks are code, and the integration works
  perfectly without any of them.** That is what makes them easy to leave: no
  press fails, nothing is red, and the only symptom is an integration nobody
  can find or connect.

  **The description has to say what SubSub IS**, not what the integration does.
  It is printed under the name with no other sentence introducing the product,
  so one opening *Post scheduled jobs from your CRM* describes a feature to
  somebody who does not yet know what the thing is. It lives in
  `deploy-zapier.yml`, because that is the only place it is ever sent —
  `register -y` with an existing `.zapierapprc` **updates**, so re-running that
  press with *First time only* ticked is how a change to the line reaches
  Zapier.

  **`CHANGELOG.md` is a hard requirement of `zapier promote`**, and the refusal
  is right: promoting moves real Zaps onto a new version and the people on them
  are owed a record of what changed under their feet. A test pins that its
  newest heading names the version being pushed — a changelog two versions
  behind is worse than none, because it is read and believed. Which is also why
  the Property dropdown is **1.1.0** rather than a second 1.0.0 with different
  contents: a pushed version is one somebody may already be connected to, the
  same rule the agreement templates follow.

  **AND THE FOURTH IS NOT A LISTING CHECK AT ALL: THE ERROR HANDLER WRITTEN TO
  CARRY SUBSUB'S WORDS THREW THE ONE ERROR TYPE THAT EATS THEM.** A 401 was
  raised as `RefreshAuthError`, which tells Zapier to go and **refresh** the
  credential. That is right for session auth, where there is a refresh to
  perform. This app is `custom` auth — an API token, with nothing to refresh —
  so Zapier cannot act on it and substitutes its own sentence: *authentication
  failed: Cannot refresh authentication for app with auth type `custom`*.

  Which names no token, no account and nothing to do about either, on **the
  single call every person makes before they can make any other**. The first
  real connection attempt was therefore unexplainable from the screen, and the
  one fact that would have explained it — what SubSub said, in SubSub's words —
  was discarded by the middleware that exists to carry it. Same shape as a
  catch wide enough to hide a real error, one layer out: **the failure path ate
  the message.**

  `ExpiredAuthError` is the counterpart for a credential that cannot be
  refreshed: Zapier keeps our words and asks the person to reconnect, which is
  the only thing a bad token can be answered with. Three assertions, because
  pinning the new name alone is weaker than it looks: the type is
  `ExpiredAuthError`, it is **not** `RefreshAuthError`, and **the message
  survives** — the last being the whole job of the file and the thing that was
  lost. The original test asserted only `name === "RefreshAuthError"`, so it
  passed for the entire life of the bug: **a test can pin the wrong answer as
  firmly as the right one.**

  And it could not have been caught here. Only Zapier knows which error names
  it can act on for which auth type, so the first real connection was always
  going to be the test — the same thing already recorded about `losses.payments`
  and the controller shape.

  **An auth field that describes a screen has to link to the page documenting
  it.** Directions alone leave somebody searching our site from inside a Zapier
  modal, which is where an integration gets abandoned. Absolute, because a
  relative href rendered on zapier.com resolves to zapier.com.

  **The three Publishing tasks that are not code are not bugs.** A connected
  account, three users with live Zaps and a task that has actually run are
  satisfied *by* using the integration, and a logo is an upload in Zapier's own
  console. They block the **App Directory**, which is a listing, and a private
  integration is reached by invitation — `Manage → Sharing` — rather than by
  being searchable. Somebody who cannot find "SubSub" in Zapier's app picker is
  not looking at a broken integration.

  **And `cleanInputData` stays at its default**, which Zapier warns about and
  which is the right answer here: it trims strings and drops empty ones, and
  `ingestJob` wants exactly that — an empty string stored where a column means
  *not given* is a lie a screen reads back. The warning is for integrations
  whose API distinguishes `""` from absent. Ours does not.

  **`externalId` stays a plain text box, and that warning should never be
  satisfied.** It is the customer's own CRM's id for the job; SubSub does not
  hold their CRM's records and cannot enumerate them. A dropdown there would be
  a list of ids SubSub has already seen, which is the opposite of what the
  field is for — its whole job is naming a job SubSub has *not* seen.

- **There was one trade list too many, and the Zapier dropdown is what forced
  the merge.** `TRADE_IDS` in the Worker validated; `CATEGORIES` in `App.tsx`
  carried ids, labels and a lucide icon each. They agreed by luck and by
  whoever last edited both. A dropdown needs a **label**, and the only place one
  existed was inside the browser bundle the Worker cannot import — so serving
  one would have meant a third copy, in the place where being wrong is least
  visible: a field somebody picks from once while setting an integration up.

  `app/shared/trades.js` is the one list, ids and labels. The icons stay in
  `App.tsx` and are attached by id, because a lucide component cannot cross into
  a Worker and a trade with no icon is a cosmetic problem rather than a wrong
  one — `test:zapier` pins that every trade has one, so adding a trade cannot
  ship a blank square, and that the Worker has not grown its own copy back.

  **Order is meaningful and it is not alphabetical**: it is the order the chip
  grid reads in, grouped by the part of a building somebody is thinking about.

- **Overflow is broadcast, not browse.** When an account has nobody on its
  own roster for an urgent job, it may broadcast to opted-in companies —
  general contractors included, since 031 made every one of them hireable.
  The posting account never sees a list of candidates, only the ones who
  answer. No ranking, no profiles, no enumeration. Eligibility is earned:
  good ratings, three months on SubSub, a minimum number of completed jobs,
  current documents and a verified licence. **Three months on SubSub means
  since they joined, not since they opted in** — the earliest of their own
  account being created and the first time anybody engaged them. Counting from
  the opt-in made a subcontractor who had worked through SubSub for a year
  "too new" for a quarter, and since nobody had opted in before the feature
  shipped it meant a broadcast could reach nobody at all for three months. It is free at launch and will
  charge a percentage of job value once payment processing exists — so the
  fee is modelled from the start and switched off, not bolted on later.

  `app/shared/overflow.js` holds the eligibility rules and the fee model;
  migration 038 holds the tables. Three properties are load-bearing and easy
  to destroy by accident:

  **The posting account never learns who it went to.** `overflow_invites` is
  the distribution list and is server-side only — no route returns it,
  filtered or counted. A count of how many companies were asked measures the
  platform's roster, and an account that can watch that number move learns
  the shape of everybody else's business one post at a time. What an account
  reads is `overflow_responses`: the ones who answered, who by answering
  chose to be known to them.

  **There is no endpoint that takes a trade and returns companies.** Matching
  happens in the Worker and the answer is never returned.

  **It is refused when the account has somebody of their own** who covers the
  trade and could actually be issued the work. Without that precondition this
  is a marketplace with extra steps.

  A response is an offer, not a booking: picking is what creates the
  engagement and the work order, so overflow is how two accounts met rather
  than a different kind of relationship — every document and expiry check
  applies to it unchanged.

  This is the one exception to "not a directory", and it stays an exception
  because nothing about it is browsable.

- **The calendar opens where the work is, not on today's month.** Reported from
  the dashboard, which is where it costs most. *What's scheduled* names the
  next dated job however far ahead it is — a job on 10 November, read on 1
  October — and then **Open the calendar** landed on an empty October grid. The
  screen you came from had just said where the work was and the screen you
  arrived at could not show it. Same failure as a count that routes somebody
  somewhere unable to display what it counted.

  Two halves, and the second is the whole of the conservatism. `aim` moves the
  grid **only when today's month is empty** — any dated job in it, past or
  future, finished or not, and it stays put, because a month with work in it is
  where somebody expects to land and being yanked to December would hide three
  jobs earlier this month. And it moves **forward only**: everything being in
  the past means nothing is coming, and today's empty month is the honest
  answer to that, where opening on August would read as the calendar having
  lost its place.

  The cursor is **null until somebody pages**, derived rather than seeded. A
  `useState(() => …)` initialiser runs once, and on a cold load straight into
  the calendar the jobs have not arrived yet — so it would aim at an empty list
  and sit on the wrong month with nothing saying so. Paging or pressing *Today*
  pins it, or paging back into an empty month would bounce the reader forward
  again.

  **An empty grid answers nothing**, so one names the next job and goes there in
  one press — the same shape as the undated line beside it, which is the other
  way a job is real and not on this grid. It prints the **date**, not
  `relDay`: that helper is written to start a sentence (*Today*, *In 70 days*),
  so it read as *"The next job is In 70 days"* mid-clause, and the date is what
  the line is for anyway since the question is which month to look in.

  **THE FIXTURE FOR THE DOES-NOT-MOVE BRANCH PASSED VACUOUSLY, and mutation is
  what caught it.** The current-month job was dated the 1st — which on the day
  this was written *was* today, so it was also the next job ahead, so
  "stay on a month with work in it" and "jump to the next job" gave the same
  answer and the assertion held whichever rule was in force. A discriminating
  fixture needs a current-month job strictly **in the past**, which on the 1st
  of a month cannot exist. So it is computed (five days back, floored at the
  1st) and the suite **says out loud** on the one day it cannot tell the rules
  apart, rather than reporting a green that means nothing. Proved by running it
  with the browser's clock shifted ten days, where the mutation fails two
  assertions.

  A static check could not have covered any of this: the aim is computed from
  jobs that only exist at runtime, so asserting that the source *mentions*
  `aim` passes with the value never used.

  **AND THE PANEL IT IS OPENED FROM ANSWERED WITH ONE JOB.** *What's scheduled*
  drew the next booked job and then two hundred pixels of nothing above the
  fortnight strip — reported with a red box round the gap, on an account with a
  job on the 12th and another on the 10th of the following month. The second
  job existed, was on the Jobs screen, and was in **Needs a contractor** lower
  down the same page; the one panel whose entire subject is *when* said nothing
  about it. The strip cannot carry it either — fourteen days by design — so the
  gap was all that stood in for a job six weeks out.

  It lists what is booked after the next one, taking the slack with
  `flex:1 1 auto`, the same rule and the same reason `.sh-none` already
  records: a zero basis collapses the box on the days there is none to take.
  Each row carries the **fill badge**, because a job nobody is on is the one
  worth seeing from here and a row that read identically either way would make
  the list decoration. **Capped at four**, with the count linking to the
  calendar: a panel that grows with the book has stopped being a summary. And
  one job with nothing after it **says so**, because that leaves the identical
  dead air and a blank is what reads as a panel that failed to draw.

  **The property under test is the GAP, not the row.** A row can render and the
  dead air survive, so the suite measures the distance from the last block in
  the panel to the top of the strip: 211px before, 0 after, and three separate
  mutations each put it back (deleting the block, deleting the single-job line,
  and changing `flex:1 1 auto` to `flex:0 0 auto` — which leaves every row on
  screen and 172px of gap under them). Nothing static could see any of it: the
  rows come from jobs that exist only at runtime and the slack comes from the
  height of the *other* card in the row.

  And the sixth recorded instance of the oldest trap in this file: a comment
  added to that CSS block quoted `flex:1 1 auto` in backticks, which closed the
  stylesheet's template literal and failed the parse.

  **Still open, and reported in the same breath: the Calendar tab is not a
  calendar of jobs.** It is `AvailabilityView` — contractors down the side,
  fourteen days across, a cell booked only when a job that day is assigned to
  *that contractor* — so a job with nobody on it has no row to appear on and is
  invisible there by construction. Its own page heading reads **Availability**
  while the nav tab says **Calendar**, which is two names for one screen, the
  trap this file already records about *Your code* under *My QR code*. Renaming
  it is a product decision rather than a refactor.

  **And a job cannot be removed at all**, which came up in the same session. A
  job arrives from four doors — the form, an owner or tenant request, the API,
  a CRM hook — and leaves through one: *Mark job complete*, which writes a
  completion event. `DELETE /api/jobs/:id` does not exist, `withdraw` is the
  requester's own move and an API job has no requester, and `decline` answers
  `not_a_request`. So tidying anything up means recording that work was done.
  The answer is almost certainly the shape the roster already settled on — a
  status rather than a delete, work orders voided so nobody turns up, refused
  once money has moved — and it is a product decision with real edges, not a
  refactor.

- **A COMPLETED JOB WENT ON TAKING CONTRACTORS, AND NEITHER HALF WAS HOLDING
  THE LINE.** Reported as *"if a job is marked off as complete, it shouldn't be
  still in the jobs overview looking like it can be edited"*. The screen was
  the half that showed; the half that mattered is that **all three routes said
  yes**.

  The empty trade slot's action row had **no `done` check at all**, so a
  completed job drew *Assign & issue WO*, *Ask for quotes* and *Overflow*
  exactly as a live one did — and pressing any of them worked, because
  `isClosed` lived in `App.tsx` and nowhere else. `POST /api/jobs/:jobId/assign`
  selected `id, requested_by, approved_at, date` and never read `status`;
  `canRequestQuotes` checked `withdrawnAt` and not `status`; the overflow post
  route checked neither. So this was not the ordinary gate-lives-in-the-browser
  lie, where the screen is looser than the route — **the screen and the route
  were both open**, and the only thing between a closed-out job and a work
  order was that nobody had pressed the button yet.

  What that costs is a contractor turning up to work nobody is expecting, which
  is the same failure the handover entry calls the worst moment this product can
  produce. Overflow is worse again, because it reaches **past this account** to
  companies who would spend an afternoon pricing an offer that cannot be taken
  up.

  `app/shared/jobstate.js` is the one predicate, read by the card and by all
  three routes. It **reads both spellings** — the browser holds `withdrawnAt`,
  the Worker passes a raw row with `withdrawn_at` — because normalising at each
  call site is a conversion to forget at the twenty-first one, and a missed one
  here reads as *not closed*, which is the direction that opens the gate. The
  mutation that proves it is dropping the snake_case half.

  **`status` had to be added to two SELECTs, and the column is as load-bearing
  as the check.** Without it the predicate reads `undefined` and answers
  cheerfully, so the gate fails open with nothing on any screen to see. Both are
  asserted separately, because the check alone passes over a row that cannot
  answer it — the two-guards-covering-for-each-other shape, again.

  **Withdrawn keeps the answer it already had.** `canRequestQuotes` answers
  `withdrawn` for a withdrawal and `job_closed` for the other two: a job somebody
  took back and a job that was finished are different events, and the screen
  already has words for the first. Same reason expired and never-added share a
  colour in `docs.js` and are told apart by the words.

  On the card the three buttons become **one line saying which closure it was**,
  not a disabled button and not a blank: a dead control is something people press
  twice before reading, and an empty row where buttons were reads as a screen
  that failed to draw. It names the way back, because *Reopen* is at the foot of
  the card and only obvious once you know the job is **shut rather than broken**.

  **Greyed, and deliberately not greyed out.** `opacity:.72` on the trade rows
  with the ratings and the issue buttons brought back to full strength — the
  notes, the star ratings and the warranty claims are the entire reason to open
  a finished job, and muting those to make a point about editing would take the
  screen's actual purpose away. The test asserts the rows are **under 1 and at
  least 0.6**: one bound alone passes a card greyed to the point of being
  unreadable.

  **And the live job is asserted in the same place.** A fix that greys
  everything is not a fix, and checking only the completed card cannot tell the
  two apart — the diagonal coverage that left `hiresLabel` half-wired.

- **Completing a job asks first, and the question is what it costs rather than
  whether you are sure.** It fired straight off the button, and what it does is
  not guessable from the button: the rating and the notes open, and the three
  ways to put somebody on a trade shut.

  **It is NOT `ConfirmRemove` with a different verb.** That one is red, carries
  a warning triangle and a trash icon, and **those are the message as much as
  the words are** — the same reason the hire-both-ways screen could not wear the
  upgrade gate's chrome. Completing is affirmative and reversible, so
  `ConfirmComplete` is green with a tick, and the sentence says it can be
  reopened, which is what makes a plain confirmation the right weight rather
  than the typed-name one.

  **What is still outstanding is NAMED, not counted.** *4 things outstanding* is
  a number somebody presses past; *Roofing — nobody assigned* is one they stop
  at. And one of the two lists is a thing the card **cannot** show: a trade
  whose contractor has not answered their work order yet counts as filled, so it
  reads 1/1 on the card and is exactly the state worth being told about before
  closing. The reported job was completed with **0/1 trades** — nobody was ever
  on it — which is the commonest way this gets pressed by mistake.

  **`completeJob` had to become awaited.** It patched optimistically and
  `persist` only logs, so a refused completion drew the card as closed over a
  write that never happened — the save-that-reports-success shape this file
  already records about `updateSub`, on the one action that shuts three others.
  The modal stays open with the reason on it.

  Three assertions in the suite are the ones worth keeping, and each is
  mutation-proved: **a modal appearing is not the property** (the request could
  still go, so the API calls are counted — zero until somebody agrees, one
  afterwards); **Cancel must leave the job open**, because a confirmation whose
  Cancel does it anyway is worse than none, having been asked and answered; and
  the routes are asserted **on their own**, because a screen assertion passing
  while the route is open is precisely what happened here.

## Working here

- The app is `app/` (Vite + React, one large `App.tsx`), the API is
  `app/worker/index.js` (Hono on Cloudflare Workers + D1 + R2), and the
  marketing site is at the repo root.
- **Three things deploy, and each one is a button in the Actions tab.**
  `deploy-api.yml` is the `subsub-api` Worker, `deploy-admin.yml` is the
  `subsub-admin` Worker, and `deploy-app.yml` is the Cloudflare Pages project
  `subsub-app` — which is what serves `app.subsub.work` and every tenant
  subdomain. All three run on push to the paths they depend on, and all three
  can be pressed by hand from a phone.

  The customer app had neither for most of this repo's life, and the cost was
  the worst kind: a day of content changes went in, every deploy that existed
  reported success, and none of it reached anybody. **A deploy nobody can press
  is a deploy nobody can fix**, which is the whole reason the third file exists.

  **And a deploy that reports success has to say whether anybody can see it.**
  The first version of `deploy-app.yml` read that off the deploy output, and
  `wrangler pages deploy` prints the immutable per-deployment
  `https://<hash>.<project>.pages.dev` URL for a **production** deploy and a
  preview alike, because that URL always exists alongside the custom domain. So
  the one question the workflow was written to answer — did anybody see this —
  was handed to a test that cannot tell the two apart, and it is answered
  confidently either way. Same class as every assertion in here that mutation
  caught: not wrong on some inputs, wrong on all of them, and silent about it.

  Only the project knows, so `Where did it land` reads `production_branch` and
  `latest_deployment.environment` off the Pages project with the token that just
  deployed. It **reports rather than refuses** — a preview deploy is a real and
  useful thing, it is how you look at a branch before it is live — and a failed
  lookup warns and leaves the deploy standing, because a missing report is not
  a failed deploy and a deploy must not fail for want of a permission it does
  not need to deploy.

  The production branch today is `claude/hello-24aree`, which is also the
  repository's only branch, so a push to it is live.

- **Whose page this is has two sources, and they can disagree.** `onSubdomain`
  is a fact about the **hostname**; `brand` is what the account lookup came
  back with. On a customer's address where that lookup does not land, the
  hostname still says *somebody's page* while the brand falls through to
  `GENERIC_BRAND` — and both cards then rendered at once on
  `outerhome.subsub.work`: **Apply to work with SubSub**, which invites a
  roofer to apply to the software company, above **Don't have an account? See
  plans and sign up**, which is SubSub's front door advertised on somebody
  else's. Each one wrong, and the pair contradicting each other.

  The gates are `onSubdomain && !brand.isSubSub` for the apply card — you can
  only apply to a company we could identify — and `brand.isSubSub &&
  !onSubdomain` for the signup card, because **SubSub's own front door is a
  hostname that belongs to nobody**, and a company's subdomain belongs to
  somebody whether or not the lookup for it succeeded. The sign-in form itself
  stays: signing in is by email, and a failed branding lookup says nothing
  about whether this person has an account.

  The lookup failing is not hypothetical and not rare — the cause here was a
  deploy with no `VITE_API_BASE`, one entry down — so the screen has to hold
  its line when it fails for any reason at all.

  **And the test for the front-door card aborted on the case it exists to
  catch.** It read `link.text` after asserting `link` was there, so the moment
  the card went missing the next line threw and took the twenty assertions
  after it with it: one failure reported, everything downstream hidden. Reading
  through `link?.` turns that into six honest failures. A test that cannot
  survive its own subject is a test that reports least when it matters most.

- **`VITE_API_BASE` is the one build value the console does not need and the app
  cannot live without.** `api.js` falls back to a relative `/api` so a dev build
  can let Vite proxy it. The customer app in production is static files on Pages
  with nothing behind them to proxy that, so `/api` hits the static site and
  every call 404s.

  Which does not look like a build problem from the outside. It presents as
  **"Couldn't reach SubSub. Check your connection"** on sign-in, and as **every
  tenant subdomain wearing SubSub's own branding** — because `subdomainBrand`
  comes from `/api/account-by-subdomain/:sub`, and a lookup that cannot land
  falls through to `GENERIC_BRAND`, which is exactly what that fallback is
  written to do when a hostname belongs to nobody. One missing variable, two
  symptoms, neither of them naming it.

  **The console gets away with the same default, and that is what hid it.** It
  is a Worker, and `worker-admin.js` forwards `/api/*` to the API over a service
  binding; Pages has nothing to forward with. `deploy-app.yml` was written by
  reading `deploy-admin.yml`'s env block, which does not set it and does not
  need to, so the gap was inherited from a file that was correct.

  Two guards, and **the second is the one that matters**. The value must be
  absolute, because relative is the failure and relative is also the default —
  a default that produces a dead app is not a default. And the **built bundle
  must contain it**, grepped out of `dist/assets` the way the is-this-the-console
  check beside it works, because a variable that is set and does not reach the
  bundle looks identical to one that does. That is what was missing: a green
  run, the correct bundle, and every call in it pointed at a path that does not
  exist. **Prove it from the artifact, never from the variable** — which is a
  rule this file already had, applied to one thing and not to the thing beside
  it.

- **The customer app and the staff console are one bundle built twice, so their
  two path lists have to agree.** Same `app/src`, same `app/shared`, same
  `index.html`, same vite config; only `VITE_BUILD` decides which comes out, and
  each workflow asserts what it built by grepping the bundle afterwards rather
  than trusting the variable.

  Which makes the push `paths:` two records of one fact, edited months apart by
  somebody fixing one of them — the `schema.sql`-against-the-migrations shape,
  and it had already drifted: `app/public/**` was on the app and not the
  console, so a new favicon would have shipped to customers and not to staff.
  `test:deploypaths` compares the shared entries, requires every pattern to
  match something on disk (a glob for a renamed directory is a guard that cannot
  fire and looks exactly like one that can), and pins that each workflow watches
  its own file so a fix to a deploy ships through that deploy.

  **A missing path entry is the same silence, one directory further in**: green
  runs, an unchanged screen, and nothing anywhere saying a deploy did not
  happen. So when the build starts reading something new, it goes in the list.

  **And `deploy-api.yml` was missing `app/shared/**`, which is the worst place
  for it.** It watched `app/worker/**` and nothing else, while the Worker imports
  two dozen rule modules out of `app/shared/` — so a fix to
  `app/shared/paygate.js`, which decides whether money may leave, would have sat
  in the repository with every deploy reporting success. `test:deploypaths` only
  compared the app against the console, because those are the pair that are one
  bundle built twice; the API's list was checked for existing on disk and for
  watching itself, and for nothing else. It now **derives** the directories from
  the Worker's own imports, because a list written by whoever added the import is
  the same record twice.

  **Which uncovered the same failure inside the test.** Its `paths:` parser
  wanted consecutive quoted entries, so the first YAML comment in the block
  ended the match and every path after it went unchecked — a shorter list
  reported as the whole list, which is this test's own failure mode turned on
  itself. Adding a comment beside the new entry is what surfaced it.
- Migrations are applied **by hand** in the D1 console, in order. Every one
  that adds a column or table gets a line in
  `app/worker/migrations/CHECK.sql`, which answers "did I run that one?"
  against the schema itself.
- **CHECK.sql also carries invariants, and a `1` where a `0` belongs is a
  bug report.** Beside the did-I-run-it columns are counts that must read
  zero: `m039_unowned` (properties with no `owner_account_id`),
  `m031_others_with` (a non-hireable account still holding a company row) and
  `m031_hireable_without` (an account that can be hired with none — it read
  `general_contractor` alone until the `subcontractor` kind was added, and a
  literal there would have flagged every subcontractor as an illegal company row
  while letting one with no company be hired as). All three read `1` once,
  and each was a different route writing a row the migration had already
  taught the schema to expect — 039 backfilled every property and
  `POST /api/properties` never learned to set the column; 031 made a general
  contractor a company and `PATCH /api/account` changed `kind` without taking
  the company row with it; and the staff console's account INSERT never minted
  one at all. None of the three showed on a screen: `propertyWithOwner`
  coalesces the owner to `account_id` on the way out, so a building with no
  owner looked owned right up to the moment somebody tried to hand it over.
  A backfill is not a fix until every INSERT that runs afterwards writes what
  it backfilled, so when a migration fills a column in, go and find the routes
  that write that table.

  One of those has to refuse rather than tidy. Clearing `company_id` when an
  account stops being hireable is right, unless somebody already hires them —
  live engagements would then point at a company no account answers for and
  the contractor on the other end would never be told. That is a conversation
  with their clients, not a setting to flip, so the route returns 409
  `hired_by_others` with the count.
- **`worker/schema.sql` and `worker/migrations/` are two records of one
  database, and `npm run test:schemadrift` is what makes them agree.** This file
  is what a FRESH database is built from — a new environment, a preview, and
  every Worker test that calls `freshDb()`. The migrations are what the LIVE
  database was built from, one hand-run paste at a time.

  They stopped agreeing around 010 and nobody noticed for thirty-five
  migrations, because nothing compared them. By 045 `schema.sql` was missing
  twenty-six tables, eighty indexes and thirty columns. Two costs, one loud and
  one quiet. **A fresh install was born broken** — CHECK.sql could not even be
  *run* against it, so the one tool for spotting the drift was disabled by the
  drift. And **the tests lied in both directions**: a Worker test got a database
  no customer has, so a route reading a post-010 column threw "no such column",
  which the Worker deliberately reports as `migration_needed` rather than a 500.
  That is right in production and poison in a test — a real bug reads as a
  database behind the code, and a route that quietly does nothing when a column
  is missing (the signup company row is exactly this) passes while writing
  nothing at all.

  **Add the column here in the same change as the migration, not afterwards.**
  `freshDb()` swallows "duplicate column" and "already exists" and nothing else,
  so the migrations a test names as its dependencies stay in and become no-ops
  as `schema.sql` catches up; otherwise fixing the drift would have broken every
  test that had worked around it.

  One thing the check **cannot** do, stated so nobody writes an assertion that
  always passes: it cannot catch something in `schema.sql` that no migration
  creates. The live shape is derived by applying the migrations *to*
  `schema.sql` — there is no migration 001, this file is the base — so anything
  added here is on both sides by construction. Catching that would need an
  independent record of the original schema, and there is none.

- **`npm run paste <n>` prints a migration as paste-ready SQL, and the reason
  it is generated rather than a second file is a mistake that reached a live
  database.** The migration files are heavily commented on purpose — those
  comments are the record of why each column exists — but a hundred lines of
  prose is a hundred lines to scroll past on an iPad, so the SQL for 052 was
  once **typed from memory instead of read from the file**. The table it
  created was missing fourteen columns and carried five that do not exist, and
  the check that was supposed to catch it asked only whether the table
  existed, so it answered `1, 1, 1, 0, 0` over a table nothing could write to.

  **A did-I-run-it check must read the columns, not the table name.** That is
  the whole lesson: `sqlite_master` tells you a table is there, and
  `pragma_table_info` tells you it is the right one.

  Writing the stripped SQL out as files beside the migrations was the obvious
  alternative and it is refused for the reason this file gives everywhere
  else: two records of one fact, where the stale one is the copy that gets
  pasted into production.

  **It deliberately has no `check` sub-command**, and the attempt is worth
  keeping. Pulling one migration's entries out of CHECK.sql means splitting on
  top-level commas, which means counting paren depth — and `m046_kind_check`
  compares against the literal `'%CHECK (kind IN%'`, whose unmatched bracket
  throws the count off for the rest of the file. It printed every migration's
  check as one entry and reported "nothing found" for the one asked for. **A
  check query that is subtly wrong is worse than none**, being the exact shape
  that let the broken 052 through, so the answer is to run the whole of
  CHECK.sql — which verifies every migration rather than one, and is the
  single record of what to look for.

- D1 stops a multi-statement script at the first failing statement and does
  not undo what ran before it. `ALTER TABLE ... ADD COLUMN` is the statement
  that is not repeatable, so it goes in a paste of its own.
- **A `var()` inside an `!important` rule deletes the property on any surface
  that forgot to define it.** `.wl-themed .btn-solid` sets
  `background: var(--wl-accent) !important`, and `AuthLanding` wore `wl-themed`
  without `themeVars`. A property set to an undefined custom property is invalid
  at computed-value time, which does **not** fall back to the cascade — it
  resets to the *initial* value. So the green went transparent, the text colour
  went dark, and *Save password and continue* rendered as a line of text with a
  padlock: the one control on the screen, invisible as a control. It fails
  silently and it fails only on the surface that forgot, which is why it
  survived. Wearing the themed class means setting the theme.

- **One password, asked for once.** Signing up took a password, then the
  confirmation link asked for a new one twice — three boxes for one password,
  and the first was never used. Confirming the address is the step that cannot
  be skipped, so that is where it is set; signup mints a random one nobody is
  ever told, because Supabase needs a value and one that is never transmitted
  back cannot be used by anybody. `hasPassword` comes back on the signup reply
  so the closing screen cannot tell somebody to "sign in with the password you
  just chose" when there is not one.

- **A subcontractor's set-up checklist is a different list, not a shorter one,
  and the UBI row on it is Washington-only.**
  Theirs said *Bring your subcontractors in — 0 of 3*, *Approve their documents*
  and *Create your first job*: three things a roofer is not here to do, one of
  them reading as a quota they are already failing on a screen they have just
  arrived at. Theirs is the four documents and sending them, which is the loop
  the account exists for. It **names** what is missing rather than only counting
  — "2 of 4" does not say which two, and that is the only thing worth knowing
  at that moment. They can still hire, and Contractors is still there; it is not
  a *set-up* step, because nothing about their account is unfinished until they
  do it.

  And **the compliance pack is in the nav** for any account that can be hired,
  opening the panel that already exists in Account rather than a second copy
  of it — two copies would be two components holding the same upload state. Its
  badge counts **presence, not approval**: `missingDocs()` asks whether a hiring
  account has verified a document and nobody verifies their own, so it would
  have read 4 after all four were uploaded. Same rule the send gate follows.

- **A backtick inside a template literal closes it, and that includes a
  comment.** Recorded three times now and hit a third: `embed.js` is one big
  template so its comments cannot contain one; a backtick in a CSS comment took
  the whole app down behind one `dot is not defined`; and a SQL comment inside
  `milestone-test.mjs`'s `BASE` template made the file fail to parse. The guard
  that catches it cheaply is to assert the extracted literal contains no
  backtick at all, which is one line beside whatever the literal is for.

- **A `\uXXXX` escape in JSX *text* is six literal characters**, not a
  character — JSX only processes escapes inside string and template literals.
  It has shipped twice: `Alder Construction \u00b7 Roofing` and
  `says today \u2014 not what it said`. The browser tests now assert that no
  `\uXXXX` survives into `document.body.innerText`, which catches the class
  rather than the instance. Write the character, or put it in `{"…"}`.
- **Whoever runs this has a browser on an iPad and no terminal.** Every
  instruction has to survive that. What works:

  **Numbered steps, one action each, in order, to the end.** Never stop mid-task
  to offer an alternative — finish the sequence, then offer the alternative
  separately if it is worth raising at all.

  **A direct URL beats describing a menu.** `dash.cloudflare.com/profile/api-tokens`
  works on any device at any width; "tap the profile icon, top right" is a guess
  about a layout that changes and collapses differently on a narrow screen.
  GitHub's Settings tab hides behind `···` on an iPad, so
  `github.com/<owner>/<repo>/settings/secrets/actions/new` is the instruction,
  not "go to Settings".

  **Exact strings in a code block**, because a secret name typed from prose gets
  typed wrong and the failure is silent.

  **End with "tell me when you've done step N", and "if a step doesn't match,
  say which number and what you see instead."** That converts a wrong guess into
  one correction rather than a dead end.

  And do not narrate a UI from memory. Cloudflare's token form now requires an
  Account Resource and a Zone Resource that "use the template and change
  nothing" does not fill in — three rounds went on guesses before a screenshot
  settled it in one. Ask for the screenshot early; it is cheaper than being
  wrong twice.
- Tests live in `app/scripts/*-test.mjs` and are registered in
  `package.json`. The ones ending in a browser harness build the real bundle
  and stub the API (`scripts/lib/stub-stack.mjs`) — no worker, no database.

  **Each of those owns a pair of ports, and a new one has to pick unused
  ones.** They pass on their own whichever ports they use, so a clash only
  shows up as some *other* suite failing with `EADDRINUSE` when the two run
  near each other — which reads as a regression in code the new test never
  touched. `grep -rhoE '\b(5[0-9]{3}|8[0-9]{3})\b' app/scripts/*.mjs | sort
  -un` is the list already taken.
- Before claiming a fix works, revert it and confirm the test fails.
