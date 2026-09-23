import React, { useState } from 'react';
import {
  Globe, ExternalLink, Copy, Check, CheckCircle2,
  Activity, ShoppingBag, ShieldCheck, X, AlertCircle, RefreshCw, Link as LinkIcon
} from 'lucide-react';
import type { Workspace } from '../../types/journey';
import { verifyCustomDomain } from '../../lib/shopifyClient';

export interface PublishedPageInfo {
  nodeId: string;
  slug: string;
  url: string;
  headline: string;
  productTitle?: string;
  checkoutMode?: string;
  customDomain?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  publishedPages: PublishedPageInfo[];
  workspace?: Workspace | null;
  onUnpublish?: () => Promise<void>;
  unpublishing?: boolean;
}

export const PublishModal: React.FC<Props> = ({
  isOpen,
  onClose,
  publishedPages,
  workspace,
  onUnpublish,
  unpublishing = false
}) => {
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [checkingDomain, setCheckingDomain] = useState<string | null>(null);
  const [domainStatus, setDomainStatus] = useState<Record<string, { verified: boolean; message: string }>>({});

  if (!isOpen) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://jourvance.com';
  const storeDomain = workspace?.shopifyConfig?.storeDomain || 'demo.myshopify.com';

  const handleCopy = (key: string, fullUrl: string) => {
    navigator.clipboard.writeText(fullUrl);
    setCopiedSlug(key);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const handleVerifyDomain = async (domain: string) => {
    setCheckingDomain(domain);
    try {
      const res = await verifyCustomDomain(domain);
      setDomainStatus(prev => ({
        ...prev,
        [domain]: {
          verified: !!res.verified,
          message: res.message || (res.verified ? 'CNAME points directly to cname.jourvance.com' : 'DNS not propagated yet')
        }
      }));
    } finally {
      setCheckingDomain(null);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '580px',
          backgroundColor: '#0F172A',
          borderRadius: '16px',
          border: '1px solid rgba(236, 72, 153, 0.3)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(236, 72, 153, 0.15)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.15), rgba(99, 102, 241, 0.05))'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #EC4899, #8B5CF6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 15px rgba(236, 72, 153, 0.4)'
              }}
            >
              <Globe size={22} color="#FFFFFF" />
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                Funnel Successfully Published!
              </h2>
              <p style={{ fontSize: '12px', color: '#94A3B8', margin: '2px 0 0 0' }}>
                Your landing pages are active and ready for live ad traffic.
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
              padding: '6px'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Published Pages List */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              Live Landing Page URLs ({publishedPages.length})
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {publishedPages.map((page) => {
                const fullUrl = `${origin}${page.url}`;
                const testUtmUrl = `${fullUrl}?utm_source=meta_ad&utm_campaign=spring_launch&fbclid=demo_fbclid_12345`;
                const isCopied = copiedSlug === page.slug;

                return (
                  <div
                    key={page.nodeId}
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '10px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>
                        {page.headline || page.productTitle || 'Landing Page'}
                      </div>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          color: '#34D399',
                          backgroundColor: 'rgba(16, 185, 129, 0.15)',
                          padding: '2px 8px',
                          borderRadius: '9999px'
                        }}
                      >
                        {page.checkoutMode === 'lead-gate' ? '2-Step Lead Gate' : '1-Click Direct Checkout'}
                      </span>
                    </div>

                    <div
                      style={{
                        backgroundColor: '#070A12',
                        borderRadius: '6px',
                        padding: '8px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.06)'
                      }}
                    >
                      <span style={{ fontSize: '12px', color: '#38BDF8', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fullUrl}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => handleCopy(page.slug, fullUrl)}
                          style={{
                            background: 'rgba(255, 255, 255, 0.08)',
                            border: 'none',
                            borderRadius: '5px',
                            color: isCopied ? '#10B981' : '#FFFFFF',
                            fontSize: '11px',
                            padding: '4px 8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          {isCopied ? <Check size={12} /> : <Copy size={12} />}
                          <span>{isCopied ? 'Copied' : 'Copy'}</span>
                        </button>
                        <a
                          href={fullUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            background: 'linear-gradient(135deg, #EC4899, #DB2777)',
                            borderRadius: '5px',
                            color: '#FFFFFF',
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '4px 10px',
                            textDecoration: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <span>Open Live</span>
                          <ExternalLink size={12} />
                        </a>
                      </div>
                    </div>

                    {/* Custom Brand Subdomain Section if configured */}
                    {page.customDomain ? (
                      <div
                        style={{
                          backgroundColor: 'rgba(99, 102, 241, 0.08)',
                          borderRadius: '8px',
                          padding: '10px 12px',
                          border: '1px solid rgba(99, 102, 241, 0.25)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <LinkIcon size={13} style={{ color: '#818CF8' }} />
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#E0E7FF' }}>
                              Custom Brand Subdomain
                            </span>
                          </div>
                          {domainStatus[page.customDomain]?.verified ? (
                            <span style={{ fontSize: '10px', fontWeight: 700, color: '#34D399', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <CheckCircle2 size={12} /> CNAME Verified
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleVerifyDomain(page.customDomain!)}
                              disabled={checkingDomain === page.customDomain}
                              style={{
                                background: 'rgba(99, 102, 241, 0.2)',
                                border: '1px solid rgba(99, 102, 241, 0.4)',
                                borderRadius: '4px',
                                color: '#A5B4FC',
                                fontSize: '10px',
                                fontWeight: 700,
                                padding: '3px 8px',
                                cursor: checkingDomain === page.customDomain ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <RefreshCw size={10} className={checkingDomain === page.customDomain ? 'spin' : ''} />
                              <span>{checkingDomain === page.customDomain ? 'Checking…' : 'Check DNS'}</span>
                            </button>
                          )}
                        </div>

                        <div
                          style={{
                            backgroundColor: '#070A12',
                            borderRadius: '6px',
                            padding: '6px 10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                            border: '1px solid rgba(255, 255, 255, 0.06)'
                          }}
                        >
                          <span style={{ fontSize: '12px', color: '#A5B4FC', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            https://{page.customDomain}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={() => handleCopy(`custom-${page.slug}`, `https://${page.customDomain}`)}
                              style={{
                                background: 'rgba(255, 255, 255, 0.08)',
                                border: 'none',
                                borderRadius: '5px',
                                color: copiedSlug === `custom-${page.slug}` ? '#10B981' : '#FFFFFF',
                                fontSize: '11px',
                                padding: '4px 8px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              {copiedSlug === `custom-${page.slug}` ? <Check size={12} /> : <Copy size={12} />}
                              <span>{copiedSlug === `custom-${page.slug}` ? 'Copied' : 'Copy'}</span>
                            </button>
                            <a
                              href={`https://${page.customDomain}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                                borderRadius: '5px',
                                color: '#FFFFFF',
                                fontSize: '11px',
                                fontWeight: 700,
                                padding: '4px 10px',
                                textDecoration: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <span>Open Live</span>
                              <ExternalLink size={12} />
                            </a>
                          </div>
                        </div>

                        {domainStatus[page.customDomain] && (
                          <div style={{ fontSize: '10px', color: domainStatus[page.customDomain].verified ? '#34D399' : '#FBBF24', lineHeight: 1.3 }}>
                            {domainStatus[page.customDomain].message}
                          </div>
                        )}
                        {!domainStatus[page.customDomain] && (
                          <div style={{ fontSize: '10px', color: '#94A3B8' }}>
                            Ensure CNAME for <code style={{ color: '#E0E7FF' }}>{page.customDomain}</code> points to <code style={{ color: '#EC4899' }}>cname.jourvance.com</code> in your DNS provider.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: '10px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>💡 Tip: You can map a custom subdomain (e.g. <code style={{ color: '#CBD5E1' }}>offer.yourbrand.com</code>) anytime in Page Settings.</span>
                      </div>
                    )}

                    {/* Attribution Test Shortcut */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' }}>
                      <span style={{ color: '#64748B' }}>Test attribution & checkout link:</span>
                      <a
                        href={testUtmUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#A78BFA', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: '3px' }}
                      >
                        <span>Simulate Ad Click (with UTMs)</span>
                        <ExternalLink size={10} />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Shopify & Ad Attribution Status Box */}
          <div
            style={{
              padding: '14px',
              borderRadius: '10px',
              backgroundColor: 'rgba(16, 185, 129, 0.06)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShoppingBag size={15} style={{ color: '#10B981' }} />
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#F1F5F9' }}>
                  Target Shopify Store: {storeDomain}
                </span>
              </div>
              <span style={{ fontSize: '11px', color: '#10B981', fontWeight: 600 }}>
                ● Connected
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              <div style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: '#94A3B8' }}>Meta Pixel</div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#38BDF8', marginTop: '2px' }}>Auto-Injected</div>
              </div>
              <div style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: '#94A3B8' }}>TikTok Pixel</div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#A78BFA', marginTop: '2px' }}>Auto-Injected</div>
              </div>
              <div style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: '#94A3B8' }}>UTM & Click IDs</div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#34D399', marginTop: '2px' }}>Forwarded</div>
              </div>
            </div>

            <div style={{ fontSize: '11px', color: '#94A3B8', lineHeight: 1.4 }}>
              Visitors clicking through will have their discount coupon automatically applied at Shopify checkout, and all ad click IDs (<code style={{ color: '#F472B6' }}>fbclid</code>, <code style={{ color: '#F472B6' }}>ttclid</code>) will be passed for ROAS attribution.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(0, 0, 0, 0.2)'
          }}
        >
          {onUnpublish ? (
            <button
              type="button"
              onClick={onUnpublish}
              disabled={unpublishing}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#EF4444',
                fontSize: '12px',
                fontWeight: 600,
                cursor: unpublishing ? 'not-allowed' : 'pointer'
              }}
            >
              {unpublishing ? 'Unpublishing…' : 'Take Funnel Offline'}
            </button>
          ) : <div />}

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              backgroundColor: '#1E293B',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#FFFFFF',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
