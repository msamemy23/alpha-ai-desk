-- Indexes for the Activity screen (what the assistant did, who approved it, and Undo).
--
-- The screen lists a shop's audit entries by date, filters them by kind of action, finds the entry an
-- Undo refers to, and counts "assistant actions this month". These indexes keep those reads fast as the
-- history grows. They only speed reads up: no data changes.
-- Each one is skipped if its table does not exist yet.
-- Safe to run more than once. Not applied to production yet.

do $$
begin
  if to_regclass('public.audit_logs') is not null then
    create index if not exists audit_logs_shop_action_created_idx
      on public.audit_logs (shop_id, action, created_at desc);
    create index if not exists audit_logs_shop_undo_of_idx
      on public.audit_logs (shop_id, ((metadata ->> 'undoOf')))
      where action = 'ai.undo';
  end if;
  if to_regclass('public.ai_action_operations') is not null then
    create index if not exists ai_action_operations_shop_status_idx
      on public.ai_action_operations (shop_id, status, created_at desc);
  end if;
end $$;
