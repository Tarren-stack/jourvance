import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { User } from '../../lib/firebase';
import { ASK_EVENT, ASK_READY_ATTR, PANEL_EXTRA, SHEET_OPEN_ATTR, screenFor } from '../../lib/assistant';
import type { ActionResult, AskEventDetail, AssistantAction, AssistantScreen } from '../../lib/assistant';
import { AssistantBubble } from './AssistantBubble';
import { AssistantPanel } from './AssistantPanel';

interface Props {
  user: User | null;
  onOpenAuth: () => void;
  /** Reserved for the question box's context; the server reads the real business from the account. */
  businessType?: string;
  /** Where the person is: the view, the open journey, and the selected step. Cut to 120 characters here too. */
  view?: string;
  journeyId?: string;
  journeyName?: string;
  stepKind?: string;
  stepName?: string;
  /** Runs one suggested action the person pressed (W3.A): App.tsx maps it to its own handlers. */
  onAction?: (action: AssistantAction) => Promise<ActionResult> | ActionResult;
}

/**
 * Ask Jourvance: the bubble and its panel. This one lazy entry owns whether the panel is open; the
 * panel owns the conversation, and stays mounted while closed so a draft, unsaved notes and an
 * answer in flight survive closing. Keyed on the uid, so signing out or in starts it empty.
 */
const AskJourvance: React.FC<Props> = ({ user, onOpenAuth, view, journeyId, journeyName, stepKind, stepName, onAction }) => {
  const [open, setOpen] = useState(false);
  const [newAnswer, setNewAnswer] = useState(false);
  // Said by an always-mounted live region, so an answer that lands while closed is not silent.
  const [announce, setAnnounce] = useState('');
  const baseScreen = useMemo(
    () => screenFor({ view, journeyId, journeyName, step: stepKind || stepName ? { kind: stepKind, name: stepName } : undefined }),
    [view, journeyId, journeyName, stepKind, stepName]
  );
  // A screen that sent "Ask about this" may name more than the mount knows (the step that leaks).
  // It applies to that one question, then the mount's own reading takes over again.
  const [sent, setSent] = useState<Partial<AssistantScreen> | null>(null);
  const screen = useMemo(() => (sent ? screenFor({ ...baseScreen, ...sent }) : baseScreen), [baseScreen, sent]);
  const [prefill, setPrefill] = useState({ n: 0, text: '' });
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(false);
  openRef.current = open;
  const panelId = 'jv-assistant-panel-' + useId().replace(/[^A-Za-z0-9_-]/g, '');

  const toggle = useCallback(() => {
    setOpen(o => !o);
    setNewAnswer(false);
    setAnnounce('');
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const onAnswer = useCallback(() => {
    if (!openRef.current) {
      setNewAnswer(true);
      setAnnounce(PANEL_EXTRA['bubble.newAnswer']);
    }
  }, []);

  // While the panel is open <html> says so, so the mobile nav trigger steps out of the sheet's way
  // (the rule is in index.css, under 720px only, where the panel is a sheet).
  useEffect(() => {
    const root = document.documentElement;
    if (open) root.setAttribute(SHEET_OPEN_ATTR, '');
    else root.removeAttribute(SHEET_OPEN_ATTR);
    return () => root.removeAttribute(SHEET_OPEN_ATTR);
  }, [open]);
  // A result whose focus left the panel is said here, outside it. Emptied first, so the same words
  // said twice are still heard.
  const announceResult = useCallback((text: string) => {
    setAnnounce('');
    window.setTimeout(() => setAnnounce(text), 50);
  }, []);

  // The buttons on other screens appear only while this is mounted.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(ASK_READY_ATTR, '');
    return () => root.removeAttribute(ASK_READY_ATTR);
  }, []);
  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<AskEventDetail>).detail;
      const text = typeof d?.question === 'string' ? d.question.trim() : '';
      if (!text) return;
      setSent(d.screen && typeof d.screen === 'object' ? d.screen : null);
      setPrefill(p => ({ n: p.n + 1, text }));
      setOpen(true);
      setNewAnswer(false);
      setAnnounce('');
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);
  // A hand-over belongs to the person who was signed in; a new sign-in does not inherit it.
  useEffect(() => {
    setPrefill(p => ({ n: p.n, text: '' }));
    setSent(null);
  }, [user?.uid]);
  const onAsked = useCallback(() => setSent(null), []);

  return (
    <>
      <span role="status" className="jv-assistant-sr">{announce}</span>
      <AssistantBubble ref={bubbleRef} open={open} hasNewAnswer={newAnswer} panelId={panelId} onToggle={toggle} />
      <AssistantPanel
        key={user?.uid ?? 'signed-out'}
        id={panelId}
        open={open}
        signedIn={!!user}
        onClose={close}
        onOpenAuth={onOpenAuth}
        onAnswer={onAnswer}
        screen={screen}
        prefill={prefill}
        onAsked={onAsked}
        onAction={onAction}
        onAnnounce={announceResult}
      />
    </>
  );
};

export default AskJourvance;
