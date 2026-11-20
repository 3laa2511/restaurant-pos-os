import type { CSSProperties, ReactNode } from 'react';
import './shared.css';

export function WorkspaceShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="workspace-shell" lang="ar" dir="rtl">
      <section className="workspace-shell__inner">
        <header className="workspace-shell__header">
          <div>
            <p className="workspace-shell__eyebrow">RESTAURANT POS OS / WORKSPACE</p>
            <h1>{title}</h1>
            <p className="workspace-shell__description">{description}</p>
          </div>
        </header>
        <div className="workspace-shell__content">{children}</div>
      </section>
    </main>
  );
}

export function DataTable({ headers, rows }: { headers: string[]; rows: Array<ReactNode[]> }) {
  return (
    <div className="workspace-data-table">
      <table>
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export const fieldStyle: CSSProperties = {
  width: '100%', minWidth: 0, boxSizing: 'border-box',
  border: '1px solid var(--rpos-border)', borderRadius: 9,
  padding: '10px 12px', background: 'var(--rpos-surface)', color: 'var(--rpos-text)',
};

export const actionStyle: CSSProperties = {
  border: '1px solid var(--rpos-border)', borderRadius: 9, padding: '9px 13px',
  background: 'var(--rpos-primary)', color: '#fff', cursor: 'pointer',
};
