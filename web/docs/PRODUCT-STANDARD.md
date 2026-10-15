# Alpha AI Desk product standard

Written 2026-10-14 and rewritten 2026-10-15: sections 21 to 30 were added after the owner pointed out that AI calling, the phone and much more were missing, and every row that depended on the database files now reflects what was applied that day. Vendor pages were read on 2026-10-14; the texting, Google Photos, Apple Messages and Instagram facts were read on 2026-10-15. Features and prices change, so treat every competitor point as possibly out of date and re-check before you quote it. The "Alpha today" column was checked by reading the code in `web/src` and `SESSION_LOG.md`, not by clicking through the live app.

## Why this document exists

Aaron's rule: "every feature has to have the fullest. i mean the fullest. professional leads, how other professional ai companies too... i want every feature to be professional and down right great."

So each feature is held to what the best shop software does (Tekmetric, Shopmonkey, Shop-Ware, with Mitchell 1 Manager SE and AutoLeap as side checks) and to what the best AI and product companies do (Intercom Fin for AI that resolves and hands off, Linear for speed and keyboard, Stripe Dashboard for tables, reports and money language, and AI phone agents for call answering).

Alpha AI Desk is an AI office manager and shop-management web app for independent auto repair shops. Houston first, many shops later. That "many shops" part is why Alpha must never show one shop's name, address, phone or wording to another shop.

## How to use this document

1. Before you build or change a feature, open its section and read the rows. Each row is one capability.
2. A feature is done when every row is Exists, or the row says who or what blocks it and that is written down in "Blocked on the owner".
3. Put the section's rows in the pull request description and say which ones you moved to Exists.
4. Update the row in the same change. If a row is wrong, fix the row.
5. Every screen must also pass "Quality bar for every screen". A feature with all rows Exists but a screen that fails the bar is not done.
6. New feature? Add a section with the same four columns before you start.

## How to read the tables

- **Capability**: one thing a shop or customer can do.
- **What the best do**: a short fact in my own words with a source tag such as [S4]. The full list is under "Sources". "Not researched" and "unverified" mean exactly that. I did not guess.
- **Alpha today**: Exists (works in code now), Partial (some of it), or Missing (not found in code), plus one phrase.
- **Status**: Exists, To build, or Blocked. Blocked means it cannot be finished or switched on until the owner or an outside party acts. The action is listed in "Blocked on the owner".
- Migrations: on 2026-10-15, 20 of the 25 files in `supabase/migrations/` (034 to 059, there is no 042) were applied to production (034 to 041, 043 to 045, 047 to 050, 052 to 056). Not applied, because the apply was cancelled each time: 046 (customer links, signed approvals, document history), 051 (job flow), 057 (parts and purchase-order functions), 058 and 059 (browser tables). A row that depends on one of those says so. Customer, invoice, estimate, payment, message and signature data were checked before and after and did not change.

## Biggest gaps against the leaders

1. **Taking money.** Tekmetric sends a pay link by text and keeps cards on file; both Tekmetric and Shopmonkey run card terminals and track payouts and fees; Shopmonkey sends payable invoices by text or email [S3][S4][S22]. Alpha only records a payment someone received. There is no processor, no link, no card on file, and no QuickBooks sync.
2. **Shop data and time.** The leaders put labor guides, parts catalogs and per-job time inside the estimate and the tech board [S1][S2][S25][S9]. Alpha has none of these, so it cannot show effective labor rate, gross profit or hours left per technician.
3. **Customer-facing AI that is safe and hands off.** The best call agents tell callers they are AI, transfer to a person and book the appointment [S41][S43][S45]. Alpha's inbound agent never says it is AI unless asked, cannot transfer, cannot book, and its text auto-reply uses fixed shop hours. This is the first thing to fix because it talks to customers unsupervised.

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
| Canned jobs | Linked to inspection findings and tailored per vehicle [S1][S6] | Partial. Name, hours, rate, parts; no per-vehicle price, no inspection link | To build |
| Pricing matrices | Parts and labor matrices price lines automatically [S1][S2] | Missing. Every price is typed | To build |
| One-click job from the vehicle | Smart Jobs adds labor, parts, fluids and a locked price [S2] | Missing | To build |
| Labor times from a guide | Up to three labor guides inside the estimate [S1] | Missing. Repair info has no labor times | To build |
| Parts search and ordering in the estimate | Search suppliers without leaving the job [S2][S24] | Partial. Parts lookup reads store pages and builds an estimate; no order | To build |
| Good, better, best options | Found in other field-service tools [S34]; not on the shop tools I read (unverified) | Missing. One price per line | To build |
| Email a document | Email with lines and total [S1] | Exists. Every line and total; a preview says what will be sent | Exists |
| Text a document | Text a link; customer approves or pays on the phone [S1][S3] | Partial. Text has total and shop phone only, no link | To build |
| Signature and approval | Click or signature with a saved record [S1] | Exists. Link works 30 days, approve button in email, signer and time kept | Exists |
| Approve or decline line by line | Customer picks which work to do [S5][S27] | Missing on estimates; exists on inspections | To build |
| Know when the customer looked | Sent and viewed icons on the card [S8] | Missing for estimates; inspections show "Customer looked" | To build |
| Convert, duplicate, delete, print | Estimate becomes repair order and invoice [S1] | Exists. Convert in place, duplicate, confirm delete, print or save as PDF | Exists |
| Totals locked once money is taken | Audit trail of changes [S1] | Exists. Lines, tax, totals lock on Paid and Partial, also in the database | Exists |
| Change history on a document | Audit trail [S1]; activity log [S28] | Partial. AI actions are logged; no history screen on a document | To build |
| Discounts | Effective labor rate counts discounts [S16] | Missing. No discount line found | To build |
| Warranty on parts and document | Not researched | Exists. Per-part box and document presets (see Settings for wording risk) | Exists |
| Declined work kept for later | Declined work flagged marketable and reminded [S5][S11] | Partial. 48-hour estimate follow-up; declined items not kept for reminders | To build |
| Shop logo on paperwork | Logo on every customer page [S39] | Exists. Print header only, not email or signing page; the logo table is live since 2026-10-15 | To build |

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
| Payout and fee reconciliation | Payouts and fees tracked; payout report [S4][S40] | Missing. A payments file exists in Reports | To build |
| Who owes you, and chasing it | A/R view on the job board [S8] | Partial. Owed by age in Reports; no overdue reminders | To build |
| Receipts | Receipt on payment | Exists. Receipt document type | Exists |
| Refunds | Not researched | Missing. No refund screen found | To build |

## 3. Digital vehicle inspections

Screens: Inspections, Jobs detail, public inspection link.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Phone-first checklist | Swipe green; yellow and red open findings [S27] | Exists. Three checklists (31-point, brakes and tires, oil-change check) | Exists |
| Per-shop checklist templates | Custom multi-point templates [S5] | Missing. Fixed three plus one custom line per inspection | To build |
| Rating with words | Four ratings incl. not applicable [S6] | Exists. Good, Watch, Needs work with a word beside each lamp; mark the rest good | Exists |
| Photos | Photos with markup [S5][S6] | Partial. Up to 4 per item and 24 per inspection, stored inside the row, no markup | To build |
| Video and voice notes | Video and voice notes [S5][S21] | Missing | To build |
| Tire and brake measurements | Tread depth per tire carried to next visit [S33]; Tekmetric not described [S6] | Missing. Typed into the note | To build |
| Suggested price per finding | Canned jobs add priced work from findings [S5] | Partial. Price typed by hand; no canned-job lookup | To build |
| Send to the customer | Text or email, customer reviews on phone [S5][S21] | Exists. Text link, no sign-in. Migration 036 is applied (2026-10-15); the link can only be texted once carrier registration is done | Blocked |
| Customer approves each repair | Approve or decline per item [S27] | Exists. Approve or Skip per finding, can change answers | Blocked |
| Findings become an estimate | Add recommended work to the estimate [S21] | Exists. "Write estimate from approved" | Exists |
| Inspection history per vehicle | History tab with ratings and technician [S7] | Partial. Shown on the job; no vehicle history screen | To build |
| Report sent with the estimate | Health report goes out with estimates [S6] | Missing | To build |
| Declined findings followed up | Declined saved for follow-up [S5] | Partial. Answers stored; no reminder | To build |
| Safe public link | Not researched | Exists. Random token, only needed fields, rate limited, can be turned off | Exists |
| Print the report | Print with or without photos [S6] | Exists | Exists |
| Database ready | Not applicable | Partial. The `dvi` table has no migration in the repo (made by hand in production) | Blocked |

## 4. Scheduling and capacity

Screens: Schedule.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Week grid, day board per tech, list | One calendar for online, check-ins, walk-ins [S10] | Exists. Tap an empty slot to book | Exists |
| Double booking | Booked time blocks the slot [S10] | Exists. Warns, never blocks (on purpose) | Exists |
| Status flow | Confirmed, arrived, done | Exists. Confirm, arrived, done, no show, cancel | Exists |
| Appointment becomes an estimate | Appointments flow into daily work [S10] | Exists. Opens a new estimate with customer and vehicle filled in | Exists |
| Confirmation and reminder texts | Sent automatically on booking and before [S19] | Partial. Manual text templates; a day-before automation exists | Blocked |
| Online booking | Booking widget, link and Google Business Profile booking [S10] | Missing | To build |
| Capacity by tech and service | Availability per service type [S10]; capacity management [S26] | Missing. Only a duration and a tech on each booking | To build |
| Calendar sync | Not researched | Partial. Ask Alpha can use Google Calendar; Schedule screen does not sync | To build |
| Suggest declined work when booking | Widget suggests declined services [S10] | Missing | To build |
| Walk-ins | Walk-in check-in [S10] | Exists. "Walk-in: name" without breaking texts | Exists |

## 5. Job board and shop board

Screens: Jobs, Shop board, Work.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Job board by stage | Estimates, work in progress, completed [S8] | Exists. Board and list with promise date, priority, late flag | Exists |
| Waiting statuses | Waiting on parts or sublet [S8] | Exists. Waiting on parts, Waiting on customer | Exists |
| Column per technician | Own column plus no-tech column [S9] | Exists. Drag (desktop) or tap and pick (phone), undo, saves at once | Exists |
| "Needs a look" summary | Not researched | Exists. No tech, late, clocked out with cars in progress | Exists |
| Hours per technician column | Assigned, completed, remaining hours [S9] | Missing. Needs job-level time | To build |
| TV or full-screen mode | Not described on the tech board page I read (unverified) | Missing | To build |
| Jump to a technician on a phone | Not researched | Missing. Long scroll on phones | To build |
| Sent and viewed markers | Paper plane and eye icons [S8] | Missing | To build |
| Labels on repair orders | Filter by RO label in the app [S18] | Missing. Status and priority only | To build |
| Parts status on the card | Parts need ordering or awaiting delivery [S27] | Partial. Status per part in the editor, not on the board | To build |
| Technician-only view | "My Work" with due times and parts status [S27] | Missing. No technician-only screen found | To build |
| Car-ready text to the customer | Automatic status messages [S19] | Partial. Can be built as a custom automation; not built in | To build |

## 6. Time clock and technician productivity

Screens: Team (route `/staff`), Reports > Technicians.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Clock in and out | Time clock with overtime [S28] | Exists. Today, Timesheets, People tabs | Exists |
| Breaks | Not researched | Exists. Migration 035 is applied (2026-10-15), so the Break buttons show; not yet clicked through on the live app | Exists |
| Weekly hours and overtime | Overtime recorded for payroll [S28] | Exists. Over 40 hours; week is fixed Monday to Sunday | Exists |
| Configurable week start | Not researched | Missing | To build |
| Fix a missed punch | Not researched | Exists. Owner or manager, reason required and kept | Exists |
| Forgotten clock-out guard | Not researched | Exists. Over 16 hours flagged, over 24 hours cannot be clocked out | Exists |
| Undo a clock-out | Not researched | Missing | To build |
| Time on a job | Clock into a specific service; compare estimated and clocked [S25] | Missing. Day-level only | To build |
| Technician efficiency | Billed hours versus worked [S28] | Partial. Billed over clocked per day; not per job | To build |
| Payroll file | Clock records feed pay [S28] | Exists. CSV, safe against spreadsheet formula tricks | Exists |
| Payroll integration | Not researched | Missing | To build |
| Location check at clock-in | Shops can require location sharing [S25] | Missing (optional) | To build |
| Activity log by employee | Actions on orders and parts per employee [S28] | Missing | To build |
| Flat-rate or commission pay | Not described on the Shop-Ware page [S28] (unverified) | Missing | To build |

## 7. Customers and vehicles

Screens: Customers, Vehicles.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| One customer record | Texts stay with the order history [S12] | Exists. Contact, vehicles, documents, texts and calls, jobs, notes | Exists |
| Search | Stripe filters and finds fast [S39] | Exists. Name, phone, vehicle; search box also finds paperwork | Exists |
| Customer mood | Not researched | Exists. Happy, neutral, unhappy mark and filter | Exists |
| VIN decode | Plate-to-VIN scan on mobile [S31][S32] | Partial. VIN decode on the form; no plate or VIN scan | To build |
| Vehicles list | Vehicle history on the profile [S21] | Exists. Owner, plate, mileage | Exists |
| Full service history per vehicle | Past inspections and orders per vehicle [S7] | Partial. Documents on the customer; no vehicle timeline | To build |
| Duplicate finder and merge | Not researched | Missing. About 20 duplicate or test customers sit in Alpha's data | Blocked |
| Import and export | Not researched | Missing. No CSV import or export | To build |
| Tags and segments | Targeted campaigns by history [S13] | Missing | To build |
| Text opt-out | Not researched | Exists. STOP handled and remembered | Exists |
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
| One thread with approvals and estimates | Messages, estimates, timelines and approvals in one thread [S29] | Exists. Sent, opened, approved, declined and paid events for the customer's estimates and invoices show inside the thread (checked in the browser). Needs the document history table from migration 046, which is not applied (cancelled 2026-10-15); until then the thread shows texts only | Exists |
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
| One approval path | Not researched | Partial. Review cards and older confirm cards both exist | To build |
| Audit trail the owner can read | Activity log [S28] | Partial. Written to the database; no screen for it | To build |
| Undo | Not researched | Missing. Deletes are flagged, not reversible | To build |
| Stop button while it works | Not researched | Partial. A Stop control was being added in the working tree on 2026-10-14; verify when it lands | To build |
| Honest about uncertainty | Asks a teammate when unsure [S36] | Partial. Sources on researched parts; one prompt line says answer from own expertise when a manual is thin | To build |
| Repair answers from manuals first | Not researched | Exists. Router sends repair questions to manuals, web only if asked | Exists |
| Shop-set rules for the AI | Guidance sets tone, handoff, limits [S37][S36] | Missing. No screen for rules | To build |
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
| Campaign dashboard | Sent and next-30-days view [S13] | Exists. Sent, delivered, replied, booked and paid afterwards, per promotion and per automation, over 7, 30 or 90 days (Get more customers, Results); next 30 days under Automations, Coming up. Delivered shows once the carrier reports it | Exists |
| Promotions to a list | Text and email promotions [S13] | Exists in code. Promotions tab: write, choose who, read every message, test text to yourself, send now or at a set time in the shop clock, stop while it goes out. STOP, quiet hours and limits are checked on the server right before each message. Real texts wait on carrier registration. Migrations 040 and 041 are applied (2026-10-15) | Blocked |
| Audience filters | Based on service history [S13] | Exists. Last visit (not in for, in within), vehicle make and model year, lifetime spend, tags (any or all), has email. Counted live before sending; STOP and no-number are always left out | Exists |
| Referral codes | Not researched | Exists. Codes with a discount you choose; credit a new customer's invoice to a code (checks they are new and the invoice counts once); what each referral paid; thank-you given or still owed. Migration 041 is applied (2026-10-15), so credits are saved | Exists |
| Find new customers | Not researched | Exists. AI lead search; check email-marketing law before auto outreach (unverified) | Exists |
| Social post drafts | Not researched | Exists. Write a post or have Alpha draft it from what you type (flags invented prices, offers and credentials), character limit per place, preview, save as a draft, copy to post yourself. Publishing is a separate row below | Exists |
| Google Business Profile | Booking via profile [S10] | Partial. Connector listed; Alpha's prompt says Google access is pending approval (unverified now) | Blocked |
| Paid ads | Not researched | Partial. Plan an ad with headline and text (optional AI draft, same checks), see a preview, save as a draft. Starting the ad needs the owner's Google Ads or Facebook account and a payment method | Blocked |
| Publishing posts to Google, Facebook, Instagram | Post from one place | Blocked on the owner. Drafts, preview and copy are built; posting itself needs each account connected and approved | Blocked |
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
| Runs at the stated time | Not researched | Partial. Times are worked out in the shop's time zone and the logic is tested, and the screen says how often it really checks. It needs a check every 5 minutes: vercel.json has one daily job, so hourly and 15-minute automations run late until a frequent scheduler is set up | Blocked |
| Safe against double runs | Not researched | Exists. Leases and fencing in migrations 040, 048, 054, 060 | Exists |
| Quiet hours | Not researched | Exists. No texts 9 PM to 8 AM by each customer's own clock (from their area code), longer if you choose, Sundays optional. Messages wait for morning instead of being dropped | Exists |
| Run history | Not researched | Exists. History tab lists every message with who, what was said, when and what happened (sent, delivered, waiting, left out and why, did not send), plus every run; failures also email the owner | Exists |
| Master off switch | Not researched | Exists. One switch pauses every automation and promotion and cancels what is waiting; each automation also has its own switch | Exists |
| Rules for all automations | Not researched | Exists. Quiet hours, Sundays, marketing and service limits, failure-alert email, in one Rules sheet | Exists |
| Results per automation | Sent, replied, booked [S13] | Exists. Sent, delivered, replied, booked and paid afterwards over 7, 30 or 90 days; each reply, booking or payment is credited once to the last message that customer got | Exists |
| Coming up | Next 30 days view [S13] | Exists. Messages waiting by day, next scheduled runs, appointments to remind, vehicles coming due | Exists |
| Failure alerts and retries | Not researched | Exists. A temporary failure retries up to three times; a message the carrier is unsure about is never sent twice; the owner is emailed when messages fail | Exists |
| Reminder dropped when the customer came back | Cancels on early return [S11] | Exists. Service, declined-work and win-back messages still waiting are cancelled if the customer paid an invoice after they were lined up | Exists |

## 13. Reports

Screens: Reports (Overview, Money, Jobs, Technicians, Calls).

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Money at a glance | ARO, car count, parts margin, labor rate [S15][S16] | Exists. Collected, Invoiced, Average invoice, Still owed, Parts profit | Exists |
| Period with comparison in words | Benchmark against other shops [S15] | Exists. Six periods, said in words ("Up 12% from the 7 days before") | Exists |
| Compare any two dates | Not researched | Missing | To build |
| Car count, new versus returning | Core Shop Index metric [S15][S16] | Missing | To build |
| Effective labor rate | What you collect per hour after discounts [S16] | Missing. Needs discounts and job-level time | To build |
| Parts margin | (retail minus cost) over retail [S16] | Partial. Counts only lines with a cost written down | To build |
| Gross profit per job and shop | Per-job gross profit [S1] | Missing. Labor cost is not recorded | To build |
| Technician efficiency | Billed hours and efficiency [S28] | Partial. Day-level; labor with no tech is called out | To build |
| Owed by age | A/R view [S8] | Exists. 0-30, 31-60, 61-90, over 90, each open invoice listed | Exists |
| Payments file and sales tax | Financial reports to download [S39][S40] | Exists. Formula-safe CSV; sales tax by quarter | Exists |
| Approval rate of recommended work | Approval rate and sell-through [S28] | Missing. Inspection answers could feed it | To build |
| Tax-ready profit and loss | Not researched | Missing. Needs expenses | To build |
| Report by email on a schedule | Stripe reports can be downloaded and filtered [S39] | Missing | To build |
| Benchmarks against other shops | Quarterly index of 10,000-plus shops [S15] | Missing. Needs many shops | To build |
| Honest about gaps | Not researched | Exists. Paid-with-no-payment invoices pointed out | Exists |
| Chart you can read without sight | Not researched | Exists. Hover, drag, arrow keys, hidden table | Exists |
| Alpha's AI calls beside human calls | Not researched | Missing | To build |

## 14. Accounting and payroll

Screens: Reports > Money, Team > Timesheets.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| QuickBooks sync | Posted orders, payments, fees, A/R, POs sync one way with review [S14]; invoices and customers [S24] | Missing | To build |
| Choose individual or summary entries | Pick before posting [S14] | Missing | To build |
| Reconciliation checks | Compare totals to end-of-day report [S14] | Missing | To build |
| Expenses and vendor bills | Purchase orders and sublets sync [S14] | Missing. Needed for profit and loss | To build |
| Export for the accountant | Not researched | Partial. Payments file and quarterly sales tax | To build |
| Payroll export | Clock records feed pay [S28] | Exists. CSV | Exists |
| Payroll integration | Not researched | Missing | To build |

## 15. Parts and inventory

Screens: Parts lookup, Inventory.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Price and availability from suppliers | Compare prices in the catalog [S24] | Partial. Store pages, source link when price cannot be verified | To build |
| Order from a catalog | PartsTech, Nexpart, RepairLink; WORLDPAC in Shop-Ware [S24][S26] | Missing | To build |
| Budget, mid, premium options | Not researched | Exists. Up to three options per part with kits | Exists |
| On hand and reorder level | Inventory with change log [S28] | Exists. Low and out of stock lamps, on-order tab | Exists |
| Who changed a quantity | Inventory change log [S28] | Missing | To build |
| Purchase orders and receiving | POs sync when received [S14] | Partial. On-order count only; no PO flow | To build |
| Part status on a line | Awaiting delivery label [S27] | Exists. Ordered, Backordered, Received, Installed, Returned | Exists |
| Returns and cores | Parts return orders [S14] | Partial. Core charge on documents; no return flow | To build |
| Who may order parts | Ordering permissions [S28] | Missing | To build |

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
| House design | Not applicable | Partial. Being rebuilt in the working tree on 2026-10-14; re-check against the quality bar when it lands | To build |

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
| Search | `/` to search by name or id [S38] | Partial. Customers and paperwork only | To build |
| Command menu | Ctrl or Cmd+K opens any page or action [S38] | Missing | To build |
| Keyboard shortcuts | Short key sequences, `?` lists them [S38][S39] | Missing | To build |
| Pinned and recent pages | Shortcuts section [S39] | Missing | To build |
| Empty states that name the action | Linear (not verified from an official page) | Exists on rebuilt lists | Exists |

## 19. Settings, team access, connected apps

Screens: Settings, Connected apps, Agents and tools, Setup guide, login.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Shop details, rates, tax, payment methods | Not researched | Exists. Defaults: $120 labor, 8.25 tax if blank | Exists |
| Per-shop logo | Logo and colours in settings [S39] | Exists. Migration 034 is applied (2026-10-15) | Exists |
| Business hours | Not researched | Missing. AI uses hard-coded or vague hours | To build |
| Warranty wording per shop | Not researched | Partial. Presets are Alpha's legal text with the name swapped in | To build |
| Permission roles | Roles per person [S39] | Partial. Roles (owner to viewer) enforced in the API; no screen to invite or change | To build |
| Never show another shop's identity | Not applicable | Partial. Settings-driven; Alpha-specific warranty text and call-type names remain in code | To build |
| Connected apps | Direct links to QuickBooks and parts [S24] | Partial. Facebook, Instagram, Google Business, Google Calendar only | To build |
| Multi-location | View jobs and techs across shops [S20][S28] | Missing | To build |
| Setup guide | Not researched | Exists. Three steps | Exists |
| Help, privacy, terms | Not researched | Exists | Exists |
| Test and build safety | Not applicable | Exists. 226 tests pass per the log; type check and lint clean | Exists |

## 20. Built-in browser

Screens: Browser (`/browser`) and the browse tool inside Ask Alpha. Added 2026-10-15 from the owner's request: "i want a built in web browser, a professional one better then chrome."

Honest framing: nobody beats Chrome as a general-purpose browser, and this section does not try to. The professional version the AI companies ship is a browser inside the product that the AI can drive while the person watches and can take over [B1][B3][B5]. This section is that, built for shops (parts sites, insurance portals, recall and VIN sites, manufacturer repair sites).

What runs where, because Alpha runs on Vercel serverless (no long-lived connection, no browser that stays open, and most sites refuse to load inside an iframe):

| Piece | Runs | Why |
| --- | --- | --- |
| Reader view | Server fetch in one request, no browser engine | Fast, cheap, works for most parts, recall and manual pages; page is turned into plain blocks and drawn by Alpha, never as the site's own HTML |
| Live view (snapshot and act) | One short headless browser per tap: open the page, redo the fields already filled, do the one action, take a picture and a list of controls, close | The picture-and-action loop the computer-use tools use [B4]; works on serverless because nothing stays open between taps |
| Ask Alpha doing a lookup | The Browser page runs the loop on the screen (up to 12 steps, Stop button), calling the two views above | The person watches every step and can take over at any time |
| Sites that need a sign-in, cookies or scripts that post data | The shop's own computer ("connect your computer" mode) | Alpha's servers must never hold a shop's passwords, and nothing can stay signed in on serverless |

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| A browser screen inside the product with tabs and an address and search bar | Dia and Atlas put tabs, an address bar and the assistant in one window [B7][B1] | Missing. Only a small panel of step pictures inside Ask Alpha | To build |
| Reader view | Not named by the AI browsers I read (unverified); Stagehand's extract pulls clean data from a page [B7] | Partial. Scrape returns plain text to the AI; no screen | To build |
| Live view you can tap | Browserbase live view: watch, or take control, of the running page [B5] | Missing | To build |
| Screenshots and page snapshots | Screenshot after every action [B4] | Partial. Screenshot route sends the page address to two outside screenshot services | To build |
| Ask Alpha does the lookup while you watch | Agent mode opens tabs, clicks and finishes multi-step tasks, and pauses on sensitive sites so you can watch [B1] | Partial. Ask Alpha can read a page and propose a click; no watch screen, no stop button on a browser task | To build |
| Take over at any time | Live view lets a person click and type in the same session [B5] | Missing | To build |
| Approval before a submit, purchase, message or download, showing the exact action | Pause before high-risk actions such as publishing or purchasing [B3]; confirm before sending, buying or filling details [B9]; human confirms real-world consequences [B4] | Partial. One approval for a whole batch; the action itself is not shown; a script cannot tell a search form from an order form | To build |
| Never types passwords, card numbers or one-time codes | Keep logins and sensitive data away from the agent [B4]; logged-out mode [B1] | Partial. A word check on the clicked item only; the typed value is not checked | To build |
| Sign-in steps hand control to the person | Pauses on sensitive sites [B1] | Partial. Some clicks stop; nothing tells the person what to do next | To build |
| Page text is data, never instructions | Mark retrieved content untrusted, separate it from the person's request, scan for hidden text [B9][B10]; pages can hide instructions [B2] | Partial. One sentence in the prompt; hidden text and invisible characters are kept | To build |
| Check each action against what was asked | Check proposed actions against the request [B10] | Missing | To build |
| Activity log of every page and action | Session replays of each step [B6] | Partial. A database row per task, no screen, no page-by-page record | To build |
| Saved quick sites for the shop | Pinned apps and profiles [B8] | Missing | To build |
| Per-shop allow and block lists | Site-level permissions and admin allow and block lists [B3]; allowlist domains [B4] | Missing | To build |
| Sensible default blocklist | Blocked categories such as financial services, adult and pirated content [B3] | Missing | To build |
| Master off switch for the AI browser | Settings to turn the extension off [B3]; per-site page visibility toggle [B2] | Missing | To build |
| Safe fetching on the server | Resolve, check every address, connect to the checked address, check every redirect, fix the scheme and port, limit the response [B11] | Partial. Public-address check and pinned connection exist; gaps listed under Bugs found; no port limit; no shop rules | To build |
| Login required, rate limits and size limits on every fetch route | Not researched | Partial. Login on all three; rate limit on one; 8 MB and 20 s limits on one | To build |
| Downloads never run | Cannot download files [B1] | Missing. Every non-image file is refused | To build |
| Approved downloads of plain files (PDF, pictures, text) | Not described by the products I read (unverified) | Missing | To build |
| Practice mode on pretend sites | Not researched | Missing | To build |
| Sources shown for what the AI found | Not researched | Missing | To build |
| Search from the address bar | AI browsers search from the address bar [B8] | Partial. Needs an optional search key; nothing without it | To build |
| Connect your computer (desktop host) | Not described by the products I read for a web app (unverified) | Missing. Contract and server side only; no desktop app yet | Blocked |
| Use what was found (copy into an estimate or Ask Alpha) | Not researched | Missing | To build |

## 21. AI calling and the phone (extends section 9)

Screens: Inbox (Calls tab and Dial sheet), the browser phone, Get more customers (Start the call), Settings (Texts and calls). Added 2026-10-15 after the owner said section 9 did not cover AI calling and the phone in full. Read from `api/make-call`, `api/voice-join`, `api/telnyx-voice-webhook`, `api/calls/webhook`, `components/PhoneWidget.tsx`, `api/growth/outreach`.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Call from the browser with your own voice | Not researched | Exists. Browser phone (WebRTC): US numbers fixed to the right format, mute and hang up, status lamps with words, call token tied to the shop | Exists |
| Three kinds of call the shop starts: service call, custom AI task, personal call | Not researched | Exists in the call route. A personal call connects silently: no AI greeting, no script, no recording | Exists |
| A button or Ask Alpha starts an AI call to a customer | AI agents place calls with a goal [S41][S43] | Partial. The call route works, but I found no button or Ask Alpha action in the current screens that starts a service or task call for a customer. AI calls to leads start from Get more customers | To build |
| Review card before an AI call (who, number, goal, hours, what it will say) | Pause for approval on risky steps [S35] | Partial. The lead call sheet shows warnings; no card for customer calls | To build |
| Says it is an AI and that the call may be recorded, first | Disclosure is a required guardrail [S45] | Exists on task and service calls; recording starts only after the notice | Exists |
| Never invents prices; ends politely on "no" | Answers only from shop context | Exists in the call prompt | Exists |
| Calling hours | Not researched | Partial. AI task calls refuse before 8 am and after 9 pm in the shop's time zone. The window is fixed in code, not set by the shop | To build |
| Do-not-call and STOP check before an AI call | Required in practice (consent and opt-out rules) | Partial. Calls to leads check opt-outs, hours and the shop's rules. The customer call route does not read the customer do-not-call flag (migration 053 is applied) | To build |
| Owner joins a live AI call | Live or warm transfer [S43][S41] | Exists. "Join" dials the owner's phone and bridges it into the call | Exists |
| Listen in without speaking, or whisper to the assistant | Not researched | Missing. Joining means the owner can be heard | To build |
| Natural voice, barge-in, echo filter, two-track transcript | Not researched | Exists. Telnyx natural voices with a fallback voice | Exists |
| Uses the shop's own AI provider and key | Not applicable | Exists. Reads the shop's AI settings, nothing deployment-wide. This stays untouched | Exists |
| Recording playback | Recordings and transcripts [S43] | Exists. Recordings stream through a shop-checked proxy | Exists |
| Transcript and AI summary of every call | Summaries, transcripts [S43] | Exists. Transcribe and summary routes | Exists |
| Call log kept in step with Telnyx | Not researched | Exists. Sync of calls and recordings, and import of past calls | Exists |
| Delete a call record | Not researched | Exists | Exists |
| Forwarding, ring groups, after-hours routing, phone menus | Business phone systems [S43] | Missing. One number; hand-off numbers exist for transfers | To build |
| Voicemail box and recorded greeting | Not researched | Partial. The assistant takes messages; the old voicemail page now opens the Inbox calls tab; no greeting or box | To build |
| Call a parts supplier for a price and save the answer to the part (the Erin idea) | Not researched | Partial. A custom task call can ask; there is no supplier list and the answer is not saved to the part | To build |
| Minutes used and cost of calls | Not researched | Missing | To build |
| Tracking numbers per campaign | Not researched | Missing | To build |
| Which numbers and caller names show on the other phone | Not researched | Unverified | To build |

## 22. Finding customers and outreach

Screens: Get more customers (Leads, Follow-ups, Results, Activity).

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| AI search near the shop: unhappy reviewers of competitors, fleets, people posting about car trouble | Not researched | Exists. Three searches. A phone or email counts only if it is written in what Alpha actually read; sources shown | Exists |
| Contact details from Google Maps, Hunter and web search | Not researched | Exists in code. Needs the shop's or Alpha's own Google Maps, Hunter and Serper accounts | Blocked |
| Outreach by text, email or AI call, written by Alpha and approved by the owner | Draft then approve [S35] | Exists. Nothing is sent unseen; opt-out, hours and shop rules are checked; email carries the shop's address and an unsubscribe link | Exists |
| Capture a lead from the web or a call | Not researched | Exists. Lead capture route, scoped to one shop | Exists |
| Lead history and status | Not researched | Exists. Outreach history, status, last contact, activity log | Exists |
| Estimate follow-up and customer follow-ups | Follow-up automations [S11] | Exists. See sections 11 and 12 | Exists |
| Legal check for contacting people who posted publicly | Not researched | Partial. The AI-call sheet warns; whether a given outreach is allowed is the owner's call with counsel | Blocked |
| Leads to customers to dollars | Campaign results [S13] | Missing. No link from a lead to the invoice it later produced | To build |

## 23. Posts, ads and social publishing

Screens: Get more customers (Posts and Ads), Automations (Social posts), Connected apps. This is the owner's example of "every feature the fullest": automatic, uses the shop's real pictures, knows the engine and the repair, groups the right photos, posts for the shop, has an on and off switch, and can be run by asking Ask Alpha.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Draft a post and check it (no invented prices, offers or credentials), preview, copy | Not researched | Exists. Character limit per place; save as draft | Exists |
| Plan an ad as a draft with headline and text | Not researched | Exists as a draft; does not start an ad | Exists |
| Real photos come in without retyping | Not researched | Missing. Sources that work: job and inspection photos, pictures texted to the shop, a pick-from-Google-Photos button (Google no longer lets apps read a whole library; the app can only read what the person picks), a shared upload link or iPhone Shortcut. Apple iCloud has no public photo API for a web app | To build |
| AI groups the photos by job and picks the best | Not researched | Missing | To build |
| Caption comes from the job record (vehicle, engine, repair), not from guessing the picture | Not researched | Missing | To build |
| Privacy first: blur plates and VINs, strip location data, customer permission box on the job (default off) | Not researched | Missing | To build |
| Publish to a Facebook Page, an Instagram professional account, Google Business Profile | Post from one place | Blocked on the owner. Drafts exist; posting needs each account connected and approved (Instagram: professional account, public image address, JPEG, 50 API posts a day) | Blocked |
| Off, Suggest or Auto, with a weekly cap | Not researched | Partial. An automation switch exists; no Suggest queue or weekly cap | To build |
| Ask Alpha runs it ("turn posts off", "show what you'd post this week", "post this one tomorrow") | Not researched | Missing | To build |
| Approve by text ("reply Y to post") | Not researched | Missing | To build |
| Log of every post with undo where the platform allows | Not researched | Partial. Social posts have durable operations; no screen | To build |
| Ads: always approval-first, with a budget cap in the owner's own ad account | Not researched | Missing. Starting an ad needs the owner's ad account and payment method; Alpha never stores a card | Blocked |
| Results the platforms really report, plus "how did you hear about us?" at intake | Not researched | Missing | To build |

## 24. Pages customers open

Screens: status link, signing page, inspection page, booking page, unsubscribe page, privacy, terms, help.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| "Where is my car" status link | Automatic status messages [S19] | Exists in code. Reads the job's public note and status; the table that stores the link token is in the blocked file 051 | Blocked |
| Approve and sign an estimate or invoice | Click or signature with a saved record [S1] | Exists. Signing page with saved signer and time; the new signed-record tables are in blocked file 046 | Exists |
| Inspection page with approve or skip per finding | [S27] | Exists. Random token, only needed fields, rate limited | Exists |
| Book online | Booking widget [S10] | Exists in code. Public page by shop link, calendar feed, request and slots routes; database tables applied 2026-10-15; not yet checked on the live app | Exists |
| Unsubscribe in one tap | Required for marketing email | Exists. Signed link, per shop | Exists |
| Privacy, terms, help | Not researched | Exists. The legal wording needs review by counsel before other shops use it | Blocked |
| The shop's logo, name and colours on every page | Logo on every customer page [S39] | Partial. Logo on print only | To build |
| Pay from the page | Pay link, no login [S3] | Missing | To build |
| Customer portal (history, documents, vehicles) | Not found (unverified) | Missing | To build |
| Spanish for customer pages, texts and the AI receptionist | Not researched | Missing. I found no Spanish in the customer pages or the receptionist rules. Houston shops need it | To build |

## 25. Ask Alpha's agents, tools and connections

Screens: Agents and tools, Connected apps, Ask Alpha.

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Nine agents (Router, Shop Ops, Parts, Repair, Desktop, Browser, Communications, Reports, Safety) | Specialist agents [S35] | Exists. Listed with what each can do and its risk level | Exists |
| Tools (parts lookup, repair search, open browser, download image, open file, MCP discover and call, send SMS, shop action) with read, write, contacts others, delete and sensitive labels | Not researched | Exists | Exists |
| Eleven ready skills (verified parts search, estimate from verified parts, source-backed repair research, customer lookup, browser tab inspection, desktop file workflow, call summary, missed call recovery, review request, service reminder, send flow) | Not researched | Exists | Exists |
| Durable multi-step jobs with a cancel | Not researched | Exists. Workflow routes with leases and cancel | Exists |
| Connect a ChatGPT plan instead of pasting a key | Not researched | Exists. Private connection, owner only. This stays untouched | Exists |
| Google Calendar | Not researched | Exists | Exists |
| Facebook, Instagram, Google Business | Direct links [S24] | Partial. Sign-in flows exist; approvals are the owner's | Blocked |
| QuickBooks, a card processor, PartsTech, CARFAX | Direct links [S24] | Missing | To build |
| Turn each agent or tool on or off per shop and per role | Admin controls [S3] | Missing | To build |
| Master off switch for all of Ask Alpha | Not researched | Partial. Separate switches exist for the receptionist and the browser; Ask Alpha has the shop rules screen | To build |

## 26. Notifications, notes, reminders and background work

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| In-app alerts and tab counts | Team alerts [S29] | Exists | Exists |
| Phone push alerts | Mobile push [S29] | Missing. Needs the installable app (section 30) | To build |
| Email alerts for failures, texts the assistant did not answer, calls needing a person | Not researched | Exists | Exists |
| Daily notes on Today | Not researched | Exists | Exists |
| Scheduled messages (appointment reminders and others) | Automatic reminders [S19] | Exists. Dispatch route and queue | Exists |
| Background jobs (reminder sync, report emails, automation ticks, heartbeats) | Not researched | Partial. The scheduler is the missing piece: one daily job today | Blocked |
| Daily briefing by text or email | Not researched | Not found in code (the old briefing page now opens Today) | To build |

## 27. Shop tablet and desktop host

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Shop tablet clock (PIN clock in and out, full screen) | Time clock [S28] | Exists in code. PIN storage is in migration 052 (applied 2026-10-15) | Exists |
| Sign in from the desktop app | Not researched | Partial. Start and complete pages exist; no desktop app shipped | Blocked |
| Connect your computer (browser host for sites that need a sign-in) | Not described for web apps (unverified) | Partial. Server side and the tables (blocked file 059); no desktop app | Blocked |

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
| One consent layer above every channel (STOP, START, HELP, quiet hours, written consent for marketing) | Alpha already enforces this for Telnyx. It must sit above every channel so switching never skips it | To build |

## 29. Selling Alpha to other shops

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Self-serve sign up and first-run setup | Not researched | Partial. Shop bootstrap and ensure routes, the Setup guide; no public signup page or trial | To build |
| Subscription billing, plans, trial, usage limits | AI sold per outcome or per seat [S35] | Missing. No billing | To build |
| AI cost per shop (pasted key vs included) | Not researched | Partial. Each shop pastes its key or connects a ChatGPT plan; an included AI plan is a business decision | Blocked |
| Shop isolation | Not applicable | Exists. Every table service-role only, scoped by shop in the server routes. Remaining Alpha-specific wording is listed in section 19 | Exists |
| Owner console: all shops, usage, problems | Not researched | Missing | To build |
| Export all my data and delete my account | Not researched | Partial. Customers export exists in code; no whole-shop export or delete | To build |
| Help center and contact | Not researched | Partial. One help page | To build |
| Terms and privacy reviewed for other shops | Not researched | Blocked on counsel | Blocked |

## 30. Install on a phone, speed, safety and monitoring

| Capability | What the best do | Alpha today | Status |
| --- | --- | --- | --- |
| Add to the home screen as an app | Installable web app | Missing. No web app manifest, no icons beyond one picture, no splash. The owner asked for this | To build |
| Works when the connection is bad (loading shell, clear "you are offline") | Not researched | Missing | To build |
| Phone push | Mobile push [S29] | Missing | To build |
| Security headers | Not researched | Partial. The request middleware sets frame, no-sniff, referrer, strict transport and a permissions policy that allows the microphone for the browser phone. There is no Content-Security-Policy | To build |
| Error reporting and uptime alerts | Not researched | Missing. Only platform logs | To build |
| Tests, type check, lint | Not applicable | Exists. 1,395 tests pass; type check and lint clean | Exists |
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
| Show exactly what will be sent before it is sent | The owner approves recipient, channel, words and total [S35] | Partial. Yes for documents and Ask Alpha. Text auto-replies: draft mode shows the exact words with Send, Change and Do not send; auto mode and calls can be tried first in test mode and the greeting preview |
| Human approval for anything customer-facing | Fin pauses for a teammate on sensitive steps [S35] | Partial. Ask Alpha yes. Text replies: the shop picks off, draft or auto. Bookings: the team approves unless the shop lets it book open times. Calls answer on their own inside the shop's rules, with a review list afterward |
| Undo, or say it cannot be undone | People mis-tap | Partial. "Cannot be undone" tag; no undo |
| Audit trail the owner can read | Who, what, when, approved [S28] | Partial. Receptionist: yes, Inbox, AI assistant lists every call and text with transcript, outcome and the rules used. Other AI actions: logged, see Ask Alpha |
| Stop button | A running action can be cancelled | Partial. Receptionist: separate master switches for calls and text replies, a pause on each conversation, quiet hours and per-number limits. Ask Alpha: being added; verify |
| Honest uncertainty | Say what is not verified; show sources; never invent prices or parts | Partial. Receptionist: never states a price, time or diagnosis and says the team will confirm; says when it is not sure and passes to a person. Parts show sources; some other prompts still say answer anyway |
| Tell people it is AI | Callers are told [S41]; disclosure is enforced [S45] | Exists on calls (inbound and outbound) and in the first text; cannot be switched off |
| Hand off to a person with context | Fin passes history to a human [S35][S36] | Exists for the receptionist: transfer with a text briefing, and a needs-a-person flag with an email, the transcript and what it wrote down |
| Rules the shop sets | Guidance for tone, handoff, limits [S37] | Exists for the receptionist (Settings, AI receptionist). Ask Alpha has its own rules screen |
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
| 0 | Done for 034 to 041, 043 to 045, 047 to 050 and 052 to 056 (2026-10-15). Still to apply: 046, 051, 057, 058, 059 | Customer links and signed records, job flow, purchase-order functions, browser tables | S | Yes |
| 1 | Done (2026-10-15). Make the AI receptionist and text auto-reply safe: say it is AI, shop hours setting, never quote prices, "needs a person" flag, off switch, quiet hours | It talks to customers unseen today | M | Yes (wording) |
| 2 | Texting that carriers allow (10DLC or toll-free verification) | Estimate texts, inspection links, reminders and review requests all depend on it | S | Yes |
| 3 | Payment links, card on file and deposits through a processor | Closes the money loop the leaders all have [S3][S22] | L | Yes |
| 4 | Estimate by text with a link: view, approve line by line, sign, pay | Today the text has no link | M | |
| 5 | Job-level technician time tracking | Unlocks tech board hours, efficiency per job, effective labor rate, gross profit | M | |
| 6 | QuickBooks sync | Accountant need; every leader has it [S14][S24] | L | Yes |
| 7 | Payroll export, payroll integrations, configurable week start | Payroll CSV exists; shops pay on different weeks | M | |
| 8 | DVI photo storage bucket instead of photos inside the row | Up to 24 photos near 220,000 characters each can mean about 5 MB per row | M | |
| 9 | DVI per-shop checklist templates | Every shop inspects differently [S5] | M | |
| 10 | DVI canned-job price lookup | Suggested prices from priced work, fewer typed numbers [S5] | S | |
| 11 | DVI per-vehicle inspection history | Shows what changed since last visit [S7] | S | |
| 12 | Tire and brake measurements with warning thresholds | Sells brake and tire work with proof; Autoflow keeps tread per tire [S33] | M | |
| 13 | Shop board: TV or full-screen mode | For the shop wall | S | |
| 14 | Shop board: jump-to-technician chips on phones | Long scroll on a phone | S | |
| 15 | Undo clock-out | Mis-taps happen | S | |
| 16 | Done (2026-10-15). Inbox: AI filter chip, and mark AI inbound calls as read | Owner sees what Alpha answered without clutter | S | |
| 17 | Labor guide integration | Leaders put labor times in the estimate [S1] | L | Yes |
| 18 | Parts catalog ordering (PartsTech first) | Order from the estimate [S2][S24] | L | Yes |
| 19 | Pricing matrices and one-click jobs from the vehicle | Speeds writing; needs 17 and 18 for full value [S2] | L | |
| 20 | Reports round two: car count, effective labor rate, approval rate, custom date comparison, scheduled report emails | The Shop Index four numbers [S15][S16] | M | |
| 21 | Tax-ready profit and loss (needs expenses) | Accountant handoff | L | |
| 22 | Online booking page and capacity | Leaders book 24 hours a day [S10] | L | |
| 23 | Customer portal | One place for estimates, invoices, inspections, pay and history; builds on 3 and 4 | L | |
| 24 | Command menu and keyboard shortcuts | Speed for office staff [S38] | M | |
| 25 | AI controls for the shop (rules, tone, handoff) and an included AI key | Fin-style guidance [S37]; the shop should not paste a key | M | Yes |
| 26 | One approval path in Ask Alpha, verify the Stop button, and an audit screen | Finish the AI-product bar | M | |
| 27 | Done except per-thread access and phone push (2026-10-15). Message templates, photos in texts, thread assignment | Shop-Ware and Tekmetric patterns [S12][S29] | M | |
| 28 | Per-shop warranty wording and permission roles screen | Needed before the second shop | M | Yes (legal) |
| 29 | Customer duplicate merge, CSV import and export | Clean data; Alpha has about 20 to remove | M | Yes |
| 30 | Multi-location view and benchmarks | Many shops later [S15][S20] | L | |
| 31 | Install on a phone: web app manifest, icons, standalone display, offline screen | The owner asked for a home-screen app; nothing is set up | S | |
| 32 | AI calling from the app and Ask Alpha: review card, do-not-call check, shop calling hours, listen-in, results saved to the customer | Section 21 | M | |
| 33 | One consent layer above every texting and calling channel, then a second provider and an optional own-phone mode | Section 28 | M | Yes |
| 34 | Posts: photo sources, grouping, caption from the job record, privacy checks, Off, Suggest or Auto, Ask Alpha control | Section 23 | L | Yes |
| 35 | Spanish for customer pages, texts and the receptionist | Section 24 | M | Yes (wording) |
| 36 | Apply the five blocked database files, then finish what depends on them | Section 24, 15, 5, 20 | S | Yes |
| 37 | Self-serve sign up, trial and billing; owner console | Section 29 | L | Yes |
| 38 | Error reporting, uptime alerts, Content-Security-Policy, backup drill | Section 30 | M | |

---

# Blocked on the owner

Nothing here can be finished by code alone.

1. **Five database files are not applied.** On 2026-10-15 twenty of the twenty-five were applied. The apply was cancelled each time for `046_document_links_and_history.sql` (customer links, signed approvals, document history), `051_job_flow.sql` (promise time, parts status, customer status link), `057_parts_functions.sql` (the purchase-order and stock functions), `058_browser_workspace.sql` and `059_browser_approvals_and_hosts.sql` (browser settings, approvals, paired computers). They only add new tables, functions and triggers; they do not change customers, invoices, estimates, payments, messages or signatures. Needs a go-ahead that is not cancelled.
2. **Pushing to GitHub and a Vercel preview.** Needs the Claude GitHub App installed on the account that owns the repo. The rebuild branch is local only until then.
3. **Texting registration.** Needs 10DLC registration or toll-free verification. Telnyx says unregistered traffic gets limited, filtered or blocked [S46][S47]. Until done, every text feature is at risk. The in-app checklist (Settings, Communications) lists each step and writes the answers to paste; only the owner can submit it in the Telnyx account.
4. **Duplicate and test customers.** About 20 should be removed; needs Aaron's approval before anything is deleted.

Also coming up, and not yet decided:

5. **Payment processor and merchant account** for items 3 and 4 above.
6. **QuickBooks Online account access** and the chart of accounts to map.
7. **Paid data accounts:** labor guide (ALLDATA or Mitchell) and a parts catalog account (PartsTech).
8. **Production schema export** for the `dvi` table, which was made by hand and has no migration in the repo.
9. **Rotate keys.** The June 2026 log says keys once in source were compromised and should be rotated. I could not verify they were.
10. **Google Business Profile access.** Alpha's prompt says Google approval was pending. Current status unverified.
11. **Legal wording.** AI disclosure on calls, call-recording notice, and warranty terms for shops other than Alpha. Ask counsel. The assistant says it is an AI and that calls may be recorded by default; the owner should read the wording on the AI receptionist screen and the registration copy before relying on them.
12. **Done (2026-10-15).** Voice and text migrations 037, 038 and 039 are applied: receptionist rules, thread assignment and saved replies, the assistant's activity log, bookings and picture storage, and the carrier checklist.
13. **One live test call and one test text** after the rules are saved, to hear the greeting and the transfer on the real Telnyx number. The assistant is covered by tests with simulated Telnyx events and by the practice screen, but not yet by a live call.
14. **Done (2026-10-15).** Automation and growth migrations 040 and 041 are applied: the message ledger, run history and results for Automations, and promotions, review replies and referral credits.
15. **A scheduler that checks every 5 minutes.** `vercel.json` has one daily job, so automations that should run every 15 minutes or every hour (appointment reminders, car is ready) run late. Options: Vercel Pro with a 5-minute cron on `/api/cron/tick`, or a free outside pinger or GitHub Actions calling it with the cron secret. The Automations screen says how often it really checks.
16. **Accounts for posting and ads.** Publishing a post to Google, Facebook, Instagram or TikTok, and starting a paid ad, need each account connected and a payment method on the ad account. Drafting, preview and copy are built; the last step waits on Aaron.
17. **Which texting route to use.** Telnyx with standard 10DLC (the shop has an EIN) or toll-free verification, then the Telnyx signing key so inbound texts are accepted, and a balance (it was $3.73). Only the owner can submit the registration in the Telnyx account.
18. **A frequent scheduler.** The free option is a database-side job that calls `/api/cron/tick` every 5 minutes with the cron secret. It is a database setting, so it needs a go-ahead.
19. **Customer clean-up.** About 20 duplicate or test customers. Alpha will show each pair side by side and merge with undo, but only after the owner says yes to that specific action.
20. **Sign-ins only the owner can do:** Facebook Page, Instagram, Google Business Profile, ad accounts, QuickBooks, a card processor, the Google Maps, Hunter and Serper accounts for lead details.
21. **Legal review:** Spanish and English wording for AI disclosure, call recording and text consent; terms and privacy for shops other than Alpha; whether outreach to people who posted publicly is allowed.

---

# Not verified

- Anything marked "unverified" or "Not researched" in the tables.
- Settings, Growth, Inventory, Repair info, Customers and Ask Alpha were being rebuilt in the working tree (uncommitted) while this was written. Rows for those screens describe what I read at that moment and may already be out of date. Re-read the code before you rely on them.
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
