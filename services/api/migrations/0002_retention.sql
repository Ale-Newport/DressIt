-- Retención limitada (RGPD art. 5.1.e): rol de mantenimiento con políticas explícitas
-- para purgar datos caducados de todos los usuarios. Las tablas tienen FORCE RLS, así que
-- ni siquiera el propietario puede borrar sin estas políticas.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dressit_maintenance') then
    create role dressit_maintenance nologin;
  end if;
end $$;
grant dressit_maintenance to current_user;
grant usage on schema public to dressit_maintenance;

do $$
declare
  t text;
begin
  foreach t in array array['assistant_messages', 'outfits', 'outfit_items', 'recommendation_events', 'import_jobs', 'import_detections', 'garment_images', 'outfit_plans', 'imported_products', 'wishlist_items', 'garments', 'purchases'] loop
    execute format('grant select, delete on %I to dressit_maintenance', t);
    execute format('create policy %I on %I for all to dressit_maintenance using (true)', t || '_retention', t);
  end loop;
end $$;
grant select, delete on auth_sessions to dressit_maintenance;
