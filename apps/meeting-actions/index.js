import functions from '@google-cloud/functions-framework';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GRANOLA_API_KEY = process.env.GRANOLA_API_KEY;
const AGENCY_DOMAIN = 'massive-marketing.co.uk';

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

// --- Granola API ---

async function listRecentNotes() {
  // Fetch notes updated in the last hour (overlap window for safety)
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

  // Try each folder name against client names (case-insensitive)
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

  // Store in Supabase
  await supabaseQuery('meeting_notes', {
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
    headers: { 'Prefer': 'return=minimal' },
  });

  console.log(`  Stored: "${note.title}" (${status})`);
  return { status: 'processed', noteId, title: note.title, matched: !!clientId, clientId };
}

// --- Main handler (Cloud Scheduler, every 15 min) ---

functions.http('pollGranolaNotes', async (req, res) => {
  try {
    console.log('Polling Granola for new notes...');

    // List notes updated in the last hour
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
