-- Keep WebRTC provider resources scoped to the shop that owns them.
alter table public.settings
  add column if not exists webrtc_connection_id text,
  add column if not exists webrtc_credential_id text;
