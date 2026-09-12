-- Provider credentials and OAuth tokens are server-only. Authenticated browser
-- clients may read ordinary shop metadata, but cannot read or write credentials.
revoke select (ai_api_key, telnyx_api_key, resend_api_key, browserless_token, facebook_page_token)
  on table public.settings from anon, authenticated;
revoke insert (ai_api_key, telnyx_api_key, resend_api_key, browserless_token, facebook_page_token)
  on table public.settings from anon, authenticated;
revoke update (ai_api_key, telnyx_api_key, resend_api_key, browserless_token, facebook_page_token)
  on table public.settings from anon, authenticated;

revoke select (access_token, refresh_token, page_access_token)
  on table public.connectors from anon, authenticated;
revoke insert (access_token, refresh_token, page_access_token)
  on table public.connectors from anon, authenticated;
revoke update (access_token, refresh_token, page_access_token)
  on table public.connectors from anon, authenticated;