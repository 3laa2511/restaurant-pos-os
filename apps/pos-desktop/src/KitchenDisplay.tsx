import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listKitchenTickets,
  transitionKitchenTicket,
  type KitchenTicket,
  type KitchenTicketStatus,
} from './pos/kitchen-api.js';
import { getPosRuntimeIdentity } from './pos/runtime-identity.js';
import type { KitchenStation } from './pos/auth-client.js';

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

type Filter = 'ACTIVE' | KitchenTicketStatus;

const STATUS_LABELS: Record<KitchenTicketStatus, string> = {
  SENT_TO_KITCHEN: 'مرسل للمطبخ',
  PREPARING: 'قيد التحضير',
  READY: 'جاهز',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغي',
};

const NEXT_STATUS: Partial<Record<KitchenTicketStatus, KitchenTicketStatus>> = {
  SENT_TO_KITCHEN: 'PREPARING',
  PREPARING: 'READY',
  READY: 'COMPLETED',
};

function stationLabel(station: KitchenStation): string {
  return station === 'KITCHEN' ? 'المطبخ' : station === 'BEVERAGE' ? 'المشروبات' : 'التجهيز';
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

export function KitchenDisplay() {
  const identity = getPosRuntimeIdentity();
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [filter, setFilter] = useState<Filter>('ACTIVE');
  const [loading, setLoading] = useState(true);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError('');
      const next = await listKitchenTickets(API_BASE_URL, identity.branchId);
      setTickets(next);
      setLastUpdated(new Date());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحميل تذاكر المطبخ');
    } finally {
      setLoading(false);
    }
  }, [identity.branchId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const visibleTickets = useMemo(() => tickets.filter((ticket) => {
    if (filter === 'ACTIVE') return ticket.status === 'SENT_TO_KITCHEN' || ticket.status === 'PREPARING' || ticket.status === 'READY';
    return ticket.status === filter;
  }), [filter, tickets]);

  async function advance(ticket: KitchenTicket) {
    const target = NEXT_STATUS[ticket.status];
    if (!target) return;
    setBusyTicketId(ticket.id);
    try {
      setError('');
      await transitionKitchenTicket(API_BASE_URL, ticket.id, target, ticket.version);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحديث التذكرة');
      await refresh();
    } finally {
      setBusyTicketId(null);
    }
  }

  async function cancel(ticket: KitchenTicket) {
    if (ticket.status === 'COMPLETED' || ticket.status === 'CANCELLED') return;
    const reason = window.prompt('سبب إلغاء تذكرة المطبخ؟')?.trim();
    if (!reason) return;
    setBusyTicketId(ticket.id);
    try {
      setError('');
      await transitionKitchenTicket(API_BASE_URL, ticket.id, 'CANCELLED', ticket.version, reason);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر إلغاء التذكرة');
      await refresh();
    } finally {
      setBusyTicketId(null);
    }
  }

  return (
    <section style={{ minHeight: '100%', padding: 24, background: 'var(--real-bg, #0b0d10)', color: 'var(--real-text, #f4f5f7)', boxSizing: 'border-box' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <span style={{ opacity: .6, fontSize: 12, letterSpacing: 1.5 }}>KITCHEN DISPLAY SYSTEM</span>
          <h1 style={{ margin: '5px 0 4px', fontSize: 28 }}>تشغيل المطبخ</h1>
          <p style={{ margin: 0, opacity: .65 }}>
            {identity.kitchenStation ? stationLabel(identity.kitchenStation) : 'كل المحطات'} · الفرع {identity.branchId}
            {lastUpdated ? ` · آخر تحديث ${formatTime(lastUpdated.toISOString())}` : ''}
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} style={{ border: '1px solid rgba(255,255,255,.14)', borderRadius: 10, padding: '10px 14px', background: 'rgba(255,255,255,.06)', color: 'inherit', cursor: 'pointer' }}>
          {loading ? 'جاري التحديث...' : 'تحديث الآن'}
        </button>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {(['ACTIVE', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'] as Filter[]).map((value) => (
          <button key={value} type="button" onClick={() => setFilter(value)} style={{ border: '1px solid rgba(255,255,255,.12)', borderRadius: 999, padding: '8px 12px', background: filter === value ? 'rgba(34,211,238,.18)' : 'rgba(255,255,255,.04)', color: 'inherit', cursor: 'pointer' }}>
            {value === 'ACTIVE' ? 'النشطة' : STATUS_LABELS[value]}
          </button>
        ))}
      </div>

      {error && <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.25)' }}>{error}</div>}

      {visibleTickets.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', border: '1px dashed rgba(255,255,255,.12)', borderRadius: 16, opacity: .7 }}>
          {loading ? 'جاري تحميل تذاكر المطبخ...' : 'لا توجد تذاكر في هذا العرض.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {visibleTickets.map((ticket) => {
            const next = NEXT_STATUS[ticket.status];
            const busy = busyTicketId === ticket.id;
            return (
              <article key={ticket.id} style={{ border: '1px solid rgba(255,255,255,.11)', borderRadius: 16, padding: 16, background: 'rgba(255,255,255,.035)', boxShadow: ticket.status === 'READY' ? '0 0 0 1px rgba(34,211,238,.15)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'start' }}>
                  <div><strong style={{ fontSize: 18 }}>طلب {ticket.orderId.slice(-8)}</strong><div style={{ opacity: .55, fontSize: 12, marginTop: 4 }}>#{ticket.id.slice(-8)} · إصدار {ticket.version}</div></div>
                  <span style={{ padding: '5px 8px', borderRadius: 999, background: 'rgba(255,255,255,.08)', fontSize: 12 }}>{STATUS_LABELS[ticket.status]}</span>
                </div>

                <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
                  {ticket.items.map((item) => (
                    <div key={item.orderItemId} style={{ padding: 10, borderRadius: 10, background: 'rgba(0,0,0,.14)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><strong>{item.productNameSnapshot}</strong><strong>× {item.quantity}</strong></div>
                      {item.note && <div style={{ marginTop: 5, opacity: .7, fontSize: 13 }}>ملاحظة: {item.note}</div>}
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 14, opacity: .55, fontSize: 12 }}>أُرسلت {formatTime(ticket.sentAt ?? ticket.createdAt)}</div>
                {next && <button type="button" disabled={busy} onClick={() => void advance(ticket)} style={{ width: '100%', marginTop: 12, border: 0, borderRadius: 11, padding: '12px 14px', background: 'rgba(34,211,238,.18)', color: 'inherit', fontWeight: 700, cursor: 'pointer' }}>{busy ? 'جاري الحفظ...' : `نقل إلى: ${STATUS_LABELS[next]}`}</button>}
                {ticket.status !== 'COMPLETED' && ticket.status !== 'CANCELLED' && <button type="button" disabled={busy} onClick={() => void cancel(ticket)} style={{ width: '100%', marginTop: 8, border: '1px solid rgba(239,68,68,.25)', borderRadius: 11, padding: '10px 14px', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>إلغاء التذكرة</button>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
