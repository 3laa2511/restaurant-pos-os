import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import './styles.css';
import { categories, demoProducts, searchProducts } from './pos/catalog.js';
import { addProduct, calculateCart, emptyCart, removeProduct, setQuantity } from './pos/cart.js';
import { confirmOrder, createOrder } from './pos/order.js';
import { createPrintJob } from './pos/print-job.js';
import { createDatabaseBridge } from './pos/tauri-bridge.js';
import { persistCompletedCheckout } from './pos/sqlite-checkout.js';
import { closeLocalShift, getOpenShift, openLocalShift } from './pos/sqlite-shift.js';
import { openShift, requestShiftClose } from './pos/shift.js';
import type { Shift } from './pos/shift.js';
import type { CartState } from './pos/types.js';
import type { KitchenStation } from './pos/kitchen-routing.js';
import type { PaymentInput } from '../../../services/api/src/modules/payments/payment-policy.js';

const BRANCH_ID = 'branch-01';
const DEVICE_ID = 'POS-01';
const CASHIER_ID = 'cashier-local';
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
  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const products = useMemo(() => searchProducts(demoProducts, query, category), [query, category]);
  const totals = calculateCart(cart);
  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await db.initialize();
        const existing = await getOpenShift(db, { branchId: BRANCH_ID, deviceId: DEVICE_ID, cashierId: CASHIER_ID });
        if (active) setShift(existing);
      } catch (error) {
        if (active) setShiftError(error instanceof Error ? error.message : 'تعذر تحميل الوردية');
      } finally {
        if (active) setShiftLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  function resetCheckoutIdentity(): void {
    if (checkoutState !== 'SAVING') setCheckoutIdentity(null);
    setCheckoutState('IDLE');
    setCheckoutError(null);
  }

  async function handleOpenShift() {
    setShiftLoading(true);
    setShiftError(null);
    try {
      await db.initialize();
      const opened = openShift({
        id: `shift:${crypto.randomUUID()}`,
        branchId: BRANCH_ID,
        deviceId: DEVICE_ID,
        cashierId: CASHIER_ID,
      });
      const persisted = await openLocalShift(db, opened);
      setShift(persisted);
    } catch (error) {
      setShiftError(error instanceof Error ? error.message : 'تعذر فتح الوردية');
    } finally {
      setShiftLoading(false);
    }
  }

  async function handleCloseShift() {
    if (!shift || cart.items.length || checkoutState === 'SAVING') return;
    setShiftLoading(true);
    setShiftError(null);
    try {
      const closed = requestShiftClose(shift);
      await closeLocalShift(db, closed.id, closed.closedAt!);
      setShift(null);
      resetCheckoutIdentity();
    } catch (error) {
      setShiftError(error instanceof Error ? error.message : 'تعذر إغلاق الوردية');
    } finally {
      setShiftLoading(false);
    }
  }

  async function handleCheckout() {
    if (!cart.items.length || checkoutState === 'SAVING' || !shift) return;

    setCheckoutState('SAVING');
    setCheckoutError(null);

    try {
      await db.initialize();
      const identity = checkoutIdentity ?? createCheckoutIdentity();
      if (!checkoutIdentity) setCheckoutIdentity(identity);

      const order = confirmOrder(createOrder({
        id: identity.orderId,
        orderNumber: identity.orderNumber,
        branchId: shift.branchId,
        deviceId: shift.deviceId,
        cashierId: shift.cashierId,
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
        shiftId: shift.id,
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

  const canCheckout = Boolean(shift) && cart.items.length > 0 && checkoutState !== 'SAVING';

  return (
    <main dir="rtl" className="pos-shell">
      <header className="topbar">
        <div className="brand"><strong>Restaurant POS</strong><span>الفرع · {DEVICE_ID}</span></div>
        <div className="connection"><i /> {shift ? `وردية مفتوحة · ${shift.cashierId}` : 'لا توجد وردية مفتوحة'}</div>
        {shift ? <button disabled={shiftLoading || Boolean(cart.items.length) || checkoutState === 'SAVING'} onClick={handleCloseShift}>إغلاق الوردية</button> : <button disabled={shiftLoading} onClick={handleOpenShift}>{shiftLoading ? 'جاري التحميل...' : 'فتح الوردية'}</button>}
      </header>
      <section className="workspace">
        <aside className="cart-panel">
          <div className="panel-title"><h2>الأوردر الحالي</h2><span>{itemCount} أصناف</span></div>
          {!shift && <div className="empty">افتح الوردية أولًا قبل تسجيل المبيعات</div>}
          {shift && cart.items.length === 0 ? <div className="empty">ابدأ بإضافة المنتجات إلى الأوردر</div> : shift && <div className="cart-items">{cart.items.map((item) => <article className="cart-item" key={item.product.id}><div><strong>{item.product.nameAr}</strong><small>{money(item.product.price)}</small></div><div className="qty"><button onClick={() => { resetCheckoutIdentity(); setCart(setQuantity(cart, item.product.id, item.quantity - 1)); }}>−</button><b>{item.quantity}</b><button onClick={() => { resetCheckoutIdentity(); setCart(setQuantity(cart, item.product.id, item.quantity + 1)); }}>+</button><button className="remove" onClick={() => { resetCheckoutIdentity(); setCart(removeProduct(cart, item.product.id)); }}>×</button></div></article>)}</div>}
          <div className="summary"><div><span>الإجمالي الفرعي</span><b>{money(totals.subtotal)}</b></div><div><span>الخصم</span><b>{money(totals.discount)}</b></div><div className="grand"><span>الإجمالي</span><b>{money(totals.total)}</b></div><button disabled={!canCheckout} onClick={handleCheckout}>{checkoutState === 'SAVING' ? 'جاري الحفظ...' : checkoutState === 'SUCCESS' ? 'تم الحفظ ✓' : 'الدفع والتأكيد'}</button>{checkoutState === 'ERROR' && <small role="alert">{checkoutError}</small>}{shiftError && <small role="alert">{shiftError}</small>}</div>
        </aside>
        <section className="menu-panel"><div className="menu-head"><div><h1>قائمة المنتجات</h1><p>{shift ? 'اضغط على المنتج لإضافته للأوردر' : 'افتح الوردية لتفعيل البيع'}</p></div><input disabled={!shift} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث عن منتج أو SKU" /></div><nav className="categories">{categories.map((item) => <button disabled={!shift} key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.name}</button>)}</nav><div className="products">{products.map((product) => <button disabled={!shift} className="product-card" key={product.id} onClick={() => { resetCheckoutIdentity(); setCart(addProduct(cart, product)); }}><strong>{product.nameAr}</strong><small>{product.nameEn}</small><b>{money(product.price)}</b></button>)}{!products.length && <div className="empty-products">لا توجد منتجات مطابقة</div>}</div></section>
      </section>
    </main>
  );
}
