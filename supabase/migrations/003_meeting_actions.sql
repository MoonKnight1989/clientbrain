-- Quest 0.1: Meeting Actions tables
-- Tables: client_domains, meeting_notes, meeting_tasks

-- Maps email domains to client IDs for automatic meeting attribution
CREATE TABLE client_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  domain TEXT NOT NULL UNIQUE, -- e.g. 'noan.com', 'atlashps.com'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_client_domains_domain ON client_domains(domain);

-- Stores Granola meeting notes linked to clients
CREATE TABLE meeting_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL, -- null = unmatched or not a client meeting
  granola_note_id TEXT UNIQUE NOT NULL, -- Granola's note ID for dedup
  title TEXT,
  attendees JSONB, -- [{ "name": "...", "email": "..." }]
  summary_markdown TEXT, -- Granola's AI summary
  transcript TEXT, -- full transcript
  calendar_event JSONB, -- { "start": "...", "end": "...", "title": "..." }
  match_method TEXT, -- 'domain', 'slack_fallback', 'not_client', null (pending)
  status TEXT DEFAULT 'pending', -- 'pending', 'matched', 'tasks_extracted'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_meeting_notes_client ON meeting_notes(client_id, created_at);
CREATE INDEX idx_meeting_notes_status ON meeting_notes(status);

-- Stores extracted tasks from meeting notes (populated in Quest 0.3)
CREATE TABLE meeting_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_note_id UUID REFERENCES meeting_notes(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  task_name TEXT NOT NULL, -- verb-led task name
  description TEXT, -- 3-5 sentence context from meeting
  task_type TEXT NOT NULL, -- 'agency' or 'client'
  due_date DATE, -- explicit from notes or +7 days
  asana_task_id TEXT, -- Asana task GID once created
  status TEXT DEFAULT 'created', -- 'created', 'synced_to_asana'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_meeting_tasks_meeting ON meeting_tasks(meeting_note_id);
CREATE INDEX idx_meeting_tasks_client ON meeting_tasks(client_id);

-- RLS
ALTER TABLE client_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON client_domains FOR ALL USING (true);
CREATE POLICY "Service role full access" ON meeting_notes FOR ALL USING (true);
CREATE POLICY "Service role full access" ON meeting_tasks FOR ALL USING (true);
