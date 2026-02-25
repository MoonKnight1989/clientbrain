# ClientBrain — Project Roadmap

## How This Works

The build is broken into **7 Levels** (0-6), each with **daily quests** designed as morning or evening sessions (1.5-3 hours each). Every quest has a clear deliverable so you know when it's done. Complete all quests in a level to unlock the next.

**Time estimate:** 6-8 weeks at 2-3 hours per day.

**Rule:** Don't skip ahead. Each level validates assumptions the next level depends on.

### Pre-existing Work
The Slack analytics bot (`apps/analytics-bot/`) was built before the roadmap started. It established:
- The Supabase project with `clients` table (8 clients populated with id, name, slug, status)
- `metrics` table with `ga4_bq_dataset` and `search_console_url` columns
- Daily BQ → Supabase analytics sync (GA4, GSC, attribution data) — being migrated to direct GA4/GSC API calls in Quest 0.5
- Slack bot infrastructure (bot token, interactivity handler, Block Kit patterns)
- The full clientBrain schema (brand, products, audiences, etc.) still needs to be deployed on top of this

The meeting actions app (`apps/meeting-actions/`) is the first item on the roadmap (Level 0). It only depends on the `clients` table, which already exists. See `docs/meeting-actions-integration.md` for full details.

---

## LEVEL 0: Meeting Actions Pipeline
**Duration:** 5-6 sessions
**Unlock condition:** You share a Granola note after a client meeting and agency tasks appear in the correct Asana project within seconds. You can create a new client from Slack and it cascades across all systems.
**App locations:** `apps/meeting-actions/`, `apps/client-manager/`

> **Why this is first:** It only depends on the `clients` table (already exists), delivers immediate agency value, and is fully self-contained. Every meeting that passes without this tool is potential tasks slipping through the cracks.

### Quest 0.1 — Meeting Notes Schema + Granola → Supabase Pipeline
**Session:** Morning
**Objective:** Create the Supabase tables (`meeting_notes`, `meeting_tasks`, `client_domains`), build a Cloud Function that receives a webhook from Zapier (triggered by Granola's "Note Shared to Zapier" instant trigger), fetches the full note from the Granola API (summary + transcript + attendees), matches to a client via attendee email domain lookup, and stores the note in Supabase.
**Architecture:**
```
Meeting ends → share note to Zapier from Granola sidebar
        ↓ Zapier instant trigger
  Cloud Function: processGranolaMeeting
        ↓ GET /v1/notes/{id}?include=transcript (Granola API)
        ↓ filter out @massive-marketing.co.uk attendees
        ↓ look up remaining domains in client_domains table
        ↓ store in meeting_notes (linked to client_id)
```
**Tables created:**
- `client_domains` — maps email domains to client IDs (e.g. `noan.com` → NOAN's UUID)
- `meeting_notes` — stores note content linked to `client_id`, with Granola note ID, title, attendees, summary markdown, transcript, calendar event data
- `meeting_tasks` — stores extracted tasks (populated in Quest 0.3)

**Deliverable:** Sharing a Granola note triggers the pipeline and the note appears in Supabase linked to the correct client.
**Done when:** You share a real meeting note from Granola, and it appears in the `meeting_notes` table with the correct `client_id` resolved via domain matching.

### Quest 0.2 — Slack Fallback for Unmatched Meetings
**Session:** Evening
**Objective:** When domain matching fails (personal emails, new clients, internal-only meetings), post a message to a designated Slack channel with client selection buttons. Handle the button response via an interactivity endpoint and continue the pipeline. Provide a "Not a client meeting" option that stores the note but skips task extraction.
**Flow:**
```
Domain match fails
        ↓
  Post to Slack (#meeting-actions channel):
  "New meeting: 'Q2 Planning Call'
   Attendees: joe@gmail.com, sarah@massive-marketing.co.uk
   Which client is this for?"
   [NOAN] [Atlas HPS] [Mercer Labs] [...] [Not a client meeting]
        ↓
  User taps button → interactivity handler picks up selection
        ↓
  Updates meeting_notes with client_id → continues to task extraction
```
**Deliverable:** Unmatched meetings get a Slack prompt, and the pipeline continues after human selection.
**Done when:** You share a Granola note where the only non-agency attendee uses a personal email. A Slack message appears with client buttons. Tapping a client button stores the note with the correct `client_id`. Tapping "Not a client meeting" stores the note with `client_id: null` and skips task extraction.

### Quest 0.3 — Task Extraction + Asana Integration
**Session:** Morning
**Objective:** Once a meeting note is stored with a client, send the summary and transcript to Claude to extract a list of actionable tasks. Each task starts with a verb. Claude classifies each as `agency` or `client`. Agency tasks are created in Asana in the matching client project with: task name, due date (explicit from notes or +7 days from today), and a 3-5 sentence description providing context from the meeting notes. All tasks (agency and client) are stored in `meeting_tasks`. A Slack confirmation message summarises what was created.
**Asana project mapping:** Match `clients.name` to existing Asana projects in the Massive Marketing Team workspace. Projects already exist for all active clients (NOAN, Atlas HPS, Mercer Labs, Sonas Systems, GrowthEx, Sonder Tattoo, Upflex, House Of Impact, Nomono, Spring Media, etc.).
**Deliverable:** End-to-end flow from Granola → Supabase → Claude → Asana, with Slack confirmation.
**Done when:** You share a Granola note from a real client meeting. Agency tasks appear in the correct Asana project within seconds, each with a verb-led name, due date, and contextual description. A Slack message confirms: "Created 3 agency tasks in NOAN, 2 client tasks logged."

### Quest 0.4 — Client Creation via Slack
**Session:** Evening
**App location:** `apps/client-manager/`
**Objective:** Build a `/client create` slash command that opens a Slack modal for creating a new client. Same UX pattern as `/analytics setup` — modal with input fields, submit, confirmation of what was created. On submission, the system cascades across all relevant systems.
**Modal fields:**
- Client name (text input)
- Slug (text input, auto-suggested from name)
- Primary email domain (text input, e.g. `noan.com`)
- Website URL (text input, optional)
- Status (dropdown: active, onboarding, paused)

**On submit, cascade:**
1. Create `clients` row in Supabase (name, slug, status, website URL)
2. Create Asana project in Massive Marketing Team workspace (if one doesn't already exist with that name)
3. Add `client_domains` entry mapping the email domain to the new client UUID
4. Post Slack confirmation: "Client created: NOAN — Supabase record, Asana project, domain mapping (noan.com) all set up."

**Deliverable:** One slash command creates a client across all core systems.
**Done when:** You run `/client create`, fill in the modal, submit, and verify: client appears in Supabase, Asana project exists, `client_domains` has the mapping, and Slack confirms everything.

### Quest 0.5 — Analytics Onboarding (Direct API)
**Session:** Morning
**Objective:** Build an optional analytics setup step and rewrite the daily sync to use the GA4 Data API and Search Console API directly, cutting BigQuery from the active pipeline. Currently the sync reads from BQ rollup tables via hardcoded `UNION ALL` queries — one block per client that must be manually edited. The new approach: store each client's GA4 property ID and Search Console URL in Supabase, and the sync function loops over configured clients calling Google's APIs directly. No BQ queries to maintain. BQ exports continue running passively as a raw data warehouse.
**Flow:**
```
/client analytics — opens modal:
  - Select client (dropdown of clients without analytics configured)
  - GA4 Property ID (text input, e.g. "properties/13073005118")
  - Primary conversion event (text input, e.g. "purchase")
  - Secondary conversion event (text input, e.g. "add_to_cart")
  - Search Console URL (text input, optional)
        ↓ on submit
  Store in metrics table (ga4_property_id, primary_conversion_event,
    secondary_conversion_event, search_console_url)
        ↓
  Slack confirmation: "Analytics configured for NOAN.
   Next daily sync will include their data."
```
**Column additions to `metrics` table:**
- `ga4_property_id TEXT` — GA4 property ID for Data API calls
- `primary_conversion_event TEXT` — e.g. "purchase", "generate_lead"
- `secondary_conversion_event TEXT` — e.g. "add_to_cart", "contact_form_submit"

**Sync function rewrite (`apps/analytics-bot/sync/`):**
- Replace BQ dependency with GA4 Data API (`@google-analytics/data`) and Search Console API
- Single generic function that reads client config from Supabase, loops over each configured client
- Pulls daily metrics: sessions, active users, new users, engaged sessions, engagement rate, primary/secondary conversions
- Pulls attribution data: sessions + conversions by source/medium/campaign
- Pulls GSC data: impressions, clicks, CTR, avg position
- Upserts to existing Supabase tables (same schema, new data source)

**Deliverable:** Adding a new client to analytics is a Slack modal — no SQL editing, no BQ queries, just a property ID and event names.
**Done when:** You run `/client analytics`, configure a client, and the next daily sync pulls their GA4 and GSC data directly from Google's APIs into Supabase. Existing analytics bot reports work unchanged.

### Quest 0.6 — Conversion Reporting in Analytics Bot
**Session:** Evening
**Objective:** Update the analytics bot's Slack reporting to include conversion data and funnel analysis. The sync function (Quest 0.5) now pulls conversion counts and attribution-level conversions. This quest wires that data into the Claude prompt and Slack reports so the team can see conversion performance alongside traffic metrics.
**Schema additions to `analytics_ga4_daily`:**
- `primary_conversions INTEGER`
- `secondary_conversions INTEGER`

**Attribution table:** No schema change — conversion events are included as additional `event_name` rows alongside `session_start`, using the existing `sessions` (event count) and `users` (unique users) columns.

**Claude prompt updates:**
- Add "Conversions" section to report format with primary/secondary conversion counts and % change
- Add funnel analysis: sessions → conversions = conversion rate (CR), week-over-week CR change
- Add attribution + conversions: "Google Organic: 500 sessions, 12 conversions (2.4% CR)"
- Traffic light rules extended: CR improving = 🟢, flat = 🟡, declining = 🔴

**Deliverable:** Analytics reports now include conversion data and meaningful funnel analysis.
**Done when:** You run `/analytics report` for a client with conversion events configured and the report includes: conversion counts with trends, conversion rate as a funnel metric, and top sources ranked by conversions with CR per source.

### 🏆 Level 0 Boss Check

**Meeting Actions (`apps/meeting-actions/`)**
- [ ] Granola → Zapier → Cloud Function pipeline triggers instantly on note share
- [ ] Domain matching correctly identifies clients from attendee emails
- [ ] Unmatched meetings trigger Slack fallback with client selection buttons
- [ ] "Not a client meeting" option stores note but skips task extraction
- [ ] Claude extracts verb-led tasks and correctly classifies agency vs client
- [ ] Agency tasks created in correct Asana project with name, due date, and description
- [ ] All tasks stored in `meeting_tasks` table for audit trail
- [ ] Slack confirmation message summarises what was created

**Client Manager (`apps/client-manager/`)**
- [ ] `/client create` opens modal, creates client across Supabase + Asana + client_domains
- [ ] Slack confirmation shows everything that was set up
- [ ] `/client analytics` configures GA4/GSC with conversion events — no BQ editing
- [ ] `client_domains` table populated for all active clients

**Analytics (updated `apps/analytics-bot/`)**
- [ ] Sync function uses GA4 Data API + Search Console API directly (no BQ dependency)
- [ ] Daily sync pulls traffic, conversions, attribution, and GSC data for all configured clients
- [ ] Conversion counts appear in `analytics_ga4_daily`
- [ ] Conversion events appear in `analytics_attribution_daily` by source/medium
- [ ] Analytics bot reports include conversion counts, conversion rates, and funnel analysis
- [ ] BQ exports still running passively as raw data warehouse

---

## LEVEL 1: The Foundation
**Duration:** Week 1 (5-7 quests)
**Unlock condition:** You can ask Claude "Write homepage copy for [client]" in Claude Code and it pulls real client data.

### Quest 1.1 — Set Up Supabase
**Session:** Morning
**Objective:** Create the Supabase project and deploy the full database schema.
**Deliverable:** All tables created (`clients`, `brand`, `visual_identity`, `products`, `audiences`, `content`, `business`, `metrics`, `relationships`, `changelog`, `project_bindings`, `api_usage`). RLS enabled. You can view empty tables in Supabase Studio.
**Done when:** You can insert a test row into `clients` via Supabase Studio and see it.

### Quest 1.2 — Populate Your First Client
**Session:** Evening
**Objective:** Manually populate one real client's full knowledge base. Use a client you know inside out (Noan or Massive Marketing itself).
**Deliverable:** Complete data across all tables for one client — brand, tone of voice with examples, products with pricing and benefit descriptions, at least one audience with pain points, business model, value propositions, visual identity with hex colours and font families.
**Done when:** Running `get_client_context('your-client-slug')` in Supabase SQL editor returns a complete, rich JSON object.

### Quest 1.3 — Build the MCP Server (Core)
**Session:** Morning
**Objective:** Scaffold the MCP server project and implement `list_clients` and `get_client_context` tools.
**Deliverable:** A working MCP server that Claude Code can connect to. Two tools functional.
**Done when:** You can type "What clients do we have?" in Claude Code and it returns your client from the database.

### Quest 1.4 — Expand MCP Tools
**Session:** Evening
**Objective:** Add `get_brand_guidelines`, `get_products`, `get_audiences`, and `search_knowledge` tools.
**Deliverable:** All read tools working.
**Done when:** You can ask Claude Code "What's Noan's tone of voice?" or "What products does Noan sell?" and get accurate answers from the database.

### Quest 1.5 — MCP Write Tools + Changelog
**Session:** Morning
**Objective:** Add `update_knowledge` tool. Every update logs to the `changelog` table with source attribution.
**Deliverable:** Claude can read AND write to the knowledge base.
**Done when:** You can say "Update Noan's tagline to 'Your company brain'" in Claude Code, it updates the database, and a changelog entry appears with source: 'mcp_server'.

### Quest 1.6 — Copy Generation Test
**Session:** Evening
**Objective:** Test the full loop — ask Claude to write copy using client knowledge. Include the conversion copywriting skill rules in the system context.
**Deliverable:** Claude generates client-aware, conversion-optimised copy that follows your skill rules.
**Done when:** You ask "Write a homepage hero section for Noan" and the output uses their actual tone, references real products, follows benefit-led and SEO conventions, and feels like it was written by someone who knows the client.

### Quest 1.7 — Completeness Validator
**Session:** Morning
**Objective:** Build `validateClientCompleteness()` in a shared utilities module. Test it against your populated client and an intentionally incomplete test client.
**Deliverable:** Function that returns `{ complete: boolean, missing: string[] }`.
**Done when:** Complete client passes, incomplete client fails with a clear list of what's missing.

### 🏆 Level 1 Boss Check
- [ ] Supabase schema deployed with all tables
- [ ] One real client fully populated
- [ ] MCP server connected to Claude Code with all tools working
- [ ] Claude generates quality copy using real client data
- [ ] Completeness validator working
- [ ] Every database write creates a changelog entry

---

## LEVEL 2: Input Pipelines
**Duration:** Week 2 (4-5 quests)
**Unlock condition:** A new client can go from zero to fully populated knowledge base without you touching Supabase Studio.

### Quest 2.1 — Typeform Onboarding Flow
**Session:** Morning + Evening (bigger quest)
**Objective:** Build the Typeform, set up Zapier integration to write responses to Supabase.
**Deliverable:** A complete onboarding form that creates a client record and populates initial data across brand, products, audiences, and business tables.
**Done when:** You fill in the Typeform as a fake client and all data appears correctly in Supabase.

### Quest 2.2 — Google Drive Extraction Script
**Session:** Morning
**Objective:** Build the Python script that authenticates with Google Drive, downloads files from a shared folder, and extracts text.
**Deliverable:** Script that takes a folder ID, downloads docs/PDFs, and outputs extracted text.
**Done when:** You point it at a real client's brand guidelines folder and it pulls the raw text content.

### Quest 2.3 — Claude-Powered Knowledge Extraction
**Session:** Evening
**Objective:** Add the Claude processing step to the Drive script. Send extracted text to Claude with the structured extraction prompt. Parse response and write to Supabase.
**Deliverable:** End-to-end extraction pipeline with human review step.
**Done when:** You run the script on a client's Drive folder, Claude extracts structured knowledge, you review it in the terminal, confirm, and it appears in Supabase.

### Quest 2.4 — Meeting Notes → Knowledge Base
**Session:** Morning
**Objective:** Extend the meeting actions pipeline (Level 0) to also update the client knowledge base. When a meeting note is processed, Claude extracts not just tasks but also knowledge updates — new product details, brand direction changes, audience insights, etc. — and writes them to the appropriate clientBrain tables with changelog entries (source: `meeting-actions`). This reuses the `meeting_notes` table from Level 0 rather than building a separate webhook.
**Deliverable:** Meeting notes automatically enrich the client knowledge base alongside creating tasks.
**Done when:** You share a Granola note that mentions a new product feature. The feature appears in the client's knowledge base, a changelog entry is created with source attribution, and the existing task extraction from Level 0 still works alongside it.

### Quest 2.5 — Second Client End-to-End
**Session:** Evening
**Objective:** Onboard a second real client using the tools you've built — Typeform for basics, Drive extraction for depth. No manual Supabase edits.
**Deliverable:** A second fully populated client in the knowledge base.
**Done when:** `validateClientCompleteness()` passes for the second client AND Claude generates quality copy for them via the MCP server.

### 🏆 Level 2 Boss Check
- [ ] Typeform → Supabase pipeline working
- [ ] Google Drive extraction with Claude processing working
- [ ] Meeting notes feed into knowledge base with changelog entries (builds on Level 0 pipeline)
- [ ] Two real clients fully populated
- [ ] Both clients pass completeness validation
- [ ] Claude generates distinct, accurate copy for each client

---

## LEVEL 3: The Webflow Plugin (Core)
**Duration:** Week 3-4 (7-8 quests)
**Unlock condition:** You can scan a Webflow page, brief it section by section, and apply generated copy — full flow working.

### Quest 3.1 — Scaffold the Extension
**Session:** Morning
**Objective:** Use the Webflow CLI to scaffold a Designer Extension project. Get it running locally and appearing in the Webflow Designer.
**Deliverable:** A "Hello World" extension panel visible in the Webflow Designer.
**Done when:** You open a Webflow project, see the ClientBrain panel, and it displays something.

### Quest 3.2 — Client Binding
**Session:** Evening
**Objective:** Build the client selector screen. On first open, show a dropdown of clients from the API. On selection, persist the binding. On subsequent opens, auto-load the bound client.
**Deliverable:** Client binding working with persistence.
**Done when:** You select a client, close and reopen the plugin, and it remembers which client is bound. "Connected: Noan" shows in the header.

### Quest 3.3 — Completeness Gate in Plugin
**Session:** Morning
**Objective:** After loading client context, run `validateClientCompleteness()`. If incomplete, block generation and show what's missing.
**Deliverable:** Incomplete clients are blocked with a clear missing-fields list.
**Done when:** An intentionally incomplete client shows the blocklist, a complete client shows the normal interface.

### Quest 3.4 — Single Element Generation
**Session:** Evening
**Objective:** Build the single-element flow: select a text element, type a prompt, generate copy using client context + conversion skill rules, preview, apply.
**Deliverable:** Working single-element copy generation.
**Done when:** You select a heading in Webflow, type "primary value proposition," and client-aware, benefit-led copy appears in the element.

### Quest 3.5 — Page Scanner
**Session:** Morning
**Objective:** Build the page scanning logic. Traverse the DOM, find `u-section` elements, collect content elements within each by Lumos classes. Build the section map data structure.
**Deliverable:** Scan button that produces a structured map of the page.
**Done when:** You scan a real Webflow page and the plugin correctly identifies all sections and their content elements (headings, paragraphs, buttons).

### Quest 3.6 — Brief Wizard
**Session:** Evening
**Objective:** Build the step-by-step section briefing UI. One section per step, showing element composition, with prompt fields for section-level and element-level context.
**Deliverable:** Complete brief wizard that produces a structured brief object.
**Done when:** You can step through a scanned page, add context to each section, and see a review summary of the full brief.

### Quest 3.7 — Full Page Generation
**Session:** Morning + Evening (bigger quest)
**Objective:** Wire up the brief to Claude API. Send the full page brief + client context + conversion skill rules in one call. Parse the structured response. Display generated copy in the review panel organised by section.
**Deliverable:** Full page copy generated from a brief, displayed for review.
**Done when:** You brief a homepage and Claude returns coherent, conversion-optimised copy for every content element across all sections.

### Quest 3.8 — Review, Edit, Apply
**Session:** Morning
**Objective:** Build the review panel with inline editing, per-section regeneration with feedback prompt, and the "Apply to Page" execution step. Add copy version history (last 3 per page).
**Deliverable:** Complete end-to-end plugin flow working.
**Done when:** You can review generated copy, tweak a headline inline, regenerate a section with feedback ("too long"), apply everything to the page, and retrieve a previous version.

### 🏆 Level 3 Boss Check
- [ ] Extension installs and runs in Webflow Designer
- [ ] Client binding persists across sessions
- [ ] Completeness gate blocks incomplete clients
- [ ] Single element generation working with client context
- [ ] Page scanner correctly identifies Lumos sections and elements
- [ ] Brief wizard flows smoothly with section and element prompts
- [ ] Full page generation produces coherent, conversion-optimised copy
- [ ] Review panel supports inline editing and regeneration with feedback
- [ ] Apply writes to all Webflow elements correctly
- [ ] Copy version history stores and retrieves previous generations

---

## LEVEL 4: Token Tracking & Dashboard
**Duration:** Week 4-5 (3-4 quests)
**Unlock condition:** You can see per-client API spend and verify client knowledge visually.

### Quest 4.1 — Token Usage Logging
**Session:** Morning
**Objective:** Wrap the Claude API client in the shared core package so every call automatically logs to `api_usage`. Include source, operation type, token counts, and estimated cost.
**Deliverable:** Every Claude call from every source is logged.
**Done when:** You generate copy via the Webflow plugin and a corresponding usage record appears in Supabase with accurate token counts.

### Quest 4.2 — Client Dashboard (Read-Only)
**Session:** Evening
**Objective:** Build a minimal Next.js page (or static page) per client showing: colour swatches rendered visually, typography samples, products with pricing, tone of voice, audiences, and completeness indicator.
**Deliverable:** A URL per client that visually renders their knowledge.
**Done when:** You open `/dashboard/noan` and can visually verify their brand colours, fonts, products, and tone are correct.

### Quest 4.3 — Usage Dashboard
**Session:** Morning
**Objective:** Add token usage and cost tracking to the dashboard. Per-client monthly spend, breakdown by source, agency-wide total.
**Deliverable:** Usage data visible on the dashboard.
**Done when:** You can see how many tokens each client has consumed this month and the estimated cost.

### Quest 4.4 — LLM Query Box
**Session:** Evening
**Objective:** Add a chat input on the dashboard that connects to Claude via the MCP server with client context pre-loaded. Natural language interface for viewing and updating knowledge.
**Deliverable:** Working query box for knowledge management.
**Done when:** You can type "Add a new product called X" in the dashboard and it updates the database, or ask "What's their primary audience?" and get an accurate answer.

### 🏆 Level 4 Boss Check
- [ ] All Claude API calls logged with token counts and costs
- [ ] Client dashboard renders visual brand elements correctly
- [ ] Usage tracking shows per-client and agency-wide spend
- [ ] LLM query box reads and writes knowledge

---

## LEVEL 5: Analytics Connectors
**Duration:** Week 5-6 (2-3 quests)
**Unlock condition:** Client metrics auto-update and Claude can reference real data in generated copy.

> **Note:** The analytics sync was originally built as a BQ → Supabase pipeline (pre-roadmap). Level 0 Quests 0.5-0.6 migrate this to direct GA4/GSC API calls, eliminating BQ from the active pipeline and adding conversion tracking. After Level 0, the analytics tables are populated via API with conversion data included.
>
> The remaining quests in this level focus on PostHog and wiring metrics into copy generation.

### Quest 5.1 — GA4 + Search Console Connector ✅
**Status:** Complete — originally built as BQ sync (pre-roadmap), migrated to direct API calls in Quest 0.5 with conversion tracking added in Quest 0.6.
**What exists:** Cloud Function `syncAnalyticsToSupabase` runs daily at 7 AM UK via Cloud Scheduler. Calls GA4 Data API and Search Console API directly for each configured client. Upserts to Supabase `analytics_ga4_daily` (including conversion counts), `analytics_gsc_daily`, and `analytics_attribution_daily` (including conversion events by source). BQ exports run passively as a raw data warehouse.

### Quest 5.2 — PostHog Connector
**Session:** Morning
**Objective:** Same pattern as GA4 but for PostHog API. Pull active users, key events, and funnel data.
**Deliverable:** Cron-triggered function that syncs PostHog data.
**Done when:** PostHog metrics appear in the database for a connected client.

### Quest 5.3 — Metrics in Copy Generation
**Session:** Evening
**Objective:** Verify that the MCP server and Webflow plugin include metrics data in the client context sent to Claude. Test that Claude naturally references real numbers in generated copy. Analytics data is already in Supabase — this quest is about wiring it into the copy generation context.
**Deliverable:** Copy that uses real data points.
**Done when:** Claude writes something like "Join 2,400+ teams" using an actual metric from the database rather than making up a number.

### 🏆 Level 5 Boss Check
- [x] GA4 + Search Console data syncing on schedule (migrated to direct API in Quest 0.5)
- [ ] PostHog data syncing on schedule
- [ ] Metrics visible on client dashboard
- [ ] Claude references real metrics in generated copy
- [ ] Usage costs for analytics sync are being tracked

---

## LEVEL 6: Figma Plugin
**Duration:** Week 6-7 (4-5 quests)
**Unlock condition:** Designers can generate client-aware copy directly in Figma.

### Quest 6.1 — Scaffold the Plugin
**Session:** Morning
**Objective:** Set up the Figma plugin project. Get a basic UI panel appearing in Figma.
**Deliverable:** "Hello World" Figma plugin running locally.
**Done when:** You open Figma, run the plugin, and see the ClientBrain panel.

### Quest 6.2 — Client Binding + Completeness Gate
**Session:** Evening
**Objective:** Implement client selection with `figma.root.setPluginData()` persistence and the completeness gate. Reuse shared core logic from the Webflow plugin.
**Deliverable:** Client binding and validation working in Figma.
**Done when:** Client persists across plugin opens and incomplete clients are blocked.

### Quest 6.3 — Single Element Generation
**Session:** Morning
**Objective:** Build single text frame generation: detect selected TextNode, load font async, generate copy with client context, preview, apply.
**Deliverable:** Working single-element flow in Figma.
**Done when:** You select a text frame, prompt, and client-aware copy appears in the frame.

### Quest 6.4 — Frame Scanner + Brief Wizard
**Session:** Evening + following Morning
**Objective:** Build frame scanning (using layer names or frame hierarchy to group content) and the brief wizard. Reuse as much UI and logic from the Webflow plugin as possible.
**Deliverable:** Full scan → brief → generate → review → apply flow in Figma.
**Done when:** You can brief a full Figma page layout and apply generated copy to all text frames.

### 🏆 Level 6 Boss Check
- [ ] Figma plugin installs and runs
- [ ] Client binding persists
- [ ] Completeness gate blocks incomplete clients
- [ ] Single element generation working
- [ ] Frame scanning detects text elements correctly
- [ ] Full page flow (scan → brief → generate → review → apply) working
- [ ] Font loading handles gracefully when fonts are missing
- [ ] Token usage logged for all Figma plugin calls

---

## FINAL BOSS: End-to-End Validation

Before considering this project complete, run through this full scenario:

1. **Onboard a brand new client** using Typeform + Google Drive extraction
2. **Verify their knowledge** on the dashboard — colours render, fonts display, products listed, tone documented
3. **Check completeness** passes with no missing fields
4. **Open their Webflow project** — plugin auto-loads the correct client
5. **Scan a full page** — all sections and elements detected
6. **Brief the page** section by section in the wizard
7. **Generate all copy** — coherent, conversion-optimised, uses their tone, references real products
8. **Edit one section** with feedback and regenerate
9. **Apply to page** — all elements populated correctly
10. **Check token usage** on the dashboard — costs tracked accurately
11. **Next day, attend a client meeting** — share the Granola note, tasks appear in Asana, knowledge base updates automatically
12. **Check Asana** — agency tasks from the meeting are in the correct project with due dates and context
13. **Regenerate a section** — notice the copy now reflects the meeting update
14. **Open the same client in Figma** — plugin binds correctly, generate copy into text frames

If all 14 steps work, you've built it. Ship it.

---

## Progress Tracker

| Level | Quest | Status |
|-------|-------|--------|
| 0 | 0.1 Meeting Notes Schema + Granola Pipeline | ⬜ |
| 0 | 0.2 Slack Fallback for Unmatched Meetings | ⬜ |
| 0 | 0.3 Task Extraction + Asana Integration | ⬜ |
| 0 | 0.4 Client Creation via Slack | ⬜ |
| 0 | 0.5 Analytics Onboarding (Direct API) | ⬜ |
| 0 | 0.6 Conversion Reporting in Analytics Bot | ⬜ |
| 1 | 1.1 Supabase Setup | ⬜ |
| 1 | 1.2 First Client Data | ⬜ |
| 1 | 1.3 MCP Server Core | ⬜ |
| 1 | 1.4 MCP Read Tools | ⬜ |
| 1 | 1.5 MCP Write Tools | ⬜ |
| 1 | 1.6 Copy Generation Test | ⬜ |
| 1 | 1.7 Completeness Validator | ⬜ |
| 2 | 2.1 Typeform Pipeline | ⬜ |
| 2 | 2.2 Drive Extraction Script | ⬜ |
| 2 | 2.3 Claude Knowledge Extraction | ⬜ |
| 2 | 2.4 Meeting Notes → Knowledge Base | ⬜ |
| 2 | 2.5 Second Client E2E | ⬜ |
| 3 | 3.1 Scaffold Extension | ⬜ |
| 3 | 3.2 Client Binding | ⬜ |
| 3 | 3.3 Completeness Gate | ⬜ |
| 3 | 3.4 Single Element Gen | ⬜ |
| 3 | 3.5 Page Scanner | ⬜ |
| 3 | 3.6 Brief Wizard | ⬜ |
| 3 | 3.7 Full Page Generation | ⬜ |
| 3 | 3.8 Review + Apply | ⬜ |
| 4 | 4.1 Token Logging | ⬜ |
| 4 | 4.2 Client Dashboard | ⬜ |
| 4 | 4.3 Usage Dashboard | ⬜ |
| 4 | 4.4 LLM Query Box | ⬜ |
| 5 | 5.1 GA4 + GSC Connector | ✅ (analytics bot) |
| 5 | 5.2 PostHog Connector | ⬜ |
| 5 | 5.3 Metrics in Copy | ⬜ |
| 6 | 6.1 Scaffold Figma Plugin | ⬜ |
| 6 | 6.2 Client Binding + Gate | ⬜ |
| 6 | 6.3 Single Element Gen | ⬜ |
| 6 | 6.4 Scanner + Brief + Apply | ⬜ |
| ✦ | Final Boss Validation | ⬜ |
