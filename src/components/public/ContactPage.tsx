import React, { useState } from 'react';
import { Mail, MapPin, Clock, Send, CheckCircle2, AlertCircle } from 'lucide-react';

interface ContactPageProps {
  onNavigate: (page: 'home' | 'about' | 'blog' | 'contact' | 'canvas') => void;
}

export const ContactPage: React.FC<ContactPageProps> = ({ onNavigate }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    businessType: '',
    message: ''
  });
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.message) {
      alert('Please fill out all required fields.');
      return;
    }

    setStatus('submitting');

    try {
      // Save locally to simulate direct contact capture
      const savedContacts = JSON.parse(localStorage.getItem('jourvance_inquiries') || '[]');
      savedContacts.push({
        ...formData,
        id: `inq-${Date.now()}`,
        submittedAt: new Date().toISOString()
      });
      localStorage.setItem('jourvance_inquiries', JSON.stringify(savedContacts));

      // CRM webhook dispatch. The hub REQUIRES a top-level `event` and reads the lead out
      // of `payload` (server.ts, POST /api/crm/webhook/:appId): a body without `event` is
      // a 400. This used to post the bare fields and swallow the refusal, so every inquiry
      // was answered "Message sent" and reached nobody.
      const res = await fetch('https://zeluslabs.dev/api/crm/webhook/jourvance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'lead_captured',
          appName: 'Jourvance',
          payload: {
            name: formData.name,
            email: formData.email,
            message: formData.message,
            source: 'contact-page',
            businessType: formData.businessType
          }
        })
      });
      if (!res.ok) throw new Error(`CRM webhook refused the lead: ${res.status}`);

      setStatus('success');
      setFormData({ name: '', email: '', businessType: '', message: '' });
    } catch (err) {
      setStatus('error');
    }
  };

  return (
    <div style={{ backgroundColor: '#0B0F19', color: '#F8FAFC', padding: '5rem 2rem 7rem' }}>
      <div style={{ maxWidth: '1050px', margin: '0 auto' }}>
        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <span
            style={{
              fontSize: '0.8rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              color: '#818CF8',
              letterSpacing: '0.08em'
            }}
          >
            Contact & Inquiries
          </span>
          <h1
            style={{
              fontSize: 'clamp(2.25rem, 4.5vw, 3.5rem)',
              fontWeight: 900,
              letterSpacing: '-0.03em',
              margin: '0.75rem 0 1rem',
              color: '#FFFFFF'
            }}
          >
            Let's Talk About Your Customer Journey
          </h1>
          <p style={{ fontSize: '1.15rem', color: '#94A3B8', maxWidth: '650px', margin: '0 auto' }}>
            Have questions about integrating Jourvance, setting up custom funnel architectures, or partnership inquiries?
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '3rem' }}>
          {/* Left: Contact Channels */}
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '1.25rem' }}>
              Direct Support
            </h2>
            <p style={{ fontSize: '0.95rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '2rem' }}>
              Our team operates with a strict under-12-hour response window. Whether you need assistance with an ad sequence
              or custom landing page styling, reach out directly.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Email */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', backgroundColor: 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Mail style={{ width: '20px', height: '20px', color: '#818CF8' }} />
                </div>
                <div>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#FFFFFF' }}>Email Support</h4>
                  <a href="mailto:support@jourvance.com" style={{ color: '#818CF8', fontSize: '0.9rem', textDecoration: 'none' }}>
                    support@jourvance.com
                  </a>
                </div>
              </div>

              {/* Location */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', backgroundColor: 'rgba(56, 189, 248, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <MapPin style={{ width: '20px', height: '20px', color: '#38BDF8' }} />
                </div>
                <div>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#FFFFFF' }}>Headquarters</h4>
                  <p style={{ color: '#94A3B8', fontSize: '0.9rem' }}>Los Angeles, CA</p>
                </div>
              </div>

              {/* Hours */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', backgroundColor: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Clock style={{ width: '20px', height: '20px', color: '#10B981' }} />
                </div>
                <div>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#FFFFFF' }}>Response Window</h4>
                  <p style={{ color: '#94A3B8', fontSize: '0.9rem' }}>Monday – Saturday: 8:00 AM – 8:00 PM PST</p>
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: '3rem',
                padding: '1.5rem',
                borderRadius: '12px',
                backgroundColor: '#111827',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '0.4rem' }}>
                Looking to try the software first?
              </h4>
              <p style={{ fontSize: '0.85rem', color: '#94A3B8', marginBottom: '1rem' }}>
                You can launch the full interactive canvas studio immediately without an account.
              </p>
              <button
                onClick={() => onNavigate('canvas')}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(99, 102, 241, 0.2)',
                  border: '1px solid #6366F1',
                  color: '#A5B4FC',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Launch Studio Canvas →
              </button>
            </div>
          </div>

          {/* Right: Interactive Contact Form */}
          <div
            style={{
              backgroundColor: '#111827',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '2.5rem'
            }}
          >
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '1.5rem' }}>
              Send a Message
            </h2>

            {status === 'success' ? (
              <div
                style={{
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '12px',
                  padding: '2rem',
                  textAlign: 'center'
                }}
              >
                <CheckCircle2 style={{ width: '36px', height: '36px', color: '#10B981', margin: '0 auto 1rem' }} />
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '0.5rem' }}>
                  Message Received!
                </h3>
                <p style={{ fontSize: '0.9rem', color: '#CBD5E1', marginBottom: '1.5rem' }}>
                  Thank you for reaching out. We will review your message and reply to your email shortly.
                </p>
                <button
                  onClick={() => setStatus('idle')}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#FFFFFF',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Send Another Message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#CBD5E1', marginBottom: '0.4rem' }}>
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Alex Morgan"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '8px',
                      backgroundColor: '#1E293B',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#FFFFFF',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#CBD5E1', marginBottom: '0.4rem' }}>
                    Work Email *
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="alex@yourcompany.com"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '8px',
                      backgroundColor: '#1E293B',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#FFFFFF',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#CBD5E1', marginBottom: '0.4rem' }}>
                    Business / Industry
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Consulting, SaaS, Legal, Home Services"
                    value={formData.businessType}
                    onChange={e => setFormData({ ...formData, businessType: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '8px',
                      backgroundColor: '#1E293B',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#FFFFFF',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#CBD5E1', marginBottom: '0.4rem' }}>
                    How can we help? *
                  </label>
                  <textarea
                    rows={4}
                    required
                    placeholder="Describe your current funnel or what you'd like to achieve..."
                    value={formData.message}
                    onChange={e => setFormData({ ...formData, message: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '8px',
                      backgroundColor: '#1E293B',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#FFFFFF',
                      fontSize: '0.9rem',
                      outline: 'none',
                      resize: 'vertical'
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={status === 'submitting'}
                  style={{
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
                    fontWeight: 700,
                    cursor: status === 'submitting' ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                    marginTop: '0.5rem'
                  }}
                >
                  <Send style={{ width: '16px', height: '16px' }} />
                  <span>{status === 'submitting' ? 'Sending...' : 'Send Message'}</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
