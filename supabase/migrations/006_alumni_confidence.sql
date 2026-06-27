-- Add confidence tracking to alumni table
alter table alumni add column if not exists confidence float default null;

-- Index for filtering high-confidence results
create index if not exists alumni_confidence_idx on alumni (confidence);
