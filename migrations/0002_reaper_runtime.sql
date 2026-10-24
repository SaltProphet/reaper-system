create table if not exists reaper_workflows (
  id text primary key,
  user_id text not null,
  name text not null,
  version integer not null default 1,
  definition jsonb not null,
  legacy_imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index if not exists reaper_workflows_user_updated_idx
  on reaper_workflows (user_id, updated_at desc);

create table if not exists reaper_runs (
  id text primary key,
  user_id text not null,
  workflow_id text not null references reaper_workflows(id) on delete cascade,
  workflow_version integer not null,
  version integer not null default 1,
  status text not null check (status in ('running', 'paused', 'done', 'failed')),
  workflow_snapshot jsonb not null,
  run_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index if not exists reaper_runs_user_updated_idx
  on reaper_runs (user_id, updated_at desc);
create index if not exists reaper_runs_workflow_idx
  on reaper_runs (user_id, workflow_id, updated_at desc);
