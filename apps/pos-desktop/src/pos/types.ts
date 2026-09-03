export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';

export interface Product {
  id: string;
  nameAr: string;
  nameEn: string;
  sku: string;
  price: number;
  categoryId: string;
  active: boolean;
}

export interface ModifierOption {
  id: string;
  nameAr: string;
  nameEn: string;
  priceDelta: number;
  active: boolean;
}

export interface ModifierGroup {
  id: string;
  nameAr: string;
  nameEn: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: ModifierOption[];
  active: boolean;
}

export interface CartItemModifier {
  groupId: string;
  optionId: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  note: string;
  modifiers?: CartItemModifier[];
}

export interface CartState {
  items: CartItem[];
  orderType: OrderType;
  discount: number;
  deliveryFee: number;
}
