import React, { useState } from 'react';
import { X, BookmarkPlus, CheckCircle2, Sparkles, Copy, Share2 } from 'lucide-react';
import type { JourneyNode, JourneyEdge, CustomBlueprint } from '../../types/journey';
import { saveCustomBlueprint } from '../../lib/templateClient';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  currentJourneyName?: string;
  onBlueprintSaved?: (blueprint: CustomBlueprint) => void;
}

export const SaveBlueprintModal: React.FC<Props> = ({
  isOpen,
  onClose,
  nodes,
  edges,
  currentJourneyName = 'My Funnel',
  onBlueprintSaved
}) => {
  const [name, setName] = useState(currentJourneyName || 'My Signature Journey');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<'ecom' | 'high-ticket' | 'digital-product' | 'lead-gen' | 'custom'>('ecom');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedBlueprint, setSavedBlueprint] = useState<CustomBlueprint | null>(null);
  const [copiedShareLink, setCopiedShareLink] = useState(false);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a title for your blueprint.');
      return;
    }

    setSaving(true);
    setError(null);

    const result = await saveCustomBlueprint({
      name: name.trim(),
      description: description.trim(),
      category,
      nodes,
      edges
    });

    setSaving(false);
    if (!result.success || !result.template) {
      setError(result.error || 'Failed saving blueprint.');
      return;
    }

    setSavedBlueprint(result.template);
    if (onBlueprintSaved) {
      onBlueprintSaved(result.template);
    }
  };

  const shareUrl = savedBlueprint?.shareCode
    ? `${window.location.origin}/?import_blueprint=${savedBlueprint.shareCode}`
    : '';

  const handleCopyShareLink = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopiedShareLink(true);
    setTimeout(() => setCopiedShareLink(false), 2500);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          backgroundColor: '#0F172A',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(255, 255, 255, 0.02)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'rgba(236, 72, 153, 0.15)',
                border: '1px solid rgba(236, 72, 153, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#F472B6'
              }}
            >
              <BookmarkPlus size={16} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#FFFFFF' }}>
                Save Canvas as Blueprint
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#94A3B8' }}>
                Snapshot this funnel layout into your private blueprint library.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94A3B8',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '22px' }}>
          {savedBlueprint ? (
            /* Success State with Share Link */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'center', padding: '10px 0' }}>
              <div
                style={{
                  width: '54px',
                  height: '54px',
                  borderRadius: '50%',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1.5px solid #10B981',
                  color: '#10B981',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto'
                }}
              >
                <CheckCircle2 size={28} />
              </div>
              <div>
                <h4 style={{ margin: '0 0 6px', fontSize: '17px', fontWeight: 800, color: '#FFFFFF' }}>
                  Blueprint Saved to Your Account
                </h4>
                <p style={{ margin: 0, fontSize: '12px', color: '#94A3B8', lineHeight: '1.5' }}>
                  <strong>{savedBlueprint.name}</strong> is now saved in your private blueprint library and accessible across all your stores.
                </p>
              </div>

              {/* Share Box */}
              <div
                style={{
                  padding: '14px',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  textAlign: 'left'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: '#38BDF8' }}>
                  <Share2 size={13} />
                  <span>Share This Blueprint With Team or Clients</span>
                </div>
                <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                  Anyone with this link can clone your sanitized funnel structure directly into their Jourvance canvas:
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#FFFFFF',
                      fontSize: '11px',
                      fontFamily: 'monospace'
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCopyShareLink}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '6px',
                      background: copiedShareLink ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                      border: copiedShareLink ? '1px solid #10B981' : '1px solid #38BDF8',
                      color: copiedShareLink ? '#10B981' : '#38BDF8',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Copy size={12} />
                    <span>{copiedShareLink ? 'Copied!' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                style={{
                  width: '100%',
                  marginTop: '6px',
                  padding: '11px',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #EC4899, #DB2777)',
                  color: '#FFFFFF',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Done
              </button>
            </div>
          ) : (
            /* Creation Form */
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {error && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#F87171',
                    fontSize: '12px'
                  }}
                >
                  {error}
                </div>
              )}

              {/* Node Summary Pill */}
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '11px',
                  color: '#94A3B8'
                }}
              >
                <span>Snapshot Details:</span>
                <span style={{ color: '#F1F5F9', fontWeight: 600 }}>
                  {nodes.length} Steps • {edges.length} Transitions
                </span>
              </div>

              {/* Title */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#CBD5E1', marginBottom: '6px' }}>
                  Blueprint Title <span style={{ color: '#F472B6' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Signature D2C Product Drop with OTO Upsell"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#FFFFFF',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Category */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#CBD5E1', marginBottom: '6px' }}>
                  Funnel Model Category
                </label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value as any)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: '#1E293B',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#FFFFFF',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                >
                  <option value="ecom">Physical E-Commerce & Retail</option>
                  <option value="high-ticket">High-Ticket Consulting & Calls</option>
                  <option value="digital-product">Digital Products, SaaS & Downloads</option>
                  <option value="lead-gen">VIP Lead Magnet & Nurture</option>
                  <option value="custom">General Custom Funnel</option>
                </select>
              </div>

              {/* Description */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#CBD5E1', marginBottom: '6px' }}>
                  Strategy Notes / Description
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. High-velocity product drop funnel using Meta hook, 1-click checkout with a pre-selected $16 order bump, and automated 3-day onboarding sequence."
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    lineHeight: '1.4',
                    outline: 'none',
                    resize: 'vertical'
                  }}
                />
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: '9px 16px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'transparent',
                    color: '#94A3B8',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: '9px 20px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #EC4899, #DB2777)',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <BookmarkPlus size={14} />
                  <span>{saving ? 'Saving...' : 'Save Blueprint'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
