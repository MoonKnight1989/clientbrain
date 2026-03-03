-- Add meeting_date to meeting_notes for when the meeting actually happened
-- (distinct from created_at which is when we stored it)

ALTER TABLE meeting_notes ADD COLUMN meeting_date TIMESTAMPTZ;

CREATE INDEX idx_meeting_notes_meeting_date ON meeting_notes(meeting_date);

-- Backfill existing rows from calendar_event data
UPDATE meeting_notes
SET meeting_date = (calendar_event->>'scheduled_start_time')::timestamptz
WHERE calendar_event->>'scheduled_start_time' IS NOT NULL;
