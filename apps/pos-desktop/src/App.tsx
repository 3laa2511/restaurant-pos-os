import { invoke } from '@tauri-apps/api/core';
import { useMemo, useState } from 'react';
import './styles.css';
import { categories, demoProducts, searchProducts } from './pos/catalog.js';
import { addProduct, calculateCart, emptyCart, removeProduct, setQuantity } from './pos/cart.js';
import { confirmOrder, createOrder } from './pos/order.js';
import { createDatabaseBridge } from './pos/tauri-bridge.js';
import { persistCompletedCheckout } from './pos/sqlite-checkout.js';
import type { CartState } from './pos/types.js';
import type { KitchenStation } from './pos/kitchen-routing.js';
import type { PaymentInput } from '../../../services/api/src/modules/payments/payment-policy.js';

const money = (value: number) => `${value.toFixed(2)} ج.م`;
const db = createDatabaseBridge({ invoke });

export function App() {
  const [cart, setCart] = useState<CartState>(emptyCart());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [checkoutState, setCheckoutState] = useState<'IDLE' | 'SAVING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const products = useMemo(() => searchProducts(demoProducts, query, category), [query, category]);
  const totals = calculateCart(cart);
  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

  async function handleCheckout() {
    if (!cart.items.length || checkoutState === 'SAVING') return;

    setCheckoutState('SAVING');
    setCheckoutError(null);

    try {
      await db.initialize();
      const order = confirmOrder(createOrder({
        id: crypto.randomUUID(),
        orderNumber: `POS-${Date.now()}`,
        branchId: 'branch-01',
        deviceId: 'POS-01',
        cashierId: 'cashier-local',
        cart,
      }));

      const stationByProduct: Readonly<Record<string, KitchenStation>> = {};
      const printJobs = [...new Set(order.items.map((item) => stationByProduct[item.productId] ?? 'KITCHEN'))].map((station, index) => ({
        id: `${order.id}:kitchen:${index}`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        station,
        copies: 1,
        payload: `#${order.orderNumber} | ${station}\n${order.items.map((item) => `${item.quantity} x ${item.nameAr}${item.note ? ` — ${item.note}` : ''}`).join('\n')}\n`,
        status: 'PENDING' as const,
        attempts: 0,
        lastError: null,
        createdAt: order.createdAt,
      }));
      printJobs.push({
        id: `${order.id}:customer`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        station: 'CUSTOMER',
        copies: 1,
        payload: `#${order.orderNumber}\n${order.items.map((item) => `${item.quantity} x ${item.nameAr}${item.note ? ` — ${item.note}` : ''}`).join('\n')}\n----------------\nالإجمالي: ${order.total.toFixed(2)} ج.م\n`,
        status: 'PENDING',
        attempts: 0,
        lastError: null,
        createdAt: order.createdAt,
      });

      const payment: PaymentInput = {
        orderId: order.id,
        shiftId: 'shift-local',
        method: 'CASH',
        amount: order.total,
        reference: null,
      };

      await persistCompletedCheckout({
        db,
        order,
        printJobs,
        payment,
        paymentId: `${order.id}:payment`,
        idempotencyKey: `${order.deviceId}:${order.orderNumber}`,
        clientSequence: Date.now(),
      });

      setCheckoutState('SUCCESS');
      setCart(emptyCart());
    } catch (error) {
      setCheckoutState('ERROR');
      setCheckoutError(error instanceof Error ? error.message : 'فشل حفظ الأوردر');
    }
  }

  return (
    <main dir="rtl" className="pos-shell">
      <header className="topbar"><div className="brand"><strong>Restaurant POS</strong><span>الفرع · POS-01</span></div><div className="connection"><i /> متصل</div></header>
      <section className="workspace">
        <aside className="cart-panel">
          <div className="panel-title"><h2>الأوردر الحالي</h2><span>{itemCount} أصناف</span></div>
          {cart.items.length === 0 ? <div className="empty">ابدأ بإضافة المنتجات إلى الأوردر</div> : <div className="cart-items">{cart.items.map((item) => <article className="cart-item" key={item.product.id}><div><strong>{item.product.nameAr}</strong><small>{money(item.product.price)}</small></div><div className="qty"><button onClick={() => setCart(setQuantity(cart, item.product.id, item.quantity - 1))}>−</button><b>{item.quantity}</b><button onClick={() => setCart(setQuantity(cart, item.product.id, item.quantity + 1))}>+</button><button className="remove" onClick={() => setCart(removeProduct(cart, item.product.id))}>×</button></div></article>)}</div>}
          <div className="summary"><div><span>الإجمالي الفرعي</span><b>{money(totals.subtotal)}</b></div><div><span>الخصم</span><b>{money(totals.discount)}</b></div><div className="grand"><span>الإجمالي</span><b>{money(totals.total)}</b></div><button disabled={!cart.items.length || checkoutState === 'SAVING'} onClick={handleCheckout}>{checkoutState === 'SAVING' ? 'جاري الحفظ...' : checkoutState === 'SUCCESS' ? 'تم الحفظ ✓' : 'الدفع والتأكيد'}</button>{checkoutState === 'ERROR' && <small role="alert">{checkoutError}</small>}</div>
        </aside>
        <section className="menu-panel"><div className="menu-head"><div><h1>قائمة المنتجات</h1><p>اضغط على المنتج لإضافته للأوردر</p></div><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث عن منتج أو SKU" /></div><nav className="categories">{categories.map((item) => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.name}</button>)}</nav><div className="products">{products.map((product) => <button className="product-card" key={product.id} onClick={() => { setCheckoutState('IDLE'); setCart(addProduct(cart, product)); }}><strong>{product.nameAr}</strong><small>{product.nameEn}</small><b>{money(product.price)}</b></button>)}{!products.length && <div className="empty-products">لا توجد منتجات مطابقة</div>}</div></section>
      </section>
    </main>
  );
}
