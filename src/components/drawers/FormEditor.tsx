import React from 'react';
import { Plus, Check, ShieldCheck } from 'lucide-react';
import type { FormNodeData, FormFieldConfig } from '../../types/journey';

interface Props {
  data: FormNodeData;
  onChange: (updated: FormNodeData) => void;
}

export const FormEditor: React.FC<Props> = ({ data, onChange }) => {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
    </div>
  );
};
