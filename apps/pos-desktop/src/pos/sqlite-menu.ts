import type { LocalDatabaseBridge } from './tauri-bridge.js';
import type { Product } from './types.js';
import { getAccessToken } from './auth-client.js';

export interface MenuCategory {
  id: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
}

export interface LocalMenu {
  categories: MenuCategory[];
  products: Product[];
  source: 'SERVER' | 'CACHE' | 'BOOTSTRAP';
}

type RemoteCategory = {
  id: string;
  name?: string | null;
  nameAr?: string | null;
  sortOrder?: number;
  products: Array<{
    id: string;
    sku: string;
    name: string;
    nameAr?: string | null;
    price: number;
    kitchenStation?: 'KITCHEN' | 'BEVERAGE' | 'PACKING';
  }>;
};

const bootstrap = [
  { id: 'burger-classic', nameAr: 'برجر كلاسيك', nameEn: 'Classic Burger', sku: 'BRG-001', price: 120, categoryId: 'burger' },
  { id: 'burger-double', nameAr: 'دابل برجر', nameEn: 'Double Burger', sku: 'BRG-002', price: 165, categoryId: 'burger' },
  { id: 'meal-chicken', nameAr: 'وجبة تشيكن', nameEn: 'Chicken Meal', sku: 'ML-001', price: 190, categoryId: 'meals' },
  { id: 'fries', nameAr: 'بطاطس', nameEn: 'Fries', sku: 'ADD-001', price: 45, categoryId: 'addons' },
  { id: 'cola', nameAr: 'كولا', nameEn: 'Cola', sku: 'DRK-001', price: 35, categoryId: 'drinks', kitchenStation: 'BEVERAGE' },
  { id: 'water', nameAr: 'مياه', nameEn: 'Water', sku: 'DRK-002', price: 15, categoryId: 'drinks', kitchenStation: 'BEVERAGE' },
] satisfies Omit<Product, 'active'>[];

const bootstrapCategories: MenuCategory[] = [
  { id: 'all', nameAr: 'الكل', nameEn: 'All', sortOrder: -1 },
  { id: 'burger', nameAr: 'برجر', nameEn: 'Burgers', sortOrder: 1 },
  { id: 'meals', nameAr: 'وجبات', nameEn: 'Meals', sortOrder: 2 },
  { id: 'addons', nameAr: 'إضافات', nameEn: 'Add-ons', sortOrder: 3 },
  { id: 'drinks', nameAr: 'مشروبات', nameEn: 'Drinks', sortOrder: 4 },
];

function mapRows(rows: Array<Record<string, unknown>>): Product[] {
  return rows.map((row) => ({
    id: String(row.id),
    sku: String(row.sku),
    nameAr: String(row.name_ar),
    nameEn: String(row.name_en),
    categoryId: String(row.category_id),
    price: Number(row.price),
    active: Number(row.active) === 1,
    kitchenStation: row.kitchen_station === 'BEVERAGE' || row.kitchen_station === 'PACKING' ? row.kitchen_station : 'KITCHEN',
  }));
}

async function readLocal(db: LocalDatabaseBridge, source: LocalMenu['source']): Promise<LocalMenu> {
  const [categories, products] = await Promise.all([
    db.query<Record<string, unknown>>('SELECT id, name_ar, name_en, sort_order FROM menu_categories WHERE active = 1 ORDER BY sort_order ASC'),
    db.query<Record<string, unknown>>('SELECT p.id, p.sku, p.name_ar, p.name_en, p.category_id, p.price, p.active, COALESCE(r.kitchen_station, \'KITCHEN\') AS kitchen_station FROM products p LEFT JOIN product_kitchen_routing r ON r.product_id = p.id WHERE p.active = 1 ORDER BY p.name_ar ASC'),
  ]);

  const mappedCategories = categories.map((row) => ({ id: String(row.id), nameAr: String(row.name_ar), nameEn: String(row.name_en), sortOrder: Number(row.sort_order) }));
  if (!mappedCategories.some((category) => category.id === 'all')) mappedCategories.unshift(bootstrapCategories[0]);
  return { categories: mappedCategories, products: mapRows(products), source };
}

async function persistMenu(db: LocalDatabaseBridge, categories: MenuCategory[], products: Product[]): Promise<void> {
  const now = new Date().toISOString();
  const statements: Array<{ sql: string; params: unknown[] }> = [
    { sql: 'DELETE FROM product_kitchen_routing', params: [] },
    { sql: 'DELETE FROM products', params: [] },
    { sql: 'DELETE FROM menu_categories', params: [] },
  ];

  for (const category of categories.filter((item) => item.id !== 'all')) {
    statements.push({
      sql: 'INSERT INTO menu_categories(id, name_ar, name_en, sort_order, active, updated_at) VALUES (?, ?, ?, ?, 1, ?)',
      params: [category.id, category.nameAr, category.nameEn, category.sortOrder, now],
    });
  }
  for (const product of products) {
    statements.push({
      sql: 'INSERT INTO products(id, sku, name_ar, name_en, category_id, price, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      params: [product.id, product.sku, product.nameAr, product.nameEn, product.categoryId, product.price, product.active ? 1 : 0, now],
    });
    statements.push({
      sql: 'INSERT INTO product_kitchen_routing(product_id, kitchen_station, updated_at) VALUES (?, ?, ?)',
      params: [product.id, product.kitchenStation ?? 'KITCHEN', now],
    });
  }
  await db.transaction(statements);
}

export async function loadMenu(db: LocalDatabaseBridge, apiBaseUrl: string): Promise<LocalMenu> {
  const cached = await readLocal(db, 'CACHE');

  try {
    const token = getAccessToken();
    if (!token) throw new Error('Authenticated POS session is required to load the remote menu');
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/menu`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`menu request failed: ${response.status}`);
    const remote = (await response.json()) as RemoteCategory[];
    const categories: MenuCategory[] = [
      { id: 'all', nameAr: 'الكل', nameEn: 'All', sortOrder: -1 },
      ...remote.map((category) => ({
        id: category.id,
        nameAr: category.nameAr ?? category.name ?? category.id,
        nameEn: category.name ?? category.nameAr ?? category.id,
        sortOrder: category.sortOrder ?? 0,
      })),
    ];
    const products: Product[] = remote.flatMap((category) => category.products.map((product) => ({
      id: product.id,
      sku: product.sku,
      nameAr: product.nameAr ?? product.name,
      nameEn: product.name,
      categoryId: category.id,
      price: Number(product.price),
      active: true,
      kitchenStation: product.kitchenStation ?? 'KITCHEN',
    })));

    if (products.length > 0) {
      await persistMenu(db, categories, products);
      return { categories, products, source: 'SERVER' };
    }
  } catch {
    // Offline-first: keep the last known local catalog.
  }

  if (cached.products.length > 0) return cached;

  const products = bootstrap.map((product) => ({ ...product, active: true }));
  await persistMenu(db, bootstrapCategories, products);
  return { categories: bootstrapCategories, products, source: 'BOOTSTRAP' };
}
