import React, { useState } from 'react';
import { X, CheckCircle2, Sparkles, ArrowRight, Store, Mail } from 'lucide-react';
import { ModalDialog } from '../modals/ModalDialog';
import { useFieldIds } from '../../lib/a11yHooks';
import { authHeaders } from '../../lib/firebase';

interface BillingModalProps {
  onClose: () => void;
  onUpgradeSuccess?: () => void;
  userEmail?: string;
}

// Names the dialog: ModalDialog's aria-labelledby points at the visible heading.
const TITLE_ID = 'jv-billing-title';

export const BillingModal: React.FC<BillingModalProps> = ({
  onClose,
  userEmail
}) => {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [email, setEmail] = useState<string>(userEmail || '');
  const [storeDomain, setStoreDomain] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fid = useFieldIds();

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          email: cleanEmail,
          storeDomain: storeDomain.trim(),
          billingCycle
        })
      });

      const data = await res.json();
      if (res.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      setErrorMsg(data.error || 'Checkout did not start. Try again.');
    } catch {
      setErrorMsg('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog bare labelledBy={TITLE_ID} onClose={onClose} maxWidth={720} fallbackFocusSelectors={['#journey-map']}>
      <div
        style={{
          width: '100%',
          maxWidth: '720px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#111827',
          borderRadius: '20px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 35px rgba(99, 102, 241, 0.22)',
          padding: '2.5rem',
          position: 'relative',
          color: '#F8FAFC'
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1.25rem',
            right: '1.25rem',
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '9999px',
            color: '#94A3B8',
            cursor: 'pointer',
            padding: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        {/* Modal Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.25rem 0.75rem',
              borderRadius: '9999px',
              backgroundColor: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              color: '#818CF8',
              fontSize: '0.75rem',
              fontWeight: 700,
              marginBottom: '0.75rem'
            }}
          >
            <Sparkles size={12} />
            <span>Zero Lead Caps • Zero Transaction Fees</span>
          </div>
          <h2 id={TITLE_ID} style={{ fontSize: '1.85rem', fontWeight: 900, color: '#FFFFFF', letterSpacing: '-0.02em', margin: 0 }}>
            Jourvance Growth Pro
          </h2>
          <p style={{ fontSize: '0.9rem', color: '#94A3B8', marginTop: '0.4rem' }}>
            Scale your customer acquisition pipeline with automated drips and multi-store intelligence.
          </p>

          {/* Billing Cycle Switcher */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              backgroundColor: '#1E293B',
              borderRadius: '9999px',
              padding: '0.25rem',
              marginTop: '1.25rem',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <button
              type="button"
              onClick={() => setBillingCycle('monthly')}
              style={{
                padding: '0.4rem 1rem',
                borderRadius: '9999px',
                border: 'none',
                backgroundColor: billingCycle === 'monthly' ? '#6366F1' : 'transparent',
                color: '#FFFFFF',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('annual')}
              style={{
                padding: '0.4rem 1rem',
                borderRadius: '9999px',
                border: 'none',
                backgroundColor: billingCycle === 'annual' ? '#6366F1' : 'transparent',
                color: '#FFFFFF',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}
            >
              <span>Annual</span>
              <span
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  backgroundColor: '#10B981',
                  color: '#FFFFFF',
                  padding: '0.1rem 0.45rem',
                  borderRadius: '9999px'
                }}
              >
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards Comparison */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
          {/* Starter Plan */}
          <div style={{ backgroundColor: '#1E293B', borderRadius: '14px', padding: '1.5rem', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Plan</span>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', marginTop: '0.2rem' }}>Starter Studio</h3>
            <div style={{ margin: '0.75rem 0' }}>
              <span style={{ fontSize: '2.25rem', fontWeight: 900, color: '#FFFFFF' }}>$0</span>
              <span style={{ fontSize: '0.8rem', color: '#64748B' }}> / forever</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem', color: '#94A3B8' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={14} color="#10B981" />
                <span>1 Active Customer Journey</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={14} color="#10B981" />
                <span>Turnkey Lead Funnel Blueprint</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={14} color="#10B981" />
                <span>Real-Time Node Canvas</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748B' }}>
                <span>✕ Automated 24/7 Drips & Recovery</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#64748B' }}>
                <span>✕ Multi-Store Shopify Sync</span>
              </li>
            </ul>
          </div>

          {/* Growth Pro Plan */}
          <div style={{ backgroundColor: '#1E293B', borderRadius: '14px', padding: '1.5rem', border: '2px solid #6366F1', position: 'relative', boxShadow: '0 8px 24px rgba(99, 102, 241, 0.2)' }}>
            <div style={{ position: 'absolute', top: '-11px', right: '16px', backgroundColor: '#6366F1', color: '#FFFFFF', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', padding: '0.2rem 0.6rem', borderRadius: '9999px', letterSpacing: '0.05em' }}>
              Most Popular
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#818CF8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scaling Stores</span>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', marginTop: '0.2rem' }}>Growth Pro</h3>
            <div style={{ margin: '0.75rem 0' }}>
              <span style={{ fontSize: '2.25rem', fontWeight: 900, color: '#FFFFFF' }}>
                {billingCycle === 'monthly' ? '$49' : '$39'}
              </span>
              <span style={{ fontSize: '0.8rem', color: '#94A3B8' }}>
                {billingCycle === 'monthly' ? ' / month' : ' / mo (billed annually)'}
              </span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem', color: '#F1F5F9' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={14} color="#10B981" />
                <span>Unlimited Customer Journeys</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={14} color="#10B981" />
                <span>24/7 Automated Drips & Cart Recovery</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={14} color="#10B981" />
                <span>Multi-Store Shopify Attribution</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={14} color="#10B981" />
                <span>Hub Brain AI Copywriting Assistant</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={14} color="#10B981" />
                <span>Custom Domain Publishing</span>
              </li>
            </ul>
          </div>
        </div>

          <form
            onSubmit={handleRequestAccess}
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '14px',
              padding: '1.5rem',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ margin: '0 0 0.25rem', fontSize: '1rem', fontWeight: 700, color: '#FFFFFF' }}>
                Checkout for Growth Pro
              </h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#94A3B8' }}>
                Monthly is $49. Annual is $39 a month, billed once a year.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <label htmlFor={fid('email')} style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#CBD5E1', marginBottom: '0.35rem' }}>
                  Work Email
                </label>
                <div style={{ position: 'relative' }}>
                  <Mail size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#64748B' }} />
                  <input
                    id={fid('email')}
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@yourbrand.com"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '0.65rem 0.75rem 0.65rem 2.25rem',
                      borderRadius: '8px',
                      backgroundColor: '#1E293B',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#FFFFFF',
                      fontSize: '0.85rem'
                    }}
                  />
                </div>
              </div>

              <div>
                <label htmlFor={fid('store')} style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#CBD5E1', marginBottom: '0.35rem' }}>
                  Shopify Store URL <span style={{ color: '#64748B' }}>(optional)</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <Store size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#64748B' }} />
                  <input
                    id={fid('store')}
                    type="text"
                    value={storeDomain}
                    onChange={e => setStoreDomain(e.target.value)}
                    placeholder="yourbrand.myshopify.com"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '0.65rem 0.75rem 0.65rem 2.25rem',
                      borderRadius: '8px',
                      backgroundColor: '#1E293B',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#FFFFFF',
                      fontSize: '0.85rem'
                    }}
                  />
                </div>
              </div>
            </div>

            {errorMsg && (
              <p role="alert" style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: '#EF4444' }}>
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.8rem',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '0.925rem',
                fontWeight: 700,
                cursor: submitting ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 15px rgba(99, 102, 241, 0.35)',
                opacity: submitting ? 0.7 : 1
              }}
            >
              <span>{submitting ? 'Opening checkout…' : 'Continue to checkout'}</span>
              <ArrowRight size={16} />
            </button>

            <p style={{ margin: '0.6rem 0 0', fontSize: '0.75rem', color: '#64748B', textAlign: 'center' }}>
              Payment is confirmed on the next page.
            </p>
          </form>
      </div>
    </ModalDialog>
  );
};
