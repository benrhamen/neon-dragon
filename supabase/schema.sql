-- Neon Dragon: shared leaderboard table for Supabase (free tier).
-- Paste this whole file into Supabase Dashboard > SQL Editor > New query, then press RUN.
-- It is safe to run more than once (idempotent).
--
-- What it does:
--   * creates public.scores with CHECK constraints (short nickname, small avatar, sane ranges)
--   * turns on Row Level Security: the public (anon) key may only INSERT new rows and SELECT rows;
--     nobody using the public key can UPDATE or DELETE anything
--   * basic anti-spam: a trigger rejects more than 5 scores per nickname per minute and more than
--     600 scores in total per minute, and stamps created_at on the server

create table if not exists public.scores (
  id           bigint generated always as identity primary key,
  nickname     text        not null,
  avatar       jsonb       not null default '{}'::jsonb,
  score_pct    integer     not null,
  rank         text        not null default '',
  zodiac_count integer     not null default 0,
  bonus_stars  integer,
  created_at   timestamptz not null default now()
);

-- (Re)create the constraints so re-running the file always leaves them in place.
alter table public.scores drop constraint if exists scores_nickname_check;
alter table public.scores add constraint scores_nickname_check
  check (char_length(nickname) between 1 and 12 and nickname ~ '^[A-Z0-9 _.!-]+$');

alter table public.scores drop constraint if exists scores_avatar_check;
alter table public.scores add constraint scores_avatar_check
  check (jsonb_typeof(avatar) = 'object' and pg_column_size(avatar) <= 512);

alter table public.scores drop constraint if exists scores_score_pct_check;
alter table public.scores add constraint scores_score_pct_check
  check (score_pct between 0 and 100);

alter table public.scores drop constraint if exists scores_rank_check;
alter table public.scores add constraint scores_rank_check
  check (char_length(rank) <= 24);

alter table public.scores drop constraint if exists scores_zodiac_count_check;
alter table public.scores add constraint scores_zodiac_count_check
  check (zodiac_count between 0 and 12);

-- Cosmetic bonus stars (one per won luck roll). Tables made before this column existed get it here.
alter table public.scores add column if not exists bonus_stars integer;
-- NULL means the old game never recorded this count. Do not invent zero for old scores.
alter table public.scores alter column bonus_stars drop not null;
alter table public.scores alter column bonus_stars drop default;
alter table public.scores drop constraint if exists scores_bonus_stars_check;
alter table public.scores add constraint scores_bonus_stars_check
  check (bonus_stars between 0 and 999);

create index if not exists scores_top_idx on public.scores (score_pct desc, created_at asc);
create index if not exists scores_recent_idx on public.scores (created_at desc);

-- Row Level Security: insert-only and select-only for the public key.
alter table public.scores enable row level security;

drop policy if exists "anon can read scores" on public.scores;
create policy "anon can read scores" on public.scores
  for select to anon, authenticated
  using (true);

drop policy if exists "anon can add scores" on public.scores;
create policy "anon can add scores" on public.scores
  for insert to anon, authenticated
  with check (true);  -- the CHECK constraints above do the validation

-- Table privileges: read + insert only (no update/delete/truncate for the public roles).
revoke all on table public.scores from anon, authenticated;
grant select, insert on table public.scores to anon, authenticated;
grant usage, select on sequence public.scores_id_seq to anon, authenticated;

-- Anti-spam trigger: server-side timestamp and a simple rate limit.
create or replace function public.scores_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_at := now();
  new.nickname := upper(btrim(new.nickname));
  if (select count(*) from public.scores
        where nickname = new.nickname and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'Too many scores for this nickname. Try again in a minute.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.scores where created_at > now() - interval '1 minute') >= 600 then
    raise exception 'Leaderboard is busy. Try again in a minute.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.scores_before_insert() from public, anon, authenticated;

drop trigger if exists scores_before_insert on public.scores;
create trigger scores_before_insert
  before insert on public.scores
  for each row execute function public.scores_before_insert();

-- Ask the REST API to pick up the new table straight away.
notify pgrst, 'reload schema';
