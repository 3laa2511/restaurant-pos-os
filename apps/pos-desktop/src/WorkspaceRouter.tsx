import { KitchenDisplay } from './KitchenDisplay.js';
import { RealPosApp } from './RealPosApp.js';
import { getDesktopSession, logoutDesktop } from './pos/auth-client.js';
import { API_BASE_URL, apiGet, apiPost } from './pos/workspace-api.js';
import { useEffect, useState, type ReactNode } from 'react';

const labels: Record<string, string> = {
  POS: 'الكاشير / POS',
  CALL_CENTER: 'كول سنتر',
  KITCHEN: 'المطبخ',
  DISPATCH: 'التوصيل',
  HR: 'الموارد البشرية',
  ACCOUNTING: 'المحاسبة',
  INVENTORY: 'المخزون',
  MANAGEMENT: 'الإدارة',
  SETTINGS: 'الإعدادات',
};


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
type AttendanceRow = {
  id: string;
  userId: string;
  branchId: string;
  workDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  workedMinutes: number;
  overtimeMinutes: number;
  status: string;
  user?: { displayName?: string; username?: string };
};
type PayrollPeriodRow = {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  branch?: { code: string; name: string } | null;
  _count?: { entries: number };
};

const fieldStyle: React.CSSProperties = {
  width: '100%', minWidth: 0, boxSizing: 'border-box', border: '1px solid #334150',
  borderRadius: 9, padding: '10px 12px', background: '#111820', color: '#e8edf5',
};
const actionStyle: React.CSSProperties = {
  border: '1px solid #334150', borderRadius: 9, padding: '9px 13px',
  background: '#172331', color: '#e8edf5', cursor: 'pointer',
};

function HrWorkspace() {
  const session = getDesktopSession();
  const permissions = session?.user.permissions ?? [];
  const canViewEmployees = permissions.includes('HR_EMPLOYEE_VIEW');
  const canManageEmployees = permissions.includes('HR_EMPLOYEE_MANAGE');
  const canViewAttendance = permissions.includes('HR_ATTENDANCE_VIEW');
  const canManageAttendance = permissions.includes('HR_ATTENDANCE_MANAGE');
  const canViewPayroll = permissions.includes('HR_PAYROLL_VIEW');
  const canManagePayroll = permissions.includes('HR_PAYROLL_MANAGE');
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [periods, setPeriods] = useState<PayrollPeriodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [employeeForm, setEmployeeForm] = useState({
    username: '', password: '', displayName: '', employeeCode: '', jobTitle: '',
    branchId: session?.user.branchId ?? '', roleCode: 'CASHIER', phone: '',
    baseSalary: '', overtimeRate: '',
  });
  const [payrollForm, setPayrollForm] = useState({ name: 'مرتبات ' + today.slice(0, 7), periodStart: monthStart, periodEnd: monthEnd });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [employeeRows, attendanceRows, payrollRows] = await Promise.all([
        canViewEmployees ? apiGet<EmployeeRow[]>('hr/employees') : Promise.resolve([]),
        canViewAttendance ? apiGet<AttendanceRow[]>(`hr/attendance?from=${encodeURIComponent(today)}&to=${encodeURIComponent(today)}`) : Promise.resolve([]),
        canViewPayroll ? apiGet<PayrollPeriodRow[]>('hr/payroll/periods') : Promise.resolve([]),
      ]);
      setEmployees(employeeRows);
      setAttendance(attendanceRows);
      setPeriods(payrollRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحميل بيانات الموارد البشرية');
    } finally {
      setLoading(false);
    }
  }

  async function createEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    setWorking('employee');
    setError('');
    try {
      await apiPost('hr/employees', {
        username: employeeForm.username.trim(),
        password: employeeForm.password,
        displayName: employeeForm.displayName.trim(),
        employeeCode: employeeForm.employeeCode.trim(),
        jobTitle: employeeForm.jobTitle.trim(),
        ...(employeeForm.branchId.trim() ? { branchId: employeeForm.branchId.trim() } : {}),
        roleCode: employeeForm.roleCode,
        ...(employeeForm.phone.trim() ? { phone: employeeForm.phone.trim() } : {}),
        baseSalary: Number(employeeForm.baseSalary),
        ...(employeeForm.overtimeRate.trim() ? { overtimeRate: Number(employeeForm.overtimeRate) } : {}),
      });
      setEmployeeForm({ username: '', password: '', displayName: '', employeeCode: '', jobTitle: '', branchId: session?.user.branchId ?? '', roleCode: 'CASHIER', phone: '', baseSalary: '', overtimeRate: '' });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر إضافة الموظف');
    } finally {
      setWorking('');
    }
  }

  async function attendanceAction(action: 'check-in' | 'check-out', employee: EmployeeRow) {
    const branchId = employee.user.branchId ?? session?.user.branchId;
    if (!branchId || working) return;
    setWorking(employee.user.id);
    setError('');
    try {
      await apiPost(`hr/attendance/${action}`, { userId: employee.user.id, branchId });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تسجيل الحضور');
    } finally {
      setWorking('');
    }
  }

  async function createPayroll(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    setWorking('payroll');
    setError('');
    try {
      await apiPost('hr/payroll/periods', payrollForm);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر إنشاء فترة الرواتب');
    } finally {
      setWorking('');
    }
  }

  async function payrollAction(id: string, action: 'approve' | 'pay') {
    if (working) return;
    setWorking(id);
    setError('');
    try {
      await apiPost(`hr/payroll/periods/${encodeURIComponent(id)}/${action}`, {});
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تنفيذ إجراء الرواتب');
    } finally {
      setWorking('');
    }
  }

  useEffect(() => { void load(); }, [session?.user.branchId, session?.workspace]);

  return <WorkspaceShell title="الموارد البشرية" description="إدارة الموظفين والحضور والرواتب. نطاق البيانات يحدده الفرع والصلاحيات في الجلسة الموثقة على الخادم.">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: '#7b8896' }}>الفرع: {session?.user.branchId ?? 'نطاق الشركة'}</span>
      <button type="button" onClick={() => void load()} disabled={loading || Boolean(working)} style={actionStyle}>{loading ? 'جاري التحميل…' : 'تحديث البيانات'}</button>
    </div>
    {error && <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, border: '1px solid #63373a', color: '#f0a7a7', background: '#211214' }}>{error}</div>}

    {canManageEmployees && <section style={{ padding: 18, marginBottom: 16, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b' }}>
      <h2 style={{ margin: '0 0 14px', fontSize: 17 }}>إضافة موظف</h2>
      <form onSubmit={createEmployee} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
        <input required value={employeeForm.displayName} onChange={e => setEmployeeForm(v => ({ ...v, displayName: e.target.value }))} placeholder="اسم الموظف" style={fieldStyle} />
        <input required value={employeeForm.username} onChange={e => setEmployeeForm(v => ({ ...v, username: e.target.value }))} placeholder="اسم المستخدم" style={fieldStyle} />
        <input required type="password" minLength={8} value={employeeForm.password} onChange={e => setEmployeeForm(v => ({ ...v, password: e.target.value }))} placeholder="كلمة مرور مؤقتة" style={fieldStyle} />
        <input required value={employeeForm.employeeCode} onChange={e => setEmployeeForm(v => ({ ...v, employeeCode: e.target.value }))} placeholder="كود الموظف" style={fieldStyle} />
        <input required value={employeeForm.jobTitle} onChange={e => setEmployeeForm(v => ({ ...v, jobTitle: e.target.value }))} placeholder="المسمى الوظيفي" style={fieldStyle} />
        <input required type="number" min="0" step="0.01" value={employeeForm.baseSalary} onChange={e => setEmployeeForm(v => ({ ...v, baseSalary: e.target.value }))} placeholder="الراتب الأساسي" style={fieldStyle} />
        <input type="number" min="0" step="0.01" value={employeeForm.overtimeRate} onChange={e => setEmployeeForm(v => ({ ...v, overtimeRate: e.target.value }))} placeholder="سعر ساعة إضافية" style={fieldStyle} />
        <input value={employeeForm.phone} onChange={e => setEmployeeForm(v => ({ ...v, phone: e.target.value }))} placeholder="رقم الهاتف (اختياري)" style={fieldStyle} />
        {!session?.user.branchId && <input value={employeeForm.branchId} onChange={e => setEmployeeForm(v => ({ ...v, branchId: e.target.value }))} placeholder="معرّف الفرع (اختياري)" style={fieldStyle} />}
        <select value={employeeForm.roleCode} onChange={e => setEmployeeForm(v => ({ ...v, roleCode: e.target.value }))} style={fieldStyle}>
          <option value="CASHIER">كاشير</option><option value="KITCHEN_STAFF">موظف مطبخ</option><option value="DISPATCHER">مسؤول توصيل</option>
        </select>
        <button type="submit" disabled={working === 'employee'} style={{ ...actionStyle, background: '#d9e7f5', color: '#10161d', fontWeight: 700 }}>{working === 'employee' ? 'جاري الحفظ…' : 'حفظ الموظف'}</button>
      </form>
    </section>}

    {canViewEmployees && <section style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 17 }}>الموظفون ({employees.length})</h2>
      <DataTable headers={['الكود','الموظف','الوظيفة','الفرع','الراتب الأساسي','الحالة',...(canManageAttendance ? ['الحضور'] : [])]} rows={employees.map(e => [
        e.employeeCode, e.user.displayName, e.jobTitle, e.user.branchId ?? 'مركزي',
        Number(e.baseSalary).toFixed(2) + ' ج.م', e.user.status,
        ...(canManageAttendance ? [<div style={{ display: 'flex', gap: 6 }}><button type="button" disabled={Boolean(working)} onClick={() => void attendanceAction('check-in',e)} style={actionStyle}>حضور</button><button type="button" disabled={Boolean(working)} onClick={() => void attendanceAction('check-out',e)} style={actionStyle}>انصراف</button></div>] : []),
      ])} />
    </section>}

    {canViewAttendance && <section style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 17 }}>حضور اليوم</h2>
      <DataTable headers={['الموظف','تاريخ العمل','الحضور','الانصراف','الدقائق','الحالة']} rows={attendance.map(row => [
        row.user?.displayName ?? employees.find(e => e.user.id === row.userId)?.user.displayName ?? row.userId,
        new Date(row.workDate).toLocaleDateString('ar-EG'),
        row.checkInAt ? new Date(row.checkInAt).toLocaleTimeString('ar-EG') : '—',
        row.checkOutAt ? new Date(row.checkOutAt).toLocaleTimeString('ar-EG') : '—',
        row.workedMinutes,
        row.status,
      ])} />
    </section>}

    {canViewPayroll && <section style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 17 }}>فترات الرواتب</h2>
      {canManagePayroll && <form onSubmit={createPayroll} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, padding: 16, marginBottom: 12, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b' }}>
        <input required value={payrollForm.name} onChange={e => setPayrollForm(v => ({ ...v, name: e.target.value }))} placeholder="اسم الفترة" style={fieldStyle} />
        <input required type="date" value={payrollForm.periodStart} onChange={e => setPayrollForm(v => ({ ...v, periodStart: e.target.value }))} style={fieldStyle} />
        <input required type="date" value={payrollForm.periodEnd} onChange={e => setPayrollForm(v => ({ ...v, periodEnd: e.target.value }))} style={fieldStyle} />
        <button type="submit" disabled={working === 'payroll'} style={{ ...actionStyle, background: '#d9e7f5', color: '#10161d', fontWeight: 700 }}>{working === 'payroll' ? 'جاري الإنشاء…' : 'إنشاء فترة رواتب'}</button>
      </form>}
      <DataTable headers={['الفترة','من','إلى','الفرع','عدد الموظفين','الحالة',...(canManagePayroll ? ['الإجراءات'] : [])]} rows={periods.map(period => [
        period.name, new Date(period.periodStart).toLocaleDateString('ar-EG'), new Date(period.periodEnd).toLocaleDateString('ar-EG'),
        period.branch?.name ?? 'كل الشركة', period._count?.entries ?? '—', period.status,
        ...(canManagePayroll ? [<div style={{ display: 'flex', gap: 6 }}>{period.status === 'DRAFT' && <button type="button" disabled={Boolean(working)} onClick={() => void payrollAction(period.id,'approve')} style={actionStyle}>اعتماد</button>}{period.status === 'APPROVED' && <button type="button" disabled={Boolean(working)} onClick={() => void payrollAction(period.id,'pay')} style={actionStyle}>صرف</button>}</div>] : []),
      ])} />
    </section>}
  </WorkspaceShell>;
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

function SettingsWorkspace() {
  const session = getDesktopSession();
  const branchId = session?.user.branchId;
  const [cycle, setCycle] = useState<{ id: string; name: string; openedAt: string } | null>(null);
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
    if (!branchId || !name.trim() || working) return;
    if (!window.confirm('سيتم إغلاق الدورة الحالية وحفظ ملخصها ثم فتح دورة جديدة. لن يتم حذف أي فواتير أو تاريخ. هل تريد المتابعة؟')) return;
    setWorking(true); setError('');
    try {
      const result = await apiPost<{ current: typeof cycle }>('business-cycles/start-new', { branchId, name: name.trim() });
      setCycle(result.current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر بدء دورة جديدة'); }
    finally { setWorking(false); }
  }

  useEffect(() => { void load(); }, [branchId]);

  return <WorkspaceShell title="الإعدادات" description="إدارة البيانات التشغيلية الحساسة. تغيير دورة التشغيل لا يحذف أي فواتير أو تاريخ، وكل عملية تمر عبر صلاحيات الـBackend والـRLS.">
    <section style={{ padding: 20, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b' }}>
      <div style={{ color: '#7b8896', fontSize: 11, marginBottom: 7 }}>إدارة البيانات</div>
      <h2 style={{ margin: 0, fontSize: 20 }}>بدء تشغيل جديد</h2>
      <p style={{ color: '#9ca8b5', lineHeight: 1.8 }}>إغلاق الدورة الحالية وفتح دورة جديدة مع الاحتفاظ الكامل بالتاريخ والفواتير.</p>
      <div style={{ padding: 14, border: '1px solid #26313d', borderRadius: 11, background: '#111820' }}>
        <div style={{ fontSize: 11, color: '#7b8896' }}>الدورة الحالية</div>
        <strong style={{ display: 'block', marginTop: 6 }}>{loading ? 'جاري التحميل…' : cycle?.name ?? 'لا توجد دورة مفتوحة'}</strong>
        {cycle && <div style={{ marginTop: 6, color: '#9ca8b5', fontSize: 12 }}>بدأت: {new Date(cycle.openedAt).toLocaleString('ar-EG')}</div>}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="اسم الدورة الجديدة" style={{ flex: 1, minWidth: 240, border: '1px solid #334150', borderRadius: 9, padding: '10px 12px', background: '#111820', color: '#e8edf5' }} />
        <button type="button" onClick={() => void startNew()} disabled={!cycle || working || !branchId} style={{ border: 0, borderRadius: 9, padding: '10px 16px', background: '#d9e7f5', color: '#10161d', fontWeight: 700 }}>{working ? 'جاري البدء…' : 'بدء تشغيل جديد'}</button>
        <button type="button" onClick={() => void load()} disabled={loading || working} style={{ border: '1px solid #334150', borderRadius: 9, padding: '10px 14px', background: '#111820', color: '#e8edf5' }}>تحديث</button>
      </div>
      {error && <div style={{ marginTop: 12, padding: 10, borderRadius: 9, border: '1px solid #63373a', color: '#f0a7a7', background: '#211214' }}>{error}</div>}
    </section>
  </WorkspaceShell>;
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

function SessionControls() {
  const [working, setWorking] = useState(false);
  async function changeWorkspace() {
    if (working || !window.confirm('سيتم تسجيل الخروج والعودة لاختيار مساحة عمل أخرى. هل تريد المتابعة؟')) return;
    setWorking(true);
    try { await logoutDesktop(API_BASE_URL); }
    catch { /* The local session is cleared by logoutDesktop even if the server is unreachable. */ }
    finally { window.location.reload(); }
  }
  return <button
    type="button"
    onClick={() => void changeWorkspace()}
    disabled={working}
    title="تسجيل الخروج وتغيير مساحة العمل"
    style={{ position: 'fixed', zIndex: 10000, top: 12, left: 12, border: '1px solid #334150', borderRadius: 9, padding: '9px 13px', background: '#111820', color: '#e8edf5', cursor: working ? 'wait' : 'pointer', boxShadow: '0 8px 24px #0006' }}
  >{working ? 'جاري الخروج…' : 'تغيير مساحة العمل'}</button>;
}

export function WorkspaceRouter() {
  const session = getDesktopSession();
  if (!session) return null;

  let content: ReactNode;
  if (session.workspace === 'POS') content = <RealPosApp />;
  else if (session.workspace === 'KITCHEN') content = <KitchenDisplay />;
  else if (session.workspace === 'HR' || session.workspace === 'ACCOUNTING' || session.workspace === 'INVENTORY') content = <ReadWorkspace workspace={session.workspace} />;
  else if (session.workspace === 'CALL_CENTER' || session.workspace === 'DISPATCH' || session.workspace === 'MANAGEMENT') content = <OperationalWorkspace workspace={session.workspace} />;
  else if (session.workspace === 'SETTINGS') content = <SettingsWorkspace />;
  else content = <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#090d12', color: '#e8edf5', padding: 24, direction: 'rtl' }}><section><h1>{labels[session.workspace] ?? session.workspace}</h1><p>مساحة العمل غير مفعّلة تشغيليًا.</p></section></main>;

  return <>{content}<SessionControls /></>;
}
