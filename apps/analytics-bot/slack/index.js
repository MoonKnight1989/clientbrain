// Slack-facing analytics bot functions
// Zero npm dependencies — uses only Node.js built-in fetch
// Reads all data from Supabase REST API

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ─── Supabase helpers ────────────────────────────────────────────────────────

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
  const CONFLICT_KEYS = {
    'slack_channels': 'channel_id',
    'analytics_gsc_daily': 'client_id,data_date',
    'analytics_ga4_daily': 'client_id,event_date',
    'analytics_attribution_daily': 'client_id,event_date,event_name,source,medium,campaign'
  };
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

async function supabasePatch(table, query, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase PATCH ${table} failed (${res.status}): ${body}`);
  }
}

// ─── Main slash command handler ───────────────────────────────────────────────

exports.handleAnalytics = async (req, res) => {
  const t0 = Date.now();
  const text = (req.body.text || '').trim();
  const channelId = req.body.channel_id;
  const responseUrl = req.body.response_url;

  // Route to setup modal if requested
  if (text.toLowerCase() === 'setup') {
    return await openSetupModal(req, res, t0);
  }

  // Route to manual report trigger
  if (text.toLowerCase() === 'report') {
    return await sendManualReport(req, res, t0);
  }

  // Acknowledge immediately (Slack requires response within 3 seconds)
  res.json({ response_type: 'in_channel', text: '🔍 Pulling your data...' });
  console.log(`[query] ack: ${Date.now() - t0}ms`);

  const question = text || 'Give me a weekly performance report';

  try {
    // 1. Look up client from channel_id via Supabase
    const channelRows = await supabaseGet(
      `slack_channels?select=client_id,clients(id,name,slug)&channel_id=eq.${channelId}&is_active=eq.true`
    );
    console.log(`[query] channel lookup: ${Date.now() - t0}ms`);

    if (channelRows.length === 0) {
      await postToSlack(responseUrl, '❌ This channel is not configured. Run `/analytics setup` to get started.');
      return;
    }

    const clientUuid = channelRows[0].client_id;
    const client = { client_id: channelRows[0].clients.slug, client_name: channelRows[0].clients.name };

    // 2. Pull daily GSC, GA4, and attribution data in parallel from Supabase (last 90 days max)
    const [gscData, gaData, attributionData] = await Promise.all([
      supabaseGet(
        `analytics_gsc_daily?select=data_date,impressions,clicks,ctr,avg_position&client_id=eq.${clientUuid}&order=data_date.desc&limit=90`
      ),
      supabaseGet(
        `analytics_ga4_daily?select=event_date,sessions,active_users,new_users,engaged_sessions,engagement_rate&client_id=eq.${clientUuid}&order=event_date.desc&limit=90`
      ),
      supabaseGet(
        `analytics_attribution_daily?select=event_date,event_name,source,medium,campaign,sessions,users&client_id=eq.${clientUuid}&order=event_date.desc,sessions.desc&limit=500`
      )
    ]);
    console.log(`[query] supabase data: ${Date.now() - t0}ms (gsc:${gscData.length} ga4:${gaData.length} attr:${attributionData.length})`);

    // 3. Send to Claude API for analysis
    const analysis = await callClaude(client, gscData, gaData, attributionData, question);
    console.log(`[query] claude: ${Date.now() - t0}ms`);

    // 4. Build chart URL from GA4 daily data
    const chartUrl = buildChartUrl(gaData);

    // 5. Post back to Slack with Block Kit
    await postBlocksToSlack(responseUrl, client, analysis, chartUrl);
    console.log(`[query] TOTAL: ${Date.now() - t0}ms`);

  } catch (error) {
    console.error('Error:', error);
    try {
      await postToSlack(responseUrl, `❌ Something went wrong.\n\n*Error:* ${error.message || String(error)}`);
    } catch (slackErr) {
      console.error('Failed to post error to Slack:', slackErr);
    }
  }
};

// ─── Setup modal ──────────────────────────────────────────────────────────────

async function openSetupModal(req, res, t0) {
  const triggerId = req.body.trigger_id;
  const channelId = req.body.channel_id;
  const userId = req.body.user_id;

  // Acknowledge immediately
  res.send('');
  console.log(`[setup] res.send: ${Date.now() - t0}ms`);

  try {
    // Open a loading modal immediately to capture the trigger_id (expires in ~3s)
    const loadingView = {
      type: 'modal',
      callback_id: 'analytics_setup_loading',
      title: { type: 'plain_text', text: 'Analytics Setup' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: 'Loading clients...' } }
      ]
    };

    const openRes = await fetch('https://slack.com/api/views.open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
      },
      body: JSON.stringify({ trigger_id: triggerId, view: loadingView })
    });

    const openData = await openRes.json();
    console.log(`[setup] views.open: ${Date.now() - t0}ms (ok: ${openData.ok})`);
    if (!openData.ok) {
      console.error('Slack views.open error:', openData.error, openData.response_metadata);
      return;
    }

    const viewId = openData.view.id;

    // Now fetch data from Supabase (no time pressure — modal is already open)
    const [clients, existing] = await Promise.all([
      supabaseGet('clients?select=id,name,slug&status=eq.active&order=name'),
      supabaseGet(`slack_channels?select=client_id,schedule_day,schedule_time&channel_id=eq.${channelId}`)
    ]);
    console.log(`[setup] supabase fetch: ${Date.now() - t0}ms (${clients.length} clients)`);

    const clientOptions = clients.map(c => ({
      text: { type: 'plain_text', text: c.name },
      value: c.id
    }));

    if (clientOptions.length === 0) {
      console.error('No active clients found');
      return;
    }

    const isUpdate = existing.length > 0;
    const current = isUpdate ? existing[0] : null;

    const dayOptions = [
      { text: { type: 'plain_text', text: 'Monday' }, value: 'monday' },
      { text: { type: 'plain_text', text: 'Tuesday' }, value: 'tuesday' },
      { text: { type: 'plain_text', text: 'Wednesday' }, value: 'wednesday' },
      { text: { type: 'plain_text', text: 'Thursday' }, value: 'thursday' },
      { text: { type: 'plain_text', text: 'Friday' }, value: 'friday' }
    ];

    const timeOptions = [
      { text: { type: 'plain_text', text: '08:00' }, value: '08:00' },
      { text: { type: 'plain_text', text: '09:00' }, value: '09:00' },
      { text: { type: 'plain_text', text: '10:00' }, value: '10:00' },
      { text: { type: 'plain_text', text: '11:00' }, value: '11:00' },
      { text: { type: 'plain_text', text: '12:00' }, value: '12:00' },
      { text: { type: 'plain_text', text: '14:00' }, value: '14:00' },
      { text: { type: 'plain_text', text: '15:00' }, value: '15:00' },
      { text: { type: 'plain_text', text: '16:00' }, value: '16:00' },
      { text: { type: 'plain_text', text: '17:00' }, value: '17:00' }
    ];

    const fullView = {
      type: 'modal',
      callback_id: 'analytics_setup',
      title: { type: 'plain_text', text: 'Analytics Setup' },
      submit: { type: 'plain_text', text: isUpdate ? 'Update' : 'Save' },
      close: { type: 'plain_text', text: 'Cancel' },
      private_metadata: JSON.stringify({ channelId, userId }),
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: isUpdate ? '_Update the configuration for this channel._' : '_Configure analytics reports for this channel._' }
        },
        {
          type: 'input',
          block_id: 'client_block',
          label: { type: 'plain_text', text: 'Select Client' },
          element: {
            type: 'static_select',
            action_id: 'client_select',
            placeholder: { type: 'plain_text', text: 'Choose a client' },
            options: clientOptions,
            ...(isUpdate && { initial_option: clientOptions.find(o => o.value === current.client_id) })
          }
        },
        {
          type: 'input',
          block_id: 'day_block',
          label: { type: 'plain_text', text: 'Weekly Report Day' },
          element: {
            type: 'static_select',
            action_id: 'day_select',
            placeholder: { type: 'plain_text', text: 'Choose day of week' },
            options: dayOptions,
            ...(isUpdate && { initial_option: dayOptions.find(o => o.value === current.schedule_day) })
          }
        },
        {
          type: 'input',
          block_id: 'time_block',
          label: { type: 'plain_text', text: 'Report Time (UK)' },
          element: {
            type: 'static_select',
            action_id: 'time_select',
            placeholder: { type: 'plain_text', text: 'Choose time' },
            options: timeOptions,
            ...(isUpdate && { initial_option: timeOptions.find(o => o.value === current.schedule_time) })
          }
        }
      ]
    };

    // Update the loading modal with the full form
    const updateRes = await fetch('https://slack.com/api/views.update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
      },
      body: JSON.stringify({ view_id: viewId, view: fullView })
    });

    const updateData = await updateRes.json();
    console.log(`[setup] views.update: ${Date.now() - t0}ms (ok: ${updateData.ok})`);
    if (!updateData.ok) {
      console.error('Slack views.update error:', updateData.error, updateData.response_metadata);
    }

    console.log(`[setup] TOTAL: ${Date.now() - t0}ms`);

  } catch (error) {
    console.error('Error opening setup modal:', error);
  }
}

// ─── Manual report trigger (/analytics report) ───────────────────────────────

async function sendManualReport(req, res, t0) {
  const channelId = req.body.channel_id;
  const responseUrl = req.body.response_url;

  // Acknowledge immediately
  res.json({ response_type: 'in_channel', text: '📊 Generating report...' });
  console.log(`[report] ack: ${Date.now() - t0}ms`);

  try {
    // Look up client from channel
    const channelRows = await supabaseGet(
      `slack_channels?select=client_id,clients(id,name,slug)&channel_id=eq.${channelId}&is_active=eq.true`
    );

    if (channelRows.length === 0) {
      await postToSlack(responseUrl, 'This channel is not configured. Run `/analytics setup` first.');
      return;
    }

    const clientUuid = channelRows[0].client_id;
    const client = { client_id: channelRows[0].clients.slug, client_name: channelRows[0].clients.name };
    console.log(`[report] client: ${client.client_name} (${Date.now() - t0}ms)`);

    // Pull data from Supabase
    const [gscData, gaData, attributionData] = await Promise.all([
      supabaseGet(
        `analytics_gsc_daily?select=data_date,impressions,clicks,ctr,avg_position&client_id=eq.${clientUuid}&order=data_date.desc&limit=90`
      ),
      supabaseGet(
        `analytics_ga4_daily?select=event_date,sessions,active_users,new_users,engaged_sessions,engagement_rate&client_id=eq.${clientUuid}&order=event_date.desc&limit=90`
      ),
      supabaseGet(
        `analytics_attribution_daily?select=event_date,event_name,source,medium,campaign,sessions,users&client_id=eq.${clientUuid}&order=event_date.desc,sessions.desc&limit=500`
      )
    ]);
    console.log(`[report] data: ${Date.now() - t0}ms (gsc:${gscData.length} ga4:${gaData.length} attr:${attributionData.length})`);

    const analysis = await callClaude(client, gscData, gaData, attributionData, 'Give me a weekly performance report');
    console.log(`[report] claude: ${Date.now() - t0}ms`);

    const chartUrl = buildChartUrl(gaData);
    await postBlocksToSlack(responseUrl, client, analysis, chartUrl);

    // Update last_report_sent
    await supabasePatch(
      'slack_channels',
      `channel_id=eq.${channelId}`,
      { last_report_sent: new Date().toISOString() }
    );

    console.log(`[report] TOTAL: ${Date.now() - t0}ms`);
  } catch (error) {
    console.error('[report] Error:', error);
    try {
      await postToSlack(responseUrl, `Something went wrong generating the report.\n\n*Error:* ${error.message || String(error)}`);
    } catch (_) { /* best effort */ }
  }
}

// ─── Interactivity handler (modal submissions) ───────────────────────────────

exports.slackInteractivity = async (req, res) => {
  console.log('[interactivity] hit');

  let payload;
  try {
    payload = JSON.parse(req.body.payload);
  } catch (err) {
    console.error('[interactivity] Invalid payload JSON:', err.message);
    res.send('');
    return;
  }

  console.log(`[interactivity] type=${payload.type} callback_id=${payload.view?.callback_id}`);

  if (payload.type !== 'view_submission' || payload.view.callback_id !== 'analytics_setup') {
    console.log('[interactivity] ignoring — not analytics_setup submission');
    res.send('');
    return;
  }

  try {
    const { channelId, userId } = JSON.parse(payload.view.private_metadata);
    const values = payload.view.state.values;
    const clientId = values.client_block.client_select.selected_option.value;
    const scheduleDay = values.day_block.day_select.selected_option.value;
    const scheduleTime = values.time_block.time_select.selected_option.value;
    console.log(`[interactivity] saving: channel=${channelId} client=${clientId} day=${scheduleDay} time=${scheduleTime}`);

    // Upsert to Supabase and get client name in parallel
    const [, clientRows] = await Promise.all([
      supabaseUpsert('slack_channels', {
        channel_id: channelId,
        client_id: clientId,
        schedule_day: scheduleDay,
        schedule_time: scheduleTime,
        is_active: true,
        created_by: userId
      }),
      supabaseGet(`clients?select=name&id=eq.${clientId}`)
    ]);
    console.log('[interactivity] upsert done');

    const clientName = clientRows[0].name;
    const dayLabel = scheduleDay.charAt(0).toUpperCase() + scheduleDay.slice(1);

    // Respond with a confirmation view in the modal itself
    res.json({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: 'Setup Complete' },
        close: { type: 'plain_text', text: 'Done' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Analytics configured for ${clientName}*\n\nWeekly reports will be sent to this channel every ${dayLabel} at ${scheduleTime} UK time.`
            }
          },
          { type: 'divider' },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Available commands:*\n\n`/analytics report` — send a report now\n`/analytics <question>` — ask anything about the data\n`/analytics setup` — change settings'
            }
          }
        ]
      }
    });
    console.log('[interactivity] confirmation view sent');

  } catch (error) {
    console.error('[interactivity] Error saving setup:', error);
    res.json({
      response_action: 'update',
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: 'Setup Failed' },
        close: { type: 'plain_text', text: 'Close' },
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `Something went wrong saving the setup. Please try again.\n\n_${error.message}_` }
          }
        ]
      }
    });
  }
};

// ─── Scheduled reports (triggered by Cloud Scheduler) ─────────────────────────

exports.sendScheduledReports = async (req, res) => {
  try {
    // Get current UK day and hour
    const now = new Date();
    const ukFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = ukFormatter.formatToParts(now);
    const currentDay = parts.find(p => p.type === 'weekday').value.toLowerCase();
    const hour = parts.find(p => p.type === 'hour').value;
    const minute = parts.find(p => p.type === 'minute').value;
    const currentTime = `${hour}:${minute}`;

    console.log(`Checking for reports due: ${currentDay} ${currentTime}`);

    // Find channels due now from Supabase
    const channels = await supabaseGet(
      `slack_channels?select=channel_id,client_id,clients(id,name,slug)&schedule_day=eq.${currentDay}&schedule_time=eq.${currentTime}&is_active=eq.true`
    );

    console.log(`Found ${channels.length} channels to report to`);

    for (const channel of channels) {
      try {
        const clientUuid = channel.client_id;
        const client = { client_id: channel.clients.slug, client_name: channel.clients.name };

        // Pull data from Supabase (last 90 days max)
        const [gscData, gaData, attributionData] = await Promise.all([
          supabaseGet(
            `analytics_gsc_daily?select=data_date,impressions,clicks,ctr,avg_position&client_id=eq.${clientUuid}&order=data_date.desc&limit=90`
          ),
          supabaseGet(
            `analytics_ga4_daily?select=event_date,sessions,active_users,new_users,engaged_sessions,engagement_rate&client_id=eq.${clientUuid}&order=event_date.desc&limit=90`
          ),
          supabaseGet(
            `analytics_attribution_daily?select=event_date,event_name,source,medium,campaign,sessions,users&client_id=eq.${clientUuid}&order=event_date.desc,sessions.desc&limit=500`
          )
        ]);

        const analysis = await callClaude(client, gscData, gaData, attributionData, 'Give me a weekly performance report');
        const chartUrl = buildChartUrl(gaData);

        // Post to channel via chat.postMessage
        const blocks = buildBlocks(client, analysis, chartUrl);
        await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
          },
          body: JSON.stringify({
            channel: channel.channel_id,
            text: `Weekly Analytics Report for ${client.client_name}`,
            blocks
          })
        });

        // Update last_report_sent
        await supabasePatch(
          'slack_channels',
          `channel_id=eq.${channel.channel_id}`,
          { last_report_sent: new Date().toISOString() }
        );

        console.log(`Report sent to ${channel.channel_id} (${client.client_name})`);
      } catch (error) {
        console.error(`Error sending report to ${channel.channel_id}:`, error);
      }
    }

    res.json({ success: true, sent: channels.length });
  } catch (error) {
    console.error('Scheduled reports error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ─── Claude API ───────────────────────────────────────────────────────────────

async function callClaude(client, gscData, gaData, attributionData, question) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: `You are a senior analytics consultant for ${client.client_name}. You have access to their daily Google Analytics (GA4), Google Search Console (GSC), and session attribution data.

Today's date: ${new Date().toISOString().split('T')[0]}

COMPARISON RULES
- By default, always compare data to the previous week (this week vs last week)
- If the user specifies a time period (e.g. "this month", "this quarter"), compare with the equivalent previous period (e.g. last month, last quarter)
- "this week" = Monday of the current week to today
- "last week" = the previous full Monday-Sunday
- "this month" = 1st of the current month to today
- "last month" = the previous full calendar month
- "this quarter" = current quarter to date
- If a period is incomplete (e.g. mid-week), note this and compare like-for-like days where possible
- Always calculate exact numbers for both periods and show the % change

WHAT TO REPORT
- SEO-specific questions: only report Search Console metrics (impressions, clicks, CTR, average position)
- Traffic-specific questions: only report GA4 metrics (sessions, active users, new users, engagement rate)
- Attribution/channel questions (e.g. "where is my traffic coming from?", "which channels are performing?"): report from the attribution data showing top sources
- General questions about site performance (e.g. "how is my site doing?"): report on all three sections: Search Console, GA4, and Traffic Attribution

FORMATTING
This response will be displayed in Slack. Use Slack markup only:
- Bold: *text* (not **text** or ## text)
- Italic: _text_
- No markdown headings (# or ##). Use *bold text* on its own line for section headers
- Use standard hyphens for bullet points

RESPONSE FORMAT

Section 1 - Data

Bullet points only. One metric per line. Show the metric name, the raw total number, the % change from the previous period, and a traffic light emoji.

Format each line exactly like this:
- *Active Users:* 1,400 - Up 14% from last week 🟢
- *Sessions:* 3,000 - Down 15% from last week 🔴
- *Engagement Rate:* 62% - Flat 🟡

Traffic light rules: 🟢 = improving or strong, 🟡 = flat or mixed, 🔴 = declining or needs attention

If reporting on both Search Console and GA4 data, separate them with a line break and a bold header:

*SEO*
- *Impressions:* 12,000 - Up 10% from last week 🟢
- *Clicks:* 800 - Down 3% from last week 🔴
- *CTR:* 6.7% - Down 0.8% from last week 🔴
- *Avg Position:* 18.2 - Improved from 19.5 last week 🟢

*Website Traffic*
- *Sessions:* 3,000 - Down 15% from last week 🔴
- *Active Users:* 1,400 - Up 14% from last week 🟢
- *Engagement Rate:* 62% - Flat 🟡

*Traffic Attribution*
Show the top traffic sources for the period, sorted by users descending. Use pipe-separated format with source, medium, raw user total, and percentage of total users. Only show sources that contribute meaningfully (top 5-8 sources). Format exactly like this:

- Google | Organic | 3,000 | 54%
- Google | CPC | 800 | 14%
- Direct | None | 650 | 12%
- Facebook | Referral | 400 | 7%

Section 2 - Analysis & Recommendations

Separate this section from the data with a line break. Use *Analysis & Recommendations* as a bold header.

Bullet points only. Each bullet is one actionable recommendation with a short justification explaining how the data led to that conclusion. Keep each bullet to one or two sentences max. Only include recommendations that are genuinely relevant to what the data shows. Example format:

- Audit meta titles on your top 10 landing pages. CTR dropped 0.8% while impressions held steady, which suggests your listings are less compelling in search results.
- Double down on organic content. Google organic drives 54% of all traffic and grew 12% this week.

TONE AND RULES
- Be direct and honest about the numbers. Never obscure bad news
- Always pair bad news with a constructive next step
- No emdashes
- No hedging ("it seems", "it appears")
- No waffle or filler
- Always express changes as percentages using the % symbol. Never use "pp" or "percentage points"
- If the data doesn't cover what they're asking, say so directly`,
      messages: [{
        role: 'user',
        content: `Client: ${client.client_name}

Search Console daily data (most recent first):
${JSON.stringify(gscData)}

GA4 daily data (most recent first):
${JSON.stringify(gaData)}

Attribution data - sessions by source/medium/campaign (most recent first):
${JSON.stringify(attributionData)}

Question: ${question}`
      }]
    })
  });

  const data = await response.json();

  if (data.error) {
    console.error('Claude API error:', JSON.stringify(data.error));
    throw new Error(`Claude API error: ${data.error.message}`);
  }

  return data.content[0].text;
}

// ─── Chart generation via QuickChart.io ───────────────────────────────────────

function buildChartUrl(gaData) {
  const recent = gaData
    .filter(d => d.event_date)
    .slice(0, 14)
    .reverse();

  if (recent.length < 2) return null;

  const labels = recent.map(d => {
    const date = new Date(d.event_date);
    return `${date.getDate()}/${date.getMonth() + 1}`;
  });

  const sessionsData = recent.map(d => d.sessions || 0);
  const usersData = recent.map(d => d.active_users || 0);

  const chartConfig = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Sessions',
          data: sessionsData,
          borderColor: '#4A90D9',
          backgroundColor: 'rgba(74, 144, 217, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3
        },
        {
          label: 'Active Users',
          data: usersData,
          borderColor: '#7B68EE',
          backgroundColor: 'rgba(123, 104, 238, 0.05)',
          fill: false,
          tension: 0.3,
          pointRadius: 3,
          borderDash: [5, 5]
        }
      ]
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 20 } }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: '#f0f0f0' } },
        x: { grid: { display: false } }
      }
    }
  };

  const encoded = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encoded}&w=600&h=300&bkg=white`;
}

// ─── Slack Block Kit response ─────────────────────────────────────────────────

function buildBlocks(client, analysis, chartUrl) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📊 ${client.client_name} Analytics`, emoji: true }
    },
    { type: 'divider' }
  ];

  if (chartUrl) {
    blocks.push({
      type: 'image',
      image_url: chartUrl,
      alt_text: `Daily sessions and users trend for ${client.client_name}`
    });
    blocks.push({ type: 'divider' });
  }

  // Split into multiple blocks if over Slack's 3000 char limit
  const maxLen = 3000;
  if (analysis.length <= maxLen) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: analysis } });
  } else {
    let remaining = analysis;
    while (remaining.length > 0) {
      let chunk = remaining.slice(0, maxLen);
      if (remaining.length > maxLen) {
        const lastNewline = chunk.lastIndexOf('\n');
        if (lastNewline > maxLen * 0.5) chunk = chunk.slice(0, lastNewline);
      }
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk } });
      remaining = remaining.slice(chunk.length);
    }
  }

  return blocks;
}

// ─── Slack helpers ────────────────────────────────────────────────────────────

async function postToSlack(responseUrl, text) {
  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_type: 'in_channel', text })
  });
}

async function postBlocksToSlack(responseUrl, client, analysis, chartUrl) {
  const blocks = buildBlocks(client, analysis, chartUrl);
  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response_type: 'in_channel',
      text: `Analytics report for ${client.client_name}`,
      blocks
    })
  });
}
