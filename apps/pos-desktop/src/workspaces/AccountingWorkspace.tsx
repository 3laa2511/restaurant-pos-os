import { useEffect, useState, type FormEvent } from 'react';
import { getDesktopSession } from '../pos/auth-client.js';
import { apiGet, apiPost } from '../pos/workspace-api.js';
import { actionStyle, DataTable, fieldStyle, WorkspaceShell } from './shared.js';

type AccountRow = { id: string; code: string; name: string; nameAr: string | null; type: string; active: boolean; allowPosting: boolean };
type FiscalPeriodRow = { id: string; name: string; periodStart: string; periodEnd: string; status: string };
type JournalLineRow = { debit: string | number; credit: string | number; account: { code: string; name: string; nameAr: string | null } };
type JournalRow = { id: string; entryNumber: string; entryDate: string; description: string; status: string; branchId: string | null; lines: JournalLineRow[]; reversalOfId: string | null; reversalEntry?: { id: string } | null };
type TrialBalanceRow = { code: string; name: string; nameAr: string | null; type: string; debit: number; credit: number; balance: number };
type ProfitLossRow = { revenue: number; expenses: number; netIncome: number; accounts: Array<{ code: string; name: string; nameAr: string | null; type: string; amount: number }> };
type BalanceSheetRow = { assets: number; liabilities: number; equity: number; netIncome: number; liabilitiesAndEquity: number; difference: number };
type LedgerRow = { entryId: string; entryNumber: string; entryDate: string; description: string; sourceType: string; account: { code: string; name: string; nameAr: string | null }; debit: number; credit: number; balance: number; memo: string | null };
type CashBankAccount = { openingBalance: number; totalDebit: number; totalCredit: number; closingBalance: number; lines: LedgerRow[] };
type CashBankReport = { cash: CashBankAccount; bank: CashBankAccount };
type ReconciliationFinding = { category: string; sourceId: string; orderNumber?: string; scope?: string; expectedRevenue?: number; postedRevenue?: number | null; movementCost?: number; postedCogs?: number | null; stockValuation?: number; inventoryAccountBalance?: number; difference?: number | null; status: string };
type ReconciliationReport = { summary: { findingCount: number; status: string; checkedPaidOrders: number; checkedCogsEntries: number; checkedConsumptionMovements: number; checkedInventoryBranches: number }; findings: ReconciliationFinding[]; inventoryValuationAsOf: string };

const today = new Date().toLocaleDateString('en-CA');
const monthStart = today.slice(0, 8) + '01';

function money(value: string | number) {
  return Number(value || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function AccountingWorkspace() {
  const session = getDesktopSession();
  const permissions = session?.user.permissions ?? [];
  const canManage = permissions.includes('ACCOUNTING_MANAGE');
  const canPost = permissions.includes('ACCOUNTING_POST');
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [periods, setPeriods] = useState<FiscalPeriodRow[]>([]);
  const [journal, setJournal] = useState<JournalRow[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceRow[]>([]);
  const [profitLoss, setProfitLoss] = useState<ProfitLossRow | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetRow | null>(null);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[] | null>(null);
  const [cashBank, setCashBank] = useState<CashBankReport | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [accountForm, setAccountForm] = useState({ code: '', name: '', nameAr: '', type: 'EXPENSE', allowPosting: true });
  const [periodForm, setPeriodForm] = useState({ name: 'فترة ' + today.slice(0, 7), periodStart: monthStart, periodEnd: today });
  const [journalForm, setJournalForm] = useState({ description: '', debitCode: '', creditCode: '', amount: '' });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const query = `from=${encodeURIComponent(monthStart)}&to=${encodeURIComponent(today)}`;
      const [accountRows, fiscalRows, journalRows, balanceRows, pnl, sheet] = await Promise.all([
        apiGet<AccountRow[]>('accounting/accounts'),
        apiGet<FiscalPeriodRow[]>('accounting/fiscal-periods'),
        apiGet<JournalRow[]>('accounting/journal'),
        apiGet<TrialBalanceRow[]>('accounting/trial-balance'),
        apiGet<ProfitLossRow>('accounting/reports/profit-and-loss?' + query),
        apiGet<BalanceSheetRow>('accounting/reports/balance-sheet?asOf=' + encodeURIComponent(today)),
      ]);
      setAccounts(accountRows);
      setPeriods(fiscalRows);
      setJournal(journalRows);
      setTrialBalance(balanceRows);
      setProfitLoss(pnl);
      setBalanceSheet(sheet);
      if (!journalForm.debitCode && accountRows.length) {
        const posting = accountRows.filter(account => account.active && account.allowPosting);
        setJournalForm(value => ({ ...value, debitCode: posting[0]?.code ?? '', creditCode: posting[1]?.code ?? '' }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحميل بيانات المحاسبة');
    } finally {
      setLoading(false);
    }
  }

  async function loadDetailedReports() {
    if (working) return;
    setWorking('reports');
    setError('');
    try {
      const query = `from=${encodeURIComponent(monthStart)}&to=${encodeURIComponent(today)}`;
      const [ledger, cash, reconciliationReport] = await Promise.all([
        apiGet<LedgerRow[]>('accounting/reports/general-ledger?' + query),
        apiGet<CashBankReport>('accounting/reports/cash-bank?' + query),
        apiGet<ReconciliationReport>('accounting/reports/reconciliation?' + query),
      ]);
      setLedgerRows(ledger);
      setCashBank(cash);
      setReconciliation(reconciliationReport);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحميل التقارير التفصيلية');
    } finally {
      setWorking('');
    }
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    setWorking('account');
    setError('');
    try {
      await apiPost('accounting/accounts', {
        code: accountForm.code.trim(),
        name: accountForm.name.trim(),
        ...(accountForm.nameAr.trim() ? { nameAr: accountForm.nameAr.trim() } : {}),
        type: accountForm.type,
        allowPosting: accountForm.allowPosting,
      });
      setAccountForm({ code: '', name: '', nameAr: '', type: 'EXPENSE', allowPosting: true });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر إنشاء الحساب');
    } finally {
      setWorking('');
    }
  }

  async function createPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    setWorking('period');
    setError('');
    try {
      await apiPost('accounting/fiscal-periods', periodForm);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر إنشاء الفترة المالية');
    } finally {
      setWorking('');
    }
  }

  async function postJournal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    const debitAccount = accounts.find(account => account.code === journalForm.debitCode && account.active && account.allowPosting);
    const creditAccount = accounts.find(account => account.code === journalForm.creditCode && account.active && account.allowPosting);
    const amount = Number(journalForm.amount);
    if (!debitAccount || !creditAccount || debitAccount.id === creditAccount.id || !Number.isFinite(amount) || amount <= 0) {
      setError('اختر حسابين مختلفين قابلين للترحيل وأدخل مبلغًا صحيحًا.');
      return;
    }
    setWorking('journal');
    setError('');
    try {
      await apiPost('accounting/journal', {
        sourceType: 'MANUAL',
        sourceId: window.crypto.randomUUID(),
        description: journalForm.description.trim(),
        lines: [
          { code: debitAccount.code, name: debitAccount.name, ...(debitAccount.nameAr ? { nameAr: debitAccount.nameAr } : {}), type: debitAccount.type, debit: amount, credit: 0 },
          { code: creditAccount.code, name: creditAccount.name, ...(creditAccount.nameAr ? { nameAr: creditAccount.nameAr } : {}), type: creditAccount.type, debit: 0, credit: amount },
        ],
      });
      setJournalForm(value => ({ ...value, description: '', amount: '' }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر ترحيل القيد');
    } finally {
      setWorking('');
    }
  }

  async function closePeriod(id: string) {
    if (working || !window.confirm('إغلاق الفترة المالية؟ لن يمكن ترحيل قيود جديدة داخلها.')) return;
    setWorking(id);
    setError('');
    try {
      await apiPost(`accounting/fiscal-periods/${encodeURIComponent(id)}/close`, {});
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر إغلاق الفترة');
    } finally {
      setWorking('');
    }
  }

  async function reverseEntry(id: string) {
    if (working) return;
    const reason = window.prompt('اكتب سبب عكس القيد:');
    if (!reason?.trim()) return;
    setWorking(id);
    setError('');
    try {
      await apiPost(`accounting/journal/${encodeURIComponent(id)}/reverse`, { reason: reason.trim() });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر عكس القيد');
    } finally {
      setWorking('');
    }
  }

  useEffect(() => { void load(); }, [session?.user.branchId, session?.workspace]);

  const postingAccounts = accounts.filter(account => account.active && account.allowPosting);
  return <WorkspaceShell title="المحاسبة" description="دليل الحسابات والقيود والفترات والتقارير المالية. كل ترحيل يُنفّذ ويُراجع داخل الـBackend مع عزل الفرع والشركة.">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <span style={{ fontSize: 11, color: '#7b8896' }}>الفرع: {session?.user.branchId ?? 'نطاق الشركة'} · فترة التقرير: {monthStart} — {today}</span>
      <button type="button" onClick={() => void load()} disabled={loading || Boolean(working)} style={actionStyle}>{loading ? 'جاري التحميل…' : 'تحديث البيانات'}</button>
    </div>
    {error && <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, border: '1px solid #63373a', color: '#f0a7a7', background: '#211214' }}>{error}</div>}

    {profitLoss && <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 16 }}>
      <div style={{ padding: 16, border: '1px solid #26313d', borderRadius: 13, background: '#0e141b' }}><div style={{ color: '#8e9baa', fontSize: 11 }}>الإيرادات</div><strong style={{ fontSize: 23 }}>{money(profitLoss.revenue)} ج.م</strong></div>
      <div style={{ padding: 16, border: '1px solid #26313d', borderRadius: 13, background: '#0e141b' }}><div style={{ color: '#8e9baa', fontSize: 11 }}>المصروفات</div><strong style={{ fontSize: 23 }}>{money(profitLoss.expenses)} ج.م</strong></div>
      <div style={{ padding: 16, border: '1px solid #26313d', borderRadius: 13, background: '#0e141b' }}><div style={{ color: '#8e9baa', fontSize: 11 }}>صافي الربح</div><strong style={{ fontSize: 23 }}>{money(profitLoss.netIncome)} ج.م</strong></div>
    </section>}

    {balanceSheet && <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 16 }}>
      <div style={{ padding: 16, border: '1px solid #26313d', borderRadius: 13, background: '#0e141b' }}><div style={{ color: '#8e9baa', fontSize: 11 }}>الأصول</div><strong style={{ fontSize: 22 }}>{money(balanceSheet.assets)} ج.م</strong></div>
      <div style={{ padding: 16, border: '1px solid #26313d', borderRadius: 13, background: '#0e141b' }}><div style={{ color: '#8e9baa', fontSize: 11 }}>الالتزامات وحقوق الملكية</div><strong style={{ fontSize: 22 }}>{money(balanceSheet.liabilitiesAndEquity)} ج.م</strong></div>
      <div style={{ padding: 16, border: '1px solid #26313d', borderRadius: 13, background: '#0e141b' }}><div style={{ color: '#8e9baa', fontSize: 11 }}>فرق الميزانية</div><strong style={{ fontSize: 22 }}>{money(balanceSheet.difference)} ج.م</strong></div>
    </section>}

    {canManage && <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14, marginBottom: 18 }}>
      <form onSubmit={createAccount} style={{ padding: 16, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b', display: 'grid', gap: 9 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>إضافة حساب</h2>
        <input required value={accountForm.code} onChange={e => setAccountForm(v => ({ ...v, code: e.target.value }))} placeholder="كود الحساب" style={fieldStyle} />
        <input required value={accountForm.name} onChange={e => setAccountForm(v => ({ ...v, name: e.target.value }))} placeholder="اسم الحساب" style={fieldStyle} />
        <input value={accountForm.nameAr} onChange={e => setAccountForm(v => ({ ...v, nameAr: e.target.value }))} placeholder="الاسم بالعربية" style={fieldStyle} />
        <select value={accountForm.type} onChange={e => setAccountForm(v => ({ ...v, type: e.target.value }))} style={fieldStyle}>
          <option value="ASSET">أصول</option><option value="LIABILITY">التزامات</option><option value="EQUITY">حقوق ملكية</option><option value="REVENUE">إيرادات</option><option value="EXPENSE">مصروفات</option>
        </select>
        <button type="submit" disabled={working === 'account'} style={actionStyle}>{working === 'account' ? 'جاري الحفظ…' : 'حفظ الحساب'}</button>
      </form>
      <form onSubmit={createPeriod} style={{ padding: 16, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b', display: 'grid', gap: 9 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>فترة مالية جديدة</h2>
        <input required value={periodForm.name} onChange={e => setPeriodForm(v => ({ ...v, name: e.target.value }))} placeholder="اسم الفترة" style={fieldStyle} />
        <input required type="date" value={periodForm.periodStart} onChange={e => setPeriodForm(v => ({ ...v, periodStart: e.target.value }))} style={fieldStyle} />
        <input required type="date" value={periodForm.periodEnd} onChange={e => setPeriodForm(v => ({ ...v, periodEnd: e.target.value }))} style={fieldStyle} />
        <button type="submit" disabled={working === 'period'} style={actionStyle}>{working === 'period' ? 'جاري الإنشاء…' : 'إنشاء الفترة'}</button>
      </form>
    </section>}

    {canPost && <form onSubmit={postJournal} style={{ padding: 16, marginBottom: 18, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 9 }}>
      <h2 style={{ margin: 0, fontSize: 16, gridColumn: '1 / -1' }}>قيد يدوي متوازن</h2>
      <input required value={journalForm.description} onChange={e => setJournalForm(v => ({ ...v, description: e.target.value }))} placeholder="وصف القيد" style={fieldStyle} />
      <select required value={journalForm.debitCode} onChange={e => setJournalForm(v => ({ ...v, debitCode: e.target.value }))} style={fieldStyle}><option value="">الحساب المدين</option>{postingAccounts.map(account => <option key={account.id} value={account.code}>{account.code} — {account.nameAr || account.name}</option>)}</select>
      <select required value={journalForm.creditCode} onChange={e => setJournalForm(v => ({ ...v, creditCode: e.target.value }))} style={fieldStyle}><option value="">الحساب الدائن</option>{postingAccounts.map(account => <option key={account.id} value={account.code}>{account.code} — {account.nameAr || account.name}</option>)}</select>
      <input required type="number" min="0.01" step="0.01" value={journalForm.amount} onChange={e => setJournalForm(v => ({ ...v, amount: e.target.value }))} placeholder="المبلغ بالجنيه" style={fieldStyle} />
      <button type="submit" disabled={working === 'journal' || postingAccounts.length < 2} style={actionStyle}>{working === 'journal' ? 'جاري الترحيل…' : 'ترحيل القيد'}</button>
    </form>}

    <section style={{ marginBottom: 18, padding: 16, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div><h2 style={{ margin: 0, fontSize: 17 }}>التقارير التفصيلية والمطابقة</h2><p style={{ margin: '5px 0 0', color: '#8e9baa', fontSize: 11 }}>دفتر الأستاذ، حركة النقدية والبنك، ومطابقة المبيعات والمخزون مع القيود</p></div>
        <button type="button" disabled={working === 'reports'} onClick={() => void loadDetailedReports()} style={actionStyle}>{working === 'reports' ? 'جاري إعداد التقارير…' : 'تحميل التقارير التفصيلية'}</button>
      </div>
      {reconciliation && <div style={{ marginTop: 14, padding: 12, border: '1px solid #26313d', borderRadius: 10 }}>
        <strong>{reconciliation.summary.status === 'NO_MISMATCHES_FOUND' ? 'لا توجد فروق في المطابقة' : 'توجد فروق تحتاج مراجعة'}</strong>
        <span style={{ marginInlineStart: 12, color: '#9ca8b5', fontSize: 12 }}>عدد الملاحظات: {reconciliation.summary.findingCount} · أوامر مدفوعة: {reconciliation.summary.checkedPaidOrders} · حركات استهلاك: {reconciliation.summary.checkedConsumptionMovements}</span>
        <DataTable headers={['النوع','المصدر','المتوقع / قيمة المخزون','المسجل / قيمة الدفتر','الفرق','الحالة']} rows={reconciliation.findings.map(item => [
          item.category, item.orderNumber || item.sourceId,
          money(item.expectedRevenue ?? item.movementCost ?? item.stockValuation ?? 0),
          money(item.postedRevenue ?? item.postedCogs ?? item.inventoryAccountBalance ?? 0),
          item.difference === null || item.difference === undefined ? '—' : money(item.difference), item.status,
        ])} />
        <p style={{ color: '#8e9baa', fontSize: 10, marginBottom: 0 }}>تقييم المخزون الحالي محسوب حتى {new Date(reconciliation.inventoryValuationAsOf).toLocaleString('ar-EG')}. التقرير للقراءة فقط ولا يعدّل الأرصدة.</p>
      </div>}
      {cashBank && <div style={{ marginTop: 14 }}>
        <h3 style={{ fontSize: 14 }}>ملخص النقدية والبنك</h3>
        <DataTable headers={['الحساب','رصيد أول المدة','إجمالي مدين','إجمالي دائن','رصيد آخر المدة']} rows={[
          ['الخزينة', money(cashBank.cash.openingBalance), money(cashBank.cash.totalDebit), money(cashBank.cash.totalCredit), money(cashBank.cash.closingBalance)],
          ['البنك', money(cashBank.bank.openingBalance), money(cashBank.bank.totalDebit), money(cashBank.bank.totalCredit), money(cashBank.bank.closingBalance)],
        ]} />
      </div>}
      {ledgerRows && <div style={{ marginTop: 14 }}>
        <h3 style={{ fontSize: 14 }}>دفتر الأستاذ العام ({ledgerRows.length})</h3>
        <DataTable headers={['التاريخ','رقم القيد','الحساب','البيان','مدين','دائن','الرصيد']} rows={ledgerRows.map(row => [
          new Date(row.entryDate).toLocaleDateString('ar-EG'), row.entryNumber, row.account.nameAr || row.account.name,
          row.description, money(row.debit), money(row.credit), money(row.balance),
        ])} />
      </div>}
    </section>

    <section style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 17 }}>ميزان المراجعة</h2>
      <DataTable headers={['الكود','الحساب','النوع','مدين','دائن','الرصيد']} rows={trialBalance.map(row => [row.code, row.nameAr || row.name, row.type, money(row.debit), money(row.credit), money(row.balance)])} />
    </section>

    <section style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 17 }}>دليل الحسابات ({accounts.length})</h2>
      <DataTable headers={['الكود','الحساب','النوع','الترحيل','الحالة']} rows={accounts.map(account => [account.code, account.nameAr || account.name, account.type, account.allowPosting ? 'مسموح' : 'تجميعي', account.active ? 'نشط' : 'موقوف'])} />
    </section>

    <section style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 17 }}>الفترات المالية</h2>
      <DataTable headers={['الفترة','من','إلى','الحالة',...(canManage ? ['إجراء'] : [])]} rows={periods.map(period => [
        period.name, new Date(period.periodStart).toLocaleDateString('ar-EG'), new Date(period.periodEnd).toLocaleDateString('ar-EG'), period.status,
        ...(canManage ? [period.status === 'OPEN' ? <button type="button" disabled={Boolean(working)} onClick={() => void closePeriod(period.id)} style={actionStyle}>إغلاق الفترة</button> : '—'] : []),
      ])} />
    </section>

    <section>
      <h2 style={{ fontSize: 17 }}>دفتر القيود</h2>
      <DataTable headers={['رقم القيد','التاريخ','الوصف','المدين','الدائن','الحالة',...(canManage ? ['إجراء'] : [])]} rows={journal.slice(0, 50).map(entry => [
        entry.entryNumber, new Date(entry.entryDate).toLocaleDateString('ar-EG'), entry.description,
        money(entry.lines.reduce((sum, line) => sum + Number(line.debit), 0)),
        money(entry.lines.reduce((sum, line) => sum + Number(line.credit), 0)),
        entry.status,
        ...(canManage ? [entry.status === 'POSTED' && !entry.reversalOfId && !entry.reversalEntry ? <button type="button" disabled={Boolean(working)} onClick={() => void reverseEntry(entry.id)} style={actionStyle}>عكس القيد</button> : '—'] : []),
      ])} />
    </section>
  </WorkspaceShell>;
}
