-- Add state column and enrichment tracking to alumni table
alter table alumni add column if not exists state text;
alter table alumni add column if not exists enriched_at timestamptz;
alter table alumni add column if not exists enrichment_source text; -- 'pdl', 'facebook_csv', 'manual'

-- Index for fast state-level filtering
create index if not exists alumni_state_idx on alumni (state);
create index if not exists alumni_industry_idx on alumni (industry);
create index if not exists alumni_tapping_class_idx on alumni (tapping_class);
