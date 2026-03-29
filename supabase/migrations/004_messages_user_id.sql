-- Add user_id to messages for per-user history scoping in shared projects
alter table messages add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists messages_user_id_idx on messages(user_id);
