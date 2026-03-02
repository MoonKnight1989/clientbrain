# Meeting Actions

## What This Is

Processes Granola meeting notes into structured tasks. Pipeline: Granola API (poll) → Cloud Function → Supabase → Claude (task extraction) → Asana.

## Structure

```
apps/meeting-actions/
├── CLAUDE.md           ← you are here
├── package.json
└── index.js            ← pollGranolaNotes Cloud Function
```

## Cloud Functions

| Function | Purpose | Trigger |
|---|---|---|
| `pollGranolaNotes` | Polls Granola API for recent notes, deduplicates, matches client via domain, stores in Supabase | Cloud Scheduler (every 15 min) |

## Supabase Tables (owned by this app)

| Table | Purpose |
|---|---|
| `meeting_notes` | Granola notes linked to clients |
| `meeting_tasks` | Extracted tasks (agency + client) |

## Shared Tables (read from)

| Table | Columns Used |
|---|---|
| `clients` | `id`, `name`, `slug`, `status` |
| `client_domains` | `domain`, `client_id` |

## Environment Variables

`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GRANOLA_API_KEY`, `SLACK_BOT_TOKEN` (Quest 0.2), `CLAUDE_API_KEY` (Quest 0.3), `ASANA_ACCESS_TOKEN` (Quest 0.3)

## Deployment

```bash
gcloud functions deploy pollGranolaNotes --runtime=nodejs20 --trigger-http --allow-unauthenticated --region=europe-west2 --project=massive-marketing --source=. --entry-point=pollGranolaNotes --memory=512Mi
```

## Cloud Scheduler

```bash
gcloud scheduler jobs create http poll-granola-notes --schedule="*/15 * * * *" --uri="https://europe-west2-massive-marketing.cloudfunctions.net/pollGranolaNotes" --http-method=POST --location=europe-west2 --project=massive-marketing
```
