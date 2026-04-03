-- Migration: 003_fix_remaining_tables (v2 — IF EXISTS guards)
-- Adds shop_id + RLS to every data table not covered by migration 002.
-- Each table is wrapped in an IF EXISTS check so missing tables are silently skipped.
-- Tables: activities, ai_calls, appointments, automations, call_history, calls, canned_jobs, connectors, daily_notes, dvi, estimate_followups_sent, estimates, growth_activity, growth_campaigns, growth_followups, growth_leads, growth_referral_redemptions, growth_referrals, growth_review_requests, growth_review_responses, growth_scans, inventory, invoices, leads, outreach_history, referrals, scheduled_messages, service_reminders_sent, signatures, social_posts, staff, timeclock, vehicles, web_automation_logs

-- activities
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'activities') THEN
    ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.activities SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.activities;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.activities FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_activities" ON public.activities;
    CREATE POLICY "shop_sel_activities" ON public.activities FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_activities" ON public.activities;
    CREATE POLICY "shop_ins_activities" ON public.activities FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_activities" ON public.activities;
    CREATE POLICY "shop_upd_activities" ON public.activities FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_activities" ON public.activities;
    CREATE POLICY "shop_del_activities" ON public.activities FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- ai_calls
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_calls') THEN
    ALTER TABLE public.ai_calls ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.ai_calls SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.ai_calls;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.ai_calls FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.ai_calls ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_ai_calls" ON public.ai_calls;
    CREATE POLICY "shop_sel_ai_calls" ON public.ai_calls FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_ai_calls" ON public.ai_calls;
    CREATE POLICY "shop_ins_ai_calls" ON public.ai_calls FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_ai_calls" ON public.ai_calls;
    CREATE POLICY "shop_upd_ai_calls" ON public.ai_calls FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_ai_calls" ON public.ai_calls;
    CREATE POLICY "shop_del_ai_calls" ON public.ai_calls FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- appointments
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'appointments') THEN
    ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.appointments SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.appointments;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_appointments" ON public.appointments;
    CREATE POLICY "shop_sel_appointments" ON public.appointments FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_appointments" ON public.appointments;
    CREATE POLICY "shop_ins_appointments" ON public.appointments FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_appointments" ON public.appointments;
    CREATE POLICY "shop_upd_appointments" ON public.appointments FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_appointments" ON public.appointments;
    CREATE POLICY "shop_del_appointments" ON public.appointments FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- automations
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'automations') THEN
    ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.automations SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.automations;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.automations FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_automations" ON public.automations;
    CREATE POLICY "shop_sel_automations" ON public.automations FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_automations" ON public.automations;
    CREATE POLICY "shop_ins_automations" ON public.automations FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_automations" ON public.automations;
    CREATE POLICY "shop_upd_automations" ON public.automations FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_automations" ON public.automations;
    CREATE POLICY "shop_del_automations" ON public.automations FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- call_history
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'call_history') THEN
    ALTER TABLE public.call_history ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.call_history SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.call_history;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.call_history FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.call_history ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_call_history" ON public.call_history;
    CREATE POLICY "shop_sel_call_history" ON public.call_history FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_call_history" ON public.call_history;
    CREATE POLICY "shop_ins_call_history" ON public.call_history FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_call_history" ON public.call_history;
    CREATE POLICY "shop_upd_call_history" ON public.call_history FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_call_history" ON public.call_history;
    CREATE POLICY "shop_del_call_history" ON public.call_history FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- calls
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'calls') THEN
    ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.calls SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.calls;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.calls FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_calls" ON public.calls;
    CREATE POLICY "shop_sel_calls" ON public.calls FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_calls" ON public.calls;
    CREATE POLICY "shop_ins_calls" ON public.calls FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_calls" ON public.calls;
    CREATE POLICY "shop_upd_calls" ON public.calls FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_calls" ON public.calls;
    CREATE POLICY "shop_del_calls" ON public.calls FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- canned_jobs
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'canned_jobs') THEN
    ALTER TABLE public.canned_jobs ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.canned_jobs SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.canned_jobs;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.canned_jobs FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.canned_jobs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_canned_jobs" ON public.canned_jobs;
    CREATE POLICY "shop_sel_canned_jobs" ON public.canned_jobs FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_canned_jobs" ON public.canned_jobs;
    CREATE POLICY "shop_ins_canned_jobs" ON public.canned_jobs FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_canned_jobs" ON public.canned_jobs;
    CREATE POLICY "shop_upd_canned_jobs" ON public.canned_jobs FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_canned_jobs" ON public.canned_jobs;
    CREATE POLICY "shop_del_canned_jobs" ON public.canned_jobs FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- connectors
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'connectors') THEN
    ALTER TABLE public.connectors ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.connectors SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.connectors;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.connectors FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.connectors ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_connectors" ON public.connectors;
    CREATE POLICY "shop_sel_connectors" ON public.connectors FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_connectors" ON public.connectors;
    CREATE POLICY "shop_ins_connectors" ON public.connectors FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_connectors" ON public.connectors;
    CREATE POLICY "shop_upd_connectors" ON public.connectors FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_connectors" ON public.connectors;
    CREATE POLICY "shop_del_connectors" ON public.connectors FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- daily_notes
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'daily_notes') THEN
    ALTER TABLE public.daily_notes ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.daily_notes SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.daily_notes;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.daily_notes FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.daily_notes ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_daily_notes" ON public.daily_notes;
    CREATE POLICY "shop_sel_daily_notes" ON public.daily_notes FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_daily_notes" ON public.daily_notes;
    CREATE POLICY "shop_ins_daily_notes" ON public.daily_notes FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_daily_notes" ON public.daily_notes;
    CREATE POLICY "shop_upd_daily_notes" ON public.daily_notes FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_daily_notes" ON public.daily_notes;
    CREATE POLICY "shop_del_daily_notes" ON public.daily_notes FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- dvi
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'dvi') THEN
    ALTER TABLE public.dvi ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.dvi SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.dvi;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.dvi FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.dvi ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_dvi" ON public.dvi;
    CREATE POLICY "shop_sel_dvi" ON public.dvi FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_dvi" ON public.dvi;
    CREATE POLICY "shop_ins_dvi" ON public.dvi FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_dvi" ON public.dvi;
    CREATE POLICY "shop_upd_dvi" ON public.dvi FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_dvi" ON public.dvi;
    CREATE POLICY "shop_del_dvi" ON public.dvi FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- estimate_followups_sent
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'estimate_followups_sent') THEN
    ALTER TABLE public.estimate_followups_sent ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.estimate_followups_sent SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.estimate_followups_sent;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.estimate_followups_sent FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.estimate_followups_sent ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_estimate_followups_sent" ON public.estimate_followups_sent;
    CREATE POLICY "shop_sel_estimate_followups_sent" ON public.estimate_followups_sent FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_estimate_followups_sent" ON public.estimate_followups_sent;
    CREATE POLICY "shop_ins_estimate_followups_sent" ON public.estimate_followups_sent FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_estimate_followups_sent" ON public.estimate_followups_sent;
    CREATE POLICY "shop_upd_estimate_followups_sent" ON public.estimate_followups_sent FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_estimate_followups_sent" ON public.estimate_followups_sent;
    CREATE POLICY "shop_del_estimate_followups_sent" ON public.estimate_followups_sent FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- estimates
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'estimates') THEN
    ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.estimates SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.estimates;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.estimates FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_estimates" ON public.estimates;
    CREATE POLICY "shop_sel_estimates" ON public.estimates FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_estimates" ON public.estimates;
    CREATE POLICY "shop_ins_estimates" ON public.estimates FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_estimates" ON public.estimates;
    CREATE POLICY "shop_upd_estimates" ON public.estimates FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_estimates" ON public.estimates;
    CREATE POLICY "shop_del_estimates" ON public.estimates FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- growth_activity
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'growth_activity') THEN
    ALTER TABLE public.growth_activity ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.growth_activity SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.growth_activity;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.growth_activity FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.growth_activity ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_growth_activity" ON public.growth_activity;
    CREATE POLICY "shop_sel_growth_activity" ON public.growth_activity FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_growth_activity" ON public.growth_activity;
    CREATE POLICY "shop_ins_growth_activity" ON public.growth_activity FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_growth_activity" ON public.growth_activity;
    CREATE POLICY "shop_upd_growth_activity" ON public.growth_activity FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_growth_activity" ON public.growth_activity;
    CREATE POLICY "shop_del_growth_activity" ON public.growth_activity FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- growth_campaigns
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'growth_campaigns') THEN
    ALTER TABLE public.growth_campaigns ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.growth_campaigns SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.growth_campaigns;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.growth_campaigns FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.growth_campaigns ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_growth_campaigns" ON public.growth_campaigns;
    CREATE POLICY "shop_sel_growth_campaigns" ON public.growth_campaigns FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_growth_campaigns" ON public.growth_campaigns;
    CREATE POLICY "shop_ins_growth_campaigns" ON public.growth_campaigns FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_growth_campaigns" ON public.growth_campaigns;
    CREATE POLICY "shop_upd_growth_campaigns" ON public.growth_campaigns FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_growth_campaigns" ON public.growth_campaigns;
    CREATE POLICY "shop_del_growth_campaigns" ON public.growth_campaigns FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- growth_followups
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'growth_followups') THEN
    ALTER TABLE public.growth_followups ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.growth_followups SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.growth_followups;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.growth_followups FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.growth_followups ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_growth_followups" ON public.growth_followups;
    CREATE POLICY "shop_sel_growth_followups" ON public.growth_followups FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_growth_followups" ON public.growth_followups;
    CREATE POLICY "shop_ins_growth_followups" ON public.growth_followups FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_growth_followups" ON public.growth_followups;
    CREATE POLICY "shop_upd_growth_followups" ON public.growth_followups FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_growth_followups" ON public.growth_followups;
    CREATE POLICY "shop_del_growth_followups" ON public.growth_followups FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- growth_leads
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'growth_leads') THEN
    ALTER TABLE public.growth_leads ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.growth_leads SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.growth_leads;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.growth_leads FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.growth_leads ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_growth_leads" ON public.growth_leads;
    CREATE POLICY "shop_sel_growth_leads" ON public.growth_leads FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_growth_leads" ON public.growth_leads;
    CREATE POLICY "shop_ins_growth_leads" ON public.growth_leads FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_growth_leads" ON public.growth_leads;
    CREATE POLICY "shop_upd_growth_leads" ON public.growth_leads FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_growth_leads" ON public.growth_leads;
    CREATE POLICY "shop_del_growth_leads" ON public.growth_leads FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- growth_referral_redemptions
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'growth_referral_redemptions') THEN
    ALTER TABLE public.growth_referral_redemptions ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.growth_referral_redemptions SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.growth_referral_redemptions;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.growth_referral_redemptions FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.growth_referral_redemptions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_growth_referral_redemptions" ON public.growth_referral_redemptions;
    CREATE POLICY "shop_sel_growth_referral_redemptions" ON public.growth_referral_redemptions FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_growth_referral_redemptions" ON public.growth_referral_redemptions;
    CREATE POLICY "shop_ins_growth_referral_redemptions" ON public.growth_referral_redemptions FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_growth_referral_redemptions" ON public.growth_referral_redemptions;
    CREATE POLICY "shop_upd_growth_referral_redemptions" ON public.growth_referral_redemptions FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_growth_referral_redemptions" ON public.growth_referral_redemptions;
    CREATE POLICY "shop_del_growth_referral_redemptions" ON public.growth_referral_redemptions FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- growth_referrals
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'growth_referrals') THEN
    ALTER TABLE public.growth_referrals ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.growth_referrals SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.growth_referrals;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.growth_referrals FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.growth_referrals ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_growth_referrals" ON public.growth_referrals;
    CREATE POLICY "shop_sel_growth_referrals" ON public.growth_referrals FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_growth_referrals" ON public.growth_referrals;
    CREATE POLICY "shop_ins_growth_referrals" ON public.growth_referrals FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_growth_referrals" ON public.growth_referrals;
    CREATE POLICY "shop_upd_growth_referrals" ON public.growth_referrals FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_growth_referrals" ON public.growth_referrals;
    CREATE POLICY "shop_del_growth_referrals" ON public.growth_referrals FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- growth_review_requests
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'growth_review_requests') THEN
    ALTER TABLE public.growth_review_requests ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.growth_review_requests SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.growth_review_requests;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.growth_review_requests FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.growth_review_requests ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_growth_review_requests" ON public.growth_review_requests;
    CREATE POLICY "shop_sel_growth_review_requests" ON public.growth_review_requests FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_growth_review_requests" ON public.growth_review_requests;
    CREATE POLICY "shop_ins_growth_review_requests" ON public.growth_review_requests FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_growth_review_requests" ON public.growth_review_requests;
    CREATE POLICY "shop_upd_growth_review_requests" ON public.growth_review_requests FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_growth_review_requests" ON public.growth_review_requests;
    CREATE POLICY "shop_del_growth_review_requests" ON public.growth_review_requests FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- growth_review_responses
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'growth_review_responses') THEN
    ALTER TABLE public.growth_review_responses ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.growth_review_responses SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.growth_review_responses;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.growth_review_responses FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.growth_review_responses ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_growth_review_responses" ON public.growth_review_responses;
    CREATE POLICY "shop_sel_growth_review_responses" ON public.growth_review_responses FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_growth_review_responses" ON public.growth_review_responses;
    CREATE POLICY "shop_ins_growth_review_responses" ON public.growth_review_responses FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_growth_review_responses" ON public.growth_review_responses;
    CREATE POLICY "shop_upd_growth_review_responses" ON public.growth_review_responses FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_growth_review_responses" ON public.growth_review_responses;
    CREATE POLICY "shop_del_growth_review_responses" ON public.growth_review_responses FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- growth_scans
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'growth_scans') THEN
    ALTER TABLE public.growth_scans ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.growth_scans SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.growth_scans;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.growth_scans FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.growth_scans ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_growth_scans" ON public.growth_scans;
    CREATE POLICY "shop_sel_growth_scans" ON public.growth_scans FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_growth_scans" ON public.growth_scans;
    CREATE POLICY "shop_ins_growth_scans" ON public.growth_scans FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_growth_scans" ON public.growth_scans;
    CREATE POLICY "shop_upd_growth_scans" ON public.growth_scans FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_growth_scans" ON public.growth_scans;
    CREATE POLICY "shop_del_growth_scans" ON public.growth_scans FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- inventory
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory') THEN
    ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.inventory SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.inventory;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_inventory" ON public.inventory;
    CREATE POLICY "shop_sel_inventory" ON public.inventory FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_inventory" ON public.inventory;
    CREATE POLICY "shop_ins_inventory" ON public.inventory FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_inventory" ON public.inventory;
    CREATE POLICY "shop_upd_inventory" ON public.inventory FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_inventory" ON public.inventory;
    CREATE POLICY "shop_del_inventory" ON public.inventory FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- invoices
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'invoices') THEN
    ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.invoices SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.invoices;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_invoices" ON public.invoices;
    CREATE POLICY "shop_sel_invoices" ON public.invoices FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_invoices" ON public.invoices;
    CREATE POLICY "shop_ins_invoices" ON public.invoices FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_invoices" ON public.invoices;
    CREATE POLICY "shop_upd_invoices" ON public.invoices FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_invoices" ON public.invoices;
    CREATE POLICY "shop_del_invoices" ON public.invoices FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- leads
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'leads') THEN
    ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.leads SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.leads;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_leads" ON public.leads;
    CREATE POLICY "shop_sel_leads" ON public.leads FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_leads" ON public.leads;
    CREATE POLICY "shop_ins_leads" ON public.leads FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_leads" ON public.leads;
    CREATE POLICY "shop_upd_leads" ON public.leads FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_leads" ON public.leads;
    CREATE POLICY "shop_del_leads" ON public.leads FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- outreach_history
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'outreach_history') THEN
    ALTER TABLE public.outreach_history ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.outreach_history SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.outreach_history;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.outreach_history FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.outreach_history ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_outreach_history" ON public.outreach_history;
    CREATE POLICY "shop_sel_outreach_history" ON public.outreach_history FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_outreach_history" ON public.outreach_history;
    CREATE POLICY "shop_ins_outreach_history" ON public.outreach_history FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_outreach_history" ON public.outreach_history;
    CREATE POLICY "shop_upd_outreach_history" ON public.outreach_history FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_outreach_history" ON public.outreach_history;
    CREATE POLICY "shop_del_outreach_history" ON public.outreach_history FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- referrals
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'referrals') THEN
    ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.referrals SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.referrals;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.referrals FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_referrals" ON public.referrals;
    CREATE POLICY "shop_sel_referrals" ON public.referrals FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_referrals" ON public.referrals;
    CREATE POLICY "shop_ins_referrals" ON public.referrals FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_referrals" ON public.referrals;
    CREATE POLICY "shop_upd_referrals" ON public.referrals FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_referrals" ON public.referrals;
    CREATE POLICY "shop_del_referrals" ON public.referrals FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- scheduled_messages
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'scheduled_messages') THEN
    ALTER TABLE public.scheduled_messages ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.scheduled_messages SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.scheduled_messages;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.scheduled_messages FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_scheduled_messages" ON public.scheduled_messages;
    CREATE POLICY "shop_sel_scheduled_messages" ON public.scheduled_messages FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_scheduled_messages" ON public.scheduled_messages;
    CREATE POLICY "shop_ins_scheduled_messages" ON public.scheduled_messages FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_scheduled_messages" ON public.scheduled_messages;
    CREATE POLICY "shop_upd_scheduled_messages" ON public.scheduled_messages FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_scheduled_messages" ON public.scheduled_messages;
    CREATE POLICY "shop_del_scheduled_messages" ON public.scheduled_messages FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- service_reminders_sent
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'service_reminders_sent') THEN
    ALTER TABLE public.service_reminders_sent ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.service_reminders_sent SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.service_reminders_sent;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.service_reminders_sent FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.service_reminders_sent ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_service_reminders_sent" ON public.service_reminders_sent;
    CREATE POLICY "shop_sel_service_reminders_sent" ON public.service_reminders_sent FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_service_reminders_sent" ON public.service_reminders_sent;
    CREATE POLICY "shop_ins_service_reminders_sent" ON public.service_reminders_sent FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_service_reminders_sent" ON public.service_reminders_sent;
    CREATE POLICY "shop_upd_service_reminders_sent" ON public.service_reminders_sent FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_service_reminders_sent" ON public.service_reminders_sent;
    CREATE POLICY "shop_del_service_reminders_sent" ON public.service_reminders_sent FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- signatures
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'signatures') THEN
    ALTER TABLE public.signatures ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.signatures SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.signatures;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.signatures FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.signatures ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_signatures" ON public.signatures;
    CREATE POLICY "shop_sel_signatures" ON public.signatures FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_signatures" ON public.signatures;
    CREATE POLICY "shop_ins_signatures" ON public.signatures FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_signatures" ON public.signatures;
    CREATE POLICY "shop_upd_signatures" ON public.signatures FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_signatures" ON public.signatures;
    CREATE POLICY "shop_del_signatures" ON public.signatures FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- social_posts
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'social_posts') THEN
    ALTER TABLE public.social_posts ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.social_posts SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.social_posts;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.social_posts FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_social_posts" ON public.social_posts;
    CREATE POLICY "shop_sel_social_posts" ON public.social_posts FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_social_posts" ON public.social_posts;
    CREATE POLICY "shop_ins_social_posts" ON public.social_posts FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_social_posts" ON public.social_posts;
    CREATE POLICY "shop_upd_social_posts" ON public.social_posts FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_social_posts" ON public.social_posts;
    CREATE POLICY "shop_del_social_posts" ON public.social_posts FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- staff
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'staff') THEN
    ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.staff SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.staff;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.staff FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_staff" ON public.staff;
    CREATE POLICY "shop_sel_staff" ON public.staff FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_staff" ON public.staff;
    CREATE POLICY "shop_ins_staff" ON public.staff FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_staff" ON public.staff;
    CREATE POLICY "shop_upd_staff" ON public.staff FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_staff" ON public.staff;
    CREATE POLICY "shop_del_staff" ON public.staff FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- timeclock
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'timeclock') THEN
    ALTER TABLE public.timeclock ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.timeclock SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.timeclock;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.timeclock FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.timeclock ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_timeclock" ON public.timeclock;
    CREATE POLICY "shop_sel_timeclock" ON public.timeclock FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_timeclock" ON public.timeclock;
    CREATE POLICY "shop_ins_timeclock" ON public.timeclock FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_timeclock" ON public.timeclock;
    CREATE POLICY "shop_upd_timeclock" ON public.timeclock FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_timeclock" ON public.timeclock;
    CREATE POLICY "shop_del_timeclock" ON public.timeclock FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- vehicles
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vehicles') THEN
    ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.vehicles SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.vehicles;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_vehicles" ON public.vehicles;
    CREATE POLICY "shop_sel_vehicles" ON public.vehicles FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_vehicles" ON public.vehicles;
    CREATE POLICY "shop_ins_vehicles" ON public.vehicles FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_vehicles" ON public.vehicles;
    CREATE POLICY "shop_upd_vehicles" ON public.vehicles FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_vehicles" ON public.vehicles;
    CREATE POLICY "shop_del_vehicles" ON public.vehicles FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- web_automation_logs
DO $$
DECLARE v_shop_id uuid;
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'web_automation_logs') THEN
    ALTER TABLE public.web_automation_logs ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shop_profiles(id) ON DELETE CASCADE;
    SELECT sp.id INTO v_shop_id FROM public.shop_profiles sp JOIN auth.users u ON u.id = sp.user_id WHERE u.email = 'valuestock85@gmail.com';
    IF v_shop_id IS NOT NULL THEN
      UPDATE public.web_automation_logs SET shop_id = v_shop_id WHERE shop_id IS NULL;
    END IF;
    DROP TRIGGER IF EXISTS trg_set_shop_id ON public.web_automation_logs;
    CREATE TRIGGER trg_set_shop_id BEFORE INSERT ON public.web_automation_logs FOR EACH ROW EXECUTE FUNCTION public.fn_set_shop_id();
    ALTER TABLE public.web_automation_logs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "shop_sel_web_automation_logs" ON public.web_automation_logs;
    CREATE POLICY "shop_sel_web_automation_logs" ON public.web_automation_logs FOR SELECT USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_ins_web_automation_logs" ON public.web_automation_logs;
    CREATE POLICY "shop_ins_web_automation_logs" ON public.web_automation_logs FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_upd_web_automation_logs" ON public.web_automation_logs;
    CREATE POLICY "shop_upd_web_automation_logs" ON public.web_automation_logs FOR UPDATE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
    DROP POLICY IF EXISTS "shop_del_web_automation_logs" ON public.web_automation_logs;
    CREATE POLICY "shop_del_web_automation_logs" ON public.web_automation_logs FOR DELETE USING (shop_id IN (SELECT id FROM public.shop_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

