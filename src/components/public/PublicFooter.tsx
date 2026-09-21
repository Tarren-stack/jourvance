import React from 'react';
import { Layers, Globe, Shield, Sparkles, CheckCircle2 } from 'lucide-react';

interface PublicFooterProps {
  onNavigate: (page: 'home' | 'about' | 'blog' | 'contact' | 'canvas') => void;
}

export const PublicFooter: React.FC<PublicFooterProps> = ({ onNavigate }) => {
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
            gridTemplateColumns: '2fr 1fr 1fr 1fr',
            gap: '3rem',
            marginBottom: '3rem'
          }}
        >
          {/* Brand Col */}
          <div>
            <div
              onClick={() => onNavigate('home')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                cursor: 'pointer',
                marginBottom: '1rem'
              }}
            >
              <div
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
              </div>
              <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#F8FAFC', letterSpacing: '-0.02em' }}>
                Jourvance
              </span>
            </div>

            <p style={{ fontSize: '0.875rem', lineHeight: '1.6', color: '#64748B', maxWidth: '340px' }}>
              The universal customer journey & conversion flow platform. Connect ad campaigns, single-offer landers,
              intake forms, and follow-up nurture sequences on an interactive visual canvas.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1.25rem' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.75rem',
                  color: '#10B981',
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '9999px',
                  border: '1px solid rgba(16, 185, 129, 0.25)'
                }}
              >
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10B981' }}></span>
                jourvance.com Registered & Active
              </span>
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#E2E8F0', marginBottom: '1rem' }}>
              Product
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.875rem' }}>
              <li>
                <button onClick={() => onNavigate('canvas')} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                  Interactive Canvas Studio
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('home')} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                  Lead Capture Blueprint
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('home')} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                  Live Funnel Simulator
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('home')} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                  Pricing Plans
                </button>
              </li>
            </ul>
          </div>

          {/* Company Links */}
          <div>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#E2E8F0', marginBottom: '1rem' }}>
              Company
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.875rem' }}>
              <li>
                <button onClick={() => onNavigate('about')} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                  About Us
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('blog')} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                  Conversion Blog
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('contact')} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                  Contact & Support
                </button>
              </li>
              <li>
                <a href="mailto:support@jourvance.com" style={{ color: '#94A3B8', textDecoration: 'none' }}>
                  support@jourvance.com
                </a>
              </li>
            </ul>
          </div>

          {/* Infrastructure / Security */}
          <div>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#E2E8F0', marginBottom: '1rem' }}>
              Architecture
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.875rem' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748B' }}>
                <CheckCircle2 style={{ width: '14px', height: '14px', color: '#6366F1' }} />
                <span>Zero Server Bloat</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748B' }}>
                <CheckCircle2 style={{ width: '14px', height: '14px', color: '#6366F1' }} />
                <span>Hub Brain RAG AI</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748B' }}>
                <CheckCircle2 style={{ width: '14px', height: '14px', color: '#6366F1' }} />
                <span>WHOIS Protected</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748B' }}>
                <CheckCircle2 style={{ width: '14px', height: '14px', color: '#6366F1' }} />
                <span>Fails Open Locally</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom copyright line */}
        <div
          style={{
            paddingTop: '2rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.8rem',
            color: '#64748B'
          }}
        >
          <div>
            © {new Date().getFullYear()} Jourvance (jourvance.com). All rights reserved. A Zelus Labs portfolio spoke.
          </div>
          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <span>Privacy Policy</span>
            <span>Terms of Service</span>
            <span>Security Sentinel Active</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
