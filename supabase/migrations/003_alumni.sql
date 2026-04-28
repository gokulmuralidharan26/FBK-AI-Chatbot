-- ============================================================
-- FBK Alumni Network — alumni table + search function
-- Run in the Supabase SQL Editor after 001_init.sql
-- ============================================================

create table if not exists alumni (
  id           uuid        primary key default uuid_generate_v4(),
  full_name    text        not null,
  first_name   text,
  last_name    text,
  city         text,                    -- "New York, NY", "Tampa, FL", etc.
  company      text,
  role         text,
  industry     text,                    -- normalized tag: "Tech", "Finance", "Law", "Consulting", etc.
  facebook_url text,
  linkedin_url text,
  notes        text,
  tapping_class text,                   -- e.g. "FBK Fall 2022 Tapping Class"
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Full-text search index on name + company + industry + city
create index if not exists alumni_name_idx      on alumni using gin(to_tsvector('english', full_name));
create index if not exists alumni_city_idx      on alumni(lower(city));
create index if not exists alumni_industry_idx  on alumni(lower(industry));
create index if not exists alumni_company_idx   on alumni(lower(company));

-- RLS: service role can do everything; anon can read
alter table alumni enable row level security;

create policy "service role full access"
  on alumni for all
  using (auth.role() = 'service_role');

create policy "anon can read alumni"
  on alumni for select
  using (true);
