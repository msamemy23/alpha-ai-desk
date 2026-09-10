-- Each shop may use its own Telnyx account and outbound voice profile.
alter table public.settings
  add column if not exists telnyx_outbound_voice_profile_id text;
