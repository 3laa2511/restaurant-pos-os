import { useMemo, useState } from 'react';
import './styles.css';
import { categories, demoProducts, searchProducts } from './pos/catalog.js';
import { addProduct, calculateCart, emptyCart, removeProduct, setQuantity } from './pos/cart.js';
import type { CartState } from './pos/types.js';

const money = (value: number) => `${value.toFixed(2)} ج.م`;

export function App() {
  const [cart, setCart] = useState<CartState>(emptyCart());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const products = useMemo(() => searchProducts(demoProducts, query, category), [query, category]);
  const totals = calculateCart(cart);
  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <main dir="rtl" className="pos-shell">
      <header className="topbar"><div className="brand"><strong>Restaurant POS</strong><span>الفرع · POS-01</span></div><div className="connection"><i /> متصل</div></header>
      <section className="workspace">
        <aside className="cart-panel">
          <div className="panel-title"><h2>الأوردر الحالي</h2><span>{itemCount} أصناف</span></div>
          {cart.items.length === 0 ? <div className="empty">ابدأ بإضافة المنتجات إلى الأوردر</div> : <div className="cart-items">{cart.items.map((item) => <article className="cart-item" key={item.product.id}><div><strong>{item.product.nameAr}</strong><small>{money(item.product.price)}</small></div><div className="qty"><button onClick={() => setQuantity(cart, item.product.id, item.quantity - 1) && setCart(setQuantity(cart, item.product.id, item.quantity - 1))}>−</button><b>{item.quantity}</b><button onClick={() => setCart(setQuantity(cart, item.product.id, item.quantity + 1))}>+</button><button className="remove" onClick={() => setCart(removeProduct(cart, item.product.id))}>×</button></div></article>)}</div>}
          <div className="summary"><div><span>الإجمالي الفرعي</span><b>{money(totals.subtotal)}</b></div><div><span>الخصم</span><b>{money(totals.discount)}</b></div><div className="grand"><span>الإجمالي</span><b>{money(totals.total)}</b></div><button disabled={!cart.items.length}>الدفع والتأكيد</button></div>
        </aside>
        <section className="menu-panel"><div className="menu-head"><div><h1>قائمة المنتجات</h1><p>اضغط على المنتج لإضافته للأوردر</p></div><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث عن منتج أو SKU" /></div><nav className="categories">{categories.map((item) => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.name}</button>)}</nav><div className="products">{products.map((product) => <button className="product-card" key={product.id} onClick={() => setCart(addProduct(cart, product))}><strong>{product.nameAr}</strong><small>{product.nameEn}</small><b>{money(product.price)}</b></button>)}{!products.length && <div className="empty-products">لا توجد منتجات مطابقة</div>}</div></section>
      </section>
    </main>
  );
}
