import React, { useState } from 'react';
import { Mail, MapPin, Clock, Send, CheckCircle2 } from 'lucide-react';
import { VIEW_LABEL } from '../../lib/studioLabels';

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
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; message?: string }>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: { name?: string; email?: string; message?: string } = {};
    if (!formData.name.trim()) next.name = 'Enter your name.';
    if (!formData.email.trim()) next.email = 'Enter your email.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) next.email = 'Enter an email like name@company.com.';
    if (!formData.message.trim()) next.message = 'Tell us what you need help with.';
    setFieldErrors(next);
    if (next.name || next.email || next.message) return;

    setStatus('submitting');

    try {
      // Save locally as browser backup
      const savedContacts = JSON.parse(localStorage.getItem('jourvance_inquiries') || '[]');
      savedContacts.push({
        ...formData,
        id: `inq-${Date.now()}`,
        submittedAt: new Date().toISOString()
      });
      localStorage.setItem('jourvance_inquiries', JSON.stringify(savedContacts));

      // Post to internal backend endpoint (persisted in Firestore with external webhook relay)
      const res = await fetch('/api/public/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          message: formData.message,
          source: 'contact-page',
          businessType: formData.businessType
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Inquiry could not be recorded (${res.status})`);
      }

      setStatus('success');
      setFieldErrors({});
      setFormData({ name: '', email: '', businessType: '', message: '' });
    } catch (err) {
      console.warn('[Jourvance] Contact submission notice:', err);
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
            Let's talk about what you're building.
          </h1>
          <p style={{ fontSize: '1.15rem', lineHeight: 1.6, color: '#94A3B8', maxWidth: '650px', margin: '0 auto' }}>
            Tell us what you're building and where you need a hand. Have a question about Jourvance,
            an idea for a campaign, or feedback from using the tools? We'd like to hear it.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '3rem' }}>
          {/* Left: Contact Channels */}
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '1.25rem' }}>
              Get in touch
            </h2>
            <p style={{ fontSize: '0.95rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '2rem' }}>
              Share a little about your business and the page, form, or follow-up you're working on.
              That context helps us understand what you need.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Email */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', backgroundColor: 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Mail style={{ width: '20px', height: '20px', color: '#818CF8' }} />
                </div>
                <div>
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#FFFFFF', margin: 0 }}>Email support</h3>
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
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#FFFFFF', margin: 0 }}>Office</h3>
                  <p style={{ color: '#94A3B8', fontSize: '0.9rem' }}>Los Angeles, CA</p>
                </div>
              </div>

              {/* Hours */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', backgroundColor: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Clock style={{ width: '20px', height: '20px', color: '#10B981' }} />
                </div>
                <div>
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#FFFFFF', margin: 0 }}>Hours</h3>
                  <p style={{ color: '#94A3B8', fontSize: '0.9rem' }}>Monday to Saturday, 8:00 AM to 8:00 PM Pacific time</p>
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
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#FFFFFF', margin: '0 0 0.4rem' }}>
                Want to try it first?
              </h3>
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
                {VIEW_LABEL.canvas}
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
              <form noValidate onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#94A3B8' }}>Name, email, and message are required.</p>
                <div>
                  <label htmlFor="contact-name" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#CBD5E1', marginBottom: '0.4rem' }}>
                    Full name (required)
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    autoComplete="name"
                    aria-invalid={fieldErrors.name ? true : undefined}
                    aria-describedby={fieldErrors.name ? 'contact-name-error' : undefined}
                    placeholder="e.g. Alex Morgan"
                    value={formData.name}
                    onChange={e => {
                      setFormData({ ...formData, name: e.target.value });
                      setFieldErrors(prev => ({ ...prev, name: undefined }));
                    }}
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
                  {fieldErrors.name && <p id="contact-name-error" role="alert" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: '#FCA5A5' }}>{fieldErrors.name}</p>}
                </div>

                <div>
                  <label htmlFor="contact-email" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#CBD5E1', marginBottom: '0.4rem' }}>
                    Work email (required)
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    autoComplete="email"
                    aria-invalid={fieldErrors.email ? true : undefined}
                    aria-describedby={fieldErrors.email ? 'contact-email-error' : undefined}
                    placeholder="alex@yourcompany.com"
                    value={formData.email}
                    onChange={e => {
                      setFormData({ ...formData, email: e.target.value });
                      setFieldErrors(prev => ({ ...prev, email: undefined }));
                    }}
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
                  {fieldErrors.email && <p id="contact-email-error" role="alert" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: '#FCA5A5' }}>{fieldErrors.email}</p>}
                </div>

                <div>
                  <label htmlFor="contact-business" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#CBD5E1', marginBottom: '0.4rem' }}>
                    Business or industry (optional)
                  </label>
                  <input
                    id="contact-business"
                    type="text"
                    placeholder="For example, consulting, software, or home services"
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
                  <label htmlFor="contact-message" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#CBD5E1', marginBottom: '0.4rem' }}>
                    How can we help? (required)
                  </label>
                  <textarea
                    id="contact-message"
                    rows={4}
                    aria-invalid={fieldErrors.message ? true : undefined}
                    aria-describedby={fieldErrors.message ? 'contact-message-error' : undefined}
                    placeholder="The page, form, or follow-up you are working on"
                    value={formData.message}
                    onChange={e => {
                      setFormData({ ...formData, message: e.target.value });
                      setFieldErrors(prev => ({ ...prev, message: undefined }));
                    }}
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
                  {fieldErrors.message && <p id="contact-message-error" role="alert" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: '#FCA5A5' }}>{fieldErrors.message}</p>}
                </div>

                {status === 'error' && (
                  <p role="alert" style={{ margin: 0, fontSize: '0.85rem', color: '#FCA5A5' }}>
                    We could not send your message. Check your connection and try again.
                  </p>
                )}

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
