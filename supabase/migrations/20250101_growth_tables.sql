-- Growth Marketing Tables for Alpha AI Desk
-- Run this in your Supabase SQL editor

-- Competitor scan results
CREATE TABLE IF NOT EXISTS growth_competitor_scans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  competitor_name text,
  address text,
  rating numeric,
  total_reviews integer,
  place_id text,
  negative_reviews jsonb DEFAULT '[]',
  opportunities jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);

-- Social media monitoring results
CREATE TABLE IF NOT EXISTS growth_social_scans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  platform text,
  post_text text,
  author text,
  url text,
  sentiment text,
  opportunity_score integer,
  suggested_response text,
  created_at timestamptz DEFAULT now()
);

-- Ad campaigns
CREATE TABLE IF NOT EXISTS growth_campaigns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  platform text NOT NULL,
  ad_copy jsonb,
  headline text,
  description text,
  target_audience text,
  daily_budget numeric,
  status text DEFAULT 'draft',
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  spend numeric DEFAULT 0,
  facebook_result jsonb,
  google_ready jsonb,
  created_at timestamptz DEFAULT now()
);

-- Follow-up messages sent
CREATE TABLE IF NOT EXISTS growth_followups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid,
  customer_name text,
  phone text,
  message text,
  sent boolean DEFAULT false,
  message_id text,
  error text,
  months_since_visit integer,
  last_service text,
  created_at timestamptz DEFAULT now()
);

-- Referral codes
CREATE TABLE IF NOT EXISTS growth_referrals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid,
  customer_name text NOT NULL,
  code text UNIQUE NOT NULL,
  discount_percent numeric DEFAULT 10,
  total_referrals integer DEFAULT 0,
  total_discount_given numeric DEFAULT 0,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Referral redemptions
CREATE TABLE IF NOT EXISTS growth_referral_redemptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  referral_id uuid REFERENCES growth_referrals(id),
  referral_code text,
  referrer_id uuid,
  referrer_name text,
  new_customer_name text,
  new_customer_phone text,
  service_total numeric DEFAULT 0,
  discount_amount numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Review requests sent
CREATE TABLE IF NOT EXISTS growth_review_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid,
  customer_name text,
  phone text,
  sent boolean DEFAULT false,
  error text,
  created_at timestamptz DEFAULT now()
);

-- AI-generated review responses
CREATE TABLE IF NOT EXISTS growth_review_responses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reviewer_name text,
  rating integer,
  review_text text,
  ai_response text,
  posted boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Walk-in / Call leads
CREATE TABLE IF NOT EXISTS growth_leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text,
  phone text,
  email text,
  source text DEFAULT 'walk-in',
  vehicle_info text,
  notes text,
  status text DEFAULT 'new',
  needs_followup boolean DEFAULT true,
  touch_count integer DEFAULT 0,
  last_contact timestamptz,
  converted boolean DEFAULT false,
  converted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE growth_competitor_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_social_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_referral_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_review_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_leads ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (adjust as needed)
CREATE POLICY "Allow all for authenticated" ON growth_competitor_scans FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON growth_social_scans FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON growth_campaigns FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON growth_followups FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON growth_referrals FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON growth_referral_redemptions FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON growth_review_requests FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON growth_review_responses FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated" ON growth_leads FOR ALL USING (true);
