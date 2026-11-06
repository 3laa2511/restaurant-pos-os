import { useEffect, useState, type FormEvent } from 'react';
import { getDesktopSession } from '../pos/auth-client.js';
import { apiGet, apiPost } from '../pos/workspace-api.js';
import { actionStyle, DataTable, fieldStyle, WorkspaceShell } from './shared.js';

type IngredientRow = { id: string; sku: string; name: string; nameAr: string | null; baseUnit: string; purchaseUnit: string; purchaseUnitFactor: string | number; active: boolean };
type StockRow = { quantityBaseUnit: string | number; averageCostPerBaseUnit: string | number; ingredient: IngredientRow; branch: { code: string; name: string } };
type BranchOption = { id: string; code: string; name: string };
type WarehouseRow = { id: string; code: string; name: string; type: string; branchId: string | null; branch: BranchOption | null };
type TransferItemRow = { id: string; quantityBaseUnit: string | number; ingredient: { sku: string; name: string; baseUnit: string } };
type ProductOption = { id: string; sku: string; name: string; nameAr: string | null };
type MenuCategory = { products: ProductOption[] };
type RecipeRow = { ingredientId: string; quantityBaseUnit: number | string; wastePercent: number | string; ingredient?: { sku: string; name: string; nameAr: string | null; baseUnit: string } };
type TransferRow = {
  id: string;
  transferNumber: string;
  status: string;
  notes: string | null;
  fromWarehouse: { id: string; code: string; name: string; type: string; branchId: string | null };
  toWarehouse: { id: string; code: string; name: string; type: string; branchId: string | null };
  items: TransferItemRow[];
};

function money(value: string | number) {
  return Number(value || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const newKey = () => window.crypto.randomUUID();

export function InventoryWorkspace() {
  const session = getDesktopSession();
  const permissions = session?.user.permissions ?? [];
  const canView = permissions.includes('INVENTORY_VIEW');
  const canPurchase = permissions.includes('INVENTORY_PURCHASE');
  const canAdjust = permissions.includes('INVENTORY_ADJUST');
  const canManage = permissions.includes('INVENTORY_MANAGE');
  const canRecipe = permissions.includes('RECIPE_MANAGE');
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [recipeRows, setRecipeRows] = useState<Array<{ ingredientId: string; quantityBaseUnit: string; wastePercent: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [ingredientForm, setIngredientForm] = useState({ sku: '', name: '', nameAr: '', baseUnit: 'g', purchaseUnit: 'kg', purchaseUnitFactor: '1000', reorderLevel: '0' });
  const [receiptForm, setReceiptForm] = useState({ branchId: session?.user.branchId ?? '', ingredientId: '', quantity: '', unitCost: '', reference: '' });
  const [receiptKey, setReceiptKey] = useState(newKey);
  const [adjustForm, setAdjustForm] = useState({ branchId: session?.user.branchId ?? '', ingredientId: '', quantity: '', direction: 'OUT' as 'IN' | 'OUT', reason: '' });
  const [adjustKey, setAdjustKey] = useState(newKey);
  const [transferForm, setTransferForm] = useState({ fromWarehouseId: '', toWarehouseId: '', ingredientId: '', quantity: '', notes: '' });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [ingredientRows, stockRows, warehouseRows, transferRows, menuCategories] = await Promise.all([
        canView ? apiGet<IngredientRow[]>('inventory/ingredients') : Promise.resolve([]),
        canView ? apiGet<StockRow[]>('inventory/stock') : Promise.resolve([]),
        canView ? apiGet<WarehouseRow[]>('inventory/warehouses') : Promise.resolve([]),
        canView ? apiGet<TransferRow[]>('inventory/transfers') : Promise.resolve([]),
        canRecipe ? apiGet<MenuCategory[]>('menu') : Promise.resolve([]),
      ]);
      setIngredients(ingredientRows);
      setStock(stockRows);
      setWarehouses(warehouseRows);
      setTransfers(transferRows);
      const productRows = menuCategories.flatMap(category => category.products);
      setProducts(productRows);
      setSelectedProductId(value => value || productRows[0]?.id || '');
      setReceiptForm(value => ({ ...value, ingredientId: value.ingredientId || ingredientRows[0]?.id || '' }));
      setAdjustForm(value => ({ ...value, ingredientId: value.ingredientId || ingredientRows[0]?.id || '' }));
      setTransferForm(value => ({
        ...value,
        ingredientId: value.ingredientId || ingredientRows[0]?.id || '',
        fromWarehouseId: value.fromWarehouseId || warehouseRows[0]?.id || '',
        toWarehouseId: value.toWarehouseId || warehouseRows.find(row => row.id !== warehouseRows[0]?.id)?.id || '',
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحميل بيانات المخزون');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canRecipe || !selectedProductId) { setRecipeRows([]); return; }
    let active = true;
    apiGet<RecipeRow[]>(`inventory/recipes/${encodeURIComponent(selectedProductId)}`)
      .then(rows => { if (active) setRecipeRows(rows.map(row => ({ ingredientId: row.ingredientId, quantityBaseUnit: String(row.quantityBaseUnit), wastePercent: String(row.wastePercent) }))); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'تعذر تحميل الوصفة'); });
    return () => { active = false; };
  }, [canRecipe, selectedProductId]);

  async function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || !selectedProductId) return;
    const items = recipeRows.filter(row => row.ingredientId && Number(row.quantityBaseUnit) > 0).map(row => ({
      ingredientId: row.ingredientId,
      quantityBaseUnit: Number(row.quantityBaseUnit),
      wastePercent: Number(row.wastePercent || 0),
    }));
    if (items.length !== recipeRows.length) {
      setError('راجع مكونات الوصفة: كل مادة تحتاج كمية أساسية أكبر من صفر.');
      return;
    }
    setWorking('recipe');
    setError('');
    try {
      await apiPost(`inventory/recipes/${encodeURIComponent(selectedProductId)}`, { items });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر حفظ الوصفة');
    } finally {
      setWorking('');
    }
  }

  async function createIngredient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    setWorking('ingredient');
    setError('');
    try {
      await apiPost('inventory/ingredients', {
        sku: ingredientForm.sku.trim(),
        name: ingredientForm.name.trim(),
        ...(ingredientForm.nameAr.trim() ? { nameAr: ingredientForm.nameAr.trim() } : {}),
        baseUnit: ingredientForm.baseUnit.trim(),
        purchaseUnit: ingredientForm.purchaseUnit.trim(),
        purchaseUnitFactor: Number(ingredientForm.purchaseUnitFactor),
        reorderLevel: Number(ingredientForm.reorderLevel || 0),
      });
      setIngredientForm({ sku: '', name: '', nameAr: '', baseUnit: 'g', purchaseUnit: 'kg', purchaseUnitFactor: '1000', reorderLevel: '0' });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر إضافة المادة');
    } finally {
      setWorking('');
    }
  }

  async function receiveStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || !receiptForm.branchId || !receiptForm.ingredientId) return;
    setWorking('receipt');
    setError('');
    try {
      await apiPost('inventory/receipts', {
        branchId: receiptForm.branchId,
        ...(receiptForm.reference.trim() ? { reference: receiptForm.reference.trim() } : {}),
        idempotencyKey: receiptKey,
        items: [{ ingredientId: receiptForm.ingredientId, quantityPurchaseUnit: Number(receiptForm.quantity), unitCost: Number(receiptForm.unitCost) }],
      });
      setReceiptKey(newKey());
      setReceiptForm(value => ({ ...value, quantity: '', unitCost: '', reference: '' }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تسجيل الاستلام');
    } finally {
      setWorking('');
    }
  }

  async function adjustStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || !adjustForm.branchId || !adjustForm.ingredientId) return;
    setWorking('adjust');
    setError('');
    try {
      await apiPost('inventory/adjust', {
        branchId: adjustForm.branchId,
        ingredientId: adjustForm.ingredientId,
        quantityBaseUnit: Number(adjustForm.quantity),
        direction: adjustForm.direction,
        reason: adjustForm.reason.trim(),
        idempotencyKey: adjustKey,
      });
      setAdjustKey(newKey());
      setAdjustForm(value => ({ ...value, quantity: '', reason: '' }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تسوية المخزون');
    } finally {
      setWorking('');
    }
  }

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working || !transferForm.fromWarehouseId || !transferForm.toWarehouseId || !transferForm.ingredientId) return;
    setWorking('transfer');
    setError('');
    try {
      await apiPost('inventory/transfers', {
        fromWarehouseId: transferForm.fromWarehouseId,
        toWarehouseId: transferForm.toWarehouseId,
        notes: transferForm.notes.trim(),
        items: [{ ingredientId: transferForm.ingredientId, quantityBaseUnit: Number(transferForm.quantity) }],
      });
      setTransferForm(value => ({ ...value, quantity: '', notes: '' }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر إنشاء طلب النقل');
    } finally {
      setWorking('');
    }
  }

  async function transferAction(id: string, action: 'approve' | 'dispatch' | 'receive') {
    if (working) return;
    setWorking(id);
    setError('');
    try {
      await apiPost(`inventory/transfers/${encodeURIComponent(id)}/${action}`, {});
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تنفيذ حركة النقل');
    } finally {
      setWorking('');
    }
  }

  useEffect(() => { void load(); }, [session?.user.branchId, session?.workspace]);

  const branchOptions = Array.from(new Map<string, BranchOption>(warehouses.filter(w => w.branchId && w.branch).map(w => [w.branchId as string, w.branch as BranchOption] as const)).values());
  const tenantWide = !session?.user.branchId;
  return <WorkspaceShell title="المخزون" description="المواد الخام والأرصدة والاستلام والتسويات والتحويلات بين مخازن الفروع والمخزن المركزي. كل حركة لها مرجع وصلاحيات وعزل على مستوى الشركة والفرع.">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <span style={{ fontSize: 11, color: '#7b8896' }}>الفرع: {session?.user.branchId ?? 'نطاق الشركة'} · المواد: {ingredients.length} · المخازن: {warehouses.length}</span>
      <button type="button" onClick={() => void load()} disabled={loading || Boolean(working)} style={actionStyle}>{loading ? 'جاري التحميل…' : 'تحديث البيانات'}</button>
    </div>
    {error && <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, border: '1px solid #63373a', color: '#f0a7a7', background: '#211214' }}>{error}</div>}

    {canPurchase && <form onSubmit={createIngredient} style={{ padding: 16, marginBottom: 16, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 9 }}>
      <h2 style={{ margin: 0, fontSize: 16, gridColumn: '1 / -1' }}>إضافة مادة خام</h2>
      <input required value={ingredientForm.sku} onChange={e => setIngredientForm(v => ({ ...v, sku: e.target.value }))} placeholder="SKU" style={fieldStyle} />
      <input required value={ingredientForm.name} onChange={e => setIngredientForm(v => ({ ...v, name: e.target.value }))} placeholder="اسم المادة" style={fieldStyle} />
      <input value={ingredientForm.nameAr} onChange={e => setIngredientForm(v => ({ ...v, nameAr: e.target.value }))} placeholder="الاسم بالعربية" style={fieldStyle} />
      <input required value={ingredientForm.baseUnit} onChange={e => setIngredientForm(v => ({ ...v, baseUnit: e.target.value }))} placeholder="الوحدة الأساسية (g/ml/pcs)" style={fieldStyle} />
      <input required value={ingredientForm.purchaseUnit} onChange={e => setIngredientForm(v => ({ ...v, purchaseUnit: e.target.value }))} placeholder="وحدة الشراء (kg/L/box)" style={fieldStyle} />
      <input required type="number" min="0.000001" step="0.000001" value={ingredientForm.purchaseUnitFactor} onChange={e => setIngredientForm(v => ({ ...v, purchaseUnitFactor: e.target.value }))} placeholder="معامل التحويل" style={fieldStyle} />
      <input type="number" min="0" step="0.0001" value={ingredientForm.reorderLevel} onChange={e => setIngredientForm(v => ({ ...v, reorderLevel: e.target.value }))} placeholder="حد إعادة الطلب" style={fieldStyle} />
      <button type="submit" disabled={working === 'ingredient'} style={actionStyle}>{working === 'ingredient' ? 'جاري الحفظ…' : 'حفظ المادة'}</button>
    </form>}

    {(canPurchase || canAdjust) && <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14, marginBottom: 16 }}>
      {canPurchase && <form onSubmit={receiveStock} style={{ padding: 16, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b', display: 'grid', gap: 9 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>استلام مشتريات</h2>
        {tenantWide && <select required value={receiptForm.branchId} onChange={e => setReceiptForm(v => ({ ...v, branchId: e.target.value }))} style={fieldStyle}><option value="">اختر الفرع</option>{branchOptions.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}</select>}
        <select required value={receiptForm.ingredientId} onChange={e => setReceiptForm(v => ({ ...v, ingredientId: e.target.value }))} style={fieldStyle}><option value="">اختر المادة</option>{ingredients.map(ingredient => <option key={ingredient.id} value={ingredient.id}>{ingredient.sku} — {ingredient.nameAr || ingredient.name}</option>)}</select>
        <input required type="number" min="0.0001" step="0.0001" value={receiptForm.quantity} onChange={e => setReceiptForm(v => ({ ...v, quantity: e.target.value }))} placeholder="الكمية بوحدة الشراء" style={fieldStyle} />
        <input required type="number" min="0" step="0.0001" value={receiptForm.unitCost} onChange={e => setReceiptForm(v => ({ ...v, unitCost: e.target.value }))} placeholder="تكلفة وحدة الشراء" style={fieldStyle} />
        <input value={receiptForm.reference} onChange={e => setReceiptForm(v => ({ ...v, reference: e.target.value }))} placeholder="رقم الفاتورة / المرجع" style={fieldStyle} />
        <button type="submit" disabled={working === 'receipt' || !receiptForm.branchId} style={actionStyle}>{working === 'receipt' ? 'جاري التسجيل…' : 'تسجيل الاستلام'}</button>
      </form>}
      {canAdjust && <form onSubmit={adjustStock} style={{ padding: 16, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b', display: 'grid', gap: 9 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>تسوية المخزون</h2>
        {tenantWide && <select required value={adjustForm.branchId} onChange={e => setAdjustForm(v => ({ ...v, branchId: e.target.value }))} style={fieldStyle}><option value="">اختر الفرع</option>{branchOptions.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}</select>}
        <select required value={adjustForm.ingredientId} onChange={e => setAdjustForm(v => ({ ...v, ingredientId: e.target.value }))} style={fieldStyle}><option value="">اختر المادة</option>{ingredients.map(ingredient => <option key={ingredient.id} value={ingredient.id}>{ingredient.sku} — {ingredient.nameAr || ingredient.name}</option>)}</select>
        <select value={adjustForm.direction} onChange={e => setAdjustForm(v => ({ ...v, direction: e.target.value as 'IN' | 'OUT' }))} style={fieldStyle}><option value="IN">زيادة</option><option value="OUT">نقص</option></select>
        <input required type="number" min="0.0001" step="0.0001" value={adjustForm.quantity} onChange={e => setAdjustForm(v => ({ ...v, quantity: e.target.value }))} placeholder="الكمية بالوحدة الأساسية" style={fieldStyle} />
        <input required value={adjustForm.reason} onChange={e => setAdjustForm(v => ({ ...v, reason: e.target.value }))} placeholder="سبب التسوية" style={fieldStyle} />
        <button type="submit" disabled={working === 'adjust' || !adjustForm.branchId} style={actionStyle}>{working === 'adjust' ? 'جاري التسجيل…' : 'تسجيل التسوية'}</button>
      </form>}
    </section>}

    {canRecipe && <form onSubmit={saveRecipe} style={{ padding: 16, marginBottom: 18, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div><h2 style={{ margin: 0, fontSize: 16 }}>وصفات المنتجات</h2><p style={{ color: '#8e9baa', fontSize: 11, margin: '5px 0 0' }}>حدد استهلاك كل منتج من المواد الخام؛ تُستخدم الوصفة لحساب تكلفة المبيعات وخصم المخزون عند إتمام الدفع.</p></div>
        <select required value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)} style={{ ...fieldStyle, maxWidth: 360 }}><option value="">اختر المنتج</option>{products.map(product => <option key={product.id} value={product.id}>{product.sku} — {product.nameAr || product.name}</option>)}</select>
      </div>
      {recipeRows.map((row, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px,2fr) minmax(110px,1fr) minmax(100px,1fr) auto', gap: 8 }}>
        <select required value={row.ingredientId} onChange={e => setRecipeRows(rows => rows.map((item,i) => i === index ? { ...item, ingredientId: e.target.value } : item))} style={fieldStyle}><option value="">المادة الخام</option>{ingredients.map(item => <option key={item.id} value={item.id}>{item.sku} — {item.nameAr || item.name} ({item.baseUnit})</option>)}</select>
        <input required type="number" min="0.0001" step="0.0001" value={row.quantityBaseUnit} onChange={e => setRecipeRows(rows => rows.map((item,i) => i === index ? { ...item, quantityBaseUnit: e.target.value } : item))} placeholder="الكمية الأساسية" style={fieldStyle} />
        <input type="number" min="0" max="100" step="0.01" value={row.wastePercent} onChange={e => setRecipeRows(rows => rows.map((item,i) => i === index ? { ...item, wastePercent: e.target.value } : item))} placeholder="هالك %" style={fieldStyle} />
        <button type="button" onClick={() => setRecipeRows(rows => rows.filter((_,i) => i !== index))} style={actionStyle}>حذف</button>
      </div>)}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={!selectedProductId || !ingredients.length} onClick={() => setRecipeRows(rows => [...rows, { ingredientId: '', quantityBaseUnit: '', wastePercent: '0' }])} style={actionStyle}>إضافة مكوّن</button>
        <button type="submit" disabled={working === 'recipe' || !selectedProductId} style={actionStyle}>{working === 'recipe' ? 'جاري الحفظ…' : 'حفظ الوصفة كاملة'}</button>
      </div>
    </form>}

    {canManage && <form onSubmit={createTransfer} style={{ padding: 16, marginBottom: 16, border: '1px solid #26313d', borderRadius: 14, background: '#0e141b', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 9 }}>
      <h2 style={{ margin: 0, fontSize: 16, gridColumn: '1 / -1' }}>طلب تحويل مخزون</h2>
      <select required value={transferForm.fromWarehouseId} onChange={e => setTransferForm(v => ({ ...v, fromWarehouseId: e.target.value }))} style={fieldStyle}><option value="">من مخزن</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name} ({w.type})</option>)}</select>
      <select required value={transferForm.toWarehouseId} onChange={e => setTransferForm(v => ({ ...v, toWarehouseId: e.target.value }))} style={fieldStyle}><option value="">إلى مخزن</option>{warehouses.filter(w => w.id !== transferForm.fromWarehouseId).map(w => <option key={w.id} value={w.id}>{w.code} — {w.name} ({w.type})</option>)}</select>
      <select required value={transferForm.ingredientId} onChange={e => setTransferForm(v => ({ ...v, ingredientId: e.target.value }))} style={fieldStyle}><option value="">اختر المادة</option>{ingredients.map(ingredient => <option key={ingredient.id} value={ingredient.id}>{ingredient.sku} — {ingredient.name}</option>)}</select>
      <input required type="number" min="0.0001" step="0.0001" value={transferForm.quantity} onChange={e => setTransferForm(v => ({ ...v, quantity: e.target.value }))} placeholder="الكمية بالوحدة الأساسية" style={fieldStyle} />
      <input value={transferForm.notes} onChange={e => setTransferForm(v => ({ ...v, notes: e.target.value }))} placeholder="ملاحظات" style={fieldStyle} />
      <button type="submit" disabled={working === 'transfer' || !transferForm.fromWarehouseId || !transferForm.toWarehouseId} style={actionStyle}>{working === 'transfer' ? 'جاري إنشاء الطلب…' : 'إنشاء طلب النقل'}</button>
    </form>}

    <section style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 17 }}>دليل المواد ({ingredients.length})</h2>
      <DataTable headers={['SKU','المادة','الوحدة الأساسية','وحدة الشراء','معامل التحويل','الحالة']} rows={ingredients.map(item => [
        item.sku, item.nameAr || item.name, item.baseUnit, item.purchaseUnit, Number(item.purchaseUnitFactor).toLocaleString('ar-EG'), item.active ? 'نشطة' : 'موقوفة',
      ])} />
    </section>

    <section style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 17 }}>أرصدة الفروع ({stock.length})</h2>
      <DataTable headers={['SKU','المادة','الفرع','الوحدة الأساسية','الكمية','متوسط التكلفة']} rows={stock.map(row => [row.ingredient.sku, row.ingredient.nameAr || row.ingredient.name, row.branch.name || row.branch.code, row.ingredient.baseUnit, Number(row.quantityBaseUnit).toFixed(3), money(row.averageCostPerBaseUnit)])} />
    </section>

    <section style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 17 }}>المخازن ({warehouses.length})</h2>
      <DataTable headers={['الكود','المخزن','النوع','الفرع']} rows={warehouses.map(row => [row.code, row.name, row.type, row.branch?.name ?? 'مركزي'])} />
    </section>

    <section>
      <h2 style={{ fontSize: 17 }}>طلبات التحويل</h2>
      <DataTable headers={['رقم الطلب','من','إلى','المواد','الحالة','الإجراءات']} rows={transfers.map(transfer => {
        const canApprove = tenantWide && transfer.status === 'REQUESTED';
        const canDispatch = transfer.status === 'APPROVED' && (tenantWide || transfer.fromWarehouse.branchId === session?.user.branchId);
        const canReceive = transfer.status === 'IN_TRANSIT' && (tenantWide || transfer.toWarehouse.branchId === session?.user.branchId);
        return [
          transfer.transferNumber,
          transfer.fromWarehouse.name,
          transfer.toWarehouse.name,
          transfer.items.map(item => item.ingredient.name + ' × ' + Number(item.quantityBaseUnit).toFixed(2)).join('، '),
          transfer.status,
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {canApprove && <button type="button" disabled={Boolean(working)} onClick={() => void transferAction(transfer.id,'approve')} style={actionStyle}>اعتماد</button>}
            {canDispatch && <button type="button" disabled={Boolean(working)} onClick={() => void transferAction(transfer.id,'dispatch')} style={actionStyle}>إرسال</button>}
            {canReceive && <button type="button" disabled={Boolean(working)} onClick={() => void transferAction(transfer.id,'receive')} style={actionStyle}>استلام</button>}
          </div>,
        ];
      })} />
    </section>
  </WorkspaceShell>;
}
