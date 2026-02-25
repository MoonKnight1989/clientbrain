# ClientBrain

## What This Project Is

ClientBrain is an internal agency knowledge system for Massive Marketing. It centralises client brand, product, and business data and makes it accessible inside the tools the team uses — Webflow, Figma, Claude, and more. The core philosophy is "client knowledge wherever you need it" with minimal UI.

## Project Documentation

- **Build Bible:** `docs/how-we-build.md` — session protocol, architecture principles, technical conventions, and decision log. Read at the start of every session.
- **Build Brief:** `docs/clientbrain-brief.md` — full architecture, schema, plugin specs, and technical decisions. Read this before building anything.
- **Roadmap:** `docs/clientbrain-roadmap.md` — quest-by-quest build plan with done conditions. Follow this in order.
- **Conversion Copywriting Rules:** `docs/conversion-copywriting-skill.md` — the copy quality rules that must be injected into every Claude API call that generates copy.

## Build Discipline

### Pacing Rules

1. **One quest at a time.** Only build what the current quest requires. Do not start the next quest, pre-build future features, or scaffold things "while we're here." The human will tell you which quest to work on.
2. **Stop at the done condition.** Every quest has a "Done when" condition in the roadmap. When that condition is met, stop and report. Do not continue building.
3. **No unsolicited refactoring.** Do not restructure, reorganise, or "improve" previously built code unless explicitly asked or the current quest requires it. Flag things that should be refactored — don't just do it.
4. **Flag uncertainty immediately.** If you make an assumption, take a shortcut, or choose between valid approaches — say so before moving on. Never bury uncertainty.
5. **Ask before building big.** If a task turns out larger than expected, pause and propose how to break it down.

### After Every Quest

Always provide:

1. **What was built** — brief summary
2. **What to test** — specific steps, commands, clicks, or inputs to verify it works
3. **Uncertainties** — trade-offs made, shortcuts taken, things you're not confident about
4. **Impact on next steps** — dependencies created, anything that affects the next quest

Then wait. Do not proceed until the human confirms it works.

### Testing Is a Gate

- Human tests after every quest
- Issues get fixed before moving on
- "Looks good" or "move on" is the green light — nothing else

### Level Boss Checks

At the end of each Level, the human runs through the Boss Check. This is the time for refactoring, fixing accumulated issues, and verifying everything works together.

## Shared Supabase Tables — Analytics Bot

The analytics bot (`apps/analytics-bot/`) is part of this project. Read `docs/analytics-bot-integration.md` for full details.

**Do not modify or drop these tables** — they are owned by the analytics bot:
- `slack_channels`
- `analytics_gsc_daily`
- `analytics_ga4_daily`
- `analytics_attribution_daily`

**Do not rename or remove** these columns (used by the analytics bot):
- `clients.slug` — maps BQ client IDs to Supabase UUIDs
- `metrics.ga4_bq_dataset` — BQ dataset ID for GA4 exports
- `metrics.search_console_url` — Search Console property URL

The `analytics_*` tables all have `client_id UUID REFERENCES clients(id)`, so any tool that knows a client UUID can query their performance data directly.

## Code Standards

- Clean, readable code with comments on non-obvious decisions
- Shared logic goes in `packages/clientbrain-core/` — do not duplicate across MCP server, Webflow extension, and Figma plugin
- Every Claude API call logs to `api_usage` table via the shared client wrapper
- Every knowledge change logs to `changelog` table with source attribution
- Never hardcode API keys, URLs, or secrets — environment variables only
- Every copy generation prompt includes the conversion copywriting skill rules — no exceptions
- Handle errors gracefully — never fail silently

## Tech Stack

- **Database:** Supabase (PostgreSQL with JSONB)
- **API:** Supabase REST API + Edge Functions
- **AI:** Claude API via MCP server (for Claude Code/Claude.ai) and direct calls (for plugins)
- **Plugins:** Webflow Designer Extension (React), Figma Plugin (TypeScript + HTML UI)
- **Ingestors:** Typeform + Zapier, Google Drive extraction script (Python), meeting note webhooks
- **Analytics:** GA4 Data API, PostHog API
- **Shared code:** `packages/clientbrain-core/` (TypeScript)

## Project Structure

```
clientbrain/
├── CLAUDE.md                          ← you are here
├── docs/
│   ├── how-we-build.md                ← build bible (read every session)
│   ├── clientbrain-brief.md           ← full build spec
│   ├── clientbrain-roadmap.md         ← quest tracker
│   ├── analytics-bot-integration.md   ← analytics bot ↔ clientBrain contract
│   └── conversion-copywriting-skill.md ← copy rules for prompts
├── packages/
│   └── clientbrain-core/              ← shared types, API client, Claude wrapper, prompts, validators
├── apps/
│   ├── analytics-bot/                 ← Slack analytics bot (Cloud Functions)
│   ├── meeting-actions/               ← Granola → tasks → Asana (Cloud Functions)
│   ├── client-manager/                ← Client creation + onboarding (Cloud Functions)
│   ├── mcp-server/                    ← MCP server for Claude Code/Claude.ai
│   ├── webflow-extension/             ← Webflow Designer Extension
│   ├── figma-plugin/                  ← Figma Plugin
│   └── dashboard/                     ← Minimal client dashboard + LLM query box
├── scripts/
│   ├── drive-extractor/               ← Google Drive knowledge extraction
│   └── seed/                          ← Database seeding utilities
├── supabase/
│   └── migrations/                    ← SQL schema migrations
└── .env.example
```
