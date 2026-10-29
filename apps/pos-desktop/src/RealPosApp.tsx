import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
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
import { reconcileLocalCashDrawer } from './pos/sqlite-cash-drawer.js';
import { listRecentLocalOrders } from './pos/sqlite-orders.js';
import { loadMenu, type LocalMenu } from './pos/sqlite-menu.js';
import { openShift, requestShiftClose } from './pos/shift.js';
import { formatOrderNumber } from './pos/order-number.js';
import { getPosRuntimeIdentity } from './pos/runtime-identity.js';
import type { PosRuntimeIdentity } from './pos/runtime-identity.js';
import type { Shift } from './pos/shift.js';
import type { CashDrawerReconciliation } from './pos/sqlite-cash-drawer.js';
import type { CartState, OrderType, Product } from './pos/types.js';
import type { KitchenStation } from './pos/kitchen-routing.js';
import type { PaymentInput } from '../../../services/api/src/modules/payments/payment-policy.js';
import './real-pos.css';

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';
const db = createDatabaseBridge({ invoke });

const money = (value: number) => `${value.toFixed(2)} ج.م`;
const labels = {
  ar: { pos: 'نقطة البيع', cashier: 'الكاشير', orders: 'الطلبات', shifts: 'الورديات', inventory: 'المخزون', customers: 'العملاء', settings: 'الإعدادات', openShift: 'فتح الوردية', closeShift: 'إغلاق الوردية', ready: 'جاهز لاستقبال الطلبات؟', openFirst: 'افتح الوردية أولًا لتفعيل البيع.', search: 'ابحث باسم المنتج أو SKU...', all: 'الكل', dine: 'داخل المطعم', takeaway: 'استلام', delivery: 'توصيل', currentOrder: 'الطلب الحالي', empty: 'لم تتم إضافة أصناف بعد', subtotal: 'الإجمالي الفرعي', discount: 'الخصم', deliveryFee: 'رسوم التوصيل', total: 'الإجمالي', checkout: 'تحصيل ودفع', cash: 'نقدي', card: 'بطاقة', cartCount: 'أصناف', noOrders: 'لا توجد طلبات محلية بعد', recent: 'آخر الطلبات', server: 'من السيرفر', cache: 'من التخزين المحلي', bootstrap: 'بيانات افتراضية', sync: 'المزامنة', online: 'متصل', offline: 'غير متصل', loading: 'جاري التحميل...', error: 'حدث خطأ', success: 'تم حفظ الطلب محليًا وإضافته للمزامنة', language: 'English', openingCash: 'رصيد افتتاحي', cashIn: 'نقدية داخلة', cashOut: 'نقدية خارجة', expectedCash: 'المتوقع في الدرج', actualCash: 'النقدية الفعلية', variance: 'الفرق', confirmClose: 'تأكيد إغلاق الوردية', cancel: 'إلغاء', enterActualCash: 'أدخل النقدية الموجودة فعليًا في الدرج', varianceWarning: 'يوجد فرق بين المتوقع والفعلي. راجع المبلغ قبل التأكيد.' },
  en: { pos: 'Point of Sale', cashier: 'Cashier', orders: 'Orders', shifts: 'Shifts', inventory: 'Inventory', customers: 'Customers', settings: 'Settings', openShift: 'Open Shift', closeShift: 'Close Shift', ready: 'Ready for orders?', openFirst: 'Open the shift first to enable sales.', search: 'Search product name or SKU...', all: 'All', dine: 'Dine In', takeaway: 'Takeaway', delivery: 'Delivery', currentOrder: 'Current Order', empty: 'No items added yet', subtotal: 'Subtotal', discount: 'Discount', deliveryFee: 'Delivery fee', total: 'Total', checkout: 'Collect & Pay', cash: 'Cash', card: 'Card', cartCount: 'items', noOrders: 'No local orders yet', recent: 'Recent Orders', server: 'Server', cache: 'Local cache', bootstrap: 'Bootstrap data', sync: 'Sync', online: 'Online', offline: 'Offline', loading: 'Loading...', error: 'Something went wrong', success: 'Order saved locally and queued for sync', language: 'العربية', openingCash: 'Opening cash', cashIn: 'Cash in', cashOut: 'Cash out', expectedCash: 'Expected cash', actualCash: 'Actual cash', variance: 'Variance', confirmClose: 'Confirm shift close', cancel: 'Cancel', enterActualCash: 'Enter the cash physically counted in the drawer', varianceWarning: 'There is a variance between expected and actual cash. Review it before confirming.' },
} as const;

type Language = keyof typeof labels;
type CheckoutState = 'IDLE' | 'SAVING' | 'SUCCESS' | 'ERROR';
type RecentOrder = { order_number: string; type: string; total: number; status: string; created_at: string };
type CheckoutIdentity = { orderId: string; orderNumber: string; idempotencyKey: string; clientSequence: number };

function Icon({ name }: { name: 'grid' | 'receipt' | 'clock' | 'box' | 'users' | 'settings' | 'search' | 'bell' | 'plus' | 'trash' | 'wallet' | 'globe' }) {
  const paths: Record<string, string> = {
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6M9 16h3',
    clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    box: 'm4 7 8-4 8 4-8 4-8-4zm0 0v10l8 4 8-4V7m-8 4v10',
    users: 'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 8a3 3 0 0 0-2-2.83M18 15a4 4 0 0 1 3 4v2',
    settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm8-3.5a6.8 6.8 0 0 0-.1-1l2-1.55-2-3.46-2.4.95a8 8 0 0 0-1.7-1L15.5 3h-4l-.4 2.95a8 8 0 0 0-1.7 1L7 6l-2 3.46L7 11a7 7 0 0 0 0 2l-2 1.54L7 18l2.4-.95a8 8 0 0 0 1.7-1L19 18l2-3.46L19 13a6.8 6.8 0 0 0 .1-1z',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm6-2 4 4',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
    plus: 'M12 5v14M5 12h14',
    trash: 'M5 7h14M10 11v6M14 11v6M8 7l1-3h6l1 3m-9 0 1 14h10l1-14',
    wallet: 'M4 7h15a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1M16 13h4',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 4 5.5 4 9s-1.5 6.5-4 9M12 3c-2.5 2.5-4 5.5-4 9s1.5 6.5 4 9',
  };
  return <svg className="real-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

async function createCheckoutIdentity(identity: PosRuntimeIdentity): Promise<CheckoutIdentity> {
  const token = crypto.randomUUID();
  const clientSequence = await nextDeviceSequence(db, identity.deviceId);
  return { orderId: token, orderNumber: formatOrderNumber({ branchCode: identity.branchId, deviceCode: identity.deviceId, sequence: clientSequence }), idempotencyKey: `${identity.deviceId}:${token}`, clientSequence };
}

export function RealPosApp() {
  const [language, setLanguage] = useState<Language>('ar');
  const [runtimeIdentity, setRuntimeIdentity] = useState<PosRuntimeIdentity | null>(null);
  const [menu, setMenu] = useState<LocalMenu | null>(null);
  const [cart, setCart] = useState<CartState>(emptyCart());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [orderType, setOrderType] = useState<OrderType>('TAKEAWAY');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD'>('CASH');
  const [shift, setShift] = useState<Shift | null>(null);
  const [checkoutState, setCheckoutState] = useState<CheckoutState>('IDLE');
  const [message, setMessage] = useState('');
  const [menuError, setMenuError] = useState('');
  const [shiftError, setShiftError] = useState('');
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [reconciliation, setReconciliation] = useState<CashDrawerReconciliation | null>(null);
  const [actualCashInput, setActualCashInput] = useState('');
  const [showCloseShift, setShowCloseShift] = useState(false);

  const t = labels[language];
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const products = useMemo(() => {
    if (!menu) return [];
    const normalized = query.trim().toLocaleLowerCase();
    return menu.products.filter((product) => product.active && (category === 'all' || product.categoryId === category) && (!normalized || [product.nameAr, product.nameEn, product.sku].some((value) => value.toLocaleLowerCase().includes(normalized))));
  }, [menu, query, category]);
  const totals = calculateCart(cart);
  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  const actualCash = Number(actualCashInput);
  const previewVariance = reconciliation && Number.isFinite(actualCash) ? Math.round((actualCash - reconciliation.expectedCash) * 100) / 100 : null;

  async function refreshRecentOrders() {
    setRecentOrders(await listRecentLocalOrders(db));
  }

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    let active = true;
    let printRuntime: ReturnType<typeof createPrintWorkerRuntime> | null = null;
    let syncRuntime: ReturnType<typeof createSyncWorkerRuntime> | null = null;
    void (async () => {
      try {
        const identity = getPosRuntimeIdentity();
        if (!active) return;
        setRuntimeIdentity(identity);
        await db.initialize();
        const loaded = await loadMenu(db, API_BASE_URL);
        if (!active) return;
        setMenu(loaded);
        setShift(await getOpenShift(db, identity));
        await refreshRecentOrders();
        printRuntime = createPrintWorkerRuntime({ db, invoke, intervalMs: 1000, workerId: `print-worker:${identity.deviceId}` });
        syncRuntime = createSyncWorkerRuntime({ repository: createSqliteSyncRepository(db), transport: createHttpSyncTransport(API_BASE_URL), intervalMs: 2000, workerId: `sync-worker:${identity.deviceId}`, leaseMs: 30_000 });
      } catch (error) {
        if (active) setMenuError(error instanceof Error ? error.message : t.error);
      }
    })();
    return () => { active = false; window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); printRuntime?.stop(); syncRuntime?.stop(); };
  }, [t.error]);

  async function handleOpenShift() {
    setShiftError('');
    try {
      const identity = runtimeIdentity ?? getPosRuntimeIdentity();
      const opened = openShift({ id: `shift:${crypto.randomUUID()}`, branchId: identity.branchId, deviceId: identity.deviceId, cashierId: identity.cashierId });
      setShift(await openLocalShift(db, opened));
    } catch (error) { setShiftError(error instanceof Error ? error.message : t.error); }
  }

  async function handleCloseShiftRequest() {
    if (!shift || cart.items.length || checkoutState === 'SAVING') return;
    setShiftError('');
    try {
      const current = await reconcileLocalCashDrawer(db, shift.id);
      setReconciliation(current);
      setActualCashInput(current.expectedCash.toFixed(2));
      setShowCloseShift(true);
    } catch (error) { setShiftError(error instanceof Error ? error.message : t.error); }
  }

  async function handleCloseShiftConfirm() {
    if (!shift || !reconciliation || !actualCashInput.trim()) return;
    const countedCash = Number(actualCashInput);
    if (!Number.isFinite(countedCash) || countedCash < 0 || Math.abs(countedCash * 100 - Math.round(countedCash * 100)) > Number.EPSILON) {
      setShiftError(language === 'ar' ? 'النقدية الفعلية يجب أن تكون رقمًا صحيحًا حتى منزلتين عشريتين.' : 'Actual cash must be a valid amount with at most 2 decimals.');
      return;
    }
    setShiftError('');
    try {
      const closed = requestShiftClose(shift, { expectedCash: reconciliation.expectedCash, actualCash: countedCash });
      const saved = await closeLocalShift(db, closed.id, closed.closedAt!, countedCash);
      setShift(saved);
      setShowCloseShift(false);
      setReconciliation(null);
      setActualCashInput('');
      setMessage('');
    } catch (error) { setShiftError(error instanceof Error ? error.message : t.error); }
  }

  async function handleCheckout() {
    if (!shift || !cart.items.length || checkoutState === 'SAVING') return;
    if (paymentMethod === 'CARD') {
      setCheckoutState('ERROR');
      setMessage(language === 'ar'
        ? 'تحصيل البطاقة غير مفعّل: لا يوجد ربط موثّق بجهاز الدفع. استخدم جهاز الدفع الخارجي وأكمل التحصيل من خلال مسار موثّق قبل تسجيل العملية.'
        : 'Card collection is not enabled: no verified payment-terminal integration is configured. Do not mark a card payment as paid until a verified payment flow is available.');
      return;
    }
    setCheckoutState('SAVING');
    setMessage('');
    try {
      const identity = runtimeIdentity ?? getPosRuntimeIdentity();
      const checkoutIdentity = await createCheckoutIdentity(identity);
      const order = confirmOrder(createOrder({ id: checkoutIdentity.orderId, orderNumber: checkoutIdentity.orderNumber, branchId: identity.branchId, deviceId: identity.deviceId, cashierId: identity.cashierId, cart }));
      const stationByProduct: Readonly<Record<string, KitchenStation>> = {};
      const stations = [...new Set(order.items.map((item) => stationByProduct[item.productId] ?? 'KITCHEN'))];
      const printJobs = stations.map((station, index) => createPrintJob({ id: `${order.id}:kitchen:${index}`, order: { ...order, items: order.items.filter((item) => (stationByProduct[item.productId] ?? 'KITCHEN') === station) }, station }));
      printJobs.push(createPrintJob({ id: `${order.id}:customer`, order, station: 'CUSTOMER' }));
      const payment: PaymentInput = { orderId: order.id, shiftId: shift.id, method: paymentMethod, amount: order.total, reference: null };
      await persistCompletedCheckout({ db, order, printJobs, payment, paymentId: `${order.id}:payment`, idempotencyKey: checkoutIdentity.idempotencyKey, clientSequence: checkoutIdentity.clientSequence });
      setCart(emptyCart());
      setCheckoutState('SUCCESS');
      setMessage(t.success);
      await refreshRecentOrders();
    } catch (error) {
      setCheckoutState('ERROR');
      setMessage(error instanceof Error ? error.message : t.error);
    }
  }

  function add(product: Product) {
    if (!shift) return;
    setCheckoutState('IDLE');
    setMessage('');
    setCart((current) => addProduct(current, product));
  }

  const nav = [
    ['grid', t.cashier], ['receipt', t.orders], ['clock', t.shifts], ['box', t.inventory], ['users', t.customers], ['settings', t.settings],
  ] as const;

  return (
    <main className="real-pos" dir={dir}>
      <aside className="real-sidebar">
        <div className="real-brand"><div className="real-brand-mark">POS</div><div><strong>Restaurant POS</strong><span>OPERATING SYSTEM</span></div></div>
        <div className="real-branch"><span>{language === 'ar' ? 'الفرع' : 'Branch'}</span><strong>{runtimeIdentity?.branchId ?? '—'}</strong><small><i /> {runtimeIdentity?.deviceId ?? '—'} · {online ? t.online : t.offline}</small></div>
        <nav>{nav.map(([icon, label], index) => <button key={label} className={index === 0 ? 'active' : ''} type="button"><Icon name={icon} /><span>{label}</span></button>)}</nav>
        <div className="real-sidebar-bottom"><div className="real-sync"><i className={online ? 'online' : 'offline'} /><div><strong>{online ? t.online : t.offline}</strong><span>{menu ? (menu.source === 'SERVER' ? t.server : menu.source === 'CACHE' ? t.cache : t.bootstrap) : t.loading}</span></div></div><div className="real-user"><div className="real-avatar">{runtimeIdentity?.displayName?.slice(0, 2).toUpperCase() ?? 'CA'}</div><div><strong>{runtimeIdentity?.displayName ?? t.cashier}</strong><span>{runtimeIdentity?.username ?? '—'}</span></div></div></div>
      </aside>

      <section className="real-main">
        <header className="real-topbar">
          <div><span className="real-eyebrow">{t.pos}</span><h1>{t.cashier}</h1></div>
          <div className="real-top-actions"><button className="language-button" type="button" onClick={() => setLanguage((current) => current === 'ar' ? 'en' : 'ar')}><Icon name="globe" /> {t.language}</button><button className="notification-button" type="button"><Icon name="bell" /><i /></button>{shift ? <button className="shift-control open" type="button" disabled={Boolean(cart.items.length) || checkoutState === 'SAVING'} onClick={() => void handleCloseShiftRequest()}><i /> {t.closeShift}</button> : <button className="shift-control" type="button" onClick={() => void handleOpenShift()}>{t.openShift}</button>}</div>
        </header>

        <div className="real-workspace">
          <section className="real-menu-panel">
            <div className="real-hero"><div><h2>{t.ready}</h2><p>{shift ? (language === 'ar' ? 'الأوردر يُحفظ أولًا على SQLite ثم يُرسل للسيرفر عبر طابور المزامنة.' : 'Orders are committed to SQLite first, then sent to the server through the sync queue.') : t.openFirst}</p></div><div className="real-status-card"><span>{t.sync}</span><strong>{online ? t.online : t.offline}</strong><small>{menu?.source === 'SERVER' ? t.server : menu?.source === 'CACHE' ? t.cache : menu?.source === 'BOOTSTRAP' ? t.bootstrap : t.loading}</small></div></div>
            <div className="real-order-types">{([['DINE_IN', t.dine], ['TAKEAWAY', t.takeaway], ['DELIVERY', t.delivery]] as const).map(([type, label]) => <button key={type} type="button" disabled={!shift} className={orderType === type ? 'active' : ''} onClick={() => { setOrderType(type); setCart((current) => ({ ...current, orderType: type })); }}>{label}</button>)}</div>
            <div className="real-toolbar"><div className="real-search"><Icon name="search" /><input disabled={!shift} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} /></div><button type="button" className="real-clear" disabled={!shift || !cart.items.length} onClick={() => setCart(emptyCart())}><Icon name="plus" /> {language === 'ar' ? 'طلب جديد' : 'New Order'}</button></div>
            <div className="real-categories">{[{ id: 'all', nameAr: t.all, nameEn: t.all }, ...(menu?.categories.filter((item) => item.id !== 'all') ?? [])].map((item) => <button key={item.id} type="button" disabled={!shift} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{language === 'ar' ? item.nameAr : item.nameEn}</button>)}</div>
            {menuError && <div className="real-error">{menuError}</div>}
            <div className="real-products">{products.map((product) => <button key={product.id} className="real-product" type="button" disabled={!shift} onClick={() => add(product)}><div className="product-art">{product.nameAr.slice(0, 1)}</div><div className="product-copy"><strong>{language === 'ar' ? product.nameAr : product.nameEn}</strong><span>{product.sku}</span></div><b>{money(product.price)}</b></button>)}</div>
            <div className="real-recent"><div className="real-section-title"><h3>{t.recent}</h3><span>{recentOrders.length}</span></div>{recentOrders.length === 0 ? <p>{t.noOrders}</p> : <div className="real-recent-list">{recentOrders.slice(0, 5).map((order) => <div key={order.order_number}><strong>{order.order_number}</strong><span>{order.status}</span><b>{money(order.total)}</b></div>)}</div>}</div>
          </section>

          <aside className="real-cart-panel">
            <div className="real-cart-head"><div><span>{t.currentOrder}</span><h2>{orderType === 'DINE_IN' ? t.dine : orderType === 'DELIVERY' ? t.delivery : t.takeaway}</h2></div><span className="item-badge">{itemCount} {t.cartCount}</span></div>
            <div className="real-cart-items">{cart.items.length === 0 ? <div className="real-empty-cart"><Icon name="receipt" /><strong>{t.empty}</strong><span>{language === 'ar' ? 'اضغط على أي صنف لإضافته للطلب.' : 'Click a product to add it to the order.'}</span></div> : cart.items.map((item) => <div className="real-cart-item" key={item.product.id}><div><strong>{language === 'ar' ? item.product.nameAr : item.product.nameEn}</strong><span>{money(item.product.price)}</span></div><div className="real-qty"><button type="button" onClick={() => setCart((current) => setQuantity(current, item.product.id, item.quantity - 1))}>−</button><b>{item.quantity}</b><button type="button" onClick={() => setCart((current) => setQuantity(current, item.product.id, item.quantity + 1))}>+</button><button className="remove" type="button" onClick={() => setCart((current) => removeProduct(current, item.product.id))}><Icon name="trash" /></button></div></div>)}</div>
            <div className="real-totals"><div><span>{t.subtotal}</span><b>{money(totals.subtotal)}</b></div><div><span>{t.discount}</span><b>{money(totals.discount)}</b></div>{orderType === 'DELIVERY' && <div><span>{t.deliveryFee}</span><b>{money(totals.deliveryFee)}</b></div>}<div className="grand"><span>{t.total}</span><b>{money(totals.total)}</b></div></div>
            <div className="real-payment"><span>{language === 'ar' ? 'طريقة الدفع' : 'Payment method'}</span><div><button type="button" className={paymentMethod === 'CASH' ? 'active' : ''} onClick={() => setPaymentMethod('CASH')}><Icon name="wallet" /> {t.cash}</button><button type="button" className={paymentMethod === 'CARD' ? 'active' : ''} onClick={() => setPaymentMethod('CARD')}><Icon name="receipt" /> {t.card}</button></div></div>
            {message && <div className={`real-message ${checkoutState === 'ERROR' ? 'error' : ''}`}>{message}</div>}
            {shiftError && <div className="real-message error">{shiftError}</div>}
            <button className="real-checkout" type="button" disabled={!shift || !cart.items.length || checkoutState === 'SAVING'} onClick={() => void handleCheckout()}>{checkoutState === 'SAVING' ? t.loading : `${t.checkout} · ${money(totals.total)}`}</button>
          </aside>
        </div>
      </section>

      {showCloseShift && reconciliation && (
        <div role="presentation" onClick={(event) => { if (event.currentTarget === event.target) setShowCloseShift(false); }} style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(0,0,0,0.55)' }}>
          <section role="dialog" aria-modal="true" aria-labelledby="shift-close-title" style={{ width: 'min(560px, 100%)', borderRadius: 20, padding: 24, background: 'var(--real-panel, #fff)', boxShadow: '0 24px 80px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'start' }}>
              <div><span style={{ opacity: .65 }}>{t.shifts}</span><h2 id="shift-close-title" style={{ margin: '6px 0 4px' }}>{t.confirmClose}</h2><p style={{ margin: 0, opacity: .7 }}>{t.enterActualCash}</p></div>
              <button type="button" onClick={() => setShowCloseShift(false)} aria-label={t.cancel} style={{ border: 0, background: 'transparent', fontSize: 24, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 22 }}>
              {[[t.openingCash, reconciliation.openingCash], [t.cashIn, reconciliation.cashIn], [t.cashOut, reconciliation.cashOut], [t.expectedCash, reconciliation.expectedCash]].map(([label, value]) => <div key={String(label)} style={{ padding: 14, borderRadius: 14, background: 'rgba(127,127,127,.08)' }}><span style={{ display: 'block', opacity: .65, fontSize: 12 }}>{label}</span><strong style={{ display: 'block', marginTop: 5, fontSize: 18 }}>{money(Number(value))}</strong></div>)}
            </div>
            <label style={{ display: 'block', marginTop: 18 }}><span style={{ display: 'block', marginBottom: 7, fontWeight: 600 }}>{t.actualCash}</span><input autoFocus inputMode="decimal" value={actualCashInput} onChange={(event) => setActualCashInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleCloseShiftConfirm(); }} style={{ width: '100%', boxSizing: 'border-box', padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(127,127,127,.35)', fontSize: 20, fontWeight: 700 }} /></label>
            <div style={{ marginTop: 14, padding: 15, borderRadius: 14, background: previewVariance === null || previewVariance === 0 ? 'rgba(16,185,129,.10)' : 'rgba(245,158,11,.12)' }}><span style={{ display: 'block', opacity: .65 }}>{t.variance}</span><strong style={{ display: 'block', marginTop: 4, fontSize: 24 }}>{previewVariance === null ? '—' : money(previewVariance)}</strong>{previewVariance !== null && previewVariance !== 0 && <small style={{ display: 'block', marginTop: 4, opacity: .75 }}>{t.varianceWarning}</small>}</div>
            {shiftError && <div className="real-message error" style={{ marginTop: 12 }}>{shiftError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}><button type="button" onClick={() => setShowCloseShift(false)} style={{ padding: '12px 18px', borderRadius: 12, border: '1px solid rgba(127,127,127,.35)', background: 'transparent', cursor: 'pointer' }}>{t.cancel}</button><button type="button" onClick={() => void handleCloseShiftConfirm()} disabled={!actualCashInput.trim()} style={{ padding: '12px 20px', borderRadius: 12, border: 0, cursor: 'pointer', fontWeight: 700 }}>{t.confirmClose}</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
