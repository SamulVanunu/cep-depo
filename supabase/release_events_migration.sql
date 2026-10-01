-- Run after link_source_migration.sql in the existing Cep Depo project.
create table if not exists public.release_events (
  id bigint generated always as identity primary key,
  app_id uuid not null references public.apps(id) on delete cascade,
  title text not null,
  version text not null,
  kind text not null check (kind in ('new','update')),
  created_at timestamptz not null default now()
);
alter table public.release_events enable row level security;
create policy "read release events" on public.release_events
  for select to anon, authenticated using (true);
create or replace function public.record_app_release() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.release_events(app_id,title,version,kind)
    values(new.id,new.title,new.version,'new');
  elsif new.version is distinct from old.version then
    insert into public.release_events(app_id,title,version,kind)
    values(new.id,new.title,new.version,'update');
  end if;
  return new;
end $$;
drop trigger if exists app_release_event on public.apps;
create trigger app_release_event after insert or update on public.apps
for each row execute function public.record_app_release();
