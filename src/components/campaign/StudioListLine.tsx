import React from 'react';
import { retryLabel, type ListLine } from '../../lib/studioLoad';

/**
 * The one line a studio list shows above its rows (EMAIL_STUDIO_PLAN.md D6, Wave 6): while it loads, a
 * status; once it loaded empty, its empty sentence; after a failed read, an alert with its failure and,
 * where retrying can help, Retry. Nothing once rows are on screen. The words are src/lib/studioLoad.ts's.
 * `data-studio-state` names the kind, so the browser check reads which line is drawn, not just its words.
 */
export const StudioListLine: React.FC<{
  line: ListLine;
  /** Reads the list again. Without it a failure shows no Retry. */
  onRetry?: () => void;
  /** True while that read runs: Retry reads Retrying and does nothing. */
  busy?: boolean;
}> = ({ line, onRetry, busy }) => {
  // A Retry that fails again with the same words changes nothing in the alert, and a screen reader does
  // not read an unchanged alert twice. Each time a read that was running ends, the failure is drawn as a
  // new node, so it is said again. Retry itself stays the same node, so keyboard focus stays on it.
  const [round, setRound] = React.useState(0);
  const wasBusy = React.useRef(Boolean(busy));
  React.useEffect(() => {
    if (wasBusy.current && !busy) setRound((n) => n + 1);
    wasBusy.current = Boolean(busy);
  }, [busy]);
  if (line.kind !== 'failed') {
    if (line.kind === 'none') return null;
    if (line.kind === 'loading') {
      return <p role="status" data-studio-state="loading" style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>{line.text}</p>;
    }
    return <p data-studio-state="empty" style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>{line.text}</p>;
  }
  return (
    <div
      role="alert"
      data-studio-state="failed"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(248, 113, 113, 0.35)', backgroundColor: 'rgba(248, 113, 113, 0.08)', color: '#fecaca', fontSize: 13 }}
    >
      <span key={round}>{line.text}</span>
      {line.retry && onRetry && (
        <button
          type="button"
          // Named for what failed, so one Retry is told from another (retryLabel).
          aria-label={retryLabel(line.text, busy)}
          // aria-disabled, not disabled: a disabled button drops keyboard focus to the page.
          aria-disabled={busy || undefined}
          onClick={() => { if (!busy) onRetry(); }}
          style={{ minHeight: 36, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(255, 255, 255, 0.2)', backgroundColor: 'transparent', color: '#f3f4f6', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
        >
          {busy ? 'Retrying' : 'Retry'}
        </button>
      )}
    </div>
  );
};
