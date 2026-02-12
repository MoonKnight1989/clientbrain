-- Quest 1.2: Populate NOAN client data
-- Run this in Supabase SQL Editor after running 001_initial_schema.sql

-- Insert client
INSERT INTO clients (id, name, slug, industry, website_url, status)
VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  'NOAN',
  'noan',
  'Artificial Intelligence, Knowledge Systems',
  'https://www.getnoan.com/',
  'active'
);

-- Insert brand
INSERT INTO brand (client_id, mission, tagline, brand_personality, tone_of_voice, messaging_frameworks)
VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  'Build an AI-Native system of record for businesses to run on facts, not fiction.',
  'Run your business on facts, not fiction',
  '["confident", "bold", "honest", "trustworthy", "intelligent"]'::jsonb,
  '{
    "description": "Honest, matter-of-fact, easy to understand, friendly. We communicate complex AI concepts in simple terms while maintaining credibility.",
    "dos": [
      "Be encouraging, positive and inspiring",
      "Use clear, simple language",
      "Focus on practical benefits",
      "Be confident and direct"
    ],
    "donts": [
      "Don''t be too technical",
      "Don''t be too wordy",
      "Don''t be boring",
      "Avoid jargon without explanation"
    ],
    "examples": [
      "Build an AI-Native system of record for your business, without the technical headache. Keep your team aligned with accurate AI built on facts, not hallucinations. Find out what NOAN can do for your business today.",
      "If you want to scale fast, you can''t afford misalignment, stale knowledge, or hallucinating AI. NOAN is the living fact layer that becomes your company''s AI-native system of record, so your strategy, operations, and AI outputs are always rooted in what''s true and up to date — not outdated docs or fragmented tools."
    ]
  }'::jsonb,
  '{
    "primary_positioning": "AI-native system of record that keeps businesses running on accurate, up-to-date facts instead of stale documentation",
    "category": "AI Knowledge Management",
    "market_position": "First AI-native workspace built on ontological knowledge graphs"
  }'::jsonb
);

-- Insert visual identity
INSERT INTO visual_identity (client_id, colours, typography, logo_urls)
VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  '{
    "primary": {
      "hex": "#EA5D04",
      "name": "Juicy Orange",
      "usage": "Primary brand color, CTAs, emphasis"
    },
    "secondary": {
      "hex": "#CBF7F2",
      "name": "Electric Blue",
      "usage": "Accents, highlights, secondary elements"
    }
  }'::jsonb,
  '{
    "headings": {
      "family": "Tusker Grotesk",
      "weights": [500, 700, 900],
      "usage": "All headings, hero text, section titles"
    },
    "body": {
      "family": "Aktiv Grotesk",
      "weights": [400, 500, 700],
      "usage": "Body copy, UI text, descriptions"
    }
  }'::jsonb,
  '{}'::jsonb
);

-- Insert product
INSERT INTO products (
  client_id,
  name,
  description,
  benefit_led_description,
  pricing,
  features,
  use_cases,
  status
)
VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  'AI Native Workspace',
  'NOAN is an AI Native Workspace that keeps your business up to date on facts, instead of documentation. NOAN uses ontological and graph knowledge to always stay up to date on your business. Create highly accurate content for your business.',
  'Create accurate content with AI that truly knows and understands your business. Say goodbye to PDF documents and make sure your business is always up to date with the latest facts. Join NOAN today and build your AI-Native business around a layer of facts.',
  '{
    "model": "subscription",
    "base_price": 99,
    "currency": "USD",
    "interval": "month",
    "tiers": [
      {
        "name": "First Seat",
        "price": 99,
        "description": "Base subscription includes 1 seat"
      },
      {
        "name": "Additional Seats",
        "price": 75,
        "per": "seat",
        "description": "Each additional team member"
      }
    ]
  }'::jsonb,
  '[
    {
      "name": "AI Assistant",
      "description": "Create content, ask questions and update business facts with AI",
      "benefit": "Generate accurate, on-brand content instantly without searching through outdated docs or risking hallucinations"
    },
    {
      "name": "Notes Repository",
      "description": "Store your meeting notes for ontological context",
      "benefit": "Turn every meeting into structured knowledge that automatically updates your business facts"
    },
    {
      "name": "Fact Layer",
      "description": "Add and maintain your business facts in a living knowledge graph",
      "benefit": "Replace scattered docs with a single source of truth that keeps your team aligned"
    },
    {
      "name": "Network CRM",
      "description": "Store information on contacts ontologically",
      "benefit": "Understand contact behaviors and relationships automatically — know who to reach out to and why"
    },
    {
      "name": "Dashboard",
      "description": "Connect your business tools to keep track of everything in one place",
      "benefit": "Stop switching between tools — see your entire business at a glance"
    },
    {
      "name": "Integrations",
      "description": "Send info in and out of NOAN seamlessly",
      "benefit": "Keep NOAN synced with your existing stack without manual data entry"
    }
  ]'::jsonb,
  '[
    {
      "persona": "Early-stage SaaS Founder",
      "scenario": "Scaling from 3 to 15 people without hiring a knowledge manager",
      "outcome": "Everyone stays aligned on product, strategy, and customer insights without weekly all-hands meetings"
    },
    {
      "persona": "CMO at Series A startup",
      "scenario": "Creating consistent marketing content across multiple channels",
      "outcome": "Generate on-brand content that reflects current product features and messaging without checking with product team every time"
    },
    {
      "persona": "CEO managing remote team",
      "scenario": "Onboarding new hires quickly without creating elaborate documentation",
      "outcome": "New team members ask NOAN questions and get accurate, up-to-date answers — reducing onboarding time by 50%"
    }
  ]'::jsonb,
  'active'
);

-- Insert audiences
INSERT INTO audiences (client_id, name, description, pain_points, goals, objections, demographics)
VALUES
(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'CEOs and Founders',
  'Early to mid-stage startup founders and CEOs scaling their companies, typically 5-50 employees.',
  '[
    "Constantly dealing with out-of-date documents as the business scales",
    "AI tools hallucinate and get information wrong about the business",
    "Tech stack is becoming bloated and inefficient",
    "Team misalignment due to scattered knowledge",
    "Spending too much time on internal communication instead of growth"
  ]'::jsonb,
  '[
    "Run their business on autopilot with reliable AI",
    "Keep headcount down in early stages while scaling efficiently",
    "Maintain accurate company knowledge as single source of truth",
    "Scale operations without proportionally scaling internal coordination overhead"
  ]'::jsonb,
  '[
    {
      "objection": "Don''t want complicated tools that require training",
      "response": "NOAN works like talking to a colleague — no training needed, just ask questions naturally"
    },
    {
      "objection": "Don''t want to code anything or deal with technical setup",
      "response": "Zero code required. Connect your tools and start chatting with your business in minutes"
    },
    {
      "objection": "Hate overcomplicated systems with steep learning curves",
      "response": "NOAN replaces complexity. It''s simpler than your current stack because it consolidates knowledge instead of adding another tool"
    },
    {
      "objection": "Already have too many disconnected tools",
      "response": "NOAN reduces your stack by becoming the central brain that connects everything"
    }
  ]'::jsonb,
  '{
    "company_stage": "Seed to Series B",
    "team_size": "5-50 employees",
    "role_level": "C-suite, Founder"
  }'::jsonb
),
(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'CMOs and First Marketing Hires',
  'Marketing leaders at startups who need to create consistent, accurate content at scale without a large team.',
  '[
    "Constantly checking with product/sales teams to verify information is current",
    "AI-generated content often contains outdated product details or wrong messaging",
    "Can''t scale content production without hiring more people",
    "Brand consistency suffers when multiple people create content",
    "Documentation is always 2-3 months behind reality"
  ]'::jsonb,
  '[
    "Generate on-brand, accurate content quickly without constant fact-checking",
    "Scale content production without proportionally scaling team",
    "Ensure every piece of content reflects current product and messaging",
    "Maintain brand voice consistency across all channels"
  ]'::jsonb,
  '[
    {
      "objection": "AI writing tools already exist — what makes this different?",
      "response": "Generic AI doesn''t know your business. NOAN does — it''s trained on your actual facts, not the internet"
    },
    {
      "objection": "We already have brand guidelines and a content calendar",
      "response": "NOAN doesn''t replace those — it makes sure AI actually follows them with real-time company knowledge"
    },
    {
      "objection": "Worried about losing the human touch in content",
      "response": "NOAN handles accuracy and consistency. You focus on creativity and strategy — the human parts that matter"
    }
  ]'::jsonb,
  '{
    "company_stage": "Seed to Series A",
    "team_size": "1-5 person marketing team",
    "role_level": "CMO, Head of Marketing, First Marketing Hire"
  }'::jsonb
);

-- Insert content/style guidelines
INSERT INTO content (client_id, seo_keywords, approved_snippets, banned_phrases, style_notes)
VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  '{
    "primary": [
      "AI native workspace",
      "AI knowledge management",
      "business knowledge graph",
      "AI system of record"
    ],
    "secondary": [
      "ontological AI",
      "living fact layer",
      "AI without hallucinations",
      "company knowledge base",
      "AI business intelligence"
    ],
    "by_page": {
      "homepage": ["AI native workspace", "run business on facts", "AI knowledge management"],
      "product": ["AI assistant", "knowledge graph", "business facts"],
      "pricing": ["AI workspace pricing", "knowledge management software cost"]
    }
  }'::jsonb,
  '[
    {
      "context": "hero",
      "text": "Run your business on facts, not fiction",
      "approved_by": "Founder"
    },
    {
      "context": "value_prop",
      "text": "AI-native system of record",
      "approved_by": "Founder"
    },
    {
      "context": "differentiator",
      "text": "Living fact layer",
      "approved_by": "Founder"
    }
  ]'::jsonb,
  '["synergy", "leverage", "cutting-edge", "revolutionary", "game-changer", "next-generation"]'::jsonb,
  'Always emphasize accuracy and factual grounding as key differentiators from generic AI tools. Avoid overpromising on automation — focus on augmentation and reliability. Use concrete examples rather than abstract concepts.'
);

-- Insert business model and positioning
INSERT INTO business (client_id, model, model_details, competitors, value_propositions, target_market)
VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  'SaaS',
  '{
    "revenue_model": "Subscription-based with per-seat pricing",
    "primary_channel": "Product-led growth with direct sales for enterprise",
    "customer_acquisition": "Content marketing, founder-led sales, product demos"
  }'::jsonb,
  '[
    {
      "name": "Fyxer AI",
      "url": "https://fyxer.ai",
      "positioning": "AI note-taking and email assistant",
      "differentiators": "NOAN is an all-in-one solution that expands across knowledge of the entire business, not just note-taking and email. We offer ontological knowledge graphs, not just AI summarization."
    },
    {
      "name": "Clarity CRM and traditional CRMs",
      "url": "",
      "positioning": "Contact and relationship management tools",
      "differentiators": "NOAN stores contacts ontologically and keeps information automatically up to date. AI can access all contact info and help you understand behaviors and marketing strategies — not just a database of names and emails."
    }
  ]'::jsonb,
  '[
    "Build your business on facts, not fiction — eliminate AI hallucinations with ontological knowledge",
    "Reduce your stack and simplify with an all-in-one AI-native knowledge system",
    "Talk to your business and scale with low headcount — AI that actually knows your company",
    "Replace stale documentation with a living fact layer that stays current automatically",
    "Keep your team aligned without constant meetings or scattered knowledge bases"
  ]'::jsonb,
  'Early to mid-stage B2B SaaS startups (5-50 employees) focused on operational efficiency and AI-augmented workflows. Primary personas: Founders, CEOs, and marketing leaders who need to scale without proportionally scaling headcount.'
);

-- Insert initial changelog entry
INSERT INTO changelog (client_id, source, summary, details)
VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  'manual',
  'Initial client onboarding - complete knowledge base populated',
  '{
    "tables_populated": ["clients", "brand", "visual_identity", "products", "audiences", "content", "business"],
    "data_source": "Direct client information provided during Quest 1.2",
    "completeness": "All required fields populated for knowledge completeness validation"
  }'::jsonb
);
