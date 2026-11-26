-- Bootstrap a dedicated Supabase project via its SQL editor.
-- Create a PRIVATE bucket named stl-room-assets separately in Storage.
-- No anon/authenticated grants: only the server service_role may use this API.
begin;
create table if not exists public.stl_room_entries (
 kind text not null check (kind in ('model','photo')),
 id text not null check (id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
 status text not null check (status in ('reserved','published','deleted')),
 path text not null,
 bytes integer not null check (bytes > 0),
 thumbnail_path text,
 thumbnail_bytes integer,
 fingerprint text,
 expires_at timestamptz not null,
 payload jsonb,
 primary key(kind,id)
);
create index if not exists stl_room_entries_catalog on public.stl_room_entries(kind,status,expires_at);
alter table public.stl_room_entries enable row level security;
revoke all on public.stl_room_entries from public, anon, authenticated;
grant select, insert, update, delete on public.stl_room_entries to service_role;
create table if not exists public.stl_room_rates (
 ip text not null, minute bigint not null, count integer not null,
 primary key (ip,minute)
);
create index if not exists stl_room_rates_minute on public.stl_room_rates(minute);
alter table public.stl_room_rates enable row level security;
revoke all on public.stl_room_rates from public, anon, authenticated;
grant select, insert, update, delete on public.stl_room_rates to service_role;

create or replace function public.stl_room_rate(p_ip text) returns void
language plpgsql security invoker set search_path = '' as $$
declare
 m bigint := floor(extract(epoch from now()) / 60);
 n integer;
begin
 delete from public.stl_room_rates where minute < m-2;
 insert into public.stl_room_rates(ip,minute,count) values(p_ip,m,1)
 on conflict (ip,minute) do update set count = stl_room_rates.count + 1
 returning count into n;
 if n > 30 then raise exception 'rate'; end if;
end; $$;
create or replace function public.stl_room_reserve(p_kind text,p_id text,p_path text,p_bytes integer,p_limit integer,p_fingerprint text)
returns void language plpgsql security invoker set search_path = '' as $$
declare
 r public.stl_room_entries%rowtype;
 is_thumb boolean := p_kind='model' and right(p_path,4)='.png';
begin
 if p_kind not in ('model','photo') or p_bytes <= 0 or p_limit < 1 or p_limit > 1000 then raise exception 'conflict'; end if;
 if p_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'conflict'; end if;
 if p_kind='model' and p_path !~ ('^uploads/'||p_id||'\.(stl|step|stp|glb|png)$') then raise exception 'conflict'; end if;
 if p_kind='photo' and (p_path <> 'photos/'||p_id||'.jpg' or p_fingerprint is null) then raise exception 'conflict'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('stl-room-reserve:'||p_kind));
 select * into r from public.stl_room_entries where kind=p_kind and id=p_id for update;
 if found then
  if r.status='deleted' then raise exception 'deleted'; end if;
  if r.status='published' then
   if p_kind='photo' and r.fingerprint=p_fingerprint then return; end if;
   raise exception 'conflict';
  end if;
  if r.expires_at<=now() then raise exception 'reservation'; end if;
  if is_thumb then
   if r.thumbnail_path is not null and (r.thumbnail_path<>p_path or r.thumbnail_bytes<>p_bytes) then raise exception 'conflict'; end if;
   update public.stl_room_entries set thumbnail_path=p_path,thumbnail_bytes=p_bytes,expires_at=now()+interval '125 minutes' where kind=p_kind and id=p_id;
  else
   if r.path<>p_path or r.bytes<>p_bytes or r.fingerprint is distinct from p_fingerprint then raise exception 'conflict'; end if;
   update public.stl_room_entries set expires_at=now()+interval '125 minutes' where kind=p_kind and id=p_id;
  end if;
  return;
 end if;
 if is_thumb then raise exception 'reservation'; end if;
 if (select count(*) from public.stl_room_entries where kind=p_kind and (status='published' or (status='reserved' and expires_at>now()))) >= p_limit then raise exception 'quota'; end if;
 insert into public.stl_room_entries(kind,id,status,path,bytes,fingerprint,expires_at) values(p_kind,p_id,'reserved',p_path,p_bytes,p_fingerprint,now()+interval '125 minutes');
end; $$;
create or replace function public.stl_room_publish(p_kind text,p_id text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.stl_room_entries%rowtype;
begin
 select * into r from public.stl_room_entries where kind=p_kind and id=p_id for update;
 if not found then raise exception 'reservation'; end if;
 if r.status='deleted' then raise exception 'deleted'; end if;
 if p_payload->>'id' is distinct from p_id then raise exception 'conflict'; end if;
 if p_kind='model' and (p_payload->>'modelPathname' is distinct from r.path or p_payload->>'thumbnailPathname' is distinct from r.thumbnail_path) then raise exception 'conflict'; end if;
 if p_kind='photo' and p_payload->>'digest' is distinct from r.fingerprint then raise exception 'conflict'; end if;
 if r.status='published' then return r.payload; end if;
 if r.expires_at<=now() then raise exception 'reservation'; end if;
 update public.stl_room_entries set status='published',payload=p_payload where kind=p_kind and id=p_id;
 return p_payload;
end; $$;
create or replace function public.stl_room_delete(p_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.stl_room_entries%rowtype;
begin
 select * into r from public.stl_room_entries where kind='model' and id=p_id for update;
 if not found or r.status='reserved' then return null; end if;
 update public.stl_room_entries set status='deleted' where kind='model' and id=p_id;
 return r.payload;
end; $$;
revoke all on function public.stl_room_rate(text) from public,anon,authenticated;
revoke all on function public.stl_room_reserve(text,text,text,integer,integer,text) from public,anon,authenticated;
revoke all on function public.stl_room_publish(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.stl_room_delete(text) from public,anon,authenticated;
grant execute on function public.stl_room_rate(text) to service_role;
grant execute on function public.stl_room_reserve(text,text,text,integer,integer,text) to service_role;
grant execute on function public.stl_room_publish(text,text,jsonb) to service_role;
grant execute on function public.stl_room_delete(text) to service_role;
commit;
