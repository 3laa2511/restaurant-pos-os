import { KitchenDisplay } from './KitchenDisplay.js';
import { RealPosApp } from './RealPosApp.js';
import { getAccessToken, getDesktopSession } from './pos/auth-client.js';
import { useEffect, useState, type ReactNode } from 'react';

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

const labels: Record<string, string> = {
  POS: 'الكاشير / POS',
  CALL_CENTER: 'كول سنتر',
  KITCHEN: 'المطبخ',
  DISPATCH: 'التوصيل',
  HR: 'الموارد البشرية',
  ACCOUNTING: 'المحاسبة',
  INVENTORY: 'المخزون',
  MANAGEMENT: 'الإدارة',
};


async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  const token = getAccessToken();
  if (!token) throw new Error('انتهت جلسة الدخول، سجّل الدخول مرة أخرى.');
  const response = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/' + path.replace(/^\//, ''), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null) as T | { message?: string } | null;
  if (!response.ok) {
    const message = body && typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string' ? body.message : 'تعذر تنفيذ العملية (' + response.status + ')';
    throw new Error(message);
  }
  return body as T;
}

async function apiGet<T>(path: string): Promise<T> {
  const token = getAccessToken();
  if (!token) throw new Error('انتهت جلسة الدخول، سجّل الدخول مرة أخرى.');
  const response = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/' + path.replace(/^\//, ''), { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
  const body = await response.json().catch(() => null) as T | { message?: string } | null;
  if (!response.ok) {
    const message = body && typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string' ? body.message : 'تعذر تحميل البيانات (' + response.status + ')';
    throw new Error(message);
  }
  return body as T;
}

type EmployeeRow = { employeeCode: string; jobTitle: string; baseSalary: string | number; user: { displayName: string; status: string; branchId: string | null } };
type AccountingRow = { code: string; name: string; nameAr: string | null; type: string; debit: number; credit: number; balance: number };
type StockRow = { quantityBaseUnit: string | number; averageCostPerBaseUnit: string | number; ingredient: { sku: string; name: string; nameAr: string | null; baseUnit: string }; branch: { code: string; name: string } };
type OperationalOrder = { id: string; orderNumber: string; status: string; type: string; source: string; total: string | number; createdAt: string; updatedAt: string; customer: { name: string | null; phone: string; addresses: Array<{ address: string; area: string | null }> } | null; branch: { code: string; name: string } };
type ManagementOverview = { orders: Array<{ status: string; count: number; total: number }>; customers: number; branches: number };

function WorkspaceShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main style={{ minHeight: '100vh', background: '#090d12', color: '#e8edf5', fontFamily: 'Inter, system-ui, sans-serif', padding: 24, direction: 'rtl' }}><section style={{ width: '100%', maxWidth: 1200, margin: '0 auto' }}><div style={{ marginBottom: 22 }}><div style={{ fontSize: 11, color: '#7b8896', marginBottom: 8 }}>RESTAURANT POS OS / WORKSPACE</div><h1 style={{ margin: 0 }}>{title}</h1><p style={{ color: '#9ca8b5', lineHeight: 1.8, marginBottom: 0 }}>{description}</p></div>{children}</section></main>;
}
function DataTable({ headers, rows }: { headers: string[]; rows: Array<ReactNode[]> }) {
  return <div style={{ overflowX: 'auto', border: '1px solid #26313d', borderRadius: 14, background: '#0e141b' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr>{headers.map((h) => <th key={h} style={{ textAlign: 'right', padding: 13, borderBottom: '1px solid #26313d', color: '#8e9baa' }}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} style={{ padding: 13, borderBottom: '1px solid #1b252f' }}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
function ReadWorkspace({ workspace }: { workspace: 'HR' | 'ACCOUNTING' | 'INVENTORY' }) {
  const [data, setData] = useState<EmployeeRow[] | AccountingRow[] | StockRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { if (workspace === 'HR') setData(await apiGet<EmployeeRow[]>('hr/employees')); else if (workspace === 'ACCOUNTING') setData(await apiGet<AccountingRow[]>('accounting/trial-balance')); else setData(await apiGet<StockRow[]>('inventory/stock')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر تحميل البيانات'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [workspace]);
  const session = getDesktopSession();
  return <WorkspaceShell title={labels[workspace]} description="عرض تشغيلي للبيانات المرتبطة بالـAPI المركزي. العمليات الحساسة والصلاحيات والعزل تظل من مسؤولية الـBackend.">
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}><span style={{ fontSize: 11, color: '#7b8896' }}>Branch: {session?.user.branchId ?? 'ALL'}</span><button type="button" onClick={() => void load()} disabled={loading} style={{ border: '1px solid #334150', borderRadius: 9, padding: '9px 14px', background: '#111820', color: '#e8edf5' }}>{loading ? 'جاري التحميل…' : 'تحديث'}</button></div>
    {error && <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, border: '1px solid #63373a', color: '#f0a7a7', background: '#211214' }}>{error}</div>}
    {loading && !data && <div style={{ padding: 30, textAlign: 'center', color: '#7b8896' }}>جاري تحميل بيانات المساحة…</div>}
    {workspace === 'HR' && data && <DataTable headers={['كود الموظف','الموظف','الوظيفة','الفرع','المرتب الأساسي','الحالة']} rows={(data as EmployeeRow[]).map(e => [e.employeeCode,e.user.displayName,e.jobTitle,e.user.branchId ?? 'مركزي',Number(e.baseSalary).toFixed(2)+' ج.م',e.user.status])} />}
    {workspace === 'ACCOUNTING' && data && <DataTable headers={['الحساب','الاسم','النوع','مدين','دائن','الرصيد']} rows={(data as AccountingRow[]).map(r => [r.code,r.nameAr || r.name,r.type,Number(r.debit).toFixed(2),Number(r.credit).toFixed(2),Number(r.balance).toFixed(2)])} />}
    {workspace === 'INVENTORY' && data && <DataTable headers={['SKU','المادة','الفرع','الوحدة','الكمية','متوسط التكلفة']} rows={(data as StockRow[]).map(r => [r.ingredient.sku,r.ingredient.nameAr || r.ingredient.name,r.branch.name || r.branch.code,r.ingredient.baseUnit,Number(r.quantityBaseUnit).toFixed(3),Number(r.averageCostPerBaseUnit).toFixed(2)])} />}
  </WorkspaceShell>;
}

function BusinessCyclePanel() {
  const session = getDesktopSession();
  const branchId = session?.user.branchId;
  const [cycle, setCycle] = useState<{ id: string; name: string; openedAt: string; closeSummary?: { orderCount?: number; grossSales?: number } | null } | null>(null);
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
    if (!branchId || !name.trim()) return;
    if (!window.confirm('سيتم إغلاق الدورة الحالية وحفظ ملخصها ثم فتح دورة جديدة. لن يتم حذف أي فواتير أو تاريخ. هل تريد المتابعة؟')) return;
    setWorking(true); setError('');
    try {
      const result = await apiPost<{ current: typeof cycle }>('business-cycles/start-new', { branchId, name: name.trim() });
      setCycle(result.current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر بدء دورة جديدة'); }
    finally { setWorking(false); }
  }

  useEffect(() => { void load(); }, [branchId]);

  return <section style={{ marginBottom: 16, padding: 18, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div>
        <div style={{ color: '#7b8896', fontSize: 11, marginBottom: 6 }}>BUSINESS CYCLE</div>
        <h2 style={{ margin: 0, fontSize: 18 }}>دورة التشغيل الحالية</h2>
        <div style={{ color: '#9ca8b5', marginTop: 7 }}>{loading ? 'جاري التحميل…' : cycle ? cycle.name : 'لا توجد دورة مفتوحة'}</div>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading || working} style={{ border: '1px solid #334150', borderRadius: 9, padding: '9px 14px', background: '#111820', color: '#e8edf5' }}>تحديث</button>
    </div>
    {cycle && <div style={{ marginTop: 14, color: '#9ca8b5', fontSize: 12 }}>بدأت: {new Date(cycle.openedAt).toLocaleString('ar-EG')}</div>}
    <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="اسم الدورة الجديدة" style={{ flex: 1, minWidth: 220, border: '1px solid #334150', borderRadius: 9, padding: '10px 12px', background: '#111820', color: '#e8edf5' }} />
      <button type="button" onClick={() => void startNew()} disabled={!cycle || working || !branchId} style={{ border: 0, borderRadius: 9, padding: '10px 16px', background: '#d9e7f5', color: '#10161d', fontWeight: 700 }}>{working ? 'جاري البدء…' : 'بدء تشغيل جديد'}</button>
    </div>
    {error && <div style={{ marginTop: 12, padding: 10, borderRadius: 9, border: '1px solid #63373a', color: '#f0a7a7', background: '#211214' }}>{error}</div>}
  </section>;
}

function OperationalWorkspace({ workspace }: { workspace: 'CALL_CENTER' | 'DISPATCH' | 'MANAGEMENT' }) {
  const [data, setData] = useState<OperationalOrder[] | ManagementOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
  return <WorkspaceShell title={labels[workspace]} description="مساحة تشغيلية مرتبطة مباشرة ببيانات الطلبات والصلاحيات المركزية.">
    {workspace === 'MANAGEMENT' && <BusinessCyclePanel />}
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}><span style={{ fontSize: 11, color: '#7b8896' }}>Branch: {session?.user.branchId ?? 'ALL'}</span><button type="button" onClick={() => void load()} disabled={loading} style={{ border: '1px solid #334150', borderRadius: 9, padding: '9px 14px', background: '#111820', color: '#e8edf5' }}>{loading ? 'جاري التحميل…' : 'تحديث'}</button></div>
    {error && <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, border: '1px solid #63373a', color: '#f0a7a7', background: '#211214' }}>{error}</div>}
    {loading && !data && <div style={{ padding: 30, textAlign: 'center', color: '#7b8896' }}>جاري تحميل بيانات المساحة…</div>}
    {workspace !== 'MANAGEMENT' && data && <DataTable headers={['رقم الطلب','العميل','الهاتف','الحالة','الفرع','الإجمالي']} rows={(data as OperationalOrder[]).map(o => [o.orderNumber,o.customer?.name || 'بدون اسم',o.customer?.phone || '—',o.status,o.branch.name || o.branch.code,Number(o.total).toFixed(2)+' ج.م'])} />}
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

export function WorkspaceRouter() {
  const session = getDesktopSession();
  if (!session) return null;

  if (session.workspace === 'POS') return <RealPosApp />;
  if (session.workspace === 'KITCHEN') return <KitchenDisplay />;
  if (session.workspace === 'HR' || session.workspace === 'ACCOUNTING' || session.workspace === 'INVENTORY') return <ReadWorkspace workspace={session.workspace} />;
  if (session.workspace === 'CALL_CENTER' || session.workspace === 'DISPATCH' || session.workspace === 'MANAGEMENT') return <OperationalWorkspace workspace={session.workspace} />;
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#090d12', color: '#e8edf5', padding: 24, direction: 'rtl' }}><section><h1>{labels[session.workspace] ?? session.workspace}</h1><p>مساحة العمل غير مفعّلة تشغيليًا.</p></section></main>;
}
