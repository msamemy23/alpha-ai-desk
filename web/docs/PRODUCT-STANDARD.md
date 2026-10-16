# Alpha AI Desk product standard

Written 2026-10-14 and rewritten 2026-10-15: sections 21 to 30 were added after the owner pointed out that AI calling, the phone and much more were missing, and every row that depended on the database files now reflects what was applied that day. Vendor pages were read on 2026-10-14; the texting, Google Photos, Apple Messages and Instagram facts were read on 2026-10-15. Features and prices change, so treat every competitor point as possibly out of date and re-check before you quote it. The "Alpha today" column was checked by reading the code in `web/src` and `SESSION_LOG.md`, not by clicking through the live app.

**As of 2026-10-15.** Every row was re-checked against the code on this date: does the code exist, can an owner reach it from a screen, the navigation, a schedule or a setting, does it depend on a database file that is not applied (and does it say so instead of failing), and is there a test. "Built in code, checked by tests" means exactly that and nothing more: nothing was clicked through on the live app. Rows that were built but that no screen, schedule or setting reaches are marked Not reachable and are collected, with the one missing step each, in "Built but not reachable" at the end. After the audit, commits 6bc49f7, 0c2d827, 3ca8b74 and 0a62529 wired up several of those rows. On the same date every row that said Not reachable (or "no screen", "no caller" and similar) was read again against the current code: the screens, pages, routes and the daily job were opened, not just the commit messages. Rows that changed are listed under "Now reachable since the audit" at the end. Other rows keep their reading from the audit.

## Why this document exists

Aaron's rule: "every feature has to have the fullest. i mean the fullest. professional leads, how other professional ai companies too... i want every feature to be professional and down right great."

So each feature is held to what the best shop software does (Tekmetric, Shopmonkey, Shop-Ware, with Mitchell 1 Manager SE and AutoLeap as side checks) and to what the best AI and product companies do (Intercom Fin for AI that resolves and hands off, Linear for speed and keyboard, Stripe Dashboard for tables, reports and money language, and AI phone agents for call answering).

Alpha AI Desk is an AI office manager and shop-management web app for independent auto repair shops. Houston first, many shops later. That "many shops" part is why Alpha must never show one shop's name, address, phone or wording to another shop.

## How to use this document

1. Before you build or change a feature, open its section and read the rows. Each row is one capability.
2. A feature is done when every row is Exists, or the row says who or what blocks it and that is written down in "Blocked on the owner". A row marked Not reachable is built but the owner cannot use it yet; it is not done until a screen, schedule or setting reaches it (see "Built but not reachable" at the end).
3. Put the section's rows in the pull request description and say which ones you moved to Exists.
4. Update the row in the same change. If a row is wrong, fix the row.
5. Every screen must also pass "Quality bar for every screen". A feature with all rows Exists but a screen that fails the bar is not done.
6. New feature? Add a section with the same four columns before you start.

## How to read the tables

- **Capability**: one thing a shop or customer can do.
- **What the best do**: a short fact in my own words with a source tag such as [S4]. The full list is under "Sources". "Not researched" and "unverified" mean exactly that. I did not guess.
- **Alpha today**: Exists (works in code now), Partial (some of it), or Missing (not found in code), plus one phrase. "Built in code, checked by tests" means the code is there and tests read it or run its logic; it does not mean it was tried live.
- **Status**: Exists, To build, Blocked, or Not reachable. Blocked means it cannot be finished or switched on until the owner or an outside party acts. The action is listed in "Blocked on the owner". Not reachable means the code is written but no screen, schedule or setting lets an owner use it; the row says the one missing step.
- Migrations: all 26 files in `supabase/migrations/` (034 to 060, there is no 042) are applied to production. Twenty went in on 2026-10-15 (034 to 041, 043 to 045, 047 to 050, 052 to 056). The last six went in on 2026-10-16, after the connector cancelled the apply each time: Aaron pasted one combined file into the Supabase SQL editor and ran it. They are 046 (customer links, signed approvals, document history), 051 (job flow), 057 (parts and purchase-order functions), 058 and 059 (browser tables) and 060_repair_posts.sql (repair posts: post_settings, job_post_info, post_queue; not the same file as web/supabase/migrations/060_atomic_automation_child_writes.sql). Because they went in through the SQL editor, Supabase's migration history does not list them. Checked afterwards: all 13 new tables and 10 new functions exist, row level security is on for every table, the security advisors show no errors, and the customer, document, payment and message counts did not change (169, 185, 147, 322). The screens and routes that use these files have not yet been tried on the live app, so a row that mentions one of them describes the database as ready and the feature as not yet seen live.

## Biggest gaps against the leaders

1. **Taking money.** Tekmetric sends a pay link by text and keeps cards on file; both Tekmetric and Shopmonkey run card terminals and track payouts and fees; Shopmonkey sends payable invoices by text or email [S3][S4][S22]. Alpha only records a payment someone received. There is no processor, no link, no card on file, and no QuickBooks sync.
2. **Shop data and time.** The leaders put labor guides, parts catalogs and per-job time inside the estimate and the tech board [S1][S2][S25][S9]. Alpha now records time on a job (Team) and shows technician efficiency, effective labor rate and gross profit in Reports, but it still has no labor guide and no parts catalog, and the board columns still do not show hours assigned and hours left.
3. **Customer-facing AI that is safe and hands off.** The best call agents tell callers they are AI, transfer to a person and book the appointment [S41][S43][S45]. Alpha's agent now does all three in code, uses the shop's own hours and rules, and every AI call the owner starts goes through a review card and the do-not-call and calling-hours check. What is left is proof and reach: it is covered by tests with simulated Telnyx events but has not been tried on a live call, texts to customers wait on carrier registration, the owner cannot listen in without being heard, and the join-a-call route has no button.
4. **Built but not reachable.** Six items are still written and tested but no screen, schedule or setting lets Aaron use them (purchase orders and receiving, who changed a quantity, capturing a lead, deleting a call record, the owner joining a live AI call and the customer duplicate merge; the list is at the end). Since the audit most of the earlier twenty-five were wired up, and on 2026-10-16 the estimate link added four more: the send sheet with a preview, the customer's answer panel, good, better, best options and the declined-work list (it now fills when a customer declines; see "Now reachable since the audit" at the end). None of those four has been tried on the live app. The one that mattered most is done in code: the unsubscribe link in marketing emails is now let through the sign-in wall (6bc49f7), so a customer can unsubscribe; it has not been tried with a real email link (section 24). Report emails, customer import and export, tags and groups, void, change history, templates, parts pricing rules and Ask Alpha for repair posts are also on screens now (see "Now reachable since the audit" at the end).

## Where Alpha is already ahead or different

- Ask Alpha shows a review card with the exact details and Approve and Cancel before it saves or sends anything, and repeats are safe (no double sends). Intercom Fin pauses for a teammate's approval on risky steps in a similar way [S35].
- Free repair-manual lookup with diagrams inside the app, with sources shown. The leaders sell licensed data instead [S1][S24].
- Reports say what is not recorded (for example an invoice marked Paid with no payment) instead of hiding it.
- Win-back, referral codes, lead finding and social drafts live next to the shop data. The shop tools I read treat marketing as automations and a dashboard [S11][S13].
- Insurance claim tracking with deductible and supplement flags and an AI claim helper. Not compared to collision estimating systems (not researched).

---

# Feature standards

## 1. Estimates and invoices

Screens: Work, Estimates, Invoices, Canned jobs, public signing page.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Write a document with parts, labor, supplies, sublet, tax | Build fast from canned jobs, matrices and labor guides [S1] | Exists. Line cards, shop labor rate and tax from Settings, per-line tax | Exists |
| Canned jobs | Linked to inspection findings and tailored per vehicle [S1][S6] | Partial. The Canned jobs screen (name, hours, rate, parts) and a one-tap "Add a canned job" inside a document work. Inspections price a finding from the shop's canned jobs. Per-vehicle versions, keywords and extra fees are built in code (migration 047 is applied, tests pass), and the "Add a canned job" sheet in a document now uses them: it puts the jobs that fit the car first, chooses the version for that car and adds the job's extra fees (3ca8b74). Canned jobs, open a saved job, Edit versions, keywords and fees, opens a sheet where the owner saves those (vehicle versions with make, model, year range and hours or a flat labor price, keywords, extra fees). The job-wide fit, customer note and inspection words are kept when saved but have no editor, and duplicating a job does not copy its extras. Built in code, checked by tests; not clicked through on the live app | Partial |
| Pricing matrices | Parts and labor matrices price lines automatically [S1][S2] | Partial. Settings, Parts pricing now edits the parts markup rules (tiers, markup or margin, rounding), shows what a sample part would sell for, and has a switch for suggestions; it saves through the document-settings route (migration 047 is applied). In a document, once a part has a cost the line offers a suggested price as a button; it is never applied by itself, is offered only while the lines can change, and only when the shop turned suggestions on (3ca8b74). Parts only: there is no labor matrix and nothing prices a line on its own. Built in code, checked by tests; not clicked through on the live app | To build |
| One-click job from the vehicle | Smart Jobs adds labor, parts, fluids and a locked price [S2] | Missing | To build |
| Labor times from a guide | Up to three labor guides inside the estimate [S1] | Missing. Repair info has no labor times | To build |
| Parts search and ordering in the estimate | Search suppliers without leaving the job [S2][S24] | Partial. Parts lookup reads store pages and builds an estimate; no order from the estimate. Supplier purchase orders are written but have no screen (see section 15) | To build |
| Good, better, best options | Found in other field-service tools [S34]; not on the shop tools I read (unverified) | Exists in code. Option groups (two to five choices; a choice's lines are added only when the customer picks it) are set up from the document menu, Good, better, best choices, on an estimate that is not locked (migration 047 is applied). The customer's private link shows each group with the recommended choice (or the first) picked, the total on the page changes as they choose, and the pick is saved in the signed record when they sign (migration 046 is applied); the choice they made is added to the estimate's lines. Tried on 2026-10-16 in a real browser at phone width (390px) and desktop width against a local stand-in database, never against the live app; no real text or email was sent | Exists |
| Email a document | Email with lines and total [S1] | Exists. Every line and total. Before sending, one sentence names who gets it, at which address, and the total. Needs the shop's email key in Settings, otherwise it says email is not set up | Exists |
| Text a document | Text a link; customer approves or pays on the phone [S1][S3] | Exists in code, and it waits on carrier registration for real texts. Send estimate (or Send for an invoice) opens one send sheet with three ways: email, text, or copy the private link. The sheet shows exactly what the customer will get (the email or the text, with the total and a placeholder where the private link goes) before anything is sent, and it explains in plain words when a way is blocked (no address or number, email or texting not set up, the customer asked not to get texts, document void). The link is made only when the shop sends or copies; a repeat tap does not send twice. The text carries the total, the shop phone and the link. Tried on 2026-10-16 in a real browser at phone width (390px) and desktop width against a local stand-in database, never against the live app; no real text or email was sent. Texts still wait on carrier registration | Partial |
| Signature and approval | Click or signature with a saved record [S1] | Exists in code. For an estimate the customer opens the private link (good for 30 days; sending again reuses and extends it), picks or declines each job, signs by drawing or typing a name (or, when the shop does not require a signature, just taps yes), and the answer is saved as a sealed record that includes the totals before and after, the time, the device and a check code the shop can verify; a second answer on the same link is refused. "They said yes in person" records a yes the shop took by hand. Invoices and receipts send the same kind of link, which shows the paper and cannot be answered. The older Request signature email (signatures table, live) is kept for invoices. Tried on 2026-10-16 in a real browser at phone width (390px) and desktop width against a local stand-in database, never against the live app; no real text or email was sent | Exists |
| Approve or decline line by line | Customer picks which work to do [S5][S27] | Exists in code. On the private link every pending job has its own Approve and Decline, with the job approved by default; the server requires an answer for each job, and an answer for only some of them is refused. Approved jobs stay on the estimate, declined jobs come off it with the total recalculated, and declined jobs are saved to Declined work with a 30-day reminder date. If the shop edits the estimate after the customer opened the link, the answer is refused with a plain "this changed" message and nothing is written. If the customer declines everything, no signature is needed and the estimate becomes Declined. Tried on 2026-10-16 in a real browser at phone width (390px) and desktop width against a local stand-in database, never against the live app; no real text or email was sent | Exists |
| Know when the customer looked | Sent and viewed icons on the card [S8] | Exists in code for the private link. Opening the link is counted (a repeat within 30 seconds is not), the first open is written to the document's history as "The customer opened the link", and the approval card on the document shows sent, looked at and how many times. An opened email is also recorded, but only as a hint: it counts only when the customer's mail program loads pictures, and some load them ahead of time. The Documents list does not yet show a sent or viewed mark on each card. Tried on 2026-10-16 in a real browser at phone width (390px) and desktop width against a local stand-in database, never against the live app; no real text or email was sent | Partial |
| Convert, duplicate, delete, print | Estimate becomes repair order and invoice [S1] | Exists. Convert in place, duplicate, confirm delete, print or save as PDF | Exists |
| Totals locked once money is taken | Audit trail of changes [S1] | Exists. Lines, tax, totals lock on Paid and Partial, also in the database | Exists |
| Change history on a document | Audit trail [S1]; activity log [S28] | Partial. Document menu, Change history (3ca8b74) opens a sheet with what happened to the document and its earlier versions; an earlier version can be put back into the editor (it still has to be saved, and it is not offered once the document is paid or void). Earlier versions use migration 048 (applied) and are kept when the lines of a sent document are changed. The event list uses migration 046 (applied 2026-10-16), so the sheet can now show events as well as payments and earlier versions. The live routes write created, converted, payment, edited, void and restored lines, and since the estimate link also sent, link made, opened, approved or declined (with the customer's note and the jobs they picked), customer questions, good-through date changed and links turned off. Built in code, checked by tests; not clicked through on the live app | Partial |
| Discounts | Effective labor rate counts discounts [S16] | Exists for a line. Open More details on a part or labor line and enter a percent off; the original price is kept and the printout says what was saved (tests). The whole-document discount is a separate row below | Exists |
| Warranty on parts and document | Not researched | Exists. Per-part box and document presets (see Settings for wording risk) | Exists |
| Declined work kept for later | Declined work flagged marketable and reminded [S5][S11] | Partial. An estimate left unanswered gets a follow-up, and declined inspection items get a reminder (Automations). A kept list of declined work is now on the Estimates screen (a Declined work button with a count, also linked from Work): each entry can become a new estimate in one tap (the draft is filled in, and the entry leaves the list once that estimate is saved), be put off 30 days, or be dismissed (3ca8b74; migration 047 is applied). A customer declining a job on the private link now fills the list (one entry per declined job, with the amount, the lines and a 30-day reminder date), written by `lib/doc-respond.ts` through `/api/sign`. Tried against a local stand-in database only, never with a real customer. There is still no add-by-hand button, and a decline the shop records by hand is not added | Partial |
| Shop logo on paperwork | Logo on every customer page [S39] | Partial. The logo is on the print header and the inspection page (the logo table is live since 2026-10-15). Not on the signing page or the document email; an email with the logo is written (doc-email) but not used | To build |
| Void and restore a document | Not researched | Exists in code, checked by tests. Document menu: Void (a draft offers Delete instead; once payments exist neither works) asks for a reason of 3 to 300 characters, keeps the number and record, turns the document's signing links off, writes the reason into the private shop notes and adds a Voided chip to the list once there is one. Restore brings it back to what it was when the history can say (needs 046), otherwise to a draft. A voided document offers no send, signature, payment, plan or convert, and its lines are read only (3ca8b74). The history line and the switch-off of the newer customer links use migration 046 (applied 2026-10-16); the status change, the earlier version (migration 048, applied) and the notes line happen with or without it. Not clicked through on the live app | Exists |
| Percent off the whole document, and fee lines from presets | Not researched | Partial. Document editor, Discount and fees (3ca8b74): Discount takes a percent off labor, parts or everything, keeps the original price on each line, and "Take all discounts off" puts every price back exactly. Add a fee puts a disposal or environmental fee, or outside work, on its own line (taxable or not, optionally tied to a job). Neither is offered once the document is paid, part paid or void, and nothing is saved until the document is saved. The "Your usual charges" presets are saved in Settings, Usual charges (name, amount, shop fee or outside work, taxable): it re-reads the current settings, replaces only that list and saves through the same route as the markup rules, and the Add a fee sheet offers them as one-tap buttons. Built in code, checked by tests; not clicked through on the live app | To build |
| Start a document from a saved template | Not researched | Exists in code, checked by tests. Document menu, Save as a template stores the labor, parts, supplies, customer notes and warranty (never the customer, the car or the private notes). In the editor, Start from a template lists the saved templates for that kind of document, with search and delete, and adds their lines after what is already there (3ca8b74; migration 047 is applied). Offered only while the lines can change. Not clicked through on the live app | Exists |
| See the customer's answer, extend the good-through date, turn customer links off | Not researched | Exists in code. The approval card sits on an estimate in the Documents screen (below the lines) and shows sent, looked at, good-through date and, once answered, the outcome (all, some or none of the work), who signed and when, the approved total (and what it was before), the device, the signature picture and the seal check. The job-by-job answer is on the customer's own signed copy, and declined jobs are in Declined work. Extend the good-through date and Turn customer links off are in the document menu; both ask first and write to the document's history. The card refreshes about every 45 seconds and when the screen comes back into view, and says so when the customer answers. Tried on 2026-10-16 in a real browser at phone width (390px) and desktop width against a local stand-in database, never against the live app; no real text or email was sent | Exists |

## 2. Payments and collecting money

Screens: Invoices (payment sheet and plan), Reports > Money.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Record a payment | Cash, card, check against the order [S4] | Exists. Methods from Settings; safe against a double tap | Exists |
| Take cards in the app | Built-in processing, terminal, Apple Pay, Google Pay [S4][S22] | Missing. No processor connected | To build |
| Payment link by text or email | Secure link, no app or login, funds next day [S3] | Missing | To build |
| Card on file | Keep cards for repeat visits [S3] | Missing | To build |
| Deposits | Not described on the Tekmetric or Shopmonkey pages I read (unverified) | Partial. A printed "deposit" number only; real money goes through Record payment | To build |
| Payment plan | Not found (unverified) | Exists. Down payment, installments and dates; records, does not auto-charge | Exists |
| Financing at checkout | Buy now, pay later options [S22][S23] | Missing | To build |
| Bulk pay for fleets | Pay several invoices in one go [S22] | Missing | To build |
| Payout and fee reconciliation | Payouts and fees tracked; payout report [S4][S40] | Partial. No processor, so no payouts or fees to reconcile. Reports, Accounting has Daily totals (sales, tax and money received by how it was paid, to hold against bank deposits) and Reports, Money has a Payments file; accounting checks list invoices marked Paid with no payment | To build |
| Who owes you, and chasing it | A/R view on the job board [S8] | Partial. Owed by age in Reports, Money, and a "Reminder wording" button per customer writes a friendly, second or final reminder for the owner to copy and send. Alpha Desk does not send it and nothing chases an overdue invoice by itself. (A route that lists who to remind, /api/reports/ar, has no caller) | To build |
| Receipts | Receipt on payment | Exists. Receipt document type | Exists |
| Refunds | Not researched | Missing. No refund screen found | To build |

## 3. Digital vehicle inspections

Screens: Inspections, Jobs detail, public inspection link.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Phone-first checklist | Swipe green; yellow and red open findings [S27] | Exists. Three built-in checklists (31-point, brakes and tires, oil-change check) plus the shop's own (next row) | Exists |
| Per-shop checklist templates | Custom multi-point templates [S5] | Exists. Templates in Inspections: make one, change one, start from a built-in one, remove one (hidden, can be put back). Up to 12 sections of 40 lines. Migration 049 is applied. Tests | Exists |
| Rating with words | Four ratings incl. not applicable [S6] | Exists. Good, Watch, Needs work with a word beside each lamp; mark the rest good | Exists |
| How soon each finding should be fixed | Not researched | Exists. Now, soon or later on each finding, in words the customer sees on their page and the printout | Exists |
| Photos | Photos with markup [S5][S6] | Exists. Up to 8 per item and 24 per inspection, drawn on with freehand, arrow or circle marks (Undo removes the last mark). Photos go to the private dvi-media storage (migration 049 is applied); if that storage is missing they stay inside the inspection as before | Exists |
| Video and voice notes | Video and voice notes [S5][S21] | Exists. Record a 30-second video or 60-second voice note on a finding, review it, keep or retake; two per item, kept in storage not in the row. The customer's page plays them. Where the browser cannot record, the phone's own camera or recorder is offered. Tests on the rules; not yet recorded on a live phone | Exists |
| Tire and brake measurements | Tread depth per tire carried to next visit [S33]; Tekmetric not described [S6] | Exists. Tread (three places, lowest counts), pad, rotor and tire pressure, each with a lamp and a word ("3/32 in: Replace soon"), and wear rate against the last visit. Tests | Exists |
| Suggested price per finding | Canned jobs add priced work from findings [S5] | Exists. The best canned-job matches sit under the price box as one-tap buttons, plus a search of the whole list. The price is the canned job's saved price, never a guess. Tests | Exists |
| Send to the customer | Text or email, customer reviews on phone [S5][S21] | Exists. Text link, no sign-in. Migration 036 is applied (2026-10-15); the link can only be texted once carrier registration is done | Blocked |
| Customer approves each repair | Approve or decline per item [S27] | Exists. Approve or Skip per finding, can change answers | Blocked |
| Findings become an estimate | Add recommended work to the estimate [S21] | Exists. "Write estimate from approved" | Exists |
| Inspection history per vehicle | History tab with ratings and technician [S7] | Exists. Inside each inspection: what got worse or is new since the last one, work declined and still open, and tire and brake wear. The Vehicles screen now also lists each car's inspections, newest first, with who did it, the date and what was found (urgent, needs attention soon, good), each opening in the inspection screen (2026-10-16; checked by tests and by a browser preview with sample data, not yet on the live app). Tests | Exists |
| Report sent with the estimate | Health report goes out with estimates [S6] | Missing | To build |
| Declined findings followed up | Declined saved for follow-up [S5] | Exists. Follow-up sheet writes a calm text about their own car naming the work (never "unsafe", opt-out line, not between 9 pm and 8 am); the shop reads, edits and sends it; up to three follow-ups. The Declined-service automation also reminds. Texts wait on carrier registration | Blocked |
| Safe public link | Not researched | Exists. Random token, only needed fields, rate limited, can be turned off | Exists |
| Print the report | Print with or without photos [S6] | Exists | Exists |
| Database ready | Not applicable | Partial. The `dvi` table has no migration in the repo (made by hand in production) | Blocked |

## 4. Scheduling and capacity

Screens: Schedule.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Week grid, day board per tech, list | One calendar for online, check-ins, walk-ins [S10] | Exists. Week grid, day board per tech, list and a month view with a fullness lamp per day. Tap an empty slot to book | Exists |
| Double booking | Booked time blocks the slot [S10] | Exists. Warns, never blocks (on purpose) | Exists |
| Status flow | Confirmed, arrived, done | Exists. Confirm, arrived, done, no show, cancel | Exists |
| Appointment becomes an estimate | Appointments flow into daily work [S10] | Exists. Opens a new estimate with customer and vehicle filled in | Exists |
| Confirmation and reminder texts | Sent automatically on booking and before [S19] | Exists in code. A Remind sheet texts everyone booked for a chosen day (shows who is included and who is left out and why, one text each, remembered so nobody is texted twice); wording for answers to online requests, late cars and missed visits is written; the appointment-reminder automation runs on the daily job, so it can be up to a day late (see Blocked on the owner, item 15). Tests. Texts wait on carrier registration | Blocked |
| Online booking | Booking widget, link and Google Business Profile booking [S10] | Exists in code. The shop turns it on in Schedule, Settings, Online booking: a public page at /book/ and the shop's link name, requests that wait for the shop (or go on the calendar at once), notice time and limits. A request panel shows what is tight about the time. Signed form token and rate limits stop scripts. Database tables applied 2026-10-15 (migration 050); tests; not yet checked on the live app | Exists |
| Capacity by tech and service | Availability per service type [S10]; capacity management [S26] | Exists. Schedule, Settings: Hours, Capacity and Services (length, drop-off or waiting). A bar on each day says how full it is. The app warns when a booking is tight and never blocks; the public page offers only times that fit. Migration 050 is applied. Tests | Exists |
| Calendar sync | Not researched | Partial. Schedule, Settings, Calendar link: a one-way feed the shop adds to Google, Apple or Outlook calendar (customer phone numbers left out). Ask Alpha can also use Google Calendar. No two-way sync | Exists |
| Suggest declined work when booking | Widget suggests declined services [S10] | Exists in the shop's own booking form: work the customer declined on a recent inspection, or an inspection they never answered, shows as one-tap suggestions. Not on the public booking page | Exists |
| Walk-ins | Walk-in check-in [S10] | Exists. "Walk-in: name" without breaking texts | Exists |
| Cars that did not show | Not researched | Exists. A strip shows booked cars not here after the grace time; one tap to text them, mark no-show or open the booking. A no-show is never marked by itself | Exists |

## 5. Job board and shop board

Screens: Jobs, Shop board, Work.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Job board by stage | Estimates, work in progress, completed [S8] | Exists. Board and list with promise date, priority, late flag. The promised time of day is set per car (Parts and time) and the card then reads "Due tomorrow 3:30 PM" or "Late: promised Oct 15 9:00 AM"; a time needs a promise date set on the job first. Tried on 2026-10-16 in a real browser at phone width (390px) and desktop width, light and dark, against a local stand-in database, never against the live app | Exists |
| Waiting statuses | Waiting on parts or sublet [S8] | Exists. Waiting on parts, Waiting on customer | Exists |
| Column per technician | Own column plus no-tech column [S9] | Exists. Drag (desktop) or tap and pick (phone), undo, saves at once | Exists |
| Clock a technician in, out or on break from the board | Not researched | Exists. Each technician column has Clock in, Break and Clock out buttons and a Fix time link to Team | Exists |
| "Needs a look" summary | Not researched | Exists. No tech, late, clocked out with cars in progress | Exists |
| Hours per technician column | Assigned, completed, remaining hours [S9] | Exists in code. Each column on the Shop board shows "6.5 h assigned, 4 h left" from the hours expected on each of that person's open cars (cars ready for pickup count as done), and says how many cars have no hours entered so the numbers are never quietly short. The hours are set per car under Parts and time. It does not compare against a working day or show hours completed from the time clock. Tried on 2026-10-16 in a real browser at phone width (390px) and desktop width, light and dark, against a local stand-in database, never against the live app | Exists |
| TV or full-screen mode | Not described on the tech board page I read (unverified) | Exists in code. Shop board, Shop wall button: a full-screen, look-only view with a column per technician who has cars, large type, a clock, and the screen kept awake. Customer names are off unless the shop turns them on (then first name only), and the plate is never shown. It refreshes at the pace the shop picks (the setting beside the button, saved with the schedule settings). Tests. Opened, closed and the settings sheet viewed on the live app on 2026-10-15 while no cars were open (so the empty wall and the technicians-with-no-cars line were seen; the cars in large type, names on, and Save were not) | Exists |
| Jump to a technician on a phone | Not researched | Exists in code. A row of chips above the columns on a phone and tablet (Unassigned and each technician, with their car count); a tap scrolls to that column. Tests; not seen on the live app, because the chips only show with cars open and the shop had none | Exists |
| Sent and viewed markers | Paper plane and eye icons [S8] | Missing | To build |
| Labels on repair orders | Filter by RO label in the app [S18] | Exists in code. Up to five labels per car, from the shop's own quick list (Rush, Warranty, Insurance, Comeback, Fleet, Sublet unless the shop changed them) or typed in; they show on the board card and a label filter row above the columns lists the labels in use with counts. Search also matches a label. Labels are set on the board (Parts and time) and on the job sheet. Tried on 2026-10-16 in a real browser at phone width (390px) and desktop width, light and dark, against a local stand-in database, never against the live app | Exists |
| Parts status on the card | Parts need ordering or awaiting delivery [S27] | Exists in code. A car-level parts status (no parts needed, to order, on order, some in, in) with what is being waited on and a due date is set on the board or the job sheet and shows on the card with a lamp and the words; a Waiting on parts filter lists those cars, and Needs a look says when a car needs its parts ordered or has parts past the due date. A technician sees the same line on My cars. The customer sees the parts line on their status page while the car is set to Waiting on parts (setting the parts status does not change the car's status). Status per part is still in the document editor. Tried on 2026-10-16 in a real browser at phone width (390px) and desktop width, light and dark, against a local stand-in database, never against the live app | Exists |
| Technician-only view | "My Work" with due times and parts status [S27] | Partial. My cars (2026-10-16, in the menu under In the shop): a technician picks their name once (this browser remembers it, as an id and nothing else) and sees only the cars with their name on them, grouped as Working on now, Up next, Waiting on something and Done, waiting for pickup, late and rush first, with the due line, status and concern on each card. Their own clock (clocked in since, hours today, Clock in, Break, Clock out, Fix my time) is on the same screen, using the time clock route the Shop board uses. Tap a car to open it on the Jobs screen. It only reads cars and never changes one, and it says plainly that picking a name is a shortcut and not a lock: a person who signs in is not tied to a team member (staff rows have no sign-in link), so everyone signed in can still see every car on the Shop board. Checked by tests, in a browser preview with sample data (phone and desktop, light and dark; a remembered person, a person who left the team, no cars, no technicians, and a failed load) and on the live site (the four technicians were listed, a name was picked, and the empty list and the clock card showed; no one was clocked in or out). Not built: parts status on the card (needs migration 051), hours assigned and left, and tying a team member to a sign-in | Partial |
| Car-ready text to the customer | Automatic status messages [S19] | Exists. A one-tap Ready for pickup text on the job (also Work started, Needs your OK, Waiting on parts), and a built-in Car is ready automation you switch on in Automations. Texts wait on carrier registration | Blocked |

## 6. Time clock and technician productivity

Screens: Team (route `/staff`), Reports > Technicians.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Clock in and out | Time clock with overtime [S28] | Exists. Today, Timesheets, People tabs | Exists |
| Breaks | Not researched | Exists. Migration 035 is applied (2026-10-15), so the Break buttons show; not yet clicked through on the live app | Exists |
| Weekly hours and overtime | Overtime recorded for payroll [S28] | Exists. Weekly, daily and double-time lines the shop sets (starting points by state), a one- or two-week pay period, and any day as the first day of the week. Migration 052 is applied. Tests | Exists |
| Configurable week start | Not researched | Exists. Team, Rules: the day the pay week starts, one- or two-week periods. Tests | Exists |
| Fix a missed punch | Not researched | Exists. Owner or manager, reason required and kept | Exists |
| Forgotten clock-out guard | Not researched | Exists. Over 16 hours flagged, over 24 hours cannot be clocked out | Exists |
| Undo a clock-out | Not researched | Exists. A person's card offers "Wrong button?" for 15 minutes after a clock-out and puts them back on the clock; the change is logged. Tests | Exists |
| Time on a job | Clock into a specific service; compare estimated and clocked [S25] | Exists. A clocked-in person picks the repair order they are working on; starting one closes the one before so no minute counts twice. Migration 052 is applied. Tests | Exists |
| Technician efficiency | Billed hours versus worked [S28] | Exists. Per pay period: hours sold on the repair orders billed against hours actually worked on them, the labor rate that works out to, and (owners and admins) gross profit where every number is known. Tests | Exists |
| Payroll file | Clock records feed pay [S28] | Exists. Three CSV files for a pay period (Hours by person, Every punch, Hours by day), safe against spreadsheet formula tricks; anyone not yet approved is named first. Hours only; pay is not worked out | Exists |
| Approve a pay period | Not researched | Exists. Review one person's period and approve it; an approved period is locked until the approval is removed | Exists |
| Payroll integration | Not researched | Missing | To build |
| Location check at clock-in | Shops can require location sharing [S25] | Exists in code, checked by tests. Team, Rules sets the shop's spot and a radius, and clock-in asks the device where it is, once, only when the shop turned the check on, and keeps only inside, outside or unknown. The app's security headers (src/middleware.ts) used to send geolocation=() which made every browser refuse location; they now send geolocation=(self), so only the app itself may ask and the person still has to allow it in the browser. Not tried on a phone | Exists |
| Activity log by employee | Actions on orders and parts per employee [S28] | Partial. Every change to a person's punches is logged with what it was, what it became, why and when, and a removed punch can be put back. Not a log of orders and parts handled | To build |
| Flat-rate or commission pay | Not described on the Shop-Ware page [S28] (unverified) | Missing. A pay rate per person is kept (owners and admins only) for a rough cost on the efficiency screen; it never goes into a payroll file | To build |

## 7. Customers and vehicles

Screens: Customers, Vehicles.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| One customer record | Texts stay with the order history [S12] | Exists. Contact, vehicles, documents, texts and calls, jobs, notes | Exists |
| Search | Stripe filters and finds fast [S39] | Exists. Name, phone, vehicle; search box also finds paperwork | Exists |
| Customer mood | Not researched | Exists. Happy, neutral, unhappy mark and filter | Exists |
| Warn about a likely duplicate when adding a customer | Not researched | Exists. Same phone, email or name is shown before saving, with a way to open the existing customer | Exists |
| Everything that happened with a customer in one feed | Not researched | Partial. Customers, open a customer, Everything with this customer (after Vehicle history): estimates, invoices, repair orders, appointments, texts, calls, inspections and notes in time order, newest first, with a filter for paperwork, work, messages and notes, and a Show more button (`/api/customers/feed`, `lib/customers/timeline.ts`). Read only, limited to the signed-in shop and that customer, and a kind that cannot be read is left out with a plain note instead of failing the whole feed. Repair orders, documents and inspections match by the customer link only, so an old repair order saved by name alone shows in the card's own list but not here. What a customer is worth (spend, owed, visits, last visit, average ticket) is still used only in the customer export file. Built in code, checked by tests; not clicked through on the live app | Partial |
| VIN decode | Plate-to-VIN scan on mobile [S31][S32] | Partial. VIN decode on the form; no plate or VIN scan | To build |
| Vehicles list | Vehicle history on the profile [S21] | Exists. Owner, plate, mileage | Exists |
| Full service history per vehicle | Past inspections and orders per vehicle [S7] | Partial. Each car's card lists its repair orders (RO number, mileage, concern). The customer card now has a Vehicle history section (0c2d827): for each of that customer's cars, the repair orders and the invoices written without one, what each billed, and the mileage readings from repair orders and the card, with a warning when a reading is lower than an earlier one or jumps. Read only, and on the customer card only. The Vehicles screen separately lists the car's repair orders and its inspections (2026-10-16), but not invoices or billed amounts. Checked on the live site: the car sheet shows an Inspections section (for a car with none it reads "No inspections for this car yet."). Saved cars, a mileage log, notes and photos (tables from migration 054, applied) are written and tested, but no route or screen reads or writes those tables, so the history is built from repair orders, invoices and the card alone | To build |
| Duplicate finder and merge | Not researched | Partial. Adding or editing a customer warns when the name, phone or email is already in the book. Customers, Customer tools, Possible duplicates (0c2d827) now lists pairs that share a phone, email, VIN, plate or name, says why, and shows each pair side by side with a link to open either card; it only reads. A merge that previews, asks for confirmation, logs every record it moves and can be undone is written and tested (`lib/customers/merge.ts`, migration 053 is applied) but is deliberately not wired: no route or screen calls it, and it stays that way until Aaron says yes to that specific action. About 20 duplicate or test customers sit in Alpha's data; nothing is deleted without Aaron's yes | Blocked |
| Import and export | Not researched | Exists in code, checked by tests. Customers, Customer tools (0c2d827; an "Import a list" button also shows when the book is empty). Export downloads the customer list as a CSV that is safe to open in a spreadsheet (phone, email, address, vehicle, tags, text permission, repair orders, last visit, paid, owed, notes). Import takes a CSV file or pasted text, guesses the columns and shows a preview (will be added, skipped because the phone, email or name is already in the book, problem rows) that changes nothing; Confirm import re-checks on the server, only adds new customers (it never updates or removes one) and stops at 500 rows. Migration 053 is applied. Not clicked through on the live app | Exists |
| Tags and segments | Targeted campaigns by history [S13] | Exists in code, checked by tests. The Customers list has a Group choice with a count for each: New (last 60 days), Repeat, Not seen in 6 months, No phone, Looks like test data, plus every tag in use ("Owes money" is its own chip). The customer card has a Tags section where a person adds and removes tags (up to 12 each; saved on the customer's own record, migration 053 is applied) and the import can set tags (0c2d827). The Promotions audience filter by tag reads the same tags. The groups top spenders, fleet and opted out of texts are written but not offered on the list. Not clicked through on the live app | Exists |
| Text opt-out | Not researched | Exists. STOP handled and remembered. Each customer's card also holds do-not-call, do-not-email and best time to reach them; texting turns back on only when the customer texts START | Exists |
| Fleet accounts | Fleet payments and bulk pay [S14][S22] | Missing | To build |
| Vehicle history report | CARFAX lookup by plate [S24] | Missing (optional) | To build |
| Customer portal | Not found on pages I read (unverified) | Missing. Only one-off signing and inspection links | To build |

## 8. Texting and the Inbox

Screens: Inbox (Texts tab).

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| One inbox on the shop number | Unified inbox on a single number [S12] | Exists. Live updates, unread, search | Exists |
| Texts kept with the customer | Stay in each customer's history [S12] | Exists | Exists |
| Photos and video in texts | Send pictures, video, progress [S12][S29] | Exists. Attach and send pictures (checked in the browser with the send route mocked); pictures customers send are saved in the app, not left on the carrier's link. Migration 038 is applied (2026-10-15); without it texts work and pictures show a notice | Exists |
| Message templates | Not shown on pages I read (unverified) | Exists. Saved replies in the thread fill the customer's name, the shop name and phone from settings; one tap adds starter replies. Migration 037 is applied (2026-10-15) | Exists |
| One thread with approvals and estimates | Messages, estimates, timelines and approvals in one thread [S29] | Partial. The thread screen asks for a customer's document events and would draw them between the texts, but the document history table is migration 046, now applied. The live routes record only created, converted and payment events; sent, opened, approved and declined are never written, because the send and signing routes do not log them. An earlier version of this row said those events showed in the thread; that was not true | To build |
| Assign a thread | Add staff to a thread [S29] | Exists. "Give to someone" names who has the thread (checked in the browser). Migration 037 is applied (2026-10-15) | Exists |
| Per-thread access | Set access per thread [S29] | Missing. Assignment shows who has it but does not hide the thread from anyone | To build |
| Alerts for new messages | Team alerts [S29] | Exists in the app: optional browser alert and tab count in the Inbox, "X texted you" on Today, and an optional email when a customer texts and the assistant did not answer. No phone push | Exists |
| Phone push alerts | Mobile push [S29] | Missing. Needs web push or a mobile app | To build |
| Opt-out handling | Not researched | Exists. STOP, START and HELP are handled on the server (tests); a stopped number is never texted again, checked again at send time | Exists |
| AI auto-reply to texts | Fin resolves and hands off with history [S35] | Exists. Off, draft or auto per shop. Says it is an AI in its first text, never gives a price or promises a time, asks for name, vehicle, problem and number, books through the schedule only with approval, flags "needs a person", pauses when a person replies, stops after the shop's reply limit and never answers another automated sender. Limits are counted from the saved texts, so a restart does not reset them. Tests plus browser checks | Exists |
| Approve the AI's reply first | Fin pauses for approval on sensitive steps [S35] | Exists. Draft mode shows the exact words in the thread with Send this reply, Change it first and Do not send (checked in the browser) | Exists |
| Human takes over a thread | Hand off with history [S35][S36] | Exists. When a person replies, the assistant steps back for the shop's chosen time; "Pause assistant" and "Let the assistant answer again" are on each thread | Exists |
| Quiet hours | Not researched | Exists. No automatic reply goes out in the shop's quiet window (default 9 pm to 8 am in the shop's time zone). Other automated texts follow their own rules in Automations | Exists |
| Texting that carriers allow | Registered sender required [S46][S47] | Blocked on the owner. Built: a step-by-step checklist in Settings, Communications that detects what is already done, remembers progress, and writes the answers to paste into the carrier forms. Still needs the owner to register in the Telnyx account. Migration 039 is applied (2026-10-15), so progress is remembered | Blocked |
## 9. Phone calls and the AI receptionist

Screens: Inbox (Calls tab), Today ("Alpha answered"), Settings (Texts and calls).

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Call log with recording and transcript | Recordings, transcripts, summaries [S43] | Exists. Filters All, AI answered, Missed, Incoming, Outgoing; search by name, number, service | Exists |
| Call from the browser | Not researched | Exists. Softphone and Dial sheet | Exists |
| AI summary of each call | Summaries, transcripts, notifications [S43] | Exists. 2 to 4 bullets, lead score, mood, service needed; the assistant's own calls also get a summary in the app and by email | Exists |
| AI answers inbound calls | 24/7, many calls at once [S41][S43][S30] | Exists. One call path (the old second path is retired). Answers, collects name, vehicle, problem and call-back number, records and transcribes. Checked with simulated call events and in the practice screen; not yet tried on a live Telnyx call | Exists |
| Tells callers it is AI | Callers are told [S41]; disclosure is a required guardrail [S45] | Exists. Said in the first sentence of every call and every first text; says so again if asked; cannot be switched off | Exists |
| Transfer to a person | Live or warm transfer with briefing [S43][S41] | Exists. During open hours the call goes to the shop's handoff numbers in order, with a short text briefing (who, vehicle, need) to the person; if nobody answers it takes a message. Simulated Telnyx events in tests | Exists |
| Books the appointment | Checks calendar, offers times, confirms [S41][S43] | Exists. Shop picks: take a message, ask the team to confirm (saved as a request the team approves with "Put on the schedule"), or offer only open times from hours and the schedule. Checked end to end in the browser | Exists |
| Knows this shop's hours | Learns from profile and site [S43] | Exists. Weekly hours, closed days and time zone in Settings, AI receptionist. Until set, it never states hours or says the shop is closed | Exists |
| Never invents prices | Answers only from shop context | Exists. Prices, ranges, discounts, "free", ready times, call-back times, diagnoses and "safe to drive" are removed from every reply on the server, whatever the AI wrote (tests) | Exists |
| Spam filtering | Spam calls filtered [S43] | Exists. Sales and robocalls are ended politely and logged; one switch | Exists |
| Text the caller during or after the call | Booking link or details by text [S41][S43] | Exists. Short text-back after a missed call or a message, never to a number that said STOP; one switch | Exists |
| Guardrails that end or transfer a call | Rules that end, transfer or reroute [S45] | Exists. Upset caller, safety, towing, accident, insurance, legal, the shop's own keywords, "talk to a person" and "not sure" flag the call for a person and email the team; a call from the shop's own number is hung up on | Exists |
| Filter chip for AI-answered calls | Not researched | Exists. "AI answered" chip with a count | Exists |
| Mark AI inbound calls as read | Not researched | Exists. "Mark all as read" and per call | Exists |
| Outbound AI calls for the shop | Not researched | Exists. Task calls started from Ask Alpha, with transcript and summary; now say they are an AI and that the call may be recorded | Exists |
| Recording notice | Not researched | Exists. Spoken near the start of every call the assistant answers; wording and on/off set by the shop. Whether the wording meets the shop's state law is the owner's call (see Blocked on the owner) | Exists |
| Shop rules screen | Guidance for tone, handoff, limits [S37] | Exists. Settings, AI receptionist: separate off switches for calls and text replies, tone, name, greeting, recording notice, hours and holidays, handoff people, what needs a person, what it may share, never-say lists, booking, quiet hours, limits, who is emailed. Defaults name no shop. Checked on phone and desktop, light and dark. Migration 037 is applied (2026-10-15), so it saves | Exists |
| Test mode | Practice before going live [S37] | Exists. "Try the assistant" runs a pretend call or text through the real rules (even unsaved ones) at a pretend time of day and shows the reply, which rules fired and what it would have done. Nothing is sent, saved or dialed | Exists |
| Review what the assistant did | Audit trail the owner can read [S28] | Exists. Inbox, AI assistant: what it needs from you, the log with transcript, recording, outcome, and Handled well or Needs work marks | Exists |
| Results in plain numbers | Outcome counts [S35] | Exists. Answered, booked, asked for a time, passed to a person, missed, after hours, messages taken, still need a person, spam blocked, for 7, 30 or 90 days. Dollars brought in are not shown (no price data) | Exists |
| Needs a person flag and email | Escalation rules [S36] | Exists. Red "Needs a person" on the thread, call and AI page, plus an email with the details; the assistant stops replying there until marked handled | Exists |
| Summary and alerts without texting | Summaries, notifications [S43] | Exists. In the app and by email (owner picks every call, only follow-ups, or never) | Exists |
| Telnyx assistant instructions | Not researched | Exists. Settings, AI receptionist: Copy instructions writes the same rules as text for a Telnyx AI assistant. This app enforces the same rules itself | Exists |
| Carrier registration checklist | Registered sender required [S46][S47] | Exists as a screen (see section 8). The registration itself is Blocked on the owner | Blocked |
## 10. Ask Alpha (AI assistant)

Screens: Ask Alpha, review cards, Agents and tools.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Ask in plain words, act on shop data | Resolves by taking actions [S35] | Exists. Customers, jobs, documents, texts, schedule, inventory | Exists |
| Show what will happen first | Pause for human approval on risky steps [S35][S36] | Exists. Review card with details, warnings, Approve and Cancel | Exists |
| Safe retry | Not researched | Exists. Same operation is checked, never done twice | Exists |
| Labels on risky actions | Not researched | Exists. "Sends a message" and "Cannot be undone" tags | Exists |
| One approval path | Not researched | Partial. Four kinds of card (workflow review, single action, text, call) now sit in one shared approval frame, but they are still four separate paths in the page | To build |
| Audit trail the owner can read | Activity log [S28] | Exists. The Activity screen (opened from Settings, Assistant rules, "See what it did"; not in the menu) lists what the assistant looked up, changed, sent and had problems with, by 1, 7, 30 or 90 days, with search and an undone filter. Migration 045 is applied. Tests | Exists |
| Undo | Not researched | Exists for changes that can be put back: an Undo bar sits under the confirmation on Ask Alpha and on the Activity screen. Anything that cannot be put back keeps its "Cannot be undone" tag. Tests | Exists |
| Stop button while it works | Not researched | Exists. A Stop control cancels a running request and says "Stopped by you. Nothing was sent or changed"; the stop is recorded on the server (migration 044 is applied). Tests | Exists |
| Honest about uncertainty | Asks a teammate when unsure [S36] | Partial. Sources on researched parts; one prompt line says answer from own expertise when a manual is thin | To build |
| Repair answers from manuals first | Not researched | Exists. Router sends repair questions to manuals, web only if asked | Exists |
| Shop-set rules for the AI | Guidance sets tone, handoff, limits [S37][S36] | Exists. Settings, Assistant rules: tone, what it may do (look up, draft, change records, contact customers; send and charge always ask or stay off), single actions to switch off, never-do and never-say lists, facts it may state, and this month's count. Migration 043 is applied. Tests | Exists |
| AI included | Not researched | Partial. Each shop pastes its own AI key or connects a ChatGPT plan | To build |
| Talk to Alpha | Not researched | Exists. Dictate and talk | Exists |
| Saved chat history | Not researched | Exists | Exists |
| Tool risk labels | Not researched | Exists. Tools page marks read, change, contacts others, delete | Exists |

## 11. Marketing, reviews and growth

Screens: Get more customers (Growth), Settings.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Review requests | Automatic Google review request after a posted order [S11] | Exists in code. Manual text of your link, plus an automation after a paid invoice: waits 2 hours by default, one request per customer every 90 days, skips unhappy customers, held at night, STOP checked right before sending, preview and test text to yourself. Real texts wait on carrier registration | Blocked |
| Reply to a review | Review management [S13] | Exists. Paste a review and the stars; Alpha drafts a plain reply (never invents an offer, price or phone number), flags low ratings and serious claims, you edit and approve, copy it into Google and mark it posted. Saved per shop. Nothing is fetched from or posted to Google. Migration 041 is applied (2026-10-15) | Exists |
| Win-back | Lost customer follow-up, default 12 months [S11] | Exists. 60-day list that can be sent as a scheduled promotion; win-back automation; the one-tap blast in Settings now opens Get more customers instead and the old call goes through the same checks | Exists |
| Service-due reminders | Reminder when a canned job is due, cancels on early return [S11] | Exists. Oil change and tire rotation by date or miles, plus state inspection, brake inspection, coolant, transmission, air filter and alignment you switch on one by one. A queued reminder is dropped if the customer came in first. Intervals are common shop defaults; only oil and tires can be changed per shop | Exists |
| Declined-service reminder | Default 6 months after declined work [S11] | Exists. Declined work follow-up names only the items on their own estimate or inspection, after 30 days by default (14 to 120), stops after 180 days; dropped if the customer came in first | Exists |
| Campaign dashboard | Sent and next-30-days view [S13] | Exists. Sent, delivered, replied, booked and paid afterwards, per promotion and per automation, over 7, 30 or 90 days (Get more customers, Results); next 30 days under Automations, Coming up. Delivered shows once the carrier reports it, but the text webhook ignores delivery receipts, so nothing records it yet (see Built but not reachable) | Exists |
| Promotions to a list | Text and email promotions [S13] | Exists in code. Promotions tab: write, choose who, read every message, test text to yourself, send now or at a set time in the shop clock, stop while it goes out. STOP, quiet hours and limits are checked on the server right before each message. Real texts wait on carrier registration. Migrations 040 and 041 are applied (2026-10-15) | Blocked |
| Audience filters | Based on service history [S13] | Exists. Last visit (not in for, in within), vehicle make and model year, lifetime spend, tags (a person puts tags on a customer in the Tags section of the customer card, 0c2d827, and the filter reads the same tags), has email. Counted live before sending; STOP and no-number are always left out | Exists |
| Referral codes | Not researched | Exists. Codes with a discount you choose; credit a new customer's invoice to a code (checks they are new and the invoice counts once); what each referral paid; thank-you given or still owed. Migration 041 is applied (2026-10-15), so credits are saved | Exists |
| Find new customers | Not researched | Exists. AI lead search; check email-marketing law before auto outreach (unverified) | Exists |
| Social post drafts | Not researched | Exists. Write a post or have Alpha draft it from what you type (flags invented prices, offers and credentials), character limit per place, preview, save as a draft, copy to post yourself. Publishing is a separate row below | Exists |
| Google Business Profile | Booking via profile [S10] | Partial. Connector listed; Alpha's prompt says Google access is pending approval (unverified now) | Blocked |
| Paid ads | Not researched | Partial. Plan an ad with headline and text (optional AI draft, same checks), see a preview, save as a draft. Starting the ad needs the owner's Google Ads or Facebook account and a payment method | Blocked |
| Publishing posts to Google, Facebook, Instagram | Post from one place | Built for Facebook Pages, Instagram and Google Business Profile (section 23); needs each account connected and approved before anything goes out | Blocked |
| Test text to yourself | Send a sample before it goes out [S11] | Exists. Promotions and every texting automation can text the message to your own number, marked [Test], never to a customer | Exists |
| Safe win-back blast in Settings | Not researched | Exists. The old Settings button sent to up to 500 people at once with one confirmation box; it now points to Promotions, and the old server call makes a promotion so STOP, quiet hours and limits apply | Exists |

## 12. Automations

Screens: Automations.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Ready-made automations | Six marketing automations [S11] | Exists. Thirteen built in (ten that message customers, three that run in the background), each with its own on and off switch, grouped by purpose | Exists |
| Your own automation | Not researched | Exists. Plain-English task with a schedule | Exists |
| Preview before it runs | Message, timing and channel set before saving [S11] | Exists. Preview shows the exact message for each person, who gets it and when, who is held until morning, who is left out and why. Switching on and Run now both open it first. Settings show the real messages as you type | Exists |
| Pause cancels queued messages | Pausing cancels pending [S13] | Exists. Pausing, the master switch and editing the message cancel what is waiting, and the screen says how many. A paused automation also never sends anything it had already lined up | Exists |
| Limits per customer | One review request per customer [S11] | Exists. One marketing text a week and three a month per customer, a daily limit on service texts, and a per-automation gap (review requests 90 days). Rules sheet changes them. Checked again right before each send | Exists |
| Runs at the stated time | Not researched | Partial. Times are worked out in the shop's time zone and the logic is tested, and the screen says how often it really checks. It needs a check every 5 minutes: vercel.json has one daily job, and the every-5-minutes route (/api/cron/tick) is built (its timing rules are tested, the route itself is not) but nothing calls it, so hourly and 15-minute automations run late until a frequent scheduler is set up | Blocked |
| Safe against double runs | Not researched | Exists. Leases and fencing in migrations 040, 048, 054, 060 | Exists |
| Quiet hours | Not researched | Exists. No texts 9 PM to 8 AM by each customer's own clock (from their area code), longer if you choose, Sundays optional. Messages wait for morning instead of being dropped | Exists |
| Run history | Not researched | Exists. History tab lists every message with who, what was said, when and what happened (sent, waiting, left out and why, did not send), plus every run; failures also email the owner. A carrier's "delivered" or "could not deliver" is not recorded yet, because the text webhook ignores delivery receipts | Exists |
| Delivered or failed at the carrier, per text | Delivery status for each message sent [S13] | Blocked. The text webhook (`/api/sms`) now passes Telnyx delivery notices to the recorder (`lib/automation-delivery.ts`) after the signature check, so history can show delivered, not delivered and the carrier's reason; inbound text handling is unchanged. It only works once Telnyx is set to send message events to this address and `TELNYX_PUBLIC_KEY` is set on the host (the webhook refuses every request without it), and only for texts sent through Telnyx. Not tried with a real text | Blocked |
| Master off switch | Not researched | Exists. One switch pauses every automation and promotion and cancels what is waiting; each automation also has its own switch | Exists |
| Rules for all automations | Not researched | Exists. Quiet hours, Sundays, marketing and service limits, failure-alert email, in one Rules sheet | Exists |
| Results per automation | Sent, replied, booked [S13] | Exists. Sent, replied, booked and paid afterwards over 7, 30 or 90 days; each reply, booking or payment is credited once to the last message that customer got. Delivered is not counted yet, because the text webhook ignores delivery receipts | Exists |
| Coming up | Next 30 days view [S13] | Exists. Messages waiting by day, next scheduled runs, appointments to remind, vehicles coming due | Exists |
| Failure alerts and retries | Not researched | Exists. A temporary failure retries up to three times; a message the carrier is unsure about is never sent twice; the owner is emailed when messages fail | Exists |
| Reminder dropped when the customer came back | Cancels on early return [S11] | Exists. Service, declined-work and win-back messages still waiting are cancelled if the customer paid an invoice after they were lined up | Exists |

## 13. Reports

Screens: Reports (Overview, Sales, Profit, Money, Jobs, Technicians, Calls, Accounting, Emailed). Needs migration 055 (applied) for expenses, accounting settings, saved reports and month close; Overview, Sales, Money, Jobs, Technicians and Calls read invoices and payments only.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Money at a glance | ARO, car count, parts margin, labor rate [S15][S16] | Exists. Overview: Collected, Invoiced, Average invoice, Still owed, Cars serviced, Labor rate you earn, Gross profit, Estimates approved online, Repeat visits, Incoming calls; each number opens the invoices behind it. Tests | Exists |
| Period with comparison in words | Benchmark against other shops [S15] | Exists. Fifteen period choices (today to all time, or pick dates), said in words ("Up 12% from the 7 days before"). Tests | Exists |
| Compare any two dates | Not researched | Exists. Compare with the period before, the same dates last year, dates you pick, or nothing. Tests | Exists |
| Car count, new versus returning | Core Shop Index metric [S15][S16] | Exists. Cars serviced, new customers and returning, with walk-ins that name no one counted and said. Tests | Exists |
| Effective labor rate | What you collect per hour after discounts [S16] | Exists. "Labor rate you earn": labor collected per hourly labor hour, after line discounts (the discount is built into the stored price). Tests | Exists |
| Parts margin | (retail minus cost) over retail [S16] | Partial. Counts only lines with a cost written down, and says how many lines that is. Gross profit shows the share of jobs with a missing part cost | To build |
| Sales by kind of work, advisor and technician | Not researched | Exists. Reports, Sales: tap a row for the invoices it was added up from. Work that matches no rule lands in "Other work" and the biggest are listed | Exists |
| Gross profit per job and shop | Per-job gross profit [S1] | Exists. Reports, Profit lists each job with its margin, and says when a part cost or technician time is missing. Labor cost comes from the cost per hour in Accounting settings. Tests | Exists |
| Technician efficiency | Billed hours and efficiency [S28] | Exists. Reports, Technicians (labor billed per technician, hours billed against hours on the clock) and Team, Efficiency (hours sold against hours worked on each repair order). Tests | Exists |
| Owed by age | A/R view [S8] | Exists. 0-30, 31-60, 61-90, over 90, each open invoice listed | Exists |
| Payments file and sales tax | Financial reports to download [S39][S40] | Exists. Formula-safe CSV; sales tax by quarter | Exists |
| Approval rate of recommended work | Approval rate and sell-through [S28] | Exists. "Estimates approved online" on Overview: approved of those sent for online approval, with the ones still waiting. Inspection answers are not counted in it yet | Exists |
| Repeat visits | Not researched | Exists. Overview shows the share of cars that came back within a set number of days of an earlier invoice and lists them (some are new problems, not comebacks). Tests | Exists |
| Tax-ready profit and loss | Not researched | Exists. Reports, Profit: profit and loss for the period on cash or accrual, cost of goods from invoices or from purchases, by month, with a CSV. Needs expenses entered under Accounting, Bills and expenses. Tests. Whether it suits a tax return is for the accountant | Exists |
| Report by email on a schedule | Stripe reports can be downloaded and filtered [S39] | Exists in code, checked by tests. Reports, Emailed saves a report (period, comparison, who gets it, weekly or monthly), shows the exact email, sends a test to yourself and sends now (needs the shop's email key). A weekly or monthly schedule is now sent: the daily job (`/api/cron`, 00:00 UTC) calls `/api/reports/scheduled` for every shop (6bc49f7), and that route claims each report and period once before sending, so a repeat run sends nothing twice. It needs `CRON_SECRET` set on the host and the shop's email key; I did not check either. The job runs once a day, so when a report arrives is set by that job and not by the shop. Saved reports use migration 055 (applied). Not tried with a real mailbox | Exists |
| Benchmarks against other shops | Quarterly index of 10,000-plus shops [S15] | Missing. Needs many shops | To build |
| Honest about gaps | Not researched | Exists. Paid-with-no-payment invoices pointed out | Exists |
| Chart you can read without sight | Not researched | Exists. Hover, drag, arrow keys, hidden table | Exists |
| Download the tables or print the report | Financial reports to download [S39][S40] | Exists. Every report can be downloaded as CSV or printed (the print window saves a PDF); the file is made from the same tables as the screen | Exists |
| Alpha's AI calls beside human calls | Not researched | Exists. Reports, Calls: who answered (people, Alpha), busiest days and hours, calls hung up fast. Tests | Exists |

## 14. Accounting and payroll

Screens: Reports > Accounting (Files, Accounts, Bills, Month end, Payroll, QuickBooks, Settings), Reports > Profit, Team > Timesheets. Needs migration 055 (applied).

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| QuickBooks sync | Posted orders, payments, fees, A/R, POs sync one way with review [S14]; invoices and customers [S24] | Partial. Import files work today: QuickBooks Online journal entries (CSV), QuickBooks Desktop (IIF), a plain ledger and a list of accounts used, all built from invoices and payments and checked before download. A live connection needs an Intuit developer app that only the owner can create; the sign-in button stays off and the page says what is needed | Blocked |
| Choose individual or summary entries | Pick before posting [S14] | Exists. Accounting, Settings: one entry per invoice, or one per day. Tests | Exists |
| Reconciliation checks | Compare totals to end-of-day report [S14] | Exists. Checks before download: every entry balances, entries match what was billed, invoice lines add up to totals, Paid invoices have a payment, payments belong to an invoice and none comes before its invoice, invoices name a customer, numbers are unique, no drafts left. Daily totals to hold against the bank. Tests | Exists |
| Expenses and vendor bills | Purchase orders and sublets sync [S14] | Exists. Accounting, Bills: add, edit, pay and void expenses (nothing is deleted; a void can be put back), a warning for a likely duplicate, bills owed by age. Feeds profit and loss. Purchase orders and sublets do not sync because there is no purchase-order screen. Tests | Exists |
| Month-end checklist | Not researched | Exists. Accounting, Month end: automatic checks plus manual items, a saved review per month, and a note when numbers changed since it was closed. Closing does not lock invoices. Tests | Exists |
| Name your accounts the way your accountant does | Not researched | Exists. Accounting, Accounts: tell Alpha Desk what your accountant calls each account so the files import without renaming. Tests | Exists |
| Export for the accountant | Not researched | Exists. The files above, the Payments file and sales tax by month or quarter, split by the agencies the shop sets | Exists |
| Payroll export | Clock records feed pay [S28] | Exists. Reports, Accounting, Payroll shows hours by person and by week and downloads two CSV files. Regular, overtime and double time follow the shop's own rules from Team, Rules (first day of the pay week, weekly and daily overtime, double time), using the same function as the Team screen, so the two screens give the same hours; if the rules cannot be loaded it says so and uses the plain Monday to Sunday, 40-hour week. A double time column is added to the files only when someone earned double time. Before 2026-10-15 this screen always used Monday to Sunday and 40 hours, whatever the shop had set. Hours only; pay is not worked out | Exists |
| Payroll integration | Not researched | Missing | To build |

## 15. Parts and inventory

Screens: Parts lookup, Inventory.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Price and availability from suppliers | Compare prices in the catalog [S24] | Partial. Store pages, source link when price cannot be verified | To build |
| Order from a catalog | PartsTech, Nexpart, RepairLink; WORLDPAC in Shop-Ware [S24][S26] | Missing | To build |
| Budget, mid, premium options | Not researched | Exists. Up to three options per part with kits | Exists |
| On hand and reorder level | Inventory with change log [S28] | Exists. Low and out of stock lamps, on-order tab | Exists |
| Who changed a quantity | Inventory change log [S28] | Built, not reachable. Every count change can be written to a history line (who, when, from, to) and shown per part. The route and rules are written and tested; the Inventory screen saves counts directly and does not use them. The one-transaction count functions are migration 057, applied 2026-10-16 | Not reachable |
| Purchase orders and receiving | POs sync when received [S14] | Built, not reachable. Vendors, purchase orders (draft, send by email, receive in part, cancel), returns and cores, vendor price comparison, price rules, barcodes and shelf value are written and tested in /api/inventory and its store. No screen calls it, and the order and receiving functions are migration 057 (applied 2026-10-16); migration 056's tables are applied. Today the screen shows an On-order count only | Not reachable |
| Part status on a line | Awaiting delivery label [S27] | Exists. Ordered, Backordered, Received, Installed, Returned | Exists |
| Returns and cores | Parts return orders [S14] | Partial. Core charge on documents. The return flow (supplier returns, cores sent back, credit expected) is written with the purchase-order code above and has no screen | Not reachable |
| Who may order parts | Ordering permissions [S28] | Partial. The inventory route lets only owners, admins, managers and service writers buy or price, and everyone but viewers count and receive; no screen uses it yet and there is no setting | To build |

## 16. Repair information

Screens: Repair info.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Manuals and diagrams | Licensed data: ALLDATA [S17]; torque, belts, TSBs [S1] | Exists. Free public manuals with diagrams inside the app and sources | Exists |
| Labor times | Labor guides [S1] | Missing | To build |
| Vehicle by VIN | Not researched | Exists. Decodes from one search box | Exists |
| Technical bulletins and recalls | TSBs in lookups [S1] | Unverified. Recall words are routed; TSB coverage not checked | To build |
| From answer to estimate | Lookups inside the estimate [S1] | Exists. "Create Estimate" with no invented part prices | Exists |
| Fast and reliable | Not researched | Partial. Cached 7 days; manual site can be slow | To build |
| House design | Not applicable | Partial. The screen was rebuilt (Answer, Estimate, Sources and a deeper Workspace view; tests on the layout rules). It was not re-checked at 390 and 1280 pixels, light and dark, in this audit | To build |

## 17. Insurance claims

Screens: Insurance claims.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Claim stages | Not researched (collision systems not compared) | Exists. Nine stages with lamp and word | Exists |
| Supplements and deductible | Not researched | Exists. Filters for supplement and deductible due | Exists |
| AI claim helper | Not researched | Exists | Exists |
| Carrier and adjuster details | Not researched | Exists. Insurer, claim and policy number, adjuster name and phone | Exists |
| Photos on a claim, estimate import from a carrier | Not researched | Missing. No photo or upload on the claims screen | To build |

## 18. Today, search and speed

Screens: Today, search box, shell.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| One list of what needs you | Home flags disputes and verifications [S39] | Exists. Texts, missed calls, money owed, old estimates, stuck jobs | Exists |
| Setup progress | Not researched | Exists. "Finish setting up your shop" | Exists |
| Money, shop, technicians, schedule | Customizable home widgets [S39] | Exists. Fixed layout | Exists |
| Daily notes | Not researched | Exists | Exists |
| Search | `/` to search by name or id [S38] | Exists in code. The search box finds customers (name, phone, email) and estimates and invoices (customer or number); `/` opens it when you are not typing | Exists |
| Command menu | Ctrl or Cmd+K opens any page or action [S38] | Exists in code. The same box jumps to every page in the navigation (by name or what people call it: "payroll" finds Team), starts Write up a car, New estimate, New invoice, Start an inspection, New text message and Book an appointment, and switches light and dark mode. Arrow keys move, Enter opens the first result, Esc closes. Tests. Tried on the live app on 2026-10-15: `/` opened it, typing "payroll" listed Reports and Team, Enter opened Reports. The Ctrl+K key itself could not be sent by the browser tool, so it was not tried; the same handler opens the menu for `/` | Exists |
| Keyboard shortcuts | Short key sequences, `?` lists them [S38][S39] | Exists in code. G then a letter goes to a main page (D Today, C Customers, W Work, I Inbox, A Ask Alpha, J Jobs, B Shop board, S Schedule, E Estimates, V Vehicles, P Parts lookup, R Reports, T Team). They never fire while typing, with a modifier key, or over a dialog. `?` opens the menu, which shows each page's shortcut beside it. Tests. G then T opened Team on the live app (2026-10-15) | Exists |
| Pinned and recent pages | Shortcuts section [S39] | Partial. Recent is built (2026-10-16): the command menu starts with the last four pages opened, newest first, leaving out the page you are on. They are kept in this browser only, as page addresses and nothing else, so another phone or computer has its own list. Checked by tests, in a browser preview with sample data (phone and desktop) and on the live site (the menu opened with Customers, Settings and Vehicles under Recent, and left out the page that was open). Pinning a page of your own is not built | Partial |
| Empty states that name the action | Linear (not verified from an official page) | Exists on rebuilt lists | Exists |

## 19. Settings, team access, connected apps

Screens: Settings, Connected apps, Agents and tools, Setup guide, login.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Shop details, rates, tax, payment methods | Not researched | Exists. Defaults: $120 labor, 8.25 tax if blank | Exists |
| Per-shop logo | Logo and colours in settings [S39] | Exists. Migration 034 is applied (2026-10-15) | Exists |
| Business hours | Not researched | Exists, in two places. Settings, AI receptionist: weekly hours, closed days, holidays and time zone for calls and texts (until set, the assistant never states hours). Schedule, Settings, Hours: opening hours for booking and capacity. They are separate settings, so a shop has to keep both right | Exists |
| Warranty wording per shop | Not researched | Partial. Presets are Alpha's legal text with the name swapped in | To build |
| Permission roles | Roles per person [S39] | Partial. What a signed-in person may do comes from their shop membership role (owner to viewer) and is enforced in the API; there is no screen to invite someone or change that role. Team has a role on each person for the time clock and pay rules, but adding someone there creates a time-clock person, not a sign-in | To build |
| Never show another shop's identity | Not applicable | Partial. Settings-driven; Alpha-specific warranty text and call-type names remain in code | To build |
| Connected apps | Direct links to QuickBooks and parts [S24] | Partial. Facebook, Instagram, Google Business, Google Calendar only | To build |
| Multi-location | View jobs and techs across shops [S20][S28] | Missing | To build |
| Setup guide | Not researched | Exists. Three steps | Exists |
| Help, privacy, terms | Not researched | Exists | Exists |
| Test and build safety | Not applicable | Exists. On 2026-10-15 during this audit: 2,026 tests passed, the type check was clean and lint had 0 errors and 25 warnings (on 2026-10-16, after the estimate link and the board details: 2,047 passed, type check clean, lint 0 errors and 26 warnings; the extra warning is an unused lint comment in `src/lib/browser/store.ts` that this work did not touch). The tests read the code and run its logic; they do not click through the live app | Exists |

## 20. Built-in browser

Screens: Browser (`/browser`) and the browse tool inside Ask Alpha. Added 2026-10-15 from the owner's request: "i want a built in web browser, a professional one better then chrome."

Honest framing: nobody beats Chrome as a general-purpose browser, and this section does not try to. The professional version the AI companies ship is a browser inside the product that the AI can drive while the person watches and can take over [B1][B3][B5]. This section is that, built for shops (parts sites, insurance portals, recall and VIN sites, manufacturer repair sites).

Where this stands (checked 2026-10-15 by reading the code and the 14 `browser-*` test files in `web/tests`, not by using the live app): the Browser screen, Reader view, Live view, Ask Alpha lookups, the activity log, the default block list and the safe fetching are built in code and checked by tests, and the Browser is in the navigation. The parts that save things use migration 058 (settings, allow and block lists, quick sites) and 059 (approvals, downloads, paired computers), which were applied on 2026-10-16 and have not yet been tried on the live app. Anything that would send, buy, agree or download still stops for the person's approval, never guessed. Whether the headless browser starts on Vercel for Live view, Ask Alpha lookups and pictures is not confirmed: the Chromium file is set to ship with only `/api/web-automation` in `next.config.mjs`.

What runs where, because Alpha runs on Vercel serverless (no long-lived connection, no browser that stays open, and most sites refuse to load inside an iframe):

| Piece | Runs | Why |
| --- | --- | --- |
| Reader view | Server fetch in one request, no browser engine | Fast, cheap, works for most parts, recall and manual pages; page is turned into plain blocks and drawn by Alpha, never as the site's own HTML |
| Live view (snapshot and act) | One short headless browser per tap: open the page, redo the fields already filled, do the one action, take a picture and a list of controls, close | The picture-and-action loop the computer-use tools use [B4]; works on serverless because nothing stays open between taps |
| Ask Alpha doing a lookup | The Browser page runs the loop on the screen (up to 12 steps, Stop button), calling the two views above | The person watches every step and can take over at any time |
| Sites that need a sign-in, cookies or scripts that post data | The shop's own computer ("connect your computer" mode) | Alpha's servers must never hold a shop's passwords, and nothing can stay signed in on serverless |

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| A browser screen inside the product with tabs and an address and search bar | Dia and Atlas put tabs, an address bar and the assistant in one window [B7][B1] | Exists. Browser (`/browser`, in the navigation): up to 8 tabs, an address and search bar, a start page with quick sites, Reader and Live views, an Ask Alpha tab, and Activity and Settings sheets. Built in code, checked by tests; not clicked through on the live app. The small step-picture panel in Ask Alpha chat is still there as the older route | Exists |
| Reader view | Not named by the AI browsers I read (unverified); Stagehand's extract pulls clean data from a page [B7] | Exists. The page is fetched on the server and turned into headings, paragraphs, lists, tables and a facts box that Alpha draws itself, never the site's own HTML; pictures can be turned off in Settings. A note appears when the page text looks aimed at an AI. Built in code, checked by tests | Exists |
| Live view you can tap | Browserbase live view: watch, or take control, of the running page [B5] | Exists in code. Live view shows a picture of the page with its controls listed; one tap does one thing (fill, choose, click, scroll) and a new picture comes back. Capped at 1,500 live actions a day for the shop. Checked by tests with a stand-in browser; starting the real headless browser on Vercel is not confirmed | Exists |
| Screenshots and page snapshots | Screenshot after every action [B4] | Exists. Live view makes its own picture with Alpha's locked headless browser, and `/api/screenshot` now uses that same browser; no outside screenshot service is called and the page address is not sent to a third party. Same Vercel caveat as Live view | Exists |
| Ask Alpha does the lookup while you watch | Agent mode opens tabs, clicks and finishes multi-step tasks, and pauses on sensitive sites so you can watch [B1] | Exists. Browser, Ask Alpha tab: Alpha takes up to 12 small steps, each listed on screen, with a Stop button always showing. It needs the shop's AI key saved and the Alpha switch on in Browser Settings, and the daily cap is 400 lookups. Built in code, checked by tests. Ask Alpha chat still has its own older browse path through `/api/web-automation` | Exists |
| Take over at any time | Live view lets a person click and type in the same session [B5] | Exists. Take over moves the page Alpha was on into Live view in a normal tab, so the person continues from the same page and fields. Built in code, checked by tests | Exists |
| Approval before a submit, purchase, message or download, showing the exact action | Pause before high-risk actions such as publishing or purchasing [B3]; confirm before sending, buying or filling details [B9]; human confirms real-world consequences [B4] | Built in code, checked by tests, but blocked on migration 059. An approval card names the website, the address and every value that will be sent, is good for that one action and lasts 10 minutes; the model cannot approve. Until 059 is applied, anything that sends, buys, deletes, agrees or downloads is refused with a "needs a database update" note | Blocked |
| Never types passwords, card numbers or one-time codes | Keep logins and sensitive data away from the agent [B4]; logged-out mode [B1] | Exists. Password, card, security code and one-time code boxes are never filled by Alpha or by a tap; typed values that look like a card number (with a check-digit test), a social security number or a secret are refused; the person does that step on the website. Built in code, checked by tests | Exists |
| Sign-in steps hand control to the person | Pauses on sensitive sites [B1] | Exists. A sign-in or human check stops with the plain words "Do this step on the website yourself" and is marked red as a step for the person. Built in code, checked by tests | Exists |
| Page text is data, never instructions | Mark retrieved content untrusted, separate it from the person's request, scan for hidden text [B9][B10]; pages can hide instructions [B2] | Exists. Invisible and hidden characters are stripped, instruction-like text (visible or hidden) is flagged to the person and to the model, page text goes to the model in a labelled block that the page cannot close, and a flagged page gets fewer allowed actions. Nothing from a page can approve anything. Built in code, checked by tests | Exists |
| Check each action against what was asked | Check proposed actions against the request [B10] | Partial. Plain code (not the model) checks that typed text comes from the request or the page, that opening a site the request did not name needs approval, and that the final answer is supported by the page text. There is no check that every click serves the request | To build |
| Activity log of every page and action | Session replays of each step [B6] | Exists. Browser, Activity lists the last 80 pages and actions for the shop (who: you, a teammate or Alpha; which site; what happened) with filters, from the existing audit log, so it does not need 058 or 059. Waiting approvals are listed there too (needs 059). Built in code, checked by tests | Exists |
| Saved quick sites for the shop | Pinned apps and profiles [B8] | Exists in code; migration 058 is applied (2026-10-16) and saving has not been tried on the live app. Seven built-in quick sites show now (recall check, VIN decoder, RockAuto, AutoZone, NAPA, O'Reilly, Advance); saving, ordering and removing the shop's own use the new table | Exists |
| Per-shop allow and block lists | Site-level permissions and admin allow and block lists [B3]; allowlist domains [B4] | Exists in code; migration 058 is applied (2026-10-16) and saving has not been tried on the live app. Built in code, checked by tests: Settings can switch the shop to "only sites I allowed" and add allow or block rules (a rule covers its sub-sites), checked on every page, redirect, picture and download. Saving them uses the table 058 added | Exists |
| Sensible default blocklist | Blocked categories such as financial services, adult and pirated content [B3] | Exists. Built into the app, no database needed: banks and cards, payments, investing and crypto, accounting sign-ins, identity providers and webmail, adult, gambling and pirated-content sites are refused for everyone. Checked by tests | Exists |
| Master off switch for the AI browser | Settings to turn the extension off [B3]; per-site page visibility toggle [B2] | Exists in code; migration 058 is applied (2026-10-16) and saving has not been tried on the live app. Browser Settings has an "Alpha can use the Browser" switch that the lookup route checks before every step, and the choice can now be saved because the settings table exists; until a shop saves one, Alpha is on | Exists |
| Safe fetching on the server | Resolve, check every address, connect to the checked address, check every redirect, fix the scheme and port, limit the response [B11] | Exists. One shared fetcher: public http or https only, ports 80, 443, 8080 and 8443 only, the name is looked up once and the connection goes to the checked address, every redirect is re-checked against the shop's rules, no cookies or credentials are sent, and size and time limits apply (3 MB per page). Checked by tests. The older `/api/web-proxy` now re-writes the page as plain text under a locked policy | Exists |
| Login required, rate limits and size limits on every fetch route | Not researched | Partial. Every browser route, including the older `/api/web-proxy`, `/api/screenshot` and `/api/web-automation`, requires sign-in, the right role and the shop's rules, and has a size and time limit. The per-minute limits are counted in memory on each server instance, so on Vercel they are a soft limit; the daily caps (1,500 live actions, 400 lookups) are counted from the audit log and hold | To build |
| Downloads never run | Cannot download files [B1] | Exists. The file is passed straight through to the device and never opened, unpacked or run by Alpha; programs and scripts (including double endings such as `.pdf.exe`) are refused outright and logged, and Alpha cannot download on its own. Built in code, checked by tests | Exists |
| Approved downloads of plain files (PDF, pictures, text) | Not described by the products I read (unverified) | Exists in code; migration 059 is applied (2026-10-16) and downloads have not been tried on the live app. Built in code, checked by tests: after the person approves that exact address, `/api/browser/download` saves the file (up to 25 MB, safe file types named, sent as a download with a locked policy) and logs it. Every download still needs an approval for that exact address first | Exists |
| Practice mode on pretend sites | Not researched | Missing | To build |
| Sources shown for what the AI found | Not researched | Exists. An Ask Alpha lookup shows the page and title its answer came from, the quoted evidence, and whether the answer was found on that page; an unconfirmed answer is labelled as unverified. Built in code, checked by tests | Exists |
| Search from the address bar | AI browsers search from the address bar [B8] | Exists. Typing words in the address bar searches (DuckDuckGo's plain results page, only the words typed are sent) and lists results; no search key is needed. The older Ask Alpha chat route uses an optional `SERPER_API_KEY`. Built in code, checked by tests; the live search page was not tried | Exists |
| Connect your computer (desktop host) | Not described by the products I read for a web app (unverified) | To build. Server side is built in code and checked by tests (one-time pairing code, hashed token, a one-command queue; migration 059 is applied 2026-10-16), but there is no screen to pair a computer and no desktop app. It is a contract only, and it is limited to open, snapshot and scroll | To build |
| Use what was found (copy into an estimate or Ask Alpha) | Not researched | Exists. Copy the page or the answer as plain text, or send it to Ask Alpha, which opens with the text in the message box and not sent. There is no one-tap add to an estimate or a job; the text is carried over by hand or through Ask Alpha | Exists |

## 21. AI calling and the phone (extends section 9)

Screens: Inbox (Calls tab and Dial sheet), the browser phone, Get more customers (Start the call), Settings (Texts and calls). Added 2026-10-15 after the owner said section 9 did not cover AI calling and the phone in full. Read from `api/make-call`, `api/voice-join`, `api/telnyx-voice-webhook`, `api/calls/webhook`, `components/PhoneWidget.tsx`, `api/growth/outreach`.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Call from the browser with your own voice | Not researched | Exists in code. The browser phone (WebRTC) is mounted on every signed-in screen: US numbers are put in the right format, mute and hang up, status lamps with words, call token tied to the shop. No automated test found for it; not tried on a live call | Exists |
| Three kinds of call the shop starts: service call, custom AI task, personal call | Not researched | Exists in code, checked by tests. `/api/make-call` takes a service call, a custom AI task or a personal call; a personal call connects silently (no AI greeting, no script, no recording). Calls that carry a task go through the do-not-call, STOP and calling-hours check on the server; a personal call is not held back | Exists |
| A button or Ask Alpha starts an AI call to a customer | AI agents place calls with a goal [S41][S43] | Exists in code, checked by tests. Customers, open a customer, "Call with Alpha" (reasons: car is ready, appointment reminder, check in after a repair, estimate follow-up, service due, something else); Ask Alpha can also propose a call and shows the same review before anything dials. The server rebuilds the instruction from the card's choices, one approval is one call, and the approval is written to the audit trail. AI calls to leads still start from Get more customers. Not tried on a live call | Exists |
| Review card before an AI call (who, number, goal, hours, what it will say) | Pause for approval on risky steps [S35] | Exists in code, checked by tests. The card shows who, the number in plain form, the calling hours, what Alpha will say first (the AI and recording notice), its goals and its limits; Approve is off while a rule blocks the call. The customer sheet then shows the live call, a transcript and a Stop button. Ask Alpha shows its own call card with the same server check | Exists |
| Says it is an AI and that the call may be recorded, first | Disclosure is a required guardrail [S45] | Exists on task and service calls; recording starts only after the notice | Exists |
| Never invents prices; ends politely on "no" | Answers only from shop context | Exists in the call prompt | Exists |
| Calling hours | Not researched | Exists in code, checked by tests. The window is the shop's own quiet hours (set in Automations, Rules; default 8 am to 9 pm, with a no-Sundays choice) and is read on the customer's own time zone from their area code as well as the shop's. A refusal says the earliest time Alpha will call | Exists |
| Do-not-call and STOP check before an AI call | Required in practice (consent and opt-out rules) | Exists in code, checked by tests. Every call that carries a task is checked on the server, whichever screen started it: the customer's do-not-call choice (Customers, contact permissions; migration 053 is applied), a number that replied STOP, and calling hours. If the check cannot be made, nothing is dialled. After a call where the customer asked not to be called, the sheet offers to set do-not-call | Exists |
| Owner joins a live AI call | Live or warm transfer [S43][S41] | Not reachable. `/api/voice-join/[callId]` is built (it dials the owner's phone and moves the live call into a conference) but no screen calls it and no test covers it. It moves the AI's own call leg, so it could cut the AI off; it needs a trial on a live call before it gets a button | Not reachable |
| Listen in without speaking, or whisper to the assistant | Not researched | Missing. Joining means the owner can be heard | To build |
| Natural voice, barge-in, echo filter, two-track transcript | Not researched | Exists. Telnyx natural voices with a fallback voice | Exists |
| Uses the shop's own AI provider and key | Not applicable | Exists. Reads the shop's AI settings, nothing deployment-wide. This stays untouched | Exists |
| Recording playback | Recordings and transcripts [S43] | Exists in code. Recordings stream through a shop-checked proxy (`/api/recording-proxy`) in the Inbox and the AI review list. No automated test found | Exists |
| Transcript and AI summary of every call | Summaries, transcripts [S43] | Exists in code. The daily job transcribes up to 10 calls per shop per run and scores leads; the customer call sheet shows the transcript and summary through `/api/call-summary`. So a transcript can arrive up to a day after the call. `/api/recording-summary` has no screen that calls it. No automated test found for the transcribe job | Exists |
| Call log kept in step with Telnyx | Not researched | Exists in code. Opening Messages pulls the latest Telnyx recordings into the call log in the background and refreshes every 10 seconds. The import of past calls (`/api/growth/import-past-calls`) and the recordings list (`/api/telnyx-recordings`) have no button. No automated test found | Exists |
| Delete a call record | Not researched | Not reachable. `/api/delete-call` is built and checks the shop, but nothing in the Inbox or any other screen calls it; there is no delete button for a call | Not reachable |
| Forwarding, ring groups, after-hours routing, phone menus | Business phone systems [S43] | Missing. One number; hand-off numbers exist for transfers | To build |
| Voicemail box and recorded greeting | Not researched | Partial. The assistant takes messages; the old voicemail page now opens the Inbox calls tab; no greeting or box | To build |
| Call a parts supplier for a price and save the answer to the part (the Erin idea) | Not researched | Partial. A custom task call can ask; there is no supplier list and the answer is not saved to the part | To build |
| Minutes used and cost of calls | Not researched | Partial. Inbox, Calls (2026-10-16) opens with Phone time this month: minutes on the phone, calls in, out and missed, and last month for comparison, added up from the length on each call record. It says plainly that it is recorded call time and not a bill. Calls the assistant handled that carry no length are listed as not counted, and the strip says "At least" and why when the list is full and older calls could be missing (the Inbox loads the latest 1,500). No cost in dollars: the rate comes from the phone company, which I did not read, so the screen points to its bill. Checked by tests, in a browser preview with sample calls (phone and desktop) and on the live site (read only: the strip showed 0 min with two assistant calls that have no length, listed as not counted). Not built: minutes for assistant calls that have no length, a cost per minute, and minutes by day | Partial |
| Tracking numbers per campaign | Not researched | Missing | To build |
| Which numbers and caller names show on the other phone | Not researched | Unverified | To build |

## 22. Finding customers and outreach

Screens: Get more customers (Leads, Follow-ups, Results, Activity).

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| AI search near the shop: unhappy reviewers of competitors, fleets, people posting about car trouble | Not researched | Blocked until a search key is set on the host. Built in code, reachable (Get more customers, Leads): three searches (competitors' unhappy reviewers, fleets and businesses with vehicles, people posting about car trouble). A phone, email or owner name counts only if it is written in what Alpha actually read; sources shown. Every search runs on `SERPER_API_KEY`; without it the searches find nothing. I did not check whether it is set. Only the contact-compliance logic has a test, not the searches | Blocked |
| Contact details from Google Maps, Hunter and web search | Not researched | Blocked. Built in code and reachable from a lead (`/api/growth/apollo-enrich`): Google Maps, then Hunter, then web search, filling only what each returns. Needs the host's `GOOGLE_MAPS_API_KEY`, `HUNTER_IO_API_KEY` and `SERPER_API_KEY`; not checked whether they are set. No automated test found | Blocked |
| Outreach by text, email or AI call, written by Alpha and approved by the owner | Draft then approve [S35] | Exists in code, checked by tests. Nothing is sent unseen; opt-out, calling hours and shop rules are checked; email carries the shop's address and an unsubscribe link. Texts to customers wait on carrier registration (see Blocked on the owner) | Exists |
| Capture a lead from the web or a call | Not researched | Not reachable. `/api/growth/capture` works for a signed-in user, but no screen, web form or call flow calls it. It also writes to `growth_leads` (read by Automations), while the Leads tab reads a different table, `leads`, so a lead captured this way would not show on the Leads tab | Not reachable |
| Lead history and status | Not researched | Exists in code. Leads tab: status, last contact, outreach history and an activity log from the `leads` table. No automated test found for the tab | Exists |
| Estimate follow-up and customer follow-ups | Follow-up automations [S11] | Exists in code through Automations (unanswered estimates, declined work, service due); see sections 11 and 12. Texts wait on carrier registration. The older routes `/api/growth/follow-ups`, `/estimate-followups` and `/service-reminders` have no screen or schedule calling them | Exists |
| Legal check for contacting people who posted publicly | Not researched | Partial. The AI-call sheet warns; whether a given outreach is allowed is the owner's call with counsel | Blocked |
| Leads to customers to dollars | Campaign results [S13] | Missing. No link from a lead to the invoice it later produced | To build |

## 23. Posts, ads and social publishing

Screens: Get more customers (Posts and Ads), Automations (Social posts), Connected apps. Where this stands (checked 2026-10-15 by reading the code and the six `posts-*` test files, not by using the live app): the Posts screen is reachable (Get more customers, Posts) and a Customer OK card sits on each job. The repair-posts pipeline uses `supabase/migrations/060_repair_posts.sql`, which was applied on 2026-10-16 and has not yet been tried on the live app. Posting stays off until the shop turns it on: the mode starts as Off with no places chosen, nothing posts automatically, and no social account is connected yet. The daily job (`/api/cron`) calls the post queue and does nothing for a shop whose mode is Off. This is the owner's example of "every feature the fullest": automatic, uses the shop's real pictures, knows the engine and the repair, groups the right photos, posts for the shop, has an on and off switch, and can be run by asking Ask Alpha.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Draft a post and check it (no invented prices, offers or credentials), preview, copy | Not researched | Exists in code. Post sheet (Get more customers, Posts): character limit per place; save as draft; the wording check refuses invented prices, offers and credentials. Works without 060 | Exists |
| Plan an ad as a draft with headline and text | Not researched | Exists as a draft in code (Ads sheet saves a campaign draft); it does not start an ad. Works without 060 | Exists |
| Real photos come in without retyping | Not researched | Partial (2026-10-15). Pick shop photos lists jobs and their inspection photos with no retyping (listing works now, saving the photos the owner checked needs 060); Post photos from this device re-draws each photo in the browser first. The screen says plainly what is not connected: Google Photos (Google no longer lets apps read a whole library), Apple iCloud (no public photo API for a web app), pictures texted to the shop, and a shared upload link (needs a public upload page and its own table; not built) | To build |
| AI groups the photos by job and picks the best | Not researched | Blocked on 060 for saving. Built in code, checked by tests: photos are grouped by job; Alpha proposes 3 to 6 from rules (the part, the rating, size, sharpness) and says why; Ask Alpha to choose again sends only photo labels to the shop's own AI, never the picture or technician notes. Looking at the groups and proposals works now; saving what the owner checked or changed needs the repair-posts database file (supabase/migrations/060_repair_posts.sql) | Blocked |
| Caption comes from the job record (vehicle, engine, repair), not from guessing the picture | Not researched | Blocked on 060 for queuing a post. Built in code, checked by tests: year, make and model from the job; engine from the VIN decode (nothing said about the engine when it cannot be read); repair from the job and estimate lines. No prices, offers, warranties or credentials; the same wording checker as drafts; AI may only polish wording from those facts. Needs the repair-posts database file (supabase/migrations/060_repair_posts.sql) to save the post | Blocked |
| Privacy first: blur plates and VINs, strip location data, customer permission box on the job (default off) | Not researched | Blocked on 060 for the customer's yes. Built in code, checked by tests: location and camera data are removed twice (re-drawn in the browser, cleaned again on the server). Cover plate or VIN lets the owner drag solid boxes over a photo; Alpha cannot find plates or VINs by itself and says so, and every photo must be checked by the owner before use. The Customer OK to post card is on each job, off by default, but saving it (and the photos already checked) needs 060; nothing is queued or posted without it. Automatic plate or VIN detection is not built | Blocked |
| Publish to a Facebook Page, an Instagram professional account, Google Business Profile | Post from one place | Built, but needs each account connected and approved (Instagram: professional account, public image address, JPEG, 50 API posts a day). The connector routes now take several photos (Facebook Page, Instagram carousel) or one photo (Google). Anything not connected shows Not connected with a link to Connected apps and is never reported as posted | Blocked |
| Off, Suggest or Auto, with a weekly cap | Not researched | Blocked on 060. Built in code, checked by tests: Off by default; Suggest queues posts for a tap; Auto posts only Alpha-prepared posts for finished jobs with the customer's yes, checked photos, clean wording, a connected app, room under the weekly cap, and after a 12-hour review window. Alpha looks once a day (the daily schedule calls the post queue), so Auto can be up to a day late. Needs the repair-posts database file (supabase/migrations/060_repair_posts.sql) | Blocked |
| Ask Alpha runs it ("turn posts off", "show what you'd post this week", "post this one tomorrow") | Not researched | Exists in code; 060 is applied (2026-10-16) and this has not been tried on the live app. Built in code, checked by tests (`tests/ai-posts-tools.test.mjs`, 0a62529): Ask Alpha has a `posts` tool (`web/src/lib/ai/posts-tools.ts`, wired in `web/src/app/(app)/ai/page.tsx` and switched off with the Social Media switch). Looking runs on its own: the queue, the mode and the weekly count, recent jobs and whether the customer said yes, one job, its photos and the words Alpha would use. Every change stops at a review card first (make a post draft, post it, skip it, set posting to Off or Suggest, take a customer's yes away) and is sent to `/api/growth/post-queue` with the approval header only after the owner approves. Ask Alpha cannot turn Auto on, record a customer's yes or accept a wording flag, and the post card cannot be approved while a wording flag or blocker is on the post; those stay on the Posts screen. "Post this one tomorrow" has no time setting in the tool: the card shows the time already on the post, if any. Nothing it does posts without the owner approving a review card | Exists |
| Approve by text ("reply Y to post") | Not researched | Missing | To build |
| Log of every post with undo where the platform allows | Not researched | Blocked on 060. Built in code, checked by tests: a log on the Posts screen shows every post, the result per place, who or what sent it (you, Auto, Ask Alpha), and undo: skip before it goes out, or a plain "cannot be undone from Alpha" with how to delete it in the app. An unclear result blocks a blind retry until the owner says what they saw. Needs the repair-posts database file (supabase/migrations/060_repair_posts.sql) | Blocked |
| Ads: always approval-first, with a budget cap in the owner's own ad account | Not researched | Missing. Starting an ad needs the owner's ad account and payment method; Alpha never stores a card | Blocked |
| Results the platforms really report, plus "how did you hear about us?" at intake | Not researched | Partial (2026-10-15). Posts this month from Alpha's own log; likes and comments only when Facebook or Instagram report them, otherwise the screen says none are recorded (Google reports none). An optional How did you hear about us? sits on the job and adds up on the Posts screen. All of this is recorded in the tables 060 added (applied 2026-10-16); nothing has been recorded yet | To build |

## 24. Pages customers open

Screens: status link, signing page, inspection page, booking page, unsubscribe page, privacy, terms, help.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| "Where is my car" status link | Automatic status messages [S19] | Built in code; its database file (051) is applied (2026-10-16) and no real link has been made yet. The public data route `/api/status?token=` (shop name and phone, the car by year, make and model, a plain status, promised time, an optional note, a link to a sent inspection; never ids, plate, VIN or prices), the staff route `/api/jobflow` that makes or cancels the token, the wording rules, the customer page at `/status/<link>` (status, four steps, parts, expected time, a note from the shop, See your inspection, Call the shop; refreshes itself; a bad link says so with no retry), and a Status link section on the job sheet (make, copy, Write the text, which opens the text composer so the shop reads it before it goes, and Turn off with a confirm). The same make, copy and turn off is also on the Shop board car sheet, under Customer page (it does not text from there; texting is on the full job). The customer page reads what the shop sets under Parts and time: the parts line and due date, the expected time and a one-line note. The page was previewed with sample data at phone and desktop width, and on the live app a made-up link shows the "not valid" page with no sign-in (2026-10-15). The Status link section on the job sheet was not seen live because the shop has no jobs; no real link has been made yet (file 051 was applied 2026-10-16). On 2026-10-16 a link was made and opened against a local stand-in database and showed the right parts line, expected time and note | Partial |
| Approve and sign an estimate or invoice | Click or signature with a saved record [S1] | Exists in code. Request signature in Documents makes a link (valid 30 days); the signing page `/sign/[token]` shows the document and saves the signer's name, a drawn signature and the time to the live `signatures` table, and it is let through the sign-in wall. Estimates now use the private link described under Signature and approval (the signed-record and history tables in file 046, applied 2026-10-16); this older page and the signatures table remain for invoices and for links already sent. Tests cover the new link; not tried on a live link | Exists |
| Inspection page with approve or skip per finding | [S27] | Exists in code, checked by tests. `/inspection/[token]` is let through the sign-in wall; random token, only the fields the customer needs, rate limited, photos and clips by short-lived links | Exists |
| Book online | Booking widget [S10] | Exists in code, checked by tests. Public page `/book/[slug]` and the `/api/book` routes (shop info, open slots, request, calendar feed) are let through the sign-in wall; database tables applied 2026-10-15; not yet checked on the live app | Exists |
| Unsubscribe in one tap | Required for marketing email | Exists in code, checked by tests. The signed link and the confirmation page (`/api/outreach/unsubscribe?t=...`: GET shows a page and changes nothing, POST unsubscribes, and a mail app's one-click unsubscribe works) are now on the list of addresses that skip sign-in in `web/src/middleware.ts` (6bc49f7), and only that one path under `/api/outreach`. The opt-out is saved in `email_opt_outs` (migration 040, applied) and checked before email is sent. Not tried with a real email link | Exists |
| Privacy, terms, help | Not researched | Exists. The legal wording needs review by counsel before other shops use it | Blocked |
| The shop's logo, name and colours on every page | Logo on every customer page [S39] | Partial. The logo shows on printed documents and on the inspection page. It is not on the signing page or the booking page, and no customer page uses the shop's colours | To build |
| Pay from the page | Pay link, no login [S3] | Missing | To build |
| Customer portal (history, documents, vehicles) | Not found (unverified) | Missing | To build |
| Spanish for customer pages, texts and the AI receptionist | Not researched | Missing. I found no Spanish in the customer pages or the receptionist rules. Houston shops need it | To build |

## 25. Ask Alpha's agents, tools and connections

Screens: Agents and tools, Connected apps, Ask Alpha.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Nine agents (Router, Shop Ops, Parts, Repair, Desktop, Browser, Communications, Reports, Safety) | Specialist agents [S35] | Exists. Agents and tools (in the navigation) lists the nine with what each can do and its risk level, read from `lib/ai/capabilities.ts`. A test checks the definitions are there; it does not click through the screen | Exists |
| Tools (parts lookup, repair search, open browser, download image, open file, MCP discover and call, send SMS, shop action) with read, write, contacts others, delete and sensitive labels | Not researched | Exists. Nine tool names (parts lookup, repair search, open browser, download image, open file, MCP discover, MCP call, send SMS, shop action), each with its read, write, contacts others, delete or sensitive label, a time limit, retries and an audit flag. A test checks the definitions are there | Exists |
| Eleven ready skills (verified parts search, estimate from verified parts, source-backed repair research, customer lookup, browser tab inspection, desktop file workflow, call summary, missed call recovery, review request, service reminder, send flow) | Not researched | Exists. All eleven are defined with their tools, success tests and what happens on failure. A test checks the definitions are there | Exists |
| Durable multi-step jobs with a cancel | Not researched | Exists in code, checked by tests. Workflow routes with leases and a cancel (`/api/ai-workflow`, `/api/ai-workflow/cancel`) are called from Ask Alpha | Exists |
| Connect a ChatGPT plan instead of pasting a key | Not researched | Exists in code. Private connection, owner only, in Settings. This stays untouched. No automated test found; not tried with a real plan | Exists |
| Google Calendar | Not researched | Exists in code (Connected apps, `/api/connectors/google-calendar`). No automated test found; not tried with a real Google account | Exists |
| Facebook, Instagram, Google Business | Direct links [S24] | Partial. Sign-in flows exist; approvals are the owner's | Blocked |
| QuickBooks, a card processor, PartsTech, CARFAX | Direct links [S24] | Missing | To build |
| Turn each agent or tool on or off per shop and per role | Admin controls [S3] | Partial. Per shop, Settings, Assistant rules can switch a whole kind of action (look up, draft, save, send) to Ask me first or Off and can switch off single actions by name; customer-facing and money actions always ask. There is no per-agent switch and nothing per role | To build |
| Master off switch for all of Ask Alpha | Not researched | Partial. No single switch. The receptionist and the browser have their own (the browser one is saved by migration 058, applied 2026-10-16), and Settings, Assistant rules can set each kind of action to Off, which together stop Ask Alpha acting but not answering | To build |

## 26. Notifications, notes, reminders and background work

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| In-app alerts and tab counts | Team alerts [S29] | Exists in code. An unread-text count on the phone tab bar; while the Inbox is open, a notice, the count in the browser tab title and (if allowed) a desktop notification for each new text; Today shows short alerts for unread texts, short missed calls and inspections a customer answered in the last day. Nothing reaches a phone when the app is closed | Exists |
| Phone push alerts | Mobile push [S29] | Missing. Needs the installable app (section 30) | To build |
| Email alerts for failures, texts the assistant did not answer, calls needing a person | Not researched | Exists in code, checked by tests (voice pipeline tests). The assistant emails the shop's team when a call or text needs a person, a summary after each call, and optionally each new text, to the address in the receptionist rules or the shop email. Needs the shop's email sending set up (Gmail or Resend); not tried with a real mailbox. "Failures" in the row means those hand-offs; there is no email when a background job fails | Exists |
| Daily notes on Today | Not researched | Exists in code. A notes box on Today saves through `/api/daily-notes`. No automated test found | Exists |
| Scheduled messages (appointment reminders and others) | Automatic reminders [S19] | Exists in code, with a daily limit. Ask Alpha can queue a text or email for later (`scheduled_messages`, table applied earlier); the dispatcher checks opt-outs and quiet hours, but it runs only inside the daily job, so a message can go out up to a day after its time. No screen lists or edits the queue. Texts to customers also wait on carrier registration. No automated test found | Exists |
| Background jobs (reminder sync, report emails, automation ticks, heartbeats) | Not researched | Partial. One daily job (`/api/cron`, 00:00 UTC in `vercel.json`) runs: audit-log repair, expired Ask Alpha action cleanup, call sync, custom and built-in automations, scheduled messages, call transcripts (10 a shop) and lead scoring, the repair-post queue, and the owner's scheduled report emails (`/api/reports/scheduled`, called for every shop since 6bc49f7). It needs `CRON_SECRET` set on the host or it answers "not configured"; I did not check that it is. Nothing runs more often: the every-5-minutes route `/api/cron/tick` has no caller, so nothing checks for due automations, retries or held messages between the daily runs, and report emails go out at most once a day | Blocked |
| Daily briefing by text or email | Not researched | Not found in code (the old briefing page now opens Today) | To build |

## 27. Shop tablet and desktop host

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Shop tablet clock (PIN clock in and out, full screen) | Time clock [S28] | Exists in code, checked by tests. Team, People has an "Open the tablet screen" button that opens `/kiosk` (full screen, PIN clock in and out, Break). PIN storage is in migration 052 (applied 2026-10-15). The tablet needs a staff sign-in on it; not tried on a real tablet | Exists |
| Sign in from the desktop app | Not researched | Partial. Start and complete pages exist (`/auth/desktop-start`, `/auth/desktop-complete`; no automated test found); the desktop app is not in the repository, so nothing uses them | Blocked |
| Connect your computer (browser host for sites that need a sign-in) | Not described for web apps (unverified) | Partial. Server side built and tested (its tables are in file 059, applied 2026-10-16); no screen to pair a computer and no desktop app. See section 20 | To build |

## 28. Texting and calling channels

Why this section: the owner asked about many ways to text (Google Messages for web, iPhone options, other SMS services). The honest answers, checked 2026-10-15 against official pages where I could reach them:

| Channel | Reality | Status |
| --- | --- | --- |
| Telnyx (current) | Official API on a real business number. Needs carrier registration (standard 10DLC with an EIN, or toll-free verification). The sole-proprietor route costs $4.50 for the brand, $15 for campaign vetting and $2 a month, covers one campaign and one number at low volume, and is for businesses without an EIN | Blocked on the owner |
| Other SMS APIs (Twilio, Bandwidth, Sinch, Vonage, Plivo) | The carrier registration rules are the same; a new vendor changes price and support, not the paperwork | To build (provider-neutral send) |
| Google Messages for web | Pairs one Android phone; texts leave from its SIM. No business API from Google, so every integration is an unofficial bridge that can break or violate terms | Not recommended for automation; optional one-to-one only |
| iMessage | No web client and no public API. Apple Messages for Business is official but customer-first (Maps, website, QR), needs an Apple-approved provider and a live agent in open hours, Apple devices only. A Mac running BlueBubbles works unofficially | Inbound lead capture only |
| Android phone as an SMS gateway | Uses the shop's real number and plan; fine for low-volume one-to-one; carriers can flag automated bulk | Optional, low volume |
| RCS business messaging | Verified sender with logo; iPhone business support not verified | Later |
| One consent layer above every channel (STOP, START, HELP, quiet hours, written consent for marketing) | Alpha already enforces this for Telnyx (STOP, START and HELP are answered in code and covered by the voice texting tests; calling hours and do-not-call are checked before AI calls). It must sit above every channel so switching never skips it | To build |

## 29. Selling Alpha to other shops

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Self-serve sign up and first-run setup | Not researched | Partial. The login page has a Sign up form (shop name, email, password, and Google sign-in) that creates the shop through `/api/shop/ensure` and opens the Setup guide; if the host asks for email confirmation, the person confirms first. No free trial, no plans and no limits. Whether open sign-ups are allowed on the live host was not checked | To build |
| Subscription billing, plans, trial, usage limits | AI sold per outcome or per seat [S35] | Missing. No billing | To build |
| AI cost per shop (pasted key vs included) | Not researched | Partial. Each shop pastes its key or connects a ChatGPT plan; an included AI plan is a business decision | Blocked |
| Shop isolation | Not applicable | Exists for the parts checked. The browser, repair-post and newer tables are service-role only and every server query is filtered by shop; the older tables were not re-audited one by one in this pass. Remaining Alpha-specific wording is listed in section 19 | Exists |
| Owner console: all shops, usage, problems | Not researched | Missing | To build |
| Export all my data and delete my account | Not researched | Partial. The customer list can be downloaded as a CSV from Customers, Customer tools, Export (0c2d827; see section 7); no whole-shop export and no account delete | To build |
| Help center and contact | Not researched | Partial. One help page | To build |
| Terms and privacy reviewed for other shops | Not researched | Blocked on counsel | Blocked |

## 30. Install on a phone, speed, safety and monitoring

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Add to the home screen as an app | Installable web app | Exists in code, checked by tests. Web app manifest (opens full screen on Today, graphite colour, shortcuts to Today, Inbox, Work and Ask Alpha), 192, 512 and maskable icons, an Apple touch icon, and an Install on your phone section in Settings. The phone draws the splash from the icon and colour. Not tried on a real phone | Exists |
| Works when the connection is bad (loading shell, clear "you are offline") | Not researched | Exists in code, checked by tests, within a deliberate limit. A small service worker shows a plain "You are offline" screen with a way back when a page cannot load. It never stores or serves shop data, so nothing works offline except that screen. Not tried on a real phone | Exists |
| Phone push | Mobile push [S29] | Missing. The service worker has no push handling, and the only alerts are on screen while the app is open (see section 26) | To build |
| Security headers | Not researched | Partial. The request middleware sets frame, no-sniff, referrer, strict transport and a permissions policy that allows the camera and microphone for the app and refuses location for every page (which also blocks the clock-in location check; see section 6). A few routes (the older web view, downloads, pictures) set their own strict content policy. There is no site-wide Content-Security-Policy | To build |
| Error reporting and uptime alerts | Not researched | Partial. Built 2026-10-15, checked by tests and by crashing local test pages in a browser (phone and desktop, light and dark). When a page breaks, the person now sees a plain screen (what happened, what is safe, Try again, a way back, a short reference) instead of a blank "Application error" page; signed-in pages keep the menu. There is a not-found page and a last-resort screen for when the page frame itself breaks. Each break, and each error a button or request raises without a screen, sends one cleaned line to the server log (page, kind of error, top of the stack; no names, phone numbers, emails, tokens or query strings; 4 KB, 10 a minute per visitor, 5 a page load, nothing written to the database). Not done: nobody is told when one happens (a person still has to look in the platform's logs, for lines marked client_error), there is no uptime check, and the signed-in version of the crash screen (the same screen inside the menu) was not crashed anywhere, because that needs a signed-in session and a real fault; the public version, the last-resort screen and the not-found page were. The not-found page was also opened on the live site. Browser extensions and offline blips are skipped on purpose | Partial |
| Tests, type check, lint | Not applicable | Exists. Measured on 2026-10-15 during this audit: 2,026 tests passed and none failed, the type check was clean, and lint had 0 errors and 25 warnings. The tests read the code and run its logic; they do not click through the live app | Exists |
| Backups and restore drill | Not researched | Not verified. Relies on the database host's backups | To build |
| Keys rotated | Not applicable | Unverified (see Blocked on the owner) | Blocked |

---

# Quality bar for every screen

Taken from `web/DESIGN.md`. A screen is not done until every box can be ticked.

## House rules

- [ ] **Phone first.** Designed at 390px wide, then widened. No sideways page scroll.
- [ ] **Tap targets** at least 44px tall. Inputs at 16px so phones do not zoom.
- [ ] **Four states on every list:** loading (skeleton), error (what failed plus Try again), empty (what this is plus the one action to fill it), populated. An error never looks like "you have none".
- [ ] **Plain words.** Sentence case. Buttons name the action ("Send estimate", "Record payment") and keep the name through the whole flow.
- [ ] **Errors say what happened and what to do.** They do not apologise or show database text.
- [ ] **No emoji.** Icons come from `Icon`. Mood uses smile, meh, frown.
- [ ] **Lamps come with words.** Colour is never the only signal.
- [ ] **Numbers** are tabular, money has a currency sign and is right aligned.
- [ ] **Keyboard and screen reader.** Every control reachable, labelled, with a visible focus ring. Sheets keep focus. Charts have a hidden table. Status messages are announced.
- [ ] **Dark mode.** Tokens only; nothing hardcoded (no `text-white`, `bg-gray-*`, hex colours, gradients, blur, uppercase, tracked-out eyebrows).
- [ ] **Motion answers a touch.** Nothing animates by itself. Reduced motion respected.
- [ ] **Never leak another shop's identity.** Name, address, phone, logo, warranty and wording come from that shop's settings.
- [ ] **Honest about what is not recorded.** Show a dash or "Not loaded" and say why, never a made-up zero.
- [ ] **Do not change business logic** (money maths, payments, signatures, numbering, shop scoping) while restyling.
- [ ] **Checked at 390x844 and 1280x800,** light and dark, with loading, error, empty and populated data. Tests added for logic; type check and lint clean.

## AI-product bar

| Rule | Why | Alpha today |
| --- | --- | --- |
| Show exactly what will be sent before it is sent | The owner approves recipient, channel, words and total [S35] | Partial. Yes for documents, for Ask Alpha (including its call card) and for an AI call started from a customer (the review card shows who, the hours, what Alpha says first, its goals and limits). Text auto-replies: draft mode shows the exact words with Send, Change and Do not send; auto mode and calls can be tried first in test mode and the greeting preview |
| Human approval for anything customer-facing | Fin pauses for a teammate on sensitive steps [S35] | Partial. Ask Alpha yes. An AI call to a customer needs the owner's approval on a review card. A browser action that sends, buys, agrees or downloads needs an approval card (needs migration 059, otherwise it is refused). Text replies: the shop picks off, draft or auto. Bookings: the team approves unless the shop lets it book open times. Calls answer on their own inside the shop's rules, with a review list afterward |
| Undo, or say it cannot be undone | People mis-tap | Partial. Ask Alpha has an Undo bar for changes that can be put back, and a "Cannot be undone" tag on the rest. Texts and calls the receptionist has already sent cannot be taken back |
| Audit trail the owner can read | Who, what, when, approved [S28] | Exists. Receptionist: Inbox, AI assistant lists every call and text with transcript, outcome and the rules used. Ask Alpha: the Activity screen (Settings, Assistant rules, See what it did). Browser: the Activity sheet on the Browser screen |
| Stop button | A running action can be cancelled | Exists. Receptionist: separate master switches for calls and text replies, a pause on each conversation, quiet hours and per-number limits. Ask Alpha has a Stop control that cancels a running request. The Browser lookup has a Stop button, and a live AI call has a Stop on the customer call sheet |
| Honest uncertainty | Say what is not verified; show sources; never invent prices or parts | Partial. Receptionist: never states a price, time or diagnosis and says the team will confirm; says when it is not sure and passes to a person. Parts show sources; some other prompts still say answer anyway |
| Tell people it is AI | Callers are told [S41]; disclosure is enforced [S45] | Exists on calls (inbound and outbound) and in the first text; cannot be switched off |
| Hand off to a person with context | Fin passes history to a human [S35][S36] | Exists for the receptionist: transfer with a text briefing, and a needs-a-person flag with an email, the transcript and what it wrote down |
| Rules the shop sets | Guidance for tone, handoff, limits [S37] | Exists for the receptionist (Settings, AI receptionist). Ask Alpha has its own rules screen (Settings, Assistant rules). The Browser has its own on and off switch, which is saved by migration 058 (applied 2026-10-16) |
| Safe to repeat | Same request never acts twice | Exists |
| Mark what the AI did | Easy to measure and review | Exists for the receptionist: texts and calls carry an AI marker, a filter chip, and Handled well or Needs work marks |

## The eight things every AI feature gets (added 2026-10-15)

Aaron's rule: "remember ai does everything", and "just dont fix my ai". The AI engine, keys and settings are left alone; each feature plugs into them the way Ask Alpha does.

| # | Rule | What it means on the screen |
| --- | --- | --- |
| 1 | Alpha does the work | The task can be done by telling Ask Alpha in words or by voice, not only through a screen |
| 2 | Off, Suggest or Auto | Suggest shows the exact result and waits for a tap. Anything that costs money or reaches a customer starts in Suggest |
| 3 | The shop sets the rules | Tone, limits, never-say lists, hours, a budget cap where money is involved |
| 4 | One switch and a Stop | The switch turns the feature off; Stop cancels what is running |
| 5 | Practice mode | Runs on pretend data and sends nothing |
| 6 | A log with undo | Who, what, when, why; undo where the outside world allows it, an honest "cannot be undone" where not |
| 7 | Honest | Says when unsure, shows sources, never invents prices, diagnoses or promises |
| 8 | Results in dollars | What the feature brought in or saved |

---

# To build next, in priority order

Rough size is my estimate (S is days, M is a couple of weeks, L is longer). "Owner" means it also needs a decision or account from Aaron.

| # | What | Why in this place | Size | Owner |
| --- | --- | --- | --- | --- |
| 0 | Done (2026-10-16). All 26 files are applied: 034 to 041, 043 to 045, 047 to 050 and 052 to 056 on 2026-10-15; 046, 051, 057, 058, 059 and 060_repair_posts.sql on 2026-10-16 | Customer links and signed records (046), job flow and the status link (051), purchase-order functions (057), browser tables (058, 059), repair posts (060) | S | Yes |
| 1 | Done (2026-10-15). Make the AI receptionist and text auto-reply safe: say it is AI, shop hours setting, never quote prices, "needs a person" flag, off switch, quiet hours | It talks to customers unseen today | M | Yes (wording) |
| 2 | Texting that carriers allow (10DLC or toll-free verification) | Estimate texts, inspection links, reminders and review requests all depend on it | S | Yes |
| 3 | Payment links, card on file and deposits through a processor | Closes the money loop the leaders all have [S3][S22] | L | Yes |
| 4 | Estimate by text with a link: view, approve line by line, sign, pay | Today the text has no link | M | |
| 5 | Done (2026-10-15 audit). Job-level technician time tracking: time on a job is recorded in Team and feeds efficiency, effective labor rate and gross profit. Hours assigned and left on the board columns are still to build | Unlocks tech board hours, efficiency per job, effective labor rate, gross profit | M | |
| 6 | QuickBooks sync | Accountant need; every leader has it [S14][S24] | L | Yes |
| 7 | Payroll file and configurable week start are done (2026-10-15 audit). Still to build: payroll integrations | Payroll CSV exists; shops pay on different weeks | M | |
| 8 | Done (migration 049, applied). DVI photo storage bucket instead of photos inside the row | Up to 24 photos near 220,000 characters each can mean about 5 MB per row | M | |
| 9 | Done (migration 049, applied). DVI per-shop checklist templates | Every shop inspects differently [S5] | M | |
| 10 | Done (2026-10-15 audit). DVI canned-job price lookup | Suggested prices from priced work, fewer typed numbers [S5] | S | |
| 11 | Done inside each inspection (2026-10-15 audit) and on the Vehicles screen (2026-10-16, in code; not yet looked at on the live app). DVI per-vehicle inspection history | Shows what changed since last visit [S7] | S | |
| 12 | Done (2026-10-15 audit). Tire and brake measurements with warning thresholds | Sells brake and tire work with proof; Autoflow keeps tread per tire [S33] | M | |
| 13 | Done (2026-10-15). Shop board: TV or full-screen mode (Shop wall button) | For the shop wall | S | |
| 14 | Done (2026-10-15). Shop board: jump-to-technician chips on phones | Long scroll on a phone | S | |
| 15 | Done (2026-10-15 audit). Undo clock-out, for 15 minutes after a clock-out | Mis-taps happen | S | |
| 16 | Done (2026-10-15). Inbox: AI filter chip, and mark AI inbound calls as read | Owner sees what Alpha answered without clutter | S | |
| 17 | Labor guide integration | Leaders put labor times in the estimate [S1] | L | Yes |
| 18 | Parts catalog ordering (PartsTech first) | Order from the estimate [S2][S24] | L | Yes |
| 19 | Pricing matrices and one-click jobs from the vehicle | Speeds writing; needs 17 and 18 for full value [S2] | L | |
| 20 | Reports round two is done (2026-10-15 audit) including scheduled report emails, which the daily job now sends (6bc49f7; needs `CRON_SECRET` and the shop's email key, not checked): car count, effective labor rate, approval rate, custom date comparison | The Shop Index four numbers [S15][S16] | M | |
| 21 | Done (2026-10-15 audit). Tax-ready profit and loss (needs expenses) | Accountant handoff | L | |
| 22 | Done in code (2026-10-15 audit), not yet checked on the live app. Online booking page and capacity | Leaders book 24 hours a day [S10] | L | |
| 23 | Customer portal | One place for estimates, invoices, inspections, pay and history; builds on 3 and 4 | L | |
| 24 | Done in code (2026-10-15). Command menu and keyboard shortcuts | Speed for office staff [S38] | M | |
| 25 | Rules, tone and handoff are done (Settings, Assistant rules and the receptionist rules). Still to build: an included AI key | Fin-style guidance [S37]; the shop should not paste a key | M | Yes |
| 26 | Stop, Undo and the Activity screen are done (2026-10-15 audit). Still to build: one approval path in Ask Alpha (four kinds of card still run separately) | Finish the AI-product bar | M | |
| 27 | Done except per-thread access and phone push (2026-10-15). Message templates, photos in texts, thread assignment | Shop-Ware and Tekmetric patterns [S12][S29] | M | |
| 28 | Per-shop warranty wording and permission roles screen | Needed before the second shop | M | Yes (legal) |
| 29 | CSV import and export, tags and groups and a read-only duplicate finder are on the Customers screen (Customer tools, 0c2d827). Customer duplicate merge is written but deliberately not wired until Aaron says yes to that specific action. See Built but not reachable | Clean data; Alpha has about 20 to remove | M | Yes |
| 30 | Multi-location view and benchmarks | Many shops later [S15][S20] | L | |
| 31 | Done in code, checked by tests, not tried on a real phone (2026-10-15 audit). Install on a phone: web app manifest, icons, standalone display, offline screen | The owner asked for a home-screen app; nothing is set up | S | |
| 32 | Done in code except listen-in (2026-10-15 audit). AI calling from the app and Ask Alpha: review card, do-not-call check, shop calling hours, results saved to the customer. The owner-joins-a-call route exists but has no button | Section 21 | M | |
| 33 | One consent layer above every texting and calling channel, then a second provider and an optional own-phone mode | Section 28 | M | Yes |
| 34 | Posts: photo sources, grouping, caption from the job record, privacy checks, Off, Suggest or Auto, Ask Alpha control. Built 2026-10-15 except Google Photos, iCloud, the shared upload link, automatic plate detection and approve by text. Ask Alpha can now look at posts and prepare, approve, skip, set the mode (Off or Suggest) and take a customer's yes away, every change on a review card (0a62529). 060_repair_posts.sql is applied (2026-10-16); posting still waits on a connected account | Section 23 | L | Yes |
| 35 | Spanish for customer pages, texts and the receptionist | Section 24 | M | Yes (wording) |
| 36 | The six database files (046, 051, 057, 058, 059, 060) are applied (2026-10-16). Now finish what depends on them | Sections 1, 5, 15, 20, 23, 24 | S | Yes |
| 37 | Self-serve sign up, trial and billing; owner console | Section 29 | L | Yes |
| 38 | Error reporting, uptime alerts, Content-Security-Policy, backup drill. Error screens, the not-found page and quiet error logging are done in code (2026-10-15). Still to do: tell someone when an error happens, an uptime check, a report-only Content-Security-Policy, a backup restore drill | Section 30 | M | |
| 39 | Done in code (6bc49f7). Fix the customer unsubscribe link: `/api/outreach/unsubscribe` is now on the public paths in `web/src/middleware.ts`. Still to do: try a real link | Every marketing email links to it; before the fix a customer who was not signed in got "Unauthorized" and could not unsubscribe (section 24) | S | |
| 40 | Done in code (2026-10-15). The customer status page for "where is my car", plus a Status link section on the job sheet that makes the link and opens the text for review | File 051 is applied (2026-10-16), so a link can now be made (section 24) | M | Yes |
| 41 | Give each built-but-not-reachable item its one missing step, most valuable first | See "Built but not reachable" at the end of this document (eleven items are left) | M | |

---

# Blocked on the owner

Nothing here can be finished by code alone.

1. **Done: the six database files are applied (2026-10-16).** On 2026-10-15 twenty of the twenty-six numbered 034 to 060 were applied. The connector cancelled the apply of the other six each time, so Aaron pasted one combined file into the Supabase SQL editor and ran it: `046_document_links_and_history.sql` (customer links, signed approvals, document history), `051_job_flow.sql` (promise time, parts status, customer status link), `057_parts_functions.sql` (the purchase-order and stock functions), `058_browser_workspace.sql` and `059_browser_approvals_and_hosts.sql` (browser settings, approvals, paired computers) and `060_repair_posts.sql` (repair posts: the settings, the customer's yes per job and the post queue). They only add new tables, functions and triggers. Checked afterwards: 13 new tables and 10 new functions exist with row level security on, the advisors show no errors, and the customer, document, payment and message counts are unchanged. Nothing on the owner is left for this item. What remains is the work that uses these files (see "Still not reachable").
2. **Pushing to GitHub and a Vercel preview.** Needs the Claude GitHub App installed on the account that owns the repo. The rebuild branch is local only until then.
3. **Texting registration.** Needs 10DLC registration or toll-free verification. Telnyx says unregistered traffic gets limited, filtered or blocked [S46][S47]. Until done, every text feature is at risk. The in-app checklist (Settings, Communications) lists each step and writes the answers to paste; only the owner can submit it in the Telnyx account.
4. **Duplicate and test customers.** About 20 should be removed; needs Aaron's approval before anything is deleted.

Also coming up, and not yet decided:

5. **Payment processor and merchant account** for items 3 and 4 above.
6. **QuickBooks Online account access**, an Intuit developer app that only the owner can create, and the chart of accounts to map. The file imports work without any of it.
7. **Paid data accounts:** labor guide (ALLDATA or Mitchell) and a parts catalog account (PartsTech).
8. **Production schema export** for the `dvi` table, which was made by hand and has no migration in the repo.
9. **Rotate keys.** The June 2026 log says keys once in source were compromised and should be rotated. I could not verify they were.
10. **Google Business Profile access.** Alpha's prompt says Google approval was pending. Current status unverified.
11. **Legal wording.** AI disclosure on calls, call-recording notice, and warranty terms for shops other than Alpha. Ask counsel. The assistant says it is an AI and that calls may be recorded by default; the owner should read the wording on the AI receptionist screen and the registration copy before relying on them.
12. **Done (2026-10-15).** Voice and text migrations 037, 038 and 039 are applied: receptionist rules, thread assignment and saved replies, the assistant's activity log, bookings and picture storage, and the carrier checklist.
13. **One live test call and one test text** after the rules are saved, to hear the greeting and the transfer on the real Telnyx number. The assistant is covered by tests with simulated Telnyx events and by the practice screen, but not yet by a live call.
14. **Done (2026-10-15).** Automation and growth migrations 040 and 041 are applied: the message ledger, run history and results for Automations, and promotions, review replies and referral credits.
15. **A scheduler that checks every 5 minutes.** `vercel.json` has one daily job, so automations that should run every 15 minutes or every hour (appointment reminders, car is ready) run late. Options: Vercel Pro with a 5-minute cron on `/api/cron/tick`, or a free outside pinger or GitHub Actions calling it with the cron secret. Nothing calls `/api/cron/tick` today. The daily job itself (`/api/cron`) answers "not configured" unless `CRON_SECRET` is set on the host; I did not check that it is. The Automations screen says how often it really checks.
16. **Accounts for posting and ads.** Publishing a post to Google, Facebook, Instagram or TikTok, and starting a paid ad, need each account connected and a payment method on the ad account. Drafting, preview, copy and the Repair posts queue (Off, Suggest, Auto) are built; connecting the accounts, wait on Aaron. 060_repair_posts.sql is applied.
17. **Which texting route to use.** Telnyx with standard 10DLC (the shop has an EIN) or toll-free verification, then the Telnyx signing key so inbound texts are accepted, and a balance (it was $3.73). Only the owner can submit the registration in the Telnyx account.
18. **A frequent scheduler.** The free option is a database-side job that calls `/api/cron/tick` every 5 minutes with the cron secret. It is a database setting, so it needs a go-ahead.
19. **Customer clean-up.** About 20 duplicate or test customers. Alpha now shows each pair side by side (Customers, Customer tools, Possible duplicates). The merge with undo is written but not wired, and will be wired only after the owner says yes to that specific action.
20. **Sign-ins only the owner can do:** Facebook Page, Instagram, Google Business Profile, ad accounts, QuickBooks, a card processor, the Google Maps, Hunter and Serper accounts for lead details (set on the host as `GOOGLE_MAPS_API_KEY`, `HUNTER_IO_API_KEY` and `SERPER_API_KEY`; the three AI lead searches find nothing without the Serper key).
21. **Legal review:** Spanish and English wording for AI disclosure, call recording and text consent; terms and privacy for shops other than Alpha; whether outreach to people who posted publicly is allowed.
22. **A desktop app, or a decision not to build one.** "Connect your computer" (section 20) and "Sign in from the desktop app" (section 27) need a desktop program on the owner's computer. The server side is built; the program is not in the repository.
23. **A first trial on a live call and a live link.** Several things are built and checked by tests but were never tried for real: the AI calls started from a customer, the signing page, the booking page, the Browser's headless pictures on Vercel, and installing the app on a phone. One try each would turn "built in code" into "works".
24. **Whether sign-ups are open on the live host.** The login page has a Sign up form; whether the host lets anyone create a shop was not checked.

---

# Not verified

- Anything marked "unverified" or "Not researched" in the tables.
- Nothing in this document was checked by clicking through the live app. "Built in code, checked by tests" means the code exists, the screen is reachable from the navigation or another screen, and the tests (1,864 passed on 2026-10-15) read the code and run its logic. It does not mean it was tried on a real phone, a real call or a real customer link.
- The headless browser behind the Browser's Live view, Ask Alpha lookups and pictures (and the older parts lookup and screenshot routes): whether it starts on Vercel was not confirmed. `next.config.mjs` ships the Chromium file with only `/api/web-automation`.
- Whether `CRON_SECRET`, `SERPER_API_KEY`, `GOOGLE_MAPS_API_KEY`, `HUNTER_IO_API_KEY` and the email sending keys are set on the live host.
- Live Telnyx calls and texts, and the sign-in role split: what a signed-in person may do comes from the shop membership role, which the Team staff list does not change.
- Shop isolation was not re-audited table by table in this pass.
- Settings, Growth, Inventory, Repair info, Customers and Ask Alpha were being rebuilt in the working tree (uncommitted) while this was written. The rows for them were re-read against the code on 2026-10-15 and may already be out of date again. Re-read the code before you rely on them. The rows for Customers, the document screen, scheduled report emails, the unsubscribe link and Ask Alpha for repair posts were read again after commits 6bc49f7, 0c2d827, 3ca8b74 and 0a62529 (only the rows that said Not reachable or similar); the test count above was measured before those commits and was not run again.
- Good, better, best, deposits and templates in Tekmetric, Shopmonkey and Shop-Ware: the pages I read did not mention them, which is not proof they do not exist.
- Tekmetric's WORLDPAC, Nexpart, Mitchell, Identifix and QuickBooks listings: not shown on the part of its integration list I could see (only 8 of 80 entries were visible) [S17]. Accounting Link is a third-party QuickBooks link [S14].
- Mitchell 1 Manager SE comes from a third-party listing only [S32].
- Linear's empty states: no official page found. Goodcall's review [S42] is from a competitor; its own site is [S41].
- Slang.ai is aimed at restaurants [S44]. Used only for handoff patterns.
- Automation timing, pause behaviour and per-customer limits in code were not tested against production.
- No collision-estimating systems (CCC, Mitchell Estimating, Audatex) were researched.
- Prices at the time of reading, which may be out of date: AutoLeap $179, $309 and $409 a month on annual billing [S31]; Goodcall from $79 a month [S41]; Rosie $49, $149 and $299 a month [S43]; Intercom Fin $0.99 per outcome plus $29 per seat [S35].

---

# Sources

All read 2026-10-14. Facts above are summarised in my own words.

| Tag | Page | What it was used for |
| --- | --- | --- |
| S1 | https://www.tekmetric.com/feature/estimate-building | Canned jobs, up to three labor guides, text or email send, approve or sign, audit trail, job gross profit |
| S2 | https://www.tekmetric.com/post/tekmetric-launches-smart-jobs | One-click job from vehicle, matrices, inventory and vendor check, locked price |
| S3 | https://tekmetric.com/feature/text-to-pay | Pay link by text or email, no login, cards on file, next-day funds |
| S4 | https://www.tekmetric.com/feature/payments | Built-in processing, terminal, wallets, reconciliation, QuickBooks through Accounting Link |
| S5 | https://www.tekmetric.com/features/digital-vehicle-inspections | Templates, photo and video, canned job links, text or email share, history, declined follow-up |
| S6 | https://tours.tekmetric.com/answers/performing-an-inspection-tekmetric | Four ratings, photo markup, report sent with estimate, no measurements described |
| S7 | https://support.tekmetric.com/hc/en-us/articles/5178699794455-Digital-Vehicle-Inspection-History | Inspection history per vehicle |
| S8 | https://tekmetric.com/post/repairs-management-software-job-board | Job board columns, statuses, sent and viewed icons, A/R view |
| S9 | https://tekmetric.com/post/streamline-mechanic-work-orders-and-workflow-with-tekmetrics-tech-board | Column per tech, assigned and remaining hours |
| S10 | https://tours.tekmetric.com/answers/automotive-appointment-scheduling-software-tekmetric | One calendar, blocked time, online booking, Google booking |
| S11 | https://support.tekmetric.com/hc/en-us/articles/33212380922007-Marketing-Automations | Declined, canned job, lost customer, follow-up, review request automations |
| S12 | https://www.tekmetric.com/feature/two-way-texting | Unified inbox, photos and video, texts stay with the order |
| S13 | https://www.tekmetric.com/feature/crm-marketing | Campaigns, review requests, marketing dashboard, pause cancels pending |
| S14 | https://support.tekmetric.com/hc/en-us/articles/360051828434 | Accounting Link to QuickBooks: what syncs, one way, review before posting |
| S15 | https://tours.tekmetric.com/answers/tekmetric-shop-index | Shop Index: car count, ARO, parts margin, effective labor rate; 10,000-plus shops |
| S16 | https://www.tekmetric.com/post/the-numbers-that-drive-auto-repair-shop-performance | Definitions of ARO, car count, parts margin, effective labor rate |
| S17 | https://tours.tekmetric.com/answers/integrations-tekmetric | PartsTech, ALLDATA and marketing listings; partial view only |
| S18 | https://support.tekmetric.com/hc/en-us/articles/26781766611351-Tekmetric-Mobile | Mobile job board, RO labels, inspections from the phone |
| S19 | https://tekmetric.com/feature/automated-reminders | Confirmations, reminders, service due, review requests |
| S20 | https://www.shopmonkey.io/ | Shopmonkey feature list, multi-location, QuickBooks |
| S21 | https://www.shopmonkey.io/demo-digital-vehicle-inspections | Photo, video, voice notes, e-signature approval, vehicle history |
| S22 | https://support.shopmonkey.io/hc/en-us/articles/46583180576020-Shopmonkey-Payments-Quick-Start-Guide | Terminals, text or email invoices, bulk payments, payout timing, fees, financing fee |
| S23 | https://www.shopmonkey.io/demo-payments | Pay later options, instant payouts, included in subscription |
| S24 | https://support.shopmonkey.io/hc/en-us/articles/38743737653908-Getting-Started-Integrations-with-Shopmonkey | QuickBooks Online, CARFAX, PartsTech, Nexpart, RepairLink, API |
| S25 | https://www.shopmonkey.io/blog/shopmonkey-for-techs | Clock into a service, estimated versus clocked, location sharing |
| S26 | https://shop-ware.com/questions/ | Shop-Ware overview: DVX, Messenger, analytics, supplier integrations, capacity |
| S27 | https://shop-ware.com/features/techapp/ | Tech app: swipe inspections, photo markup, My Work, service hour tracker |
| S28 | https://shop-ware.com/features/employee-management/ | Time clock, overtime, efficiency, approval rate, activity log, inventory log |
| S29 | https://shop-ware.com/features/messenger/ | Single thread, photos and video, staff access, notifications |
| S30 | https://shop-ware.com/ai-receptionist/ | AI receptionist: calls, bookings, after hours, escalation |
| S31 | https://www.autoleap.com | Work board, AI call answering, review requests, integrations, plans |
| S32 | https://www.softwareadvice.com.au/software/451162/Manager-SE | Mitchell 1 Manager SE (third-party listing) |
| S33 | https://autoflow.com/support/service-advisor-training/how-do-i-use-the-digital-vehicle-inspection/ | Tread depth per tire carried to next visit |
| S34 | https://blog.service.works/features/feature-good-better-best-multi-option-estimations/ | Good, better, best estimates in ServiceWorks |
| S35 | https://www.intercom.com/chatbot | Fin resolves, hands off with history, pauses for approval, outcome pricing |
| S36 | https://www.intercom.com/help/en/articles/12396892-how-to-automatically-escalate-conversations | Escalation triggers and rules; ask a teammate when unsure |
| S37 | https://www.intercom.com/help/en/articles/10560969-fin-guidance-best-practices-writing-effective-ai-prompts | Guidance for tone, handoff wording and limits |
| S38 | https://linear.app/enablement/guide/navigating-linear | Command menu, shortcuts, search |
| S39 | https://docs.stripe.com/dashboard/basics | Shortcuts list, pinned pages, filters, export, home widgets, branding, roles |
| S40 | https://docs.stripe.com/reports/select-a-report | Balance and payout reconciliation reports |
| S41 | https://www.goodcall.com | AI agent: books, transfers, tells callers it is AI, pricing from $79 |
| S42 | https://schedulingkit.com/reviews/goodcall-review | Third-party review of Goodcall (written by a competitor) |
| S43 | https://heyrosie.com/pricing | Rosie: warm transfer, spam filter, summaries, texting, plans |
| S44 | https://slang.ai/pricing | Slang.ai: handoff to a person, VIP routing (restaurant focus) |
| S45 | https://docs.bland.ai/tutorials/guard-rails.md | Guardrails: required AI disclosure, end or transfer on a breach |
| S46 | https://developers.telnyx.com/docs/messaging/toll-free-verification | Toll-free verification and filtering of unverified traffic |
| S47 | https://support.telnyx.com/en/articles/3679260-10dlc-general-faq-s-at-t-launch-faq-s | 10DLC registration and blocking of unregistered traffic |
| B1 | https://help.openai.com/en/articles/12628199-chatgpt-atlas-agent-mode | Atlas agent mode: logged-in and logged-out, pauses on sensitive sites, cannot run code, download files, install extensions or touch the computer's files; custom rules |
| B2 | https://openai.com/index/introducing-chatgpt-atlas/ | Atlas launch post: optional viewable memories, per-site page visibility toggle, warning that pages can hide malicious instructions. The fetch summary said the page now calls Atlas deprecated; not checked further |
| B3 | https://claude.com/resources/articles/claude-for-chrome | Claude for Chrome: site-level permissions, confirmation before high-risk actions, blocked categories, admin allow and block lists, prompt-injection test results |
| B4 | https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool | Computer use: screenshot and action loop, isolate, keep logins away, allowlist domains, human confirms real-world consequences, injection classifiers |
| B5 | https://docs.browserbase.com/features/session-live-view | Live view: watch or take control of a running page, read-only or interactive, embeddable |
| B6 | https://docs.browserbase.com/introduction/what-is-browserbase | Browserbase: isolated sessions, live view, session replays |
| B7 | https://docs.stagehand.dev/v3/first-steps/introduction | Stagehand: act, extract, observe, agent; save and replay actions |
| B8 | https://www.diabrowser.com/ | Dia: chat with tabs, profiles, privacy toggles; page did not describe agent actions |
| B9 | https://hub-prod.perplexity.ai/hub/blog/mitigating-prompt-injection-in-comet | Comet: classifiers on retrieved content, content marked untrusted, confirmation before sending or buying, notices when something is blocked |
| B10 | https://brave.com/blog/comet-prompt-injection/ | Brave's attack on Comet and its advice: separate instructions from page content, check actions against the request, confirm sensitive actions, isolate agent browsing |
| B11 | https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html | SSRF prevention: check every address, connect to the checked address, redirects, schemes, ports, parser disagreement |
| S48 | https://developers.google.cn/photos/support/updates?hl=en | Google Photos: read-everything scopes removed from 31 March 2025; apps read only what they created; the Picker API lets a person choose photos |
| S49 | https://getkanal.com/blog/apple-messages-for-business | Apple Messages for Business: customer starts the conversation, approved provider, live agent required, Apple devices only (third-party guide, not Apple's own page) |
| S50 | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing | Instagram publishing: professional account, app review for outside users, 50 API posts a day, JPEG images, public media address |
| S51 | https://developers.telnyx.com/docs/messaging/10dlc/sole-proprietor/index | Telnyx sole-proprietor 10DLC: $4.50 brand, $15 vetting, $2 a month, one campaign and one number; standard registration details not on that page |

---

# Built but not reachable

As of 2026-10-15, read again against the code after commits 6bc49f7, 0c2d827, 3ca8b74 and 0a62529. The items below are written, and mostly tested, but Aaron cannot use them today: no screen shows them, no schedule runs them, or a setting or a rule blocks them. Each line gives the one step that is missing. Ordered by value to a shop owner, most valuable first (my judgment). "Needs" names a database file; all of them are applied since 2026-10-16 (see "Blocked on the owner", item 1), so what is missing is the screen or route. Nothing here was tried on the live app.

## Now reachable since the audit

These were on the earlier list of twenty-five. Each is now reached from a screen, the daily job or a setting, in the code I opened. None was clicked through on the live app, and the test count quoted elsewhere in this document (1,864) was measured after these commits (2,026 passing, the type check clean and lint with 0 errors).

- **Unsubscribe link in marketing emails** (section 24), 6bc49f7. `/api/outreach/unsubscribe` is on the list of addresses that skip sign-in in `web/src/middleware.ts`. Not tried with a real email link.
- **Report by email on a schedule** (section 13), 6bc49f7. The daily job (`/api/cron`) calls `/api/reports/scheduled` for every shop. Needs `CRON_SECRET` on the host and the shop's email key; I did not check either.
- **Customer CSV export and import, tags and groups, a car's service history on the customer card, and a read-only possible-duplicates list** (section 7), 0c2d827. Customers, Customer tools (Export, Import, Possible duplicates); the Group choice on the list; the Tags and Vehicle history sections on the customer card. Migration 053 is applied. Merge is not part of this and stays unbuilt.
- **Void and restore, change history, percent off the whole document, add a fee, start from and save as a template, the declined-work list, canned-job versions in the Add a canned job sheet, and parts pricing rules** (section 1), 3ca8b74. Document screen and Settings, Parts pricing. Change history events use 046 (applied). The declined-work list has no way to be filled yet (item 1 below).
- **Everything about a customer in one feed** (section 7). Customers, open a customer, Everything with this customer. Not clicked through on the live app.
- **Carrier delivery receipts for texts** (section 12) and **the clock-in location check** (section 6). The text webhook records delivery notices (needs Telnyx event settings and `TELNYX_PUBLIC_KEY`); the security header now lets the app itself ask for location. Neither was tried on the live app.
- **Usual charges (fee presets) in Settings, and the canned-job editor for vehicle versions, keywords and extra fees** (section 1). Settings, Usual charges; Canned jobs, open a saved job, Edit versions, keywords and fees. Not clicked through on the live app.
- **The customer status page and the Status link section on the job sheet** (section 24). Jobs, open a job, Status link; the customer opens `/status/<link>`, which skips sign-in in `web/src/middleware.ts`. File 051 is applied (2026-10-16), so a link can be made; none has been made yet. Previewed with sample data, not with a real link.
- **Command menu, search shortcut and G-then-letter page shortcuts** (section 18). Top bar search box (shows Ctrl K or Cmd K), and the search button on a phone. Phones have no keyboard shortcuts but get the same menu from the search button. Tried on the live app with `/`, a typed search and Enter, and G then T; Ctrl+K not tried. A first live look found the search box did not take typing right after opening (the pop-up sheet grabbed focus); fixed in 2dbc139 and checked again live.
- **Shop wall (TV) and jump-to-technician chips** (section 5). Shop board, Shop wall and the settings button beside it (names on or off, how often it refreshes); the chips show above the columns on a phone. The wall only looks and cannot save anything. Checked on the live app with no cars open; the chips and the cars on the wall were not seen.
- **Ask Alpha runs repair posts** (section 23), 0a62529. The `posts` tool in `web/src/app/(app)/ai/page.tsx` and `web/src/lib/ai/posts-tools.ts`. 060 is applied (2026-10-16).
- **The estimate link: send with a preview, line-by-line answer, signed record, good, better, best, history, and the declined-work list** (section 1), 2026-10-16. Documents, open an estimate, Send estimate (email, text or copy the private link, with a preview first); the customer opens `/sign/<link>`; the approval card, Extend good-through date, Turn customer links off and Good, better, best choices are on the same screen or its menu; `/api/send-document`, `/api/sign` and `/api/signature` serve it. Tried only against a local stand-in database at 390px and desktop width: the preview, the copy-link path, a partial answer with a choice, the seal check, a second answer refused, a shop edit after the customer opened the link, a turned-off link and a customer question. No real email or text was sent, and nothing was tried on the live app with real customers or real documents. Tests: `tests/estimate-link-send.test.mjs` and `tests/documents-wiring.test.mjs`.
- **Parts status, labels, hours and promised time on the shop board** (sections 5 and 24), 2026-10-16. Shop board, tap a car, Parts and time (also on the job sheet in Jobs). Cards show the parts line, hours, labels and promised time; columns show hours assigned and left; there is a Waiting on parts filter and a label filter; Needs a look flags parts to order and parts past due; My cars shows the same line to the technician. The extras are kept in their own table (`job_flow`, file 051), so a repair order itself is never touched, and a save made from an out-of-date copy is refused and shows the newer copy. Tried at phone and desktop width, light and dark, against a local stand-in database, including a save that lost to somebody else's; not tried on the live app. A hours box of a tenth of an hour used to round to zero, which the database refuses; that is fixed and tested. Tests: `tests/board-details.test.mjs`, `tests/jobflow-logic.test.mjs`.

## Still not reachable

1. **Declined work kept for later** (section 1). Done in code 2026-10-16: a customer declining a job on the private link fills the list. Not tried with a real customer.
2. **Purchase orders, receiving, returns and cores** (section 15). Step: a screen that calls `/api/inventory`. 057 is applied.
3. **The customer's answer, good-through date and signed record** (section 1). Done in code 2026-10-16: the approval card is on the document screen. Not tried on the live app.
4. **Send a document with a preview and a customer link** (section 1). Done in code 2026-10-16: the send sheet is on the Documents screen and `/api/send-document` previews and makes the link. Not tried on the live app, and no real text or email has been sent.
5. **Parts status and labels on the shop board** (section 5). Done in code 2026-10-16: the board car sheet has a Parts and time tab, cards show the extras, and columns show hours. Not tried on the live app. (The customer status link has its own section on the job sheet, section 24.)
6. **Good, better, best options** (section 1). Done in code 2026-10-16: the sheet is in the document menu and the customer picks on the private link. Not tried on the live app.
7. **Duplicate merge for customers** (section 7; status is Blocked because about 20 records need Aaron's yes). Step: not built, on purpose. A screen that shows a pair and calls the merge in `lib/customers/merge.ts`, built only after Aaron says yes to that specific action. The read-only pair finder is already on the Customers screen.
8. **Who changed a quantity** (section 15). Step: make the Inventory screen save counts through the history code. 057 is applied.
9. **Capture a lead from the web or a call** (section 22). Step: a form or a call hook that calls `/api/growth/capture`, and make it write to the `leads` table the Leads tab reads.
10. **Delete a call record** (section 21). Step: a Delete button in the Inbox that calls `/api/delete-call`.
11. **Owner joins a live AI call** (section 21). Step: a trial on a live call to see whether moving the AI's call leg cuts it off, then a button that calls `/api/voice-join/[callId]`.

Also written but with no caller, and not worth a row of their own:

- `/api/growth/import-past-calls` (turn past Telnyx calls into leads), `/api/telnyx-recordings` (list recordings) and `/api/recording-summary` (summarize one recording): no button.
- `/api/receptionist/attention` (counts of things waiting for a person, for a badge): Today does its own counts.
- `/api/reports/ar` (customers with an old balance): no screen or automation reads it.
- `/api/browser/host` and its claim, poll and result routes: wait for the desktop app (section 27).
- `/api/cron/tick` (the every-5-minutes check): nothing calls it (see "Blocked on the owner", items 15 and 18).
- Old growth routes replaced by Automations: `/api/growth/follow-ups`, `/estimate-followups`, `/service-reminders`, `/scan-competitors`, `/scan-social`, `/create-ad`.
- Old or retired: `/api/ai-voice-call` (alias of make-call), `/api/ai-process-inbound`, `/api/ai-process-turn`, `/api/create-estimate`, `/api/save-document`, `/api/migrate`, `/api/shop/bootstrap`; `/api/seed-settings` and `/api/seed-connectors` are admin-only set-up helpers.
- Leftover files nothing imports: `lib/call-state.ts`, `app/sign/[token]/SignPad.tsx` and `parts.tsx` (the signing page has its own copy).
