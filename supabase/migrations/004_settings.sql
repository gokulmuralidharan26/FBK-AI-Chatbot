-- Settings table for runtime feature flags (e.g. Tavily web search toggle)
create table if not exists settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- Seed default values
insert into settings (key, value) values ('tavily_enabled', 'false')
  on conflict (key) do nothing;

-- RLS: service role full access, anon read-only
alter table settings enable row level security;

create policy "service role full access" on settings
  for all using (auth.role() = 'service_role');

create policy "anon read" on settings
  for select using (true);
