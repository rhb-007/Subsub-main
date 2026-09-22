# Launch list

The order things get done in, and what "done" means for each. Kept here
rather than in a chat thread because a long build generates a lot of side
issues, and a list that lives only in conversation is one that quietly
becomes whatever was most recently urgent.

**The rule: side issues do not reorder this list.** A bug found while doing
item 2 gets fixed if it blocks item 2, and otherwise gets written down under
"Found along the way" and left there until the blocking items are done.

Status: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Blocking launch

- [x] **1. Console UI** — dashboard, range picker, trend chart, forms,
      responsive layout.
- [x] **2. Embedded checkout** — the card form renders inside the SubSub
      page. Needed the publishable key on the **subsub-app** Pages project
      rather than on the API, and `ui_mode: embedded_page` — Stripe renamed
      the old value and refused the session outright.
- [~] **3. Stripe live mode** — the actual gate on taking money. Everything
      today is test mode, so no real card can pay. Recreate the two prices
      in live mode, swap the secret key and webhook secret, take one real
      charge.
      *Done when:* a real card has paid and the account shows Scale.
- [ ] **4. Two-factor on Cloudflare** — the whole business sits behind that
      one login. Ten minutes, highest value per minute of anything left.
- [ ] **5. "Book a demo" sends nothing at all.** The form on
      `book-a-demo.html` picks a day and a slot, validates the three fields,
      and then shows *"You're booked. We've sent a calendar invite to
      &lt;email&gt;"* — having made no request of any kind. No fetch, no form
      action, no mailto. Every demo booked since that page went up was told
      an invite was on its way and nobody was ever told they asked.
      `get-started.html` does post to the real API; this one never did.
      *Found by audit, not by a report, which is the worrying part: nobody
      complains about a booking they think went through.*
      *Done when:* a booking reaches something a person reads. See the Cal
      integration below, or a plain POST to the Worker in the meantime.
      *Done when:* 2FA is on for Cloudflare, and for the Google account if
      it can reach Cloudflare.
- [x] **5. Send invites, by email and text** — done for tenants: the account
      types in who lives where, or uploads the list it already keeps, and
      SubSub sends the invite. Email works today (Resend is configured).
      **Text needs Twilio credentials** — `TWILIO_ACCOUNT_SID`,
      `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` — and until they are set, a text is
      reported as not sent rather than silently dropped.
      Still to do: the same for **subcontractor** invites, which are still a
      link the account copies.
- [ ] **6. Subcontractor invites, sent the same way** — the tenant side is
      done; a subcontractor invite is still a link somebody copies. Same
      machinery, one audience along.
- [ ] **7. Photos on a tenant report** — a picture of the leak is worth more
      than the paragraph describing it: it decides which trade goes out, and
      often whether anyone needs to go out twice. Jobs already carry uploaded
      files and the bucket is already there, so this is a camera button on the
      report form, thumbnails on the job, and nothing new underneath.
      *Done when:* a tenant can attach photos from a phone, and they appear on
      the job the contractor is sent.

## Worth doing when tenants are in real use

- Telling a tenant when something changes. They see status when they look;
  they are not told, and "has anyone done anything" is the question the
  feature exists to stop being asked by phone.
- Whether a building is flats or offices is guessed from the account type,
  which is the only signal there is. A management company holding both gets the
  residential list when browsing; typing finds either. A flag on the property
  itself would settle it properly.

## Asked for, queued

Written down the day they were asked for, with what each actually involves
from a look at the code rather than a guess. Order is the asking order, not
a judgement about which matters most.

- [ ] **Google sign-in on user accounts.** The plumbing already exists:
      `signInWithOAuth` is wired for the platform console and the Supabase
      client is shared. What is missing is the provider enabled in Supabase,
      the Google OAuth client, and the button on the customer sign-in
      screens — including the branded ones, where "Sign in with Google" has
      to sit sensibly next to a customer's own logo.
      *Watch for:* a person who signs in with Google on an address that
      already has a password, and tenants invited at an address that is not
      the Google one they use.

- [ ] **Cal integration for Book a demo.** Blocking item 5 above is the
      same thing seen from the other end. The page already has a working
      day-and-slot picker, so the honest minimum is posting the booking
      somewhere; the real answer is real availability, a real invite and a
      real video link.

- [x] **Loose ends audit.** Done — the findings are in this file: blocking
      item 5, and the two notes added under "Known, not blocking" below.
      What was checked: every client API call against the Worker's routes
      (all 76 resolve), every migration against the schema, every
      environment variable the Worker reads, and the whole test suite.

- [ ] **Contractor licence checks in all 50 states.** Today it is six
      states and the District of Columbia — WA, OR, CT, IA, IL, TX — each
      wired directly to that state's own open-data endpoint. Two separate
      problems hide behind "add the rest": most states publish nothing
      comparable, which is what a paid aggregator is for, and of the six
      already here only Washington's field mapping has been verified
      against real records. The other five are marked
      `fieldMappingVerified: false` in the code and their status text may be
      reading the wrong column.
      *Do the verification before the expansion:* five states quietly
      wrong is worse than forty-four honestly unsupported.

- [ ] **Hover and CompanyCam on roofing work orders.** Measurement and site
      photos attached to the work order. Report photos (022) already prove
      the shape: upload through the Worker into R2, serve back only through
      a route that re-checks who is asking, never by key. These would be
      pulled from a third party rather than uploaded, so the new parts are
      the OAuth per account and deciding what happens when the third party
      is down — a work order that cannot be issued because CompanyCam is
      unreachable is the failure to design against.

## Parked — deliberately not before launch

Bot protection on the signup form (Turnstile) ·
daily stats rollup in the console.

(Licence verification outside Washington used to be parked here. Six states
and DC are wired up now, so it has moved to "Asked for, queued" above as the
50-state item — with the caveat that five of those six mappings are still
unverified.)

## Found along the way

Fixed as encountered, because each one blocked something on the list:

- Branded hostnames were a manual Cloudflare step per customer — now
  provisioned automatically, with a retry sweep and status in both consoles.
- The nightly cron had never run once: `wrangler.toml` declared a schedule
  and the Worker exported a Hono app, which has no `scheduled` handler.
- "Sign in as this account" set the browser's idea of who it was and handed
  over no session the API would accept.
- Password reset asked for a user called `undefined` — the row carries
  `userId`, the caller read `u.id`.
- Console-created users had no Supabase account, so reset had nothing to
  send to.
- Revenue reporting dropped downgrades entirely, so logged MRR drifted above
  the real figure and never came back.
- Nothing in the app handled a confirmation or reset link, so a working one
  did nothing and a failed one looked identical.
- Stripe moved `current_period_end` onto subscription items, so the renewal
  date was never stored and the plan line had no date to show.
- An account's type (general contractor, property manager, and so on) could
  only be corrected in the database, so one picked wrongly at signup was
  stuck. The console can now change it — Accounts, open the account, Account
  type — and it is superadmin-only, because it decides whether the account
  keeps a building list.
- The logo and company name in both headers did nothing when clicked, which
  is the one thing every other site on the web has trained people to try.
- A job's property was never saved. The column existed and was cleared when a
  building was deleted, but nothing wrote it and nothing read it, so a job's
  building survived until the page reloaded. Owner scoping is built on that
  link, so it had to be real first.
- Two taps on a property picker in the same instant kept only the second.
- A seat's role read as "Property manager (property manager)" whenever the
  account's own type was the same word as the role.
- The tenant vocabulary shipped in British English — flat, tap, cupboard,
  lift, fuse box, mould. Rewritten: apartment, faucet, cabinet, elevator,
  breaker, mold. The unit field now asks an office for a suite and an
  apartment for an apartment.
- Switching an account's type to "general contractor" left any scoped seat on
  it with no building list, and their dashboard crashed on it rather than
  showing an empty one.
- The role called "Project Manager" is now "Property manager" throughout.
  These accounts are property businesses; project-manager was general
  contractor language that had been left on the role everywhere.
- The sign-in address could be typed into but never saved. The account page
  sent name, logo and colours and silently left the subdomain out, and
  `PATCH /api/account` did not read the field at all — so it said "Saved",
  showed the new address, and was back to the old one after a reload. It now
  saves, refuses a reserved or already-taken name in words, takes the old
  hostname down at Cloudflare and puts the new one up, and writes the change
  into the account's activity so support can see it.
- "Open the live application form" signed you out and showed SubSub's own
  generic sign-up instead of the company's. It now opens the real form at the
  company's own address in a new tab, and that address serves it directly
  (`/?apply=1`) rather than only via the sign-in page.
- Back out of the application form left the site altogether — to whatever the
  tab held before, which after an upgrade is Stripe's checkout page. The
  public views now push a history entry, so Back returns to the sign-in page.
- The "address is setting up" panel never went green by itself. Its poll
  depended on a callback the parent rewrote on every render, and the parent
  re-renders once a second off the clock, so the twenty-second timer was
  destroyed and rebuilt before it could ever fire.
- The three cards on My account -> Company sat flush against each other.
- A request could only be approved, never refused, so one the manager was
  never going to do sat on the dashboard forever and the person who asked
  was never told. There is a decline now (migration 021), with a required
  reason that goes straight to them -- "declined" with no explanation is
  what makes somebody phone the office, which is the thing this replaces.
  Approving a refused one reverses it.
- A tenant can now see their closed-out reports (done, or taken back) under
  "Past reports", take a live one back -- it fixed itself -- with a reason,
  which voids any work order on it so nobody turns up, and correct one
  within ten minutes of making it, until the manager has acted on it.
  Withdrawn jobs sit with completed ones on the manager's Jobs tab, marked
  as withdrawn by the tenant with the reason (migration 020).
- A report went from "contractor assigned" to "done" with the tenant told
  nothing about when anybody would turn up. There is a visit now (migration
  019): the manager or the contractor proposes a date and a window, the
  tenant confirms it or says it doesn't work -- with why -- in the app, and
  only a confirmed visit puts a date on the job or reads as "Scheduled" to
  them. A declined one lands on the manager's dashboard with the reason.
- An unapproved request from an owner or a tenant was counted as needing a
  contractor -- listed under "Needs a contractor", counted in the unassigned
  trade slots, and offered as somewhere to put a subcontractor, which the
  API then refused. Until the manager approves it, it has no trade slots
  anywhere; it sits under "Asked for by owners and tenants" and only that.
- A tenant is now told when a report of theirs moves -- approved, gone to a
  contractor, contractor assigned, done -- by email by default, by text as
  well if they ask, or not at all. The choice is theirs, under My account,
  and lives on the person (migration 018: `users.notify`), not the account.
  The tenant nav had nothing in it; it has Dashboard and File a report.
- A tenant who set a password from their invite and then signed in was
  refused with Supabase's own words, "Email not confirmed" -- because the
  project has Confirm email on, so setting a password also sends a second
  message that has to be clicked first, and the page had not made that
  clear. Sign-in now says what happened and offers the message again; the
  "all set" screen says sign-in will not work until it is clicked; and the
  confirmation link brings them back to their building's address rather
  than the shared one (which needs `https://*.subsub.work/**` on the
  Supabase redirect allow-list -- still to do). Whether Confirm email
  should stay on at all is a decision for the owner: the invite link has
  already proved the address, and three hundred tenants each clicking two
  emails is where tenants get lost.
- The sign-in address sat under the company name in the app header, where
  it repeated the address bar. It is in the profile menu now (and in the
  drawer on a narrow screen), as a link, for the moment somebody needs to
  copy it.
- "Powered by SubSub" vanished on a dark-themed branded page. It took the
  customer's text colour, which they chose to read on the card, and sat on
  the page behind the card -- Outerhome's black page, white card, dark text
  meant dark on black. Themed pages now derive a colour for anything on the
  page itself, whichever of white or ink reads better against the page
  background, computed from the colours rather than trusted to them.
- An invite that has gone out can be opened: the record corrected, the
  wording changed, the whole thing sent again or called off. Correcting it
  matters most -- the commonest reason an invite goes nowhere is that it was
  addressed wrongly, and re-sending it unchanged sends it to the same wrong
  place. Calling one off stops the link without removing the person.
- Adding a tenant demanded an email address, although the rest of the system
  has handled somebody reachable only by phone from the start -- the sign-up
  page asks such a person for an address the moment they arrive. An email or
  a cell phone is enough now, either one.
- Every branded sign-in page called itself a "Contractor portal", with the
  address printed after it -- the address the person was already standing
  on. SubSub's own page at app.subsub.work reads "Subcontractor Management
  Platform"; a company's reads its account type -- "Property manager
  portal". Neither prints the URL: it said nothing and took the room a
  description needs. The page also
  says tenants belong there, because until now it only spoke to
  subcontractors.
- `/api/account-by-subdomain` read `kind` back out of a row it never selected
  it from, so every branded page thought its account was a general
  contractor. Nothing showed until the two things above depended on it.
- The tenant roster can be narrowed by building, by status and -- for a
  portfolio across more than one -- by state. The status counts are taken
  before the status filter is applied, so "Invite sent (164)" keeps saying
  how many there are rather than collapsing to what is on screen.
- **The tenant sign-up page was a blank screen.** `needsEmail`, `email` and
  `setEmail` were read by it and never declared, so it threw a ReferenceError
  on render: every tenant who followed an invite got nothing. The API half
  had been finished all along -- the lookup returns `needsEmail`, the accept
  route takes an address -- and only the page was left unwired. Both paths
  now work end to end, checked in a browser: somebody added with an email
  picks a password, somebody added by phone alone gives an address first.
  Also `Show password` and `Set my password` were both inline buttons sharing
  a line, so one printed over the other.
- Nothing in the build catches an identifier that is used and never declared
  -- esbuild only checks syntax -- which is how the above shipped. `npm run
  lint` now runs ESLint with `no-undef` and nothing else; put the bug back
  and it names all three identifiers.
- Adding a tenant replaced the roster with a full page. It opens over the
  list now, the way every other short form in the app does. Importing a
  spreadsheet is still a page of its own: it puts a file's worth of rows on
  screen to be checked before any are sent, and those do not fit in a box.
- Adding a tenant on a database that had not had migration 015 run failed
  with "Could not add them. Try again." SQLite has two ways of saying a
  column is missing and they share no words -- a SELECT says "no such
  column: unit", an INSERT says "table memberships has no column named
  unit" -- and the detector knew only the first. Reading the roster named
  the migration; adding one threw a plain 500. Both now say which file to
  run. The roster's own message had the matching half of the same bug: it
  looked for raw SQLite wording in a response that carries a code.

## Known, not blocking

- Gold used as TEXT on a light background does not meet AA. `--gold` and
  `--gold-dk` are button fills, where the label sits on them in near-black;
  as text on white they come out at 3.4:1. index.html now has `--gold-ink`
  (5.3:1) for that job. The other pages still use `--gold-dk` as text in two
  places each -- the eyebrow chip and the numbered steps -- and should move
  to the same token.

- `scripts/hostnames-test.mjs` has three failing assertions in its `diagnose`
  section. They fail on the commit before this work too, and branded hostnames
  provision correctly in production, so this is test drift rather than a live
  fault. Worth a look before anyone trusts that file again.
- `scripts/e2e-smoke.mjs` waits for `.ld-row`, the demo account picker the
  sign-in page had before it took an email and a password. Nothing renders
  that class any more, so the script times out — on the commit before this
  work too. It needs rewriting against the real sign-in, or deleting.
- The Add menu has a "User" entry behind `can("users")`, and no role grants
  `users`, so it never renders. Users are managed from My account -> Users,
  which works. Dead branch, harmless.

- Licence checking covers six states and DC, and only Washington's field
  mapping has been verified against real records. Oregon, Connecticut, Iowa,
  Illinois and Texas are all `fieldMappingVerified: false` — the code says so
  and stores the flag with every check, so nothing is pretending otherwise,
  but a status shown from an unverified mapping could be reading the wrong
  column. See the 50-state item above.

- The gold-as-text contrast item is still open and is now measured: 25 uses
  of `color:var(--gold-dk)` across 11 marketing pages, at 3.39:1 on white
  where body text needs 4.5. `--gold-ink` is already defined and measures
  5.28:1. It is a token swap in eleven files.
