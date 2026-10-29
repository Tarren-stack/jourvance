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
  ChevronRight,
  Pin,
  PinOff,
  Rocket,
  BookmarkPlus
} from 'lucide-react';
import type { ActiveAppView, NodeType } from '../../types/journey';
import { ACTION_LABEL, STEP_TYPES, VIEW_LABEL, checkDesignName } from '../../lib/studioLabels';

const SIDEBAR_PIN_KEY = 'jourvance_sidebar_pinned';

interface Props {
  activeView: ActiveAppView;
  onSelectView: (view: ActiveAppView) => void;
  // Creation. Shown only on Funnel Canvas.
  onAddNode: (type: NodeType) => void;
  onOpenAiBuilder?: () => void;
  onOpenBlueprints?: () => void;
  onSaveBlueprint?: () => void;
  // Diagnostics. Shown only on Funnel Canvas.
  onOpenAudit: () => void;
  designCount?: number;
  storeScore?: number | null;
  onOpenLaunchPlaybook?: () => void;
  launchCompleted?: number;
  launchTotal?: number;
  onOpenSimulator?: () => void;
  onOpenShopifySync?: () => void;
  onExportAssets?: () => void;
  // Mobile drawer control
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

function readPinned(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_PIN_KEY) !== '0';
  } catch {
    return true;
  }
}

function writePinned(pinned: boolean) {
  try {
    localStorage.setItem(SIDEBAR_PIN_KEY, pinned ? '1' : '0');
  } catch {
    // Private mode keeps the choice for this visit only.
  }
}

const itemStyle = (expanded: boolean, extra: React.CSSProperties = {}): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  width: '100%',
  height: '40px',
  padding: expanded ? '0 10px' : '0 12px',
  justifyContent: expanded ? 'flex-start' : 'center',
  borderRadius: '8px',
  backgroundColor: 'transparent',
  border: '1px solid transparent',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  textAlign: 'left',
  ...extra
});

export const AppSidebar: React.FC<Props> = ({
  activeView,
  onSelectView,
  onAddNode,
  onOpenAiBuilder,
  onOpenBlueprints,
  onSaveBlueprint,
  onOpenAudit,
  designCount = 0,
  onOpenLaunchPlaybook,
  launchCompleted = 0,
  launchTotal = 5,
  onOpenSimulator,
  onOpenShopifySync,
  onExportAssets,
  mobileOpen = false,
  onCloseMobile
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(readPinned);
  const [showAddFlyout, setShowAddFlyout] = useState(false);
  const addFlyoutRef = useRef<HTMLDivElement>(null);

  // The drawer is a narrow overlay on a phone. Opening it must show the words, not icons.
  const isExpanded = mobileOpen || isPinned || isHovered;
  const onCanvas = activeView === 'canvas';
  const designName = checkDesignName(designCount);
  const playbookName = `Launch playbook: ${launchCompleted} of ${launchTotal} completed`;

  const setPinned = (next: boolean) => {
    setIsPinned(next);
    writePinned(next);
  };

  useEffect(() => {
    if (!showAddFlyout) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowAddFlyout(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAddFlyout]);

  useEffect(() => {
    if (!showAddFlyout) return;
    const onClick = (e: MouseEvent) => {
      if (addFlyoutRef.current && !addFlyoutRef.current.contains(e.target as Node)) {
        setShowAddFlyout(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showAddFlyout]);

  const go = (view: ActiveAppView) => {
    onSelectView(view);
    onCloseMobile?.();
  };

  return (
    <>
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

      <div
        className={`jv-sidebar-container ${mobileOpen ? 'jv-sidebar-mobile-open' : ''}`}
        style={{
          width: isExpanded ? '240px' : '64px',
          transition: 'width 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        <aside
          aria-label="Main Navigation"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className="jv-sidebar"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: isExpanded ? '240px' : '64px',
            pointerEvents: 'auto',
            backgroundColor: 'rgba(11, 15, 25, 0.96)',
            borderRight: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            transition: 'width 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
            overflowX: 'hidden',
            overflowY: 'auto'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 10px 8px' }}>
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
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#F472B6', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      Studio
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setPinned(!isPinned)}
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

            <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {isExpanded && (
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', padding: '0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Views
                </span>
              )}

              <button
                type="button"
                onClick={() => go('canvas')}
                aria-pressed={activeView === 'canvas'}
                aria-label={VIEW_LABEL.canvas}
                title={VIEW_LABEL.canvas}
                style={itemStyle(isExpanded, {
                  backgroundColor: activeView === 'canvas' ? 'rgba(236, 72, 153, 0.18)' : 'transparent',
                  border: activeView === 'canvas' ? '1px solid rgba(236, 72, 153, 0.35)' : '1px solid transparent',
                  color: activeView === 'canvas' ? '#FFFFFF' : '#94A3B8',
                  fontWeight: activeView === 'canvas' ? 700 : 500
                })}
              >
                <GitFork size={16} color={activeView === 'canvas' ? '#EC4899' : '#94A3B8'} style={{ flexShrink: 0 }} />
                {isExpanded && <span>{VIEW_LABEL.canvas}</span>}
              </button>

              <button
                type="button"
                onClick={() => go('email-studio')}
                aria-pressed={activeView === 'email-studio'}
                aria-label={VIEW_LABEL['email-studio']}
                title={VIEW_LABEL['email-studio']}
                style={itemStyle(isExpanded, {
                  backgroundColor: activeView === 'email-studio' ? 'rgba(236, 72, 153, 0.18)' : 'transparent',
                  border: activeView === 'email-studio' ? '1px solid rgba(236, 72, 153, 0.35)' : '1px solid transparent',
                  color: activeView === 'email-studio' ? '#FFFFFF' : '#94A3B8',
                  fontWeight: activeView === 'email-studio' ? 700 : 500
                })}
              >
                <Mail size={16} color={activeView === 'email-studio' ? '#EC4899' : '#94A3B8'} style={{ flexShrink: 0 }} />
                {isExpanded && <span>{VIEW_LABEL['email-studio']}</span>}
              </button>

              <button
                type="button"
                onClick={() => go('attribution')}
                aria-pressed={activeView === 'attribution'}
                aria-label={VIEW_LABEL.attribution}
                title={VIEW_LABEL.attribution}
                style={itemStyle(isExpanded, {
                  backgroundColor: activeView === 'attribution' ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
                  border: activeView === 'attribution' ? '1px solid rgba(99, 102, 241, 0.35)' : '1px solid transparent',
                  color: activeView === 'attribution' ? '#FFFFFF' : '#94A3B8',
                  fontWeight: activeView === 'attribution' ? 700 : 500
                })}
              >
                <BarChart3 size={16} color={activeView === 'attribution' ? '#818CF8' : '#94A3B8'} style={{ flexShrink: 0 }} />
                {isExpanded && <span>{VIEW_LABEL.attribution}</span>}
              </button>
            </div>

            {onCanvas && (
              <>
                <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {isExpanded && (
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', padding: '0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Creation
                    </span>
                  )}

                  <div ref={addFlyoutRef} style={{ position: 'relative' }}>
                    <button
                      type="button"
                      onClick={() => setShowAddFlyout(!showAddFlyout)}
                      aria-haspopup="menu"
                      aria-expanded={showAddFlyout}
                      aria-label={ACTION_LABEL.addStep}
                      title={ACTION_LABEL.addStep}
                      style={itemStyle(isExpanded, {
                        backgroundColor: showAddFlyout ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        color: '#F8FAFC'
                      })}
                    >
                      <Plus size={16} color="#38BDF8" style={{ flexShrink: 0 }} />
                      {isExpanded && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                          <span>{ACTION_LABEL.addStep}</span>
                          <ChevronRight size={13} color="#94A3B8" />
                        </div>
                      )}
                    </button>

                    {showAddFlyout && (
                      <div
                        role="menu"
                        aria-label="Step Palette"
                        className="glass-dropdown"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: isExpanded ? '236px' : '68px',
                          width: '280px',
                          borderRadius: '10px',
                          padding: '6px',
                          zIndex: 70,
                          boxShadow: '0 12px 30px rgba(0, 0, 0, 0.6)'
                        }}
                      >
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', padding: '4px 8px 6px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', marginBottom: '4px' }}>
                          Choose Step Type
                        </div>
                        {STEP_TYPES.map(step => (
                          <button
                            key={step.type}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              onAddNode(step.type);
                              setShowAddFlyout(false);
                              onCloseMobile?.();
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
                              alignItems: 'flex-start',
                              gap: '8px'
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: step.dotColor, flexShrink: 0, marginTop: '4px' }} />
                            <span style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
                              <span>{step.label}</span>
                              <span style={{ fontSize: '11px', fontWeight: 500, color: '#94A3B8' }}>{step.description}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {onOpenAiBuilder && (
                    <button
                      type="button"
                      onClick={onOpenAiBuilder}
                      data-ai-builder-trigger
                      aria-label="Draft with AI"
                      title="Draft with AI"
                      style={itemStyle(isExpanded, { color: '#C4B5FD' })}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(196, 181, 253, 0.1)')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <WandSparkles size={16} color="#C4B5FD" style={{ flexShrink: 0 }} />
                      {isExpanded && <span>Draft with AI</span>}
                    </button>
                  )}

                  {onOpenBlueprints && (
                    <button
                      type="button"
                      onClick={onOpenBlueprints}
                      data-blueprints-trigger
                      aria-label="Blueprints"
                      title="Blueprints"
                      style={itemStyle(isExpanded, { color: '#F472B6' })}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(244, 114, 182, 0.1)')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <Sparkles size={16} color="#F472B6" style={{ flexShrink: 0 }} />
                      {isExpanded && <span>Blueprints</span>}
                    </button>
                  )}

                  {onSaveBlueprint && (
                    <button
                      type="button"
                      onClick={onSaveBlueprint}
                      data-save-blueprint-trigger
                      aria-label={ACTION_LABEL.saveBlueprint}
                      title={ACTION_LABEL.saveBlueprint}
                      style={itemStyle(isExpanded, { color: '#F9A8D4' })}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(244, 114, 182, 0.1)')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <BookmarkPlus size={16} color="#F9A8D4" style={{ flexShrink: 0 }} />
                      {isExpanded && <span>{ACTION_LABEL.saveBlueprint}</span>}
                    </button>
                  )}
                </div>

                <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {isExpanded && (
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', padding: '0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Diagnostics
                    </span>
                  )}

                  {onOpenLaunchPlaybook && (
                    <button
                      type="button"
                      onClick={onOpenLaunchPlaybook}
                      aria-label={playbookName}
                      title={playbookName}
                      style={itemStyle(isExpanded, {
                        backgroundColor: launchCompleted === launchTotal ? 'rgba(16, 185, 129, 0.12)' : 'rgba(236, 72, 153, 0.12)',
                        border: launchCompleted === launchTotal ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(236, 72, 153, 0.3)',
                        color: launchCompleted === launchTotal ? '#34D399' : '#F472B6'
                      })}
                    >
                      <Rocket size={16} color={launchCompleted === launchTotal ? '#34D399' : '#F472B6'} style={{ flexShrink: 0 }} />
                      {isExpanded && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                          <span>{ACTION_LABEL.launchPlaybook}</span>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: '9999px',
                              backgroundColor: launchCompleted === launchTotal ? '#34D399' : '#BE185D',
                              color: launchCompleted === launchTotal ? '#0B0F19' : '#FFFFFF'
                            }}
                          >
                            {launchCompleted === launchTotal ? 'Ready' : `${launchCompleted}/${launchTotal}`}
                          </span>
                        </div>
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onOpenAudit}
                    aria-label={designName}
                    title={designName}
                    style={itemStyle(isExpanded, {
                      backgroundColor: designCount > 0 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                      border: designCount > 0 ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)',
                      color: designCount > 0 ? '#FBBF24' : '#34D399'
                    })}
                  >
                    {designCount > 0 ? (
                      <AlertTriangle size={16} color="#FBBF24" style={{ flexShrink: 0 }} />
                    ) : (
                      <CheckCircle2 size={16} color="#34D399" style={{ flexShrink: 0 }} />
                    )}
                    {isExpanded && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                        <span>{ACTION_LABEL.checkDesign}</span>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: '9999px',
                            backgroundColor: designCount > 0 ? '#F59E0B' : '#34D399',
                            color: '#0B0F19'
                          }}
                        >
                          {designCount > 0 ? designCount : 'Passed'}
                        </span>
                      </div>
                    )}
                  </button>
                </div>

                {(onOpenSimulator || onOpenShopifySync || onExportAssets) && (
                  <>
                    <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {isExpanded && (
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', padding: '0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Tools
                        </span>
                      )}

                      {onOpenSimulator && (
                        <button
                          type="button"
                          onClick={onOpenSimulator}
                          aria-label={ACTION_LABEL.adReturn}
                          title={ACTION_LABEL.adReturn}
                          style={itemStyle(isExpanded, { color: '#34D399' })}
                          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(52, 211, 153, 0.1)')}
                          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <TrendingUp size={16} color="#34D399" style={{ flexShrink: 0 }} />
                          {isExpanded && <span>{ACTION_LABEL.adReturn}</span>}
                        </button>
                      )}

                      {onOpenShopifySync && (
                        <button
                          type="button"
                          onClick={onOpenShopifySync}
                          data-shopify-sync-trigger
                          aria-label="Shopify Sync"
                          title="Shopify Sync"
                          style={itemStyle(isExpanded, { color: '#38BDF8' })}
                          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.1)')}
                          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <Zap size={16} color="#38BDF8" style={{ flexShrink: 0 }} />
                          {isExpanded && <span>Shopify Sync</span>}
                        </button>
                      )}

                      {onExportAssets && (
                        <button
                          type="button"
                          onClick={onExportAssets}
                          data-export-trigger
                          aria-label="Export Assets"
                          title="Export Assets"
                          style={itemStyle(isExpanded, { color: '#818CF8' })}
                          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(129, 140, 248, 0.1)')}
                          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <Download size={16} color="#818CF8" style={{ flexShrink: 0 }} />
                          {isExpanded && <span>Export Assets</span>}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  );
};
