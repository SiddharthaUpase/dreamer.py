-- Projects table
create table if not exists projects (
  id          text primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text not null,
  template    text default 'blank',
  sandbox_id  text,
  preview_url text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Messages table
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  project_id  text references projects(id) on delete cascade not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  tools       jsonb,
  created_at  timestamptz default now()
);

-- Indexes
create index if not exists idx_projects_user_id on projects(user_id);
create index if not exists idx_messages_project_id on messages(project_id);
create index if not exists idx_messages_created_at on messages(project_id, created_at);

-- Enable RLS
alter table projects enable row level security;
alter table messages enable row level security;

-- Projects: users can only access their own
create policy "Users can select own projects"
  on projects for select
  using (auth.uid() = user_id);

create policy "Users can insert own projects"
  on projects for insert
  with check (auth.uid() = user_id);

create policy "Users can update own projects"
  on projects for update
  using (auth.uid() = user_id);

create policy "Users can delete own projects"
  on projects for delete
  using (auth.uid() = user_id);

-- Messages: users can access messages for their own projects
create policy "Users can select own project messages"
  on messages for select
  using (
    exists (
      select 1 from projects
      where projects.id = messages.project_id
      and projects.user_id = auth.uid()
    )
  );

create policy "Users can insert own project messages"
  on messages for insert
  with check (
    exists (
      select 1 from projects
      where projects.id = messages.project_id
      and projects.user_id = auth.uid()
    )
  );

create policy "Users can delete own project messages"
  on messages for delete
  using (
    exists (
      select 1 from projects
      where projects.id = messages.project_id
      and projects.user_id = auth.uid()
    )
  );

-- Service role bypass (for backend)
-- The service_role key bypasses RLS by default, so the backend
-- can access all data. No additional policies needed for that.
