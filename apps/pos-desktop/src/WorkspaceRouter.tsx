import { KitchenDisplay } from './KitchenDisplay.js';
import { RealPosApp } from './RealPosApp.js';
import { getDesktopSession, logoutDesktop } from './pos/auth-client.js';
import { API_BASE_URL, apiGet, apiPost } from './pos/workspace-api.js';
import { DataTable, WorkspaceShell } from './workspaces/shared.js';
import { AccountingWorkspace } from './workspaces/AccountingWorkspace.js';
import { InventoryWorkspace } from './workspaces/InventoryWorkspace.js';
import { HrWorkspace } from './workspaces/HrWorkspace.js';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

const labels: Record<string, string> = {
  POS: 'الكاشير / POS',
  CALL_CENTER: 'كول سنتر',
  KITCHEN: 'المطبخ',
  DISPATCH: 'التوصيل',
  HR: 'الموارد البشرية',
  ACCOUNTING: 'المحاسبة',
  INVENTORY: 'المخزون',
  MANAGEMENT: 'الإدارة',
  SETTINGS: 'الإعدادات',
};

type OperationalOrder = { id: string; orderNumber: string; status: string; type: string; source: string; total: string | number; createdAt: string; updatedAt: string; customer: { name: string | null; phone: string; addresses: Array<{ address: string; area: string | null }> } | null; items: Array<{ id: string; quantity: number; productName?: string }>; branch: { code: string; name: string } };
type ManagementOverview = { orders: Array<{ status: string; count: number; total: number }>; customers: number; branches: number };

function SettingsWorkspace() {
  const session = getDesktopSession();
  const branchId = session?.user.branchId;
  const [cycle, setCycle] = useState<{ id: string; name: string; openedAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState(() => 'تشغيل جديد - ' + new Date().toLocaleDateString('ar-EG'));

  async function load() {
    if (!branchId) { setLoading(false); setError('لا يوجد فرع محدد في جلسة العمل.'); return; }
    setLoading(true); setError('');
    try { setCycle(await apiGet<typeof cycle>('business-cycles/current?branchId=' + encodeURIComponent(branchId))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر تحميل الدورة الحالية'); }
    finally { setLoading(false); }
  }

  async function startNew() {
    if (!branchId || !name.trim() || working) return;
    if (!window.confirm('سيتم إغلاق الدورة الحالية وحفظ ملخصها ثم فتح دورة جديدة. لن يتم حذف أي فواتير أو تاريخ. هل تريد المتابعة؟')) return;
    setWorking(true); setError('');
    try {
      const result = await apiPost<{ current: typeof cycle }>('business-cycles/start-new', { branchId, name: name.trim() });
      setCycle(result.current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر بدء دورة جديدة'); }
    finally { setWorking(false); }
  }

  useEffect(() => { void load(); }, [branchId]);

  return <WorkspaceShell title="الإعدادات" description="إدارة البيانات التشغيلية الحساسة. تغيير دورة التشغيل لا يحذف أي فواتير أو تاريخ، وكل عملية تمر عبر صلاحيات الـBackend والـRLS.">
    <section style={{ padding: 20, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b' }}>
      <div style={{ color: '#7b8896', fontSize: 11, marginBottom: 7 }}>إدارة البيانات</div>
      <h2 style={{ margin: 0, fontSize: 20 }}>بدء تشغيل جديد</h2>
      <p style={{ color: '#9ca8b5', lineHeight: 1.8 }}>إغلاق الدورة الحالية وفتح دورة جديدة مع الاحتفاظ الكامل بالتاريخ والفواتير.</p>
      <div style={{ padding: 14, border: '1px solid #26313d', borderRadius: 11, background: '#111820' }}>
        <div style={{ fontSize: 11, color: '#7b8896' }}>الدورة الحالية</div>
        <strong style={{ display: 'block', marginTop: 6 }}>{loading ? 'جاري التحميل…' : cycle?.name ?? 'لا توجد دورة مفتوحة'}</strong>
        {cycle && <div style={{ marginTop: 6, color: '#9ca8b5', fontSize: 12 }}>بدأت: {new Date(cycle.openedAt).toLocaleString('ar-EG')}</div>}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="اسم الدورة الجديدة" style={{ flex: 1, minWidth: 240, border: '1px solid #334150', borderRadius: 9, padding: '10px 12px', background: '#111820', color: '#e8edf5' }} />
        <button type="button" onClick={() => void startNew()} disabled={!cycle || working || !branchId} style={{ border: 0, borderRadius: 9, padding: '10px 16px', background: '#d9e7f5', color: '#10161d', fontWeight: 700 }}>{working ? 'جاري البدء…' : 'بدء تشغيل جديد'}</button>
        <button type="button" onClick={() => void load()} disabled={loading || working} style={{ border: '1px solid #334150', borderRadius: 9, padding: '10px 14px', background: '#111820', color: '#e8edf5' }}>تحديث</button>
      </div>
      {error && <div style={{ marginTop: 12, padding: 10, borderRadius: 9, border: '1px solid #63373a', color: '#f0a7a7', background: '#211214' }}>{error}</div>}
    </section>
  </WorkspaceShell>;
}

function OperationalWorkspace({ workspace }: { workspace: 'CALL_CENTER' | 'DISPATCH' | 'MANAGEMENT' }) {
  const [data, setData] = useState<OperationalOrder[] | ManagementOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  async function load() {
    setLoading(true); setError('');
    try {
      if (workspace === 'MANAGEMENT') setData(await apiGet<ManagementOverview>('operations/management/overview'));
      else if (workspace === 'CALL_CENTER') setData(await apiGet<OperationalOrder[]>('operations/call-center/orders'));
      else setData(await apiGet<OperationalOrder[]>('operations/dispatch/orders'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر تحميل البيانات'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [workspace]);
  const session = getDesktopSession();
  const operationalOrders = useMemo(() => {
    if (!Array.isArray(data)) return [];
    const term = search.trim().toLocaleLowerCase();
    return data.filter(order => {
      const matchesStatus = statusFilter === 'ALL' || order.status === statusFilter;
      const customer = order.customer?.name ?? '';
      const phone = order.customer?.phone ?? '';
      const address = order.customer?.addresses?.map(item => [item.area, item.address].filter(Boolean).join(' ')).join(' ') ?? '';
      const matchesSearch = !term || [order.orderNumber, customer, phone, address, order.branch.name, order.branch.code]
        .some(value => value.toLocaleLowerCase().includes(term));
      return matchesStatus && matchesSearch;
    });
  }, [data, search, statusFilter]);
  const availableStatuses = Array.isArray(data) ? [...new Set(data.map(order => order.status))].sort() : [];
  return <WorkspaceShell title={labels[workspace]} description="مساحة تشغيلية مرتبطة مباشرة ببيانات الطلبات والصلاحيات المركزية.">

    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}><span style={{ fontSize: 11, color: '#7b8896' }}>Branch: {session?.user.branchId ?? 'ALL'}</span><button type="button" onClick={() => void load()} disabled={loading} style={{ border: '1px solid #334150', borderRadius: 9, padding: '9px 14px', background: '#111820', color: '#e8edf5' }}>{loading ? 'جاري التحميل…' : 'تحديث'}</button></div>
    {error && <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, border: '1px solid #63373a', color: '#f0a7a7', background: '#211214' }}>{error}</div>}
    {loading && !data && <div style={{ padding: 30, textAlign: 'center', color: '#7b8896' }}>جاري تحميل بيانات المساحة…</div>}
    {workspace !== 'MANAGEMENT' && data && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,2fr) minmax(160px,1fr)', gap: 10, marginBottom: 14 }}>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث برقم الطلب أو العميل أو الهاتف أو العنوان…" style={{ border: '1px solid #334150', borderRadius: 9, padding: '10px 12px', background: '#111820', color: '#e8edf5', minWidth: 0 }} />
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} style={{ border: '1px solid #334150', borderRadius: 9, padding: '10px 12px', background: '#111820', color: '#e8edf5' }}>
          <option value="ALL">كل الحالات</option>
          {availableStatuses.map(status => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 9, color: '#8e9baa', fontSize: 11 }}>
        <span>الطلبات المعروضة: {operationalOrders.length} من {Array.isArray(data) ? data.length : 0}</span>
        <span>{workspace === 'DISPATCH' ? 'مرتبة حسب آخر تحديث من الأقدم للأحدث' : 'مرتبة بالأحدث أولاً'}</span>
      </div>
      {operationalOrders.length ? <DataTable headers={['رقم الطلب','العميل / الهاتف','العنوان','الحالة','الفرع','وقت الطلب','عدد الأصناف','الإجمالي']} rows={operationalOrders.map(order => {
        const address = order.customer?.addresses?.[0];
        return [
          order.orderNumber,
          <span>{order.customer?.name || 'بدون اسم'}<small style={{ display: 'block', color: '#8e9baa', marginTop: 4, direction: 'ltr', textAlign: 'right' }}>{order.customer?.phone || '—'}</small></span>,
          address ? [address.area, address.address].filter(Boolean).join(' — ') : 'لا يوجد عنوان مسجل',
          order.status, order.branch.name || order.branch.code,
          new Date(order.createdAt).toLocaleString('ar-EG'),
          order.items?.length ?? 0, Number(order.total).toFixed(2) + ' ج.م',
        ];
      })} /> : <div style={{ padding: 24, border: '1px dashed #334150', borderRadius: 12, textAlign: 'center', color: '#8e9baa' }}>لا توجد طلبات تطابق البحث والحالة المحددة.</div>}
    </>}
    {workspace === 'MANAGEMENT' && data && <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12 }}>
        <div style={{ padding: 18, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b' }}><div style={{ color:'#7b8896', fontSize:11 }}>الفروع</div><strong style={{ fontSize:26 }}>{(data as ManagementOverview).branches}</strong></div>
        <div style={{ padding: 18, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b' }}><div style={{ color:'#7b8896', fontSize:11 }}>العملاء</div><strong style={{ fontSize:26 }}>{(data as ManagementOverview).customers}</strong></div>
        <div style={{ padding: 18, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b' }}><div style={{ color:'#7b8896', fontSize:11 }}>حالات الطلبات</div><strong style={{ fontSize:26 }}>{(data as ManagementOverview).orders.reduce((sum, row) => sum + row.count, 0)}</strong></div>
      </div>
      <DataTable headers={['الحالة','عدد الطلبات','الإجمالي']} rows={(data as ManagementOverview).orders.map(r => [r.status,r.count,Number(r.total).toFixed(2)+' ج.م'])} />
    </div>}
  </WorkspaceShell>;
}

function SessionControls() {
  const [working, setWorking] = useState(false);
  async function changeWorkspace() {
    if (working || !window.confirm('سيتم تسجيل الخروج والعودة لاختيار مساحة عمل أخرى. هل تريد المتابعة؟')) return;
    setWorking(true);
    try { await logoutDesktop(API_BASE_URL); }
    catch { /* The local session is cleared by logoutDesktop even if the server is unreachable. */ }
    finally { window.location.reload(); }
  }
  return <button
    type="button"
    onClick={() => void changeWorkspace()}
    disabled={working}
    title="تسجيل الخروج وتغيير مساحة العمل"
    style={{ position: 'fixed', zIndex: 10000, top: 12, left: 12, border: '1px solid #334150', borderRadius: 9, padding: '9px 13px', background: '#111820', color: '#e8edf5', cursor: working ? 'wait' : 'pointer', boxShadow: '0 8px 24px #0006' }}
  >{working ? 'جاري الخروج…' : 'تغيير مساحة العمل'}</button>;
}

export function WorkspaceRouter() {
  const session = getDesktopSession();
  if (!session) return null;

  let content: ReactNode;
  if (session.workspace === 'POS') content = <RealPosApp />;
  else if (session.workspace === 'KITCHEN') content = <KitchenDisplay />;
  else if (session.workspace === 'HR') content = <HrWorkspace />;
  else if (session.workspace === 'ACCOUNTING') content = <AccountingWorkspace />;
  else if (session.workspace === 'INVENTORY') content = <InventoryWorkspace />;
  else if (session.workspace === 'CALL_CENTER' || session.workspace === 'DISPATCH' || session.workspace === 'MANAGEMENT') content = <OperationalWorkspace workspace={session.workspace} />;
  else if (session.workspace === 'SETTINGS') content = <SettingsWorkspace />;
  else content = <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#090d12', color: '#e8edf5', padding: 24, direction: 'rtl' }}><section><h1>{labels[session.workspace] ?? session.workspace}</h1><p>مساحة العمل غير مفعّلة تشغيليًا.</p></section></main>;

  return <>{content}<SessionControls /></>;
}
