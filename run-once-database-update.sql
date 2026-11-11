-- Ebony Imports Hub: ONE database update. Run it once in Supabase:
-- SQL Editor -> New query -> paste everything -> Run.
-- It is safe to run more than once, and safe if you already ran some of it before.

-- ===== Settings and shipping rules =====
-- Shipping rules page: run this once in Supabase (SQL Editor -> New query -> paste -> Run).
-- Safe to run whether or not you already ran settings.sql, and safe to run twice.

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  business_name text,
  whatsapp_number text,
  phone_display text,
  email text,
  tiktok_handle text,
  whatsapp_group text,
  announcement text,
  updated_at timestamptz not null default now()
);

alter table public.settings add column if not exists rules text;
alter table public.settings enable row level security;

drop policy if exists "Anyone can view settings" on public.settings;
create policy "Anyone can view settings" on public.settings for select using (true);
drop policy if exists "Owner can add settings" on public.settings;
create policy "Owner can add settings" on public.settings for insert to authenticated with check (true);
drop policy if exists "Owner can edit settings" on public.settings;
create policy "Owner can edit settings" on public.settings for update to authenticated using (true) with check (true);

insert into public.settings (id) values (1) on conflict (id) do nothing;

notify pgrst, 'reload schema';

-- ===== Batches and small preview pictures =====
-- Batches + small preview pictures: run this once in Supabase (SQL Editor -> New query -> paste -> Run).
-- Safe to run again, even if you ran an older version of this file before.

create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'upcoming' check (status in ('ongoing', 'upcoming', 'closed')),
  closes_on date,
  arrival_note text,
  note text,
  created_at timestamptz not null default now()
);

-- columns that older versions of this file were missing
alter table public.batches add column if not exists closes_on date;
alter table public.batches add column if not exists arrival_note text;
alter table public.batches add column if not exists note text;

alter table public.batches enable row level security;

drop policy if exists "Anyone can view batches" on public.batches;
create policy "Anyone can view batches" on public.batches for select using (true);
drop policy if exists "Owner can add batches" on public.batches;
create policy "Owner can add batches" on public.batches for insert to authenticated with check (true);
drop policy if exists "Owner can edit batches" on public.batches;
create policy "Owner can edit batches" on public.batches for update to authenticated using (true) with check (true);
drop policy if exists "Owner can delete batches" on public.batches;
create policy "Owner can delete batches" on public.batches for delete to authenticated using (true);

-- Which batch(es) each product is open for, and its small preview picture
alter table public.products add column if not exists batch_ids uuid[] not null default '{}';
alter table public.products add column if not exists thumb_url text;

notify pgrst, 'reload schema';

-- ===== Sizes and colours =====
-- Sizes and colours for products: run this once in Supabase (SQL Editor -> New query -> paste -> Run).
-- Safe to run again.

alter table public.products add column if not exists sizes text[] not null default '{}';
alter table public.products add column if not exists colours text[] not null default '{}';

notify pgrst, 'reload schema';

-- ===== Orders, bank transfer payments and receipts =====
-- Orders, bank transfer payments and receipts.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- (If you use run-once-database-update.sql this is already included.)

-- 1) Settings: bank accounts customers can pay into, and a note shown with them
alter table public.settings add column if not exists accounts jsonb not null default '[]'::jsonb;
alter table public.settings add column if not exists pay_note text;

-- 2) Orders
create sequence if not exists public.order_number_seq start 1001;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  token uuid not null unique default gen_random_uuid(),
  method text not null check (method in ('whatsapp', 'transfer')),
  status text not null default 'requested'
    check (status in ('requested', 'awaiting_payment', 'receipt_sent', 'confirmed', 'cancelled')),
  customer_name text,
  customer_phone text,
  items jsonb not null default '[]'::jsonb,
  items_total numeric(12,2) not null default 0,
  ship_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  receipt_path text,
  receipt_via text check (receipt_via in ('app', 'whatsapp')),
  receipt_at timestamptz,
  confirmed_at timestamptz,
  owner_note text,
  created_at timestamptz not null default now()
);

create index if not exists orders_created_idx on public.orders (created_at desc);

alter table public.orders enable row level security;

-- Only you (the logged-in owner) can see or change orders directly.
-- Customers never read this table; they use the three functions below,
-- which only ever give a customer back their own order.
drop policy if exists "Owner can view orders" on public.orders;
create policy "Owner can view orders" on public.orders for select to authenticated using (true);
drop policy if exists "Owner can edit orders" on public.orders;
create policy "Owner can edit orders" on public.orders for update to authenticated using (true) with check (true);
drop policy if exists "Owner can delete orders" on public.orders;
create policy "Owner can delete orders" on public.orders for delete to authenticated using (true);

-- 3) Place an order. Prices are looked up here on the server, never trusted from the phone.
create or replace function public.place_order(p_items jsonb, p_method text, p_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
  prod public.products%rowtype;
  bat public.batches%rowtype;
  q int;
  lines jsonb := '[]'::jsonb;
  v_items numeric := 0;
  v_ship numeric := 0;
  v_token uuid := gen_random_uuid();
  v_code text;
  v_bname text;
  v_status text;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if p_method is null or p_method not in ('whatsapp', 'transfer') then
    raise exception 'Please choose how you want to order';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 40 then
    raise exception 'Your cart is empty';
  end if;
  if p_method = 'transfer' and (coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_phone), '') = '') then
    raise exception 'Please enter your name and phone number for a bank transfer order';
  end if;

  for it in select value from jsonb_array_elements(p_items) loop
    q := greatest(1, least(20, coalesce(nullif(it->>'qty', '')::int, 1)));
    select * into prod from public.products where id = (it->>'pid')::uuid;
    if not found then
      raise exception 'An item in your cart is no longer available';
    end if;
    if not prod.in_stock then
      raise exception '% is sold out', prod.name;
    end if;

    v_bname := null;
    if nullif(it->>'bid', '') is not null then
      select * into bat from public.batches where id = (it->>'bid')::uuid;
      if found then
        if bat.status = 'closed' or (bat.closes_on is not null and bat.closes_on < v_today) then
          raise exception '% is closed for preorders', bat.name;
        end if;
        v_bname := bat.name;
      end if;
    end if;

    lines := lines || jsonb_build_array(jsonb_build_object(
      'pid', prod.id,
      'name', prod.name,
      'size', left(coalesce(it->>'size', ''), 40),
      'colour', left(coalesce(it->>'colour', ''), 40),
      'qty', q,
      'price', prod.price,
      'ship', prod.shipping_fee,
      'batch', v_bname
    ));
    v_items := v_items + prod.price * q;
    v_ship := v_ship + prod.shipping_fee * q;
  end loop;

  v_code := 'EIH-' || nextval('public.order_number_seq')::text;
  v_status := case when p_method = 'transfer' then 'awaiting_payment' else 'requested' end;

  insert into public.orders (code, token, method, status, customer_name, customer_phone, items, items_total, ship_total, total)
  values (
    v_code, v_token, p_method, v_status,
    left(nullif(btrim(coalesce(p_name, '')), ''), 80),
    left(nullif(btrim(coalesce(p_phone, '')), ''), 30),
    lines, v_items, v_ship, v_items + v_ship
  );

  return jsonb_build_object('code', v_code, 'token', v_token, 'total', v_items + v_ship, 'status', v_status);
end;
$$;

-- 4) A customer looks up their own orders (by the secret token their phone saved)
create or replace function public.get_orders(p_tokens uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', o.code,
    'token', o.token,
    'method', o.method,
    'status', o.status,
    'name', o.customer_name,
    'items', o.items,
    'items_total', o.items_total,
    'ship_total', o.ship_total,
    'total', o.total,
    'receipt_via', o.receipt_via,
    'created_at', o.created_at,
    'confirmed_at', o.confirmed_at
  ) order by o.created_at desc), '[]'::jsonb)
  from public.orders o
  where o.token = any (p_tokens[1:20]);
$$;

-- 5) A customer tells you they have paid: receipt uploaded in the app, or sent on WhatsApp
create or replace function public.attach_receipt(p_token uuid, p_path text, p_via text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
begin
  if p_via is null or p_via not in ('app', 'whatsapp') then
    raise exception 'Invalid receipt type';
  end if;
  select * into o from public.orders where token = p_token;
  if not found then
    raise exception 'Order not found';
  end if;
  if o.method <> 'transfer' then
    raise exception 'This order was sent on WhatsApp, so it has no payment step';
  end if;
  if o.status in ('confirmed', 'cancelled') then
    raise exception 'This order is already %', o.status;
  end if;
  if p_via = 'app' then
    if p_path is null or p_path !~ ('^' || p_token::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
      raise exception 'Invalid receipt file';
    end if;
  end if;

  update public.orders
     set status = 'receipt_sent',
         receipt_via = p_via,
         receipt_path = case when p_via = 'app' then p_path else receipt_path end,
         receipt_at = now()
   where id = o.id;

  return jsonb_build_object('status', 'receipt_sent');
end;
$$;

-- 5b) "Find my order": a customer on a new phone gets their order back with order code + the phone number they ordered with
create or replace function public.find_order(p_code text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
  c text := upper(regexp_replace(btrim(coalesce(p_code, '')), '\s', '', 'g'));
  want text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  have text;
begin
  if c ~ '^[0-9]+$' then c := 'EIH-' || c;
  elsif c ~ '^EIH[0-9]+$' then c := 'EIH-' || substr(c, 4);
  end if;
  select * into o from public.orders where code = c;
  if found then
    have := right(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g'), 10);
  end if;
  if not found or length(want) < 10 or have is distinct from want then
    perform pg_sleep(0.4); -- slows down anyone guessing
    raise exception 'No order found with those details';
  end if;
  return jsonb_build_object('token', o.token, 'code', o.code);
end;
$$;

revoke all on function public.place_order(jsonb, text, text, text) from public;
revoke all on function public.get_orders(uuid[]) from public;
revoke all on function public.attach_receipt(uuid, text, text) from public;
grant execute on function public.place_order(jsonb, text, text, text) to anon, authenticated;
grant execute on function public.get_orders(uuid[]) to anon, authenticated;
grant execute on function public.attach_receipt(uuid, text, text) to anon, authenticated;
revoke all on function public.find_order(text, text) from public;
grant execute on function public.find_order(text, text) to anon, authenticated;

-- 6) Private storage for payment receipts (not public: only you can open them)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Customers can upload receipts" on storage.objects;
create policy "Customers can upload receipts" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$');
drop policy if exists "Owner can view receipts" on storage.objects;
create policy "Owner can view receipts" on storage.objects for select to authenticated
  using (bucket_id = 'receipts');
drop policy if exists "Owner can delete receipts" on storage.objects;
create policy "Owner can delete receipts" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts');

notify pgrst, 'reload schema';
