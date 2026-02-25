# Analytics Bot Integration

## What This Is

The **Slack Analytics Bot** (`/analytics`) lives at `apps/analytics-bot/` within this project. It provides automated weekly analytics reports and ad-hoc queries via Slack for Massive Marketing's clients. It deploys as Google Cloud Functions (separate from the rest of clientBrain) but shares the same Supabase database.

## How It Connects

```
Google (GA4/GSC exports) → BigQuery (raw data + daily rollup queries)
                                    ↓ daily sync (Cloud Function)
                              Supabase (shared with clientBrain)
                                    ↓ fast reads
                        Slack Bot Cloud Functions → Slack channels
```

- **BigQuery** receives raw GA4 and Google Search Console exports via Google's native pipelines. Scheduled queries roll up daily summaries. This is unchanged.
- **A daily sync function** (`syncAnalyticsToSupabase`) reads BQ rollup tables and upserts to Supabase. Runs at 7 AM UK daily.
- **The Slack bot** reads all config and analytics data from Supabase at query time.

## Supabase Tables Used

These tables are **created and managed by the analytics bot project** (migration `003_analytics_integration.sql`):

| Table | Purpose | Managed By |
|---|---|---|
| `slack_channels` | Maps Slack channel IDs to clients with schedule config | Analytics bot (via `/analytics setup` modal) |
| `analytics_gsc_daily` | Google Search Console daily metrics | Daily sync from BigQuery |
| `analytics_ga4_daily` | GA4 daily metrics (sessions, users, engagement) | Daily sync from BigQuery |
| `analytics_attribution_daily` | Session source/medium/campaign breakdown | Daily sync from BigQuery |

The bot also **reads from** these clientBrain tables:
- `clients` — to list clients in the setup modal and look up client names
- `metrics` — uses `ga4_bq_dataset` and `search_console_url` columns (added by migration 003)

## Column Additions

Migration 003 adds two columns to the `metrics` table:
- `ga4_bq_dataset TEXT` — BigQuery dataset ID for the client's GA4 export
- `search_console_url TEXT` — Search Console property URL

These are used by the BQ → Supabase sync function to know which BQ tables to read from.

## Client Slug Convention

The analytics bot maps clients between BQ and Supabase using the `clients.slug` field. BQ uses slug-style IDs (e.g. "noan", "atlas-hps", "mercerlabs") which match the Supabase `slug` column. When adding new clients, ensure the slug matches the BQ `client_id`.

## What NOT to Change

- Do not rename or remove the `slug` column on `clients` — the analytics bot depends on it for BQ mapping
- Do not drop the `analytics_*` tables — they are populated daily by the sync function
- Do not modify `slack_channels` — managed by the Slack bot's setup flow
- The `ga4_bq_dataset` and `search_console_url` columns on `metrics` are used by the sync function
