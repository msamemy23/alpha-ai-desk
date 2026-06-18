-- Adds two columns needed by the latest features:
--   documents.internal_notes  — shop-only notes that never print/email/sign
--   customers.sms_opted_out   — set true when a customer texts STOP (TCPA opt-out)
-- Safe to run more than once.

ALTER TABLE public.documents  ADD COLUMN IF NOT EXISTS internal_notes text;
ALTER TABLE public.customers  ADD COLUMN IF NOT EXISTS sms_opted_out  boolean NOT NULL DEFAULT false;

-- Index so outbound sends can quickly skip opted-out customers.
CREATE INDEX IF NOT EXISTS idx_customers_sms_opted_out ON public.customers (sms_opted_out) WHERE sms_opted_out = true;
