# Analytics Bot

## What This Is

A Slack bot (`/analytics`) that provides automated weekly analytics reports and ad-hoc data queries for Massive Marketing's clients. This is one app within the clientBrain ecosystem. Deployed as Google Cloud Functions (Gen2) in `europe-west2`.

## Architecture

```
Google (GA4/GSC exports) → BigQuery (raw data + daily rollup queries)
                                    ↓ daily sync at 7 AM UK
                              Supabase (shared clientBrain database)
                                    ↓ fast reads
                        Cloud Functions → Slack
```

## Structure

```
apps/analytics-bot/
├── CLAUDE.md           ← you are here
├── slack/              ← Slack-facing functions (zero npm dependencies)
│   ├── index.js        ← handleAnalytics, slackInteractivity, sendScheduledReports
│   └── package.json
└── sync/               ← BQ → Supabase daily sync
    ├── index.js        ← syncAnalyticsToSupabase
    └── package.json
```

## Deployed Cloud Functions

| Function | Source | Purpose | Trigger |
|---|---|---|---|
| `handleAnalytics` | `slack/` | Slash command handler + setup modal | HTTP (Slack slash command) |
| `slackInteractivity` | `slack/` | Modal submission handler | HTTP (Slack interactivity URL) |
| `sendScheduledReports` | `slack/` | Sends weekly reports to configured channels | HTTP (Cloud Scheduler, hourly) |
| `syncAnalyticsToSupabase` | `sync/` | Syncs last 7 days from BQ → Supabase | HTTP (Cloud Scheduler, daily 7 AM UK) |

All Slack-facing functions use `--no-cpu-throttling` (they do async work after responding). 512Mi memory. Region: `europe-west2`.

## Supabase Tables

### Tables this app owns:

| Table | Purpose |
|---|---|
| `slack_channels` | Maps Slack channels to clients with schedule config |
| `analytics_gsc_daily` | Google Search Console daily metrics per client |
| `analytics_ga4_daily` | GA4 daily metrics per client |
| `analytics_attribution_daily` | Session source/medium/campaign breakdown per client |

All `analytics_*` tables use `client_id UUID REFERENCES clients(id)`. Any clientBrain tool can query these tables to get performance data for a client.

### Tables this app reads from (owned by clientBrain core):

| Table | Columns Used |
|---|---|
| `clients` | `id`, `name`, `slug`, `status` |
| `metrics` | `ga4_bq_dataset`, `search_console_url` |

Schema changes to `clients` or `metrics` go through clientBrain's `supabase/migrations/`.

### Client ID Convention

The `clients.slug` field maps between BQ (slugs like "noan", "mercerlabs") and Supabase (UUIDs). Do not rename or remove `slug`.

## Slash Commands

- `/analytics setup` — configure channel → client mapping + weekly schedule
- `/analytics report` — manually trigger a report for the current channel
- `/analytics <question>` — ad-hoc query answered by Claude
- `/analytics` (no args) — defaults to weekly performance report

## Environment Variables

All Cloud Functions need: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SLACK_BOT_TOKEN`, `CLAUDE_API_KEY`

## Deployment

Deploy from the `slack/` or `sync/` subdirectory:
```bash
cd apps/analytics-bot
gcloud functions deploy <functionName> --runtime=nodejs20 --trigger-http --allow-unauthenticated --region=europe-west2 --project=massive-marketing --source=slack --entry-point=<functionName> --memory=512Mi
```
