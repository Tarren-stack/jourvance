import type React from 'react';

export const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: 16
};

export const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#9ca3af',
  textTransform: 'uppercase',
  letterSpacing: '0.04em'
};

export const field: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(0,0,0,0.35)',
  color: '#f3f4f6',
  fontSize: 13
};

export const ghostBtn: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'transparent',
  color: '#e5e7eb',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600
};

export const solidBtn: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid rgba(236,72,153,0.4)',
  background: 'rgba(236,72,153,0.18)',
  color: '#f9a8d4',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 700
};

export async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}
