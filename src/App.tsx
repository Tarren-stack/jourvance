import React, { useState, useEffect, useRef, Suspense, lazy, useMemo, useCallback } from 'react';
import type { JourneyProject, JourneyNode, JourneyEdge, JourneyNodeData, PageNodeData, NodeType, Workspace, CanvasViewMode, ActiveAppView } from './types/journey';
import { loadInitialJourney, saveCurrentJourney, keepJourney, parkJourney, readParkedJourney } from './lib/journeyStorage';
import { adoptChangesNothing, chooseOnLoad, forgetOtherAccounts, isSaveConflict, readSyncRecord, recordAfterConflict, writeSyncRecord, setAsideName, setAsideNotice, LOAD_FAILED, LOAD_PENDING, SAVE_CONFLICT, SET_ASIDE_FAILED, type SyncRecord } from './lib/accountSync';
import { parseAppLocation, type AppPage } from './lib/journeyRoute';
import { newJourneyId, journeyToken } from './lib/journeyLibrary';
import { useJourneyNavigation } from './lib/useJourneyNavigation';
import { repairJourneyHandles } from './lib/stepHandles';
import {
  readStoredRange,
  writeStoredRange,
  statsRequestBody,
  readStatsAnswer,
  metricsView,
  metricsLoading,
  metricsFailed,
  type MetricsState,
  type RangeDays
} from './lib/journeyMetrics';
import { Compass } from 'lucide-react';
import { CanvasHeader } from './components/toolbar/CanvasHeader';
import { AppSidebar } from './components/navigation/AppSidebar';
import { storeScoreFor } from './lib/funnelAuditor';
import { PublicHeader } from './components/public/PublicHeader';
import { PublicFooter } from './components/public/PublicFooter';
import { HomePage } from './components/public/HomePage';
import { AboutPage } from './components/public/AboutPage';
import { BlogPage } from './components/public/BlogPage';
import { ContactPage } from './components/public/ContactPage';
import { fetchWorkspaces, createWorkspace } from './lib/shopifyClient';
import { auth, onAuthStateChanged, logOut, authHeaders, type User } from './lib/firebase';
import type { FunnelForecast } from './types/journey';
import type { PublishedPageInfo } from './components/preview/PublishModal';
import { injectRetentionFlows, retentionFlowsThatFit, DEFAULT_FORECAST } from './lib/funnelForecaster';
import { checkJourneyDesign } from './lib/designChecks';
import { saveOutcome, browserSaveOutcome, publishRefusal, publishedPartly, publishWarning, unpublishRefusal, requestAnswer, type SaveStatus, type Refusal } from './lib/saveOutcome';
import { applyPublishResult, type PublishedStep } from './lib/publishState';
import { usePublication } from './lib/usePublication';
import { PublishStatusContext } from './components/canvas/PublishStatus';
import { useJourneyEditing } from './lib/useJourneyEditing';
import { noteAccountRead, postAccountJourney, refusedBase } from './lib/journeyClient';
import { revealsHiddenStep } from './lib/stepNavigation';
import { makeStep, newStamp } from './lib/stepDefaults';
import { linesWithBothEnds } from './lib/lineEnds';
import { slotForNewStep, defaultExit, type CanvasView, type AddRequest } from './lib/addStep';
import { SIGN_OUT_QUESTION } from './lib/journeyAutosave';
import { funnelReturnFor, returnStepId, returnBannerText, openAfterSave, type FunnelReturn } from './lib/editorReturn';
import { FunnelReturnBanner } from './components/campaign/FunnelReturnBanner';

// Code-split heavy interior app and modal bundles to ensure sub-second public page loads
const JourneyCanvas = lazy(() => import('./components/canvas/JourneyCanvas').then(m => ({ default: m.JourneyCanvas })));
const StepDock = lazy(() => import('./components/drawers/StepDock').then(m => ({ default: m.StepDock })));
const HubEmailSuite = lazy(() => import('./components/campaign/HubEmailSuite').then(m => ({ default: m.HubEmailSuite })));
const AttributionReports = lazy(() => import('./components/analytics/AttributionReports').then(m => ({ default: m.AttributionReports })));
const FinancialSimulatorDrawer = lazy(() => import('./components/drawers/FinancialSimulatorDrawer').then(m => ({ default: m.FinancialSimulatorDrawer })));
const PreFlightAuditDrawer = lazy(() => import('./components/drawers/PreFlightAuditDrawer').then(m => ({ default: m.PreFlightAuditDrawer })));
const OperatorDashboard = lazy(() => import('./components/admin/OperatorDashboard').then(m => ({ default: m.OperatorDashboard })));
const LiveFunnelModal = lazy(() => import('./components/preview/LiveFunnelModal').then(m => ({ default: m.LiveFunnelModal })));
const ShopifyConnectModal = lazy(() => import('./components/shopify/ShopifyConnectModal').then(m => ({ default: m.ShopifyConnectModal })));
const ShopifySyncModal = lazy(() => import('./components/modals/ShopifySyncModal').then(m => ({ default: m.ShopifySyncModal })));
const AuthModal = lazy(() => import('./components/auth/AuthModal').then(m => ({ default: m.AuthModal })));
const BillingModal = lazy(() => import('./components/billing/BillingModal').then(m => ({ default: m.BillingModal })));
const ExportAssetsModal = lazy(() => import('./components/export/ExportAssetsModal').then(m => ({ default: m.ExportAssetsModal })));
const PublishModal = lazy(() => import('./components/preview/PublishModal').then(m => ({ default: m.PublishModal })));
const BlueprintModal = lazy(() => import('./components/modals/BlueprintModal').then(m => ({ default: m.BlueprintModal })));
const SaveBlueprintModal = lazy(() => import('./components/modals/SaveBlueprintModal').then(m => ({ default: m.SaveBlueprintModal })));
const JourneyLibraryDialog = lazy(() => import('./components/modals/JourneyLibraryDialog').then(m => ({ default: m.JourneyLibraryDialog })));
const AiJourneyBuilder = lazy(() => import('./components/modals/AiJourneyBuilder').then(m => ({ default: m.AiJourneyBuilder })));
const LaunchPlaybookModal = lazy(() => import('./components/modals/LaunchPlaybookModal').then(m => ({ default: m.LaunchPlaybookModal })));

const SuspenseLoader: React.FC<{ label?: string }> = ({ label = 'Loading studio...' }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    width: '100%',
    minHeight: '260px',
    color: '#94a3b8',
    fontSize: '13px',
    gap: '10px'
  }}>
    <div style={{
      width: '16px',
      height: '16px',
      border: '2px solid rgba(255, 255, 255, 0.15)',
      borderTopColor: '#f43f5e',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite'
    }} />
    <span>{label}</span>
  </div>
);

export const App: React.FC = () => {
  // The first address, read once: /canvas/:journeyId?step=<nodeId> (#18). After this the address
  // belongs to useJourneyNavigation, which keeps it in step with what is on screen.
  const [initialRoute] = useState(() => parseAppLocation(window.location.pathname, window.location.search));
  const [initialLoad] = useState(() => loadInitialJourney(initialRoute.page === 'canvas' ? initialRoute.journeyId : null));
  const [project, setProject] = useState<JourneyProject>(initialLoad.project);
  const [activePage, setActivePage] = useState<AppPage>(initialRoute.page);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => (
    initialRoute.step && initialLoad.project.nodes.some(n => n.id === initialRoute.step) ? initialRoute.step : null
  ));
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // Stable, so the canvas callbacks that list them are not rebuilt on every App render.
  const selectNode = useCallback((node: JourneyNode | null) => {
    setSelectedNodeId(node ? node.id : null);
    if (node) setSelectedEdgeId(null);
  }, []);
  const selectEdge = useCallback((edge: JourneyEdge | null) => {
    setSelectedEdgeId(edge ? edge.id : null);
    if (edge) setSelectedNodeId(null);
  }, []);

  const selectedEdge = useMemo(() => {
    return project.edges.find(e => e.id === selectedEdgeId) || null;
  }, [project.edges, selectedEdgeId]);

  const edgeSourceNode = useMemo(() => {
    if (!selectedEdge) return null;
    return project.nodes.find(n => n.id === selectedEdge.source) || null;
  }, [project.nodes, selectedEdge]);

  const edgeTargetNode = useMemo(() => {
    if (!selectedEdge) return null;
    return project.nodes.find(n => n.id === selectedEdge.target) || null;
  }, [project.nodes, selectedEdge]);

  const handleDeleteEdge = useCallback((edgeId: string) => {
    setProject(prev => {
      const nextEdges = prev.edges.filter(e => e.id !== edgeId);
      return { ...prev, edges: nextEdges, updatedAt: new Date().toISOString() };
    });
    setSelectedEdgeId(null);
  }, []);
  
  // Workspace & Multi-Tenancy (1 Shopify Store Per Workspace)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [showShopifyModal, setShowShopifyModal] = useState(false);
  const [showShopifySyncModal, setShowShopifySyncModal] = useState(false);
  const [activeView, setActiveView] = useState<ActiveAppView>('canvas');
  // The editor round trip (#21): the step Email Studio was opened from, and the step whose Email
  // Studio button takes focus on the way back. A return belongs to one trip into Email Studio, and
  // a focus hand-back to one landing on the map.
  const [funnelReturn, setFunnelReturn] = useState<FunnelReturn | null>(null);
  const [returnFocusNodeId, setReturnFocusNodeId] = useState<string | null>(null);
  useEffect(() => {
    if (activeView !== 'email-studio') setFunnelReturn(null);
    if (activeView !== 'canvas') setReturnFocusNodeId(null);
  }, [activeView]);
  useEffect(() => {
    setReturnFocusNodeId(prev => (prev === selectedNodeId ? prev : null));
  }, [selectedNodeId]);
  const [canvasViewMode, setCanvasViewMode] = useState<CanvasViewMode>('edit');
  const [showRetentionBranches, setShowRetentionBranches] = useState<boolean>(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Modals & Authentication
  const [user, setUser] = useState<User | null>(null);
  // False until Firebase answers once, so a signed-in user never sees "Not published" early (#23).
  const [authReady, setAuthReady] = useState(false);
  const [showLiveModal, setShowLiveModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [showOperatorDashboard, setShowOperatorDashboard] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showBlueprintModal, setShowBlueprintModal] = useState(false);
  const [showSaveBlueprintModal, setShowSaveBlueprintModal] = useState(false);
  const [showAiBuilder, setShowAiBuilder] = useState(false);
  const [blueprintModalTab, setBlueprintModalTab] = useState<'turnkey' | 'custom' | 'import'>('turnkey');
  const [blueprintImportCode, setBlueprintImportCode] = useState<string>('');
  const [showSimulatorDrawer, setShowSimulatorDrawer] = useState(false);
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);
  const [showLaunchPlaybook, setShowLaunchPlaybook] = useState(false);
  // Check design opened from a card's badge scrolls to that step's rows (#10).
  const [auditFocusNodeId, setAuditFocusNodeId] = useState<string | null>(null);
  const openIssues = useCallback((id: string) => { setAuditFocusNodeId(id); setShowAuditDrawer(true); }, []);
  const openAudit = () => { setAuditFocusNodeId(null); setShowAuditDrawer(true); };
  const [publishing, setPublishing] = useState(false);
  const [publishedPages, setPublishedPages] = useState<PublishedPageInfo[]>([]);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const [unpublishing, setUnpublishing] = useState(false);
  
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'idle' });
  // Signed in, nothing is saved to the account over a journey until its account copy has been read
  // and reconciled with this browser's (C00), whichever way it was opened: at sign-in, by a switch,
  // Back or a deep link. `reconciled` lists those journeys for the signed-in user; every other one is
  // held, and accountHold says why for the open one: loading, failed, or blocked when the browser's
  // own copy could not be set aside.
  const [reconciled, setReconciled] = useState<{ uid: string; ids: ReadonlySet<string> }>({ uid: '', ids: new Set() });
  const isReconciled = (id: string) => !!user && reconciled.uid === user.uid && reconciled.ids.has(id);
  const isReconciledRef = useRef(isReconciled);
  isReconciledRef.current = isReconciled;
  const markReconciled = useCallback((uid: string, id: string) => setReconciled(r => (
    r.uid === uid ? (r.ids.has(id) ? r : { uid, ids: new Set(r.ids).add(id) }) : { uid, ids: new Set([id]) }
  )), []);
  const [accountHold, setAccountHold] = useState<{ id: string; why: 'loading' | 'failed' | 'blocked' } | null>(null);
  const accountHoldRef = useRef(accountHold);
  accountHoldRef.current = accountHold;
  // The notice names the journey it is about, and shows only while that journey is open.
  const [accountNotice, setAccountNotice] = useState<{ id: string; message: string; retry?: boolean; openId?: string } | null>(null);
  const [accountLoadAttempt, setAccountLoadAttempt] = useState(0);
  const journeyLoadSettled = !user || isReconciled(project.id);
  // This browser's own copy of a journey a switch opens, taken before it is overwritten: the switch
  // may have shown the account copy instead, and the load below must not lose this one (C00).
  // Its record is the account's that was signed in at the switch, so another account never uses it (F1).
  const openedBaseRef = useRef<{ id: string; uid: string | null; parked: JourneyProject | null; record: SyncRecord | null; shownAt: string } | null>(null);
  // The journey whose save the server refused as a conflict, and the base that save named: the load
  // it runs again weighs the shared sync record only when it is this tab's (F1).
  const conflictRef = useRef<{ id: string; uid: string; base: string | null } | null>(null);
  // So its Try again reloads the journey it describes, never whichever one is open.
  const shownAccountNotice = accountNotice && accountNotice.id === project.id ? accountNotice : null;
  const projectRef = useRef(project);
  projectRef.current = project;
  const [publishError, setPublishError] = useState<Refusal | null>(null);
  const [unpublishError, setUnpublishError] = useState<Refusal | null>(null);

  // Deep-link listener for ?import_blueprint=...
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const importCode = params.get('import_blueprint');
      if (importCode) {
        // Read once: every later address keeps foreign parameters, so a journey link would
        // otherwise reopen the import.
        params.delete('import_blueprint');
        const rest = params.toString();
        window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
        setBlueprintImportCode(importCode);
        setBlueprintModalTab('import');
        setShowBlueprintModal(true);
        setActivePage('canvas');
        setActiveView('canvas');
      }
    } catch (err) {
      console.warn('[Jourvance] Failed parsing import_blueprint param:', err);
    }
  }, []);

  // Load Workspaces
  useEffect(() => {
    let cancelled = false;
    fetchWorkspaces().then(wsList => {
      if (cancelled || !wsList.length) return;
      setWorkspaces(wsList);
      setCurrentWorkspace(prev => prev || wsList[0]);
    });
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Monitor Firebase Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, u => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Load the server copy of the open journey. Saves used to be write-only: nothing ever read a
  // journey back, so signing in on a second device showed the default blueprint, and the next save
  // replaced the stored journey with it. Choosing the copy with the later updatedAt was not enough
  // either (C00): an edit made while the load was slow, or a signed-out map on a new device, is
  // stamped "now" without coming from the account copy. chooseOnLoad reads which account revision
  // this browser's copy descends from; one that does not is set aside as its own journey. It runs
  // for every journey opened while signed in, because #18's switch keeps the newer copy by the same
  // timestamp rule and opens the browser copy when the account cannot be read.
  useEffect(() => {
    // Signing in again reads every journey again: edits made while signed out never met the account.
    if (!user) { setReconciled({ uid: '', ids: new Set() }); setAccountHold(null); setAccountNotice(null); return; }
    const uid = user.uid;
    // A switch cancels this load, and reopening the journey runs it again.
    const requestedId = project.id;
    if (isReconciledRef.current(requestedId)) {
      setAccountHold(h => (h && h.id === requestedId ? null : h));
      return;
    }
    let cancelled = false;
    const base = openedBaseRef.current && openedBaseRef.current.id === requestedId ? openedBaseRef.current : null;
    // Reconciled, the copy a switch passed over has been dealt with and is never weighed again.
    const consumeBase = () => { if (base && openedBaseRef.current === base) openedBaseRef.current = null; };
    const conflict = conflictRef.current && conflictRef.current.id === requestedId && conflictRef.current.uid === uid ? conflictRef.current : null;
    // Reconciled, the refused save has been dealt with and its base is weighed no more.
    const consumeConflict = () => { if (conflict && conflictRef.current === conflict) conflictRef.current = null; };
    setAccountHold({ id: requestedId, why: 'loading' });
    (async () => {
      let answered = false;
      let raw: Partial<JourneyProject> | null = null;
      try {
        const res = await fetch(`/api/journey/${encodeURIComponent(requestedId)}`, { headers: await authHeaders() });
        const data = await res.json().catch(() => ({}));
        answered = res.ok && data?.success === true;
        raw = answered ? data.journey : null;
      } catch { /* offline or signed out mid-flight */ }
      if (cancelled) return;
      if (!answered) {
        // Nothing is saved over an account copy this browser could not read.
        setAccountHold({ id: requestedId, why: 'failed' });
        setAccountNotice({ id: requestedId, message: LOAD_FAILED, retry: true });
        return;
      }
      const p = projectRef.current;
      // Rendered but not yet committed as another journey: the effect runs again for that one.
      if (p.id !== requestedId) return;
      // This browser's copy is this account's to reconcile now, and every save names the revision read.
      forgetOtherAccounts(uid, requestedId);
      noteAccountRead(uid, requestedId, raw ?? null);
      if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
        consumeBase();
        consumeConflict();
        markReconciled(uid, requestedId);
        setAccountHold(null);
        setAccountNotice(null);
        return;
      }
      const remote = raw as JourneyProject;
      const remoteAt = String(remote.updatedAt);
      const repaired = repairJourneyHandles(remote);
      // The copy to reconcile is this browser's: the one on screen, or the one a switch passed over.
      const hidden = base?.parked && base.parked.updatedAt !== base.shownAt && !adoptChangesNothing(base.parked, repaired) ? base.parked : null;
      const same = !hidden && adoptChangesNothing(p, repaired);
      const choice = hidden
        ? (chooseOnLoad(hidden.updatedAt, remoteAt, base!.uid === uid ? base!.record : null, false) === 'adopt' ? 'keep' : 'set-aside')
        : chooseOnLoad(p.updatedAt, remoteAt, conflict ? recordAfterConflict(readSyncRecord(uid, p.id), conflict.base, p.updatedAt) : readSyncRecord(uid, p.id), same);
      if (choice === 'set-aside') {
        const from = hidden || p;
        const kept = { ...from, id: newJourneyId(Date.now(), journeyToken()), name: setAsideName(from.name) };
        if (!parkJourney(kept)) {
          setAccountHold({ id: requestedId, why: 'blocked' });
          setAccountNotice({ id: requestedId, message: SET_ASIDE_FAILED });
          return;
        }
        // Minted here this moment, so the account has no copy of it to replace.
        markReconciled(uid, kept.id);
        setAccountNotice({ id: requestedId, message: setAsideNotice(kept.name), openId: kept.id });
      } else {
        setAccountNotice(null);
      }
      // The account copy as the load shows it: its fields, keeping this browser's where it has none.
      const asAccount = (cur: JourneyProject): JourneyProject => ({
        ...cur,
        name: remote.name || cur.name,
        businessType: remote.businessType || cur.businessType,
        offerHeadline: remote.offerHeadline || cur.offerHeadline,
        goal: remote.goal || cur.goal,
        workspaceId: remote.workspaceId || cur.workspaceId,
        shopifyStoreDomain: remote.shopifyStoreDomain || cur.shopifyStoreDomain,
        forecast: remote.forecast || cur.forecast,
        nodes: repaired.nodes,
        edges: repaired.edges,
        updatedAt: remoteAt
      });
      // The same content under another stamp is that account revision, so record it as one.
      if (choice === 'keep' && same) writeSyncRecord(uid, p.id, remoteAt, p.updatedAt);
      // Edits kept on top of the account copy (made signed out, or refused by a 409 the account then
      // agreed with) are this journey's next save: they read as unsaved and autosave sends them (F1).
      if (choice === 'keep' && !same && !hidden) editing.markAccountCopy(asAccount(p));
      // A copy a switch passed over is set aside, and the account copy it showed stays.
      if (choice !== 'keep' && !hidden) {
        // The adopted copy is already saved: not an edit, not a step (#8), and edits are counted
        // from it (#18's leave check).
        editing.markLoaded(remoteAt);
        nav.noteLoaded(remoteAt);
        setProject(cur => (cur.id !== requestedId ? cur : asAccount(cur)));
      }
      consumeBase();
      consumeConflict();
      markReconciled(uid, requestedId);
      setAccountHold(null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, project.id, accountLoadAttempt]);

  // Auto-save changes locally. Signed out this IS the save, so remember whether the browser kept it.
  // `full` says the browser refused because its storage is full, which the status words apart.
  const localWrite = useRef({ kept: true, full: false });
  useEffect(() => {
    localWrite.current = keepJourney(project);
  }, [project]);

  // Measured counts come from the event log into ONE snapshot held here, never into the journey
  // (#9), so a poll never marks the journey edited, never enters undo history and is never saved.
  // The effect depends on the fields the request sends and the range, not on any count.
  const [statsDays, setStatsDays] = useState<RangeDays>(() => readStoredRange());
  const changeStatsDays = useCallback((d: RangeDays) => { setStatsDays(d); writeStoredRange(d); }, []);
  const [metricsState, setMetricsState] = useState<MetricsState>({ status: 'signed-out' });
  const metrics = useMemo(() => metricsView(metricsState, project.id, statsDays), [metricsState, project.id, statsDays]);
  const statsShape = JSON.stringify(statsRequestBody(project, statsDays));
  useEffect(() => {
    if (!user) { setMetricsState({ status: 'signed-out' }); return; }
    let cancelled = false;
    const journeyId = project.id;
    const days = statsDays;
    const pull = async () => {
      setMetricsState(p => metricsLoading(p, journeyId, days));
      try {
        const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
        const res = await fetch('/api/funnel/stats', { method: 'POST', headers, body: statsShape });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        // Only an answer that echoes this journey and this range is shown.
        const snapshot = res.ok ? readStatsAnswer(data, journeyId, days) : null;
        setMetricsState(p => (snapshot ? { status: 'ready', snapshot } : metricsFailed(p, journeyId, days)));
      } catch {
        if (!cancelled) setMetricsState(p => metricsFailed(p, journeyId, days));
      }
    };
    pull();
    const timer = window.setInterval(pull, 20000);
    return () => { cancelled = true; window.clearInterval(timer); };
    // statsShape is the request body, built from the render's project and range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, statsShape]);

  const selectedNode = project.nodes.find(n => n.id === selectedNodeId) || null;

  // The one way to choose a step (#7): it clears the line selection and turns Retention Flows back
  // on when the step is one they hide. The map pans to the selected step on its own. Bump
  // inspectorFocus (openStep) when the choice should also move focus to the panel heading.
  // A journey switch names the journey it is opening (#18): this render's project is the old one.
  const [inspectorFocus, setInspectorFocus] = useState(0);
  const selectStep = (nodeId: string | null, inJourney: JourneyProject = project) => {
    setSelectedEdgeId(null);
    setSelectedNodeId(nodeId);
    const node = nodeId ? inJourney.nodes.find(n => n.id === nodeId) : undefined;
    if (node && revealsHiddenStep(node, showRetentionBranches)) setShowRetentionBranches(true);
  };
  const openStep = (nodeId: string) => {
    selectStep(nodeId);
    setInspectorFocus(n => n + 1);
  };
  // Enter on a line's rate pill: the line panel opens and its heading takes focus, as a step's does.
  const openEdge = (edgeId: string) => {
    setSelectedNodeId(null);
    setSelectedEdgeId(edgeId);
    setInspectorFocus(n => n + 1);
  };

  const handleUpdateProjectName = (name: string) => {
    setProject(p => ({ ...p, name, updatedAt: new Date().toISOString() }));
  };

  // Every node and line change keeps only lines with both steps still on the map (C06): with
  // Retention Flows hidden, React Flow never removes the lines into a hidden step, and it sends
  // the line removals before the step removal, so whichever of these runs second drops them.
  const handleNodesChange = (nodes: JourneyNode[]) => {
    setProject(p => ({ ...p, nodes, edges: linesWithBothEnds(nodes, p.edges), updatedAt: new Date().toISOString() }));
  };

  const handleEdgesChange = (edges: JourneyEdge[]) => {
    setProject(p => ({ ...p, edges: linesWithBothEnds(p.nodes, edges), updatedAt: new Date().toISOString() }));
  };

  const handleUpdateNode = (nodeId: string, data: JourneyNodeData) => {
    setProject(p => ({
      ...p,
      nodes: p.nodes.map(n => (n.id === nodeId ? { ...n, data } : n)),
      updatedAt: new Date().toISOString()
    }));
  };

  const handleDeleteNode = (nodeId: string) => {
    setProject(p => ({
      ...p,
      nodes: p.nodes.filter(n => n.id !== nodeId),
      edges: p.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
      updatedAt: new Date().toISOString()
    }));
    setSelectedNodeId(null);
  };

  // The header's Add Step: an unconnected step in a free slot at the centre of the visible map
  // (#12), selected, so the map pans to it only when that slot is off screen. The step's data
  // carries no invented product copy (stepDefaults.ts).
  const canvasView = useRef<CanvasView | null>(null);
  const handleAddNode = (type: NodeType) => {
    const node = makeStep(type, slotForNewStep(project.nodes, canvasView.current), newStamp());
    setProject(p => ({ ...p, nodes: [...p.nodes, node], updatedAt: new Date().toISOString() }));
    setSelectedEdgeId(null);
    setSelectedNodeId(node.id);
  };

  // A step added from the map (+ Next, + Before, + Step, a dragged line, a step dropped on a line)
  // is ONE setProject, so it is one undo step and one autosave.
  const handleGraphChange = (nodes: JourneyNode[], edges: JourneyEdge[]) =>
    setProject(p => ({ ...p, nodes, edges, updatedAt: new Date().toISOString() }));

  const [pickerRequest, setPickerRequest] = useState<AddRequest | null>(null);
  const handleAddStepBefore = useCallback((anchorId: string) => {
    setPickerRequest({ direction: 'before', anchorId });
  }, []);
  const handleAddStepAfter = useCallback((anchorId: string) => {
    const node = project.nodes.find(n => n.id === anchorId);
    const handle = node ? defaultExit(node, project.nodes, project.edges) ?? null : null;
    setPickerRequest({ direction: 'next', anchorId, handle });
  }, [project.nodes, project.edges]);

  /** Save one journey and report what actually happened. Resolves true only when the save landed. */
  const saveJourney = async (doc: JourneyProject): Promise<boolean> => {
    // Signed out, the canvas is local-only and the effect above has already written it. There is
    // no 'anonymous' tenant to save into: the server derives the owner from a verified token.
    if (!user) {
      const s = browserSaveOutcome(localWrite.current.kept, doc.updatedAt, localWrite.current.full);
      setSaveStatus(s);
      return s.kind !== 'failed';
    }
    // Save included (C00): a journey whose account copy has not been read and reconciled is never
    // written over it. The notice says why, and Try again re-runs the load.
    if (!isReconciledRef.current(doc.id)) {
      const held = accountHoldRef.current;
      const hold = held && held.id === doc.id ? held : { id: doc.id, why: 'loading' as const };
      setAccountNotice(hold.why === 'loading' ? { id: hold.id, message: LOAD_PENDING }
        : hold.why === 'failed' ? { id: hold.id, message: LOAD_FAILED, retry: true }
        : { id: hold.id, message: SET_ASIDE_FAILED });
      return false;
    }
    setSaving(true);
    try {
      // The one save request, which also records the account revision a landed save now is.
      const answer = await postAccountJourney(user.uid, doc);
      if (isSaveConflict(answer)) {
        // The account copy changed after this browser read it (another device or tab saved), so
        // nothing was replaced (F1). Read it again: the load keeps this copy and saves it when it
        // still comes from that revision, and otherwise sets it aside beside the account copy.
        const uid = user.uid;
        conflictRef.current = { id: doc.id, uid, base: refusedBase(uid, doc.id) };
        setReconciled(r => {
          if (r.uid !== uid || !r.ids.has(doc.id)) return r;
          const ids = new Set(r.ids);
          ids.delete(doc.id);
          return { uid, ids };
        });
        setAccountHold({ id: doc.id, why: 'loading' });
        setAccountNotice({ id: doc.id, message: SAVE_CONFLICT });
        setAccountLoadAttempt(n => n + 1);
        setSaveStatus({ kind: 'idle' });
        return false;
      }
      const status = saveOutcome(answer, doc.updatedAt);
      if (status.kind === 'not-backed-up') {
        console.warn('[Jourvance] Journey saved without a backup:', (answer?.body as { reason?: string })?.reason);
      }
      setSaveStatus(status);
      return status.kind !== 'failed';
    } finally {
      setSaving(false);
    }
  };

  // Undo, autosave and the leave warning. Every setProject is one undoable step with no extra call.
  const editing = useJourneyEditing({
    project,
    setProject,
    save: saveJourney,
    signedIn: !!user,
    accountUid: user?.uid ?? null,
    ready: journeyLoadSettled,
    shortcutsActive: activePage === 'canvas' && activeView === 'canvas'
  });

  // What is live, read from the server (#23). The cards and the inspector get it by context.
  const pub = usePublication({ authReady, signedIn: !!user, journeyId: project.id, workspaceId: currentWorkspace?.id, nodes: project.nodes, edges: project.edges, save: editing.saveNow });
  const publishCtx = useMemo(() => ({ states: pub.states, read: pub.read, refresh: pub.refresh, preview: pub.preview }), [pub.states, pub.read, pub.refresh, pub.preview]);

  // Launch Readiness Playbook milestones: computed deterministically from workspace, nodes, and audit
  const designIssuesCount = useMemo(() => checkJourneyDesign(project).issues.length, [project]);
  const currentStoreScore = useMemo(() => currentWorkspace ? storeScoreFor(project, currentWorkspace)?.overallScore ?? null : null, [project, currentWorkspace]);
  const isStoreConnected = Boolean(currentWorkspace?.shopifyConfig?.status === 'connected');
  const hasBlueprint = Boolean(project.nodes && project.nodes.length >= 2);
  const hasOffer = Boolean(project.nodes && project.nodes.some(n => n.type === 'landing-page' && Boolean((n.data as PageNodeData)?.headline || (n.data as PageNodeData)?.productId)));
  const isAuditPassed = designIssuesCount === 0 && (currentStoreScore === null || currentStoreScore >= 80);
  const isPublished = Boolean(
    (project.nodes && project.nodes.some(n => n.type === 'landing-page' && Boolean((n.data as PageNodeData)?.publishedUrl))) ||
    publishedPages.length > 0
  );
  const publishedUrl = (project.nodes?.find(n => n.type === 'landing-page' && (n.data as PageNodeData)?.publishedUrl)?.data as PageNodeData)?.publishedUrl || publishedPages[0]?.url || null;
  const launchCompleted = [isStoreConnected, hasBlueprint, hasOffer, isAuditPassed, isPublished].filter(Boolean).length;

  // The journey library and the address (#18): every switch, Back and Forward goes through here.
  // Leaving saves through #8's saveNow and keeps a browser copy; a step is chosen through selectStep.
  const [showJourneyLibrary, setShowJourneyLibrary] = useState(false);
  // A switch puts another journey on screen: keep this browser's copy of it as it was, for the load.
  const openJourneyOnScreen: typeof setProject = next => {
    if (typeof next !== 'function' && next.id !== projectRef.current.id) {
      const uid = user?.uid ?? null;
      openedBaseRef.current = { id: next.id, uid, parked: readParkedJourney(next.id), record: uid ? readSyncRecord(uid, next.id) : null, shownAt: next.updatedAt };
    }
    setProject(next);
  };
  const nav = useJourneyNavigation({
    project,
    setProject: openJourneyOnScreen,
    user,
    authReady,
    saveStatus,
    setSaveStatus,
    handleSave: editing.saveNow,
    markLoaded: editing.markLoaded,
    activePage,
    setActivePage,
    selectedNodeId,
    setSelectedNodeId: selectStep,
    setSelectedEdgeId,
    initialMissingId: initialLoad.missing ? initialRoute.journeyId : null,
    initialStep: initialRoute.step,
    onSwitched: () => {
      setPublishedPages([]);
      setShowPublishModal(false);
      setPublishError(null);
      setUnpublishError(null);
    }
  });

  // Every way back to the map (the banner, Email Studio's own button, the header's switch) lands
  // on the step Email Studio was opened from, through the one step chooser, which also pans to it.
  const showCanvas = () => {
    const stepId = returnStepId(project, funnelReturn);
    if (stepId) selectStep(stepId);
    setReturnFocusNodeId(stepId);
    setFunnelReturn(null);
    setActiveView('canvas');
  };

  // A sequence step's Email Studio button: the same save as the header's Save, and Email Studio
  // opens only once it landed. A failed save leaves the map as it was, and the button says why.
  const handleOpenEmailStudio = (nodeId: string): Promise<boolean> => {
    const ret = funnelReturnFor(project, nodeId);
    if (!ret) return Promise.resolve(false);
    const { saveNow } = editing;
    return openAfterSave(saveNow, () => { setFunnelReturn(ret); setActiveView('email-studio'); });
  };

  // An undo can take away the selected step or line, so let go of an id that no longer exists.
  useEffect(() => {
    if (selectedNodeId && !project.nodes.some(n => n.id === selectedNodeId)) setSelectedNodeId(null);
    if (selectedEdgeId && !project.edges.some(e => e.id === selectedEdgeId)) setSelectedEdgeId(null);
  }, [project.nodes, project.edges, selectedNodeId, selectedEdgeId]);

  const handleSignOut = async () => {
    if (await editing.confirmLeave(SIGN_OUT_QUESTION)) logOut();
  };

  const handleLoadBlueprint = async (
    prepared: { name: string; nodes: JourneyNode[]; edges: JourneyEdge[] },
    mode: 'replace' | 'new'
  ) => {
    if (mode === 'replace') {
      setProject(prev => ({
        ...prev,
        name: prepared.name,
        nodes: prepared.nodes,
        edges: prepared.edges,
        updatedAt: new Date().toISOString()
      }));
    } else {
      const newJourney: JourneyProject = {
        id: newJourneyId(Date.now(), journeyToken()),
        name: prepared.name,
        businessType: project.businessType || 'E-Commerce Brand',
        offerHeadline: prepared.name,
        goal: 'High-converting Shopify customer acquisition funnel',
        workspaceId: currentWorkspace?.id,
        nodes: prepared.nodes,
        edges: prepared.edges,
        updatedAt: new Date().toISOString()
      };
      // A new journey leaves this one through the library (#18): it is saved first when signed in,
      // kept in this browser either way, and stays one Back away. A refusal keeps it on screen.
      // Its id is minted here, so the account has no copy for it to replace (C00).
      if (user) markReconciled(user.uid, newJourney.id);
      if (await nav.startJourney(newJourney)) return;
    }
    setActivePage('canvas');
    setActiveView('canvas');
    setSelectedNodeId(null);
  };

  // Draft with AI (#25) adds its journey to the library (#18): the open journey is saved first
  // when signed in, kept in this browser either way, and stays one Back away. A refusal changes
  // nothing and is said once, in the dialog, which stays open. (Worded here, not in journeyAi.ts,
  // so the builder's logic stays in its own lazy chunk.)
  const handleCreateFromAi = async (journey: JourneyProject): Promise<string | null> => {
    const refused = await nav.startJourney(journey);
    if (refused) {
      nav.dismissNotice();
      return `Not created. ${refused.message}`;
    }
    setActiveView('canvas');
    return null;
  };

  const handleSyncRetentionToCanvas = (options: { addCartRecovery?: boolean; addUpsellRescue?: boolean }) => {
    setProject(prev => {
      // The drawer offers only what fits; ask the same rule again so no caller can wire a used exit (R12).
      const fit = retentionFlowsThatFit(prev.nodes, prev.edges);
      const result = injectRetentionFlows({
        nodes: prev.nodes,
        edges: prev.edges,
        addCartRecovery: options.addCartRecovery && fit.cartRecovery,
        addUpsellRescue: options.addUpsellRescue && fit.upsellRescue,
        cartRecoveryDiscount: prev.forecast?.cartRecoveryDiscount ?? 10,
        upsellRescueDiscount: prev.forecast?.upsellRescueDiscount ?? 10,
        // Drafts only: the Forecaster's discount is a what-if, not a code that exists in the store (C18).
        placeholderCopy: true
      });

      const updatedForecast: FunnelForecast = {
        ...(prev.forecast || DEFAULT_FORECAST),
        cartRecoveryEnabled: options.addCartRecovery ? true : (prev.forecast?.cartRecoveryEnabled ?? false),
        upsellRescueEnabled: options.addUpsellRescue ? true : (prev.forecast?.upsellRescueEnabled ?? false)
      };

      const updatedProject: JourneyProject = {
        ...prev,
        nodes: result.nodes,
        edges: result.edges,
        forecast: updatedForecast,
        updatedAt: new Date().toISOString()
      };

      saveCurrentJourney(updatedProject);
      return updatedProject;
    });
  };

  const handleCreateWorkspace = async () => {
    const name = prompt('Enter a name for your new Shopify workspace:');
    if (!name || !name.trim()) return;
    const res = await createWorkspace(name.trim());
    if (res.success && res.workspace) {
      setWorkspaces(prev => [...prev, res.workspace!]);
      setCurrentWorkspace(res.workspace);
    } else if (res.error?.includes('Upgrade')) {
      setShowBillingModal(true);
    } else {
      alert(res.error || 'Could not create workspace.');
    }
  };

  const handlePublishFunnel = async () => {
    // Publishing puts pages on the web under an account. Signed out there is none, and the old
    // fallback marked pages live on this screen while nothing was served anywhere. This comes
    // before the audit gate: fixing audit items first would not make a signed-out publish work.
    if (!user) {
      setPublishError({ message: 'Not published. Sign in first: publishing puts your pages on the web under your account.', retryable: false });
      setShowAuthModal(true);
      return;
    }

    // Open design checks ask once (#10). The store score never blocks or prompts.
    const open = checkJourneyDesign(project).issues.length;
    if (open > 0 && !window.confirm(`This journey has ${open} open design ${open === 1 ? 'check' : 'checks'}. Choose Cancel to see ${open === 1 ? 'it' : 'them'}, or OK to publish anyway.`)) {
      openAudit();
      return;
    }

    setPublishing(true);
    setPublishError(null);
    try {
      // The server publishes its own saved copy, so an unsaved canvas would publish stale pages.
      if (!(await editing.saveNow())) {
        setPublishError({ message: 'Not published, because the journey could not be saved first. Fix the save problem above, then publish again.', retryable: false });
        return;
      }

      const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
      const answer = await requestAnswer(`/api/journey/${encodeURIComponent(project.id)}/publish`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workspaceId: currentWorkspace?.id })
      });
      const refused = publishRefusal(answer);
      if (refused) {
        setPublishError(refused);
        // Some pages did go live, so the steps' status has to be read again.
        if (publishedPartly(answer)) void pub.refresh();
        return;
      }

      const pubPages = (answer!.body as { publishedPages: PublishedPageInfo[] }).publishedPages;
      // The server's own slugs and times, so every published step reads "Published" at once.
      setProject(prev => applyPublishResult(prev, ((answer!.body as { steps?: PublishedStep[] }).steps) || []));
      void pub.refresh();

      setPublishedPages(pubPages);
      setPublishNotice(publishWarning(answer));
      setUnpublishError(null);
      setShowPublishModal(true);
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublishFunnel = async () => {
    if (!user) return;
    setUnpublishing(true);
    setUnpublishError(null);
    try {
      const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
      const answer = await requestAnswer(`/api/journey/${encodeURIComponent(project.id)}/unpublish`, {
        method: 'POST',
        headers
      });
      const refused = unpublishRefusal(answer);
      if (refused) {
        setUnpublishError(refused);
        return;
      }
      // Mirror what the server took down: landing pages, upsells and A/B splits.
      setProject(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => (n.type === 'landing-page' || n.type === 'upsell' || n.type === 'ab-split')
          ? { ...n, data: { ...n.data, published: false } }
          : n)
      }));
      void pub.refresh();
      setShowPublishModal(false);
    } finally {
      setUnpublishing(false);
    }
  };

  return (
    <div className="jv-app-shell jv-app-shell--has-sidebar" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {activePage === 'canvas' ? (
        <>
          {/* Docked workspace: the rail spans the full height on the left, the toolbar and the
              studio sit in a column beside it, and the column reserves the rail's width at every
              state so the rail never covers content. */}
          <div className="jv-workspace-row">
            <AppSidebar
              activeView={activeView}
              onSelectView={view => (view === 'canvas' ? showCanvas() : setActiveView(view))}
              workspaces={workspaces}
              currentWorkspace={currentWorkspace}
              onSelectWorkspace={ws => setCurrentWorkspace(ws)}
              onOpenShopifyConnect={() => setShowShopifyModal(true)}
              onCreateWorkspace={handleCreateWorkspace}
              onOpenBilling={() => setShowBillingModal(true)}
              onAddNode={handleAddNode}
              onOpenAiBuilder={() => setShowAiBuilder(true)}
              onOpenBlueprints={() => {
                setBlueprintModalTab('turnkey');
                setShowBlueprintModal(true);
              }}
              onOpenLaunchPlaybook={() => setShowLaunchPlaybook(true)}
              launchCompleted={launchCompleted}
              launchTotal={5}
              onOpenAudit={openAudit}
              designCount={designIssuesCount}
              storeScore={currentStoreScore}
              onOpenSimulator={() => setShowSimulatorDrawer(true)}
              onOpenShopifySync={() => setShowShopifySyncModal(true)}
              onExportAssets={() => setShowExportModal(true)}
              user={user}
              onOpenAuth={() => setShowAuthModal(true)}
              onOpenAdmin={() => setShowOperatorDashboard(true)}
              onSignOut={handleSignOut}
              mobileOpen={mobileSidebarOpen}
              onCloseMobile={() => setMobileSidebarOpen(false)}
            />
          <div className="jv-workspace-main">
          {/* Top Canvas Header Toolbar */}
          <CanvasHeader
            project={project}
            onUpdateProjectName={handleUpdateProjectName}
            onSave={() => { void editing.saveNow(); }}
            canUndo={editing.canUndo}
            canRedo={editing.canRedo}
            onUndo={editing.undo}
            onRedo={editing.redo}
            savePending={editing.savePending}
            unsaved={editing.unsaved}
            onTestJourney={() => setShowLiveModal(true)}
            onExportAssets={() => setShowExportModal(true)}
            onAddNode={handleAddNode}
            onOpenWebsite={() => setActivePage('home')}
            user={user}
            onOpenAuth={() => setShowAuthModal(true)}
            onOpenBilling={() => setShowBillingModal(true)}
            onOpenAdmin={() => setShowOperatorDashboard(true)}
            onSignOut={handleSignOut}
            saving={saving}
            saveStatus={saveStatus}
            publishError={publishError}
            onDismissSaveError={() => setSaveStatus({ kind: 'idle' })}
            onDismissPublishError={() => setPublishError(null)}
            onPublishFunnel={handlePublishFunnel}
            publishing={publishing}
            workspaces={workspaces}
            currentWorkspace={currentWorkspace}
            onSelectWorkspace={ws => setCurrentWorkspace(ws)}
            onOpenShopifyConnect={() => setShowShopifyModal(true)}
            onCreateWorkspace={handleCreateWorkspace}
            activeView={activeView}
            onSelectView={view => (view === 'canvas' ? showCanvas() : setActiveView(view))}
            onOpenBlueprints={() => {
              setBlueprintModalTab('turnkey');
              setShowBlueprintModal(true);
            }}
            onSaveBlueprint={() => setShowSaveBlueprintModal(true)}
            onOpenAiBuilder={() => setShowAiBuilder(true)}
            canvasViewMode={canvasViewMode}
            onToggleCanvasViewMode={setCanvasViewMode}
            onOpenShopifySync={() => setShowShopifySyncModal(true)}
            onOpenSimulator={() => setShowSimulatorDrawer(true)}
            onOpenAudit={openAudit}
            metrics={metrics}
            onOpenJourneyLibrary={() => setShowJourneyLibrary(true)}
            journeyNotice={nav.notice}
            onDismissJourneyNotice={nav.dismissNotice}
            onRetryJourneyNotice={nav.retryNotice}
            accountNotice={shownAccountNotice && {
              message: shownAccountNotice.message,
              actionLabel: shownAccountNotice.retry ? 'Try again' : shownAccountNotice.openId ? 'Open it' : undefined
            }}
            onAccountNoticeAction={() => {
              const n = shownAccountNotice;
              if (n?.retry) { setAccountNotice(null); setAccountLoadAttempt(a => a + 1); }
              else if (n?.openId) { setAccountNotice(null); void nav.openJourney(n.openId); }
            }}
            onDismissAccountNotice={() => setAccountNotice(null)}
          />

          {/* Main Workspace Layout: Left Sidebar + Studio/Canvas Content */}
          <div className="jv-workspace-body">

            <div className="jv-workspace-content">
              {activeView === 'email-studio' && funnelReturn && (
                <FunnelReturnBanner
                  text={returnBannerText(project, funnelReturn)}
                  onBack={showCanvas}
                  onDismiss={() => setFunnelReturn(null)}
                />
              )}

              {/* Main Area: Funnel Canvas, Email Studio, OR Attribution Reports */}
              <Suspense fallback={<SuspenseLoader label="Loading studio view..." />}>
                {activeView === 'email-studio' ? (
                  <HubEmailSuite
                    workspace={currentWorkspace}
                    onOpenShopifyConnect={() => setShowShopifyModal(true)}
                    // While the banner shows, its Back to funnel is the one way back.
                    onReturnToCanvas={funnelReturn ? undefined : showCanvas}
                    initialTab={funnelReturn ? 'map' : undefined}
                    openFlowId={funnelReturn?.flowId || undefined}
                  />
                ) : activeView === 'attribution' ? (
                  <AttributionReports
                    workspace={currentWorkspace}
                    nodes={project.nodes}
                    forecast={project.forecast}
                    onOpenShopifySync={() => setShowShopifySyncModal(true)}
                    journeyId={project.id}
                    edges={project.edges}
                    onSelectStep={nodeId => {
                      // Back to the map through the one step chooser (#7), which also pans to the step.
                      if (!project.nodes.some(n => n.id === nodeId)) return;
                      selectStep(nodeId);
                      setActiveView('canvas');
                    }}
                  />
                ) : (
                  <PublishStatusContext.Provider value={publishCtx}>
                  <main className="jv-canvas-layout">
                    <div className="jv-canvas-pane">
                    {/* One canvas per journey, so no step position carries across a switch (#18) and a
                        new journey is fitted into view (#25). */}
                    <JourneyCanvas key={project.id}
                      nodes={project.nodes}
                      edges={project.edges}
                      onNodesChange={handleNodesChange}
                      onEdgesChange={handleEdgesChange}
                      selectedNodeId={selectedNodeId}
                      onSelectNode={selectNode}
                      selectedEdgeId={selectedEdgeId}
                      onSelectEdge={selectEdge}
                      canvasViewMode={canvasViewMode}
                      showRetentionBranches={showRetentionBranches}
                      onToggleRetentionBranches={setShowRetentionBranches}
                      onUndoMove={editing.undoMove}
                      metrics={metrics}
                      onChangeStatsDays={changeStatsDays}
                      onOpenStep={openStep}
                      onOpenEdge={openEdge}
                      focusRequest={inspectorFocus}
                      onOpenIssues={openIssues}
                      onGraphChange={handleGraphChange}
                      canvasViewRef={canvasView}
                      pickerRequest={pickerRequest}
                      onClearPickerRequest={() => setPickerRequest(null)}
                    />
                    </div>

                    {/* The docked step panel beside the map, or under it below 768px: the finder, then the opened step or line. */}
                    <StepDock
                      key={project.id}
                      nodes={project.nodes}
                      edges={project.edges}
                      node={selectedNode}
                      edge={selectedEdge}
                      edgeSourceNode={edgeSourceNode}
                      edgeTargetNode={edgeTargetNode}
                      showRetentionBranches={showRetentionBranches}
                      focusRequest={inspectorFocus}
                      onSelectStep={selectStep}
                      onCloseEdge={() => setSelectedEdgeId(null)}
                      onUpdateNode={handleUpdateNode}
                      onDeleteNode={handleDeleteNode}
                      onDeleteEdge={handleDeleteEdge}
                      offerHeadline={project.offerHeadline}
                      businessType={project.businessType}
                      journeyId={project.id}
                      workspace={currentWorkspace}
                      onOpenShopifyConnect={() => setShowShopifyModal(true)}
                      metrics={metrics}
                      onOpenEmailStudio={handleOpenEmailStudio}
                      openingEmailStudio={saving}
                      returnFocusNodeId={returnFocusNodeId}
                      onAddStepBefore={handleAddStepBefore}
                      onAddStepAfter={handleAddStepAfter}
                    />
                  </main>
                  </PublishStatusContext.Provider>
                )}
              </Suspense>
            </div>
          </div>
          </div>{/* jv-workspace-main */}
          </div>{/* jv-workspace-row */}

          {/* Floating Mobile Navigation Trigger Button */}
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Open navigation menu"
            className="jv-mobile-nav-trigger"
            style={{
              position: 'fixed',
              bottom: '20px',
              left: '20px',
              width: '46px',
              height: '46px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #EC4899 0%, #8B5CF6 100%)',
              border: 'none',
              color: '#FFFFFF',
              display: 'none',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 15px rgba(236, 72, 153, 0.4)',
              cursor: 'pointer',
              zIndex: 45
            }}
          >
            <Compass size={20} />
          </button>
        </>
      ) : (
        /* Public Marketing Web Pages */
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
          <PublicHeader
            activePage={activePage}
            onNavigate={setActivePage}
            onTestJourney={() => setShowLiveModal(true)}
            user={user}
            onOpenAuth={() => setShowAuthModal(true)}
            onOpenBilling={() => setShowBillingModal(true)}
            onOpenAdmin={() => setShowOperatorDashboard(true)}
            onSignOut={handleSignOut}
          />

          <main style={{ flex: 1 }}>
            {activePage === 'home' && (
              <HomePage
                onNavigate={setActivePage}
                onTestJourney={() => setShowLiveModal(true)}
                onOpenBilling={() => setShowBillingModal(true)}
              />
            )}
            {activePage === 'about' && (
              <AboutPage onNavigate={setActivePage} />
            )}
            {activePage === 'blog' && (
              <BlogPage onNavigate={setActivePage} />
            )}
            {activePage === 'contact' && (
              <ContactPage onNavigate={setActivePage} />
            )}
          </main>

          <PublicFooter onNavigate={setActivePage} />
        </div>
      )}

      {/* Lazy-Loaded Modals & Drawers */}
      <Suspense fallback={null}>
        {/* Live Funnel Simulation Modal */}
        {showLiveModal && (
          <LiveFunnelModal
            project={project}
            onClose={() => setShowLiveModal(false)}
          />
        )}

        {/* Shopify Connect Modal */}
        <ShopifyConnectModal
          isOpen={showShopifyModal}
          onClose={() => setShowShopifyModal(false)}
          workspace={currentWorkspace}
          onWorkspaceUpdated={updated => {
            setCurrentWorkspace(updated);
            setWorkspaces(prev => prev.map(w => (w.id === updated.id ? updated : w)));
          }}
          onOpenBilling={() => setShowBillingModal(true)}
        />

        {/* Shopify webhooks, discounts, and abandoned checkouts */}
        <ShopifySyncModal
          isOpen={showShopifySyncModal}
          onClose={() => setShowShopifySyncModal(false)}
          workspace={currentWorkspace}
        />

        {/* User Auth Modal */}
        {showAuthModal && (
          <AuthModal
            onClose={() => setShowAuthModal(false)}
          />
        )}

        {/* Subscription billing */}
        {showBillingModal && (
          <BillingModal
            onClose={() => setShowBillingModal(false)}
            userEmail={user?.email || undefined}
          />
        )}

        {/* Operator Admin Dashboard */}
        {showOperatorDashboard && (
          <OperatorDashboard
            currentProject={project}
            onClose={() => setShowOperatorDashboard(false)}
            onLoadProject={p => {
              void nav.startJourney(p);
              setShowOperatorDashboard(false);
            }}
          />
        )}

        {/* Production Assets Export Modal */}
        <ExportAssetsModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          nodes={project.nodes as any}
          journeyTitle={project.name}
          workspaceId={currentWorkspace?.id}
          journeyId={project.id}
        />

        {/* Funnel Publish Modal */}
        <PublishModal
          isOpen={showPublishModal}
          onClose={() => setShowPublishModal(false)}
          publishedPages={publishedPages}
          notice={publishNotice}
          workspace={currentWorkspace}
          onUnpublish={handleUnpublishFunnel}
          unpublishing={unpublishing}
          unpublishError={unpublishError?.message || null}
        />

        {/* The journey library (#18): open, rename and duplicate, in this browser and the account */}
        {showJourneyLibrary && (
          <JourneyLibraryDialog
            project={project}
            user={user}
            onClose={() => setShowJourneyLibrary(false)}
            onOpen={nav.openJourney}
            onRename={nav.renameJourneyById}
            onDuplicate={nav.duplicateJourneyById}
            onNewJourney={() => { setShowJourneyLibrary(false); setBlueprintModalTab('turnkey'); setShowBlueprintModal(true); }}
            onFreedSpace={() => {
              // A removal may have made room: keep the open journey again, and signed out say so.
              localWrite.current = keepJourney(projectRef.current);
              if (!user) void editing.saveNow();
            }}
          />
        )}

        {/* Save as Reusable Blueprint Modal */}
        <SaveBlueprintModal
          isOpen={showSaveBlueprintModal}
          onClose={() => setShowSaveBlueprintModal(false)}
          nodes={project.nodes}
          edges={project.edges}
          currentJourneyName={project.name}
        />

        {/* Draft with AI (#25): a reviewed draft becomes a new journey in the library */}
        {showAiBuilder && (
          <AiJourneyBuilder
            signedIn={!!user}
            businessType={project.businessType}
            workspaceId={currentWorkspace?.id}
            onOpenAuth={() => { setShowAiBuilder(false); setShowAuthModal(true); }}
            onOpenBlueprints={() => { setShowAiBuilder(false); setBlueprintModalTab('turnkey'); setShowBlueprintModal(true); }}
            onCreate={handleCreateFromAi}
            createMode="add"
            onClose={() => setShowAiBuilder(false)}
          />
        )}

        {/* E-Commerce Funnel Blueprints Modal */}
        <BlueprintModal
          isOpen={showBlueprintModal}
          onClose={() => {
            setShowBlueprintModal(false);
            setBlueprintImportCode('');
          }}
          onLoadBlueprint={handleLoadBlueprint}
          workspace={currentWorkspace}
          currentJourneyName={project.name}
          initialTab={blueprintModalTab}
          initialImportCode={blueprintImportCode}
        />

        {/* Funnel Financial Simulator & ROAS Forecaster (Wave 10) */}
        <FinancialSimulatorDrawer
          isOpen={showSimulatorDrawer}
          onClose={() => setShowSimulatorDrawer(false)}
          nodes={project.nodes}
          edges={project.edges}
          initialForecast={project.forecast}
          onSaveForecast={(forecast: FunnelForecast) => {
            setProject(prev => {
              const updated = { ...prev, forecast, updatedAt: new Date().toISOString() };
              saveCurrentJourney(updated);
              return updated;
            });
          }}
          onSyncRetentionToCanvas={handleSyncRetentionToCanvas}
        />

        {/* Check design (#10): design checks, and the store score when a store is connected */}
        <PreFlightAuditDrawer
          isOpen={showAuditDrawer}
          onClose={() => { setShowAuditDrawer(false); setAuditFocusNodeId(null); }}
          project={project}
          workspace={currentWorkspace}
          signedIn={!!user}
          focusNodeId={auditFocusNodeId}
          onOpenShopifyConnect={() => setShowShopifyModal(true)}
          // One setProject is one edit (and one undo step); the [project] effect saves it locally.
          onUpdateProject={updated => setProject(updated)}
          onOpenPublish={() => {
            setShowAuditDrawer(false);
            handlePublishFunnel();
          }}
          onSelectNode={openStep}
        />

        {/* Launch Readiness Playbook Modal */}
        <LaunchPlaybookModal
          isOpen={showLaunchPlaybook}
          onClose={() => setShowLaunchPlaybook(false)}
          isStoreConnected={isStoreConnected}
          hasBlueprint={hasBlueprint}
          hasOffer={hasOffer}
          isAuditPassed={isAuditPassed}
          isPublished={isPublished}
          storeName={currentWorkspace?.shopifyConfig?.shopName || currentWorkspace?.shopifyConfig?.storeDomain || currentWorkspace?.name}
          designCount={designIssuesCount}
          storeScore={currentStoreScore}
          publishedUrl={publishedUrl}
          onOpenShopifyConnect={() => {
            setShowLaunchPlaybook(false);
            setShowShopifyModal(true);
          }}
          onOpenBlueprints={() => {
            setShowLaunchPlaybook(false);
            setBlueprintModalTab('turnkey');
            setShowBlueprintModal(true);
          }}
          onConfigureOffer={() => {
            setShowLaunchPlaybook(false);
            const lp = project.nodes?.find(n => n.type === 'landing-page');
            if (lp) {
              openStep(lp.id);
            }
          }}
          onOpenAudit={() => {
            setShowLaunchPlaybook(false);
            openAudit();
          }}
          onOpenPublish={() => {
            setShowLaunchPlaybook(false);
            if (isPublished && publishedUrl) {
              window.open(publishedUrl, '_blank', 'noopener,noreferrer');
            } else {
              handlePublishFunnel();
            }
          }}
        />
      </Suspense>
    </div>
  );
};
export default App;
