import React, { useState, useEffect } from 'react';
import {
  Sparkles, RefreshCw, Plus, Trash2, Globe, ExternalLink,
  ShoppingBag, Link2, CheckCircle2, Copy, Check, Tag,
  Activity, Eye, Share2, Zap, GitFork, Clock, ShieldAlert
} from 'lucide-react';
import type { PageNodeData, PageVariantData, Workspace, ShopifyProduct } from '../../types/journey';
import { requestAICopy } from '../../lib/hubClient';
import { fetchShopifyProducts, buildCheckoutPermalink, buildMultiItemCheckoutPermalink, verifyCustomDomain } from '../../lib/shopifyClient';
import { authHeaders } from '../../lib/firebase';

interface Props {
  data: PageNodeData;
  onChange: (updated: PageNodeData) => void;
  offerHeadline: string;
  businessType: string;
  workspace?: Workspace | null;
  onOpenShopifyConnect?: () => void;
}

export const PageEditor: React.FC<Props> = ({
  data,
  onChange,
  offerHeadline,
  businessType,
  workspace,
  onOpenShopifyConnect
}) => {
  const [loadingAI, setLoadingAI] = useState(false);
  const [editorTab, setEditorTab] = useState<'settings' | 'preview'>('settings');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [syncingDisc, setSyncingDisc] = useState(false);
  const [discSyncedMsg, setDiscSyncedMsg] = useState<string | null>(null);
  const [previewBumpChecked, setPreviewBumpChecked] = useState(false);
  const [previewViewMode, setPreviewViewMode] = useState<'page' | 'modal'>('page');
  const [activeVariantTab, setActiveVariantTab] = useState<'a' | 'b'>('a');
  const [previewVariant, setPreviewVariant] = useState<'a' | 'b'>('a');

  // Custom Domain & DNS Check (Wave 3)
  const [checkingDns, setCheckingDns] = useState(false);
  const [dnsResult, setDnsResult] = useState<{ verified?: boolean; message?: string } | null>(null);

  const handleCheckDns = async () => {
    if (!data.customDomain) return;
    setCheckingDns(true);
    try {
      const res = await verifyCustomDomain(data.customDomain);
      setDnsResult({ verified: res.verified, message: res.message });
      if (res.verified) {
        handleFieldChange('customDomainVerified', true);
      }
    } finally {
      setCheckingDns(false);
    }
  };

  // Shopify Product Integration
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedLiveUrl, setCopiedLiveUrl] = useState(false);

  const livePageUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/p/${data.slug || 'offer'}`
    : `/p/${data.slug || 'offer'}`;

  const handleCopyLiveUrl = () => {
    navigator.clipboard.writeText(livePageUrl);
    setCopiedLiveUrl(true);
    setTimeout(() => setCopiedLiveUrl(false), 2000);
  };

  useEffect(() => {
    if (!workspace) return;
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
  }, [workspace?.id]);

  const selectedProduct = products.find(p => p.id === data.shopifyProductId) || null;
  const storeDomain = workspace?.shopifyConfig?.storeDomain && workspace.shopifyConfig.storeDomain !== 'demo.myshopify.com'
    ? workspace.shopifyConfig.storeDomain
    : '';
  const isStoreConnected = workspace?.shopifyConfig?.status === 'connected' && !!workspace?.shopifyConfig?.storeDomain;

  const currentCheckoutUrl = (data.orderBumpEnabled && data.orderBumpVariantId)
    ? buildMultiItemCheckoutPermalink({
        storeDomain,
        items: [
          { variantId: data.shopifyVariantId || selectedProduct?.variants?.[0]?.id },
          { variantId: data.orderBumpVariantId }
        ],
        discountCode: data.discountCode,
        utmCampaign: data.slug || 'spring-promo'
      })
    : buildCheckoutPermalink({
        storeDomain,
        variantId: data.shopifyVariantId || selectedProduct?.variants?.[0]?.id,
        discountCode: data.discountCode,
        utmCampaign: data.slug || 'spring-promo'
      });

  const handleFieldChange = (field: keyof PageNodeData, val: any) => {
    onChange({ ...data, [field]: val });
  };

  const handleSelectBumpProduct = (productId: string) => {
    const p = products.find(prod => prod.id === productId);
    if (!p) return;
    const defaultVariant = p.variants?.[0];
    onChange({
      ...data,
      orderBumpProductId: p.id,
      orderBumpTitle: p.title,
      orderBumpPrice: defaultVariant?.price || p.price,
      orderBumpImage: p.imageUrl,
      orderBumpVariantId: defaultVariant?.id,
      orderBumpHeadline: data.orderBumpHeadline || `✦ Add ${p.title} for Special Savings`,
      orderBumpDescription: data.orderBumpDescription || p.description || 'Exclusive complementary upgrade for this order.'
    });
  };

  const handleBulletChange = (idx: number, val: string) => {
    const updated = [...(data.bullets || [])];
    updated[idx] = val;
    handleFieldChange('bullets', updated);
  };

  const addBullet = () => {
    handleFieldChange('bullets', [...(data.bullets || []), 'New value point']);
  };

  const removeBullet = (idx: number) => {
    handleFieldChange('bullets', (data.bullets || []).filter((_, i) => i !== idx));
  };

  const handleSelectProduct = (productId: string) => {
    const p = products.find(prod => prod.id === productId);
    if (!p) return;
    const defaultVariant = p.variants?.[0];
    onChange({
      ...data,
      shopifyProductId: p.id,
      shopifyProductTitle: p.title,
      shopifyProductPrice: defaultVariant?.price || p.price,
      shopifyProductImage: p.imageUrl,
      shopifyVariantId: defaultVariant?.id
    });
  };

  const handleSyncProductToPage = () => {
    if (!selectedProduct) return;
    const variant = selectedProduct.variants?.[0];
    const price = variant?.price || selectedProduct.price;
    onChange({
      ...data,
      headline: selectedProduct.title,
      subhead: selectedProduct.description || data.subhead,
      heroImageUrl: selectedProduct.imageUrl || data.heroImageUrl,
      shopifyProductTitle: selectedProduct.title,
      shopifyProductPrice: price,
      shopifyVariantId: variant?.id,
      buttonText: data.checkoutMode === 'lead-gate' ? 'Claim 15% VIP Voucher' : `Buy Now — ${price}`
    });
  };

  const generateAICopy = async () => {
    setLoadingAI(true);
    try {
      const copy = await requestAICopy({
        nodeType: 'page',
        businessType: businessType || 'E-Commerce Brand',
        offerHeadline: selectedProduct?.title || data.headline || offerHeadline,
        goal: 'High-converting single-product Shopify landing page with instant checkout'
      });
      if (copy) {
        onChange({
          ...data,
          headline: copy.headline || data.headline,
          subhead: copy.subhead || data.subhead,
          buttonText: copy.cta || data.buttonText
        });
      }
    } finally {
      setLoadingAI(false);
    }
  };

  const handleVariantBFieldChange = (field: keyof PageVariantData, val: any) => {
    const currentB = data.variantB || {};
    onChange({
      ...data,
      variantB: {
        ...currentB,
        [field]: val
      }
    });
  };

  const handleCloneVariantAtoB = () => {
    onChange({
      ...data,
      variantB: {
        ...(data.variantB || {}),
        headline: data.headline,
        subhead: data.subhead,
        bullets: [...(data.bullets || [])],
        buttonText: data.buttonText,
        trustBadge: data.trustBadge,
        heroImageUrl: data.heroImageUrl
      }
    });
  };

  const generateAIChallenger = async () => {
    setLoadingAI(true);
    try {
      const copy = await requestAICopy({
        nodeType: 'page',
        businessType: businessType || 'E-Commerce Brand',
        offerHeadline: selectedProduct?.title || data.headline || offerHeadline,
        goal: 'High-converting challenger A/B split-test variation with a sharp alternative hook (clinical results or VIP exclusivity)'
      });
      if (copy) {
        onChange({
          ...data,
          variantB: {
            ...(data.variantB || {}),
            headline: copy.headline || data.headline,
            subhead: copy.subhead || data.subhead,
            buttonText: copy.cta || data.buttonText
          }
        });
      }
    } finally {
      setLoadingAI(false);
    }
  };

  const copyPermalink = () => {
    navigator.clipboard.writeText(currentCheckoutUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const isPreviewB = Boolean(data.abTestingEnabled && previewVariant === 'b' && data.variantB);
  const vB = isPreviewB ? (data.variantB || {}) : {};
  const previewHeadline = vB.headline || data.headline;
  const previewSubhead = vB.subhead || data.subhead;
  const previewBullets = (vB.bullets && vB.bullets.length) ? vB.bullets : (data.bullets || []);
  const previewButtonText = vB.buttonText || data.buttonText;
  const previewHeroImage = vB.heroImageUrl || selectedProduct?.imageUrl || data.shopifyProductImage || data.heroImageUrl;
  const previewTrustBadge = vB.trustBadge || data.trustBadge;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Tab Switcher: Settings vs Live Preview */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.35)',
          padding: '4px',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}
      >
        <button
          type="button"
          onClick={() => setEditorTab('settings')}
          style={{
            flex: 1,
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: editorTab === 'settings' ? '#ec4899' : 'transparent',
            color: editorTab === 'settings' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          Page Settings & Shopify
        </button>
        <button
          type="button"
          onClick={() => setEditorTab('preview')}
          style={{
            flex: 1,
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: editorTab === 'preview' ? '#ec4899' : 'transparent',
            color: editorTab === 'preview' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          Live Interactive Preview
        </button>
      </div>

      {editorTab === 'preview' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Device & Mode Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', flexWrap: 'wrap', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>Device:</span>
              <button
                type="button"
                onClick={() => setPreviewDevice('desktop')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  backgroundColor: previewDevice === 'desktop' ? 'rgba(236, 72, 153, 0.25)' : 'transparent',
                  color: previewDevice === 'desktop' ? '#f472b6' : '#94A3B8',
                  cursor: 'pointer'
                }}
              >
                Desktop
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice('mobile')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  backgroundColor: previewDevice === 'mobile' ? 'rgba(236, 72, 153, 0.25)' : 'transparent',
                  color: previewDevice === 'mobile' ? '#f472b6' : '#94A3B8',
                  cursor: 'pointer'
                }}
              >
                Mobile
              </button>
            </div>

            {data.abTestingEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>Variant:</span>
                <button
                  type="button"
                  onClick={() => setPreviewVariant('a')}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '5px',
                    fontSize: '11px',
                    fontWeight: 600,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    backgroundColor: previewVariant === 'a' ? 'rgba(236, 72, 153, 0.25)' : 'transparent',
                    color: previewVariant === 'a' ? '#f472b6' : '#94A3B8',
                    cursor: 'pointer'
                  }}
                >
                  Var A
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewVariant('b')}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '5px',
                    fontSize: '11px',
                    fontWeight: 600,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    backgroundColor: previewVariant === 'b' ? 'rgba(139, 92, 246, 0.25)' : 'transparent',
                    color: previewVariant === 'b' ? '#a78bfa' : '#94A3B8',
                    cursor: 'pointer'
                  }}
                >
                  Var B
                </button>
              </div>
            )}

            {data.checkoutMode === 'lead-gate' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>Screen:</span>
                <button
                  type="button"
                  onClick={() => setPreviewViewMode('page')}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '5px',
                    fontSize: '11px',
                    fontWeight: 600,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    backgroundColor: previewViewMode === 'page' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                    color: previewViewMode === 'page' ? '#38bdf8' : '#94A3B8',
                    cursor: 'pointer'
                  }}
                >
                  Page
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewViewMode('modal')}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '5px',
                    fontSize: '11px',
                    fontWeight: 600,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    backgroundColor: previewViewMode === 'modal' ? 'rgba(236, 72, 153, 0.25)' : 'transparent',
                    color: previewViewMode === 'modal' ? '#f472b6' : '#94A3B8',
                    cursor: 'pointer'
                  }}
                >
                  Lead Gate Modal
                </button>
              </div>
            )}
          </div>

          {/* Rendered Live Page Mockup */}
          <div
            style={{
              backgroundColor: '#070A12',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              overflow: 'hidden',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
              maxWidth: previewDevice === 'mobile' ? '300px' : '100%',
              margin: '0 auto',
              width: '100%'
            }}
          >
            {/* Browser chrome */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 12px',
                backgroundColor: '#1E293B',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#EF4444' }} />
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B' }} />
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981' }} />
              <span style={{ fontSize: '10px', color: '#64748B', marginLeft: '6px', fontFamily: 'monospace' }}>
                jourvance.app/p/{data.slug || 'offer'}{previewViewMode === 'modal' ? ' [2-Step Modal]' : ''}{data.abTestingEnabled ? ` [Variant ${previewVariant.toUpperCase()}]` : ''}
              </span>
            </div>

            {/* Top Announcement Bar */}
            {data.discountCode ? (
              <div style={{ background: 'linear-gradient(90deg, #ec4899, #db2777, #9333ea)', color: '#FFFFFF', fontSize: '9px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'center', padding: '4px 8px' }}>
                Code {data.discountCode} is ready at checkout
              </div>
            ) : null}

            {/* Urgency Reservation Bar */}
            {data.urgencyTimerEnabled && (
              <div style={{ background: 'linear-gradient(90deg, rgba(236, 72, 153, 0.16) 0%, rgba(147, 51, 234, 0.12) 50%, rgba(236, 72, 153, 0.16) 100%)', borderBottom: '1px solid rgba(236, 72, 153, 0.28)', padding: '5px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '10px', color: '#FCE7F3' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#F472B6', boxShadow: '0 0 6px #EC4899' }} />
                <span>{data.urgencyText || 'Cart & promotional pricing reserved for'}</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#F472B6', background: 'rgba(236, 72, 153, 0.2)', padding: '1px 5px', borderRadius: '4px' }}>
                  {data.urgencyMinutes ? `${String(data.urgencyMinutes).padStart(2, '0')}:00` : 'Set minutes'}
                </span>
              </div>
            )}

            {previewViewMode === 'modal' && data.checkoutMode === 'lead-gate' ? (
              /* Modal Mockup */
              <div style={{ padding: '20px 16px', backgroundColor: '#0B0F19', textAlign: 'center' }}>
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: '10px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: '#ec4899',
                    backgroundColor: 'rgba(236, 72, 153, 0.15)',
                    padding: '3px 8px',
                    borderRadius: '9999px',
                    marginBottom: '8px'
                  }}
                >
                  ✦ Step 2: Claim VIP Voucher
                </span>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#FFFFFF', marginBottom: '4px' }}>
                  Where should we send your {data.discountCode ? `${data.discountCode} ` : ''}code?
                </h3>
                <p style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '14px' }}>
                  Enter your email to reveal your private discount and jump straight to checkout.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                  <input
                    type="email"
                    placeholder="Enter your email address"
                    disabled
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#E2E8F0',
                      fontSize: '11px'
                    }}
                  />
                  <input
                    type="text"
                    placeholder="First Name (optional)"
                    disabled
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#E2E8F0',
                      fontSize: '11px'
                    }}
                  />
                </div>

                {/* Order Bump inside Modal Preview */}
                {data.orderBumpEnabled && (
                  <div
                    style={{
                      backgroundColor: previewBumpChecked ? 'rgba(236, 72, 153, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                      border: `1.5px solid ${previewBumpChecked ? '#ec4899' : 'rgba(255, 255, 255, 0.12)'}`,
                      borderRadius: '8px',
                      padding: '10px',
                      marginBottom: '14px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    onClick={() => setPreviewBumpChecked(!previewBumpChecked)}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <input
                        type="checkbox"
                        checked={previewBumpChecked}
                        onChange={e => setPreviewBumpChecked(e.target.checked)}
                        style={{ marginTop: '2px', accentColor: '#ec4899', cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1 }}>
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 800,
                            color: '#f472b6',
                            backgroundColor: 'rgba(236, 72, 153, 0.2)',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                          }}
                        >
                          ✦ Modal VIP Upgrade
                        </span>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#FFFFFF', marginTop: '2px' }}>
                          {data.orderBumpHeadline || 'One-Time Upgrade'}
                        </div>
                        <p style={{ fontSize: '10px', color: '#94A3B8', margin: '4px 0 6px 0', lineHeight: 1.4 }}>
                          {data.orderBumpDescription || 'Add complementary companion item to this order.'}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px' }}>
                          <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{data.orderBumpTitle || 'Complementary Add-on'}</span>
                          <span style={{ color: '#34D399', fontWeight: 700 }}>{data.orderBumpPrice || '$19.00'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(236, 72, 153, 0.35)'
                  }}
                >
                  {previewBumpChecked ? 'Claim Voucher & Upgrade Order →' : 'Claim Voucher & Checkout →'}
                </button>
              </div>
            ) : (
              /* Page Mockup */
              <div style={{ padding: previewDevice === 'mobile' ? '16px' : '24px', textAlign: 'center' }}>
                {/* Scarcity Batch Indicator */}
                {data.scarcityBatchEnabled && (data.scarcityBatchText || data.scarcityBatchCount) ? (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(236, 72, 153, 0.1)', border: '1px solid rgba(236, 72, 153, 0.28)', padding: '3px 8px', borderRadius: '9999px', fontSize: '10px', fontWeight: 700, color: '#F472B6', marginBottom: '10px' }}>
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#EC4899' }} />
                    <span>{data.scarcityBatchText || `Limited batch: ${data.scarcityBatchCount} units remaining`}</span>
                  </div>
                ) : null}

                {/* Product Hero Image */}
                {previewHeroImage && (
                  <div style={{ marginBottom: '14px', position: 'relative' }}>
                    <img
                      src={previewHeroImage}
                      alt={previewHeadline}
                      style={{
                        width: '100%',
                        maxHeight: '160px',
                        objectFit: 'cover',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.1)'
                      }}
                    />
                    {data.shopifyProductPrice && (
                      <span
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          backgroundColor: 'rgba(0, 0, 0, 0.75)',
                          backdropFilter: 'blur(4px)',
                          color: '#34d399',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          border: '1px solid rgba(16, 185, 129, 0.3)'
                        }}
                      >
                        {data.shopifyProductPrice}
                      </span>
                    )}
                  </div>
                )}

                <span
                  style={{
                    display: 'inline-block',
                    fontSize: '10px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: '#ec4899',
                    backgroundColor: 'rgba(236, 72, 153, 0.12)',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    marginBottom: '10px'
                  }}
                >
                  {data.discountCode ? `VIP Code: ${data.discountCode}` : 'Exclusive Offer'}
                </span>

                <h2
                  style={{
                    fontSize: previewDevice === 'mobile' ? '16px' : '20px',
                    fontWeight: 800,
                    color: '#FFFFFF',
                    lineHeight: 1.3,
                    marginBottom: '8px'
                  }}
                >
                  {previewHeadline || 'Your High-Converting Offer Headline'}
                </h2>
                <p
                  style={{
                    fontSize: previewDevice === 'mobile' ? '11px' : '12px',
                    color: '#94A3B8',
                    lineHeight: 1.5,
                    marginBottom: '16px'
                  }}
                >
                  {previewSubhead || 'Clear, concise subheadline addressing customer pain.'}
                </p>

                {/* Value Bullets */}
                <div
                  style={{
                    textAlign: 'left',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px'
                  }}
                >
                  {previewBullets.map((b, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#E2E8F0', marginBottom: '6px' }}>
                      <span style={{ color: '#10B981', fontWeight: 800 }}>✓</span>
                      <span>{b}</span>
                    </div>
                  ))}
                </div>

                {/* Trust Badge */}
                {previewTrustBadge && (
                  <div style={{ fontSize: '10px', color: '#94A3B8', marginBottom: '12px' }}>
                    ⭐ {previewTrustBadge}
                  </div>
                )}

                {/* Order Bump Card on Page */}
                {data.orderBumpEnabled && (
                  <div
                    style={{
                      backgroundColor: previewBumpChecked ? 'rgba(236, 72, 153, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                      border: `1.5px solid ${previewBumpChecked ? '#ec4899' : 'rgba(255, 255, 255, 0.12)'}`,
                      borderRadius: '8px',
                      padding: '10px',
                      marginBottom: '14px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    onClick={() => setPreviewBumpChecked(!previewBumpChecked)}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <input
                        type="checkbox"
                        checked={previewBumpChecked}
                        onChange={e => setPreviewBumpChecked(e.target.checked)}
                        style={{ marginTop: '2px', accentColor: '#ec4899', cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1 }}>
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 800,
                            color: '#f472b6',
                            backgroundColor: 'rgba(236, 72, 153, 0.2)',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                          }}
                        >
                          ✦ 1-Click Order Bump
                        </span>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#FFFFFF', marginTop: '2px' }}>
                          {data.orderBumpHeadline || 'One-Time Upgrade'}
                        </div>
                        <p style={{ fontSize: '10px', color: '#94A3B8', margin: '4px 0 6px 0', lineHeight: 1.4 }}>
                          {data.orderBumpDescription || 'Add complementary companion item to this order.'}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px' }}>
                          <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{data.orderBumpTitle || 'Complementary Add-on'}</span>
                          <span style={{ color: '#34D399', fontWeight: 700 }}>{data.orderBumpPrice || '$19.00'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* CTA Button */}
                <a
                  href={currentCheckoutUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '10px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    fontWeight: 700,
                    border: 'none',
                    textDecoration: 'none',
                    textAlign: 'center',
                    boxShadow: '0 4px 12px rgba(236, 72, 153, 0.35)',
                    boxSizing: 'border-box'
                  }}
                >
                  {previewBumpChecked
                    ? 'Upgrade Order & Checkout →'
                    : (previewButtonText || (data.checkoutMode === 'lead-gate' ? 'Claim VIP Voucher' : 'Buy Now — Instant Checkout'))}
                </a>

                <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '8px' }}>
                  {data.checkoutMode === 'lead-gate'
                    ? 'Triggers discount popup, then routes to Shopify'
                    : 'Routes directly to Shopify Checkout with coupon applied'}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* SECTION 1: SHOPIFY PRODUCT LINK */}
          <div
            style={{
              padding: '14px',
              borderRadius: '10px',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShoppingBag size={16} style={{ color: '#10b981' }} />
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#f3f4f6' }}>
                  Shopify Product Link
                </span>
              </div>

              {isStoreConnected ? (
                <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                  ● {storeDomain}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={onOpenShopifyConnect}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#10b981',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  Connect Store
                </button>
              )}
            </div>

            {/* Product Picker Dropdown */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '6px' }}>
                Select Product from Catalog:
              </label>
              <select
                value={data.shopifyProductId || ''}
                onChange={e => handleSelectProduct(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  backgroundColor: '#0a0a0f',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#ffffff',
                  fontSize: '12px',
                  outline: 'none'
                }}
              >
                <option value="">-- Choose a Shopify Product --</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.price})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="page-collection-id" style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '6px' }}>
                Collection id
              </label>
              <input
                id="page-collection-id"
                value={data.shopifyCollectionId || ''}
                placeholder="Only if this page is a collection"
                onChange={e => handleFieldChange('shopifyCollectionId', e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  backgroundColor: '#0a0a0f',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#ffffff',
                  fontSize: '12px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#6b7280' }}>
                A saved collection id records a collection view. Leave it empty on a product page.
              </p>
            </div>
            <div>
              <label htmlFor="page-cart-action" style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '6px' }}>
                Button records
              </label>
              <select
                id="page-cart-action"
                value={data.cartAction === 'add' ? 'add' : 'checkout'}
                onChange={e => handleFieldChange('cartAction', e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  backgroundColor: '#0a0a0f',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#ffffff',
                  fontSize: '12px',
                  outline: 'none'
                }}
              >
                <option value="checkout">Checkout link</option>
                <option value="add">Add to cart</option>
              </select>
              <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#6b7280' }}>
                A checkout link records checkout. Add to cart records an add, and does not record checkout.
              </p>
            </div>

            {/* If product selected, show summary & 1-click sync */}
            {selectedProduct && (
              <div
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  padding: '10px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {selectedProduct.imageUrl && (
                    <img
                      src={selectedProduct.imageUrl}
                      alt={selectedProduct.title}
                      style={{ width: '36px', height: '36px', borderRadius: '4px', objectFit: 'cover' }}
                    />
                  )}
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#ffffff' }}>
                      {selectedProduct.title}
                    </div>
                    <div style={{ fontSize: '11px', color: '#10b981' }}>
                      Price: {selectedProduct.price} • {selectedProduct.variants.length} variant(s)
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSyncProductToPage}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    backgroundColor: '#10b981',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                  title="Auto-fill page title, hero photo, and pricing from this product"
                >
                  Sync to Page
                </button>
              </div>
            )}

            {/* Checkout Mode Toggle: Choice by user, default is less friction */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '6px' }}>
                Checkout Flow Mode:
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => handleFieldChange('checkoutMode', 'direct')}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: `1px solid ${data.checkoutMode !== 'lead-gate' ? '#10b981' : 'rgba(255, 255, 255, 0.1)'}`,
                    backgroundColor: data.checkoutMode !== 'lead-gate' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(0, 0, 0, 0.2)',
                    color: data.checkoutMode !== 'lead-gate' ? '#34d399' : '#9ca3af'
                  }}
                >
                  <div style={{ fontWeight: 700 }}>Direct to Checkout</div>
                  <div style={{ fontSize: '10px', opacity: 0.8 }}>1-Click (Less friction - Default)</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleFieldChange('checkoutMode', 'lead-gate')}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: `1px solid ${data.checkoutMode === 'lead-gate' ? '#ec4899' : 'rgba(255, 255, 255, 0.1)'}`,
                    backgroundColor: data.checkoutMode === 'lead-gate' ? 'rgba(236, 72, 153, 0.15)' : 'rgba(0, 0, 0, 0.2)',
                    color: data.checkoutMode === 'lead-gate' ? '#f472b6' : '#9ca3af'
                  }}
                >
                  <div style={{ fontWeight: 700 }}>2-Step Lead Gate</div>
                  <div style={{ fontSize: '10px', opacity: 0.8 }}>Collect email for coupon first</div>
                </button>
              </div>
            </div>

            {/* Post-Submit Action when in Lead-Gate Mode */}
            {data.checkoutMode === 'lead-gate' && (
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '6px' }}>
                  Post-Lead Action:
                </label>
                <select
                  value={data.postSubmitAction || 'redirect_checkout'}
                  onChange={e => handleFieldChange('postSubmitAction', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    backgroundColor: '#0a0a0f',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#ffffff',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                >
                  <option value="redirect_checkout">Immediate Checkout Redirect (Default — Less Friction)</option>
                  <option value="modal_voucher">On-Screen Voucher Code Card</option>
                  <option value="custom_url">Custom Thank You URL</option>
                </select>

                {data.postSubmitAction === 'custom_url' && (
                  <input
                    type="url"
                    placeholder="https://yourstore.com/thank-you"
                    value={data.customRedirectUrl || ''}
                    onChange={e => handleFieldChange('customRedirectUrl', e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: '6px',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      backgroundColor: '#0a0a0f',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#ffffff',
                      fontSize: '12px',
                      outline: 'none'
                    }}
                  />
                )}
              </div>
            )}

            {/* Discount Code */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                Auto-Applied Discount Code (Optional)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Tag size={13} style={{ color: '#ec4899' }} />
                <input
                  type="text"
                  placeholder="e.g. VIP15 or GLOW20"
                  value={data.discountCode || ''}
                  onChange={e => handleFieldChange('discountCode', e.target.value.toUpperCase())}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    borderRadius: '6px',
                    backgroundColor: '#0a0a0f',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    outline: 'none'
                  }}
                />
                {data.discountCode && (
                  <button
                    type="button"
                    disabled={syncingDisc}
                    onClick={async () => {
                      setSyncingDisc(true);
                      setDiscSyncedMsg(null);
                      try {
                        const headers = await authHeaders();
                        const wsId = workspace?.id || 'default';
                        const res = await fetch(`/api/workspace/${wsId}/shopify/create-discount`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', ...headers },
                          body: JSON.stringify({ code: data.discountCode, discountType: 'percentage', value: 20 })
                        });
                        const json = await res.json().catch(() => ({}));
                        if (json?.success) {
                          setDiscSyncedMsg(json.message || (json.discount?.syncedToLiveShopify
                            ? `${data.discountCode} is active in Shopify.`
                            : `${data.discountCode} is saved here. Shopify was not updated.`));
                          setTimeout(() => setDiscSyncedMsg(null), 3000);
                        }
                      } catch (err) {
                        console.error('Failed syncing discount:', err);
                      } finally {
                        setSyncingDisc(false);
                      }
                    }}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(236, 72, 153, 0.15)',
                      border: '1px solid rgba(236, 72, 153, 0.3)',
                      color: '#f472b6',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: syncingDisc ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    title="Provision this code directly in connected Shopify Admin"
                  >
                    <Zap size={11} />
                    <span>{syncingDisc ? 'Syncing...' : 'Sync to Shopify'}</span>
                  </button>
                )}
              </div>
              {discSyncedMsg && (
                <div style={{ marginTop: '4px', fontSize: '11px', color: '#34d399', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle2 size={12} /> <span>{discSyncedMsg}</span>
                </div>
              )}
            </div>

            {/* Live Permalink Preview */}
            <div
              style={{
                backgroundColor: '#070a12',
                borderRadius: '6px',
                padding: '8px 10px',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Target Shopify Permalink:
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={copyPermalink}
                    style={{ background: 'transparent', border: 'none', color: '#10b981', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
                  >
                    {copiedLink ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                  </button>
                  <a
                    href={currentCheckoutUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#60a5fa', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '2px', textDecoration: 'none' }}
                  >
                    <span>Test</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
              </div>
              <div style={{ fontSize: '11px', color: '#94A3B8', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {currentCheckoutUrl}
              </div>
            </div>
          </div>

          {/* SECTION 1.5: 1-CLICK ORDER BUMP / ADD-ON OFFER (AOV BOOSTER) */}
          <div
            style={{
              padding: '14px',
              borderRadius: '10px',
              backgroundColor: 'rgba(236, 72, 153, 0.08)',
              border: '1px solid rgba(236, 72, 153, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Zap size={16} style={{ color: '#ec4899' }} />
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#f3f4f6' }}>
                    1-Click Order Bump (AOV Booster)
                  </span>
                  <div style={{ fontSize: '10px', color: '#9ca3af' }}>
                    Boost checkout value with a complementary product offer
                  </div>
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(data.orderBumpEnabled)}
                  onChange={e => handleFieldChange('orderBumpEnabled', e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#ec4899', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '11px', fontWeight: 600, color: data.orderBumpEnabled ? '#f472b6' : '#6b7280' }}>
                  {data.orderBumpEnabled ? 'Active' : 'Disabled'}
                </span>
              </label>
            </div>

            {data.orderBumpEnabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
                {/* Bump Product Selector */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                    Select Add-on Product from Catalog:
                  </label>
                  <select
                    value={data.orderBumpProductId || ''}
                    onChange={e => handleSelectBumpProduct(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      backgroundColor: '#0a0a0f',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#ffffff',
                      fontSize: '12px',
                      outline: 'none'
                    }}
                  >
                    <option value="">-- Choose Complementary Product --</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.title} ({p.price})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Bump Headline */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                    Bump Card Headline:
                  </label>
                  <input
                    type="text"
                    value={data.orderBumpHeadline || ''}
                    placeholder="e.g. ✦ Add the Rose Gold Hydration Roller for 50% Off"
                    onChange={e => handleFieldChange('orderBumpHeadline', e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      backgroundColor: '#0a0a0f',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#ffffff',
                      fontSize: '12px',
                      outline: 'none'
                    }}
                  />
                </div>

                {/* Bump Description */}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                    Bump Offer Description:
                  </label>
                  <textarea
                    rows={2}
                    value={data.orderBumpDescription || ''}
                    placeholder="Explain why this pairs perfectly with the main product..."
                    onChange={e => handleFieldChange('orderBumpDescription', e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      backgroundColor: '#0a0a0f',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#ffffff',
                      fontSize: '12px',
                      resize: 'none',
                      outline: 'none'
                    }}
                  />
                </div>

                {/* Bump Offer Price & Variant ID */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                      Add-on Price:
                    </label>
                    <input
                      type="text"
                      value={data.orderBumpPrice || ''}
                      placeholder="e.g. $19.00 (Save 50%)"
                      onChange={e => handleFieldChange('orderBumpPrice', e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '7px 10px',
                        borderRadius: '6px',
                        backgroundColor: '#0a0a0f',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#ffffff',
                        fontSize: '12px',
                        outline: 'none'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                      Shopify Variant ID:
                    </label>
                    <input
                      type="text"
                      value={data.orderBumpVariantId || ''}
                      placeholder="e.g. 42109840194"
                      onChange={e => handleFieldChange('orderBumpVariantId', e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '7px 10px',
                        borderRadius: '6px',
                        backgroundColor: '#0a0a0f',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#ffffff',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        outline: 'none'
                      }}
                    />
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#94a3b8',
                    border: '1px solid rgba(255, 255, 255, 0.05)'
                  }}
                >
                  <strong style={{ color: '#f472b6' }}>Shopify Native Bundling:</strong> Automatically passes both items to checkout as{' '}
                  <code style={{ color: '#38bdf8' }}>/cart/{data.shopifyVariantId || 'v1'}:1,{data.orderBumpVariantId || 'v2'}:1</code> without needing expensive 3rd-party Shopify apps.
                </div>
              </div>
            )}
          </div>

          {/* SECTION 1.6: A/B SPLIT TESTING & TRAFFIC ROUTING */}
          <div
            style={{
              padding: '14px',
              borderRadius: '10px',
              backgroundColor: data.abTestingEnabled ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255, 255, 255, 0.03)',
              border: data.abTestingEnabled ? '1px solid rgba(139, 92, 246, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <GitFork size={16} style={{ color: data.abTestingEnabled ? '#a78bfa' : '#94a3b8' }} />
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#f3f4f6' }}>
                    A/B Split Testing & Traffic Routing
                  </span>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    Split incoming visitors between two offer angles with 0-redirect cookie persistence
                  </div>
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '6px' }}>
                <input
                  type="checkbox"
                  checked={data.abTestingEnabled || false}
                  onChange={e => {
                    const enabled = e.target.checked;
                    if (enabled && !data.variantB) {
                      onChange({
                        ...data,
                        abTestingEnabled: true,
                        splitRatio: data.splitRatio || 50,
                        variantB: {
                          headline: data.headline,
                          subhead: data.subhead,
                          bullets: [...(data.bullets || [])],
                          buttonText: data.buttonText,
                          trustBadge: data.trustBadge
                        }
                      });
                    } else {
                      handleFieldChange('abTestingEnabled', enabled);
                    }
                  }}
                  style={{ width: '16px', height: '16px', accentColor: '#8b5cf6', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '12px', fontWeight: 600, color: data.abTestingEnabled ? '#a78bfa' : '#6b7280' }}>
                  {data.abTestingEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>

            {data.abTestingEnabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af' }}>
                      Traffic Split Ratio:
                    </label>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#a78bfa' }}>
                      {data.splitRatio || 50}% Variant A / {100 - (data.splitRatio || 50)}% Variant B
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="90"
                    step="10"
                    value={data.splitRatio || 50}
                    onChange={e => handleFieldChange('splitRatio', Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#8b5cf6' }}
                  />
                </div>

                <div
                  style={{
                    padding: '8px 10px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(0, 0, 0, 0.25)',
                    fontSize: '11px',
                    color: '#94a3b8',
                    border: '1px solid rgba(255, 255, 255, 0.05)'
                  }}
                >
                  <strong style={{ color: '#a78bfa' }}>Zero-Latency Split:</strong> Traffic is routed server-side using <code style={{ color: '#f472b6' }}>jv_var</code> cookie with instant rendering and 0 redirects. Override anytime with <code style={{ color: '#38bdf8' }}>?var=b</code>.
                </div>
              </div>
            )}
          </div>

          {/* SECTION 1.7: ON-BRAND URGENCY & SCARCITY BOOSTERS */}
          <div
            style={{
              padding: '14px',
              borderRadius: '10px',
              backgroundColor: (data.urgencyTimerEnabled || data.scarcityBatchEnabled) ? 'rgba(236, 72, 153, 0.08)' : 'rgba(255, 255, 255, 0.03)',
              border: (data.urgencyTimerEnabled || data.scarcityBatchEnabled) ? '1px solid rgba(236, 72, 153, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Zap size={16} style={{ color: '#ec4899' }} />
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#f3f4f6' }}>
                    Urgency & Scarcity Boosters
                  </span>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    Luxury rose-gold reservation bar & limited batch drop indicators
                  </div>
                </div>
              </div>
            </div>

            {/* Toggle 1: Reservation Countdown Bar */}
            <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: data.urgencyTimerEnabled ? '8px' : '0' }}>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px' }}>
                  <input
                    type="checkbox"
                    checked={data.urgencyTimerEnabled || false}
                    onChange={e => handleFieldChange('urgencyTimerEnabled', e.target.checked)}
                    style={{ width: '15px', height: '15px', accentColor: '#ec4899', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#ffffff' }}>
                    Reservation Countdown Bar
                  </span>
                </label>
                <span style={{ fontSize: '11px', color: data.urgencyTimerEnabled ? '#ec4899' : '#64748b', fontWeight: 600 }}>
                  {data.urgencyTimerEnabled ? (data.urgencyMinutes ? `${data.urgencyMinutes} min` : 'Set minutes') : 'Off'}
                </span>
              </div>

              {data.urgencyTimerEnabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '8px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>
                        Minutes:
                      </label>
                      <input
                        type="number"
                        min="3"
                        max="60"
                        value={data.urgencyMinutes ?? ''}
                        onChange={e => handleFieldChange('urgencyMinutes', e.target.value === '' ? undefined : Number(e.target.value))}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: '6px',
                          background: '#0a0a0f',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: '#ffffff',
                          fontSize: '12px'
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>
                        Banner Message:
                      </label>
                      <input
                        type="text"
                        value={data.urgencyText || ''}
                        placeholder="Cart & promotional pricing reserved for"
                        onChange={e => handleFieldChange('urgencyText', e.target.value)}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: '6px',
                          background: '#0a0a0f',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: '#ffffff',
                          fontSize: '12px'
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                    ✦ Automatically saved in visitor's browser (<code style={{ color: '#f472b6' }}>localStorage</code>) so refreshing does not reset the clock.
                  </div>
                </div>
              )}
            </div>

            {/* Toggle 2: Batch Stock Scarcity Indicator */}
            <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: data.scarcityBatchEnabled ? '8px' : '0' }}>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px' }}>
                  <input
                    type="checkbox"
                    checked={data.scarcityBatchEnabled || false}
                    onChange={e => handleFieldChange('scarcityBatchEnabled', e.target.checked)}
                    style={{ width: '15px', height: '15px', accentColor: '#ec4899', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#ffffff' }}>
                    Batch Stock Scarcity Counter
                  </span>
                </label>
                <span style={{ fontSize: '11px', color: data.scarcityBatchEnabled ? '#ec4899' : '#64748b', fontWeight: 600 }}>
                  {data.scarcityBatchEnabled ? (data.scarcityBatchCount ? `${data.scarcityBatchCount} units left` : 'Add a count') : 'Off'}
                </span>
              </div>

              {data.scarcityBatchEnabled && (
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '8px', marginTop: '6px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>
                      Units Left:
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={data.scarcityBatchCount ?? ''}
                      placeholder="Count"
                      onChange={e => handleFieldChange('scarcityBatchCount', e.target.value === '' ? undefined : Number(e.target.value))}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        background: '#0a0a0f',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#ffffff',
                        fontSize: '12px'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>
                      Custom Badge Copy:
                    </label>
                    <input
                      type="text"
                      value={data.scarcityBatchText || ''}
                      placeholder={data.scarcityBatchCount ? `Limited batch: ${data.scarcityBatchCount} units remaining` : 'Write the stock line shoppers should see'}
                      onChange={e => handleFieldChange('scarcityBatchText', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        background: '#0a0a0f',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#ffffff',
                        fontSize: '12px'
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SECTION 1.8: EXIT-INTENT CONVERSION RESCUE */}
          <div
            style={{
              padding: '14px',
              borderRadius: '10px',
              backgroundColor: data.exitIntentEnabled ? 'rgba(236, 72, 153, 0.08)' : 'rgba(255, 255, 255, 0.03)',
              border: data.exitIntentEnabled ? '1px solid rgba(236, 72, 153, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldAlert size={16} style={{ color: '#ec4899' }} />
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#f3f4f6' }}>
                    Exit-Intent Conversion Rescue
                  </span>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    Luxury slide-over to recover abandoning shoppers with a VIP formulation code
                  </div>
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '6px' }}>
                <input
                  type="checkbox"
                  checked={data.exitIntentEnabled || false}
                  onChange={e => handleFieldChange('exitIntentEnabled', e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#ec4899', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '11px', fontWeight: 700, color: data.exitIntentEnabled ? '#ec4899' : '#64748b' }}>
                  {data.exitIntentEnabled ? 'Active' : 'Off'}
                </span>
              </label>
            </div>

            {data.exitIntentEnabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>
                      Rescue Badge:
                    </label>
                    <input
                      type="text"
                      value={data.exitIntentBadge || 'Wait — VIP Privilege'}
                      onChange={e => handleFieldChange('exitIntentBadge', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        background: '#0a0a0f',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#ffffff',
                        fontSize: '12px'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>
                      VIP Discount Code:
                    </label>
                    <input
                      type="text"
                      value={data.exitIntentDiscountCode || data.discountCode || ''}
                      onChange={e => handleFieldChange('exitIntentDiscountCode', e.target.value.toUpperCase())}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        background: '#0a0a0f',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#ffffff',
                        fontSize: '12px',
                        fontFamily: 'monospace'
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>
                    Headline:
                  </label>
                  <input
                    type="text"
                    value={data.exitIntentHeadline || 'Before You Go: Save Your 15% VIP Formulation Voucher'}
                    onChange={e => handleFieldChange('exitIntentHeadline', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      background: '#0a0a0f',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#ffffff',
                      fontSize: '12px'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>
                    Subhead Description:
                  </label>
                  <textarea
                    rows={2}
                    value={data.exitIntentSubhead || 'Reserve your private batch discount code now before this allocation sells out.'}
                    onChange={e => handleFieldChange('exitIntentSubhead', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      background: '#0a0a0f',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#ffffff',
                      fontSize: '12px'
                    }}
                  />
                </div>

                <div style={{ padding: '8px 10px', borderRadius: '6px', background: 'rgba(0, 0, 0, 0.3)', border: '1px dashed rgba(236, 72, 153, 0.3)', fontSize: '11px', color: '#fbcfe8' }}>
                  💡 <strong>Smart Triggering</strong>: Triggered on desktop cursor exit and mobile upward scroll. Frequency capped in <code>sessionStorage</code> so it never annoys repeat shoppers.
                </div>
              </div>
            )}
          </div>

          {/* SECTION 2: LIVE PUBLIC HOSTING & STATUS */}
          <div
            style={{
              padding: '14px',
              borderRadius: '10px',
              backgroundColor: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Globe size={16} style={{ color: '#38bdf8' }} />
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#f3f4f6' }}>
                  Live Funnel Hosting
                </span>
              </div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: '9999px',
                  backgroundColor: data.published ? 'rgba(16, 185, 129, 0.2)' : 'rgba(148, 163, 184, 0.15)',
                  color: data.published ? '#34d399' : '#94a3b8',
                  border: `1px solid ${data.published ? 'rgba(16, 185, 129, 0.3)' : 'rgba(148, 163, 184, 0.2)'}`
                }}
              >
                {data.published ? '● Live Published' : '○ Draft (Publish on toolbar)'}
              </span>
            </div>

            <div
              style={{
                backgroundColor: '#070a12',
                borderRadius: '6px',
                padding: '10px',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  Live Hosted Page URL:
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={handleCopyLiveUrl}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: copiedLiveUrl ? '#10b981' : '#38bdf8',
                      fontSize: '11px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    {copiedLiveUrl ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copiedLiveUrl ? 'Copied' : 'Copy'}</span>
                  </button>
                  <a
                    href={`/p/${data.slug || 'offer'}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: '#38bdf8',
                      fontSize: '11px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      textDecoration: 'none'
                    }}
                  >
                    <Eye size={12} />
                    <span>View Live</span>
                  </a>
                </div>
              </div>
              <div style={{ fontSize: '12px', color: '#38bdf8', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {livePageUrl}
              </div>
            </div>

            {/* Custom Brand Subdomain & CNAME Verification (Wave 3) */}
            <div
              style={{
                backgroundColor: '#070a12',
                borderRadius: '6px',
                padding: '10px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#f3f4f6' }}>
                  Custom Brand Subdomain:
                </label>
                {data.customDomainVerified ? (
                  <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <Check size={11} /> CNAME Verified
                  </span>
                ) : (
                  <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                    Optional • High-Trust
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="e.g. offer.yourbrand.com"
                  value={data.customDomain || ''}
                  onChange={e => {
                    handleFieldChange('customDomain', e.target.value.toLowerCase().trim());
                    setDnsResult(null);
                  }}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    borderRadius: '6px',
                    backgroundColor: '#0a0a0f',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    outline: 'none'
                  }}
                />
                <button
                  type="button"
                  onClick={handleCheckDns}
                  disabled={!data.customDomain || checkingDns}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    backgroundColor: checkingDns ? 'rgba(56, 189, 248, 0.2)' : 'rgba(56, 189, 248, 0.15)',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                    color: '#38bdf8',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: data.customDomain && !checkingDns ? 'pointer' : 'default',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {checkingDns ? 'Checking…' : 'Check DNS'}
                </button>
              </div>

              {dnsResult && (
                <div
                  style={{
                    fontSize: '11px',
                    padding: '6px 8px',
                    borderRadius: '5px',
                    backgroundColor: dnsResult.verified ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: dnsResult.verified ? '#34d399' : '#f87171',
                    border: `1px solid ${dnsResult.verified ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                  }}
                >
                  {dnsResult.message}
                </div>
              )}

              <div style={{ fontSize: '10px', color: '#64748b', lineHeight: 1.4 }}>
                DNS Record: <strong style={{ color: '#cbd5e1' }}>CNAME</strong> pointing to <code style={{ color: '#38bdf8' }}>cname.jourvance.com</code>.
              </div>
            </div>

            {/* Outbound Webhook Relay (Klaviyo / Zapier / Make) */}
            <div
              style={{
                backgroundColor: '#070a12',
                borderRadius: '6px',
                padding: '10px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#f3f4f6' }}>
                Outbound Lead &amp; Bump Webhook Relay (Optional):
              </label>
              <input
                type="url"
                placeholder="https://hooks.zapier.com/hooks/catch/..."
                value={data.webhookUrl || ''}
                onChange={e => handleFieldChange('webhookUrl', e.target.value.trim())}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  backgroundColor: '#0a0a0f',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#ffffff',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  outline: 'none'
                }}
              />
              <div style={{ fontSize: '10px', color: '#64748b' }}>
                Relays new leads, bump selections, and UTM attribution in real time to Klaviyo, Zapier, or your CRM.
              </div>
            </div>
          </div>

          {/* SECTION 3: AD TRACKING PIXELS & ATTRIBUTION */}
          <div
            style={{
              padding: '14px',
              borderRadius: '10px',
              backgroundColor: 'rgba(139, 92, 246, 0.08)',
              border: '1px solid rgba(139, 92, 246, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Activity size={16} style={{ color: '#a78bfa' }} />
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#f3f4f6' }}>
                  Ad Tracking Pixels & Attribution
                </span>
              </div>
              <span style={{ fontSize: '10px', color: '#a78bfa', fontWeight: 600 }}>
                Zero-Code Injection
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                  Meta (Facebook/Instagram) Pixel ID:
                </label>
                <input
                  type="text"
                  placeholder="e.g. 109284756291048"
                  value={data.metaPixelId || ''}
                  onChange={e => handleFieldChange('metaPixelId', e.target.value.trim())}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '7px 10px',
                    borderRadius: '6px',
                    backgroundColor: '#0a0a0f',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                  TikTok Pixel ID:
                </label>
                <input
                  type="text"
                  placeholder="e.g. C9K87F1Q3B6"
                  value={data.tiktokPixelId || ''}
                  onChange={e => handleFieldChange('tiktokPixelId', e.target.value.trim())}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '7px 10px',
                    borderRadius: '6px',
                    backgroundColor: '#0a0a0f',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                  Google Analytics 4 (GA4) Measurement ID:
                </label>
                <input
                  type="text"
                  placeholder="e.g. G-XXXXXXXXXX"
                  value={data.ga4TrackingId || ''}
                  onChange={e => handleFieldChange('ga4TrackingId', e.target.value.trim())}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '7px 10px',
                    borderRadius: '6px',
                    backgroundColor: '#0a0a0f',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                borderRadius: '6px',
                padding: '8px 10px',
                fontSize: '11px',
                color: '#34d399',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
              <span>Full UTM (`utm_source`, `utm_campaign`) & Click ID (`fbclid`, `ttclid`, `gclid`) passthrough to Shopify is active automatically.</span>
            </div>
          </div>

          {/* AI Assistant */}
          <div
            style={{
              padding: '14px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.12), rgba(99, 102, 241, 0.05))',
              border: '1px solid rgba(236, 72, 153, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={14} color="#ec4899" /> Hub Brain Page Optimizer
              </div>
              <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>
                Generate conversion-tested copy for this product
              </div>
            </div>
            <button
              onClick={generateAICopy}
              disabled={loadingAI}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 12px',
                borderRadius: '8px',
                background: '#ec4899',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 600,
                cursor: loadingAI ? 'not-allowed' : 'pointer'
              }}
            >
              {loadingAI ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {loadingAI ? 'Writing…' : 'Generate'}
            </button>
          </div>

          {/* URL Slug */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
              Page URL Path
            </label>
            <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '8px', padding: '0 10px' }}>
              <span style={{ fontSize: '12px', color: '#64748B', fontFamily: 'monospace' }}>jourvance.app/p/</span>
              <input
                type="text"
                value={data.slug}
                onChange={e => handleFieldChange('slug', e.target.value)}
                placeholder="vip-glow-kit"
                style={{
                  flex: 1,
                  padding: '10px 4px',
                  background: 'transparent',
                  border: 'none',
                  color: '#FFFFFF',
                  fontSize: '13px',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          {/* A/B Variant Sub-tabs */}
          {data.abTestingEnabled && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px',
                borderRadius: '8px',
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(139, 92, 246, 0.35)'
              }}
            >
              <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
                <button
                  type="button"
                  onClick={() => setActiveVariantTab('a')}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: activeVariantTab === 'a' ? '#ec4899' : 'transparent',
                    color: activeVariantTab === 'a' ? '#FFFFFF' : '#94A3B8',
                    transition: 'all 0.15s ease'
                  }}
                >
                  Variant A (Control)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveVariantTab('b')}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: activeVariantTab === 'b' ? '#8B5CF6' : 'transparent',
                    color: activeVariantTab === 'b' ? '#FFFFFF' : '#94A3B8',
                    transition: 'all 0.15s ease'
                  }}
                >
                  Variant B (Challenger)
                </button>
              </div>

              {activeVariantTab === 'b' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px' }}>
                  <button
                    type="button"
                    onClick={handleCloneVariantAtoB}
                    style={{
                      padding: '5px 8px',
                      borderRadius: '5px',
                      fontSize: '10px',
                      fontWeight: 600,
                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#E2E8F0',
                      cursor: 'pointer'
                    }}
                    title="Clone text and bullets from Variant A"
                  >
                    Clone A
                  </button>
                  <button
                    type="button"
                    onClick={generateAIChallenger}
                    disabled={loadingAI}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '5px 8px',
                      borderRadius: '5px',
                      fontSize: '10px',
                      fontWeight: 600,
                      backgroundColor: '#8B5CF6',
                      border: 'none',
                      color: '#FFFFFF',
                      cursor: loadingAI ? 'not-allowed' : 'pointer'
                    }}
                    title="Generate alternative hook with AI"
                  >
                    <Sparkles size={11} /> AI Angle
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Headline */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
              Main Landing Headline {data.abTestingEnabled ? `(${activeVariantTab === 'b' ? 'Variant B' : 'Variant A'})` : ''}
            </label>
            <input
              type="text"
              value={activeVariantTab === 'b' ? (data.variantB?.headline ?? '') : (data.headline ?? '')}
              onChange={e => {
                if (activeVariantTab === 'b') {
                  handleVariantBFieldChange('headline', e.target.value);
                } else {
                  handleFieldChange('headline', e.target.value);
                }
              }}
              placeholder={activeVariantTab === 'b' ? 'Alternative headline hook...' : 'e.g. Experience Radiant Skin With Pure Botanical Radiance'}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'rgba(0, 0, 0, 0.3)',
                border: activeVariantTab === 'b' ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid rgba(255, 255, 255, 0.15)',
                color: '#FFFFFF',
                fontSize: '13px',
                outline: 'none'
              }}
            />
          </div>

          {/* Subhead */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
              Subheadline & Value Description {data.abTestingEnabled ? `(${activeVariantTab === 'b' ? 'Variant B' : 'Variant A'})` : ''}
            </label>
            <textarea
              rows={3}
              value={activeVariantTab === 'b' ? (data.variantB?.subhead ?? '') : (data.subhead ?? '')}
              onChange={e => {
                if (activeVariantTab === 'b') {
                  handleVariantBFieldChange('subhead', e.target.value);
                } else {
                  handleFieldChange('subhead', e.target.value);
                }
              }}
              placeholder={activeVariantTab === 'b' ? 'Alternative subheadline addressing customer pain...' : 'Clarify who this product is for and what makes it special...'}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'rgba(0, 0, 0, 0.3)',
                border: activeVariantTab === 'b' ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid rgba(255, 255, 255, 0.15)',
                color: '#FFFFFF',
                fontSize: '13px',
                outline: 'none',
                resize: 'vertical'
              }}
            />
          </div>

          {/* Value Bullets */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#E2E8F0' }}>
                Key Benefits & Features {data.abTestingEnabled ? `(${activeVariantTab === 'b' ? 'Variant B' : 'Variant A'})` : ''} ({activeVariantTab === 'b' ? (data.variantB?.bullets?.length || 0) : (data.bullets?.length || 0)})
              </label>
              <button
                type="button"
                onClick={() => {
                  if (activeVariantTab === 'b') {
                    const cur = data.variantB?.bullets || [];
                    handleVariantBFieldChange('bullets', [...cur, 'New value point']);
                  } else {
                    addBullet();
                  }
                }}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: activeVariantTab === 'b' ? '#a78bfa' : '#ec4899', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
              >
                <Plus size={12} /> Add Point
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(activeVariantTab === 'b' ? (data.variantB?.bullets || []) : (data.bullets || [])).map((b, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="text"
                    value={b}
                    onChange={e => {
                      if (activeVariantTab === 'b') {
                        const cur = [...(data.variantB?.bullets || [])];
                        cur[idx] = e.target.value;
                        handleVariantBFieldChange('bullets', cur);
                      } else {
                        handleBulletChange(idx, e.target.value);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#FFFFFF',
                      fontSize: '12px',
                      outline: 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (activeVariantTab === 'b') {
                        const cur = (data.variantB?.bullets || []).filter((_, i) => i !== idx);
                        handleVariantBFieldChange('bullets', cur);
                      } else {
                        removeBullet(idx);
                      }
                    }}
                    style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: '4px' }}
                    title="Remove bullet"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Trust Badge */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
              Social Proof / Trust Badge {data.abTestingEnabled ? `(${activeVariantTab === 'b' ? 'Variant B' : 'Variant A'})` : ''}
            </label>
            <input
              type="text"
              value={activeVariantTab === 'b' ? (data.variantB?.trustBadge ?? '') : (data.trustBadge ?? '')}
              onChange={e => {
                if (activeVariantTab === 'b') {
                  handleVariantBFieldChange('trustBadge', e.target.value);
                } else {
                  handleFieldChange('trustBadge', e.target.value);
                }
              }}
              placeholder="A line you can stand behind. Leave it blank if you do not have one."
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

          {/* Button Text */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
              Primary Button Text {data.abTestingEnabled ? `(${activeVariantTab === 'b' ? 'Variant B' : 'Variant A'})` : ''}
            </label>
            <input
              type="text"
              value={activeVariantTab === 'b' ? (data.variantB?.buttonText ?? '') : (data.buttonText ?? '')}
              onChange={e => {
                if (activeVariantTab === 'b') {
                  handleVariantBFieldChange('buttonText', e.target.value);
                } else {
                  handleFieldChange('buttonText', e.target.value);
                }
              }}
              placeholder="e.g. Buy Now — Fast Checkout"
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
        </>
      )}
    </div>
  );
};
