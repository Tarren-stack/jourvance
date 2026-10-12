import React, { useCallback, useId, useRef, useState } from 'react';
import type { User } from '../../lib/firebase';
import { PANEL_EXTRA } from '../../lib/assistant';
import { AssistantBubble } from './AssistantBubble';
import { AssistantPanel } from './AssistantPanel';

interface Props {
  user: User | null;
  onOpenAuth: () => void;
  /** Reserved for the question box's context; the server reads the real business from the account. */
  businessType?: string;
}

/**
 * Ask Jourvance: the bubble and its panel. This one lazy entry owns whether the panel is open; the
 * panel owns the conversation, and stays mounted while closed so a draft, unsaved notes and an
 * answer in flight survive closing. Keyed on the uid, so signing out or in starts it empty.
 */
const AskJourvance: React.FC<Props> = ({ user, onOpenAuth }) => {
  const [open, setOpen] = useState(false);
  const [newAnswer, setNewAnswer] = useState(false);
  // Said by an always-mounted live region, so an answer that lands while closed is not silent.
  const [announce, setAnnounce] = useState('');
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
      />
    </>
  );
};

export default AskJourvance;
