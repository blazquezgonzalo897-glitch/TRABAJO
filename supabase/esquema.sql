-- Mis trabajos · cuenta y sincronización
-- Pega este archivo entero en Supabase → SQL Editor → Run. Se puede volver a ejecutar sin problema.
--
-- Cada dato de la app es una fila: un trabajo ("t_<id>") o un ajuste ("ritmo", "horasDia",
-- "planHoy", "temporizador"). "rev" sube en cada cambio: la app lo usa para no pisar lo que
-- otro dispositivo acaba de guardar.

create table if not exists public.datos_app (
  usuario     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  clave       text        not null,
  valor       jsonb       not null,
  rev         integer     not null default 1,
  actualizado timestamptz not null default now(),
  primary key (usuario, clave)
);

-- La base de datos (no el navegador) numera las versiones y apunta la hora del cambio
create or replace function public.datos_app_nueva_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.rev := 1;
  else
    new.rev := old.rev + 1;
  end if;
  new.actualizado := now();
  return new;
end;
$$;

drop trigger if exists datos_app_nueva_version on public.datos_app;
create trigger datos_app_nueva_version
  before insert or update on public.datos_app
  for each row execute function public.datos_app_nueva_version();

-- Seguridad (RLS): cada cuenta solo puede ver y tocar sus propias filas
alter table public.datos_app enable row level security;

drop policy if exists "ver lo mio" on public.datos_app;
drop policy if exists "crear lo mio" on public.datos_app;
drop policy if exists "cambiar lo mio" on public.datos_app;
drop policy if exists "borrar lo mio" on public.datos_app;

create policy "ver lo mio" on public.datos_app
  for select to authenticated using ((select auth.uid()) = usuario);
create policy "crear lo mio" on public.datos_app
  for insert to authenticated with check ((select auth.uid()) = usuario);
create policy "cambiar lo mio" on public.datos_app
  for update to authenticated using ((select auth.uid()) = usuario) with check ((select auth.uid()) = usuario);
create policy "borrar lo mio" on public.datos_app
  for delete to authenticated using ((select auth.uid()) = usuario);

-- Permisos de la API. Desde octubre de 2026 Supabase ya no los da solos a las tablas nuevas.
revoke all on table public.datos_app from anon;
grant select, insert, update, delete on table public.datos_app to authenticated;
