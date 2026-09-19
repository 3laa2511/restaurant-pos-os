-- ==============================================================================
-- BO'SH STORE RETAIL PLATFORM — STORAGE BUCKETS & POLICIES
-- Migration Version: 20260901_003_storage_buckets
-- Target: Supabase Storage
-- ==============================================================================

-- 1. Create Buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('products', 'products', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']),
  ('repair-photos', 'repair-photos', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('expense-receipts', 'expense-receipts', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Storage Policies

-- Products Bucket: Public read access, Authenticated staff upload/update/delete
CREATE POLICY "Public Read Access for Products Bucket"
ON storage.objects FOR SELECT
USING (bucket_id = 'products');

CREATE POLICY "Service Role Upload for Products Bucket"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'products');

-- Repair Photos Bucket: Service role & technicians access
CREATE POLICY "Service Role Access for Repair Photos"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'repair-photos')
WITH CHECK (bucket_id = 'repair-photos');

-- Expense Receipts Bucket: Service role & finance access
CREATE POLICY "Service Role Access for Expense Receipts"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'expense-receipts')
WITH CHECK (bucket_id = 'expense-receipts');
