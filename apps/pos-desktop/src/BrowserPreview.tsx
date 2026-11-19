import { useMemo, useState } from 'react';

type Area = 'POS' | 'KITCHEN' | 'CALL_CENTER' | 'DISPATCH' | 'INVENTORY' | 'ACCOUNTING' | 'HR' | 'MANAGEMENT' | 'SETTINGS';
type DemoProduct = { id: number; name: string; category: string; price: number };
const areas: { id: Area; title: string; sub: string }[] = [
  { id: 'POS', title: 'الكاشير / POS', sub: 'البيع والطلبات والورديات' },
  { id: 'KITCHEN', title: 'المطبخ', sub: 'تذاكر التجهيز وحالات الطلبات' },
  { id: 'CALL_CENTER', title: 'كول سنتر', sub: 'العملاء واستقبال الطلبات' },
  { id: 'DISPATCH', title: 'التوصيل', sub: 'توزيع ومتابعة الطلبات' },
  { id: 'INVENTORY', title: 'المخزون', sub: 'الأصناف والأرصدة والتوريد' },
  { id: 'ACCOUNTING', title: 'المحاسبة', sub: 'الحركة المالية والتقارير' },
  { id: 'HR', title: 'الموارد البشرية', sub: 'الموظفون والحضور والورديات' },
  { id: 'MANAGEMENT', title: 'الإدارة', sub: 'ملخص الفروع ومؤشرات التشغيل' },
  { id: 'SETTINGS', title: 'الإعدادات', sub: 'إعدادات التشغيل والأجهزة' },
];
const products: DemoProduct[] = [
  { id: 1, name: 'برجر كلاسيك', category: 'وجبات', price: 125 },
  { id: 2, name: 'تشيز برجر', category: 'وجبات', price: 145 },
  { id: 3, name: 'فراخ كرسبي', category: 'وجبات', price: 135 },
  { id: 4, name: 'بطاطس', category: 'إضافات', price: 35 },
  { id: 5, name: 'كولا', category: 'مشروبات', price: 25 },
  { id: 6, name: 'مياه', category: 'مشروبات', price: 15 },
];
const orders = [
  ['#1042', 'تيك أواي', 'جاري التجهيز', '185.00'],
  ['#1041', 'دليفري', 'جاهز للاستلام', '220.00'],
  ['#1040', 'داخل المطعم', 'تم التسليم', '145.00'],
];
const money = (n: number) => n.toFixed(2) + ' ج.م';

export function BrowserPreview() {
  const [area, setArea] = useState<Area>('POS');
  const [cart, setCart] = useState<Record<number, number>>({});
  const [category, setCategory] = useState('الكل');
  const [search, setSearch] = useState('');
  const [night, setNight] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(true);
  const [notice, setNotice] = useState('');
  const [tickets, setTickets] = useState(['#1042', '#1041']);
  const [filter, setFilter] = useState('الكل');
  const selected = areas.find(x => x.id === area)!;
  const cartItems = useMemo(() => products.filter(p => cart[p.id]).map(p => ({ ...p, qty: cart[p.id] })), [cart]);
  const total = cartItems.reduce((sum, p) => sum + p.price * p.qty, 0);
  const visible = products.filter(p => (category === 'الكل' || p.category === category) && p.name.includes(search.trim()));
  const add = (id: number) => setCart(old => ({ ...old, [id]: (old[id] ?? 0) + 1 }));
  const change = (id: number, delta: number) => setCart(old => { const next = { ...old, [id]: (old[id] ?? 0) + delta }; if (next[id] <= 0) delete next[id]; return next; });
  const demoAction = (message: string) => setNotice(message + ' — وضع المعاينة فقط، لم يتم حفظ أي بيانات.');

  return <main className={night ? 'bp-root bp-night' : 'bp-root'} dir="rtl">
    <style>{`
      .bp-root{min-height:100vh;background:#f3f6fb;color:#172235;font-family:Arial,sans-serif;padding:18px;box-sizing:border-box}
      .bp-night{background:#0b1119;color:#e7edf6}.bp-wrap{max-width:1440px;margin:auto}
      .bp-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px}
      .bp-brand{display:flex;align-items:center;gap:12px}.bp-logo{width:42px;height:42px;border-radius:13px;background:#294f94;color:white;display:grid;place-items:center;font-weight:900}
      .bp-muted{color:#8190a5;font-size:12px}.bp-pill{background:#fff1d6;color:#8b5a08;border:1px solid #f0d7a7;border-radius:99px;padding:7px 12px;font-size:12px;font-weight:700}
      .bp-actions{display:flex;gap:8px}.bp-btn{border:1px solid #d9e1ec;background:white;color:#24344c;border-radius:9px;padding:9px 13px;cursor:pointer;font-weight:700}
      .bp-night .bp-btn,.bp-night .bp-card,.bp-night .bp-panel,.bp-night .bp-nav button{background:#121c28;color:#e7edf6;border-color:#28384a}
      .bp-layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:16px}.bp-nav,.bp-panel,.bp-card{background:white;border:1px solid #e0e7f0;border-radius:14px}
      .bp-nav{padding:10px;height:max-content;position:sticky;top:12px}.bp-nav button{display:block;width:100%;text-align:right;border:0;background:transparent;padding:12px;border-radius:9px;color:#40516b;cursor:pointer;margin:2px 0}
      .bp-nav button.active{background:#e9f0fc;color:#234b91;font-weight:800}.bp-night .bp-nav button.active{background:#1d3458;color:#dce9ff}
      .bp-content{min-width:0}.bp-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}.bp-heading h1{font-size:24px;margin:0 0 5px}
      .bp-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}.bp-card{padding:16px;min-width:0}.bp-kpi{font-size:24px;font-weight:800;margin-top:8px}
      .bp-panel{padding:16px;margin-bottom:14px;overflow:auto}.bp-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid #e9eef5}
      .bp-night .bp-row{border-color:#28384a}.bp-row:last-child{border:0}.bp-table{width:100%;border-collapse:collapse;min-width:520px}.bp-table th,.bp-table td{text-align:right;padding:12px;border-bottom:1px solid #e9eef5;font-size:13px}
      .bp-night .bp-table th,.bp-night .bp-table td{border-color:#28384a}.bp-table th{color:#8190a5;font-weight:700}
      .bp-products{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.bp-product{border:1px solid #e0e7f0;border-radius:12px;padding:14px;background:#fbfcfe;text-align:right;cursor:pointer;color:inherit}
      .bp-night .bp-product{background:#0e1722;border-color:#28384a}.bp-product strong{display:block;margin:9px 0}.bp-product span{font-size:12px;color:#8190a5}
      .bp-two{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,1fr);gap:14px}.bp-input{width:100%;box-sizing:border-box;border:1px solid #d9e1ec;border-radius:9px;padding:10px;background:transparent;color:inherit;margin-bottom:10px}
      .bp-primary{background:#294f94;color:white;border:0;border-radius:9px;padding:11px 15px;cursor:pointer;font-weight:800}.bp-tag{font-size:11px;padding:5px 8px;border-radius:99px;background:#eaf4ed;color:#2c7544}
      .bp-notice{background:#eaf4ed;color:#27643c;padding:12px;border-radius:10px;margin-bottom:12px;font-size:13px}.bp-empty{padding:26px;text-align:center;color:#8190a5}
      @media(max-width:800px){.bp-layout{grid-template-columns:1fr}.bp-nav{position:static;display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.bp-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.bp-two{grid-template-columns:1fr}.bp-products{grid-template-columns:repeat(2,minmax(0,1fr))}.bp-heading h1{font-size:20px}}
      @media(max-width:420px){.bp-root{padding:10px}.bp-grid{gap:8px}.bp-card{padding:12px}.bp-products{gap:7px}}
    `}</style>
    <div className="bp-wrap">
      <header className="bp-top">
        <div className="bp-brand"><div className="bp-logo">RPOS</div><div><strong>نظام تشغيل المطعم</strong><div className="bp-muted">Restaurant Operating System</div></div></div>
        <div className="bp-actions"><span className="bp-pill">معاينة تجريبية — بيانات وهمية</span><button className="bp-btn" onClick={() => setNight(v => !v)}>{night ? 'الوضع النهاري' : 'الوضع الليلي'}</button></div>
      </header>
      <div className="bp-layout">
        <nav className="bp-nav" aria-label="مساحات العمل">{areas.map(item => <button key={item.id} className={area === item.id ? 'active' : ''} onClick={() => { setArea(item.id); setNotice(''); }}>{item.title}<div className="bp-muted">{item.sub}</div></button>)}</nav>
        <section className="bp-content">
          <div className="bp-heading"><div><h1>{selected.title}</h1><div className="bp-muted">{selected.sub} · فرع تجريبي · POS-01</div></div><span className="bp-tag">DEMO MODE</span></div>
          {notice && <div className="bp-notice">{notice}</div>}
          {area === 'POS' && <><div className="bp-grid">
            <div className="bp-card"><div className="bp-muted">حالة الوردية</div><div className="bp-kpi" style={{fontSize:18}}>{shiftOpen ? 'مفتوحة' : 'مغلقة'}</div><button className="bp-btn" onClick={() => {setShiftOpen(v=>!v);demoAction(shiftOpen?'تم إغلاق الوردية تجريبيًا':'تم فتح الوردية تجريبيًا')}}>{shiftOpen?'إغلاق تجريبي':'فتح الوردية'}</button></div>
            <div className="bp-card"><div className="bp-muted">إجمالي السلة</div><div className="bp-kpi">{money(total)}</div></div>
            <div className="bp-card"><div className="bp-muted">عدد الأصناف</div><div className="bp-kpi">{cartItems.reduce((s,p)=>s+p.qty,0)}</div></div>
            <div className="bp-card"><div className="bp-muted">الطلبات اليوم</div><div className="bp-kpi">42</div></div>
          </div><div className="bp-two"><div className="bp-panel"><div className="bp-row"><strong>قائمة المنتجات</strong><span className="bp-muted">اضغط على المنتج لإضافته</span></div><input className="bp-input" placeholder="ابحث عن منتج..." value={search} onChange={e=>setSearch(e.target.value)}/><div style={{display:'flex',gap:7,flexWrap:'wrap',marginBottom:12}}>{['الكل','وجبات','إضافات','مشروبات'].map(c=><button key={c} className="bp-btn" onClick={()=>setCategory(c)}>{c}</button>)}</div><div className="bp-products">{visible.map(p=><button className="bp-product" key={p.id} onClick={()=>add(p.id)}><span>{p.category}</span><strong>{p.name}</strong><b>{money(p.price)}</b></button>)}</div></div>
          <div className="bp-panel"><div className="bp-row"><strong>الطلب الحالي</strong><span className="bp-muted">تيك أواي</span></div>{cartItems.length===0?<div className="bp-empty">السلة فارغة — اختر منتجًا للبدء</div>:cartItems.map(p=><div className="bp-row" key={p.id}><div><strong>{p.name}</strong><div className="bp-muted">{money(p.price)} × {p.qty}</div></div><div style={{display:'flex',gap:5,alignItems:'center'}}><button className="bp-btn" onClick={()=>change(p.id,-1)}>−</button><b>{p.qty}</b><button className="bp-btn" onClick={()=>add(p.id)}>+</button></div></div>)}<div className="bp-row"><strong>الإجمالي</strong><strong>{money(total)}</strong></div><button className="bp-primary" style={{width:'100%'}} disabled={!cartItems.length||!shiftOpen} onClick={()=>{demoAction('تم تسجيل عملية بيع تجريبية');setCart({})}}>تحصيل ودفع تجريبي</button></div></div></>}
          {area === 'KITCHEN' && <div className="bp-grid">{tickets.map((id,i)=><div className="bp-card" key={id}><div className="bp-row"><strong>طلب {id}</strong><span className="bp-tag">{i===0?'جديد':'قيد التجهيز'}</span></div><p>برجر كلاسيك × 1</p><p>بطاطس × 1</p><div className="bp-muted">منذ {i+3} دقائق · محطة المطبخ</div><button className="bp-primary" style={{marginTop:12}} onClick={()=>{setTickets(old=>old.filter(x=>x!==id));demoAction('تم إنهاء التذكرة '+id)}}>إنهاء التذكرة</button></div>)}</div>}
          {(area==='CALL_CENTER'||area==='DISPATCH') && <div className="bp-panel"><div className="bp-row"><strong>{area==='CALL_CENTER'?'طلبات العملاء':'قائمة التوصيل'}</strong><button className="bp-primary" onClick={()=>demoAction('تم إنشاء طلب تجريبي')}>طلب جديد +</button></div><table className="bp-table"><thead><tr><th>رقم الطلب</th><th>النوع</th><th>الحالة</th><th>الإجمالي</th><th>إجراء</th></tr></thead><tbody>{orders.map(o=><tr key={o[0]}>{o.map((v,i)=><td key={i}>{v}</td>)}<td><button className="bp-btn" onClick={()=>demoAction('تم تحديث '+o[0])}>تحديث</button></td></tr>)}</tbody></table></div>}
          {area==='INVENTORY' && <><div className="bp-grid"><div className="bp-card"><div className="bp-muted">أصناف المخزون</div><div className="bp-kpi">128</div></div><div className="bp-card"><div className="bp-muted">نواقص</div><div className="bp-kpi">7</div></div><div className="bp-card"><div className="bp-muted">قيمة المخزون</div><div className="bp-kpi">84,250</div></div><div className="bp-card"><div className="bp-muted">طلبات توريد</div><div className="bp-kpi">3</div></div></div><div className="bp-panel"><div className="bp-row"><strong>الأصناف</strong><button className="bp-primary" onClick={()=>demoAction('إضافة صنف تجريبي')}>إضافة صنف</button></div><table className="bp-table"><thead><tr><th>الصنف</th><th>الوحدة</th><th>الرصيد</th><th>حد الطلب</th><th>الحالة</th></tr></thead><tbody>{[['صدور فراخ','كجم','24','10','متاح'],['زيت','لتر','6','8','منخفض'],['خبز برجر','قطعة','90','30','متاح'],['جبنة شيدر','كجم','4','5','منخفض']].map(r=><tr key={r[0]}>{r.map(v=><td key={v}>{v}</td>)}</tr>)}</tbody></table></div></>}
          {area==='ACCOUNTING' && <><div className="bp-grid">{[['إيراد اليوم','18,450 ج.م'],['مصروفات اليوم','3,280 ج.م'],['صافي الحركة','15,170 ج.م'],['فواتير معلقة','4']].map(r=><div className="bp-card" key={r[0]}><div className="bp-muted">{r[0]}</div><div className="bp-kpi">{r[1]}</div></div>)}</div><div className="bp-panel"><strong>آخر الحركات المالية</strong><table className="bp-table"><thead><tr><th>البيان</th><th>التصنيف</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>{[['مبيعات الوردية','إيراد','12,500','اليوم'],['شراء خامات','مصروف','2,300','اليوم'],['مبيعات دليفري','إيراد','5,950','اليوم']].map(r=><tr key={r[0]}>{r.map(v=><td key={v}>{v}</td>)}</tr>)}</tbody></table></div></>}
          {area==='HR' && <><div className="bp-grid">{[['الموظفون','26'],['حضور اليوم','22'],['متأخرون','2'],['إجازات','2']].map(r=><div className="bp-card" key={r[0]}><div className="bp-muted">{r[0]}</div><div className="bp-kpi">{r[1]}</div></div>)}</div><div className="bp-panel"><div className="bp-row"><strong>الموظفون والحضور</strong><button className="bp-primary" onClick={()=>demoAction('إضافة موظف تجريبي')}>إضافة موظف</button></div><table className="bp-table"><thead><tr><th>الاسم</th><th>القسم</th><th>بداية الوردية</th><th>الحالة</th></tr></thead><tbody>{[['محمد أحمد','كاشير','09:00','حاضر'],['سارة محمود','خدمة عملاء','10:00','حاضر'],['أحمد علي','مطبخ','09:30','متأخر']].map(r=><tr key={r[0]}>{r.map(v=><td key={v}>{v}</td>)}</tr>)}</tbody></table></div></>}
          {area==='MANAGEMENT' && <><div className="bp-grid">{[['إجمالي المبيعات','52,840 ج.م'],['الطلبات','186'],['متوسط الطلب','284 ج.م'],['الفروع النشطة','3']].map(r=><div className="bp-card" key={r[0]}><div className="bp-muted">{r[0]}</div><div className="bp-kpi">{r[1]}</div></div>)}</div><div className="bp-panel"><strong>أداء الفروع</strong><table className="bp-table"><thead><tr><th>الفرع</th><th>الطلبات</th><th>المبيعات</th><th>الحالة</th></tr></thead><tbody>{[['الفرع الرئيسي','92','28,400','نشط'],['فرع شبين','58','16,200','نشط'],['فرع قويسنا','36','8,240','نشط']].map(r=><tr key={r[0]}>{r.map(v=><td key={v}>{v}</td>)}</tr>)}</tbody></table></div></>}
          {area==='SETTINGS' && <div className="bp-panel"><strong>إعدادات التشغيل</strong>{[['بيانات الفرع','الفرع الرئيسي · branch-01'],['الجهاز','POS-01 · متصل تجريبيًا'],['الطابعات','مطبخ · كاشير'],['المزامنة','وضع المعاينة — غير متصل بقاعدة البيانات']].map(r=><div className="bp-row" key={r[0]}><strong>{r[0]}</strong><span className="bp-muted">{r[1]}</span></div>)}<button className="bp-primary" onClick={()=>demoAction('تم حفظ إعدادات العرض التجريبي')}>حفظ تجريبي</button></div>}
          <div className="bp-muted" style={{textAlign:'center',padding:12}}>هذه بيئة استعراض للواجهات فقط. لا تستخدم بيانات حقيقية ولا تنفّذ عمليات على قاعدة البيانات.</div>
        </section>
      </div>
    </div>
  </main>;
}
