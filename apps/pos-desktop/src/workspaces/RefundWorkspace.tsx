import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState, type FormEvent } from 'react';
import { getDesktopSession } from '../pos/auth-client.js';
import { apiGet, apiPost } from '../pos/workspace-api.js';
import { createDatabaseBridge } from '../pos/tauri-bridge.js';
import { nextDeviceSequence } from '../pos/sqlite-sequence.js';
import { actionStyle, fieldStyle, WorkspaceShell } from './shared.js';

type Candidate = { paymentId: string; orderNumber: string; orderType: string; orderStatus: string; shiftId: string; amount: number; refundedAmount: number; remainingAmount: number; status: string; createdAt: string };
const db = createDatabaseBridge({ invoke });
const money = (value: number) => value.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';

export function RefundWorkspace({ onClose }: { onClose: () => void }) {
  const session = getDesktopSession();
  const branchId = session?.user.branchId ?? undefined;
  const deviceId = session?.deviceId ?? undefined;
  const [rows, setRows] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<Candidate | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  async function load() {
    if (!deviceId) { setLoading(false); setError('الجهاز غير مسجل في الجلسة الحالية.'); return; }
    setLoading(true); setError('');
    try {
      const query = branchId ? '?branchId=' + encodeURIComponent(branchId) : '';
      setRows(await apiGet<Candidate[]>('payments/refundable' + query));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر تحميل المدفوعات'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [branchId, deviceId]);

  function begin(row: Candidate) {
    setTarget(row);
    setAmount(row.remainingAmount.toFixed(2));
    setReason('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || !deviceId || working) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > target.remainingAmount || Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) {
      setError('أدخل مبلغًا صحيحًا لا يتجاوز المتبقي.');
      return;
    }
    if (reason.trim().length < 3) { setError('سبب الاسترجاع مطلوب.'); return; }
    setWorking(true); setError('');
    try {
      await db.initialize();
      const clientSequence = await nextDeviceSequence(db, deviceId);
      await apiPost('payments/refund', {
        paymentId: target.paymentId,
        shiftId: target.shiftId,
        amount: value,
        reason: reason.trim(),
        idempotencyKey: deviceId + ':refund:' + crypto.randomUUID(),
        clientSequence,
      });
      setTarget(null);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر تسجيل الاسترجاع'); }
    finally { setWorking(false); }
  }

  return <div style={{ position: 'fixed', inset: 0, zIndex: 12000, overflowY: 'auto', background: '#090d12' }}>
    <WorkspaceShell title="استرجاع المدفوعات" description="استرجاع نقدي مرتبط بالدفع الأصلي ووردية مفتوحة على نفس الجهاز.">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ color: '#8e9baa', fontSize: 11 }}>الفرع: {branchId ?? 'حسب الجهاز'} · الجهاز: {deviceId ?? 'غير مسجل'}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => void load()} disabled={loading || working} style={actionStyle}>تحديث</button>
          <button type="button" onClick={onClose} style={actionStyle}>رجوع للكاشير</button>
        </div>
      </div>
      <div style={{ padding: 12, marginBottom: 14, border: '1px solid #6a4e20', borderRadius: 10, color: '#f2c477', background: '#332713', fontSize: 12, lineHeight: 1.8 }}>
        الاسترجاع النقدي فقط متاح حاليًا، بشرط أن تكون الوردية الأصلية مفتوحة على نفس الجهاز. استرجاع البطاقة والمحفظة متوقف لحين ربط مزوّد الدفع بشكل موثّق.
      </div>
      {error && <div role="alert" style={{ padding: 12, marginBottom: 14, border: '1px solid #63373a', borderRadius: 10, color: '#f0a7a7', background: '#211214' }}>{error}</div>}
      {loading && <p style={{ textAlign: 'center', color: '#8e9baa' }}>جاري تحميل المدفوعات…</p>}
      {!loading && !rows.length && !error && <p style={{ padding: 24, border: '1px dashed #334150', borderRadius: 12, textAlign: 'center', color: '#9ca8b5' }}>لا توجد مدفوعات نقدية قابلة للاسترجاع على الوردية الحالية.</p>}
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map(row => <article key={row.paymentId} style={{ padding: 15, border: '1px solid #26313d', borderRadius: 12, background: '#0e141b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <div><strong>طلب {row.orderNumber}</strong><div style={{ color: '#8e9baa', fontSize: 11, marginTop: 4 }}>{row.orderType} · {row.orderStatus} · {new Date(row.createdAt).toLocaleString('ar-EG')}</div></div>
            <span style={{ color: '#83d7a8', fontSize: 11 }}>{row.status}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8, marginTop: 12 }}>
            <div>المدفوع<strong style={{ display: 'block' }}>{money(row.amount)}</strong></div>
            <div>المسترجع<strong style={{ display: 'block' }}>{money(row.refundedAmount)}</strong></div>
            <div>المتبقي<strong style={{ display: 'block' }}>{money(row.remainingAmount)}</strong></div>
          </div>
          <button type="button" onClick={() => begin(row)} disabled={working} style={{ ...actionStyle, marginTop: 12, background: '#d9e7f5', color: '#10161d' }}>بدء الاسترجاع</button>
        </article>)}
      </div>
      {target && <div role="presentation" onClick={event => { if (event.target === event.currentTarget && !working) setTarget(null); }} style={{ position: 'fixed', inset: 0, zIndex: 13000, display: 'grid', placeItems: 'center', padding: 18, background: '#000a' }}>
        <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="refund-title" style={{ width: 'min(460px,100%)', padding: 22, border: '1px solid #334150', borderRadius: 14, background: '#111820', color: '#e8edf5' }}>
          <h2 id="refund-title" style={{ marginTop: 0 }}>استرجاع الطلب {target.orderNumber}</h2>
          <p style={{ color: '#9ca8b5', fontSize: 12 }}>الحد الأقصى: {money(target.remainingAmount)}. سيتم تسجيل حركة الدرج والقيد المحاسبي والتدقيق داخل معاملة واحدة.</p>
          <label style={{ display: 'grid', gap: 6, marginBottom: 12, fontSize: 12 }}>مبلغ الاسترجاع
            <input type="number" min="0.01" max={target.remainingAmount} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} required style={fieldStyle} />
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>سبب الاسترجاع
            <textarea value={reason} onChange={event => setReason(event.target.value)} minLength={3} maxLength={500} required placeholder="اكتب سبب الاسترجاع" style={{ ...fieldStyle, minHeight: 90, resize: 'vertical' }} />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button type="button" disabled={working} onClick={() => setTarget(null)} style={actionStyle}>إلغاء</button>
            <button type="submit" disabled={working || !amount || !reason.trim()} style={{ ...actionStyle, background: '#d9e7f5', color: '#10161d' }}>{working ? 'جاري التسجيل…' : 'تأكيد الاسترجاع'}</button>
          </div>
        </form>
      </div>}
    </WorkspaceShell>
  </div>;
}
