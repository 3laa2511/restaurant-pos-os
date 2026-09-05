import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import './styles.css';
import { categories, demoProducts, searchProducts } from './pos/catalog.js';
import { addProduct, calculateCart, emptyCart, removeProduct, setQuantity } from './pos/cart.js';
import { confirmOrder, createOrder } from './pos/order.js';
import { createPrintJob } from './pos/print-job.js';
import { createPrintWorkerRuntime } from './pos/print-worker.js';
import { createDatabaseBridge } from './pos/tauri-bridge.js';
import { createSqliteSyncRepository } from './pos/sync-repository.js';
import { createHttpSyncTransport, createSyncWorkerRuntime } from './pos/sync-worker.js';
import { persistCompletedCheckout } from './pos/sqlite-checkout.js';
import { nextDeviceSequence } from './pos/sqlite-sequence.js';
import { closeLocalShift, getOpenShift, openLocalShift } from './pos/sqlite-shift.js';
import { openShift, requestShiftClose } from './pos/shift.js';
import { formatOrderNumber } from './pos/order-number.js';
import type { Shift } from './pos/shift.js';
import type { CartState } from './pos/types.js';
import type { KitchenStation } from './pos/kitchen-routing.js';
import type { PaymentInput } from '../../../services/api/src/modules/payments/payment-policy.js';

const BRANCH_ID = 'branch-01';
const DEVICE_ID = 'POS-01';
const CASHIER_ID = 'cashier-local';
const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';
const money = (value: number) => `${value.toFixed(2)} ج.م`;
const db = createDatabaseBridge({ invoke });

type CheckoutIdentity = { orderId: string; orderNumber: string; idempotencyKey: string; clientSequence: number };
type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';

async function createCheckoutIdentity(): Promise<CheckoutIdentity> {
  const token = crypto.randomUUID();
  const clientSequence = await nextDeviceSequence(db, DEVICE_ID);
  return { orderId: token, orderNumber: formatOrderNumber({ branchCode: BRANCH_ID, deviceCode: DEVICE_ID, sequence: clientSequence }), idempotencyKey: `${DEVICE_ID}:${token}`, clientSequence };
}

function Icon({ name }: { name: 'grid' | 'receipt' | 'clock' | 'box' | 'users' | 'settings' | 'search' | 'bell' | 'plus' | 'trash' | 'wallet' | 'arrow' }) {
  const paths: Record<string, string> = {
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6M9 16h3',
    clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    box: 'm4 7 8-4 8 4-8 4-8-4zm0 0v10l8 4 8-4V7m-8 4v10',
    users: 'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 8a3 3 0 0 0-2-2.83M18 15a4 4 0 0 1 3 4v2',
    settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm8-3.5a6.8 6.8 0 0 0-.1-1l2-1.55-2-3.46-2.4.95a8 8 0 0 0-1.7-1L15.5 3h-4l-.4 2.95a8 8 0 0 0-1.7 1L7 6l-2 3.46L7 11a7 7 0 0 0 0 2l-2 1.54L7 18l2.4-.95a8 8 0 0 0 1.7 1l.4 2.95h4l.4-2.95a8 8 0 0 0 1.7-1L19 18l2-3.46L19 13a6.8 6.8 0 0 0 .1-1z',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm6-2 4 4',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
    plus: 'M12 5v14M5 12h14',
    trash: 'M5 7h14M10 11v6M14 11v6M8 7l1-3h6l1 3m-9 0 1 14h10l1-14',
    wallet: 'M4 7h15a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1M16 13h4',
    arrow: 'M5 12h13m-5-5 5 5-5 5',
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function App() {
  const [cart, setCart] = useState<CartState>(emptyCart());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [orderType, setOrderType] = useState<OrderType>('TAKEAWAY');
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
    let printRuntime: ReturnType<typeof createPrintWorkerRuntime> | null = null;
    let syncRuntime: ReturnType<typeof createSyncWorkerRuntime> | null = null;
    void (async () => {
      try {
        await db.initialize();
        if (!active) return;
        printRuntime = createPrintWorkerRuntime({ db, invoke, intervalMs: 1000, workerId: `print-worker:${DEVICE_ID}` });
        syncRuntime = createSyncWorkerRuntime({ repository: createSqliteSyncRepository(db), transport: createHttpSyncTransport(API_BASE_URL), intervalMs: 2000, workerId: `sync-worker:${DEVICE_ID}`, leaseMs: 30_000 });
        const existing = await getOpenShift(db, { branchId: BRANCH_ID, deviceId: DEVICE_ID, cashierId: CASHIER_ID });
        if (active) setShift(existing);
      } catch (error) {
        if (active) setShiftError(error instanceof Error ? error.message : 'تعذر تحميل الوردية');
      } finally {
        if (active) setShiftLoading(false);
      }
    })();
    return () => { active = false; printRuntime?.stop(); syncRuntime?.stop(); };
  }, []);

  function resetCheckoutIdentity(): void {
    if (checkoutState !== 'SAVING') setCheckoutIdentity(null);
    setCheckoutState('IDLE');
    setCheckoutError(null);
  }

  async function handleOpenShift() {
    setShiftLoading(true); setShiftError(null);
    try {
      await db.initialize();
      const opened = openShift({ id: `shift:${crypto.randomUUID()}`, branchId: BRANCH_ID, deviceId: DEVICE_ID, cashierId: CASHIER_ID });
      setShift(await openLocalShift(db, opened));
    } catch (error) { setShiftError(error instanceof Error ? error.message : 'تعذر فتح الوردية'); }
    finally { setShiftLoading(false); }
  }

  async function handleCloseShift() {
    if (!shift || cart.items.length || checkoutState === 'SAVING') return;
    setShiftLoading(true); setShiftError(null);
    try { const closed = requestShiftClose(shift); await closeLocalShift(db, closed.id, closed.closedAt!); setShift(null); resetCheckoutIdentity(); }
    catch (error) { setShiftError(error instanceof Error ? error.message : 'تعذر إغلاق الوردية'); }
    finally { setShiftLoading(false); }
  }

  async function handleCheckout() {
    if (!cart.items.length || checkoutState === 'SAVING' || !shift) return;
    setCheckoutState('SAVING'); setCheckoutError(null);
    try {
      await db.initialize();
      const identity = checkoutIdentity ?? await createCheckoutIdentity();
      if (!checkoutIdentity) setCheckoutIdentity(identity);
      const order = confirmOrder(createOrder({ id: identity.orderId, orderNumber: identity.orderNumber, branchId: shift.branchId, deviceId: shift.deviceId, cashierId: shift.cashierId, cart }));
      const stationByProduct: Readonly<Record<string, KitchenStation>> = {};
      const stations = [...new Set(order.items.map((item) => stationByProduct[item.productId] ?? 'KITCHEN'))];
      const printJobs = stations.map((station, index) => createPrintJob({ id: `${order.id}:kitchen:${index}`, order: { ...order, items: order.items.filter((item) => (stationByProduct[item.productId] ?? 'KITCHEN') === station) }, station }));
      printJobs.push(createPrintJob({ id: `${order.id}:customer`, order, station: 'CUSTOMER' }));
      const payment: PaymentInput = { orderId: order.id, shiftId: shift.id, method: 'CASH', amount: order.total, reference: null };
      await persistCompletedCheckout({ db, order, printJobs, payment, paymentId: `${order.id}:payment`, idempotencyKey: identity.idempotencyKey, clientSequence: identity.clientSequence });
      setCheckoutState('SUCCESS'); setCheckoutIdentity(null); setCart(emptyCart());
    } catch (error) { setCheckoutState('ERROR'); setCheckoutError(error instanceof Error ? error.message : 'فشل حفظ الأوردر'); }
  }

  const canCheckout = Boolean(shift) && cart.items.length > 0 && checkoutState !== 'SAVING';
  const navItems = [
    ['grid', 'الكاشير', true], ['receipt', 'الطلبات', false], ['clock', 'الورديات', false], ['box', 'المخزون', false], ['users', 'العملاء', false], ['settings', 'الإعدادات', false],
  ] as const;
  const orderLabels: Record<OrderType, string> = { DINE_IN: 'داخل المطعم', TAKEAWAY: 'استلام', DELIVERY: 'توصيل' };

  return (
    <main dir="rtl" className="pos-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="brand-mark">B</div><div><strong>BO'SH</strong><span>RESTAURANT OS</span></div></div>
        <div className="branch-card"><span>الفرع الحالي</span><strong>فرع المنوفية</strong><small><i /> {DEVICE_ID} · متصل</small></div>
        <nav className="main-nav">{navItems.map(([icon, label, active]) => <button key={label} className={active ? 'active' : ''} type="button"><Icon name={icon} /><span>{label}</span>{label === 'الطلبات' && <b>12</b>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="sync-mini"><i /><div><strong>المزامنة تعمل</strong><span>آخر مزامنة منذ لحظات</span></div></div><div className="user-card"><div className="avatar">CA</div><div><strong>الكاشير</strong><span>{CASHIER_ID}</span></div><button type="button" aria-label="إعدادات الحساب"><Icon name="settings" /></button></div></div>
      </aside>

      <section className="app-content">
        <header className="topbar">
          <div><p className="eyebrow">نقطة البيع</p><h1>الكاشير</h1></div>
          <div className="top-actions"><div className="date-pill">السبت، ٥ سبتمبر ٢٠٢٦</div><button className="icon-button" type="button" aria-label="الإشعارات"><Icon name="bell" /><i /></button>{shift ? <button className="shift-button open" type="button" disabled={shiftLoading || Boolean(cart.items.length) || checkoutState === 'SAVING'} onClick={handleCloseShift}><i /> وردية مفتوحة <span>إغلاق</span></button> : <button className="shift-button" type="button" disabled={shiftLoading} onClick={handleOpenShift}>{shiftLoading ? 'جاري التحميل...' : 'فتح الوردية'}</button>}</div>
        </header>

        <div className="workspace">
          <section className="menu-area">
            <div className="welcome-row"><div><h2>جاهز لاستقبال الطلبات؟</h2><p>{shift ? 'اختر الأصناف وسيتم إرسال الطلب للمطبخ تلقائيًا.' : 'افتح الوردية أولًا لتفعيل عمليات البيع.'}</p></div><div className="quick-stats"><div><span>طلبات اليوم</span><strong>24</strong></div><div><span>مبيعات اليوم</span><strong>4,860 ج.م</strong></div></div></div>
            <div className="order-type-tabs">{(Object.keys(orderLabels) as OrderType[]).map((type) => <button key={type} type="button" className={orderType === type ? 'active' : ''} disabled={!shift} onClick={() => { resetCheckoutIdentity(); setOrderType(type); }}>{orderLabels[type]}</button>)}</div>
            <div className="menu-toolbar"><div className="search-box"><Icon name="search" /><input disabled={!shift} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث باسم المنتج أو SKU..." /><kbd>⌘ K</kbd></div><button className="new-order" type="button" disabled={!shift || !cart.items.length} onClick={() => { setCart(emptyCart()); resetCheckoutIdentity(); }}><Icon name="plus" /> طلب جديد</button></div>
            <nav className="categories">{categories.map((item) => <button disabled={!shift} key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)} type="button">{item.name}</button>)}</nav>
            <div className="products">{products.map((product) => <button disabled={!shift} className="product-card" key={product.id} type="button" onClick={() => { resetCheckoutIdentity(); setCart(addProduct(cart, product)); }}><div className="product-art">{product.nameAr.slice(0, 1)}</div><div className="product-copy"><strong>{product.nameAr}</strong><small>{product.nameEn}</small><b>{money(product.price)}</b></div><span className="add-product"><Icon name="plus" /></span></button>)}{!products.length && <div className="empty-products">لا توجد منتجات مطابقة</div>}</div>
          </section>

          <aside className="cart-panel">
            <div className="cart-head"><div><span>الطلب الحالي</span><h2>{orderLabels[orderType]}</h2></div><span className="order-badge">{itemCount} أصناف</span></div>
            {!shift && <div className="locked-state"><div className="lock-icon"><Icon name="clock" /></div><strong>الوردية مغلقة</strong><span>افتح الوردية من الأعلى لبدء البيع.</span></div>}
            {shift && cart.items.length === 0 && <div className="cart-empty"><div className="empty-cart-art"><Icon name="receipt" /></div><strong>الطلب فارغ</strong><span>اضغط على أي منتج لإضافته إلى الطلب.</span></div>}
            {shift && cart.items.length > 0 && <div className="cart-items">{cart.items.map((item) => <article className="cart-item" key={item.product.id}><div className="cart-item-main"><div className="mini-art">{item.product.nameAr.slice(0, 1)}</div><div><strong>{item.product.nameAr}</strong><small>{money(item.product.price)} · بدون إضافات</small></div></div><div className="item-bottom"><div className="qty"><button type="button" onClick={() => { resetCheckoutIdentity(); setCart(setQuantity(cart, item.product.id, item.quantity - 1)); }}>−</button><b>{item.quantity}</b><button type="button" onClick={() => { resetCheckoutIdentity(); setCart(setQuantity(cart, item.product.id, item.quantity + 1)); }}>+</button></div><strong>{money(item.product.price * item.quantity)}</strong><button className="remove" type="button" onClick={() => { resetCheckoutIdentity(); setCart(removeProduct(cart, item.product.id)); }} aria-label="حذف"><Icon name="trash" /></button></div></article>)}</div>}
            <div className="cart-footer"><div className="totals"><div><span>الإجمالي الفرعي</span><b>{money(totals.subtotal)}</b></div><div><span>الخصم</span><b>{money(totals.discount)}</b></div><div className="grand"><span>الإجمالي المستحق</span><strong>{money(totals.total)}</strong></div></div><div className="payment-method"><div><Icon name="wallet" /><span>الدفع نقدًا</span></div><span>Cash</span></div><button className="checkout" disabled={!canCheckout} type="button" onClick={handleCheckout}><span>{checkoutState === 'SAVING' ? 'جاري حفظ الطلب...' : checkoutState === 'SUCCESS' ? 'تم تسجيل الطلب ✓' : 'الدفع وتأكيد الطلب'}</span><strong>{money(totals.total)} <Icon name="arrow" /></strong></button>{checkoutState === 'ERROR' && <small className="error-message" role="alert">{checkoutError}</small>}{shiftError && <small className="error-message" role="alert">{shiftError}</small>}</div>
          </aside>
        </div>
      </section>
    </main>
  );
}
