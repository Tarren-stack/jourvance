import React, { useState, useMemo } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  Globe,
  Mail,
  Share2,
  Code,
  CheckCircle2,
  Split,
  Gift,
  Layers,
  Settings,
  FileText,
  Webhook,
  TrendingUp,
  ArrowDownRight
} from 'lucide-react';
import type { Node } from '@xyflow/react';
import type {
  PageNodeData,
  AdNodeData,
  SequenceNodeData,
  FormNodeData,
  ThankYouNodeData,
  AbSplitNodeData,
  UpsellNodeData
} from '../../types/journey';
import {
  generateSplitRouterHtml,
  generateLandingPageHtml,
  generateThankYouHtml,
  generateUpsellHtml,
  generateEmailSequenceText,
  generateAdCopyText
} from '../../lib/funnelExportGenerators';
import { ModalDialog } from '../modals/ModalDialog';
import { useFieldIds } from '../../lib/a11yHooks';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  nodes: Node[];
  journeyTitle: string;
  workspaceId?: string;
  journeyId?: string;
}

interface ExportableHtmlPage {
  id: string;
  label: string;
  sublabel: string;
  badge: string;
  filename: string;
  isRouter?: boolean;
  isThankYou?: boolean;
  isUpsell?: boolean;
  isDownsell?: boolean;
  getContent: () => string;
}

// Names the dialog: ModalDialog's aria-labelledby points at the visible heading.
const TITLE_ID = 'jv-export-assets-title';

export const ExportAssetsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  nodes,
  journeyTitle,
  workspaceId,
  journeyId
}) => {
  const [activeTab, setActiveTab] = useState<'page' | 'emails' | 'ads' | 'json'>('page');
  const [copied, setCopied] = useState(false);
  const fid = useFieldIds();
  const [targetAUrl, setTargetAUrl] = useState<string>('');
  const [targetBUrl, setTargetBUrl] = useState<string>('');
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [upsellAcceptUrls, setUpsellAcceptUrls] = useState<Record<string, string>>({});
  const [upsellDeclineUrls, setUpsellDeclineUrls] = useState<Record<string, string>>({});

  // Extract typed nodes from canvas
  const pageNodes = useMemo(() => nodes.filter(n => n.type === 'landing-page'), [nodes]);
  const primaryPageNode = pageNodes[0]?.data as PageNodeData | undefined;
  const splitNode = useMemo(
    () => nodes.find(n => n.type === 'ab-split')?.data as AbSplitNodeData | undefined,
    [nodes]
  );
  const upsellNodes = useMemo(() => nodes.filter(n => n.type === 'upsell'), [nodes]);
  const downsellNode = useMemo(
    () => upsellNodes.find(n => (n.data as UpsellNodeData)?.offerType === 'downsell'),
    [upsellNodes]
  );
  const thankYouNode = useMemo(
    () => nodes.find(n => n.type === 'thank-you')?.data as ThankYouNodeData | undefined,
    [nodes]
  );
  const adNode = useMemo(
    () => nodes.find(n => n.type === 'ad-source')?.data as AdNodeData | undefined,
    [nodes]
  );
  const sequenceNode = useMemo(
    () => nodes.find(n => n.type === 'follow-up-sequence')?.data as SequenceNodeData | undefined,
    [nodes]
  );
  const formNode = useMemo(
    () => nodes.find(n => n.type === 'lead-form')?.data as FormNodeData | undefined,
    [nodes]
  );

  // Default target destination URLs for router
  const defaultTargetA = `./${splitNode?.branchAPageSlug || primaryPageNode?.slug || 'variant-a'}.html`;
  const defaultTargetB = `./${splitNode?.branchBPageSlug || (primaryPageNode?.slug ? `${primaryPageNode.slug}-b` : 'variant-b')}.html`;

  const effectiveTargetA = targetAUrl.trim() || defaultTargetA;
  const effectiveTargetB = targetBUrl.trim() || defaultTargetB;

  // Ingestion Endpoint & Webhook Dual-Sync configuration
  const defaultLeadEndpoint = typeof window !== 'undefined'
    ? `${window.location.origin}/api/public/lead`
    : 'https://jourvance.com/api/public/lead';

  const [leadEndpointUrl, setLeadEndpointUrl] = useState<string>('');
  const [externalWebhookUrl, setExternalWebhookUrl] = useState<string>(primaryPageNode?.webhookUrl || '');

  const effectiveLeadEndpoint = leadEndpointUrl.trim() || defaultLeadEndpoint;
  const effectiveExternalWebhook = externalWebhookUrl.trim();
  const effectiveWorkspaceId = workspaceId || (primaryPageNode as any)?.workspaceId;
  const effectiveJourneyId = journeyId || (primaryPageNode as any)?.journeyId;

  // Build dynamic list of exportable HTML pages
  const exportablePages = useMemo<ExportableHtmlPage[]>(() => {
    const pages: ExportableHtmlPage[] = [];

    // 1. Split Router (Available whenever ab-split exists, or if abTestingEnabled on page, or user has multiple pages)
    const hasSplitCapability = Boolean(splitNode || primaryPageNode?.abTestingEnabled || pageNodes.length > 1);
    if (hasSplitCapability) {
      pages.push({
        id: 'split-router',
        label: splitNode?.label || 'A/B Traffic Split Router',
        sublabel: 'Deterministic sticky client-side redirect',
        badge: `${splitNode?.splitRatio ?? 50}/${100 - (splitNode?.splitRatio ?? 50)} Split`,
        filename: 'split-router.html',
        isRouter: true,
        getContent: () =>
          generateSplitRouterHtml({
            splitNode,
            targetAUrl: effectiveTargetA,
            targetBUrl: effectiveTargetB
          })
      });
    }

    // 2. Landing Pages
    if (splitNode && pageNodes.length >= 2) {
      // Multiple dedicated page nodes connected to split branches
      const nodeA = pageNodes.find(n => n.id === splitNode.branchANodeId) || pageNodes[0];
      const nodeB = pageNodes.find(n => n.id === splitNode.branchBNodeId) || pageNodes[1];

      if (nodeA) {
        const dataA = nodeA.data as PageNodeData;
        pages.push({
          id: 'variant-a',
          label: splitNode.branchALabel || dataA.label || 'Variant A Offer',
          sublabel: dataA.headline || 'Branch A Landing Page',
          badge: 'Variant A',
          filename: `${splitNode.branchAPageSlug || dataA.slug || 'variant-a'}.html`,
          getContent: () =>
            generateLandingPageHtml({
              pageNode: dataA,
              formNode,
              variantOverride: 'a',
              leadEndpointUrl: effectiveLeadEndpoint,
              externalWebhookUrl: effectiveExternalWebhook,
              workspaceId: effectiveWorkspaceId,
              journeyId: effectiveJourneyId
            })
        });
      }

      if (nodeB) {
        const dataB = nodeB.data as PageNodeData;
        pages.push({
          id: 'variant-b',
          label: splitNode.branchBLabel || dataB.label || 'Variant B Offer',
          sublabel: dataB.headline || 'Branch B Landing Page',
          badge: 'Variant B',
          filename: `${splitNode.branchBPageSlug || dataB.slug || 'variant-b'}.html`,
          getContent: () =>
            generateLandingPageHtml({
              pageNode: dataB,
              formNode,
              variantOverride: 'b',
              leadEndpointUrl: effectiveLeadEndpoint,
              externalWebhookUrl: effectiveExternalWebhook,
              workspaceId: effectiveWorkspaceId,
              journeyId: effectiveJourneyId
            })
        });
      }

      // Any additional landing pages beyond branches A & B
      pageNodes.forEach((node, idx) => {
        if (node !== nodeA && node !== nodeB) {
          const d = node.data as PageNodeData;
          pages.push({
            id: `page-${node.id}`,
            label: d.label || `Landing Page ${idx + 1}`,
            sublabel: d.headline || 'Offer Page',
            badge: 'Offer Page',
            filename: `${d.slug || `page-${idx + 1}`}.html`,
            getContent: () =>
              generateLandingPageHtml({
                pageNode: d,
                formNode,
                leadEndpointUrl: effectiveLeadEndpoint,
                externalWebhookUrl: effectiveExternalWebhook,
                workspaceId: effectiveWorkspaceId,
                journeyId: effectiveJourneyId
              })
          });
        }
      });
    } else if (primaryPageNode) {
      if (primaryPageNode.abTestingEnabled && primaryPageNode.variantB) {
        // Single page node configured with Variant B challenger
        pages.push({
          id: 'variant-a',
          label: 'Variant A (Control)',
          sublabel: primaryPageNode.headline || 'Primary Offer Headline',
          badge: 'Variant A',
          filename: `${primaryPageNode.slug || 'variant-a'}.html`,
          getContent: () =>
            generateLandingPageHtml({
              pageNode: primaryPageNode,
              formNode,
              variantOverride: 'a',
              leadEndpointUrl: effectiveLeadEndpoint,
              externalWebhookUrl: effectiveExternalWebhook,
              workspaceId: effectiveWorkspaceId,
              journeyId: effectiveJourneyId
            })
        });
        pages.push({
          id: 'variant-b',
          label: 'Variant B (Challenger)',
          sublabel: primaryPageNode.variantB.headline || primaryPageNode.headline || 'Challenger Offer Headline',
          badge: 'Variant B',
          filename: `${primaryPageNode.slug ? `${primaryPageNode.slug}-b` : 'variant-b'}.html`,
          getContent: () =>
            generateLandingPageHtml({
              pageNode: primaryPageNode,
              formNode,
              variantOverride: 'b',
              leadEndpointUrl: effectiveLeadEndpoint,
              externalWebhookUrl: effectiveExternalWebhook,
              workspaceId: effectiveWorkspaceId,
              journeyId: effectiveJourneyId
            })
        });
        pages.push({
          id: 'single-page-swap',
          label: 'Single-Page Dynamic Swap',
          sublabel: 'Self-contained page with embedded in-DOM switcher',
          badge: 'Smart DOM',
          filename: `${primaryPageNode.slug || 'offer'}-smart.html`,
          getContent: () =>
            generateLandingPageHtml({
              pageNode: primaryPageNode,
              formNode,
              leadEndpointUrl: effectiveLeadEndpoint,
              externalWebhookUrl: effectiveExternalWebhook,
              workspaceId: effectiveWorkspaceId,
              journeyId: effectiveJourneyId
            })
        });
      } else {
        // Standard single landing page or list of pages
        pageNodes.forEach((node, idx) => {
          const d = node.data as PageNodeData;
          pages.push({
            id: `page-${node.id || idx}`,
            label: d.label || (idx === 0 ? 'Primary Landing Page' : `Landing Page ${idx + 1}`),
            sublabel: d.headline || 'High-Converting Offer',
            badge: 'Offer Page',
            filename: `${d.slug || `page-${idx + 1}`}.html`,
            getContent: () =>
              generateLandingPageHtml({
                pageNode: d,
                formNode,
                leadEndpointUrl: effectiveLeadEndpoint,
                externalWebhookUrl: effectiveExternalWebhook,
                workspaceId: effectiveWorkspaceId,
                journeyId: effectiveJourneyId
              })
          });
        });
      }
    }

    // 3. One-Time Offers (Upsell & Downsell OTO Pages)
    upsellNodes.forEach(node => {
      const uData = node.data as UpsellNodeData;
      const isDown = uData.offerType === 'downsell';
      const pageId = `upsell-${node.id}`;
      const defaultFilename = `${uData.slug || (isDown ? 'downsell' : 'upsell')}.html`;

      pages.push({
        id: pageId,
        label: uData.label || (isDown ? 'Downsell Offer (OTO)' : 'Upsell Offer (OTO)'),
        sublabel: uData.headline || (isDown ? 'Discounted Downsell Offer' : 'Exclusive VIP Upgrade'),
        badge: isDown ? 'Downsell (OTO)' : 'Upsell (OTO)',
        filename: defaultFilename,
        isUpsell: true,
        isDownsell: isDown,
        getContent: () =>
          generateUpsellHtml({
            upsellNode: uData,
            thankYouNode,
            downsellNode: downsellNode ? (downsellNode.data as UpsellNodeData) : undefined,
            targetAcceptUrl: upsellAcceptUrls[pageId],
            targetDeclineUrl: upsellDeclineUrls[pageId],
            storeDomain: (primaryPageNode as any)?.shopifyConfig?.storeDomain
          })
      });
    });

    // 4. VIP Thank-You Portal
    if (thankYouNode) {
      pages.push({
        id: 'thank-you',
        label: thankYouNode.label || 'VIP Order Confirmation Portal',
        sublabel: thankYouNode.headline || 'Onboarding & Discount Courtesy Voucher',
        badge: 'VIP Portal',
        filename: `${thankYouNode.slug || 'thank-you'}.html`,
        isThankYou: true,
        getContent: () => generateThankYouHtml({ thankYouNode })
      });
    }

    return pages;
  }, [
    splitNode,
    primaryPageNode,
    pageNodes,
    upsellNodes,
    downsellNode,
    effectiveTargetA,
    effectiveTargetB,
    formNode,
    thankYouNode,
    effectiveLeadEndpoint,
    effectiveExternalWebhook,
    effectiveWorkspaceId,
    effectiveJourneyId,
    upsellAcceptUrls,
    upsellDeclineUrls
  ]);

  const [selectedPageId, setSelectedPageId] = useState<string>('split-router');

  // Ensure active page points to an existing item
  const activeHtmlPage = useMemo(() => {
    return exportablePages.find(p => p.id === selectedPageId) || exportablePages[0];
  }, [exportablePages, selectedPageId]);

  if (!isOpen) return null;

  // Retrieve current content for preview & download
  const getCurrentContent = () => {
    switch (activeTab) {
      case 'page':
        return activeHtmlPage ? activeHtmlPage.getContent() : '<!-- No pages found on canvas -->';
      case 'emails':
        return generateEmailSequenceText({ sequenceNode });
      case 'ads':
        return generateAdCopyText({
          adNode,
          destinationUrl: primaryPageNode?.publishedUrl || (splitNode ? './split-router.html' : './variant-a.html')
        });
      case 'json':
        return JSON.stringify({ title: journeyTitle, exportedAt: new Date().toISOString(), nodes }, null, 2);
    }
  };

  const downloadBlob = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getCurrentContent());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const content = getCurrentContent();
    let filename = `${journeyTitle.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    let mimeType = 'text/plain';

    if (activeTab === 'page') {
      filename = activeHtmlPage ? activeHtmlPage.filename : `${filename}-page.html`;
      mimeType = 'text/html';
    } else if (activeTab === 'emails') {
      filename += '-email-sequence.txt';
    } else if (activeTab === 'ads') {
      filename += '-ad-copy-utms.txt';
    } else if (activeTab === 'json') {
      filename += '-blueprint.json';
      mimeType = 'application/json';
    }

    downloadBlob(filename, content, mimeType);
  };

  const handleDownloadAllPages = async () => {
    if (exportablePages.length === 0) return;
    setIsDownloadingAll(true);
    try {
      for (let i = 0; i < exportablePages.length; i++) {
        const page = exportablePages[i];
        downloadBlob(page.filename, page.getContent(), 'text/html');
        // Minor delay to prevent browser download flood throttling
        await new Promise(resolve => setTimeout(resolve, 220));
      }
    } finally {
      setTimeout(() => setIsDownloadingAll(false), 1000);
    }
  };

  return (
    <ModalDialog bare labelledBy={TITLE_ID} onClose={onClose} maxWidth={880} fallbackFocusSelectors={['[data-more-trigger]']}>
      <div
        style={{
          backgroundColor: '#0F172A',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '18px',
          width: '100%',
          maxWidth: '880px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.7)',
          // On a phone the wrapped tabs and strips can outgrow the panel, which then scrolls
          // rather than cutting off the footer.
          overflowX: 'hidden',
          overflowY: 'auto'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.4rem 1.75rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#111C33'
          }}
        >
          <div>
            <span
              style={{
                fontSize: '0.725rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                color: '#818CF8',
                letterSpacing: '0.08em'
              }}
            >
              Self-Hosted Funnel Export Engine
            </span>
            <h2 id={TITLE_ID} style={{ fontSize: '1.35rem', fontWeight: 800, color: '#FFFFFF', marginTop: '0.2rem' }}>
              Export Production Assets
            </h2>
            <p style={{ fontSize: '0.825rem', color: '#94A3B8' }}>
              Export complete, deterministic A/B split funnels, email automations, and ad links for zero-cost self-hosting.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close export modal"
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: 'none',
              borderRadius: '8px',
              padding: '0.5rem',
              color: '#94A3B8',
              cursor: 'pointer'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Primary Tabs: they wrap on a phone rather than scroll out of the panel. */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 1.75rem',
            backgroundColor: '#0B1120',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
          }}
        >
          <button
            onClick={() => setActiveTab('page')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              backgroundColor: activeTab === 'page' ? '#6366F1' : 'transparent',
              color: activeTab === 'page' ? '#FFFFFF' : '#94A3B8'
            }}
          >
            <Globe size={15} />
            <span>HTML Funnel Pages ({exportablePages.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('emails')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              backgroundColor: activeTab === 'emails' ? '#6366F1' : 'transparent',
              color: activeTab === 'emails' ? '#FFFFFF' : '#94A3B8'
            }}
          >
            <Mail size={15} />
            <span>Email Sequence</span>
          </button>

          <button
            onClick={() => setActiveTab('ads')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              backgroundColor: activeTab === 'ads' ? '#6366F1' : 'transparent',
              color: activeTab === 'ads' ? '#FFFFFF' : '#94A3B8'
            }}
          >
            <Share2 size={15} />
            <span>Ad Copy + UTMs</span>
          </button>

          <button
            onClick={() => setActiveTab('json')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              backgroundColor: activeTab === 'json' ? '#6366F1' : 'transparent',
              color: activeTab === 'json' ? '#FFFFFF' : '#94A3B8'
            }}
          >
            <Code size={15} />
            <span>JSON Blueprint</span>
          </button>
        </div>

        {/* Sub-Navigation Pill Bar (when viewing HTML Funnel Pages) */}
        {activeTab === 'page' && exportablePages.length > 0 && (
          <div
            style={{
              padding: '0.75rem 1.75rem',
              backgroundColor: 'rgba(15, 23, 42, 0.7)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.6rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#64748B', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginRight: '0.25rem', whiteSpace: 'nowrap' }}>
              <Layers size={13} />
              <span>Funnel Pages:</span>
            </div>

            {exportablePages.map(page => {
              const isSelected = (activeHtmlPage?.id === page.id);
              return (
                <button
                  key={page.id}
                  onClick={() => setSelectedPageId(page.id)}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: '0.45rem',
                    maxWidth: '100%',
                    textAlign: 'left',
                    padding: '0.4rem 0.75rem',
                    borderRadius: '8px',
                    fontSize: '0.775rem',
                    fontWeight: isSelected ? 700 : 500,
                    border: isSelected ? '1px solid #6366F1' : '1px solid rgba(255, 255, 255, 0.08)',
                    backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                    color: isSelected ? '#FFFFFF' : '#94A3B8',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {page.isRouter ? (
                    <Split size={13} color={isSelected ? '#818CF8' : '#64748B'} />
                  ) : page.isThankYou ? (
                    <Gift size={13} color={isSelected ? '#34D399' : '#64748B'} />
                  ) : page.isUpsell ? (
                    page.isDownsell ? (
                      <ArrowDownRight size={13} color={isSelected ? '#F59E0B' : '#64748B'} />
                    ) : (
                      <TrendingUp size={13} color={isSelected ? '#F59E0B' : '#64748B'} />
                    )
                  ) : (
                    <FileText size={13} color={isSelected ? '#60A5FA' : '#64748B'} />
                  )}
                  <span>{page.label}</span>
                  <span
                    style={{
                      fontSize: '0.6875rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      backgroundColor: 'rgba(0, 0, 0, 0.3)',
                      padding: '0.1rem 0.35rem',
                      borderRadius: '4px',
                      overflowWrap: 'anywhere',
                      color: isSelected ? '#C7D2FE' : '#64748B'
                    }}
                  >
                    {page.filename}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Router Target URL Configuration Strip (shown only when split-router is selected) */}
        {activeTab === 'page' && activeHtmlPage?.isRouter && (
          <div
            style={{
              padding: '0.85rem 1.75rem',
              backgroundColor: 'rgba(99, 102, 241, 0.06)',
              borderBottom: '1px solid rgba(99, 102, 241, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.65rem'
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.25rem 1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#C7D2FE', fontSize: '0.8rem', fontWeight: 700 }}>
                <Settings size={14} color="#818CF8" />
                <span>Router Target Destination URLs (Self-Hosted Path or Full CDN URL)</span>
              </div>
              <span style={{ fontSize: '0.725rem', color: '#94A3B8' }}>
                Pre-configured for local side-by-side files or remote hosting
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '0.85rem' }}>
              <div>
                <label htmlFor={fid('branch-a')} style={{ display: 'block', fontSize: '0.725rem', fontWeight: 600, color: '#94A3B8', marginBottom: '0.25rem' }}>
                  Branch A Destination ({splitNode?.branchALabel || 'Variant A'})
                </label>
                <input
                  id={fid('branch-a')}
                  type="text"
                  value={targetAUrl}
                  placeholder={defaultTargetA}
                  onChange={e => setTargetAUrl(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.45rem 0.65rem',
                    borderRadius: '6px',
                    backgroundColor: '#070A12',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#F8FAFC',
                    fontSize: '0.8rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <label htmlFor={fid('branch-b')} style={{ display: 'block', fontSize: '0.725rem', fontWeight: 600, color: '#94A3B8', marginBottom: '0.25rem' }}>
                  Branch B Destination ({splitNode?.branchBLabel || 'Variant B'})
                </label>
                <input
                  id={fid('branch-b')}
                  type="text"
                  value={targetBUrl}
                  placeholder={defaultTargetB}
                  onChange={e => setTargetBUrl(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.45rem 0.65rem',
                    borderRadius: '6px',
                    backgroundColor: '#070A12',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#F8FAFC',
                    fontSize: '0.8rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    outline: 'none'
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Lead Ingestion & Webhook Dual-Sync Configuration Strip (shown on landing page variants) */}
        {activeTab === 'page' && activeHtmlPage && !activeHtmlPage.isRouter && !activeHtmlPage.isThankYou && !activeHtmlPage.isUpsell && (
          <div
            style={{
              padding: '0.85rem 1.75rem',
              backgroundColor: 'rgba(16, 185, 129, 0.06)',
              borderBottom: '1px solid rgba(16, 185, 129, 0.18)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.65rem'
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.25rem 1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#6EE7B7', fontSize: '0.8rem', fontWeight: 700 }}>
                <Webhook size={14} color="#10B981" />
                <span>Lead Ingestion & Webhook Dual-Sync (Self-Hosted Integration)</span>
              </div>
              <span style={{ fontSize: '0.725rem', color: '#94A3B8' }}>
                Saves to Jourvance CRM + triggers drips + relays to your external webhook
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '0.85rem' }}>
              <div>
                <label htmlFor={fid('lead-endpoint')} style={{ display: 'block', fontSize: '0.725rem', fontWeight: 600, color: '#94A3B8', marginBottom: '0.25rem' }}>
                  Jourvance Ingestion Endpoint (CORS Enabled)
                </label>
                <input
                  id={fid('lead-endpoint')}
                  type="text"
                  value={leadEndpointUrl}
                  placeholder={defaultLeadEndpoint}
                  onChange={e => setLeadEndpointUrl(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.45rem 0.65rem',
                    borderRadius: '6px',
                    backgroundColor: '#070A12',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#F8FAFC',
                    fontSize: '0.8rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <label htmlFor={fid('webhook-relay')} style={{ display: 'block', fontSize: '0.725rem', fontWeight: 600, color: '#94A3B8', marginBottom: '0.25rem' }}>
                  External Webhook Relay (Optional: Zapier, Make or Klaviyo)
                </label>
                <input
                  id={fid('webhook-relay')}
                  type="text"
                  value={externalWebhookUrl}
                  placeholder="https://hooks.zapier.com/hooks/catch/..."
                  onChange={e => setExternalWebhookUrl(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.45rem 0.65rem',
                    borderRadius: '6px',
                    backgroundColor: '#070A12',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#F8FAFC',
                    fontSize: '0.8rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    outline: 'none'
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Upsell / Downsell OTO Target URL Configuration Strip */}
        {activeTab === 'page' && activeHtmlPage?.isUpsell && (
          <div
            style={{
              padding: '0.85rem 1.75rem',
              backgroundColor: 'rgba(245, 158, 11, 0.06)',
              borderBottom: '1px solid rgba(245, 158, 11, 0.18)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.65rem'
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.25rem 1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#FCD34D', fontSize: '0.8rem', fontWeight: 700 }}>
                {activeHtmlPage.isDownsell ? (
                  <ArrowDownRight size={14} color="#F59E0B" />
                ) : (
                  <TrendingUp size={14} color="#F59E0B" />
                )}
                <span>Post-Purchase {activeHtmlPage.isDownsell ? 'Downsell' : 'Upsell'} Offer Destination Routing</span>
              </div>
              <span style={{ fontSize: '0.725rem', color: '#94A3B8' }}>
                Pre-configured for 1-click Shopify checkout or multi-step funnel paths
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '0.85rem' }}>
              <div>
                <label htmlFor={fid('accept-url')} style={{ display: 'block', fontSize: '0.725rem', fontWeight: 600, color: '#94A3B8', marginBottom: '0.25rem' }}>
                  Accept Checkout Destination (Cart URL / Variant)
                </label>
                <input
                  id={fid('accept-url')}
                  type="text"
                  value={upsellAcceptUrls[activeHtmlPage.id] || ''}
                  placeholder="./thank-you.html (or Shopify /cart/variantId:1)"
                  onChange={e =>
                    setUpsellAcceptUrls(prev => ({ ...prev, [activeHtmlPage.id]: e.target.value }))
                  }
                  style={{
                    width: '100%',
                    padding: '0.45rem 0.65rem',
                    borderRadius: '6px',
                    backgroundColor: '#070A12',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#F8FAFC',
                    fontSize: '0.8rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <label htmlFor={fid('decline-url')} style={{ display: 'block', fontSize: '0.725rem', fontWeight: 600, color: '#94A3B8', marginBottom: '0.25rem' }}>
                  Decline Destination URL ({activeHtmlPage.isDownsell ? 'Thank-You Portal' : 'Downsell Offer or Portal'})
                </label>
                <input
                  id={fid('decline-url')}
                  type="text"
                  value={upsellDeclineUrls[activeHtmlPage.id] || ''}
                  placeholder={activeHtmlPage.isDownsell ? './thank-you.html' : './downsell.html'}
                  onChange={e =>
                    setUpsellDeclineUrls(prev => ({ ...prev, [activeHtmlPage.id]: e.target.value }))
                  }
                  style={{
                    width: '100%',
                    padding: '0.45rem 0.65rem',
                    borderRadius: '6px',
                    backgroundColor: '#070A12',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#F8FAFC',
                    fontSize: '0.8rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    outline: 'none'
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Code/Text Viewer Box */}
        <div style={{ flex: '1 1 auto', minHeight: '12rem', padding: '1.25rem 1.75rem', overflowY: 'auto' }}>
          <div
            style={{
              backgroundColor: '#070A12',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              padding: '1.25rem',
              maxHeight: '380px',
              overflowY: 'auto'
            }}
          >
            <pre
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.8rem',
                color: '#E2E8F0',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.5
              }}
            >
              {getCurrentContent()}
            </pre>
          </div>
        </div>

        {/* Action Footer: the buttons move under the status line on a phone. */}
        <div
          style={{
            padding: '1.2rem 1.75rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            backgroundColor: '#0B1120'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#10B981',
              fontSize: '0.825rem',
              fontWeight: 600
            }}
          >
            <CheckCircle2 size={16} />
            <span>
              {activeTab === 'page'
                ? `${exportablePages.length} production page file${exportablePages.length !== 1 ? 's' : ''} ready for zero-cost self-hosting`
                : 'Ready to publish & launch'}
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem', maxWidth: '100%' }}>
            <button
              onClick={handleCopy}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.65rem 1.15rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#FFFFFF',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {copied ? <Check size={16} color="#10B981" /> : <Copy size={16} />}
              <span>{copied ? 'Copied to Clipboard' : 'Copy Code'}</span>
            </button>

            {activeTab === 'page' && exportablePages.length > 1 && (
              <button
                onClick={handleDownloadAllPages}
                disabled={isDownloadingAll}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.65rem 1.15rem',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(99, 102, 241, 0.18)',
                  border: '1px solid rgba(99, 102, 241, 0.4)',
                  color: '#C7D2FE',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: isDownloadingAll ? 'not-allowed' : 'pointer'
                }}
              >
                <Download size={15} />
                <span>{isDownloadingAll ? 'Downloading Files...' : `Download All (${exportablePages.length})`}</span>
              </button>
            )}

            <button
              onClick={handleDownload}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                maxWidth: '100%',
                textAlign: 'left',
                padding: '0.65rem 1.25rem',
                borderRadius: '8px',
                backgroundColor: '#6366F1',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)'
              }}
            >
              <Download size={16} style={{ flexShrink: 0 }} />
              <span style={{ overflowWrap: 'anywhere' }}>
                Download {activeTab === 'page' && activeHtmlPage ? activeHtmlPage.filename : 'File'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
};
