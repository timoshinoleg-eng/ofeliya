-- Dedicated private snapshot; no existing application tables are modified.
create schema if not exists ofeliya_private;
revoke all on schema ofeliya_private from public, anon, authenticated;
grant usage on schema ofeliya_private to service_role;
create table ofeliya_private.state (
  id integer primary key check (id = 1),
  payload jsonb not null,
  revision bigint not null default 0,
  writer uuid,
  last_commit uuid,
  updated_at timestamptz not null default now()
);
alter table ofeliya_private.state enable row level security;
grant select, update on ofeliya_private.state to service_role;

create function public.ofeliya_state_call(
  op text, writer_id uuid default null, expected bigint default null,
  document jsonb default null, commit_id uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s ofeliya_private.state;
begin
  select * into s from ofeliya_private.state where id = 1 for update;
  if not found then raise exception 'OFELIYA state is not initialized'; end if;
  if op = 'read' then
    return jsonb_build_object('revision', s.revision, 'document', s.payload);
  elsif op = 'claim' and writer_id is not null then
    if s.writer is distinct from writer_id then
      update ofeliya_private.state set writer = writer_id, revision = revision + 1,
        last_commit = null, updated_at = now() where id = 1 returning * into s;
    end if;
    return jsonb_build_object('revision', s.revision, 'document', s.payload);
  elsif op = 'commit' then
    if writer_id is null or s.writer is distinct from writer_id then
      return jsonb_build_object('error', 'writer-conflict');
    end if;
    if commit_id is not null and s.last_commit = commit_id and s.payload = document then
      return jsonb_build_object('revision', s.revision);
    end if;
    if s.revision is distinct from expected then
      return jsonb_build_object('error', 'revision-conflict');
    end if;
    if commit_id is null or coalesce(jsonb_typeof(document->'store'), '') <> 'object'
      or coalesce(jsonb_typeof(document->'profiles'), '') <> 'object' then
      raise exception 'invalid OFELIYA snapshot';
    end if;
    update ofeliya_private.state set payload = document, revision = revision + 1,
      last_commit = commit_id, updated_at = now() where id = 1 returning * into s;
    return jsonb_build_object('revision', s.revision);
  end if;
  raise exception 'invalid OFELIYA state operation';
end;
$$;
revoke all on function public.ofeliya_state_call(text, uuid, bigint, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.ofeliya_state_call(text, uuid, bigint, jsonb, uuid) to service_role;
