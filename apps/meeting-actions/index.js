import functions from '@google-cloud/functions-framework';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GRANOLA_API_KEY = process.env.GRANOLA_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const AGENCY_DOMAIN = 'massive-marketing.co.uk';

// Common personal email domains — skip these for domain auto-learn
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'aol.com', 'mail.com',
]);

// --- Supabase helpers ---

async function supabaseQuery(table, { method = 'GET', body, query = '', headers: extraHeaders = {} } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${method} ${table} failed (${res.status}): ${err}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// --- Slack helpers ---

async function slackApi(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack ${method} failed: ${data.error}`);
  }
  return data;
}

async function lookupSlackUser(email) {
  try {
    const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` },
    });
    const data = await res.json();
    return data.ok ? data.user?.id || null : null;
  } catch {
    return null;
  }
}

async function sendSlackDM(slackUserId, meetingNoteId, title, attendees, clients) {
  // Build client buttons (max 5 per row, Slack limit)
  const clientButtons = clients.map(c => ({
    type: 'button',
    text: { type: 'plain_text', text: c.name },
    value: JSON.stringify({ noteId: meetingNoteId, clientId: c.id }),
    action_id: `assign_client_${c.id}`,
  }));

  const notClientButton = {
    type: 'button',
    text: { type: 'plain_text', text: 'Not a client meeting' },
    value: JSON.stringify({ noteId: meetingNoteId, clientId: 'not_client' }),
    action_id: 'assign_not_client',
    style: 'danger',
  };

  // Split into rows of 5
  const buttonRows = [];
  for (let i = 0; i < clientButtons.length; i += 5) {
    buttonRows.push({
      type: 'actions',
      elements: clientButtons.slice(i, i + 5),
    });
  }
  buttonRows.push({ type: 'actions', elements: [notClientButton] });

  const attendeeList = attendees
    .filter(a => a.email && !a.email.endsWith(`@${AGENCY_DOMAIN}`))
    .map(a => a.name ? `${a.name} (${a.email})` : a.email)
    .join(', ') || 'No external attendees';

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Unmatched meeting:* ${title}\n*Attendees:* ${attendeeList}\n\nWhich client is this for?`,
      },
    },
    ...buttonRows,
  ];

  await slackApi('chat.postMessage', {
    channel: slackUserId,
    text: `Unmatched meeting: ${title}`,
    blocks,
  });
}

// --- Granola API ---

async function listRecentNotes() {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const res = await fetch(`https://public-api.granola.ai/v1/notes?updated_after=${since}&page_size=30`, {
    headers: {
      'Authorization': `Bearer ${GRANOLA_API_KEY}`,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Granola list API failed (${res.status}): ${err}`);
  }

  return res.json();
}

async function fetchGranolaNote(noteId) {
  const res = await fetch(`https://public-api.granola.ai/v1/notes/${noteId}?include=transcript`, {
    headers: {
      'Authorization': `Bearer ${GRANOLA_API_KEY}`,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Granola API failed (${res.status}): ${err}`);
  }

  return res.json();
}

// --- Domain matching ---

function extractDomains(attendees) {
  const domains = new Set();

  for (const attendee of attendees) {
    const email = attendee.email;
    if (!email) continue;

    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) continue;

    if (domain === AGENCY_DOMAIN) continue;

    domains.add(domain);
  }

  return [...domains];
}

async function matchClientByDomains(domains) {
  if (domains.length === 0) return null;

  const domainFilter = domains.map(d => `domain.eq.${d}`).join(',');
  const results = await supabaseQuery('client_domains', {
    query: `?or=(${domainFilter})&select=client_id,domain`,
  });

  if (results && results.length > 0) {
    return results[0].client_id;
  }

  return null;
}

async function matchClientByFolder(folderMembership) {
  if (!folderMembership || folderMembership.length === 0) return null;

  const folderNames = folderMembership.map(f => f.name).filter(Boolean);
  if (folderNames.length === 0) return null;

  const clients = await supabaseQuery('clients', {
    query: '?select=id,name',
  });

  if (!clients) return null;

  for (const folder of folderNames) {
    const match = clients.find(c =>
      c.name.toLowerCase() === folder.toLowerCase()
    );
    if (match) return match.id;
  }

  return null;
}

// --- Process a single note ---

async function processNote(noteId) {
  // Check for duplicate
  const existing = await supabaseQuery('meeting_notes', {
    query: `?granola_note_id=eq.${noteId}&select=id`,
  });

  if (existing && existing.length > 0) {
    console.log(`  Skipping ${noteId} — already processed`);
    return { status: 'duplicate', noteId };
  }

  // Fetch full note with transcript
  const note = await fetchGranolaNote(noteId);
  console.log(`  Fetched: "${note.title}" (${note.attendees?.length || 0} attendees)`);

  // Match client: domain first, then folder name fallback
  const attendees = note.attendees || [];
  const externalDomains = extractDomains(attendees);
  let clientId = await matchClientByDomains(externalDomains);
  let matchMethod = clientId ? 'domain' : null;

  if (!clientId) {
    clientId = await matchClientByFolder(note.folder_membership);
    matchMethod = clientId ? 'folder' : null;
  }

  const status = clientId ? 'matched' : 'pending';

  console.log(`  Domains: ${externalDomains.join(', ') || 'none'} → ${matchMethod ? `${matchMethod}: ${clientId}` : 'no match'}`);

  // Extract meeting date from calendar event, fall back to Granola created_at
  const calEvent = note.calendar_event || null;
  const meetingDate = calEvent?.scheduled_start_time || note.created_at || null;

  // Store in Supabase (use return=representation to get the row ID back)
  const inserted = await supabaseQuery('meeting_notes', {
    method: 'POST',
    body: {
      granola_note_id: noteId,
      client_id: clientId,
      title: note.title || 'Untitled Meeting',
      meeting_date: meetingDate,
      attendees: attendees.map(a => ({ name: a.name, email: a.email })),
      summary_markdown: note.summary_markdown || null,
      summary_text: note.summary_text || null,
      transcript: note.transcript || null,
      calendar_event: calEvent,
      folder_membership: note.folder_membership || null,
      owner: note.owner || null,
      match_method: matchMethod,
      status,
    },
    headers: { 'Prefer': 'return=representation' },
  });

  const meetingNoteId = inserted?.[0]?.id;

  // If unmatched, DM the meeting owner in Slack
  if (!clientId && SLACK_BOT_TOKEN && note.owner?.email) {
    try {
      const slackUserId = await lookupSlackUser(note.owner.email);
      if (slackUserId) {
        const clients = await supabaseQuery('clients', {
          query: '?select=id,name&status=eq.active&order=name',
        });
        if (clients && clients.length > 0) {
          await sendSlackDM(slackUserId, meetingNoteId, note.title, attendees, clients);
          console.log(`  Slack DM sent to ${note.owner.email}`);
        }
      } else {
        console.log(`  Could not find Slack user for ${note.owner.email}`);
      }
    } catch (err) {
      console.error(`  Slack notification failed: ${err.message}`);
    }
  }

  console.log(`  Stored: "${note.title}" (${status})`);
  return { status: 'processed', noteId, title: note.title, matched: !!clientId, clientId };
}

// --- Main handler (Cloud Scheduler, every 15 min) ---

functions.http('pollGranolaNotes', async (req, res) => {
  try {
    console.log('Polling Granola for new notes...');

    const { notes } = await listRecentNotes();
    console.log(`Found ${notes.length} recent notes`);

    if (notes.length === 0) {
      res.status(200).json({ status: 'ok', processed: 0 });
      return;
    }

    const results = [];
    for (const note of notes) {
      try {
        const result = await processNote(note.id);
        results.push(result);
      } catch (err) {
        console.error(`  Error processing ${note.id}: ${err.message}`);
        results.push({ status: 'error', noteId: note.id, error: err.message });
      }
    }

    const processed = results.filter(r => r.status === 'processed').length;
    const duplicates = results.filter(r => r.status === 'duplicate').length;
    const errors = results.filter(r => r.status === 'error').length;

    console.log(`Done — ${processed} new, ${duplicates} skipped, ${errors} errors`);

    res.status(200).json({ status: 'ok', processed, duplicates, errors, results });
  } catch (err) {
    console.error('Polling error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Interactivity handler (Slack button responses) ---

functions.http('meetingInteractivity', async (req, res) => {
  try {
    // Slack sends form-encoded payload
    const payload = JSON.parse(req.body.payload);

    if (payload.type !== 'block_actions' || !payload.actions?.[0]) {
      res.status(200).send('');
      return;
    }

    const action = payload.actions[0];
    const { noteId, clientId } = JSON.parse(action.value);
    const userId = payload.user?.id;

    console.log(`Interactivity: noteId=${noteId} clientId=${clientId} user=${userId}`);

    if (clientId === 'not_client') {
      // Mark as not a client meeting
      await supabaseQuery('meeting_notes', {
        method: 'PATCH',
        query: `?id=eq.${noteId}`,
        body: {
          client_id: null,
          match_method: 'not_client',
          status: 'matched',
        },
      });

      // Update the Slack message
      await slackApi('chat.update', {
        channel: payload.channel.id,
        ts: payload.message.ts,
        text: 'Meeting marked as not a client meeting.',
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: '*Marked as not a client meeting.*' },
        }],
      });

      console.log(`  Note ${noteId} marked as not_client`);
      res.status(200).send('');
      return;
    }

    // Assign to client
    await supabaseQuery('meeting_notes', {
      method: 'PATCH',
      query: `?id=eq.${noteId}`,
      body: {
        client_id: clientId,
        match_method: 'slack_fallback',
        status: 'matched',
      },
    });

    // Auto-learn: add non-personal attendee domains to client_domains
    const meetingNotes = await supabaseQuery('meeting_notes', {
      query: `?id=eq.${noteId}&select=attendees`,
    });

    if (meetingNotes?.[0]?.attendees) {
      const domains = extractDomains(meetingNotes[0].attendees);
      const learnableDomains = domains.filter(d => !PERSONAL_DOMAINS.has(d));

      for (const domain of learnableDomains) {
        const existing = await supabaseQuery('client_domains', {
          query: `?domain=eq.${domain}&select=id`,
        });

        if (!existing || existing.length === 0) {
          await supabaseQuery('client_domains', {
            method: 'POST',
            body: { client_id: clientId, domain },
            headers: { 'Prefer': 'return=minimal' },
          });
          console.log(`  Auto-learned domain: ${domain} → ${clientId}`);
        }
      }
    }

    // Get client name for the confirmation message
    const clients = await supabaseQuery('clients', {
      query: `?id=eq.${clientId}&select=name`,
    });
    const clientName = clients?.[0]?.name || 'Unknown';

    // Update the Slack message
    await slackApi('chat.update', {
      channel: payload.channel.id,
      ts: payload.message.ts,
      text: `Meeting assigned to ${clientName}.`,
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*Assigned to ${clientName}.*` },
      }],
    });

    console.log(`  Note ${noteId} assigned to ${clientName} via Slack`);
    res.status(200).send('');
  } catch (err) {
    console.error('Interactivity error:', err.message);
    res.status(200).send('');
  }
});
