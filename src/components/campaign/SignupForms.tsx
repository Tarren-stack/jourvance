import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Eye,
  Laptop,
  Smartphone,
  CheckCircle2,
  Copy,
  Check,
  Plus,
  Trash2,
  ExternalLink,
  ShieldCheck,
  Layers,
  Settings2,
  Tag,
  X,
  ArrowRight,
  Gift,
  BellRing,
  MousePointerClick,
  SlidersHorizontal
} from 'lucide-react';
import { authHeaders } from '../../lib/firebase';
import { card, field, ghostBtn, label, readJson, solidBtn } from './emailChrome';

type FormType = 'popup' | 'bar' | 'embed' | 'flyout' | 'page';
type Slice = { label: string; coupon: { name: string; discountType: string; value: number } };

export interface SignupForm {
  id: string;
  name: string;
  type: FormType;
  enabled: boolean;
  headline: string;
  body: string;
  buttonText: string;
  successMessage: string;
  teaser: string;
  teaserClosed: string;
  delaySeconds: number;
  optIn: 'single' | 'double';
  optInLabel: string;
  askPhone: boolean;
  askSms: boolean;
  testEnabled: boolean;
  variantB: { headline: string; body: string; buttonText: string; successMessage: string };
  rules: {
    urlContains: string;
    utmKey: string;
    utmValue: string;
    device: 'any' | 'mobile' | 'desktop';
    hideSubmitted: boolean;
    scrollPercent: number;
    exit: boolean;
    showAgainDays: number;
  };
  coupon: { name: string; discountType: string; value: number } | null;
  slices: Slice[];
  submissions: number;
}

const TYPES: { id: FormType; label: string }[] = [
  { id: 'popup', label: 'Center Popup' },
  { id: 'bar', label: 'Floating Bar' },
  { id: 'flyout', label: 'Flyout Drawer' },
  { id: 'embed', label: 'Embedded Form' },
  { id: 'page', label: 'Full Page' }
];

const BEAUTY_PRESETS = [
  {
    name: '15% Welcome Ritual (Exit-Intent)',
    type: 'popup' as FormType,
    headline: 'Claim Your 15% Welcome Ritual',
    body: 'Join our private botanical community to receive 15% off your first order, complimentary samples, and early access to limited seasonal formulations.',
    buttonText: 'Unlock My 15% Gift',
    successMessage: 'Your 15% courtesy code is unlocked below. Welcome to the ritual.',
    teaser: '15% Off Your First Order',
    teaserClosed: 'Unlock 15% Off',
    coupon: { name: 'WELCOME15', discountType: 'percentage', value: 15 },
    delaySeconds: 5,
    rules: { exit: true, scrollPercent: 0, device: 'any' as const, hideSubmitted: true, showAgainDays: 7, urlContains: '', utmKey: '', utmValue: '' }
  },
  {
    name: 'VIP Sanctuary Early Access',
    type: 'flyout' as FormType,
    headline: 'Private VIP Sanctuary Access',
    body: 'Be the first to experience small-batch drops, private skincare masterclasses, and secret subscriber-only archival sales.',
    buttonText: 'Enter The Sanctuary',
    successMessage: 'Welcome to the Sanctuary. Your VIP member privileges are now active.',
    teaser: 'VIP Private Access',
    teaserClosed: 'VIP Access',
    coupon: { name: 'SANCTUARY', discountType: 'percentage', value: 10 },
    delaySeconds: 8,
    rules: { exit: false, scrollPercent: 35, device: 'any' as const, hideSubmitted: true, showAgainDays: 14, urlContains: '', utmKey: '', utmValue: '' }
  },
  {
    name: 'Free Shipping Floating Bar',
    type: 'bar' as FormType,
    headline: 'Complimentary Express Shipping on Orders $50+',
    body: 'Subscribe today to unlock free priority delivery and a complimentary botanical travel bag with your first order.',
    buttonText: 'Unlock Free Delivery',
    successMessage: 'Free shipping voucher unlocked! Use code FREESHIP at checkout.',
    teaser: 'Free Express Delivery Available',
    teaserClosed: 'Free Shipping Voucher',
    coupon: { name: 'FREESHIP', discountType: 'percentage', value: 10 },
    delaySeconds: 2,
    rules: { exit: false, scrollPercent: 0, device: 'any' as const, hideSubmitted: true, showAgainDays: 3, urlContains: '', utmKey: '', utmValue: '' }
  }
];

export const SignupForms: React.FC = () => {
  const [forms, setForms] = useState<SignupForm[]>([]);
  const [hubForms, setHubForms] = useState<number>(0);
  const [hubError, setHubError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewForm, setPreviewForm] = useState<SignupForm | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await readJson(await fetch('/api/email/forms', { headers: await authHeaders() }));
      setForms(Array.isArray(data?.forms) ? data.forms : []);
      setHubForms(Array.isArray(data?.hubForms) ? data.hubForms.length : 0);
      setHubError(data?.hubError || '');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const create = async (type: FormType) => {
    const typeLabel = TYPES.find((row) => row.id === type)?.label || 'Form';
    const res = await fetch('/api/email/forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        name: `${typeLabel} Campaign`,
        type,
        headline: 'Join Our Private Community',
        body: 'Subscribe to receive exclusive beauty perks, seasonal formula previews, and surprise gifts.',
        buttonText: 'Claim My Gift',
        successMessage: 'Welcome to our community! Your coupon is unlocked below.',
        teaser: 'Special Gift Inside',
        teaserClosed: 'Unlock Offer',
        coupon: { name: 'WELCOME10', discountType: 'percentage', value: 10 },
        rules: { exit: false, scrollPercent: 0, device: 'any', hideSubmitted: true, showAgainDays: 7, urlContains: '', utmKey: '', utmValue: '' }
      })
    });
    const data = await readJson(res);
    setNotice(data?.error || 'New form created. Review copy and turn on when ready.');
    await load();
  };

  const createWithPreset = async (preset: typeof BEAUTY_PRESETS[0]) => {
    const res = await fetch('/api/email/forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(preset)
    });
    const data = await readJson(res);
    setNotice(data?.error || `Created "${preset.name}". Preview or edit below.`);
    await load();
  };

  const save = async (form: SignupForm, patch: Partial<SignupForm>) => {
    const res = await fetch(`/api/email/forms/${form.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ ...form, ...patch })
    });
    const data = await readJson(res);
    setNotice(data?.error || 'Saved changes.');
    await load();
    if (previewForm && previewForm.id === form.id) {
      setPreviewForm({ ...previewForm, ...patch });
    }
  };

  const remove = async (form: SignupForm) => {
    if (!window.confirm(`Delete "${form.name}"?`)) return;
    await fetch(`/api/email/forms/${form.id}`, { method: 'DELETE', headers: await authHeaders() });
    if (previewForm?.id === form.id) setPreviewForm(null);
    await load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', borderRadius: '12px', backgroundColor: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.3)', color: '#f472b6', fontSize: '11px', fontWeight: 700, marginBottom: '6px' }}>
            <Sparkles size={11} />
            <span>Storefront Lead Acquisition & Exit-Intent</span>
          </div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f3f4f6' }}>
            Signup Forms & Exit-Intent Rescue
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af', maxWidth: '720px' }}>
            Capture high-intent shoppers before they bounce with modal popups, floating sticky bars, and exit-intent rescue cards with instant coupon code reveals.
          </p>
        </div>

        {/* New Form Button Group */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {TYPES.slice(0, 3).map((type) => (
            <button
              key={type.id}
              type="button"
              onClick={() => create(type.id)}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s'
              }}
            >
              <Plus size={13} />
              <span>+ {type.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 1-Click Luxury Beauty Presets Bar */}
      <div style={{ backgroundColor: '#1e293b', padding: '14px 18px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#cbd5e1', marginBottom: '10px' }}>
          <Gift size={14} color="#ec4899" />
          <span>1-Click High-Converting Beauty Presets</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
          {BEAUTY_PRESETS.map((preset, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => createWithPreset(preset)}
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ec4899'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#f3f4f6' }}>{preset.name}</span>
                <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(236, 72, 153, 0.2)', color: '#f472b6', fontWeight: 700 }}>
                  {preset.coupon.name}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {preset.headline}
              </div>
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', backgroundColor: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCircle2 size={15} />
          <span>{notice}</span>
        </div>
      )}

      {/* Forms List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {forms.map((form) => (
          <FormCard
            key={form.id}
            form={form}
            onSave={save}
            onDelete={remove}
            onPreview={(f) => setPreviewForm(f)}
          />
        ))}

        {!forms.length && !loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', backgroundColor: '#121217', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.06)', color: '#94a3b8' }}>
            <Layers size={32} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff' }}>No signup forms active yet</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>Choose a preset above or click + Center Popup to build your first high-converting storefront form.</div>
          </div>
        )}
      </div>

      {/* Live Storefront Simulator Modal */}
      {previewForm && (
        <StorefrontPreviewModal
          form={previewForm}
          onClose={() => setPreviewForm(null)}
          onSave={save}
        />
      )}
    </div>
  );
};

const FormCard: React.FC<{
  form: SignupForm;
  onSave: (form: SignupForm, patch: Partial<SignupForm>) => void;
  onDelete: (form: SignupForm) => void;
  onPreview: (form: SignupForm) => void;
}> = ({ form, onSave, onDelete, onPreview }) => {
  const [draft, setDraft] = useState(form);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setDraft(form), [form]);

  const set = (patch: Partial<SignupForm>) => setDraft({ ...draft, ...patch });
  const rules = draft.rules || { urlContains: '', utmKey: '', utmValue: '', device: 'any' as const, hideSubmitted: true, scrollPercent: 0, exit: false, showAgainDays: 0 };
  const setRule = (patch: Partial<SignupForm['rules']>) => set({ rules: { ...rules, ...patch } });

  return (
    <div style={{ backgroundColor: '#121217', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)', overflow: 'hidden' }}>
      {/* Card Header */}
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', borderBottom: expanded ? '1px solid rgba(255, 255, 255, 0.06)' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              padding: '6px',
              borderRadius: '8px',
              backgroundColor: form.enabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              color: form.enabled ? '#34d399' : '#94a3b8'
            }}
          >
            {form.type === 'bar' ? <BellRing size={16} /> : <Gift size={16} />}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 700, fontSize: '15px', color: '#f3f4f6' }}>{form.name}</span>
              <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', backgroundColor: 'rgba(255, 255, 255, 0.08)', color: '#cbd5e1' }}>
                {form.type}
              </span>
              <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 700, backgroundColor: form.enabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)', color: form.enabled ? '#34d399' : '#f87171' }}>
                {form.enabled ? 'Live on Store' : 'Draft / Paused'}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '3px' }}>
              Headline: <em>"{form.headline}"</em> • {form.submissions || 0} leads joined
              {form.coupon && ` • Unlocks ${form.coupon.name} (${form.coupon.value}% off)`}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => onPreview(draft)}
            style={{
              padding: '7px 12px',
              borderRadius: '8px',
              backgroundColor: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              color: '#818cf8',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Eye size={13} />
            <span>Preview in Simulator</span>
          </button>

          <button
            type="button"
            onClick={() => onSave(draft, { enabled: !form.enabled })}
            style={{
              padding: '7px 12px',
              borderRadius: '8px',
              backgroundColor: form.enabled ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              border: `1px solid ${form.enabled ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
              color: form.enabled ? '#f87171' : '#34d399',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            {form.enabled ? 'Turn Off' : 'Turn On'}
          </button>

          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            style={{
              padding: '7px 12px',
              borderRadius: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <SlidersHorizontal size={13} />
            <span>{expanded ? 'Hide Settings' : 'Edit Copy & Rules'}</span>
          </button>
        </div>
      </div>

      {/* Expanded Editor Form */}
      {expanded && (
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'rgba(0, 0, 0, 0.2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
            <div>
              <label style={label}>Internal Form Name</label>
              <input style={field} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </div>

            <div>
              <label style={label}>Form Format</label>
              <select style={field} value={draft.type} onChange={(e) => set({ type: e.target.value as FormType })}>
                {TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
            <div>
              <label style={label}>Headline</label>
              <input style={field} value={draft.headline} onChange={(e) => set({ headline: e.target.value })} />
            </div>

            <div>
              <label style={label}>Body Copy</label>
              <textarea style={{ ...field, minHeight: '65px' }} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={label}>Button Label</label>
                <input style={field} value={draft.buttonText} onChange={(e) => set({ buttonText: e.target.value })} />
              </div>

              <div>
                <label style={label}>Success Message</label>
                <input style={field} value={draft.successMessage} onChange={(e) => set({ successMessage: e.target.value })} />
              </div>
            </div>
          </div>

          {/* Coupon Section */}
          <div style={{ backgroundColor: 'rgba(236, 72, 153, 0.05)', border: '1px solid rgba(236, 72, 153, 0.2)', padding: '12px 14px', borderRadius: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#f472b6', textTransform: 'uppercase', marginBottom: '8px' }}>
              Shopify Courtesy Coupon Reward
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#9ca3af' }}>Coupon Code Name</label>
                <input
                  style={field}
                  placeholder="e.g. WELCOME15"
                  value={draft.coupon?.name || ''}
                  onChange={(e) => set({ coupon: { name: e.target.value, discountType: 'percentage', value: draft.coupon?.value || 10 } })}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: '#9ca3af' }}>Discount Percentage (%)</label>
                <input
                  style={field}
                  type="number"
                  min={1}
                  max={100}
                  value={draft.coupon?.value || 10}
                  onChange={(e) => set({ coupon: { name: draft.coupon?.name || 'WELCOME10', discountType: 'percentage', value: Number(e.target.value) } })}
                />
              </div>
            </div>
          </div>

          {/* Behavioral Triggers */}
          <div style={{ backgroundColor: '#1e293b', padding: '14px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', marginBottom: '10px' }}>
              Targeting & Behavioral Triggers
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <label style={{ fontSize: '12px', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={rules.exit === true} onChange={(e) => setRule({ exit: e.target.checked })} />
                <span>Exit-Intent Rescue</span>
              </label>

              <label style={{ fontSize: '12px', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={draft.askPhone === true} onChange={(e) => set({ askPhone: e.target.checked })} />
                <span>Ask for Phone Number</span>
              </label>

              <label style={{ fontSize: '12px', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={draft.askSms === true} onChange={(e) => set({ askSms: e.target.checked })} />
                <span>SMS Consent Checkbox</span>
              </label>

              <div>
                <label style={{ fontSize: '11px', color: '#9ca3af' }}>Delay (seconds)</label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  style={field}
                  value={draft.delaySeconds || 0}
                  onChange={(e) => set({ delaySeconds: Number(e.target.value) })}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: '#9ca3af' }}>Scroll Depth (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  style={field}
                  value={rules.scrollPercent || 0}
                  onChange={(e) => setRule({ scrollPercent: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
            <button type="button" onClick={() => onDelete(form)} style={{ ...ghostBtn, color: '#f87171' }}>
              Delete Form
            </button>
            <button type="button" onClick={() => { onSave(draft, {}); setExpanded(false); }} style={solidBtn}>
              Save Changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// -------------------------------------------------------------
// LIVE STOREFRONT SIMULATOR MODAL
// -------------------------------------------------------------

const StorefrontPreviewModal: React.FC<{
  form: SignupForm;
  onClose: () => void;
  onSave: (form: SignupForm, patch: Partial<SignupForm>) => void;
}> = ({ form, onClose, onSave }) => {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [testEmail, setTestEmail] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [testSubmitted, setTestSubmitted] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const handleTestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmail || !testEmail.includes('@')) return;
    setTestSubmitted(true);
  };

  const handleCopyCode = () => {
    const code = form.coupon?.name || 'WELCOME15';
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 130,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Top Simulator Control Bar */}
      <div
        style={{
          width: '100%',
          maxWidth: '1000px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#1e293b',
          padding: '12px 20px',
          borderRadius: '12px 12px 0 0',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderBottom: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>
            Storefront Simulator: {form.name}
          </span>
          <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 700, backgroundColor: 'rgba(236, 72, 153, 0.2)', color: '#f472b6', textTransform: 'uppercase' }}>
            {form.type}
          </span>
        </div>

        {/* Device Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'rgba(0,0,0,0.3)', padding: '3px', borderRadius: '8px' }}>
          <button
            type="button"
            onClick={() => setDevice('desktop')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: device === 'desktop' ? '#6366f1' : 'transparent',
              color: '#ffffff',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Laptop size={13} />
            <span>Desktop</span>
          </button>

          <button
            type="button"
            onClick={() => setDevice('mobile')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: device === 'mobile' ? '#6366f1' : 'transparent',
              color: '#ffffff',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Smartphone size={13} />
            <span>Mobile</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            borderRadius: '6px',
            padding: '6px',
            color: '#94a3b8',
            cursor: 'pointer'
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Simulator Viewport Container */}
      <div
        style={{
          width: '100%',
          maxWidth: '1000px',
          height: '620px',
          backgroundColor: '#0a0a0f',
          borderRadius: '0 0 12px 12px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {/* Mock Storefront Background */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.18, filter: 'blur(2px)', pointerEvents: 'none', background: 'radial-gradient(circle at 50% 30%, #312e81 0%, #030712 100%)', display: 'flex', flexDirection: 'column', padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '12px' }}>
            <div style={{ fontWeight: 800, fontSize: '18px', color: '#ffffff' }}>JOURVANCE BOTANICALS</div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#94a3b8' }}>
              <span>Skincare</span>
              <span>Elixirs</span>
              <span>Rituals</span>
              <span>Our Story</span>
            </div>
          </div>
          <div style={{ marginTop: '60px', textAlign: 'center' }}>
            <div style={{ fontSize: '32px', fontWeight: 900, color: '#ffffff' }}>Pure Botanical Formulations</div>
            <div style={{ fontSize: '14px', color: '#94a3b8', marginTop: '8px' }}>Handcrafted organic skincare backed by dermatological efficacy.</div>
          </div>
        </div>

        {/* Floating Bar Mode */}
        {form.type === 'bar' && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              backgroundColor: '#111827',
              borderBottom: '2px solid #ec4899',
              padding: device === 'mobile' ? '12px 16px' : '14px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              zIndex: 10
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Sparkles size={16} color="#ec4899" />
              <div>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>{form.headline}</span>
                {device === 'desktop' && (
                  <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '10px' }}>{form.body}</span>
                )}
              </div>
            </div>

            {testSubmitted ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#34d399' }}>Code: {form.coupon?.name || 'WELCOME15'}</span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    backgroundColor: '#10b981',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {copiedCode ? 'Copied!' : 'Copy'}
                </button>
              </div>
            ) : (
              <form onSubmit={handleTestSubmit} style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="email"
                  required
                  placeholder="Your email address"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#ffffff',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                />
                <button
                  type="submit"
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    backgroundColor: '#ec4899',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {form.buttonText || 'Claim'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Center Popup or Flyout Mode */}
        {form.type !== 'bar' && (
          <div
            style={{
              width: device === 'mobile' ? '320px' : '480px',
              backgroundColor: '#111827',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(236, 72, 153, 0.25)',
              padding: device === 'mobile' ? '20px' : '32px',
              position: 'relative',
              textAlign: 'center',
              zIndex: 10,
              animation: 'fadeIn 0.25s ease'
            }}
          >
            {/* Close indicator */}
            <div style={{ position: 'absolute', top: '14px', right: '14px', color: '#64748b' }}>
              <X size={16} />
            </div>

            {testSubmitted ? (
              /* Success State with Dynamic Voucher */
              <div>
                <div style={{ display: 'inline-flex', padding: '10px', borderRadius: '50%', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#34d399', marginBottom: '12px' }}>
                  <CheckCircle2 size={28} />
                </div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#ffffff' }}>
                  Welcome to the Ritual
                </h3>
                <p style={{ margin: '6px 0 16px', fontSize: '13px', color: '#cbd5e1', lineHeight: 1.4 }}>
                  {form.successMessage || 'Your discount voucher has been unlocked.'}
                </p>

                {/* Voucher Card */}
                <div
                  style={{
                    padding: '14px 18px',
                    borderRadius: '10px',
                    border: '1px dashed rgba(236, 72, 153, 0.6)',
                    backgroundColor: 'rgba(236, 72, 153, 0.08)',
                    marginBottom: '16px'
                  }}
                >
                  <div style={{ fontSize: '11px', color: '#f472b6', fontWeight: 700, textTransform: 'uppercase' }}>
                    Courtesy Voucher Unlocked ({form.coupon?.value || 15}% Off)
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 900, color: '#ffffff', letterSpacing: '0.05em', margin: '4px 0' }}>
                    {form.coupon?.name || 'WELCOME15'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    Pre-applied automatically at checkout
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: copiedCode ? '#10b981' : '#ec4899',
                      border: 'none',
                      color: '#ffffff',
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px'
                    }}
                  >
                    {copiedCode ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copiedCode ? 'Code Copied!' : 'Copy Code & Shop'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTestSubmitted(false)}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#94a3b8',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            ) : (
              /* Entry State */
              <form onSubmit={handleTestSubmit}>
                <div style={{ display: 'inline-flex', padding: '6px 12px', borderRadius: '12px', backgroundColor: 'rgba(236, 72, 153, 0.15)', color: '#f472b6', fontSize: '11px', fontWeight: 700, marginBottom: '10px' }}>
                  <Sparkles size={11} style={{ marginRight: '4px' }} />
                  <span>Exclusive Offer</span>
                </div>

                <h3 style={{ margin: 0, fontSize: device === 'mobile' ? '18px' : '22px', fontWeight: 900, color: '#ffffff', letterSpacing: '-0.02em' }}>
                  {form.headline}
                </h3>

                <p style={{ margin: '8px 0 18px', fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
                  {form.body}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                  <input
                    type="email"
                    required
                    placeholder="Enter your email address"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#ffffff',
                      fontSize: '13px',
                      outline: 'none',
                      textAlign: 'center'
                    }}
                  />

                  {form.askPhone && (
                    <input
                      type="tel"
                      placeholder="Phone number (optional)"
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      style={{
                        padding: '10px 14px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(0, 0, 0, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#ffffff',
                        fontSize: '13px',
                        outline: 'none',
                        textAlign: 'center'
                      }}
                    />
                  )}

                  {form.askSms && (
                    <label style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px', textAlign: 'left' }}>
                      <input type="checkbox" defaultChecked />
                      <span>Send VIP text updates & early drops. Unsubscribe anytime.</span>
                    </label>
                  )}
                </div>

                <button
                  type="submit"
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: '14px',
                    fontWeight: 800,
                    cursor: 'pointer',
                    boxShadow: '0 4px 15px rgba(236, 72, 153, 0.4)'
                  }}
                >
                  {form.buttonText || 'Unlock My Offer'}
                </button>

                <div style={{ marginTop: '10px', fontSize: '11px', color: '#64748b' }}>
                  No spam. Single-click unsubscribe anytime.
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
