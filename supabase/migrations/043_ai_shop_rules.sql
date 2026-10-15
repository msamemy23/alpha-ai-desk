-- Shop-set rules for the AI (tone, what it may do, what it must never do, facts it may state).
--
-- One JSON document per shop, kept on the shop's existing settings row. It is read and written only by
-- the server (/api/ai-rules and the AI routes): migration 027 revoked broad table access and granted the
-- browser only a short list of columns, and this column is deliberately not on that list.
-- The shape is documented in src/lib/ai/shop-rules.ts.
--
-- The app checks for this column: until this runs, the rules screen shows a "needs a database update"
-- notice and the AI keeps its built-in defaults (it asks before it changes anything or contacts anyone).
-- Safe to run more than once. Not applied to production yet.

alter table public.settings add column if not exists ai_rules jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'settings_ai_rules_check' and conrelid = 'public.settings'::regclass
  ) then
    alter table public.settings add constraint settings_ai_rules_check
      check (ai_rules is null or (jsonb_typeof(ai_rules) = 'object' and length(ai_rules::text) <= 40000));
  end if;
end $$;
