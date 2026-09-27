import { KitchenDisplay } from './KitchenDisplay.js';
import { RealPosApp } from './RealPosApp.js';
import { getDesktopSession } from './pos/auth-client.js';

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

export function WorkspaceRouter() {
  const session = getDesktopSession();
  if (!session) return null;

  if (session.workspace === 'POS') return <RealPosApp />;
  if (session.workspace === 'KITCHEN') return <KitchenDisplay />;

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#090d12', color: '#e8edf5', fontFamily: 'Inter, system-ui, sans-serif', padding: 24, direction: 'rtl' }}>
      <section style={{ width: '100%', maxWidth: 620, padding: 30, border: '1px solid #26313d', borderRadius: 18, background: '#0e141b' }}>
        <div style={{ fontSize: 11, color: '#7b8896', marginBottom: 8 }}>BO'SH SYSTEM / WORKSPACE</div>
        <h1 style={{ margin: 0 }}>{labels[session.workspace] ?? session.workspace}</h1>
        <p style={{ color: '#9ca8b5', lineHeight: 1.8 }}>تم تسجيل الدخول إلى مساحة العمل المصرّح بها. واجهة هذا القسم ستُربط بالـAPI الخاص بها بدون منح صلاحيات أو بيانات من أقسام أخرى.</p>
        <div style={{ padding: 12, borderRadius: 10, background: '#111820', color: '#7b8896', fontSize: 11 }}>Workspace: {session.workspace}</div>
      </section>
    </main>
  );
}
