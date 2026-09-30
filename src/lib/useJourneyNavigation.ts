import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { JourneyProject } from '../types/journey';
import { parkJourney, readParkedJourney } from './journeyStorage';
import { renameRefusal } from './saveOutcome';
import type { Refusal, SaveStatus } from './saveOutcome';
import { buildAppPath, historyMode, parseAppLocation, type AppPage, type AppRoute } from './journeyRoute';
import {
  NOT_IN_ACCOUNT,
  NOT_IN_BROWSER,
  RENAME_NOT_KEPT,
  STEP_GONE,
  SWITCH_REFUSED,
  SWITCH_REFUSED_LOCAL,
  duplicateJourney,
  fromServerJourney,
  hasUnsavedEdits,
  journeyToken,
  newJourneyId,
  openRefusal,
  renameJourney,
  switchUnsaved
} from './journeyLibrary';
import { getAccountJourney, saveAccountJourney } from './journeyClient';
import { WRITE_DIVERGED, adoptChangesNothing, chooseOnLoad, readSyncRecord } from './accountSync';

/**
 * Switching journeys and keeping the address in step with what is on screen, called once from App.
 *
 * Every value App hands in is kept in a ref that is updated on each render, and every async path
 * reads the project, the user, the save state and the save function from that ref at the moment
 * it needs them. A closure would hand a switch the journey as it was when the click happened.
 *
 * Choosing a journey or a page adds a history entry; choosing a step only replaces the address,
 * so Back moves between journeys and pages, and the address always names the open step.
 */

// ---- Browser copies ----
// Re-exported so the library dialog reads browser copies through the same module as the switch.
export { parkJourney, readParkedJourney, listLocalJourneys } from './journeyStorage';

// ---- The hook ----

export interface JourneyNavigationOptions {
  project: JourneyProject;
  setProject: Dispatch<SetStateAction<JourneyProject>>;
  user: { uid: string } | null;
  /** True once Firebase has said who is signed in (or that nobody is). */
  authReady: boolean;
  saveStatus: SaveStatus;
  setSaveStatus: (status: SaveStatus) => void;
  /** Save the open journey to the account now. Resolves true only when it landed (#8's saveNow). */
  handleSave: () => Promise<boolean>;
  activePage: AppPage;
  setActivePage: (page: AppPage) => void;
  selectedNodeId: string | null;
  /**
   * How a step is chosen; pass #7's selectStep so the one selection path is used. A switch names
   * the journey it opens, because App's selectStep would otherwise look the step up in the journey
   * of the render it came from (the one being left) and miss a Retention Flows step it must show.
   */
  setSelectedNodeId: (id: string | null, inJourney?: JourneyProject) => void;
  setSelectedEdgeId: (id: string | null) => void;
  /** The journey the first address named when this browser did not have it. */
  initialMissingId: string | null;
  /** The step the first address named. */
  initialStep: string | null;
  /** Runs after every switch, to clear state that belonged to the previous journey. */
  onSwitched?: () => void;
  /** #8's markLoaded: an account copy just opened is already saved, so it is not an edit. */
  markLoaded?: (updatedAt: string) => void;
}

export interface OpenOptions {
  /** False when the address already names the target (Back and Forward). */
  history?: boolean;
  step?: string | null;
  /**
   * The caller shows a refusal itself (the library dialog), so it is returned and not also put in
   * the header notice: one refusal, one place.
   */
  inline?: boolean;
}

export interface JourneyNavigation {
  openJourney: (id: string, opts?: OpenOptions) => Promise<Refusal | null>;
  /** Leave the open journey (keeping it) and put `project` on the canvas. */
  startJourney: (project: JourneyProject, opts?: Pick<OpenOptions, 'inline'>) => Promise<Refusal | null>;
  duplicateJourneyById: (id: string, opts?: Pick<OpenOptions, 'inline'>) => Promise<Refusal | null>;
  renameJourneyById: (id: string, name: string) => Promise<Refusal | null>;
  /** One sentence for the problems banner, or null. */
  notice: Refusal | null;
  dismissNotice: () => void;
  /** Re-runs the action the notice is about. Only offer it when notice.retryable. */
  retryNotice: () => void;
  /** True while a deep link or a switch is loading. */
  pending: boolean;
  /** Call when App adopts a newer account copy of the open journey (the sign-in load). */
  noteLoaded: (updatedAt: string) => void;
}

type Body = JourneyProject | 'missing' | Refusal;

const isRefusal = (b: Body): b is Refusal => typeof b === 'object' && b !== null && 'message' in b && !('nodes' in b);

export function useJourneyNavigation(opts: JourneyNavigationOptions): JourneyNavigation {
  const latestRef = useRef(opts);
  latestRef.current = opts;

  const [notice, setNoticeState] = useState<Refusal | null>(null);
  const retryRef = useRef<(() => void) | null>(null);
  const [pending, setPending] = useState(() => !!opts.initialMissingId);

  /** updatedAt of the open journey as it was opened: an edit since then is unsaved. */
  const openedAtRef = useRef(opts.project.updatedAt);
  /** The address names something that is not on screen, so the next sync replaces it. */
  const replaceNextRef = useRef(false);
  const deepLinkRef = useRef<string | null>(opts.initialMissingId);
  const unresolvedIdRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  /** Each switch takes a number; one that is overtaken by a newer one applies nothing. */
  const opRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const setNotice = useCallback((next: Refusal | null, retry?: () => void) => {
    retryRef.current = next && next.retryable && retry ? retry : null;
    setNoticeState(next);
  }, []);

  const api = useMemo(() => {
    /** The address of what is on screen now. */
    const currentPath = () => {
      const cur = latestRef.current;
      const onCanvas = cur.activePage === 'canvas';
      return buildAppPath({ page: cur.activePage, journeyId: onCanvas ? cur.project.id : null, step: onCanvas ? cur.selectedNodeId : null }, window.location.search);
    };

    /**
     * The journey as this browser or the account holds it now. Which copy is chosen by lineage, the
     * rule App's sign-in load uses (chooseOnLoad), never by the later stamp: a browser copy that did
     * not come from the account copy is not the one to show or write (F1). `diverged` says this
     * browser holds such a copy, which App's load then sets aside when the journey is opened.
     */
    const loadBody = async (id: string): Promise<{ body: Body; fromAccount: boolean; diverged: boolean }> => {
      const cur = latestRef.current;
      if (id === cur.project.id) return { body: cur.project, fromAccount: false, diverged: false };
      const local = readParkedJourney(id);
      if (!cur.user) return { body: local || 'missing', fromAccount: false, diverged: false };
      const answer = await getAccountJourney(id, cur.user.uid);
      const ok = !!answer && answer.status >= 200 && answer.status < 300 && (answer.body as { success?: unknown })?.success === true;
      if (!ok) return { body: local || openRefusal(answer), fromAccount: false, diverged: false };
      const remote = fromServerJourney((answer!.body as { journey?: unknown }).journey);
      if (!remote || !local) return { body: remote || local || 'missing', fromAccount: !!remote, diverged: false };
      const choice = chooseOnLoad(local.updatedAt, remote.updatedAt, readSyncRecord(cur.user.uid, id), adoptChangesNothing(local, remote));
      return choice === 'keep'
        ? { body: local, fromAccount: false, diverged: false }
        : { body: remote, fromAccount: true, diverged: choice === 'set-aside' };
    };

    /**
     * Keeps the open journey before it leaves the canvas: saved to the account first when signed in
     * with unsaved edits, and always into its own browser copy. Refused only when neither holds it.
     */
    const leaveCurrent = async (): Promise<{ refusal: Refusal | null; notice: Refusal | null }> => {
      const cur = latestRef.current;
      const unsaved = hasUnsavedEdits(cur.saveStatus, cur.project.updatedAt, openedAtRef.current);
      const savedOk = cur.user && unsaved ? await cur.handleSave() : false;
      const accountHasIt = !!cur.user && (!unsaved || savedOk);
      const leaving = latestRef.current.project;
      const parked = parkJourney(leaving);
      if (!parked && !accountHasIt) {
        // Signed in, a later save can land, so trying again can help; signed out it cannot.
        const refusal = cur.user ? { message: SWITCH_REFUSED, retryable: true } : { message: SWITCH_REFUSED_LOCAL, retryable: false };
        return { refusal, notice: null };
      }
      const notice = cur.user && !accountHasIt ? { message: switchUnsaved(leaving.name), retryable: false } : null;
      return { refusal: null, notice };
    };

    const activate = (target: JourneyProject, step: string | null, notice: Refusal | null, fromAccount: boolean) => {
      const cur = latestRef.current;
      const hasStep = !!step && target.nodes.some(n => n.id === step);
      if (fromAccount) cur.markLoaded?.(target.updatedAt);
      cur.setProject(target);
      cur.setSelectedEdgeId(null);
      cur.setSelectedNodeId(hasStep ? step : null, target);
      cur.setSaveStatus({ kind: 'idle' });
      cur.setActivePage('canvas');
      openedAtRef.current = target.updatedAt;
      setNotice(step && !hasStep ? { message: STEP_GONE, retryable: false } : notice);
      cur.onSwitched?.();
    };

    const fail = (refusal: Refusal, retry: () => void, inline = false) => {
      // The address may name the journey that could not be opened (Back, a deep link).
      window.history.replaceState(window.history.state, '', currentPath());
      if (!inline) setNotice(refusal, retry);
    };

    // `history` needs no branch here: after Back or Forward the address already names the target,
    // so the sync effect finds nothing to write, and after a click it pushes.
    const openJourney = async (id: string, { step = null, inline = false }: OpenOptions = {}): Promise<Refusal | null> => {
      const op = ++opRef.current;
      const retry = () => { void openJourney(id, { history: true, step }); };
      setPending(true);
      try {
        // Load before leaving, so a journey that cannot be opened never costs a save.
        const { body, fromAccount } = await loadBody(id);
        if (!aliveRef.current || op !== opRef.current) return null;
        let refusal: Refusal | null = null;
        if (body === 'missing') refusal = { message: latestRef.current.user ? NOT_IN_ACCOUNT : NOT_IN_BROWSER, retryable: false };
        else if (isRefusal(body)) refusal = body;
        if (refusal) {
          fail(refusal, retry, inline);
          return refusal;
        }
        const target = body as JourneyProject;
        if (target.id === latestRef.current.project.id) {
          // Already open: only the step can change.
          const hasStep = !!step && target.nodes.some(n => n.id === step);
          if (step) latestRef.current.setSelectedNodeId(hasStep ? step : null);
          if (step && !hasStep) setNotice({ message: STEP_GONE, retryable: false });
          latestRef.current.setActivePage('canvas');
          return null;
        }
        const left = await leaveCurrent();
        if (!aliveRef.current || op !== opRef.current) return null;
        if (left.refusal) {
          fail(left.refusal, retry, inline);
          return left.refusal;
        }
        activate(target, step, left.notice, fromAccount);
        return null;
      } finally {
        if (aliveRef.current && op === opRef.current) setPending(false);
      }
    };

    const startJourney = async (project: JourneyProject, { inline = false }: Pick<OpenOptions, 'inline'> = {}): Promise<Refusal | null> => {
      const op = ++opRef.current;
      const retry = () => { void startJourney(project); };
      setPending(true);
      try {
        const left = await leaveCurrent();
        if (!aliveRef.current || op !== opRef.current) return null;
        if (left.refusal) {
          fail(left.refusal, retry, inline);
          return left.refusal;
        }
        activate(project, null, left.notice, false);
        return null;
      } finally {
        if (aliveRef.current && op === opRef.current) setPending(false);
      }
    };

    const duplicateJourneyById = async (id: string, opts: Pick<OpenOptions, 'inline'> = {}): Promise<Refusal | null> => {
      const { body } = await loadBody(id);
      if (!aliveRef.current) return null;
      if (body === 'missing') return { message: latestRef.current.user ? NOT_IN_ACCOUNT : NOT_IN_BROWSER, retryable: false };
      if (isRefusal(body)) return body;
      const copy = duplicateJourney(body as JourneyProject, {
        id: newJourneyId(Date.now(), journeyToken()),
        now: new Date().toISOString(),
        token: journeyToken()
      });
      return startJourney(copy, opts);
    };

    const renameJourneyById = async (id: string, name: string): Promise<Refusal | null> => {
      const now = new Date().toISOString();
      const cur = latestRef.current;
      if (id === cur.project.id) {
        // The open journey: an edit like any other, so autosave keeps it and Undo can reverse it.
        if (renameJourney(cur.project, name, now)) {
          cur.setProject(p => (p.id === id ? renameJourney(p, name, now) || p : p));
        }
        return null;
      }
      const { body, diverged } = await loadBody(id);
      if (!aliveRef.current) return null;
      if (body === 'missing') return { message: latestRef.current.user ? NOT_IN_ACCOUNT : NOT_IN_BROWSER, retryable: false };
      if (isRefusal(body)) return body;
      // Renaming the account copy would put it over this browser's own: opening the journey keeps both.
      // Worded as the library write's own refusal of the same case (journeyClient.ts writeRefusal).
      if (diverged) return renameRefusal({ status: 409, body: { success: false, error: WRITE_DIVERGED } });
      const renamed = renameJourney(body as JourneyProject, name, now);
      if (!renamed) return null;
      const user = latestRef.current.user;
      if (user) {
        // The account first: a refused rename changes nothing, here or in this browser.
        const refused = renameRefusal(await saveAccountJourney(user.uid, renamed));
        if (refused) return refused;
        parkJourney(renamed);
        return null;
      }
      return parkJourney(renamed) ? null : { message: RENAME_NOT_KEPT, retryable: true };
    };

    return { openJourney, startJourney, duplicateJourneyById, renameJourneyById, currentPath };
  }, [setNotice]);

  // Keep the address in step with what is on screen. Held while a switch is loading, so the
  // address never names a journey for the moment before it is shown.
  const { activePage, project, selectedNodeId } = opts;
  useEffect(() => {
    if (pending) return;
    const here = parseAppLocation(window.location.pathname, window.location.search);
    const onCanvas = activePage === 'canvas';
    const nextRoute: AppRoute = { page: activePage, journeyId: onCanvas ? project.id : null, step: onCanvas ? selectedNodeId : null };
    const next = buildAppPath(nextRoute, window.location.search);
    if (next === window.location.pathname + window.location.search) {
      replaceNextRef.current = false;
      return;
    }
    let mode = historyMode(here, nextRoute);
    if (replaceNextRef.current) mode = 'replace';
    replaceNextRef.current = false;
    if (mode === 'push') window.history.pushState({ page: activePage }, '', next);
    else window.history.replaceState({ page: activePage }, '', next);
  }, [activePage, project.id, selectedNodeId, pending]);

  // Back and Forward.
  useEffect(() => {
    const onPop = () => {
      const route = parseAppLocation(window.location.pathname, window.location.search);
      const cur = latestRef.current;
      cur.setActivePage(route.page);
      if (route.page !== 'canvas') return;
      if (route.journeyId === null || route.journeyId === cur.project.id) {
        if (!route.step) {
          cur.setSelectedNodeId(null);
          return;
        }
        if (cur.project.nodes.some(n => n.id === route.step)) {
          cur.setSelectedEdgeId(null);
          cur.setSelectedNodeId(route.step);
          return;
        }
        cur.setSelectedNodeId(null);
        setNotice({ message: STEP_GONE, retryable: false });
        window.history.replaceState(window.history.state, '', buildAppPath({ page: 'canvas', journeyId: cur.project.id, step: null }, window.location.search));
        return;
      }
      void api.openJourney(route.journeyId, { history: false, step: route.step });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [api, setNotice]);

  // A first address naming a journey this browser does not have waits for sign-in to be known.
  const { authReady, user } = opts;
  useEffect(() => {
    if (!authReady || !deepLinkRef.current) return;
    const id = deepLinkRef.current;
    deepLinkRef.current = null;
    if (latestRef.current.user) {
      void api.openJourney(id, { history: false, step: latestRef.current.initialStep });
      return;
    }
    unresolvedIdRef.current = id;
    replaceNextRef.current = true;
    setNotice({ message: NOT_IN_BROWSER, retryable: false });
    setPending(false);
  }, [authReady, api, setNotice]);

  // Signing in while that notice still shows opens the journey once.
  useEffect(() => {
    if (!user || !unresolvedIdRef.current) return;
    const id = unresolvedIdRef.current;
    unresolvedIdRef.current = null;
    if (notice?.message !== NOT_IN_BROWSER) return;
    setNotice(null);
    void api.openJourney(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // A first address naming a step this journey does not have.
  useEffect(() => {
    const { initialStep, initialMissingId, project: first } = latestRef.current;
    if (initialStep && !initialMissingId && !first.nodes.some(n => n.id === initialStep)) {
      setNotice({ message: STEP_GONE, retryable: false });
    }
  }, [setNotice]);

  const dismissNotice = useCallback(() => setNotice(null), [setNotice]);
  const retryNotice = useCallback(() => {
    const retry = retryRef.current;
    setNotice(null);
    retry?.();
  }, [setNotice]);
  const noteLoaded = useCallback((updatedAt: string) => { openedAtRef.current = updatedAt; }, []);

  return {
    openJourney: api.openJourney,
    startJourney: api.startJourney,
    duplicateJourneyById: api.duplicateJourneyById,
    renameJourneyById: api.renameJourneyById,
    notice,
    dismissNotice,
    retryNotice,
    pending,
    noteLoaded
  };
}
