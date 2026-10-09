import React, { useEffect, useState } from 'react';
import {
  MessageSquare, Smartphone, Clock, ShieldCheck, Sparkles,
  CheckCircle2, AlertTriangle, ArrowRight, Lock, Bell, Check, Users
} from 'lucide-react';
import { authHeaders } from '../../lib/firebase';
import { card, field, ghostBtn, label, solidBtn } from './emailChrome';
import { SMS_STARTERS, smsStarterText, type SmsStarterId } from '../../lib/offerPresets';
import { LIST_LOADING, PHONES_READ, TEXTS_HOLDS, TEXTS_READ, readOutcome, studioRead, type ListState } from '../../lib/studioLoad';
import { StudioListLine } from './StudioListLine';

type SmsStatus = {
  configured?: boolean;
  live?: boolean;
  provider?: string;
  from?: string;
  mode?: string;
  stats?: { optedIn?: number; optedOut?: number };
};

export const SmsPanel: React.FC = () => {
  const [status, setStatus] = useState<SmsStatus | null>(null);
  const [phoneCount, setPhoneCount] = useState<number>(0);
  const [totalContacts, setTotalContacts] = useState<number>(0);
  // The composer starts empty and a starter draft names no code, amount or gift: the old ones
  // offered WELCOMEBACK15, 15% and 10% off and a free gift the store may not have (T13). A code
  // goes in only when the merchant types their own below.
  const [message, setMessage] = useState<string>('');
  const [starterCode, setStarterCode] = useState<string>('');
  const [notifyMe, setNotifyMe] = useState(false);
  const [notifiedMsg, setNotifiedMsg] = useState(false);
  // D6 (Wave 6): a failed status read says so on screen (it was a console warning only), and the phone
  // count is shown only from an audience the server answered with, never a 0 nobody measured.
  const [statusLoad, setStatusLoad] = useState<ListState>(LIST_LOADING);
  const [audienceLoad, setAudienceLoad] = useState<ListState>(LIST_LOADING);
  const [reading, setReading] = useState(false);

  const load = async () => {
    setReading(true);
    try {
      const headers = await authHeaders();
      const [stateRead, audRead] = await Promise.all([
        studioRead('/api/sms/status', headers),
        studioRead('/api/email/audience', headers)
      ]);
      const statusOutcome = readOutcome(stateRead, TEXTS_READ, TEXTS_HOLDS);
      setStatusLoad(statusOutcome);
      if (statusOutcome.state === 'loaded' && stateRead.answered) setStatus(stateRead.data);
      const audienceOutcome = readOutcome(audRead, PHONES_READ, (data) => Array.isArray(data.subscribers));
      setAudienceLoad(audienceOutcome);
      if (audienceOutcome.state === 'loaded' && audRead.answered) {
        const subscribers: any[] = audRead.data.subscribers;
        setTotalContacts(subscribers.length);
        setPhoneCount(subscribers.filter((s: any) => Boolean(s.phone && String(s.phone).trim())).length);
      }
    } finally {
      setReading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleApplyPreset = (preset: SmsStarterId) => {
    setMessage(smsStarterText(preset, starterCode));
  };

  const handleNotifyToggle = () => {
    setNotifyMe(!notifyMe);
    if (!notifyMe) {
      setNotifiedMsg(true);
      setTimeout(() => setNotifiedMsg(false), 3000);
    }
  };

  // Character calculation
  const charLength = message.length;
  const segments = Math.max(1, Math.ceil(charLength / 160));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '980px', margin: '0 auto' }}>
      {/* Header with Carrier Status Badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f3f4f6' }}>
              SMS Marketing & VIP Text Drops
            </h2>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 10px',
                borderRadius: '12px',
                backgroundColor: 'rgba(234, 179, 8, 0.12)',
                border: '1px solid rgba(234, 179, 8, 0.3)',
                color: '#fde047',
                fontSize: '11px',
                fontWeight: 600
              }}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#facc15' }} />
              Carrier Verification in Progress
            </span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#9ca3af', lineHeight: 1.5, maxWidth: '640px' }}>
            Send announcements, VIP texts and winback check-ins directly to your clients' mobile phones with industry-leading 98% open rates.
          </p>
          {statusLoad.state === 'failed' && (
            <div style={{ marginTop: '10px' }}>
              <StudioListLine line={{ kind: 'failed', text: statusLoad.text, retry: statusLoad.retry }} onRetry={load} busy={reading} />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleNotifyToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            padding: '8px 14px',
            borderRadius: '8px',
            border: notifyMe ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(236, 72, 153, 0.4)',
            backgroundColor: notifyMe ? 'rgba(16, 185, 129, 0.15)' : 'rgba(236, 72, 153, 0.15)',
            color: notifyMe ? '#34d399' : '#f9a8d4',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          {notifyMe ? <Check size={14} /> : <Bell size={14} />}
          <span>{notifyMe ? 'Carrier Launch Alert Active' : 'Notify Me on Carrier Live'}</span>
        </button>
      </div>

      {notifiedMsg && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#34d399',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <CheckCircle2 size={16} />
          <span>You’re on the priority notification list! Direct sending will unlock the moment US cellular carriers approve the sending gateway.</span>
        </div>
      )}

      {/* Telecom Verification Roadmap Card */}
      <div
        style={{
          backgroundColor: '#121217',
          borderRadius: '14px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '20px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <ShieldCheck size={16} style={{ color: '#ec4899' }} />
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#f3f4f6', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Managed Carrier Gateway Roadmap (US 10DLC A2P & Toll-Free)
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
          {/* Step 1 */}
          <div style={{ padding: '14px', borderRadius: '10px', backgroundColor: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399', fontSize: '13px', fontWeight: 600 }}>
              <CheckCircle2 size={16} /> 1. SMS Engine Ready
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#9ca3af', lineHeight: 1.4 }}>
              TCPA opt-in consent registry, quiet hours (8pm–11am), GSM-7 character counter, and link shorteners are built and tested.
            </p>
          </div>

          {/* Step 2 */}
          <div style={{ padding: '14px', borderRadius: '10px', backgroundColor: 'rgba(234, 179, 8, 0.06)', border: '1px solid rgba(234, 179, 8, 0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#facc15', fontSize: '13px', fontWeight: 600 }}>
              <Clock size={16} /> 2. Carrier Vetting in Review
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#9ca3af', lineHeight: 1.4 }}>
              Twilio 10DLC A2P registration is submitted to US mobile carriers (AT&T, Verizon, T-Mobile) for telecom routing approval.
            </p>
          </div>

          {/* Step 3 */}
          <div style={{ padding: '14px', borderRadius: '10px', backgroundColor: 'rgba(168, 85, 247, 0.06)', border: '1px solid rgba(168, 85, 247, 0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#c084fc', fontSize: '13px', fontWeight: 600 }}>
              <Sparkles size={16} /> 3. Automatic 1-Click Launch
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#9ca3af', lineHeight: 1.4 }}>
              As soon as carrier registration clears, direct text dispatch unlocks automatically for your store with zero setup needed.
            </p>
          </div>
        </div>

        <p style={{ margin: '14px 0 0', fontSize: '11px', color: '#6b7280', lineHeight: 1.4 }}>
          We handle 100% of cellular telecom compliance behind the scenes so you never have to navigate confusing carrier forms, EIN verification, or developer APIs.
        </p>
      </div>

      {/* Main Interactive Sandbox Grid: Composer (Left) & Phone Preview (Right). On a phone the
          preview stacks under the composer rather than scrolling the page sideways (U08). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '20px' }}>
        {/* Left Column: Interactive Composer & Presets */}
        <div
          style={{
            backgroundColor: '#121217',
            borderRadius: '14px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Text Sandbox
            </div>
            <span style={{ fontSize: '11px', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Smartphone size={12} /> Live Preview
            </span>
          </div>

          {/* Starter drafts: plain words with no offer. The merchant's own code is added only when typed. */}
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <label htmlFor="sms-starter-code" style={{ fontSize: '11px', color: '#9ca3af', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                Your discount code (optional)
                <input
                  id="sms-starter-code"
                  type="text"
                  value={starterCode}
                  onChange={e => setStarterCode(e.target.value.trim().slice(0, 40))}
                  placeholder="A code that exists in your store"
                  style={{ width: '220px', maxWidth: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.12)', backgroundColor: 'rgba(0, 0, 0, 0.35)', color: '#ffffff', fontSize: '12px' }}
                />
              </label>
            </div>
            <div id="sms-starter-hint" style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '6px' }}>Starter drafts (edit before sending):</div>
            <div role="group" aria-labelledby="sms-starter-hint" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {SMS_STARTERS.map((starter, index) => {
                const tone = [
                  { border: 'rgba(245, 158, 11, 0.3)', bg: 'rgba(245, 158, 11, 0.08)', color: '#fef3c7' },
                  { border: 'rgba(168, 85, 247, 0.3)', bg: 'rgba(168, 85, 247, 0.08)', color: '#e9d5ff' },
                  { border: 'rgba(16, 185, 129, 0.3)', bg: 'rgba(16, 185, 129, 0.08)', color: '#a7f3d0' }
                ][index % 3];
                return (
                  <button
                    key={starter.id}
                    type="button"
                    onClick={() => handleApplyPreset(starter.id)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '6px',
                      border: `1px solid ${tone.border}`,
                      backgroundColor: tone.bg,
                      color: tone.color,
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {starter.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Message Textarea */}
          <div>
            <textarea
              rows={4}
              value={message}
              onChange={e => setMessage(e.target.value)}
              aria-label="Text message"
              placeholder="Write your text, or pick a starter draft above. {{first_name}} becomes the customer's first name."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                backgroundColor: 'rgba(0, 0, 0, 0.35)',
                color: '#ffffff',
                fontSize: '13px',
                lineHeight: 1.4,
                outline: 'none',
                resize: 'vertical'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
              <span>{charLength} characters ({segments} {segments === 1 ? 'credit' : 'credits'})</span>
              <span>GSM-7 standard (160 chars / credit)</span>
            </div>
          </div>

          {/* Compliance Safeguards */}
          <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontSize: '11px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={13} /> TCPA Compliance: Automatic STOP opt-out suffix included.
            </div>
            <div style={{ fontSize: '11px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={13} /> Quiet Hours Protected: Texts hold between 8:00 PM and 11:00 AM recipient local time.
            </div>
          </div>

          {/* Disabled Launch Button */}
          <div>
            <button
              type="button"
              disabled
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                color: '#6b7280',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <Lock size={14} /> Direct Dispatch Unlocks Upon Carrier Verification
            </button>
            <div style={{ fontSize: '11px', color: '#6b7280', textAlign: 'center', marginTop: '6px' }}>
              All sending endpoints are pre-wired. No code changes needed once carrier approval clears.
            </div>
          </div>
        </div>

        {/* Right Column: Smartphone Mockup */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '10px'
          }}
        >
          {/* Phone Frame */}
          <div
            style={{
              width: '280px',
              maxWidth: '100%',
              height: '460px',
              backgroundColor: '#000000',
              borderRadius: '36px',
              border: '4px solid #27272a',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.7)',
              padding: '16px 14px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              position: 'relative'
            }}
          >
            {/* Speaker & Camera Notch */}
            <div
              style={{
                position: 'absolute',
                top: '10px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '70px',
                height: '14px',
                backgroundColor: '#18181b',
                borderRadius: '10px'
              }}
            />

            {/* Phone Header */}
            <div style={{ marginTop: '16px', textAlign: 'center' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  backgroundColor: '#a855f7',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '13px',
                  fontWeight: 700,
                  margin: '0 auto 4px'
                }}
              >
                JV
              </div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#f3f4f6' }}>Jourvance VIP</div>
              <div style={{ fontSize: '11px', color: '#6b7280' }}>SMS Text Message</div>
            </div>

            {/* Message Bubble Stream */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '8px' }}>
              <div style={{ fontSize: '11px', color: '#6b7280', textAlign: 'center' }}>Today 2:15 PM</div>
              <div
                style={{
                  backgroundColor: '#27272a',
                  color: '#ffffff',
                  padding: '10px 12px',
                  borderRadius: '14px 14px 14px 4px',
                  fontSize: '11px',
                  lineHeight: 1.4,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                  wordBreak: 'break-word'
                }}
              >
                {message.trim()
                  ? message.split('{{first_name}}').join('Sarah')
                  : <span style={{ color: '#9ca3af' }}>Your message appears here.</span>}
                <div style={{ marginTop: '6px', fontSize: '11px', color: '#9ca3af' }}>
                  Reply STOP to opt out
                </div>
              </div>
            </div>

            {/* Phone Footer Home Bar */}
            <div
              style={{
                width: '80px',
                height: '3px',
                backgroundColor: '#52525b',
                borderRadius: '2px',
                margin: '0 auto 4px'
              }}
            />
          </div>

          {/* CRM Readiness Callout */}
          <div style={{ marginTop: '14px', textAlign: 'center' }}>
            {/* A failed count says so with Retry where it can help, even when the status read loaded. When
                the status read failed too, its alert above (whose Retry reads both) is the one alert. */}
            {audienceLoad.state === 'failed' && statusLoad.state !== 'failed' ? (
              <StudioListLine line={{ kind: 'failed', text: audienceLoad.text, retry: audienceLoad.retry }} onRetry={load} busy={reading} />
            ) : (
              <span style={{ fontSize: '11px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'center' }}>
                <Users size={12} style={{ color: '#c084fc' }} />
                {audienceLoad.state === 'loaded'
                  ? <><strong>{phoneCount}</strong> of {totalContacts} contacts have phones on file</>
                  : audienceLoad.state === 'failed' ? audienceLoad.text : 'Counting contacts with a phone.'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
