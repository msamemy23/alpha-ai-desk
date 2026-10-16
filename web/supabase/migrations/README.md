# Migration status (checked 2026-10-15, updated after applying twenty files)

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

## In the repo but NOT in production (six files, waiting for the owner)

046, 051, 057, 058 and 059 were each sent for applying and the request was cancelled; 060 was written afterwards and
has not been sent. They stay unapplied until the owner says to apply them. The app handles their absence: the screens that need them say a database update is needed instead of
failing, and everything else works as before.

| File (top-level `supabase/migrations`) | What it adds | What waits on it |
| --- | --- | --- |
| 046_document_links_and_history | Customer links, signed approvals, document change history | Send-with-preview, customer answers, good/better/best, the declined-work list, change-history events |
| 051_job_flow | Parts status, labels, estimated hours, promised time and the customer status link on each car | The customer status page (`/status/<link>`) and the Status link section on a job, parts status and labels on the shop board |
| 057_parts_functions | Purchase-order, receiving, returns and quantity-history functions | Purchase orders and returns, quantity history |
| 058_browser_workspace | The built-in browser's saved workspace | The Browser screen's saved tabs and notes |
| 059_browser_approvals_and_hosts | The built-in browser's approvals and allowed sites | Browser approvals |
| 060_repair_posts | Repair-post queue, photos and settings | Automatic repair posts and Ask Alpha's `posts` tool |

Note on the number 059: the top-level `059_browser_approvals_and_hosts` is a different change from
`web/supabase/migrations/059_durable_operation_constraints` (see above, already live).

Before applying any of them: take the baseline counts (customers, documents, payments, messages, signatures and the
paid-invoice total), apply one file, check the counts again, then run the Supabase advisors. Stop at the first problem.

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
