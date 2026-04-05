-- Agent jobs: one row per agent run. Enables async execution + refresh-safe streaming.
create table if not exists agent_jobs (
  id uuid default gen_random_uuid() primary key,
  project_id text not null,
  worktree_id text not null default 'main',
  user_id text not null,
  status text not null default 'queued',  -- queued | running | completed | failed | aborted
  message text not null,
  model text not null default 'mimo',
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_agent_jobs_project_worktree on agent_jobs (project_id, worktree_id);
create index if not exists idx_agent_jobs_status on agent_jobs (status);
create index if not exists idx_agent_jobs_user on agent_jobs (user_id);

-- Agent events: append-only event log for each job.
-- Frontend subscribes to this table via Supabase Realtime.
create table if not exists agent_events (
  id bigserial primary key,
  job_id uuid not null references agent_jobs(id) on delete cascade,
  type text not null,  -- token | tool_start | tool_end | result | error | aborted
  data jsonb not null default '{}',
  created_at timestamptz default now()
);

create index if not exists idx_agent_events_job_id on agent_events (job_id);

-- Enable Realtime for both tables so the frontend can subscribe
alter publication supabase_realtime add table agent_events;
alter publication supabase_realtime add table agent_jobs;
