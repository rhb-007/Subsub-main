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

- **AND THE CAUSE WAS THAT THE FIRST PERSON ON AN ACCOUNT WAS NOT ITS ADMIN.**
  The entry above fixed the symptom — staff could not sign in. Asked why the
  account had no admin in the first place, and the answer is two defaults that
  only hurt together:

  `POST /api/platform/accounts` writes an admin membership **inside
  `if (ownerEmail)`**, so an account created without an owner address gets
  nobody. `POST /api/platform/accounts/:id/users` then defaulted to `pm`
  (`["admin","pm","contractor"].includes(b.role) ? b.role : "pm"`), **and the
  console's form opened on `pm` too**. So: make the account, add the owner,
  leave the dropdown alone — an account whose one person cannot reach Account,
  billing or branding.

  **And it could not get out of that by itself.** Every door to granting the
  admin role is `requireRole("admin")`, so the account could not produce one
  from inside; and the console — which exists precisely to answer what a
  customer cannot — could add people and reset passwords and **not change this
  one field**. There was no route to change a role anywhere. The only remaining
  remedy was SQL against D1, which is the answer this file refuses everywhere
  else.

  **FORCED, NOT DEFAULTED.** The first team seat on an account is an admin
  whatever the form said, because *a default that produces an account nobody
  can administer is not a default, it is a trap* — and the person who finds it
  is the customer, weeks later, looking for billing. The test asks for `pm`
  **explicitly** rather than sending an empty body, because only that tells
  forcing from defaulting.

  **A contractor seat is exempt, and that is load-bearing.** It is a roster
  seat with a `company_id` behind it, not a member of this team; promoting one
  on an admin-less account would hand the account to a subcontractor it hires.
  Mutating that condition to `true` fails two assertions.

  **The screen does not offer a choice the route overrides.** On an account
  with no admin the dropdown is replaced by what will happen — *Admin, the
  first person on an account runs it*. A control whose other option is
  silently overwritten is the screen-that-lies rule **with the lie on the
  server side**, which is worse: nothing on the page is wrong, and what gets
  stored is not what was picked.

  `PATCH /api/platform/accounts/:id/users/:userId` is the way out for accounts
  already in that state. Admin and pm only — converting a contractor seat
  either way would invent or discard the company behind it — and **the last
  admin may not be demoted**, for the reason `cannot_remove_self` refuses on
  the customer side: this route is the only thing that could undo it, so
  refusing here is what keeps that true.

  **And the panel reports the condition** rather than leaving it to be found by
  somebody pressing a button, reading `hasAdminSeat` — the same predicate the
  impersonate route uses, so the two cannot drift back into the disagreement
  that started this.

- **AND THE ROLE CONTROL SHIPPED WITH A HOLE IN IT, BECAUSE "NOT A CONTRACTOR"
  IS NOT "ON THE TEAM".** The panel it sits in filters
  `memberships WHERE role <> 'contractor'` and is called **Team**, and that is
  the whole of why this was missed: a **building owner** invited onto a
  managing agent's account and a **tenant** of one of its buildings both pass
  that filter. They are guests — scoped to named buildings, there to watch
  their own property or report a leak — and the account they are guests on
  belongs to somebody else.

  Two things followed, and the second is the serious one. The `<select>` holds
  only Admin and the pm label, so drawing it over an `owner` row rendered a
  control reading **Admin** for somebody who is not one — *a screen stating a
  role that is not held*, which is worse than the missing control it replaced.
  And the route refused `contractor` **by name** rather than asking the
  question, so **a guest could be promoted**: handing a client, or a tenant,
  admin of their agent's entire business — every other building, every
  contractor on the roster, the billing. The mutation that proves it answers
  `{"ok":true,"role":"admin","from":"owner"}`.

  `isTeamSeat` is the one predicate now, and the refusal is
  `not_a_team_seat` rather than a case per seat, which is how the other two
  were missed. A guest keeps a plain badge.

  **The general form, and it is a new one for this file: a filter that EXCLUDES
  the obvious exception is not the same as one that INCLUDES the intended set.**
  `role <> 'contractor'` was written when the only thing to keep out was the
  roster, and it silently widened every time a new role was added — `owner` and
  `tenant` walked in behind it. The panel's own name said "team" and nothing
  checked that it held one.

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

- **SUBSUB'S FEE IS 0.05% OF A PAYMENT, AT MOST $500 A PAYMENT, CHARGED TO
  THE HIRING ACCOUNT ON TOP -- AND ONLY ON MONEY THAT GOES THROUGH SUBSUB.**
  `app/shared/fee.js`. The rate is the owner's call and was corrected from
  0.5% to 0.05% the day it shipped -- a "point oh five" said aloud is exactly
  the figure that gets an extra zero, so the test pins the rate in words as
  well as in basis points. Worth knowing beside it: at 0.05% a $4,000 payment
  earns $2, and a Stripe bank transfer costs SubSub up to $5 before Connect's
  payout fees, so on most payments this fee does not cover the rail. That is a
  pricing decision, recorded rather than reopened. The cap is **per payment**
  and only binds above $1,000,000.

  **On top, never out of net, and that reverses what `money.js` did.** Net was
  gross less retainage less fee, so whatever SubSub charged came out of the
  roofer's cheque. Harmless at zero and the wrong way round at anything else:
  subcontractors are the growth loop, and a deduction from what they are paid
  is the one thing that would make them ask for paper instead. The hiring side
  is the side on Scale, so the fee is theirs -- they fund gross plus fee and the
  subcontractor is sent exactly what they would have been sent without us. A
  test pins it, and the test it replaced pinned the old answer.

  **Stamped at verify, spent at pay, zeroed at settle.** The account must see
  the fee before it funds or pays, so it is on the release from the moment the
  milestone is verified. Paid through `/pay` it is spent: `woMoney` counts it
  as taken, so it is neither available nor refundable afterwards. Recorded as
  paid by check, nothing went through us -- `settle` writes `fee_cents = 0` in
  the same UPDATE that closes the release, and `m033_inv_fee_off_platform`
  counts one that slipped past. A fee still due is owed money: it is in
  `owedCents` and out of `refundableCents`, or refunding it would leave that
  release unpayable.

  **The fund suggestion is computed milestone by milestone** because the cap
  is per payment: two $100,000 draws are two $500 fees, and one lump would
  suggest one and leave the second draw short.

- **THE FIRST $50,000 AN ACCOUNT SENDS THROUGH SUBSUB IS FREE, AND STAFF CAN
  SET AN ACCOUNT'S OWN RATE, CAP AND FREE AMOUNT.** `feeFor` and `feeTerms` in
  `app/shared/fee.js`; migration 071 (`account_fee_terms`); the **Payment fee**
  panel on an account in the console.

  **Counted against what was PAID through SubSub, not what is owed.** A check
  recorded here uses none of it -- nothing went through us. A payment that
  straddles the line is charged only on the part past it ($45,000 sent and a
  $10,000 payment is a fee on $5,000), because a cliff that charges the whole
  payment for crossing is a price nobody would agree to.

  **Stamped at verify as an estimate, worked out again at pay.** The stamp
  counts releases still owed against the allowance, so two releases verified
  back to back do not both claim the same free dollars; `/pay` recomputes from
  what has actually been paid and writes the figure back **before** the money
  check, so the check, the screen and the ledger read the fee charged. This
  replaced the per-work-order cumulative cut for the fee: the allowance and
  the cap are both promises about each payment, and the cost is at most a cent
  per payment in SubSub's disfavour.

  **An account's own terms fall back one figure at a time.** No row is the
  defaults; a lower rate keeps the default cap and free amount; a free amount
  of **zero** is zero, not the default -- `feeTerms` treats only NULL as
  "not set", and the test pins the zero case because `|| default` would get it
  wrong. Reset deletes the row so the account follows the defaults if they
  change.

  **Typed as percent and dollars, stored as basis points and cents**, and the
  panel says back what a $10,000 payment would cost before the save: this fee
  already had one slipped decimal the day it shipped. The route refuses past
  10% and refuses fractions of a basis point rather than rounding them. **A
  reason is required** and every change is audited with the old terms and the
  new, for the reason a comp carries a note. Support reads the terms; only a
  superadmin sets them, enforced on the route and drawn as no controls.

  **The customer's screens quote the account's own terms.** `/funding`
  carries `feeTerms`, `processedCents` and `freeLeftCents`; the pay window,
  the fund form and the fund suggestion all read them, and the pay window
  **says** when the free amount covers a payment -- silence there reads the
  same as a charge nobody mentioned.

- **AND EVERY AMOUNT ON THE PAYMENT SCREENS HAD BEEN A HUNDRED TIMES TOO
  LARGE, AND ADD FUNDS CHARGED A HUNDREDTH OF WHAT WAS TYPED.** Found by the
  browser test for the fee line, which read "$380,000.00" where it expected
  $3,800. `formatMoney` takes **dollars**; the work order's progress panel, the
  funding panel, the pay window and every lien-waiver amount handed it
  **cents** -- twenty-three call sites, all reading exactly as intended. And the
  fund form read the dollars typed into it as cents, so funding $3,820 asked
  Stripe for $38.20, and the confirm route faithfully recorded what Stripe
  said landed -- which made a units error look like a short payment. The plan
  editor passed MoneyInput a `cents` prop it does not read, so it drew empty
  over a real amount.

  `formatCents` is the second name, and the two are kept apart by name
  because nothing static can tell which unit a variable holds. **No test had
  ever drawn these figures** -- every money assertion was on the server -- which
  is the whole of why it survived. `test:feesmsui` reads the drawn total, the
  drawn fee and the amount on the wire, and undoing either half fails it.

- **TEXT MESSAGES ARE 2,500 A MONTH ON SCALE, AND PAST THAT THEY KEEP GOING:
  EACH EXTRA 5,000 (OR PART) IS $50 ON THE FOLLOWING MONTH'S BILL. NONE ON
  BASIC.** `app/shared/smsquota.js`, migration 070 (`sms_overage`). Basic at
  zero is what the pricing page always said; nothing enforced it until now.

  **It replaced a pre-bought add-on the same day, and the reason is the
  design.** The first version paused texts at 2,500 and sold 5,000 more as a
  monthly line bought in advance. That makes an account guess its volume and
  pay for the guess every month, and it makes running out silent -- a work
  order not texted on the 28th because nobody topped up. Billing what was
  actually sent, in the same $50 blocks, never stops a notice and never
  charges for texts nobody sent. 070 was rewritten rather than followed by a
  071 because it had not been pasted; one that had is harmless, its column is
  simply unused.

  **One door.** Seven call sites paired `sendSms` with `logSms` by hand; a
  count checked at six of them is a count with a door round it, and the
  seventh -- the emergency call-out -- was not even logged, so it would have
  been missing from the bill. `sendAccountSms` is the only caller of `sendSms`
  and a test counts that. A refusal is logged as failed with its reason and a
  failed row is not counted, so a refusal is never billed.

  **Three things still stop a text, each for a reason.** Basic (no texts). An
  account with **nothing to bill** -- a comped Scale account has the plan and
  no subscription, so it pauses at 2,500 rather than running up a charge on an
  account we gave the plan to. And a **runaway**: `SMS_OVERAGE_MAX_BLOCKS` is a
  loop, not a busy month, and a loop billing $50 every 5,000 texts with nobody
  watching is the worst thing this could do. **An emergency call-out goes
  past all three** -- a named kind, never a flag a caller can pass -- and still
  counts, so the bill is true.

  **The account is told when it happens, not when it is billed.** The text
  that opens each new $50 block writes one activity line; the panel shows the
  running overage and last month's charge. A charge nobody saw coming until the
  invoice is the one that becomes a support call.

  **Billing is a nightly sweep of LAST month, idempotent by construction.**
  One `sms_overage` row per account per month (the unique index), written
  **before** Stripe is asked, so a night that dies halfway leaves a pending row
  the next night finishes. A monthly plan gets a Stripe **invoice item tied to
  the subscription**, which rides its next invoice -- the following month's
  bill. A **yearly** plan has no monthly bill, and waiting up to eleven months
  to charge for October is not "the following month", so its item goes on an
  **invoice of its own** charged to the card on file. A refusal is `failed`
  with Stripe's words and retried the next night; `m070_inv_billed_unrecorded`
  counts a month marked billed with no Stripe line behind it.

  **Counted from `sms_log`, in messages, by calendar month (UTC)**, never as a
  counter. The month boundary is `YYYY-MM-01` compared against
  `CURRENT_TIMESTAMP` text -- one format against itself, 057's lesson kept.
  A count that cannot be read lets the text go.

  **Not verified here: live Stripe.** The invoice-item and invoice shapes are
  the documented ones and the suite asserts them at `fetch`; the first real
  month past 2,500 is the real test, as with every other Stripe call here.

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

  **SubSub authors no waiver document IN A STATUTORY STATE.** It requests,
  tracks, gates payment on, and stores what was signed with a hash of it.
  Twelve states prescribe exact wording and a form that deviates can be void,
  and lien law follows the property's state, not the signer's. In the other
  thirty-eight and DC it now offers a form of its own — see the entry below,
  which is where that decision was made.

- **LIEN WAIVERS ARE ASKED FOR, SIGNED AND RECORDED, AND THE TWELVE STATUTORY
  STATES GET AN UPLOAD UNTIL THEIR TEXT IS LOADED FROM ITS SOURCE.** 035 built
  the chain and the gate and wrote nothing at all: no route inserted a row, so
  every release has answered *"No waiver has been requested yet"* since the
  gate shipped, and the override was the only thing anybody could press.
  Asked for as *"SubSub will create the waiver (or allow upload) — they are
  standardized but differ by state based on regulations"*, with the twelve
  statutory states and the four kinds named. Migration 069,
  `app/shared/waiverform.js`.

  **A STATUTORY STATE NEVER GETS SUBSUB'S FORM, and that is refused on the
  server and counted by an invariant.** Arizona, California, Florida, Georgia,
  Massachusetts, Michigan, Mississippi, Missouri, Nevada, Texas, Utah and
  Wyoming set the words in statute, and a waiver on another form can release
  nothing while looking exactly like one that does. **The verbatim text was not
  written from memory**, for the reason the Stripe v2 migration was not: a
  paraphrase of a statute reads exactly like the statute, and the person
  relying on it is the one person who cannot tell. So `STATUTORY_FORMS` is
  **empty on purpose**; an entry needs the statute, a source URL and a date,
  and until one is there a waiver in that state is signed on the state's own
  form and uploaded. Everything else — the request, the chain, the gate, the
  record — works identically. `m069_inv_standard_in_statutory` counts a row
  that got past.

  **NO STATE ON THE BUILDING IS ITS OWN ANSWER, and it is upload-only too.**
  It cannot be told apart from a statutory one, and "probably not" is how an
  invalid waiver gets signed. **And the company's state is deliberately not a
  fallback**, unlike the handyman cap: a roofer registered in Oregon on a
  Washington building signs under Washington law.

  **SUBSUB'S FORM IS PLAIN AND NARROW, and `reviewed` is null.** Releases only
  to the extent of the payment, carves out retention, later work and unpaid
  change orders, and says in section 4 whether it waits for the money. It is
  keyed by id **and** version, a miss throws, and a hard-coded golden hash pins
  1.0.0 — the agreement templates' machinery, spent a second time. **The
  screen says the same one line the agreement does**: a starting point, not
  legal advice. **Still open, and only a lawyer can close it: nobody has read
  this text, or will have read any statutory text before it is loaded.**

  **AN UNCONDITIONAL WAIVER IS NEVER ASKED FOR BEFORE THE PAYMENT IS
  RECORDED.** It gives the right up whether or not the money arrives, so asking
  for one first is asking somebody to sign away a lien for a cheque that may
  bounce. The hiring side may pick any of the four; `kindRefusal` refuses that
  one combination, and the picker greys it with the reason. The signer is also
  told in amber, above the document, before they sign one.

  **THE DECLARATION IS PART OF WHAT IS SIGNED.** *Labor only* versus *these
  people supplied me* is section 5 of the document, chosen at the moment of
  signing, rendered into the text and hashed with it — the preview re-renders
  through the same `renderWaiver` the server hashes, so the page cannot show
  one document and record another. It is also what made `setWoScope` stop
  mattering: the signer's sworn answer outranks the work order's setting once
  signed, because that is the one an attestation backs. Materials with nobody
  named is refused (`parties_required`): it is the one answer that would read
  the chain as clear with nobody below ever asked.

  **NAMING A SUPPLIER ASKS THEM.** Each declared party with an address is
  emailed a tier-1 waiver of the same kind and through date, signed from a link
  with no account — `/api/waiver/:token`, on the public exemption list for the
  pack's reason. **The paying side sees counts, never names**: the
  subcontractor's supplier list is their book. **The subcontractor sees their
  own by name**, because they declared them. Below tier 1 the chain is capped.

  **THE GATE NOW COUNTS THE WORK'S DAY, NOT TODAY — and this changes an
  existing answer.** `waiverStateFor` asked whether the waiver covered
  *today*, so one signed through the 20th went stale on the 21st over a payment
  for work finished on the 20th: every waiver expired the night after it was
  signed. It now asks about the day the release was made, which is the work
  that payment covers. **And a signed waiver outranks a newer unsigned one**,
  or asking for the unconditional waiver after payment would hide the
  conditional one the money went out against.

  **ONE WRITE SIGNS, FOUR WAYS IN.** In the app, by link, by the claimant
  uploading, or by the paying side recording a copy it was emailed — all through
  `markSigned`, guarded on `status = 'requested'` in the UPDATE so two presses
  sign once. **The recipient's upload is recorded as the recipient's**, so
  nobody later reads it as the subcontractor having signed in the app. An
  upload's hash is of its bytes; an in-app signature's is of the canonical text,
  recomputed from stored inputs and never taken from the request.
  `m069_inv_signed_unrecorded` counts a signed row with neither.

  **WHERE IT LIVES ON SCREEN.** A *Lien waiver* button on every release row of
  the work order, and the same panel inside the payment modal **where the gate
  refuses** — it used to name the problem and offer only the override. The
  subcontractor's list sits under their schedule on the contractor dashboard,
  because a waiver waiting is a payment waiting, and beside their agreements in
  the compliance pack.

  **One assertion could not fail, caught by mutation**: *unconditional is not
  choosable* read `every()` over the picker's options, which is true over an
  empty list — so it passed loudest on a form that never opened. Length first.
  And a mutation that broke the JSX built nothing and printed nothing, which
  reads exactly like a suite that hung: *check the change means something*, in
  the form of a mutation that has to compile to mean anything at all.

  One pre-existing slip fixed in passing: agreements printed `signedAt` through
  `formatExpiry`, which takes a bare date, so a timestamp came back raw —
  *"Signed by Juan Soto on 2026-10-05 10:00:00"*.

  **AND IT IS SCALE, BECAUSE A WAIVER BELONGS TO A PAYMENT AND PAYING IS
  SCALE.** Asked for in those words — and the second half turned out not to be
  true in the code either: `/fund` and `/pay` checked only that Stripe was
  configured, so the plan limit on paying subcontractors existed on the
  pricing page and nowhere else. Both are enforced now, by one helper
  (`payingAccountOnScale`, reading `accountOnScale` so a comped account counts)
  on the **paying** account, never the subcontractor's.

  Three choices in it, each deliberate. **Money is gated where it comes in**,
  at `/fund`: paying out money already funded and refunding it stay open after
  a downgrade, because money that is in must always have a way out — to the
  subcontractor or back. **The payment gate stands aside for a Basic account**
  rather than demanding a waiver it cannot ask for, which would have made every
  recorded cheque an override; the waiver block is not drawn at all there,
  rather than reading "Waiver clear" over a waiver nobody could have asked for.
  And **a request made before a downgrade stays signable and withdrawable** —
  the subcontractor's signature is their act — while asking, re-sending and
  recording a copy answer `scale_required`. The panel says Scale in words and
  offers no button the route refuses. Both plans are asserted in the same
  suites, because a gate checked on one branch is the diagonal coverage that
  left `hiresLabel` half-wired.

  **Still open:** a waiver cannot be requested for a release that has none —
  `amount` and `through` come off the release, so work paid outside the
  milestone ledger has no door yet. And **pasting 069 is required** before any
  of this works on the live database; until then the routes answer
  `migration_needed` naming it.

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

  **AND THE TIERS ARE CARDS, BECAUSE ON A TABLET THEY RAN TOGETHER.** At an
  iPad's upright width each column was about 230px of grey text with only a
  rule on top, so one tier read straight into the next. Each is a white card
  now, three across only above 1000px and stacked below it. The inspections
  paragraph under them came off **on request** — a second kind of record under
  a section about CRMs read as noise — and the door it was is the footer link
  on every page plus the developer page's own section. **AppFolio was asked for
  and is deliberately not on it**: SubSub has no AppFolio receiver, AppFolio is
  not on Zapier, and its own API is a partner programme with write access by
  AppFolio's approval. A name here is a promise, which is this entry's whole
  rule.

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

- **THE FRONT PAGE CARRIED SIX MARKED-UP ANSWERS AND HAD NO FAQ ON IT.**
  Asked where the FAQ was. There was not one: `index.html` has shipped a
  `FAQPage` block with six questions since it was written, and five of the six
  answers were nowhere in its body text. That is against Google's own rule for
  the type — the content has to be visible to the reader — and it is the rule
  this file already states for the licensing pages, broken on the page with the
  most traffic. **Only a crawler reads structured data, so nothing about it
  looks wrong**, which is why it sat there.

  The section is built **from the stored answers verbatim**, so the two cannot
  say different things. `pricing.html` was the same shape from the other
  direction: a real visible FAQ of ten questions, and a `FAQPage` block
  carrying six *different* ones, paraphrased. There the markup was rewritten
  from the page rather than the page from the markup — the visible copy is what
  a reader gets and what the rule is about. The CTA at the end of it ("I'd
  rather see it first.") is deliberately **not** an entry: an FAQ item is a
  question somebody searches, not a link.

  **The guard checks the QUESTION as well as the answer, and the first version
  did not.** A mutation changing only the question walked straight through —
  and a fabricated *question* over a real answer is the actual abuse, because
  it is how a page ranks for something it does not address. Checked across
  every page on the marketing site, not only the generated ones, because the
  page that was wrong is the one nobody thought to look at.

  **And `.qa` is defined per page**, because this site has no shared stylesheet
  and no build step — so a section pasted from another page renders unspaced.
  The rules travel with it.

  The footer's Resources column now carries the roundup article and the FAQ as
  well as Compare: an article reachable only from one hub and the sitemap is
  the orphan failure the licensing pages shipped with, measured in traffic that
  never arrives.

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

- **THE HEADER'S ADD CONTROL DREW A SECOND COPY OF THE DASHBOARD'S OWN BUTTON.**
  Reported from a property manager's dashboard as *"it says add job twice"*,
  beside a general contractor's where it reads correctly — which is the whole
  reason nothing had caught it.

  The dashboard's call to action is `New job` (`Request work` for an owner).
  The header's Add collapses to a **single button** when the seat has exactly
  one thing it can add — and that one thing is the job. So the two sat side by
  side saying the same word. A seat with a real menu never showed it: *Add*
  over four items is not a duplicate of anything, and an unscoped admin on
  either kind has four. It takes a **narrowed** seat to see it, which is the
  seat nobody demos with.

  It is dropped **on that one screen**, not removed. Everywhere else — Jobs,
  Calendar, Properties — there is no second copy and the header button is the
  only way in, so removing it outright would take the action away to fix a
  duplicate. The mutation that proves each half: deleting the check puts
  `["New job","New job"]` back on the dashboard, and widening it to every
  screen fails the Jobs assertion.

  **And the Add list per account kind was already right**, which is worth
  pinning rather than assuming: `can("properties")` is `hasProperties(account)`
  and not the role's list alone, so a property manager, a portfolio manager and
  a building owner get **Property** and a general contractor does not — it
  works job to job and has no building list to add one to. `test:addmenu`
  asserts all four kinds **in the same place**, because a rule with two
  branches checked on one branch is the diagonal coverage that left
  `hiresLabel` half-wired.

- **AN ACCOUNT WITH NO ADMIN COULD BE OPENED AND NOT USED, AND THE SECOND HALF
  LOOKED NOTHING LIKE THE FIRST.** `pickSeat` fixed "that account has nobody
  on it to sign in as" by falling back to the best seat there was. What it did
  not fix is what the person then found: a project manager cannot reach
  Account, billing or branding — the banner already had to say so — and
  `runsTheAccount` being false quietly empties the screens that remain.

  Reported from a property manager's own property: *"it says assign someone to
  manage it… the admin of the account should be able to manage it! Why is it
  asking this? The admin should be able to access everything within this
  account."* Which is exactly what the panel does with `canManage` false: no
  vendor list, no Edit, no Remove, no owners panel, and the handover block
  reduced to one sentence telling a managing agent to **add an owner who will
  appoint a manager**. Nothing on that screen is wrong; it is the right screen
  for a seat nobody should have been in.

  **Nobody inside the account could repair it either**, which is what makes
  this the staff seat's job rather than the customer's: every door to granting
  the admin role is `requireRole("admin")`, so the one seat that could produce
  an admin was the seat being refused.

  `staffStandsIn` in `app/shared/seats.js`. A **team seat**, on an account with
  **no admin anywhere**, runs it — and both halves are load-bearing. A guest is
  never promoted: an owner or a tenant is somebody else's client, and standing
  in their seat is how support sees what a client sees, which is `isTeamSeat`
  reused rather than restated. And an account that **has** an admin is never
  widened, so naming a pm seat still reproduces a pm's complaint, which is the
  reason naming a seat was added at all.

  **The scope goes with the role.** A pm's buildings narrow a *person* and
  there is no person here; an admin still scoped to part of the book is the
  hybrid `runsTheAccount` refuses anyway, so keeping it would redraw the
  half-shut account one layer down. The browser replaces the **whole
  membership** for that reason and reads the answer off the impersonate reply
  rather than deriving a second one — the seat row still says `pm`, because
  that is true of the person, whose role and buildings are unchanged. Safe to
  hold in memory because `resumeSession` refuses to resume an impersonated
  session at all, so a refresh ends it and the flag cannot go stale against the
  token the API is checking.

  **It is deliberately not conditional on whether a seat was NAMED**, and that
  is a trade rather than an oversight: the session row records which seat, not
  how it was chosen, and a column to tell the two apart would buy the ability
  to reproduce a pm's view on an account where a pm's view and the account's
  view are already the same thing.

  **The audit trail says what was done, not only whose seat it was.** "(pm
  seat)" over a session that reached billing and branding is a record that
  understates it, so the row names both and the meta carries `ranAsAdmin`.

  **And the banner now has two sentences where it had one.** They are different
  sentences: *this account has no admin, you are standing in as one, give
  somebody the role* is the customer's to fix; *you are in a pm seat, so this
  is that person's view* is what was asked for. The second case said nothing at
  all before, because the banner read `fellBack` — which is about how the seat
  was **chosen** rather than about what it **is** — so a staff member who
  deliberately opened a contractor seat got the contractor portal and no
  explanation for it.

  **Still open, and unchanged by any of this: the console does not list
  accounts with no admin.** Three doors make them — the account INSERT skips
  the admin without an owner email, add-user forces the first *team* seat and
  a contractor seat is exempt, and `DELETE /api/account-users/:userId` only
  refuses `cannot_remove_self`. Staff are now told while signed in as one;
  finding them without signing in is where it belongs.

- **A set of photographs is one piece of evidence, so the lightbox holds the
  set.** Reported looking at a tenant's report: *"when viewing images of an
  issue a tenant sent me, they should be strung together, so you can increase
  size and arrow forward or back to view the other images without closing
  them."*

  There were **two** one-picture lightboxes — the tenant's own view of their
  report and the manager's view of the same report — each drawing exactly the
  photo that was tapped, each closing on any click, and neither able to reach
  the next one. Three photos of a leak are the ceiling, the floor and the meter
  reading, read in order; what was there made that three round trips through a
  grid. Two copies of one thing is two things to keep in step, so it is one
  `PhotoLightbox` used from both modals and fed by all three grids.

  **It fetches nothing.** Every photo in a set already has a thumbnail mounted
  behind it, and each of those owns exactly one object URL for those bytes —
  two owners of one URL means revoking either blanks the other. So
  `ReportPhoto` reports what it loaded through `onLoaded` and the lightbox
  reads that map: `undefined` is still arriving, `null` failed and says so in
  the same words the thumbnail uses, and the set can still be walked past it.

  **It wraps at both ends**, because a dead Next on the last of three is the
  disabled-control-with-no-reason failure on the one control whose whole job is
  to be pressed, and a set of three has no boundary worth defending. The
  **counter is what makes the arrows mean something** — a set you can move
  through has to say where in it you are — so with one photo there are neither,
  `1 of 1` being a number about nothing. A `div` rather than a `button`, now
  that it contains buttons.

  **What the suite says out loud rather than claiming:** `Modal` binds no
  Escape handler, so the lightbox's `stopPropagation` changes nothing today and
  no test can tell. It is there against the day `Modal` grows one. What the two
  assertions beside it do catch is the lightbox having no Escape of its own,
  and the box being rendered outside `.modal`, where its own backdrop click
  would reach `.modal-backdrop` and close the report underneath.

  And the fixture needed a job's **whole** shape to appear on the dashboard at
  all. A partial one loaded, rendered nothing, and read exactly like the modal
  never opening — an hour on a bug that was a missing `accountId`.

- **The only thing on the dashboard that is a person waiting on an answer was
  under five numbers that are not.** *Asked for by owners and tenants* sat
  below the KPI tiles. Reported: *"move the section of the issues sent to pm by
  the tenant or owner, this should go to the top and share scheduled jobs as
  it's the most important for a property manager to see right when they
  login."*

  It joins `dash-top` beside the schedule, which is the other question this
  page exists to answer — what is happening and when, and who is waiting on me.
  Built once into a variable and rendered there rather than written out twice.
  Already capped, too: `DashRows` shows three and offers the rest, which is
  what keeps a panel in that row from growing with the book.

  **Not gated on the account kind.** A general contractor has no owners and no
  tenants, so the list is empty for them and the panel does not render — a kind
  check would be a second record of a fact the data already carries. The suite
  **says** that rather than pinning it, because catching an added gate would
  need a general contractor holding a tenant's request and there is no way for
  a GC to have one: a fixture for it would be the test-of-its-own-fixture trap.

  Three things had to follow and none is decoration. It wears **the schedule
  panel's own card**, compared against that panel rather than against a
  literal, because a run of bare rows beside a card reads as content that
  failed to land in one. Its rows take `--paper`, or a card-coloured row on a
  card disappears — the same pairing the schedule panel's own rows use. And the
  **row wraps**: Decline and Approve are about 170px of a 340px column, which
  leaves the title ellipsed to nothing, and the decline box wants 320px of its
  own.

  Measured rather than read off the source, because **source order is not
  screen order inside a grid** and a static check that the JSX moved passes
  whether or not the panel lands anywhere near the schedule.

  One thing it found a layer down: **`severity: "standard"` is a shape the
  product never produces.** `jobRowToJs` answers `"911"`, `"urgent"` or `null`,
  and the dashboard's emergencies filter is `j.severity && …` — so a fixture
  saying "standard" files every ordinary job under *Needs attention now*, and
  the screen under test stops being the screen. `job-closed-test.mjs` still
  carries it; it asserts nothing about that section, so it passes, which is
  exactly why it is written down here.

- **An invite with a letter wrong in the address could only be thrown away.**
  The panel offered Copy link, Send again and Revoke — so the route from a
  typo to a working invite was revoke, retype the company, the contact, the
  email and the mobile, and start again, losing when it was first raised and
  leaving the dashboard reading as though nobody had ever been asked.
  Reported as *"make sub/contractors editable until they accept invite,
  instead of just resending or emailing invite"*.

  `PATCH /api/invites/:id`, and **the boundary is exactly where the report put
  it**. Once `used_at` is set the record is their `companies` row and
  `PATCH /api/subs/:companyId` is the door, with its own rule about whether
  this account may write a row somebody else answers for — two doors onto one
  record is how the two come to disagree. An invite raised **from a
  contractor's card** is refused one step earlier for the same reason: it
  carries `company_id`, so their name and address already live on a row the
  roster edits. The panel draws no form there and **says where instead**,
  because a missing button with no explanation is a dead end.

  **REPLACING AN ADDRESS REISSUES THE TOKEN, AND THAT INVERTS THE RULE
  BESIDE IT.** Resending deliberately reuses the token, because reissuing
  would break the link already sitting in somebody's inbox. Here the whole
  reason to change an address is that the link went to the **wrong person**,
  and leaving their copy live hands a stranger a way onto this account's
  roster. **Replaced or removed, never merely added**: a link made to hand
  over in person has no address and was never sent by us, but may well have
  been pasted into a message by hand, so adding an email to it must not kill
  the link somebody is already holding.

  Two things follow. `sent_at` is **cleared** on a reissue, or the status line
  goes on claiming a send that has not happened — which is also what makes the
  panel offer *Send again* rather than read as finished. And the screen
  **warns before the press**, not after it: finding out that the link changed
  once it already has is finding out too late to decide.

  Only the keys sent are written, which is the shape that deleted a W-9
  through `SubForm`. Same seats as creating and resending one; revoking stays
  admin-only because it destroys a live credential, and correcting an address
  does not — and a project manager chasing a contractor is exactly who notices
  the typo.

- **AND `relTime` IS A PAST-TENSE HELPER THAT ANSWERED A FUTURE DATE "just
  now".** Every branch in it is a `<` against a positive bound and `ago` is
  negative ahead of now, so the first one matched whatever the date was. The
  invite panel renders `Expires {relTime(expiresAt)}`, so a link good for
  another thirty days read **"Expires just now"** — on the one line that says
  whether the link still works, which reads as already dead.

  One helper rather than a second one beside it: a future time is the same
  question asked the other way round, and two of these is how the two come to
  round differently. Nothing that passes a past time moves, and anything that
  was passing a future one was already wrong.

  The general shape, which is new here: **a helper whose name does not say
  which direction it reads will be handed the other one**, and it will answer
  rather than refuse. The screen is the only place that shows it.

- **AN ADMIN WAS READ AS NARROWED TO NAMED BUILDINGS, AND THE ACCOUNT SHUT
  AROUND THEM.** Reported as a property manager's own building opening with no
  vendor list, no Edit, no Remove and no owners panel — one line reading *Add
  the owner above and they can take this building over* — under a header
  reading **Your buildings** instead of **Properties**. Every one of those is
  `canManage` false. The seat was an **admin**: the impersonation banner
  carried no fallback note at all, which only an admin seat produces.

  **Two bugs, and each is invisible without the other.**

  **The door.** `PATCH /api/platform/accounts/:id/users/:userId` — the
  console's role control — wrote `memberships.role` and nothing else. The
  customer-side route has always gone through `setMembershipProperties` and
  `setMembershipJobs`, which delete first and write back only for a role that
  may carry a list. So promoting a project manager scoped to named buildings
  left their buildings behind on an admin seat. Which is the route this file
  had just recommended pressing.

  **The disagreement.** `propertyScope` answers null for anything but a pm, an
  owner or a tenant, so the API never refused anything — nothing was ever
  wrongly denied, which is why no error appeared anywhere. But
  `GET /api/account-users` hands the **stored** rows to the browser, correctly,
  because the user form has to draw the picker with what is actually there —
  and `isScoped` read the **list** and never the **role**. Scoped on screen,
  unscoped on the server, and `runsTheAccount` is what turned that into a
  locked account.

  `app/shared/propscope.js` is the one rule, imported by both.
  `ALWAYS_SCOPED_ROLES` was defined in the Worker **and** in `App.tsx`, and
  `propertyScope`'s own `role !== "pm" && !ALWAYS_SCOPED_ROLES.includes(role)`
  was a third expression of it that the browser did not share. **Three records
  of one fact in two languages**, which is the shape this file keeps recording
  — and the one place it had never been applied is the question *is this seat
  narrowed at all*.

  **Fixing one half alone fixes nothing.** The door alone leaves every account
  already in that state broken; the predicate alone leaves dead rows arriving
  for ever. So both, plus **migration 054** for what is already there and a
  **CHECK.sql invariant that must read zero**. That is the same shape 053
  already counts one axis over for jobs — and nothing had ever cleared that
  one either, so 054 does both.

  **Clearing must not run on a no-op role change**, which the route's existing
  early return already guarantees: without it, pressing Save over the role
  somebody already holds would wipe a scoped manager's buildings. The mutation
  that proves it is deleting that return.

  And the general form, which is new: **a route that changes a row's ROLE owes
  every list that hangs off it.** `memberships.role` is not a field, it is what
  decides which other tables may hold rows for that seat, and a route that
  writes it alone leaves records nothing reads — until something reads them.

- **A COMPANY COULD NOT BE DELETED FROM THE CONSOLE, AND THERE WERE THREE
  BUGS BEHIND ONE DEAD BUTTON.** Reported as *"can't delete subcontractors in
  admin console - stops here"*, with a screenshot of the name typed
  correctly and **Delete company** still greyed out.

  **THE LABEL AND THE COMPARISON WERE DIFFERENT STRINGS.** `DeleteConfirmModal`
  read `typed.trim() === item.name` — the typed side trimmed, the **stored**
  side not. HTML collapses trailing whitespace, so a company whose name had
  picked up a space rendered identically in *Type **X** to confirm* and never
  matched. The button was dead for ever, for that row only, and **no static
  check can see it**: the expression reads exactly as intended. It is the
  misspelt-capability shape again — fails closed, and nothing reports it.

  **AND THE CAUSE WAS ONE ROUTE ALONG.** `POST /api/platform/companies` has
  always trimmed the name; `PATCH` beside it wrote `b[key]` raw. So **editing
  a company is what put the space there** — and the Delete button lives in
  that very edit panel. A write that is correct on create and not on update
  is the same two-records-of-one-fact shape this file keeps recording, with
  the stale copy being the one people actually use.

  **AND THE BUTTON SAID NOTHING, which is what "stops here" actually
  describes.** *A disabled control with no reason beside it is
  indistinguishable from a broken one* — written here already, and the
  countersign box three thousand lines away has had that hint since it was
  written. This one had none, so a reader has no way to tell a refused name
  from a broken console. `typedNameHint` is the sentence, and it stays
  **silent while the box is empty**: a confirmation that tells somebody off
  before they have started is one they stop reading.

  **THE PREDICATE EXISTED AND NOBODY USED IT.** `typedNameMatches` — trim,
  collapse, lowercase — has been in `shared/agreement.js` since
  countersigning shipped, and the staff console had written **three** stricter
  copies: the modal and both delete routes. It now lives in
  `shared/typedname.js`, out of the agreement module because it is a
  validation rule rather than contract text (unlike `PARTY_TERMS`, which is
  frozen inside the versioned document on purpose), and all four call sites
  read it. **Both** delete routes were changed, not just the reported one:
  fixing the company branch and leaving the account branch is the diagonal
  coverage that left `hiresLabel` half-wired.

  **What it tolerates is a decision.** Whitespace and case, because a typed
  confirmation exists to make somebody stop, read the name and decide — not
  to test their shift key, and a name that must be reproduced character-exact
  is one people copy and paste, which defeats the asking. It still refuses a
  different name, a prefix and a substring, and each is pinned.

  **AND UNDERNEATH ALL OF IT, TWO ROUTES HAD BEEN THROWING 500 THE WHOLE
  TIME** — found only because the suite drove them rather than asserting the
  predicate. `auditPlatform` writes `activity`, whose `account_id` is `NOT
  NULL` because it is explicitly the **per-account** stream, and every
  company action passed `null` into it: **create, edit and delete on the
  console's Companies screen all failed**, with "that didn't work" over a
  company that was still there. And `DELETE /api/platform/accounts/:id` ran
  `UPDATE activity SET account_id = NULL` to keep the trail after the row
  went — a statement that column can never accept — so **deleting an account
  threw too**.

  Both are fixed the same way and **widening the column is refused**: a row
  in `activity` with no account is a row in nobody's stream, and that stream
  is read by the customer-facing feed. The per-account row is written only
  when there is an account; `events`, whose `account_id` is nullable
  precisely because it is the platform-wide log, always gets one and the
  account delete nulls it rather than losing it. The trail is the point —
  *a support action nobody can reconstruct afterwards is indistinguishable
  from an intrusion* is the comment above these routes — so the suite
  asserts the `account_deleted` record **survives the account**, names the
  staff member, and is detached rather than gone.

  The general form, and it is new here: **a NOT NULL column is a claim about
  what the table is for.** `activity.account_id` says a row belongs to one
  customer. Two routes wrote as though it did not, and both were wrong about
  the table rather than about the column — so the fix is to stop writing the
  row, not to loosen the constraint.

  **The fixture is the test.** A clean company name passes whichever
  comparison is in force, so every assertion here runs against a row whose
  stored name carries the trailing space — the only row either direction can
  be told apart on. Six mutations fire: the exact comparison in the route and
  again in the modal, the trim removed from `PATCH`, the per-account row
  written for an account-less action, the hint deleted, and the predicate
  relaxed into a prefix match. The browser suite reproduces the screenshot
  exactly under the first of those — name typed as drawn, button disabled,
  nothing said.

  Two harness traps, both already in this file. The console reads its session
  from `localStorage`, so going straight to the page lands on *Continue with
  Google* — where every selector finds nothing and the suite reports the
  **feature** as broken; signing in is now its own assertion that prints
  what is on screen instead. And two checks read `!m?.hint`, which is **true
  when the modal is absent**, so they passed loudest exactly when the subject
  had disappeared. They require the modal first now.

  **Still open, and not worth a migration:** rows already stored with
  untrimmed names stay as they are. Nothing is harmed — the comparison
  normalises both sides, so they delete fine — but a tidy-up is
  `UPDATE companies SET company = TRIM(company) WHERE company <> TRIM(company)`
  if the stray space ever shows up somewhere it matters. Deliberately **not**
  a CHECK.sql invariant, because one shipped knowing it reads non-zero is a
  bug report nobody can action.

- **A MODEL DRAFTS THE PHOTO NOTE AND THE MANAGER KEEPS IT, AND THE WHOLE
  FEATURE IS THE WORD "DRAFT".** A managing agent photographs forty things in
  a flat and then types forty sentences most of which the photograph already
  says. So Claude reads each picture and drafts the line. **This is the first
  outbound AI call in the product**, and three things about it are decisions
  rather than implementation.

  **IT WAS PRICED BEFORE IT WAS BUILT, and the price is what fixes the
  size.** Claude bills a picture by **area** — `ceil(w/28) * ceil(h/28)`
  visual tokens — so a photograph straight off a phone (4032x3024) is 4,784
  tokens and 1120px on the long edge is 1,200, for detail nobody needs in
  order to see that a wall is scuffed. At **Haiku 4.5's $1/$5 per MTok** that
  is **about two cents for a twelve-photograph room** against eight full
  size. So `DRAFT_LONG_EDGE` is a **cost constant and not a quality one**,
  1120 is deliberately under the *smaller* models' resolution cap so moving
  the model later cannot quietly quadruple the bill, and
  `photo-draft-test.mjs` asserts the arithmetic — including the per-room
  figure in dollars — rather than trusting it. The three options were priced
  before one was picked: Haiku 2c a room, Sonnet 5.5 4c, Opus 5.5 8c, and
  naming what is in a photograph is what the cheapest is for when a person
  edits every line before it is kept.

  **THINKING IS OFF, AND THE SPELLING TRAVELS WITH THE MODEL, which is the
  `losses.payments` lesson in a new place.** Thinking is billed as output, so
  turning it on multiplies what a one-line caption costs with nothing on any
  screen different — the quoted price assumes none. But *how you say so is
  per model and the API validates the COMBINATION*:
  `{type: "between_tools"}` is Claude Sonnet 5.5's only way to turn thinking
  off and **every other model answers 400 to it**, while `{type: "disabled"}`
  is what Sonnet 5.5 refuses, and a pre-4.6 model like Haiku 4.5 wants the
  field left off entirely. So a model swap on its own — the obvious one-line
  change, and the one somebody will make — is a dead feature on the first
  real press with nothing in the source looking wrong.

  `DRAFT_THINKING` is therefore a table keyed by model id, beside
  `DRAFT_MODEL`, the way `PAYOUT_CONTROLLER` sits beside `payoutAccountKey`
  for the same reason: the request and the setting are one fact and holding
  them apart is what lets this happen. **A model absent from it fails the
  suite rather than the press** — Opus 5.5 is deliberately not in it, because
  it cannot turn thinking off at all, so listing it would need a guess.
  Three mutations prove it: a bare model swap, Sonnet's spelling sent to
  Haiku, and thinking switched on.

  **THE DOWNSCALE HAPPENS IN THE BROWSER, which is not where it belongs.** A
  Worker has no image processing and Cloudflare's is a separate product
  behind its own setup, so the alternative was paying four times over. It is
  nearly free there because `ReportPhoto` has already fetched the bytes to
  draw the thumbnail. What makes it safe is that **none of it is trusted**:
  every posted id must be a photograph **of that room** and
  `MAX_DRAFT_BYTES` is the ceiling, so a hand-made request cannot cost more
  than a real press. Both are mutation-checked, and the one place the
  downscale itself is observable is the body of the request the browser
  sends — so the UI suite decodes it and reads the dimensions back. A static
  check that `jpegForDraft` exists passes with `scale = 1`.

  **A DRAFT IS NOT THE RECORD, and that is the entire shape of the data.**
  `caption` is the manager's words and is what the owner reads; `draft` is
  what the model wrote and is the team's working note. Stored **beside** each
  other — the same rule `engagements.doc_review`'s draft follows — so nothing
  downstream can read a half-answer as an answer. A draft nobody kept is **not
  in the report**: an offer that was never accepted, which is the line
  `inForce` draws about a countersignature. The upsert on the draft route
  **names neither half of `caption`**, so a re-draft cannot overwrite a
  sentence somebody has already kept, which is the one way this feature could
  destroy the record it exists to help write.

  **AND THE BOX DOES NOT SAVE ON BLUR WHILE IT HOLDS A DRAFT.** That is the
  half a static check cannot see and the half that matters: the draft arrives
  in the field, because a sentence behind a button is a sentence nobody
  reads — but *a preselection mistaken for your own choice is worse than a
  blank*, the lesson the trade suggestions already paid for, and here the
  blank is the truth. So an unkept draft is **dashed**, says it is a draft,
  and clicking away from it records nothing. Typing in it or pressing **Keep**
  is what makes it theirs. Dirtiness is **derived** by comparing the box
  against what it was seeded with rather than a `touched` flag — a flag is a
  second record of one fact and it is the one that gets missed.

  **UNREADABLE IS AN ANSWER, and it does not seed the box.** A dark or
  blurred photograph is the one a model will confidently invent a description
  of, and an invented line on a deposit record reads exactly like a real one.
  `unclear` comes back on the schema, and its words are shown **beside** an
  empty field rather than inside it — what it could not see is a reason to
  take another photograph, and is not something anybody should be able to keep
  as the condition record with one press.

  **The prompt says what a condition record IS**, and three of its
  instructions are load-bearing rather than padding. **Condition, not
  contents** — a model asked to describe a photograph writes a tour of the
  room. **No cause and no blame** — whose fault the mark is, is the entire
  deposit dispute, and a record that has already decided is one the other
  side can attack. **Never invent** — see `unclear`. Each is pinned, because
  a later pass trimming the prompt would take them for verbosity.

  **WHAT LEAVES IS SAID AT THE CONTROL, and asserted field by field.** A
  photograph of the inside of a rented home goes to a third party, which is a
  bigger step than the weather lookup this file already records as
  deliberately server-side — and it is not guessable from a button, so the
  note sits under it rather than in help text nobody opens. The tenant's
  name, the address, the building and the account are each asserted **absent**
  from the request, because the screen promises exactly that and a field added
  to the prompt later would break the promise rather than the build. Claude
  also refuses to identify people in a photograph, which for this use is the
  right behaviour rather than a limitation.

  `shared/photodraft.js` holds the model, the prompt, the schema, the size and
  the caps, because the route, the screen and the tests all describe them.
  `worker/ai.js` is one JSON POST over plain `fetch` — the same trade
  `billing.js` makes with Stripe, and every outbound provider in this Worker
  goes through one named helper rather than an SDK. **`ANTHROPIC_API_BASE` is
  spent from the day it shipped**, unlike `STRIPE_API_BASE`, which sat unused
  for years: the suite stubs at `fetch` and asserts the request *shape*, which
  is the only place several of these claims are checkable at all.

  Three smaller things. **Structured outputs rather than "reply with only
  JSON"** — a caption about a cracked basin carries an apostrophe or a quoted
  measurement sooner or later, and free-text JSON fails on exactly that. The
  answer is **keyed by `ref`, never by position**: a model that skips one or
  answers out of order would otherwise shift every caption by one, which on a
  condition record is not a cosmetic error. And the reply is **read by block
  type, not `content[0]`** — a reply can open with a thinking block, so
  position-reading breaks the day somebody changes a thinking setting, with
  nothing in the request looking different.

  **No key is a named refusal and never a 500**, and `aiDrafts` on the
  inspection is what keeps the button off a screen that cannot use it —
  `mail_not_configured`'s shape, for the same reason: only the Worker knows
  whether there is a key. **A failure writes nothing**, which is what makes
  "try again" the honest sentence, and an answer about zero photographs is a
  refusal rather than a success — a press reporting "done" having written
  nothing is the save-that-reports-success shape this file refuses elsewhere.
  Rate-limited **per account**, because every press spends real money and the
  one thing a limit has to stop is a loop.

  Two test traps, both already here. Assigning `.value` on a controlled
  textarea **does not reach React's onChange**, so the first version of the
  edit-a-draft block reported the product as broken when the harness was
  wrong; it goes through the node's own descriptor setter, as four other
  suites already do. And the owner-read block indexed `mine.rooms[0]`
  unguarded, so it **threw on exactly the case it exists to catch** — the
  read-through-`link?.` lesson, for the fourth time. One real fixture bug
  underneath it: finishing an inspection is `{finish: true}`, and the
  `{status: "finished"}` body answers `nothing_to_change`, so the 404 the
  owner correctly got read as the feature being broken.

  **Still open, and a decision rather than a build: it reads the words and
  not the photographs for the trade suggestions.** `suggestTrades` works off
  the room notes; this reads the pictures. Pointing the vision call at the
  trade grid as well is the obvious next thing and is a second cost per
  inspection for a selection somebody confirms in one tap either way.

- **A HANDYMAN IS NOT A SUBCONTRACTOR, AND IT IS A PROPERTY OF THE
  ENGAGEMENT RATHER THAN OF THE COMPANY.** A roofing company on a general
  contractor's roster holds a licence, carries its own cover and works under
  a prime contract. The person a managing agent calls to change a tap washer,
  reset a breaker and paint a bedroom wall is not that — and treating them as
  one leaves a maintenance worker permanently short of compliance over a
  certificate nobody asked them for, which is `docs.js`'s permanently-amber
  failure pointed at a person instead of a document.

  Migration 058, `engagements.engaged_as`, `app/shared/engaged.js`.

  **ON `engagements` AND NEVER ON `companies`, which is the whole shape.**
  That row is **shared**: one account's handyman is another account's
  contractor, and writing the word there would say it for both. It is also
  the answer this file had already written down for exactly this question —
  *"whether a general contractor requires an agreement is their call… the
  right answer if it comes up is per-account, not a global default."* An
  engagement **is** per-account, so this is that answer spent rather than a
  new rule. A test asserts the other account's view of the same company is
  untouched, which is the only thing that proves it.

  **NULL READS AS SUBCONTRACTOR, and so does a word nothing recognises.**
  Every row that exists today has no value at all, so the migration changes
  nothing about any roster — the same asymmetry `jobScopeFrom` uses. And the
  default is the **strict** answer deliberately: the direction that fails
  open here is the one that stops asking for a certificate, so an unknown
  word must not quietly excuse cover. A mutation taking the word at face
  value fails.

  **WHICH ACCOUNTS HAVE HANDYMAN WORK: the ones with buildings.** Asked for as
  "under property manager, portfolio manager, and building owner", which is
  exactly `ACCOUNT_KINDS_WITH_PROPERTIES` — not a coincidence, because a
  handyman is a maintenance worker for a *building*. **Named rather than
  derived as "not a subcontractor-hirer"**: a filter that excludes the obvious
  exception is not one that includes the intended set, which this file already
  paid for where `role <> 'contractor'` let an owner and a tenant into a Team
  panel. An unknown kind is refused.

  And it is a **permission, not a label**: without the account-kind half any
  account could relabel somebody and walk the entire compliance gate, so the
  route checks it and CHECK.sql counts a row that got past.

  **PLUMBING AND ELECTRICAL ARE ON THE TRADE LIST, and that is the decision a
  later pass will want to reverse.** A dripping tap and a tripped breaker were
  the examples given, and those *are* plumbing and electrical. The tension is
  real — they are also the two trades where licensing bites hardest — but the
  line being drawn is **small work in those trades, not the trades
  themselves**, and no list of trade ids can express "small". Narrowing it is
  deleting two entries; doing so would also refuse the two examples the
  feature was asked for.

  **A W-9 IS STILL REQUIRED, and the signed agreement is deliberately
  untouched.** Insurance and a bond come off — a surety bond is a
  *contractor's* bond posted against a licence, so asking for one from
  somebody who needs no licence is the same unanswerable row. A W-9 is **not
  cover at all**: it is the ability to report the payment, which is why the
  document-request mail has always said payment cannot be issued without it
  and why `paygate.js` reads it. Nothing about being a handyman changes who
  the IRS expects a 1099 from. And whether a hiring account wants its own form
  signed stays their call, which is the rule already recorded — the request
  was about insurance and a licence, so the agreement was left alone and the
  test fixture carries one rather than the suite quietly widening the ask.

  **THE TRADE GATE IS ON THE SERVER**, because the roster not offering
  somebody is not the same as the route refusing them — and here that
  difference is a maintenance worker sent to a roof. The picker already
  filters by `sub.categories`, and the form strips a disallowed trade when the
  relationship changes, so the screen agrees; the route is what makes it true.

  **`requiredDocsFor` COMPOSES rather than replaces.** `kindsFor(agreement)`
  decides whether a signed agreement counts and this narrows that answer, so
  there is still one place deciding what a document kind *is*. It is applied
  in four places and each was a real hole: the roster's verdict, the
  assignment's `documents_incomplete`, the **lapse** check beside it (which
  reads `EXPIRING_KINDS` — insurance and a bond, both excused, so without it a
  work order would be refused over a certificate nobody asked for), and the
  browser's own `missingDocs` / `docsComplete`.

  **AND THE COLUMN HAS TO BE NAMED IN THREE PLACES OR IT IS SILENTLY
  DROPPED.** The first run of the suite returned `subcontractor` for a
  handyman: `/api/subs` selects named columns with `en_` aliases, and
  `engaged_as` was in the row shape and the re-map but not the SELECT. Not a
  visible failure — a roster that quietly goes back to asking a maintenance
  worker for a certificate. Same shape as `answersForItself` reaching
  `SubForm` as `undefined`, and `ENGAGEMENT_FIELDS` in the browser is the
  fourth place for the same reason: `splitSeed` carries only what its two
  whitelists name.

  **BOTH BRANCHES ARE ASSERTED IN THE SAME PLACE**, because a change that
  excused *everybody* their insurance passes a suite that only drives the
  handyman — the diagonal coverage that left `hiresLabel` half-wired. The same
  company, on the same account, with the same documents, is driven as each,
  and the mutation that excuses everybody fails five assertions.

  **Still open, and the user's call rather than a build:** there is no value
  or permit ceiling. "Lighter work" is expressed only as a trade list, so a
  handyman can be issued a $40,000 work order for painting. A cap would be a
  second axis and a different decision.

- **MOVE-IN AND MOVE-OUT UNIT INSPECTIONS.** A managing agent walks a unit
  when somebody moves in and again when they move out, room by room, with
  photographs, and raises the work from what they find. *"The carpet was like
  that when I moved in"* is the commonest dispute in the business and the only
  answer to it is two dated records of the same unit — which is why the kind
  and the date are columns rather than something somebody types into a note.

  Migration 055, `app/shared/inspection.js`, and an Inspections tab. **Gated
  the way Properties is** — `hasProperties(account)` as well as the role —
  because an account with no buildings has no units to walk. A **scoped**
  project manager keeps it: the buildings they are narrowed to are the
  buildings they inspect, which is the whole job, so it is a role capability
  and not `canManage`. The list, every room and every photo resolve through
  one function that applies that scope, because a scope added to nine places
  is a scope missing from the tenth.

  **FOUR STATUSES, NOT THREE.** A room nobody has walked and a room walked and
  found fine must not look the same — the ambiguity `doccheck.js` was written
  to remove one feature along. So `unchecked` is a real answer, it is drawn
  **plain rather than tinted** (not got to yet is a to-do, not a problem — the
  same distinction the never-added document dot makes by being hollow), and it
  is the thing that stops an inspection being finished. **Fail and Follow-up
  are both flagged**: a cracked basin and a scuffed wall need different words
  and the same next step, which is `docs.js`'s expired-and-never-added rule in
  a new place.

  **Photos are nudged and never demanded.** A room with nothing wrong in it
  needs no picture, and a gate that insisted would be answered with a photo of
  the floor.

  **ONE LEVEL, NOT TWO.** Rooms and the parts of a room sit at the same level
  on every inspection sheet this was modelled on, so *Bathroom 1* and *Walls
  and floors* are both rooms and the standard list offers both. A second,
  nested level would be another thing to add, name, reorder and delete for a
  distinction nobody draws on paper. And the list is a **datalist on a
  free-text box**: every building has a room it has not heard of, and a
  dropdown that cannot be typed past is a form that argues.

  **FINISHED IS A ONE-WAY DOOR**, which is the point of it. An inspection is
  evidence months later, and a record that can be edited afterwards is one the
  other side can say was edited afterwards. Everything stays readable; nothing
  stays writable, on the screen as well as in the route.

  **RAISING THE WORK CREATES A JOB AND STOPS THERE**, and that is a decision
  rather than an unfinished half. Issuing a work order is a price and a date
  committed to a company, and this file's own rule is that the side paying
  cannot commit the side doing the work without them answering. So the job
  lands unassigned at the right building with its address already on it, its
  scope is **the flagged rooms and nothing else** — a job is a list of things
  to do, not a document to read — and Assign, Ask for quotes and Overflow are
  one tap away on it with every gate they carry. **One job per inspection**: a
  second would be two contractors asked for the same work, found out when both
  turn up. An all-clear inspection says so rather than creating an empty job
  somebody then has to find and close.

  Photographs go through the **same checked upload kind** a tenant's report
  photo uses — one set of type and size limits rather than two — and the key
  from the body is **checked, never trusted**: without that, a key under
  another account's prefix would attach and then be served back by the route
  that reads it. Taking a photo off leaves the object in R2, for the reason
  the report photo does: it is still evidence of what was walked.

  `ReportPhoto` took a `load` prop rather than being copied, so there is still
  one thumbnail and one lightbox. That is now mounted in three places, and
  `test:lightbox` counts the mounts rather than looking for one — the
  whichever-one-exists trap this file already records twice.

  **Still open, and a product decision rather than a build:** an inspection is
  not shown to the tenant it is about. Handing somebody the record of their own
  move-out, with the photographs, is the obvious next thing and it is also a
  decision about what a deposit conversation looks like inside this product —
  it needs an answer about who may dispute what, not an endpoint.


- **THE FINISHED INSPECTION GOES TO THE BUILDING'S OWNER, AND THE ROLE
  CAPABILITY WAS NOT ENOUGH TO LET THEM READ IT.** A move-in and a move-out
  report are the two documents a deposit argument is run from, and the owner is
  the one person besides the agent who has to be able to produce them. Migration
  056, `inspection_sends`, `whyNotSend` in `app/shared/inspection.js`.

  **It is a LINK into their own seat, not an attachment and not a token.** They
  were invited onto this building scoped to exactly it, so the permission
  already exists and is already right; minting a token would be a second
  surface, a second expiry and a second thing to revoke for somebody who can
  already sign in. It also keeps the record **live** — a PDF starts going stale
  the moment it is sent, which is the same reason the compliance pack is a link.
  So the email is the **telling** and not the access, which is why a mail that
  fails is worth saying out loud and is still not a lost report, and the panel
  says both.

  **FINISHED ONLY, through the gate that already exists.** `whyNotSend` is
  beside `whyNotFinish` and asks the same question, because a half-walked
  document says nothing while looking like it says everything — and a sent one
  is the document somebody quotes back. Sending a draft would undo that gate by
  a different door.

  **AND THE FEATURE SHIPPED REFUSED, BY A LIST THE ROUTE NEVER SEES.** The
  owner's seat was given `INSPECTION_READ_ROLES` on three routes and the
  Inspections tab on the screen, and every one of those reads answered **403** —
  because what a guest seat may reach is recorded in `OWNER_ALLOWED` as well,
  in a second vocabulary, as a path and a method rather than a role. Correct
  pieces with no way in, for the tenth time, and this is the general shape:
  **a role list and a path allowlist are two records of one fact, and a new
  route refuses a guest until BOTH of them say otherwise.** That direction is
  deliberate and must not be relaxed — the allowlist's own comment says a new
  route should fail closed — so the fix is three `["GET"]` lines, not a
  loosening.

  **GET is the whole of what is listed, and that is what makes it safe.** Every
  write route behind the screen is `INSPECTION_WRITE_ROLES`, so an owner is
  refused twice: once by the method not being on the line, once by the role.
  Those two guards cover for each other — mutating the allowlist to carry
  `PATCH`, `DELETE` and `POST` changed **no outcome**, because the role guard
  held — which is the shape this file keeps recording, so the allowlist's
  methods are pinned **statically** as well as driven.

  **THE ROLES ARE ONE LIST RATHER THAN THIRTEEN.** `requireRole("admin","pm")`
  was written out ten times and `("admin","pm","owner")` three, and the
  screen's own `canEdit` defaulted to **true** — which is what this was one
  edit away from shipping: an owner holding the tab, offered Finish, Raise a
  job, Send and a room form, every one of them a 403 after the press.
  `INSPECTION_WRITE_ROLES` / `INSPECTION_READ_ROLES` and `mayWriteInspection`,
  read by the routes and by the screen, and a test asserts **every** inspection
  route takes its roles from one of the two.

  **A DRAFT IS NOT THEIRS TO READ, and the refusal is `not_found`.** Same rule
  `jobscope.js` already records: `forbidden` on a real id beside `not_found` on
  an invented one is how somebody walks the account's inspection list one guess
  at a time. The list route filters in the SQL for the same reason a scoped
  list does — a list filtered in the browser is a list the API sent.

  **WHO ELSE WAS TOLD IS THE TEAM'S OWN RECORD.** `recipients` and `sends` are
  on the team's read and absent from an owner's, because the audience is the
  other owners' names and addresses — the same rule that keeps an overflow
  distribution list server-side. An owner reading their own report learns
  nothing about who else holds one.

  **AN ID IN THE BODY IS A CLAIM.** The posted ids are intersected with the
  audience rather than trusted, so naming any other user on the platform sends
  them nothing. The discriminating fixture is an owner of **the other building
  on the same account**: they are a real user, a real owner, and a check that
  merely asked for owners would have mailed them a unit they have nothing to do
  with. An empty list is **not** a send to everybody, either — defaulting would
  make a stray press mail every owner on the building.

  **A ROW PER SEND, AND IT RECORDS WHETHER THE MAIL WENT.** Re-sending appends
  rather than updating: *we sent it in October and again in January* is a
  different fact from the second half alone, and the first is the one that
  matters when somebody says they never got it. `emailed` is the send's own
  answer rather than the press's — a row reading "Sent" over an owner who was
  never told is exactly how somebody says they never received it while the
  screen says they did. An owner with no address at all is still recorded and
  still drawn as *Not emailed*, because **we never told them** is the fact
  somebody needs months later.

  **The panel defaults to whoever has NOT had it**, and ticks everybody once
  they all have — an empty set behind a dead Send is the
  disabled-control-with-no-reason failure, and sending it again is the only
  thing left to want there. With no owner on the building it draws **no button
  at all** and says where an owner is added instead, rather than a dead Send
  that says neither what is wrong nor where to go. It **re-reads the
  inspection** rather than patching the row, because who has it and when is the
  server's answer — a locally invented "Sent" disagrees with it the moment a
  mail fails, the same rule the pack card's upload follows.

  **The owner's copy of the screen is the same component.** `canEdit` gates
  Finish, Raise a job, the room form, the send panel and *New inspection*;
  the empty states and the blurb follow it too, because *walk a unit room by
  room* is an instruction to somebody who is not walking anything. Close stays,
  so it is not a dead end. And the manager's branch is asserted **in the same
  place**, because a fix that hid the button from everybody passes an assertion
  written only against the owner — the diagonal coverage that left `hiresLabel`
  half-wired.

  **And the owner is the only party this adds.** The tenant the report is
  about is still not shown it, which is the product decision recorded directly
  above and is not one a send feature settles: an owner is the client, and the
  tenant is the person the document will be used against.


- **AN ELLIPSIS ONLY HAPPENS WHEN SOMETHING UPSTREAM DECIDES THE WIDTH, and
  nothing did.** Reported with a red line drawn round a request title running
  out of its card and off the right of the screen: *"Barely any water pressure
  in the main bathroom - both the shower and the basin"*, 642px of text in a
  340px panel.

  `.dr-title` has carried `white-space:nowrap`, `overflow:hidden` and
  `text-overflow:ellipsis` since it was written, and all three did nothing.
  `.dash-row-open` is `align-items:flex-start`, so every child of that column
  flex container is sized to **its own text** rather than to the row — and
  `overflow:hidden` on a box that is exactly as wide as its content has
  nothing to clip. **A static assertion on those three properties passes over
  precisely this bug**, which is why the test measures the title's rendered
  right edge against the panel's content edge instead.

  **Two mechanisms, each pinned where it is the only one working.**
  `max-width:100%` on `.dr-title` holds the full-width sections; in the ~340px
  `sec-top` panel the title **wraps to two lines, clamped**, because an
  ellipsis there leaves about a third of the sentence and the title *is* the
  problem somebody is reporting — a queue that has stopped saying what is in
  it, which is the screen-that-answers-nothing shape rather than a layout
  preference. `overflow-wrap:anywhere`, because an address or a part number
  has no spaces to break at.

  **And the fixture could not tell whether half of it was there.** Deleting
  `max-width` changed **no outcome**: every other dashboard section's row is a
  plain `div`, whose children stretch and therefore clip on their own, so the
  only rows the rule holds are the two that are **buttons** — the requests
  panel, which now wraps instead, and the **emergencies** list. The suite had
  no emergency in it, so one guard was covering for the other. An urgent job
  with a long title is what makes the mutation fail, 281px past the card at
  390px. The two-guards-covering-for-each-other shape, for the sixth time.

  Three smaller things, all of them this file's own rules. A **short title
  cannot catch a row that does not clip**, so the fixture carries the reported
  one at its real length rather than "No hot water". The wide-section check
  only discriminates at **390px**, because at 1340 those columns are wide
  enough that no title reaches the edge — checking it only at desktop is
  choosing the width that flatters it. And a clamp needs an **explicit
  line-height** or the measurement reads `normal`, which is not a number.

  **The heading said WHO rather than WHAT.** *Asked for by owners and tenants*
  is a sentence where a heading should be a name, and the row under it already
  says who asked, by name and by role. It is **Work requests**, which mirrors
  the owner's own button reading *Request work*. Deliberately **not** *work
  order requests*, which is what was asked for: a work order is a specific
  object here — issued to one company, at a price, against an approved job —
  and these are requests for work that is not a job yet. Two names for one
  noun is how somebody concludes there are two lists, the trap already
  recorded about *Your code* under *My QR code*.

  And the backtick trap for the **eighth** time, in the comment explaining the
  `max-width` — written while adding a guard against it to the block three
  rules below, which is the one it was checked against.


- **A SELECTED STATE WRITTEN IN THE MARKUP THAT THE STYLESHEET HAD NEVER HEARD
  OF.** Reported against the inspection screen twice over: *"move in/out … can't
  tell if they are selected or not"* and *"same with selecting trades, can't
  tell which are selected in order to raise a job"*. Both were the same thing.
  `className={\`chip ${on ? "on" : ""}\`}` is written in three places and there
  was **no `.chip` rule and no `.chip.on` rule anywhere in the stylesheet** —
  the pills took their shape from a generic button rule and their selected
  state from nothing at all. So a ticked trade and an untouched one were the
  same pixels, and the grid of twenty-nine could not be read.

  **No static check could have caught it and no mutation either**, which is why
  it is worth recording as its own shape: the JSX is exactly right, the class
  name is exactly right, and the thing that is missing is a rule in a different
  file. It is the misspelt-capability failure in CSS — *the markup says `on`
  and nothing downstream reads it* — and the only thing that can see it is the
  computed pixels, which is what the test now reads.

  The values are the pair `.pick.on` and `.cov-toggle button.on` already carry,
  not a third set: two selected states differing by a shade is the
  almost-aligned failure one layer out. And **a tick rides in the chip as well
  as the fill**, because about one man in twelve cannot read a green against a
  grey and this is pressed on a phone in daylight.

  **MOVE-IN / MOVE-OUT IS ONE CONTROL WITH TWO HALVES, not two loose pills.**
  Exactly one answer is true and exactly one can be, which a pair of chips
  cannot say however they are coloured — so it is a segmented box, the chosen
  half solid, `aria-pressed` on both. The same control in both places it is
  asked (the New inspection modal and the header edit), because two components
  drawing one question two ways is how somebody concludes there are two
  questions.

- **THE NOTES ALREADY NAME THE TRADE, SO THE GRID OPENS WITH THEM TICKED.**
  Raising a job put twenty-nine trades in front of somebody who had just
  written *"Messy a lot of people, dirt floors, trim needs to be repaired"* —
  who has already said Final Clean, Flooring and Finish Carpentry, and was
  being asked to say it a second time by hunting for three chips in a wall of
  them. `suggestTrades` in `app/shared/inspection.js` reads the flagged rooms
  and ticks what the words name.

  **IT READS WHAT IS WRITTEN ABOUT A PHOTOGRAPH, NOT THE PHOTOGRAPH — and
  that stopped being a limit the day the drafts shipped.** This entry used to
  record the opposite, and the reasoning is worth keeping because it is what
  the answer turned out to be: reading a picture needs a vision model, an
  outbound call per photo, a key, a cost on every inspection, and the inside
  of a tenant's home leaving this origin. All four were then paid for by the
  photo drafts — which turn each picture into a **sentence about its
  condition, written to the row**. So by the time anybody raises a job the
  pictures are already words, and reading them here is **free**: no second
  call, no second charge, nothing new leaving. Asked for as "recommend trades
  based on issues within the description and photos", and the cheap answer was
  already sitting in the next column.

  Which makes the suggestion **only as good as what has been read**, so the
  screen says so: `unread` counts photographs on flagged rooms carrying
  neither a caption nor a draft, and the modal names them and points at the
  **Draft notes** press that already exists rather than growing a second one.
  A screen reading *suggested from your photos* over three unread ones is
  claiming the pictures were looked at. The surviving limit — **a photograph
  nobody has written about contributes nothing** — is what the old assertion
  was rewritten to pin, rather than deleted, because it is still true and is
  the honest statement of the edge.

  **WHERE EACH WORD CAME FROM IS CARRIED, because the two are not equally
  theirs.** A word in a note is one the manager typed; a word in a caption was
  drafted *for* them and may still be a draft nobody has kept. `fromPhoto`
  marks the second kind and the chip line reads *Plumbing (photo: "cracked
  basin")* — the same rule that makes an unkept draft dashed rather than
  silently adopted.

  **AND A WORD THAT ONLY SAYS WHERE THE DAMAGE IS, IS NOT THE DAMAGED
  THING.** The first run of this suggested a glazier for *"scuff to the wall
  left of the door"* — `door`, whole-word, in a sentence about paint. Not a
  rare phrasing: it is the one the photo-draft prompt **explicitly asks
  for** ("where in the frame it is, so somebody can find it again"), so the
  feature that made captions useful is the same feature that made them
  misread. A noun arriving behind a positional preposition is dropped before
  matching, and it is applied to the **note as well**, because a manager
  writes the same sentence and two rules for one fact is how the two come to
  disagree about "beside the sink". Both directions are pinned — the door
  somebody is standing next to earns nothing, the door that will not latch
  still does — because a guard that swallows the real case would quietly stop
  a glazier ever being suggested.

  **IT IS A SUGGESTION AND NEVER AN ANSWER**, and the screen is what makes that
  true. It names what it read and the word it read it from — *Finish Carpentry
  (“trim”)* — because **a preselection somebody mistakes for their own choice
  is worse than an empty grid**, since they will not read it. Every chip comes
  off, a removed suggestion stays **dashed** so putting it back does not mean
  re-reading the paragraph, and *Back to what the notes suggested* appears only
  once the selection differs — the same rule the agreement terms panel follows.
  Nothing recognised says **nothing at all**: no apology, no empty banner.

  **WHOLE WORDS, NEVER SUBSTRINGS**, which is the rule `crmmap.js` records for
  a different reason and the same cost — a trade on a job nobody is doing. The
  mutation that proves it is the one that hurts most: with substring matching,
  *bath* inside **Bathroom 1** ticks plumbing on a cracked mirror, and *pane*
  inside *panel* calls a glazier.

  **A ROOM THAT NAMES A SYSTEM SAYS WHICH TRADE; A ROOM THAT NAMES A SPACE DOES
  NOT.** *Shower and bath* is plumbing whatever is wrong with it; *Bathroom 1*
  is not, and the spaces are deliberately absent from `ROOM_TRADES` with the
  note saying why. Getting that backwards ticks plumbing on every bathroom in
  the building.

  **Only flagged rooms**, because the scope the job carries is the flagged
  rooms — a trade suggested off a room that was fine puts somebody on site for
  work that is not in the job. And every id in both maps is checked against
  `TRADES`, because a hint keyed on a trade that does not exist ticks nothing
  and nothing on any screen would say so.

  Two things this uncovered beside it. *Raise the job* was **dead with no
  reason next to it** when nothing was ticked — visible in the report as a pale
  button with no explanation, which this file has already called
  indistinguishable from a broken one. And an existing assertion had to change
  rather than be kept: *it will not go without a trade* was asserting the old
  emptiness, so it now pins that a recognised note opens the form **ready**,
  with the nothing-ticked case pinned where the grid can actually be emptied.
  **A test can pin the old answer as firmly as the right one**, which this file
  records about `RefreshAuthError` and has now paid for twice.

  And the backtick trap for the **ninth** time — in the comment explaining the
  new chip rule, caught by the one-line guard this file prescribes *before* it
  reached a build, which is the first time that guard has earned its keep at
  the gate rather than after a failed parse.


- **DIRECTIONS WITH NO CONTROL BESIDE THEM ARE A DEAD END WEARING
  INSTRUCTIONS.** The send panel's empty state read *"Add the owner on the
  building in Properties and the finished report can go to them"* — a sentence
  naming another screen, on a screen somebody had just finished a walk on.
  Reported with the words *"so not a dead end > add owner and send"*, which is
  the whole of it. This file has recorded the no-way-in failure a dozen times
  in its large form, where a route exists and nothing can reach it; this is its
  smallest, and it is the one most easily written by accident, because the
  sentence *sounds* like help.

  **It is the SAME form the Properties screen opens**, prefilled with this
  building and the owner role — the two things pressing the button has already
  said. `addOwner` is hoisted and passed to both, rather than a second handler
  or a second form: two would be two things holding the same seat limit, the
  same preset and the same invite.

  **And the loop closes without leaving the screen, because the seat is written
  on save.** `POST /api/account-users` writes the membership and its property
  scope immediately — before the owner has set a password — so an owner added
  here is a recipient the moment the panel re-reads, and the report goes while
  somebody is still standing where they asked for it. That is what makes *add
  owner and send* one gesture rather than a round trip through Properties.

  Two mechanics hold it. The follow-on is held in its **own state beside the
  form** and never on the preset: the preset is spread into the form's fields,
  so a callback riding in there is a key that ends up in a request body, which
  is the extra-field shape one along from the one that deleted a W-9. And it is
  **awaited after the save**, so a refused write does not run it.

  **The panel is KEYED on who it can go to**, which is the part that would have
  shipped broken. `InspectionSend` seeds its ticks on mount from "whoever has
  not had it" — so an owner arriving into a component mounted when the list was
  empty lands **un-ticked**, leaving Send dead over the very person somebody
  had just added in order to send to. The key remounts it when the recipients
  change, which is exactly when re-defaulting is right.

  And the test for all of it had two of this file's own traps in its first
  version. It matched the submit button as Add/Save/Invite when it reads
  **Create user**, so it clicked nothing and reported the feature as not
  working rather than the selector as wrong. And it read `after.who[0].ticked`
  unguarded, so the block **threw** on exactly the case it exists to catch,
  taking the assertions after it down — the read-through-`link?.` lesson, for
  the third time.

- **THE INSPECTION SCREEN WALKS YOU THROUGH IT, AND POINTING IS NOT GATING.**
  Asked to make it "more of a step by step walk through, ie add another room?
  get started by adding your first room here, recommended trades, assign sub
  contractors or handyman or later". The screen already held every control an
  inspection needs and said nothing at all about the order they are used in: a
  manager opening a draft met a header form, a tally, a bare list, thirty
  tap-to-add chips, a text box and five buttons, with no answer to *what now*.

  **A WIZARD IS THE WRONG SHAPE AND THE REQUEST IS NOT ASKING FOR ONE.** A
  wizard narrows what is available, and this screen is used standing in an
  empty flat where the one thing that must never happen is a control being out
  of reach — somebody photographs the bathroom while they are in it, not when a
  sequence says to. So the steps **point**: nothing is hidden, disabled or
  reordered, every existing affordance stays exactly where it was, and what is
  added is a name for where you are plus one control for the next thing. The
  suite asserts that directly, on the state where a wizard would be most
  tempting: with no rooms yet, all thirty chips, the free-text box, its button
  and the whole header form are still there and still enabled. Gating the add
  row behind a step fails four assertions.

  **`inspectionStep` IS THE ONE RULE**, read by the strip, the card and the
  tests, for the reason `inspectionTally` exists rather than a count per
  screen: three answers to "what is next" is how they come to disagree.

  **THE ORDER IS ROOMS, WALK, WORK, FINISH — work BEFORE the paperwork.** This
  product already offers *Raise a job* the moment something is flagged,
  finished or not, because the leak does not wait for the paperwork. A strip
  that put finishing first would be telling somebody to do the opposite of what
  the screen does.

  **NOTHING FLAGGED IS NOT AN UNFINISHED STEP, IT IS THE BEST ANSWER TO ONE.**
  An all-clear walk marks the work step **done** rather than sitting for ever
  on *raise the work* over a unit with nothing wrong in it — the
  permanently-amber failure `docs.js` exists to prevent, reached through a step
  number.

  **AND `send` IS A STEP ONLY WHEN THERE IS SOMEBODY TO SEND TO.** A building
  the account owns itself has no owner seat and never will, so listing it would
  leave a fifth step that can never be ticked on every inspection of it. The
  send panel keeps its own *add an owner* way in for the case where one should
  exist. Listing it unconditionally fails three assertions.

  **THE ASSIGN NUDGE IS DELIBERATELY NOT A STEP, which is "or later" taken at
  its word.** Once a job is raised it is on the Jobs screen and leaving it
  there is a real answer, so the step counts as **done** the moment the job
  exists and the nudge sits below the strip on a plain surface rather than the
  tinted one — a card wearing the colour that means *something is waiting on
  you* over work somebody has decided to leave is how people learn to stop
  reading the card. It names **a subcontractor or a handyman**, because a
  managing agent hires both. And there is **no Later button**: doing nothing is
  already later, and a control that does nothing is a control that lies.

  **POINTING IS SCROLLING *AND* RINGING**, the rule the compliance pack already
  paid for — a *Manage* button that only scrolled had answered "here is your
  company profile" to the question "what is still missing". A `box-shadow`
  rather than a border, because a border that thickens moves everything beside
  it by a pixel and the whole screen appears to twitch; and the ring carries a
  **counter as well as a key**, so asking for the same place twice takes you
  there twice. The add row also takes the **cursor**, because a ring round a
  box somebody still has to tap is a box they tap twice.

  **The old empty-rooms paragraph came off**, because the first card says the
  same thing and two sentences saying one thing is how somebody concludes there
  are two places to add a room. The inspections **list** gained the opposite
  fix: *Start the first one* beside its empty-state sentence, since the only
  control was in the header, which on a phone is off the top of an empty screen
  — directions with no control beside them are a dead end wearing instructions.

  **What a static check could not see, and what the browser suite is therefore
  for.** The strip has **three** states and two of them reading the same pixels
  is the chip bug this project already paid for — correct markup, nothing on
  screen — so the badge's own computed background and border come back and
  deleting the current-step rule fails. The card's button is **pressed**, not
  mentioned: wiring Finish to a no-op leaves every other assertion green. And
  pressing *Raise a job* is read through to the form, where the trades are
  already ticked and the line naming which word produced each one is visible,
  which is the only place the two halves of the request meet.

  **AND THE HANDYMAN PICKER FINALLY HAS PROOF THAT ANYBODY CAN REACH IT.** It
  shipped with a server suite and static assertions, which is exactly the state
  `roleLocked` was in: route, migration, picker and note all correct, and the
  picker unreachable for every seat on every account kind with nothing
  reporting it. It is driven now — the card, Edit, step 2 — on **both** account
  kinds in the same place, because a rule checked on one branch is the diagonal
  coverage that left `hiresLabel` half-wired.

  Two of this file's own lessons were paid for again in that one block. The
  negative assertion (*no working-relationship picker on a general contractor*)
  **passed over a screen that had never opened**: the roster noun follows the
  account kind, so a GC's nav reads **Subcontractors** and the harness matched
  only `^Contractors`. What caught it is the positive assertion beside it,
  which is the whole reason a "this is absent" check must be accompanied by a
  "and the screen is really here" one. And the note assertion matched
  `/licen|insur/` against whichever note happened to be showing and passed on
  the **subcontractor's** — *"Carries their own insurance and bond"*, which is
  the opposite claim. **An assertion that passes on either answer is not an
  assertion about the answer**, so each note is now read on its own selected
  half.

  Eight mutations fire, each on its own assertion: the current-step CSS rule,
  the ring, the focus, the Finish wiring, the walkthrough drawn on a finished
  inspection, the add row gated behind a step, the work step marked done
  whenever rooms exist, and `send` listed with nobody to send to.

- **AND THE HANDYMAN FINALLY HAS A CEILING, WHICH IS A SET OF FIGURES NOBODY MAY
  REFUSE A WORK ORDER ON.** The entry above shipped `engaged_as = 'handyman'`
  and recorded what was left open in its own words: *"there is no value or
  permit ceiling. 'Lighter work' is expressed only as a trade list, so a
  handyman can be issued a $40,000 work order for painting."* Every state's
  licence exemption for unlicensed work **is** a dollar figure, so the ceiling
  is the thing that makes the relationship mean anything rather than being a
  label. Supplied as a dataset of all fifty-one jurisdictions;
  `app/shared/handycap.js` is the figures and the rules for reading them.

  **IT WARNS, IT NEVER BLOCKS, AND THAT IS THE WHOLE DECISION.** Every other
  gate here refuses — `documents_incomplete`, `trade_not_handyman`,
  `cover_outstanding`. This one must not, for a reason the dataset states about
  itself: *compiled from secondary sources, verify each state before relying on
  it, not legal advice*. **Thirteen of the fifty-one carry `verify: true`**, and
  for a dozen more the note beside the figure outranks it — Tennessee is $3,000
  rather than $25,000 in nine named counties, Washington's exemption is void the
  moment you advertise. **A number nobody has checked must never be the thing
  that stops a work order**, which is the licensing dataset's own `reviewed`
  rule pointed at money. So the shape is the one `docs.js` already uses for a
  certificate lapsing under booked work: say it, loudly, where somebody can act
  on it, and cancel nothing. `test:handycap` asserts the **status** as well as
  the body — turning it into a 409 is the mutation that exists to be caught —
  and `test:handycapui` reads the Issue button's `disabled` back out of the
  browser, because an assertion that the component *mentions* the check passes
  with the button wired shut.

  **WHICH PUTS IT BEFORE THE PRESS.** A warning that arrives with the 201 is a
  warning about a commitment already made, so the screen is where it is said —
  on the form where the figure is typed, above the button rather than under it,
  which the suite measures as a rectangle rather than trusting source order. The
  route records the same verdict afterwards because **a warning on a screen is
  not a record**: *they were told and issued it anyway* has to survive, which is
  a trail and not a gate. Both halves read the one predicate so they cannot
  disagree, and the event log gets the figures and deliberately **not the
  prose** — the words change and the log is read months later.

  **THE STATE IS THE BUILDING'S, NOT THE CONTRACTOR'S**, because licensing
  follows where the work is — the rule `lien_waivers.governing_state` already
  keeps. Only a fixture whose building and whose company are in **different
  states** can tell those apart, so the handyman is registered in Oregon
  ($1,000) and the building is in Washington ($500) and the figure is $700:
  under one, over the other. A job at no building falls back to the company's
  own state, which is the only thing left to read, and that fallback has its own
  fixture. **The picker on the roster form deliberately asks a different
  question** — there is no job there to have a building, so it reads the
  company's state — and a later pass will want to unify them and must not.

  **IT COUNTS THE WHOLE JOB, because splitting is what the dataset explicitly
  prohibits.** A per-work-order comparison is a screen that teaches people to
  split one project across invoices to stay under a cap, which is the third
  global rule. Two $300 work orders on one job are $600 against a $500 cap, and
  that is the assertion: comparing the single line passes every other one.

  **FOUR BASES ARE FOUR SENTENCES, NOT FOUR NUMBERS.** `per_job` is a ceiling on
  this work; `annual` is a ceiling on their year; `none` is no exemption at all,
  at any amount, in six jurisdictions; `no_state_license` is a state that
  licenses nobody. A cap of 0 and no cap at all are both "no number to compare"
  and they are **opposite answers**, told apart by the words — `docs.js`'s
  expired-and-never-added rule, on a dataset.

  **AND AN ANNUAL CAP IS NEVER ANSWERED "UNDER IT".** That figure counts the
  handyman's whole business across every client and SubSub sees one slice, so the
  sentence names it as such — *committed through this account this year… and
  SubSub cannot see their other clients*. The same honesty the waiver roll-up
  keeps by never saying "clear", only "clear through a date". One job over the
  annual cap is over it on its own, with no year figure at all, because that is
  the one case nobody can argue with and dropping it is a silent miss.

  **THE COLOUR FOLLOWS THE MONEY, AND THAT IS WHY PLUMBING IS A NOTE.** The
  dataset's first global rule says electrical, plumbing, HVAC, gas and
  structural work sit outside every exemption — which speaks directly to a
  decision already recorded above, that `HANDYMAN_TRADES` keeps plumbing and
  electrical because *a dripping tap and a tripped breaker are what this was
  asked for*. Both are kept: reversing it would refuse the two examples the
  feature exists for. What changes is that the screen now **says so** instead of
  the product holding the caveat privately. But it says it **quietly** under the
  figure, because a warning on every tap washer is *a red number that never
  clears is how people learn to stop reading badges* — already written here
  about the nav count — and then the one that matters, $8,000 of re-piping,
  is drawn like a washer. Over the figure it leads the verdict, since then no
  amount would have been exempt and being under would not have helped. Two
  mutations, one per axis: making the colour follow the trade fails one
  assertion, making the trade always lead the verdict fails a different one.

  **THE FIGURES WERE TRANSCRIBED MECHANICALLY, NOT BY HAND.** A digit typed
  wrong here is a wrong number on a screen somebody relies on, which is the
  `npm run paste` lesson this repository paid for once against a live database —
  so the table was generated from the supplied JSON. The suite then checks the
  shape rather than trusting it: exactly the fifty-one `states.js` knows and
  nothing else, every basis one of the four, `none` implies no figure,
  `no_state_license` implies no figure, every measurable basis positive and
  naming what it takes to go above it. **No row carries a state name**, because
  `stateName` already holds those. And the unconfirmed thirteen are **printed as
  a work queue** rather than counted, the rule the licensing dataset runs on: a
  count is not something anybody can act on.

  **One tension left as supplied rather than silently corrected:** Alaska reads
  `basis: "none"` while its own note describes a handyman licence covering jobs
  up to $10,000. Editing somebody else's dataset to make it internally tidy is
  how a figure nobody checked becomes a figure somebody invented, so the note
  renders and a reader sees both.

  **The words live in the module**, for the reason `docStatusText` does: the
  form, the route's recorded detail and the tests all describe one thing. Three
  mutations came out of writing them and each is now pinned — the licensing
  authority **lowercased into a sentence** (*"needs l&i contractor
  registration"*), a **raw trade id** reaching prose (`windows_doors`), and a
  `${}` surviving into rendered text, which is the same class as a `\uXXXX`
  escape in JSX and which this project has shipped twice. All three are checked
  across **every state at three figures and three trade sets** — 459
  combinations — because only one of them was ever wrong.

  **Still open, and the user's call rather than a build:** the permit rule. *Work
  requiring a building permit usually voids the exemption* is true wherever
  there is a figure and no dataset can answer it for a particular job, so it is
  said as a standing rule on the picker and nothing computes it. A permit flag
  on a work order would be the way, and it is a question about what people will
  actually fill in rather than an endpoint.

- **SUPPORT COULD NOT FIX A RECORD THE CUSTOMER CANNOT EITHER, AND THE SECOND
  FAULT BEHIND THAT SCREEN WAS NOT ABOUT STAFF AT ALL.** Reported from an
  impersonated session: a superadmin standing in Sound Property Management
  opened Pacific apartment maintenance — a contractor who answers for
  themselves — and got the refusal pane, *"they are not yours to change here"*,
  with no way to upload a document for them. *"A superadmin should be able to
  edit all users and upload documents on behalf of all users to get them set up
  and then perform emergency changes."*

  **THE DOCUMENTS HALF WAS A HOLE FOR EVERY ACCOUNT, NOT ONLY FOR STAFF.** The
  block was gated on `locked`, which is `answersForItself` — and that answers
  *may I rewrite their company record*. Uploading a certificate is a different
  question, and `mayWriteCompanyDocs` has answered it since it was written with
  **any live engagement**, deliberately, because a hiring account being emailed
  a COI and uploading it is the ordinary case rather than the odd one. So for
  every contractor with their own login the route took the upload and the screen
  offered no control — **the screen stricter than the route, which this file has
  called the same lie as looser three times** — and nobody could see it, because
  the only symptom is a button that is not there.

  **UPLOADING IS ADDITIVE AND DELETING IS NOT, which is why the two are not
  gated together.** An upload supersedes rather than overwriting, so the worst
  case is one more row in the history; a delete sets the boolean to 0 and takes
  them off **every roster they are on**, over a record somebody else holds. The
  route is unchanged and still allows it — so this is **prominence, not
  permission**, the distinction the pack card already draws: the screen is not
  inventing a stricter rule, it is declining to put a destructive control on
  somebody else's record where a moment ago there was none. Shipping Delete as a
  side effect of fixing Upload would have been widening scope in the one
  direction nobody asked for.

  **AND `companyAnswersForItself` WAS REFUSING THE ONE CALLER IT WAS NEVER MEANT
  TO.** That rule stops *one hiring account* rewriting *another business's*
  record and it does not move — a plain admin is still refused, and the test
  pins that first. A staff member standing in the account is not that: they are
  the one party who can fix a record while the customer is on the telephone, and
  this file has already written down what the alternative is — *"The only
  remaining remedy was SQL against D1, which is the answer this file refuses
  everywhere else."*

  `staffMayWriteShared` in `app/shared/seats.js`, read by the route and by the
  form so the screen cannot invite a save the server refuses or hide one it
  would have taken. Three things make it safe and all three are load-bearing.
  **It reads `impersonatedBy`, which comes off the session ROW** — the caller
  names a token and never an identity, so there is nothing a customer can send
  to claim it, and a test posts forged `X-Impersonated-By` and `X-Staff-User-Id`
  headers to prove it buys nothing. **It is a TEAM SEAT only**, because staff
  sitting in a tenant's or a contractor's seat are there to see what that person
  sees and widening those would make reproducing the customer's view impossible
  — the entire reason naming a seat exists. And **it is not a silent power**.

  **THE FIELD IT READS HAS EXISTED SINCE IMPERSONATION SHIPPED, WITH A COMMENT
  SAYING NOTHING READ IT YET.** *"Who is really here. Nothing reads it yet; it is
  set because a session whose real actor is unrecoverable is the one thing this
  table exists to prevent."* Eleventh time this file has recorded a correct piece
  with nothing wired to it, and the first where the piece was written in
  anticipation of exactly this. It is spent now.

  **RECORDED AS ITS OWN EVENT, not a flag on the ordinary one**, because *which
  fields of somebody else's shared row* is the whole of what anybody asks
  afterwards. `sub.company_written_by_staff` names the staff user — the only
  place the real actor exists, since `actor_id` is the seat — and an
  engagement-only save deliberately records **no** override, or every staff save
  would look like one and the log would stop meaning anything. That is the
  banner's own promise kept: *actions are recorded* is decorative otherwise.

  **AND THE WARNING DID NOT BECOME SILENCE.** For staff the danger inverts
  rather than disappearing: somebody correcting what looks like this account's
  copy of a contractor, and changing what every account that hires them sees. So
  the amber refusal is replaced by a note in the brand colour — **two different
  messages must not wear one colour**, amber here means *you cannot* — saying
  the change reaches all of them and is recorded against their name. The
  documents note says the same thing one layer down for an ordinary account: a
  file added here goes onto *their* record, and nothing of theirs is replaced.

  **What the browser suite CANNOT reach, said rather than faked:
  `resumeSession` deliberately refuses to resume an impersonated session** — a
  refresh ends it, which is what stops the flag going stale against the token
  the API is checking — so there is no way to land the harness in one. The staff
  half is driven on the route instead, through a real `impersonation_sessions`
  row, including a handed-back token and a token nobody issued. Writing a
  browser assertion for it would have been a test of its own fixture.

  Two traps in writing the tests. `String(row)` on a D1 row throws rather than
  printing, so the failure detail took down the block — the
  read-through-`link?.` shape in a new costume. And an assertion reading
  `got.staffOverride || got.staffOverrode` **passes a rename**, which is the
  could-not-fail shape this file keeps catching; it pins the one spelling now.

  Six mutations fire, each on its own assertion: dropping the team-seat half,
  giving the override to everybody, not recording it, recording it for an
  engagement-only save, putting the documents back behind the lock, and offering
  Delete on somebody else's record.

- **AN INVARIANT READ 8 ON A LIVE DATABASE WITH THE GATE IT CHECKS WORKING
  PERFECTLY, BECAUSE THIS PROJECT WRITES TIMESTAMPS TWO WAYS.** `CHECK.sql`'s
  `m057_inv_drafted_after_finish` counts a photo draft written after the
  inspection was finished — a one-way door the route refuses and the screen
  does not offer. Both halves of that gate are correct and the count read 8.

  `drafted_at` is the route's `new Date().toISOString()`
  (`2026-10-02T09:15:00.000Z`); `finished_at` is SQLite's `CURRENT_TIMESTAMP`
  (`2026-10-02 11:40:00`). Compared as TEXT, `'T'` (0x54) sorts above `' '`
  (0x20) — so **whenever the date halves are equal the ISO value always
  compares greater**, and the ordinary case, somebody walking a unit and
  closing it out on the same visit, reports itself as a draft written after
  the door shut. Across different days it is correct, which is why it reads as
  a plausible number rather than as every row.

  **Both formats are long-standing and neither is wrong.** Fifty `toISOString()`
  writes and seventy-one `CURRENT_TIMESTAMP`s, plus fifty-eight columns
  defaulting to it. They are both UTC, so nothing about the data is broken —
  what is broken is any SQL that compares a column from one family against one
  from the other. `datetime()` on **both** sides is the whole fix, and the only
  such comparison in the repository was this one. Changing the write instead
  was refused: the existing rows are ISO, so it would put two formats in one
  column and leave the comparison needing normalising anyway.

  **And an unparseable timestamp is counted, not skipped.** `datetime()`
  answers NULL for one and a comparison against NULL is NULL, so a route
  writing a malformed date would have **dropped out of the count that exists to
  report it** — a catch wide enough to hide a real error, in the one place whose
  only job is reporting them. The `IS NULL` arms are explicit, and the row
  carrying no draft at all stays uncounted, because never-drafted is the
  commonest row there is.

  **WHAT LET IT SHIP IS THE REAL LESSON: `schema-drift-test` RUNS EVERY
  INVARIANT AGAINST AN EMPTY DATABASE.** Every one of them reads zero there
  because there are no rows, so **no invariant's comparison has ever been
  executed by the suite** — it proves CHECK.sql parses and that a fresh install
  is clean, which is all it can prove, and it is not nothing. But a wrong query
  passes it forever, and this is the could-not-fail shape this file keeps
  catching, sitting underneath the mechanism built to catch the others. So an
  invariant is only exercised by **its own feature's suite seeding the case**:
  `photo-draft-test` drives a real draft and a real finish, then runs the real
  `CHECK.sql` and reads the column **by name**, so the test cannot drift from
  the file an operator pastes. Three mutations fire — the raw comparison (which
  reproduces the live 8), dropping the unparseable arms, and dropping the
  `IS NOT NULL` guard — each on its own assertion. The two stored formats are
  asserted too, named rather than taken on trust, because the entire bug is
  that they differ.

  **TWO CLASSES WERE THEN AUDITED ACROSS EVERY INVARIANT, so a later pass does
  not repeat it.** This one was the only comparison of two date columns in the
  repository. And the sibling fault — a `<>` or `NOT IN` against a column that
  can be NULL, where the comparison is NULL and the row drops out of the count
  meant to report it — bites none of the six that use one: `memberships.role`,
  `accounts.kind`, `wo_releases.status`, `inspections.status`,
  `inspection_rooms.status` and `payout_accounts.payouts_enabled` /
  `.transfers_active` are all `NOT NULL` on the live database as well as in
  `schema.sql` (003 added `kind` as `NOT NULL DEFAULT`, so the migrated shape
  agrees). Everything else reads through `IS NULL`, `COALESCE` or `NOT EXISTS`.

  **Still open, and a decision rather than a build:** that audit is static, and
  the faults it cannot see are the ones the 057 bug actually was — a query that
  parses, compares columns that exist, and answers the wrong question. The other
  twenty-odd invariants are still correct only as far as anybody knows, because
  none has been run against a row. Seeding each one needs a fixture from the
  feature that owns it, which is where it belongs rather than in the drift test.

- **A ROSTER OF JOBS ASSIGNED TO A CONTRACTOR WHOSE OWN PORTAL SHOWED NONE OF
  THEM — AND THE PORTAL WAS RIGHT.** Reported as *"I just assigned a bunch of
  new jobs to pacific apartment maintenance, but there is nothing in their
  dashboard… where is all of that!??"*, with a screenshot of the contractor's
  own screen reading **0 job requests, 0 upcoming, no upcoming jobs booked** —
  under an amber banner saying *you can't be assigned jobs until you upload*
  four documents.

  Everything the report asked for already existed and was rendering: the
  schedule, the pending requests with their countdowns, the document reminder,
  the booked value, aggregated across every client. The jobs were the thing
  that was not real. `POST /api/jobs/:jobId/assign` had refused **every one**
  with `documents_incomplete`, and this screen drew them anyway.

  **THE PATCH AND THE FEED ENTRY RAN OUTSIDE THE PROMISE.**
  `assignContractor` fired `Promise.all(...).then(...).catch(...)` and then,
  **synchronously**, wrote `logEvent("wo_issued", …)` and
  `setJobs(... issueWO ...)`. So a refusal drew the trade as assigned with a
  work order number on it, recorded *Issued a work order* in the activity feed
  about one that does not exist, and left a note that arrived afterwards and
  read as a remark about an issued work order rather than as a refusal. A
  reload made the lot vanish. Third instance of the save-that-reports-success
  shape — `updateSub`, `completeJob`, and now **the single most consequential
  press in the product**, the one that ends with somebody driving to a job.

  **No static check could see it.** `setJobs((js) => … issueWO(…))` is exactly
  the right code; the bug is only that it runs whether or not the server
  agreed. So `test:assignref` drives the form against a stubbed 409 and reads
  the Jobs screen back: the trade must still be unassigned and the contractor
  must not be named against it. Reinstating the fall-through fails seven
  assertions. **And the success branch is asserted in the same place**, because
  a "fix" that simply stopped drawing would pass every refusal assertion and
  break the product — the diagonal coverage that left `hiresLabel` half-wired.

  **One assertion in the first version could not fail and was replaced rather
  than kept.** *Nothing claims a work order was issued* looked for the feed
  line, which the Jobs screen does not render and the stub cannot serve — it
  survived the mutation untouched. What the suite can see is the trade row, so
  that is what it reads; the feed entry is guarded by the same early return and
  the suite **says out loud** that it has no assertion of its own.

  **AND THE REFUSAL TOLD PEOPLE THE WRONG THING TO DO.** It read *"has
  documents still waiting on review"* for every case, including the one in the
  report, where nothing had been uploaded at all. Those need opposite actions:
  nothing on file is the contractor's and this account can only ask; on file
  and unverified is **this account's own review sitting undone**, which the
  contractor cannot clear however many times they are chased. The route now
  answers `absent` and `unreviewed` beside `missing` — it already selected the
  company's document columns and simply did not say — and each sentence names
  the one action that works. The same expired-versus-never-added distinction
  `docs.js` draws in colour, one screen along.

  **AND THE CONTRACTOR'S BANNER NAMED A DOCUMENT THAT BLOCKS NOTHING.** It said
  *you can't be assigned jobs until you upload: … IRS Form W-9*, counting
  `missingDocs`, which is all four kinds. The route has always refused on
  **three**: a W-9 is not cover, it is what makes the payment reportable, which
  is why `paygate.js` reads it before money moves and the document-request mail
  says payment cannot be issued without it. So a subcontractor was sent looking
  for a tax form to unblock work that was waiting on a certificate — the screen
  **stricter** than the route, which this file has called the same lie as
  looser, pointed at the first sentence a subcontractor acts on.

  `ASSIGN_KINDS` in `app/shared/docs.js` is the one list, read by the route and
  by the banner, with `PAY_ONLY_KINDS` derived from it so the W-9 gets its own
  clause — *it does not hold up job requests, but you can't be paid without
  it* — rather than being a fourth item in a sentence about assignment. The
  route had the three written out inline and the banner counted a different
  set: two records of one fact, and the copy people read was the wrong one.
  `missingDocs` is unchanged and still drives the badge and the Upload button,
  because *what is this engagement judged on* is a different question from
  *what stops a work order*.

  **The fixture is a contractor who looks assignable from here.** The roster row
  carries four verified documents, because the refusal under test is the
  **server's** — a row the screen already knew was short would never reach the
  button, and a suite driving that case could not tell a guarded patch from a
  hidden one. Five mutations fire, each on its own assertion: the fall-through,
  the W-9 back in the gate, the refusal flattening `absent` and `unreviewed`
  into one, and both halves of the message.

  **Still open, and worth a decision rather than a guess:** every other write on
  this screen is optimistic in the same way, and most of them are recoverable by
  reloading. This one was not, and neither is completing a job — which is why
  both have now been awaited one at a time. A sweep of the rest would be the
  right shape and is a bigger change than a bug fix.

- **ONE NAME FOR THE FOUR DOCUMENTS, AND THE RENAME WAS HALF DONE ALREADY.**
  The account side has said **Compliance pack** since Account was split into
  tabs, and `sub-home-test` has pinned that the tab is *not* called "My
  documents" ever since. The contractor portal went on calling the same four
  documents **My Documents** in its nav and **My documents** on its page head —
  two names for one object, which is how somebody concludes there are two of
  them, and the exact trap already recorded here about a panel headed *Your
  code* under a menu entry reading *My QR code*.

  It is also what a general contractor actually says when they ask for it,
  which is the whole reason the words matter: the pack exists to be asked for.

  **And the send is `Quick send`**, which is what the component has been called
  since it was written. *Send my documents* described the action and the menu
  entry is now the name of the thing it opens, with the panel under it saying
  in one sentence what goes — the certificate, the bond and the agreement as a
  live page rather than an attachment that goes stale. It still sits beside
  **My QR code**, because both are the same gesture: give somebody your details
  without a conversation.

  **The comments were moved too, and the two that are history were kept.**
  `test:rosterword` already records that a comment naming a literal reads to a
  substring check exactly like the literal still being there — and worse, a
  comment describing current behaviour under a name that no longer exists is
  how a later pass "fixes" the inconsistency by reverting it. The two that say
  *until now the only nav item was "My Documents"* and *the portal went on
  calling it "My Documents"* are the record of why the rename happened and stay
  as they are.

  Three suites keyed on the old words and each was updated rather than
  loosened: `page-head-test` pins the nav label and the page head as **one
  pair**, so they cannot drift; `doc-share-ui-test` navigates by the nav label;
  `quicksend-ui-test` opens the menu entry. Reverting the nav label alone fails
  `test:docshareui` — the rename is load-bearing rather than decorative.

  `missingDocs` and the red count are untouched: *what is this engagement
  judged on* is a different question from what the screen is called.

  **Not verified here:** `test:pagehead` needs the full local stack (worker
  8787, Supabase stub 8902, dists on 5191 and 5192) and this container runs
  none of it, so it fails with `ERR_CONNECTION_REFUSED` before reaching an
  assertion — as it did before this change. The edit pins the same pair under
  the new name and is correct by construction; it has not been run.

- **INVITING A HANDYMAN PRODUCED A SUBCONTRACTOR, BECAUSE THE PICKER WAS ON
  ONE OF THE TWO DOORS.** Reported as *"when I go to signup a new user I don't
  see any settings for a handyman"*. 058 put `engaged_as` on `engagements` and
  the control for it on the add-a-contractor form. The other door is the blank
  **Invite**, and it creates no engagement at all: there is nothing but a
  `sub_invites` row until somebody opens the link, at which point
  `createApplication` writes the company, the engagement and the seat in one
  go — with no word to write.

  So the door used for somebody who has **no SubSub account** could only ever
  produce a subcontractor, and that is exactly the person most likely to be a
  handyman: you do not type the man who changes tap washers into a roster, you
  send him a link. He then landed as a subcontractor, his own portal demanded a
  certificate of insurance and a surety bond he will never hold, and he could
  not be given a job until somebody noticed and edited his card. The
  permanently-amber failure `docs.js` exists to prevent, reached through the
  commonest door. Twelfth time this file has recorded correct pieces with no
  way in, and the first where the missing way in was *one of two*.

  Migration 059, `sub_invites.engaged_as`.

  **IT IS A HELD INTENTION, NOT A FACT ABOUT ANYBODY**, which is what decides
  where it lives and when it can be changed. Nothing has happened until the
  link is opened, so it rides on the invite and is applied to the engagement at
  redemption — and it is **correctable right up to that moment**, the same
  boundary `PATCH /api/invites/:id` already draws for the address. After that
  the record is their `companies` row and the roster is the door; two doors
  onto one record is how the two come to disagree.

  **And changing it does NOT reissue the link, which inverts the rule beside
  it.** Replacing an address reissues, because the reason to change an address
  is that the link went to the wrong person and leaving their copy live hands a
  stranger a way onto this roster. Here nothing went anywhere wrong — the form
  they open simply asks them different questions — so killing a working link
  would cost somebody their invitation to fix a classification.

  **On BOTH buttons.** A link handed over in person writes the same engagement
  when it is opened, so leaving the word off that one would make the
  relationship depend on which button was pressed.

  **NEVER OVER AN EXISTING ENGAGEMENT, and never from the applicant.** A
  company already on this roster has a relationship somebody set, and an invite
  raised afterwards — to give them the login they never got — must not silently
  reclassify it. And the word comes off the invite row the *account* created,
  never out of the body: whoever opens the link types that, and a contractor
  naming themselves a handyman would be excusing their own insurance and bond.

  **AND THE FORM THEY LAND ON FOLLOWS, or the screen is looser than the route
  on the one page whose reader cannot find that out.** `GET /api/invite/:token`
  carries the word, so the signup form stops asking a maintenance worker for a
  WA L&I number over a line promising to check it against the state registry —
  `needsLicense` has said he has none since 058 — and narrows the trade grid to
  the thirteen `mayCover` will actually allow. It offered all twenty-nine, so
  picking Roofing at signup produced a slot this account could never fill. Both
  changes **say so** rather than silently asking for less, because a form that
  quietly drops a field reads as one that is still loading.

  **THE NEW MECHANISM, AND IT COST THE FIRST RUN OF THE SUITE: a column that
  is not NAMED is silently absent, and here it failed in the quiet
  direction.** `createApplication` re-asks `mayEngageHandyman` before applying
  the word, because an account can change kind between being invited and being
  joined. `lookupInvite` selected six columns of `accounts` and **`kind` was
  not one of them** — so that check answered false for every account on earth,
  and a handyman invite redeemed correctly, as a subcontractor, with nothing
  anywhere saying a word. Same shape as `answersForItself` reaching `SubForm`
  as `undefined` and `engaged_as` missing from `/api/subs`, with the twist that
  the predicate it broke is a *defence-in-depth* one: it had no visible job, so
  nothing but the end-to-end assertion could see it was dead. The discriminating
  fixture is an account that has **become a general contractor since inviting**,
  which is the only case either behaviour can be told apart on.

  **The degradation is one statement, deliberately not a column on the
  insert.** The invite INSERT already carries a fallback for a database without
  027, and folding this into it would mean a database with 027 and not 059
  dropping the **recipient** as well — losing the common case to record the
  rare one. As a separate `UPDATE` the invite still goes, the address is still
  recorded, and only the relationship is lost, which is **said** on the reply
  (`engagedAsRecorded`) and on the screen rather than assumed. Skipped entirely
  for a subcontractor, because NULL already means that — so the ordinary invite
  never touches a column 059 added and cannot fail on it.

  **NULL, never the word, when switching back.** Two spellings of the ordinary
  state is `engagedAs()` reading one of them by luck.

  **Two test traps, both already in this file and both paid for again.** The
  browser suite read `s.btns[1].bg` and **threw on exactly the case it exists
  to catch** — the picker being absent — which killed the run and took eleven
  assertions with it: one real failure reported as a crash, the
  read-through-`link?.` lesson for the fifth time. And the harness typed the
  email address into the **company** box, because that field carries an inline
  note reading *"SubSub is matched on the email, mobile or licence below"* and
  a substring match for `Email` found it first; Send was then disabled, and the
  suite reported the product as not posting the relationship. A label is
  matched on its own text nodes now, not its `innerText` — splitting on the
  newline was not enough either, since the note is a `<span>` and sits on the
  same rendered line. Third assertion worth keeping: *the confirmation says
  what they will join as* originally read the whole panel for the word
  "handyman", which the picker's own explanatory copy contains — so it passed
  whether or not the confirmation mentioned it.

  Sixteen mutations fire, each on its own assertion. `test:inviteasui` drives
  **both account kinds in the same place**, with the positive assertion ahead of
  the negative one, because "there is no picker" passes loudest on a screen that
  never opened — and the roster noun follows the account kind, so a harness
  matching only `^Contractors` misses a general contractor's nav entirely,
  which is a trap this file has already recorded against this exact navigation.

  **Not verified here:** `test:invitedlist` and `test:subinvite` need the full
  local stack (worker 8787, Supabase stub 8902) and this container runs none of
  it, so both fail on `ECONNREFUSED` before reaching an assertion — as they did
  before this change.

  **Still open, and a product decision rather than a build: there is no handyman
  account KIND, and that is deliberate.** `get-started.html` offers five kinds
  and none of them is handyman, because the word is what somebody is *to an
  account that engaged them* and the same company is one firm's handyman and
  another's contractor — the whole reason 058 put it on `engagements`. A
  maintenance business signing up for itself is the `subcontractor` kind, which
  is the hireable one. Nothing in the product asks them to classify themselves,
  and nothing should.

- **THE TIME NEVER REACHED THE PERSON WHO HAS TO TURN UP.** Reported with two
  screenshots of the same job a minute apart. Sound Property Management's Jobs
  screen: *"Proposed Oct 4, 2026 - 11 AM-1:15 PM - waiting on John Smith to
  confirm."* Pacific apartment maintenance's own portal, same job: **No date** —
  on the card they are asked to accept or decline. *"We need to tighten up the
  assigning and scheduling of jobs since this is the core of what the product
  does."*

  **TWO PLACES A TIME CAN LIVE, AND THE CONTRACTOR COULD SEE ONLY THE EMPTY
  ONE.** `jobs.date` is the target date somebody typed when the job was raised.
  A row in `visits` is the actual appointment. 019 built that as a
  manager-to-tenant conversation — the manager proposes a window, the tenant
  confirms it because somebody has to be in — and **`/api/my-work` never joined
  it**. So the one party who physically drives to the address was the only
  party not told when, and the product's central act, putting a named company
  on a job at a time, was missing its third of the three facts.

  `app/shared/schedule.js` is the one rule. `workWhen` answers which of the two
  a row means and what it means; the screens format it with `visitWhen`, which
  the tenant's side has used since 019, rather than a second formatter — two of
  those is how the two parties to one appointment come to read it differently.

  **A CONFIRMED VISIT OUTRANKS THE JOB'S OWN DATE, and getting that backwards
  is the whole trap.** The job column is what somebody typed; the visit is what
  the tenant agreed to, and it is the later fact. The tenant's screen has drawn
  it that way since 019 — *"a date on the job is not a date with the tenant"* —
  so reading the job column here would put two different dates in front of two
  parties to one appointment. **Only a fixture where the two DISAGREE can tell
  which is being read**, so the suite's row carries a job date nine days in the
  past and a confirmed visit five days ahead.

  **FOUR ANSWERS, NOT TWO, AND THE WORDS ARE THE POINT.** *Confirmed* is the
  appointment. *Proposed* is a time somebody asked for that nobody has agreed
  to — and the difference between those two is whether you get in the van, so
  they are said in words and drawn in different pixels rather than one being
  left to infer. *Target* is a job date with no appointment, which is still the
  honest answer for work with nobody to let anybody in. *None* **says so**:
  a contractor accepting work with no date needs to know that is what they are
  accepting, and a blank reads as a screen that has not finished loading.

  **A PROPOSED TIME STILL GOES ON THE CALENDAR**, which is a decision rather
  than an oversight. A contractor needs to know somebody has **asked** for
  Saturday as much as that Saturday is settled, and a strip that showed only
  confirmed ones would be the same silence this change exists to end. Every row
  says which it is and the day is tinted rather than filled, so nothing is
  passed off as agreed.

  **AND A DECLINED OR SUPERSEDED VISIT IS NOT AN APPOINTMENT.** Driving to a
  time the tenant refused is worse than having no time at all. `LIVE_VISIT` is
  `proposed` and `confirmed` and nothing else, and the route serves the
  **newest** live one — a job collects superseded proposals behind it, and
  serving the first row the table felt like handing back is a date nobody
  agreed to drawn as the appointment.

  **THE SUBCONTRACTOR HAS A SCHEDULE OF THEIR OWN NOW.** The portal had
  *Current & upcoming* — cards ordered by date, which answers *what have I got*
  and not *am I on a roof on Thursday*. `MySchedule` is the next appointment,
  what is after it, a fortnight strip and the count of work with no time on it
  at all. **Deliberately not a reuse of `ScheduleHero`**: that one draws a fill
  badge off `j.trades` and `j.assignments`, which is the hiring account's
  question (is this job covered). A contractor holds one trade on one job and
  their question is the opposite one — is the time agreed — so feeding their
  rows through it would mean faking an assignments map to get a badge that
  means nothing to them. It spans every client, like everything else on that
  screen.

  **The box for what needs answering already existed** and the report was right
  anyway: *Job requests* renders only when there is one, and the screenshot had
  none, so there was nothing on screen to say where they would appear.

  **AND `/api/visits` WAS HANDING A CONTRACTOR SEAT THE WHOLE ACCOUNT.**
  `scopeClause` narrows by buildings and a contractor has none, so it
  contributed nothing — the same hole `/api/jobs` already closed, one table
  along, and it got wider the moment anything started reading that list from
  the portal. Scoped by the **work order**, never the job, because holding one
  is the thing that says this job was given to them. The discriminating fixture
  is a visit on a job this company holds no work order on: without it a leak
  and a clean list are the same list. **The admin branch is asserted in the
  same place**, because narrowing everybody is a manager who can no longer see
  their own buildings' appointments.

  **AND THE TENANT'S NOTE IS DELIBERATELY NOT CARRIED.** Why Tuesday does not
  work for somebody's flat is theirs; the contractor needs the window. What
  does ride along is the **proposer's** note — a gate code, a dog, which
  entrance — which is the manager telling the contractor something they cannot
  do the job without, and nothing anywhere carried it.

  **"Accepted" names the company.** On a job with three trades a bare tick
  makes you read back up the row to find out who agreed, and the whole point of
  that chip is that a named business has committed. `subName` is one helper
  rather than `subs.find(...)?.company` at each call site, and it falls back to
  the plain word rather than a blank, because the roster list a screen holds is
  not always the whole one.

  **Seven mutations fire on the browser suite and five on the server one**,
  each on its own assertion — and **one of them did not fire on the first
  attempt**, which is the lesson worth keeping: the patch reverting the card to
  the bare job date silently matched nothing, because a comment had been added
  between the condition and the branch. A green run under a mutation that never
  applied is indistinguishable from a guarantee that holds. **Check the file
  changed, not that the script exited.**

  And the backtick trap for the **tenth** time, in a SQL comment inside the
  `my-work` query — twice in one edit, once for the word *visits* and once for
  a column name.

  **Still open, and a product decision rather than a build: the contractor
  cannot answer a proposed time.** They can see it now and they can propose one
  (`POST /api/jobs/:id/visits` has taken a contractor since it was written),
  but the confirm/decline pair belongs to the tenant, so a window that does not
  suit the crew goes back through *Request a change to this work order* rather
  than through the thing it is actually about. A three-party handshake —
  manager proposes, tenant confirms it is convenient, contractor confirms they
  can come — is the right shape and is a decision about who outranks whom when
  two of the three disagree, not an endpoint.

- **"WON'T LET ME EDIT THE SUBCONTRACTOR AT ALL" WAS TWO BUGS AND A MISSING
  CONTROL**, reported from the staff console's Companies screen with the pencil
  tapped and nothing apparently happening.

  **SAVE WAS DEAD ON ANY COMPANY WITH NO LICENCE NUMBER.** `CompanyEditFields`
  read `disabled={!f.company.trim() || !f.license.trim()}`, so a record
  somebody typed off a business card — which is five of the ten rows on that
  screen — could be opened, edited and never saved. **With nothing beside the
  button saying why**, which this file has already called indistinguishable
  from a broken one, on the console, for the second time.

  And it contradicted a decision this product took twice: *several states have
  no state contractor licence at all*, so signing up never requires one and
  neither does being on a roster. The one screen in SubSub demanding a licence
  was the staff console, about companies the product deliberately allows to
  have none. The route had always accepted the save — **it was only ever the
  button**, which is why nothing server-side could have caught it.

  **AND THE FORM OPENED BELOW THE FOLD.** It renders after the whole company
  grid, so at an iPad's width with ten companies on it the pencil scrolled
  nothing and drew nothing in view. It scrolls **and rings** now, the rule the
  compliance pack already paid for — *landing somewhere is not the same as
  pointing at something*, and a panel arriving silently at the foot of a long
  page has not been pointed at. A `box-shadow`, because a border that thickens
  moves everything beside it by a pixel.

  **AND THE WORKING RELATIONSHIP COULD BE READ NOWHERE AND CHANGED NOWHERE.**
  058 put it on `engagements` and the picker on the roster form, which is
  right — but the console, which exists to answer what a customer cannot,
  carried it in neither direction.

  `PATCH /api/platform/engagements/:id`, and **keyed by the engagement, never
  the company**, which is the whole shape of 058 and is why it is not a field
  on the company edit panel three functions up. One account's handyman is
  another account's contractor; a control on the shared company row would say
  it for both. The card carries **one per account that engages them**, and the
  mutation that proves it writes by `company_id` and changes the other
  roster's answer too.

  **SUPERADMIN, unlike the company edit beside it.** This is the entry that
  excuses somebody their insurance and their licence on a roster — closer to
  the delete button than to correcting a phone number.

  **AND STAFF GET THE SAME PREDICATE, NOT AN EXEMPTION FROM IT.** A general
  contractor's engagement refuses `handyman` here exactly as it does on the
  customer side, because `CHECK.sql` counts that row as a fault and writing one
  from the screen that exists to *fix* faults is the worst place to put it.
  Being staff is a reason to reach another account's record, never a reason for
  that record to be wrong.

  **The console bootstrap had to name the column**, or it comes back
  `undefined`, which `engagedAs()` reads as `subcontractor` — a console
  quietly disagreeing with the roster it is meant to explain. Same silent drop
  as `/api/subs` and `answersForItself`, now the third instance. It falls back
  to the old shape on a database without 058 rather than blanking the whole
  console, because one missing column must not cost staff every screen.

  **Recorded as its own event naming both sides and the DIRECTION.** "Staff
  changed a relationship" is not answerable afterwards; *which company, on
  whose roster, from what to what* is — and this is the edit that decides
  whether a certificate of insurance is ever asked for again. `events.payload`
  carries from/to and `activity.text` carries the sentence, which is the split
  that already exists: the machine half and the readable one.

  **Eight mutations fire, and the eighth needed the assertion rewritten
  first.** *The edit panel is scrolled to and rung* was `/scrollIntoView/`
  over the whole of `App.tsx` — which finds the compliance pack's focus ring
  and the inspection walkthrough's, and **passed with this panel doing
  nothing at all**. The `.embed-code-btn` trap, for the fourth time. It reads
  the effect's own block now, keyed on `editCompanyId`.

  **Deliberately unchanged: the customer side already works.** The roster
  form's own picker has been on step 2 since 058 and is driven in a browser by
  `test:inspectstep`. This adds the staff door, not a second customer one.

- **THE TENANT DOES NOT ALWAYS HAVE TO BE IN, AND NOBODY COULD SAY SO.** Asked
  for as *"a tenant does not always need to be available and in the unit [for
  a] job. Sometimes you need to be there. Allow the property manager to adjust
  that when scheduling the job, because that's one process that does not need
  to happen."*

  **THE RULE ALREADY EXISTED AND HAD NO OVERRIDE.** `POST /api/jobs/:id/visits`
  has read `seat?.role === "tenant"` since 019: a repair a **tenant** reported
  waits on that tenant to confirm the window, anything else is confirmed the
  moment a time is proposed. That is a good default and it is derived entirely
  from who happened to raise the job — so a tenant reporting a **leaking roof**,
  fixed from outside with nobody needed indoors, still sat waiting on them to
  agree a morning they did not have to be home for, and the repair did not move
  until they answered. Thirteenth time this file has recorded a correct rule
  with no way to say otherwise about it.

  Migration 060, `jobs.access`, `app/shared/access.js`.

  **NULL IS THE 019 RULE, NOT A THIRD ANSWER.** `accessFor` takes the stored
  word when there is one and otherwise falls back to exactly what the route has
  always done, so every job that already exists behaves as it did — the same
  asymmetry `jobScopeFrom` and `engagedAs` use, and what makes it safe against
  a live database with no backfill. Only a fixture carrying jobs on **both**
  sides of that fallback can tell it from a blanket change, which is why the
  suite drives a tenant's report left alone as well as one overridden.

  **THREE ANSWERS, AND ONLY ONE OF THEM COSTS ANYTHING.** *The tenant needs to
  be in* is the round trip. *We'll let them in* and *no access needed* both
  book outright. The second and third are mechanically identical and are
  deliberately not merged, because **they are different sentences to the person
  who turns up** — "the managing agent will meet you" and "nobody has to be
  there" are different journeys, and that is the audience this product keeps
  forgetting has to be told anything at all. Every kind carries words for the
  manager deciding and words for the contractor arriving, and they are not the
  same words.

  **AND THE ANSWER IS CHANGED AT SCHEDULING, which is what was actually
  asked.** What a repair turns out to need is usually only clear once somebody
  has looked at it, so the picker sits in the visit block beside the time as
  well as on the create form. `PATCH /api/jobs/:id` takes it.

  **A JOB NOBODY REPORTED HAS NOBODY TO ASK, whatever the column says — and the
  test is what found that.** The first version let a manager mark their own job
  *the tenant needs to be in*, which would have left a visit proposed for ever
  with no one able to answer it: `notifyTenant` writes to `jobs.requested_by`,
  and a manager-raised job has none. That is the
  waiting-on-somebody-who-cannot-reply failure this file records about a
  handshake behind a capability its answering role lacks, and it was two
  assertions in the same suite contradicting each other that exposed it.

  So **the override decides whether to ask; whether there is anybody to ask is
  still a fact.** `canAskTenant` is that fact, read by the route *and* by
  `accessChoices`, so the picker drops the answer rather than offering a
  control the server quietly ignores. It reads **both spellings** —
  `requestedBy` in the browser, `requested_by` on a raw row — because
  normalising at each call site is a conversion to forget, and a missed one
  here reads as *nobody to ask*, which is the direction that silently drops the
  confirmation step.

  **A TENANT DOES NOT GET TO ANSWER IT.** They are the side being let in;
  taking the word off their own request would let them book themselves out of
  their own confirmation step. `POST /api/jobs` drops it for any requester.

  **Nothing is preselected on the form**, because leaving it alone *is* the
  019 rule and a preselected answer would read as the account's choice rather
  than as the default — the preselection-mistaken-for-a-choice lesson the trade
  suggestions already paid for, where the blank is the truth.

  **The column is an EXTRA on the insert, not a base one**, so a database
  without 060 still creates jobs: losing the access answer costs a round trip
  with a tenant that was not needed, and refusing the job costs the repair.
  The same trade `material_supplier` already makes one column along. And
  `missingSchema` matches `access` only in the two shapes SQLite actually
  produces for a missing column, because it is far too ordinary a word to match
  loosely — a broad rule there would claim errors belonging to half the other
  migrations.

  Seven mutations fire, each on its own assertion. And the backtick trap for
  the **eleventh** time, in a SQL comment naming `requested_by`.

  **Still open, and it is the half this deliberately does not ship: a manager
  cannot put a tenant INTO a job the tenant did not report.** The reverse
  direction needs a way to say *which* tenant — a job carries a property, a
  property carries many tenancies, and `memberships.unit` is the only thing
  that narrows it. That is per-unit tenancy on a job, which is a real design
  question rather than an endpoint, and shipping a control that silently books
  anyway would be worse than not having one. The picker says so by not offering
  it.


- **THE SUBCONTRACTOR COULD NEITHER ACCEPT A TIME NOR SAY IT DOES NOT WORK.**
  Reported as *"on this contractor — we need to allow it to be edited and [a]
  new time [proposed] by [the] subcontractor, or the other way: the property
  manager needs to send it to [the] subcontractor and tenant, or just [the]
  subcontractor, to be confirmed."*

  019 built a visit as manager-proposes, **tenant**-confirms, because somebody
  has to be in. The party who physically drives to the address was never asked.
  So a time could be agreed between a manager and a tenant for a morning the
  crew was already on another roof, and the first anybody found out was nobody
  turning up — and the contractor's own card offered **accept or decline the
  work**, so the only thing they could do about a Tuesday that did not suit was
  turn the job down.

  Migration 061, `visits.contractor_at` / `.contractor_note`,
  `app/shared/visitparty.js`.

  **`status` IS THE COMBINED VERDICT AND `visitSettled` IS THE ONLY THING THAT
  WRITES IT.** Proposed while anybody who must agree has not; confirmed once
  everybody who must has. Two expressions of that rule is how the two sides
  both draw *waiting on them* and an appointment stalls for ever — which is
  why `waitingOn` is one function for an agreement, and the same reason here.
  The propose route and the respond route both read it rather than deciding
  for themselves.

  **The "or just the subcontractor" half was already answered by 060, and that
  is why no second switch was added.** Who has to be **in** decides whether the
  tenant is asked at all, so a repair fixed from outside is now a one-party
  appointment with the party being the crew. `visitParties` reads `accessFor`
  and `canAskTenant` rather than restating either.

  **ACCEPTED, not merely assigned.** Somebody who has not said yes to the
  *job* cannot be waited on for the *time*, and counting a pending work order
  as a party would leave every visit stuck behind an offer nobody has opened.
  The discriminating fixture is a company holding an accepted work order on one
  job and a pending one on another.

  **THE DATE LANDS WHEN IT IS SETTLED, not when the tenant alone has been dealt
  with.** The old route wrote `jobs.date` on `!needsTenant`, which answered one
  side; a window the crew has not agreed to is not a booking either, and dating
  it puts a job on a calendar nobody has committed to — the state this whole
  change exists to stop reading as settled. Mutating the condition back to
  `!needsTenant` fails one assertion and nothing else, which is why it has its
  own.

  **AND A JOB WITH NO PARTY AT ALL IS STILL BOOKED OUTRIGHT.** Without that,
  work with nobody to let anybody in and nobody yet assigned would be
  permanently unbookable — the permanently-amber failure `docs.js` exists to
  prevent, on a calendar.

  **PROPOSING IS AGREEING, for whoever proposed it.** A contractor who offers
  Thursday has said they can come on Thursday, and asking them to confirm their
  own suggestion is a round trip that answers nothing — the same rule that
  makes the side who asks for a handover already a party to it. The mutation
  that matters is the other direction: counting *every* proposal as the
  contractor's yes puts the manager's own proposal in their column and books
  the job, which fails nine assertions.

  **A DECLINE FROM EITHER SIDE ENDS IT, and the two notes stay apart.** A time
  one party cannot make is not a time, and carrying on collecting the other
  side's answer would leave a window with a tick against it that nobody is
  attending — the worst of the three states, because it reads as settled. The
  reason is filed as whoever wrote it: *the tenant can't make it* over a
  contractor who turned it down sends somebody to the wrong telephone.

  **`responded_at` AND `tenant_note` STAY THE TENANT'S.** Giving either a
  second meaning would make every row written before today ambiguous about who
  it was that answered. Which uncovered one thing 019 did that had to stop:
  it stamped `responded_at` on a visit **nobody had to confirm**, so the row
  read as answered by a tenant who was never asked. That was harmless while
  the column only ever meant "this is settled" and is exactly the ambiguity the
  two columns exist to remove, so it is left NULL and the verdict comes from
  `visitSettled`.

  **A DATABASE WITHOUT 061 KEEPS THE TWO-PARTY SHAPE IT HAS, and the signal is
  the column's ABSENCE.** `SELECT v.*` returns no key at all rather than null,
  so the respond route can tell. Without that the tenant confirms, the
  contractor is counted as a party who can never answer, and the window sits
  proposed for ever — a repair that stops moving because of a migration nobody
  has run, which is strictly worse than the gap it reports. The insert falls
  back the same way, with a warning: losing the contractor's leg costs a
  confirmation, refusing the insert costs anybody the ability to schedule a
  repair at all. A contractor who does answer there gets
  `migration_needed` by name, never a 500.

  **AND `/api/my-work` NOW DEGRADES RATHER THAN BLANKING.** Its catch answers
  `{work: []}` for any missing column — written for 020's `withdrawn_at` — and
  an empty contractor portal over a roster of nine jobs is *precisely* the
  report this route was last changed to fix. So the two newest columns are
  interpolated into the SELECT and a 060-or-061 miss retries without them: a
  database behind the code loses the access answer and the contractor's own
  tick, never the work itself. Found by reading the catch rather than by a
  failure, which is the only way it could have been found before a deploy.

  **ONE PROPOSE FORM, used from both sides.** `VisitForm` came out of
  `VisitBlock` rather than being copied into the contractor's modal: three
  inputs, a window validation and four refusal sentences are not worth having
  twice, and the half that rots is whichever side is used less often. A test
  counts the mounts, because a bare search for the component finds whichever
  one exists — the `.embed-code-btn` trap.

  **AND 060's COPY WAS ALREADY A LIE BY THE TIME THIS SHIPPED.** *"Booked as
  soon as you set a time. Nobody is asked to confirm"* was true the day it was
  written and stopped being true one change later, because the contractor is
  now asked on every job. Same for `WHEN_KINDS.confirmed`, which said *the
  tenant confirmed this time* on a card where the tenant is often not a party
  at all — it says whether it is **settled** now, and who actually agreed it is
  decided per job. **A sentence naming one of two parties is a sentence that
  goes stale the moment there are two**, and neither was caught by anything but
  reading them.

  **ONE THING 060 SHIPPED THAT NOTHING COULD SEE: the contractor's access line
  was reading the RAW column.** `job.access` off `/api/jobs` is null on nearly
  every job, so the one sentence telling somebody whether anybody will be there
  to open the door rendered for almost nobody — and on the cross-account half
  of the list the field was not carried at all. `myAccess`, beside `myVisits`,
  off the same single source. The general shape, which this file keeps
  recording: **the effective answer and the stored column are two different
  values, and a screen reading the second is a screen answering a different
  question.**

  On the card the answer is **two buttons and a question**, not a bare pair:
  *Can you make this?* over **Confirm this time** and **Propose a different
  time**. Only while the window is open and only on a row at **this** account,
  because answering is an account-scoped write — the same reason accept and
  decline are withheld on a row from elsewhere. Once we have answered there is
  nothing to press and the card says **who is still owed** instead, which by
  construction is the tenant: if the crew were the only party their own yes
  would have settled it.

  Fifteen mutations fire, each on its own assertion, and two are worth naming
  because they are shapes rather than slips. **Wiring Confirm to the modal**
  passes every assertion about the buttons being there and quietly turns
  agreeing a window into re-proposing it, which is a different act with a
  different record — so the suite counts what reached the server and checks no
  form opened. And **dropping the `when.mine` branch** leaves the markup
  perfect and the button dead-ended, which only the drawn card can see.

  **Still open, and unchanged by this: there is no way to withdraw a proposed
  window.** Superseding it by proposing another is the only move, so a manager
  who proposed Tuesday by mistake has to propose something else rather than
  take it back. Same shape as the job that cannot be removed, one object down.


- **A MOVE-OUT NEEDS NO TENANT IN THE SCHEDULING LOOP AND A MOVE-IN DOES, AND
  THE SECOND HALF IS THE CORRECTION THAT MATTERS.** Asked for as *"for
  scheduling jobs for move out or move in, obviously those do not include any
  tenant input"*, then corrected in the same breath: *"move in would need to
  coordinate with a tenant since they are moving in, they will be in the unit
  when the job is done"*.

  So the two kinds answer differently and **neither answer is 019's default**.
  A move-out unit is being handed back, so the agent opens the door and nobody
  waits on a tenant to agree a morning. A move-in unit has somebody moving into
  it, and a time nobody checked with them is a time they are not in for.
  `accessForInspection` in `app/shared/inspection.js` returns an `access` value
  rather than a boolean, so there is still one vocabulary — `ACCESS_KINDS` —
  and the inspection does not grow a second way of saying the same thing.

  **AND IT CLOSES THE HALF 060 RECORDED AS STILL OPEN, in the one place the
  missing fact exists.** That entry's own words: *"a manager cannot put a tenant
  INTO a job the tenant did not report. The reverse direction needs a way to say
  WHICH tenant — a job carries a property, a property carries many tenancies,
  and `memberships.unit` is the only thing that narrows it."* **An inspection
  carries a unit.** Migration 062, `jobs.access_user_id`, and the raise route
  resolves the tenant seat from the unit it walked.

  Matched case-insensitively on trimmed text, because a unit is "3B" in one
  building and "Apt 12" in the next and a managing agent types what is on the
  door — the stored seat in the fixture is `' 3b '` for that reason. Only when
  the inspection **has** a unit: a whole-building walk has no one tenant, and
  taking the first tenant on the property would name somebody at random. **The
  fixture is what makes that checkable** — two tenants in two units on one
  building, with the WRONG one inserted first, so matching the building rather
  than the unit answers `u_t4a` and the mutation fires. Without that ordering
  both rules give the same id and the assertion cannot tell them apart.

  **IT IS DELIBERATELY NOT `requested_by`, and that is the whole shape.** That
  column means *who asked for this work*: it is what the manager's Work requests
  panel reads and what the feed names. Writing a tenant into it to make them
  answerable would put a sentence on a dashboard saying they asked for something
  they never asked for, and invite somebody to approve or decline a job their own
  account raised. Two facts, two columns — and `accessTenant` in
  `shared/access.js` is the one predicate that reads both, so `canAskTenant`,
  `notifyTenant`, `partiesFor` and the respond route cannot disagree about who
  may answer. Before it, the respond route compared against `requested_by` and a
  job raised from an inspection has none, so **every answer was a 403**.

  **THE COMMON MOVE-IN HAS NOBODY TO ASK, and the screen says so.** The
  inspection schema already says it in its own words — *"the person moving IN
  very often has no seat yet"* — so the ordinary case stores `access = 'tenant'`,
  because they genuinely do have to be in, and names nobody. 060's rule then
  books the window outright: whether to ask is the override, whether there is
  anybody to ask is still a fact. A screen that drew *the tenant needs to be in*
  and said nothing about that would promise a confirmation step that is never
  going to happen, so the visit block names it and points at Account → Tenants.
  **Still open, and honestly a dead end wearing instructions:** there is no
  control there to add them from, because an inspection carries a tenant's NAME
  and no address, and an invite needs one.

  **AND THE WORK ORDER FINALLY CARRIES THE PHOTOGRAPHS.** Asked for as *"in the
  work orders when they are passed over to subcontractors the images should be
  passed along in the full report so they can visually see what they are fixing
  prior"*. 055 has composed the WORDS into the job since it shipped — a bulleted
  line per flagged room in `jobs.scope` — and a paragraph about a cracked basin
  is not a photograph of it. The one reader who needs the picture is the person
  who prices the work, loads a van and then stands in the room, and they were
  **the one reader who could not reach it**: every inspection route is
  `INSPECTION_READ_ROLES`, so a contractor asking for the photo got a 403 about a
  job they hold the work order on. Twelfth time this file records a correct piece
  with no way in for the party it is about.

  **KEYED BY THE WORK ORDER, NEVER THE INSPECTION**, which is what makes it safe
  rather than a second door into the Inspections tab: there is no route that
  takes an inspection id and describes it, so nothing can be walked. A company
  holding no live work order on that job gets `not_found`, never `forbidden` —
  the same refusal the quote request uses to be a key to one job rather than to
  the list. A **voided** work order is not a key either: reissuing voids the old
  row, and somebody taken off the job keeps no view of the unit they were going
  to walk into.

  **FLAGGED ROOMS, THE KEPT CAPTIONS, AND NEITHER THE DRAFTS NOR WHO WAS
  MOVING.** `contractorInspectionShape` is the redaction, named once. Flagged
  only, which is the same line `inspectionJobScope` draws and for the same
  reason — an inspection is a record of the whole unit and a job is a list of
  things to do, so handing over the rooms that were fine would turn a work order
  into a document to read. `drafts: false`, the rule this file already applies to
  an owner's copy: a sentence a model wrote and nobody kept is the team's working
  note and would read here as a finding somebody made. And `tenant_name` is
  absent, because who was moving out is not a contractor's business.

  **A TENANT IS ON THE ACCOUNT TOO, which is why the route is not scoped by
  account id alone.** An inspection is explicitly not shown to the tenant it is
  about — a recorded product decision about what a deposit conversation looks
  like — and a route reading only `j.account_id = ?` would have undone it by a
  different door. **The two guards cover for each other and mutation is what
  showed it:** deleting the role gate changed no outcome, because `TENANT_ALLOWED`
  refuses any path it does not list. That direction is deliberate — the
  allowlist's own comment says a new route should fail closed — so the role gate
  is pinned **statically** as well, exactly as 056 pins the allowlist's methods.
  The first version of that static check read only as far as the first comma, so
  every role after `"admin"` went unchecked: this suite's own could-not-fail
  shape, on the assertion about the one role that must not be there.

  **The panel is driven in a browser, and the first run did not render at all.**
  A static check that `JobInspection` is mounted passes over a modal that throws,
  and `WorkOrderProgress` reads `plan.milestones.filter(...)` unguarded — so the
  stub's default empty array threw inside the modal, which left **no modal** and
  read exactly like a button that does nothing. The fixture lesson this file
  already records about a missing `accountId`, paid again. Worse, **the harness's
  own `crashes` stayed empty through it**, so *nothing crashed* passed loudest
  exactly when the subject had disappeared; the suite reads the page's console as
  well now, filtering the deliberate 404 that is itself under test.

  Six browser mutations and fifteen server ones fire, and two of each needed the
  assertion rewritten first. **Tapping the FIRST photograph cannot tell a
  computed index from a hard-coded zero**, so the suite taps the second room's
  and requires *2 of 2* — the lightbox holds the whole unit, because a set of
  photographs is one piece of evidence read in order.

  **One guard is deliberately unasserted and the suite says so.** `partiesFor`
  looks the seat role up by `accessTenant` rather than by `requested_by`, and
  mutating that back changes no outcome today: the lookup only decides anything
  on a job with a NULL access answer, and nothing writes `access_user_id` on one
  of those. Pinning it would need a row the product never produces, which is a
  test of its own fixture.

  **`/api/my-work` also stopped blanking.** Its catch answers `{work: []}` for
  any missing column — written for 020's `withdrawn_at` — and an empty contractor
  portal over a roster of nine jobs is *precisely* the report that route was last
  changed to fix. The newest columns are interpolated into the SELECT and a
  060-or-061 miss retries without them, so a database behind the code loses the
  access answer and the contractor's own tick, never the work itself.


- **THE CONTRACTOR'S SCHEDULE ON ITS OWN PAGE, AND THE DOT ANSWERS THEIR
  QUESTION RATHER THAN THE ACCOUNT'S.** Asked for as *"need to allow the
  calendar to be expanded to its own page so easier to visualize for the actual
  person [doing the] job"*.

  `MySchedule` on their dashboard answers *what is next and what is after it* in
  a panel that shares a row with something else, so it is the next appointment,
  four more and a fortnight strip. A month is the thing somebody looks at to
  decide whether they can take Thursday, and fourteen days cannot show it.

  **IT REUSES `.jcal`, WHICH IS A DECISION ABOUT THE STYLESHEET AND NOT A
  SHORTCUT.** The hiring side's month grid and this one are the same geometry —
  seven columns, a padded first week, a day panel underneath — and two copies of
  that is two things to keep in step the next time a cell changes size. What
  differs is what a dot MEANS, which is the whole reason it is not the same
  component: `JobCalendar` colours a day by how many trades are filled, and a
  contractor holds one trade on one job, so that answer is always 1/1. Theirs is
  the opposite question — **is the time agreed** — so the three classes that
  stylesheet already defines are pointed at a different fact: agreed, waiting on
  a yes, been and gone. The key says so in those words, and a test fails if it
  goes back to naming trades.

  **IT OPENS WHERE THE WORK IS, and the two halves of that rule each needed
  their own fixture.** `aim` moves only when today's month is empty, and only
  forward — the conservatism the hiring grid already records. **Both branches
  passed vacuously at first and mutation caught each one.** With work in today's
  month, *stay put* and *open on today* give the same answer; with the nearest
  future job in today's month, *stay put* and *always follow the work* give the
  same answer. So the suite drives three fixtures: work in this month, work only
  two months out, and — the one that discriminates the second pair — **work in
  this month that is entirely in the past** with the next appointment two months
  out. That day is computed and floored at the 1st, and on the 1st of a month it
  cannot exist, so the suite **says so out loud** rather than reporting a green
  that means nothing.

  **The day panel shows the WINDOW, through `visitWhen`.** One formatter, the
  same one the tenant's screen and the contractor's card use, because two of
  these is how the parties to one appointment come to read it differently. It
  leads with the date and the panel's own heading already carries that, so the
  day part is stripped at the separator rather than rebuilt — and the first
  version passed it `start_time`, the Worker's spelling, which **silently
  dropped the whole window and left the date**. A row that reads as having no
  time on it, on the one screen whose subject is when.

  **Fed `accepted`, not `upcoming`**, which is the one place it deliberately
  differs from the dashboard panel: a calendar is also what you look back at —
  *was I there on the Tuesday* is the question a dispute asks — while the panel
  is only about what is coming.

  **And the panel routes to it.** A panel that names the next job has to route
  somewhere that can show it; that is the exact lie the hiring side's *Open the
  calendar* told when it landed on an empty month. One `onGoPane`, so the nav
  entry and every in-page pointer land on the same screen.

  **And the backtick trap, for the TWELFTH time, two rules below a comment
  saying not to.** The new CSS block's own comment named `.jcal` in backticks,
  which closed the stylesheet's template literal — the whole app rendered
  nothing behind one `.jcal is not a function`, and the suite reported sixteen
  failures that were all one parse error. The guard that catches it is reading
  the failure for what it is: a helper name in an error message that should
  never have been a function.


- **THE CHIP UNDER SOMEBODY'S OWN NAME WAS A CONSTANT, AND IT WAS WRONG TWICE
  OVER.** Reported as *"I updated pacific to handyman, but it's still showing
  contractor on [the] profile drop down"*, with the drawer header circled:
  **Juan Soto / Contractor**.

  `roleLabel` read `ROLES.contractor.label` flat — no account kind, no
  engagement — so it was wrong in **two** directions at once, and only one of
  them was reported. A handyman read *Contractor*, which is what was noticed.
  And a general contractor's roofer also read *Contractor*, on an account whose
  own roster, nav and Add menu all say **Subcontractor**, because `hiresLabel`
  has decided that noun everywhere else since it was written. One screen in the
  product telling somebody they are a thing the rest of the product does not
  call them.

  `engagedSeatLabel` **composes rather than replaces**: the hiring word is
  whatever `rosterWords` already decided for that account kind, narrowed when
  the engagement says handyman. The hiring word is passed in rather than
  imported, so `engaged.js` does not take a dependency on `hires.js` to say one
  word.

  **THE ROLE ID IS UNTOUCHED**, which is the distinction this file already
  records and a later pass must not collapse: `contractor` stays the seat
  role — a person signing in to the portal rather than a company on a roster —
  and the staff console goes on describing SubSub's own data model. What
  changed is the word shown to that person about their seat **here**.

  **It had to MOVE to be able to read the answer.** A contractor seat's word is
  not a constant: it is what the account that engaged them calls them, which
  needs the engagement row, and `allSubs` is declared two hundred lines below
  where `roleLabel` was. The whole expression moved rather than the value being
  plumbed up to it — every use of it is in JSX, so nothing in between reads it.

  **Still as it was, and deliberately: the account switcher's rows.** Those are
  seats in OTHER accounts, and this browser holds no engagement for them — only
  `seatDescription`, which already takes the hirer's kind. Making those follow
  the engagement would mean carrying every other account's roster row for a
  label.

- **AND THE SCHEDULE MOVED ABOVE THE FOUR NUMBERS, for the second time in this
  file and the same reason.** *"Put the scheduled jobs box on top of
  [the] dashboard"*. It sat under job requests, upcoming, crews and booked
  value — a summary of a book — while the one thing on that page that is a
  **commitment to be somewhere** was below them. That is the same shape as the
  manager's work requests panel, which was under five KPI tiles for the same
  reason and moved for the same reason.

  Measured in the suite rather than read off the source, because **source order
  is not screen order** and a static check that the JSX moved passes whether or
  not the panel lands anywhere near the top.

  **And both engagement branches are asserted in the same place.** On a property
  manager the roster word is *Contractor*, which is also exactly what the broken
  constant said — so a fixture driving only the handyman case cannot tell the
  fix from the bug it replaced, and one driving only the subcontractor case
  cannot see the fix at all. The suite flips the engagement and reloads.


- **AND WHO HAS TO BE THERE IS A SUGGESTION, NOT A RULE — which is the second
  correction in two messages and the one the function name now carries.** *"A
  move in doesn't necessarily need a tenant in the unit, only if required."*

  The first pass had the inspection kind **decide**: move-out booked outright,
  move-in waited on the tenant. That is wrong about the commonest move-in there
  is — a unit being turned round between tenancies is usually empty on the day
  the work is done, and the person moving in has not moved in yet. Forcing a
  confirmation step onto every one of them is the product deciding something
  the manager is standing in the flat to decide.

  So `suggestedAccessForInspection` pre-answers it and the **Raise a job** form
  settles it, the same shape as the trade chips directly above it: the
  suggestion is named, says which walk produced it, and every other answer is
  one tap away. `POST /api/inspections/:id/job` takes `access` from the body
  and falls back to the suggestion, **validated against `ACCESS_KINDS`** so a
  word the picker never offered cannot reach the column the CHECK.sql invariant
  counts one table along.

  **Both directions are asserted in the same place**, because a move-in told
  *we let them in* and a move-out told *the tenant needs to be in* are the two
  halves, and pinning one passes with the body ignored for whichever kind
  already agreed with it.

  **Two shipped bugs, both from a second control wearing the first one's
  name, and both caught by a suite that was already there.** The picker started
  in a `.chips` container, which is how `test:inspectionui` finds the trade
  grid — so *We let them in* appeared in the list of trades it had ticked. And
  its suggestion line wore `.insp-sugg`, which is how the same suite asks
  whether the trades claimed a reading they did not do — so that assertion
  failed on a screen where the trades genuinely suggested nothing. The
  `.embed-code-btn` trap, twice in one change, from the markup side rather than
  the test side.

- **DIRECTIONS, ON THE ADDRESS THEY ARE ABOUT.** Asked for by the people who
  actually drive to these: *"on the job address when [the] modal is open… add a
  call to action link that will open directions from current location on Google
  Maps"*. An address on a work order is a string somebody retypes into a phone
  at the kerb, and retyping is where a digit goes missing.

  `/maps/dir/?api=1&destination=…` is Google's documented universal form, and
  why it is that one rather than a coordinate or a place id: no key, it opens
  the Maps **app** on iOS and Android where one is installed and the web map
  where not, and **the origin is deliberately omitted** — omitted means *from
  where you are*, which is the whole request. Naming an origin we had guessed
  at would route somebody from the office, and a test asserts the parameter is
  absent rather than merely that the URL is Google's.

  **It answers null rather than a link to nowhere.** `jobs.address` is nullable
  — an API-ingested job, or one raised against a property that has none — and a
  Directions button that opens an empty map is worse than no button, which is
  the screen-that-lies rule pointed at a kerb. **Only a fixture job with no
  address at all can see that guard**, and the first version of the suite had
  one on every row, so the mutation removing it survived.

  **Shown to every seat that can open the document**, not only the company
  holding it. The request named handymen and subcontractors; a manager visiting
  the site drives to the same address, and gating a link to a public map by
  role would be a screen inventing a rule the thing behind it does not have.

  `target="_blank"` with `rel="noopener noreferrer"`, because this leaves the
  app and the page it opens must not get a handle on ours.

  **And the backtick trap for the THIRTEENTH time, two days after the
  twelfth.** A CSS comment explaining which class carries the chip look named
  it in backticks, closed the stylesheet's template literal, and took the whole
  app down — reported by an existing suite as *"Inspections is in the nav —
  []"*, which reads as a missing feature rather than a parse error. The tell is
  that shape: a whole screen's worth of assertions failing at once, with the
  first one being something that has worked for months.

- **A LIST OF ELEVEN ROOMS CANNOT SAY WHAT THE JOB IS, so the comments are
  combined once at the top.** Asked for as *"A work order should also carry a
  summary of all of the comments from the follow up or flagged item to give as
  a summary for the subcontractor. Combine the comments and summarize
  automatically."*

  062 already carries the flagged rooms, their notes and their photographs to
  whoever drives to the job, which is the record. What a list cannot say about
  itself is the thing somebody pricing it wants first: that eleven lines about
  scuffing are one repaint across four rooms plus a tap. Migration 063,
  `app/shared/inspectsummary.js`.

  **A SUMMARY IS NOT THE RECORD**, which is the same line 057 draws between a
  caption and a draft and the reason this is its own table rather than a column
  on `inspections`. The rooms stay underneath in full and stay the thing a
  deposit argument is run from; deleting every row in `inspection_summaries`
  would lose nothing but convenience. On the screen it says it was *put
  together automatically* for the same reason an unkept photo draft is drawn
  dashed: the reader is about to put a price on this, and a paragraph read as
  the hiring account's own instruction is a paragraph they will quote back.

  **IT IS A SUMMARY OF WHAT THE CONTRACTOR CAN ALREADY READ, which is the
  design rather than a convenience.** `summarySource` is built *through*
  `contractorInspectionShape` — the redaction the work order already applies —
  so the model is handed flagged rooms only, the captions somebody kept and
  never the model's own unkept drafts, and no tenant name. Two things follow: a
  summary cannot contain anything its reader is not also shown, and a field
  added to that shape later cannot leak through a second path that forgot about
  it. The discriminating fixture is a photograph carrying a **draft and no
  caption** — the only row either behaviour can be told apart on — plus a room
  that was **fine with a note on it**, and both are asserted on the request
  that actually goes out.

  **IT RUNS AT RAISE TIME AND NEVER BLOCKS THE RAISE.** The obvious
  alternative is the contractor's first read, and it is wrong three ways: it
  spends the account's money on a press they did not make, it fails at the one
  moment the person needs it with nothing written to fall back on, and three
  companies on one job pay for three answers to one question. So raising the
  job is the press — there is no button for the ordinary case, which is what
  *automatically* means. **The catch around it is deliberately wide**, which
  this file normally refuses: by the time it runs the job exists and the
  inspection points at it, so a throw would answer 500 to a raise that already
  happened, and a screen reporting failure over work that is on the Jobs
  screen is strictly worse than a work order with no paragraph on it. The reply
  carries `summaryError` by name rather than a bare null, for the reason
  `engagedAsRecorded` does: a screen that cannot tell *there was nothing to
  summarise* from *the call failed* cannot offer the one of those worth a
  second press.

  **NOTHING TO COMBINE IS A REFUSAL, NOT A PROMPT.** A model handed *Bathroom 1
  — Fail, Kitchen — Follow-up* will write a confident sentence about what is
  wrong with them, and an invented fault on a document somebody is about to
  quote reads exactly like a real one — the `unclear` rule from the photo
  drafts arriving from the other direction. `no_comments` answers 409 with no
  call made at all, and the fixture for it is a **real flagged room with no
  note and no caption** rather than a hand-made argument object.

  **STALENESS IS A COMPARISON, WHICH IS WHY `source` IS STORED VERBATIM.** A
  job can be raised from an **unfinished** inspection — deliberately, because
  the leak does not wait for the paperwork — so the notes can move on and a
  paragraph from the old ones would read as current. Same rule `agreements`
  follows by hashing what the signer was shown rather than re-rendering later;
  stored rather than hashed because it is a kilobyte either way and a hash
  cannot be read back by anybody wondering what the model was actually given.
  A stale summary is **said, never quietly rewritten**: re-asking on every read
  would spend money on a press nobody made and change a document somebody may
  already have quoted from, so the panel says it is behind and the rooms under
  it are always live. `source` itself never travels to anybody — it is the
  notes, which the same reader has in full underneath.

  **FINISHED IS DELIBERATELY NOT A GATE, and that is the opposite answer to
  `whyNotDraft` beside it.** Drafting writes to the inspection, which is a
  document somebody quotes back, so finishing shuts it. This writes a derived
  paragraph in its own table and touches nothing in the record — and the moment
  it is most wanted is after the job has been raised, which is very often after
  finishing. Gating it would leave a finished inspection whose automatic
  summary failed with no way ever to get one.

  **THE MODEL IS THE DRAFTS' MODEL, with no second constant.** How you turn
  thinking off is validated as a **combination** with the model rather than as
  a field of its own, which is the whole lesson `DRAFT_THINKING` records — so a
  second model constant here would be a second place for that pairing to be got
  wrong, and the one that was wrong would be the one nobody pressed this week.
  A test pins that the two are the same id and that `knowsThinking` has heard
  of it.

  **THE OWNER'S COPY DOES NOT CARRY IT.** The report is what a deposit argument
  is run from, and a model's paragraph in it would read as a finding somebody
  made. The manager sees it because they are answerable for what their work
  order says — and `aiDrafts` is read for both buttons, because it means *SubSub
  has a model key*, which is one fact.

  **AND THE INVARIANT IS RUN AGAINST A REAL ROW**, which is the lesson 057 paid
  for: every invariant reads zero on an empty database, so one that is subtly
  wrong passes for ever. `m063_inv_summary_empty` counts a row that says
  nothing or cannot say what it summarised — the first draws a blank box over
  the list of rooms, and a blank there reads as *nothing much wrong*; the second
  makes the paragraph unfalsifiable, since staleness is a comparison against it.
  Seeded both ways. And the column check counts **five named columns** rather
  than the table name, which is what the broken 052 cost once already.

  One paste, no `ALTER TABLE`, for the reason 048 and 057 both chose a table:
  four `ADD COLUMN`s is four pastes and an operator who has to get the order
  right.


- **FIVE DEPLOYS IN A ROW FAILED ON LINT AND NOBODY NOTICED, WHICH IS WORSE
  THAN THE BUG THEY WERE STOPPING.** Reported as a white screen on a job:
  *"Can't find variable: canManage"*, with the way back out a broken Cloudflare
  page.

  The line is `canSetAccess={mayChooseAccess(kindOf(account)) && canManage}`.
  **`canManage` is a PROP NAME on six components in `App.tsx` and is not a
  variable in the scope that line sits in** — so opening an approved,
  tenant-requested job threw on render and took the Jobs view with it. Reading
  it back it looks exactly right, which is the whole trouble: the name is real,
  it is spelt correctly, and it means something three hundred lines away.

  **THE GUARD ALREADY EXISTED AND ALREADY CAUGHT IT.** `eslint.config.mjs`
  turns on `no-undef` for precisely this, and its own comment records the last
  time this class shipped — `needsEmail`, `email` and `setEmail` read by the
  tenant sign-up page and never declared, every tenant following their invite
  getting a blank screen. `npm run lint` names this one in a second, and all
  three deploy workflows run it before they build.

  So the deploy **refused, correctly, five times**: 989cf5d, 41072bf, ab3f657,
  040cf45 and 61a6fc5 all went red at the Lint step and nothing was published.
  The customer app and the console both stayed on 4c544c6 all day. Which means
  a day of work was not live, the person using it was looking at an older
  build, and **nothing anywhere said so** — a red tick in a tab nobody opens is
  not a report. Every commit message said what shipped; none of it had.

  **The general form, and it is new here: a guard that runs where nobody is
  looking is a guard that reports to nobody.** The lesson this project keeps
  writing down is about assertions that cannot fail. This is its opposite — an
  assertion that fired every time, correctly, into silence.

  So the rule is in `## Working here`: **run `npm run lint` before any commit
  that touches `app/src`, `app/shared` or `app/worker`**, because the deploy
  runs it and a failure there is not a failed test, it is a release that did
  not happen. And when work is pushed, **check the run went green** rather than
  assuming the push was the end of it.

  `maySetAccess` in `app/shared/access.js` is the fix, and where it lives is
  the point. It is `requireRole("admin", "pm")` on `PATCH /api/jobs/:id`, so it
  is those two and no more — named beside `mayChooseAccess`, which already
  answers the account-kind half, because the two together are one question and
  a role list written at a call site is a role list that drifts from its route.
  **The capability vocabulary is deliberately not used**: `can("jobs")`
  includes an OWNER, who is a guest on somebody else's account and whom that
  route refuses, so gating on it would have been looser than the server rather
  than merely undefined.


- **A JOB PAST ITS DATE COULD NOT BE GIVEN A NEW ONE, BECAUSE THE WHOLE
  SCHEDULING BLOCK WAS GATED ON SOMEBODY ELSE HAVING ASKED FOR IT.** Reported
  with the dashboard's own warning in a red box — *"1 job is past its date —
  Press Apartments — leaking sink"* — and *"rescheduling this past appointment
  is still an issue, can't edit it… need to be able to simply open and edit
  this and have it resend out to contractor or handyman to be approved and
  scheduled."*

  **EVERY PIECE OF WHAT WAS ASKED FOR ALREADY EXISTED.** 061 made proposing a
  time supersede the live window and made the contractor a party who has to
  confirm, so a new time already goes back out for approval rather than being
  imposed. What was missing was the way in: the block read
  `{j.requestedBy && j.approvedAt && !isClosed(j) && …}`, so it drew only on a
  job a **tenant or an owner** had requested. A job the account raised itself
  — which is most of them, and every job that arrives from an inspection, the
  API or a CRM — had no way to set a date, no way to move one, and nothing on
  the card saying when anybody was coming. Fourteenth time this file has
  recorded correct pieces with no way in, and the first on the product's own
  central act.

  `approvedAt` stays, and that is the half of the gate that was doing real
  work: an unapproved **request** is not a job yet, and scheduling one would
  book work nobody has agreed to do.

  **AND IT NAMED THE WRONG PERSON, which 062 had already made possible.**
  `who` was `users.find((u) => u.id === j.requestedBy)`, and a job raised from
  an inspection has no requester at all — the tenant of the unit is on
  `accessUserId`. So the one screen that says who has to be let in named
  nobody and fell back to the words "the tenant". It reads `accessTenant`
  now, which is the same predicate the route uses to decide who may answer.

  **"Note for the tenant" ON A JOB WITH NO TENANT IN THE LOOP.** `forWhom` was
  the tenant's name whatever the parties were, so the one field that carries a
  gate code, a dog or which entrance was addressed to somebody who was never
  going to read it. It is `partyText(parties)` now — every party rather than
  the ones still owed an answer, because a note about getting in is for
  whoever attends.

  **BOTH BRANCHES ARE DRIVEN IN THE SAME PLACE**, because a fix that drew the
  block on every job and a fix that drew it on none both pass a suite written
  against one of them — the diagonal coverage that left `hiresLabel`
  half-wired. `test:resched` carries four jobs that cannot be told apart on
  each other: one the account raised, one a tenant requested, one raised from
  an inspection (no requester, a named tenant), and one unapproved request.

  One harness trap worth keeping, and it is this project's own: **`.jr-card` is
  the CONTRACTOR's request card and `.job-card` is the manager's.** The first
  version matched the wrong one, found nothing, and reported the feature as
  missing on a screen that had rendered perfectly — the whichever-one-exists
  trap, from the selector side rather than the markup side.


- **THE PERSON WHO SIGNED UP AS A SUBCONTRACTOR COULD NOT SEE THE WORK THEY
  HAD BEEN GIVEN.** Reported as *"on the contractor admin / Sound Property
  Management My Jobs is not visible… Redirects to dashboard instead"*.

  `can("portal")` is the `contractor` seat role and nothing else — a seat
  somebody **else** invited onto **their** account. `ROLES.admin` does not have
  it and neither does `ROLES.pm`. So the admin of a subcontractor account — the
  person who owns the business the whole kind exists for — had no My Jobs, no
  My calendar and no portal at all. Fifteenth instance of a rule already
  written down here, and the file says it in so many words: **anything 031 made
  true of an account-as-company has to have a home outside the contractor
  portal, because the seat that runs an account never has one.** The connect
  badge was this exact bug one nav entry along.

  **THE SERVER WAS ALREADY RIGHT, WHICH IS WHY NOTHING SERVER-SIDE COULD HAVE
  CAUGHT IT.** `seatCompany` has answered the account's own company for an
  admin or a pm since it was written, so `/api/my-work` has been returning
  their work the whole time and the browser has been fetching it on every
  login. The rows arrived and nothing drew them.

  **`ownSub` IS A SEPARATE VALUE AND NOT A WIDER `mySub`, and that is the part
  worth keeping.** `mySub` drives a dozen writes through
  `patchSub(mySub.id, …)` — notification preferences, the mailing address,
  crews, coverage — and those go to `PATCH /api/subs/:companyId`, which is the
  wrong route for an account's own row (`PATCH /api/my-company` is). Widening
  `mySub` would have pointed every one of them at a route the server refuses,
  silently, from screens that look identical to the ones that work.

  **AND THERE IS NO ENGAGEMENT, so the half that needs one is absent rather
  than invented.** A roster row is a company **and** an engagement; your own
  company has nobody on the other side of it. `ownAccount` is what says so.
  The sharpest consequence: `missingDocs` reads `docVerified`, which is a
  *hiring account's* verdict — on your own row it answers false for ever, so
  the nav would carry a red four over four documents already uploaded. Nobody
  verifies their own paperwork, so the count is **presence**, which is the same
  rule the compliance-pack badge already follows.

  **Two of the entries, not the portal.** Compliance pack is already a tab in
  Account for a hireable kind and two names for one object is how somebody
  concludes there are two of them; My Crews and Job Settings are
  engagement-shaped; Connect is on the dashboard, where it was moved for
  exactly this reason.

  **AND IT UNCOVERED A WORDING BUG THAT WAS ALREADY THERE.** The who-bar's
  one-client line read `brand.name` — the account you are standing in. That is
  right for a contractor seat whose work is on that account and wrong the
  moment it is not, which for a subcontractor account's own team is *always*:
  it said **"Working for Pacific apartment maintenance"** to Pacific. It names
  the client off the work now, and the same was already true of a contractor
  seat at one account holding work only at another.

  **The temporal dead zone is a blank screen that `no-undef` cannot see, and
  it cost a round here.** `ownSub` was first written beside `mySub`, seven
  hundred lines above the `myCompany` state it reads — a `const` is in the TDZ
  until its declaration, so the page threw `Cannot access 'jt' before
  initialization` and rendered nothing. Lint was green throughout. The browser
  suite caught it, and only because it reads **the page's own console**: the
  harness's crash list stayed empty, so *"and the harness saw no crash"* passed
  loudest at the moment the subject had disappeared.

  **`no-use-before-define` is the rule that would catch the class, and turning
  it on is its own piece of work rather than something to ride along with a
  bug fix.** It reports 73 pre-existing sites, nearly all safe — a name
  referenced inside a callback that runs long after initialisation is fine, and
  ESLint cannot tell that from one evaluated during it. Setting it to `warn`
  was refused: that is a guard reporting to nobody, which is the failure this
  file has just finished recording about five red deploys. **Still open**, with
  the 73 to audit.


- **SCHEDULING IS A CHAIN, NOT A BROADCAST: THE CREW FIRST AND THE TENANT
  LAST.** Asked for as the order it should actually happen in — *"the job's
  date is what [the] hiring party starts with, sends it to
  contractor/handyman, contractor/handyman either confirms or rejects and
  proposes new day/time, hiring party agrees, scheduled job date/time is then
  sent to tenant saying this is when the contractor will be there to fix your
  sink, confirm this works for you, if not propose another time"* — with the
  question *"tell me if this is the most efficient and optimized way of doing
  this"*. It is, and 061 was wrong.

  **061 ASKED EVERYBODY AT ONCE**, which treats the contractor and the tenant
  as symmetric. They are not. The contractor has a diary full of other jobs
  and is the **constraint**; the tenant is one person who may book a morning
  off work to be in. Asking the tenant to confirm a window the crew has not
  committed to risks asking them twice — and the second ask is the expensive
  one, because by then they have arranged to be home for a time that has just
  evaporated. Parallel saves a round trip and spends it on the party least
  able to absorb a wasted one.

  Migration 064, `visits.manager_at`, `PARTY_ORDER` and `nextToAnswer` in
  `app/shared/visitparty.js`.

  **THE HIRING SIDE ONLY COSTS A HOP WHEN THE TIME MOVES**, which is the one
  refinement to the sequence as asked and it falls out of a rule already here:
  *proposing is agreeing, for whoever proposed it.* A crew that accepts the
  date costs the account nothing — they agreed by setting it, and the window
  goes straight to the tenant. A crew that puts forward a **different** time is
  proposing a slot the account did not choose and may not be able to let anybody
  in for, so they answer. Best case stays two hops.

  **`waitingOn` AND `nextToAnswer` ARE DIFFERENT QUESTIONS, and that difference
  is the whole feature.** The first is everybody who has not answered; the
  second is the one who may answer **now**. A tenant is outstanding from the
  moment a window is proposed and must not be *asked* until the chain reaches
  them.

  **REFUSED ON THE SERVER, NOT MERELY NOT OFFERED.** `not_your_turn`, because a
  screen is a convenience and this is the rule. **A decline is exempt**: *I
  cannot make this* is true whenever it is said, and holding it until somebody's
  turn would collect agreement to a window that is already dead.

  **AND A SIDE WHOSE COLUMN IS NOT THERE IS TOLD WHICH MIGRATION**, rather than
  that it is not their turn. Both are refusals and only one is actionable — the
  first sends somebody to wait for a hand-off that can never come.

  **`turn` IS WORKED OUT ON THE SERVER AND PUT ON THE ROW.** The tenant's screen
  holds no work orders, so it cannot know whether the crew has agreed; a screen
  deriving it would be a second opinion about whose answer is outstanding, which
  is what this module exists to stop. Memoised per JOB rather than per visit,
  because parties are a fact about the job.

  **ONE FIELD NAME, ONE SHAPE.** The refusal first carried the party under
  `waitingOn`, which is an **array** everywhere else on those routes — callers
  parsing it as a list threw on `.join`, which two existing suites duly did. It
  is `turn`.

  **AND 062 LEFT A GAP THE CHAIN MADE MATTER.** `/api/visits` filtered a
  tenant's own list on `j.requested_by`, so a tenant named on `access_user_id` —
  every job raised from a move-in inspection — could not see the appointment
  they are now asked to confirm **last**. The route that decides who may ANSWER
  has read both since 062; the one that decides what they can SEE still read the
  requester. Guarded on the column, because naming it on a database without 062
  would answer `migration_needed` to every tenant rather than losing one row
  shape.

  **NO CHECK.sql INVARIANT, and the reason is recorded rather than left to be
  wondered about.** The obvious one — a confirmed visit with no hiring-side
  agreement — reads **non-zero on every live database**, because every row
  written before 064 settled under the 061 rule and legitimately has none. An
  invariant that ships knowing it reads non-zero is a bug report nobody can
  action. Scoping it to "rows that had a contractor leg" catches exactly the
  061-era rows it must not.

  **The suites were updated to the new rule rather than loosened**, which is the
  distinction that matters: *a test can pin the old answer as firmly as the
  right one.* `test:visitparty` went from 65 to 83 and now walks the chain end
  to end, including the counter — crew proposes, hiring side agrees, tenant
  closes — and the superseded first window.


- **A TURNAROUND SCHEDULES ITSELF, AND THE ONE THING IT WILL NOT DO IS BOOK
  SOMEBODY ELSE'S CALENDAR.** Asked for as a setting: *"upon approval by them
  of the move-in, move-out job (these jobs only) it will auto schedule and
  assign the job to the most optimized qualified tradesman and the best
  possible time and then automate back and forth with tenant and tradesman
  until it's booked."* Migration 065, `app/shared/autopick.js`.

  **A TURNAROUND IS THE ONE KIND OF JOB WHERE THIS IS SAFE**, and that is why
  the request named it rather than jobs in general. A unit between tenancies is
  **empty**, the scope came off a walk somebody already did, and the date is
  driven by the next tenancy. None of that holds for a repair, which is
  somebody's home with somebody in it and a date that follows how bad the leak
  is.

  **IT CALLS THE REAL ROUTES RATHER THAN REIMPLEMENTING THEM**, which is the
  decision everything else hangs off. Assigning carries about a dozen gates —
  roster status, the handyman trade list, documents, cover on the job date, the
  value ceiling, a closed job — and an automatic path with its own copy would
  be a second set of rules to keep in step, with the one that drifted being the
  one nobody watches because nobody is standing in front of it. So the machine
  does what a person does: it POSTs to `/api/jobs/:id/assign` and
  `/api/jobs/:id/visits` with the manager's own headers. The mutation that
  proves it deletes the roster filter from the candidate query — and the
  fixture's paused company is rated top, has nothing on and is **named to sort
  first**, so the only thing keeping it out is the roster. Without that naming
  the mutation survived: the fixture was covering for the guard.

  **AND IT DOES NOT HAND THE HIRING SIDE WHAT `autoschedule.js` REFUSES THEM.**
  That module explains at length why the side paying cannot switch on
  auto-schedule for the side doing the work: it writes the job to their
  calendar as accepted, with nothing to press. So this setting turns on the
  **choosing** and the **asking**. Where a crew has granted auto-schedule the
  work order is accepted on issue and the window goes out at once; where they
  have not it is an offer, and the chain runs itself from there. Either way the
  manager does nothing, which is the request.

  **THE WINDOW WAITS UNTIL THE CREW HAS TAKEN THE JOB, and getting that wrong
  nearly shipped.** The first version assigned and proposed in the same breath.
  A work order sits **pending** until it is accepted, and `visitParties` counts
  a contractor only once they have — deliberately, because somebody who has not
  said yes to the JOB cannot be waited on for the TIME. So the window settled on
  the hiring side alone: **confirmed, with the crew never asked**, which is the
  exact state 061 and 064 exist to stop. The suite caught it, and the mutation
  that reproduces it reads `["2026-10-06:confirmed"]`. Accepting the work order
  is what starts the clock.

  **THE RANKING IS EXPLAINABLE AND DETERMINISTIC, in that order of priority.**
  Soonest free day, because "the best possible time" is the request and an empty
  unit costs money every day; then the better rating, because among crews free
  the same day that is the right answer and it is the only quality signal the
  product holds; then fewer open jobs, which spreads the work and makes the slot
  likelier to survive; then the **name**, because a tie broken at random is a
  feature nobody can test and nobody can explain to the person whose turnaround
  it was. Each tier has its own fixture, since a check that only drives the
  first passes whatever the rest do.

  **Deliberately NOT ranked on whether they granted auto-schedule**, which would
  quietly steer every turnaround to the crews who gave up their accept/decline.
  That is paying for consent with work.

  **WHAT IT CAN HONESTLY MEAN BY "THE BEST POSSIBLE TIME"** is the next working
  day this account has not already booked them on and they have not marked
  themselves out of. SubSub sees this account's bookings; it does not see the
  other four accounts' diaries. So the slot is an **offer** and the chain is
  what settles it — pretending otherwise would be the confident-and-wrong answer
  this file refuses everywhere.

  **AND THE BACK AND FORTH IS BOUNDED AT `AUTO_TRIES`.** "Until it's booked"
  cannot mean for ever: two people who keep declining are telling us something a
  fourth date will not fix, and a machine that keeps proposing is one they
  switch off. The budget is counted from the visit rows rather than held in a
  column — every proposal is one, which is exactly what the budget is about.
  Past it, it stops and says so.

  **EVERY OUTCOME IS NAMED, because a manager who switched this on and heard
  nothing would assume it worked.** `not_switched_on`, `not_a_turnaround`,
  `already_assigned`, `no_candidate`, `assign_refused` — on the reply and in the
  feed, with the choice and the reason for it in words.

  **Still open, and worth saying: the trade is the first one on the job.** A
  turnaround with three trades gets one contractor auto-assigned and the other
  two slots left for a person. Doing all three means three rankings, three
  windows and a question about whether they should be the same day — which is a
  real scheduling problem rather than an endpoint.


- **SIX THINGS ON THE JOBS SCREEN, AND FIVE OF THEM COULD ONLY BE SEEN
  DRAWN.** Reported in one message with two screenshots. They are worth
  keeping as a set because each is a different way for a correct-looking
  source file to be wrong on screen.

  **A BARE DATE IS NOT A TIMESTAMP, AND `new Date()` PARSES THE TWO BY
  OPPOSITE RULES.** *"Trying to reschedule a job but I made it for October
  6th, but it made it for October 5th instead."* `"2026-10-06"` is **UTC
  midnight**; `"2026-10-06T12:00:00"` is local. `niceDay` was written for
  Stripe's period end -- a full ISO timestamp, as its own comment says -- and
  was then handed every plain date key in the product, so every one of them
  came out **a day early for every reader west of Greenwich**. Not one screen:
  `visitWhen`, every job date, both calendar grids, the day panel, an
  inspection's date, a waiver chain's through-date, a cover date. The database
  was right the whole time and the server never touched it.

  Anchored at noon, which is the trick `formatDay`, `formatExpiry` and
  `dayFromKey` all already use beside it and for the reason `dayFromKey`
  states: a daylight-saving shift cannot move the date under it. **This was
  the one date helper in the file that did not**, which is exactly why nothing
  beside it was wrong and nothing anywhere reported it. The browser suite is
  driven with the clock in **Los Angeles**, because in UTC the bug does not
  reproduce at all -- a run without that is a run that passes whichever rule
  is in force.

  **A LIST OF PARTIES WRITTEN AT A CALL SITE IS A LIST THAT CANNOT LEARN
  ABOUT A NEW PARTY.** *"One of the times for a job says waiting on a
  contractor and a contractor to confirm."* `VisitBlock` built that sentence
  with `pp === "tenant" ? name : "the contractor"`, which was complete when
  061 shipped two parties and silently wrong the moment 064 added the hiring
  side: the new party came out **wearing the old one's label, beside the real
  contractor, in the same sentence**. `partyText` and `joinAnd` in
  `shared/visitparty.js` read `VISIT_PARTIES` in `PARTY_ORDER`, and a party
  the list has never heard of is dropped rather than rendered as `undefined`
  in front of somebody. **The three-party case is the only one either
  behaviour can be told apart on** -- with two, a hand-written ternary and the
  helper agree -- and the same two-branch assumption was one branch along in
  the confirmed sentence, which said "the tenant and the contractor" and left
  out the side that had agreed it.

  The negative assertion had to **strip comments first**: the note recording
  the bug quotes the expression it replaced, which reads to a substring check
  exactly like the expression still being there. Fifth time this file has paid
  for that, and the first version duly failed on its own explanation.

  **AND THE TENANT IS NAMED WITH THEIR ROLE.** *"Who is John Smith? Juan Soto
  is the account holder."* Every sentence in that block printed a bare name,
  and the tenant is the one party on a job a managing agent may never have
  spoken to -- so the name read as a stranger who had wandered onto the
  screen. *the tenant (John Smith)* answers both at once, from the same
  helper, and a tenant we hold no name for keeps the plain label rather than
  an empty bracket. The labels are written lower-case so they read correctly
  mid-clause, so the two places that **start** a sentence with one go through
  `cap1`.

  **MOVING THE START MOVES THE END, and the screenshot is why that is a bug
  rather than a convenience.** From 11:00 AM, To 11:00 AM, over a Propose
  button refusing the window for ending before it starts: setting the start
  had left a window that **cannot be sent**, with the only way out being to
  notice the second box. It keeps the length somebody has already chosen -- a
  2h15m window shifted from 11am to 1pm is still 2h15m, and overwriting that
  would be the screen deciding something they had decided. **One hour is the
  default**, which is where *"if the start time is 1pm the end time should
  automatically adjust to an hour after"* comes from, and the old default was
  two. Clamped to the end of the day, because a window past midnight is one
  the server refuses and two dates in one row.

  **THE CONTRACTOR'S ANSWER WAS A CHIP ROW, AND THE PERSON IT IS AIMED AT
  COULD NOT SEE IT.** *"None of the jobs scheduled times have been updated on
  the contractor side. There should be big call to action on each one that
  says the time has changed and to accept or skip. This needs to be fixed asap
  and very user friendly."* 061 shipped the control: a 12.5px question and two
  inline buttons, between the scope and the work-order link, in a card that
  already has five other rows of small bold text. What is being asked is
  **whether somebody turns up on Tuesday**, which is the most consequential
  question this product puts in front of anybody, and the whole scheduling
  chain stalls on it going unanswered.

  `VisitAnswer` leads the card, says the window at 19px, and carries **all
  three** answers rather than two -- decline is what was asked for and the
  route has always taken it, and a screen offering only confirm-or-repropose
  makes somebody turn the **job** down to say no to a morning. The status line
  under it goes **off** while the panel is up: *"Proposed, not confirmed yet"*
  over a block saying the same thing in bigger type is the line that makes
  somebody stop reading both. It **awaits** -- the old row fired
  `onAnswerVisit` unawaited with no busy state and no error path, so
  `not_your_turn`, `not_open` or a dropped connection left the card exactly as
  it was: the save-that-reports-success shape, on the press that decides
  whether a crew is expected.

  **AND THE GATE IS WHOSE TURN IT IS, WHICH THE SERVER HAS TO ANSWER.** 061's
  gate was *has this side answered*, which offers Confirm on a window the crew
  is **third in line for** -- and a card cannot work the turn out for itself,
  because whether the tenant is a party depends on the access answer AND on
  there being a seat to ask. So `/api/my-work` carries `turn`, `parties` and
  `waitingOn`, and `hasContractor` is an **accepted** work order rather than
  merely an assigned one: somebody who has not said yes to the job cannot be
  waited on for the time. Only a row with a **pending** work order can tell
  the two rules apart. `turn` absent reads as *not known* and falls back to
  061's question, never as *not your turn*, so an older reply cannot hide the
  button altogether. And the *you confirmed this time* line is gated on our
  own leg rather than merely on the panel being down, or it would say that to
  somebody who has not accepted the job.

  **A ROW AT ANOTHER CLIENT IS TOLD, AND OFFERED THE ONE TAP.** Answering is
  an account-scoped write, so the panel draws with no answers and *Open
  Cascade Management to answer* instead -- and that matters far more than it
  looks, because **for a subcontractor ACCOUNT's own admin every row arrives
  that way**: `mine` is deliberately empty for them, so `away` is true on all
  of it. Which is most of what the report was about.

  **AND THAT ONE TAP WAS BROKEN -- A THIRD DOOR DOING LESS WORK THAN THE OTHER
  TWO.** `onGoClient` set `currentAccountId` and stopped: no `setAuth`, no
  `hydrateAccount`, no tab change, so pressing Open left every fetch pointed
  at the account just left -- the new client's name in the nav over the old
  one's jobs, roster and visits. The **identical** bug this file already
  records about the drawer, in a door nobody had noticed was one, and it is the
  only route a subcontractor account's admin has to a screen where they can
  answer a time. The header user menu was a **fourth** copy, correct but
  inline; both go through `goToSeat` now, and the suite counts how many places
  set the account id by hand, because *four copies of one gesture is four
  places for one of them to be missing a step.*

  **AND A JOB COULD BE CREATED AND NEVER CORRECTED.** *"When you click on a
  job card it should open to edit, so the entire job can be edited and
  saved."* `PATCH /api/jobs/:id` took four fields -- notes, measurement docs,
  the property and 060's access answer -- so everything typed on the create
  form was typed **once and frozen**: a street spelt wrong, a square footage,
  a trade nobody needed, the materials line. The only way to correct any of it
  was to close the job out and raise another, losing the work orders, the
  visit and the history. Fourteenth no-way-in in this file, and the one on the
  object this product is about.

  **One form, not a second copy.** `JobForm` takes `existing` and seeds the
  same fields the create path seeds from its presets -- two of the biggest
  form in the product would be two things to keep in step with the trade grid,
  the supplier chooser and the property picker. The title is the way in rather
  than the whole tile, for the reason the property tile already records: a
  button inside a button is not a thing, and this card is full of them.

  **A TRADE SOMEBODY IS ALREADY BOOKED FOR CANNOT BE TAKEN OFF.** Each trade
  is a slot and a slot can hold a live work order -- a price, a date and a
  company that accepted it -- so dropping the trade would leave that order
  pointing at a slot the job no longer has: invisible on every screen, and a
  contractor who still turns up. Refused **by name**, so the form can say
  which rather than quietly keeping it, which is the
  save-that-writes-nothing shape. And a **voided** order is not a booking:
  re-assigning voids the old row, so counting one would make a mis-assignment
  permanent. The screen agrees rather than offering a chip whose removal the
  save will reject, and says **why** beside the grid -- a control that refuses
  a press and explains nothing is indistinguishable from a broken one.

  **ONLY THE KEYS SENT ARE WRITTEN, on both sides.** The route writes only
  what the body names and the browser sends only what the form holds, so the
  photos, the report detail, the severity, who asked and the access answer all
  survive a save -- the shape that once deleted a W-9 through `SubForm`. The
  **materials line is composed by the server** and never taken from the
  request, the same rule the create route states: what a contractor reads on a
  work order should be something the shared supplier list produced. And the
  job **floats**, because 025 added `updated_at` so a job somebody is working
  on rises up the list, and a route that changes the job and not the column
  leaves the edit somewhere nobody scrolls to.

  **The access picker is deliberately NOT on the edit form.** Who lets them in
  is asked beside the **time** on the card, which is where the question
  actually arises and where the answer can say whether there is anybody to
  ask -- so a second picker here would be two controls for one column and this
  one's value is not in what the save sends. A control whose value is thrown
  away is the screen-that-lies rule pointed at a widget.

  **And the form says what editing does NOT do**, before anything is typed:
  the work orders already issued keep their price and their contractor, and
  changing the date here changes the date on the **job**, not the agreed
  visit. A form that let somebody believe otherwise would have them edit a
  date and expect a crew to know.

  **`test:mywork` HAD BEEN RED FOR A STALE REASON**, which this file has
  already called worse than being green: its whitelist of `account*` keys was
  never updated when `shared/hires.js` started carrying `accountKind`, so a
  suite nobody reads was sitting on top of whatever else it covers. Fixed with
  the reason beside it -- the kind is carried deliberately and for one
  purpose, because the verb beside the client count follows who is hiring.

  Nine server mutations and fifteen browser ones fire, each on its own
  assertion, and **one survived first time for the reason this file keeps
  recording**: *waiting on the tenant* hard-coded gave the same answer as
  reading the row, because the fixture had only the tenant left to answer. The
  fixture now owes two parties, which is the only shape either behaviour can
  be told apart on.

  **The backtick trap, for the FOURTEENTH time**, in a CSS comment naming a
  disabled attribute -- and caught by `npm run lint` rather than by a blank
  page, which is the first time that guard has reported it at the gate.

  **Not verified here:** `test:visits`, `test:visitafter`, `test:visitnobody`
  and `test:scheduled` need the full local stack (worker 8787, Supabase stub
  8902) and this container runs none of it, so all four fail on
  `ECONNREFUSED` before reaching an assertion -- as they did before this
  change.


- **A JOB ARRIVED THROUGH FOUR DOORS AND LEFT THROUGH ONE.** Asked for as *"a
  job should be able to be cancelled or deferred if needed for some reason -
  maybe it's an inaccurate assessment of what the issue was etc. maybe we have
  something 'complete, no work done'"*.

  The one door out was **Mark job complete**. `DELETE /api/jobs/:id` does not
  exist; `withdraw` is the requester's own move and most jobs have no
  requester; `decline` answers `not_a_request` on anything approved. So tidying
  anything up meant **recording that work had been done** — on a product whose
  payment ledger hangs off exactly that. Migration 066, `job_endings`,
  `app/shared/jobstate.js` extended rather than joined by a second module.

  **A STATUS RATHER THAN A DELETE**, which is the shape the roster already
  settled: the job history is what answers *were they insured on the day of
  that job*, the work orders and releases hang off it, and a repair somebody
  cancelled is a thing that happened.

  **ONE TABLE RATHER THAN SIX `ADD COLUMN`s**, for the reason 048, 057 and 063
  all chose a table: `ALTER TABLE ... ADD COLUMN` is the one statement that
  cannot be run twice, so six of them is six pastes and an operator who has to
  get the order right. One paste, every statement `IF NOT EXISTS`.

  **AND IT IS APPEND-ONLY, no primary key on `job_id`.** A deferral ends with a
  `resumed` row rather than by deleting the one that put it on hold, because
  *we put this off in January and picked it up in March* is two facts and the
  first is the one anybody asks about later. Same shape as `wo_events`, the
  superseded visit and the revoked invite. The current state is the **newest
  row**, read `at DESC, rowid DESC` the way the live visit is, and there is
  deliberately no denormalised copy on `jobs` — two records of one fact, and
  the stale one would be the one every screen reads.

  **ONE ROUTE FOR THE THREE**, because they share the approval check, the money
  boundary, the standing-down and the row. Three routes would be three places
  for the void to be forgotten, and the one that forgot it would be a
  contractor turning up to work nobody is expecting.

  **NOBODY IS LEFT BOOKED, AND THAT IS AS TRUE OF A HOLD AS OF A
  CANCELLATION.** A crew expecting Tuesday is a crew that turns up. Live work
  orders are **voided** rather than deleted — the question afterwards is what
  was issued and what happened to it — the open window is superseded and open
  quote requests are cancelled, because three companies pricing cancelled work
  is an afternoon each and that is the whole reason the commit gate refuses a
  closed job. **Pending work orders count too**: an offer somebody is about to
  accept, voided silently, is an afternoon they spent pricing work that was
  already off.

  **MONEY IS THE HARD BOUNDARY AND IT IS NOT OVERRIDABLE.** Once a funding has
  landed there is real money in a balance with this job's name on it, and a
  route that cancelled around it would leave the only record of that money
  saying the work was called off. **A hold is deliberately exempt** — putting
  work off spends nothing and the funding is still there when it comes back.

  **AND THE FIRST VERSION HAD TWO GUARDS COVERING FOR EACH OTHER.** The route
  skipped the funding query `if (kind !== "deferred")` and `whyNotEnd` also
  checked the kind — so a mutation to the rule changed no outcome on that path
  and the suite's own money assertion could not see it. One query is cheaper
  than that: the route reads the figure for every kind and the rule is the only
  thing that decides. Caught by mutation, which is the only thing that could
  have.

  **NOTHING IS PAYABLE AGAINST AN ENDED JOB, and this is the half of "complete,
  no work done" that would otherwise be a word on a screen.** `no_work` writes
  `status = 'completed'` — deliberately, because a fourth status value means a
  full rebuild of a table carrying a CHECK and every existing reader already
  answers correctly for `completed` — and *completed* is precisely the state a
  release is normally paid against. So without a gate it would be **the most
  payable a job ever gets.** `jobEndingBlocksPay` sits in `loadWorkOrder`'s
  shadow and is read by `settle` **and** `pay`: those are two routes on purpose,
  one recording money that moved elsewhere and one moving it, so a gate on one
  of the two is a door round it. It is checked **before** the cover and waiver
  gates, because those are overridable with a recorded reason and this is not —
  no reason makes work that was never done payable, which is the line `canPay`
  already draws about unfunded money.

  **A HOLD COMES OFF BY ITSELF WHEN ITS DATE PASSES.** That is what "defer
  until March" says, and it is why this needs no nightly sweep to undo. A hold
  with no date is indefinite and only a `resumed` row ends it. **Strictly
  past**: a hold until the 6th is still a hold *on* the 6th, because somebody
  who picked a date meant the work happens then and not before.

  **`jobIsLive` IS A SECOND PREDICATE, NOT A WIDER `jobIsClosed`, and the
  difference is the whole feature.** A held job is deliberately **not closed**:
  it keeps its phase on the Jobs screen, it can be resumed, and the list must
  not file it under completed. So `jobClosure` answers *no* to it — and every
  reader that treats a job as work still to come would have gone on counting
  it: the schedule, the overdue count, the fortnight strip, the undated tally,
  the calendar's aim, the unassigned-slot count, the emergencies list and
  `readyToComplete`. *"1 job is past its date"* about work somebody
  deliberately put off is the red number that never clears, which is how people
  learn to stop reading the panel.

  **AND THE THREE COMMIT DOORS REFUSE A HELD JOB SEPARATELY**, because
  `jobClosure` says no to it. `jobCommitRefusal` answers both for assign and
  overflow; `canRequestQuotes` carries its own line, which is right — that is
  the shared rule, and the one place `today` has to reach it so a lapsed hold
  stops refusing. Named `job_deferred` rather than `job_closed`, because
  "closed" is the wrong word for a reversible thing and the screen has to be
  able to say *on hold until the 14th*.

  **`autoRepropose` IS THE ONE AUTO HOOK THAT FIRES LATER**, when a tenant
  declines a window days afterwards — so it is the one that can find the job
  ended underneath it, and a machine proposing times for work somebody called
  off is the standing-permission failure this file records about a flag nobody
  is watching. It reads `jobIsLive`, not `jobIsClosed`.

  **WHAT ENDING IT COSTS IS ASKED BEFORE THE MODAL OPENS**, which is the
  roster's own rule word for word: *the consequence can name what is booked and
  how many people lose access; opening the modal first and filling it in
  afterwards puts the question in front of somebody above an empty space.*
  `GET /api/jobs/:id/end-check` answers it, because the browser cannot derive
  the money — what is funded sits on `wo_funding` per work order and the jobs
  list deliberately does not carry it, since a figure on every row would have
  to be redacted for owners and tenants. It is **a courtesy, not a gate**: the
  route refuses what it refuses whatever this said, and the modal asks anyway
  if the call fails, because a pre-flight that could stop somebody tidying up
  their own job list would be worse than none. It returns the refusal **per
  kind, from the one rule the route reads**, so the screen greys an option with
  the reason beside it rather than offering a press that answers 409.

  **NAMED, NOT COUNTED**, the same rule the completion modal already follows:
  *Plumbing — the contractor accepted this work order; it is voided and they
  are told* is what somebody stops at, where "3 things affected" is the number
  they press past.

  **IT IS NOT `ConfirmRemove` WITH DIFFERENT WORDS, AND NOT THE TYPED-NAME ONE
  EITHER.** Typed confirmation is for what cannot be undone, and nothing here
  is a delete — the job, its history, its work orders and its releases all
  stay, which is the whole reason this is a status. What it owes somebody
  instead is naming who gets stood down, because that is the thing they
  hesitate over and the card cannot show it.

  **A REASON IS REQUIRED ON THE TWO TERMINAL ONES AND NOT ON A HOLD.** *"An
  inaccurate assessment of what the issue was"* is exactly the thing somebody
  reads back in six months, and a cancellation with no words on it is
  indistinguishable from a mis-press. A hold's date is usually its whole story.

  **AND THE TENANT IS TOLD, in the right one of three sentences.** The person
  who reported a leak is the one who otherwise finds out by it never happening.
  Not flattened to "cancelled": somebody who read the problem and decided
  nothing needed doing is saying a different thing from somebody calling the
  work off, and a tenant told the wrong one of those rings up.

  **Which uncovered a default written for one stage leaking into every stage
  added after it.** `stageWords` was `w(detail || "a time to be confirmed")` —
  right for `visit`, and a deferral with no date came out reading *"has been
  put on hold: a time to be confirmed"*. The default belongs to the stage that
  wants it, and each function now answers for its own missing detail.

  **TAKING A HOLD OFF DOES NOT RE-ISSUE WHAT IT VOIDED**, and the modal says so
  before the press. Those were a price and a date somebody agreed to for a day
  that has gone; re-issuing silently would commit a contractor to work they
  have not been asked about again, which is the rule `autoschedule.js` states
  at length about whose calendar may be written to.

  **THE INVARIANTS ARE RUN AGAINST REAL ROWS, and that is what caught the one
  real bug in them.** 057's lesson: every invariant reads zero on an empty
  database, so one that is subtly wrong passes for ever. Four are seeded both
  ways in the feature's own suite, out of the real `CHECK.sql` and by column
  name so the test cannot drift from the file an operator pastes — and
  `m066_inv_resume_without_hold` **fired on an ordinary deferral** on its first
  run. `at` is an ISO string from the route, so a hold and the resume seconds
  later can share one to the millisecond; `e.at < r.at` then found nothing,
  read the hold as absent, and counted the common case as a fault. The tiebreak
  is part of "previous": `(at, rowid)`, the same ordering every read uses.

  **And `missingSchema` had never heard of `job_endings`**, so a database
  without 066 answered `migration: "unknown"` — a 503 somebody cannot act on.
  Also caught by the suite, which asserts the name rather than the status.

  **The two it refuses by name are worth keeping**: an unapproved **request**
  is sent to `decline` instead, because that is its door and two doors onto one
  act is how the two come to disagree about what they wrote; and `resumed` is
  refused through the ending door, because offering it there would let a resume
  be written against a job that was never held — which is the invariant above,
  and would make `jobEnding` answer *live* for work somebody called off.

  Nine server mutations and seven browser ones fire, each on its own assertion.
  Three harness faults in the first run of the browser suite were all ones this
  file already records: `.job-phase` is `text-transform:uppercase` and Chrome's
  `innerText` applies it, so a case-sensitive compare was testing the
  stylesheet; a **cancelled job is closed**, so the Active tab correctly hid it
  and the suite had to ask for All (now asserted in both directions before
  switching); and the card reader returned `{missing:true}` while the block
  below read `.slotBtns.length` off it, so it **threw on exactly the case it
  exists to catch** — the read-through-`link?.` lesson, for the sixth time.

  **Still open, and deliberately not in this change: reopening a cancelled job
  is not offered.** `reopen` writes `status` back and would leave the
  cancellation row as the newest ending, so the job would read as cancelled
  either way — and a cancelled job that can be un-cancelled is a fourth
  lifecycle to reason about on top of the three endings. Raising a new job is
  the honest answer today; making `reopen` append a `resumed`-shaped row for a
  cancellation is a product decision rather than a patch.


- **"WAITING ON THE CONTRACTOR AND THE HIRING SIDE TO CONFIRM", ON A SCREEN
  BELONGING TO THE HIRING SIDE.** Reported with a screenshot of a property
  manager's own Jobs card and the question *"shouldn't this say tenant?"* — and
  the answer to that is **no**, because the access answer three lines above it
  is *No access needed*, which is 060 taking the tenant out of the loop
  deliberately. What the screenshot actually caught is that **the manager is
  being told they are waiting on themselves**, with no button anywhere to
  answer it.

  **NOTHING WAS WRONG WITH THE SCREEN.** The line is `waitingOn` read
  correctly off a row where the hiring side's leg is NULL. Two separate causes
  put it there, and the second one is live rather than historical.

  **ONE: ROWS WRITTEN BEFORE 064 EXISTED.** 064's rule is *proposing is
  agreeing, for whoever proposed it*, and the propose route has stamped
  `manager_at` since the day it shipped. Under 061 a manager proposing stamped
  **nothing at all**, because the hiring side had no leg — so every window
  proposed before that deploy reads as a party who has not answered. And it
  cannot resolve itself: the chain asks the crew **first**, so until the
  contractor answers it is never the manager's turn and no button is drawn.
  The appointment sits with both sides apparently outstanding and neither able
  to be wrong about it.

  Migration 067 is the backfill, and `proposed_by` is what makes it a fact
  rather than a guess: the column has recorded who put the window forward
  since 019, and joining it to their seat says whether that was the hiring
  side. `manager_at` is set to the row's own `created_at` — exactly what the
  route would have written had the column existed.

  **Scoped three ways, because a backfill that reaches one row too far is
  worse than one that reaches none.** Live windows only. `manager_at IS NULL`
  only, so it is idempotent and a stamped row is untouched. And the proposer
  must hold an **admin or pm seat on that visit's own account** — a window a
  *contractor* proposed is their agreement and not the manager's, so those
  must go on waiting, which is the whole of what 064 added. Matched on the
  account rather than globally, because the same person can be an admin of one
  account and a contractor seat on another; the fixture puts exactly that
  person in, so a global match fails.

  **`status` is deliberately not touched, and that is safe rather than an
  omission.** The rows this matches had no leg stamped at all, so the
  contractor is still outstanding and `proposed` remains correct. A row where
  the contractor *had* answered was proposed by the contractor, which the
  WHERE clause excludes.

  **TWO, AND THIS ONE IS LIVE: THE AUTOMATION PROPOSED IN THE CONTRACTOR'S
  NAME.** `autoProposeOnAccept` fires inside the crew's own request — accepting
  a work order is what starts the clock — and `asSelf` relayed their headers,
  so the propose route read `auth.role === "contractor"` and recorded the
  window as **their** agreement. `proposed_by` named them for a time they had
  never put forward, and the hiring side's leg was left NULL. Every
  auto-scheduled job then stopped dead waiting for a manager to tick a slot a
  machine had chosen on their behalf.

  **Which is the opposite of what was asked for**: *"automate back and forth
  with tenant and tradesman... until it's booked - this should be fully
  automated"*. The hiring side is explicitly not in that back and forth. They
  agreed by **switching it on**, and the automation proposing for them IS that
  agreement — 064's own rule applied to the side that delegated the choice.

  `asSelf` takes an optional seat to act as, and `accountSeat` finds one.
  **`pickSeat` over the TEAM seats**, not whichever row came back first: a
  guest seat — an owner or a tenant, scoped to named buildings and somebody
  else's client — speaking for the account is the widening `staffStandsIn`
  already refuses, arrived at from a new direction. An unrecognised role sorts
  last there, so a role added later cannot silently become the account's voice.
  Null when there is nobody, and the caller falls back to relaying: an account
  with no team seat must still be able to schedule a repair.

  `autoRepropose` takes it too, and for a sharper reason — that one runs inside
  the **decline** of whoever could not make the last window, so relaying would
  record the replacement as the tenant's or the contractor's agreement to a day
  they have not seen.

  **AND THE FIXTURE COVERED FOR THE GUARD FIRST TIME ROUND.** Mutating
  `pickSeat` over team seats to "take the first row" changed **no outcome**,
  because the seed inserted the admin before the tenant and the two rules gave
  the same answer. The tenant seat is inserted first now, which is the only
  order either can be told apart on — and the mutation then fails five
  assertions. The two-guards-covering-for-each-other shape, in its fixture
  form, for the seventh time.

  **The invariant is both halves at once.** 067 is a backfill, so there is no
  column for a did-I-run-it check — `m067_inv_manager_unstamped` counts a live
  window the hiring side proposed with no record that they agreed, which is
  non-zero before the paste and zero after, and **stays** zero because the
  propose route stamps at write time. Run against real rows in two suites
  rather than left to the drift test, which is 057's lesson.

  **And the backtick trap, for the FIFTEENTH time**, in a SQL comment written
  into a test fixture's template literal — this one naming a function in
  backticks inside the seed. Caught by the suite failing to parse, with the
  one-line guard now beside it.

- **A HANDYMAN WAS CALLED THE CONTRACTOR ON THE APPOINTMENT LINE, AND THE WORD
  IS A PROPERTY OF THE ENGAGEMENT RATHER THAN OF THE SENTENCE.** Reported in
  the same breath as the entry above, looking at the same card: *"Or it should
  actually say handyman since pacific is a handyman"*. The line read *waiting
  on the contractor and the hiring side to confirm*, and Pacific apartment
  maintenance is engaged as a **handyman** — which 058 recorded, 058's own
  picker sets, and the chip under their name already follows.

  `VISIT_PARTIES.contractor.label` is a flat constant. **The same shape as the
  `roleLabel` constant this file already records being wrong twice over**, one
  screen along, and wrong for the same reason: a label that cannot see the
  engagement is wrong for every handyman on every roster, and it reads exactly
  right in the source.

  **IT IS READ OFF THE COMPANIES ACTUALLY HOLDING THE WORK, not off the
  account.** A roster carries both kinds, so the question is not *what does
  this account call its contractors* but *what is this account's relationship
  with whoever is on this job* — which is per-engagement, which is the whole
  shape of 058.

  **MIXED TAKES THE NEUTRAL WORD, which is `workingForVerb`'s own refusal.**
  There is no word that is right for two companies when one is a licensed trade
  and the other is a maintenance worker, so a job held by both says the
  account's ordinary roster word rather than flattering one of them. Nobody
  assigned yet reads the same way, because there is no engagement to read.

  **AND `null` IN THE LIST IS A SUBCONTRACTOR, NOT A GAP — which the first
  version got wrong.** `jobHiresWord` filtered the blanks out, so a job held by
  a handyman **and** a company whose relationship nobody had answered read as
  all-handyman. Every roster row written before 058 is that blank, so this is
  the common case rather than the odd one, and the sentence it lands on is the
  one somebody reads before standing a licensed trade down. The rows with
  **nobody assigned** are dropped by the caller instead, where a trade with no
  company on it is visibly a different thing from a company with no word
  against it.

  **The neutral word is the CALLER'S, never a literal.** `hiringWord` is passed
  in for the reason `engagedSeatLabel` takes one: a general contractor's roster
  says subcontractor and a managing agent's says contractor, `hiresLabel`
  already decides that, and `engaged.js` must not take a dependency on
  `hires.js` to say one word.

  **`partyText` TAKES THE WORD RATHER THAN READING IT, and the other two
  labels are untouched by it.** `VISIT_PARTIES` keeps its label as the default,
  so every call site with no job to read — the job form's access note, the
  inspection's — renders exactly the sentence it did. A change that painted
  every party with the word would pass every assertion about the handyman, so
  the hiring side and the tenant are asserted beside it.

  **AND THE THREE ACCESS NOTES BECAME FUNCTIONS OF IT.** *The tenant and the
  contractor both confirm the time* is a sentence about the parties, so it goes
  stale the same way — the lesson 061 recorded about 060's copy going stale one
  change later, paid again rather than relearned. The two call sites with no job
  behind them call it with no argument, because the default word is the only
  honest one where nobody is assigned yet.

  **BOTH BRANCHES ARE ASSERTED IN THE SAME PLACE, in two suites, which needed
  two fixtures to earn.** A handyman and a subcontractor on **one roster**,
  each holding an otherwise identical job: only a pair that can be told apart
  on each other can show that the word follows the engagement rather than
  having been swapped wholesale. The diagonal coverage that left `hiresLabel`
  half-wired, refused in the place that rule was written about.

  Nine mutations fire, each on its own assertion: `partyText` back to the
  constant, `every` → `some`, the blanks filtered out, the neutral word
  hard-coded, either mount site dropping `hiresWord`, the mount site reading
  the company row instead of the engagement, the stand-down sentence back to
  the constant, and `jobHiresWord` answering handyman for everybody.

- **THE DATE MOVED AND THE CREW WAS NEVER TOLD, BECAUSE `PATCH /api/jobs/:id`
  WROTE TWO COLUMNS AND STOPPED.** Reported with the handyman's own portal on
  screen: *"This same job issue is not resolved. I resolved it from the
  property manager side, but on the handyman side (pacific) it's showing
  this… it should have showed an accept or decline option when I updated it
  from the property manager side."* The card read **Oct 7, 2026 · 11:30 AM —
  Target date. The date on the job. No visit time has been agreed**, over a
  date the manager had already changed.

  **THE CARD WAS READING THE ROW CORRECTLY.** `jobs.date` is the target and a
  row in `visits` is the appointment, and the edit form wrote the first and
  created nothing. So there genuinely was no live visit, `workWhen` answered
  `target`, and the one party who physically drives to the address was told
  about a date nobody had asked them to agree to. Which is the same silence
  061 and 064 exist to end, arriving through a door neither of them covered.

  **AND THE FORM CARRIED A SENTENCE SAYING SO**, which is why it survived:
  *"Changing the date here changes the date on the job — to move an agreed
  visit, propose a new time on the card."* That was an accurate description of
  what the route did, and the route was wrong. **The screen and the server
  agreed with each other about a behaviour nobody wanted**, so every static
  check passed, the suite passed, and the only reader who could tell was
  somebody holding both screens. That is a new shape for this file: not a
  screen stricter than its route, nor looser — the two in step and both
  wrong, which no assertion comparing them can see.

  The browser suite had duly pinned it. `test:jobeditui` asserted *"and that
  moving an agreed visit is done on the card"*, so the bug was held as firmly
  as the fix would have been — **a test can pin the wrong answer as firmly as
  the right one**, for the third time in this file, and the assertion was
  rewritten to the new rule rather than loosened.

  **NOBODY EDITS THE DATE ON A JOB A CREW HAS ACCEPTED "JUST AS A TARGET".**
  There is no third meaning: the crew is booked and moving the date moves
  them. So a date or time change now proposes that window.

  **THROUGH THE REAL ROUTE, never a second insert beside it**, which is
  065's recorded decision applied again: proposing carries the approval
  check, `partiesFor`, the chain's turn order, the supersede and three schema
  fallbacks, and a copy here would be a second set of rules with the one that
  drifted being whichever door is used less. `asSelf` is the same relay the
  auto-scheduler uses, and the test proves the gates came with it — an
  unapproved request still gets nothing.

  **ONLY WHEN THERE IS SOMEBODY BUT US TO ASK, which is a predicate rather
  than a crew check.** `visitParties` always carries the hiring side on a 064
  database, because proposing is agreeing for whoever proposed it — so a list
  of just `manager` settles the moment it is written and tells nobody.
  Proposing one of those would draw **"Confirmed. Agreed by everybody who has
  to be there"** over a job with no crew on it, which is the screen-that-lies
  rule pointed at the one line a contractor reads to decide whether to get in
  the van. `othersMustAgree` is that question, and the discriminating row is a
  **tenant's own report with nobody assigned**: a rule written as "has a crew"
  asks nobody there and passes every other assertion.

  **ACCEPTED, NOT MERELY ASSIGNED**, which `partiesFor` already says and which
  only a fixture holding a **pending** work order can check — that row is the
  whole reason it is in the seed.

  **AND ONLY WHEN IT MOVED.** A save that resends the date it already had is
  not a reschedule, and asking a crew to re-confirm a day they agreed to is
  precisely the round trip 064 ordered the chain to avoid. The route had no
  idea what the row said before, so it reads it first — through the same
  column cascade the propose route uses, because a database behind the code
  must lose the ask and never the edit. Two fixtures tell the rule from
  "always propose": one that re-sends the stored date, and one that edits the
  title alone.

  **THE WINDOW SOMEBODY AGREED TO KEEPS ITS LENGTH.** A 2h15m slot moved to
  the morning is still 2h15m, and an hour's default would quietly shorten
  every appointment anybody reschedules. That arithmetic was written inside
  `VisitForm` and is now `windowEnd` in `shared/schedule.js`, because the
  server needs it too and two copies is two records of one fact.

  **AND IT IS SAID ON THE REPLY RATHER THAN ASSUMED.** `rescheduled` carries
  who was asked, or the refusal — the `engagedAsRecorded` rule: a screen that
  cannot tell *nobody needed telling* from *the ask did not go* cannot offer
  the one of those worth a second press. The edit itself stands either way,
  because refusing it now would be a save that reports failure over a write
  that happened. The browser then **re-reads the appointment list**, or the
  manager's own card keeps the window the propose just superseded — the
  stale-snapshot shape, on the one row that says when somebody is coming.

  **AND UNDERNEATH IT, A PROPOSE THAT FAILED TOOK THE APPOINTMENT WITH IT.**
  `POST /api/jobs/:id/visits` superseded every live visit **first** and then
  inserted the new one, and the two are not a transaction. So an insert that
  failed for any reason left the job with **no live visit at all**: the
  appointment gone, and a refusal on screen that reads as nothing having
  happened — which is exactly what the reported card looked like.

  Reversed, the worst case is a stale row nothing reads: every reader takes
  the newest live visit by `created_at DESC, rowid DESC`, and the new one is
  the newest by construction. **A vanished appointment is a crew nobody told;
  a superseded row that did not get the word is invisible.** Driven with a
  trigger that refuses every INSERT on `visits` and leaves UPDATE alone, which
  is the one way to make the second statement fail deterministically without a
  broken schema.

  Nine mutations fire, each on its own assertion — and **one of them did not
  apply on the first attempt**, which is the lesson worth repeating: the patch
  script that moved the supersede back above the insert threw on its own
  anchor and the suite ran green against unmodified source. *Check the file
  changed, not that the script exited*, for the second time in two changes.

  **Still open, and the honest limit of this: `jobs.date` and the visit can
  still disagree**, because the propose can refuse (an unapproved request) or
  a party can decline, and the target date has already moved by then. That is
  reported rather than hidden, and reconciling the two would mean deciding
  which outranks the other — a product decision about what a target date is
  for, not a patch.

- **FOUR ROWS OF A SCHEDULE ALL READING "WEDNESDAY".** Asked for in four
  words, with the rows circled: *"Add date / time on these jobs too."* The
  contractor's own schedule panel drew its follow-on rows as
  `relDay(date)` and nothing else, so four jobs on one day were four
  identical words — and the thing somebody actually needs from a schedule,
  which of them is the morning one, was on none of them.

  **TWO HOLES IN ONE COLUMN, and only one of them is about the time.** Past a
  week `relDay` stops naming a day at all: *"In 70 days"* is the one answer a
  person looking at a schedule cannot use. So the day line carries a real
  **date** as well as the weekday on everything but today and tomorrow.

  **`rowDay` IS A NEW HELPER RATHER THAN A CHANGE TO `relDay`**, which is the
  lesson the agreement templates record about `plural`: `relDay` is read by
  the activity feed, the dashboard and half a dozen other screens where
  "Wednesday" beside a sentence is exactly right, and widening it there would
  rewrite all of them to fix a column in one panel. Today, Tomorrow and
  Yesterday keep their words, because those are what make a schedule readable
  at a glance and a date cannot say them. The year rides along only when it is
  not the current one — the rule the compliance pack's date column already
  follows so the common row stays short.

  **AND A ROW WITH NO HOUR SAYS SO.** A blank there reads as a line that
  failed to draw, which is the opposite of the fact it is reporting:
  *No time set* is itself the useful answer on a target date.

  **THE PROPERTY UNDER TEST IS THAT THE TIMES TELL THE ROWS APART**, not that
  a time is present. A column printing the same hour on every row passes
  "each of them carries a time" and leaves the panel exactly as it was, which
  is the mutation that proves it. The fixture is the reported shape — several
  jobs landing on one day — because that is the only shape where the fault is
  visible at all.

  **AND THE FIX NEARLY PAID FOR ITSELF OUT OF THE TITLE.** The when column is
  24px wider, which at 390px left the job name about twelve characters before
  the ellipsis. So at phone width the title **wraps to two lines, clamped** —
  the same answer the dashboard's request titles already give at that width
  and for the same reason. Caught by measuring the row rather than by reading
  the CSS, which is the only thing that can see it.

  **AND THE MEDIA BLOCK WAS WRITTEN ABOVE THE RULE IT OVERRIDES, WHICH DID
  NOTHING AT ALL.** A media query does not raise specificity, so the later of
  two identical selectors wins whatever the query says — `.mys-title` is
  redeclared four lines below, and the computed `white-space` stayed `nowrap`.
  **A colour set twice in one stylesheet is a colour decided by ordering**,
  which this file already records about the compliance pack's dot, in CSS that
  reads exactly as intended. Nothing static could see it: the selector is
  right, the query is right, and the only witness is the computed value. So
  the assertion reads `getComputedStyle` at both widths, and the mutation that
  moves the block back above the base rule fails three of them.

  One naming note worth keeping: the new spans are `mysd-*` rather than
  `mysw-*`, because `mysw-` already means the TAG's tone (`mysw-ok`,
  `mysw-wait`, `mysw-plain`). A second meaning on one prefix is how a selector
  finds the wrong thing, which is the `.embed-code-btn` trap before it has a
  chance to happen.

- **A SENTENCE LAID OUT AS A ROW OF FLEX ITEMS, AND A PERIOD ORPHANED AT THE
  START OF A LINE.** Reported with the hiring side's own answer panel circled:
  *"Reformat this, better design of the information and use proper American
  English."* It drew as three columns —

      The contractor has put    Oct 7, 2026 · 9 AM–11    . Agree it and the
      forward                   AM                       tenant (John Smith)…

  **`.visit-state` WAS `display:flex` WITH A GAP**, so the icon, every run of
  text AND the `<b>` holding the date each became its own flex item, sized to
  its own content and wrapping on its own. The gap is the space in front of
  that period. **All nine of these lines have that shape** — an icon, a
  sentence, a bold date in the middle — so every one of them was one wrap away
  from the same thing. The `.dash-row-open` lesson this file already records,
  inside a single paragraph.

  The icon goes inline and the text flows. Which needed one guard: the one
  block that really IS a row, `.visit-nobody` (a sentence and a button), is
  declared **above** `.visit-state`, so a later `display:block` would have
  beaten it. Raised to `.visit-state.visit-nobody` rather than moved, because
  ordering is what decides two equal selectors and this one must not be
  decided by where it sits.

  **THREE LINES IN THE ORDER SOMEBODY READS THEM: what happened, when, and
  what yes does.** Even laid out correctly, the date was mid-clause — and it
  is the one value on that panel somebody has to find before they can answer,
  so it gets a line of its own at 16px. The panel is amber-edged rather than
  sharing the flat paper tone of the access note directly above it: two tinted
  blocks stacked said nothing about which was the statement and which was the
  question.

  **"AGREE IT" AND "HAS PUT FORWARD" ARE BRITISH.** So was *"has been and
  gone"* one branch along. Approve, proposed, has passed. This is a product
  sold in the United States and the voice should not wander.

  **AND TWO BUTTONS DID ONE THING, ONE DIRECTLY ABOVE THE OTHER.** *Propose
  another* inside the panel and *Propose a different time* under it, both
  opening the same form — two names for one object, which is how somebody
  concludes there are two of them, and here they were four pixels apart. One
  name, and the standalone one is withheld while the panel is up, so there is
  one of it on screen as well. `myTurn` is read once and both the panel and
  the suppression hang off it, so they cannot disagree.

  The contractor's own panel said *"Propose another time"* for the same act on
  the same object, read by the other party to the same appointment, so it
  matches now. The **service call** flow keeps *"Propose another date"*
  deliberately: a return date is not a window, and matching the wording there
  would name the wrong thing.

  **THE BACKTICK TRAP, TWICE IN ONE CHANGE — THE SIXTEENTH AND SEVENTEENTH
  TIMES — AND THE GUARD FOR IT HAS EXISTED SINCE THE FIRST.** `test:css`
  reads the stylesheet literal and asserts there is no backtick in it. It
  never ran: its first three assertions need nothing but a file, and they sat
  behind a browser, a built bundle and a server on 5191 — so a container
  without that stack could not run *either* half, and the one-second check
  that catches this landed nine more incidents with the guard in the
  repository the whole time.

  **A guard that runs where nobody is looking is a guard that reports to
  nobody**, which is the lesson the five red deploys already taught, found
  again in the one place that was supposed to have learned it. The static half
  runs first and on its own now; the live half says it did not run rather than
  failing, because no stack is not a fault in the stylesheet and a red run for
  a missing server is a red run people learn to ignore — which is exactly how
  this one got ignored. It names the offending line.

  And one harness fault worth keeping, because it is this project's own: a
  blanket rename in the test to clear a shadowed binding rewrote the SELECTOR
  string as well, so the probe looked for a class that does not exist and
  reported the panel as missing on a screen that had rendered perfectly.
  **The selector was wrong, not the product** — for the third time.

- **ONE ACTION ROW, ONE SIZE, THREE SIDES — AND THE WORDS WERE ALREADY
  RIGHT.** Asked for as *"all the scheduling call to actions on the tenant
  side, the property manager side and the contractor / handyman side need to be
  well designed, very clear… large buttons, make it easy to select propose a new
  time"*.

  Three sides answer a question about one appointment and each had grown its
  own buttons: the contractor's `.vans-*` set, the tenant's `.tn-visit` pair,
  and the manager's `btn-solid sm` / `btn-ghost sm`. **Nothing was wrong with
  any of the sentences.** What was wrong is that all three rendered at the
  card's own 12.5px, inline, among five other rows of small bold text — so the
  most consequential question this product asks anybody, *does somebody turn up
  on Tuesday*, was the quietest thing on the card. Reported as "a bit hidden",
  which is exactly what it was.

  **`.sm` IS NOT A SIZE THIS STYLESHEET DEFINES**, and that is worth its own
  line. The manager's pair carried it, so the modifier did nothing at all and
  the two read as ordinary form buttons at the foot of a long card — a class
  that looks like a decision and is a no-op. The same shape as a misspelt
  capability: the source reads exactly as intended, it fails in the quiet
  direction, and nothing anywhere reports it. Only the computed pixels can see
  it, which is why the suites measure `getBoundingClientRect().height` and the
  font size rather than asserting a class is present.

  `VisitActs` is the one row, and **`kind` carries the meaning rather than the
  caller picking a class**: `yes` is the commitment, `alt` is proposing another
  time, `no` is declining, `quiet` is a way back out of a sub-form. A caller
  choosing colours is a caller who can paint the decline green — somebody
  tapping the solid button to say no — so the component maps the kind and an
  unrecognised one falls to `alt` rather than to the commitment. Pinned in both
  directions: exactly one `yes` per row, and the refusal is a `no`. Painting
  the decline as the commitment fails three assertions.

  **THE WORDS STAY WITH EACH SIDE.** The tenant, the crew and the hiring
  account are being asked genuinely different things — *can you be in*, *can
  you make it*, *is this time all right with us* — so one component owning the
  copy would have flattened three questions into one. What is shared is the
  size, the shape and which of the three acts each button is.

  **44px AND 15px ARE FLOORS, ASSERTED AS BOUNDS.** This is used on a phone at
  a kerb, so the floor is the smallest target anybody recommends for a thumb
  and the design may exceed it. Each bound carries **its own length check**,
  because `[].every(...)` is true — a size assertion over a control that has
  disappeared passes loudest exactly when the subject is gone, which is the
  read-through-`link?.` lesson in its arithmetic form. The manager-side
  mutation (back to `btn-solid sm`) fails three assertions only after that fix;
  before it, two of them passed on the empty array.

  **AND THE NARROW-SCREEN STACK IS MEASURED AT 540px, NOT AT 390px, which is
  the whole of why that assertion means anything.** `min-width:168px` plus
  `flex-wrap` already stacks the row under about 345px, so at phone width the
  media query and no media query at all draw the identical thing — **deleting
  the query is a mutation that SURVIVES there.** 540 is the one band where they
  differ: two buttons fit side by side and the query is the only thing stopping
  them pairing up. Checking the narrower viewport would have been choosing the
  width that flatters it, which this file already records about the hero's
  right-clip bound.

  **AND THE FIRST VERSION SHIPPED A LABEL WITH NO WAY IN, in miniature.** The
  manager's standalone control was written as `visit ? "alt" : "yes"` reading
  *Set a time for this job* on a job nobody had scheduled — which reads
  perfectly and can never draw: `open` starts true when there is no visit, so
  the propose **form** is already on screen there and `onCancel` is null, so
  there is no way back to a button. Found only by driving the branch and
  dumping the block's own HTML. The ternary is gone rather than made reachable,
  because a form already open **is** the primary action and is strictly better
  than a button that opens one — and the suite now asserts that (form open, no
  button) so a later pass adding the label back has to notice it is
  unreachable. Fifteenth no-way-in in this file and the first one authored in
  the same change that was fixing the others.

  The old `.vans-*` button system is **deleted rather than left behind**: a
  second scheduling button set in the stylesheet is a second one for a later
  change to reach for, and the one it reached for would be the one nothing
  uses. Its place in the file carries a comment saying where it went.

- **"JOB RAISED" IS TRUE ON THE DAY IT IS PRESSED AND NEVER STOPS BEING
  TRUE.** Reported against the Inspections list with the flagged rows circled:
  *"details or status of the inspection of ones that were flagged for follow
  up should have the status updated from job raised to what's happening
  currently — job scheduled for specific date"*.

  The chip was `!!inspection.jobId` — **a fact about whether a row exists, not
  about the work.** So a unit whose repaint is booked for Thursday, a unit
  whose crew has not answered, and a unit whose job was cancelled all read the
  same two words from the one screen a managing agent opens to see what is
  still outstanding. Everything 061, 064 and 066 added happens *after* that
  chip is earned and none of it reached it.

  `jobProgress` in `app/shared/jobstate.js` is the one rule, read by the two
  routes that build a row and by both screens that draw one.

  **NOBODY ON IT OUTRANKS A DATE, which is the one ordering decision worth
  writing down.** A window settles the moment everybody who must agree has —
  and `visitParties` counts only crews who have **accepted** — so on a job with
  nobody assigned the hiring side agrees with itself and the visit reads
  `confirmed`. Drawing *Scheduled Oct 9* over a unit no contractor is coming to
  is the screen-that-lies rule pointed at the one line somebody scans to decide
  what still needs them. So the crew is asked about first, and the mutation that
  proves it reads the visit before the count.

  **IT ANSWERS A STEM AND A DATE, never a finished string.** The Worker answers
  in UTC and the browser in the reader's own zone, and this file has already
  paid in full for a date helper that disagreed with the one beside it — so the
  module says *Scheduled* and the screen says which day, through the `rowDay`
  the contractor's own schedule already uses. A test asserts no label in
  `JOB_PROGRESS` contains a digit.

  **ONLY THE SERVER CAN ANSWER IT.** The browser holds no work orders and no
  visits for a job it is not standing on, so a screen deriving this would be
  guessing — the same reason `turn` is computed server-side. One extra
  statement for the whole page rather than one per row, and the **detail screen
  reads the same function** rather than deriving a second opinion beside the
  button into the job.

  **AND `jobId` WITH NO ANSWER BESIDE IT STILL SAYS A JOB WAS RAISED.** A
  database behind the code must cost the progress line and never the row —
  which is also why each of the three joins has its own `missingSchema` catch,
  and why a missing `job_endings` leaves the list listing rather than refusing
  it.

  **FOUR GUARDS WERE COVERED FOR BY OTHER GUARDS, and the fixture is what
  earned each one.** This is the seventh time this file has recorded the shape,
  and it took four rows to close:

  - The visits query's `status IN ('proposed','confirmed')` filter survived
    deletion, because `workWhen` checks liveness again and the ordering hid the
    dead row. The only row that can tell them apart is **a live window with a
    NEWER declined one behind it** — which is exactly what the propose route's
    deliberate insert-then-supersede order leaves when the newest of two live
    windows is turned down.
  - The newest-live **ordering** needed a second live row on one job, which is
    the same shape from the other side.
  - `voided_at IS NULL` on the assigned count survived, because no fixture had
    a voided work order — and re-assigning and ending a job both leave one. A
    voided row is not a crew.
  - The endings' last-write-wins ordering survived, because every job had at
    most one ending. `job_endings` is append-only, so **a job put on hold and
    picked back up carries two** — reversed, work somebody restarted reads as
    on hold for ever.

  **AND THE ROW HAD TO LEARN TO WRAP, which cost two goes.** The chip is wider
  than the two words it replaced, so at 390px the title was ellipsed to about
  four characters — the thing somebody is scanning for, paid out to show the
  thing beside it. `flex-wrap` alone did nothing: `.insp-row-main` was a bare
  grow, whose basis is zero, so the column shrinks to nothing rather than
  pushing the chips onto a second line and **wrapping never happens**. A basis
  is what makes the wrap real, and the measurement (`titleRight` 64px → 250px)
  is the only thing that can see it.

  **The backtick trap, for the SIXTEENTH time**, in the comment explaining that
  very rule — which named the flex shorthand in backticks and closed the
  stylesheet's template literal. Caught by `npm run lint` and by `test:css`,
  which now runs its static half anywhere, one change after that was fixed.

- **THE SUMMARY IS WRITTEN WHEN THE WORK ORDER IS ISSUED TOO, AND IT LEADS THE
  PAGE RATHER THAN THE LIST.** Asked for as *"when an inspection follow up
  creates a job and the job turns into a work order, the summary creation
  should happen automatically when added to the work order with all of the
  other details. Summary should be at the top of the page / pictures of the
  work order."*

  **063 WRITES IT AT RAISE TIME, WHICH IS THE RIGHT MOMENT AND IS NOT THE ONLY
  ONE.** A raise whose call failed, a job raised before 063 shipped, a job
  raised from a walk that had nothing to combine yet — every one of those
  reaches a contractor with the rooms and no paragraph, and **nothing
  retried**. The person who has to read it is the one person who cannot ask
  for it, so from their side the gap was permanent.

  **ISSUING IS A PRESS THE ACCOUNT MAKES, which is what makes this allowed
  where 063 refuses the contractor's first read.** That entry's three
  objections were: it spends the account's money on a press they did not make,
  it fails at the moment somebody needs it with nothing to fall back on, and
  three companies on one job pay for three answers. Issuing answers all three
  — a person pressed Assign, the rooms are the fallback and are the record,
  and it writes **only when there is nothing there**, so the second and third
  work orders on one job cost nothing. The mutation that proves the last one
  rewrites on every issue and fires four assertions.

  **A STALE ONE IS NEVER REWRITTEN, which is 063's rule kept rather than
  weakened.** The notes can move on after a job is raised, and a paragraph
  another company may already be pricing from must not change under them. The
  screen says it is behind and the rooms beneath it are always live.

  **IT NEVER BLOCKS THE ISSUE**, for the reason the raise does not: by the
  time it runs the work order exists and the contractor has been told, so a
  500 over a paragraph reports failure for work that is already on somebody's
  screen. Said on the reply rather than inferred from a null, so a caller can
  tell *there was nothing to summarise* from *the call failed*.

  **AND THE CATCH NEEDED ITS OWN SEED, because the obvious fixture cannot
  reach it.** `writeInspectionSummary` answers a refused provider call with an
  error rather than by throwing, so every failure it reports comes back the
  tidy way and the outer catch changes nothing — it survived deletion. What
  gets past it is the **database**, so the fixture breaks the summary table
  with a CHECK no row can satisfy, which `missingSchema` does not recognise
  and which therefore throws. Without that seed the catch is a guard nothing
  can tell from no guard at all.

  **AND THE PARAGRAPH MOVED TO THE TOP OF THE MODAL, above the document.**
  It already sat above the rooms it summarises — what it did not do is lead
  the page. Somebody opening a work order is about to put a price on it, and
  what the work **is** belongs before the paperwork. The rooms and the
  photographs stay below the document: they are the record, and a unit's worth
  of pictures above it would bury the work order itself.

  **ONE FETCH, TWO PLACES, WHICH IS THE PART THAT WOULD HAVE GONE WRONG
  QUIETLY.** Two mounts of one component is two requests for one record —
  the duplicate-state trap this file already refuses for the compliance pack
  panel — so the fetch is hoisted into the modal as `useWoInspection` and both
  pieces read it. Only the wire can see that: the suite counts the asks for
  `/api/work-orders/:id/inspection`, and the mutation that gives the summary
  its own hook fires exactly that one assertion while every other check stays
  green.

  **And the existing suite was updated to the new rule rather than loosened.**
  It asserted the summary sits above the ROOMS, which is still true and is no
  longer the claim — *a test can pin the old answer as firmly as the right
  one*, for the fourth time. It now measures against the **document** as well,
  reads the lede's own title line, and pins that there is exactly **one** copy
  on screen, because moving a paragraph without removing it from where it was
  prints it twice.

  **The backtick trap, for the SEVENTEENTH time**, in a SQL comment inside a
  test fixture's template literal — this one naming `documents_incomplete`.
  The failure reads as `SyntaxError: missing ) after argument list` at the
  `db.exec(` line, which is the tell.

  One fixture fault worth keeping, and it is this project's own: the new block
  read `sent[0].body` to assert what the request carried, and **threw on
  exactly the case it exists to catch** — the call not going out. The
  read-through-`link?.` lesson, for the seventh time.

- **THE SUMMARY IS WRITTEN WHEN THE INSPECTION IS FINISHED, AND THE COPY ABOVE
  IT EXPLAINED ITSELF INSTEAD OF SAYING ANYTHING.** Asked for in one message:
  *"Write a summary automatically when inspection is done, remove this language
  which doesn't make any sense"*, quoting the blurb — *the paragraph whoever
  does the work reads before the room-by-room list. Combined from your notes
  and the captions you kept — never from a draft nobody kept* — and the empty
  state under it.

  **THREE DOORS NOW WRITE IT AND THERE IS ONE WRITE.** 063 shipped the
  paragraph at raise time and the release before this one added it at issue, so
  a third call site was the moment this stopped being safe as three copies: the
  redaction, the already-written check, the staleness comparison and the
  deliberately-wide catch are four rules, and the one that drifted would be on
  whichever door is pressed least. `summariseInspection` is the write;
  `summariseForWorkOrder` is now the job→inspection lookup and nothing else.

  **FINISHING IS WHEN IT IS WANTED AND NOT WHEN IT IS CHEAPEST.** A job raised
  from an unfinished walk gets the paragraph at raise time, which is right —
  the leak does not wait for the paperwork. But most inspections are finished
  before anybody raises anything, and until now those had no paragraph at all
  unless somebody pressed a button they had no reason to know about. **The
  press that said *I am done walking this unit* is the press that knows the
  notes are final**, which is also the only moment the staleness comparison can
  be satisfied by construction.

  **AND IT NEVER BLOCKS THE FINISH, which is the same trade 063 recorded about
  the raise.** Finishing is a one-way door and the paragraph is derived, so a
  throw there would answer 500 to a finish that already happened — a screen
  reporting failure over an inspection that is shut. The reply carries
  `summarised: {wrote, reason}` rather than a bare null, the
  `engagedAsRecorded` rule: a screen that cannot tell *there was nothing to
  summarise* from *the call failed* cannot offer the one of those worth a
  second press.

  **THE BLURB WAS A DESIGN NOTE WEARING A PARAGRAPH'S CLOTHES.** *Never from a
  draft nobody kept* is a true and load-bearing fact about the redaction, and
  it is **this file's** to hold, not the screen's — the reader is a managing
  agent looking for the summary, and a sentence arguing the implementation at
  them is the stops-the-send shape the agreement preview already paid for. The
  rule is unchanged and only its recital is gone.

  And the empty state said what the work order *still* carries, which answers a
  worry nobody had, and said nothing about the one thing somebody standing
  there wants to know: whether one is coming. It names the door instead — *one
  gets written when you finish the inspection* on a draft, *write one when you
  are ready* on a finished one.

  **AND THE AUTO-TURNAROUND SWITCH HAD NEVER BEEN DRAWN IN A BROWSER.** Asked
  in the same session: *"is the auto schedule movein moveout inspection jobs
  in? Can't see it - where is it?"* It was: route, migration, panel, gate and
  fifty-seven server assertions, all green — and **not one test had ever
  rendered it**, which is exactly the state `roleLocked` was in when a general
  contractor could not scope a project manager to jobs. `test:autoturnui`
  drives Account → Company and reads the switch back, on **both** account kinds
  in the same place, because a panel checked on one branch is the diagonal
  coverage that left `hiresLabel` half-wired.

  **AND MY FIRST DIAGNOSIS OF WHY IT WOULD REFUSE WAS HALF WRONG, which is
  worth recording because the half I got wrong is the half this file keeps
  insisting on.** I said pressing On would answer an unexplained failure
  because 065 is unpasted. The **server was already right**: `app.onError`
  has answered `migration_needed` with the migration's name for every route
  since it was written, so a per-route catch is two records of one fact and
  the one I added was duly reverted. What was wrong was the **browser**, which
  printed *That didn't save. Try again.* over a 503 naming the file to paste —
  the catch-wide-enough-to-hide-a-real-error shape, in the one place that
  turns an actionable answer into a dead end. It reads `e.body.migration` now,
  and `test:autoturn` drops the column to prove the server names it.

  **AND `test:lightbox` HAD BEEN RED FOR A WHOLE RELEASE FOR A STALE REASON.**
  It counts the mounts rather than looking for one — deliberately, so a fix
  applied to one of two copies cannot pass — and its own comment says *a fourth
  place showing photographs should raise this number*. The work order's
  inspection panel was that fourth place and nobody raised it, so the suite sat
  at 28/1 with its one real assertion underneath: **a suite that is red for a
  stale reason is a suite nobody reads**, which this file already records about
  `test:subedit`, found again in the test written to catch the trap it fell
  into. Raised to four, with the fourth named, and the mutation still fires.

  One harness fault from the new suite, and it is this project's own: a
  degradation block read `.find` on a body that is a 503 object rather than an
  array, so it threw on exactly the case it exists to catch. Guarded with
  `Array.isArray(rows) ? … : null`.

  **Not verified here:** rebuilding `accounts` in the fixture with a subset of
  its columns answers 403 rather than 503, because the session lookup loses the
  columns it reads — `ALTER TABLE accounts DROP COLUMN auto_turnaround` is what
  reproduces an unmigrated database without taking the sign-in with it.

- **`CHECK.sql` HAD BEEN UNRUNNABLE IN THE CONSOLE FOR FIVE MIGRATIONS, AND
  THE SUITE THAT GUARDS IT WAS GREEN THROUGHOUT.** Pasted it to verify 063–067
  and got `too many columns in result set: SQLITE_ERROR`. **D1 refuses a result
  set wider than 100 columns.** The file was one row of 110, and 062 landed on
  exactly 100 — so **063 is the migration that killed it**, taking it to 102,
  and nothing has been able to answer *did I run that one?* since.

  **WHICH IS THIS FILE'S OLDEST SHAPE, pointed at the tool that exists to catch
  it.** The entry about `schema.sql` drift says it in so many words: *CHECK.sql
  could not even be run against a fresh database, so the one tool for spotting
  the drift was disabled BY the drift.* That was fixed. This is the same
  sentence with a different cause — **disabled by its own growth** — and the
  one place it is ever really run is an iPad, so the only way to find out was to
  paste it.

  **AND `schema-drift-test` PASSED EVERY TIME, because node:sqlite allows 2000
  columns where D1 allows 100.** The assertion was *it runs*, which was true
  locally and false where it matters. **A guard that runs where nobody is
  looking is a guard that reports to nobody** — written here one release ago
  about five red deploys, found again inside the suite built to catch this
  class. The new assertion reads the **width** and names the ceiling, and the
  mutation that proves it is the old file: `110 columns, D1 allows 100`.

  **ONE ROW PER CHECK, which is the shape that cannot come back.** `name` and
  `value`, 109 `UNION ALL`s. A bound on the number of entries would be the same
  bug waiting — entries are meant to grow with the folder — so the fix is a
  shape with no ceiling and an assertion on **two columns** rather than on a
  count. It also reads better on the device it is used from: a list of 110 named
  rows rather than one row 110 columns wide.

  **Splitting the paste in half was the obvious alternative and is refused**,
  in this file's own words about why `npm run paste` has no `check`
  sub-command: *a check query that is subtly wrong is worse than none.* Two
  hand-split pastes is two records of one fact, and the half somebody skips is
  the half that was going to report something.

  **`runCheck(db)` IS A HELPER BECAUSE SIX SUITES READ IT BY COLUMN NAME.**
  `db.prepare(CHECK).get().m057_inv_drafted_after_finish` was written out in
  `schema-drift`, `photo-draft`, `job-end`, `auto-turnaround`, `visit-party`
  and `inspect-summary` — so a change to the file's shape was six edits, which
  is how five of them would have been made and one forgotten. The helper hands
  back the object they all already wanted, so the thing a later change has to
  keep is **the function's** shape and not the file's.

  **THE CONVERTER COST FOUR ATTEMPTS AND EACH FAILURE IS THE SAME CLASS: SQL
  COMMENTS ARE NOT INERT.** Splitting 110 entries on top-level commas needs a
  scanner that skips strings **and** comments, because this file's comments
  carry a **comma** (031's note on `HIREABLE_KINDS`), carry a **semicolon** —
  which made `indexOf(";")` truncate the scan at entry 21 and silently produce
  22 chunks out of 110 — and because `m046_kind_check` compares against
  `'%CHECK (kind IN%'`, a **string literal holding an unmatched paren**. Fifth,
  sixth and seventh instances of *a comment reads to a scanner exactly like the
  code it describes*, in one afternoon, in one file.

  And the statement's `;` is **not at end of file**: a note about why 064 has no
  invariant sits after it, which `.get()` never saw because SQLite stops at the
  semicolon. The terminator has to be found by the same scan.

  **The header was rewritten rather than left**, because it said *read the row*
  and *MOST columns answer 1* over a file that no longer produces either — and
  that header already records being wrong once about exactly this, when it
  claimed every column answers 1 and a healthy database read four zeros. **A
  comment describing a shape the file no longer has is the screen-that-lies rule
  with nothing on screen to contradict it.**

  **Still open, and worth a decision rather than a guess:** nothing anywhere
  runs `CHECK.sql` against D1 itself. The width guard closes the one failure
  that was live, but a query that D1 rejects for some *other* reason — a
  pragma it does not serve, a function it lacks — would pass here and fail in
  the console exactly as this did. The only real check is pasting it, which is
  what found this.


- **THE PEOPLE BEING ASKED TO PRICE THE WORK COULD NOT SEE IT, AND THE ROOMS
  THEY GET ARE NARROWER THAN THE WINNER'S.** 062 carried the flagged rooms, the
  kept captions and the photographs to the company that **won** —
  `GET /api/work-orders/:id/inspection`. A quote request is **pre-award and has
  no work order**, so the two or three companies actually being asked for a
  number were the only readers who could not see the mark. Which is the wrong
  way round: a price given off a line of text is a price that changes when
  somebody gets there, and the moment the picture is worth most is before the
  number is given rather than after.

  **KEYED BY THE INVITE, which is what makes it safe rather than a second door
  into the Inspections tab.** Same shape and same reasoning as the work-order
  route: there is no route anywhere that takes an inspection id and describes
  it, so nothing can be walked. The invite names the request, the request names
  the job, the job names the inspection.

  **SCOPED EXACTLY AS `/api/my-quotes` IS, clause for clause.** The detail must
  be reachable for precisely the invites the list carries — narrower and a row
  on their own screen opens onto a refusal, wider and there is a door into a job
  their list does not show them. A cancelled or awarded request still answers,
  because it still appears on that list.

  **NARROWED TO THE TRADE'S OWN ROOMS, and that is the whole difference from the
  work-order view.** `quoteJobShape` already hands over one trade and not the
  job's list — *"the others are somebody else's to quote"* — and
  `inspectionTradeScopes` already narrows the **text** the same way, so a
  plumber asked to price plumbing gets the toilet rather than eleven rooms with
  the toilet somewhere in them. Read through the one `roomTrades` both of those
  use, so the words a company is given and the pictures beside them cannot name
  different rooms. The test asserts that **against the per-trade scope rather
  than against a literal**: a shape with its own matching could be internally
  consistent and still show rooms the text never mentioned, and the contractor
  reads both side by side.

  **DELIBERATELY STRICTER THAN THE WORK-ORDER VIEW, AND THE TWO MUST NOT BE
  HARMONISED.** The holder of a work order has the job, so the whole walk is
  context for work they are committed to. An invitee has a question, and two or
  three of them have the same one. Same component, same thumbnails, same
  lightbox, different redaction — the shape this file already records about an
  incoming manager's roll-up being stricter than an owner's.

  **AND THE PHOTO ROUTE IS NARROWED THE SAME WAY, which is the assertion that
  discriminates.** The work-order route pins a photograph with `isFlagged`, and
  a copy of that check here serves the painter's wall to the plumber while
  **every other assertion in the file passes** — the mutation that proves it
  fires three. So the photo route reads the ids off the **shape the panel was
  drawn from** rather than asking a second and looser question about the room:
  a picture can never come from a room the panel did not show.

  **A TRADE NOTHING MATCHED GETS NO ROOMS, never the whole walk as a
  fallback.** That is the same answer the scope gives in the same case — the
  manager typed that scope by hand, so which rooms it was about is not
  something this can know, and widening to all of them would hand over the unit
  because a word did not match.

  **AND NO SUMMARY.** It is written from every flagged room, so carrying it
  would put back in one paragraph exactly what the narrowing takes out.

  **ONE PANEL FOR BOTH AUDIENCES, and `test:lightbox` is where that is held.**
  `JobInspection` takes a `kind`, which picks the route the bytes come from and
  the sentence under the heading; everything else is identical. A second copy
  would be a second grid, a second thumbnail loader and a second lightbox to
  keep in step, and the one that rotted would be the quote door, since most jobs
  are assigned outright. Which needed that suite's own note corrected: it said
  *a fifth place showing photographs should raise this number*, and a fifth
  place has appeared and the number is right at four — **what goes up is the
  count of PANELS, not of grids**, so the assertion beside it is now one panel
  mounted by two audiences, and that a third audience either goes through it or
  earns a mount.

  **WHAT A HEADING READING "what the inspection found" SAYS OVER TWO ROOMS is
  the whole unit**, and somebody pricing off that has priced a unit rather than
  their own part of it. So the panel says which it is showing — *the rooms you
  are being asked about* — and that line is drawn **before** the evidence, since
  a reader who has already priced two rooms as the whole job has not been told
  anything by a footnote.

  **AND "the photograph really loaded" COULD NOT SEE WHICH ROUTE SERVED IT.**
  `ReportPhoto` fails only when the fetch rejects, and a stub answers something
  for every path, so a loader hard-coded to the work-order route still draws an
  `<img>` — the mutation survived with 57 green. The ask is counted **on the
  wire** now and the path is asserted, which is the only place that claim is
  checkable: there is no work order yet, which is the entire reason this route
  exists.

  **AND EVERY ROOM LINE IN THE SCOPE NOW CARRIES WHAT WAS WRITTEN ABOUT ITS
  PHOTOGRAPHS**, which is the other half of the same ask: *"describe it by room,
  give the issue, image, and summary or what the issue is"*. A room line said
  the room, the verdict and the note — and the note is very often the shorter
  half, because somebody photographs four marks in a bedroom, writes a sentence
  about each, and puts "Scuffing" in the room's own box. The captions were in
  the record and not on the document the price is given off.

  It is in **`scopeFrom`**, so it reaches the job's own stamped `jobs.scope` and
  every per-trade seed through one composer — the two must not word one walk two
  ways. Stamped, so nothing already raised moves.

  **THE KEPT CAPTION AND NEVER THE DRAFT, read off the FIELD rather than from
  which rooms were passed in.** `inspectionJobScope` runs at raise time with the
  **writable** shape, drafts included, so a composer reading `draft` would stamp
  a model's unkept sentence into `jobs.scope` where it reads as a finding
  somebody made. Reading `caption` alone is correct whichever shape arrives, and
  the fixture carries a room with a draft and no caption because that is the only
  row either reading can be told apart on.

  **NAMED AS A PHOTOGRAPH rather than run in with the note**, because a caption
  is a sentence about one picture and a reader standing in the room needs to know
  which of the four it refers to. Deduped against the note and against each
  other, since the commonest caption on a one-photograph room is the note again
  and a document saying it twice reads as two faults. **Uncapped**, deliberately:
  twelve captions is twelve faults, and a cap would silently drop one from the
  document somebody prices from, which is the failure this composer exists to
  stop reached from the other side.

  Seven server mutations and three browser ones fire, each on its own assertion.
  One harness fault worth keeping, and it is a new spelling of an old one: a
  regex written into the test through a Python heredoc had `\b` in a non-raw
  string, so `/<JobInspection\b/` became `/<JobInspection\x08/` and the count
  read zero — a selector that matches nothing, reporting the product as missing
  on a screen that had rendered perfectly, for the fourth time.


- **THE WALK ARRIVES FROM WHATEVER THEY ALREADY WALK UNITS IN, AND IT ARRIVES AS
  A DRAFT.** Jobs have posted in from somebody else's CRM since 048; an
  inspection is the other record a managing agent types twice — once in an
  inspection app on a tablet in the flat, once into SubSub so the work can be
  raised. Migration 068, `app/shared/inspectingest.js`, and the panel that hands
  over the address and answers what arrived meaning nothing.

  **IT IS NEVER FINISHED ON ARRIVAL, which is the decision everything else
  hangs off.** Finishing is a one-way door: it is what makes the inspection a
  document somebody quotes back months later, what writes the summary, and what
  lets the report go to the building's owner. A receiver that finished them
  would bake an unrecognised condition word **permanently into a record nobody
  can edit** — and the account's own press is one tap and is the thing that
  writes the summary anyway, so nothing is lost by waiting for it. The reply
  says `status: "draft"` while whoever is wiring it up is still looking at the
  screen, rather than leaving them to find out from a walk they cannot explain.

  **A WALK WHOSE CONDITION WORDS MEAN NOTHING STILL ARRIVES**, which is 049's
  argument one object along and the reason this has a queue at all. Every
  inspection app has its own scale — pass/fail, good/fair/poor, 1 to 5, A to C
  — and SubSub has four room statuses. Refusing a word is the worst answer
  available: the sender does not get a 200, so it retries, so it keeps not
  getting one, and **nobody is told** — the unit has no record of being walked
  and the only symptom is its absence. So those rooms land `unchecked`, the
  words are counted in `inspection_unmapped`, and the panel turns that count
  into one tap.

  **AND THE FALLBACK IS THE STRICT ANSWER.** `unchecked` rather than `ok`,
  because `ok` asserts that somebody walked the room and found nothing wrong —
  a claim nobody made, on the document a deposit argument is run from. It is
  also what keeps the walk out of being signed off, since `whyNotFinish`
  refuses an unanswered room.

  **THERE ARE NO SYNONYMS FOR `unchecked`, AND THAT IS NOT AN OMISSION.** It is
  already the fallback, so a built-in synonym for it — `n/a`, `skipped`,
  `unknown`, `not inspected` — would produce exactly the room an unrecognised
  word already produces and buy one thing only: **silence in the queue.**
  Silence about rooms nobody has walked is the one thing an inspection must not
  have, so those words go to the queue, where the account answers them once and
  they are quiet for ever. The room is identical either way; the difference is
  whether anybody was told, which is the whole of why the queue exists.

  **Nor is there a fifth status for "does not apply".** It would have to be
  answered by `inspectionTally`, `whyNotFinish`, `flaggedRooms`,
  `suggestTrades`, `inspectionJobScope`, `contractorInspectionShape`, the chips
  and the room form — eight places for a word — and this is a receiver, not the
  place to decide what an inspection can say. `Not checked` is offered as an
  answer on the panel precisely so an app sending "N/A" on rooms a flat does
  not have can be dealt with as a decision rather than as a guess.

  **RULES FIRST, BUILT-IN WORDS SECOND.** An account's "Fair" may well mean
  follow-up where ours says it is fine, and a built-in that outranked their rule
  would be a setting that does nothing. The rule is filed for **every** system
  unless one is named — 049's lesson taken at the start rather than after a
  release of rules that fired for nobody — and a source with no receiver is
  **refused rather than defaulted**, since a rule filed against a CRM the
  account does not use fires for nobody and does not clear its queue row either.

  **THE KIND IS REFUSED RATHER THAN GUESSED.** A move-in and a move-out are
  opposite documents and the entire value of the record is two dated walks of
  one unit — "the carpet was like that when I moved in" is the commonest dispute
  in the business. Every ordinary spelling is read; a word that places as
  neither is a 400 naming both, because defaulting would silently file a
  move-out as the move-in it is about to be compared against.

  **THE BUILDING IS FOUND, NEVER GUESSED EITHER.** An inspection has no address
  of its own — `inspections.property_id` is NOT NULL — so unlike a job there is
  nowhere to put a bare street and a building has to be resolved. Matching a
  name or address against **this account's own** properties is its own data,
  which is the line this file already draws about local name matching; whole
  value, case-insensitive, never a prefix. **Two matches are refused rather
  than resolved**: picking either files a walk of one flat against a different
  building, which is a job raised at the wrong address and a deposit record
  attached to the wrong tenancy, and nothing downstream would look wrong. Only
  a fixture with two buildings of one name can tell that from a lucky first row.

  **THE KIND GATE IS NOT THE JOBS ENDPOINT'S.** `apiCaller` refuses a
  non-`HIRING_KINDS` account, which lets a general contractor post jobs — and a
  general contractor keeps no buildings, so it has no unit to walk. So the
  inspections door adds `ACCOUNT_KINDS_WITH_PROPERTIES` and answers
  `no_buildings` by name. **The screen and the route read the same pair of
  gates**, including the rules routes, because a screen stricter than its route
  is the same lie as looser.

  **PHOTOGRAPHS ARE DELIBERATELY NOT ACCEPTED.** A webhook carries JSON and a
  photograph is bytes, so taking them would mean base64 inside the payload with
  its own ceiling, its own content-type checking and its own R2 path — a second
  upload route beside the checked one the screen already uses. The rooms, the
  conditions and the notes arrive; the pictures are added on the inspection.
  Said on the panel and in the docs rather than left to be discovered.

  **ONE RECEIVER, because nobody here has had a real payload from an inspection
  app in front of them.** `INSPECT_PRESETS` holds `generic` and `verified`
  records which that is true of — the rule `crmsources.js` states and the
  licensing dataset runs on: inventing plausible field names for an app
  produces an integration that looks supported, fails on first contact, and
  fails in the way that is hardest to debug. Common spellings of our own fields
  are read (`external_id`, `items`, `condition`, `completed_at`), so most
  systems need no mapping anyway.

  **THE OBJECT IS THE LAST SEGMENT OF THE HOOK ADDRESS**
  (`/v1/hooks/generic/<token>/inspections`), so the two addresses cannot be
  mistaken for each other by somebody pasting one into a field. And **the URL's
  source outranks the payload's**: somebody pasted that address, and it is the
  one fact about a delivery nobody can mistype into a different meaning.

  **BOTH ADDRESSES ARE PRINTED IN THE MINTED TOKEN BOX, and that is not
  convenience.** A token is hashed the moment that box closes, so **an address
  not printed then can never be printed whole again** — which is what made this
  a change to the token panel as well as a new one. Listed rather than hidden
  behind a picker, because nobody goes looking for a second address they have
  not been told exists. The inspections panel below prints the same address
  with `YOUR_TOKEN` in it and says why it cannot fill it in, which is strictly
  better than leaving somebody to assemble it out of the developer docs —
  the correct-pieces-and-no-way-in shape, in miniature.

  **THE QUEUE COUNTS ROOMS, NOT DELIVERIES, and the first version got it
  wrong.** One row per distinct word — twelve rooms saying "Poor" is one
  question — but the number on it is twelve, because the panel says *on N rooms
  so far* and that is the measure of how much of the walk is unreadable.
  Counting deliveries reported "1 room" over twelve, which is the wrong scale
  for deciding whether to answer it, and the suite caught it.

  **A RETRY COUNTS NOTHING.** The duplicate is recognised and returned **before**
  anything is written, because a redelivered walk is one walk and climbing
  `hits` on retries would report nine rooms where there was one room delivered
  nine times. Everything else about the retry is 048's shape: the pre-check
  makes the ordinary case cheap and hands back the id, `ux_inspection_sources_external`
  is what is correct when two deliveries arrive at once, and the two are **not
  interchangeable** — so the index is asserted directly.

  **AND THEY COVER FOR EACH OTHER IN A WAY WORTH RECORDING.** Deleting the
  pre-check leaves *one inspection, not two* passing: the insert runs, the index
  refuses the source row, the catch deletes the inspection again. What the
  pre-check uniquely buys is the assertion beside it — the queue is not
  re-counted — and that is the only one its mutation fires. Seventh time this
  file has recorded two guards covering for each other.

  **A QUEUE ROW IS WRITTEN BEFORE THE INSPECTION AND NEVER FAILS THE REQUEST.**
  The word *did* arrive, which is the fact the queue records, so a row left by a
  failed insert is still a rule worth having — where a word that arrived and was
  never counted is a room nobody is told about. A work queue that can break an
  integration is worse than one with a hole.

  **A BLANK CONDITION IS NOT A QUEUE ROW.** A room that said nothing lands
  `unchecked` and is counted in `needsAnswers`, because the panel's question is
  how much of the walk has no answer on it — but nothing arrived that we failed
  to understand, so there is nothing to ask about. Both halves are pinned, since
  dropping the guard puts an empty-string row in the queue.

  **`missingSchema` HAD TO LEARN THE THREE TABLES, or 068 answered
  `migration: "unknown"`** — a 503 somebody cannot act on, which is the shape
  this file records about `job_endings`. Each is named in full rather than by an
  `inspection_` prefix, because `inspection_summaries` (063) and
  `inspection_sends` (056) start the same way. Asserted on the **field** rather
  than the message, which is what caught it: the prose said 068 while the field
  a caller reads said nothing.

  **THE PUBLISHED PAGE IS THE THIRD RECORD.** `shared/inspectingest.js` exists
  so the route, the tests and `developers.html` agree, and the jobs receiver one
  feature along shipped with its **whole webhook address undocumented** — found
  by exactly this check. A field is documented when it has a **row somebody can
  read**, not when the string appears on the page, which is why the assertion
  reads the `<td>` cells; both doors, `needsAnswers`, `unmapped`, the
  always-a-draft rule and the `no_buildings` refusal are each pinned, and the
  panel the page sends somebody to is checked against a heading the app
  actually has.

  **BOTH ACCOUNT KINDS ARE DRIVEN IN THE SAME PLACE**, because a panel checked
  on one branch is the diagonal coverage that left `hiresLabel` half-wired — and
  the general-contractor block asserts the account screen **really opened**
  before asserting the panel is absent, since "there is no panel" passes loudest
  on a screen that never rendered. The ordering of the queue is **measured**
  rather than read off the source, because source order is not screen order;
  proving that assertion took a mutation that *moved* the block rather than one
  that deleted it, since deleting it fails sixteen other checks and says nothing
  about where it sits.

  Twenty-five mutations fire across the two suites, each on its own assertion —
  and **one did not apply on the first attempt**, which is the lesson this file
  keeps paying for: `if (seen) {` appears in `ingestJob` as well, so a
  first-occurrence patch mutated the jobs route and the inspections suite ran
  green against unmodified code. *Check the file changed, and that the change
  means something.*

  **Still open, and the user's call rather than a build:** a walk cannot be
  **updated**. A retry returns the inspection that exists and changes nothing,
  which is right for a redelivery and wrong for a correction made in the
  inspection app afterwards — and an update would have to decide what happens to
  rooms somebody has since edited here, to photographs added here, and to a job
  already raised off the back of it. That is a merge policy, not an endpoint.


- **A NOUN IS NOT A FAULT, AND A PHOTOGRAPH HAS NO STATUS OF ITS OWN.** Reported
  against a move-out with ONE flagged hallway and four pictures: the only thing
  wrong in the unit was a chipped door panel, and **Raise a job** came back with
  Electrical, Painting, Finish Carpentry, Flooring, Final Clean, Concrete and
  Windows/Doors ticked. *"Should only select trades for rooms/images that need
  to be fixed or followed up on."*

  Every extra trade was earned by a noun inside a sentence saying that thing was
  **fine**. *"Black rubber base trim intact with no visible damage or separation
  from flooring"* called a floor layer. Three of the four photographs recorded
  nothing wrong at all, and all three contributed.

  **THE ASYMMETRY IT TURNS ON IS A FACT ABOUT THE SCHEMA RATHER THAN A
  PREFERENCE: a room carries a status and a photograph does not.** `suggestTrades`
  already reads flagged rooms only, so the ROOM half of the report was already
  right. A note sits on a room somebody flagged, which establishes it as being
  about a problem, and its nouns are read as they were. A caption inherits
  nothing — and on a thorough walk most pictures exist precisely to record that
  something is fine. So **a photograph earns a trade only when its own words
  name a fault.**

  That is **one rule and not two**, which matters because this file already
  insists the positional-preposition guard be applied to the note as well: a
  trade is earned by a fault, and the two fields establish the fault differently
  because only one of them has a flag above it. Applying the fault filter to the
  note too is a mutation that fails three assertions, two of them pre-existing:
  *"Carpet."* on a flagged room is somebody saying the carpet is the problem,
  and a terse note has to keep working.

  **CLAUSE BY CLAUSE, NEVER CAPTION BY CAPTION.** The reported caption is two
  clauses — a chipped door panel and an intact trim — so dropping the whole
  caption loses the door and keeping it calls the floor layer. Both halves are
  asserted, because either alone passes with the other broken.

  **NEGATION IS SCOPED TO THE END OF ITS CLAUSE**, which is the construction the
  reported sentence actually used: *no visible damage **or separation from
  flooring*** has to negate both, or the second noun walks through. And it stops
  at the clause boundary, or one fine thing early in a caption would silence a
  real fault later in it.

  **CONTRAST SPLITS A CLAUSE; A COMMA DOES NOT.** *"Door panel, chipped"* is one
  thought with the noun on one side of the comma and the fault on the other, so
  splitting there would drop the door — which is the thing being reported. ` but `
  and its friends do split, because that is where a sentence changes its mind.

  **READ PER FIELD, NEVER AS ONE BLOB**, or a caption naming a fault keeps the
  draft beside it saying the carpet is fine, and every noun in it. **The fixture
  for that needed a caption with no full stop on it**, which is what somebody
  typing into a box actually writes: with one, the clause splitter separates the
  two fields by itself and the mutation survives. Found exactly that way, twice —
  the first attempt at the mutation joined with `". "` and did the splitting for
  itself, which is *check the change means something* in its subtlest form.

  **THE COST IS STATED RATHER THAN HIDDEN: a real fault phrased in words the list
  has not heard of earns nothing.** That is the right way round, because every
  chip is one tap to add and the opposite error is the one that was reported —
  seven trades on a job about a door is an electrician driving to a hallway. Bare
  `paint` and bare `clean` are deliberately absent from the fault list for the
  same reason: a painted finish in good order and a clean floor are not faults,
  and `needs` carries *needs a clean* and *needs repainting* on its own.

  **AND A PICTURE THAT WAS READ AND SAID NOTHING WRONG IS COUNTED.** Four
  photographs producing one chip has to be distinguishable from four nobody
  looked at, or the honest answer reads as the broken one — the same sentence
  `unread` already exists for, with the other half now said. Deliberately **not**
  folded into `unread`: *nobody has written about this* and *this was read and is
  fine* are different facts needing different actions, which is `docs.js`'s
  expired-and-never-added rule in a third place.

  **It reaches the scope and the quote redaction too, and that is correct rather
  than incidental.** `roomTrades` is the one matcher — `inspectionTradeScopes`
  splits the scope text with it and `quoteInspectionShape` picks a quote
  invitee's rooms with it — so a trade nothing faults no longer pulls a room into
  a scope or a photograph into somebody's quote pack. Ten mutations fire, each on
  its own assertion.


## Working here

- The app is `app/` (Vite + React, one large `App.tsx`), the API is
  `app/worker/index.js` (Hono on Cloudflare Workers + D1 + R2), and the
  marketing site is at the repo root.
- **RUN `npm run lint` BEFORE COMMITTING ANYTHING UNDER `app/`, and check the
  run went green after pushing.** All three deploy workflows run it before they
  build, so a lint error is not a failing test — it is a release that does not
  happen, silently from the outside. Five commits in a row once went red at that
  step over one undefined variable while every commit message said what had
  shipped; the person using the product was on a build from that morning and
  nothing told either of us. `eslint.config.mjs` is there for exactly one class
  of bug — a name used and never declared, which esbuild does not check and
  which white-screens the app on render.

- **THE MARKETING SITE IS THE FOURTH, AND IT WAS PUBLISHING THE REPOSITORY.**
  `wrangler.jsonc` at the root serves `"directory": "./"`, and wrangler's
  asset walk ignores nothing by default — not `app/`, not `.git`, not
  `node_modules` (which is how a run once died on a 126 MiB file). So every
  deploy of subsub.work uploaded the app's source, the Worker, the migrations
  and this file alongside the pages. It could not be confirmed against the
  live site from here — subsub.work is outside this environment's network —
  which is exactly why the workflow now confirms it from a runner.

  `.assetsignore` is an **allow-list**: ignore everything, then name the
  site's own files and its three generated sections, so a new file at the root
  is private until somebody adds it — the safe direction to be wrong in.
  `test:siteassets` applies it with wrangler's own matcher (the `ignore`
  package, the same three default patterns, the same recursive walk) to the
  real tree and checks both directions: nothing private by name **and by
  shape**, and nothing a page links to held back. wrangler's own debug log
  agreed with it to the file: 169 kept out of about 29,100.

  `deploy-site.yml` refuses to upload unless that suite and `test:discover`
  pass, removes `node_modules` before the upload, and then asks subsub.work
  itself for `/CLAUDE.md` and the Worker source and fails if either answers
  200. Cloudflare's own git-connected build, if still on, honours the same
  file.

- **Four things deploy, and each one is a button in the Actions tab** — the
  fourth, `deploy-site.yml`, is the marketing site above.
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

  **AND CHECKING THAT A RUN WENT GREEN HAS ITS OWN SILENT-FAILURE SHAPE.**
  `gh api "…/actions/runs?head_sha=<sha>"` answers `{"total_count":0,
  "workflow_runs":[]}` for a **short** sha — not an error, an empty list. So a
  poll written to wait for completions reads that as *not finished yet* and
  waits for ever, and it would read a **failed** deploy the same way: an empty
  list is indistinguishable from an unfinished one in that query. Which is this
  file's own lesson about the five red deploys, in the one tool left for
  checking them. `git rev-parse HEAD` first, and a watch on that endpoint has
  to treat `total_count: 0` as *the query is wrong* rather than as *nothing has
  happened*.

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

  **SQL GOES IN THE CHAT, NEVER IN AN ATTACHED FILE.** A file sent to the chat
  could not be opened on the iPad, so the check statements arrived as two
  things nobody could copy. Every migration and every CHECK.sql statement is
  pasted into the reply as its own code block, one per paste, comments
  stripped — even when that makes the reply long.

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

- **AND IT ANSWERED WITH A HUNDRED AND TEN NUMBERS AND A FOUR-PART RULE.** The
  entry above made `CHECK.sql` runnable. It did not make it readable: 110 rows
  on an iPad, where most must read 1 or more, three named ones must read 0,
  anything containing `_inv_` must read 0, and `m046_kind_check` is fine at 0 or
  2 and needs a migration at exactly 1. The reader applies that a hundred and
  ten times with their thumb, and the one bad number is at position 74.

  **The rule lived in the prose and in the reader's head, and the prose had
  already been wrong about it once** — an earlier header said *every column
  answers 1 for applied and 0 for not*, which would send somebody with a
  perfectly healthy database looking for four migrations that were never
  missing. That is this file's own screen-that-lies rule pointed at a comment,
  and it is the general case: **prose describing a rule is a second record of
  it, and the second record is the one that goes wrong.**

  So `verdict` is computed in the file, from the naming convention the file
  already keeps, and **the problems sort to the top** — `ORDER BY verdict =
  'ok'` puts the 0s first, so somebody reads the first row and stops. Three
  words rather than one, because *the migration has not been run* and *a route
  wrote rows the schema forbids* need opposite actions: `NOT RUN` means paste
  it, `BROKEN ROWS` means fix a route, `RUN 046` is the one tri-state. The same
  expired-versus-never-added distinction `docs.js` draws in colour.

  **`value` stays beside it**, which is what separates this from the per-migration
  check `npm run paste` refuses to generate: a verdict that is wrong is then
  visible rather than silent.

  **`instr(name, '_inv_')` AND NOT `LIKE '%_inv_%'`, because `_` is a LIKE
  wildcard.** That pattern matches any three characters around "inv", so it
  classifies `m027_invite_email`, `m028_user_invites` and `m038_invites` as
  invariants — a healthy database reporting three bug reports, which is the
  failure this column exists to remove, caused by the column. The mutation
  fires on five rows.

  **AND THE ORDERING COULD NOT BE CHECKED ON A CLEAN DATABASE.** Every row
  reads `ok` there, so any order satisfies "problems first" vacuously and
  deleting the `ORDER BY` passed every assertion — the could-not-fail shape, on
  the one property the column was added for. The fixture breaks
  `m039_unowned` with a single property row whose `owner_account_id` is NULL,
  which is a real violation of exactly the kind that read 1 on the live
  database once, and the assertion is that it is the **first** row rather than
  that it is somewhere in a sorted list: the reader looks at the top and
  nowhere else.

  **The two readers in `scripts/lib/check-sql.mjs` survived the wrapper by
  luck, and it is worth knowing why.** `checkExpr` counts parens from the
  entry's own `SELECT '<name>' AS name,` rather than from the start of the
  file, so wrapping the whole chain in `SELECT … FROM ( … )` leaves every
  entry's `AS value` at depth 0 where the scan expects it. Had it tracked depth
  from the top of the file, every one of its 110 entries would have become
  unfindable in one edit.

- **NINE TRADES, NINE EMPTY SCOPE BOXES, AND A QUOTE REQUEST THAT SENT
  EVERYBODY THE WHOLE WALK.** Reported with a move-out job on screen carrying
  nine trades and the job's own scope above them — *"From the move-out
  inspection of unit 10B: • Toilet — Follow-up • Living room — Follow-up •
  Bedroom 1 — Follow-up"* — with three red boxes: the work order line's **Scope
  for plumbing**, blank; and the **Ask for quotes** modal, whose *What they are
  pricing* was seeded with that same whole-job text. Asked for as *"auto-populate
  the content for each jobs scope ... and reduce the work of filling each out for
  the property manager"*.

  **THE ANSWER WAS ALREADY COMPUTED AND SPENT ON TICKING CHIPS.** `suggestTrades`
  reads each flagged room and decides which trades it names — that is why the
  plumbing chip is ticked when the toilet is flagged. The room that produced the
  trade **is** that trade's scope, and nothing was reading it that way, so the
  product knew the answer to nine questions and asked the manager all nine.

  **ONE MATCHING RULE, FACTORED OUT RATHER THAN COPIED.** `roomTrades(room)` is
  now its own function, read by `suggestTrades` for the grid and by
  `inspectionTradeScopes` for the text. Two copies would let a chip be ticked
  while the scope under it listed different rooms — and **the contractor reads
  the second one**, so that is the copy that would be wrong where it costs.
  `scopeFrom` is likewise shared with `inspectionJobScope`, so the job's scope
  and a trade's slice cannot word one walk two ways.

  **A TRADE NOTHING MATCHED GETS NOTHING, never a header with no rooms under
  it.** *From the move-out inspection of unit 10B:* on its own reads as a scope
  saying there is nothing to do, on the document somebody is about to put a price
  on — strictly worse than the blank box it replaces, because a blank box is
  visibly unanswered. The screen falls back to its own placeholder. The mutation
  that emits a header per known trade fails five assertions.

  **COMPOSED ON READ, NOT STAMPED, AND SO NO MIGRATION.** `jobs.scope` is written
  once at raise time and that is right for the job's own record. This is a **seed
  for a form**: photo drafts can be written after a job is raised, and a seed
  taken from the walk as it was would quietly hand over less than the inspection
  knows. Nothing reads it back, so there is nothing to store — which also keeps
  it off the paste backlog.

  **ONLY THE SERVER CAN ANSWER IT.** The browser has always held a job's `scope`
  as one string and has never held the rooms behind it, so a screen splitting
  that text per trade would be parsing our own rendered prose — the second
  implementation this file refuses everywhere. `GET /api/jobs/:id/trade-scope`,
  **admin or pm**: it answers a slice of the inspection, so it takes the
  Inspections tab's gate rather than the job's — a TENANT is on this account and
  an inspection is explicitly not shown to the tenant it is about, and a
  CONTRACTOR reads the walk through the work-order route, scoped to work they
  actually hold.

  **A JOB NOBODY WALKED ANSWERS AN EMPTY MAP, NOT A 404.** Most jobs were typed
  or arrived from a CRM. A refusal on the common case is a modal that has to
  decide whether a missing answer is a fault, so `{}` is the ordinary state and
  every caller reads one shape — including when the call fails.

  **DRAFTS DO NOT DECIDE WHAT A CONTRACTOR IS ASKED TO PRICE**, the same line the
  work-order shape and the owner's copy both draw: a sentence a model wrote and
  nobody kept is the team's working note. **The consequence is real and is
  recorded rather than hidden:** the inspection screen's chip grid *does* read
  drafts — it says *(photo: "cracked basin")* and marks the word as second-hand —
  so a trade ticked off a draft alone gets no seeded scope and the manager types
  that one. Two audiences, two answers, and the fallback is exactly the behaviour
  that existed before this.

  **ONE FETCH FOR BOTH MODALS.** `useJobTradeScope` is hoisted into the Jobs
  screen and handed to Assign and to Ask for quotes, because only one is ever
  open and two mounts of one record is two requests for it — the duplicate-state
  trap this file already refuses for the compliance pack panel.

  **SEEDED, NEVER FORCED.** It fills an untouched box and leaves a typed one
  alone, which is the rule the photo drafts already follow: a preselection
  somebody mistakes for their own words is worse than a blank. Each site guards
  on **its own flag** rather than on the box being empty, because a manager who
  clears the box has also made a choice, and the note says where the text came
  from while it is still untouched.

  **AND ONE ASSERTION COULD NOT FAIL, caught by the mutation written to prove
  it.** *The work order line leaves a typed scope alone* searched the whole of
  `App.tsx` for the flag — which the onChange sets and the note reads — so
  deleting the guard **from the effect** changed no outcome. Each check now reads
  its **own effect block**. Seven mutations fire, each on its own assertion.

  **Said rather than claimed: no browser suite drives this.** The effect runs on
  an answer that arrives after the modal opens, so the only real proof that the
  box fills is a drawn modal, and the static checks above are the class and not
  the behaviour.

  **Still open, and it is the other half of what was asked:** *"sending any
  relevant pictures to the contractor or handyman so they can give an appropriate
  price"*. 062 already does that for the company that **won** —
  `GET /api/work-orders/:id/inspection` — but a quote request is pre-award and
  there is no work order yet, so the people being asked to **price** the work
  still cannot see the photographs. That needs a route keyed by the quote invite
  with the same redaction, and it is its own piece.

- **AND THE FIX FOR THE COLUMN LIMIT WALKED STRAIGHT INTO THE NEXT ONE.** The
  rewritten file was pasted and D1 answered **`too many terms in compound
  SELECT`**. Every `UNION ALL` is a term and terms are capped too, so 110 rows
  is refused exactly as 110 columns was.

  **THE ENTRY ABOVE SAYS, IN ITS OWN WORDS, THAT THIS COULD NOT HAPPEN:**
  *"Rows, unlike columns, have no ceiling. Adding a check is one more `UNION
  ALL` and can never run the file into a limit again."* That was not a slip of
  phrasing, it was the reasoning — and it was wrong, which is why the file was
  shipped a second time without anybody looking for a second limit. **A fix
  that trades one ceiling for another is the same bug wearing the next limit
  along**, and the confident sentence is what stopped it being checked.

  So the fix this time is **not a bigger number, it is removing the thing that
  grows from the count at all.** The did-I-run-it half — one check per
  migration, which is the half that gets longer every week — is now **DATA**: a
  JSON list read through `json_each`, with `pragma_table_info(w.tbl)` taking
  the table name from the outer row. Seventy-nine checks, **one** compound
  term between them. What stays SQL is the 31 invariants, which are arbitrary
  queries that cannot be expressed as a list.

  **TWO STATEMENTS, AND THEY ANSWER DIFFERENT QUESTIONS ANYWAY.** *Did I run
  that one* and *is anything wrong* were always two things wearing one verdict
  column; splitting them is what lets statement 1 have no special cases at all.
  A rule with branches that can never fire is a rule somebody later reads as
  load-bearing. Statement 2 keeps the full rule, because two of its rows are
  **not** invariants: `m046_kind_check` is a tri-state and
  `m046_subdomain_unique` has to ask which column an index covers.

  **AND THE NEW GUARD IS ON THE SHAPE, NOT ON A NUMBER.** `D1_MAX_COMPOUND` is
  a deliberately generous bound — nobody here knows D1's real figure, only that
  it refused 110 and accepts 31 — so the assertion that matters is the other
  one: **the growing half costs one term however many checks are in it.** That
  is the property that stops this returning a third time, and tuning a constant
  would not have been. The mutation puts the data list back as a compound chain
  and fires both.

  **The per-check comments survived the conversion**, which is most of why it
  was done by a script rather than by hand: they are the record of why each
  check exists, and SQL comments sit **between the concatenated string pieces**
  (`'...' || -- note || '...'`), so each entry still carries its own. Adding a
  did-I-run-it check is now one line rather than a six-line SELECT.

  **And `schema-drift-test` was reading one statement**, because
  `prepare(checkSql())` takes only the leading one — so after the split the
  invariants went unchecked and every assertion about them passed on an empty
  list. `checkStatements` and `checkRows` are in the one reader module for the
  same reason `runCheck` is: nine suites wanted an object keyed by name before
  the file was split and still do.

  **Still open, and the honest limit: nothing here runs this against D1.** Both
  limits were found by a person pasting it on an iPad, twice. A local SQLite
  accepts far more of both, so the suite can prove the file parses, that the
  answers are right and that the shape stays small — and cannot prove D1 will
  take it. If statement 2 is ever refused, **split it; do not re-describe it.**

- **AND IT WAS REFUSED A THIRD TIME, ON THE LIMIT THE PREVIOUS FIX SAID IT WAS
  COMFORTABLY UNDER.** The entry above made the growing half cost no compound
  terms and left 31 invariants as a 31-term `UNION ALL`. D1 refused that too —
  the same `too many terms in compound SELECT`, from the same console, one
  paste later.

  **THE SENTENCE THAT SHIPPED IT IS THE WHOLE LESSON, AND IT IS THE SECOND
  TIME IN TWO CHANGES.** The first note said rows *"have no ceiling"*. Its
  correction then said 31 terms *"accepts this"* — on no evidence at all beyond
  110 having been refused. **"Under the number that failed" is not a
  measurement**, and a bound somebody reasons their way to is exactly as good
  as the reasoning: `D1_MAX_COMPOUND` was 60, which was generous right up to
  the paste that failed at 31. So the real ceiling is somewhere **below 31**
  and nobody here knows where, because the only place it can be measured is an
  iPad and every measurement costs a round trip to the person holding it.

  **SO THE FIX IS THE ONE THE PREVIOUS ENTRY INSTRUCTED: split it, do not
  re-describe it.** Five statements of seven terms and under, the same
  thirty-one expressions verbatim, the same verdict wrapper on each. Seven is
  not read off a spec either — the point is that it is *far* under the smallest
  number ever refused, which is the only kind of number that can be trusted
  without measuring.

  **AND THE OBVIOUS ONE-PASTE ALTERNATIVE IS WHAT THE INSTRUCTION EXISTS TO
  REFUSE.** The invariants could be unpivoted out of a `json_object` — or out
  of a `||`-concatenated list of `json_array(name, (SELECT …))`, which is the
  shape statement 1 already uses and which D1 demonstrably accepts at 79
  entries. It would be one paste and zero compound terms. **It would also be a
  third unverified ceiling**: `json_object` needs two arguments per invariant
  and D1 caps arguments per function (far lower than SQLite's own default), so
  the thing that grows would be pointed straight at the next limit along. A
  split has **no** ceiling — growth adds a statement, not a term — which is
  what makes it the answer rather than the fallback. Going round a third time
  would have been the same bug for the third time, and it was promised to the
  person pasting it that it would not be.

  **The cost is real and is the right trade: six pastes instead of two**, read
  one at a time. `verdict` is what makes that bearable — the first row of each
  statement is the whole answer — and the growing half is still free, so adding
  a migration never adds a paste. Adding an *invariant* can, which the header
  says in so many words: past seven, add a statement rather than lengthening
  one.

  **FIVE COPIES OF ONE VERDICT RULE IS THE NEW RISK, so it is asserted.** Each
  statement carries its own `CASE`, and a copy that drifted would report a
  healthy database as broken — or a broken one as healthy — for whichever
  handful of invariants happened to land in it. `schema-drift-test` normalises
  the text above each `FROM (` and requires exactly one distinct wrapper across
  all five; deleting the `m046_kind_check` branch from one of them fails it.

  **And the ordering assertion had to stop naming a position.** It read
  `parts[1]`, which was right only because `m039_unowned` is the third
  invariant; the suite now finds the statement that row actually landed in.
  Hard-coding an index would be right today and wrong the moment an invariant
  is added, **which is the same thing as not checking it** — proved by moving
  the entry to the last statement, where `find` passes and `parts[1]` fails.

  **AND `npm run paste check` PRINTS IT PASTEABLE, which the file had always
  needed and which only the split made safe to write.** That script's own note
  recorded why there was no `check` sub-command: pulling ONE migration's entries
  out meant splitting the list on top-level commas, and `m046_kind_check`'s
  `'%CHECK (kind IN%'` sends a paren count off by one for the rest of the file.
  **That objection was to a SUBSET, not to printing the thing.** The file is now
  six statements and `checkStatements` already splits them for nine suites, so
  the whole of it comes out comment-stripped: about forty lines a statement
  instead of a hundred and fifteen, which is the difference between pasteable on
  an iPad and not.

  `pasteForm` therefore lives in the reader module and **both** the printer and
  the test read it, because `schema-drift-test` can only prove the printed query
  answers what the file answers about the strip it actually uses. A whole-line
  strip that ever ate a line of SQL would print a check that is subtly wrong,
  which is the shape that reported 1,1,1,0,0 over an `agreements` table missing
  fourteen columns — **the thing that gets used being the thing nothing tests.**

  **And a mutation that applied and proved nothing is worth recording, because
  it is the inverse of the usual trap.** The first attempt at that guard
  rewrote `!l.trim().startsWith("--")` into
  `!l.trim().startsWith("--") || l.includes("UNION")`, which parses as *keep it
  if it is not a comment, OR if it contains UNION* — the same set of lines, a
  no-op wearing a diff. The suite stayed green and the conclusion looked like
  "the assertion cannot fail". **`!` binds to the call, not to the clause**, so
  checking the file changed is not enough: check the file changed *and that the
  change means something.*

  **Still open, and unchanged by any of this: nothing here runs this against
  D1.** Three refusals, all three found by a person pasting it. Local SQLite
  allows 2000 columns and 500 compound terms, so this suite can prove the file
  parses, that the answers are right and that the shape stays small — and
  cannot prove D1 will take it. If a statement is refused again, **split it
  smaller; the limit is lower than anybody here has guessed, twice.**

- **AND A FOURTH TIME, AT SEVEN TERMS — SO THE ANSWER IS NO TERMS AT ALL.** The
  entry above split the 31 invariants into five statements of seven and under,
  on the reasoning that *far* under the number that failed is safe without
  measuring. D1 refused the first of them. `too many terms in compound SELECT`
  at **seven**.

  **THREE GUESSES, THREE REFUSALS, AND EACH ONE WAS WRITTEN DOWN HERE AS
  SOUND.** "Rows have no ceiling." "31 accepts this." "Seven is far enough
  under 31." Every one of those was reasoning rather than evidence, and the
  file recorded the reasoning each time as though recording it made it hold. So
  the lesson is not a smaller number: **a limit nobody has measured cannot be
  respected by arithmetic.** Any number above zero is the same bet again, and
  the only one that cannot lose is zero.

  **BOTH STATEMENTS NOW BUILD A JSON ARRAY WITH `||` AND READ IT BACK THROUGH
  `json_each`**, which is not a fourth guess: it is the one shape D1 has
  actually been seen to accept — **79 entries of it, in statement 1, which ran
  cleanly on the same iPad in the same minute that everything else was being
  refused.** Each invariant is `json_array(name, (SELECT …))`, the pairs are
  concatenated, and a JSON array of pairs becomes 31 rows. Zero compound terms,
  two statements, two pastes.

  **`json_object` IS THE TIDIER SPELLING AND IS STILL REFUSED**, for exactly the
  reason the entry above refused it: it needs two arguments per entry, D1 caps
  arguments per function far below SQLite's own default, and the thing that
  grows would point straight at the next ceiling. `json_array(name, value)` is
  **two arguments per call** however long the list gets. That distinction is
  the whole of why this is not the trade that failed three times — the previous
  entry rejected the json route on the 62-argument form and never noticed that
  per-pair calls do not have the problem.

  **I SAID I WOULD SPLIT RATHER THAN REDESIGN, AND THEN REDESIGNED.** Worth
  recording plainly. The promise was made when splitting looked like it
  converged; at seven terms it does not — the remaining honest split is one
  invariant per statement, which is thirty-one pastes. **A commitment made on a
  premise that turns out false is not kept by honouring it anyway**, and the
  cost of pretending otherwise would have been paid by the person pasting.

  **`D1_MAX_COMPOUND` IS NOW 0, which is a rule rather than a bound.** The
  drift test asserts the count of `UNION ALL`s is zero rather than under some
  figure, because a figure is what was wrong three times. Beside it, the
  property that stops this returning: **both halves carry their entries as
  data**, so a migration adds a line and an invariant adds a piece and neither
  adds a term anywhere. Asserted on the row counts too — an emptied statement
  satisfies a term check trivially, which is the mutation that proves it.

  **AND `checkExpr` HAS NOW BEEN BROKEN BY THREE REWRITES OF THIS FILE**, which
  is the argument for it existing. It matched `AS m054_…`, then
  `SELECT '<name>' AS name,`, now `json_array('<name>', `; two suites
  (`propscope`, `sub-signup`) run a single check against a hand-built database
  and would each have carried their own copy of the shape. One function, one
  edit per rewrite, and the mutation that drops its paren guard crashes both.

  **AND IT RAN.** Both statements answered in the console on the first attempt
  after four refusals, 110 rows, every verdict `ok`. So the shape is no longer
  reasoned about — it is the one that has been seen to work, which is what every
  previous note in this saga claimed about a number instead.

  Two readings from that run are worth keeping, because they are the answers
  somebody will look for next time. **`m046_kind_check` is 0, which means do not
  run 046**: this database grew through the migrations, so `accounts.kind` has no
  CHECK on it and the subcontractor kind stores with nothing pasted — exactly the
  case that entry describes as the common one. And
  **`m057_inv_drafted_after_finish` is 0 where it read 8**, which is the
  ISO-versus-`CURRENT_TIMESTAMP` comparison fixed and confirmed against the live
  rows rather than against a seeded fixture.

  **Still open, and now the only thing left worth measuring: nobody knows D1's
  compound limit.** It is below seven. Four refusals, all four found by a person
  pasting on an iPad; local SQLite allows 500, so nothing here can see it. It no
  longer matters for this file, which uses none — but any **other** query in
  this repository that grows a `UNION` chain is in exactly the position this one
  was in, and the number it may not reach is smaller than anybody would guess.

- **THE SEED WAS WRITTEN AND WIPED BEFORE ANYTHING COULD DRAW IT, AND THE NOTE
  BESIDE THE BOX WENT ON CLAIMING IT.** Reported as *"the scope is empty still
  when raising a job for an inspection follow up … should be prepopulated"*,
  with the work-order modal on screen: an empty **Scope for painting** box, its
  placeholder showing, and the italic note under it reading *"Filled in from the
  painting rooms on the inspection. Edit it if you want."*

  **EVERY PIECE OF THE FEATURE WAS WORKING.** `GET /api/jobs/:id/trade-scope`
  answered, `useJobTradeScope` fetched it, the seeding effect in
  `PickContractor` ran, and `lines` held the text. Then `pickSub` — which runs
  when somebody picks the contractor, and is the press that makes the scope
  boxes exist at all — replaced the whole of `lines` with a fresh object whose
  every scope was `""`. **The box the seed is for does not exist until after
  the thing that wipes it**, so the seed was correct, applied, and unobservable.

  **THE NOTE AND THE BOX ARE TWO RECORDS OF ONE FACT, AND THE ONE PEOPLE READ
  WENT WRONG.** The note is gated on `tradeScopes[t]`, which `pickSub` never
  touched, so it kept announcing a fill that had just been undone — the
  screen-that-lies rule, inside a single label. Which is also why the report
  reads as a feature that was never built rather than as one press too many:
  the screen says it happened.

  **NO STATIC CHECK COULD SEE IT, and `test:tradescope` passed throughout.**
  The effect is exactly right, its typed-guard is exactly right, `pickSub` is
  exactly right for everything it was written to initialise, and the bug is only
  in the ORDER of two correct pieces. That suite asserts the effect and the
  guard in the source — which is the class this project keeps catching from the
  other direction, an assertion that cannot fail; this is its sibling, an
  assertion that can only ever have been about the wrong half. The only witness
  is the drawn textarea after the pick, so `test:scopeseed` drives the modal and
  reads it back.

  **`typed.current` IS STILL WHAT DECIDES, so a box somebody CLEARED stays
  cleared.** Putting the seed back over an emptied box is the
  preselection-mistaken-for-a-choice failure one press along, and it is a real
  path: pick a contractor, clear the box, press Back, pick somebody else. The
  mutation that drops that half fails exactly that assertion.

  **AND THE NEGATIVE HALF IS ASSERTED IN THE SAME PLACE.** A "fix" that filled
  every box, or that fell back to the job's whole scope when a trade had no
  slice, passes every positive assertion and puts eleven rooms on a work order
  for the one trade the walk said nothing about — which is the failure
  `inspectionTradeScopes` exists to prevent, reintroduced one layer up. Three
  mutations fire, each on its own assertion: the blank-out restored, the typed
  guard dropped, and the job-scope fallback added.

  One harness trap worth keeping, and it is this file's own: `.fld-note` is also
  the class on the value field's hint (*"their pay for this trade only"*), so a
  bare lookup inside the line found whichever existed and reported the value's
  note as the scope's — the `.embed-code-btn` trap, from the selector side. The
  note is read off the textarea's own label.

- **THE INSPECTIONS WEBHOOK WAS DOCUMENTED AND UNREACHABLE, WHICH IS THE
  NO-WAY-IN FAILURE ON THE OTHER SIDE OF THE API.** 068 shipped the receiver
  *and* its section on `developers.html` — both addresses, a row per field, the
  conditions queue, the always-a-draft rule — with `test:discover` pinning each
  of those against `shared/inspectingest.js`. What it did not ship is any way to
  arrive at it: the section carried **no `id`**, so nothing could link to it,
  and the one footer link on every page reads *Connect your CRM*.

  **AN INSPECTION APP IS NOT A CRM**, so a managing agent who walks units on a
  tablet never presses that link — the reading error this file already records
  twice, about naming the page after one CRM and about filing it under
  *Developer tools*. Third instance, and the first where the words were right
  and the **door** was missing.

  **THE PAGE IS DELIBERATELY NOT RENAMED, and that is the decision rather than
  the shortcut.** Nearly every reader is connecting a CRM; a heading vague
  enough to cover an inspection app as well (*Connect your systems*) makes the
  common case worse to serve the rarer one, which is the trade refused where the
  account switcher keeps its flat list under the threshold. **Two named doors
  into one page** is the answer: `id="inspections"` and a second Resources entry,
  *Send inspections in*. The URL stays `/developers` — a URL is not a heading.

  **AND THE INDEX ANSWERS IT IN THE TIER IT HONESTLY BELONGS IN.** That section
  opens *"Keep scheduling wherever you schedule"* and its three cards are about
  CRMs, so the one page a prospect reads never said unit walks arrive at all.
  Where it goes is decided by the rule the section already runs on: a name under
  **Built in** is a promise that SubSub reads that system's own fields, and
  `INSPECT_PRESETS` carries `generic` alone because nobody here has seen a real
  payload from an inspection app. So the sentence names the **shape** —
  anything that can send a web request, or an automation tool in front of
  anything that cannot — and **no product at all**.

  **The guard is on the positioning rather than on the sentence.** The existing
  check compares `data-src` against the verified presets exactly, which cannot
  see a name added **without** one — so every `<li>` in the Built-in card must
  carry a `data-src`, and the inspections line must sit outside the three cards,
  because it is a second object arriving rather than a fourth kind of sender.
  Adding `<li>AppFolio Inspections</li>` to that card fails two assertions.

  **AND MY OWN NEW ASSERTION COULD NOT FAIL, caught by mutation on the first
  run.** *The index names unit inspections* read the section with a substring,
  and the note above the paragraph explains why inspections are tier three — so
  it contains the word, and deleting the sentence left the check green **on its
  own explanation**. Seventh instance of a comment reading to a scanner exactly
  like the code it describes, this time in HTML and in a test I had just
  written. `noComments` strips `<!-- … -->` first; the mutation then fires two.

  Four mutations fire: the anchor removed, one page losing the footer link, an
  unbacked name in the Built-in card, and the index sentence deleted.

  **Not verified here:** the marketing site at the repo root has **no deploy
  workflow** — `deploy-app.yml`, `deploy-api.yml` and `deploy-admin.yml` all
  watch `app/` — so these pages reach subsub.work by whatever is connected to
  the repository rather than through Actions, and a push cannot be confirmed
  green the way the other three can. Worth a workflow of its own, for the reason
  the customer app got one: *a deploy nobody can press is a deploy nobody can
  fix*, and this one cannot even be watched.

- **STRIPE CLOSED ACCOUNTS V1 TO NEW INTEGRATIONS, AND THE REFUSAL WAS PRINTED
  TO A ROOFER.** Reported from Account → Company → **Getting paid**, under the
  heading *A few details before we can pay you*:

  > Stripe refused that: Stripe no longer recommends Accounts v1 for new
  > Connect integrations. Create connected accounts with POST
  > /v2/core/accounts instead … If your integration requires v1 account
  > creation for a supported compatibility scenario, **enable Accounts v1
  > support in the Dashboard: https://dashboard.stripe.com/settings/…**

  **EVERY WORD OF THAT IS ADDRESSED TO SUBSUB** — our endpoint choice, our
  dashboard, our API policy. The person reading it runs a roofing company. They
  were shown our configuration problem as though it were their paperwork, with
  an instruction they cannot carry out and a link to an account they cannot
  open, on the one screen they cannot get paid without.

  **THE PANEL'S OWN NOTE SAID THE OPPOSITE IN SO MANY WORDS**, which is why it
  shipped: *"this panel is read by exactly one person, the admin setting
  payouts up, who is the only one who can act on what Stripe actually said."*
  True of the refusals it was written for — a photo ID, an address Stripe would
  not take — and false for a whole class it did not anticipate. **A premise
  that is true of every case you have seen is still a premise.**

  **WHAT SEPARATES THE TWO IS NOT AN ERROR CODE, and that is what makes this
  safe to decide.** At the moment the connected account is **minted**, Stripe
  has been told nothing about this company beyond an email: no identity to
  reject, no document outstanding, no bank account to refuse. So a refusal
  there is about our request or our platform settings **by construction**, and
  no reading of `error.code` is needed — which matters, because the codes are
  Stripe's to change and a classifier built on them would be a second record of
  a fact the call site already knows. After the account exists — the session,
  the link, the refresh — a refusal may well be theirs, and Stripe's words lead
  exactly as before. Both branches are asserted in the same place, because a
  "fix" routing every Stripe refusal through the new code would pass every
  assertion about the first and silence the only class the reader can act on.

  **STAFF STANDING IN GET THE SENTENCE, because they ARE that party.**
  `mintDetailFor` reads `impersonatedBy`, which comes off the session **row**,
  so there is nothing a customer can send to claim it — the same property
  `staffMayWriteShared` already relies on. Withholding it there would hide the
  one message that says what to go and change.

  **AND THE HEADING HAD TO FOLLOW, which my own new assertion caught.** The
  first version fixed the sentence and left *A few details before we can pay
  you* above it — so the panel said the hold-up was theirs in the larger type
  and ours in the smaller. The cause is that the panel kept only the **rendered
  sentence** and threw away what went wrong, so the line above it had nothing
  to read: one state (`failed`) now holds the error and both are derived from
  it. **Two records of one fact, with the louder one wrong**, found only by
  driving the drawn panel.

  **A BLANKET `replace` ACROSS `App.tsx` IS A REFACTOR OF EVERY COMPONENT.**
  Renaming `setErr` inside `PayoutSetup` was done with a whole-file replace, and
  `setBusy(true); setErr("");` appears in dozens of components — 45 `no-undef`
  errors, and it also clobbered `ReportPhoto`'s own unrelated `setFailed`.
  `npm run lint` named every one in a second, which is the entire argument for
  the rule in `## Working here`. A rename inside one function is scoped to that
  function's line range, and the diff is read back afterwards.

  **WHAT THIS DELIBERATELY DOES NOT DO: migrate to `POST /v2/core/accounts`.**
  `docs.stripe.com` is blocked by this session's egress proxy, so the v2
  reference could not be read — and the doc URLs search returns carry
  `?api-version=…preview`, so it is a **preview-versioned** API. Writing the
  migration from search snippets would be exactly the confident-and-wrong
  answer this file records twice about Stripe: *only Stripe knows which
  combinations it accepts, so the first real press was always going to be the
  test* — `losses.payments` and the controller shape both. Accounts v2 changes
  the create body, the capability names, where requirements live and probably
  how an Account Session is minted, and `rowFromStripe` reads **all** of that.
  Guessing it would not be one wrong field, it would be a payments integration
  that looks shipped.

  **The immediate answer is the one Stripe's own message gives: enable Accounts
  v1 support in the Dashboard.** One toggle, no code, and it is a supported
  compatibility path rather than a workaround. The v2 migration is its own
  piece, and it needs the reference open.

  Three server mutations and two browser ones fire, each on its own assertion:
  the mint refusal routed back through `stripe_failed` with the detail on it
  (which reproduces the report exactly), the detail handed to everybody, the
  detail withheld from staff, the heading reverted, and the sentence reverted.
