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

export interface CartItem {
  product: Product;
  quantity: number;
  note: string;
}

export interface CartState {
  items: CartItem[];
  orderType: OrderType;
  discount: number;
  deliveryFee: number;
}
