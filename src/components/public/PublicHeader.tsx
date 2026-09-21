import React, { useState } from 'react';
import { Layers, ArrowRight, Play, User as UserIcon, LogOut, ShieldCheck, Zap, ChevronDown } from 'lucide-react';
import type { User } from '../../lib/firebase';
import { isOperator } from '../../lib/firebase';

interface PublicHeaderProps {
  activePage: 'home' | 'about' | 'blog' | 'contact' | 'canvas';
  onNavigate: (page: 'home' | 'about' | 'blog' | 'contact' | 'canvas') => void;
  onTestJourney: () => void;
  user: User | null;
  onOpenAuth: () => void;
  onOpenBilling: () => void;
  onOpenAdmin?: () => void;
  onSignOut: () => void;
}

export const PublicHeader: React.FC<PublicHeaderProps> = ({
  activePage,
  onNavigate,
  onTestJourney,
  user,
  onOpenAuth,
  onOpenBilling,
  onOpenAdmin,
  onSignOut
}) => {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const operator = isOperator(user);

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backgroundColor: 'rgba(11, 15, 25, 0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        padding: '0 2rem',
        height: '68px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}
    >
      {/* Brand Logo */}
      <div
        onClick={() => onNavigate('home')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #6366F1 0%, #4338CA 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 16px rgba(99, 102, 241, 0.35)',
            border: '1px solid rgba(255, 255, 255, 0.2)'
          }}
        >
          <Layers style={{ width: '20px', height: '20px', color: '#ffffff' }} />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#F8FAFC' }}>
              Jourvance
            </span>
            <span
              style={{
                fontSize: '0.65rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                padding: '0.15rem 0.4rem',
                borderRadius: '4px',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                color: '#818CF8',
                border: '1px solid rgba(99, 102, 241, 0.3)'
              }}
            >
              Pro
            </span>
          </div>
          <span style={{ fontSize: '0.7rem', color: '#64748B', display: 'block', marginTop: '-2px' }}>
            jourvance.com
          </span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button
          onClick={() => onNavigate('home')}
          style={{
            background: activePage === 'home' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
            color: activePage === 'home' ? '#F8FAFC' : '#94A3B8',
            border: 'none',
            padding: '0.5rem 0.85rem',
            borderRadius: '8px',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          Home
        </button>

        <button
          onClick={() => onNavigate('about')}
          style={{
            background: activePage === 'about' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
            color: activePage === 'about' ? '#F8FAFC' : '#94A3B8',
            border: 'none',
            padding: '0.5rem 0.85rem',
            borderRadius: '8px',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          About
        </button>

        <button
          onClick={() => onNavigate('blog')}
          style={{
            background: activePage === 'blog' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
            color: activePage === 'blog' ? '#F8FAFC' : '#94A3B8',
            border: 'none',
            padding: '0.5rem 0.85rem',
            borderRadius: '8px',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          Blog
        </button>

        <button
          onClick={() => onNavigate('contact')}
          style={{
            background: activePage === 'contact' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
            color: activePage === 'contact' ? '#F8FAFC' : '#94A3B8',
            border: 'none',
            padding: '0.5rem 0.85rem',
            borderRadius: '8px',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          Contact
        </button>

        <button
          onClick={onOpenBilling}
          style={{
            background: 'transparent',
            color: '#818CF8',
            border: 'none',
            padding: '0.5rem 0.85rem',
            borderRadius: '8px',
            fontSize: '0.875rem',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem'
          }}
        >
          <Zap size={14} color="#818CF8" />
          <span>Pricing</span>
        </button>
      </nav>

      {/* Action Buttons & Auth */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
          onClick={onTestJourney}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            padding: '0.5rem 0.85rem',
            borderRadius: '8px',
            backgroundColor: 'rgba(30, 41, 59, 0.8)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#CBD5E1',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(51, 65, 85, 0.9)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'rgba(30, 41, 59, 0.8)')}
        >
          <Play style={{ width: '14px', height: '14px', color: '#38BDF8' }} />
          <span>Live Simulator</span>
        </button>

        <button
          onClick={() => onNavigate('canvas')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.55rem 1.15rem',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#ffffff',
            fontSize: '0.875rem',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(99, 102, 241, 0.35)',
            transition: 'all 0.2s ease'
          }}
        >
          <span>Studio Canvas</span>
          <ArrowRight style={{ width: '15px', height: '15px' }} />
        </button>

        {/* User Account / Sign In */}
        {user ? (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.4rem 0.75rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(30, 41, 59, 0.9)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#FFFFFF',
                fontSize: '0.825rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  backgroundColor: operator ? '#10B981' : '#6366F1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 700
                }}
              >
                {user.email ? user.email[0].toUpperCase() : 'U'}
              </div>
              <span style={{ maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.displayName || user.email?.split('@')[0]}
              </span>
              <ChevronDown size={13} color="#94A3B8" />
            </button>

            {showUserMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: '42px',
                  right: 0,
                  width: '210px',
                  backgroundColor: '#1E293B',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
                  padding: '6px',
                  zIndex: 60
                }}
              >
                <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', marginBottom: '4px' }}>
                  <div style={{ fontSize: '11px', color: '#94A3B8' }}>Signed in as</div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user.email}
                  </div>
                </div>

                {operator && (
                  <button
                    onClick={() => { setShowUserMenu(false); onOpenAdmin?.(); }}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: 'none',
                      border: 'none',
                      color: '#34D399',
                      fontSize: '12px',
                      fontWeight: 700,
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <ShieldCheck size={14} />
                    <span>Operator Admin</span>
                  </button>
                )}

                <button
                  onClick={() => { setShowUserMenu(false); onOpenBilling(); }}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: 'none',
                    border: 'none',
                    color: '#CBD5E1',
                    fontSize: '12px',
                    fontWeight: 500,
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <Zap size={14} color="#818CF8" />
                  <span>Subscription Plan</span>
                </button>

                <button
                  onClick={() => { setShowUserMenu(false); onSignOut(); }}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: 'none',
                    border: 'none',
                    color: '#F87171',
                    fontSize: '12px',
                    fontWeight: 500,
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <LogOut size={14} />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={onOpenAuth}
            style={{
              padding: '0.5rem 0.95rem',
              borderRadius: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#FFFFFF',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Sign In
          </button>
        )}
      </div>
    </header>
  );
};
