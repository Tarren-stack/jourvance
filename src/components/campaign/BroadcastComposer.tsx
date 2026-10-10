import React, { useEffect, useRef, useState } from 'react';
import { auth, authHeaders } from '../../lib/firebase';
import { withNote } from '../../lib/emailStats';
import { settleRead, sendFlowWrite } from '../../lib/flowMapLoad';
import { retryLabel } from '../../lib/studioLoad';
import { noteBroadcastUnsaved, warnBeforeUnload } from '../../lib/studioLeave';
import {
  audienceOptions, blocksHaveContent, bodyBlocks, campaignSendBody, confirmSendText, draftFromStored, draftHasContent, draftRequestBody,
  draftSnapshot, emptyBroadcastDraft, lintSummary, looksLikeAddress, previewKey, testSendBody,
  type AudienceOption, type BroadcastDraft, type BroadcastSettings, type BroadcastWhen
} from '../../lib/broadcastComposer';
import { BlockEditor, type LibraryRow, type MailBlock } from './EmailBlocks';
import { card, field, ghostBtn, label, readJson, solidBtn } from './emailChrome';

/**
 * The broadcast composer (EMAIL_STUDIO_PLAN.md Wave 5, D4): Broadcasts, New broadcast. One screen
 * that is the builder (BlockEditor, with the account's saved blocks) plus who gets it, when, A/B,
 * holdout and the text add-on, which were the retired textarea modal's. It sends through
 * POST /api/email/campaign/send with the blocks, saves drafts at /api/email/broadcast-drafts, and
 * asks before Send or Schedule, naming the audience count the server reported.
 *
 * The draft lives in HubEmailSuite (useBroadcastDraft), so leaving Broadcasts for another section
 * and coming back finds it as it was; only a saved draft survives a reload, and while an unsaved one
 * has something in it the browser asks before a reload or a closed tab drops it.
 */

/** The written drafts a merchant can start from (Audience, a customer, or the composer's own group). */
export type BroadcastPreset = 'whales' | 'at_risk' | 'lapsed' | 'whale_perk' | 'at_risk_winback' | 'lead_welcome' | 'personal';

export interface BroadcastPerson {
  firstName?: string;
  signOff?: string;
}

export interface BroadcastDraftState {
  draft: BroadcastDraft;
  /** True when the draft differs from what was last saved, opened or started. */
  dirty: boolean;
  patch: (next: Partial<Omit<BroadcastDraft, 'settings'>>) => void;
  patchSettings: (next: Partial<BroadcastSettings>) => void;
  /** Starts the composer on a stored draft, or on a new broadcast. Either way nothing is unsaved yet. */
  start: (from?: BroadcastDraft) => void;
  /** After a save: the id the server gave it, and the content that was sent to be saved. */
  markSaved: (id: string, snapshot: string) => void;
  /** A draft deleted elsewhere: the composer keeps the content and saves it as a new draft next time. */
  forget: (id: string) => void;
  startPreset: (kind: BroadcastPreset, person?: BroadcastPerson) => void;
}

/** The composer's draft, held by the studio so it outlives a switch between sections. */
export function useBroadcastDraft(): BroadcastDraftState {
  const [draft, setDraft] = useState<BroadcastDraft>(emptyBroadcastDraft);
  const [savedAs, setSavedAs] = useState<string>(() => draftSnapshot(emptyBroadcastDraft()));
  const setBroadcastSubject = (subject: string) => setDraft((d) => ({ ...d, subject }));
  const setBroadcastPreviewText = (previewText: string) => setDraft((d) => ({ ...d, previewText }));
  const setBroadcastBody = (text: string) => setDraft((d) => ({ ...d, blocks: bodyBlocks(text) }));
  const setBroadcastAudience = (include: string) => setDraft((d) => ({ ...d, settings: { ...d.settings, include } }));
  const start = (from?: BroadcastDraft) => {
    const next = from || emptyBroadcastDraft();
    setDraft(next);
    setSavedAs(draftSnapshot(next));
  };
  const startPreset = (kind: BroadcastPreset, person: BroadcastPerson = {}) => {
    start();
    const first = person.firstName || 'there';
    const from = person.signOff || 'Your Care Team';
    // Drafts name no gift, code or percentage: an offer is the merchant's to write, and only if it exists (R24).
    if (kind === 'whales') {
      setBroadcastAudience('whales');
      setBroadcastSubject('A thank-you to our most loyal clients');
      setBroadcastPreviewText('A personal message from us');
      setBroadcastBody('Hello lovely,\n\nAs one of our most valued clients, we wanted to say thank you.\n\nReplace this text with your real message before anyone receives it. Mention a gift or discount only if it exists in your store.');
    } else if (kind === 'at_risk') {
      setBroadcastAudience('at_risk');
      setBroadcastSubject('It has been a little while');
      setBroadcastPreviewText("We'd love to welcome you back");
      setBroadcastBody('Hello lovely,\n\nWe noticed it’s been a little while since your last visit, and we wanted to check in.\n\nReplace this text with your real message before anyone receives it. Mention a discount only if the code exists in your store.');
    } else if (kind === 'lapsed') {
      setBroadcastAudience('lapsed');
      setBroadcastSubject('A warm invitation back');
      setBroadcastPreviewText("A warm welcome whenever you're ready");
      setBroadcastBody('Hello lovely,\n\nIt’s been some time since your last order, and we wanted to send a warm message your way.\n\nReplace this text with your real message before anyone receives it. Mention a discount only if the code exists in your store.');
    } else if (kind === 'whale_perk') {
      setBroadcastSubject('A personal thank-you');
      setBroadcastPreviewText('A message for one of our most valued clients');
      setBroadcastBody(`Hi ${first},\n\nAs one of our most valued clients, we wanted to personally say thank you.\n\nReplace this text with your real message before anyone receives it. Mention a gift or discount only if it exists in your store.\n\nWith gratitude,\n${from}`);
    } else if (kind === 'at_risk_winback') {
      setBroadcastSubject('We would love to welcome you back');
      setBroadcastPreviewText('It has been a little while');
      setBroadcastBody(`Hi ${first},\n\nIt has been a while since your last order, and we would love to welcome you back.\n\nReplace this text with your real message before anyone receives it. Mention a discount only if the code exists in your store.\n\nWarmly,\n${from}`);
    } else if (kind === 'lead_welcome') {
      setBroadcastSubject('Welcome, and thank you for joining');
      setBroadcastPreviewText('A quick hello from us');
      setBroadcastBody(`Hi ${first},\n\nThank you for joining our community!\n\nReplace this text with your real message before anyone receives it. Mention a discount only if the code exists in your store.\n\nWarmly,\n${from}`);
    } else {
      setBroadcastSubject(`A personal message for ${person.firstName || 'you'}`);
      setBroadcastPreviewText('Checking in on your latest order');
      setBroadcastBody(`Hi ${first},\n\nWe wanted to follow up and see how you are enjoying your order.\n\nWarmly,\n${from}`);
    }
  };
  const dirty = draftSnapshot(draft) !== savedAs;
  // A reload or a closed tab drops an email nobody saved, so the browser asks first while there is one.
  // The draft lives in the studio, so this holds from any section of it.
  const unsaved = dirty && draftHasContent(draft);
  useEffect(() => {
    if (!unsaved) return;
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [unsaved]);
  // Open list: leaving Email Studio drops this draft too (it lives in the studio, which unmounts), so
  // App's ways out ask first, in one question with an unsaved flow edit (studioLeave.ts leaveStudioOk).
  // The studio's own tabs keep the draft and do not ask. Cleared when the studio closes.
  useEffect(() => { noteBroadcastUnsaved(unsaved); }, [unsaved]);
  useEffect(() => () => noteBroadcastUnsaved(false), []);
  return {
    draft,
    dirty,
    patch: (next) => setDraft((d) => ({ ...d, ...next })),
    patchSettings: (next) => setDraft((d) => ({ ...d, settings: { ...d.settings, ...next } })),
    start,
    markSaved: (id, snapshot) => {
      setDraft((d) => ({ ...d, id }));
      setSavedAs(snapshot);
    },
    forget: (id) => setDraft((d) => (d.id === id ? { ...d, id: '' } : d)),
    startPreset
  };
}

/** A send's requestId: random, and in the characters campaign/send keeps. */
const newRequestId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);

/** What Start from a written draft asks before it replaces an email that has something in it. */
export const COMPOSER_REPLACE = 'Replace the broadcast you are writing? Changes that are not saved as a draft will be lost.';

type AudienceLoad =
  | { state: 'loading' }
  | { state: 'loaded'; segments: any[]; lists: any[]; listsFailed: boolean }
  | { state: 'failed'; text: string; retry: boolean };

type Busy = '' | 'save' | 'send' | 'preview' | 'check' | 'test';

const section: React.CSSProperties = { ...card, display: 'flex', flexDirection: 'column', gap: 10 };
const h3: React.CSSProperties = { margin: 0, fontSize: 15, fontWeight: 700, color: '#f3f4f6' };
const note: React.CSSProperties = { margin: 0, fontSize: 12, color: '#9ca3af', lineHeight: 1.45 };
const said: React.CSSProperties = { margin: 0, fontSize: 13, color: '#d1d5db', lineHeight: 1.45 };
const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#d1d5db' };
const check: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#e5e7eb' };
const tall: React.CSSProperties = { minHeight: 44 };
const group: React.CSSProperties = { ...card, padding: '4px 16px 12px' };
const summary: React.CSSProperties = { display: 'list-item', cursor: 'pointer', padding: '12px 0 4px', fontSize: 14, fontWeight: 700, color: '#f3f4f6' };

/** A select with its label beside it, joined by id: a label wrapped round a select also reads every option. */
const Pick: React.FC<{ id: string; text: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ id, text, style, children }) => (
  <div style={{ ...fieldLabel, ...style }}>
    <label htmlFor={id}>{text}</label>
    {children}
  </div>
);

// Open list: the option says when, and the button alone says Send now, so the two never share a name.
const WHEN_LABEL: Record<BroadcastWhen, string> = {
  now: 'Right away',
  clock: 'At a clock time',
  gradual: 'Gradual',
  smart: 'At each person’s hour'
};

export const BroadcastComposer: React.FC<{
  composer: BroadcastDraftState;
  workspaceId?: string;
  /** Opened from a button (New broadcast, a draft, a written draft): focus moves to the heading once. */
  focusHeading?: boolean;
  onHeadingFocused?: () => void;
  /** After campaign/send answered success: the server's own sentence. */
  onSent: (message: string) => void;
}> = ({ composer, workspaceId, focusHeading, onHeadingFocused, onSent }) => {
  const { draft, patch, patchSettings } = composer;
  const s = draft.settings;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [library, setLibrary] = useState<LibraryRow[]>([]);
  const [libraryNote, setLibraryNote] = useState('');
  const [audience, setAudience] = useState<AudienceLoad>({ state: 'loading' });
  const [busy, setBusy] = useState<Busy>('');
  const [status, setStatus] = useState('');
  // `key` is what the preview was made from (previewKey), so an edit after it hides it rather than showing an old email.
  const [preview, setPreview] = useState<{ html: string; label: string; untranslated: string[]; hidden: number; key: string } | null>(null);
  // A preview that could not be made, said beside the Preview button.
  const [previewNote, setPreviewNote] = useState('');
  // The send the merchant confirmed and what it sent: kept while the server has not answered, so Send
  // again for the same email carries the same requestId and campaign/send refuses a second copy.
  const pendingSend = useRef<{ id: string; snapshot: string } | null>(null);
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [checkNote, setCheckNote] = useState('');
  const [testAddress, setTestAddress] = useState(() => auth.currentUser?.email || '');
  const [testNote, setTestNote] = useState('');
  const [openGroups, setOpenGroups] = useState(() => ({
    measure: s.abVariable !== '' || s.holdoutOn,
    text: s.smsMessage.trim() !== '',
    links: Boolean(s.utmSource || s.utmCampaign),
    written: false
  }));

  useEffect(() => {
    if (!focusHeading) return;
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    onHeadingFocused?.();
  }, []);

  // The saved-block library, read the way the old Builder read it: GET /api/email/suite, suite.library.
  const loadLibrary = async () => {
    const read = await settleRead(async () => {
      const res = await fetch('/api/email/suite', { headers: await authHeaders() });
      return { ok: res.ok, data: await readJson(res) };
    });
    if (read.answered && read.data.ok && Array.isArray(read.data.data?.suite?.library)) {
      setLibrary(read.data.data.suite.library);
      setLibraryNote('');
    } else {
      setLibraryNote('Saved blocks could not be loaded, so none are offered here.');
    }
  };

  // Who can get it: GET /api/email/segments (each count is the server's) and GET /api/email/lists.
  const loadAudience = async () => {
    setAudience({ state: 'loading' });
    const headers = await authHeaders();
    const [segs, lists] = await Promise.all([
      settleRead(async () => {
        const res = await fetch('/api/email/segments', { headers });
        return { status: res.status, data: await readJson(res) };
      }),
      settleRead(async () => {
        const res = await fetch('/api/email/lists', { headers });
        return { status: res.status, data: await readJson(res) };
      })
    ]);
    if (!segs.answered) {
      setAudience({ state: 'failed', text: 'The segments could not be loaded. The server did not answer.', retry: true });
      return;
    }
    if (segs.data.status === 401) {
      setAudience({ state: 'failed', text: 'Sign in to choose who gets this broadcast.', retry: false });
      return;
    }
    if (!segs.data.data?.success || !Array.isArray(segs.data.data.segments)) {
      setAudience({ state: 'failed', text: 'The segments could not be loaded. Try again in a minute.', retry: true });
      return;
    }
    const listsOk = lists.answered && lists.data.data?.success === true && Array.isArray(lists.data.data.lists);
    setAudience({ state: 'loaded', segments: segs.data.data.segments, lists: listsOk ? lists.data.data.lists : [], listsFailed: !listsOk });
  };

  useEffect(() => {
    loadLibrary();
    loadAudience();
  }, []);

  const options: AudienceOption[] = audience.state === 'loaded' ? audienceOptions(audience.segments, audience.lists) : [];
  const known = (id: string) => options.some((row) => row.id === id);

  const saveCopy = async (block: MailBlock) => {
    const sent = await sendFlowWrite(async () => fetch('/api/email/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ name: block.kind, block })
    }));
    if (!sent.answered) {
      setLibraryNote('The server did not answer, so that block may not be saved.');
      return;
    }
    if (Array.isArray(sent.data?.library)) setLibrary(sent.data.library);
    setLibraryNote(sent.ok ? 'Saved a copy of that block.' : (sent.data?.error || 'That block was not saved.'));
  };

  const deleteCopy = async (id: string) => {
    const sent = await sendFlowWrite(async () => fetch(`/api/email/library/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeaders() }));
    if (!sent.answered) {
      setLibraryNote('The server did not answer, so that saved block may not be deleted.');
      return;
    }
    if (Array.isArray(sent.data?.library)) setLibrary(sent.data.library);
    setLibraryNote(sent.ok ? 'Deleted that saved block.' : (sent.data?.error || 'That saved block was not deleted.'));
  };

  // POST /api/email/programs/preview over the blocks on screen, saved or not. Nothing is sent.
  const render = async (merge: 'sample' | 'keep') => settleRead(async () => {
    const res = await fetch('/api/email/programs/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ subject: draft.subject, blocks: draft.blocks, merge, previewText: draft.previewText })
    });
    return { ok: res.ok, data: await readJson(res) };
  });

  const showPreview = async () => {
    if (busy) return;
    setBusy('preview');
    const key = previewKey(draft);
    try {
      const read = await render('sample');
      if (!read.answered) {
        setPreview(null);
        setPreviewNote('The server did not answer, so there is no preview.');
        return;
      }
      if (!read.data.ok || typeof read.data.data?.html !== 'string' || !read.data.data.html) {
        setPreview(null);
        setPreviewNote(read.data.data?.error || 'The preview could not be made.');
        return;
      }
      const d = read.data.data;
      setPreview({ html: d.html, label: d.label || 'Sample preview. Nothing was sent.', untranslated: Array.isArray(d.untranslated) ? d.untranslated : [], hidden: Number(d.hidden) || 0, key });
      setPreviewNote('');
    } finally {
      setBusy('');
    }
  };

  const runCheck = async () => {
    if (busy) return;
    setBusy('check');
    setCheckNote('');
    try {
      const read = await render('keep');
      if (!read.answered || !read.data.ok || typeof read.data.data?.html !== 'string') {
        setCheckNote(read.answered ? (read.data.data?.error || 'The email could not be made, so it was not checked.') : 'The server did not answer, so the email was not checked.');
        return;
      }
      const checked = await sendFlowWrite(async () => fetch('/api/email/lint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ subject: draft.subject, html: read.data.data.html })
      }));
      if (!checked.answered) {
        setCheckNote('The server did not answer, so the email was not checked.');
        return;
      }
      setCheckNote(lintSummary(checked.data));
    } finally {
      setBusy('');
    }
  };

  // A test is the email the preview route renders from the blocks, with sample names, to one address.
  // POST /api/email/send takes html (server.mjs hands its body to hub.email.send), so the blocks go
  // through the same renderer the preview uses and the html is what is sent.
  const sendTest = async () => {
    if (busy) return;
    if (!looksLikeAddress(testAddress)) {
      setTestNote('Enter your email address to send a test.');
      return;
    }
    if (!draft.subject.trim()) {
      setTestNote('Add a subject before sending a test.');
      return;
    }
    setBusy('test');
    setTestNote('Sending a test.');
    try {
      const read = await render('sample');
      if (!read.answered || !read.data.ok || typeof read.data.data?.html !== 'string' || !read.data.data.html) {
        setTestNote(read.answered ? (read.data.data?.error || 'The email could not be made, so no test was sent.') : 'The server did not answer, so no test was sent.');
        return;
      }
      const sent = await sendFlowWrite(async () => fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(testSendBody(testAddress, String(read.data.data.subject || draft.subject), read.data.data.html))
      }));
      if (!sent.answered) {
        setTestNote('The server did not answer, so the test may not have been sent.');
        return;
      }
      if (sent.ok && sent.data?.success) {
        setTestNote(`The email service accepted a test to ${testAddress.trim()}. Names and products in it are samples.`);
        return;
      }
      const notConnected = /not connected/i.test(String(sent.data?.error || ''));
      setTestNote(notConnected ? 'A test cannot be sent while email sending is not connected.' : (sent.data?.error || 'The test was not sent.'));
    } finally {
      setBusy('');
    }
  };

  const saveDraft = async () => {
    if (busy) return;
    if (!draftHasContent(draft)) {
      setStatus('There is nothing in this draft yet. Add a subject or a block first.');
      return;
    }
    setBusy('save');
    setStatus('Saving the draft.');
    const snapshot = draftSnapshot(draft);
    try {
      const sent = await sendFlowWrite(async () => fetch('/api/email/broadcast-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(draftRequestBody(draft))
      }));
      if (!sent.answered) {
        setStatus('The server did not answer, so this draft may not be saved.');
        return;
      }
      if (sent.ok && sent.data?.success && typeof sent.data.draft?.id === 'string') {
        composer.markSaved(sent.data.draft.id, snapshot);
        setStatus('Draft saved. It is under Drafts in All broadcasts, and nothing was sent.');
        return;
      }
      if (draft.id && sent.data?.error && /not on this account/.test(sent.data.error)) {
        composer.forget(draft.id);
        setStatus('That draft is no longer on this account. Save draft again to keep this as a new draft.');
        return;
      }
      setStatus(sent.data?.error || 'This draft was not saved.');
    } finally {
      setBusy('');
    }
  };

  const send = async () => {
    if (busy) return;
    if (!draft.subject.trim()) {
      setStatus('Add a subject before sending.');
      return;
    }
    // A blank heading and paragraph are not an email; campaign/send refuses them too (CAMPAIGN_EMAIL_EMPTY).
    if (!blocksHaveContent(draft.blocks)) {
      setStatus('Add words, a picture or a button to the email before sending.');
      return;
    }
    // Nobody can see who gets it until the segments load, so nothing goes out before they have.
    if (audience.state !== 'loaded') {
      setStatus(audience.state === 'loading'
        ? 'Who gets it is still loading, so nothing was sent. Try again in a moment.'
        : 'Who gets it could not be loaded, so nothing was sent. See Who gets it above.');
      return;
    }
    if ((s.sendWhen === 'clock' || s.sendWhen === 'gradual') && !s.sendAt) {
      setStatus('Choose a date and time before scheduling.');
      return;
    }
    if (!window.confirm(confirmSendText(draft, options))) {
      setStatus('Nothing was sent.');
      return;
    }
    const snapshot = draftSnapshot(draft);
    if (!pendingSend.current || pendingSend.current.snapshot !== snapshot) pendingSend.current = { id: newRequestId(), snapshot };
    const requestId = pendingSend.current.id;
    setBusy('send');
    setStatus(s.sendWhen === 'now' ? 'Sending.' : 'Scheduling.');
    try {
      const sent = await sendFlowWrite(async () => fetch('/api/email/campaign/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(campaignSendBody(draft, workspaceId, requestId))
      }));
      if (!sent.answered) {
        setStatus('The server did not answer, so this broadcast may or may not have gone out. Look in All broadcasts before sending it again.');
        return;
      }
      // The server answered: unless it says this send was already taken, the next Send is a new one.
      if (!sent.data?.duplicate) pendingSend.current = null;
      if (!sent.ok || !sent.data?.success) {
        setStatus(sent.data?.error || 'This broadcast was not sent.');
        return;
      }
      let message = [sent.data.message, sent.data.smartReport].filter(Boolean).join(' ') || 'Done.';
      if (draft.id) {
        const id = draft.id;
        const removed = await sendFlowWrite(async () => fetch(`/api/email/broadcast-drafts/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeaders() }));
        message += removed.answered && removed.ok ? ' Its draft was removed from Drafts.' : ' Its draft is still under Drafts.';
      }
      composer.start();
      onSent(message);
    } finally {
      setBusy('');
    }
  };

  const startWritten = (kind: BroadcastPreset) => {
    if (draftHasContent(draft) && composer.dirty && !window.confirm(COMPOSER_REPLACE)) return;
    composer.startPreset(kind);
    setStatus('A written draft is in the email. Replace its words with your own before anyone receives it.');
  };

  // A button that is busy reads as busy: aria-disabled alone left it looking pressable.
  const dim: React.CSSProperties = busy ? { opacity: 0.55, cursor: 'not-allowed' } : {};
  const previewStale = preview !== null && preview.key !== previewKey(draft);
  const previewSaid = preview
    ? (previewStale
      ? 'The email changed after this preview, so the preview is hidden. Preview again to see the email as it is now.'
      : [
        preview.label,
        preview.untranslated.length ? `Not translated: ${preview.untranslated.join(', ')}. These tags were removed.` : '',
        preview.hidden > 0 ? 'Some blocks are hidden for this preview.' : ''
      ].filter(Boolean).join(' '))
    : previewNote;
  const segments = audience.state === 'loaded' ? audience.segments : [];
  const lists = audience.state === 'loaded' ? audience.lists : [];
  const scheduled = s.sendWhen !== 'now';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820 }}>
      <div>
        <h2 ref={headingRef} tabIndex={-1} style={{ margin: 0, fontSize: 18, color: '#f3f4f6' }}>{draft.id ? 'Edit broadcast draft' : 'New broadcast'}</h2>
        <p style={{ ...note, marginTop: 4, fontSize: 13 }}>
          One email, sent once to the people you choose. Write it with blocks, choose who gets it and when, then send or schedule. A postal address and an unsubscribe link are added on send, and a send counts only when the email service accepts it.
        </p>
      </div>

      <section aria-labelledby="bc-h-email" style={section}>
        <h3 id="bc-h-email" style={h3}>The email</h3>
        <label style={fieldLabel}>Subject
          <input style={field} value={draft.subject} onChange={(e) => patch({ subject: e.target.value })} placeholder="The line people see first" />
        </label>
        <label style={fieldLabel}>Preview text
          <input style={field} value={draft.previewText} onChange={(e) => patch({ previewText: e.target.value })} placeholder="The line inbox apps show after the subject" />
        </label>
        <div role="group" aria-label="Email content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <BlockEditor blocks={draft.blocks} onChange={(blocks) => patch({ blocks })} library={library} onSaveCopy={saveCopy} onDeleteCopy={deleteCopy} />
        </div>
        {libraryNote && <p role="status" style={note}>{libraryNote}</p>}
        <details open={openGroups.written} onToggle={(e) => { const open = (e.currentTarget as HTMLDetailsElement).open; setOpenGroups((g) => ({ ...g, written: open })); }} style={group}>
          <summary style={summary}>Start from a written draft</summary>
          <p style={note}>Each one fills in the subject, preview text and words. It names no gift or discount; add one only if it exists in your store.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" style={{ ...ghostBtn, ...tall }} onClick={() => startWritten('whales')}>VIP thank-you</button>
            <button type="button" style={{ ...ghostBtn, ...tall }} onClick={() => startWritten('at_risk')}>At-risk check-in</button>
            <button type="button" style={{ ...ghostBtn, ...tall }} onClick={() => startWritten('lapsed')}>Lapsed invitation</button>
          </div>
        </details>
      </section>

      <section aria-labelledby="bc-h-who" style={section}>
        <h3 id="bc-h-who" style={h3}>Who gets it</h3>
        {audience.state === 'loading' && <p role="status" style={said}>Loading the segments and lists.</p>}
        {audience.state === 'failed' && (
          <div role="alert" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <p style={said}>{audience.text}</p>
            {audience.retry && <button type="button" aria-label={retryLabel(audience.text)} style={{ ...ghostBtn, ...tall }} onClick={loadAudience}>Retry</button>}
          </div>
        )}
        {audience.state === 'loaded' && (
          <>
            <Pick id="bc-send-to" text="Send to">
              <select id="bc-send-to" style={field} value={s.include} onChange={(e) => patchSettings({ include: e.target.value })}>
                {!known(s.include) && <option value={s.include}>{s.include}, not on this account now</option>}
                {segments.map((seg) => (
                  <option key={seg.id} value={seg.id}>
                    {Number.isFinite(seg.count) ? withNote(`${seg.name} (${seg.count} contacts)`, seg.definition || seg.description) : withNote(seg.name, seg.definition || seg.description)}
                  </option>
                ))}
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>{Number.isFinite(list.count) ? `List · ${list.name} (${list.count} contacts)` : `List · ${list.name}`}</option>
                ))}
              </select>
            </Pick>
            <Pick id="bc-leave-out" text="Leave out">
              <select id="bc-leave-out" style={field} value={s.exclude} onChange={(e) => patchSettings({ exclude: e.target.value })}>
                <option value="">Nobody</option>
                {s.exclude && !known(s.exclude) && <option value={s.exclude}>{s.exclude}, not on this account now</option>}
                {segments.map((seg) => <option key={seg.id} value={seg.id}>{seg.name}</option>)}
                {lists.map((list) => <option key={list.id} value={list.id}>List · {list.name}</option>)}
              </select>
            </Pick>
            <p style={note}>The counts are the server's. A segment counts the people in it who accept marketing; a list counts everyone on it, and anyone who cannot receive marketing is skipped on send.</p>
            {audience.listsFailed && <p role="status" style={said}>The lists could not be loaded, so only segments are offered.</p>}
          </>
        )}
        <label style={check}>
          <input type="checkbox" checked={s.smartSkip} onChange={(e) => patchSettings({ smartSkip: e.target.checked })} />
          <span>Skip someone who already got a marketing email in 16 hours, or a text in 24 hours</span>
        </label>
      </section>

      <section aria-labelledby="bc-h-when" style={section}>
        <h3 id="bc-h-when" style={h3}>When</h3>
        <Pick id="bc-when" text="When to send">
          <select id="bc-when" style={field} value={s.sendWhen} onChange={(e) => {
            const next = e.target.value as BroadcastWhen;
            patchSettings(next === 'smart' && s.abVariable === 'send_time' ? { sendWhen: next, abVariable: '' } : { sendWhen: next });
          }}>
            {(Object.keys(WHEN_LABEL) as BroadcastWhen[]).map((key) => (
              <option key={key} value={key} disabled={key === 'smart' && s.abVariable === 'send_time'}>{WHEN_LABEL[key]}</option>
            ))}
          </select>
        </Pick>
        {(s.sendWhen === 'clock' || s.sendWhen === 'gradual') && (
          <label style={fieldLabel}>Date and time, in the account timezone (UTC when none is saved)
            <input type="datetime-local" style={field} value={s.sendAt} onChange={(e) => patchSettings({ sendAt: e.target.value })} />
          </label>
        )}
        {s.sendWhen === 'smart' && (
          <>
            <p style={note}>Their hour after 5 opens or clicks. Otherwise the store hour after 200 opens or clicks in 90 days. Otherwise the hour you set. Otherwise the next send. A stored timezone on the contact is used when there is one.</p>
            <label style={fieldLabel}>Fallback hour, 0 through 23. Leave empty for the next send.
              <input type="number" min={0} max={23} style={{ ...field, width: 100 }} value={s.fallbackHour} onChange={(e) => patchSettings({ fallbackHour: e.target.value })} />
            </label>
            <label style={check}>
              <input type="checkbox" checked={s.explore} onChange={(e) => patchSettings({ explore: e.target.checked })} />
              <span>Send 10% at another hour between 9:00 and 17:00</span>
            </label>
            <label style={check}>
              <input type="checkbox" checked={s.smartGradual} onChange={(e) => patchSettings({ smartGradual: e.target.checked })} />
              <span>Send gradually. Each person’s hour is the batch time</span>
            </label>
          </>
        )}
        {(s.sendWhen === 'gradual' || (s.sendWhen === 'smart' && s.smartGradual)) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={fieldLabel}>Percent per batch, 1 to 50
              <input type="number" min={1} max={50} style={{ ...field, width: 100 }} value={s.gradualPercent} onChange={(e) => patchSettings({ gradualPercent: Number(e.target.value) })} />
            </label>
            <Pick id="bc-every" text="Every">
              <select id="bc-every" style={{ ...field, width: 'auto' }} value={s.gradualEvery} onChange={(e) => patchSettings({ gradualEvery: e.target.value as 'minute' | 'hour' })}>
                <option value="hour">Hour</option>
                <option value="minute">Minute</option>
              </select>
            </Pick>
          </div>
        )}
      </section>

      <details open={openGroups.measure} onToggle={(e) => { const open = (e.currentTarget as HTMLDetailsElement).open; setOpenGroups((g) => ({ ...g, measure: open })); }} style={group}>
        <summary style={summary}>A/B test and holdout</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          <Pick id="bc-ab" text="A/B one variable. You choose the winner.">
            <select id="bc-ab" style={field} value={s.abVariable} onChange={(e) => patchSettings({ abVariable: e.target.value as BroadcastSettings['abVariable'] })}>
              <option value="">No A/B</option>
              <option value="subject">Subject</option>
              <option value="content">Content</option>
              <option value="send_time" disabled={s.sendWhen === 'smart'}>Send time</option>
            </select>
          </Pick>
          {s.abVariable === 'subject' && (
            <label style={fieldLabel}>Second subject
              <input style={field} value={s.abSubject} onChange={(e) => patchSettings({ abSubject: e.target.value })} />
            </label>
          )}
          {s.abVariable === 'content' && (
            <label style={fieldLabel}>Second version, as plain text. Version B is sent as one block of text in place of the blocks above.
              <textarea style={{ ...field, minHeight: 90 }} value={s.abBody} onChange={(e) => patchSettings({ abBody: e.target.value })} />
            </label>
          )}
          {s.abVariable === 'send_time' && (
            <label style={fieldLabel}>Hours later for version B, 1 to 168
              <input type="number" min={1} max={168} style={{ ...field, width: 100 }} value={s.abHours} onChange={(e) => patchSettings({ abHours: Number(e.target.value) })} />
            </label>
          )}
          <label style={check}>
            <input type="checkbox" checked={s.holdoutOn} onChange={(e) => patchSettings({ holdoutOn: e.target.checked })} />
            <span>Hold out a percent. They receive nothing.</span>
          </label>
          {s.holdoutOn && (
            <label style={fieldLabel}>Percent who receive nothing, 1 to 90
              <input type="number" min={1} max={90} style={{ ...field, width: 100 }} value={s.holdoutPercent} onChange={(e) => patchSettings({ holdoutPercent: Number(e.target.value) })} />
            </label>
          )}
          <p style={note}>Holdout stays off until you check it. The broadcast row then shows revenue per person for the sent group and the held-out group, with both sample sizes.</p>
        </div>
      </details>

      <details open={openGroups.text} onToggle={(e) => { const open = (e.currentTarget as HTMLDetailsElement).open; setOpenGroups((g) => ({ ...g, text: open })); }} style={group}>
        <summary style={summary}>A text message with it</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          <label style={fieldLabel}>Text message, up to 480 characters
            <textarea style={{ ...field, minHeight: 70 }} maxLength={480} value={s.smsMessage} onChange={(e) => patchSettings({ smsMessage: e.target.value })} />
          </label>
          <label style={check}>
            <input type="checkbox" checked={s.smsConfirm} onChange={(e) => patchSettings({ smsConfirm: e.target.checked })} />
            <span>This text goes only to numbers that already opted in</span>
          </label>
        </div>
      </details>

      <details open={openGroups.links} onToggle={(e) => { const open = (e.currentTarget as HTMLDetailsElement).open; setOpenGroups((g) => ({ ...g, links: open })); }} style={group}>
        <summary style={summary}>Link tracking</summary>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <label style={{ ...fieldLabel, flex: '1 1 200px' }}>UTM source
            <input style={field} value={s.utmSource} onChange={(e) => patchSettings({ utmSource: e.target.value })} />
          </label>
          <label style={{ ...fieldLabel, flex: '1 1 200px' }}>UTM campaign
            <input style={field} value={s.utmCampaign} onChange={(e) => patchSettings({ utmCampaign: e.target.value })} />
          </label>
        </div>
      </details>

      <section aria-labelledby="bc-h-check" style={section}>
        <h3 id="bc-h-check" style={h3}>Check it before it goes</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" style={{ ...ghostBtn, ...tall, ...dim }} aria-disabled={busy !== ''} onClick={showPreview}>{busy === 'preview' ? 'Making the preview' : 'Preview'}</button>
          <span role="group" aria-label="Preview width" style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={{ ...ghostBtn, ...tall }} aria-pressed={previewWidth === 'desktop'} onClick={() => setPreviewWidth('desktop')}>Desktop width</button>
            <button type="button" style={{ ...ghostBtn, ...tall }} aria-pressed={previewWidth === 'mobile'} onClick={() => setPreviewWidth('mobile')}>Mobile width</button>
          </span>
          <button type="button" style={{ ...ghostBtn, ...tall, ...dim }} aria-disabled={busy !== ''} onClick={runCheck}>{busy === 'check' ? 'Checking' : 'Check this email'}</button>
        </div>
        <p role="status" style={said}>{previewSaid}</p>
        <p role="status" style={said}>{checkNote}</p>
        {preview && !previewStale && (
          <iframe
            title={previewWidth === 'mobile' ? 'Broadcast preview at mobile width' : 'Broadcast preview at desktop width'}
            sandbox=""
            srcDoc={preview.html}
            style={{ width: previewWidth === 'mobile' ? 375 : '100%', maxWidth: '100%', height: 480, background: '#fff', border: 0, borderRadius: 8 }}
          />
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ ...fieldLabel, flex: '1 1 220px' }}>Your address for tests
            <input type="email" autoComplete="email" style={field} value={testAddress} onChange={(e) => setTestAddress(e.target.value)} />
          </label>
          <button type="button" style={{ ...ghostBtn, ...tall, ...dim }} aria-disabled={busy !== ''} onClick={sendTest}>{busy === 'test' ? 'Sending a test' : 'Send a test to me'}</button>
        </div>
        <p role="status" style={said}>{testNote}</p>
      </section>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', position: 'sticky', bottom: 0, padding: '12px 0', background: '#0b0c10' }}>
        <button type="button" style={{ ...ghostBtn, ...tall, ...dim }} aria-disabled={busy !== ''} onClick={saveDraft}>{busy === 'save' ? 'Saving the draft' : 'Save draft'}</button>
        <button type="button" style={{ ...solidBtn, ...tall, fontSize: 13, ...dim }} aria-disabled={busy !== ''} onClick={send}>
          {busy === 'send' ? (scheduled ? 'Scheduling' : 'Sending') : (scheduled ? 'Schedule' : 'Send now')}
        </button>
        <span role="status" style={{ fontSize: 12, color: '#fbbf24' }}>{composer.dirty && draftHasContent(draft) ? 'Unsaved changes' : ''}</span>
        <p role="status" style={{ ...said, flex: '1 1 100%' }}>{status}</p>
      </div>
    </div>
  );
};

type DraftsLoad = { state: 'loading' } | { state: 'loaded'; drafts: BroadcastDraft[]; updated: Record<string, string> } | { state: 'failed'; text: string; retry: boolean };

/**
 * Drafts, on All broadcasts: GET /api/email/broadcast-drafts, read each time the list opens. Open
 * hands a draft to the composer; Delete asks first, naming it.
 */
export const BroadcastDraftList: React.FC<{
  onOpen: (draft: BroadcastDraft) => void;
  onDeleted: (id: string) => void;
}> = ({ onOpen, onDeleted }) => {
  const [load, setLoad] = useState<DraftsLoad>({ state: 'loading' });
  const [notice, setNotice] = useState('');
  // A delete takes away the row whose button had focus, so focus moves to the list's heading.
  const headingRef = useRef<HTMLHeadingElement>(null);

  const accept = (rows: any[]) => {
    const drafts = rows.map(draftFromStored).filter((d) => d.id);
    const updated: Record<string, string> = {};
    for (const row of rows) if (row && typeof row.id === 'string') updated[row.id] = String(row.updatedAt || '').slice(0, 10);
    setLoad({ state: 'loaded', drafts, updated });
  };

  const read = async () => {
    setLoad({ state: 'loading' });
    const got = await settleRead(async () => {
      const res = await fetch('/api/email/broadcast-drafts', { headers: await authHeaders() });
      return { status: res.status, data: await readJson(res) };
    });
    if (!got.answered) return setLoad({ state: 'failed', text: 'Drafts could not be loaded. The server did not answer.', retry: true });
    if (got.data.status === 401) return setLoad({ state: 'failed', text: "Sign in to see this account's drafts.", retry: false });
    if (!got.data.data?.success || !Array.isArray(got.data.data.drafts)) return setLoad({ state: 'failed', text: 'Drafts could not be loaded. Try again in a minute.', retry: true });
    accept(got.data.data.drafts);
  };

  useEffect(() => { read(); }, []);

  const remove = async (draft: BroadcastDraft) => {
    const name = draft.subject.trim() || 'with no subject';
    if (!window.confirm(`Delete the draft "${name}"? This cannot be undone.`)) return;
    const sent = await sendFlowWrite(async () => fetch(`/api/email/broadcast-drafts/${encodeURIComponent(draft.id)}`, { method: 'DELETE', headers: await authHeaders() }));
    if (!sent.answered) {
      setNotice('The server did not answer, so that draft may not be deleted.');
      return;
    }
    if (!sent.ok || !sent.data?.success) {
      setNotice(sent.data?.error || 'That draft was not deleted.');
      return;
    }
    if (Array.isArray(sent.data.drafts)) accept(sent.data.drafts);
    onDeleted(draft.id);
    setNotice(`Deleted the draft "${name}".`);
    headingRef.current?.focus();
  };

  return (
    <section aria-labelledby="bc-h-drafts" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 id="bc-h-drafts" ref={headingRef} tabIndex={-1} style={h3}>Drafts</h3>
      {load.state === 'loading' && <p style={said}>Loading drafts.</p>}
      {load.state === 'failed' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <p style={said}>{load.text}</p>
          {load.retry && <button type="button" aria-label={retryLabel(load.text)} style={{ ...ghostBtn, ...tall }} onClick={read}>Retry</button>}
        </div>
      )}
      {load.state === 'loaded' && load.drafts.length === 0 && <p style={note}>No drafts yet. Save draft, in New broadcast, keeps a broadcast here without sending it.</p>}
      {load.state === 'loaded' && load.drafts.length > 0 && (
        <ul aria-label="Drafts" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {load.drafts.map((draft) => {
            const name = draft.subject.trim() || 'No subject yet';
            return (
              <li key={draft.id} style={{ ...card, padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere', fontSize: 13, color: '#f3f4f6' }}>
                  {name}
                  {load.updated[draft.id] && <span style={{ display: 'block', fontSize: 12, color: '#9ca3af' }}>Saved {load.updated[draft.id]}</span>}
                </span>
                <button type="button" style={{ ...ghostBtn, ...tall }} aria-label={`Open draft ${name}`} onClick={() => onOpen(draft)}>Open</button>
                <button type="button" style={{ ...ghostBtn, ...tall }} aria-label={`Delete draft ${name}`} onClick={() => remove(draft)}>Delete</button>
              </li>
            );
          })}
        </ul>
      )}
      <p role="status" style={said}>{notice}</p>
    </section>
  );
};
