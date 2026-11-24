-- DressIt — esquema inicial
-- Convenciones:
--  * Todas las tablas con datos personales llevan user_id y una política RLS
--    `user_id = app_current_user_id()`. La API se conecta con el rol `dressit_app`
--    (no propietario), por lo que RLS se aplica siempre.
--  * El catálogo comercial (retailers, catalog_products…) es global y está
--    separado del inventario personal (garments…).
--  * Dinero en céntimos (int) + divisa ISO.

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;
create extension if not exists vector;
create extension if not exists unaccent;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dressit_app') then
    create role dressit_app nologin;
  end if;
end $$;

create or replace function app_current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Immutable wrapper so unaccent can be used in generated columns / indexes.
create or replace function immutable_unaccent(text) returns text
language sql immutable parallel safe strict as $$
  select public.unaccent('public.unaccent'::regdictionary, $1)
$$;

-- ===========================================================================
-- Users, auth, preferences, consents
-- ===========================================================================

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name text not null check (char_length(display_name) between 1 and 80),
  locale text not null default 'es-ES',
  timezone text not null default 'Europe/Madrid',
  location_name text,
  -- ubicación aproximada (2 decimales ≈ 1 km); nunca coordenadas precisas
  location_lat numeric(5,2) check (location_lat between -90 and 90),
  location_lon numeric(5,2) check (location_lon between -180 and 180),
  country_code char(2) not null default 'ES',
  plan text not null default 'free' check (plan in ('free', 'premium')),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated before update on users for each row execute function set_updated_at();

-- Credenciales y sesiones: sin RLS, solo accesibles desde el módulo de auth.
create table auth_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('password', 'apple', 'google')),
  subject citext not null,
  password_hash text,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, subject)
);
create index auth_identities_user_idx on auth_identities(user_id);

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  refresh_token_hash text not null unique,
  family_id uuid not null,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz
);
create index auth_sessions_user_idx on auth_sessions(user_id);
create index auth_sessions_family_idx on auth_sessions(family_id);

create table user_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  preferred_styles text[] not null default '{}',
  favorite_colors text[] not null default '{}',
  avoided_colors text[] not null default '{}',
  fit_preferences jsonb not null default '{}',
  sizes jsonb not null default '{}',
  favorite_brands text[] not null default '{}',
  budget_min_eur int check (budget_min_eur >= 0),
  budget_max_eur int check (budget_max_eur >= 0),
  second_hand boolean not null default false,
  prioritize_sustainable boolean not null default false,
  usual_contexts text[] not null default '{}',
  priorities jsonb not null default '{"comfort":0.4,"elegance":0.3,"practicality":0.3}',
  day_start time not null default '08:00',
  day_end time not null default '19:00',
  temperature_sensitivity smallint not null default 0 check (temperature_sensitivity between -2 and 2),
  updated_at timestamptz not null default now(),
  check (budget_min_eur is null or budget_max_eur is null or budget_min_eur <= budget_max_eur)
);
create trigger user_preferences_updated before update on user_preferences for each row execute function set_updated_at();

-- Perfil de estilo aprendido (pesos del ranking y afinidades), versionado.
create table style_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  style_weights jsonb not null default '{}',
  color_weights jsonb not null default '{}',
  ranking_weights jsonb not null default '{}',
  item_affinity jsonb not null default '{}',
  pair_affinity jsonb not null default '{}',
  feedback_count int not null default 0,
  model_version int not null default 1,
  updated_at timestamptz not null default now()
);

create table consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('terms', 'privacy', 'photo_processing', 'location', 'calendar', 'email_import', 'ai_assistant_external', 'analytics', 'marketing')),
  granted boolean not null,
  version text not null,
  created_at timestamptz not null default now()
);
-- histórico append-only; el estado vigente es la fila más reciente por (user, kind)
create index consents_user_kind_idx on consents(user_id, kind, created_at desc);

-- ===========================================================================
-- Wardrobe (inventario personal)
-- ===========================================================================

create table wardrobes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null default 'Mi armario',
  is_default boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index wardrobes_default_idx on wardrobes(user_id) where is_default;

create table wardrobe_spaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  wardrobe_id uuid not null references wardrobes(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null default 'armario' check (kind in ('armario', 'cajon', 'zapatero', 'almacenaje', 'maleta', 'otro')),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index wardrobe_spaces_user_idx on wardrobe_spaces(user_id, position);

-- ---------------------------------------------------------------------------
-- Retail (global, no personal data) — defined early because garments reference them
-- ---------------------------------------------------------------------------

create table retailers (
  id text primary key check (id ~ '^[a-z0-9_]+$'),
  name text not null,
  group_name text,
  domains text[] not null,
  country_codes text[] not null default '{ES}',
  website_url text not null,
  created_at timestamptz not null default now()
);

create table retailer_integrations (
  id uuid primary key default gen_random_uuid(),
  retailer_id text not null references retailers(id) on delete cascade,
  kind text not null check (kind in ('official_api', 'affiliate_feed', 'data_provider', 'public_catalog', 'link_import', 'page_capture', 'manual')),
  provider text not null,
  status text not null check (status in ('operational', 'partial', 'link_only', 'pending_authorization', 'disabled')),
  image_policy text not null default 'none' check (image_policy in ('licensed', 'link_preview', 'none')),
  capabilities jsonb not null default '{}',
  config jsonb not null default '{}',
  -- nombre de la variable de entorno con la credencial; nunca el secreto
  credentials_env text,
  requires text,
  notes text not null default '',
  last_checked_at timestamptz,
  last_check_result text,
  updated_at timestamptz not null default now(),
  unique (retailer_id, kind, provider)
);

create table catalog_products (
  id uuid primary key default gen_random_uuid(),
  retailer_id text not null references retailers(id),
  integration_id uuid references retailer_integrations(id) on delete set null,
  external_id text not null,
  title text not null,
  brand text,
  description text,
  category text,
  subcategory text,
  color_name text,
  color_family text,
  color_hexes text[] not null default '{}',
  materials text[] not null default '{}',
  styles text[] not null default '{}',
  audience text,
  product_url text not null,
  market char(2) not null default 'ES',
  currency char(3) not null default 'EUR',
  is_active boolean not null default true,
  is_sponsored boolean not null default false,
  data_quality numeric(3,2) not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_verified_at timestamptz,
  raw jsonb,
  search_text tsvector generated always as (
    to_tsvector('spanish', immutable_unaccent(coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(color_name, '') || ' ' || coalesce(subcategory, '')))
  ) stored,
  unique (retailer_id, external_id)
);
create index catalog_products_search_idx on catalog_products using gin(search_text);
create index catalog_products_filter_idx on catalog_products(is_active, category, subcategory, color_family);
create index catalog_products_retailer_idx on catalog_products(retailer_id, last_seen_at desc);

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references catalog_products(id) on delete cascade,
  external_variant_id text not null,
  color_name text,
  size_label text,
  sku text,
  gtin text check (gtin is null or gtin ~ '^[0-9]{8,14}$'),
  product_url text,
  unique (product_id, external_variant_id)
);
create index product_variants_gtin_idx on product_variants(gtin) where gtin is not null;

create table product_prices (
  id bigserial primary key,
  product_id uuid not null references catalog_products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,
  price_cents int not null check (price_cents >= 0),
  original_price_cents int check (original_price_cents >= 0),
  currency char(3) not null default 'EUR',
  source text not null check (source in ('feed', 'api', 'structured_data')),
  observed_at timestamptz not null default now()
);
create index product_prices_latest_idx on product_prices(product_id, observed_at desc);

create table product_availability (
  id bigserial primary key,
  product_id uuid not null references catalog_products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,
  availability text not null check (availability in ('in_stock', 'out_of_stock', 'preorder', 'unknown')),
  source text not null check (source in ('feed', 'api', 'structured_data')),
  observed_at timestamptz not null default now()
);
create index product_availability_latest_idx on product_availability(product_id, observed_at desc);

create table product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references catalog_products(id) on delete cascade,
  url text not null,
  position int not null default 0,
  license text not null check (license in ('licensed', 'link_preview')),
  attribution text,
  unique (product_id, url)
);

create table product_embeddings (
  product_id uuid primary key references catalog_products(id) on delete cascade,
  model text not null,
  image_url text,
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);
create index product_embeddings_hnsw on product_embeddings using hnsw (embedding vector_cosine_ops);

create table affiliate_links (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references catalog_products(id) on delete cascade,
  network text not null,
  url text not null,
  commission_note text,
  created_at timestamptz not null default now(),
  unique (product_id, network)
);

create table catalog_sync_runs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid references retailer_integrations(id) on delete set null,
  source text not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  stats jsonb not null default '{}',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Productos importados por enlace / captura: pertenecen al usuario que los importó
create table imported_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  retailer_id text references retailers(id),
  url text not null,
  canonical_url text,
  external_id text,
  data jsonb not null default '{}',
  image_urls text[] not null default '{}',
  image_policy text not null default 'none' check (image_policy in ('licensed', 'link_preview', 'none')),
  fetch_status text not null check (fetch_status in ('resolved', 'partial', 'blocked', 'unsupported_domain', 'not_product', 'error')),
  fetch_message text,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index imported_products_user_idx on imported_products(user_id, created_at desc);

create table garments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  wardrobe_id uuid not null references wardrobes(id) on delete cascade,
  space_id uuid references wardrobe_spaces(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  category text not null check (category in ('top', 'bottom', 'one_piece', 'outerwear', 'footwear', 'accessory', 'swimwear')),
  subcategory text not null,
  brand text,
  model text,
  size text,
  colors jsonb not null default '[]',
  primary_color text,
  pattern text,
  materials text[] not null default '{}',
  styles text[] not null default '{}',
  seasons text[] not null default '{}',
  occasions text[] not null default '{}',
  formality smallint not null check (formality between 0 and 100),
  warmth_clo numeric(4,2) not null check (warmth_clo between 0 and 3),
  waterproof boolean not null default false,
  fit text check (fit in ('ajustado', 'regular', 'holgado', 'oversize')),
  condition text check (condition in ('nuevo', 'como_nuevo', 'bueno', 'usado', 'desgastado')),
  status text not null default 'available' check (status in ('available', 'laundry', 'lent', 'stored', 'retired')),
  favorite boolean not null default false,
  notes text,
  purchase_date date,
  purchase_price_cents int check (purchase_price_cents >= 0),
  currency char(3) not null default 'EUR',
  source text not null check (source in ('camera', 'gallery', 'batch', 'link', 'share', 'receipt', 'screenshot', 'label', 'manual', 'demo')),
  source_url text,
  imported_product_id uuid references imported_products(id) on delete set null,
  catalog_product_id uuid references catalog_products(id) on delete set null,
  is_demo boolean not null default false,
  wear_count int not null default 0 check (wear_count >= 0),
  last_worn_on date,
  primary_image_id uuid,
  search_text tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index garments_user_status_idx on garments(user_id, status);
create index garments_user_category_idx on garments(user_id, category, subcategory);
create index garments_user_color_idx on garments(user_id, primary_color);
create index garments_user_worn_idx on garments(user_id, last_worn_on);
create index garments_styles_idx on garments using gin(styles);
create index garments_search_idx on garments using gin(search_text);
create index garments_brand_trgm_idx on garments using gin(brand gin_trgm_ops);
create trigger garments_updated before update on garments for each row execute function set_updated_at();

create or replace function garments_search_text() returns trigger
language plpgsql as $$
begin
  new.search_text := to_tsvector('spanish', immutable_unaccent(
    coalesce(new.name, '') || ' ' || coalesce(new.brand, '') || ' ' || coalesce(new.model, '') || ' ' ||
    replace(coalesce(new.subcategory, ''), '_', ' ') || ' ' || replace(coalesce(new.primary_color, ''), '_', ' ') || ' ' ||
    coalesce(new.pattern, '') || ' ' || array_to_string(new.materials, ' ') || ' ' || array_to_string(new.styles, ' ') || ' ' ||
    coalesce(new.notes, '')));
  return new;
end $$;
create trigger garments_search before insert or update on garments for each row execute function garments_search_text();

create table garment_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  garment_id uuid references garments(id) on delete cascade,
  kind text not null check (kind in ('original', 'cutout', 'product_reference', 'label', 'receipt', 'screenshot', 'inspiration', 'visual_search')),
  storage_key text not null,
  thumb_storage_key text,
  mime text not null,
  width int,
  height int,
  bytes int,
  sha256 text not null,
  phash bit(64),
  license text not null default 'user_owned' check (license in ('user_owned', 'retailer_licensed', 'retailer_link_preview')),
  attribution text,
  source_url text,
  parent_image_id uuid references garment_images(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index garment_images_user_idx on garment_images(user_id, created_at desc);
create index garment_images_garment_idx on garment_images(garment_id);
create index garment_images_sha_idx on garment_images(user_id, sha256);
alter table garments add constraint garments_primary_image_fk foreign key (primary_image_id) references garment_images(id) on delete set null;

create table garment_attributes (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  garment_id uuid not null references garments(id) on delete cascade,
  attribute text not null,
  value jsonb not null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  source text not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create index garment_attributes_garment_idx on garment_attributes(garment_id, attribute, created_at desc);

create table garment_embeddings (
  garment_id uuid primary key references garments(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  image_id uuid references garment_images(id) on delete set null,
  model text not null,
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);
create index garment_embeddings_user_idx on garment_embeddings(user_id);
create index garment_embeddings_hnsw on garment_embeddings using hnsw (embedding vector_cosine_ops);

create table garment_availability (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  garment_id uuid not null references garments(id) on delete cascade,
  status text not null check (status in ('available', 'laundry', 'lent', 'stored', 'retired')),
  note text,
  lent_to text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index garment_availability_garment_idx on garment_availability(garment_id, started_at desc);

create table tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);
create unique index tags_user_name_idx on tags(user_id, lower(name));

create table garment_tags (
  garment_id uuid not null references garments(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (garment_id, tag_id)
);
create index garment_tags_tag_idx on garment_tags(tag_id);

-- ===========================================================================
-- Imports (cámara, galería, lote, enlace, tickets…)
-- ===========================================================================

create table import_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('camera', 'gallery', 'batch', 'link', 'share', 'page_capture', 'receipt', 'screenshot', 'label', 'email', 'retailer_export')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source_id uuid references import_sources(id) on delete set null,
  kind text not null check (kind in ('image_analysis', 'link_import', 'receipt_parse')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'needs_review', 'completed', 'failed', 'cancelled')),
  total int not null default 0,
  processed int not null default 0,
  input jsonb not null default '{}',
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index import_jobs_user_idx on import_jobs(user_id, created_at desc);
create trigger import_jobs_updated before update on import_jobs for each row execute function set_updated_at();

create table import_detections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  job_id uuid not null references import_jobs(id) on delete cascade,
  image_id uuid not null references garment_images(id) on delete cascade,
  cutout_image_id uuid references garment_images(id) on delete set null,
  bbox jsonb,
  predicted jsonb not null default '{}',
  embedding vector(768),
  embedding_model text,
  duplicate jsonb,
  warnings text[] not null default '{}',
  state text not null default 'pending' check (state in ('pending', 'accepted', 'rejected', 'merged')),
  garment_id uuid references garments(id) on delete set null,
  created_at timestamptz not null default now()
);
create index import_detections_job_idx on import_detections(job_id);

-- ===========================================================================
-- Outfits, feedback, usage, calendar, planner, trips
-- ===========================================================================

create table outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text,
  source text not null check (source in ('generated', 'manual', 'assistant', 'simulation', 'trip')),
  status text not null default 'suggested' check (status in ('suggested', 'saved', 'accepted', 'rejected', 'worn')),
  occasion text,
  signature text not null,
  score numeric(5,4) not null default 0,
  breakdown jsonb not null default '{}',
  features jsonb not null default '{}',
  explanation jsonb not null default '[]',
  weather_note text,
  context jsonb not null default '{}',
  layout jsonb not null default '[]',
  is_saved boolean not null default false,
  is_favorite boolean not null default false,
  is_exploration boolean not null default false,
  request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index outfits_user_idx on outfits(user_id, created_at desc);
create index outfits_user_saved_idx on outfits(user_id) where is_saved;
create index outfits_signature_idx on outfits(user_id, signature);
create trigger outfits_updated before update on outfits for each row execute function set_updated_at();

create table outfit_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  outfit_id uuid not null references outfits(id) on delete cascade,
  slot text not null,
  garment_id uuid references garments(id) on delete cascade,
  catalog_product_id uuid references catalog_products(id) on delete cascade,
  imported_product_id uuid references imported_products(id) on delete cascade,
  position int not null default 0,
  check (num_nonnulls(garment_id, catalog_product_id, imported_product_id) = 1),
  unique (outfit_id, slot)
);
create index outfit_items_garment_idx on outfit_items(garment_id);

create table outfit_ratings (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  outfit_id uuid not null references outfits(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  reasons text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index outfit_ratings_outfit_idx on outfit_ratings(outfit_id);

create table weather_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  -- cuadrícula de ~11 km: sin datos personales
  grid_lat numeric(4,1) not null,
  grid_lon numeric(5,1) not null,
  valid_date date not null,
  timezone text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  unique (provider, grid_lat, grid_lon, valid_date)
);

create table outfit_usage_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  outfit_id uuid references outfits(id) on delete set null,
  worn_on date not null,
  garment_ids uuid[] not null,
  occasion text,
  weather_snapshot_id uuid references weather_snapshots(id) on delete set null,
  created_at timestamptz not null default now()
);
create index outfit_usage_user_idx on outfit_usage_history(user_id, worn_on desc);
create index outfit_usage_garments_idx on outfit_usage_history using gin(garment_ids);

create table calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source text not null check (source in ('manual', 'device', 'google', 'outlook', 'trip')),
  external_id text,
  title text not null check (char_length(title) between 1 and 200),
  occasion text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  is_outdoor boolean,
  location_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create unique index calendar_events_external_idx on calendar_events(user_id, source, external_id) where external_id is not null;
create index calendar_events_user_time_idx on calendar_events(user_id, starts_at);
create trigger calendar_events_updated before update on calendar_events for each row execute function set_updated_at();

create table trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  destination_name text not null,
  lat numeric(5,2) not null,
  lon numeric(5,2) not null,
  start_date date not null,
  end_date date not null,
  activities text[] not null default '{}',
  luggage text not null check (luggage in ('mochila', 'cabina', 'mediana', 'grande')),
  max_items int not null,
  result jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 30)
);
create index trips_user_idx on trips(user_id, start_date desc);

create table trip_items (
  trip_id uuid not null references trips(id) on delete cascade,
  garment_id uuid not null references garments(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  quantity int not null default 1,
  packed boolean not null default false,
  primary key (trip_id, garment_id)
);

create table outfit_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  plan_date date not null,
  position int not null default 0,
  outfit_id uuid not null references outfits(id) on delete cascade,
  calendar_event_id uuid references calendar_events(id) on delete set null,
  trip_id uuid references trips(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
create index outfit_plans_user_date_idx on outfit_plans(user_id, plan_date, position);

-- ===========================================================================
-- Shopping (personal side)
-- ===========================================================================

create table wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null default 'Lista de deseos',
  is_default boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index wishlists_default_idx on wishlists(user_id) where is_default;

create table wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  wishlist_id uuid not null references wishlists(id) on delete cascade,
  catalog_product_id uuid references catalog_products(id) on delete cascade,
  imported_product_id uuid references imported_products(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(catalog_product_id, imported_product_id) = 1)
);
create unique index wishlist_items_catalog_idx on wishlist_items(wishlist_id, catalog_product_id) where catalog_product_id is not null;
create unique index wishlist_items_imported_idx on wishlist_items(wishlist_id, imported_product_id) where imported_product_id is not null;

create table purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  garment_id uuid references garments(id) on delete set null,
  catalog_product_id uuid references catalog_products(id) on delete set null,
  imported_product_id uuid references imported_products(id) on delete set null,
  retailer_id text references retailers(id),
  order_ref text,
  purchased_on date,
  price_cents int check (price_cents >= 0),
  currency char(3) not null default 'EUR',
  size_label text,
  source text not null check (source in ('link', 'wishlist', 'receipt', 'screenshot', 'email', 'label', 'manual')),
  evidence_image_id uuid references garment_images(id) on delete set null,
  created_at timestamptz not null default now()
);
create index purchases_user_idx on purchases(user_id, purchased_on desc);

create table shopping_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  catalog_product_id uuid not null references catalog_products(id) on delete cascade,
  section text not null,
  score numeric(6,4) not null,
  new_outfits int not null default 0,
  redundancy numeric(4,3) not null default 0,
  breakdown jsonb not null default '{}',
  reasons jsonb not null default '[]',
  is_sponsored boolean not null default false,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index shopping_recommendations_user_idx on shopping_recommendations(user_id, section, score desc);

create table recommendation_events (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('impression', 'accept', 'reject', 'save', 'unsave', 'favorite', 'swap', 'wear', 'rate', 'regenerate', 'adjust', 'unavailable', 'product_click', 'simulate', 'purchase_confirmed', 'wishlist_add')),
  request_id uuid,
  outfit_id uuid references outfits(id) on delete set null,
  garment_id uuid references garments(id) on delete set null,
  product_ref text,
  features jsonb,
  context jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index recommendation_events_user_idx on recommendation_events(user_id, created_at desc);

-- ===========================================================================
-- Assistant & audit
-- ===========================================================================

create table assistant_messages (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);
create index assistant_messages_conv_idx on assistant_messages(user_id, conversation_id, id);

create table audit_events (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  actor text not null check (actor in ('user', 'system', 'admin')),
  action text not null,
  entity text,
  entity_id text,
  ip_hash text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_events_user_idx on audit_events(user_id, created_at desc);

-- ===========================================================================
-- Row level security
-- ===========================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'user_preferences', 'style_profiles', 'consents', 'wardrobes', 'wardrobe_spaces', 'imported_products',
    'garments', 'garment_images', 'garment_attributes', 'garment_embeddings', 'garment_availability', 'tags',
    'garment_tags', 'import_sources', 'import_jobs', 'import_detections', 'outfits', 'outfit_items',
    'outfit_ratings', 'outfit_usage_history', 'calendar_events', 'trips', 'trip_items', 'outfit_plans',
    'wishlists', 'wishlist_items', 'purchases', 'shopping_recommendations', 'recommendation_events',
    'assistant_messages'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I using (user_id = app_current_user_id()) with check (user_id = app_current_user_id())', t || '_owner', t);
    execute format('grant select, insert, update, delete on %I to dressit_app', t);
  end loop;
end $$;

alter table users enable row level security;
alter table users force row level security;
create policy users_self on users using (id = app_current_user_id()) with check (id = app_current_user_id());
grant select, insert, update, delete on users to dressit_app;

-- audit: el usuario puede leer sus eventos; inserción libre; sin update/delete (append-only)
alter table audit_events enable row level security;
alter table audit_events force row level security;
create policy audit_events_read on audit_events for select using (user_id = app_current_user_id());
create policy audit_events_insert on audit_events for insert with check (user_id is null or user_id = app_current_user_id());
grant select, insert on audit_events to dressit_app;

-- Tablas sin RLS accesibles por la app (auth interno y catálogo global)
grant select, insert, update, delete on auth_identities, auth_sessions to dressit_app;
grant select, insert, update, delete on retailers, retailer_integrations, catalog_products, product_variants,
  product_prices, product_availability, product_images, product_embeddings, affiliate_links, catalog_sync_runs,
  weather_snapshots to dressit_app;
grant usage, select on all sequences in schema public to dressit_app;
grant execute on function app_current_user_id(), immutable_unaccent(text) to dressit_app;
