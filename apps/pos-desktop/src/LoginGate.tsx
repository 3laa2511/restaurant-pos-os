import type { FormEvent, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { clearDesktopSession, getDesktopSession, loginDesktop } from './pos/auth-client.js';
import type { WorkspaceCode } from './pos/auth-client.js';

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';
const DEFAULT_BRANCH = (import.meta.env.VITE_BRANCH_ID as string | undefined) ?? 'branch-01';
const DEFAULT_DEVICE = (import.meta.env.VITE_DEVICE_CODE as string | undefined) ?? 'POS-01';

const WORKSPACES: readonly { code: WorkspaceCode; title: string; description: string }[] = [
  { code: 'POS', title: 'الكاشير / POS', description: 'المبيعات، الدفع، الشيفت والدرج' },
  { code: 'CALL_CENTER', title: 'كول سنتر', description: 'العملاء، الطلبات وتوجيهها للفروع' },
  { code: 'HR', title: 'الموارد البشرية', description: 'الموظفين، الحضور والجداول والمرتبات' },
  { code: 'ACCOUNTING', title: 'المحاسبة', description: 'الحسابات، المشتريات والتقارير المالية' },
  { code: 'INVENTORY', title: 'المخزون', description: 'المواد الخام، التوريد والمخزون والوصفات' },
  { code: 'MANAGEMENT', title: 'الإدارة', description: 'إدارة الشركة والفروع والتقارير' },
  { code: 'KITCHEN', title: 'المطبخ', description: 'تذاكر وتجهيز الطلبات' },
  { code: 'DISPATCH', title: 'التوصيل', description: 'توزيع ومتابعة طلبات التوصيل' },
];

export function LoginGate({ children }: { children: ReactNode }) {
  const existing = useMemo(() => getDesktopSession(), []);
  const [session, setSession] = useState(existing);
  const [workspace, setWorkspace] = useState<WorkspaceCode>('POS');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [branchId, setBranchId] = useState(DEFAULT_BRANCH);
  const [deviceCode, setDeviceCode] = useState(DEFAULT_DEVICE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const branchDeviceRequired = workspace === 'POS' || workspace === 'KITCHEN' || workspace === 'DISPATCH';

  if (session) return <>{children}</>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await loginDesktop(API_BASE_URL, {
        username: username.trim(),
        password,
        workspace,
        branchId: branchDeviceRequired ? branchId.trim() || undefined : undefined,
        deviceCode: branchDeviceRequired ? deviceCode.trim() || undefined : undefined,
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
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 760, padding: 30, border: '1px solid #26313d', borderRadius: 18, background: '#0e141b', boxShadow: '0 24px 80px #0008' }}>
        <div style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 13, background: '#eef2f6', color: '#10151b', fontWeight: 900, fontSize: 12, marginBottom: 18 }}>BO'SH</div>
        <h1 style={{ margin: 0, fontSize: 24 }}>الدخول إلى BO'SH SYSTEM</h1>
        <p style={{ margin: '8px 0 22px', color: '#7b8896', fontSize: 12, lineHeight: 1.7 }}>اختار مساحة العمل أولًا، ثم سجّل دخولك. الصلاحيات الحقيقية يحددها الـBackend بعد التحقق من الحساب.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginBottom: 22 }}>
          {WORKSPACES.map((item) => (
            <button key={item.code} type="button" onClick={() => setWorkspace(item.code)} style={{ minHeight: 82, textAlign: 'right', padding: 12, borderRadius: 11, border: workspace === item.code ? '1px solid #e8edf5' : '1px solid #293540', background: workspace === item.code ? '#18212a' : '#111820', color: '#e8edf5', cursor: 'pointer' }}>
              <strong style={{ display: 'block', fontSize: 12 }}>{item.title}</strong>
              <span style={{ display: 'block', marginTop: 6, color: '#7b8896', fontSize: 10, lineHeight: 1.5 }}>{item.description}</span>
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={labelStyle}>اسم المستخدم<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required style={inputStyle} /></label>
          <label style={labelStyle}>كلمة المرور<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required style={inputStyle} /></label>
          {branchDeviceRequired && <label style={labelStyle}>الفرع<input value={branchId} onChange={(event) => setBranchId(event.target.value)} style={inputStyle} /></label>}
          {branchDeviceRequired && <label style={labelStyle}>كود الجهاز<input value={deviceCode} onChange={(event) => setDeviceCode(event.target.value)} style={inputStyle} /></label>}
        </div>

        {error && <div style={{ margin: '14px 0', padding: 10, borderRadius: 9, border: '1px solid #63373a', color: '#f0a7a7', background: '#211214', fontSize: 11 }}>{error}</div>}
        <button disabled={busy} type="submit" style={{ width: '100%', height: 46, marginTop: 8, border: 0, borderRadius: 11, background: '#eef2f5', color: '#10151b', fontWeight: 900, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'جاري تسجيل الدخول…' : 'تسجيل الدخول'}</button>
      </form>
    </main>
  );
}

const labelStyle = { display: 'grid', gap: 7, marginBottom: 13, fontSize: 11, color: '#9ca8b5' };
const inputStyle = { width: '100%', boxSizing: 'border-box' as const, height: 40, border: '1px solid #293540', borderRadius: 9, outline: 'none', padding: '0 11px', background: '#111820', color: '#e8edf5', fontSize: 12 };
