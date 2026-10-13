import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronRight, LoaderCircle, MessageCircleQuestionMark, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import {
  ASSISTANT_LIMITS,
  PANEL_COPY,
  PANEL_EXTRA,
  actionKey,
  actionRunnable,
  feedbackLine,
  focusTargetOnOpen,
  latestAnswerId,
  limitText,
  markActionRun,
  notesOutcome,
  readAskOutcome,
  readThread,
  showsActionButtons,
  suggestionKeys
} from '../../lib/assistant';
import type { ActionResult, AssistantAction, AssistantActionView, AssistantMessage, AssistantScreen } from '../../lib/assistant';
import { FOCUSABLE_SELECTOR, nextTrapIndex } from '../../lib/a11y';
import { ask, clearThread, fetchThread, saveNotes, sendFeedback } from '../../lib/assistantClient';

interface Props {
  id: string;
  open: boolean;
  signedIn: boolean;
  onClose: () => void;
  onOpenAuth: () => void;
  onAnswer: () => void;
  /** The screen the person is on, sent with the thread and every question. */
  screen: AssistantScreen;
  /** A question another screen handed over ("Ask about this"): n counts the hand-overs. */
  prefill: { n: number; text: string };
  /** Said once a question has gone, so a screen that was only for that question is let go. */
  onAsked: () => void;
  /**
   * Runs one suggested action through the app (W3.A). Without it the actions show as plain lines.
   * Called only from a button press, never on render, on open or from the question box.
   */
  onAction?: (action: AssistantAction) => Promise<ActionResult> | ActionResult;
  /** Says a result out loud from outside the panel, for when focus leaves it (AskJourvance's status). */
  onAnnounce?: (text: string) => void;
}

const ACTION_FAILED: ActionResult = { ok: false, line: PANEL_COPY['action.failed'], tone: 'bad' };
// The main heading of each view, found by its own words, so the heading of the view that was on
// screen before is never the one that takes focus.
const VIEW_HEADING: Record<Exclude<AssistantActionView, 'canvas'>, RegExp> = { 'email-studio': /Email Studio/, attribution: /Attribution/ };

/**
 * After the sheet closes on a successful "open", focus goes to that view's main heading (the map,
 * for the canvas) once it is drawn, since the view may still be loading. Nothing moves when the
 * person has put focus somewhere else meanwhile.
 */
function focusViewHeading(view: AssistantActionView): void {
  let tries = 0;
  const attempt = () => {
    const a = document.activeElement;
    if (a && a !== document.body && !a.hasAttribute('data-assistant-bubble')) return;
    const target = view === 'canvas'
      ? document.getElementById('journey-map')
      : Array.from(document.querySelectorAll<HTMLElement>('.jv-workspace-main h1')).find(h => VIEW_HEADING[view].test(h.textContent || '')) ?? null;
    if (target && target.getClientRects().length > 0) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus();
      return;
    }
    if (++tries < 100) window.setTimeout(attempt, 50);
  };
  window.setTimeout(attempt, 0);
}

type Problem =
  | { kind: 'limit'; seconds: number; text: string }
  | { kind: 'failed'; retryable: boolean; text: string; question: string }
  | { kind: 'signedOut'; text: string };

type NotesLine = { tone: 'ok' | 'warn' | 'bad'; text: string } | null;

const fmt = (n: number) => n.toLocaleString('en-US');
const countText = (n: number, max: number) =>
  PANEL_EXTRA['count.template'].replace('{n}', fmt(n)).replace('{max}', fmt(max));

/** The Ask Jourvance panel. Look and place are the .jv-assistant-* rules in index.css; palette C is AiJourneyBuilder's. */
export const AssistantPanel: React.FC<Props> = ({ id, open, signedIn, onClose, onOpenAuth, onAnswer, screen, prefill, onAsked, onAction, onAnnounce }) => {
  const base = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const titleId = `jv-assistant-title-${base}`;
  const inputId = `jv-assistant-input-${base}`;
  const notesId = `jv-assistant-notes-${base}`;
  const notesHeadId = `jv-assistant-notes-head-${base}`;
  const notesHelpId = `jv-assistant-notes-help-${base}`;
  const limitId = `jv-assistant-limit-${base}`;
  const inputStatusId = `jv-assistant-input-status-${base}`;
  const notesStatusId = `jv-assistant-notes-status-${base}`;

  const [loaded, setLoaded] = useState(false);
  // The history commits while aria-busy is still true and settles in a later effect, so a screen reader
  // does not read the whole thread aloud as new.
  const [settled, setSettled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesLine, setNotesLine] = useState<NotesLine>(null);
  const [rating, setRating] = useState<string | null>(null);
  const [ratingLines, setRatingLines] = useState<Record<string, string>>({});
  const [lineSeen, setLineSeen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearLine, setClearLine] = useState('');
  // A suggested action that ran is replaced by its result line, keyed `${messageId}:${index}`, so it
  // cannot run twice from the same message. Kept for this page load only.
  const [actionLines, setActionLines] = useState<Record<string, ActionResult>>({});
  const [focusLine, setFocusLine] = useState('');
  const runningAction = useRef(false);
  const [actionBusy, setActionBusy] = useState(false);
  // The answers that came back from a question asked in this page load. Only these offer buttons; an
  // answer read back with the thread shows its actions as lines, so a stored action never runs again.
  const [liveAnswers, setLiveAnswers] = useState<ReadonlySet<string>>(() => new Set());

  // Not on the dialog stack (a11y.ts): the panel sits beside a map and its step dock, and a dialog
  // on the stack stopped Escape closing the dock beneath it. Focus in and out is handled here.
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const notesLineRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const mounted = useRef(true);
  const started = useRef(false);
  const localId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Focus goes in on open (the element marked data-dialog-start) and back to the bubble on close,
  // but only when it would otherwise be lost: nothing focused, the body, or something inside the panel.
  useEffect(() => {
    const panel = panelRef.current;
    if (open && !wasOpen.current) {
      (panel?.querySelector<HTMLElement>('[data-dialog-start]') ?? panel)?.focus({ preventScroll: true });
    } else if (!open && wasOpen.current) {
      const a = document.activeElement;
      if (!a || a === document.body || panel?.contains(a)) {
        document.querySelector<HTMLElement>('[data-assistant-bubble]')?.focus({ preventScroll: true });
      }
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (loaded) setSettled(true);
  }, [loaded]);

  // "Ask about this": the question lands in the box and the box takes focus. Nothing is sent. Signed
  // out there is no box, so the panel simply stays open on its sign-in line.
  const prefillSeen = useRef(0);
  useEffect(() => {
    if (!prefill.n || !prefill.text || prefill.n === prefillSeen.current || !open) return;
    if (!signedIn) { prefillSeen.current = prefill.n; return; }
    if (!loaded || unavailable) return;
    prefillSeen.current = prefill.n;
    setInput(prefill.text);
    window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
  }, [prefill, open, signedIn, loaded, unavailable]);

  // A pending clear confirm never outlives the panel being open.
  useEffect(() => {
    if (!open) setConfirmClear(false);
  }, [open]);

  // The thread loads the first time the panel opens while signed in, never before.
  useEffect(() => {
    if (!open || !signedIn || started.current) return;
    started.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    void fetchThread(screen, controller.signal).then(answer => {
      if (!mounted.current) return;
      const thread = readThread(answer?.body);
      setMessages(thread.messages);
      setNotesDraft(thread.notes);
      setUnavailable(!thread.available);
      setLoaded(true);
    });
  }, [open, signedIn]);

  // The newest message stays in view when the reader was already at the foot.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  // The question box grows to five rows, then scrolls.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }, [input, open, loaded, unavailable]);

  // The button that ran is gone, so focus moves to the line that took its place, but only when it
  // would otherwise be lost: an action that put focus somewhere on purpose keeps it there (a new step
  // takes focus on the map, as the header's Add Step gives it).
  useEffect(() => {
    if (!focusLine) return;
    const a = document.activeElement;
    if (a && a !== document.body && !panelRef.current?.contains(a)) return;
    const line = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-action-line]') ?? []).find(el => el.dataset.actionLine === focusLine);
    line?.focus({ preventScroll: true });
  }, [focusLine]);

  // A notes result under a long notes box can be below the fold of the body.
  useEffect(() => {
    if (notesLine) notesLineRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [notesLine]);

  // The hourly wait ends on its own: the line goes, and Send works again.
  useEffect(() => {
    if (problem?.kind !== 'limit') return;
    const timer = setTimeout(() => setProblem(p => (p && p.kind === 'limit' ? null : p)), problem.seconds * 1000);
    return () => clearTimeout(timer);
  }, [problem]);

  // When the box goes away (the assistant turns out to be unavailable) focus would be lost with it.
  useEffect(() => {
    if (!unavailable || !open) return;
    const a = document.activeElement;
    if (!a || a === document.body) headingRef.current?.focus({ preventScroll: true });
  }, [unavailable, open]);

  const limited = problem?.kind === 'limit';
  const over = input.length > ASSISTANT_LIMITS.MESSAGE_MAX;
  const notesOver = notesDraft.length > ASSISTANT_LIMITS.NOTES_MAX;
  const startOn: 'signin' | 'heading' | 'input' = !signedIn
    ? 'signin'
    : unavailable
      ? 'heading'
      : focusTargetOnOpen(typeof window === 'undefined' ? 1024 : window.innerWidth);

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy || limited || question.length > ASSISTANT_LIMITS.MESSAGE_MAX) return;
    const mine: AssistantMessage = { id: `local-${++localId.current}`, role: 'user', text: question, at: new Date().toISOString() };
    setMessages(m => [...m, mine]);
    setInput('');
    setProblem(null);
    setClearLine('');
    setBusy(true);
    onAsked();
    nearBottom.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    const outcome = readAskOutcome(await ask(question, screen, controller.signal));
    if (!mounted.current) return;
    setBusy(false);
    if (outcome.kind === 'answer') {
      setLiveAnswers(ids => new Set(ids).add(outcome.message.id));
      setMessages(m => [...m, outcome.message]);
      onAnswer();
      return;
    }
    // Nothing was answered: the question leaves the log and comes back into the box, so the draft is kept.
    setMessages(m => m.filter(x => x.id !== mine.id));
    setInput(cur => cur || question);
    if (outcome.kind === 'unavailable') setUnavailable(true);
    else if (outcome.kind === 'limit') setProblem({ kind: 'limit', seconds: outcome.seconds, text: outcome.text });
    else if (outcome.kind === 'signedOut') setProblem({ kind: 'signedOut', text: outcome.text });
    else setProblem({ kind: 'failed', retryable: outcome.retryable, text: outcome.text, question });
  };

  const retry = () => {
    if (problem?.kind !== 'failed') return;
    const question = problem.question;
    setInput('');
    void send(question);
    inputRef.current?.focus({ preventScroll: true });
  };

  const rate = async (message: AssistantMessage, value: 'up' | 'down') => {
    if (rating || message.rating === value) return;
    setRating(message.id);
    const answer = await sendFeedback(message.id, value);
    if (!mounted.current) return;
    setRating(null);
    const seenBefore = lineSeen || messages.some(m => m.shared === true);
    const line = feedbackLine(answer, seenBefore, value, message.shared === true);
    const body = (answer?.body ?? {}) as { success?: unknown; shared?: unknown };
    if (body.success === true) {
      setMessages(list =>
        list.map(m => (m.id === message.id ? { ...m, rating: value, ...(value === 'up' && body.shared === true ? { shared: true } : {}) } : m))
      );
    }
    // Always replace the line, so a stale "shared" line never sits under a pressed Not helpful.
    setRatingLines(lines => ({ ...lines, [message.id]: line }));
    if (body.success === true && value === 'up' && line) setLineSeen(true);
  };

  // Only a press runs an action. A handler that throws, or answers nothing readable, is action.failed.
  // The bookkeeping is actionRunnable and markActionRun (src/lib/assistant.ts), both given this key.
  const runAction = async (messageId: string, index: number, action: AssistantAction) => {
    const key = actionKey(messageId, index);
    if (!onAction || runningAction.current || !actionRunnable(actionLines, key)) return;
    runningAction.current = true;
    setActionBusy(true);
    let result: ActionResult;
    try {
      const r = await onAction(action);
      result = r && typeof r.ok === 'boolean' && typeof r.line === 'string' && r.line.trim()
        ? { ok: r.ok, line: r.line, tone: r.tone === 'ok' || r.tone === 'warn' || r.tone === 'bad' ? r.tone : r.ok ? 'ok' : 'bad' }
        : ACTION_FAILED;
    } catch {
      result = ACTION_FAILED;
    }
    runningAction.current = false;
    if (!mounted.current) return;
    setActionBusy(false);
    setActionLines(lines => markActionRun(lines, key, result));
    // Below 720px the sheet covers the page, so a successful open or add-step closes it and the result
    // is on screen: focus goes to the new step (the map gives it focus, as the header's Add Step does)
    // or to the view's main heading. A new step takes focus at every width. When focus leaves the
    // panel the result is said from outside it; otherwise focus moves to the line, which is not live.
    const sheet = typeof window !== 'undefined' && window.innerWidth < 720;
    const closes = sheet && result.ok && (action.kind === 'add-step' || action.kind === 'open');
    if (closes) {
      onClose();
      if (action.kind === 'open') focusViewHeading(action.view);
    }
    if (closes || (result.ok && action.kind === 'add-step')) onAnnounce?.(result.line);
    else setFocusLine(key);
  };

  const save = async () => {
    if (notesSaving || notesOver) return;
    setNotesSaving(true);
    setNotesLine(null);
    const outcome = notesOutcome(await saveNotes(notesDraft.trim()));
    if (!mounted.current) return;
    setNotesSaving(false);
    if (outcome.notes !== null) {
      setNotesDraft(outcome.notes);
    }
    setNotesLine({ tone: outcome.kind === 'saved' ? 'ok' : outcome.kind === 'local' ? 'warn' : 'bad', text: outcome.text });
  };

  const clear = async () => {
    setConfirmClear(false);
    const answer = await clearThread();
    if (!mounted.current) return;
    const ok = !!answer && answer.status >= 200 && answer.status < 300 && (answer.body as { success?: unknown } | null)?.success === true;
    if (!ok) {
      setClearLine(PANEL_EXTRA['clear.failed']);
      clearRef.current?.focus({ preventScroll: true });
      return;
    }
    setMessages([]);
    setRatingLines({});
    setActionLines({});
    // Clearing the conversation does not lift the hourly limit.
    setProblem(p => (p && p.kind === 'limit' ? p : null));
    setClearLine(PANEL_COPY['clear.done']);
    // The Clear button is gone with the messages, so focus goes to the box.
    setTimeout(() => (unavailable ? headingRef.current : inputRef.current)?.focus({ preventScroll: true }), 0);
  };

  // Keys pressed in the panel stay in it, so Backspace never reaches the map's delete and Ctrl+Z on a
  // panel button never undoes a map edit. Escape closes the panel, and never cancels an answer in flight.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      // Escape in the clear confirm is "Keep it", not "close everything".
      if (confirmClear) keepConversation();
      else onClose();
      return;
    }
    // Below 720px the panel is a sheet drawn over the page, so Tab stays inside it (focus must not be
    // obscured). From 720px up the page stays usable beside the card and Tab moves on freely.
    if (e.key === 'Tab' && typeof window !== 'undefined' && window.innerWidth < 720) {
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(`${FOCUSABLE_SELECTOR}, summary`)).filter(el => el.getClientRects().length > 0);
      const next = nextTrapIndex(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      if (next === null) {
        if (items.length === 0) e.preventDefault();
        return;
      }
      e.preventDefault();
      items[next].focus();
    }
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // Enter during IME composition picks a character; it neither sends nor adds a line.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    void send(input);
  };

  const showConfirm = () => {
    setConfirmClear(true);
    setTimeout(() => keepRef.current?.focus({ preventScroll: true }), 0);
  };
  const keepConversation = () => {
    setConfirmClear(false);
    setTimeout(() => clearRef.current?.focus({ preventScroll: true }), 0);
  };

  const sendBlocked = busy || limited || !input.trim() || over;
  // Only the newest answer's actions are buttons; older ones are plain lines.
  const latestId = latestAnswerId(messages);

  return (
    <div
      ref={panelRef}
      id={id}
      className="jv-assistant-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      hidden={!open}
      data-signed-out={signedIn ? 'false' : 'true'}
      onKeyDown={onKeyDown}
      onKeyUp={e => e.stopPropagation()}
    >
      <div className="jv-assistant-head">
        <MessageCircleQuestionMark size={20} aria-hidden="true" className="jv-assistant-head-icon" />
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="jv-assistant-title" data-dialog-start={startOn === 'heading' ? '' : undefined}>
          {PANEL_COPY['panel.title']}
        </h2>
        {signedIn && messages.length > 0 && (
          <button
            ref={clearRef}
            type="button"
            className="jv-assistant-btn jv-assistant-clear"
            aria-disabled={busy || confirmClear}
            onClick={() => {
              if (!busy && !confirmClear) showConfirm();
            }}
          >
            {PANEL_COPY['clear.label']}
          </button>
        )}
        <button type="button" className="jv-assistant-btn jv-assistant-icon-btn" aria-label={PANEL_COPY['close.label']} onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {confirmClear && (
        <div role="group" aria-label={PANEL_COPY['clear.label']} className="jv-assistant-confirm">
          <p className="jv-assistant-text">{PANEL_COPY['clear.confirm']}</p>
          <div className="jv-assistant-row">
            <button type="button" className="jv-assistant-btn jv-assistant-danger" onClick={() => void clear()}>
              {PANEL_COPY['clear.confirmYes']}
            </button>
            <button ref={keepRef} type="button" className="jv-assistant-btn" onClick={keepConversation}>
              {PANEL_COPY['clear.confirmNo']}
            </button>
          </div>
        </div>
      )}
      {!signedIn ? (
        <div className="jv-assistant-body">
          <p className="jv-assistant-text">{PANEL_COPY['signedOut.line']}</p>
          <button
            type="button"
            className="jv-assistant-btn jv-assistant-primary"
            data-dialog-start=""
            onClick={() => {
              // Close first, so the auth dialog never opens behind the panel.
              onClose();
              onOpenAuth();
            }}
          >
            {PANEL_COPY['signedOut.button']}
          </button>
        </div>
      ) : (
        <>
          <div
            ref={bodyRef}
            className="jv-assistant-body"
            onScroll={e => {
              const el = e.currentTarget;
              nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
            }}
          >
            <details className="jv-assistant-notes">
              <summary id={notesHeadId} className="jv-assistant-summary">
                <ChevronRight size={16} aria-hidden="true" className="jv-assistant-chev" />
                {PANEL_COPY['notes.heading']}
              </summary>
              <p id={notesHelpId} className="jv-assistant-help">{PANEL_COPY['notes.help']}</p>
              <textarea
                id={notesId}
                className="jv-assistant-field"
                rows={5}
                aria-labelledby={notesHeadId}
                aria-describedby={`${notesHelpId} ${notesStatusId}`}
                aria-invalid={notesOver}
                value={notesDraft}
                onChange={e => setNotesDraft(e.target.value)}
              />
              <div id={notesStatusId} role="status" className="jv-assistant-meta">
                <span>{countText(notesDraft.length, ASSISTANT_LIMITS.NOTES_MAX)}</span>
                {notesOver && <span className="jv-assistant-warn-text">{PANEL_COPY['notes.tooLong']}</span>}
              </div>
              <button
                type="button"
                className="jv-assistant-btn jv-assistant-primary"
                aria-disabled={notesSaving || notesOver}
                onClick={() => void save()}
              >
                {notesSaving && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
                {PANEL_COPY['notes.save']}
              </button>
              <div ref={notesLineRef} role="status" className={`jv-assistant-line${notesLine ? ` jv-assistant-line--${notesLine.tone}` : ''}`} hidden={!notesLine}>
                {notesLine?.text}
              </div>
            </details>

            {messages.length === 0 && loaded && !unavailable && (
              <div className="jv-assistant-empty">
                <p className="jv-assistant-text">{PANEL_COPY['panel.intro']}</p>
                <div className="jv-assistant-suggest">
                  {suggestionKeys(screen.view).map(key => (
                    <button
                      key={key}
                      type="button"
                      className="jv-assistant-btn jv-assistant-suggestion"
                      onClick={() => {
                        setInput(PANEL_COPY[key]);
                        inputRef.current?.focus({ preventScroll: true });
                      }}
                    >
                      {PANEL_COPY[key]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div role="log" aria-live="polite" aria-busy={!settled} className="jv-assistant-log">
              {messages.map(m => (
                <article key={m.id} className={`jv-assistant-msg jv-assistant-msg--${m.role}`}>
                  <span className="jv-assistant-sr">{m.role === 'user' ? PANEL_EXTRA['speaker.you'] : PANEL_EXTRA['speaker.assistant']}</span>
                  <div className="jv-assistant-bubble-text">{m.text}</div>
                  {m.role === 'assistant' && !!m.actions?.length && (
                    showsActionButtons(m.id, latestId, liveAnswers) && onAction ? (
                      <div role="group" aria-label={PANEL_COPY['action.group']} className="jv-assistant-actions">
                        {m.actions.map((a, i) => {
                          const key = actionKey(m.id, i);
                          const done = actionLines[key];
                          // Not live: focus moves to this line, and the log already holds it.
                          return done ? (
                            <p
                              key={key}
                              role="status"
                              aria-live="off"
                              tabIndex={-1}
                              data-action-line={key}
                              className={`jv-assistant-action-line jv-assistant-action-line--${done.tone ?? (done.ok ? 'ok' : 'bad')}`}
                            >
                              {done.line}
                            </p>
                          ) : (
                            <button
                              key={key}
                              type="button"
                              className="jv-assistant-btn jv-assistant-action"
                              aria-disabled={actionBusy}
                              onClick={() => void runAction(m.id, i, a)}
                            >
                              {a.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <ul className="jv-assistant-suggested">
                        {m.actions.map((a, i) => {
                          // An action that already ran shows what it did, not the suggestion.
                          const done = actionLines[actionKey(m.id, i)];
                          return done ? (
                            <li key={actionKey(m.id, i)} className={`jv-assistant-action-line jv-assistant-action-line--${done.tone ?? (done.ok ? 'ok' : 'bad')}`}>{done.line}</li>
                          ) : (
                            <li key={actionKey(m.id, i)}>{PANEL_COPY['action.suggested']} {a.label}</li>
                          );
                        })}
                      </ul>
                    )
                  )}
                  {m.role === 'assistant' && !m.id.startsWith('local-') && (
                    <>
                      <div role="group" aria-label={PANEL_COPY['feedback.group']} className="jv-assistant-feedback">
                        {(['up', 'down'] as const).map(value => {
                          const pressed = m.rating === value;
                          const Icon = pressed ? Check : value === 'up' ? ThumbsUp : ThumbsDown;
                          return (
                            <button
                              key={value}
                              type="button"
                              className="jv-assistant-btn jv-assistant-toggle"
                              aria-pressed={pressed}
                              aria-disabled={rating === m.id}
                              onClick={() => void rate(m, value)}
                            >
                              <Icon size={14} aria-hidden="true" />
                              {value === 'up' ? PANEL_COPY['feedback.helpful'] : PANEL_COPY['feedback.notHelpful']}
                            </button>
                          );
                        })}
                      </div>
                      <div role="status" className="jv-assistant-help" hidden={!ratingLines[m.id]}>
                        {ratingLines[m.id]}
                      </div>
                    </>
                  )}
                </article>
              ))}
              {busy && (
                <p className="jv-assistant-busy">
                  <LoaderCircle size={14} className="spin" aria-hidden="true" />
                  {PANEL_COPY['busy.line']}
                </p>
              )}
            </div>
          </div>

          <div className="jv-assistant-foot">
            <div role="status" className="jv-assistant-line" hidden={!clearLine}>{clearLine}</div>
            {problem?.kind === 'limit' && (
              <div id={limitId} role="status" className="jv-assistant-line jv-assistant-line--warn">{limitText(problem.seconds)}</div>
            )}
            {problem?.kind === 'signedOut' && (
              <div role="alert" className="jv-assistant-line jv-assistant-line--bad">{problem.text}</div>
            )}
            {problem?.kind === 'failed' && (
              <div role="alert" className="jv-assistant-line jv-assistant-line--bad">
                <span>{problem.text}</span>
                {problem.retryable && (
                  <button type="button" className="jv-assistant-btn" onClick={retry}>{PANEL_COPY['failed.retry']}</button>
                )}
              </div>
            )}

            {unavailable ? (
              <p className="jv-assistant-text" role="status">{PANEL_COPY['unavailable.line']}</p>
            ) : (
              <>
                <label htmlFor={inputId} className="jv-assistant-label">{PANEL_COPY['input.label']}</label>
                <div className="jv-assistant-compose">
                  <textarea
                    id={inputId}
                    ref={inputRef}
                    className="jv-assistant-field jv-assistant-input"
                    rows={1}
                    placeholder={PANEL_COPY['input.placeholder']}
                    enterKeyHint="send"
                    aria-describedby={inputStatusId}
                    aria-invalid={over}
                    value={input}
                    data-dialog-start={startOn === 'input' ? '' : undefined}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={onInputKeyDown}
                  />
                  <button
                    type="button"
                    className="jv-assistant-btn jv-assistant-primary jv-assistant-send"
                    aria-disabled={sendBlocked}
                    aria-describedby={limited ? limitId : undefined}
                    onClick={() => {
                      if (!sendBlocked) void send(input);
                    }}
                  >
                    {busy && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
                    {PANEL_COPY['send.label']}
                  </button>
                </div>
                <div className="jv-assistant-meta">
                  <span>{PANEL_EXTRA['input.hint']}</span>
                </div>
                <div id={inputStatusId} role="status" className="jv-assistant-meta">
                  <span>{input.length >= 900 ? countText(input.length, ASSISTANT_LIMITS.MESSAGE_MAX) : ''}</span>
                  {over && <span className="jv-assistant-warn-text">{PANEL_COPY['input.tooLong']}</span>}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
