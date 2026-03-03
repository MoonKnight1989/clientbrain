-- Add folder_membership, summary_text, and owner to meeting_notes

ALTER TABLE meeting_notes ADD COLUMN folder_membership JSONB;  -- [{object, id, name}]
ALTER TABLE meeting_notes ADD COLUMN summary_text TEXT;
ALTER TABLE meeting_notes ADD COLUMN owner JSONB;              -- {name, email}
