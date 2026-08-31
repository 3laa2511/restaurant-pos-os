import type { Product } from './types.js';

export const demoProducts: Product[] = [
  { id: 'burger-classic', nameAr: 'برجر كلاسيك', nameEn: 'Classic Burger', sku: 'BRG-001', price: 120, categoryId: 'burger', active: true },
  { id: 'burger-double', nameAr: 'دابل برجر', nameEn: 'Double Burger', sku: 'BRG-002', price: 165, categoryId: 'burger', active: true },
  { id: 'meal-chicken', nameAr: 'وجبة تشيكن', nameEn: 'Chicken Meal', sku: 'ML-001', price: 190, categoryId: 'meals', active: true },
  { id: 'fries', nameAr: 'بطاطس', nameEn: 'Fries', sku: 'ADD-001', price: 45, categoryId: 'addons', active: true },
  { id: 'cola', nameAr: 'كولا', nameEn: 'Cola', sku: 'DRK-001', price: 35, categoryId: 'drinks', active: true },
  { id: 'water', nameAr: 'مياه', nameEn: 'Water', sku: 'DRK-002', price: 15, categoryId: 'drinks', active: true },
];

export const categories = [
  { id: 'all', name: 'الكل' },
  { id: 'burger', name: 'برجر' },
  { id: 'meals', name: 'وجبات' },
  { id: 'addons', name: 'إضافات' },
  { id: 'drinks', name: 'مشروبات' },
] as const;

export function searchProducts(products: readonly Product[], query: string, categoryId = 'all'): Product[] {
  const normalized = query.trim().toLocaleLowerCase();
  return products.filter((product) => {
    if (!product.active || (categoryId !== 'all' && product.categoryId !== categoryId)) return false;
    if (!normalized) return true;
    return [product.nameAr, product.nameEn, product.sku].some((value) => value.toLocaleLowerCase().includes(normalized));
  });
}
