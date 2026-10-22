-- KOOQ: eenmalig uitvoeren in Supabase → SQL Editor → New query → Run.
-- Veilig om vaker te draaien: bestaande data blijft staan.

-- 1. Receptenbank: kolommen die de backend gebruikt
alter table public.recipes add column if not exists ai_image_prompt text;
alter table public.recipes add column if not exists image_url text;
alter table public.recipes add column if not exists short_description text;
alter table public.recipes add column if not exists diet_tags text[] default '{}';

-- Snel zoeken op titel (hergebruik van bestaande gerechten)
create index if not exists recipes_title_idx on public.recipes (title);

-- 2. Openbare opslagplek voor maaltijdfoto's
insert into storage.buckets (id, name, public)
values ('meal-images', 'meal-images', true)
on conflict (id) do update set public = true;
