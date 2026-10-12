-- Baby Shoes: run this ONCE in Supabase
-- Supabase Dashboard > SQL Editor > New query > paste everything > Run

-- Shoes shown on the website
create table if not exists public.products (
  id          text primary key,
  name        text not null,
  cat         text not null check (cat in ('heels', 'flats', 'sandals', 'sneakers')),
  price       integer not null check (price > 0),
  old         integer check (old is null or old > price),
  baby_price  integer check (baby_price is null or baby_price > 0),
  img         text,
  baby_img    text,
  best        boolean not null default false,
  hidden      boolean not null default false,
  out_of_stock boolean not null default false,
  sold_sizes  integer[] not null default '{}',
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Already created the table before? This adds the "Out of stock" switch column:
alter table public.products add column if not exists out_of_stock boolean not null default false;
alter table public.products add column if not exists sold_sizes integer[] not null default '{}';

-- Editable website text (key = which text, value = the text)
create table if not exists public.site_content (
  key    text primary key,
  value  text not null default ''
);

-- Admin password (only a salted hash is stored, never the password itself)
create table if not exists public.admin_settings (
  id          integer primary key default 1 check (id = 1),
  salt        text not null,
  hash        text not null,
  updated_at  timestamptz not null default now()
);

-- Lock all three tables. With row level security on and no policies, nobody can read or
-- write them from the browser. Only the website's server, using the secret key, can.
alter table public.products       enable row level security;
alter table public.site_content   enable row level security;
alter table public.admin_settings enable row level security;

-- Bucket for shoe photos: anyone can view a photo, only the server can upload or delete
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
