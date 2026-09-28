import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  ShoppingBag,
  ArrowRight,
  Zap,
  CheckCircle2,
  Copy,
  Layers,
  ExternalLink,
  Share2,
  Trash2,
  Download,
  Check,
  BookmarkPlus,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { ECOM_BLUEPRINTS, type EcomBlueprint } from '../../data/ecomBlueprints';
import type { Workspace, ShopifyProduct, JourneyNode, JourneyEdge, CustomBlueprint } from '../../types/journey';
import { fetchShopifyProducts } from '../../lib/shopifyClient';
import { zeroBlueprintMetrics } from '../../lib/liveStats';
import {
  fetchCustomBlueprints,
  deleteCustomBlueprint,
  fetchSharedBlueprint,
  importSharedBlueprint
} from '../../lib/templateClient';

type TabType = 'turnkey' | 'custom' | 'import';

interface GenericBlueprintSelection {
  id: string;
  title: string;
  category?: string;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  isCustom?: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onLoadBlueprint: (
    preparedBlueprint: {
      name: string;
      nodes: JourneyNode[];
      edges: JourneyEdge[];
    },
    mode: 'replace' | 'new'
  ) => void;
  workspace?: Workspace | null;
  currentJourneyName?: string;
  initialTab?: TabType;
  initialImportCode?: string;
}

export const BlueprintModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onLoadBlueprint,
  workspace,
  currentJourneyName = 'Current Canvas',
  initialTab = 'turnkey',
  initialImportCode = ''
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [selectedBlueprint, setSelectedBlueprint] = useState<GenericBlueprintSelection | null>(null);
  const [showConfirmPrompt, setShowConfirmPrompt] = useState(false);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // Custom Blueprints State
  const [customBlueprints, setCustomBlueprints] = useState<CustomBlueprint[]>([]);
  const [loadingCustom, setLoadingCustom] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null);

  // Import State
  const [importCodeInput, setImportCodeInput] = useState(initialImportCode);
  const [inspectingImport, setInspectingImport] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [inspectedBlueprint, setInspectedBlueprint] = useState<CustomBlueprint | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // Load Shopify Products when modal opens
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
    return () => {
      cancelled = true;
    };
  }, [isOpen, workspace?.id]);

  // Load Custom Blueprints when modal opens or user switches to custom tab
  useEffect(() => {
    if (!isOpen) return;
    if (initialTab) setActiveTab(initialTab);
    if (initialImportCode) {
      setImportCodeInput(initialImportCode);
      setActiveTab('import');
      handleInspectCode(initialImportCode);
    }
    loadCustomList();
  }, [isOpen, initialTab, initialImportCode]);

  const loadCustomList = async () => {
    setLoadingCustom(true);
    setCustomError(null);
    try {
      const items = await fetchCustomBlueprints();
      setCustomBlueprints(items);
    } catch (err: any) {
      setCustomError('Failed loading your custom blueprints.');
    } finally {
      setLoadingCustom(false);
    }
  };

  if (!isOpen) return null;

  const storeConnected = workspace?.shopifyConfig?.status === 'connected' && !!workspace?.shopifyConfig?.storeDomain;
  const storeDomain = workspace?.shopifyConfig?.storeDomain || '';

  const prepareBlueprintWithAutoLink = (blueprint: GenericBlueprintSelection) => {
    // Deep clone nodes and edges
    const clonedNodes: JourneyNode[] = JSON.parse(JSON.stringify(blueprint.nodes));
    const clonedEdges: JourneyEdge[] = JSON.parse(JSON.stringify(blueprint.edges));
    const demoVariantIds = new Set(['42109840192', '42109840193', '42109840194', '42109840195', '42109840196', '42109840999']);

    for (const node of clonedNodes) {
      const d = node.data as any;
      if (!d) continue;
      if (typeof d.trustBadge === 'string' && /4\.9\/5|verified (beauty lovers|customers|buyers|clients)/i.test(d.trustBadge)) {
        d.trustBadge = '';
      }
      if (d.discountCode === 'VIP15') d.discountCode = '';
      if (Array.isArray(d.steps)) {
        for (const step of d.steps) {
          if (typeof step?.body === 'string' && /VIP15|15% discount code/i.test(step.body)) {
            step.body = 'Hi [First Name],\n\nThanks for signing up. The next step is here: [Checkout Link]\n\nThe Team';
          }
          if (typeof step?.subject === 'string' && /15%|VIP coupon/i.test(step.subject)) {
            step.subject = 'Your next step';
          }
        }
      }
      for (const key of ['shopifyVariantId', 'orderBumpVariantId', 'upsellVariantId']) {
        if (demoVariantIds.has(String(d[key] || ''))) d[key] = '';
      }
    }

    // Auto-link primary & secondary products if real catalog is connected
    if (products.length > 0) {
      const primaryProduct = products[0];
      const primaryVariant = primaryProduct.variants?.[0];
      const secondaryProduct = products.length > 1 ? products[1] : products[0];
      const secondaryVariant = secondaryProduct.variants?.[0];

      for (const node of clonedNodes) {
        if (node.type === 'landing-page' && node.data) {
          const d = node.data as any;
          d.shopifyProductId = primaryProduct.id;
          d.shopifyVariantId = primaryVariant?.id || '';
          d.shopifyProductTitle = primaryProduct.title;
          d.shopifyProductPrice = primaryVariant?.price || primaryProduct.price;
          if (primaryProduct.imageUrl) {
            d.shopifyProductImage = primaryProduct.imageUrl;
            d.heroImageUrl = primaryProduct.imageUrl;
          }
          if (d.headline && !d.headline.includes('Awaken') && !d.headline.includes('Radiance')) {
            d.headline = primaryProduct.title;
          }

          if (d.orderBumpEnabled && secondaryProduct) {
            d.orderBumpProductId = secondaryProduct.id;
            d.orderBumpVariantId = secondaryVariant?.id || '';
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

    const blank = zeroBlueprintMetrics(clonedNodes, clonedEdges);
    return {
      name: `${blueprint.title}`,
      nodes: blank.nodes,
      edges: blank.edges
    };
  };

  const handleSelectTurnkey = (bp: EcomBlueprint) => {
    setSelectedBlueprint({
      id: bp.id,
      title: bp.title,
      category: bp.category,
      nodes: bp.nodes,
      edges: bp.edges,
      isCustom: false
    });
    setShowConfirmPrompt(true);
  };

  const handleSelectCustom = (cb: CustomBlueprint) => {
    setSelectedBlueprint({
      id: cb.id,
      title: cb.name,
      category: cb.category,
      nodes: cb.nodes,
      edges: cb.edges,
      isCustom: true
    });
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

  const handleCopyShareLink = (bp: CustomBlueprint) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const shareUrl = `${origin}/?import_blueprint=${bp.shareCode}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopiedShareId(bp.id);
      setTimeout(() => setCopiedShareId(null), 2500);
    });
  };

  const handleDeleteCustom = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete the blueprint "${name}"? This will not affect existing journeys using it.`)) {
      return;
    }
    const ok = await deleteCustomBlueprint(id);
    if (ok) {
      setCustomBlueprints(prev => prev.filter(b => b.id !== id));
    } else {
      alert('Could not delete blueprint.');
    }
  };

  const handleInspectCode = async (codeToInspect?: string) => {
    const raw = (codeToInspect || importCodeInput).trim();
    if (!raw) return;
    setInspectingImport(true);
    setImportError(null);
    setInspectedBlueprint(null);
    setImportSuccess(null);

    const cleanCode = raw.replace(/^https?:\/\/.*[?&]import_blueprint=/, '');
    const res = await fetchSharedBlueprint(cleanCode);
    setInspectingImport(false);

    if (res.success && res.template) {
      setInspectedBlueprint(res.template);
    } else {
      setImportError(res.error || 'Blueprint not found. Verify the code or URL.');
    }
  };

  const handleExecuteImport = async (andLoad: boolean) => {
    if (!inspectedBlueprint || !inspectedBlueprint.shareCode) return;
    setImporting(true);
    setImportError(null);

    const res = await importSharedBlueprint(inspectedBlueprint.shareCode);
    setImporting(false);

    if (res.success && res.template) {
      setImportSuccess(`Imported "${res.template.name}" into your account!`);
      // Update custom list
      setCustomBlueprints(prev => [res.template!, ...prev]);

      if (andLoad) {
        // Immediately load onto canvas
        handleSelectCustom(res.template);
      } else {
        setTimeout(() => {
          setActiveTab('custom');
          setInspectedBlueprint(null);
          setImportCodeInput('');
          setImportSuccess(null);
        }, 1500);
      }
    } else {
      setImportError(res.error || 'Failed to import blueprint into your account.');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(10px)',
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
          maxWidth: '920px',
          maxHeight: '92vh',
          backgroundColor: '#0F172A',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '20px 24px 16px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(to right, rgba(236, 72, 153, 0.08), rgba(139, 92, 246, 0.08))'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #ec4899, #8B5CF6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 10px rgba(236, 72, 153, 0.4)'
              }}
            >
              <Sparkles size={20} color="#FFFFFF" />
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                Journey Blueprint Library
              </h2>
              <p style={{ fontSize: '12px', color: '#94A3B8', margin: '2px 0 0 0' }}>
                Turnkey funnel architectures & reusable custom blueprints across all your workspaces.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94A3B8',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation Ribbon */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(15, 23, 42, 0.6)'
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('turnkey')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              border: activeTab === 'turnkey' ? '1px solid rgba(236, 72, 153, 0.4)' : '1px solid transparent',
              background: activeTab === 'turnkey' ? 'rgba(236, 72, 153, 0.15)' : 'transparent',
              color: activeTab === 'turnkey' ? '#F472B6' : '#94A3B8'
            }}
          >
            <Sparkles size={14} />
            <span>Turnkey Library</span>
            <span
              style={{
                fontSize: '11px',
                padding: '1px 6px',
                borderRadius: '9999px',
                backgroundColor: activeTab === 'turnkey' ? 'rgba(236, 72, 153, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                color: activeTab === 'turnkey' ? '#FFFFFF' : '#94A3B8'
              }}
            >
              {ECOM_BLUEPRINTS.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('custom');
              loadCustomList();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              border: activeTab === 'custom' ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid transparent',
              background: activeTab === 'custom' ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
              color: activeTab === 'custom' ? '#A78BFA' : '#94A3B8'
            }}
          >
            <BookmarkPlus size={14} />
            <span>My Team Blueprints</span>
            <span
              style={{
                fontSize: '11px',
                padding: '1px 6px',
                borderRadius: '9999px',
                backgroundColor: activeTab === 'custom' ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                color: activeTab === 'custom' ? '#FFFFFF' : '#94A3B8'
              }}
            >
              {customBlueprints.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('import')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              border: activeTab === 'import' ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
              background: activeTab === 'import' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
              color: activeTab === 'import' ? '#38BDF8' : '#94A3B8'
            }}
          >
            <Download size={14} />
            <span>Import via Share Code</span>
          </button>
        </div>

        {/* Store Auto-Link Banner */}
        <div
          style={{
            padding: '9px 24px',
            backgroundColor: storeConnected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(56, 189, 248, 0.08)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShoppingBag size={14} style={{ color: storeConnected ? '#10b981' : '#38bdf8' }} />
            <span style={{ color: '#E2E8F0' }}>
              {storeConnected ? (
                <>
                  Active Store: <strong style={{ color: '#34d399' }}>{storeDomain}</strong> • Products will automatically link to your live catalog.
                </>
              ) : (
                <>
                  No Shopify catalog is loaded. Blueprints will start with clean zero-traffic layouts.
                </>
              )}
            </span>
          </div>
          {products.length > 0 && (
            <span
              style={{
                fontSize: '11px',
                color: '#10b981',
                fontWeight: 700,
                backgroundColor: 'rgba(16, 185, 129, 0.2)',
                padding: '2px 8px',
                borderRadius: '9999px'
              }}
            >
              ✓ {products.length} Products Synced
            </span>
          )}
        </div>

        {/* TAB 1: Turnkey Blueprints */}
        {activeTab === 'turnkey' && (
          <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {ECOM_BLUEPRINTS.map(bp => {
              const isAov = bp.category === 'aov-booster';
              const isLead = bp.category === 'lead-magnet';
              const isHighTicket = bp.category === 'high-ticket';
              const isDigital = bp.category === 'digital-product';
              const isRetention = bp.category === 'retention';
              const badgeColor = isRetention ? '#F59E0B' : isAov ? '#a855f7' : isLead ? '#ec4899' : isHighTicket ? '#38bdf8' : isDigital ? '#f59e0b' : '#10b981';

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
                  onClick={() => handleSelectTurnkey(bp)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
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
                      {bp.nodes.some(n => (n.data as any)?.isRetentionBranch) && (
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            color: '#F59E0B',
                            backgroundColor: 'rgba(245, 158, 11, 0.15)',
                            border: '1px solid rgba(245, 158, 11, 0.35)',
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <span>✦</span> Includes 24h Rescue & Cart Recovery
                        </span>
                      )}
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

                    {/* Step Preview Pills */}
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
                                backgroundColor:
                                  node.type === 'ad-source'
                                    ? '#3B82F6'
                                    : node.type === 'landing-page'
                                    ? '#EC4899'
                                    : (node.data as any)?.isRetentionBranch
                                    ? '#F59E0B'
                                    : node.type === 'upsell'
                                    ? '#10B981'
                                    : '#8B5CF6'
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
                      handleSelectTurnkey(bp);
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
                    <span>Use Blueprint</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 2: My Team Blueprints */}
        {activeTab === 'custom' && (
          <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {loadingCustom ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: '10px', color: '#94A3B8' }}>
                <Loader2 size={20} className="animate-spin" />
                <span>Loading your team blueprints...</span>
              </div>
            ) : customError ? (
              <div style={{ padding: '16px', borderRadius: '10px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#F87171', fontSize: '13px' }}>
                {customError}
              </div>
            ) : customBlueprints.length === 0 ? (
              <div
                style={{
                  padding: '48px 24px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  border: '1px dashed rgba(255, 255, 255, 0.12)',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px'
                }}
              >
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(139, 92, 246, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#A78BFA'
                  }}
                >
                  <BookmarkPlus size={22} />
                </div>
                <div>
                  <h4 style={{ fontSize: '15px', fontWeight: 700, color: '#FFFFFF', margin: 0 }}>
                    No Custom Blueprints Saved Yet
                  </h4>
                  <p style={{ fontSize: '13px', color: '#94A3B8', margin: '6px 0 0 0', maxWidth: '460px', lineHeight: 1.5 }}>
                    Save any journey canvas as a reusable blueprint using the <strong>&ldquo;Save as Blueprint&rdquo;</strong> button in the top toolbar. It will be available across all your stores and workspaces.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('turnkey')}
                  style={{
                    marginTop: '8px',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(236, 72, 153, 0.15)',
                    border: '1px solid rgba(236, 72, 153, 0.35)',
                    color: '#F472B6',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Browse Turnkey Blueprints
                </button>
              </div>
            ) : (
              customBlueprints.map(cb => {
                const categoryLabels: Record<string, { label: string; color: string }> = {
                  ecom: { label: 'E-Commerce', color: '#10b981' },
                  'high-ticket': { label: 'High-Ticket', color: '#38bdf8' },
                  'digital-product': { label: 'Digital Product', color: '#f59e0b' },
                  'lead-gen': { label: 'Lead Generation', color: '#ec4899' },
                  custom: { label: 'Custom Architecture', color: '#8b5cf6' }
                };
                const catInfo = categoryLabels[cb.category] || categoryLabels.custom;

                return (
                  <div
                    key={cb.id}
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '12px',
                      padding: '18px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '20px',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            color: catInfo.color,
                            backgroundColor: `${catInfo.color}22`,
                            padding: '3px 8px',
                            borderRadius: '6px',
                            border: `1px solid ${catInfo.color}44`
                          }}
                        >
                          {catInfo.label}
                        </span>
                        <span style={{ fontSize: '11px', color: '#64748B' }}>
                          Saved {new Date(cb.createdAt).toLocaleDateString()}
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            fontFamily: 'monospace',
                            color: '#94A3B8',
                            backgroundColor: 'rgba(255, 255, 255, 0.06)',
                            padding: '2px 6px',
                            borderRadius: '4px'
                          }}
                        >
                          Code: {cb.shareCode}
                        </span>
                      </div>

                      <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#FFFFFF', margin: '0 0 4px 0' }}>
                        {cb.name}
                      </h3>
                      {cb.description && (
                        <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0, lineHeight: 1.5, maxWidth: '580px' }}>
                          {cb.description}
                        </p>
                      )}

                      {/* Step Pipeline Pills */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
                        {cb.nodes.map((node, i) => (
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
                                  backgroundColor:
                                    node.type === 'ad-source' ? '#3B82F6' : node.type === 'landing-page' ? '#EC4899' : '#F59E0B'
                                }}
                              />
                              {node.data?.label || node.type}
                            </span>
                            {i < cb.nodes.length - 1 && (
                              <span style={{ color: '#64748B', fontSize: '10px' }}>&rarr;</span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {/* Copy Share Link */}
                      <button
                        type="button"
                        onClick={() => handleCopyShareLink(cb)}
                        title="Copy shareable link for another user"
                        style={{
                          padding: '9px 12px',
                          borderRadius: '8px',
                          backgroundColor: copiedShareId === cb.id ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                          border: copiedShareId === cb.id ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.12)',
                          color: copiedShareId === cb.id ? '#34D399' : '#E2E8F0',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {copiedShareId === cb.id ? <Check size={14} /> : <Share2 size={14} />}
                        <span>{copiedShareId === cb.id ? 'Link Copied!' : 'Share'}</span>
                      </button>

                      {/* Use Blueprint */}
                      <button
                        type="button"
                        onClick={() => handleSelectCustom(cb)}
                        style={{
                          padding: '9px 16px',
                          borderRadius: '8px',
                          background: 'linear-gradient(135deg, #8B5CF6, #EC4899)',
                          color: '#FFFFFF',
                          fontSize: '12px',
                          fontWeight: 700,
                          border: 'none',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          whiteSpace: 'nowrap',
                          boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3)'
                        }}
                      >
                        <span>Use Blueprint</span>
                        <ArrowRight size={14} />
                      </button>

                      {/* Delete Blueprint */}
                      <button
                        type="button"
                        onClick={() => handleDeleteCustom(cb.id, cb.name)}
                        title="Delete custom blueprint"
                        style={{
                          padding: '9px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          color: '#F87171',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB 3: Import via Share Code */}
        {activeTab === 'import' && (
          <div style={{ padding: '28px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div
              style={{
                backgroundColor: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.2)',
                borderRadius: '12px',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px'
              }}
            >
              <Share2 size={20} style={{ color: '#38BDF8', marginTop: '2px', flexShrink: 0 }} />
              <div>
                <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF', margin: 0 }}>
                  Collaborate & Import Shared Blueprints
                </h4>
                <p style={{ fontSize: '12px', color: '#94A3B8', margin: '4px 0 0 0', lineHeight: 1.5 }}>
                  Did another Jourvance user or team member share a blueprint with you? Paste their share link or code below. The blueprint will be safely cloned into your private account where you can adapt and launch it.
                </p>
              </div>
            </div>

            {/* Code Input Row */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={importCodeInput}
                onChange={e => setImportCodeInput(e.target.value)}
                placeholder="Paste share code (e.g. bp_abc123) or full share link..."
                onKeyDown={e => {
                  if (e.key === 'Enter') handleInspectCode();
                }}
                style={{
                  flex: 1,
                  padding: '11px 14px',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '8px',
                  color: '#FFFFFF',
                  fontSize: '13px',
                  outline: 'none',
                  fontFamily: 'monospace'
                }}
              />
              <button
                type="button"
                onClick={() => handleInspectCode()}
                disabled={inspectingImport || !importCodeInput.trim()}
                style={{
                  padding: '11px 20px',
                  borderRadius: '8px',
                  backgroundColor: inspectingImport ? 'rgba(56, 189, 248, 0.3)' : '#0284C7',
                  border: 'none',
                  color: '#FFFFFF',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: inspectingImport || !importCodeInput.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {inspectingImport ? <Loader2 size={15} className="animate-spin" /> : <ExternalLink size={15} />}
                <span>Inspect</span>
              </button>
            </div>

            {importError && (
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#F87171',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <AlertCircle size={16} />
                <span>{importError}</span>
              </div>
            )}

            {importSuccess && (
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  color: '#34D399',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <CheckCircle2 size={16} />
                <span>{importSuccess}</span>
              </div>
            )}

            {/* Inspected Preview Card */}
            {inspectedBlueprint && (
              <div
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  borderRadius: '12px',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        color: '#38BDF8',
                        backgroundColor: 'rgba(56, 189, 248, 0.15)',
                        padding: '3px 8px',
                        borderRadius: '6px'
                      }}
                    >
                      {inspectedBlueprint.category}
                    </span>
                    <span style={{ fontSize: '11px', color: '#94A3B8' }}>
                      Shared Blueprint Found
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#64748B', fontFamily: 'monospace' }}>
                    Code: {inspectedBlueprint.shareCode}
                  </span>
                </div>

                <div>
                  <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                    {inspectedBlueprint.name}
                  </h3>
                  {inspectedBlueprint.description && (
                    <p style={{ fontSize: '13px', color: '#94A3B8', margin: '6px 0 0 0', lineHeight: 1.5 }}>
                      {inspectedBlueprint.description}
                    </p>
                  )}
                </div>

                {/* Pipeline Flow Steps */}
                <div>
                  <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '6px', fontWeight: 600 }}>
                    Funnel Architecture ({inspectedBlueprint.nodes.length} Steps):
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    {inspectedBlueprint.nodes.map((node, i) => (
                      <React.Fragment key={node.id}>
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '4px 9px',
                            borderRadius: '5px',
                            backgroundColor: 'rgba(0, 0, 0, 0.5)',
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
                              backgroundColor:
                                node.type === 'ad-source' ? '#3B82F6' : node.type === 'landing-page' ? '#EC4899' : '#F59E0B'
                            }}
                          />
                          {node.data?.label || node.type}
                        </span>
                        {i < inspectedBlueprint.nodes.length - 1 && (
                          <span style={{ color: '#64748B', fontSize: '10px' }}>&rarr;</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                  <button
                    type="button"
                    onClick={() => handleExecuteImport(false)}
                    disabled={importing}
                    style={{
                      padding: '10px 16px',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.18)',
                      color: '#FFFFFF',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: importing ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Download size={14} />
                    <span>Save to My Blueprints</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExecuteImport(true)}
                    disabled={importing}
                    style={{
                      padding: '10px 18px',
                      borderRadius: '8px',
                      background: 'linear-gradient(135deg, #0284c7, #8b5cf6)',
                      border: 'none',
                      color: '#FFFFFF',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: importing ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: '0 4px 14px rgba(2, 132, 199, 0.35)'
                    }}
                  >
                    {importing ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                    <span>Import & Load onto Canvas</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

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
                    <strong>Auto-Linking Enabled:</strong> Will connect to &ldquo;{products[0].title}&rdquo;
                    {selectedBlueprint.category === 'aov-booster' && products.length > 1
                      ? ` and &ldquo;${products[1].title}&rdquo; as bump offer`
                      : ''}
                    .
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
                    Preserves your current canvas and starts a new journey project in workspace &ldquo;
                    {workspace?.name || 'Default'}&rdquo;.
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
