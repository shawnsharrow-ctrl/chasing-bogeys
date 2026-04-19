-- ══════════════════════════════════════════
-- CHASING BOGEYS — Database Schema
-- Run this entire block in Supabase SQL Editor
-- ══════════════════════════════════════════

-- PROFILES table (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  first_name text,
  last_name text,
  handicap numeric(4,1),
  gamer_ball text,
  blowup_threshold text default 'triple',
  pitch_yards integer default 100,
  chip_yards integer default 25,
  created_at timestamptz default now()
);

-- COURSES table
create table public.courses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  location text,
  rating numeric(4,1),
  slope integer,
  par integer default 72,
  holes integer default 18,
  hole_pars integer[] not null,
  is_complex boolean default false,
  complex_name text,
  complex_id text,
  nine_labels text[],
  created_at timestamptz default now()
);

-- ROUNDS table
create table public.rounds (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  course_id uuid references public.courses on delete cascade not null,
  played_at date not null,
  scores integer[] not null,
  putts integer[],
  chips integer[],
  pitches integer[],
  penalties jsonb,
  journal_tee text,
  journal_approach text,
  journal_short text,
  journal_notes text,
  journal_share boolean default false,
  created_at timestamptz default now()
);

-- ── Row Level Security ──────────────────────
alter table public.profiles enable row level security;
alter table public.courses  enable row level security;
alter table public.rounds   enable row level security;

-- Profiles
create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

-- Courses
create policy "Users can manage own courses"
  on public.courses for all using (auth.uid() = user_id);

-- Rounds
create policy "Users can manage own rounds"
  on public.rounds for all using (auth.uid() = user_id);

-- Community wall: shared journal entries readable by all
create policy "Anyone can read shared journal entries"
  on public.rounds for select using (journal_share = true);

-- ── Auto-create profile on signup ──────────
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, first_name, last_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
