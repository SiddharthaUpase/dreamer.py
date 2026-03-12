-- Fix messages table to properly store LangChain message types
-- Currently: role only allows ('user', 'assistant'), missing tool_calls/tool_call_id/name columns
-- After: role allows ('human', 'ai', 'tool'), all LangChain fields persisted

-- 1. Wipe old messages — they lack tool_calls/tool_call_id and are unrecoverable
DELETE FROM messages;

-- 2. Drop the old role constraint
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;

-- 3. Add new constraint with all 3 roles
ALTER TABLE messages ADD CONSTRAINT messages_role_check
  CHECK (role IN ('human', 'ai', 'tool'));

-- 4. Add columns for tool call tracking
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_calls jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_call_id text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS name text;

-- 5. Drop legacy 'tools' column (was UI-only display, always null now)
ALTER TABLE messages DROP COLUMN IF EXISTS tools;

-- 6. Index for tool_call_id lookups
CREATE INDEX IF NOT EXISTS idx_messages_tool_call_id
  ON messages(tool_call_id) WHERE tool_call_id IS NOT NULL;
