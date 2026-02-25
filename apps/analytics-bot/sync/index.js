// Daily BQ → Supabase sync function
// Runs once daily at 7 AM UK via Cloud Scheduler
// Reads rollup tables from BigQuery, upserts to Supabase

const { BigQuery } = require('@google-cloud/bigquery');
const bigquery = new BigQuery({ location: 'EU' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const CONFLICT_KEYS = {
  'analytics_gsc_daily': 'client_id,data_date',
  'analytics_ga4_daily': 'client_id,event_date',
  'analytics_attribution_daily': 'client_id,event_date,event_name,source,medium,campaign'
};

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase GET ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function supabaseUpsert(table, data) {
  const onConflict = CONFLICT_KEYS[table] || '';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal,resolution=merge-duplicates'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase UPSERT ${table} failed (${res.status}): ${body}`);
  }
}

async function upsertBatch(table, rows) {
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await supabaseUpsert(table, rows.slice(i, i + chunkSize));
  }
}

exports.syncAnalyticsToSupabase = async (req, res) => {
  try {
    console.log('Starting BQ → Supabase sync...');

    // 1. Get slug → UUID mapping from Supabase
    const clients = await supabaseGet('clients?select=id,slug');
    const slugToUuid = {};
    for (const c of clients) {
      slugToUuid[c.slug] = c.id;
    }
    console.log(`Loaded ${clients.length} client mappings`);

    // 2. Query all 3 BQ tables in parallel (last 7 days)
    const [[gscRows], [gaRows], [attrRows]] = await Promise.all([
      bigquery.query({
        query: `SELECT client_id, data_date, impressions, clicks, ctr, avg_position
                FROM client_analytics.search_console_daily
                WHERE data_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)`
      }),
      bigquery.query({
        query: `SELECT client_id, event_date, sessions, active_users, new_users, engaged_sessions, engagement_rate
                FROM client_analytics.ga4_daily
                WHERE event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)`
      }),
      bigquery.query({
        query: `SELECT client_id, event_date, event_name, source, medium, campaign, sessions, users
                FROM client_analytics.attribution_daily
                WHERE event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)`
      })
    ]);

    // 3. Transform and upsert to Supabase
    const gscData = gscRows
      .filter(r => slugToUuid[r.client_id])
      .map(r => ({
        client_id: slugToUuid[r.client_id],
        data_date: r.data_date.value || r.data_date,
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: r.ctr,
        avg_position: r.avg_position
      }));

    const gaData = gaRows
      .filter(r => slugToUuid[r.client_id])
      .map(r => ({
        client_id: slugToUuid[r.client_id],
        event_date: r.event_date.value || r.event_date,
        sessions: r.sessions,
        active_users: r.active_users,
        new_users: r.new_users,
        engaged_sessions: r.engaged_sessions,
        engagement_rate: r.engagement_rate
      }));

    const attrData = attrRows
      .filter(r => slugToUuid[r.client_id])
      .map(r => ({
        client_id: slugToUuid[r.client_id],
        event_date: r.event_date.value || r.event_date,
        event_name: r.event_name,
        source: r.source,
        medium: r.medium,
        campaign: r.campaign,
        sessions: r.sessions,
        users: r.users
      }));

    // Upsert all 3 in parallel
    await Promise.all([
      gscData.length > 0 ? upsertBatch('analytics_gsc_daily', gscData) : null,
      gaData.length > 0 ? upsertBatch('analytics_ga4_daily', gaData) : null,
      attrData.length > 0 ? upsertBatch('analytics_attribution_daily', attrData) : null
    ]);

    console.log(`Synced: ${gscData.length} GSC, ${gaData.length} GA4, ${attrData.length} attribution rows`);
    res.json({ success: true, gsc: gscData.length, ga4: gaData.length, attribution: attrData.length });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: error.message });
  }
};
