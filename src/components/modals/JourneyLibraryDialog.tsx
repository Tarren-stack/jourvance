import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { JourneyProject } from '../../types/journey';
import type { Refusal } from '../../lib/saveOutcome';
import { ModalDialog } from './ModalDialog';
import {
  REMOVE_OPEN,
  REMOVE_REFUSED,
  RESTORE_REFUSED,
  browserCopyHasOwnChanges,
  mergeLibrary,
  readJourneyList,
  removalConsequence,
  removeNotSavedHere,
  removeOpenElsewhere,
  removedNotice,
  type AccountJourneyRow,
  type JourneySummary
} from '../../lib/journeyLibrary';
import { listAccountJourneys } from '../../lib/journeyClient';
import { listLocalJourneys } from '../../lib/useJourneyNavigation';
import {
  activeSlotHold,
  browserStorageUsage,
  removeBrowserJourney,
  restoreBrowserJourney,
  storageUsageLine,
  type ActiveSlotHold,
  type RemovedBrowserJourney
} from '../../lib/journeyStorage';
import { readSyncRecord } from '../../lib/accountSync';

/**
 * Every journey this browser keeps, plus the account's when signed in: open, rename, duplicate,
 * and remove a browser copy. A list the account could not answer in full is never shown as
 * complete; the browser's journeys are listed with one sentence saying what is missing.
 *
 * A browser copy is removed only when the person asks, after a confirm naming the journey and
 * what removing it costs, and Undo puts back the exact stored copy for UNDO_MS. The journey that
 * is open is never offered. A usage line estimates how much of this browser's storage is used.
 */

interface JourneyLibraryDialogProps {
  project: JourneyProject;
  user: { uid: string } | null;
  onClose: () => void;
  /** `inline`: this dialog shows the refusal itself, so the header must not repeat it. */
  onOpen: (id: string, opts: { inline: true }) => Promise<Refusal | null>;
  onRename: (id: string, name: string) => Promise<Refusal | null>;
  onDuplicate: (id: string, opts: { inline: true }) => Promise<Refusal | null>;
  onNewJourney: () => void;
  /** A browser copy was removed, so a save refused for want of space may now land. */
  onFreedSpace?: () => void;
}

interface PendingRemoval {
  id: string;
  name: string;
  consequence: string;
}

/** What the notice under the heading says after a removal or an Undo. */
type RemovalNotice =
  | { kind: 'removed'; name: string; removed: RemovedBrowserJourney }
  | { kind: 'restored'; name: string };

const TITLE_ID = 'journey-library-title';
const CONFIRM_TITLE_ID = 'journey-remove-title';
const CONFIRM_DESC_ID = 'journey-remove-desc';
/** How long Undo is offered after a removal. Paused while the pointer or focus is on it. */
export const UNDO_MS = 8000;

const buttonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 10px',
  minHeight: '30px',
  fontSize: '12px',
  fontWeight: 600,
  borderRadius: '6px',
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface-2)',
  color: 'var(--color-text-main)',
  cursor: 'pointer'
};

const tagStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: '999px',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)',
  whiteSpace: 'nowrap'
};

function describeRow(row: JourneySummary): string {
  const steps = row.nodeCount === 1 ? '1 step.' : `${row.nodeCount} steps.`;
  const when = new Date(row.updatedAt).getTime();
  // The starter map is stamped at time zero (defaultBlueprint.ts) so any saved copy wins; that
  // stamp is "never edited", not a date to show.
  return Number.isNaN(when) || when <= 0 ? steps : `${steps} Edited ${new Date(when).toLocaleDateString()}.`;
}

export const JourneyLibraryDialog: React.FC<JourneyLibraryDialogProps> = ({
  project,
  user,
  onClose,
  onOpen,
  onRename,
  onDuplicate,
  onNewJourney,
  onFreedSpace
}) => {
  const [localProjects, setLocalProjects] = useState<JourneyProject[]>(() => listLocalJourneys());
  const [accountRows, setAccountRows] = useState<AccountJourneyRow[] | null>(null);
  // True only once the account answered in full: a failed or partial list says nothing about
  // which journeys the account is missing.
  const [accountComplete, setAccountComplete] = useState(false);
  const [listNotice, setListNotice] = useState<Refusal | null>(null);
  const [loading, setLoading] = useState(!!user);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = user?.uid || null;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const retried = useRef(false);
  const [confirmRemoval, setConfirmRemoval] = useState<PendingRemoval | null>(null);
  const [removalNotice, setRemovalNotice] = useState<RemovalNotice | null>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const undoTimer = useRef<number | null>(null);
  // Focus goes to Undo once the confirm has closed; the removed row's button is gone.
  const focusUndo = useRef(false);

  const loadAccount = useCallback(async (isCancelled: () => boolean) => {
    if (!uid) {
      setAccountRows(null);
      setAccountComplete(false);
      setListNotice(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const answer = await listAccountJourneys();
    if (isCancelled()) return;
    const { rows, complete, notice } = readJourneyList(answer);
    setAccountRows(rows);
    setAccountComplete(complete);
    setListNotice(notice);
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    let cancelled = false;
    void loadAccount(() => cancelled);
    return () => { cancelled = true; };
  }, [loadAccount]);

  // A retry that clears the notice removes the Try again button that held focus; hand focus to
  // the dialog title rather than letting it fall to the page behind.
  useEffect(() => {
    if (!retried.current || loading) return;
    retried.current = false;
    if (!retryRef.current) titleRef.current?.focus();
  }, [listNotice, loading]);

  // The journey on the canvas is newer than any stored copy of it.
  const rows = useMemo(() => {
    const local = [project, ...localProjects.filter(p => p.id !== project.id)];
    return mergeLibrary(local, uid ? accountRows : null, project.id);
  }, [project, localProjects, accountRows, uid]);

  // Read again whenever the list changes: a removal, an Undo, or the open journey's autosave.
  const usageLine = useMemo(() => storageUsageLine(browserStorageUsage()), [localProjects, project]);

  const stopUndoTimer = () => {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    undoTimer.current = null;
  };
  const startUndoTimer = () => {
    stopUndoTimer();
    undoTimer.current = window.setTimeout(() => {
      undoTimer.current = null;
      // Undo is about to go: focus on it would fall to the page, so it moves to the heading.
      if (document.activeElement === undoRef.current) titleRef.current?.focus();
      setRemovalNotice(null);
    }, UNDO_MS);
  };
  useEffect(() => stopUndoTimer, []);
  useEffect(() => {
    if (!removalNotice) return;
    startUndoTimer();
    if (focusUndo.current) {
      focusUndo.current = false;
      undoRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [removalNotice]);

  // Why a journey the active slot still holds is not removed. Another tab is named only when this
  // tab's own last write to the slot landed; otherwise this tab could not write over it (a full
  // browser), and the advice is to make room, when some other browser copy can be removed.
  const slotRefusal = (hold: ActiveSlotHold, id: string, name: string) =>
    hold.kind === 'another-tab'
      ? removeOpenElsewhere(name)
      : removeNotSavedHere(name, hold.full, rows.some(r => r.inBrowser && r.id !== project.id && r.id !== id));

  const askToRemove = (row: JourneySummary) => {
    if (row.id === project.id) {
      setRefusal({ message: REMOVE_OPEN, retryable: false });
      return;
    }
    // Refused before the confirm rather than after it: asking would promise a removal that cannot happen.
    const hold = activeSlotHold(row.id, project.id);
    if (hold) {
      setRefusal({ message: slotRefusal(hold, row.id, row.name), retryable: false });
      return;
    }
    const local = localProjects.find(p => p.id === row.id);
    const account = accountRows?.find(r => r.id === row.id);
    const ownChanges = !!local && !!account && !!uid && browserCopyHasOwnChanges(String(local.updatedAt || ''), account.updatedAt, readSyncRecord(uid, row.id));
    setRefusal(null);
    setConfirmRemoval({
      id: row.id,
      name: row.name,
      consequence: removalConsequence({ signedIn: !!uid, accountListed: accountComplete, inAccount: row.inAccount, ownChanges })
    });
  };

  const remove = () => {
    const pending = confirmRemoval;
    if (!pending) return;
    const result = removeBrowserJourney(pending.id, project.id);
    setConfirmRemoval(null);
    if (!result.ok) {
      // Another tab may have opened it since the confirm, or the browser refused; either way nothing was removed.
      const message = result.reason === 'open' ? REMOVE_OPEN : result.reason === 'active-slot' ? slotRefusal(result.hold, pending.id, pending.name) : REMOVE_REFUSED;
      setRefusal({ message, retryable: false });
      setLocalProjects(listLocalJourneys());
      return;
    }
    setLocalProjects(listLocalJourneys());
    focusUndo.current = true;
    setRemovalNotice({ kind: 'removed', name: pending.name, removed: result.removed });
    onFreedSpace?.();
  };

  const undo = () => {
    if (removalNotice?.kind !== 'removed') return;
    if (!restoreBrowserJourney(removalNotice.removed)) {
      setRefusal({ message: RESTORE_REFUSED, retryable: false });
      return;
    }
    setLocalProjects(listLocalJourneys());
    setRefusal(null);
    // The Undo button goes with the notice below, so focus waits on the heading.
    titleRef.current?.focus();
    setRemovalNotice({ kind: 'restored', name: removalNotice.name });
  };

  const run = async (action: () => Promise<Refusal | null>, closeOnSuccess: boolean) => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const refused = await action();
      if (refused) {
        setRefusal(refused);
        return;
      }
      if (closeOnSuccess) onClose();
    } finally {
      setBusy(false);
    }
  };

  const rename = (row: JourneySummary) => {
    const name = window.prompt('Rename this journey:', row.name);
    if (name === null) return;
    void run(async () => {
      const refused = await onRename(row.id, name);
      if (!refused) {
        setLocalProjects(listLocalJourneys());
        const next = name.trim().slice(0, 100);
        if (next) setAccountRows(prev => prev && prev.map(r => (r.id === row.id ? { ...r, name: next } : r)));
      }
      return refused;
    }, false);
  };

  return (
    // The out-of-space banner's Open journeys button goes once a removal lets the save land, so focus
    // falls back to the header's Journeys button rather than the page body.
    <ModalDialog labelledBy={TITLE_ID} onClose={onClose} maxWidth={640} fallbackFocusSelectors={['[data-journeys-trigger]', '#journey-map']}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <h2 id={TITLE_ID} ref={titleRef} tabIndex={-1} style={{ fontSize: '16px', fontWeight: 700, flex: 1, minWidth: 0 }}>Your journeys</h2>
        <button type="button" onClick={onNewJourney} style={buttonStyle}>
          <Plus size={14} aria-hidden="true" />
          New journey
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close journeys"
          style={{ ...buttonStyle, padding: '6px', background: 'transparent', border: '1px solid transparent' }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {!uid && (
        <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
          You are signed out, so these journeys are kept in this browser only.
        </p>
      )}

      {usageLine && (
        <p
          data-storage-usage
          title="An estimate: browsers allow a site about 5 MB of this storage, and none of them report the exact figure."
          style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '10px' }}
        >
          {usageLine}
        </p>
      )}

      {/* Always rendered, so a screen reader hears the removal and the Undo when they appear. */}
      <div
        role="status"
        onMouseEnter={stopUndoTimer}
        onMouseLeave={event => { if (removalNotice && !event.currentTarget.contains(document.activeElement)) startUndoTimer(); }}
        onFocus={stopUndoTimer}
        onBlur={event => { if (removalNotice && !event.currentTarget.contains(event.relatedTarget as Node | null)) startUndoTimer(); }}
        style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '12px', marginBottom: removalNotice ? '10px' : 0 }}
      >
        {removalNotice && (
          <>
            <span style={{ flex: 1, minWidth: '200px' }}>
              {removalNotice.kind === 'removed' ? removedNotice(removalNotice.name) : `Put "${removalNotice.name}" back in this browser.`}
            </span>
            {removalNotice.kind === 'removed' && (
              <button type="button" ref={undoRef} style={buttonStyle} aria-label={`Undo removing ${removalNotice.name}`} onClick={undo}>
                Undo
              </button>
            )}
          </>
        )}
      </div>

      {listNotice && (
        <div
          role="alert"
          style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--color-warning)', marginBottom: '10px' }}
        >
          <span style={{ flex: 1, minWidth: '200px' }}>{listNotice.message}</span>
          {listNotice.retryable && (
            <button type="button" ref={retryRef} style={buttonStyle} onClick={() => { retried.current = true; void loadAccount(() => false); }}>
              Try again
            </button>
          )}
        </div>
      )}

      {refusal && (
        <p role="alert" style={{ fontSize: '12px', color: 'var(--color-danger)', marginBottom: '10px' }}>
          {refusal.message}
        </p>
      )}

      {loading && (
        <p role="status" style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
          Loading your journeys…
        </p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {rows.map(row => {
          const active = row.id === project.id;
          return (
            <li
              key={row.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                flexWrap: 'wrap',
                padding: '10px 12px',
                borderRadius: '8px',
                border: `1px solid ${active ? 'var(--color-border-focus)' : 'var(--color-border)'}`,
                background: 'var(--color-bg)'
              }}
            >
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, overflowWrap: 'anywhere' }}>{row.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>{describeRow(row)}</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                  {active && <span style={{ ...tagStyle, color: 'var(--color-accent)' }}>Open now</span>}
                  {/* Only once the account list was read in full: a failed or partial list says nothing about the account. */}
                  {uid && accountComplete && !row.inAccount && <span style={tagStyle}>This browser only</span>}
                  {row.newerInBrowser && <span style={tagStyle}>Unsaved changes in this browser</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {!active && (
                  <button type="button" style={buttonStyle} aria-label={`Open ${row.name}`} onClick={() => { void run(() => onOpen(row.id, { inline: true }), true); }}>
                    Open
                  </button>
                )}
                <button type="button" style={buttonStyle} aria-label={`Rename ${row.name}`} onClick={() => rename(row)}>
                  Rename
                </button>
                <button type="button" style={buttonStyle} aria-label={`Duplicate ${row.name}`} onClick={() => { void run(() => onDuplicate(row.id, { inline: true }), true); }}>
                  Duplicate
                </button>
                {/* The open journey is never offered: its copy is the one every edit writes. */}
                {row.inBrowser && !active && (
                  <button type="button" style={buttonStyle} aria-haspopup="dialog" aria-label={`Remove ${row.name} from this browser`} onClick={() => askToRemove(row)}>
                    Remove from this browser
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {confirmRemoval && (
        <ModalDialog labelledBy={CONFIRM_TITLE_ID} onClose={() => setConfirmRemoval(null)} maxWidth={440}>
          <h3 id={CONFIRM_TITLE_ID} style={{ fontSize: '15px', fontWeight: 700, marginBottom: '8px', overflowWrap: 'anywhere' }}>
            Remove "{confirmRemoval.name}" from this browser?
          </h3>
          <p id={CONFIRM_DESC_ID} style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--color-text-muted)', marginBottom: '16px' }}>
            {confirmRemoval.consequence} Undo is offered for a few seconds after.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
            {/* First, so it takes focus when the confirm opens: the safe choice. */}
            <button type="button" style={buttonStyle} aria-describedby={CONFIRM_DESC_ID} onClick={() => setConfirmRemoval(null)}>
              Cancel
            </button>
            <button
              type="button"
              aria-describedby={CONFIRM_DESC_ID}
              onClick={remove}
              style={{ ...buttonStyle, background: '#DC2626', border: '1px solid #DC2626', color: '#FFFFFF' }}
            >
              Remove from this browser
            </button>
          </div>
        </ModalDialog>
      )}
    </ModalDialog>
  );
};

export default JourneyLibraryDialog;
