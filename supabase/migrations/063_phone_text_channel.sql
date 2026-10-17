-- Text through the shop's own Android phone: six new columns on settings.
--
-- A shop can now choose how its texts go out: the shop's Telnyx number (what every shop used until now), or its own Android phone
-- through a text gateway app (TextBee or httpSMS) installed on that phone. These columns hold that choice.
--
--   sms_channel           'telnyx' or 'phone'. Empty means 'telnyx', so every existing shop behaves exactly as before.
--   phone_gateway         'textbee' or 'httpsms'
--   phone_gateway_key     that service's API key for this shop (kept like telnyx_api_key: the browser is never sent it back)
--   phone_gateway_device  TextBee's device id for the phone (httpSMS does not use one)
--   phone_gateway_number  the phone's own number, with the country code
--   phone_gateway_secret  a random code in this shop's incoming-text address, so nobody else can post fake customer texts into it
--
-- Add-only: six nullable columns and two checks. No table, row, policy or existing column changes, and no customer, estimate,
-- invoice or message data is read or written. settings is already server-only (migration 041), so these are too.
-- Until this runs, the app works as before and the Settings card says it needs a database update. Safe to run more than once.

alter table public.settings add column if not exists sms_channel text;
alter table public.settings add column if not exists phone_gateway text;
alter table public.settings add column if not exists phone_gateway_key text;
alter table public.settings add column if not exists phone_gateway_device text;
alter table public.settings add column if not exists phone_gateway_number text;
alter table public.settings add column if not exists phone_gateway_secret text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_sms_channel_check') then
    alter table public.settings
      add constraint settings_sms_channel_check check (sms_channel is null or sms_channel in ('telnyx', 'phone'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'settings_phone_gateway_check') then
    alter table public.settings
      add constraint settings_phone_gateway_check check (phone_gateway is null or phone_gateway in ('textbee', 'httpsms'));
  end if;
end $$;
