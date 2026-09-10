-- Make the service-only repair cache explicit to security tooling.
-- No browser role receives access; API routes use the service role.
drop policy if exists repair_manual_cache_service_only on public.repair_manual_cache;
create policy repair_manual_cache_service_only
  on public.repair_manual_cache
  for all
  to service_role
  using (true)
  with check (true);
