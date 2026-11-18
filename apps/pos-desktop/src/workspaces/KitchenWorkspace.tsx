import { useEffect, useState } from 'react';
import { getDesktopSession } from '../pos/auth-client.js';
import { apiGet, apiPatch } from '../pos/workspace-api.js';
import { actionStyle, WorkspaceShell } from './shared.js';

type TicketStatus = 'SENT_TO_KITCHEN' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
type Ticket = {
  id: string;
  orderId: string;
  branchId: string;
  station: 'KITCHEN' | 'BEVERAGE' | 'PACKING';
  status: TicketStatus;
  sequence: number;
  version: number;
  createdAt: string;
  sentAt?: string | null;
  preparingAt?: string | null;
  readyAt?: string | null;
  items: Array<{ id: string; nameSnapshot: string; quantity: number; note?: string | null }>;
  order: { orderNumber: string; type: string };
};

const stationLabel: Record<Ticket['station'], string> = { KITCHEN: 'المطبخ', BEVERAGE: 'المشروبات', PACKING: 'التجهيز والتعبئة' };
const statusLabel: Record<TicketStatus, string> = { SENT_TO_KITCHEN: 'وصل للمطبخ', PREPARING: 'قيد التحضير', READY: 'جاهز', COMPLETED: 'تم التسليم', CANCELLED: 'ملغي' };
const nextStatus: Partial<Record<TicketStatus, TicketStatus>> = { SENT_TO_KITCHEN: 'PREPARING', PREPARING: 'READY', READY: 'COMPLETED' };
const nextLabel: Partial<Record<TicketStatus, string>> = { SENT_TO_KITCHEN: 'بدء التحضير', PREPARING: 'تحديد كجاهز', READY: 'تأكيد التسليم' };

export function KitchenWorkspace({ onClose }: { onClose: () => void }) {
  const session = getDesktopSession();
  const canManage = session?.user.permissions.includes('kitchen.ticket.manage') ?? false;
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'ALL' | Ticket['station']>('ALL');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const branchId = session?.user.branchId;
      const query = branchId ? '?branchId=' + encodeURIComponent(branchId) : '';
      setTickets(await apiGet<Ticket[]>('kitchen/tickets' + query));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحميل تذاكر المطبخ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [session?.user.branchId]);

  async function advance(ticket: Ticket) {
    const target = nextStatus[ticket.status];
    if (!target || !canManage || workingId) return;
    setWorkingId(ticket.id);
    setError('');
    try {
      await apiPatch('kitchen/ticket/' + encodeURIComponent(ticket.id) + '/status', {
        target,
        expectedVersion: ticket.version,
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحديث التذكرة');
      await load();
    } finally {
      setWorkingId(null);
    }
  }

  const visible = tickets.filter(ticket => filter === 'ALL' || ticket.station === filter);
  const counts = {
    incoming: tickets.filter(ticket => ticket.status === 'SENT_TO_KITCHEN').length,
    preparing: tickets.filter(ticket => ticket.status === 'PREPARING').length,
    ready: tickets.filter(ticket => ticket.status === 'READY').length,
  };

  return <div style={{ position: 'fixed', inset: 0, zIndex: 12000, overflowY: 'auto', background: '#090d12' }}>
    <WorkspaceShell title="شاشة المطبخ" description="تذاكر مباشرة من السيرفر، مقسمة حسب محطة التحضير وبحالات انتقال محكومة.">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ color: '#8e9baa', fontSize: 11 }}>الفرع: {session?.user.branchId ?? 'حسب صلاحيات الجلسة'}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => void load()} disabled={loading || Boolean(workingId)} style={actionStyle}>تحديث التذاكر</button>
          <button type="button" onClick={onClose} style={actionStyle}>رجوع</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 14 }}>
        {([['وارد', counts.incoming], ['قيد التحضير', counts.preparing], ['جاهز', counts.ready]] as const).map(([label, count]) =>
          <div key={label} style={{ padding: 14, border: '1px solid #26313d', borderRadius: 12, background: '#111820' }}><span style={{ color: '#9ca8b5', fontSize: 12 }}>{label}</span><strong style={{ display: 'block', fontSize: 25, marginTop: 5 }}>{count}</strong></div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {([['ALL', 'كل المحطات'], ['KITCHEN', 'المطبخ'], ['BEVERAGE', 'المشروبات'], ['PACKING', 'التجهيز']] as const).map(([value, label]) =>
          <button key={value} type="button" onClick={() => setFilter(value)} style={{ ...actionStyle, background: filter === value ? '#d9e7f5' : '#17212b', color: filter === value ? '#10161d' : '#dce5ef' }}>{label}</button>
        )}
      </div>
      {!canManage && <div style={{ padding: 11, marginBottom: 12, border: '1px solid #6a4e20', borderRadius: 10, color: '#f2c477', background: '#332713', fontSize: 12 }}>الجلسة الحالية للعرض فقط؛ تحديث حالات التذاكر يحتاج صلاحية إدارة المطبخ.</div>}
      {error && <div role="alert" style={{ padding: 12, marginBottom: 14, border: '1px solid #63373a', borderRadius: 10, color: '#f0a7a7', background: '#211214' }}>{error}</div>}
      {loading && <p style={{ textAlign: 'center', color: '#8e9baa' }}>جاري تحميل التذاكر…</p>}
      {!loading && visible.length === 0 && !error && <p style={{ padding: 24, border: '1px dashed #334150', borderRadius: 12, textAlign: 'center', color: '#9ca8b5' }}>لا توجد تذاكر نشطة في المحطة المختارة.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 12 }}>
        {visible.map(ticket => <article key={ticket.id} style={{ padding: 15, border: '1px solid #334150', borderRadius: 13, background: '#111820' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'start' }}>
            <div><strong style={{ fontSize: 17 }}>طلب {ticket.order?.orderNumber ?? ticket.orderId.slice(0,8)}</strong><div style={{ color: '#9ca8b5', fontSize: 11, marginTop: 4 }}>{stationLabel[ticket.station]} · تذكرة {ticket.sequence}</div></div>
            <span style={{ padding: '5px 8px', borderRadius: 20, background: '#253344', color: '#dce5ef', fontSize: 11 }}>{statusLabel[ticket.status]}</span>
          </div>
          <div style={{ display: 'grid', gap: 9, marginTop: 15 }}>
            {ticket.items.map(item => <div key={item.id} style={{ paddingBottom: 9, borderBottom: '1px solid #26313d' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{item.nameSnapshot}</strong><b>× {item.quantity}</b></div>
              {item.note && <p style={{ margin: '5px 0 0', color: '#f2c477', fontSize: 12 }}>ملاحظة: {item.note}</p>}
            </div>)}
          </div>
          {nextStatus[ticket.status] && <button type="button" disabled={!canManage || workingId === ticket.id} onClick={() => void advance(ticket)} style={{ ...actionStyle, width: '100%', marginTop: 13, background: '#d9e7f5', color: '#10161d' }}>{workingId === ticket.id ? 'جاري التحديث…' : nextLabel[ticket.status]}</button>}
        </article>)}
      </div>
    </WorkspaceShell>
  </div>;
}
