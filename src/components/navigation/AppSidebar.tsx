import React, { useState, useRef, useEffect } from 'react';
import {
  Compass,
  GitFork,
  Mail,
  BarChart3,
  Plus,
  WandSparkles,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Zap,
  Download,
  Shield,
  CreditCard,
  User,
  LogOut,
  ChevronRight,
  Pin,
  PinOff,
  Layers,
  ShoppingBag,
  X
} from 'lucide-react';
import type { ActiveAppView, NodeType, Workspace } from '../../types/journey';

interface Props {
  activeView: ActiveAppView;
  onSelectView: (view: ActiveAppView) => void;
  // Workspace & Shopify
  workspaces?: Workspace[];
  currentWorkspace?: Workspace | null;
  onSelectWorkspace?: (ws: Workspace) => void;
  onOpenShopifyConnect?: () => void;
  onCreateWorkspace?: () => void;
  onOpenBilling?: () => void;
  // Creation Palette
  onAddNode: (type: NodeType) => void;
  onOpenAiBuilder?: () => void;
  onOpenBlueprints?: () => void;
  // Diagnostics & Tools
  onOpenAudit: () => void;
  designCount?: number;
  storeScore?: number | null;
  onOpenSimulator?: () => void;
  onOpenShopifySync?: () => void;
  onExportAssets?: () => void;
  // Account
  user?: any;
  onOpenAuth?: () => void;
  onOpenAdmin?: () => void;
  onSignOut?: () => void;
  // Mobile drawer control
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const STEP_TYPES: { type: NodeType; label: string; desc: string; dotColor: string }[] = [
  { type: 'ad-source', label: 'Ad Source', desc: 'Paid or organic traffic channel', dotColor: '#3B82F6' },
  { type: 'landing-page', label: 'Landing Page', desc: 'Product, advertorial, or hero offer', dotColor: '#6366F1' },
  { type: 'ab-split', label: 'A/B Traffic Splitter', desc: 'Split test variants and copy', dotColor: '#8B5CF6' },
  { type: 'lead-form', label: 'Lead Capture Form', desc: 'High-converting opt-in or quiz', dotColor: '#10B981' },
  { type: 'follow-up-sequence', label: 'Follow-Up Sequence', desc: 'Automated email rescue or drip', dotColor: '#F59E0B' },
  { type: 'thank-you', label: 'Thank-you page', desc: 'Order confirmation and receipt', dotColor: '#EC4899' },
  { type: 'upsell', label: 'Post-Purchase Upsell', desc: 'One-click Day-0 AOV bump offer', dotColor: '#10B981' }
];

export const AppSidebar: React.FC<Props> = ({
  activeView,
  onSelectView,
  workspaces = [],
  currentWorkspace = null,
  onSelectWorkspace,
  onOpenShopifyConnect,
  onCreateWorkspace,
  onOpenBilling,
  onAddNode,
  onOpenAiBuilder,
  onOpenBlueprints,
  onOpenAudit,
  designCount = 0,
  storeScore = null,
  onOpenSimulator,
  onOpenShopifySync,
  onExportAssets,
  user,
  onOpenAuth,
  onOpenAdmin,
  onSignOut,
  mobileOpen = false,
  onCloseMobile
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [showAddFlyout, setShowAddFlyout] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);

  const isExpanded = isPinned || isHovered;
  const isOp = user?.email?.toLowerCase() === 'tlm@tarrenmunoz.com';
  const hasStore = currentWorkspace?.shopifyConfig?.status === 'connected';

  const addFlyoutRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on Escape key
  useEffect(() => {
    if (!showAddFlyout && !showAccountMenu && !showWorkspaceMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAddFlyout(false);
        setShowAccountMenu(false);
        setShowWorkspaceMenu(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAddFlyout, showAccountMenu, showWorkspaceMenu]);

  // Close menus on click outside
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (addFlyoutRef.current && !addFlyoutRef.current.contains(e.target as Node)) {
        setShowAddFlyout(false);
      }
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setShowAccountMenu(false);
      }
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setShowWorkspaceMenu(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          onClick={onCloseMobile}
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(2, 6, 23, 0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 49
          }}
        />
      )}

      {/* Outer rail container that floats over the workspace */}
      <div
        className={`jv-sidebar-container ${mobileOpen ? 'jv-sidebar-mobile-open' : ''}`}
        style={{
          width: isPinned ? '240px' : '64px',
          position: 'absolute',
          top: '10px',
          left: '10px',
          bottom: '110px',
          zIndex: 40,
          pointerEvents: 'none',
          transition: 'width 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Inner floating/expanding rail */}
        <aside
          aria-label="Main Navigation"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => {
            setIsHovered(false);
            setShowAddFlyout(false);
            setShowAccountMenu(false);
            setShowWorkspaceMenu(false);
          }}
          className="jv-sidebar"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: isExpanded ? '240px' : '64px',
            pointerEvents: 'auto',
            borderRadius: '12px',
            backgroundColor: 'rgba(11, 15, 25, 0.96)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: isExpanded && !isPinned ? '0 12px 32px rgba(0, 0, 0, 0.6)' : '0 4px 20px rgba(0, 0, 0, 0.3)',
            transition: 'width 0.22s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.22s ease',
            overflowX: 'hidden',
            overflowY: 'auto'
          }}
        >
          {/* Top Section: Brand & Workspace */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 10px 8px' }}>
            {/* Brand Logo Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                height: '40px',
                padding: '0 6px',
                borderRadius: '8px'
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  minWidth: '32px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #EC4899 0%, #8B5CF6 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 10px rgba(236, 72, 153, 0.35)',
                  flexShrink: 0
                }}
              >
                <Compass size={18} color="#FFFFFF" />
              </div>

              {isExpanded && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '14px', fontWeight: 800, letterSpacing: '-0.02em', color: '#FFFFFF' }}>
                      Jourvance
                    </span>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: '#EC4899', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      Studio
                    </span>
                  </div>

                  {/* Pin toggle button on desktop */}
                  <button
                    type="button"
                    onClick={() => setIsPinned(!isPinned)}
                    aria-label={isPinned ? 'Unpin sidebar' : 'Pin sidebar'}
                    title={isPinned ? 'Unpin sidebar' : 'Pin sidebar open'}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '26px',
                      height: '26px',
                      borderRadius: '6px',
                      background: isPinned ? 'rgba(236, 72, 153, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                      border: 'none',
                      color: isPinned ? '#F472B6' : '#94A3B8',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                  </button>
                </div>
              )}
            </div>

            {/* Workspace & Store Pill */}
            <div ref={workspaceMenuRef} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
                title={`Workspace: ${currentWorkspace?.name || 'Default'}`}
                aria-label={`Current workspace: ${currentWorkspace?.name || 'Default'}`}
                aria-haspopup="true"
                aria-expanded={showWorkspaceMenu}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  height: '38px',
                  padding: isExpanded ? '0 10px' : '0 10px',
                  justifyContent: isExpanded ? 'flex-start' : 'center',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  color: '#E2E8F0',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Layers size={15} color={hasStore ? '#10B981' : '#EC4899'} style={{ flexShrink: 0 }} />
                {isExpanded && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, minWidth: 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                      {currentWorkspace?.name || 'Workspace'}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '9999px',
                        background: hasStore ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                        color: hasStore ? '#34D399' : '#94A3B8'
                      }}
                    >
                      {hasStore ? 'Shopify' : 'Store'}
                    </span>
                  </div>
                )}
              </button>

              {/* Workspace flyout menu */}
              {showWorkspaceMenu && (
                <div
                  className="glass-dropdown"
                  style={{
                    position: 'absolute',
                    top: '44px',
                    left: 0,
                    width: '220px',
                    borderRadius: '10px',
                    padding: '8px',
                    zIndex: 60
                  }}
                >
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', padding: '4px 8px', textTransform: 'uppercase' }}>
                    Workspaces
                  </div>
                  {workspaces.map(ws => (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => {
                        onSelectWorkspace?.(ws);
                        setShowWorkspaceMenu(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        background: ws.id === currentWorkspace?.id ? 'rgba(236, 72, 153, 0.15)' : 'transparent',
                        border: 'none',
                        color: ws.id === currentWorkspace?.id ? '#F472B6' : '#E2E8F0',
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ws.name}</span>
                      {ws.id === currentWorkspace?.id && <span style={{ fontSize: '11px', color: '#F472B6' }}>Active</span>}
                    </button>
                  ))}
                  <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '6px 0' }} />
                  <button
                    type="button"
                    onClick={() => {
                      setShowWorkspaceMenu(false);
                      onOpenShopifyConnect?.();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      background: 'none',
                      border: 'none',
                      color: '#34D399',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <ShoppingBag size={13} />
                    <span>{hasStore ? 'Manage Shopify Store' : 'Connect Shopify Store'}</span>
                  </button>
                  {onCreateWorkspace && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowWorkspaceMenu(false);
                        onCreateWorkspace();
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        background: 'none',
                        border: 'none',
                        color: '#38BDF8',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                    >
                      <Plus size={13} />
                      <span>Create Workspace</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

            {/* Views Navigation */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {isExpanded && (
                <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', padding: '0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Views
                </span>
              )}

              {/* Funnel Canvas */}
              <button
                type="button"
                onClick={() => onSelectView('canvas')}
                aria-pressed={activeView === 'canvas'}
                aria-label="Switch to Funnel Canvas view"
                title="Funnel Canvas"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  height: '40px',
                  padding: isExpanded ? '0 10px' : '0 12px',
                  justifyContent: isExpanded ? 'flex-start' : 'center',
                  borderRadius: '8px',
                  backgroundColor: activeView === 'canvas' ? 'rgba(236, 72, 153, 0.18)' : 'transparent',
                  border: activeView === 'canvas' ? '1px solid rgba(236, 72, 153, 0.35)' : '1px solid transparent',
                  color: activeView === 'canvas' ? '#FFFFFF' : '#94A3B8',
                  fontSize: '12px',
                  fontWeight: activeView === 'canvas' ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <GitFork size={16} color={activeView === 'canvas' ? '#EC4899' : '#94A3B8'} style={{ flexShrink: 0 }} />
                {isExpanded && <span>Funnel Canvas</span>}
              </button>

              {/* Email Studio */}
              <button
                type="button"
                onClick={() => onSelectView('email-studio')}
                aria-pressed={activeView === 'email-studio'}
                aria-label="Switch to Email Studio view"
                title="Email Studio"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  height: '40px',
                  padding: isExpanded ? '0 10px' : '0 12px',
                  justifyContent: isExpanded ? 'flex-start' : 'center',
                  borderRadius: '8px',
                  backgroundColor: activeView === 'email-studio' ? 'rgba(236, 72, 153, 0.18)' : 'transparent',
                  border: activeView === 'email-studio' ? '1px solid rgba(236, 72, 153, 0.35)' : '1px solid transparent',
                  color: activeView === 'email-studio' ? '#FFFFFF' : '#94A3B8',
                  fontSize: '12px',
                  fontWeight: activeView === 'email-studio' ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Mail size={16} color={activeView === 'email-studio' ? '#EC4899' : '#94A3B8'} style={{ flexShrink: 0 }} />
                {isExpanded && <span>Email Studio</span>}
              </button>

              {/* Attribution */}
              <button
                type="button"
                onClick={() => onSelectView('attribution')}
                aria-pressed={activeView === 'attribution'}
                aria-label="Switch to Attribution view"
                title="Attribution Reports"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  height: '40px',
                  padding: isExpanded ? '0 10px' : '0 12px',
                  justifyContent: isExpanded ? 'flex-start' : 'center',
                  borderRadius: '8px',
                  backgroundColor: activeView === 'attribution' ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                  border: activeView === 'attribution' ? '1px solid rgba(99, 102, 241, 0.35)' : '1px solid transparent',
                  color: activeView === 'attribution' ? '#FFFFFF' : '#94A3B8',
                  fontSize: '12px',
                  fontWeight: activeView === 'attribution' ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <BarChart3 size={16} color={activeView === 'attribution' ? '#818CF8' : '#94A3B8'} style={{ flexShrink: 0 }} />
                {isExpanded && <span>Attribution</span>}
              </button>
            </div>

            <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

            {/* Creation Palette */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {isExpanded && (
                <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', padding: '0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Creation
                </span>
              )}

              {/* Add Step with Flyout */}
              <div ref={addFlyoutRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setShowAddFlyout(!showAddFlyout)}
                  aria-haspopup="menu"
                  aria-expanded={showAddFlyout}
                  aria-label="Insert step to canvas"
                  title="Insert step to canvas"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    height: '40px',
                    padding: isExpanded ? '0 10px' : '0 12px',
                    justifyContent: isExpanded ? 'flex-start' : 'center',
                    borderRadius: '8px',
                    backgroundColor: showAddFlyout ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#F8FAFC',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Plus size={16} color="#38BDF8" style={{ flexShrink: 0 }} />
                  {isExpanded && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                      <span>+ Step</span>
                      <ChevronRight size={13} color="#94A3B8" />
                    </div>
                  )}
                </button>

                {/* Add Step Flyout Submenu */}
                {showAddFlyout && (
                  <div
                    role="menu"
                    aria-label="Step Palette"
                    className="glass-dropdown"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: isExpanded ? '236px' : '68px',
                      width: '230px',
                      borderRadius: '10px',
                      padding: '6px',
                      zIndex: 70,
                      boxShadow: '0 12px 30px rgba(0, 0, 0, 0.6)'
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', padding: '4px 8px 6px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', marginBottom: '4px' }}>
                      Choose Step Type
                    </div>
                    {STEP_TYPES.map(s => (
                      <button
                        key={s.type}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onAddNode(s.type);
                          setShowAddFlyout(false);
                        }}
                        style={{
                          width: '100%',
                          padding: '7px 8px',
                          borderRadius: '6px',
                          background: 'transparent',
                          border: 'none',
                          color: '#E2E8F0',
                          fontSize: '12px',
                          fontWeight: 500,
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.dotColor, flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Draft with AI */}
              {onOpenAiBuilder && (
                <button
                  type="button"
                  onClick={onOpenAiBuilder}
                  aria-label="Draft with AI"
                  title="Draft Funnel with AI"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    height: '40px',
                    padding: isExpanded ? '0 10px' : '0 12px',
                    justifyContent: isExpanded ? 'flex-start' : 'center',
                    borderRadius: '8px',
                    backgroundColor: 'transparent',
                    border: '1px solid transparent',
                    color: '#C4B5FD',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(196, 181, 253, 0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <WandSparkles size={16} color="#C4B5FD" style={{ flexShrink: 0 }} />
                  {isExpanded && <span>Draft with AI</span>}
                </button>
              )}

              {/* Blueprints Library */}
              {onOpenBlueprints && (
                <button
                  type="button"
                  onClick={onOpenBlueprints}
                  aria-label="Blueprints Library"
                  title="Blueprints Library"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    height: '40px',
                    padding: isExpanded ? '0 10px' : '0 12px',
                    justifyContent: isExpanded ? 'flex-start' : 'center',
                    borderRadius: '8px',
                    backgroundColor: 'transparent',
                    border: '1px solid transparent',
                    color: '#F472B6',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(244, 114, 182, 0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <Sparkles size={16} color="#F472B6" style={{ flexShrink: 0 }} />
                  {isExpanded && <span>Blueprints</span>}
                </button>
              )}
            </div>

            <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

            {/* Growth & Diagnostics Tools */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {isExpanded && (
                <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', padding: '0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Diagnostics
                </span>
              )}

              {/* Check Design / Audit Button */}
              <button
                type="button"
                onClick={onOpenAudit}
                aria-label={`Audit drawer: ${designCount} open ${designCount === 1 ? 'issue' : 'issues'}`}
                title={`Audit drawer: ${designCount} open ${designCount === 1 ? 'issue' : 'issues'}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  height: '40px',
                  padding: isExpanded ? '0 10px' : '0 12px',
                  justifyContent: isExpanded ? 'flex-start' : 'center',
                  borderRadius: '8px',
                  backgroundColor: designCount > 0 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                  border: designCount > 0 ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)',
                  color: designCount > 0 ? '#FBBF24' : '#34D399',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {designCount > 0 ? (
                  <AlertTriangle size={16} color="#FBBF24" style={{ flexShrink: 0 }} />
                ) : (
                  <CheckCircle2 size={16} color="#34D399" style={{ flexShrink: 0 }} />
                )}
                {isExpanded && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                    <span>Audit</span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: '9999px',
                        backgroundColor: designCount > 0 ? '#F59E0B' : '#10B981',
                        color: '#FFFFFF'
                      }}
                    >
                      {designCount > 0 ? designCount : 'OK'}
                    </span>
                  </div>
                )}
              </button>

              {/* ROAS Forecaster */}
              {onOpenSimulator && (
                <button
                  type="button"
                  onClick={onOpenSimulator}
                  aria-label="ROAS Forecaster"
                  title="ROAS Forecaster"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    height: '40px',
                    padding: isExpanded ? '0 10px' : '0 12px',
                    justifyContent: isExpanded ? 'flex-start' : 'center',
                    borderRadius: '8px',
                    backgroundColor: 'transparent',
                    border: '1px solid transparent',
                    color: '#34D399',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(52, 211, 153, 0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <TrendingUp size={16} color="#34D399" style={{ flexShrink: 0 }} />
                  {isExpanded && <span>Forecaster</span>}
                </button>
              )}

              {/* Shopify Sync */}
              {onOpenShopifySync && (
                <button
                  type="button"
                  onClick={onOpenShopifySync}
                  aria-label="Shopify Sync"
                  title="Shopify Sync"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    height: '40px',
                    padding: isExpanded ? '0 10px' : '0 12px',
                    justifyContent: isExpanded ? 'flex-start' : 'center',
                    borderRadius: '8px',
                    backgroundColor: 'transparent',
                    border: '1px solid transparent',
                    color: '#38BDF8',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <Zap size={16} color="#38BDF8" style={{ flexShrink: 0 }} />
                  {isExpanded && <span>Shopify Sync</span>}
                </button>
              )}

              {/* Export Assets */}
              {onExportAssets && (
                <button
                  type="button"
                  onClick={onExportAssets}
                  aria-label="Export Assets"
                  title="Export Assets"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    height: '40px',
                    padding: isExpanded ? '0 10px' : '0 12px',
                    justifyContent: isExpanded ? 'flex-start' : 'center',
                    borderRadius: '8px',
                    backgroundColor: 'transparent',
                    border: '1px solid transparent',
                    color: '#818CF8',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(129, 140, 248, 0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <Download size={16} color="#818CF8" style={{ flexShrink: 0 }} />
                  {isExpanded && <span>Export Assets</span>}
                </button>
              )}
            </div>
          </div>

          {/* Bottom Section: Account / Operator / Plan */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 10px 14px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
            {user ? (
              <div ref={accountMenuRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setShowAccountMenu(!showAccountMenu)}
                  aria-haspopup="menu"
                  aria-expanded={showAccountMenu}
                  aria-label="Account Settings"
                  title={`Account: ${user.email}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    height: '42px',
                    padding: isExpanded ? '0 8px' : '0 11px',
                    justifyContent: isExpanded ? 'flex-start' : 'center',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#FFFFFF',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      backgroundColor: isOp ? '#047857' : '#4F46E5',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                      flexShrink: 0
                    }}
                  >
                    {user.email ? user.email[0].toUpperCase() : 'U'}
                  </div>
                  {isExpanded && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', overflow: 'hidden', minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#F8FAFC', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                        {user.displayName || user.email?.split('@')[0]}
                      </span>
                      <span style={{ fontSize: '10px', color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                        {user.email}
                      </span>
                    </div>
                  )}
                </button>

                {/* Account Flyout */}
                {showAccountMenu && (
                  <div
                    className="glass-dropdown"
                    style={{
                      position: 'absolute',
                      bottom: '48px',
                      left: 0,
                      width: '220px',
                      borderRadius: '10px',
                      padding: '6px',
                      zIndex: 70,
                      boxShadow: '0 12px 30px rgba(0, 0, 0, 0.6)'
                    }}
                  >
                    <div style={{ padding: '6px 8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', marginBottom: '4px' }}>
                      <div style={{ fontSize: '11px', color: '#94A3B8' }}>Signed in as</div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {user.email}
                      </div>
                    </div>

                    {isOp && onOpenAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAccountMenu(false);
                          onOpenAdmin();
                        }}
                        style={{
                          width: '100%',
                          padding: '7px 8px',
                          borderRadius: '6px',
                          background: 'none',
                          border: 'none',
                          color: '#34D399',
                          fontSize: '12px',
                          fontWeight: 700,
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                      >
                        <Shield size={14} />
                        <span>Operator Admin</span>
                      </button>
                    )}

                    {onOpenBilling && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAccountMenu(false);
                          onOpenBilling();
                        }}
                        style={{
                          width: '100%',
                          padding: '7px 8px',
                          borderRadius: '6px',
                          background: 'none',
                          border: 'none',
                          color: '#A5B4FC',
                          fontSize: '12px',
                          fontWeight: 600,
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                      >
                        <CreditCard size={14} />
                        <span>Subscription Plan</span>
                      </button>
                    )}

                    {onSignOut && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAccountMenu(false);
                          onSignOut();
                        }}
                        style={{
                          width: '100%',
                          padding: '7px 8px',
                          borderRadius: '6px',
                          background: 'none',
                          border: 'none',
                          color: '#F87171',
                          fontSize: '12px',
                          fontWeight: 500,
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                      >
                        <LogOut size={14} />
                        <span>Sign Out</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={onOpenAuth}
                aria-label="Sign In"
                title="Sign In to Jourvance"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  height: '40px',
                  padding: isExpanded ? '0 10px' : '0 12px',
                  justifyContent: isExpanded ? 'flex-start' : 'center',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <User size={16} />
                {isExpanded && <span>Sign In</span>}
              </button>
            )}
          </div>
        </aside>
      </div>
    </>
  );
};
