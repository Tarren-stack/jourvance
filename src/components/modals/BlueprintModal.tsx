import React, { useState, useEffect } from 'react';
import { X, Sparkles, ShoppingBag, ArrowRight, Zap, CheckCircle2, Copy, Layers, ExternalLink } from 'lucide-react';
import { ECOM_BLUEPRINTS, type EcomBlueprint } from '../../data/ecomBlueprints';
import type { Workspace, ShopifyProduct, JourneyNode, JourneyEdge } from '../../types/journey';
import { fetchShopifyProducts } from '../../lib/shopifyClient';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onLoadBlueprint: (preparedBlueprint: {
    name: string;
    nodes: JourneyNode[];
    edges: JourneyEdge[];
  }, mode: 'replace' | 'new') => void;
  workspace?: Workspace | null;
  currentJourneyName?: string;
}

export const BlueprintModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onLoadBlueprint,
  workspace,
  currentJourneyName = 'Current Canvas'
}) => {
  const [selectedBlueprint, setSelectedBlueprint] = useState<EcomBlueprint | null>(null);
  const [showConfirmPrompt, setShowConfirmPrompt] = useState(false);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  useEffect(() => {
    if (!isOpen || !workspace) return;
    let cancelled = false;
    setLoadingProducts(true);
    fetchShopifyProducts(workspace.id)
      .then(res => {
        if (!cancelled && res.products) {
          setProducts(res.products);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingProducts(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, workspace?.id]);

  if (!isOpen) return null;

  const storeConnected = workspace?.shopifyConfig?.status === 'connected' && !!workspace?.shopifyConfig?.storeDomain;
  const storeDomain = workspace?.shopifyConfig?.storeDomain || 'demo.myshopify.com';

  const prepareBlueprintWithAutoLink = (blueprint: EcomBlueprint) => {
    // Clone nodes and edges
    const clonedNodes: JourneyNode[] = JSON.parse(JSON.stringify(blueprint.nodes));
    const clonedEdges: JourneyEdge[] = JSON.parse(JSON.stringify(blueprint.edges));

    // If real connected products exist, auto-link them per user directive
    if (products.length > 0) {
      const primaryProduct = products[0];
      const primaryVariant = primaryProduct.variants?.[0];
      const secondaryProduct = products.length > 1 ? products[1] : products[0];
      const secondaryVariant = secondaryProduct.variants?.[0];

      for (const node of clonedNodes) {
        if (node.type === 'landing-page' && node.data) {
          const d = node.data as any;
          // Auto-link primary product
          d.shopifyProductId = primaryProduct.id;
          d.shopifyVariantId = primaryVariant?.id || '42109840192';
          d.shopifyProductTitle = primaryProduct.title;
          d.shopifyProductPrice = primaryVariant?.price || primaryProduct.price;
          if (primaryProduct.imageUrl) {
            d.shopifyProductImage = primaryProduct.imageUrl;
            d.heroImageUrl = primaryProduct.imageUrl;
          }
          if (d.headline && !d.headline.includes('Awaken') && !d.headline.includes('Radiance')) {
            d.headline = primaryProduct.title;
          }

          // If blueprint has order bump enabled, auto-link secondary product
          if (d.orderBumpEnabled && secondaryProduct) {
            d.orderBumpProductId = secondaryProduct.id;
            d.orderBumpVariantId = secondaryVariant?.id || '42109840194';
            d.orderBumpTitle = secondaryProduct.title;
            d.orderBumpPrice = secondaryVariant?.price || secondaryProduct.price;
            if (secondaryProduct.imageUrl) {
              d.orderBumpImage = secondaryProduct.imageUrl;
            }
            d.orderBumpHeadline = `One-Time VIP Add-on: ${secondaryProduct.title}`;
          }
        }
      }
    }

    return {
      name: `${blueprint.title}`,
      nodes: clonedNodes,
      edges: clonedEdges
    };
  };

  const handleSelectBlueprint = (bp: EcomBlueprint) => {
    setSelectedBlueprint(bp);
    setShowConfirmPrompt(true);
  };

  const handleConfirmLoad = (mode: 'replace' | 'new') => {
    if (!selectedBlueprint) return;
    const prepared = prepareBlueprintWithAutoLink(selectedBlueprint);
    onLoadBlueprint(prepared, mode);
    setShowConfirmPrompt(false);
    setSelectedBlueprint(null);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: '20px'
      }}
      onClick={e => {
        if (e.target === e.currentTarget && !showConfirmPrompt) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '880px',
          maxHeight: '90vh',
          backgroundColor: '#0F172A',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(to right, rgba(236, 72, 153, 0.08), rgba(139, 92, 246, 0.08))'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #ec4899, #8B5CF6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(236, 72, 153, 0.4)'
              }}
            >
              <Sparkles size={20} color="#FFFFFF" />
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                E-Commerce Funnel Blueprints
              </h2>
              <p style={{ fontSize: '12px', color: '#94A3B8', margin: '2px 0 0 0' }}>
                Pre-built full journey architectures optimized for high AOV, instant Shopify checkout, and email flows.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94A3B8',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Store Auto-Link Banner */}
        <div
          style={{
            padding: '10px 24px',
            backgroundColor: storeConnected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(56, 189, 248, 0.1)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShoppingBag size={15} style={{ color: storeConnected ? '#10b981' : '#38bdf8' }} />
            <span style={{ color: '#E2E8F0' }}>
              {storeConnected ? (
                <>
                  Connected Store: <strong style={{ color: '#34d399' }}>{storeDomain}</strong> • Products will automatically link to your live catalog.
                </>
              ) : (
                <>
                  Catalog Mode: <span style={{ color: '#94a3b8' }}>Using demo beauty catalog</span> (Connect your Shopify store anytime in the toolbar).
                </>
              )}
            </span>
          </div>
          {products.length > 0 && (
            <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 700, backgroundColor: 'rgba(16, 185, 129, 0.2)', padding: '2px 8px', borderRadius: '9999px' }}>
              ✓ {products.length} Products Synced
            </span>
          )}
        </div>

        {/* Blueprint Cards Grid */}
        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {ECOM_BLUEPRINTS.map(bp => {
            const isAov = bp.category === 'aov-booster';
            const isLead = bp.category === 'lead-magnet';
            const badgeColor = isAov ? '#a855f7' : isLead ? '#ec4899' : '#10b981';

            return (
              <div
                key={bp.id}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '12px',
                  padding: '18px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '20px',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                  e.currentTarget.style.borderColor = badgeColor;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                }}
                onClick={() => handleSelectBlueprint(bp)}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: badgeColor,
                        backgroundColor: `${badgeColor}22`,
                        padding: '3px 8px',
                        borderRadius: '6px',
                        border: `1px solid ${badgeColor}44`
                      }}
                    >
                      {bp.badge}
                    </span>
                    <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>
                      • {bp.expectedAovLift}
                    </span>
                  </div>

                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#FFFFFF', margin: '0 0 4px 0' }}>
                    {bp.title}
                  </h3>
                  <div style={{ fontSize: '12px', color: '#F472B6', fontWeight: 600, marginBottom: '6px' }}>
                    {bp.tagline}
                  </div>
                  <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0, lineHeight: 1.5, maxWidth: '580px' }}>
                    {bp.description}
                  </p>

                  {/* Funnel Pipeline Steps Preview */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
                    {bp.nodes.map((node, i) => (
                      <React.Fragment key={node.id}>
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '3px 8px',
                            borderRadius: '5px',
                            backgroundColor: 'rgba(0, 0, 0, 0.4)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: '#CBD5E1',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <span
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              backgroundColor: node.type === 'ad-source' ? '#3B82F6' : node.type === 'landing-page' ? '#EC4899' : '#F59E0B'
                            }}
                          />
                          {node.data?.label || node.type}
                        </span>
                        {i < bp.nodes.length - 1 && (
                          <span style={{ color: '#64748B', fontSize: '10px' }}>&rarr;</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    handleSelectBlueprint(bp);
                  }}
                  style={{
                    padding: '10px 16px',
                    borderRadius: '8px',
                    background: `linear-gradient(135deg, ${badgeColor}, #db2777)`,
                    color: '#FFFFFF',
                    fontSize: '12px',
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    whiteSpace: 'nowrap',
                    boxShadow: `0 4px 12px ${badgeColor}33`
                  }}
                >
                  <span>Select Blueprint</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Confirmation Prompt Modal (Replace vs New Journey) */}
        {showConfirmPrompt && selectedBlueprint && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              backdropFilter: 'blur(12px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              zIndex: 110
            }}
          >
            <div
              style={{
                maxWidth: '480px',
                width: '100%',
                backgroundColor: '#1E293B',
                borderRadius: '14px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                padding: '24px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.6)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Sparkles size={18} style={{ color: '#ec4899' }} />
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                  Load &ldquo;{selectedBlueprint.title}&rdquo;
                </h3>
              </div>

              <p style={{ fontSize: '13px', color: '#94A3B8', lineHeight: 1.5, margin: '0 0 16px 0' }}>
                How would you like to load this blueprint into your workspace?
              </p>

              {products.length > 0 && (
                <div
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    marginBottom: '16px',
                    fontSize: '11px',
                    color: '#34d399',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <CheckCircle2 size={14} />
                  <span>
                    <strong>Auto-Linking Enabled:</strong> Will connect to &ldquo;{products[0].title}&rdquo;{selectedBlueprint.category === 'aov-booster' && products.length > 1 ? ` and &ldquo;${products[1].title}&rdquo; as bump offer` : ''}.
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Option 1: Replace Current Canvas */}
                <button
                  type="button"
                  onClick={() => handleConfirmLoad('replace')}
                  style={{
                    padding: '12px 16px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(236, 72, 153, 0.15)',
                    border: '1px solid rgba(236, 72, 153, 0.4)',
                    color: '#FFFFFF',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(236, 72, 153, 0.25)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'rgba(236, 72, 153, 0.15)')}
                >
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#f472b6', marginBottom: '2px' }}>
                    1. Replace Current Canvas
                  </div>
                  <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                    Overwrites the active journey with this blueprint layout and auto-links your store products.
                  </div>
                </button>

                {/* Option 2: Create as New Journey */}
                <button
                  type="button"
                  onClick={() => handleConfirmLoad('new')}
                  style={{
                    padding: '12px 16px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                    color: '#FFFFFF',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.22)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'rgba(56, 189, 248, 0.12)')}
                >
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#38bdf8', marginBottom: '2px' }}>
                    2. Create as New Journey
                  </div>
                  <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                    Preserves your current canvas and starts a new journey project in workspace &ldquo;{workspace?.name || 'Default'}&rdquo;.
                  </div>
                </button>
              </div>

              <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowConfirmPrompt(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94A3B8',
                    fontSize: '12px',
                    cursor: 'pointer',
                    padding: '6px 12px'
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
