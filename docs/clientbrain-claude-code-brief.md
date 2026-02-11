# Client Knowledge System — Claude Code Build Brief

## Project Overview

Build an internal agency tool called **ClientBrain** (working name) — a centralised knowledge store for client brand, product, and business data that integrates into the tools the team already uses. The core philosophy is **"client knowledge wherever you need it"** — no new UI to learn, knowledge flows in and out via plugins, connectors, and APIs.

### Core Users
- Designers (Figma)
- Developers (Webflow, code editors)
- Growth marketers (analytics, reporting)
- Account managers (meetings, briefs)

### Tech Stack
- **Database:** Supabase (PostgreSQL with JSONB)
- **API:** Supabase auto-generated REST API + custom Edge Functions where needed
- **AI layer:** Claude API via MCP (Model Context Protocol) server
- **Plugins:** Webflow Designer Extension, Figma Plugin
- **Ingestors:** Typeform (via Zapier), Google Drive extraction script, meeting note webhooks
- **Analytics connectors:** GA4 Data API, PostHog API

---

## Working With Claude Code — Build Rules

This project is built quest-by-quest following the project roadmap. These rules govern how Claude Code should operate during the build.

### Pacing Rules

1. **One quest at a time.** Only build what the current quest requires. Do not start the next quest, pre-build future features, or scaffold things "while we're here." The human will tell you which quest to work on.
2. **Stop at the done condition.** Every quest has a "Done when" condition in the roadmap. When that condition is met, stop and tell the human what to test. Do not continue building.
3. **No unsolicited refactoring.** Do not restructure, reorganise, or "improve" previously built code unless the human explicitly asks or the current quest requires it. Refactoring happens during Level Boss Checks.
4. **Flag uncertainty immediately.** If you make an assumption, take a shortcut, or are unsure about an implementation choice, say so before moving on. Don't bury it.

### Session Structure

**At the start of each session, expect the human to provide:**
- Which quest they're working on
- The objective and done condition (from the roadmap)

**At the end of each quest, always provide:**
1. What was built (brief summary)
2. What the human should test to verify it works (specific steps)
3. Anything you're uncertain about or that was implemented with a trade-off
4. Whether anything from this quest affects the next quest

### Testing Checkpoints

Do not treat the human confirming something works as optional. After every quest:
- Wait for the human to test
- If they find issues, fix them before moving to the next quest
- If the human says "looks good, move on" — only then proceed to the next quest

### Code Quality Rules

- Write clean, readable code with clear comments on non-obvious decisions
- Use the shared `clientbrain-core` package for any logic that will be reused across the MCP server, Webflow extension, and Figma plugin
- Log every Claude API call to the `api_usage` table via the shared client wrapper
- Log every knowledge change to the `changelog` table with source attribution
- Never hardcode API keys, URLs, or secrets — use environment variables
- Include the conversion copywriting skill rules in every copy generation prompt — no exceptions

### Level Boss Checks

At the end of each Level (after all quests complete), the human will run through the Boss Check checklist. This is the time to:
- Address accumulated issues
- Refactor if needed
- Verify everything works together, not just individually
- Fix any shortcuts or assumptions that were flagged during quests

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  SUPABASE (PostgreSQL)            │
│                                                  │
│  clients / brand / products / visual / content   │
│  business / metrics / relationships / changelog  │
│                                                  │
└──────────────────────┬───────────────────────────┘
                       │
                       │ REST API + Edge Functions
                       │
        ┌──────────────┼──────────────────┐
        │              │                  │
   ┌────▼────┐   ┌─────▼─────┐   ┌───────▼───────┐
   │ OUTPUTS  │   │  INPUTS   │   │   AI LAYER    │
   │ (Pull)   │   │  (Push)   │   │               │
   ├──────────┤   ├───────────┤   │  MCP Server   │
   │ Webflow  │   │ Typeform  │   │  (Node.js)    │
   │ Designer │   │ + Zapier  │   │               │
   │ Extension│   ├───────────┤   │  Exposes:     │
   ├──────────┤   │ Google    │   │  - get_client │
   │ Figma    │   │ Drive     │   │  - get_brand  │
   │ Plugin   │   │ Extractor │   │  - get_product│
   ├──────────┤   ├───────────┤   │  - search     │
   │ Claude   │   │ Fireflies │   │  - update     │
   │ via MCP  │   │ / Fathom  │   │               │
   ├──────────┤   │ Webhooks  │   │  Used by:     │
   │ Slack    │   ├───────────┤   │  Claude Code  │
   │ Bot      │   │ GA4 /     │   │  Claude.ai    │
   │ (future) │   │ PostHog   │   │  WF Extension │
   └──────────┘   │ Cron jobs │   │  Figma Plugin │
                  └───────────┘   └───────────────┘
```

---

## Phase 1: Database Schema & API

### Supabase Tables

**Design principle:** Structure data relationally but include a `relationships` table that models entity connections graph-style, making future Neo4j migration straightforward if needed.

#### `clients`
```sql
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
```

#### `brand`
```sql
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
```

#### `visual_identity`
```sql
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
```

#### `products`
```sql
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
```

#### `audiences`
```sql
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
```

#### `content`
```sql
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
```

#### `business`
```sql
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
```

#### `metrics`
```sql
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
```

#### `relationships` (graph-ready)
```sql
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

CREATE INDEX idx_relationships_from ON relationships(from_entity_type, from_entity_id);
CREATE INDEX idx_relationships_to ON relationships(to_entity_type, to_entity_id);
CREATE INDEX idx_relationships_type ON relationships(relationship_type);
```

#### `changelog`
```sql
CREATE TABLE changelog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  source TEXT NOT NULL, -- 'meeting_notes', 'manual', 'typeform', 'drive_extraction', 'analytics_sync'
  summary TEXT NOT NULL,
  details JSONB, -- what changed, structured
  raw_input TEXT, -- original transcript/text that triggered the change
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### `project_bindings`
```sql
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
```

#### `api_usage`
```sql
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

CREATE INDEX idx_api_usage_client ON api_usage(client_id, created_at);
CREATE INDEX idx_api_usage_source ON api_usage(source, created_at);
```

**Logging:** Every Claude API call from every source (plugins, MCP server, extraction scripts, meeting note processing) must log to this table. The shared `clientbrain-core` Claude client wrapper handles this automatically — after every API response, it extracts token counts from the response and inserts a usage record.

**Dashboard display:** The client dashboard shows a usage summary:
- Total tokens / estimated cost this month (per client)
- Breakdown by source (plugin vs MCP vs extraction)
- Trend over last 3 months
- Total across all clients for agency-wide spend visibility
This table lets the MCP server and dashboard know which projects are connected to which clients, and prevents accidentally binding two projects to the same client record differently.

### Row Level Security

Enable RLS on all tables. For now, a simple API key-based approach is fine since this is internal-only. Set up a service role key for the MCP server and plugins.

```sql
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
-- Repeat for all tables
-- Policy: allow all operations for authenticated service role
CREATE POLICY "Service role full access" ON clients FOR ALL USING (true);
```

### Database Functions

Create Supabase Edge Functions for complex operations:

#### `get_client_context(client_slug TEXT)`
Returns a complete, LLM-ready JSON object for a client — brand, tone, products, audiences, content rules, recent metrics. This is the primary function the MCP server and plugins call.

```sql
CREATE OR REPLACE FUNCTION get_client_context(p_slug TEXT)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'client', c.*,
    'brand', b.*,
    'visual', v.*,
    'products', (SELECT jsonb_agg(p.*) FROM products p WHERE p.client_id = c.id AND p.status = 'active'),
    'audiences', (SELECT jsonb_agg(a.*) FROM audiences a WHERE a.client_id = c.id),
    'content', co.*,
    'business', bu.*,
    'metrics', m.kpis,
    'recent_changes', (
      SELECT jsonb_agg(ch.* ORDER BY ch.created_at DESC)
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
```

---

## Phase 2: MCP Server

### Overview
A Node.js MCP server that exposes the knowledge store as tools Claude can call. This is the primary AI integration layer.

### Setup

Use the `@modelcontextprotocol/sdk` package for the server implementation. The server should use the stdio transport for Claude Code integration and expose tools following the MCP tool definition schema. Refer to the MCP SDK documentation for the server initialisation pattern — the key requirement is that each tool has a clear name, description, input schema (JSON Schema), and handler function.

```
clientbrain-mcp/
├── package.json
├── src/
│   ├── index.ts          -- MCP server entry point
│   ├── tools/
│   │   ├── getClient.ts       -- get full client context
│   │   ├── getBrand.ts        -- get brand/tone specifically
│   │   ├── getProducts.ts     -- get product details
│   │   ├── getAudiences.ts    -- get audience data
│   │   ├── searchKnowledge.ts -- semantic search across all client data
│   │   ├── updateKnowledge.ts -- update specific fields
│   │   └── listClients.ts     -- list all active clients
│   ├── db.ts             -- Supabase client
│   └── utils.ts          -- shared utilities
├── tsconfig.json
└── README.md
```

### MCP Tools to Expose

#### `get_client_context`
- **Input:** `{ client: string }` (slug or name, fuzzy matched)
- **Output:** Full client context JSON (brand, tone, products, audiences, content rules, metrics)
- **Use case:** "Write homepage copy for Noan" → Claude calls this first

#### `get_brand_guidelines`
- **Input:** `{ client: string }`
- **Output:** Brand-specific data: tone of voice, dos/donts, personality, messaging frameworks
- **Use case:** When Claude needs tone guidance without full product context

#### `get_products`
- **Input:** `{ client: string, product?: string }`
- **Output:** All products or a specific product with features, pricing, benefit descriptions
- **Use case:** "What are Noan's pricing tiers?" or generating product-specific copy

#### `get_audiences`
- **Input:** `{ client: string, audience?: string }`
- **Output:** Audience data including pain points, goals, objections
- **Use case:** Writing persona-targeted copy

#### `search_knowledge`
- **Input:** `{ query: string, client?: string }`
- **Output:** Relevant knowledge entries across all or specific client data
- **Use case:** "What do we know about enterprise onboarding for Client A?"
- **Implementation:** Use Supabase full-text search initially. Upgrade to pgvector embeddings if search quality isn't sufficient.

#### `update_knowledge`
- **Input:** `{ client: string, table: string, field: string, value: any, source: string }`
- **Output:** Confirmation of update + changelog entry
- **Use case:** "Update Noan's primary colour to #2A4B7C" via Claude chat
- **Important:** Always log to changelog with source attribution

#### `list_clients`
- **Input:** `{ status?: string }`
- **Output:** List of clients with slugs and basic info
- **Use case:** "Which clients do we have?" or selecting a client in plugins

### MCP Server Configuration

The server should be configurable via environment variables:
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx
CLAUDE_API_KEY=xxx  # for any Claude-powered processing within the server
```

Register in Claude Code's MCP config (`~/.claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "clientbrain": {
      "command": "node",
      "args": ["/path/to/clientbrain-mcp/dist/index.js"]
    }
  }
}
```

---

## Phase 3: Input Connectors

### 3a. Typeform Onboarding Flow

**Purpose:** Capture initial client basics when onboarding a new client.

**Fields to collect:**
- Business name, website, industry
- Products/services (name, pricing, key features for each)
- Target audiences (who they sell to)
- Competitors (top 3)
- Brand personality (select from list + free text)
- Tone of voice description
- Existing brand guidelines (file upload)
- Goals for working with us

**Integration:** Typeform → Zapier → Supabase REST API
- Zapier webhook receives form submission
- Maps fields to the appropriate Supabase tables
- Creates client record, brand record, initial products, audiences
- Logs to changelog with source: 'typeform'

### 3b. Google Drive Knowledge Extraction

**Purpose:** Extract detailed brand knowledge from client documents (brand guidelines PDFs, pitch decks, product docs).

**Implementation:** Python script (not a live sync)

**Google Auth:** Use a Google Cloud service account with Drive API read access. The service account JSON key file is stored as an environment variable. The client shares their folder with the service account's email address — this avoids OAuth consent screens and works for a service-to-service flow. The same service account can be reused for GA4 access if the GA4 property grants it read permissions.

```
scripts/
├── drive_extractor.py
├── requirements.txt
└── prompts/
    └── extraction_prompt.txt
```

**Flow:**
1. Script authenticates with Google Drive API
2. Accepts a folder ID or shared folder URL
3. Downloads all supported files (PDF, DOCX, PPTX, Google Docs)
4. For PDFs: extracts text (falls back to OCR for image-heavy brand guidelines)
5. Sends extracted text to Claude API with a structured extraction prompt
6. Claude returns structured JSON matching our schema (brand, tone, colours, typography, products, etc.)
7. Script presents extracted data for human review (print to terminal or simple diff view)
8. On confirmation, writes to Supabase via API
9. Logs to changelog with source: 'drive_extraction'

**Extraction prompt should instruct Claude to:**
- Extract hex colour values wherever found
- Identify font family names and weights
- Pull out tone of voice guidelines verbatim where possible
- Structure products with names, descriptions, and pricing
- Identify target audiences and their characteristics
- Flag anything it's uncertain about with confidence scores

### 3c. Meeting Notes Webhook

**Purpose:** Automatically capture client-relevant updates from meetings.

**Supported tools:** Fireflies.ai, Fathom, Otter.ai (all have webhook/API support)

**Implementation:** Supabase Edge Function as webhook endpoint

**Flow:**
1. Meeting ends → note-taker sends webhook with transcript
2. Edge Function receives transcript
3. Sends to Claude API with prompt: "Extract any client-relevant updates from this meeting transcript. Identify which client this relates to. Categorise updates as: brand changes, product updates, strategy shifts, feedback, action items. Return structured JSON."
4. Claude returns structured updates with client identification
5. Edge Function writes updates to relevant tables
6. Logs to changelog with source: 'meeting_notes' and stores raw transcript

**Important:** Include the list of active client names/slugs in the prompt so Claude can correctly attribute updates to clients.

---

## Phase 4: Webflow Designer Extension

### Overview
A Designer Extension that lives as a side panel in the Webflow Designer. Enables designers/developers to generate client-aware copy and write it directly into page elements.

### Project Structure
```
clientbrain-webflow/
├── package.json
├── webflow.json          -- Webflow app manifest
├── src/
│   ├── index.tsx         -- Extension entry point (React)
│   ├── components/
│   │   ├── ClientSelector.tsx    -- Dropdown to select active client
│   │   ├── SingleGenerate.tsx    -- Single element copy generation
│   │   ├── PageScanner.tsx       -- Full page scan and brief builder
│   │   ├── SectionBrief.tsx      -- Per-section prompt/context input
│   │   ├── CopyReview.tsx        -- Review generated copy before applying
│   │   └── LoadingState.tsx      -- Progress indicator during generation
│   ├── hooks/
│   │   ├── useClientContext.ts   -- Fetch client data from API
│   │   ├── usePageStructure.ts   -- Scan page DOM for content blocks
│   │   └── useCopyGeneration.ts  -- Handle Claude API calls
│   ├── lib/
│   │   ├── api.ts               -- API client for ClientBrain
│   │   ├── webflow.ts           -- Webflow Designer API helpers
│   │   └── claude.ts            -- Claude API integration
│   └── types.ts
├── tsconfig.json
└── README.md
```

### Webflow Designer API Reference Notes

The extension interacts with the Webflow Designer via the Designer Extension APIs. Key capabilities needed:

- **Getting the selected element** and reading its type, classes, and text content
- **Traversing child elements** within a section to find all content elements
- **Reading class lists** on elements to identify Lumos utility classes (`u-section`, `u-heading`, etc.)
- **Setting text content** on elements (plain text for headings/paragraphs, HTML for rich text blocks)

Refer to the Webflow Designer Extension documentation at `developers.webflow.com` for the specific API methods. The Webflow CLI (`npm init @webflow/designer-extension`) scaffolds the project with the correct structure and API bindings.

### Content Block Detection (Lumos Class-Based)

Since all Webflow builds use Lumos (utility-class, component-based architecture), the extension detects page structure using existing Lumos classes. **No custom attributes required.** This means any existing Lumos-built site is immediately compatible with zero extra setup.

#### Section Detection
The plugin identifies sections by scanning for elements with the `u-section` class. Each `u-section` becomes a section in the brief wizard.

#### Content Element Detection
Within each section, the plugin identifies writable content elements by their Lumos utility classes:

| Lumos Class | Content Type | Claude Instruction |
|-------------|-------------|-------------------|
| `u-heading` | Heading (H1-H6) | Generate headline copy. Detect heading level from the HTML tag. |
| `u-paragraph` | Paragraph text | Generate body copy. |
| `u-text` | Generic text | Generate text content based on context. |
| `u-button` | Button/CTA | Generate short CTA text (typically 2-5 words). |
| `u-link` | Text link | Generate link text. |

**Detection logic:**
```
1. Find all elements with class `u-section`
2. For each section, traverse children recursively
3. Collect all elements matching content classes (u-heading, u-paragraph, u-text, u-button, u-link)
4. Record element type, heading level (if heading), current text content, and position in section
5. Group into ordered list per section
```

**Why this works:** The designer doesn't add any attributes or change their build process. The Lumos classes they already use for styling are sufficient to identify every writable element. All intent and context comes from the designer in the brief wizard step, not from the markup.

#### Section Labelling
Since `u-section` doesn't tell the plugin what the section is *for*, the plugin uses a combination of:
1. **Position on page** — "Section 1", "Section 2", etc.
2. **Content preview** — shows the first few words of existing text (if any) to help the designer recognise it
3. **Element composition** — "1 heading, 2 paragraphs, 1 button" gives structural hints
4. **Optional: section component class** — if the section has an additional class beyond `u-section` (e.g., `hero_component`, `features_grid`), display it as a label hint. But don't rely on it.

The designer confirms or labels each section in the brief wizard, which is fast because they built the page and know what each section is.

#### Handling Nested Components
Lumos builds often have components nested within sections (e.g., a features grid with repeating card components inside a section). The plugin should:
- Detect these as grouped content blocks within the section
- Present them in the brief as "3x card pattern: each with heading + paragraph + button"
- Generate copy for all instances at once, with Claude varying the content per card
- Allow the designer to specify whether the cards should cover different features, benefits, or use cases

### Knowledge Completeness Gate

**This is a hard requirement.** The plugin MUST NOT allow copy generation if the client's knowledge base is incomplete. Generating copy on incomplete data produces mediocre output that undermines the entire system's value.

**Required fields before generation is allowed:**
- `brand.tone_of_voice` — must have description and at least 2 examples
- `brand.mission` OR `brand.tagline` — at least one
- `brand.brand_personality` — at least 2 traits
- `products` — at least 1 active product with name, description, and benefit_led_description
- `audiences` — at least 1 audience with name, pain_points, and goals
- `business.model` — must be set
- `business.value_propositions` — at least 1
- `visual_identity.colours` — primary colour at minimum
- `visual_identity.typography` — heading and body font families

**Behaviour when incomplete:**
1. Plugin checks completeness immediately after loading client context
2. If incomplete, show a clear blocklist: "Cannot generate copy. Missing: tone of voice examples, target audience pain points, value propositions"
3. Each missing item links to the relevant section in the dashboard (or instructs the user to update via the LLM query box)
4. The "Scan Page" and "Generate" buttons are disabled until all required fields are populated
5. No workarounds, no "generate anyway" option

**Implementation:** Create a `validateClientCompleteness()` function in `clientbrain-core` that returns `{ complete: boolean, missing: string[] }`. Call it on client context load in both Webflow and Figma plugins.

### Project-to-Client Binding

Each Webflow project must be linked to a client knowledge base. This is a one-time setup per project.

**First open:** Plugin detects no client is bound to this project. Shows a client selector screen: "Which client is this project for?" with a searchable dropdown of all active clients from the API. On selection, the plugin stores the binding using Webflow's app data storage against the site ID.

**Subsequent opens:** Plugin reads the stored binding and auto-loads that client's context. The panel header shows "Connected: Noan" (or whichever client) with a "Change" link for switching.

**Storage method:** Use the Webflow Designer Extension's `webflow.setExtensionData()` or store as a `data-cb-client` attribute on the `<body>` element. The body attribute approach has the advantage of being visible in the Webflow Designer and transferable if the project is cloned.

**Edge cases:**
- If the bound client has been offboarded/deactivated, show a warning and prompt to rebind
- If the project is cloned for a new client, prompt to rebind on first open
- Support a "Disconnect" option so the project can be unlinked entirely

### UX Flows

#### Flow 1: Single Element Generation
1. Designer selects a text element in Webflow
2. Opens ClientBrain panel (client auto-loaded from project binding)
4. Types a prompt: "Write a hero headline about their AI knowledge management"
5. Extension calls ClientBrain API → gets client context → sends to Claude → returns copy
6. Shows copy preview in panel
7. Designer clicks "Apply" → copy writes to selected element

#### Flow 2: Full Page Generation (Primary Flow)
1. Designer has built the page layout using Lumos utility classes (standard build process, no extra steps)
2. Opens ClientBrain panel → clicks "Scan Page"
3. Extension traverses the DOM, finds all `u-section` elements, and within each collects content elements (`u-heading`, `u-paragraph`, `u-text`, `u-button`, `u-link`)
4. **Brief Builder (step-by-step wizard inside the plugin):**
   - Shows one section at a time
   - Section is labelled by position ("Section 1") with a content preview (existing text) and element composition ("1 heading, 2 paragraphs, 1 button")
   - Designer names/describes the section purpose: "Hero — lead with AI knowledge management, push free trial"
   - Designer can optionally add per-element notes for specific direction (e.g., "this heading should be the primary value prop")
   - For repeated patterns (e.g., 3 feature cards), designer can describe the pattern once: "3 cards covering speed, accuracy, and integrations benefits"
   - Navigation: Previous / Next / Skip to review
5. **Review Brief:**
   - Shows all sections with their descriptions, block counts, and any specific prompts
   - Completeness indicator: "12 sections — 10 briefed, 2 using defaults"
   - Designer can jump back to edit any section
6. **Generate:**
   - Designer clicks "Generate All"
   - Extension sends full page brief + full client context to Claude API in one call
   - Claude generates all copy at once (maintaining narrative coherence across sections)
   - Progress indicator shows generation status
7. **Review Copy:**
   - Shows generated copy organised by section
   - Each block shows: element type (heading/paragraph/button), generated text, character count
   - Inline editing — designer can modify any block directly
   - Per-section "Regenerate" button with a **feedback prompt field** — designer can type why they want it regenerated: "too long", "wrong tone", "focus more on enterprise angle", "less technical jargon". This feedback is sent to Claude alongside the original brief and all other finalised sections so the regeneration is targeted, not random.
   - "Regenerate All" if they want a completely fresh pass (also with optional feedback field)
   - **Copy version history** — the plugin stores previous generations per project in local storage (keyed by project binding + page URL). Designer can access "Previous versions" to see and restore earlier generations. Stores last 3 versions per page to avoid unbounded storage growth.
8. **Execute:**
   - Designer clicks "Apply to Page"
   - Extension writes all copy to Webflow elements in one pass
   - Confirmation: "47 content blocks updated across 12 sections"

### Element Type Handling

The extension must handle different Webflow element types appropriately:

| Element Type | Write Method | Format |
|-------------|-------------|--------|
| Heading (H1-H6) | Set text content | Plain text |
| Paragraph | Set text content | Plain text |
| Text Block | Set text content | Plain text |
| Text Link | Set text content | Plain text |
| Rich Text | Set HTML content | HTML with formatting |
| Button | Set text content | Plain text (short) |
| List Item | Set text content | Plain text |

**Detection:** Use the Webflow Designer API to check element type before writing. Format Claude's output accordingly.

### Conversion Copywriting Skill Integration

Every Claude API call that generates copy — whether single element or full page — MUST include the conversion copywriting skill rules in the system prompt. This includes:

- Benefit-led over feature-led principles
- Action/verb-led headlines as default
- Social proof patterns with specificity requirements
- SEO conventions (heading lengths, readability standards, keyword integration, meta copy rules)
- The copy quality checklist as validation criteria

**Implementation:** Store the skill rules as a constant in the shared `clientbrain-core` package (`prompts.ts`). Every copy generation call prepends these rules to the system prompt before client context and page brief. The rules are non-negotiable — they apply to every client regardless of their brand tone.

### Claude API Prompt Structure (Full Page Generation)

```
System: You are a conversion-focused copywriter. You write benefit-led, action-verb-led copy 
that converts. You follow SEO best practices for heading hierarchy and readability.

[Insert conversion-copywriting skill rules here]

User: Generate complete page copy for the following page structure.

## Client Context
{full client context from get_client_context()}

## Page Structure
For each section, I'll provide:
- The designer's description of what this section should communicate
- The content elements available (headings, paragraphs, buttons) with their types and hierarchy
- Any specific per-element notes from the designer
- For repeated patterns (e.g. feature cards), how many instances and what they should cover

{sections with designer briefs and element maps}

## Rules
- Generate copy for every content element listed
- Maintain narrative coherence across sections — hero sets up the story, each section builds on it, CTA closes it
- Match copy length to element type: headings should be concise (6-12 words), paragraphs can be fuller, buttons should be 2-5 words
- For repeated patterns (cards, list items), vary the language and angle across instances
- Use the client's tone of voice consistently
- Include SEO keywords naturally where relevant
- H1 must be 20-70 characters and contain the primary keyword
- Return as structured JSON matching the section/element IDs provided
```

**Expected response schema:** Claude must return JSON that the plugin can map back to DOM elements. The plugin assigns each detected element a unique ID during scanning (e.g., `section-0-heading-0`, `section-2-paragraph-1`) and includes these IDs in the prompt. Claude returns copy keyed to those same IDs. The exact schema shape should be determined during implementation, but the principle is: every element ID sent in gets a corresponding copy string back out.

### Error Handling Patterns

The plugins and MCP server must handle failures gracefully. Key scenarios to account for:

- **Claude API timeout or failure mid-generation:** Show clear error state in the plugin with a "Retry" button. Do not partially apply copy — it's all or nothing per generation.
- **Supabase connection failure:** Cache the last-loaded client context in the plugin's local storage so the designer isn't completely blocked. Show a warning that they're working with potentially stale data.
- **Element deleted between scan and apply:** During the apply step, if an element ID from the scan no longer exists on the page, skip it, apply everything else, and report which elements were skipped: "Applied 45 of 47 blocks — 2 elements no longer found on page."
- **Incomplete Claude response:** If Claude returns JSON missing some element IDs (possible on very large pages), flag the missing sections and offer to regenerate just those.
- **Rate limiting:** If hitting Claude API rate limits, queue requests and show progress rather than failing silently.

### API Integration

**Authentication between plugins and Supabase:** The plugins should NOT embed the Supabase service key directly — that's a security risk even for an internal tool. Instead, use a lightweight proxy approach: the plugins call Supabase Edge Functions which authenticate with the service key server-side. The Edge Functions validate requests using a simple API key or token that's stored in the plugin configuration. This keeps the service key out of client-side code while keeping the architecture simple. The Edge Functions act as the API gateway for all plugin requests.

The extension calls the ClientBrain API (Supabase Edge Functions) for client data, Claude API directly for copy generation (the Claude API key is stored in the plugin's backend/config, not exposed client-side).

```
Extension → Supabase Edge Functions (authenticated) → gets client context
Extension → Claude API (server-side or proxied) → sends context + page brief → gets copy
Extension → Webflow Designer API → writes copy to elements
```

---

## Phase 5: Figma Plugin

### Overview
Same concept as the Webflow extension but for Figma. Designers can generate client-aware copy and write it directly into text frames.

### Project Structure
```
clientbrain-figma/
├── package.json
├── manifest.json         -- Figma plugin manifest
├── src/
│   ├── code.ts           -- Plugin sandbox code (Figma API access)
│   ├── ui.tsx            -- Plugin UI (React, runs in iframe)
│   ├── components/       -- Same component pattern as Webflow
│   │   ├── ClientSelector.tsx
│   │   ├── SingleGenerate.tsx
│   │   ├── FrameScanner.tsx
│   │   ├── SectionBrief.tsx
│   │   ├── CopyReview.tsx
│   │   └── LoadingState.tsx
│   ├── lib/
│   │   ├── api.ts
│   │   └── claude.ts
│   └── types.ts
├── tsconfig.json
└── README.md
```

### Figma-Specific Considerations

**Project-to-client binding:** Same concept as Webflow. Use `figma.root.setPluginData('clientbrain_client_id', clientSlug)` to persist the binding at the file level. This survives file close/reopen and is specific to this plugin (other plugins can't read it). First open prompts client selection, subsequent opens auto-load. Show "Connected: Noan" in the plugin header with a "Change" link.

**Font loading:** Before writing text to a TextNode, must call `figma.loadFontAsync({ family: "...", style: "..." })` for the font applied to that node. Handle failures gracefully — if the font isn't available, show an error rather than crashing.

**Frame scanning:** Instead of DOM attributes, use Figma layer names or component names to identify content blocks. Convention: name layers with the same `cb-` prefix system:
- `cb-hero-headline`
- `cb-feature-title-1`
- `cb-cta-button`

Or use Figma's built-in component description field to store intent metadata.

**Text writing:** Set `node.characters` on TextNode. For styled text (bold, links), use `node.setRangeFont*()` methods.

**Plugin communication:** Figma plugins have a split architecture — the sandbox code (code.ts) accesses the Figma API, and the UI code (ui.tsx) runs in an iframe. They communicate via `postMessage`. All Figma API calls happen in code.ts, all UI rendering in ui.tsx.

### UX Flows

Mirror the Webflow extension flows exactly. The only differences are:
- Element detection uses Figma layer names instead of HTML attributes
- Font loading required before text writes
- Frame hierarchy instead of DOM hierarchy for section grouping

---

## Phase 6: Analytics Connectors

### GA4 Connector

**Purpose:** Pull key metrics periodically and store in the knowledge base.

**Implementation:** Supabase Edge Function on a cron schedule (daily).

**Metrics to pull:**
- Total sessions (last 30 days)
- Conversion rate (if goals configured)
- Top 10 pages by traffic
- Bounce rate
- Average session duration
- Traffic by source

**Flow:**
1. Cron triggers Edge Function
2. For each client with a `ga4_property_id`:
   - Authenticate with GA4 Data API (service account)
   - Pull defined metrics
   - Store in `metrics.snapshot_data`
   - Update `metrics.last_synced_at`

### PostHog Connector

**Purpose:** Pull product analytics and user behaviour data.

**Implementation:** Same pattern as GA4 — Supabase Edge Function on cron.

**Metrics to pull:**
- Active users (DAU/WAU/MAU)
- Key events/actions counts
- Funnel conversion rates (if configured)
- Feature flag statuses

---

## Phase 7: Client Dashboard (Minimal UI)

### Purpose
A simple read-only verification page per client. Not an editing interface — just a visual confirmation that knowledge is complete and accurate.

### Implementation
Single Next.js page (or even a static HTML page generated from the database). One URL per client: `/dashboard/{client-slug}`

### What It Shows
- Client name and status
- **Colour swatches** rendered as actual coloured blocks (hex values displayed)
- **Typography samples** rendered in the actual font families with weight examples
- **Products** listed with pricing
- **Tone of voice** description with example snippets
- **Audiences** with pain points
- **Completeness indicator**: which knowledge areas are populated vs empty
- **Recent changelog**: last 10 updates with source attribution
- **Link to Supabase Studio** for direct editing if needed

### LLM Query Box
An input field on the dashboard that connects to Claude via the MCP server with client context pre-loaded. Natural language interface for viewing and updating knowledge.

Examples:
- "Show me Noan's brand colours"
- "Update their tagline to 'Your company brain, reimagined'"
- "Add a new product: Studio Lite, £99/month, features: basic recording, 25GB storage"
- "What tone of voice do we use for their enterprise audience?"

---

## Shared Component Library

The Webflow extension and Figma plugin share the same core logic. Extract shared code into a package:

```
packages/
├── clientbrain-core/
│   ├── src/
│   │   ├── api.ts          -- Supabase client wrapper
│   │   ├── claude.ts       -- Claude API integration
│   │   ├── types.ts        -- Shared TypeScript types
│   │   ├── prompts.ts      -- Prompt templates for copy generation
│   │   └── pageContext.ts  -- Page brief builder logic
│   └── package.json
├── clientbrain-webflow/    -- Webflow-specific code
├── clientbrain-figma/      -- Figma-specific code
└── clientbrain-mcp/        -- MCP server
```

---

## Key Design Decisions

1. **Supabase over custom backend:** Auto-generated REST API, built-in auth, Edge Functions, real-time subscriptions. Eliminates the need to build and host a separate API server.

2. **Separate Claude API calls in plugins vs MCP for Claude Code:** The plugins call Claude directly because they need to control the prompt structure (page briefs, attribute context). The MCP server is for conversational Claude interactions where Claude decides what to query.

3. **Graph-ready relationships table:** Even in Postgres, entity relationships are stored explicitly. This makes Neo4j migration a structured data migration rather than a conceptual remodel.

4. **Changelog everything:** Every change to client knowledge is logged with source attribution. This creates an audit trail and lets the team understand where knowledge came from.

5. **Lumos class detection over custom attributes:** Content elements are identified using existing Lumos utility classes (`u-section`, `u-heading`, `u-paragraph`, etc.) rather than requiring custom `data-*` attributes. This means zero extra build steps for designers, retroactive compatibility with any existing Lumos-built site, and all intent/context lives in the brief wizard rather than the markup. The plugin reads structure from classes, purpose from the designer's brief.

6. **Full page generation in one Claude call:** Generates all page copy at once for narrative coherence rather than section-by-section, which would risk repetition and disconnected messaging.

---

## Environment Variables

```
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=

# Claude
ANTHROPIC_API_KEY=

# Google (for Drive extraction and GA4)
GOOGLE_SERVICE_ACCOUNT_JSON=

# PostHog
POSTHOG_API_KEY=
POSTHOG_HOST=

# Meeting Notes (webhook secrets)
FIREFLIES_WEBHOOK_SECRET=
FATHOM_WEBHOOK_SECRET=
```

---

## Testing Strategy

### Phase 1 Validation
- Populate one real client (e.g., Noan) with complete knowledge
- Query via Supabase API — verify `get_client_context()` returns complete, well-structured data
- Verify changelog captures all inserts

### Phase 2 Validation
- Connect MCP server to Claude Code
- Test: "Write homepage hero copy for Noan" — does Claude call the MCP tools and use client context?
- Test: "What's Noan's tone of voice?" — does it return accurate data?
- Test: "Update Noan's tagline to X" — does it update and log?

### Phase 3 Validation
- Submit test Typeform → verify data appears in Supabase correctly
- Run Drive extractor on a real client's brand guidelines PDF → review extraction quality
- Simulate meeting notes webhook → verify client attribution and structured extraction

### Phase 4 Validation
- Build a test Webflow page using standard Lumos classes (`u-section`, `u-heading`, `u-paragraph`, `u-button`)
- Scan page → verify all sections detected and content elements correctly identified within each
- Verify repeated patterns (e.g., 3 feature cards with identical class structures) are detected and grouped
- Brief one section → generate → verify quality and client-awareness
- Brief full page → generate all → verify narrative coherence and no repetition across sections
- Apply to page → verify all elements updated correctly with right formatting per element type

### Phase 5 Validation
- Same test flow as Webflow but in Figma
- Additional: verify font loading works for various font families

---

## Future Considerations (Not in Scope Now)

- **Template briefs:** Save reusable page brief templates (e.g., "SaaS Homepage Brief", "Pricing Page Brief", "Landing Page Brief") that can be loaded in the plugin wizard and applied to any client. Designers brief a page type once, reuse across clients. High value, add after MVP validation.
- **Figma content detection convention:** Define a standardised layer naming convention for Figma (mirroring the Lumos class approach for Webflow) once the Figma plugin moves into active development. For MVP, the Figma workflow is design → dev (Webflow) → content (via Webflow plugin).
- **Multi-agency support:** Auth, team management, client isolation. Only needed if this becomes a product.
- **Neo4j migration:** The relationships table and entity typing make this possible when needed.
- **Slack bot:** Query client knowledge from Slack. Low effort once MCP server exists.
- **Version control for knowledge:** Branching client knowledge for A/B testing messaging.
- **Webflow CMS integration:** Auto-populate CMS collection items, not just static page content.
- **Real-time collaboration:** Multiple designers generating copy on the same page simultaneously.
