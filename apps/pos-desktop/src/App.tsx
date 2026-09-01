import { invoke } from '@tauri-apps/api/core';
import { useMemo, useState } from 'react';
import './styles.css';
import { categories, demoProducts, searchProducts } from './pos/catalog.js';
import { addProduct, calculateCart, emptyCart, removeProduct, setQuantity } from './pos/cart.js';
import { confirmOrder, createOrder } from './pos/order.js';
import { createPrintJob } from './pos/print-job.js';
import { createDatabaseBridge } from './pos/tauri-bridge.js';
import { persistCompletedCheckout } from './pos/sqlite-checkout.js';
import type { CartState } from './pos/types.js';
import type { KitchenStation } from './pos/kitchen-routing.js';
import type { PaymentInput } from '../../../services/api/src/modules/payments/payment-policy.js';

const money = (value: number) => `${value.toFixed(2)} ج.م`;
const db = createDatabaseBridge({ invoke });

type CheckoutIdentity = {
  orderId: string;
  orderNumber: string;
  idempotencyKey: string;
  clientSequence: number;
};

function createCheckoutIdentity(): CheckoutIdentity {
  const token = crypto.randomUUID();
  return {
    orderId: token,
    orderNumber: `POS-${Date.now()}`,
    idempotencyKey: `POS-01:${token}`,
    clientSequence: Date.now(),
  };
}

export function App() {
  const [cart, setCart] = useState<CartState>(emptyCart());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [checkoutState, setCheckoutState] = useState<'IDLE' | 'SAVING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutIdentity, setCheckoutIdentity] = useState<CheckoutIdentity | null>(null);
  const products = useMemo(() => searchProducts(demoProducts, query, category), [query, category]);
  const totals = calculateCart(cart);
  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

  function resetCheckoutIdentity(): void {
    if (checkoutState !== 'SAVING') setCheckoutIdentity(null);
    setCheckoutState('IDLE');
    setCheckoutError(null);
  }

  async function handleCheckout() {
    if (!cart.items.length || checkoutState === 'SAVING') return;

    setCheckoutState('SAVING');
    setCheckoutError(null);

    try {
      await db.initialize();
      const identity = checkoutIdentity ?? createCheckoutIdentity();
      if (!checkoutIdentity) setCheckoutIdentity(identity);

      const order = confirmOrder(createOrder({
        id: identity.orderId,
        orderNumber: identity.orderNumber,
        branchId: 'branch-01',
        deviceId: 'POS-01',
        cashierId: 'cashier-local',
        cart,
      }));

      const stationByProduct: Readonly<Record<string, KitchenStation>> = {};
      const stations = [...new Set(order.items.map((item) => stationByProduct[item.productId] ?? 'KITCHEN'))];
      const printJobs = stations.map((station, index) => createPrintJob({
        id: `${order.id}:kitchen:${index}`,
        order: {
          ...order,
          items: order.items.filter((item) => (stationByProduct[item.productId] ?? 'KITCHEN') === station),
        },
        station,
      }));
      printJobs.push(createPrintJob({ id: `${order.id}:customer`, order, station: 'CUSTOMER' }));

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
        idempotencyKey: identity.idempotencyKey,
        clientSequence: identity.clientSequence,
      });

      setCheckoutState('SUCCESS');
      setCheckoutIdentity(null);
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
          {cart.items.length === 0 ? <div className="empty">ابدأ بإضافة المنتجات إلى الأوردر</div> : <div className="cart-items">{cart.items.map((item) => <article className="cart-item" key={item.product.id}><div><strong>{item.product.nameAr}</strong><small>{money(item.product.price)}</small></div><div className="qty"><button onClick={() => { resetCheckoutIdentity(); setCart(setQuantity(cart, item.product.id, item.quantity - 1)); }}>−</button><b>{item.quantity}</b><button onClick={() => { resetCheckoutIdentity(); setCart(setQuantity(cart, item.product.id, item.quantity + 1)); }}>+</button><button className="remove" onClick={() => { resetCheckoutIdentity(); setCart(removeProduct(cart, item.product.id)); }}>×</button></div></article>)}</div>}
          <div className="summary"><div><span>الإجمالي الفرعي</span><b>{money(totals.subtotal)}</b></div><div><span>الخصم</span><b>{money(totals.discount)}</b></div><div className="grand"><span>الإجمالي</span><b>{money(totals.total)}</b></div><button disabled={!cart.items.length || checkoutState === 'SAVING'} onClick={handleCheckout}>{checkoutState === 'SAVING' ? 'جاري الحفظ...' : checkoutState === 'SUCCESS' ? 'تم الحفظ ✓' : 'الدفع والتأكيد'}</button>{checkoutState === 'ERROR' && <small role="alert">{checkoutError}</small>}</div>
        </aside>
        <section className="menu-panel"><div className="menu-head"><div><h1>قائمة المنتجات</h1><p>اضغط على المنتج لإضافته للأوردر</p></div><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث عن منتج أو SKU" /></div><nav className="categories">{categories.map((item) => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.name}</button>)}</nav><div className="products">{products.map((product) => <button className="product-card" key={product.id} onClick={() => { resetCheckoutIdentity(); setCart(addProduct(cart, product)); }}><strong>{product.nameAr}</strong><small>{product.nameEn}</small><b>{money(product.price)}</b></button>)}{!products.length && <div className="empty-products">لا توجد منتجات مطابقة</div>}</div></section>
      </section>
    </main>
  );
}
