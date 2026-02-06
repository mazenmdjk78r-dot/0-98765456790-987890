-- Certificates table for Supabase
create table if not exists public.certificates (
  id text primary key,
  registration_number text not null,
  student_name text not null,
  student_category text not null,
  student_center text,
  certification jsonb,
  image_path text,
  image_url text,
  saved_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes
create index if not exists certificates_reg_idx on public.certificates (registration_number);
create index if not exists certificates_updated_idx on public.certificates (updated_at);

-- Optional: enable RLS (service_role bypasses this)
-- alter table public.certificates enable row level security;

-- Optional public read policy (ONLY if you want to query directly from browser)
-- create policy "public read certificates"
-- on public.certificates for select
-- using (true);
