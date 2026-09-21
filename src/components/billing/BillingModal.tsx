import React, { useState } from 'react';
import { X, CheckCircle2, Zap, Sparkles, Shield, ArrowRight } from 'lucide-react';

interface BillingModalProps {
  onClose: () => void;
  onUpgradeSuccess?: () => void;
  userEmail?: string;
}

export const BillingModal: React.FC<BillingModalProps> = ({
  onClose,
  onUpgradeSuccess,
  userEmail
}) => {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState(false);
  const [upgraded, setUpgraded] = useState(false);

  const handleUpgrade = () => {
    setLoading(true);
    // Simulate instantaneous upgrade or stripe session initialization
    setTimeout(() => {
      setLoading(false);
      setUpgraded(true);
      localStorage.setItem('jourvance_plan', 'pro');
      setTimeout(() => {
        onUpgradeSuccess?.();
        onClose();
      }, 1500);
    }, 1000);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        color: '#F8FAFC'
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '680px',
          backgroundColor: '#111827',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 30px rgba(99, 102, 241, 0.25)',
          padding: '2.5rem',
          position: 'relative'
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1.25rem',
            right: '1.25rem',
            background: 'none',
            border: 'none',
            color: '#94A3B8',
            cursor: 'pointer',
            padding: '4px'
          }}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {upgraded ? (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.5rem'
              }}
            >
              <CheckCircle2 size={32} color="#10B981" />
            </div>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '0.5rem' }}>
              Welcome to Jourvance Growth Pro!
            </h2>
            <p style={{ fontSize: '0.95rem', color: '#94A3B8' }}>
              Your account has been upgraded. Unlimited funnels and AI copywriter are now active.
            </p>
          </div>
        ) : (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.2rem 0.65rem',
                  borderRadius: '9999px',
                  backgroundColor: 'rgba(99, 102, 241, 0.15)',
                  color: '#818CF8',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  marginBottom: '0.75rem'
                }}
              >
                <Sparkles size={12} />
                <span>Zero Lead Caps • Zero Transaction Fees</span>
              </div>
              <h2 style={{ fontSize: '1.75rem', fontWeight: 900, color: '#FFFFFF', letterSpacing: '-0.02em' }}>
                Upgrade to Jourvance Growth Pro
              </h2>
              <p style={{ fontSize: '0.9rem', color: '#94A3B8', marginTop: '0.35rem' }}>
                Scale your client acquisition pipeline without paying extra per lead.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
              {/* Free Plan */}
              <div style={{ backgroundColor: '#1E293B', borderRadius: '12px', padding: '1.5rem', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase' }}>Current Plan</span>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', marginTop: '0.2rem' }}>Free Sandbox</h3>
                <div style={{ margin: '1rem 0' }}>
                  <span style={{ fontSize: '2rem', fontWeight: 900, color: '#FFFFFF' }}>$0</span>
                  <span style={{ fontSize: '0.8rem', color: '#64748B' }}> / forever</span>
                </div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem', color: '#94A3B8' }}>
                  <li>✓ 1 Active Visual Journey</li>
                  <li>✓ Turnkey Lead Blueprint</li>
                  <li>✓ Live Funnel Simulator</li>
                  <li>✕ AI Copywriter Generation</li>
                  <li>✕ Custom Domain Publishing</li>
                </ul>
              </div>

              {/* Growth Pro Plan */}
              <div style={{ backgroundColor: '#1E293B', borderRadius: '12px', padding: '1.5rem', border: '2px solid #6366F1', position: 'relative' }}>
                <div style={{ position: 'absolute', top: '-10px', right: '15px', backgroundColor: '#6366F1', color: '#FFFFFF', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', padding: '0.15rem 0.5rem', borderRadius: '9999px' }}>
                  Recommended
                </div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#818CF8', textTransform: 'uppercase' }}>Unlimited Growth</span>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', marginTop: '0.2rem' }}>Growth Pro</h3>
                <div style={{ margin: '1rem 0' }}>
                  <span style={{ fontSize: '2rem', fontWeight: 900, color: '#FFFFFF' }}>$49</span>
                  <span style={{ fontSize: '0.8rem', color: '#94A3B8' }}> / month</span>
                </div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem', color: '#F1F5F9' }}>
                  <li>✓ Unlimited Customer Journeys</li>
                  <li>✓ Hub Brain AI Copywriter (High converting ad & email copy)</li>
                  <li>✓ Custom Domain Publishing (jourvance.com/p/:slug)</li>
                  <li>✓ Zero Lead Caps or Platform Fees</li>
                </ul>
              </div>
            </div>

            <button
              onClick={handleUpgrade}
              disabled={loading}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.85rem',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '0.95rem',
                fontWeight: 800,
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)'
              }}
            >
              <span>{loading ? 'Activating Growth Pro…' : 'Activate Growth Pro ($49/mo)'}</span>
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
