-- Let signed-in screens read the shop's timezone.
--
-- settings is column-allowlisted for browsers (migration 041): shop name, phone, rates and similar are readable, secrets are
-- not. timezone was added later and never added to the list, so the Reports screen got a 403 and fell back to the browser's
-- clock (audit 20 Oct 2026, bug B9). A timezone name is not secret.
--
-- Add-only: one column-level SELECT grant. Row security still limits each person to their own shop's row.
-- Undo: revoke select (timezone) on public.settings from authenticated;

grant select (timezone) on public.settings to authenticated;
