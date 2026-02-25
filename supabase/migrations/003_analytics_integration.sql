-- ClientBrain Migration 003: Analytics Bot Integration
-- Adds tables for Slack analytics bot to read config + analytics data from Supabase
-- instead of BigQuery (which is too slow for real-time config lookups).
-- BQ remains the warehouse for raw GA4/GSC exports; daily summaries sync here.

-- ============================================================================
-- SCHEMA CHANGES TO EXISTING TABLES
-- ============================================================================

-- Add analytics config columns to metrics table
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS ga4_bq_dataset TEXT;
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS search_console_url TEXT;

-- ============================================================================
-- NEW TABLES
-- ============================================================================

-- Slack channel → client mapping with schedule config
CREATE TABLE slack_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  channel_id TEXT UNIQUE NOT NULL,
  schedule_day TEXT,
  schedule_time TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_report_sent TIMESTAMPTZ
);

-- GSC daily rollup (synced from BigQuery)
CREATE TABLE analytics_gsc_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  data_date DATE NOT NULL,
  impressions INTEGER,
  clicks INTEGER,
  ctr DOUBLE PRECISION,
  avg_position DOUBLE PRECISION,
  UNIQUE(client_id, data_date)
);

-- GA4 daily rollup (synced from BigQuery)
CREATE TABLE analytics_ga4_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  sessions INTEGER,
  active_users INTEGER,
  new_users INTEGER,
  engaged_sessions INTEGER,
  engagement_rate DOUBLE PRECISION,
  UNIQUE(client_id, event_date)
);

-- Attribution daily rollup (synced from BigQuery)
CREATE TABLE analytics_attribution_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  event_name TEXT,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  sessions INTEGER,
  users INTEGER,
  UNIQUE(client_id, event_date, event_name, source, medium, campaign)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_slack_channels_schedule ON slack_channels(schedule_day, schedule_time, is_active);
CREATE INDEX idx_analytics_gsc_daily_client ON analytics_gsc_daily(client_id, data_date);
CREATE INDEX idx_analytics_ga4_daily_client ON analytics_ga4_daily(client_id, event_date);
CREATE INDEX idx_analytics_attribution_daily_client ON analytics_attribution_daily(client_id, event_date);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE slack_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_gsc_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_ga4_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_attribution_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON slack_channels FOR ALL USING (true);
CREATE POLICY "Service role full access" ON analytics_gsc_daily FOR ALL USING (true);
CREATE POLICY "Service role full access" ON analytics_ga4_daily FOR ALL USING (true);
CREATE POLICY "Service role full access" ON analytics_attribution_daily FOR ALL USING (true);
