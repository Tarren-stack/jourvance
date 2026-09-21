import React, { useState } from 'react';
import { X, ArrowRight, CheckCircle2, Mail, ExternalLink, RefreshCw, Send } from 'lucide-react';
import type { JourneyProject, AdNodeData, PageNodeData, FormNodeData, SequenceNodeData } from '../../types/journey';

interface Props {
  project: JourneyProject;
  onClose: () => void;
}

export const LiveFunnelModal: React.FC<Props> = ({ project, onClose }) => {
  const [currentStep, setCurrentStep] = useState<'ad' | 'page' | 'submitted'>('ad');
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', note: '' });

  // Extract node datas
  const adNode = project.nodes.find(n => n.type === 'ad-source')?.data as AdNodeData | undefined;
  const pageNode = project.nodes.find(n => n.type === 'landing-page')?.data as PageNodeData | undefined;
  const formNode = project.nodes.find(n => n.type === 'lead-form')?.data as FormNodeData | undefined;
  const seqNode = project.nodes.find(n => n.type === 'follow-up-sequence')?.data as SequenceNodeData | undefined;

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentStep('submitted');
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(12px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '780px',
          maxHeight: '90vh',
          background: '#0F172A',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '16px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)'
        }}
      >
        {/* Modal Top Bar */}
        <div
          style={{
            padding: '14px 20px',
            background: 'rgba(255, 255, 255, 0.03)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ padding: '3px 8px', borderRadius: '6px', background: 'rgba(99, 102, 241, 0.2)', color: '#818CF8', fontSize: '11px', fontWeight: 700 }}>
              Live Customer Journey Simulator
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#94A3B8' }}>
              <span style={{ color: currentStep === 'ad' ? '#38BDF8' : '#64748B', fontWeight: currentStep === 'ad' ? 700 : 400 }}>1. Ad Click</span>
              <span>→</span>
              <span style={{ color: currentStep === 'page' ? '#38BDF8' : '#64748B', fontWeight: currentStep === 'page' ? 700 : 400 }}>2. Landing Page & Form</span>
              <span>→</span>
              <span style={{ color: currentStep === 'submitted' ? '#34D399' : '#64748B', fontWeight: currentStep === 'submitted' ? 700 : 400 }}>3. Automated Nurture</span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: '4px' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {/* STEP 1: AD CLICK */}
          {currentStep === 'ad' && (
            <div style={{ maxWidth: '420px', margin: '0 auto' }}>
              <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '12px', textAlign: 'center' }}>
                Simulating prospect scrolling social feed and seeing your sponsored campaign:
              </div>
              <div
                style={{
                  borderRadius: '12px',
                  background: '#1E293B',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  padding: '16px',
                  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#FFF' }}>
                    J
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#FFF' }}>Your Business</div>
                    <div style={{ fontSize: '11px', color: '#64748B' }}>Sponsored · Instagram / Facebook</div>
                  </div>
                </div>
                <div style={{ fontSize: '13px', color: '#E2E8F0', marginBottom: '12px', lineHeight: '1.5' }}>
                  {adNode?.body || 'Check out our exclusive new client package.'}
                </div>
                {adNode?.imageUrl && (
                  <img
                    src={adNode.imageUrl}
                    alt="Ad Visual"
                    style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '8px', marginBottom: '12px' }}
                  />
                )}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px',
                    background: 'rgba(0, 0, 0, 0.25)',
                    borderRadius: '8px'
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFF', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {adNode?.headline || 'Claim Your Consultation'}
                  </div>
                  <button
                    onClick={() => setCurrentStep('page')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      background: '#3B82F6',
                      border: 'none',
                      color: '#FFF',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    <span>{adNode?.ctaText || 'Learn More'}</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: LANDING PAGE & FORM */}
          {currentStep === 'page' && (
            <div style={{ maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Fake Browser Top */}
              <div style={{ padding: '8px 14px', background: '#1E293B', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ display: 'flex', gap: '5px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#EF4444' }} />
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#F59E0B' }} />
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981' }} />
                </div>
                <div style={{ flex: 1, padding: '3px 10px', background: '#0F172A', borderRadius: '4px', fontSize: '11px', color: '#94A3B8', fontFamily: 'monospace' }}>
                  https://jourvance.app/p/{pageNode?.slug || 'offer'}?utm_source=meta&utm_campaign={adNode?.utmCampaign || 'promo'}
                </div>
              </div>

              {/* Landing Page Content */}
              <div style={{ padding: '24px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ display: 'inline-block', padding: '4px 10px', borderRadius: '9999px', background: 'rgba(56, 189, 248, 0.15)', color: '#38BDF8', fontSize: '11px', fontWeight: 700, marginBottom: '12px' }}>
                  {pageNode?.trustBadge || 'Verified Client Guarantee'}
                </div>
                <h1 style={{ fontSize: '24px', fontWeight: 800, color: '#FFF', marginBottom: '10px', lineHeight: '1.3' }}>
                  {pageNode?.headline || 'Experience High-Value Results'}
                </h1>
                <p style={{ fontSize: '14px', color: '#94A3B8', marginBottom: '16px', lineHeight: '1.6' }}>
                  {pageNode?.subhead || 'Clear, transparent service built for your specific requirements.'}
                </p>

                {/* Bullets */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
                  {(pageNode?.bullets || []).map((b, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#E2E8F0' }}>
                      <CheckCircle2 size={16} color="#34D399" />
                      <span>{b}</span>
                    </div>
                  ))}
                </div>

                {/* Lead Form Box */}
                <form
                  onSubmit={handleSubmitForm}
                  style={{
                    padding: '20px',
                    borderRadius: '10px',
                    background: '#1E293B',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}
                >
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#FFF', marginBottom: '4px' }}>
                    {formNode?.formTitle || 'Where should we send your invitation details?'}
                  </div>

                  {formNode?.fields?.filter(f => f.enabled).map(f => (
                    <div key={f.id}>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#94A3B8', marginBottom: '4px' }}>
                        {f.label} {f.required && <span style={{ color: '#EF4444' }}>*</span>}
                      </label>
                      {f.type === 'textarea' ? (
                        <textarea
                          rows={2}
                          required={f.required}
                          value={(formData as any)[f.id === 'f_notes' ? 'note' : 'name']}
                          onChange={e => setFormData({ ...formData, note: e.target.value })}
                          placeholder={f.placeholder}
                          style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', background: '#0F172A', border: '1px solid rgba(255, 255, 255, 0.15)', color: '#FFF', fontSize: '12px', outline: 'none' }}
                        />
                      ) : (
                        <input
                          type={f.type}
                          required={f.required}
                          value={(formData as any)[f.id === 'f_name' ? 'name' : f.id === 'f_email' ? 'email' : 'phone']}
                          onChange={e => {
                            const key = f.id === 'f_name' ? 'name' : f.id === 'f_email' ? 'email' : 'phone';
                            setFormData({ ...formData, [key]: e.target.value });
                          }}
                          placeholder={f.placeholder}
                          style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', background: '#0F172A', border: '1px solid rgba(255, 255, 255, 0.15)', color: '#FFF', fontSize: '12px', outline: 'none' }}
                        />
                      )}
                    </div>
                  ))}

                  <button
                    type="submit"
                    style={{
                      marginTop: '8px',
                      padding: '12px',
                      borderRadius: '8px',
                      background: '#6366F1',
                      border: 'none',
                      color: '#FFF',
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px'
                    }}
                  >
                    <span>{formNode?.submitButtonText || 'Submit & Lock In My Spot'}</span>
                    <ArrowRight size={14} />
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* STEP 3: SUBMITTED & NURTURE RECEIPT */}
          {currentStep === 'submitted' && (
            <div style={{ maxWidth: '580px', margin: '0 auto', textAlign: 'center' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.15)', color: '#34D399', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <CheckCircle2 size={28} />
              </div>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#FFF', marginBottom: '8px' }}>
                Lead Successfully Captured!
              </h2>
              <p style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '24px' }}>
                {formNode?.successMessage || 'Your consultation reservation is confirmed.'}
              </p>

              {/* Inbox simulation of instant follow-up */}
              <div style={{ textAlign: 'left', padding: '18px', borderRadius: '12px', background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Mail size={16} color="#FBBF24" />
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#FFF' }}>
                      Automated Follow-Up Triggered (0m delay)
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#34D399', fontWeight: 600 }}>Delivered</span>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#F8FAFC', marginBottom: '4px' }}>
                  Subject: {seqNode?.steps?.[0]?.subject || 'Your Confirmation is inside'}
                </div>
                <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '12px' }}>
                  To: {formData.email || 'prospect@example.com'} · From: notifications@yourbusiness.com
                </div>
                <div style={{ fontSize: '12px', color: '#CBD5E1', whiteSpace: 'pre-line', lineHeight: '1.6', background: 'rgba(0, 0, 0, 0.25)', padding: '12px', borderRadius: '8px' }}>
                  {seqNode?.steps?.[0]?.body.replace(/\[First Name\]/g, formData.name || 'Friend') || 'Thank you for reaching out!'}
                </div>
              </div>

              <div style={{ marginTop: '20px' }}>
                <button
                  onClick={() => setCurrentStep('ad')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: 'none',
                    color: '#FFF',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <RefreshCw size={13} />
                  <span>Restart Journey Test</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
