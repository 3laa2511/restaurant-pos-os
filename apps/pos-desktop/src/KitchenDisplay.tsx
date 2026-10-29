import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KitchenApiError,
  listKitchenTickets,
  transitionKitchenTicket,
  type KitchenTicket,
  type KitchenTicketStatus,
} from './pos/kitchen-api.js';
import { getPosRuntimeIdentity } from './pos/runtime-identity.js';
import type { KitchenStation } from './pos/auth-client.js';
import { ensureKitchenLocalSchema, cacheKitchenTickets, getCachedKitchenTickets, getKitchenSyncStates, enqueueKitchenTransition, applyOptimisticKitchenCache, markKitchenSyncState, type KitchenSyncState } from './pos/sqlite-kitchen.js';
import { createDatabaseBridge } from './pos/tauri-bridge.js';
import { invoke } from '@tauri-apps/api/core';
import { nextDeviceSequence } from './pos/sqlite-sequence.js';

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';
const db = createDatabaseBridge({ invoke });

type Filter = 'ACTIVE' | KitchenTicketStatus;

type SyncMeta = { state: KitchenSyncState; error: string | null };

const STATUS_LABELS: Record<KitchenTicketStatus, string> = {
  SENT_TO_KITCHEN: 'مرسل للمطبخ',
  PREPARING: 'قيد التحضير',
  READY: 'جاهز',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغي',
};

const SYNC_LABELS: Record<KitchenSyncState, string> = {
  SYNCED: 'متزامن',
  PENDING: 'في انتظار المزامنة',
  SYNCING: 'جاري المزامنة',
  FAILED: 'فشلت المزامنة',
  CONFLICT: 'تعارض يحتاج مراجعة',
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

function syncBadgeStyle(state: KitchenSyncState): { background: string; border: string } {
  if (state === 'SYNCED') return { background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.18)' };
  if (state === 'CONFLICT' || state === 'FAILED') return { background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.2)' };
  return { background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.18)' };
}

export function KitchenDisplay() {
  const identity = getPosRuntimeIdentity();
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [syncMeta, setSyncMeta] = useState<Record<string, SyncMeta>>({});
  const [filter, setFilter] = useState<Filter>('ACTIVE');
  const [loading, setLoading] = useState(true);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadLocalState = useCallback(async () => {
    const [cached, states] = await Promise.all([
      getCachedKitchenTickets(db, identity.kitchenStation),
      getKitchenSyncStates(db, identity.kitchenStation),
    ]);
    setTickets(cached);
    setSyncMeta(states);
    return cached;
  }, [identity.kitchenStation]);

  const refresh = useCallback(async () => {
    try {
      await ensureKitchenLocalSchema(db);
      setError('');
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await loadLocalState();
        setOffline(true);
        setLastUpdated(new Date());
        return;
      }
      const next = await listKitchenTickets(API_BASE_URL, identity.branchId);
      const scoped = identity.kitchenStation ? next.filter((ticket) => ticket.station === identity.kitchenStation) : next;
      await cacheKitchenTickets(db, scoped);
      const states = await getKitchenSyncStates(db, identity.kitchenStation);
      setTickets(scoped);
      setSyncMeta(states);
      setOffline(false);
      setLastUpdated(new Date());
    } catch (cause) {
      try {
        const cached = await loadLocalState();
        if (cached.length) {
          setOffline(true);
          setError('تعذر الوصول للسيرفر؛ تعمل الآن من آخر نسخة محفوظة محليًا.');
        } else {
          setError(cause instanceof Error ? cause.message : 'تعذر تحميل تذاكر المطبخ');
        }
      } catch {
        setError(cause instanceof Error ? cause.message : 'تعذر تحميل تذاكر المطبخ');
      }
    } finally {
      setLoading(false);
    }
  }, [identity.branchId, identity.kitchenStation, loadLocalState]);

  const reconcileConflict = useCallback(async (ticketId: string): Promise<boolean> => {
    try {
      const latest = await listKitchenTickets(API_BASE_URL, identity.branchId);
      const scoped = identity.kitchenStation ? latest.filter((ticket) => ticket.station === identity.kitchenStation) : latest;
      const serverTicket = scoped.find((ticket) => ticket.id === ticketId);
      if (!serverTicket) {
        await refresh();
        return false;
      }
      await cacheKitchenTickets(db, [serverTicket]);
      await markKitchenSyncState(db, ticketId, 'CONFLICT', 'Server state changed while this device was offline or processing an older version.');
      const states = await getKitchenSyncStates(db, identity.kitchenStation);
      const cached = await getCachedKitchenTickets(db, identity.kitchenStation);
      setTickets(cached);
      setSyncMeta(states);
      setOffline(false);
      setLastUpdated(new Date());
      setError('حدث تعارض: تم اعتماد نسخة السيرفر. راجع حالة التذكرة قبل تنفيذ أي إجراء جديد.');
      return true;
    } catch {
      await refresh();
      return false;
    }
  }, [identity.branchId, identity.kitchenStation, refresh]);

  useEffect(() => {
    void refresh();
    const onOnline = () => { setOffline(false); void refresh(); };
    const onOffline = () => { setOffline(true); void refresh(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refresh]);

  const visibleTickets = useMemo(() => tickets.filter((ticket) => {
    if (filter === 'ACTIVE') return ticket.status === 'SENT_TO_KITCHEN' || ticket.status === 'PREPARING' || ticket.status === 'READY';
    return ticket.status === filter;
  }), [filter, tickets]);

  async function advance(ticket: KitchenTicket) {
    const target = NEXT_STATUS[ticket.status];
    if (!target) return;
    if (syncMeta[ticket.id]?.state === 'CONFLICT') {
      setError('هذه التذكرة لديها تعارض. تم اعتماد نسخة السيرفر؛ حدّث القائمة أولًا قبل تنفيذ إجراء جديد.');
      return;
    }
    setBusyTicketId(ticket.id);
    try {
      setError('');
      if (!offline) {
        try {
          await transitionKitchenTicket(API_BASE_URL, ticket.id, target, ticket.version);
          await refresh();
          return;
        } catch (cause) {
          if (cause instanceof KitchenApiError && cause.status === 409) {
            await reconcileConflict(ticket.id);
            return;
          }
          if (typeof navigator !== 'undefined' && navigator.onLine) throw cause;
          setOffline(true);
        }
      }
      const clientSequence = await nextDeviceSequence(db, identity.deviceId);
      await applyOptimisticKitchenCache(db, { ticketId: ticket.id, target, expectedVersion: ticket.version, reason: null });
      await enqueueKitchenTransition(db, identity, { ticketId: ticket.id, target, expectedVersion: ticket.version, reason: null }, clientSequence);
      const cached = await getCachedKitchenTickets(db, identity.kitchenStation);
      setTickets(cached);
      setSyncMeta(await getKitchenSyncStates(db, identity.kitchenStation));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحديث التذكرة');
      await refresh();
    } finally {
      setBusyTicketId(null);
    }
  }

  async function cancel(ticket: KitchenTicket) {
    if (ticket.status === 'COMPLETED' || ticket.status === 'CANCELLED') return;
    if (syncMeta[ticket.id]?.state === 'CONFLICT') {
      setError('هذه التذكرة لديها تعارض. تم اعتماد نسخة السيرفر؛ حدّث القائمة أولًا قبل تنفيذ إجراء جديد.');
      return;
    }
    const reason = window.prompt('سبب إلغاء تذكرة المطبخ؟')?.trim();
    if (!reason) return;
    setBusyTicketId(ticket.id);
    try {
      setError('');
      if (!offline) {
        try {
          await transitionKitchenTicket(API_BASE_URL, ticket.id, 'CANCELLED', ticket.version, reason);
          await refresh();
          return;
        } catch (cause) {
          if (cause instanceof KitchenApiError && cause.status === 409) {
            await reconcileConflict(ticket.id);
            return;
          }
          if (typeof navigator !== 'undefined' && navigator.onLine) throw cause;
          setOffline(true);
        }
      }
      const clientSequence = await nextDeviceSequence(db, identity.deviceId);
      await applyOptimisticKitchenCache(db, { ticketId: ticket.id, target: 'CANCELLED', expectedVersion: ticket.version, reason });
      await enqueueKitchenTransition(db, identity, { ticketId: ticket.id, target: 'CANCELLED', expectedVersion: ticket.version, reason }, clientSequence);
      const cached = await getCachedKitchenTickets(db, identity.kitchenStation);
      setTickets(cached);
      setSyncMeta(await getKitchenSyncStates(db, identity.kitchenStation));
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ padding: '8px 11px', borderRadius: 999, background: offline ? 'rgba(245,158,11,.14)' : 'rgba(16,185,129,.12)', fontSize: 12 }}>{offline ? 'Offline · Local Queue' : 'Online · Server'}</span>
          <button type="button" onClick={() => void refresh()} disabled={loading} style={{ border: '1px solid rgba(255,255,255,.14)', borderRadius: 10, padding: '10px 14px', background: 'rgba(255,255,255,.06)', color: 'inherit', cursor: 'pointer' }}>
            {loading ? 'جاري التحديث...' : 'تحديث الآن'}
          </button>
        </div>
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
            const sync = syncMeta[ticket.id] ?? { state: 'SYNCED' as KitchenSyncState, error: null };
            const syncStyle = syncBadgeStyle(sync.state);
            return (
              <article key={ticket.id} style={{ border: '1px solid rgba(255,255,255,.11)', borderRadius: 16, padding: 16, background: 'rgba(255,255,255,.035)', boxShadow: ticket.status === 'READY' ? '0 0 0 1px rgba(34,211,238,.15)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'start' }}>
                  <div><strong style={{ fontSize: 18 }}>طلب {ticket.order?.orderNumber ?? ticket.orderId.slice(-8)}</strong><div style={{ opacity: .55, fontSize: 12, marginTop: 4 }}>#{ticket.id.slice(-8)} · إصدار {ticket.version}</div></div>
                  <span style={{ padding: '5px 8px', borderRadius: 999, background: 'rgba(255,255,255,.08)', fontSize: 12 }}>{STATUS_LABELS[ticket.status]}</span>
                </div>

                <div style={{ marginTop: 10, padding: '7px 9px', borderRadius: 9, background: syncStyle.background, border: syncStyle.border, fontSize: 12 }}>
                  <strong>{SYNC_LABELS[sync.state]}</strong>
                  {sync.error && <div style={{ marginTop: 4, opacity: .72 }}>{sync.error}</div>}
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
                {next && <button type="button" disabled={busy || sync.state === 'CONFLICT'} onClick={() => void advance(ticket)} style={{ width: '100%', marginTop: 12, border: 0, borderRadius: 11, padding: '12px 14px', background: 'rgba(34,211,238,.18)', color: 'inherit', fontWeight: 700, cursor: busy || sync.state === 'CONFLICT' ? 'not-allowed' : 'pointer', opacity: sync.state === 'CONFLICT' ? .5 : 1 }}>{busy ? 'جاري الحفظ...' : sync.state === 'CONFLICT' ? 'راجع التعارض أولًا' : `نقل إلى: ${STATUS_LABELS[next]}`}</button>}
                {ticket.status !== 'COMPLETED' && ticket.status !== 'CANCELLED' && <button type="button" disabled={busy || sync.state === 'CONFLICT'} onClick={() => void cancel(ticket)} style={{ width: '100%', marginTop: 8, border: '1px solid rgba(239,68,68,.25)', borderRadius: 11, padding: '10px 14px', background: 'transparent', color: 'inherit', cursor: busy || sync.state === 'CONFLICT' ? 'not-allowed' : 'pointer', opacity: sync.state === 'CONFLICT' ? .5 : 1 }}>إلغاء التذكرة</button>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
