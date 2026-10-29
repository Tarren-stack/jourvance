import React, { useState, useMemo, useEffect, useLayoutEffect, useRef, useId } from 'react';
import { Save, CheckCircle2, Plus, Compass, Globe, Circle, AlertTriangle, Loader2, Undo2, Redo2, Library, ChevronDown } from 'lucide-react';
import {
  UNIVERSAL_BUSINESS_CATEGORIES,
  isUniversalBusinessCategory,
  normalizeBusinessCategory
} from '../../types/journey';
import type { JourneyProject, Workspace, CanvasViewMode, NodeType, ActiveAppView } from '../../types/journey';
import { WorkspaceSelector } from './WorkspaceSelector';
import { checkJourneyDesign } from '../../lib/designChecks';
import { storeScoreFor } from '../../lib/funnelAuditor';
import type { SaveStatus, Refusal } from '../../lib/saveOutcome';
import { countText, journeyTotals, metricsStatusNote, moneyText, percentText, type MetricsView } from '../../lib/journeyMetrics';
import { menuSide } from '../../lib/menuPlacement';
import { MENU_GUTTER_PX } from '../../lib/menuPlacement';
import { isOperator } from '../../lib/firebase';
import { ACTION_LABEL, STEP_TYPES } from '../../lib/studioLabels';

/**
 * Below this width the lead stats step aside so the journey toolbar stays one row on a laptop
 * with the save status showing.
 */
const COMPACT_BELOW_PX = 1720;
/**
 * In Live ROAS mode the ROAS ribbon (about 580px with every figure Unavailable) replaces the 135px
 * lead stats, so the full row needs about 2,130px after an edit and used to wrap from 1,720px up
 * to about 2,150px. Below this width the ribbon alone steps aside; Test Lead Flow keeps
 * COMPACT_BELOW_PX, so switching modes never moves it in or out of More. Between the two widths a
 * ROAS pill no wider than the lead stats takes the ribbon's place and opens the four totals, so a
 * 1,920px screen in ad return still shows them (R01). With a store the pill shows from
 * COMPACT_BELOW_PX, on the compact row, so the ROAS figure never leaves the row from there up (T08).
 */
const ROAS_RIBBON_BELOW_PX = 2160;
/** Below this width Check design keeps its words and the store-score pill steps aside with them. */
const NARROW_BELOW_PX = 1180;
/**
 * The store-score pill's width budget starts here. The old Edit / Live ROAS toggle used this same
 * line as the point where its labels dropped. The toggle is gone. The constant stays because the
 * pill still steps aside below STORE_SCORE_FROM_PX.
 */
const MODES_ICON_BELOW_PX = 1400;
/** Below this width the Journeys button shows its icon only (see MODES_ICON_BELOW_PX). */
const LIBRARY_LABEL_BELOW_PX = 1280;
/**
 * With a store connected, Check design carries the Store score pill (about 113px), which the widths
 * above were measured without: after an edit the row wrapped at 1,720, 1,440, 1,280, 1,240 and
 * 1,180px (C27). So with a store the compact and ribbon widths move up by this much, and below
 * STORE_SCORE_FROM_PX the pill steps aside. The button's name and title carry the score only while
 * the pill shows it (R07), and at every width the Check design drawer shows it.
 */
const STORE_SCORE_PX = 120;
const STORE_SCORE_FROM_PX = MODES_ICON_BELOW_PX + STORE_SCORE_PX;
/**
 * Below this width the save status shows a short word ("In browser" for "Saved in this browser",
 * whose full sentence stays its spoken text and title) in a slot reserved from the start, and
 * Publish Funnel reads Publish. The full status (about 144px) joining the row on the first edit
 * wrapped it from 1,008px down to 864px, so the map jumped 33px (T08); the row it wraps at now is
 * the same before and after an edit. The edited row with the full status fits from about 1,012px.
 */
const STATUS_SHORT_BELOW_PX = 1040;
/** The reserved slot: the icon, its gap and the widest short word that is not a failure (about 81px). */
const STATUS_SLOT_PX = 84;
/**
 * Below this width (phones) the gaps and side padding tighten and the journey name starts at 80px.
 * Add Step, Check design, Save and Publish keep their words.
 */
const PHONE_BELOW_PX = 520;
/**
 * Below this width (360 to 389px phones) the two halves of the toolbar share one wrapping row.
 * Save keeps its word.
 */
const SMALL_PHONE_BELOW_PX = 390;
/** The Add Step menu width. Each row names the step and says what it is, so the menu is wider than the old one-line list. */
const ADD_MENU_WIDTH = 280;

/** The shortcut key named in the Undo and Redo titles. */
const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Cmd' : 'Ctrl';

/** Undo and Redo match More, dimmed when there is nothing to step to. No outline override, so the focus ring shows. */
const historyButtonStyle = (enabled: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '30px',
  height: '30px',
  padding: 0,
  borderRadius: '8px',
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  color: '#F8FAFC',
  opacity: enabled ? 1 : 0.4,
  cursor: enabled ? 'pointer' : 'not-allowed'
});

interface Props {
  project: JourneyProject;
  onUpdateProjectName: (name: string) => void;
  onUpdateBusinessType?: (category: string) => void;
  onSave: () => void;
  onAddNode: (type: NodeType) => void;
  onOpenWebsite?: () => void;
  user?: any;
  onOpenAuth?: () => void;
  onOpenBilling?: () => void;
  onOpenAdmin?: () => void;
  onSignOut?: () => void;
  saving: boolean;
  /** What the last save actually achieved (see lib/saveOutcome). */
  saveStatus: SaveStatus;
  /** Why the last publish put nothing live, if it did not. */
  publishError?: Refusal | null;
  onDismissSaveError?: () => void;
  onDismissPublishError?: () => void;
  onPublishFunnel?: () => void;
  publishing?: boolean;
  // Workspace & Shopify additions
  workspaces?: Workspace[];
  currentWorkspace?: Workspace | null;
  onSelectWorkspace?: (ws: Workspace) => void;
  onOpenShopifyConnect?: () => void;
  onCreateWorkspace?: () => void;
  activeView?: ActiveAppView;
  canvasViewMode?: CanvasViewMode;
  onOpenAudit: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  /** An autosave is waiting on its timer. */
  savePending?: boolean;
  /** The latest edits have not landed anywhere yet. */
  unsaved?: boolean;
  /** The map's stats snapshot (#9). The totals read it; nothing is summed from saved counts. */
  metrics?: MetricsView;
  /** Opens the journey library (#18). */
  onOpenJourneyLibrary?: () => void;
  /** Why a journey switch or deep link did not go as asked, if it did not. */
  journeyNotice?: Refusal | null;
  onDismissJourneyNotice?: () => void;
  onRetryJourneyNotice?: () => void;
  /** Why this browser's copy was set aside, or why nothing is saved over the account copy (C00). */
  accountNotice?: { message: string; actionLabel?: string } | null;
  onAccountNoticeAction?: () => void;
  onDismissAccountNotice?: () => void;
}

export const CanvasHeader: React.FC<Props> = ({
  project,
  onUpdateProjectName,
  onUpdateBusinessType,
  onSave,
  onAddNode,
  onOpenWebsite,
  user,
  onOpenAuth,
  onOpenBilling,
  onOpenAdmin,
  onSignOut,
  saving,
  saveStatus,
  publishError = null,
  onDismissSaveError,
  onDismissPublishError,
  onPublishFunnel,
  publishing = false,
  workspaces = [],
  currentWorkspace = null,
  onSelectWorkspace,
  onOpenShopifyConnect,
  onCreateWorkspace,
  activeView = 'canvas',
  canvasViewMode = 'edit',
  onOpenAudit,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  savePending = false,
  unsaved = false,
  metrics,
  onOpenJourneyLibrary,
  journeyNotice = null,
  onDismissJourneyNotice,
  onRetryJourneyNotice,
  accountNotice = null,
  onAccountNoticeAction,
  onDismissAccountNotice
}) => {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showRoasTotals, setShowRoasTotals] = useState(false);
  const roasTotalsId = useId();
  // A menu item hands focus to its menu button before it acts (#19), so a dialog or a step it opens
  // returns focus there on close instead of dropping it on the page body.
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  // Which edge of its button the Add Step menu hangs from. On a wrapped toolbar the button sits near
  // the left of the screen, where a right-aligned menu ran off it (#11 found this at 768 and 390px).
  const [addMenuSide, setAddMenuSide] = useState<'left' | 'right'>('right');
  const sideFor = (button: HTMLButtonElement | null, width: number) =>
    button ? menuSide(button.getBoundingClientRect(), width, window.innerWidth) : 'right';
  // Where neither edge fits, the menu slides back on screen by what it would lose, so none of its items is cut off.
  const [addMenuSlide, setAddMenuSlide] = useState(0);
  /** How far right (positive) or left (negative) the menu on sideFor's side moves to sit inside the gutters. */
  const slideFor = (button: HTMLButtonElement | null, width: number) => {
    if (!button) return 0;
    const r = button.getBoundingClientRect();
    const start = sideFor(button, width) === 'left' ? r.left : r.right - width;
    return Math.max(MENU_GUTTER_PX - start, Math.min(0, window.innerWidth - MENU_GUTTER_PX - (start + width)));
  };
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  const isOp = isOperator(user);

  // The header used to be one 2,704px row: on a 1440px laptop Save and Publish sat past the
  // right edge, where the page's overflow:hidden made them unreachable.
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Check design (#10): the store score only when a store is connected. storeReport is the pill,
  // shown only where the row has room for it (C27), and the button's name and title follow it.
  const storeScore = useMemo(() => storeScoreFor(project, currentWorkspace), [project, currentWorkspace]);
  const storeReport = viewportWidth >= STORE_SCORE_FROM_PX ? storeScore : null;
  const storeWidth = storeReport ? STORE_SCORE_PX : 0;
  const compact = viewportWidth < COMPACT_BELOW_PX + storeWidth;
  const statsHidden = compact || (canvasViewMode === 'roas' && viewportWidth < ROAS_RIBBON_BELOW_PX + storeWidth);
  // The mode's key number is never hidden where the row has room for it (T08): from the compact width
  // up the pill stands in for the ribbon, with a store too, where the compact width moves up by the
  // store pill and 1,720 to 1,839px used to show no ROAS figure at all.
  const roasSummary = canvasViewMode === 'roas' && statsHidden && viewportWidth >= COMPACT_BELOW_PX;
  const narrow = viewportWidth < NARROW_BELOW_PX;
  const statusShort = viewportWidth < STATUS_SHORT_BELOW_PX;
  const phone = viewportWidth < PHONE_BELOW_PX;
  const smallPhone = viewportWidth < SMALL_PHONE_BELOW_PX;
  // On a small phone each half of the toolbar hands its items to the toolbar's own row (U09).
  const toolbarHalf: React.CSSProperties | null = smallPhone ? { display: 'contents' } : null;
  // An open menu is placed again when the screen changes width (a phone turned on its side), from
  // the button's new place once the row has laid out, so it never stays where the old width put it.
  useLayoutEffect(() => {
    if (showAddMenu) { setAddMenuSide(sideFor(addButtonRef.current, ADD_MENU_WIDTH)); setAddMenuSlide(slideFor(addButtonRef.current, ADD_MENU_WIDTH)); }
  }, [viewportWidth]);

  // The ROAS totals pill exists only between the two widths, so the totals close when it steps aside.
  useEffect(() => {
    if (!roasSummary) setShowRoasTotals(false);
  }, [roasSummary]);

  // Escape closes whichever menu is open, and the ROAS totals.
  useEffect(() => {
    if (!showAddMenu && !showUserMenu && !showRoasTotals) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Focus sits on an item while a menu is open, and closing the menu removes that item, so hand
      // focus back to the menu's button or it falls to the page body (C30).
      const active = document.activeElement;
      if (addMenuRef.current?.contains(active)) addButtonRef.current?.focus();
      else if (userMenuRef.current?.contains(active)) userButtonRef.current?.focus();
      setShowAddMenu(false);
      setShowUserMenu(false);
      // Nothing in the totals takes focus, so focus is already on their pill.
      setShowRoasTotals(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAddMenu, showUserMenu, showRoasTotals]);

  // Opening Add Step puts focus on its first item, so the arrow keys below have somewhere to start.
  useEffect(() => {
    if (!showAddMenu) return;
    addMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [showAddMenu]);

  // ArrowUp and ArrowDown move between a menu's items, wrapping; Home and End jump to the ends.
  const moveInMenu = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (at + 1) % items.length
      : (at <= 0 ? items.length - 1 : at - 1);
    items[next].focus();
  };

  // What the save indicator says. Edits save themselves, so a waiting save reads as saving, and
  // "Unsaved changes" means the latest edits have not landed and nothing is about to save them.
  // `short` is what a narrow row shows (T08); the full text is still what a screen reader hears.
  const statusView: { text: string; short: string; title: string; color: string; icon: React.ReactNode } | null = saving || savePending
    ? { text: 'Saving…', short: 'Saving…', title: 'Saving this journey', color: '#94A3B8', icon: <Loader2 size={13} className="spin" /> }
    : saveStatus.kind === 'failed'
      ? { text: saveStatus.action === 'open-library' ? 'Out of space' : 'Not saved', short: saveStatus.action === 'open-library' ? 'No space' : 'Not saved', title: saveStatus.message, color: '#FCA5A5', icon: <AlertTriangle size={13} /> }
      : unsaved
        ? { text: 'Unsaved changes', short: 'Unsaved', title: 'You have edits that are not saved yet. Press Save to save them now.', color: '#FBBF24', icon: <Circle size={9} fill="#FBBF24" /> }
        : saveStatus.kind === 'saved'
          ? { text: 'Saved', short: 'Saved', title: 'Saved to your account.', color: '#34D399', icon: <CheckCircle2 size={13} /> }
          : saveStatus.kind === 'browser-only'
            ? { text: 'Saved in this browser', short: 'In browser', title: 'You are signed out, so this journey is saved in this browser only. Sign in to keep it in your account.', color: '#FBBF24', icon: <AlertTriangle size={13} /> }
            : saveStatus.kind === 'not-backed-up'
              ? { text: 'Saved, not backed up', short: 'No backup', title: 'The server kept this journey but could not back it up, so a server restart could lose it. Save again in a few minutes.', color: '#FBBF24', icon: <AlertTriangle size={13} /> }
              : null;

  const problems: { key: string; message: string; onRetry?: () => void; retryLabel?: string; onDismiss: () => void }[] = [];
  if (accountNotice) {
    problems.push({
      key: 'account',
      message: accountNotice.message,
      onRetry: accountNotice.actionLabel ? onAccountNoticeAction : undefined,
      retryLabel: accountNotice.actionLabel,
      onDismiss: () => onDismissAccountNotice?.()
    });
  }
  if (saveStatus.kind === 'failed') {
    // Out of space, trying again cannot help: the button opens the library, where a journey can go.
    const openLibrary = saveStatus.action === 'open-library' && onOpenJourneyLibrary;
    problems.push({
      key: 'save',
      message: saveStatus.message,
      onRetry: openLibrary ? onOpenJourneyLibrary : saveStatus.retryable ? onSave : undefined,
      retryLabel: openLibrary ? 'Open journeys' : undefined,
      onDismiss: () => onDismissSaveError?.()
    });
  }
  if (publishError) {
    problems.push({
      key: 'publish',
      message: publishError.message,
      onRetry: publishError.retryable ? onPublishFunnel : undefined,
      onDismiss: () => onDismissPublishError?.()
    });
  }
  if (journeyNotice) {
    problems.push({
      key: 'journey',
      message: journeyNotice.message,
      onRetry: journeyNotice.retryable ? onRetryJourneyNotice : undefined,
      onDismiss: () => onDismissJourneyNotice?.()
    });
  }

  // Check design (#10): the open design checks, and the store score only when a store is connected.
  const designCount = useMemo(() => checkJourneyDesign(project).issues.length, [project]);
  // Said only where the pill shows it (R07): a name that carried it at every width told a screen
  // reader a score a sighted user at 1,440px never saw. The drawer shows it at every width.
  const storeScoreName = storeReport ? `, store score ${storeReport.overallScore} out of 100` : '';
  const storeScoreTitle = storeReport ? ` Store score ${storeReport.overallScore} out of 100.` : '';

  // Totals over the landing pages the stats snapshot measured (#9). Spend is what was entered.
  const totals = journeyTotals(project.nodes, metrics?.snapshot ?? null);
  const hasSnapshot = metrics?.status === 'ready' && !!metrics.snapshot;
  const roasHeadline = totals.roas === null ? 'ROAS Unavailable' : `Est. ${totals.roas.toFixed(1)}x ROAS`;
  // The ribbon's four figures, for the ROAS pill that stands in for it where the row has no room.
  const roasFigures: { label: string; value: string; measured: boolean }[] = [
    { label: 'Spend you entered', value: totals.spend > 0 ? moneyText(totals.spend) : 'Not entered', measured: totals.spend > 0 },
    { label: 'Gross', value: moneyText(totals.gross), measured: totals.gross !== null },
    { label: 'Bump rate', value: percentText(totals.bumpRate), measured: totals.bumpRate !== null },
    { label: 'ROAS', value: totals.roas === null ? 'Unavailable' : `Est. ${totals.roas.toFixed(1)}x`, measured: totals.roas !== null }
  ];

  // Open checks make Add Step the filled action. A clean check makes Publish the filled action.
  // Publish stays available either way.
  const publishPrimary = designCount === 0;
  const filledAction: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '7px 16px',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #EC4899 0%, #DB2777 100%)',
    border: 'none',
    color: '#FFFFFF',
    fontSize: '12px',
    fontWeight: 800,
    letterSpacing: '0.02em',
    boxShadow: '0 4px 15px rgba(236, 72, 153, 0.4)',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  };
  const quietAction: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '7px 12px',
    borderRadius: '8px',
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    color: '#F8FAFC',
    fontSize: '12px',
    fontWeight: 600,
    boxShadow: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  };

  return (
    <>
      <header
        className="jv-global-header"
        style={{
          minHeight: '56px',
          padding: '8px 20px',
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px 16px',
          position: 'relative',
          // Above the journey toolbar below it, so the account menu opens over that row.
          zIndex: 31
        }}
      >
        {/* Left: Brand and Workspace */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0, flexWrap: 'wrap' }}>
          <div className="jv-header-brand" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #ec4899, #8B5CF6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 10px rgba(236, 72, 153, 0.4)'
              }}
            >
              <Compass size={18} color="#FFFFFF" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '-0.02em', color: '#FFFFFF' }}>
                  Jourvance
                </span>
              </div>
            </div>
          </div>

          <div className="jv-header-brand" style={{ width: '1px', height: '24px', background: 'rgba(255, 255, 255, 0.1)' }} />

          {/* Workspace & Shopify Selector */}
          {onSelectWorkspace && onOpenShopifyConnect && onCreateWorkspace && (
            <WorkspaceSelector
              workspaces={workspaces}
              currentWorkspace={currentWorkspace}
              onSelectWorkspace={onSelectWorkspace}
              onOpenShopifyConnect={onOpenShopifyConnect}
              onCreateWorkspace={onCreateWorkspace}
              onOpenBilling={onOpenBilling}
            />
          )}
        </div>

        {/* Right: Account. The place switcher lives in the rail, so this row is the account only. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* User Account / Sign In */}
          {user ? (
            <div style={{ position: 'relative' }}>
              <button
                ref={userButtonRef}
                onClick={() => setShowUserMenu(!showUserMenu)}
                aria-haspopup="menu"
                aria-expanded={showUserMenu}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 10px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(30, 41, 59, 0.9)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <div
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    backgroundColor: isOp ? '#047857' : '#4F46E5',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    fontWeight: 700
                  }}
                >
                  {user.email ? user.email[0].toUpperCase() : 'U'}
                </div>
                <span style={{ maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.displayName || user.email?.split('@')[0]}
                </span>
              </button>

              {showUserMenu && (
                <div
                  ref={userMenuRef}
                  style={{
                    position: 'absolute',
                    top: '38px',
                    right: 0,
                    width: '190px',
                    backgroundColor: '#1E293B',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
                    padding: '6px',
                    zIndex: 60
                  }}
                >
                  <div style={{ padding: '6px 8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', marginBottom: '4px' }}>
                    <div style={{ fontSize: '11px', color: '#94A3B8' }}>Account</div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#FFFFFF', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {user.email}
                    </div>
                  </div>

                  {isOp && (
                    <button
                      onClick={() => { userButtonRef.current?.focus(); setShowUserMenu(false); onOpenAdmin?.(); }}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        background: 'none',
                        border: 'none',
                        color: '#34D399',
                        fontSize: '11px',
                        fontWeight: 700,
                        textAlign: 'left',
                        cursor: 'pointer'
                      }}
                    >
                      🛡 Operator Admin
                    </button>
                  )}

                  <button
                    onClick={() => { userButtonRef.current?.focus(); setShowUserMenu(false); onOpenBilling?.(); }}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      background: 'none',
                      border: 'none',
                      color: '#A5B4FC',
                      fontSize: '11px',
                      fontWeight: 600,
                      textAlign: 'left',
                      cursor: 'pointer'
                    }}
                  >
                    ⚡ Subscription Plan
                  </button>

                  {onOpenWebsite && (
                    <button
                      type="button"
                      onClick={() => { userButtonRef.current?.focus(); setShowUserMenu(false); onOpenWebsite(); }}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        background: 'none',
                        border: 'none',
                        color: '#C4B5FD',
                        fontSize: '11px',
                        fontWeight: 600,
                        textAlign: 'left',
                        cursor: 'pointer'
                      }}
                    >
                      {ACTION_LABEL.publicWebsite}
                    </button>
                  )}

                  <button
                    onClick={() => { setShowUserMenu(false); onSignOut?.(); }}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      background: 'none',
                      border: 'none',
                      color: '#F87171',
                      fontSize: '11px',
                      fontWeight: 500,
                      textAlign: 'left',
                      cursor: 'pointer'
                    }}
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {onOpenWebsite && (
                <button
                  type="button"
                  onClick={onOpenWebsite}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#E2E8F0',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {ACTION_LABEL.publicWebsite}
                </button>
              )}
              <button
                onClick={onOpenAuth}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Sign In
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Journey toolbar: everything that acts on the open journey, on one row that fits a laptop */}
      {activeView === 'canvas' && (
        <div
          role="toolbar"
          aria-label="Journey tools"
          style={{
            minHeight: '48px',
            // 10px on a small phone, with the name starting at 72px, so a two-digit Check design count
            // (up to three digits) still fits the first row at 360px (U09).
            padding: smallPhone ? '6px 10px' : phone ? '6px 12px' : '6px 20px',
            background: 'rgba(11, 15, 25, 0.92)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            // One gap for every item when the halves share the rows on a small phone, and Publish's
            // own margin takes the room left at the end of its row (U09).
            justifyContent: smallPhone ? 'flex-start' : 'space-between',
            flexWrap: 'wrap',
            gap: smallPhone ? '6px' : '8px 12px',
            position: 'relative',
            // Above the map's own floating controls (zIndex 20, later in the page), so the Add Step
            // and More menus open over them rather than under them where no click can reach.
            zIndex: 30
          }}
        >
          <div style={toolbarHalf ?? { display: 'flex', alignItems: 'center', gap: phone ? '6px' : '10px', minWidth: 0, flex: '1 1 auto', flexWrap: 'wrap' }}>
            {/* The journey library (#18): every journey in this browser and the account */}
            {onOpenJourneyLibrary && (
              <button
                type="button"
                onClick={onOpenJourneyLibrary}
                // The library hands focus back here when the button that opened it is gone (the
                // out-of-space banner's Open journeys, once a removal lets the save land).
                data-journeys-trigger
                aria-label="Journeys"
                aria-haspopup="dialog"
                title="Your journeys"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 12px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#F8FAFC',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                <Library size={14} aria-hidden="true" />
                {viewportWidth >= LIBRARY_LABEL_BELOW_PX && <span>Journeys</span>}
              </button>
            )}

            {/* Editable Name */}
            <input
              type="text"
              value={project.name}
              onChange={e => onUpdateProjectName(e.target.value)}
              aria-label="Journey name"
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#F1F5F9',
                background: 'transparent',
                border: '1px solid transparent',
                outline: 'none',
                // The row wraps on each item's starting width, so the name starts at 120px (width
                // too, or the row sizes it by the input's own default width) and grows into whatever
                // room the row has left, up to its old width. Starting at 200px it wrapped the
                // edited row below about 1,090px, 1,024px included (R01). On a phone it starts at
                // 80px, so Check design fits on the first row at 390px (T08), and at 72px below 390px,
                // where "! 10" wrapped Check design at 360px and pushed Publish to a third row (U09).
                width: smallPhone ? '72px' : phone ? '80px' : '120px',
                flex: smallPhone ? '1 1 72px' : phone ? '1 1 80px' : '1 1 120px',
                maxWidth: compact ? '200px' : '240px',
                minWidth: smallPhone ? '72px' : phone ? '80px' : '120px',
                padding: '5px 8px',
                borderRadius: '6px',
                textOverflow: 'ellipsis'
              }}
              onFocus={e => { e.target.style.background = 'rgba(255, 255, 255, 0.05)'; e.target.style.borderColor = 'rgba(99, 102, 241, 0.6)'; }}
              onBlur={e => { e.target.style.background = 'transparent'; e.target.style.borderColor = 'transparent'; }}
            />

            {/* Business Category Selector */}
            <select
              value={
                isUniversalBusinessCategory(project.businessType)
                  ? project.businessType
                  : normalizeBusinessCategory(project.businessType)
              }
              onChange={e => onUpdateBusinessType?.(e.target.value)}
              aria-label="Business category"
              title="Business category"
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#CBD5E1',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '8px',
                padding: '5px 8px',
                cursor: 'pointer',
                height: '30px',
                maxWidth: smallPhone ? '100px' : phone ? '120px' : '160px',
                flexShrink: 0
              }}
            >
              {UNIVERSAL_BUSINESS_CATEGORIES.map(category => (
                <option
                  key={category}
                  value={category}
                  style={{
                    background: '#0B0F19',
                    color: '#F8FAFC',
                    fontSize: '12px'
                  }}
                >
                  {category}
                </option>
              ))}
            </select>

            {/* Undo and Redo: one step is one drag, one delete, or one burst of typing. aria-disabled,
                not disabled, so undoing the last step does not throw keyboard focus off the button. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <button
                type="button"
                aria-label="Undo"
                title={`Undo (${modKey}+Z)`}
                aria-disabled={!canUndo}
                onClick={() => { if (canUndo) onUndo?.(); }}
                style={historyButtonStyle(canUndo)}
              >
                <Undo2 size={14} />
              </button>
              <button
                type="button"
                aria-label="Redo"
                title={`Redo (${modKey}+Shift+Z)`}
                aria-disabled={!canRedo}
                onClick={() => { if (canRedo) onRedo?.(); }}
                style={historyButtonStyle(canRedo)}
              >
                <Redo2 size={14} />
              </button>
            </div>

            {/* Check design (#10): the open design checks. The store score sits beside it only
                when a store is connected and the row has room, and it never gates anything. */}
            <button
              type="button"
              onClick={onOpenAudit}
              aria-label={(designCount > 0
                ? `Check design, ${designCount} open ${designCount === 1 ? 'check' : 'checks'}`
                : 'Check design, all checks passed') + storeScoreName}
              title={(designCount > 0
                ? `${designCount} open design ${designCount === 1 ? 'check' : 'checks'}. Open Check design to see ${designCount === 1 ? 'it' : 'them'}.`
                : 'Every design check passed.') + storeScoreTitle}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '9999px',
                background: designCount > 0
                  ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(217, 119, 6, 0.15))'
                  : 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.15))',
                border: designCount > 0 ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(16, 185, 129, 0.4)',
                color: designCount > 0 ? '#FBBF24' : '#34D399',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: designCount > 0 ? '0 2px 8px rgba(245, 158, 11, 0.15)' : '0 2px 8px rgba(16, 185, 129, 0.15)',
                transition: 'all 0.15s ease'
              }}
            >
              {designCount > 0 ? (
                <AlertTriangle size={13} color="#FBBF24" />
              ) : (
                <CheckCircle2 size={13} color="#34D399" />
              )}
              <span>{designCount > 0 ? `Check design (${designCount})` : 'Design checked'}</span>
              {!narrow && storeReport && (
                <span style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: '#E2E8F0',
                  background: 'rgba(255, 255, 255, 0.1)',
                  padding: '1px 5px',
                  borderRadius: '9999px'
                }}>
                  Store score {storeReport.overallScore}/100
                </span>
              )}
            </button>

            {!statsHidden && (
              <>
              {/* Live Pipeline Telemetry OR ROAS Ribbon */}
              {canvasViewMode === 'roas' ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '4px 14px',
                    borderRadius: '9999px',
                    background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(99, 102, 241, 0.1))',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    boxShadow: '0 2px 12px rgba(16, 185, 129, 0.15)'
                  }}
                >
                  {totals.spend > 0 ? (
                    <div data-entered title="Spend you entered" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94A3B8', fontWeight: 600 }}>Spend</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#F1F5F9' }}>{moneyText(totals.spend)}</span>
                    </div>
                  ) : (
                    <span data-entered title="Spend you entered" style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8' }}>Spend not entered</span>
                  )}
                  <span style={{ color: '#475569' }}>·</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94A3B8', fontWeight: 600 }}>Gross</span>
                    <span data-metric style={{ fontSize: '12px', fontWeight: 800, color: totals.gross === null ? '#94A3B8' : '#34D399' }}>{moneyText(totals.gross)}</span>
                  </div>
                  <span style={{ color: '#475569' }}>·</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '11px', textTransform: 'uppercase', color: '#94A3B8', fontWeight: 600 }}>Bump rate</span>
                    <span data-metric style={{ fontSize: '11px', fontWeight: 700, color: totals.bumpRate === null ? '#94A3B8' : '#F472B6' }}>{percentText(totals.bumpRate)}</span>
                  </div>
                  <span style={{ color: '#475569' }}>·</span>
                  <div
                    data-metric
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(16, 185, 129, 0.25)',
                      color: totals.roas === null ? '#CBD5E1' : '#34D399',
                      fontWeight: 800,
                      fontSize: '11px'
                    }}
                  >
                    <span>{roasHeadline}</span>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '5px 12px',
                    borderRadius: '9999px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)'
                  }}
                >
                  {hasSnapshot ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: '#94A3B8' }}>Leads</span>
                        <span data-metric style={{ fontSize: '12px', fontWeight: 700, color: totals.leads === null ? '#94A3B8' : '#38BDF8' }}>{countText(totals.leads)}</span>
                      </div>
                      <span style={{ color: '#475569' }}>·</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: '#94A3B8' }}>Lead rate</span>
                        <span data-metric style={{ fontSize: '12px', fontWeight: 700, color: totals.leadRate === null ? '#94A3B8' : '#34D399' }}>{percentText(totals.leadRate)}</span>
                      </div>
                    </>
                  ) : (
                    <span data-metric title={metricsStatusNote(metrics ?? null)} style={{ fontSize: '11px', color: '#94A3B8' }}>
                      Numbers unavailable
                    </span>
                  )}
                </div>
              )}
              </>
            )}

            {/* Where the ribbon has no room (R01), its headline figure opens all four totals. */}
            {roasSummary && (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => { setShowRoasTotals(v => !v); setShowAddMenu(false); }}
                  aria-expanded={showRoasTotals}
                  aria-controls={roasTotalsId}
                  title="Show the spend, gross, bump rate and ROAS totals"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 8px 4px 10px',
                    borderRadius: '9999px',
                    background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(99, 102, 241, 0.1))',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    color: totals.roas === null ? '#CBD5E1' : '#34D399',
                    fontSize: '11px',
                    fontWeight: 800,
                    whiteSpace: 'nowrap',
                    cursor: 'pointer'
                  }}
                >
                  <span data-metric>{roasHeadline}</span>
                  <ChevronDown size={12} aria-hidden="true" style={{ transform: showRoasTotals ? 'rotate(180deg)' : undefined }} />
                </button>
                {showRoasTotals && (
                  <>
                    <div onClick={() => setShowRoasTotals(false)} style={{ position: 'fixed', inset: 0, zIndex: 45 }} />
                    <div
                      id={roasTotalsId}
                      role="group"
                      aria-label="ROAS totals"
                      className="glass-dropdown"
                      style={{ position: 'absolute', top: '32px', left: 0, width: '220px', borderRadius: '10px', padding: '10px 12px', zIndex: 50 }}
                    >
                      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', alignItems: 'baseline' }}>
                        {roasFigures.map(f => (
                          <React.Fragment key={f.label}>
                            <dt style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8' }}>{f.label}</dt>
                            <dd data-metric style={{ margin: 0, fontSize: '12px', fontWeight: 700, textAlign: 'right', color: f.measured ? '#F1F5F9' : '#94A3B8' }}>{f.value}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div style={toolbarHalf ?? { display: 'flex', alignItems: 'center', gap: phone ? '6px' : '8px', flex: '0 1 auto', minWidth: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {/* Add Step Dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                ref={addButtonRef}
                type="button"
                onClick={() => { setAddMenuSide(sideFor(addButtonRef.current, ADD_MENU_WIDTH)); setAddMenuSlide(slideFor(addButtonRef.current, ADD_MENU_WIDTH)); setShowAddMenu(!showAddMenu); }}
                aria-haspopup="menu"
                aria-expanded={showAddMenu}
                style={{ ...(publishPrimary ? quietAction : filledAction), cursor: 'pointer' }}
              >
                <Plus size={14} aria-hidden="true" />
                <span>{ACTION_LABEL.addStep}</span>
              </button>

              {showAddMenu && (
                <div
                  ref={addMenuRef}
                  role="menu"
                  aria-label="Add a step"
                  onKeyDown={moveInMenu}
                  className="glass-dropdown"
                  style={{
                    position: 'absolute',
                    top: '42px',
                    [addMenuSide]: 0,
                    transform: addMenuSlide ? `translateX(${addMenuSlide}px)` : undefined,
                    width: `${ADD_MENU_WIDTH}px`,
                    borderRadius: '10px',
                    padding: '6px',
                    zIndex: 30
                  }}
                >
                  {STEP_TYPES.map(step => (
                    <button
                      key={step.type}
                      type="button"
                      role="menuitem"
                      onClick={() => { addButtonRef.current?.focus(); onAddNode(step.type); setShowAddMenu(false); }}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', background: 'transparent', border: 'none', color: '#E2E8F0', fontSize: '12px', fontWeight: 500, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '8px' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: step.dotColor, flexShrink: 0, marginTop: '4px' }} />
                      <span style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                        <span>{step.label}</span>
                        <span style={{ fontSize: '11px', fontWeight: 500, color: '#94A3B8' }}>{step.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Save state: what the last save actually achieved, or that there are edits since. On a
                narrow row its slot is held from the start and it shows a short word, so the first
                edit never wraps the row (T08); a screen reader still hears the full text, first. */}
            <span
              role="status"
              aria-live="polite"
              title={statusView?.title || ''}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '12px',
                fontWeight: 600,
                color: statusView?.color || '#94A3B8',
                whiteSpace: 'nowrap',
                minWidth: statusShort ? `${STATUS_SLOT_PX}px` : undefined,
                maxWidth: '190px',
                overflow: 'hidden'
              }}
            >
              {statusView?.icon}
              {statusView && (statusShort && statusView.short !== statusView.text
                ? <>
                    <span className="jv-sr-only">{statusView.text}</span>
                    <span aria-hidden="true">{statusView.short}</span>
                  </>
                : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{statusView.text}</span>)}
            </span>

            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              {/* The label keeps its width while a save runs (the status beside it says Saving…), so
                  an autosave never widens the row onto a second line (T08). */}
              {saving ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
              <span>Save</span>
            </button>

            {/* Publish stays available. It is the filled action once every design check has passed. */}
            {onPublishFunnel && (
              <button
                data-publish-trigger
                onClick={onPublishFunnel}
                disabled={publishing}
                style={{
                  ...(publishPrimary ? filledAction : quietAction),
                  marginLeft: smallPhone ? 'auto' : undefined,
                  cursor: publishing ? 'not-allowed' : 'pointer'
                }}
              >
                {publishing && statusShort ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Globe size={14} aria-hidden="true" />}
                {/* On a narrow row it reads Publish and keeps that width while it publishes (T08). */}
                <span>{statusShort ? 'Publish' : publishing ? 'Publishing…' : 'Publish Funnel'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* A save or publish that did not land says so, in words, until it is dealt with */}
      {problems.length > 0 && (
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '8px 20px',
            background: 'rgba(127, 29, 29, 0.45)',
            borderBottom: '1px solid rgba(248, 113, 113, 0.35)',
            position: 'relative',
            zIndex: 19
          }}
        >
          {problems.map(problem => (
            <div key={problem.key} style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <AlertTriangle size={15} color="#FCA5A5" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '13px', color: '#FEE2E2', flex: '1 1 320px', lineHeight: 1.45 }}>{problem.message}</span>
              {problem.onRetry && (
                <button
                  type="button"
                  onClick={problem.onRetry}
                  style={{ padding: '5px 12px', borderRadius: '6px', background: '#DC2626', border: 'none', color: '#FFFFFF', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  {problem.retryLabel || 'Try again'}
                </button>
              )}
              <button
                type="button"
                onClick={problem.onDismiss}
                style={{ padding: '5px 10px', borderRadius: '6px', background: 'transparent', border: '1px solid rgba(254, 226, 226, 0.35)', color: '#FEE2E2', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
};
