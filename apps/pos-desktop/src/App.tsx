import './styles.css';

export function App() {
  return (
    <main dir="rtl" className="pos-shell">
      <header className="topbar">
        <div className="brand"><strong>Restaurant POS</strong><span>الفرع · POS-01</span></div>
        <div className="connection"><i /> متصل</div>
      </header>
      <section className="workspace">
        <aside className="cart-panel">
          <div className="panel-title"><h2>الأوردر الحالي</h2><span>0 أصناف</span></div>
          <div className="empty">ابدأ بإضافة المنتجات إلى الأوردر</div>
          <div className="summary">
            <div><span>الإجمالي الفرعي</span><b>0.00 ج.م</b></div>
            <div><span>الخصم</span><b>0.00 ج.م</b></div>
            <div className="grand"><span>الإجمالي</span><b>0.00 ج.م</b></div>
            <button disabled>الدفع والتأكيد</button>
          </div>
        </aside>
        <section className="menu-panel">
          <div className="menu-head"><div><h1>قائمة المنتجات</h1><p>اختر المنتج لإضافته للأوردر</p></div><input placeholder="ابحث عن منتج أو SKU" /></div>
          <nav className="categories"><button className="active">الكل</button><button>برجر</button><button>وجبات</button><button>إضافات</button><button>مشروبات</button></nav>
          <div className="products"><div className="empty-products">سيتم تحميل المنتجات من الـLocal Store</div></div>
        </section>
      </section>
    </main>
  );
}
