import type { CartItem, CartState, Product } from './types.js';

export const emptyCart = (): CartState => ({ items: [], orderType: 'TAKEAWAY', discount: 0, deliveryFee: 0 });

export function addProduct(cart: CartState, product: Product): CartState {
  const existing = cart.items.find((item) => item.product.id === product.id);
  const items = existing
    ? cart.items.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
    : [...cart.items, { product, quantity: 1, note: '' }];
  return { ...cart, items };
}

export function setQuantity(cart: CartState, productId: string, quantity: number): CartState {
  if (!Number.isInteger(quantity) || quantity < 1) return removeProduct(cart, productId);
  return { ...cart, items: cart.items.map((item) => item.product.id === productId ? { ...item, quantity } : item) };
}

export function removeProduct(cart: CartState, productId: string): CartState {
  return { ...cart, items: cart.items.filter((item) => item.product.id !== productId) };
}

export function setItemNote(cart: CartState, productId: string, note: string): CartState {
  return { ...cart, items: cart.items.map((item) => item.product.id === productId ? { ...item, note } : item) };
}

export function calculateCart(cart: CartState) {
  const subtotal = cart.items.reduce((sum, item: CartItem) => sum + item.product.price * item.quantity, 0);
  const total = Math.max(0, subtotal - cart.discount + cart.deliveryFee);
  return { subtotal, discount: cart.discount, deliveryFee: cart.deliveryFee, total };
}
