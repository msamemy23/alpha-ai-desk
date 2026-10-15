# Migration status (checked 2026-10-15)

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

## In the repo but NOT in production

The folder `supabase/migrations` at the top of the repository holds files 034-059 for the new
screens (shop logo, time-clock breaks, AI shop rules, document links and history, scheduling,
customer and vehicle records, reports, parts purchasing, the built-in browser, and more).
None of them appear in production's history. The app code degrades gracefully without
them (documents, payments, signing, messaging and the assistant all work against the current
database), but the features that depend on them stay off until the owner reviews and
approves applying them. Nothing in these folders is applied automatically.

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
