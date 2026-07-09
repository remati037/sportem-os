-- ============================================================================
-- Sportem OS — Storage bucket za priloge troškova (Korak 1.7)
--
-- Prilog uz trošak (račun/faktura) — expenses.attachment_path drži object path.
-- Za razliku od kataloga, ovaj bucket je PRIVATAN (računi su osetljivi) →
-- prikaz ide isključivo kroz signed URL (createSignedUrl), nikad public URL.
-- Dozvoljeni tipovi uključuju PDF (računi su često PDF, ne samo slike).
--
-- Model rola isti kao u 0.5 / 1.1a: svi ulogovani su Postgres rola
-- `authenticated`, razlika po roli kroz public.current_app_role().
-- Čitanje: Admin/Menadžer (privatan bucket — ne svi authenticated).
-- Upis/izmena/brisanje: samo Admin.
-- ============================================================================

-- ── bucket ───────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-attachments',
  'expense-attachments',
  false,                                  -- privatan → samo signed URL
  5242880,                                -- 5 MiB po fajlu
  array['image/webp', 'image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do nothing;

-- ── politike na storage.objects (samo za ovaj bucket) ────────────────────────
-- Čitanje: Admin i Menadžer (Logistika nema pristup finansijama/troškovima).
create policy "expense_attachments_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'expense-attachments'
    and public.current_app_role() in ('admin', 'manager')
  );

-- Upis: samo Admin.
create policy "expense_attachments_admin_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expense-attachments' and public.current_app_role() = 'admin'
  );

-- Izmena (upsert postojećeg objekta): samo Admin.
create policy "expense_attachments_admin_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'expense-attachments' and public.current_app_role() = 'admin'
  )
  with check (
    bucket_id = 'expense-attachments' and public.current_app_role() = 'admin'
  );

-- Brisanje: samo Admin.
create policy "expense_attachments_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'expense-attachments' and public.current_app_role() = 'admin'
  );
