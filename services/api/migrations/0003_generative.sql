-- Generative images: studio-quality garment photos and the user's avatar (photos of their face
-- and full body, and renders of them wearing an outfit).
--
-- Both are opt-in with their own consents. The user's own photos are personal data (RGPD) and are
-- never used to identify anyone: they are only the input for the user's own avatar renders, are
-- served through signed URLs like every other image, and are deleted with the consent, the avatar
-- or the account.

alter table consents drop constraint consents_kind_check;
alter table consents add constraint consents_kind_check check (kind in (
  'terms', 'privacy', 'photo_processing', 'location', 'calendar', 'email_import', 'ai_assistant_external',
  'analytics', 'marketing', 'ai_image_generation', 'avatar'
));

alter table garment_images drop constraint garment_images_kind_check;
alter table garment_images add constraint garment_images_kind_check check (kind in (
  'original', 'cutout', 'product_reference', 'label', 'receipt', 'screenshot', 'inspiration', 'visual_search',
  -- generated product photo of an owned garment (always derived from its own cutout)
  'studio',
  -- the user's own photos for the avatar, and generated renders of the user wearing an outfit
  'self_face', 'self_body', 'avatar_render'
));
-- Generated images are not the user's photographs: they say which model made them.
alter table garment_images add column generated_by text;

create table avatar_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  face_image_id uuid references garment_images(id) on delete set null,
  body_image_id uuid references garment_images(id) on delete set null,
  -- The user confirmed the photos are of themselves and that they are an adult.
  attested_self boolean not null default false,
  attested_adult boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('studio', 'avatar')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'rejected')),
  garment_id uuid references garments(id) on delete cascade,
  outfit_id uuid references outfits(id) on delete cascade,
  input jsonb not null default '{}',
  result_image_id uuid references garment_images(id) on delete set null,
  model text,
  workflow text,
  -- Fidelity check against the real garment(s): similarity, colour difference, verdict.
  fidelity jsonb,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  check ((kind = 'studio' and garment_id is not null) or (kind = 'avatar' and outfit_id is not null))
);
create index generation_jobs_user_idx on generation_jobs(user_id, created_at desc);
create index generation_jobs_garment_idx on generation_jobs(garment_id) where garment_id is not null;
create index generation_jobs_outfit_idx on generation_jobs(outfit_id) where outfit_id is not null;

do $$
declare
  t text;
begin
  foreach t in array array['avatar_profiles', 'generation_jobs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I using (user_id = app_current_user_id()) with check (user_id = app_current_user_id())', t || '_owner', t);
    execute format('grant select, insert, update, delete on %I to dressit_app', t);
  end loop;
end $$;

-- Retention: failed/rejected jobs and their inputs are purged after 7 days (see maintenance).
grant select, delete on generation_jobs to dressit_maintenance;
create policy generation_jobs_retention on generation_jobs for all to dressit_maintenance using (true);
