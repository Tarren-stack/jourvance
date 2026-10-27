import React from 'react';
import { Layers } from 'lucide-react';
import { VIEW_LABEL } from '../../lib/studioLabels';

interface PublicFooterProps {
  onNavigate: (page: 'home' | 'about' | 'blog' | 'contact' | 'canvas') => void;
  onOpenBilling: () => void;
}

const linkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#94A3B8',
  cursor: 'pointer',
  textAlign: 'left',
  padding: 0,
  font: 'inherit'
};

export const PublicFooter: React.FC<PublicFooterProps> = ({ onNavigate, onOpenBilling }) => {
  return (
    <footer
      style={{
        backgroundColor: '#070A12',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        padding: '3.5rem 2rem 2.5rem',
        color: '#94A3B8'
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
            gap: '3rem',
            marginBottom: '3rem'
          }}
        >
          <div>
            <button
              type="button"
              onClick={() => onNavigate('home')}
              style={{ ...linkStyle, display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', color: '#F8FAFC' }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #6366F1 0%, #4338CA 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Layers style={{ width: '18px', height: '18px', color: '#ffffff' }} />
              </span>
              <span style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                Jourvance home
              </span>
            </button>

            <p style={{ fontSize: '0.875rem', lineHeight: '1.6', color: '#94A3B8', maxWidth: '340px' }}>
              Built from hands-on marketing experience to help you plan, create, and grow.
            </p>
          </div>

          <div>
            <h2 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#E2E8F0', margin: '0 0 1rem' }}>
              Product
            </h2>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.875rem', margin: 0, padding: 0 }}>
              <li>
                <button type="button" onClick={() => onNavigate('canvas')} style={linkStyle}>
                  {VIEW_LABEL.canvas}
                </button>
              </li>
              <li>
                <button type="button" onClick={onOpenBilling} style={linkStyle}>
                  Pricing
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h2 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#E2E8F0', margin: '0 0 1rem' }}>
              Company
            </h2>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.875rem', margin: 0, padding: 0 }}>
              <li>
                <button type="button" onClick={() => onNavigate('about')} style={linkStyle}>
                  About
                </button>
              </li>
              <li>
                <button type="button" onClick={() => onNavigate('blog')} style={linkStyle}>
                  Blog
                </button>
              </li>
              <li>
                <button type="button" onClick={() => onNavigate('contact')} style={linkStyle}>
                  Contact
                </button>
              </li>
              <li>
                <a href="mailto:support@jourvance.com" style={{ color: '#94A3B8', textDecoration: 'none', overflowWrap: 'anywhere' }}>
                  Email support@jourvance.com
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div
          style={{
            paddingTop: '2rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            fontSize: '0.8rem',
            color: '#64748B'
          }}
        >
          © {new Date().getFullYear()} Jourvance (jourvance.com). All rights reserved. A Zelus Labs portfolio spoke.
        </div>
      </div>
    </footer>
  );
};
