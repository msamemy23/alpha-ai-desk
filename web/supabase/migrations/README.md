# Migration status (checked 2026-10-16, updated after applying all twenty-six files)

The live Supabase project ("alpha desk") is the source of truth for what is applied.
This file records how the repository relates to it.

## Saved in the repo on 2026-10-15 (already applied to production on 2026-09-13)

The 16 files whose names start with `20260913` are word-for-word copies of the SQL
that production recorded in `supabase_migrations.schema_migrations`. They were
copied here so the repository can rebuild the database that is live today.
**They are already applied. Do not run them against production again.**

| Version          | Name                                       |
| ---------------- | ------------------------------------------ |
| 20260913182525   | insurance_job_fields_20260913              |
| 20260913184052   | atomic_signatures_20260913                 |
| 20260913184053   | service_role_operational_policies_20260913 |
| 20260913190650   | message_idempotency_20260913               |
| 20260913192428   | server_only_shop_bootstrap                 |
| 20260913205202   | protect_financial_audit_tables             |
| 20260913210837   | server_only_payment_rpcs                   |
| 20260913221953   | signature_send_idempotency                 |
| 20260913221954   | atomic_inventory_adjustments               |
| 20260913225624   | signature_profile_write_policies_20260913  |
| 20260913230517   | revoke_signature_browser_select_20260913   |
| 20260913230559   | restrict_shop_profile_bootstrap_20260913   |
| 20260913230951   | inventory_quantity_set_20260913            |
| 20260913231112   | one_open_timeclock_entry_20260913          |
| 20260913231234   | validate_inventory_replays_20260913        |
| 20260913231945   | extend_ai_workflow_lease_window_20260913   |

## Numbered files that production already has (under dated names)

`web/supabase/migrations` files 035-060 are all in production already, recorded
there under their dated versions (for example `039_payment_idempotency_required`
is `20260910161213 payment_idempotency_required`). Two need a note:

- `038_audit_log_error_reporting.sql` contains only comments (a marker), so there is nothing to apply.
- `059_durable_operation_constraints.sql` has no entry of its own in production's history, but
  all three of its changes are present in the live database (checked 2026-10-15: the `unknown`
  status on `ai_action_operations`, the unique index `messages_shop_telnyx_message_id_idx`,
  and the `idempotency_payload_hash` column on `growth_campaigns`).

## Applied to production on 2026-10-15 (the owner said "apply them")

These files from the top-level `supabase/migrations` folder were applied to the live project.
Production records them under the version below (the time they were applied), not the file number.

| File | Production version |
| ---- | ------------------ |
| 034_shop_logo | 20261015210404 |
| 035_timeclock_breaks | 20261015210409 |
| 036_dvi_customer_link | 20261015210413 |
| 037_voice_rules | 20261015210422 |
| 038_voice_activity | 20261015210552 |
| 039_messaging_registration | 20261015210556 |
| 040_automation_messaging | 20261015210603 |
| 041_growth_promotions_replies_referrals | 20261015210615 |
| 043_ai_shop_rules | 20261015210619 |
| 044_ai_run_cancels | 20261015210624 |
| 045_ai_activity_indexes | 20261015210630 |
| 047_document_options_templates_settings | 20261015211158 |
| 048_document_revisions | 20261015211202 |
| 049_dvi_templates_and_media | 20261015211212 |
| 050_scheduling | 20261015211217 |
| 052_people_time | 20261015211247 |
| 053_customer_records | 20261015211258 |
| 054_vehicle_records | 20261015211305 |
| 055_reports_accounting | 20261015211324 |
| 056_parts_purchasing | 20261015211340 |

(`042` was never used.)

## Applied to production on 2026-10-16 (the owner ran them in the Supabase SQL editor)

The connector cancelled the apply of these six files each time, so the owner pasted one combined file (the six files, in
this order, unchanged) into the Supabase SQL editor and ran it. **Because the SQL editor does not write to
`supabase_migrations.schema_migrations`, the migration history does not list them.** Check the tables and functions
below instead. The files are written so that running them again is safe.

| File (top-level `supabase/migrations`) | What it adds | What uses it |
| --- | --- | --- |
| 046_document_links_and_history | Tables `document_links`, `document_approvals`, `document_events`; triggers that keep signed records and history from being changed | Send-with-preview, customer answers, good/better/best, the declined-work list, change-history events |
| 051_job_flow | Table `job_flow` (parts status, labels, estimated hours, promised time, customer status link) | The customer status page (`/status/<link>`) and the Status link section on a job, parts status and labels on the shop board |
| 057_parts_functions | Functions `inventory_apply_delta`, `inventory_set_prices`, `next_po_number`, `po_save_draft`, `po_mark_sent`, `po_cancel`, `receive_po_lines` | Purchase orders and returns, quantity history |
| 058_browser_workspace | Tables `browser_settings`, `browser_site_rules`, `browser_bookmarks` | The Browser screen's settings, allow and block lists and saved sites |
| 059_browser_approvals_and_hosts | Tables `browser_approvals`, `browser_hosts`, `browser_host_commands` | Browser approvals, downloads, paired computers |
| 060_repair_posts | Tables `post_settings`, `job_post_info`, `post_queue` | Repair posts and Ask Alpha's `posts` tool |
| 061_deleted_calls | Table `deleted_calls` (shop, call id, who deleted it, when) | Delete a call: the call log copies calls in again each time Messages opens, so a deleted call's id is kept here and skipped. One new table, server-only, nothing existing changed. STATUS: applied to production 2026-10-16 (checked afterwards: table exists and is empty, row level security on, no policies, access for the server only, customer, document, payment and message counts unchanged at 169, 185, 147, 322) |
| 062_client_error_counts | Table `client_error_counts` (shop, day, kind, screen name, short reference, cleaned message, count) and function `record_client_error` | Problems reported: the owner's list of screens that broke, and the line on Today. One new table and one new function, server only, nothing existing changed. STATUS: NOT applied to production (the apply was cancelled on 2026-10-16 and not retried). Until it is applied, reports are still written to the log and the Problems reported screen says it needs a database update. Before running, check customer, document, payment and message counts (169, 185, 147, 322) and check them again after |

Checked after running them (2026-10-16): all 13 tables and 10 functions exist, row level security is on for every
table, the security advisors show no errors (the notices are tables with no browser access, the same as the other
server-only tables), and the customer, document, payment and message counts did not change (169, 185, 147, 322).

Note on the number 059: the top-level `059_browser_approvals_and_hosts` is a different change from
`web/supabase/migrations/059_durable_operation_constraints` (see above, already live).



## Other things to know

- Migrations live in two folders: `supabase/migrations` (010-041, 043-059 and one
  dated file) and `web/supabase/migrations` (001-006, 035-060 and the dated files).
  The numbers 005 and 006 are each used by two files in `web/`, and 042 is not used at the top level.
  The numbers 035-041 also appear in both folders for different changes, so always go by the dated
  version recorded in production, not by the number.
- Only the dated, versioned history in production is authoritative. Do not run the
  older numbered files against production again.
- The original `20250101_growth_tables.sql` created growth tables with
  `USING (true)` policies. Production has since replaced them (see
  `tenant_growth_security_hardening`); a fresh database built only from the older
  files would be open until the later migrations are applied.
