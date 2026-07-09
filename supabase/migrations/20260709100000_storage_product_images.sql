-- ============================================================================
-- Sportem OS — Storage bucket za slike kataloga (Korak 1.1a)
--
-- Slike proizvoda i varijanti (products.image / product_variants.image drže
-- object path). Bucket je public-read → getPublicUrl radi u <img> bez signed
-- URL-a (slike nisu osetljive). Upis/izmena/brisanje samo Admin — upload ide
-- kroz normalni server klijent (RLS), bez service role.
--
-- Model rola je isti kao u 0.5: svi ulogovani su Postgres rola `authenticated`,
-- razlika po roli kroz public.current_app_role().
-- ============================================================================

-- ── bucket ───────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,                                   -- public read (CDN/getPublicUrl)
  5242880,                                -- 5 MiB po fajlu
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- ── politike na storage.objects (samo za ovaj bucket) ────────────────────────
-- Čitanje: svi ulogovani (public bucket ionako služi preko CDN-a).
create policy "product_images_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images');

-- Upis: samo Admin.
create policy "product_images_admin_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images' and public.current_app_role() = 'admin'
  );

-- Izmena (upsert postojećeg objekta): samo Admin.
create policy "product_images_admin_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images' and public.current_app_role() = 'admin'
  )
  with check (
    bucket_id = 'product-images' and public.current_app_role() = 'admin'
  );

-- Brisanje: samo Admin.
create policy "product_images_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images' and public.current_app_role() = 'admin'
  );
