-- Catalogue photo of a garment ("foto de catálogo"): turns a home photo into a professional
-- product photo. First the real product is searched on the internet (reverse image search) and in
-- the authorised catalogues; when the very same product is found with an official photo that may
-- be used, it is proposed. Otherwise a generative model re-creates the garment as a packshot
-- (flat lay / ghost mannequin) from the user's photo, and the result is checked against the real
-- garment. The user chooses; their own photos are always kept.

-- Sending a garment photo to an external search service (Google Lens via SerpApi, Google Cloud
-- Vision, Lykdat) is a separate, revocable consent.
alter table consents drop constraint consents_kind_check;
alter table consents add constraint consents_kind_check check (kind in (
  'terms', 'privacy', 'photo_processing', 'location', 'calendar', 'email_import', 'ai_assistant_external',
  'analytics', 'marketing', 'ai_image_generation', 'avatar', 'visual_search_external'
));

create table catalog_photo_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  garment_id uuid references garments(id) on delete cascade,
  detection_id uuid references import_detections(id) on delete set null,
  -- The user's photo and the garment's cutout in it (the generator works from the photo, the
  -- checks compare against the cutout).
  source_image_id uuid not null references garment_images(id) on delete cascade,
  cutout_image_id uuid references garment_images(id) on delete set null,
  bbox jsonb,
  trigger text not null check (trigger in ('import', 'manual', 'regenerate')),
  -- auto: search, then generate if no usable official photo; search / generate: only that step.
  mode text not null default 'auto' check (mode in ('auto', 'search', 'generate')),
  status text not null default 'queued' check (status in (
    'queued', 'searching', 'generating', 'ready', 'needs_user', 'failed', 'confirmed', 'dismissed'
  )),
  stage jsonb,
  -- Reverse search: providers asked (or skipped and why), queries, OCR text/brand, cost.
  search jsonb not null default '{}',
  -- Verified candidates (exact / possible) with scores, provenance and usage rights.
  candidates jsonb not null default '[]',
  official_match_id text,
  official_image_id uuid references garment_images(id) on delete set null,
  generated_image_id uuid references garment_images(id) on delete set null,
  -- Generation attempts: provider, model, prompt version, checks and reasons.
  generation jsonb not null default '{}',
  choice text check (choice in ('official', 'generated', 'original')),
  cost_cents numeric(10, 3) not null default 0,
  message text,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index catalog_photo_jobs_user_idx on catalog_photo_jobs(user_id, created_at desc);
create index catalog_photo_jobs_garment_idx on catalog_photo_jobs(garment_id, created_at desc) where garment_id is not null;
create index catalog_photo_jobs_detection_idx on catalog_photo_jobs(detection_id) where detection_id is not null;
create trigger catalog_photo_jobs_updated before update on catalog_photo_jobs for each row execute function set_updated_at();

-- Cache of external search responses for the same photo bytes (sha256) and parameters, so a
-- retried or regenerated job does not pay twice.
create table visual_search_cache (
  user_id uuid not null references users(id) on delete cascade,
  key text not null,
  provider text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Calls and estimated cost per user, provider and day: per-user daily limits and a monthly budget.
create table external_api_usage (
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  day date not null default current_date,
  calls int not null default 0,
  cost_cents numeric(10, 3) not null default 0,
  primary key (user_id, provider, day)
);

do $$
declare
  t text;
begin
  foreach t in array array['catalog_photo_jobs', 'visual_search_cache', 'external_api_usage'] loop
    execute format('alter table %I enable row level security', t);
    -- external_api_usage is not FORCEd: the owner-run budget function below sums every user's rows.
    if t <> 'external_api_usage' then
      execute format('alter table %I force row level security', t);
    end if;
    execute format('create policy %I on %I using (user_id = app_current_user_id()) with check (user_id = app_current_user_id())', t || '_owner', t);
    execute format('grant select, insert, update, delete on %I to dressit_app', t);
  end loop;
end $$;

-- This month's spend of every user and paid provider together (budget guard), without exposing
-- anyone's rows.
create function external_api_month_cost() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_cents), 0) from external_api_usage
  where day >= date_trunc('month', current_date)::date
$$;
revoke all on function external_api_month_cost() from public;
grant execute on function external_api_month_cost() to dressit_app;

-- Retention: cached search responses after 30 days, dismissed/failed jobs after 30 days.
grant select, delete on visual_search_cache, catalog_photo_jobs, external_api_usage to dressit_maintenance;
create policy visual_search_cache_retention on visual_search_cache for all to dressit_maintenance using (true);
create policy catalog_photo_jobs_retention on catalog_photo_jobs for all to dressit_maintenance using (true);
create policy external_api_usage_retention on external_api_usage for all to dressit_maintenance using (true);
