import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../pos/workspace-api.js';
import { getDesktopSession } from '../pos/auth-client.js';
import { actionStyle, fieldStyle, WorkspaceShell } from './shared.js';

type DiningOrder = {
  id: string;
  orderNumber: string;
  status: string;
  total: string | number;
  createdAt: string;
  currentDiningTable: { id: string; number: string } | null;
};

type DiningTable = {
  id: string;
  number: string;
  name: string | null;
  nameAr: string | null;
  seats: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'CLEANING' | 'OUT_OF_SERVICE';
  version: number;
  currentOrder: { id: string; orderNumber: string; status: string; total: string | number } | null;
};

type DiningArea = {
  id: string;
  name: string;
  nameAr: string | null;
  tables: DiningTable[];
};

const statusLabels: Record<DiningTable['status'], string> = {
  AVAILABLE: 'متاحة',
  OCCUPIED: 'مشغولة',
  RESERVED: 'محجوزة',
  CLEANING: 'تحت التنظيف',
  OUT_OF_SERVICE: 'خارج الخدمة',
};

const statusColors: Record<DiningTable['status'], { color: string; background: string; border: string }> = {
  AVAILABLE: { color: '#83d7a8', background: '#123022', border: '#28543c' },
  OCCUPIED: { color: '#f2c477', background: '#332713', border: '#6a4e20' },
  RESERVED: { color: '#a9c7f5', background: '#172b46', border: '#355783' },
  CLEANING: { color: '#d2b4f2', background: '#2a1d3b', border: '#584077' },
  OUT_OF_SERVICE: { color: '#f0a7a7', background: '#321c1e', border: '#63373a' },
};

export function DiningWorkspace({ onClose }: { onClose: () => void }) {
  const session = getDesktopSession();
  const branchId = session?.user.branchId ?? undefined;
  const permissions = session?.user.permissions ?? [];
  const canManage = permissions.includes('dining_table.manage');
  const canAssign = permissions.includes('order.create');
  const [areas, setAreas] = useState<DiningArea[]>([]);
  const [orders, setOrders] = useState<DiningOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [areaName, setAreaName] = useState('');
  const [showAreaForm, setShowAreaForm] = useState(false);
  const [tableFormArea, setTableFormArea] = useState<string | null>(null);
  const [tableNumber, setTableNumber] = useState('');
  const [tableName, setTableName] = useState('');
  const [tableSeats, setTableSeats] = useState('4');
  const [selectedOrders, setSelectedOrders] = useState<Record<string, string>>({});
  const [clearTarget, setClearTarget] = useState<DiningTable | null>(null);
  const [clearReason, setClearReason] = useState('');

  async function load() {
    if (!branchId) {
      setLoading(false);
      setError('الجلسة الحالية لا تحتوي على فرع محدد. سجّل الدخول مع اختيار الفرع أولاً.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const query = '?branchId=' + encodeURIComponent(branchId);
      const [nextAreas, nextOrders] = await Promise.all([
        apiGet<DiningArea[]>('dining/areas' + query),
        apiGet<DiningOrder[]>('operations/dining/orders' + query),
      ]);
      setAreas(nextAreas);
      setOrders(nextOrders);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحميل صالة الطعام');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [branchId]);

  async function runAction(action: () => Promise<unknown>) {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تنفيذ العملية');
    } finally {
      setWorking(false);
    }
  }

  async function createArea(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!areaName.trim() || !branchId) return;
    await runAction(async () => {
      await apiPost('dining/areas', { branchId, name: areaName.trim() });
      setAreaName('');
      setShowAreaForm(false);
    });
  }

  async function createTable(event: React.FormEvent<HTMLFormElement>, areaId: string) {
    event.preventDefault();
    if (!tableNumber.trim()) return;
    await runAction(async () => {
      await apiPost('dining/areas/' + encodeURIComponent(areaId) + '/tables', {
        number: tableNumber.trim(),
        name: tableName.trim() || undefined,
        seats: Number(tableSeats),
      });
      setTableNumber('');
      setTableName('');
      setTableSeats('4');
      setTableFormArea(null);
    });
  }

  async function assignOrder(table: DiningTable) {
    const orderId = selectedOrders[table.id];
    if (!orderId) return;
    await runAction(() => apiPost(
      'dining/tables/' + encodeURIComponent(table.id) + '/orders/' + encodeURIComponent(orderId),
      { expectedVersion: table.version },
    ));
  }

  async function changeStatus(table: DiningTable, status: 'AVAILABLE' | 'RESERVED' | 'OUT_OF_SERVICE') {
    await runAction(() => apiPatch('dining/tables/' + encodeURIComponent(table.id) + '/status', {
      status,
      expectedVersion: table.version,
    }));
  }

  async function clearTable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clearTarget || clearReason.trim().length < 3) return;
    const target = clearTarget;
    const reason = clearReason.trim();
    await runAction(async () => {
      await apiPost('dining/tables/' + encodeURIComponent(target.id) + '/clear', {
        reason,
        expectedVersion: target.version,
      });
      setClearTarget(null);
      setClearReason('');
    });
  }

  const eligibleOrders = useMemo(() => orders.filter(order => !order.currentDiningTable), [orders]);
  const tableCount = areas.reduce((sum, area) => sum + area.tables.length, 0);
  const occupiedCount = areas.reduce((sum, area) => sum + area.tables.filter(table => table.status === 'OCCUPIED').length, 0);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 12000, overflowY: 'auto', background: '#090d12' }}>
      <WorkspaceShell
        title="صالة الطعام والطاولات"
        description="إدارة مناطق الجلوس والطاولات وربط طلبات داخل المطعم. كل تغيير محفوظ على الخادم ومقيّد بالفرع والصلاحيات."
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ padding: '10px 14px', border: '1px solid #26313d', borderRadius: 10, background: '#0e141b' }}>
              <small style={{ color: '#8e9baa' }}>إجمالي الطاولات</small><strong style={{ display: 'block', fontSize: 20 }}>{tableCount}</strong>
            </div>
            <div style={{ padding: '10px 14px', border: '1px solid #26313d', borderRadius: 10, background: '#0e141b' }}>
              <small style={{ color: '#8e9baa' }}>الطاولات المشغولة</small><strong style={{ display: 'block', fontSize: 20 }}>{occupiedCount}</strong>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <button type="button" onClick={() => void load()} disabled={loading || working} style={actionStyle}>تحديث</button>
            {canManage && <button type="button" onClick={() => setShowAreaForm(value => !value)} style={{ ...actionStyle, background: '#d9e7f5', color: '#10161d', borderColor: '#d9e7f5' }}>+ منطقة جديدة</button>}
            <button type="button" onClick={onClose} style={actionStyle}>رجوع للكاشير</button>
          </div>
        </div>

        {showAreaForm && canManage && <form onSubmit={createArea} style={{ display: 'flex', gap: 9, marginBottom: 16, padding: 14, border: '1px solid #334150', borderRadius: 12, background: '#0e141b' }}>
          <input value={areaName} onChange={event => setAreaName(event.target.value)} placeholder="اسم المنطقة (مثلاً: الصالة الرئيسية)" required style={{ ...fieldStyle, flex: 1 }} />
          <button type="submit" disabled={working || !areaName.trim()} style={actionStyle}>حفظ المنطقة</button>
        </form>}

        {error && <div role="alert" style={{ marginBottom: 14, padding: 12, border: '1px solid #63373a', borderRadius: 10, color: '#f0a7a7', background: '#211214' }}>{error}</div>}
        {loading && <div style={{ padding: 28, textAlign: 'center', color: '#8e9baa' }}>جاري تحميل بيانات الطاولات والطلبات…</div>}
        {!loading && areas.length === 0 && !error && <div style={{ padding: 30, border: '1px dashed #334150', borderRadius: 14, textAlign: 'center', color: '#9ca8b5' }}>
          <h2 style={{ marginTop: 0 }}>لسه مفيش مناطق أو طاولات</h2>
          <p>ابدأ بإضافة منطقة، وبعدها أضف الطاولات التابعة ليها.</p>
          {canManage && <button type="button" onClick={() => setShowAreaForm(true)} style={actionStyle}>إنشاء أول منطقة</button>}
        </div>}

        <div style={{ display: 'grid', gap: 18 }}>
          {areas.map(area => (
            <section key={area.id} style={{ padding: 16, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div><h2 style={{ margin: 0, fontSize: 18 }}>{area.nameAr || area.name}</h2><small style={{ color: '#8e9baa' }}>{area.tables.length} طاولة</small></div>
                {canManage && <button type="button" onClick={() => setTableFormArea(tableFormArea === area.id ? null : area.id)} style={actionStyle}>+ إضافة طاولة</button>}
              </div>

              {tableFormArea === area.id && canManage && <form onSubmit={event => void createTable(event, area.id)} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 9, marginBottom: 14 }}>
                <input value={tableNumber} onChange={event => setTableNumber(event.target.value)} placeholder="رقم الطاولة" required style={fieldStyle} />
                <input value={tableName} onChange={event => setTableName(event.target.value)} placeholder="اسم اختياري" style={fieldStyle} />
                <input type="number" min="1" max="100" value={tableSeats} onChange={event => setTableSeats(event.target.value)} placeholder="عدد الكراسي" required style={fieldStyle} />
                <button type="submit" disabled={working || !tableNumber.trim()} style={actionStyle}>حفظ الطاولة</button>
              </form>}

              {area.tables.length === 0 ? <p style={{ color: '#8e9baa', fontSize: 12 }}>لا توجد طاولات في المنطقة دي حتى الآن.</p> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(245px,1fr))', gap: 10 }}>
                {area.tables.map(table => {
                  const color = statusColors[table.status];
                  return <article key={table.id} style={{ minWidth: 0, padding: 14, border: '1px solid #26313d', borderRadius: 12, background: '#111820' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                      <div><strong style={{ fontSize: 17 }}>طاولة {table.number}</strong><div style={{ color: '#8e9baa', fontSize: 11, marginTop: 4 }}>{table.nameAr || table.name || (table.seats + ' مقاعد')}</div></div>
                      <span style={{ padding: '5px 8px', borderRadius: 20, border: '1px solid ' + color.border, color: color.color, background: color.background, fontSize: 10, whiteSpace: 'nowrap' }}>{statusLabels[table.status]}</span>
                    </div>
                    <div style={{ marginTop: 12, color: '#9ca8b5', fontSize: 11 }}>السعة: {table.seats} أفراد</div>
                    {table.currentOrder && <div style={{ marginTop: 10, padding: 9, borderRadius: 8, background: '#1b252f', fontSize: 11 }}>
                      <span style={{ color: '#8e9baa' }}>الطلب الحالي</span><strong style={{ display: 'block', marginTop: 4 }}>{table.currentOrder.orderNumber}</strong><span style={{ color: '#9ca8b5' }}>{table.currentOrder.status} · {Number(table.currentOrder.total).toFixed(2)} ج.م</span>
                    </div>}
                    {table.status === 'AVAILABLE' || table.status === 'RESERVED' ? <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                      {canAssign && <><select value={selectedOrders[table.id] ?? ''} onChange={event => setSelectedOrders(current => ({ ...current, [table.id]: event.target.value }))} style={fieldStyle}>
                        <option value="">اختار طلب داخل المطعم</option>
                        {eligibleOrders.map(order => <option key={order.id} value={order.id}>{order.orderNumber} · {Number(order.total).toFixed(2)} ج.م</option>)}
                      </select><button type="button" disabled={working || !selectedOrders[table.id]} onClick={() => void assignOrder(table)} style={actionStyle}>تسكين الطلب على الطاولة</button></>}
                      {canManage && <div style={{ display: 'flex', gap: 7 }}>
                        {table.status === 'AVAILABLE' && <button type="button" disabled={working} onClick={() => void changeStatus(table, 'RESERVED')} style={actionStyle}>حجز</button>}
                        {table.status === 'RESERVED' && <button type="button" disabled={working} onClick={() => void changeStatus(table, 'AVAILABLE')} style={actionStyle}>إلغاء الحجز</button>}
                        <button type="button" disabled={working} onClick={() => void changeStatus(table, 'OUT_OF_SERVICE')} style={actionStyle}>خارج الخدمة</button>
                      </div>}
                    </div> : null}
                    {table.status === 'OCCUPIED' && canManage && <button type="button" disabled={working} onClick={() => { setClearTarget(table); setClearReason(''); }} style={{ ...actionStyle, width: '100%', marginTop: 12, color: '#f2c477' }}>طلب إخلاء الطاولة بموافقة المدير</button>}
                    {(table.status === 'CLEANING' || table.status === 'OUT_OF_SERVICE') && canManage && <button type="button" disabled={working} onClick={() => void changeStatus(table, 'AVAILABLE')} style={{ ...actionStyle, width: '100%', marginTop: 12 }}>إعادة الطاولة للخدمة</button>}
                  </article>;
                })}
              </div>}
            </section>
          ))}
        </div>

        {clearTarget && <div role="presentation" onClick={event => { if (event.target === event.currentTarget && !working) setClearTarget(null); }} style={{ position: 'fixed', inset: 0, zIndex: 13000, display: 'grid', placeItems: 'center', padding: 18, background: '#000a' }}>
          <form onSubmit={clearTable} role="dialog" aria-modal="true" aria-labelledby="dining-clear-title" style={{ width: 'min(460px,100%)', padding: 22, border: '1px solid #334150', borderRadius: 14, background: '#111820', color: '#e8edf5' }}>
            <h2 id="dining-clear-title" style={{ marginTop: 0 }}>تأكيد إخلاء الطاولة {clearTarget.number}</h2>
            <p style={{ color: '#9ca8b5', lineHeight: 1.8, fontSize: 12 }}>الإجراء متاح للمدير فقط، ولا يمكن إخلاء الطاولة قبل إغلاق الطلب المرتبط بها. بعد التأكيد ستتحول لحالة تحت التنظيف.</p>
            <textarea value={clearReason} onChange={event => setClearReason(event.target.value)} required minLength={3} maxLength={500} placeholder="اكتب سبب الإخلاء أو ملاحظة المدير" style={{ ...fieldStyle, minHeight: 90, resize: 'vertical' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" disabled={working} onClick={() => setClearTarget(null)} style={actionStyle}>إلغاء</button>
              <button type="submit" disabled={working || clearReason.trim().length < 3} style={{ ...actionStyle, background: '#d9e7f5', color: '#10161d' }}>{working ? 'جاري الحفظ…' : 'تأكيد الإخلاء'}</button>
            </div>
          </form>
        </div>}
      </WorkspaceShell>
    </div>
  );
}
