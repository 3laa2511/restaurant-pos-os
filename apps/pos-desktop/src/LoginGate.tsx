import { FormEvent, useMemo, useState } from 'react';
import { clearDesktopSession, getDesktopSession, loginDesktop } from './pos/auth-client.js';

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';
const DEFAULT_BRANCH = (import.meta.env.VITE_BRANCH_ID as string | undefined) ?? 'branch-01';
const DEFAULT_DEVICE = (import.meta.env.VITE_DEVICE_CODE as string | undefined) ?? 'POS-01';

export function LoginGate({ children }: { children: React.ReactNode }) {
  const existing = useMemo(() => getDesktopSession(), []);
  const [session, setSession] = useState(existing);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [branchId, setBranchId] = useState(DEFAULT_BRANCH);
  const [deviceCode, setDeviceCode] = useState(DEFAULT_DEVICE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (session) {
    return <>{children}</>;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await loginDesktop(API_BASE_URL, {
        username: username.trim(),
        password,
        branchId: branchId.trim() || undefined,
        deviceCode: deviceCode.trim() || undefined,
      });
      setSession(next);
    } catch (cause) {
      clearDesktopSession();
      setError(cause instanceof Error ? cause.message : 'تعذر تسجيل الدخول');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#090d12', color: '#e8edf5', fontFamily: 'Inter, system-ui, sans-serif', padding: 24, direction: 'rtl' }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 430, padding: 30, border: '1px solid #26313d', borderRadius: 18, background: '#0e141b', boxShadow: '0 24px 80px #0008' }}>
        <div style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 13, background: '#eef2f6', color: '#10151b', fontWeight: 900, fontSize: 12, marginBottom: 18 }}>POS</div>
        <h1 style={{ margin: 0, fontSize: 24 }}>تسجيل الدخول</h1>
        <p style={{ margin: '8px 0 24px', color: '#7b8896', fontSize: 12, lineHeight: 1.7 }}>سجّل دخولك لربط الكاشير بالفرع والجهاز والـBackend. بعد تسجيل الدخول يظل الـPOS قادرًا على العمل Offline.</p>

        <label style={{ display: 'grid', gap: 7, marginBottom: 13, fontSize: 11, color: '#9ca8b5' }}>
          اسم المستخدم
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required style={inputStyle} />
        </label>
        <label style={{ display: 'grid', gap: 7, marginBottom: 13, fontSize: 11, color: '#9ca8b5' }}>
          كلمة المرور
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required style={inputStyle} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ display: 'grid', gap: 7, marginBottom: 13, fontSize: 11, color: '#9ca8b5' }}>
            الفرع
            <input value={branchId} onChange={(event) => setBranchId(event.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: 'grid', gap: 7, marginBottom: 13, fontSize: 11, color: '#9ca8b5' }}>
            كود الجهاز
            <input value={deviceCode} onChange={(event) => setDeviceCode(event.target.value)} style={inputStyle} />
          </label>
        </div>

        {error && <div style={{ margin: '5px 0 14px', padding: 10, borderRadius: 9, border: '1px solid #63373a', color: '#f0a7a7', background: '#211214', fontSize: 11 }}>{error}</div>}
        <button disabled={busy} type="submit" style={{ width: '100%', height: 46, border: 0, borderRadius: 11, background: '#eef2f5', color: '#10151b', fontWeight: 900, cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'جاري تسجيل الدخول…' : 'دخول إلى نقطة البيع'}
        </button>
      </form>
    </main>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box' as const, height: 40, border: '1px solid #293540', borderRadius: 9,
  outline: 'none', padding: '0 11px', background: '#111820', color: '#e8edf5', fontSize: 12,
};
