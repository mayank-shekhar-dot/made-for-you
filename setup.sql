-- =====================================================================
--  Arpita & Mayank Love ♡   |   database setup for Supabase
--  Supabase dashboard -> SQL Editor -> New query -> paste ALL -> Run
--  (safe to run again: it will not delete your chat)
-- =====================================================================

-- 1) the two people ----------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null unique check (name in ('Arpita','Mayank')),
  avatar_path text,
  last_seen   timestamptz
);
alter table public.profiles enable row level security;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- when you create the users arpita@example.com / mayank@example.com they get a profile automatically
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(split_part(new.email, '@', 1)) in ('arpita', 'mayank') then
    insert into public.profiles(id, name)
    values (new.id, initcap(split_part(new.email, '@', 1)))
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- if the users already exist, create their profiles now
insert into public.profiles(id, name)
select id, initcap(split_part(email, '@', 1)) from auth.users
where lower(split_part(email, '@', 1)) in ('arpita', 'mayank')
on conflict do nothing;

create or replace function public.profiles_lock() returns trigger language plpgsql as $$
begin new.id := old.id; new.name := old.name; return new; end $$;
drop trigger if exists profiles_lock on public.profiles;
create trigger profiles_lock before update on public.profiles
  for each row execute function public.profiles_lock();

-- 2) chat --------------------------------------------------------------
create table if not exists public.messages (
  id           bigint generated always as identity primary key,
  sender       uuid not null default auth.uid() references public.profiles(id),
  body         text not null default '' check (char_length(body) <= 2000),
  attachments  jsonb check (attachments is null or (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10)),
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,
  read_at      timestamptz,
  edited_at    timestamptz,
  check (char_length(btrim(body)) > 0 or attachments is not null)
);
alter table public.messages enable row level security;

create table if not exists public.reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id    uuid   not null default auth.uid() references public.profiles(id) on delete cascade,
  emoji      text   not null,
  primary key (message_id, user_id)
);
alter table public.reactions enable row level security;

create table if not exists public.chat_meta (
  id         int primary key check (id = 1),
  epoch      text not null default gen_random_uuid()::text,
  cleared_by uuid,
  cleared_at timestamptz
);
insert into public.chat_meta(id) values (1) on conflict do nothing;
alter table public.chat_meta enable row level security;

create table if not exists public.memories (
  id         bigint generated always as identity primary key,
  uploader   uuid not null default auth.uid() references public.profiles(id),
  path       text not null,
  caption    text not null default '' check (char_length(caption) <= 300),
  created_at timestamptz not null default now()
);
alter table public.memories enable row level security;

-- 3) who may do what (only the two members; nobody else, not even logged-in strangers) ----------
revoke all on public.profiles, public.messages, public.reactions, public.chat_meta, public.memories from anon, authenticated;
grant select on public.profiles, public.messages, public.reactions, public.chat_meta, public.memories to authenticated;
grant update (avatar_path, last_seen) on public.profiles to authenticated;
grant insert (body, attachments) on public.messages to authenticated;
grant insert (path, caption) on public.memories to authenticated;
grant delete on public.memories to authenticated;

drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles update" on public.profiles;
create policy "profiles read"   on public.profiles for select to authenticated using (public.is_member());
create policy "profiles update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "messages read"   on public.messages;
drop policy if exists "messages insert" on public.messages;
create policy "messages read"   on public.messages for select to authenticated using (public.is_member());
create policy "messages insert" on public.messages for insert to authenticated with check (public.is_member() and sender = auth.uid());

drop policy if exists "reactions read" on public.reactions;
create policy "reactions read" on public.reactions for select to authenticated using (public.is_member());

drop policy if exists "chat_meta read" on public.chat_meta;
create policy "chat_meta read" on public.chat_meta for select to authenticated using (public.is_member());

drop policy if exists "memories read"   on public.memories;
drop policy if exists "memories insert" on public.memories;
drop policy if exists "memories delete" on public.memories;
create policy "memories read"   on public.memories for select to authenticated using (public.is_member());
create policy "memories insert" on public.memories for insert to authenticated with check (public.is_member() and uploader = auth.uid());
create policy "memories delete" on public.memories for delete to authenticated using (uploader = auth.uid());

-- 4) actions the app can call ---------------------------------------------
create or replace function public.edit_message(p_id bigint, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'not allowed'; end if;
  p_body := btrim(p_body);
  if p_body is null or p_body = '' or char_length(p_body) > 2000 then raise exception 'bad message'; end if;
  update public.messages set body = p_body, edited_at = now() where id = p_id and sender = auth.uid();
  if not found then raise exception 'not your message'; end if;
end $$;

create or replace function public.mark_delivered() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'not allowed'; end if;
  update public.messages set delivered_at = now() where sender <> auth.uid() and delivered_at is null;
end $$;

create or replace function public.mark_read() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'not allowed'; end if;
  update public.messages set read_at = now(), delivered_at = coalesce(delivered_at, now())
  where sender <> auth.uid() and read_at is null;
end $$;

create or replace function public.react(p_message_id bigint, p_emoji text) returns void
language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if not public.is_member() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.messages where id = p_message_id) then raise exception 'no such message'; end if;
  select emoji into cur from public.reactions where message_id = p_message_id and user_id = auth.uid();
  if p_emoji is null or cur = p_emoji then
    delete from public.reactions where message_id = p_message_id and user_id = auth.uid();
  elsif p_emoji = any (array['❤️','😂','😮','😢','👍','🙏','🔥','🥰']) then
    insert into public.reactions(message_id, user_id, emoji) values (p_message_id, auth.uid(), p_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji;
  else
    raise exception 'bad emoji';
  end if;
end $$;

-- clears the whole chat for both people; returns the file paths so the app can delete them too
create or replace function public.clear_chat() returns jsonb
language plpgsql security definer set search_path = public as $$
declare paths jsonb;
begin
  if not public.is_member() then raise exception 'not allowed'; end if;
  select coalesce(jsonb_agg(a ->> 'path'), '[]'::jsonb) into paths
  from public.messages m, jsonb_array_elements(coalesce(m.attachments, '[]'::jsonb)) a;
  delete from public.messages;
  update public.chat_meta set epoch = gen_random_uuid()::text, cleared_by = auth.uid(), cleared_at = now() where id = 1;
  return paths;
end $$;

revoke all on function public.edit_message(bigint, text), public.mark_delivered(), public.mark_read(),
  public.react(bigint, text), public.clear_chat() from public, anon;
grant execute on function public.edit_message(bigint, text), public.mark_delivered(), public.mark_read(),
  public.react(bigint, text), public.clear_chat() to authenticated;

-- 5) private file storage (photos, videos, voice, memories, profile pictures) -----------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('love', 'love', false, 52428800, array[
  'image/jpeg','image/png','image/gif','image/webp',
  'video/mp4','video/webm','video/quicktime',
  'audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/x-m4a'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "love read"   on storage.objects;
drop policy if exists "love upload" on storage.objects;
drop policy if exists "love delete" on storage.objects;
create policy "love read"   on storage.objects for select to authenticated
  using (bucket_id = 'love' and public.is_member());
create policy "love upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'love' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "love delete" on storage.objects for delete to authenticated
  using (bucket_id = 'love' and public.is_member());

-- 6) private live channel (online status + typing) ----------------------------------------
drop policy if exists "love room receive" on realtime.messages;
drop policy if exists "love room send"    on realtime.messages;
create policy "love room receive" on realtime.messages for select to authenticated using (public.is_member());
create policy "love room send"    on realtime.messages for insert to authenticated with check (public.is_member());

-- 7) instant delivery of new messages ---------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['messages','reactions','memories','chat_meta','profiles'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
