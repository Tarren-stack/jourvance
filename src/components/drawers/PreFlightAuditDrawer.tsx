import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Store
} from 'lucide-react';
import type { JourneyProject, Workspace } from '../../types/journey';
import { checkJourneyDesign, planDesignFix, applyFixPlan, revertFixPlan } from '../../lib/designChecks';
import type { DesignIssue, FixPlan } from '../../lib/designChecks';
import { storeScoreFor, planAuditFix } from '../../lib/funnelAuditor';
import type { AuditCheckItem } from '../../lib/funnelAuditor';
import { useDialogFocus } from '../../lib/a11yHooks';
// This drawer is written in utility classes; Jourvance has no Tailwind, so they come from a
// generated stylesheet scoped to .jv-utility (scripts/build-drawer-css.mjs).
import '../../styles/drawerUtilities.css';

// Check design (#10). The design checks run on every journey and list their rows by step; the
// store score is shown only when a store is connected. A fix is previewed as plain sentences
// written from the change list it applies, applied as one edit, and undone all or nothing.
// Every hook sits above the early return that renders nothing while the drawer is closed.

interface PreFlightAuditDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  project: JourneyProject;
  workspace?: Workspace | null;
  /** The whole journey after a fix or an undo. One call is one edit. */
  onUpdateProject: (updated: JourneyProject) => void;
  onOpenPublish?: () => void;
  onSelectNode?: (nodeId: string) => void;
  /** Open scrolled to this step's checks, with focus on its heading (the card's ! N badge). */
  focusNodeId?: string | null;
  onOpenShopifyConnect?: () => void;
  /** Whether someone is signed in. Decides the sentence shown when there is no workspace. */
  signedIn?: boolean;
}

const TITLE_ID = 'jv-check-design-title';
const STALE_PREVIEW = 'The journey changed since this preview. Preview the fix again.';
const STALE_UNDO = 'This fix was edited after it was applied, so it cannot be undone here.';

export const PreFlightAuditDrawer: React.FC<PreFlightAuditDrawerProps> = ({
  isOpen,
  onClose,
  project,
  workspace,
  onUpdateProject,
  onOpenPublish,
  onSelectNode,
  focusNodeId,
  onOpenShopifyConnect,
  signedIn = false
}) => {
  // Computed only while open: the drawer stays mounted behind every journey edit.
  const design = useMemo(() => (isOpen ? checkJourneyDesign(project) : null), [isOpen, project]);
  const store = useMemo(() => (isOpen ? storeScoreFor(project, workspace) : null), [isOpen, project, workspace]);
  const designFixes = useMemo(() => {
    const plans = new Map<string, FixPlan>();
    for (const issue of design?.issues ?? []) {
      const plan = planDesignFix(project, issue);
      if (plan) plans.set(issue.key, plan);
    }
    return plans;
  }, [design, project]);

  const [preview, setPreview] = useState<FixPlan | null>(null);
  const [lastFix, setLastFix] = useState<FixPlan | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  // A fix belongs to the journey it was written for, and to one opening of the drawer: once it is
  // closed the map's own undo can take the fix back, so a reopened drawer never offers a stale Undo.
  useEffect(() => {
    setPreview(null);
    setLastFix(null);
    setNotice(null);
  }, [project.id, isOpen]);

  const panelRef = useDialogFocus<HTMLDivElement>(isOpen, onClose, {
    modal: true,
    initialFocus: !focusNodeId,
    // When the button that opened the Audit is gone, focus lands on the map, never the page body.
    fallbackFocusId: 'journey-map'
  });

  // Opened from a step's badge: show that step's checks and put focus on its heading.
  useEffect(() => {
    if (!isOpen || !focusNodeId) return;
    const section = document.getElementById(`check-${focusNodeId}`);
    if (!section) return;
    section.scrollIntoView({ block: 'start' });
    section.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
  }, [isOpen, focusNodeId]);

  if (!isOpen || !design) return null;

  const focusStatus = () => requestAnimationFrame(() => statusRef.current?.focus({ preventScroll: true }));

  const openPreview = (plan: FixPlan | null) => {
    if (!plan) return;
    setPreview(plan);
    setNotice(null);
  };

  const applyPreview = () => {
    if (!preview) return;
    const result = applyFixPlan(project, preview);
    if (!result.applied) {
      setNotice(STALE_PREVIEW);
      focusStatus();
      return;
    }
    onUpdateProject(result.project);
    setLastFix(preview);
    setPreview(null);
    setNotice('Fix applied.');
    focusStatus();
  };

  const undoLastFix = () => {
    if (!lastFix) return;
    const result = revertFixPlan(project, lastFix);
    if (!result.reverted) {
      setNotice(STALE_UNDO);
      focusStatus();
      return;
    }
    onUpdateProject(result.project);
    setLastFix(null);
    setNotice('Fix undone.');
    focusStatus();
  };

  const openStep = (nodeId: string) => {
    onSelectNode?.(nodeId);
    onClose();
  };

  // fetchWorkspaces answers a stand-in workspace (userId 'local') when the server gives none, for
  // example signed out. No store can be connected to it, so it counts as no workspace here.
  const storeWorkspace = workspace && workspace.userId !== 'local' ? workspace : null;
  const count = design.issues.length;
  const groups = project.nodes.filter(n => design.byNode[n.id]);

  const previewPanel = (plan: FixPlan) => (
    <div className="mt-2 p-3 rounded-lg border border-amber-500/30 bg-slate-950/40 space-y-2">
      <p className="text-xs font-semibold text-slate-200">{plan.title}. This will:</p>
      <ul className="space-y-1">
        {plan.lines.map((line, i) => (
          <li key={i} className="text-xs text-slate-300 leading-relaxed">{line}</li>
        ))}
      </ul>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={applyPreview}
          className="px-3 py-1.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-md transition"
        >
          Apply fix
        </button>
        <button
          type="button"
          onClick={() => setPreview(null)}
          className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white rounded-md border border-slate-700 transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  const previewButton = (plan: FixPlan | null | undefined) =>
    plan ? (
      <button
        type="button"
        onClick={() => openPreview(plan)}
        aria-expanded={preview?.key === plan.key}
        className="shrink-0 px-2.5 py-1 text-[11px] font-bold text-amber-300 rounded-md border border-amber-500/30 hover:bg-amber-950/50 transition"
      >
        Preview fix
      </button>
    ) : null;

  const issueRow = (issue: DesignIssue) => {
    const plan = designFixes.get(issue.key);
    return (
      <li key={issue.key}>
        <div className="flex items-start justify-between gap-3">
          {issue.nodeId ? (
            <button
              type="button"
              onClick={() => openStep(issue.nodeId!)}
              className="flex-1 flex items-start gap-2 py-1 text-left text-xs text-slate-200 hover:text-white"
            >
              <AlertTriangle aria-hidden="true" className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{issue.message}</span>
            </button>
          ) : (
            <p className="flex-1 flex items-start gap-2 py-1 text-xs text-slate-200">
              <AlertTriangle aria-hidden="true" className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{issue.message}</span>
            </p>
          )}
          {previewButton(plan)}
        </div>
        {plan && preview?.key === plan.key && previewPanel(preview)}
      </li>
    );
  };

  const storeRow = (item: AuditCheckItem) => {
    const plan = !item.passed && item.autoFixType ? planAuditFix(project, item) : null;
    const previewing = preview?.key === `store:${item.id}`;
    return (
      <li key={item.id} className={`p-3 rounded-lg border ${item.passed ? 'bg-slate-900/30 border-slate-800/50' : 'bg-amber-950/20 border-amber-500/30'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            {item.passed ? (
              <CheckCircle2 aria-hidden="true" className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle aria-hidden="true" className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-slate-200">
                {item.title} <span className="font-mono font-medium text-slate-400">({item.points}/{item.maxPoints} pts)</span>
              </p>
              <p className="text-[11px] text-slate-300">{item.summary}</p>
            </div>
          </div>
          {item.passed ? (
            <span className="shrink-0 text-[11px] font-bold text-emerald-400">Passed</span>
          ) : plan ? (
            previewButton(plan)
          ) : item.targetNodeId && onSelectNode ? (
            <button
              type="button"
              onClick={() => openStep(item.targetNodeId!)}
              className="shrink-0 text-[11px] font-semibold text-pink-400 hover:text-pink-300 underline underline-offset-2"
            >
              Open step
            </button>
          ) : null}
        </div>
        {previewing && preview && previewPanel(preview)}
      </li>
    );
  };

  // SVG circle for the store score gauge
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const tierRing = store ? (store.tier === 'ready' ? '#10B981' : store.tier === 'good' ? '#F59E0B' : '#F43F5E') : '#F59E0B';

  return (
    <div className="jv-utility fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end transition-opacity">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="w-full max-w-2xl bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200"
      >

        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
              <ShieldCheck aria-hidden="true" className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 id={TITLE_ID} tabIndex={-1} data-dialog-start className="text-base font-bold text-white tracking-tight">
                Check design
              </h2>
              <p className="text-xs text-slate-400">
                These checks read the lines and pages on this map. They do not test your live pages.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
            aria-label="Close design checks"
          >
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Design checks: every journey */}
          <section aria-labelledby="jv-design-checks-title" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 id="jv-design-checks-title" className="text-sm font-bold text-white tracking-tight">Design checks</h3>
              {count > 0 && (
                <span className="text-[11px] font-semibold text-amber-300 px-2.5 py-1 rounded-md bg-amber-950/50 border border-amber-800/40">
                  {count} open {count === 1 ? 'check' : 'checks'}
                </span>
              )}
            </div>

            {count === 0 ? (
              <p className="flex items-center gap-2 text-xs text-emerald-300">
                <CheckCircle2 aria-hidden="true" className="w-4 h-4 text-emerald-400" />
                <span>Design checks passed.</span>
              </p>
            ) : (
              <div className="space-y-3">
                {design.journeyIssues.length > 0 && (
                  <section className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3.5 space-y-2">
                    <h3 className="text-xs font-bold text-slate-200">Whole journey</h3>
                    <ul className="space-y-2">{design.journeyIssues.map(issueRow)}</ul>
                  </section>
                )}
                {groups.map(node => (
                  <section key={node.id} id={`check-${node.id}`} className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3.5 space-y-2">
                    <h3 tabIndex={-1} className="text-xs font-bold text-slate-200">{design.byNode[node.id].name}</h3>
                    <ul className="space-y-2">{design.issues.filter(i => i.nodeId === node.id).map(issueRow)}</ul>
                  </section>
                ))}
              </div>
            )}
          </section>

          {/* Store checks: only with a connected store */}
          <section aria-labelledby="jv-store-checks-title" className="space-y-3">
            <h3 id="jv-store-checks-title" className="text-sm font-bold text-white tracking-tight">Store checks</h3>

            {store ? (
              <>
                <div className="p-5 rounded-2xl bg-slate-950/40 border border-slate-800/80 flex flex-col sm:flex-row items-center gap-6">
                  <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
                    <svg aria-hidden="true" className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r={radius} className="stroke-slate-800" strokeWidth="8" fill="transparent" />
                      <circle
                        cx="50"
                        cy="50"
                        r={radius}
                        stroke={tierRing}
                        strokeWidth="8"
                        strokeDasharray={circumference}
                        strokeDashoffset={circumference - (store.overallScore / 100) * circumference}
                        strokeLinecap="round"
                        fill="transparent"
                        className="transition-all duration-700 ease-out"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                      <span className="text-2xl font-black font-mono text-white leading-none">{store.overallScore}</span>
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">/ 100</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2 text-center sm:text-left">
                    <p className="text-sm font-bold text-white tracking-tight">{store.headline}</p>
                    <p className="text-xs text-slate-300 leading-relaxed">{store.subhead}</p>
                    <p className="text-[11px] font-semibold text-slate-300">
                      {store.passedChecks} of {store.totalChecks} store checks passed
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  {store.pillars.map(pillar => (
                    <div key={pillar.id} className="rounded-xl border border-slate-800/80 bg-slate-950/40 overflow-hidden">
                      <div className="p-4 bg-slate-900/60 border-b border-slate-800/60 flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-white tracking-tight">{pillar.title}</p>
                          <p className="text-[11px] text-slate-400">{pillar.description}</p>
                        </div>
                        <span className={`shrink-0 text-xs font-mono font-bold ${pillar.score === pillar.maxScore ? 'text-emerald-400' : 'text-slate-300'}`}>
                          {pillar.score} / {pillar.maxScore} pts
                        </span>
                      </div>
                      <ul className="p-3.5 space-y-2.5">{pillar.items.map(storeRow)}</ul>
                    </div>
                  ))}
                </div>
              </>
            ) : storeWorkspace ? (
              <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-950/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <p className="text-xs text-slate-300 leading-relaxed">
                  Store checks need a connected store. Connect one to check checkout, order bump and upsell.
                </p>
                {onOpenShopifyConnect && (
                  <button
                    type="button"
                    onClick={onOpenShopifyConnect}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition"
                  >
                    <Store aria-hidden="true" className="w-4 h-4" />
                    <span>Connect a store</span>
                  </button>
                )}
              </div>
            ) : (
              <p className="p-4 rounded-xl border border-slate-800/80 bg-slate-950/40 text-xs text-slate-300 leading-relaxed">
                {signedIn
                  ? 'Store checks need a connected store. Choose a workspace to connect one.'
                  : 'Store checks need a connected store. Sign in and choose a workspace to connect one.'}
              </p>
            )}
          </section>
        </div>

        {/* Result of the last apply or undo. The live region stays mounted so each change is read out. */}
        <div ref={statusRef} tabIndex={-1} role="status" className="shrink-0">
          {notice && (
            <div className="px-6 py-2.5 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-200">{notice}</span>
              {lastFix && notice === 'Fix applied.' && (
                <button
                  type="button"
                  onClick={undoLastFix}
                  className="shrink-0 px-3 py-1 text-xs font-semibold text-slate-200 rounded-md border border-slate-700 hover:bg-slate-800 transition"
                >
                  Undo
                </button>
              )}
            </div>
          )}
        </div>

        {/* Drawer Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/95 backdrop-blur flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition"
          >
            Close
          </button>

          {onOpenPublish && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenPublish();
              }}
              className="flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg transition bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            >
              <span>Publish</span>
              <ArrowRight aria-hidden="true" className="w-4 h-4" />
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
