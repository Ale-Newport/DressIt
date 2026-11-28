-- Persistent avatar and sequential virtual try-on.
--
-- avatar_bases: the user's reusable "studio" avatar images — their own full-body photo cut out and
-- placed on a studio background (no generation, identity untouched), plus optional generated views
-- (three-quarter, side) of that same base. Try-ons start from a base, so the user never has to send
-- photos again.
-- tryon_cache: every intermediate image of a sequential try-on, keyed by the base and the ordered
-- garments dressed so far. Changing one garment only re-runs the steps after it.

alter table garment_images drop constraint garment_images_kind_check;
alter table garment_images add constraint garment_images_kind_check check (kind in (
  'original', 'cutout', 'product_reference', 'label', 'receipt', 'screenshot', 'inspiration', 'visual_search',
  'studio', 'self_face', 'self_body', 'avatar_render', 'avatar_base', 'tryon_step'
));

create table avatar_bases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  view text not null check (view in ('frontal', 'tres_cuartos', 'perfil')),
  background text not null check (background in ('estudio_gris', 'blanco', 'beige', 'original')),
  status text not null default 'ready' check (status in ('generating', 'ready', 'failed')),
  image_id uuid references garment_images(id) on delete cascade,
  error text,
  created_at timestamptz not null default now(),
  unique (user_id, view, background)
);

create table tryon_cache (
  user_id uuid not null references users(id) on delete cascade,
  key text not null,
  image_id uuid not null references garment_images(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table generation_jobs add column progress jsonb;
alter table generation_jobs add column method text;
alter table generation_jobs add column avatar_base_id uuid references avatar_bases(id) on delete set null;
alter table generation_jobs drop constraint generation_jobs_kind_check;
alter table generation_jobs add constraint generation_jobs_kind_check check (kind in ('studio', 'avatar', 'avatar_view'));
alter table generation_jobs drop constraint generation_jobs_check;
alter table generation_jobs add constraint generation_jobs_check check (
  (kind = 'studio' and garment_id is not null) or (kind = 'avatar' and outfit_id is not null) or (kind = 'avatar_view' and avatar_base_id is not null)
);

do $$
declare
  t text;
begin
  foreach t in array array['avatar_bases', 'tryon_cache'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I using (user_id = app_current_user_id()) with check (user_id = app_current_user_id())', t || '_owner', t);
    execute format('grant select, insert, update, delete on %I to dressit_app', t);
  end loop;
end $$;

-- Intermediate try-on images are a cache: purged after 30 days (maintenance).
grant select, delete on tryon_cache to dressit_maintenance;
create policy tryon_cache_retention on tryon_cache for all to dressit_maintenance using (true);
