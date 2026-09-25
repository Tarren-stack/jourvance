import React, { useEffect, useState } from 'react';
import { authHeaders } from '../../lib/firebase';
import { card, field, ghostBtn, label, readJson, solidBtn } from './emailChrome';

type FormType = 'popup' | 'bar' | 'embed' | 'flyout' | 'page';
type Slice = { label: string; coupon: { name: string; discountType: string; value: number } };
type SignupForm = {
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
};

const TYPES: { id: FormType; label: string }[] = [
  { id: 'popup', label: 'Popup' },
  { id: 'bar', label: 'Bar' },
  { id: 'embed', label: 'Embed' },
  { id: 'flyout', label: 'Flyout' },
  { id: 'page', label: 'Full page' }
];

export const SignupForms: React.FC = () => {
  const [forms, setForms] = useState<SignupForm[]>([]);
  const [hubForms, setHubForms] = useState<number>(0);
  const [hubError, setHubError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    const data = await readJson(await fetch('/api/email/forms', { headers: await authHeaders() }));
    setForms(Array.isArray(data?.forms) ? data.forms : []);
    setHubForms(Array.isArray(data?.hubForms) ? data.hubForms.length : 0);
    setHubError(data?.hubError || '');
  };

  useEffect(() => { load(); }, []);

  const create = async (type: FormType) => {
    const res = await fetch('/api/email/forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ name: TYPES.find((row) => row.id === type)?.label || 'Form', type, buttonText: 'Join', successMessage: 'You are on the list.' })
    });
    const data = await readJson(res);
    setNotice(data?.error || 'Saved off. A new form uses double opt-in. Turn it on when the words are ready.');
    await load();
  };

  const save = async (form: SignupForm, patch: Partial<SignupForm>) => {
    const res = await fetch(`/api/email/forms/${form.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ ...form, ...patch })
    });
    const data = await readJson(res);
    setNotice(data?.error || 'Saved.');
    await load();
  };

  const remove = async (form: SignupForm) => {
    await fetch(`/api/email/forms/${form.id}`, { method: 'DELETE', headers: await authHeaders() });
    await load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, color: '#f3f4f6' }}>Signup forms</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af', maxWidth: 720 }}>
          Popup, bar, embed, flyout, or full page on this account’s published landing pages. A new form is double opt-in and stays off until you turn it on. The count is people tagged by that form.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TYPES.map((type) => (
          <button key={type.id} type="button" style={ghostBtn} onClick={() => create(type.id)}>New {type.label.toLowerCase()}</button>
        ))}
      </div>
      {forms.map((form) => <FormCard key={form.id} form={form} onSave={save} onDelete={remove} />)}
      {!forms.length && <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>No signup forms on this account yet.</p>}
      {hubForms > 0 && <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>{hubForms} form{hubForms === 1 ? '' : 's'} also exist on the email service. Those render where that service’s tracker is installed.</p>}
      {hubError && <p style={{ margin: 0, fontSize: 12, color: '#d1d5db' }}>{hubError}</p>}
      {notice && <p style={{ margin: 0, fontSize: 13, color: '#d1d5db' }} role="status">{notice}</p>}
    </div>
  );
};

const FormCard: React.FC<{
  form: SignupForm;
  onSave: (form: SignupForm, patch: Partial<SignupForm>) => void;
  onDelete: (form: SignupForm) => void;
}> = ({ form, onSave, onDelete }) => {
  const [draft, setDraft] = useState(form);
  useEffect(() => setDraft(form), [form]);
  const set = (patch: Partial<SignupForm>) => setDraft({ ...draft, ...patch });
  const rules = draft.rules || { urlContains: '', utmKey: '', utmValue: '', device: 'any' as const, hideSubmitted: true, scrollPercent: 0, exit: false, showAgainDays: 0 };
  const setRule = (patch: Partial<SignupForm['rules']>) => set({ rules: { ...rules, ...patch } });
  const [sliceLabel, setSliceLabel] = useState('');
  const [sliceCoupon, setSliceCoupon] = useState('');
  const [sliceValue, setSliceValue] = useState(10);
  const addSlice = () => {
    if (!sliceCoupon.trim() || !sliceValue) return;
    const slices = [...(draft.slices || []), { label: sliceLabel.trim() || sliceCoupon.trim(), coupon: { name: sliceCoupon.trim(), discountType: 'percentage', value: sliceValue } }];
    set({ slices });
    setSliceLabel('');
    setSliceCoupon('');
  };
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, color: '#f3f4f6' }}>{draft.name || 'Signup form'}</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{draft.type} · {form.enabled ? 'On' : 'Off'} · {form.submissions} joined</div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#e5e7eb' }}>{form.optInLabel}</p>
        </div>
        <button type="button" style={form.enabled ? solidBtn : ghostBtn} onClick={() => onSave(draft, { enabled: !form.enabled })}>{form.enabled ? 'Turn off' : 'Turn on'}</button>
      </div>
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        <label style={label}>Name</label>
        <input style={field} aria-label="Form name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        <label style={label}>Type</label>
        <select style={field} aria-label="Form type" value={draft.type} onChange={(e) => set({ type: e.target.value as FormType })}>
          {TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
        </select>
        <label style={label}>Opt-in</label>
        <select style={field} aria-label="Opt-in mode" value={draft.optIn} onChange={(e) => set({ optIn: e.target.value as SignupForm['optIn'] })}>
          <option value="double">Double opt-in</option>
          <option value="single">Single opt-in</option>
        </select>
        <label style={label}>Headline</label>
        <input style={field} aria-label="Headline" value={draft.headline} onChange={(e) => set({ headline: e.target.value })} />
        <label style={label}>Text</label>
        <textarea style={{ ...field, minHeight: 70 }} aria-label="Form text" value={draft.body} onChange={(e) => set({ body: e.target.value })} />
        <label style={label}>Button</label>
        <input style={field} aria-label="Button label" value={draft.buttonText} onChange={(e) => set({ buttonText: e.target.value })} />
        <label style={label}>Success text</label>
        <input style={field} aria-label="Success message" value={draft.successMessage} onChange={(e) => set({ successMessage: e.target.value })} />
        <label style={label}>Teaser before open</label>
        <input style={field} aria-label="Teaser" value={draft.teaser || ''} onChange={(e) => set({ teaser: e.target.value })} />
        <label style={label}>Teaser after close</label>
        <input style={field} aria-label="Teaser after close" value={draft.teaserClosed || ''} onChange={(e) => set({ teaserClosed: e.target.value })} />
        <label style={{ fontSize: 13, color: '#e5e7eb' }}>
          <input type="checkbox" checked={draft.askPhone === true} onChange={(e) => set({ askPhone: e.target.checked })} /> Optional phone field
        </label>
        <label style={{ fontSize: 13, color: '#e5e7eb' }}>
          <input type="checkbox" checked={draft.askSms === true} onChange={(e) => set({ askSms: e.target.checked })} /> Text consent box. It is posted only when they check it.
        </label>
        <label style={label}>Show when the URL contains</label>
        <input style={field} aria-label="URL contains" value={rules.urlContains || ''} onChange={(e) => setRule({ urlContains: e.target.value })} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input style={field} aria-label="UTM key" placeholder="UTM key" value={rules.utmKey || ''} onChange={(e) => setRule({ utmKey: e.target.value })} />
          <input style={field} aria-label="UTM value" placeholder="UTM value" value={rules.utmValue || ''} onChange={(e) => setRule({ utmValue: e.target.value })} />
        </div>
        <label style={label}>Device</label>
        <select style={field} aria-label="Device" value={rules.device || 'any'} onChange={(e) => setRule({ device: e.target.value as SignupForm['rules']['device'] })}>
          <option value="any">Any device</option>
          <option value="mobile">Mobile</option>
          <option value="desktop">Desktop</option>
        </select>
        <label style={{ fontSize: 13, color: '#e5e7eb' }}>Seconds before it shows
          <input style={{ ...field, marginTop: 4 }} type="number" min={0} max={120} aria-label="Delay seconds" value={draft.delaySeconds || 0} onChange={(e) => set({ delaySeconds: Number(e.target.value) })} />
        </label>
        <label style={{ fontSize: 13, color: '#e5e7eb' }}>Scroll percent
          <input style={{ ...field, marginTop: 4 }} type="number" min={0} max={100} aria-label="Scroll percent" value={rules.scrollPercent || 0} onChange={(e) => setRule({ scrollPercent: Number(e.target.value) })} />
        </label>
        <label style={{ fontSize: 13, color: '#e5e7eb' }}>
          <input type="checkbox" checked={rules.exit === true} onChange={(e) => setRule({ exit: e.target.checked })} /> Wait for the exit signal
        </label>
        <label style={{ fontSize: 13, color: '#e5e7eb' }}>
          <input type="checkbox" checked={rules.hideSubmitted !== false} onChange={(e) => setRule({ hideSubmitted: e.target.checked })} /> Hide after they submit
        </label>
        <label style={{ fontSize: 13, color: '#e5e7eb' }}>Show again after this many days. 0 keeps the teaser until they open it.
          <input style={{ ...field, marginTop: 4 }} type="number" min={0} max={365} aria-label="Show again after days" value={rules.showAgainDays || 0} onChange={(e) => setRule({ showAgainDays: Number(e.target.value) })} />
        </label>
        <label style={{ fontSize: 13, color: '#e5e7eb' }}>
          <input type="checkbox" checked={draft.testEnabled === true} onChange={(e) => set({ testEnabled: e.target.checked })} /> Publish the A/B test. It stays off until this is checked.
        </label>
        <label style={label}>Second headline</label>
        <input style={field} aria-label="Second headline" value={draft.variantB?.headline || ''} onChange={(e) => set({ variantB: { ...draft.variantB, headline: e.target.value } })} />
        <label style={label}>Success coupon name</label>
        <input style={field} aria-label="Coupon name" value={draft.coupon?.name || ''} onChange={(e) => set({ coupon: { name: e.target.value, discountType: draft.coupon?.discountType || 'percentage', value: draft.coupon?.value || 0 } })} />
        <label style={{ fontSize: 13, color: '#e5e7eb' }}>Coupon percent
          <input style={{ ...field, marginTop: 4 }} type="number" min={0} max={100} aria-label="Coupon percent" value={draft.coupon?.value || 0} onChange={(e) => set({ coupon: { name: draft.coupon?.name || '', discountType: 'percentage', value: Number(e.target.value) } })} />
        </label>
        <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>The code is created once, after a real submit. A preview does not create one.</p>
        <div style={label}>Spin slices</div>
        {(draft.slices || []).map((slice, index) => (
          <div key={`${slice.label}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, color: '#e5e7eb' }}>
            <span>{slice.label} · {slice.coupon?.name}</span>
            <button type="button" style={ghostBtn} onClick={() => set({ slices: draft.slices.filter((_, i) => i !== index) })}>Remove</button>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px auto', gap: 8 }}>
          <input style={field} aria-label="Slice label" placeholder="Slice label" value={sliceLabel} onChange={(e) => setSliceLabel(e.target.value)} />
          <input style={field} aria-label="Slice coupon" placeholder="Coupon name" value={sliceCoupon} onChange={(e) => setSliceCoupon(e.target.value)} />
          <input style={field} aria-label="Slice percent" type="number" min={1} max={100} value={sliceValue} onChange={(e) => setSliceValue(Number(e.target.value))} />
          <button type="button" style={ghostBtn} disabled={!sliceCoupon.trim() || !sliceValue} onClick={addSlice}>Add slice</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={ghostBtn} onClick={() => onSave(draft, {})}>Save</button>
          <button type="button" style={ghostBtn} onClick={() => onDelete(form)}>Delete</button>
        </div>
      </div>
    </div>
  );
};
