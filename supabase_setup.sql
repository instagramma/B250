-- BIOL 250 Study App — progress table + security policies
-- Run this once in your Supabase project's SQL Editor (Dashboard > SQL Editor > New query > Run)

create table if not exists public.progress (
  user_id uuid references auth.users(id) on delete cascade primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.progress enable row level security;

-- Each person can only ever read their own row
create policy "select own progress"
  on public.progress for select
  using (auth.uid() = user_id);

-- Each person can only ever create their own row
create policy "insert own progress"
  on public.progress for insert
  with check (auth.uid() = user_id);

-- Each person can only ever update their own row
create policy "update own progress"
  on public.progress for update
  using (auth.uid() = user_id);

-- Keep updated_at fresh automatically
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists progress_touch_updated_at on public.progress;
create trigger progress_touch_updated_at
  before update on public.progress
  for each row execute function public.touch_updated_at();
