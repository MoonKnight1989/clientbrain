# How We Build ClientBrain

This is the working reference for every build session. Read this before starting work.

---

## Core Beliefs

- **Clean and efficient code, always.** No bloat, no dead weight, no "good enough for now." If it's not clean, it's not done.
- **Modern code, always.** Use current patterns, current APIs, current conventions. Don't write code that feels like it was built three years ago.
- **Independent by default, dependent when necessary.** Every app, module, and function should stand on its own. Coupling is a conscious choice, not an accident.
- **Usability above all else.** Our products must be easy to use and slot into the everyday life of the people who use them. If it's hard to use, it doesn't matter how well it's built.
- **No main UI.** We are not building a dashboard-first product. We build mini apps that deploy into the tools the team already lives in — Slack, Webflow, Asana, Figma. The UI is theirs, the intelligence is ours.
- **Connecting tissue, not a branded SaaS tool.** ClientBrain is coded infrastructure woven into existing workflows. It is not an "everything app." It has no login screen, no landing page, no onboarding flow. It just works, wherever you already are.
- **Boldness over timidity.** We are not afraid of making large changes if they serve optimal usability. Refactoring, rearchitecting, or scrapping something that isn't working — all fair game when the outcome is better.
- **Honest and opinionated.** We say what we think. We challenge each other when something doesn't align with these beliefs. But the human always has the last word.

---

## Session Protocol

### Starting a session
1. Check `docs/clientbrain-roadmap.md` — find the current quest (first ⬜ in the Progress Tracker)
2. Read the quest's objective, deliverable, and done condition
3. Confirm with the human which quest we're working on — never assume
4. Read any relevant existing code before writing new code

### During a session
- **One quest at a time.** Don't start the next quest, pre-build future features, or scaffold things "while we're here"
- **Stop at the done condition.** When it's met, report and wait
- **Flag uncertainty immediately.** If making an assumption, taking a shortcut, or choosing between valid approaches — say so before moving on
- **Ask before building big.** If a task turns out larger than expected, pause and propose how to break it down

### Ending a session
Always provide:
1. **What was built** — brief summary
2. **What to test** — specific steps, commands, clicks, or inputs to verify it works
3. **Uncertainties** — trade-offs made, shortcuts taken, things not confident about
4. **Impact on next steps** — dependencies created, anything that affects the next quest

Then wait. Do not proceed until the human confirms it works.

### Testing is a gate
- Human tests after every quest
- Issues get fixed before moving on
- "Looks good" or "move on" is the green light — nothing else

---

## Architecture Principles

### Lean by default
- Always question whether a component is needed. If the same outcome can be achieved with fewer systems, do that.
- No over-engineering. Only build what the current quest requires.
- Don't add error handling for scenarios that can't happen. Don't design for hypothetical future requirements.

### Slack is the agency interface
- All ops tools (meeting actions, client creation, analytics setup) use Slack as the UI
- Modals for data input, messages for notifications, buttons for human-in-the-loop decisions
- No custom dashboards needed for ops workflows — the team lives in Slack

### Each app is self-contained
- Lives in `apps/<app-name>/` with its own `CLAUDE.md`, `package.json`, and Cloud Function entry points
- Deploys as Google Cloud Functions (Gen2) in `europe-west2`
- Shares the Supabase database but owns its own tables
- Shares the Slack bot token but has its own slash commands and interactivity handlers

### Supabase is the shared brain
- Every app reads/writes to the same Supabase instance
- Client identity is `clients.id` (UUID) — all tables reference this
- `clients.slug` maps between external systems (BQ, etc.) and Supabase UUIDs
- Service role key for all Cloud Function access (RLS policies allow full access via service role)

### Config-driven, not hardcoded
- Client-specific config lives in Supabase tables, not in code
- Adding a new client should never require editing source code or SQL
- The `metrics` table holds per-client analytics config (property IDs, conversion events, URLs)
- The `client_domains` table maps email domains to clients

---

## Technical Conventions

### Cloud Functions
- Runtime: Node.js 20
- Region: `europe-west2`
- Memory: 512Mi
- Slack-facing functions use `--no-cpu-throttling` (async work after responding)
- Deploy from the app subdirectory:
  ```bash
  gcloud functions deploy <functionName> --runtime=nodejs20 --trigger-http --allow-unauthenticated --region=europe-west2 --project=massive-marketing --source=<dir> --entry-point=<functionName> --memory=512Mi
  ```

### Supabase access pattern
- Use `fetch` with the REST API — no Supabase JS client in Cloud Functions (keeps deps minimal)
- Headers: `apikey` + `Authorization: Bearer` with service key
- Upserts use `Prefer: return=minimal,resolution=merge-duplicates` with `on_conflict` parameter
- Always include error handling that surfaces the Supabase error body

### Slack patterns
- Acknowledge slash commands within 3 seconds (respond immediately, do async work after)
- Use `response_url` for follow-up messages to slash commands
- Use `chat.postMessage` for proactive messages (scheduled reports, notifications)
- Modals: open a loading modal immediately to capture `trigger_id`, then `views.update` with full content
- Block Kit for rich formatting (sections, dividers, images, buttons)
- Slack mrkdwn (not markdown): `*bold*`, `_italic_`, no `#` headings

### Claude API calls
- Model: `claude-haiku-4-5-20251001` for analytics and task extraction (fast, cheap)
- Always include `anthropic-version: 2023-06-01` header
- System prompt sets the role, rules, and output format
- Log all calls to `api_usage` table (when the shared wrapper exists — Level 4)

### Environment variables
All Cloud Functions need: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SLACK_BOT_TOKEN`
Additional per-app: `CLAUDE_API_KEY`, `GRANOLA_API_KEY`, `ASANA_ACCESS_TOKEN`

---

## Decision Log

Decisions made during planning that should not be revisited without good reason.

| Decision | Rationale | Date |
|---|---|---|
| BQ removed from active analytics pipeline | GA4 Data API provides the same daily summaries directly. Eliminates hardcoded UNION ALL queries per client. BQ exports kept running passively for raw data warehouse needs. | 2026-02-25 |
| Granola via "Note Shared to Zapier" trigger | Instant trigger, no folder management needed. Supabase is the filing system, not Granola folders. | 2026-02-25 |
| Client matching via email domain + Slack fallback | Domain matching handles 95% of cases automatically. Slack buttons handle edge cases (personal emails, new clients, non-client meetings) with human-in-the-loop. | 2026-02-25 |
| Meeting actions and client manager as separate apps | Different concerns (meeting processing vs client lifecycle). Same Slack bot, different slash commands and Cloud Functions. | 2026-02-25 |
| Level 0 before Level 1 | Meeting actions + client creation only need `clients` table (exists). Delivers immediate agency value. Self-contained, doesn't block or get blocked by knowledge base work. | 2026-02-25 |
| Per-client conversion events | Primary + secondary conversion event names stored in `metrics` table. Each client tracks different events. Included in both GA4 daily and attribution syncs. | 2026-02-25 |
| Slack as the ops UI | Team lives in Slack. No need for a separate dashboard for ops workflows. Modals for input, messages for notifications, buttons for decisions. | 2026-02-25 |

---

## Integration Reference

### Asana
- Workspace: `massive-marketing.co.uk` (GID: `1204818740126150`)
- Team: `Massive Marketing Team` (GID: `1204818740126152`)
- Projects exist per client (NOAN, Atlas HPS, Mercer Labs, etc.)
- API access via MCP tools or direct REST API with access token

### Granola
- API base: `https://public-api.granola.ai`
- Auth: Bearer token (API key from workspace settings, Enterprise plan)
- Endpoints: `GET /v1/notes` (list), `GET /v1/notes/{id}?include=transcript` (full note)
- Note data: title, attendees (name + email), calendar event, summary_markdown, transcript
- Rate limits: 25 req/5s burst, 300/min sustained
- Zapier triggers: "Note Shared to Zapier" (instant), "Note Added to Folder" (instant)

### GA4 Data API
- Library: `@google-analytics/data`
- Property ID format: `properties/13073005118`
- Dimensions: date, sessionSource, sessionMedium, sessionCampaignName, eventName
- Metrics: sessions, activeUsers, newUsers, engagedSessions, engagementRate, eventCount
- Free quota: 10,000 requests/day per property

### Search Console API
- URL format: `sc-domain:example.com` or `https://www.example.com/`
- Stored in `metrics.search_console_url`
- Returns: impressions, clicks, CTR, position by date

### Supabase tables owned by each app

**Analytics Bot (`apps/analytics-bot/`):**
- `slack_channels` — Slack channel → client mapping + schedule config
- `analytics_gsc_daily` — GSC daily metrics
- `analytics_ga4_daily` — GA4 daily metrics (+ conversion counts after Quest 0.6)
- `analytics_attribution_daily` — attribution by source/medium/campaign/event

**Meeting Actions (`apps/meeting-actions/`):** (Quest 0.1)
- `meeting_notes` — Granola notes linked to clients
- `meeting_tasks` — extracted tasks (agency + client)

**Client Manager (`apps/client-manager/`):** (Quest 0.4)
- `client_domains` — email domain → client mapping

**Core (shared):**
- `clients` — client records (id, name, slug, status)
- `metrics` — per-client config (GA4 property, conversion events, GSC URL)
- Plus all knowledge base tables (brand, products, audiences, etc.) from Level 1

---

## What NOT to change

- Do not rename or remove `clients.slug` — used for BQ mapping (passive) and as a universal identifier
- Do not drop `analytics_*` tables — populated by daily sync, read by analytics bot
- Do not modify `slack_channels` — managed by analytics bot setup flow
- `ga4_bq_dataset` and `search_console_url` columns on `metrics` — keep for backwards compatibility even after API migration
