-- ==============================================================================
-- BO'SH STORE RETAIL PLATFORM — SEED DATA MIGRATION
-- Migration Version: 20260901_004_seed_data
-- Target: Supabase PostgreSQL 15+
-- ==============================================================================

-- 1. Roles & Permissions
INSERT INTO roles (id, name, description) VALUES
  ('owner', 'Business Owner', 'Full system access including finance, profits, and staff management'),
  ('admin', 'Administrator', 'Full operational and configuration access'),
  ('manager', 'Store Manager', 'Operational oversight, inventory adjustments, and order processing'),
  ('cashier', 'POS Cashier', 'Point of sale, order creation, customer lookup'),
  ('technician', 'Repair Technician', 'Hardware diagnosis, repair ticket processing, part consumption'),
  ('lounge_host', 'Gaming Lounge Host', 'Station management, timer billing, snacks and beverages'),
  ('customer', 'Customer', 'Online storefront ordering, repair status tracking')
ON CONFLICT (id) DO NOTHING;

-- 2. Warehouses
INSERT INTO warehouses (id, name, name_ar, location, is_main, contact_phone) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Main Nasr City Warehouse', 'مستودع مدينة نصر الرئيسي', 'Nasr City, Cairo', true, '+201001234567'),
  ('00000000-0000-0000-0000-000000000002', 'Heliopolis Retail Branch', 'فرع مصر الجديدة', 'Heliopolis, Cairo', false, '+201001234568')
ON CONFLICT (id) DO NOTHING;

-- 3. Categories
INSERT INTO categories (id, name, name_ar, slug, description, description_ar, icon, display_order) VALUES
  ('11111111-0000-0000-0000-000000000001', 'PlayStation Consoles', 'أجهزة بلايستيشن', 'playstation-consoles', 'PlayStation 5 and PlayStation 4 console systems', 'أجهزة بلايستيشن 5 وبلايستيشن 4', 'Gamepad2', 1),
  ('11111111-0000-0000-0000-000000000002', 'Controllers & Accessories', 'أذرع التحكم والإكسسوارات', 'controllers-accessories', 'DualSense, DualShock, headsets, and charging docks', 'أذرع تحكم وسماعات وشواحن', 'Headphones', 2),
  ('11111111-0000-0000-0000-000000000003', 'Video Games', 'ألعاب الفيديو', 'video-games', 'Physical disc titles for PS5, PS4, and Nintendo Switch', 'أسطوانات ألعاب أصلية', 'Disc', 3),
  ('11111111-0000-0000-0000-000000000004', 'Repair Parts & Service', 'قطع غيار وخدمات الصيانة', 'repair-parts', 'Original replacement parts and maintenance services', 'قطع غيار أصلية وخدمات صيانة', 'Wrench', 4)
ON CONFLICT (id) DO NOTHING;

-- 4. Brands
INSERT INTO brands (id, name, description) VALUES
  ('22222222-0000-0000-0000-000000000001', 'Sony PlayStation', 'Official Sony Interactive Entertainment hardware and accessories'),
  ('22222222-0000-0000-0000-000000000002', 'Electronic Arts (EA)', 'Global sports and action video game publisher'),
  ('22222222-0000-0000-0000-000000000003', 'Ubisoft', 'Leading developer and publisher of interactive entertainment'),
  ('22222222-0000-0000-0000-000000000004', 'Nintendo', 'Nintendo consoles and exclusive games')
ON CONFLICT (id) DO NOTHING;

-- 5. Shipping Rates
INSERT INTO shipping_rates (id, governorate, governorate_ar, standard_fee, express_fee, free_shipping_threshold, estimated_days, estimated_days_ar) VALUES
  ('33333333-0000-0000-0000-000000000001', 'Cairo', 'القاهرة', 50.00, 80.00, 2000.00, '24-48 Hours', '٢٤-٤٨ ساعة'),
  ('33333333-0000-0000-0000-000000000002', 'Giza', 'الجيزة', 50.00, 80.00, 2000.00, '24-48 Hours', '٢٤-٤٨ ساعة'),
  ('33333333-0000-0000-0000-000000000003', 'Alexandria', 'الإسكندرية', 75.00, 120.00, 2500.00, '2-3 Days', '٢-٣ أيام'),
  ('33333333-0000-0000-0000-000000000004', 'Qalyubia', 'القليوبية', 60.00, 100.00, 2500.00, '2-3 Days', '٢-٣ أيام'),
  ('33333333-0000-0000-0000-000000000005', 'Gharbia', 'الغربية', 80.00, 130.00, 3000.00, '2-4 Days', '٢-٤ أيام'),
  ('33333333-0000-0000-0000-000000000006', 'Dakahlia', 'الدقهلية', 80.00, 130.00, 3000.00, '2-4 Days', '٢-٤ أيام'),
  ('33333333-0000-0000-0000-000000000007', 'Sharqia', 'الشرقية', 80.00, 130.00, 3000.00, '2-4 Days', '٢-٤ أيام'),
  ('33333333-0000-0000-0000-000000000008', 'Suez', 'السويس', 80.00, 130.00, 3000.00, '2-4 Days', '٢-٤ أيام'),
  ('33333333-0000-0000-0000-000000000009', 'Ismailia', 'الإسماعيلية', 80.00, 130.00, 3000.00, '2-4 Days', '٢-٤ أيام'),
  ('33333333-0000-0000-0000-000000000010', 'Port Said', 'بورسعيد', 80.00, 130.00, 3000.00, '2-4 Days', '٢-٤ أيام'),
  ('33333333-0000-0000-0000-000000000011', 'Red Sea', 'البحر الأحمر', 110.00, 180.00, 4000.00, '3-5 Days', '٣-٥ أيام'),
  ('33333333-0000-0000-0000-000000000012', 'South Sinai', 'جنوب سيناء', 110.00, 180.00, 4000.00, '3-5 Days', '٣-٥ أيام'),
  ('33333333-0000-0000-0000-000000000013', 'Aswan', 'أسوان', 110.00, 180.00, 4000.00, '4-6 Days', '٤-٦ أيام'),
  ('33333333-0000-0000-0000-000000000014', 'Luxor', 'الأقصر', 110.00, 180.00, 4000.00, '4-6 Days', '٤-٦ أيام')
ON CONFLICT (id) DO NOTHING;

-- 6. Coupons
INSERT INTO coupons (id, code, discount_type, discount_value, min_order_amount, max_discount_amount, start_date, expiration_date, usage_limit, usage_count, per_customer_limit, is_active, description_en, description_ar) VALUES
  ('44444444-0000-0000-0000-000000000001', 'WELCOME10', 'percentage', 10.00, 500.00, 300.00, NOW() - INTERVAL '30 days', NOW() + INTERVAL '365 days', 1000, 24, 1, true, '10% off for new gamers (Max 300 EGP)', 'خصم ١٠٪ للعملاء الجدد (بحد أقصى ٣٠٠ جنيه)'),
  ('44444444-0000-0000-0000-000000000002', 'BOSH50', 'fixed', 50.00, 1000.00, 50.00, NOW() - INTERVAL '30 days', NOW() + INTERVAL '365 days', 500, 89, 2, true, '50 EGP flat discount on orders over 1,000 EGP', 'خصم ٥٠ جنيه على الطلبات أكثر من ١٠٠٠ جنيه'),
  ('44444444-0000-0000-0000-000000000003', 'GAMING20', 'percentage', 20.00, 2000.00, 600.00, NOW() - INTERVAL '30 days', NOW() + INTERVAL '365 days', 200, 42, 1, true, '20% off on premium gaming hardware and accessories', 'خصم ٢٠٪ على إكسسوارات الجيمنج المتميزة')
ON CONFLICT (id) DO NOTHING;

-- 7. Gaming Stations
INSERT INTO gaming_stations (id, code, name, name_ar, type, screen_model, controllers_count, current_status, hourly_rate, hourly_rate_single, hourly_rate_multi, is_vip, installed_games) VALUES
  ('55555555-0000-0000-0000-000000000001', 'PS5-STD-01', 'Station 1 - Standard', 'محطة ١ - ستاندرد', 'ps5_standard', 'Sony Bravia 55" 4K 120Hz', 2, 'available', 50.00, 50.00, 70.00, false, ARRAY['EA Sports FC 24', 'Mortal Kombat 1', 'Tekken 8', 'Spider-Man 2']),
  ('55555555-0000-0000-0000-000000000002', 'PS5-STD-02', 'Station 2 - Standard', 'محطة ٢ - ستاندرد', 'ps5_standard', 'Sony Bravia 55" 4K 120Hz', 2, 'available', 50.00, 50.00, 70.00, false, ARRAY['EA Sports FC 24', 'Call of Duty: Modern Warfare III', 'Rocket League']),
  ('55555555-0000-0000-0000-000000000003', 'PS5-STD-03', 'Station 3 - Standard', 'محطة ٣ - ستاندرد', 'ps5_standard', 'Sony Bravia 55" 4K 120Hz', 2, 'available', 50.00, 50.00, 70.00, false, ARRAY['EA Sports FC 24', 'GTA V', 'NBA 2K24']),
  ('55555555-0000-0000-0000-000000000004', 'PS5-VIP-01', 'VIP Lounge 1 - Ultimate', 'غرفة VIP ١ - التميز', 'ps5_vip', 'Samsung 75" QLED 4K 144Hz', 4, 'available', 110.00, 110.00, 130.00, true, ARRAY['EA Sports FC 24', 'Mortal Kombat 1', 'Tekken 8', 'Spider-Man 2', 'Gran Turismo 7']),
  ('55555555-0000-0000-0000-000000000005', 'PS5-VIP-02', 'VIP Lounge 2 - Pro Arena', 'غرفة VIP ٢ - برو أرينا', 'ps5_vip', 'LG OLED 65" C3 4K 120Hz', 4, 'available', 110.00, 110.00, 130.00, true, ARRAY['EA Sports FC 24', 'Tekken 8', 'Street Fighter 6', 'Overcooked! All You Can Eat'])
ON CONFLICT (id) DO NOTHING;
