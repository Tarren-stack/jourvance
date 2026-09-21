import React, { useState } from 'react';
import { Play, Save, CheckCircle2, Sparkles, Plus, Share2, Compass, Layers, Globe, Download } from 'lucide-react';
import type { JourneyProject } from '../../types/journey';

interface Props {
  project: JourneyProject;
  onUpdateProjectName: (name: string) => void;
  onSave: () => void;
  onTestJourney: () => void;
  onExportAssets?: () => void;
  onAddNode: (type: 'ad-source' | 'landing-page' | 'lead-form' | 'follow-up-sequence') => void;
  onOpenWebsite?: () => void;
  user?: any;
  onOpenAuth?: () => void;
  onOpenBilling?: () => void;
  onOpenAdmin?: () => void;
  onSignOut?: () => void;
  saving: boolean;
  savedRecently: boolean;
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
  savedRecently
}) => {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const isOp = user?.email?.toLowerCase() === 'tlm@tarrenmunoz.com';

  // Compute total pipeline conversions
  const adNode = project.nodes.find(n => n.type === 'ad-source')?.data as any;
  const formNode = project.nodes.find(n => n.type === 'lead-form')?.data as any;
  const totalLeads = formNode?.submissions || 0;
  const totalClicks = adNode?.clicks || 1;
  const overallRate = totalClicks > 0 ? ((totalLeads / totalClicks) * 100).toFixed(1) : '0.0';

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
      {/* Left: Brand & Journey Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #3B82F6, #6366F1, #8B5CF6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 10px rgba(99, 102, 241, 0.4)'
            }}
          >
            <Compass size={18} color="#FFFFFF" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '-0.02em', color: '#FFFFFF' }}>
                Jourvance
              </span>
              <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(99, 102, 241, 0.2)', color: '#A5B4FC', fontWeight: 700, fontFamily: 'monospace' }}>
                jourvance.com
              </span>
            </div>
          </div>
        </div>

        <div style={{ width: '1px', height: '24px', background: 'rgba(255, 255, 255, 0.1)' }} />

        {/* Editable Name */}
        <input
          type="text"
          value={project.name}
          onChange={e => onUpdateProjectName(e.target.value)}
          aria-label="Journey Name"
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: '#F1F5F9',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            width: '280px',
            padding: '4px 6px',
            borderRadius: '6px'
          }}
          onFocus={e => (e.target.style.background = 'rgba(255, 255, 255, 0.05)')}
          onBlur={e => (e.target.style.background = 'transparent')}
        />
      </div>

      {/* Center: Live Pipeline Telemetry Summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            borderRadius: '9999px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: '#94A3B8' }}>Pipeline Leads:</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#38BDF8' }}>{totalLeads}</span>
          </div>
          <span style={{ color: '#475569' }}>·</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: '#94A3B8' }}>Overall Conversion:</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#34D399' }}>{overallRate}%</span>
          </div>
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

        {/* Save & Deploy Button */}
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 16px',
            borderRadius: '8px',
            background: savedRecently ? '#10B981' : '#6366F1',
            border: 'none',
            color: '#FFFFFF',
            fontSize: '12px',
            fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s ease'
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
              <span>{saving ? 'Saving…' : 'Save & Publish'}</span>
            </>
          )}
        </button>

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
