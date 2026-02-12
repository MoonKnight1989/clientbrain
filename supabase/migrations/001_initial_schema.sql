-- ClientBrain Database Schema
-- Migration 001: Initial schema with all tables, RLS, and functions

-- ============================================================================
-- TABLES
-- ============================================================================

-- Clients table
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  industry TEXT,
  website_url TEXT,
  status TEXT DEFAULT 'active', -- active, paused, offboarded
  onboarded_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Brand table
CREATE TABLE brand (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  mission TEXT,
  vision TEXT,
  tagline TEXT,
  brand_personality JSONB, -- e.g. ["authoritative", "approachable", "technical"]
  tone_of_voice JSONB, -- { "description": "...", "dos": [...], "donts": [...], "examples": [...] }
  messaging_frameworks JSONB, -- stored frameworks, value props, positioning statements
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id)
);

-- Visual Identity table
CREATE TABLE visual_identity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  colours JSONB, -- { "primary": {"hex": "#xxx", "rgb": "...", "name": "..."}, "secondary": {...}, "accent": {...} }
  typography JSONB, -- { "headings": {"family": "...", "weights": [...]}, "body": {...} }
  logo_urls JSONB, -- { "primary": "url", "reversed": "url", "icon": "url" }
  imagery_guidelines TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id)
);

-- Products table
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  benefit_led_description TEXT, -- the conversion-copy version
  pricing JSONB, -- flexible: { "model": "subscription", "tiers": [...] } or { "model": "one-time", "price": 299 }
  features JSONB, -- [{ "name": "...", "description": "...", "benefit": "..." }]
  use_cases JSONB, -- [{ "persona": "...", "scenario": "...", "outcome": "..." }]
  competitive_positioning TEXT,
  status TEXT DEFAULT 'active',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Audiences table
CREATE TABLE audiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- e.g. "Enterprise IT Directors"
  description TEXT,
  pain_points JSONB, -- ["...", "..."]
  goals JSONB,
  objections JSONB, -- [{ "objection": "...", "response": "..." }]
  demographics JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Content table
CREATE TABLE content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  seo_keywords JSONB, -- { "primary": [...], "secondary": [...], "by_page": { "homepage": [...] } }
  approved_snippets JSONB, -- [{ "context": "hero", "text": "...", "approved_by": "..." }]
  banned_phrases JSONB, -- ["leverage", "synergy", ...]
  style_notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id)
);

-- Business table
CREATE TABLE business (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  model TEXT, -- saas, ecommerce, service, marketplace, etc.
  model_details JSONB, -- flexible detail about the business model
  competitors JSONB, -- [{ "name": "...", "url": "...", "positioning": "...", "differentiators": "..." }]
  value_propositions JSONB, -- ["...", "..."]
  target_market TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id)
);

-- Metrics table
CREATE TABLE metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  ga4_property_id TEXT,
  posthog_project_id TEXT,
  kpis JSONB, -- [{ "name": "Monthly Traffic", "current_value": 45000, "target": 60000, "updated_at": "..." }]
  snapshot_data JSONB, -- latest pull from GA4/PostHog
  last_synced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id)
);

-- Relationships table (graph-ready)
CREATE TABLE relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_entity_type TEXT NOT NULL, -- 'client', 'product', 'audience', 'competitor'
  from_entity_id UUID NOT NULL,
  relationship_type TEXT NOT NULL, -- 'targets', 'competes_with', 'solves_pain_point', 'features_in'
  to_entity_type TEXT NOT NULL,
  to_entity_id UUID NOT NULL,
  properties JSONB, -- any additional context about the relationship
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Changelog table
CREATE TABLE changelog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  source TEXT NOT NULL, -- 'meeting_notes', 'manual', 'typeform', 'drive_extraction', 'analytics_sync', 'mcp_server'
  summary TEXT NOT NULL,
  details JSONB, -- what changed, structured
  raw_input TEXT, -- original transcript/text that triggered the change
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Project Bindings table
CREATE TABLE project_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL, -- 'webflow', 'figma'
  project_identifier TEXT NOT NULL, -- Webflow site ID or Figma file key
  project_name TEXT, -- human-readable name for reference
  bound_by TEXT, -- who set this up
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(platform, project_identifier)
);

-- API Usage table
CREATE TABLE api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  source TEXT NOT NULL, -- 'webflow_plugin', 'figma_plugin', 'mcp_server', 'meeting_notes', 'drive_extraction'
  operation TEXT NOT NULL, -- 'single_generate', 'full_page_generate', 'regenerate', 'knowledge_extraction', 'knowledge_query'
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  estimated_cost_usd NUMERIC(10, 6), -- calculated based on current Claude pricing
  model TEXT NOT NULL, -- 'claude-sonnet-4-5-20250929' etc.
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Copy Generations table
CREATE TABLE copy_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL, -- 'webflow', 'figma', 'mcp_server'
  project_identifier TEXT, -- Webflow site ID or Figma file key
  page_url TEXT, -- which page/frame this was for
  generation_type TEXT NOT NULL, -- 'single_element', 'full_page', 'section_regenerate'
  brief JSONB, -- the page/section brief submitted
  generated_copy JSONB, -- the copy that was generated
  applied BOOLEAN DEFAULT false, -- whether user clicked "Apply" or discarded it
  feedback TEXT, -- if regenerated, what feedback was given
  api_usage_id UUID REFERENCES api_usage(id), -- link to the API call
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_relationships_from ON relationships(from_entity_type, from_entity_id);
CREATE INDEX idx_relationships_to ON relationships(to_entity_type, to_entity_id);
CREATE INDEX idx_relationships_type ON relationships(relationship_type);
CREATE INDEX idx_api_usage_client ON api_usage(client_id, created_at);
CREATE INDEX idx_api_usage_source ON api_usage(source, created_at);
CREATE INDEX idx_copy_generations_client ON copy_generations(client_id, created_at);
CREATE INDEX idx_copy_generations_project ON copy_generations(platform, project_identifier, page_url);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand ENABLE ROW LEVEL SECURITY;
ALTER TABLE visual_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE audiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE content ENABLE ROW LEVEL SECURITY;
ALTER TABLE business ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE copy_generations ENABLE ROW LEVEL SECURITY;

-- Service role full access policies
CREATE POLICY "Service role full access" ON clients FOR ALL USING (true);
CREATE POLICY "Service role full access" ON brand FOR ALL USING (true);
CREATE POLICY "Service role full access" ON visual_identity FOR ALL USING (true);
CREATE POLICY "Service role full access" ON products FOR ALL USING (true);
CREATE POLICY "Service role full access" ON audiences FOR ALL USING (true);
CREATE POLICY "Service role full access" ON content FOR ALL USING (true);
CREATE POLICY "Service role full access" ON business FOR ALL USING (true);
CREATE POLICY "Service role full access" ON metrics FOR ALL USING (true);
CREATE POLICY "Service role full access" ON relationships FOR ALL USING (true);
CREATE POLICY "Service role full access" ON changelog FOR ALL USING (true);
CREATE POLICY "Service role full access" ON project_bindings FOR ALL USING (true);
CREATE POLICY "Service role full access" ON api_usage FOR ALL USING (true);
CREATE POLICY "Service role full access" ON copy_generations FOR ALL USING (true);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to get complete client context (LLM-ready)
CREATE OR REPLACE FUNCTION get_client_context(p_slug TEXT)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'client', row_to_json(c.*)::jsonb,
    'brand', row_to_json(b.*)::jsonb,
    'visual', row_to_json(v.*)::jsonb,
    'products', (SELECT jsonb_agg(row_to_json(p.*)::jsonb) FROM products p WHERE p.client_id = c.id AND p.status = 'active'),
    'audiences', (SELECT jsonb_agg(row_to_json(a.*)::jsonb) FROM audiences a WHERE a.client_id = c.id),
    'content', row_to_json(co.*)::jsonb,
    'business', row_to_json(bu.*)::jsonb,
    'metrics', m.kpis,
    'recent_changes', (
      SELECT jsonb_agg(row_to_json(ch.*)::jsonb ORDER BY ch.created_at DESC)
      FROM (SELECT * FROM changelog WHERE client_id = c.id ORDER BY created_at DESC LIMIT 10) ch
    )
  )
  FROM clients c
  LEFT JOIN brand b ON b.client_id = c.id
  LEFT JOIN visual_identity v ON v.client_id = c.id
  LEFT JOIN content co ON co.client_id = c.id
  LEFT JOIN business bu ON bu.client_id = c.id
  LEFT JOIN metrics m ON m.client_id = c.id
  WHERE c.slug = p_slug;
$$ LANGUAGE sql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to tables with updated_at
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_brand_updated_at BEFORE UPDATE ON brand FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_visual_identity_updated_at BEFORE UPDATE ON visual_identity FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_audiences_updated_at BEFORE UPDATE ON audiences FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_content_updated_at BEFORE UPDATE ON content FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_business_updated_at BEFORE UPDATE ON business FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_metrics_updated_at BEFORE UPDATE ON metrics FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
