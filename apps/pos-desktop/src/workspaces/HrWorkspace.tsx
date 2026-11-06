import { useEffect, useState, type FormEvent } from 'react';
import { getDesktopSession } from '../pos/auth-client.js';
import { apiGet, apiPost } from '../pos/workspace-api.js';
import { actionStyle, DataTable, fieldStyle, WorkspaceShell } from './shared.js';

type HrBranch = { id: string; code: string; name: string };
type Employee = {
  userId: string; employeeCode: string; jobTitle: string; baseSalary: string | number;
  overtimeRate: string | number; user: { id: string; username: string; displayName: string; status: string; branchId: string | null };
};
type Attendance = {
  id: string; workDate: string; status: string; checkInAt: string | null; checkOutAt: string | null;
  overtimeMinutes: number; user: { id: string; username: string; displayName: string };
  branch: { id: string; code: string; name: string };
};
type PayrollPeriod = {
  id: string; name: string; periodStart: string; periodEnd: string; status: string;
  branch: { code: string; name: string } | null; _count: { entries: number };
};
const today = new Date().toLocaleDateString('en-CA');
const monthStart = today.slice(0, 8) + '01';

export function HrWorkspace() {
  const session = getDesktopSession();
  const permissions = session?.user.permissions ?? [];
  const canEmployees = permissions.includes('HR_EMPLOYEE_MANAGE');
  const canAttendance = permissions.includes('HR_ATTENDANCE_MANAGE');
  const canPayrollView = permissions.includes('HR_PAYROLL_VIEW');
  const canPayrollManage = permissions.includes('HR_PAYROLL_MANAGE');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<HrBranch[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [employeeForm, setEmployeeForm] = useState({ username: '', password: '', displayName: '', employeeCode: '', jobTitle: '', baseSalary: '', overtimeRate: '0', phone: '', branchId: session?.user.branchId ?? '' });
  const [attendanceFilter, setAttendanceFilter] = useState({ from: monthStart, to: today });
  const [payrollForm, setPayrollForm] = useState({ name: 'مرتبات ' + today.slice(0, 7), periodStart: monthStart, periodEnd: today });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [employeeRows, attendanceRows, payrollRows, branchRows] = await Promise.all([
        canEmployees || canAttendance ? apiGet<Employee[]>('hr/employees') : Promise.resolve([]),
        canAttendance ? Promise.all([
          apiGet<Attendance[]>(`hr/attendance?from=${encodeURIComponent(attendanceFilter.from)}&to=${encodeURIComponent(attendanceFilter.to)}`),
          apiGet<Attendance[]>(`hr/attendance?from=${encodeURIComponent(today)}&to=${encodeURIComponent(today)}`),
        ]).then(([rangeRows, todayRows]) => Array.from(new Map([...rangeRows, ...todayRows].map(row => [row.id, row])).values())) : Promise.resolve([]),
        canPayrollView || canPayrollManage ? apiGet<PayrollPeriod[]>('hr/payroll/periods') : Promise.resolve([]),
        canEmployees ? apiGet<HrBranch[]>('hr/branches') : Promise.resolve([]),
      ]);
      setEmployees(employeeRows);
      setBranches(branchRows);
      setEmployeeForm(value => ({ ...value, branchId: value.branchId || session?.user.branchId || branchRows[0]?.id || '' }));
      setAttendance(attendanceRows);
      setPeriods(payrollRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحميل بيانات الموارد البشرية');
    } finally {
      setLoading(false);
    }
  }

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
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
        baseSalary: Number(employeeForm.baseSalary),
        overtimeRate: Number(employeeForm.overtimeRate || 0),
        ...(employeeForm.phone.trim() ? { phone: employeeForm.phone.trim() } : {}),
        ...(session?.user.branchId ? { branchId: session.user.branchId } : employeeForm.branchId ? { branchId: employeeForm.branchId } : {}),
      });
      setEmployeeForm({ username: '', password: '', displayName: '', employeeCode: '', jobTitle: '', baseSalary: '', overtimeRate: '0', phone: '', branchId: session?.user.branchId ?? branches[0]?.id ?? '' });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر إضافة الموظف');
    } finally {
      setWorking('');
    }
  }

  async function attendanceAction(employee: Employee, action: 'check-in' | 'check-out') {
    if (working || !employee.user.branchId) return;
    setWorking(employee.userId);
    setError('');
    try {
      await apiPost('hr/attendance/' + action, { userId: employee.userId, branchId: employee.user.branchId });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تسجيل الحضور');
    } finally {
      setWorking('');
    }
  }

  async function createPayroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    setWorking('payroll');
    setError('');
    try {
      await apiPost('hr/payroll/periods', payrollForm);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر إنشاء كشف المرتبات');
    } finally {
      setWorking('');
    }
  }

  async function payrollAction(id: string, action: 'approve' | 'pay') {
    if (working) return;
    const message = action === 'approve'
      ? 'اعتماد كشف المرتبات وترحيل قيد الاستحقاق؟'
      : 'تأكيد صرف كشف المرتبات وتسجيل حركة الصرف؟';
    if (!window.confirm(message)) return;
    setWorking(id);
    setError('');
    try {
      await apiPost(`hr/payroll/periods/${encodeURIComponent(id)}/${action}`, {});
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحديث حالة المرتبات');
    } finally {
      setWorking('');
    }
  }

  useEffect(() => { void load(); }, [session?.user.branchId, session?.workspace, attendanceFilter.from, attendanceFilter.to]);

  return <WorkspaceShell title="الموارد البشرية" description="ملفات الموظفين والحضور والانصراف وكشوف المرتبات. الصلاحيات ونطاق الفرع والاعتماد المالي تُفرض من الـBackend.">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <span style={{ color: '#7b8896', fontSize: 11 }}>الموظفون: {employees.length} · سجلات الحضور: {attendance.length} · كشوف المرتبات: {periods.length}</span>
      <button type="button" onClick={() => void load()} disabled={loading || Boolean(working)} style={actionStyle}>{loading ? 'جاري التحميل…' : 'تحديث البيانات'}</button>
    </div>
    {error && <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, border: '1px solid #63373a', color: '#f0a7a7', background: '#211214' }}>{error}</div>}

    {canEmployees && <form onSubmit={createEmployee} style={{ padding: 16, marginBottom: 18, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 9 }}>
      <h2 style={{ margin: 0, fontSize: 16, gridColumn: '1 / -1' }}>إضافة موظف</h2>
      <input required value={employeeForm.displayName} onChange={e => setEmployeeForm(v => ({ ...v, displayName: e.target.value }))} placeholder="اسم الموظف" style={fieldStyle} />
      <input required value={employeeForm.employeeCode} onChange={e => setEmployeeForm(v => ({ ...v, employeeCode: e.target.value }))} placeholder="كود الموظف" style={fieldStyle} />
      <input required value={employeeForm.jobTitle} onChange={e => setEmployeeForm(v => ({ ...v, jobTitle: e.target.value }))} placeholder="الوظيفة" style={fieldStyle} />
      {!session?.user.branchId && <select required value={employeeForm.branchId} onChange={e => setEmployeeForm(v => ({ ...v, branchId: e.target.value }))} style={fieldStyle}><option value="">اختر الفرع</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}</select>}
      <input required value={employeeForm.username} onChange={e => setEmployeeForm(v => ({ ...v, username: e.target.value }))} placeholder="اسم المستخدم" style={fieldStyle} />
      <input required type="password" minLength={8} value={employeeForm.password} onChange={e => setEmployeeForm(v => ({ ...v, password: e.target.value }))} placeholder="كلمة المرور (8 أحرف على الأقل)" style={fieldStyle} />
      <input required type="number" min="0" step="0.01" value={employeeForm.baseSalary} onChange={e => setEmployeeForm(v => ({ ...v, baseSalary: e.target.value }))} placeholder="الراتب الأساسي" style={fieldStyle} />
      <input type="number" min="0" step="0.01" value={employeeForm.overtimeRate} onChange={e => setEmployeeForm(v => ({ ...v, overtimeRate: e.target.value }))} placeholder="سعر ساعة الإضافي" style={fieldStyle} />
      <input value={employeeForm.phone} onChange={e => setEmployeeForm(v => ({ ...v, phone: e.target.value }))} placeholder="رقم الهاتف (اختياري)" style={fieldStyle} />
      <button type="submit" disabled={working === 'employee'} style={actionStyle}>{working === 'employee' ? 'جاري الحفظ…' : 'حفظ الموظف'}</button>
    </form>}

    <section style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 17 }}>ملفات الموظفين</h2>
      <DataTable headers={['الكود','الموظف','اسم المستخدم','الوظيفة','الفرع','الراتب الأساسي','الحالة',...(canAttendance ? ['الحضور اليوم'] : [])]} rows={employees.map(employee => {
        const todayRecord = attendance.find(row => row.user.id === employee.userId && row.workDate.slice(0,10) === today);
        return [
          employee.employeeCode, employee.user.displayName, employee.user.username, employee.jobTitle,
          employee.user.branchId ?? 'نطاق الشركة', Number(employee.baseSalary).toFixed(2) + ' ج.م', employee.user.status,
          ...(canAttendance ? [<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" disabled={Boolean(working) || !employee.user.branchId || Boolean(todayRecord?.checkInAt)} onClick={() => void attendanceAction(employee,'check-in')} style={actionStyle}>حضور</button>
            <button type="button" disabled={Boolean(working) || !employee.user.branchId || !todayRecord?.checkInAt || Boolean(todayRecord?.checkOutAt)} onClick={() => void attendanceAction(employee,'check-out')} style={actionStyle}>انصراف</button>
          </div>] : []),
        ];
      })} />
    </section>

    {canAttendance && <section style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 17 }}>سجل الحضور والانصراف</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={{ color: '#9ca8b5', fontSize: 12 }}>من <input type="date" value={attendanceFilter.from} onChange={e => setAttendanceFilter(v => ({ ...v, from: e.target.value }))} style={fieldStyle} /></label>
        <label style={{ color: '#9ca8b5', fontSize: 12 }}>إلى <input type="date" value={attendanceFilter.to} onChange={e => setAttendanceFilter(v => ({ ...v, to: e.target.value }))} style={fieldStyle} /></label>
      </div>
      <DataTable headers={['التاريخ','الموظف','الفرع','الحالة','وقت الحضور','وقت الانصراف','إضافي (دقيقة)']} rows={attendance.map(row => [
        new Date(row.workDate).toLocaleDateString('ar-EG'), row.user.displayName, row.branch.name || row.branch.code, row.status,
        row.checkInAt ? new Date(row.checkInAt).toLocaleTimeString('ar-EG') : '—',
        row.checkOutAt ? new Date(row.checkOutAt).toLocaleTimeString('ar-EG') : '—', row.overtimeMinutes,
      ])} />
    </section>}

    {canPayrollManage && <form onSubmit={createPayroll} style={{ padding: 16, marginBottom: 18, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 9 }}>
      <h2 style={{ margin: 0, fontSize: 16, gridColumn: '1 / -1' }}>إنشاء كشف مرتبات</h2>
      <input required value={payrollForm.name} onChange={e => setPayrollForm(v => ({ ...v, name: e.target.value }))} placeholder="اسم الكشف" style={fieldStyle} />
      <input required type="date" value={payrollForm.periodStart} onChange={e => setPayrollForm(v => ({ ...v, periodStart: e.target.value }))} style={fieldStyle} />
      <input required type="date" value={payrollForm.periodEnd} onChange={e => setPayrollForm(v => ({ ...v, periodEnd: e.target.value }))} style={fieldStyle} />
      <button type="submit" disabled={working === 'payroll'} style={actionStyle}>{working === 'payroll' ? 'جاري الإنشاء…' : 'إنشاء الكشف'}</button>
    </form>}

    {(canPayrollView || canPayrollManage) && <section>
      <h2 style={{ fontSize: 17 }}>دورات المرتبات</h2>
      <DataTable headers={['الكشف','من','إلى','الفرع','عدد الموظفين','الحالة','الإجراءات']} rows={periods.map(period => [
        period.name, new Date(period.periodStart).toLocaleDateString('ar-EG'), new Date(period.periodEnd).toLocaleDateString('ar-EG'),
        period.branch?.name ?? 'كل الفروع', period._count.entries, period.status,
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {canPayrollManage && period.status === 'DRAFT' && <button type="button" disabled={Boolean(working)} onClick={() => void payrollAction(period.id,'approve')} style={actionStyle}>اعتماد</button>}
          {canPayrollManage && period.status === 'APPROVED' && <button type="button" disabled={Boolean(working)} onClick={() => void payrollAction(period.id,'pay')} style={actionStyle}>تسجيل الصرف</button>}
        </div>,
      ])} />
    </section>}
  </WorkspaceShell>;
}
