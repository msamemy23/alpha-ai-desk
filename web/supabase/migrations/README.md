# Migration status (checked 2026-10-14)

The live Supabase project ("alpha desk") has database changes that are **not saved
in this repository**. If the database were ever lost or a second environment
were needed (a staging copy, a new region), these files alone could not rebuild it.

## Missing from the repo (applied to production on 2026-09-13)

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

The exact SQL is stored in production in `supabase_migrations.schema_migrations`
(column `statements`). Export it with the Supabase CLI instead of retyping it:

```
supabase link --project-ref fztnsqrhjesqcnsszqdb
supabase migration fetch
```

## Other things to know

- Migrations live in two folders: `supabase/migrations` (010-033 and two dated
  files) and `web/supabase/migrations` (001-006, 035-060 and dated files). There is
  no 034, and the numbers 005 and 006 are each used by two files here.
- Only the dated, versioned history in production is authoritative. Do not run the
  older numbered files against production again.
- The original `20250101_growth_tables.sql` created growth tables with
  `USING (true)` policies. Production has since replaced them (see
  `tenant_growth_security_hardening`); a fresh database built only from the older
  files would be open until the later migrations are applied.
