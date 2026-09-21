import React, { useState } from 'react';
import { Plus, Check, ShieldCheck, CheckCircle2 } from 'lucide-react';
import type { FormNodeData, FormFieldConfig } from '../../types/journey';

interface Props {
  data: FormNodeData;
  onChange: (updated: FormNodeData) => void;
}

export const FormEditor: React.FC<Props> = ({ data, onChange }) => {
  const [editorTab, setEditorTab] = useState<'settings' | 'preview'>('settings');
  const [submitted, setSubmitted] = useState(false);

  const handleFieldChange = (field: keyof FormNodeData, val: any) => {
    onChange({ ...data, [field]: val });
  };

  const toggleField = (fieldId: string) => {
    const updated = (data.fields || []).map(f =>
      f.id === fieldId ? { ...f, enabled: !f.enabled } : f
    );
    handleFieldChange('fields', updated);
  };

  const toggleRequired = (fieldId: string) => {
    const updated = (data.fields || []).map(f =>
      f.id === fieldId ? { ...f, required: !f.required } : f
    );
    handleFieldChange('fields', updated);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Tab Switcher */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.35)',
          padding: '4px',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}
      >
        <button
          type="button"
          onClick={() => { setEditorTab('settings'); setSubmitted(false); }}
          style={{
            flex: 1,
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: editorTab === 'settings' ? '#6366F1' : 'transparent',
            color: editorTab === 'settings' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          Form Builder Settings
        </button>
        <button
          type="button"
          onClick={() => { setEditorTab('preview'); setSubmitted(false); }}
          style={{
            flex: 1,
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: editorTab === 'preview' ? '#6366F1' : 'transparent',
            color: editorTab === 'preview' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          Live Interactive Form
        </button>
      </div>

      {editorTab === 'preview' ? (
        <div
          style={{
            backgroundColor: '#0F172A',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)'
          }}
        >
          <div style={{ fontSize: '15px', fontWeight: 800, color: '#FFFFFF', marginBottom: '4px', textAlign: 'center' }}>
            {data.formTitle || 'Request Consultation Details'}
          </div>
          <p style={{ fontSize: '11px', color: '#94A3B8', textAlign: 'center', marginBottom: '16px' }}>
            Complete this form to test real-time validation.
          </p>

          {submitted ? (
            <div style={{ textAlign: 'center', padding: '24px 12px', backgroundColor: 'rgba(16, 185, 129, 0.08)', borderRadius: '10px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
              <CheckCircle2 size={32} color="#10B981" style={{ margin: '0 auto 10px' }} />
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#FFFFFF', marginBottom: '6px' }}>
                Submission Received!
              </div>
              <p style={{ fontSize: '12px', color: '#94A3B8', lineHeight: 1.5 }}>
                {data.successMessage || 'Thank you! Your details have been routed to the CRM.'}
              </p>
              <button
                type="button"
                onClick={() => setSubmitted(false)}
                style={{
                  marginTop: '14px',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  border: 'none',
                  color: '#FFFFFF',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Reset Form
              </button>
            </div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); setSubmitted(true); }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                {(data.fields || []).filter(f => f.enabled).map(f => (
                  <div key={f.id}>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#E2E8F0', marginBottom: '4px' }}>
                      {f.label} {f.required && <span style={{ color: '#EF4444' }}>*</span>}
                    </label>
                    <input
                      type={f.type}
                      placeholder={f.placeholder}
                      required={f.required}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        background: '#1E293B',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        color: '#FFFFFF',
                        fontSize: '12px',
                        outline: 'none'
                      }}
                    />
                  </div>
                ))}
              </div>

              <button
                type="submit"
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)'
                }}
              >
                {data.submitButtonText || 'Confirm & Reserve'}
              </button>
            </form>
          )}
        </div>
      ) : (
        <>
      {/* Form Title */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Form Heading
        </label>
        <input
          type="text"
          value={data.formTitle}
          onChange={e => handleFieldChange('formTitle', e.target.value)}
          placeholder="e.g. Where should we send your invitation details?"
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#FFFFFF',
            fontSize: '13px',
            outline: 'none'
          }}
        />
      </div>

      {/* Field Configuration */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '8px' }}>
          Form Fields ({data.fields?.filter(f => f.enabled).length} Active)
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(data.fields || []).map(f => (
            <div
              key={f.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderRadius: '8px',
                background: f.enabled ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                border: f.enabled ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(255, 255, 255, 0.04)',
                opacity: f.enabled ? 1 : 0.6
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="checkbox"
                  checked={f.enabled}
                  onChange={() => toggleField(f.id)}
                  style={{ cursor: 'pointer', width: '15px', height: '15px', accentColor: '#6366F1' }}
                />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC' }}>{f.label}</div>
                  <div style={{ fontSize: '10px', color: '#64748B' }}>type: {f.type}</div>
                </div>
              </div>
              {f.enabled && (
                <button
                  type="button"
                  onClick={() => toggleRequired(f.id)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: 'none',
                    background: f.required ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    color: f.required ? '#818CF8' : '#64748B',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {f.required ? 'Required' : 'Optional'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Button Label */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Submit Button Text
        </label>
        <input
          type="text"
          value={data.submitButtonText}
          onChange={e => handleFieldChange('submitButtonText', e.target.value)}
          placeholder="e.g. Submit & Lock In My Offer"
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#FFFFFF',
            fontSize: '13px',
            outline: 'none'
          }}
        />
      </div>

      {/* Success Message */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Post-Submit Confirmation Message
        </label>
        <textarea
          rows={2}
          value={data.successMessage}
          onChange={e => handleFieldChange('successMessage', e.target.value)}
          placeholder="e.g. Thank you! Your spot is reserved. Check your email for next steps."
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#FFFFFF',
            fontSize: '13px',
            outline: 'none',
            resize: 'vertical'
          }}
        />
      </div>

      {/* Notification Email */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
          Instant Lead Notification Email
        </label>
        <input
          type="email"
          value={data.notifyEmail || ''}
          onChange={e => handleFieldChange('notifyEmail', e.target.value)}
          placeholder="notifications@yourbusiness.com"
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#FFFFFF',
            fontSize: '13px',
            outline: 'none'
          }}
        />
      </div>
      </>
      )}
    </div>
  );
};
