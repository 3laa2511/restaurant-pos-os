import type { FormEvent, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { clearDesktopSession, getDesktopSession, loginDesktop } from './pos/auth-client.js';
import type { WorkspaceCode } from './pos/auth-client.js';
import './login-gate.css';

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
  { code: 'SETTINGS', title: 'الإعدادات', description: 'إدارة البيانات ودورة التشغيل' },
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
  const branchDeviceRequired = workspace === 'POS' || workspace === 'KITCHEN' || workspace === 'DISPATCH' || workspace === 'SETTINGS';
  const deviceRequired = workspace === 'POS' || workspace === 'KITCHEN' || workspace === 'DISPATCH';

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
        deviceCode: deviceRequired ? deviceCode.trim() || undefined : undefined,
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
    <main className="login-gate" dir="rtl">
      <section className="login-card" aria-labelledby="login-title">
        <header className="login-brand">
          <div className="login-brand-mark" aria-hidden="true">RPOS</div>
          <div>
            <span className="login-overline">RESTAURANT OPERATING SYSTEM</span>
            <h1 id="login-title">أهلاً بيك في نظام المطعم</h1>
            <p>سجّل دخولك واختر مساحة العمل المصرّح لك باستخدامها.</p>
          </div>
        </header>

        <form onSubmit={submit} className="login-form">
          <fieldset className="workspace-picker">
            <legend>اختار مساحة العمل</legend>
            <div className="workspace-grid">
              {WORKSPACES.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  className={workspace === item.code ? 'workspace-option selected' : 'workspace-option'}
                  aria-pressed={workspace === item.code}
                  onClick={() => setWorkspace(item.code)}
                >
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="login-fields">
            <label className="login-field">
              <span>اسم المستخدم</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required placeholder="اكتب اسم المستخدم" />
            </label>
            <label className="login-field">
              <span>كلمة المرور</span>
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required placeholder="اكتب كلمة المرور" />
            </label>
            {branchDeviceRequired && (
              <label className="login-field">
                <span>كود الفرع</span>
                <input value={branchId} onChange={(event) => setBranchId(event.target.value)} autoComplete="off" placeholder="كود الفرع" />
              </label>
            )}
            {branchDeviceRequired && (
              <label className="login-field">
                <span>كود الجهاز</span>
                <input value={deviceCode} onChange={(event) => setDeviceCode(event.target.value)} autoComplete="off" required={deviceRequired} placeholder="كود الجهاز" />
              </label>
            )}
          </div>

          <div className="login-security-note">
            <span aria-hidden="true">✓</span>
            <p>تأكيد الحساب والصلاحيات واختيار الفرع بيتم من خلال الخادم، مش من الواجهة.</p>
          </div>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="login-submit" disabled={busy || !username.trim() || !password} type="submit">
            {busy ? <><span className="login-spinner" aria-hidden="true" /> جاري تسجيل الدخول…</> : 'تسجيل الدخول'}
          </button>
        </form>
        <footer className="login-footer"><span>RPOS</span><span>نظام تشغيل المطعم</span></footer>
      </section>
    </main>
  );
}
