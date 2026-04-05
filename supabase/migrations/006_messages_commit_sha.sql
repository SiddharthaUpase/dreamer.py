-- Add commit_sha to messages for git integration
ALTER TABLE messages ADD COLUMN IF NOT EXISTS commit_sha text;

-- Index for looking up messages by commit
CREATE INDEX IF NOT EXISTS idx_messages_commit_sha
  ON messages(commit_sha) WHERE commit_sha IS NOT NULL;
