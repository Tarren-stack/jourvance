import React, { useState } from 'react';
import { Play, Save, CheckCircle2, Sparkles, Plus, Share2, Compass, Layers, Globe, Download, Mail, GitFork, TrendingUp, DollarSign, Zap, BarChart3, Circle, ChevronDown, ArrowRight, ExternalLink, BookmarkPlus } from 'lucide-react';
import type { JourneyProject, Workspace, CanvasViewMode, NodeType, ActiveAppView } from '../../types/journey';
import { WorkspaceSelector } from './WorkspaceSelector';

interface Props {
  project: JourneyProject;
  onUpdateProjectName: (name: string) => void;
  onSave: () => void;
  onTestJourney: () => void;
  onExportAssets?: () => void;
  onAddNode: (type: NodeType) => void;
  onOpenWebsite?: () => void;
  user?: any;
  onOpenAuth?: () => void;
  onOpenBilling?: () => void;
  onOpenAdmin?: () => void;
  onSignOut?: () => void;
  saving: boolean;
  savedRecently: boolean;
  onPublishFunnel?: () => void;
  publishing?: boolean;
  // Workspace & Shopify additions
  workspaces?: Workspace[];
  currentWorkspace?: Workspace | null;
  onSelectWorkspace?: (ws: Workspace) => void;
  onOpenShopifyConnect?: () => void;
  onCreateWorkspace?: () => void;
  activeView?: ActiveAppView;
  onSelectView?: (view: ActiveAppView) => void;
  onOpenBlueprints?: () => void;
  onSaveBlueprint?: () => void;
  canvasViewMode?: CanvasViewMode;
  onToggleCanvasViewMode?: (mode: CanvasViewMode) => void;
  showRetentionBranches?: boolean;
  onToggleRetentionBranches?: () => void;
  onOpenShopifySync?: () => void;
  onOpenSimulator?: () => void;
  onSelectNode?: (nodeId: string) => void;
}

export const CanvasHeader: React.FC<Props> = ({
  project,
  onUpdateProjectName,
  onSave,
  onTestJourney,
  onExportAssets,
  onAddNode,
  onOpenWebsite,
  user,
  onOpenAuth,
  onOpenBilling,
  onOpenAdmin,
  onSignOut,
  saving,
  savedRecently,
  onPublishFunnel,
  publishing = false,
  workspaces = [],
  currentWorkspace = null,
  onSelectWorkspace,
  onOpenShopifyConnect,
  onCreateWorkspace,
  activeView = 'canvas',
  onSelectView,
  onOpenBlueprints,
  onSaveBlueprint,
  canvasViewMode = 'edit',
  onToggleCanvasViewMode,
  showRetentionBranches = true,
  onToggleRetentionBranches,
  onOpenShopifySync,
  onOpenSimulator,
  onSelectNode
}) => {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const isOp = user?.email?.toLowerCase() === 'tlm@tarrenmunoz.com';

  // First-Run Launch Readiness evaluation
  const landingPageNode = project.nodes.find(n => n.type === 'landing-page');
  const lpData = (landingPageNode?.data as any) || {};

  const isOfferDone = Boolean(
    (project.offerHeadline && project.offerHeadline !== 'Your offer' && project.offerHeadline.trim().length > 3) ||
    (lpData.headline && lpData.headline !== 'Your offer headline' && lpData.headline.trim().length > 3)
  );

  const isStoreDone = Boolean(
    currentWorkspace?.shopifyConfig?.shopName ||
    currentWorkspace?.shopifyConfig?.storeDomain ||
    project.shopifyStoreDomain ||
    lpData.shopifyProductId ||
    lpData.checkoutUrl
  );

  const isPublishDone = Boolean(
    project.nodes.some(n => n.type === 'landing-page' && (n.data as any)?.published)
  );

  const completedCount = (isOfferDone ? 1 : 0) + (isStoreDone ? 1 : 0) + (isPublishDone ? 1 : 0);
  const isAllDone = completedCount === 3;

  // Compute total pipeline conversions
  const adNode = project.nodes.find(n => n.type === 'ad-source')?.data as any;
  const formNode = project.nodes.find(n => n.type === 'lead-form')?.data as any;
  const totalLeads = formNode?.submissions || 0;
  const totalClicks = adNode?.clicks || 0;
  const overallRate = totalClicks > 0 ? ((totalLeads / totalClicks) * 100).toFixed(1) : '0.0';

  // Financial & ROAS calculations (Wave 3)
  const adNodes = project.nodes.filter(n => n.type === 'ad-source');
  const pageNodes = project.nodes.filter(n => n.type === 'landing-page');

  let totalSpend = 0;
  for (const n of adNodes) {
    totalSpend += (n.data as any)?.spend || 0;
  }

  let totalConversions = 0;
  let totalGrossRevenue = 0;
  let totalBumpRevenue = 0;
  let totalBumpTakes = 0;

  for (const n of pageNodes) {
    const d = n.data as any;
    const conv = d?.conversions || 0;
    const bumpTakes = d?.orderBumpTakes || 0;
    const bumpRev = d?.orderBumpRevenue || 0;
    const gross = d?.grossRevenue || d?.liveRevenue || 0;

    totalConversions += conv;
    totalGrossRevenue += gross;
    totalBumpRevenue += bumpRev;
    totalBumpTakes += bumpTakes;
  }

  const blendedRoas = totalSpend > 0 ? (totalGrossRevenue / totalSpend).toFixed(1) : '—';
  const blendedAov = totalConversions > 0 ? Math.round(totalGrossRevenue / totalConversions) : 0;
  const bumpTakeRate = totalConversions > 0 ? Math.round((totalBumpTakes / totalConversions) * 100) : 0;

  return (
    <header
      style={{
        height: '60px',
        padding: '0 20px',
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 20
      }}
    >
      {/* Left: Brand, Workspace & Journey Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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

        <div style={{ width: '1px', height: '24px', background: 'rgba(255, 255, 255, 0.1)' }} />

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

        <div style={{ width: '1px', height: '24px', background: 'rgba(255, 255, 255, 0.1)' }} />

        {/* Editable Name */}
        <input
          type="text"
          value={project.name}
          onChange={e => onUpdateProjectName(e.target.value)}
          aria-label="Journey Name"
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: '#F1F5F9',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            width: '200px',
            padding: '4px 6px',
            borderRadius: '6px'
          }}
          onFocus={e => (e.target.style.background = 'rgba(255, 255, 255, 0.05)')}
          onBlur={e => (e.target.style.background = 'transparent')}
        />
      </div>

      {/* Center: View Switcher (Canvas vs Email Studio) & Telemetry */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        {onSelectView && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'rgba(0, 0, 0, 0.4)',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <button
              onClick={() => onSelectView('canvas')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: activeView === 'canvas' ? '#ec4899' : 'transparent',
                color: activeView === 'canvas' ? '#ffffff' : '#9ca3af',
                transition: 'all 0.15s ease'
              }}
            >
              <GitFork size={13} />
              <span>Funnel Canvas</span>
            </button>

            <button
              onClick={() => onSelectView('email-studio')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: activeView === 'email-studio' ? '#ec4899' : 'transparent',
                color: activeView === 'email-studio' ? '#ffffff' : '#9ca3af',
                transition: 'all 0.15s ease'
              }}
            >
              <Mail size={13} />
              <span>Email Studio</span>
            </button>

            <button
              onClick={() => onSelectView('attribution')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: activeView === 'attribution' ? '#6366f1' : 'transparent',
                color: activeView === 'attribution' ? '#ffffff' : '#9ca3af',
                transition: 'all 0.15s ease'
              }}
            >
              <BarChart3 size={13} />
              <span>Attribution</span>
            </button>
          </div>
        )}

        {/* ROAS & Financials Canvas Mode Toggle */}
        {activeView === 'canvas' && onToggleCanvasViewMode && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'rgba(0, 0, 0, 0.4)',
              borderRadius: '8px',
              padding: '2px',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <button
              type="button"
              onClick={() => onToggleCanvasViewMode('edit')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: canvasViewMode === 'edit' ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                color: canvasViewMode === 'edit' ? '#FFFFFF' : '#94A3B8',
                transition: 'all 0.15s ease'
              }}
            >
              <Layers size={12} />
              <span>Edit Canvas</span>
            </button>

            <button
              type="button"
              onClick={() => onToggleCanvasViewMode('roas')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: canvasViewMode === 'roas' ? '#059669' : 'transparent',
                color: canvasViewMode === 'roas' ? '#FFFFFF' : '#94A3B8',
                boxShadow: canvasViewMode === 'roas' ? '0 2px 8px rgba(16, 185, 129, 0.4)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <TrendingUp size={12} />
              <span>Live ROAS</span>
            </button>
          </div>
        )}

        {/* Phase 3: Visual Retention Flow Canvas Filter Toggle */}
        {onToggleRetentionBranches && (
          <button
            type="button"
            onClick={onToggleRetentionBranches}
            title={showRetentionBranches ? 'Hide courtesy rescue and retention flows from canvas' : 'Show courtesy rescue and retention flows on canvas'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 600,
              border: showRetentionBranches ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid rgba(255, 255, 255, 0.12)',
              cursor: 'pointer',
              backgroundColor: showRetentionBranches ? 'rgba(245, 158, 11, 0.15)' : 'rgba(0, 0, 0, 0.25)',
              color: showRetentionBranches ? '#FBBF24' : '#94A3B8',
              boxShadow: showRetentionBranches ? '0 0 10px rgba(245, 158, 11, 0.2)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <Sparkles size={12} color={showRetentionBranches ? '#FBBF24' : '#64748B'} />
            <span>{showRetentionBranches ? 'Retention: On' : 'Retention: Off'}</span>
          </button>
        )}

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '10px', textTransform: 'uppercase', color: '#94A3B8', fontWeight: 600 }}>Spend:</span>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#F1F5F9' }}>${totalSpend}</span>
            </div>
            <span style={{ color: '#475569' }}>·</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '10px', textTransform: 'uppercase', color: '#94A3B8', fontWeight: 600 }}>Gross:</span>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#34D399' }}>${totalGrossRevenue.toLocaleString()}</span>
            </div>
            <span style={{ color: '#475569' }}>·</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '10px', textTransform: 'uppercase', color: '#94A3B8', fontWeight: 600 }}>Bump:</span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#F472B6' }}>+${totalBumpRevenue} ({bumpTakeRate}%)</span>
            </div>
            <span style={{ color: '#475569' }}>·</span>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                borderRadius: '6px',
                backgroundColor: 'rgba(16, 185, 129, 0.25)',
                color: '#34D399',
                fontWeight: 800,
                fontSize: '11px'
              }}
            >
              <span>{blendedRoas === '—' ? 'ROAS —' : `${blendedRoas}x ROAS`}</span>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: '#94A3B8' }}>Leads:</span>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#38BDF8' }}>{totalLeads}</span>
            </div>
            <span style={{ color: '#475569' }}>·</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: '#94A3B8' }}>Conversion:</span>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#34D399' }}>{overallRate}%</span>
            </div>
          </div>
        )}

        {/* First-Run Launch Readiness Checklist */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setShowChecklist(!showChecklist)}
            aria-label="Launch Readiness Checklist"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '9999px',
              background: isAllDone
                ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.18), rgba(5, 150, 105, 0.12))'
                : 'linear-gradient(135deg, rgba(236, 72, 153, 0.15), rgba(139, 92, 246, 0.12))',
              border: isAllDone
                ? '1px solid rgba(16, 185, 129, 0.35)'
                : '1px solid rgba(236, 72, 153, 0.3)',
              color: isAllDone ? '#34D399' : '#F472B6',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: isAllDone
                ? '0 2px 8px rgba(16, 185, 129, 0.15)'
                : '0 2px 8px rgba(236, 72, 153, 0.15)',
              transition: 'all 0.15s ease'
            }}
          >
            {isAllDone ? (
              <CheckCircle2 size={13} color="#34D399" />
            ) : (
              <Sparkles size={13} color="#F472B6" />
            )}
            <span>{isAllDone ? 'Funnel Live' : `Launch: ${completedCount}/3 Ready`}</span>
            <ChevronDown size={11} style={{ transform: showChecklist ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
          </button>

          {showChecklist && (
            <>
              <div
                onClick={() => setShowChecklist(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 45 }}
              />
              <div
                className="glass-dropdown"
                style={{
                  position: 'absolute',
                  top: '38px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '330px',
                  background: 'rgba(15, 23, 42, 0.98)',
                  backdropFilter: 'blur(20px)',
                  borderRadius: '14px',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  boxShadow: '0 16px 36px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(236, 72, 153, 0.15)',
                  padding: '16px',
                  zIndex: 50
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
                      Launch Readiness
                    </div>
                    <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                      Essential steps before driving traffic
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      background: isAllDone ? 'rgba(16, 185, 129, 0.2)' : 'rgba(236, 72, 153, 0.2)',
                      color: isAllDone ? '#34D399' : '#F472B6',
                      border: isAllDone ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(236, 72, 153, 0.3)'
                    }}
                  >
                    {completedCount} of 3 Ready
                  </span>
                </div>

                {/* Progress bar */}
                <div style={{ width: '100%', height: '4px', backgroundColor: 'rgba(255, 255, 255, 0.08)', borderRadius: '2px', overflow: 'hidden', marginBottom: '14px' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${(completedCount / 3) * 100}%`,
                      background: 'linear-gradient(90deg, #EC4899, #10B981)',
                      borderRadius: '2px',
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>

                {/* Checklist Steps */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* Step 1: Define Offer */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: isOfferDone ? 'rgba(16, 185, 129, 0.06)' : 'rgba(255, 255, 255, 0.03)',
                      border: isOfferDone ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(255, 255, 255, 0.06)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      {isOfferDone ? (
                        <CheckCircle2 size={15} color="#10B981" style={{ marginTop: '2px', flexShrink: 0 }} />
                      ) : (
                        <Circle size={15} color="#64748B" style={{ marginTop: '2px', flexShrink: 0 }} />
                      )}
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#F1F5F9' }}>
                          1. Define your offer
                        </div>
                        <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '2px' }}>
                          Set your headline, hero shot, and offer pricing
                        </div>
                      </div>
                    </div>
                    {isOfferDone ? (
                      <span style={{ fontSize: '10px', fontWeight: 700, color: '#10B981' }}>Done</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (landingPageNode && onSelectNode) onSelectNode(landingPageNode.id);
                          setShowChecklist(false);
                        }}
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: '#EC4899',
                          background: 'rgba(236, 72, 153, 0.12)',
                          border: '1px solid rgba(236, 72, 153, 0.25)',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        <span>Edit Offer</span>
                        <ArrowRight size={10} />
                      </button>
                    )}
                  </div>

                  {/* Step 2: Connect Store */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: isStoreDone ? 'rgba(16, 185, 129, 0.06)' : 'rgba(255, 255, 255, 0.03)',
                      border: isStoreDone ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(255, 255, 255, 0.06)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      {isStoreDone ? (
                        <CheckCircle2 size={15} color="#10B981" style={{ marginTop: '2px', flexShrink: 0 }} />
                      ) : (
                        <Circle size={15} color="#64748B" style={{ marginTop: '2px', flexShrink: 0 }} />
                      )}
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#F1F5F9' }}>
                          2. Connect your store
                        </div>
                        <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '2px' }}>
                          Link Shopify products for 1-click checkout
                        </div>
                      </div>
                    </div>
                    {isStoreDone ? (
                      <span style={{ fontSize: '10px', fontWeight: 700, color: '#10B981' }}>Connected</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onOpenShopifyConnect?.();
                          setShowChecklist(false);
                        }}
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: '#38BDF8',
                          background: 'rgba(56, 189, 248, 0.12)',
                          border: '1px solid rgba(56, 189, 248, 0.25)',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        <span>Connect</span>
                        <ArrowRight size={10} />
                      </button>
                    )}
                  </div>

                  {/* Step 3: Publish Funnel */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: isPublishDone ? 'rgba(16, 185, 129, 0.06)' : 'rgba(255, 255, 255, 0.03)',
                      border: isPublishDone ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(255, 255, 255, 0.06)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      {isPublishDone ? (
                        <CheckCircle2 size={15} color="#10B981" style={{ marginTop: '2px', flexShrink: 0 }} />
                      ) : (
                        <Circle size={15} color="#64748B" style={{ marginTop: '2px', flexShrink: 0 }} />
                      )}
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#F1F5F9' }}>
                          3. Publish to live domain
                        </div>
                        <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '2px' }}>
                          Push landing page live with global edge hosting
                        </div>
                      </div>
                    </div>
                    {isPublishDone ? (
                      <span style={{ fontSize: '10px', fontWeight: 700, color: '#10B981' }}>Live</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onPublishFunnel?.();
                          setShowChecklist(false);
                        }}
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: '#A855F7',
                          background: 'rgba(168, 85, 247, 0.12)',
                          border: '1px solid rgba(168, 85, 247, 0.25)',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        <span>Publish</span>
                        <ArrowRight size={10} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Footer advice / status */}
                <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  {isAllDone ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '11px', color: '#34D399', fontWeight: 600 }}>
                        All 3 steps complete. Ready for customers.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onTestJourney();
                          setShowChecklist(false);
                        }}
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: '#38BDF8',
                          background: 'rgba(56, 189, 248, 0.12)',
                          border: '1px solid rgba(56, 189, 248, 0.25)',
                          borderRadius: '6px',
                          padding: '3px 8px',
                          cursor: 'pointer'
                        }}
                      >
                        Test Flow
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '10px', color: '#94A3B8' }}>
                        Need inspiration?
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenBlueprints?.();
                          setShowChecklist(false);
                        }}
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: '#F472B6',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          textDecoration: 'underline'
                        }}
                      >
                        Browse Journey Blueprints
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right: Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Switch to Public Website */}
        {onOpenWebsite && (
          <button
            onClick={onOpenWebsite}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 12px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#CBD5E1',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)')}
          >
            <Globe size={13} color="#818CF8" />
            <span>Public Website</span>
          </button>
        )}

        {/* Blueprints / Templates Button */}
        {onOpenBlueprints && (
          <button
            onClick={onOpenBlueprints}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 12px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.15), rgba(139, 92, 246, 0.15))',
              border: '1px solid rgba(236, 72, 153, 0.35)',
              color: '#F472B6',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'linear-gradient(135deg, rgba(236, 72, 153, 0.25), rgba(139, 92, 246, 0.25))')}
            onMouseLeave={e => (e.currentTarget.style.background = 'linear-gradient(135deg, rgba(236, 72, 153, 0.15), rgba(139, 92, 246, 0.15))')}
          >
            <Sparkles size={13} color="#F472B6" />
            <span>Blueprints</span>
          </button>
        )}

        {/* Save as Custom Blueprint Button */}
        {onSaveBlueprint && (
          <button
            onClick={onSaveBlueprint}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 12px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#E2E8F0',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            title="Save current journey canvas as a reusable team blueprint"
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(236, 72, 153, 0.15)';
              e.currentTarget.style.borderColor = 'rgba(236, 72, 153, 0.35)';
              e.currentTarget.style.color = '#F472B6';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
              e.currentTarget.style.color = '#E2E8F0';
            }}
          >
            <BookmarkPlus size={13} color="#F472B6" />
            <span>Save as Blueprint</span>
          </button>
        )}

        {/* Shopify Live Attribution & Sync Modal */}
        {onOpenShopifySync && (
          <button
            onClick={onOpenShopifySync}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 12px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15))',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              color: '#34D399',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            title="Shopify orders, webhooks, and discount codes"
            onMouseEnter={e => (e.currentTarget.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(59, 130, 246, 0.25))')}
            onMouseLeave={e => (e.currentTarget.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(59, 130, 246, 0.15))')}
          >
            <Zap size={13} color="#34D399" />
            <span>Shopify Sync</span>
          </button>
        )}

        {/* ROAS Forecaster & Financial Simulator (Wave 10) */}
        {onOpenSimulator && (
          <button
            onClick={onOpenSimulator}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 12px',
              borderRadius: '8px',
              background: project.forecast
                ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(20, 184, 166, 0.2))'
                : 'rgba(255, 255, 255, 0.05)',
              border: project.forecast
                ? '1px solid rgba(16, 185, 129, 0.45)'
                : '1px solid rgba(255, 255, 255, 0.12)',
              color: project.forecast ? '#34D399' : '#CBD5E1',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            title="Interactive Funnel Financial Simulator & ROAS Forecaster"
            onMouseEnter={e => (e.currentTarget.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(20, 184, 166, 0.25))')}
            onMouseLeave={e => (e.currentTarget.style.background = project.forecast ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(20, 184, 166, 0.2))' : 'rgba(255, 255, 255, 0.05)')}
          >
            <TrendingUp size={13} color={project.forecast ? '#34D399' : '#10B981'} />
            <span>ROAS Forecaster</span>
            {project.forecast && (
              <span style={{ fontSize: '10px', background: 'rgba(16, 185, 129, 0.25)', color: '#34D399', padding: '1px 5px', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.4)' }}>
                Target {(project.forecast.corePrice / Math.max(0.1, project.forecast.cpc)).toFixed(1)}x
              </span>
            )}
          </button>
        )}

        {/* Add Step Dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
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
              cursor: 'pointer'
            }}
          >
            <Plus size={14} />
            <span>Add Step</span>
          </button>

          {showAddMenu && (
            <div
              className="glass-dropdown"
              style={{
                position: 'absolute',
                top: '42px',
                right: 0,
                width: '210px',
                borderRadius: '10px',
                padding: '6px',
                zIndex: 30
              }}
            >
              <button
                onClick={() => { onAddNode('ad-source'); setShowAddMenu(false); }}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', background: 'transparent', border: 'none', color: '#E2E8F0', fontSize: '12px', fontWeight: 500, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3B82F6' }} />
                <span>+ Ad Source (Traffic)</span>
              </button>
              <button
                onClick={() => { onAddNode('landing-page'); setShowAddMenu(false); }}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', background: 'transparent', border: 'none', color: '#E2E8F0', fontSize: '12px', fontWeight: 500, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6366F1' }} />
                <span>+ Landing Page</span>
              </button>
              <button
                onClick={() => { onAddNode('ab-split'); setShowAddMenu(false); }}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', background: 'transparent', border: 'none', color: '#E2E8F0', fontSize: '12px', fontWeight: 500, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#8B5CF6' }} />
                <span>+ A/B Traffic Splitter</span>
              </button>
              <button
                onClick={() => { onAddNode('lead-form'); setShowAddMenu(false); }}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', background: 'transparent', border: 'none', color: '#E2E8F0', fontSize: '12px', fontWeight: 500, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981' }} />
                <span>+ Lead Capture Form</span>
              </button>
              <button
                onClick={() => { onAddNode('follow-up-sequence'); setShowAddMenu(false); }}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', background: 'transparent', border: 'none', color: '#E2E8F0', fontSize: '12px', fontWeight: 500, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#F59E0B' }} />
                <span>+ Follow-Up Sequence</span>
              </button>
              <button
                onClick={() => { onAddNode('thank-you'); setShowAddMenu(false); }}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', background: 'transparent', border: 'none', color: '#E2E8F0', fontSize: '12px', fontWeight: 500, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#EC4899' }} />
                <span>+ VIP Thank-You Portal</span>
              </button>
              <button
                onClick={() => { onAddNode('upsell'); setShowAddMenu(false); }}
                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', background: 'transparent', border: 'none', color: '#E2E8F0', fontSize: '12px', fontWeight: 500, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981' }} />
                <span>+ Post-Purchase Upsell (OTO)</span>
              </button>
            </div>
          )}
        </div>

        {/* Test Funnel Simulation Button */}
        <button
          onClick={onTestJourney}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 14px',
            borderRadius: '8px',
            background: 'rgba(56, 189, 248, 0.15)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            color: '#38BDF8',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          <Play size={13} fill="#38BDF8" />
          <span>Test Lead Flow</span>
        </button>

        {/* Export Assets Button */}
        {onExportAssets && (
          <button
            onClick={onExportAssets}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#F1F5F9',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)')}
          >
            <Download size={13} color="#818CF8" />
            <span>Export Assets</span>
          </button>
        )}

        {/* Save Canvas Button */}
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 14px',
            borderRadius: '8px',
            background: savedRecently ? '#10B981' : 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#FFFFFF',
            fontSize: '12px',
            fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          {savedRecently ? (
            <>
              <CheckCircle2 size={14} />
              <span>Saved!</span>
            </>
          ) : (
            <>
              <Save size={14} />
              <span>{saving ? 'Saving…' : 'Save'}</span>
            </>
          )}
        </button>

        {/* Publish Funnel Button */}
        {onPublishFunnel && (
          <button
            onClick={onPublishFunnel}
            disabled={publishing}
            style={{
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
              cursor: publishing ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 15px rgba(236, 72, 153, 0.4)',
              transition: 'all 0.2s ease'
            }}
          >
            <Globe size={14} />
            <span>{publishing ? 'Publishing…' : 'Publish Funnel'}</span>
          </button>
        )}

        {/* User Account / Sign In */}
        {user ? (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
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
                  backgroundColor: isOp ? '#10B981' : '#6366F1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
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
                  <div style={{ fontSize: '10px', color: '#94A3B8' }}>Account</div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#FFFFFF', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user.email}
                  </div>
                </div>

                {isOp && (
                  <button
                    onClick={() => { setShowUserMenu(false); onOpenAdmin?.(); }}
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
                  onClick={() => { setShowUserMenu(false); onOpenBilling?.(); }}
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
        )}
      </div>
    </header>
  );
};
