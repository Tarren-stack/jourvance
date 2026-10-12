import React from 'react';
import { MessageCircleQuestionMark, X } from 'lucide-react';
import { PANEL_COPY, PANEL_EXTRA } from '../../lib/assistant';

interface Props {
  open: boolean;
  /** An answer landed while the panel was closed. */
  hasNewAnswer: boolean;
  panelId: string;
  onToggle: () => void;
}

const DOT_ID = 'jv-assistant-new-answer';

/** The round Ask Jourvance button, bottom right. Its look and place are the .jv-assistant-bubble rule in index.css. */
export const AssistantBubble = React.forwardRef<HTMLButtonElement, Props>(function AssistantBubble(
  { open, hasNewAnswer, panelId, onToggle },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className="jv-assistant-bubble"
      data-assistant-bubble=""
      data-sheet-open={open ? 'true' : 'false'}
      aria-label={PANEL_COPY['bubble.ariaLabel']}
      aria-expanded={open}
      aria-controls={panelId}
      aria-describedby={hasNewAnswer && !open ? DOT_ID : undefined}
      onClick={onToggle}
      style={{ zIndex: 25 }}
    >
      {open ? <X size={22} aria-hidden="true" /> : <MessageCircleQuestionMark size={22} aria-hidden="true" />}
      {hasNewAnswer && !open && <span className="jv-assistant-dot" aria-hidden="true" />}
      <span id={DOT_ID} className="jv-assistant-sr">{hasNewAnswer && !open ? PANEL_EXTRA['bubble.newAnswer'] : ''}</span>
    </button>
  );
});
