import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { JourneyProject } from '../types/journey';
import {
  createHistory,
  historyShortcut,
  onlyPositionsDiffer,
  recordEdit,
  redoStep,
  restoreSnapshot,
  saveFingerprint,
  undoStep,
  type JourneyHistory,
  type HistoryStep
} from './journeyHistory';
import { AUTOSAVE_DELAY_MS, createAutosaver, type Autosaver } from './journeyAutosave';
import { nodesAt, type Positions } from './journeyLayout';
import { modalIsOpen } from './modalOpen';
import { writeSyncRecord } from './accountSync';

/**
 * Undo, autosave and the leave warning for the canvas, called once from App.
 *
 * History is recorded by watching `project`, so every setProject call is undoable with no
 * snapshot call at its site. Three kinds of change are told apart by the updatedAt they carry:
 * an undo or redo (not a new step), the server copy loaded at sign-in (not a step, and already
 * saved), and everything else. A new project id empties the history.
 */

interface Options {
  project: JourneyProject;
  setProject: Dispatch<SetStateAction<JourneyProject>>;
  /** Writes one journey. Resolves true only when the write landed. */
  save: (doc: JourneyProject) => Promise<boolean>;
  signedIn: boolean;
  /** The signed-in user's uid: a loaded account copy is recorded as that account's revision (F1). */
  accountUid: string | null;
  /** False holds autosave, for example until the sign-in load has answered. */
  ready: boolean;
  /** The undo and redo keys only work while this is true. */
  shortcutsActive: boolean;
}

export interface JourneyEditing {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /**
   * Undo the latest step only when it did nothing but move steps and undoing it puts every named
   * step back at `positions`. Returns false, changing nothing, otherwise (a later edit is on top).
   */
  undoMove: (positions: Positions) => boolean;
  /** Call right before setProject with the server copy stamped `updatedAt`: no step, already saved. */
  markLoaded: (updatedAt: string) => void;
  /**
   * The account holds `accountCopy` and the journey on screen, kept at sign-in, is edits on top of
   * it: those edits read as unsaved and autosave sends them once the journey is released (F1).
   */
  markAccountCopy: (accountCopy: JourneyProject) => void;
  /** Save now, even when nothing changed. Resolves true when it landed. */
  saveNow: () => Promise<boolean>;
  /** Saves first; asks `question` only when that save did not land. Resolves true to go ahead. */
  confirmLeave: (question: string) => Promise<boolean>;
  /** A save is waiting on its timer. */
  savePending: boolean;
  /** The latest content has not landed. */
  unsaved: boolean;
}

type Quiet = 'restore' | 'load';
/** A load that kept the newer local copy never consumes its stamp, so keep the map small. */
const QUIET_MAX = 32;

const flags = (h: JourneyHistory) => `${h.past.length > 0}:${h.future.length > 0}`;

export function useJourneyEditing({ project, setProject, save, signedIn, accountUid, ready, shortcutsActive }: Options): JourneyEditing {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [saveState, setSaveState] = useState({ pending: false, dirty: false });

  const historyRef = useRef<JourneyHistory>(createHistory());
  const projectRef = useRef(project);
  projectRef.current = project;
  const committedRef = useRef(project);
  const saveRef = useRef(save);
  saveRef.current = save;
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const accountUidRef = useRef(accountUid);
  accountUidRef.current = accountUid;
  /** A journey whose kept edits must be sent once autosave is released, even if they failed before. */
  const resaveRef = useRef<string | null>(null);
  const setProjectRef = useRef(setProject);
  setProjectRef.current = setProject;
  const quietRef = useRef(new Map<string, Quiet>());

  const saverRef = useRef<Autosaver<JourneyProject> | null>(null);
  if (!saverRef.current) {
    const saver = createAutosaver<JourneyProject>({
      save: doc => saveRef.current(doc),
      fingerprint: saveFingerprint,
      keyOf: p => p.id,
      delayMs: () => (signedInRef.current ? AUTOSAVE_DELAY_MS : 0),
      canAutosave: () => readyRef.current,
      onState: s => setSaveState(prev => (
        prev.pending === s.pending && prev.dirty === s.dirty ? prev : { pending: s.pending, dirty: s.dirty }
      ))
    });
    saver.baseline(project);
    saverRef.current = saver;
  }
  const saver = saverRef.current;

  const quiet = (stamp: string, why: Quiet) => {
    const map = quietRef.current;
    map.delete(stamp);
    map.set(stamp, why);
    while (map.size > QUIET_MAX) map.delete(map.keys().next().value as string);
  };

  const setHistory = (next: JourneyHistory) => {
    const before = flags(historyRef.current);
    historyRef.current = next;
    if (flags(next) !== before) bump();
  };

  useEffect(() => {
    const before = committedRef.current;
    committedRef.current = project;
    if (before !== project) {
      const why = quietRef.current.get(project.updatedAt);
      quietRef.current.delete(project.updatedAt);
      if (before.id !== project.id || why === 'load') {
        setHistory(createHistory());
        if (why === 'load') {
          saver.baseline(project);
          // This browser's copy is now that account revision, so the next sign-in load keeps it (C00).
          if (accountUidRef.current) writeSyncRecord(accountUidRef.current, project.id, project.updatedAt, project.updatedAt);
        }
      } else if (why !== 'restore') {
        setHistory(recordEdit(historyRef.current, before, project, Date.now()));
      }
    }
    saver.schedule(project);
    // Kept edits whose last save was refused (a 409 before the load ran again) are the same
    // content, so schedule holds them back; the account copy has been read again, so send them.
    if (ready && resaveRef.current === project.id) {
      resaveRef.current = null;
      const s = saver.state();
      if (s.dirty && !s.pending && !s.inFlight) void saver.flush();
    }
    // setHistory and saver are stable for the life of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, ready]);

  // Undo and redo read refs, so they stay the same functions for the life of the component.
  const apply = useCallback((step: HistoryStep | null) => {
    if (!step) return;
    const stamp = new Date().toISOString();
    quiet(stamp, 'restore');
    // Move the present forward now, so a second key press before React renders steps from here.
    const restored = restoreSnapshot(projectRef.current, step.target, stamp);
    projectRef.current = restored;
    setHistory(step.history);
    setProjectRef.current(cur => restoreSnapshot(cur, step.target, stamp));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undo = useCallback(() => apply(undoStep(historyRef.current, projectRef.current)), [apply]);
  const redo = useCallback(() => apply(redoStep(historyRef.current, projectRef.current)), [apply]);
  // The tidy notice's Undo: the same stack as Cmd+Z, used only while the tidy is still on top.
  const undoMove = useCallback((positions: Positions) => {
    const step = undoStep(historyRef.current, projectRef.current);
    if (!step || !onlyPositionsDiffer(step.target, projectRef.current) || !nodesAt(step.target.nodes || [], positions)) {
      return false;
    }
    apply(step);
    return true;
  }, [apply]);

  useEffect(() => {
    if (!shortcutsActive) return;
    const onKey = (e: KeyboardEvent) => {
      // The map behind an open modal is inert: undo there would pull a change out from under it.
      if (modalIsOpen(document)) return;
      const action = historyShortcut(e, e.target as HTMLElement | null);
      if (!action) return;
      e.preventDefault();
      if (action === 'undo') undo();
      else redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcutsActive, undo, redo]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = saver.state();
      if (!s.dirty && !s.inFlight) return;
      e.preventDefault();
      e.returnValue = '';
      // Only helps if the person stays: nothing runs while the browser's dialog is open.
      if (readyRef.current) void saver.flush();
    };
    // A hidden tab may never come back (mobile browsers skip beforeunload), so save on the way out.
    // Held while autosave is held: a failed sign-in load means the server may hold a newer copy.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && readyRef.current) void saver.flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [saver]);

  // Only the timer: the saver itself outlives a StrictMode remount.
  useEffect(() => () => saver.cancelTimer(), [saver]);

  const markLoaded = useCallback((updatedAt: string) => quiet(String(updatedAt), 'load'), []);
  const markAccountCopy = useCallback((accountCopy: JourneyProject) => {
    saver.baseline(accountCopy);
    resaveRef.current = projectRef.current.id;
    saver.schedule(projectRef.current);
  }, [saver]);
  const saveNow = useCallback(() => saver.flush({ force: true }), [saver]);
  const confirmLeave = useCallback(
    async (question: string) => (await saver.flush()) || window.confirm(question),
    [saver]
  );

  return {
    canUndo: historyRef.current.past.length > 0,
    canRedo: historyRef.current.future.length > 0,
    undo,
    redo,
    undoMove,
    markLoaded,
    markAccountCopy,
    saveNow,
    confirmLeave,
    savePending: saveState.pending,
    unsaved: saveState.dirty
  };
}
