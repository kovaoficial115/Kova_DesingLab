-- Consulta mínima para que el proyecto gratuito no se pause por inactividad
-- (la usa .github/workflows/keep-alive.yml). No lee ni escribe datos.
create or replace function public.ping()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$ select now() $$;

revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
