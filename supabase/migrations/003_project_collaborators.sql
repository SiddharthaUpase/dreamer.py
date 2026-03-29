create table if not exists project_collaborators (
  project_id  text references projects(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz default now(),
  primary key (project_id, user_id)
);

create index if not exists project_collaborators_user_id_idx on project_collaborators(user_id);
create index if not exists project_collaborators_project_id_idx on project_collaborators(project_id);
