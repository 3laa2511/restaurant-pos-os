import type { CSSProperties, ReactNode } from 'react';

export function WorkspaceShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main style={{ minHeight: '100vh', background: '#090d12', color: '#e8edf5', fontFamily: 'Inter, system-ui, sans-serif', padding: 24, direction: 'rtl' }}>
    <section style={{ width: '100%', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, color: '#7b8896', marginBottom: 8 }}>RESTAURANT POS OS / WORKSPACE</div>
        <h1 style={{ margin: 0 }}>{title}</h1>
        <p style={{ color: '#9ca8b5', lineHeight: 1.8, marginBottom: 0 }}>{description}</p>
      </div>
      {children}
    </section>
  </main>;
}

export function DataTable({ headers, rows }: { headers: string[]; rows: Array<ReactNode[]> }) {
  return <div style={{ overflowX: 'auto', border: '1px solid #26313d', borderRadius: 14, background: '#0e141b' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr>{headers.map((header) => <th key={header} style={{ textAlign: 'right', padding: 13, borderBottom: '1px solid #26313d', color: '#8e9baa' }}>{header}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} style={{ padding: 13, borderBottom: '1px solid #1b252f' }}>{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

export const fieldStyle: CSSProperties = {
  width: '100%', minWidth: 0, boxSizing: 'border-box', border: '1px solid #334150',
  borderRadius: 9, padding: '10px 12px', background: '#111820', color: '#e8edf5',
};

export const actionStyle: CSSProperties = {
  border: '1px solid #334150', borderRadius: 9, padding: '9px 13px',
  background: '#172331', color: '#e8edf5', cursor: 'pointer',
};
