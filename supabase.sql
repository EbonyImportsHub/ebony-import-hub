-- Ebony Import Hub: run this whole file once in Supabase (SQL Editor -> New query -> paste -> Run)

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Other',
  description text,
  price numeric(12,2) not null check (price >= 0),
  shipping_fee numeric(12,2) not null default 0 check (shipping_fee >= 0),
  image_urls text[] not null default '{}',
  in_stock boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.products enable row level security;

-- Everyone can see products
create policy "Anyone can view products"
  on public.products for select using (true);

-- Only a logged-in user (you, the owner) can change products
create policy "Owner can add products"
  on public.products for insert to authenticated with check (true);
create policy "Owner can edit products"
  on public.products for update to authenticated using (true) with check (true);
create policy "Owner can delete products"
  on public.products for delete to authenticated using (true);

-- Photo storage
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "Anyone can view product images"
  on storage.objects for select using (bucket_id = 'product-images');
create policy "Owner can upload product images"
  on storage.objects for insert to authenticated with check (bucket_id = 'product-images');
create policy "Owner can update product images"
  on storage.objects for update to authenticated using (bucket_id = 'product-images');
create policy "Owner can delete product images"
  on storage.objects for delete to authenticated using (bucket_id = 'product-images');
