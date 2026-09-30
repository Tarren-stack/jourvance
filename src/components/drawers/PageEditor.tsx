import React, { useState, useEffect, useId, useRef } from 'react';
import {
  Sparkles, RefreshCw, Plus, Trash2, Globe, ExternalLink,
  ShoppingBag, Link2, CheckCircle2, Copy, Check, Tag,
  Activity, Eye, Share2, Zap, GitFork, Clock, ShieldAlert, ShieldCheck, Star
} from 'lucide-react';
import type { PageNodeData, PageVariantData, Workspace, ShopifyProduct } from '../../types/journey';
import { requestAICopyAnswer } from '../../lib/hubClient';
import {
  readCopyAnswer,
  planCopyRows,
  applyCopyRows,
  copyGoal,
  initialFocus,
  joinLabels,
  COPY_FIELD_LABELS,
  type CopyField,
  type CopyTarget,
  type SuggestedCopy
} from '../../lib/pageCopyProposal';
import { buttonTextForProduct } from '../../lib/productButtonText';
import {
  PAGE_EDITOR_SECTIONS,
  sectionSummary,
  parseOpenSections,
  toggleSection,
  PAGE_FIELD_IDS,
  OPEN_SECTIONS_STORAGE_KEY,
  type SectionId
} from '../../lib/pageEditorSections';
import { EditorSection } from './EditorSection';
import { CopyProposalCard } from './CopyProposalCard';
import { fetchShopifyProducts, buildCheckoutPermalink, buildMultiItemCheckoutPermalink } from '../../lib/shopifyClient';
import { authHeaders } from '../../lib/firebase';
import { requestAnswer } from '../../lib/saveOutcome';
import { dnsCheckOutcome, dnsVerdictDetail, type DnsCheckOutcome } from '../../lib/dnsCheckOutcome';
import { ShopifyProductPickerModal, type SelectedProductPayload } from '../modals/ShopifyProductPickerModal';
import { useFieldIds } from '../../lib/a11yHooks';
import { isDemoVariantId } from '../../lib/productPickerCatalog';
import { orderBumpPriceText, NO_BUMP_PRICE } from '../../lib/orderBumpPrice';
import {
  previewPageCopy,
  NEW_BENEFIT,
  BENEFIT_HINT,
  SOCIAL_PROOF_FALLBACK,
  URGENCY_FALLBACK
} from '../../lib/pagePreviewCopy';
import {
  SUPPORTED_CURRENCIES,
  convertCurrencyCharm,
  type CurrencyCode
} from '../../lib/geoCurrency';

interface Props {
  data: PageNodeData;
  onChange: (updated: PageNodeData) => void;
  offerHeadline: string;
  businessType: string;
  workspace?: Workspace | null;
  onOpenShopifyConnect?: () => void;
  // The step being edited. The inspector reuses one PageEditor across landing-page steps, so this
  // is what lets a pending AI reply and the variant tab be dropped when the step changes.
  nodeId?: string;
  // The journey this page belongs to. Check DNS names it, so a verified domain goes to this
  // journey's page and never to another journey of the same account asking for it (R26).
  journeyId?: string;
}

const sectionTitle = (id: SectionId) => PAGE_EDITOR_SECTIONS.find(s => s.id === id)?.title ?? id;

export const PageEditor: React.FC<Props> = ({
  data,
  onChange,
  offerHeadline,
  businessType,
  workspace,
  onOpenShopifyConnect,
  nodeId,
  journeyId
}) => {
  const [loadingAI, setLoadingAI] = useState(false);
  const [editorTab, setEditorTab] = useState<'settings' | 'preview'>('settings');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [previewCurrency, setPreviewCurrency] = useState<CurrencyCode>('USD');
  const [syncingDisc, setSyncingDisc] = useState(false);
  const [discSyncedMsg, setDiscSyncedMsg] = useState<string | null>(null);
  const [discSyncError, setDiscSyncError] = useState<string | null>(null);
  const [previewBumpChecked, setPreviewBumpChecked] = useState(false);
  const [previewViewMode, setPreviewViewMode] = useState<'page' | 'modal'>('page');
  const [activeVariantTab, setActiveVariantTab] = useState<'a' | 'b'>('a');
  const [previewVariant, setPreviewVariant] = useState<'a' | 'b'>('a');
  // Version B is only editable while the test is on. The tab state alone would keep editing a
  // hidden version B after A/B was turned off.
  const editingB = Boolean(data.abTestingEnabled) && activeVariantTab === 'b';
  const pageWordsHeadingId = useId();
  // Ties each label to its control, unique per mounted editor.
  const fid = useFieldIds();

  // Which settings sections this viewer keeps open. A convenience, so a blocked or broken
  // localStorage only means every section starts closed.
  const [openSections, setOpenSections] = useState<SectionId[]>(() => {
    try {
      return parseOpenSections(localStorage.getItem(OPEN_SECTIONS_STORAGE_KEY));
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_SECTIONS_STORAGE_KEY, JSON.stringify(openSections));
    } catch {
      // Storage blocked: the sections still work for this session.
    }
  }, [openSections]);

  // AI copy is a proposal until the person keeps it. `aiRequest` numbers each request so a reply
  // that lands after a step switch or after the inspector closed is dropped.
  const [proposal, setProposal] = useState<{ target: CopyTarget; copy: SuggestedCopy } | null>(null);
  const [aiNotice, setAiNotice] = useState('');
  const [selectedFields, setSelectedFields] = useState<CopyField[]>([]);
  const aiRequest = useRef(0);
  const writeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setProposal(null);
    setAiNotice('');
    setLoadingAI(false);
    setActiveVariantTab('a');
    return () => {
      aiRequest.current++;
    };
  }, [nodeId]);

  useEffect(() => {
    if (proposal?.target === 'b' && !data.abTestingEnabled) setProposal(null);
  }, [data.abTestingEnabled]);

  // Custom Domain & DNS Check (Wave 3). Only a real answer from the check may say whether the
  // CNAME matches: a failed request says the check did not run (dnsCheckOutcome, U03).
  // `dnsRequest` numbers each check so an answer for an address since edited, or for another
  // step, is dropped.
  const [checkingDns, setCheckingDns] = useState(false);
  const [dnsOutcome, setDnsOutcome] = useState<DnsCheckOutcome | null>(null);
  const dnsRequest = useRef(0);
  const checkDnsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    dnsRequest.current++;
    setDnsOutcome(null);
    setCheckingDns(false);
  }, [nodeId]);

  const handleCheckDns = async (fromRetry = false) => {
    // aria-disabled rather than disabled while checking: a disabled button drops keyboard focus.
    if (!data.customDomain || checkingDns) return;
    const request = ++dnsRequest.current;
    setCheckingDns(true);
    const journeyParam = journeyId ? `&journeyId=${encodeURIComponent(journeyId)}` : '';
    let headers: Record<string, string> = {};
    try {
      headers = await authHeaders();
    } catch {
      // No token to send: the server answers 401 and the panel says to sign in.
    }
    const answer = await requestAnswer(`/api/domain/verify?domain=${encodeURIComponent(data.customDomain)}${journeyParam}`, { headers });
    if (request !== dnsRequest.current) return;
    const outcome = dnsCheckOutcome(answer);
    setDnsOutcome(outcome);
    setCheckingDns(false);
    if (outcome.kind === 'verdict' && outcome.result.verified) {
      handleFieldChange('customDomainVerified', true);
    }
    // Retry leaves with the refusal it answered, so focus goes back to Check DNS rather than to
    // the page body.
    if (fromRetry && !(outcome.kind === 'refused' && outcome.retryable)) {
      requestAnimationFrame(() => checkDnsButtonRef.current?.focus());
    }
  };

  // Shopify Product Integration
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedLiveUrl, setCopiedLiveUrl] = useState(false);
  const [isPrimaryPickerOpen, setIsPrimaryPickerOpen] = useState(false);
  const [isBumpPickerOpen, setIsBumpPickerOpen] = useState(false);

  // The host this app answers on, the same origin livePageUrl uses.
  const pageHost = typeof window !== 'undefined' ? window.location.host : '';
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
  // With no store the page publishes only the email form, whatever the checkout mode, and names no
  // voucher or checkout (publicRoutes leadOnly and leadHasCode, R18). The preview says the same.
  const leadOnly = !storeDomain;
  const leadHasCode = !!data.discountCode && !leadOnly;
  const hasLeadModal = data.checkoutMode === 'lead-gate' || leadOnly;
  const showModalScreen = previewViewMode === 'modal' && hasLeadModal;

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

  // The percent a synced Shopify code takes off. The user states it: the sync used to create
  // every code at a hard-coded 20% whatever the page said (C18 follow-up).
  const discountPercent = Number(data.discountPercentage) || 0;
  const discountPercentOk = Number.isInteger(discountPercent) && discountPercent >= 1 && discountPercent <= 99;

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
      // The headline stays the person's own: a pick used to write "Add <title> for Special Savings",
      // an offer nobody made (R14). The description may take the store's own product text.
      orderBumpHeadline: data.orderBumpHeadline,
      orderBumpDescription: data.orderBumpDescription || p.description || ''
    });
  };

  const handleBulletChange = (idx: number, val: string) => {
    const updated = [...(data.bullets || [])];
    updated[idx] = val;
    handleFieldChange('bullets', updated);
  };

  const addBullet = () => {
    // An empty benefit with a hint, as the upsell editor adds: an instruction stored as a value
    // read as page copy in the editor and the preview (R19).
    handleFieldChange('bullets', [...(data.bullets || []), NEW_BENEFIT]);
  };

  // Add Point puts focus in the new empty benefit, so a keyboard user types it straight away (U03).
  // The index waits here until the render that draws that input; a step or variant switch drops it.
  const bulletGroupRef = useRef<HTMLDivElement>(null);
  const focusBulletAt = useRef<number | null>(null);
  useEffect(() => {
    const idx = focusBulletAt.current;
    if (idx === null) return;
    const input = bulletGroupRef.current?.querySelectorAll<HTMLInputElement>('input[type="text"]')[idx];
    if (input) {
      focusBulletAt.current = null;
      input.focus();
    }
  });
  useEffect(() => {
    focusBulletAt.current = null;
  }, [nodeId, activeVariantTab]);

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

  const handlePrimaryProductPicked = ({ product, variant }: SelectedProductPayload) => {
    const isDefaultHeadline = !data.headline || data.headline === 'Bioactive Triple Barrier Restorative Crème' || data.headline === 'New Product Offer';
    onChange({
      ...data,
      shopifyProductId: product.id,
      shopifyVariantId: variant.id,
      shopifyProductTitle: product.title,
      shopifyProductPrice: variant.price || product.price,
      shopifyProductImage: product.imageUrl,
      heroImageUrl: product.imageUrl || data.heroImageUrl,
      headline: isDefaultHeadline ? product.title : data.headline,
      subhead: (!data.subhead || data.subhead.includes('Ceramide NP')) && product.description ? product.description : data.subhead,
      buttonText: buttonTextForProduct(data.buttonText, data.checkoutMode, variant.price || product.price)
    });
  };

  const handleBumpProductPicked = ({ product, variant }: SelectedProductPayload) => {
    const variantSuffix = variant.title && variant.title !== 'Default' ? ` (${variant.title})` : '';
    onChange({
      ...data,
      orderBumpProductId: product.id,
      orderBumpVariantId: variant.id,
      orderBumpTitle: `${product.title}${variantSuffix}`,
      orderBumpPrice: variant.price || product.price,
      orderBumpImage: product.imageUrl,
      // The person's own headline, or none: the pick names the product in the title above (R14).
      orderBumpHeadline: data.orderBumpHeadline
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
      buttonText: buttonTextForProduct(data.buttonText, data.checkoutMode, price)
    });
  };

  // One AI action for the version being edited. It never writes: a real answer becomes a review
  // card, and anything else (template copy, the hourly limit, a 401, no answer) is one sentence.
  const requestSuggestion = async () => {
    const target: CopyTarget = editingB ? 'b' : 'a';
    const ticket = ++aiRequest.current;
    setAiNotice('');
    setProposal(null);
    setLoadingAI(true);
    try {
      const answer = await requestAICopyAnswer({
        nodeType: 'page',
        businessType: businessType || 'E-Commerce Brand',
        offerHeadline: selectedProduct?.title || data.headline || offerHeadline,
        goal: copyGoal(target)
      });
      // The step changed or the inspector closed while this was in flight.
      if (ticket !== aiRequest.current) return;
      const read = readCopyAnswer(answer as { status: number; body: any } | null);
      if (read.kind === 'unavailable') {
        setAiNotice(read.message);
        return;
      }
      const rows = planCopyRows(data, target, read.copy);
      if (rows.length === 0) {
        setAiNotice('The suggestion matches your current copy. Nothing was changed.');
        return;
      }
      setProposal({ target, copy: read.copy });
      setSelectedFields(rows.map(r => r.field));
    } finally {
      if (ticket === aiRequest.current) setLoadingAI(false);
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

  const copyPermalink = () => {
    navigator.clipboard.writeText(currentCheckoutUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const isPreviewB = Boolean(data.abTestingEnabled && previewVariant === 'b' && data.variantB);
  // The preview shows the published page's words and nothing else; where the page shows nothing
  // it shows a muted hint (previewHint), never copy of its own (T12). That includes the product's
  // price tag and image, which the page drops for a placeholder product.
  const pageCopy = previewPageCopy(data, isPreviewB ? data.variantB : null);
  const previewHeroImage = pageCopy.heroImage;
  const previewLeadHasCode = !!pageCopy.discountCode && !leadOnly;
  // An editor note inside the mockup: italic in a dashed box, so it never reads as page copy.
  const previewHint = (text: string, marginBottom = '12px') => (
    <p style={{ margin: `0 0 ${marginBottom}`, padding: '4px 8px', border: '1px dashed rgba(148, 163, 184, 0.45)', borderRadius: '6px', fontSize: '11px', fontStyle: 'italic', color: '#94A3B8', lineHeight: 1.4 }}>
      {text}
    </p>
  );

  // Planned from the live data on every render, so "Now" is what the field holds this moment and a
  // card whose every row now matches simply disappears.
  const proposalRows = proposal ? planCopyRows(data, proposal.target, proposal.copy) : [];

  // Applies the kept rows onto the CURRENT data prop in one onChange, so text typed while the
  // request ran survives and the undo history records one step.
  const applyProposal = () => {
    if (!proposal) return;
    const fields = selectedFields.filter(f => proposalRows.some(r => r.field === f));
    if (fields.length > 0) onChange(applyCopyRows(data, proposal.target, proposal.copy, fields));
    setProposal(null);
    setAiNotice(fields.length > 0 ? `Updated ${joinLabels(fields.map(f => COPY_FIELD_LABELS[f]))}.` : '');
    writeButtonRef.current?.focus();
  };

  const keepCopy = () => {
    setProposal(null);
    writeButtonRef.current?.focus();
  };

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
          aria-pressed={editorTab === 'settings'}
          style={{
            flex: 1,
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: editorTab === 'settings' ? '#db2777' : 'transparent',
            color: editorTab === 'settings' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          Edit page
        </button>
        <button
          type="button"
          onClick={() => setEditorTab('preview')}
          aria-pressed={editorTab === 'preview'}
          style={{
            flex: 1,
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: editorTab === 'preview' ? '#db2777' : 'transparent',
            color: editorTab === 'preview' ? '#FFFFFF' : '#94A3B8',
            transition: 'all 0.15s ease'
          }}
        >
          Preview
        </button>
      </div>

      {editorTab === 'preview' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Device & Mode Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', flexWrap: 'wrap', gap: '6px' }}>
            <div role="group" aria-labelledby={fid('preview-device')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span id={fid('preview-device')} style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>Device:</span>
              <button
                type="button"
                onClick={() => setPreviewDevice('desktop')}
                aria-pressed={previewDevice === 'desktop'}
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
                aria-pressed={previewDevice === 'mobile'}
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
              <div role="group" aria-labelledby={fid('preview-variant')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span id={fid('preview-variant')} style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>Variant:</span>
                <button
                  type="button"
                  onClick={() => setPreviewVariant('a')}
                  aria-pressed={previewVariant === 'a'}
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
                  aria-pressed={previewVariant === 'b'}
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

            {hasLeadModal && (
              <div role="group" aria-labelledby={fid('preview-screen')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span id={fid('preview-screen')} style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>Screen:</span>
                <button
                  type="button"
                  onClick={() => setPreviewViewMode('page')}
                  aria-pressed={previewViewMode === 'page'}
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
                  aria-pressed={previewViewMode === 'modal'}
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

            {/* Currency Preview Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span id={fid('preview-currency')} style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>Currency:</span>
              <select
                aria-labelledby={fid('preview-currency')}
                value={previewCurrency}
                onChange={e => setPreviewCurrency(e.target.value as CurrencyCode)}
                style={{
                  padding: '2px 6px',
                  borderRadius: '5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  backgroundColor: '#0F172A',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#FFFFFF',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                {Object.values(SUPPORTED_CURRENCIES).map(c => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.code}
                  </option>
                ))}
              </select>
              <a
                href={`/p/${data.slug || 'offer'}?preview=true&currency=${previewCurrency}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 7px',
                  borderRadius: '5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  backgroundColor: 'rgba(236, 72, 153, 0.15)',
                  border: '1px solid rgba(236, 72, 153, 0.35)',
                  color: '#F472B6',
                  textDecoration: 'none',
                  transition: 'all 0.15s ease'
                }}
                title="Launch interactive Geo-Pricing Simulator toolbar in a new tab"
              >
                <ExternalLink size={10} />
                <span>Simulate ({previewCurrency})</span>
              </a>
            </div>
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
              <span style={{ fontSize: '11px', color: '#94A3B8', marginLeft: '6px', fontFamily: 'monospace' }}>
                {pageHost}/p/{data.slug || 'offer'}{showModalScreen ? ' [2-Step Modal]' : ''}{data.abTestingEnabled ? ` [Variant ${previewVariant.toUpperCase()}]` : ''}
              </span>
            </div>

            {/* Top Announcement Bar */}
            {pageCopy.discountCode ? (
              <div style={{ background: 'linear-gradient(90deg, #ec4899, #db2777, #9333ea)', color: '#FFFFFF', fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'center', padding: '4px 8px' }}>
                Code {pageCopy.discountCode} is ready at checkout
              </div>
            ) : null}

            {/* Urgency Reservation Bar */}
            {pageCopy.urgency ? (
              <div style={{ background: 'linear-gradient(90deg, rgba(236, 72, 153, 0.16) 0%, rgba(147, 51, 234, 0.12) 50%, rgba(236, 72, 153, 0.16) 100%)', borderBottom: '1px solid rgba(236, 72, 153, 0.28)', padding: '5px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '11px', color: '#FCE7F3' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#F472B6', boxShadow: '0 0 6px #EC4899' }} />
                <span>{pageCopy.urgency.text}</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#F472B6', background: 'rgba(236, 72, 153, 0.2)', padding: '1px 5px', borderRadius: '4px' }}>
                  {`${String(pageCopy.urgency.minutes).padStart(2, '0')}:00`}
                </span>
              </div>
            ) : data.urgencyTimerEnabled ? (
              <div style={{ padding: '6px 10px 0' }}>{previewHint('The countdown shows once it has minutes set.', '0')}</div>
            ) : null}

            {showModalScreen ? (
              /* Modal Mockup: the same words the published modal uses, which name a discount only when
                 the page has a code and a store, and ask only for an email when there is no store */
              <div style={{ padding: '20px 16px', backgroundColor: '#0B0F19', textAlign: 'center' }}>
                {previewLeadHasCode ? (<span
                  style={{
                    display: 'inline-block',
                    fontSize: '11px',
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
                  VIP Access
                </span>) : null}
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#FFFFFF', marginBottom: leadOnly ? '14px' : '4px' }}>
                  {previewLeadHasCode ? 'Unlock Your Exclusive Discount' : leadOnly ? 'Leave your email' : 'Continue to checkout'}
                </h3>
                {!leadOnly && (
                  <p style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '14px' }}>
                    {previewLeadHasCode
                      ? <>Enter your email to claim your <strong>{pageCopy.discountCode}</strong> coupon and route straight to checkout.</>
                      : 'Enter your email to go straight to checkout.'}
                  </p>
                )}

                {/* The published form's three fields, with its own placeholders */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                  {[
                    { type: 'text', label: 'Full name', hint: 'Your Full Name (optional)' },
                    { type: 'email', label: 'Email address', hint: 'Your Best Email Address' },
                    { type: 'tel', label: 'Mobile phone', hint: leadOnly ? 'Mobile Phone (optional)' : 'Mobile Phone (for tracking SMS, optional)' }
                  ].map(f => (
                    <input
                      key={f.type}
                      type={f.type}
                      aria-label={f.label}
                      placeholder={f.hint}
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
                  ))}
                </div>

                {/* Order Bump inside Modal Preview */}
                {pageCopy.bumpNeedsProduct && previewHint('The add-on is left off the page until it has a product from your store.', '14px')}
                {pageCopy.bump && (
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
                        aria-labelledby={fid('modal-bump')}
                        checked={previewBumpChecked}
                        onChange={e => setPreviewBumpChecked(e.target.checked)}
                        style={{ marginTop: '2px', accentColor: '#ec4899', cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1 }}>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 800,
                            color: '#f472b6',
                            backgroundColor: 'rgba(236, 72, 153, 0.2)',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                          }}
                        >
                          ✦ One-Time VIP Upgrade
                        </span>
                        <div id={fid('modal-bump')} style={{ fontSize: '11px', fontWeight: 700, color: '#FFFFFF', marginTop: '2px' }}>
                          {pageCopy.bump.headline}
                        </div>
                        <p style={{ fontSize: '11px', color: '#94A3B8', margin: '4px 0 6px 0', lineHeight: 1.4 }}>
                          {pageCopy.bump.description}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' }}>
                          <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{pageCopy.bump.title}</span>
                          {pageCopy.bump.price ? (
                            <span style={{ color: '#34D399', fontWeight: 700 }}>
                              {orderBumpPriceText(data.orderBumpPrice, price => previewCurrency === 'USD' ? price : convertCurrencyCharm(price, previewCurrency).formatted)}
                            </span>
                          ) : (
                            <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>{NO_BUMP_PRICE}</span>
                          )}
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
                  {leadOnly
                    ? 'Send'
                    : previewLeadHasCode
                      ? (previewBumpChecked ? 'Claim Voucher & Upgrade Order →' : 'Claim Voucher & Checkout →')
                      : (previewBumpChecked ? 'Upgrade Order & Checkout →' : 'Continue to Checkout →')}
                </button>
              </div>
            ) : (
              /* Page Mockup */
              <div style={{ padding: previewDevice === 'mobile' ? '16px' : '24px', textAlign: 'center' }}>
                {/* Scarcity Batch Indicator */}
                {pageCopy.scarcity ? (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(236, 72, 153, 0.1)', border: '1px solid rgba(236, 72, 153, 0.28)', padding: '3px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700, color: '#F472B6', marginBottom: '10px' }}>
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#EC4899' }} />
                    <span>{pageCopy.scarcity}</span>
                  </div>
                ) : null}

                {/* Product Hero Image, with the price tag the page puts on it */}
                {previewHeroImage && (
                  <div style={{ marginBottom: '14px', position: 'relative' }}>
                    <img
                      src={previewHeroImage}
                      alt={pageCopy.headline}
                      style={{
                        width: '100%',
                        maxHeight: '160px',
                        objectFit: 'cover',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.1)'
                      }}
                    />
                    {pageCopy.productPrice && (
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
                        {previewCurrency === 'USD' ? pageCopy.productPrice : convertCurrencyCharm(pageCopy.productPrice, previewCurrency).formatted}
                      </span>
                    )}
                  </div>
                )}

                {/* The page names a code only when it has one; with none it shows no badge at all. */}
                {pageCopy.discountCode ? (
                  <span
                    style={{
                      display: 'inline-block',
                      fontSize: '11px',
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
                    Code {pageCopy.discountCode} is ready at checkout
                  </span>
                ) : null}

                <h2
                  style={{
                    fontSize: previewDevice === 'mobile' ? '16px' : '20px',
                    fontWeight: 800,
                    color: '#FFFFFF',
                    lineHeight: 1.3,
                    marginBottom: '8px'
                  }}
                >
                  {pageCopy.headline}
                </h2>
                {pageCopy.subhead ? (
                  <p
                    style={{
                      fontSize: previewDevice === 'mobile' ? '11px' : '12px',
                      color: '#94A3B8',
                      lineHeight: 1.5,
                      marginBottom: '16px'
                    }}
                  >
                    {pageCopy.subhead}
                  </p>
                ) : previewHint('No subheadline yet', '16px')}

                {/* Value Bullets: only the written ones, as the page lists them */}
                {pageCopy.bullets.length ? (
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
                    {pageCopy.bullets.map((b, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#E2E8F0', marginBottom: '6px' }}>
                        <span style={{ color: '#10B981', fontWeight: 800 }}>✓</span>
                        <span>{b}</span>
                      </div>
                    ))}
                  </div>
                ) : previewHint('No key benefits yet', '16px')}

                {/* Trust Badge */}
                {pageCopy.trustBadge && (
                  <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '12px' }}>
                    {pageCopy.trustBadge}
                  </div>
                )}

                {/* Order Bump Card on Page */}
                {pageCopy.bumpNeedsProduct && previewHint('The add-on is left off the page until it has a product from your store.', '14px')}
                {pageCopy.bump && (
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
                        aria-labelledby={fid('page-bump')}
                        checked={previewBumpChecked}
                        onChange={e => setPreviewBumpChecked(e.target.checked)}
                        style={{ marginTop: '2px', accentColor: '#ec4899', cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1 }}>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 800,
                            color: '#f472b6',
                            backgroundColor: 'rgba(236, 72, 153, 0.2)',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                          }}
                        >
                          ✦ One-Time Offer
                        </span>
                        <div id={fid('page-bump')} style={{ fontSize: '11px', fontWeight: 700, color: '#FFFFFF', marginTop: '2px' }}>
                          {pageCopy.bump.headline}
                        </div>
                        <p style={{ fontSize: '11px', color: '#94A3B8', margin: '4px 0 6px 0', lineHeight: 1.4 }}>
                          {pageCopy.bump.description}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' }}>
                          <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{pageCopy.bump.title}</span>
                          {pageCopy.bump.price ? (
                            <span style={{ color: '#34D399', fontWeight: 700 }}>
                              {orderBumpPriceText(data.orderBumpPrice, price => previewCurrency === 'USD' ? price : convertCurrencyCharm(price, previewCurrency).formatted)}
                            </span>
                          ) : (
                            <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>{NO_BUMP_PRICE}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* CTA Button */}
                <a
                  href={currentCheckoutUrl || '#'}
                  onClick={e => {
                    if (!currentCheckoutUrl) {
                      e.preventDefault();
                      alert('Please connect your Shopify store and select a product variant to activate checkout.');
                    }
                  }}
                  target={currentCheckoutUrl ? "_blank" : undefined}
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
                    : pageCopy.buttonText}
                </a>

                {/* What the button does: an editor note, so it is styled as one */}
                <div style={{ marginTop: '8px' }}>
                  {previewHint(leadOnly
                    ? 'Opens the email form. No checkout until a store is connected.'
                    : data.checkoutMode === 'lead-gate'
                      ? 'Opens the email form, then goes to Shopify checkout.'
                      : pageCopy.discountCode
                        ? `Goes straight to Shopify checkout with code ${pageCopy.discountCode}.`
                        : 'Goes straight to Shopify checkout.', '0')}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* PAGE WORDS: always open, first */}
          <section aria-labelledby={pageWordsHeadingId} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                <h3 id={pageWordsHeadingId} style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#F3F4F6' }}>
                  Page words
                </h3>
                <button
                  ref={writeButtonRef}
                  type="button"
                  onClick={requestSuggestion}
                  disabled={loadingAI}
                  aria-busy={loadingAI}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 12px',
                    minHeight: '32px',
                    borderRadius: '8px',
                    background: editingB ? '#7c3aed' : '#db2777',
                    border: 'none',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: loadingAI ? 'not-allowed' : 'pointer'
                  }}
                >
                  {loadingAI ? <RefreshCw size={13} className="spin" aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}
                  {loadingAI ? 'Writing' : editingB ? 'Write version B with AI' : 'Write with AI'}
                </button>
              </div>
              <p
                role="status"
                style={{
                  margin: aiNotice ? '8px 0 0' : 0,
                  fontSize: '12px',
                  lineHeight: 1.45,
                  color: aiNotice.endsWith('Nothing was changed.') ? '#FBBF24' : '#34D399',
                  overflowWrap: 'anywhere'
                }}
              >
                {aiNotice}
              </p>
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
                    aria-pressed={!editingB}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: activeVariantTab === 'a' ? '#db2777' : 'transparent',
                      color: activeVariantTab === 'a' ? '#FFFFFF' : '#94A3B8',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    Variant A (Control)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveVariantTab('b')}
                    aria-pressed={editingB}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: editingB ? '#7c3aed' : 'transparent',
                      color: editingB ? '#FFFFFF' : '#94A3B8',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    Variant B (Challenger)
                  </button>
                </div>

                {editingB && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px' }}>
                    <button
                      type="button"
                      onClick={handleCloneVariantAtoB}
                      style={{
                        padding: '5px 8px',
                        borderRadius: '5px',
                        fontSize: '11px',
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
                  </div>
                )}
              </div>
            )}

            {proposal && proposalRows.length > 0 && (
              <CopyProposalCard
                rows={proposalRows}
                heading={proposal.target === 'b' ? 'Suggested copy for version B' : 'Suggested copy'}
                selected={selectedFields}
                onToggle={field => setSelectedFields(cur => cur.includes(field) ? cur.filter(f => f !== field) : [...cur, field])}
                onUse={applyProposal}
                onKeep={keepCopy}
                focusFirst={initialFocus(proposalRows)}
              />
            )}

            {/* Headline */}
            <div>
              <label htmlFor={PAGE_FIELD_IDS.headline} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
                Headline {data.abTestingEnabled ? `(${editingB ? 'Variant B' : 'Variant A'})` : ''}
              </label>
              <input
                id={PAGE_FIELD_IDS.headline}
                type="text"
                value={editingB ? (data.variantB?.headline ?? '') : (data.headline ?? '')}
                onChange={e => {
                  if (editingB) {
                    handleVariantBFieldChange('headline', e.target.value);
                  } else {
                    handleFieldChange('headline', e.target.value);
                  }
                }}
                placeholder={editingB ? 'Alternative headline hook...' : 'e.g. Elevate Your Results With Our Proven Signature System'}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: editingB ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#FFFFFF',
                  fontSize: '13px',
                  outline: 'none'
                }}
              />
            </div>

            {/* Subhead */}
            <div>
              <label htmlFor={PAGE_FIELD_IDS.subhead} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
                Subheadline {data.abTestingEnabled ? `(${editingB ? 'Variant B' : 'Variant A'})` : ''}
              </label>
              <textarea
                id={PAGE_FIELD_IDS.subhead}
                rows={3}
                value={editingB ? (data.variantB?.subhead ?? '') : (data.subhead ?? '')}
                onChange={e => {
                  if (editingB) {
                    handleVariantBFieldChange('subhead', e.target.value);
                  } else {
                    handleFieldChange('subhead', e.target.value);
                  }
                }}
                placeholder={editingB ? 'Alternative subheadline addressing customer pain...' : 'Clarify who this product is for and what makes it special...'}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: editingB ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#FFFFFF',
                  fontSize: '13px',
                  outline: 'none',
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Button Text */}
            <div>
              <label htmlFor={PAGE_FIELD_IDS.buttonText} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
                Button text {data.abTestingEnabled ? `(${editingB ? 'Variant B' : 'Variant A'})` : ''}
              </label>
              <input
                id={PAGE_FIELD_IDS.buttonText}
                type="text"
                value={editingB ? (data.variantB?.buttonText ?? '') : (data.buttonText ?? '')}
                onChange={e => {
                  if (editingB) {
                    handleVariantBFieldChange('buttonText', e.target.value);
                  } else {
                    handleFieldChange('buttonText', e.target.value);
                  }
                }}
                placeholder="e.g. Buy now"
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

            {/* URL Slug */}
            <div>
              <label htmlFor={PAGE_FIELD_IDS.slug} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
                Page address {data.abTestingEnabled ? '(both versions)' : ''}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '8px', padding: '0 10px' }}>
                <span style={{ fontSize: '12px', color: '#94A3B8', fontFamily: 'monospace' }}>{pageHost}/p/</span>
                <input
                  id={PAGE_FIELD_IDS.slug}
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

            {/* Value Bullets */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div id={fid('bullets')} style={{ fontSize: '12px', fontWeight: 600, color: '#E2E8F0' }}>
                  Key benefits {data.abTestingEnabled ? `(${editingB ? 'Variant B' : 'Variant A'})` : ''} ({editingB ? (data.variantB?.bullets?.length || 0) : (data.bullets?.length || 0)})
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (editingB) {
                      const cur = data.variantB?.bullets || [];
                      focusBulletAt.current = cur.length;
                      handleVariantBFieldChange('bullets', [...cur, NEW_BENEFIT]);
                    } else {
                      focusBulletAt.current = (data.bullets || []).length;
                      addBullet();
                    }
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: editingB ? '#a78bfa' : '#ec4899', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                >
                  <Plus size={12} /> Add Point
                </button>
              </div>
              <div ref={bulletGroupRef} role="group" aria-labelledby={fid('bullets')} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {(editingB ? (data.variantB?.bullets || []) : (data.bullets || [])).map((b, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="text"
                      aria-label={`Key benefit ${idx + 1}`}
                      value={b}
                      placeholder={BENEFIT_HINT}
                      onChange={e => {
                        if (editingB) {
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
                        if (editingB) {
                          const cur = (data.variantB?.bullets || []).filter((_, i) => i !== idx);
                          handleVariantBFieldChange('bullets', cur);
                        } else {
                          removeBullet(idx);
                        }
                      }}
                      style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: '4px' }}
                      title="Remove bullet"
                      aria-label={`Remove key benefit ${idx + 1}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Trust Badge */}
            <div>
              <label htmlFor={fid('trust-badge')} style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#E2E8F0', marginBottom: '6px' }}>
                Trust line {data.abTestingEnabled ? `(${editingB ? 'Variant B' : 'Variant A'})` : ''}
              </label>
              <input
                id={fid('trust-badge')}
                type="text"
                value={editingB ? (data.variantB?.trustBadge ?? '') : (data.trustBadge ?? '')}
                onChange={e => {
                  if (editingB) {
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
          </section>

          {/* SETTINGS SECTIONS: collapsible, closed by default */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <EditorSection
              title={sectionTitle('commerce')}
              summary={sectionSummary('commerce', data, { storeConnected: isStoreConnected })}
              open={openSections.includes('commerce')}
              onToggle={() => setOpenSections(o => toggleSection(o, 'commerce'))}
            >
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

                {/* Placeholder / Missing Variant Warning */}
                {(isDemoVariantId(data.shopifyVariantId) || !data.shopifyVariantId || !data.shopifyProductTitle) && (
                  <div
                    style={{
                      backgroundColor: 'rgba(245, 158, 11, 0.12)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      borderRadius: '6px',
                      padding: '8px 10px',
                      fontSize: '11px',
                      color: '#fbbf24',
                      lineHeight: '1.4'
                    }}
                  >
                    ⚠️ <strong>Placeholder Product Active:</strong> Please select a real product from your Shopify catalog below so your 1-click checkout button connects to your live inventory.
                  </div>
                )}

                {/* Product Picker & Visual Catalog Selector */}
                <div
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div id={fid('shopify-product')} style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af' }}>
                      Connected Shopify Product:
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsPrimaryPickerOpen(true)}
                      style={{
                        backgroundColor: 'rgba(244, 114, 182, 0.15)',
                        border: '1px solid rgba(244, 114, 182, 0.35)',
                        color: '#f472b6',
                        borderRadius: '6px',
                        padding: '5px 10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px'
                      }}
                    >
                      <ShoppingBag size={12} />
                      Browse Catalog
                    </button>
                  </div>

                  {data.shopifyProductTitle && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid rgba(255, 255, 255, 0.06)'
                      }}
                    >
                      {data.shopifyProductImage ? (
                        <img
                          src={data.shopifyProductImage}
                          alt={data.shopifyProductTitle}
                          style={{ width: '36px', height: '36px', borderRadius: '4px', objectFit: 'cover' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(244, 114, 182, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#f472b6'
                          }}
                        >
                          <ShoppingBag size={16} />
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {data.shopifyProductTitle}
                        </div>
                        <div style={{ fontSize: '11px', color: '#10B981', fontWeight: 600 }}>
                          {data.shopifyProductPrice || '$0.00'} • <span style={{ color: '#94A3B8', fontFamily: 'monospace' }}>Variant: {data.shopifyVariantId || 'Not Set'}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Multi-Currency Geo-Pricing (Option A Charm) Breakdown */}
                  {data.shopifyProductPrice && (
                    <div
                      style={{
                        backgroundColor: 'rgba(236, 72, 153, 0.06)',
                        border: '1px solid rgba(236, 72, 153, 0.2)',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        margin: '8px 0'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#f472b6', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          ✦ Multi-Currency Geo-Pricing (Option A Charm)
                        </span>
                        <span style={{ fontSize: '11px', color: '#10B981', fontWeight: 600 }}>$0 API Overhead</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {(['USD', 'EUR', 'GBP', 'CAD', 'AUD'] as CurrencyCode[]).map(code => {
                          const charm = convertCurrencyCharm(data.shopifyProductPrice || '0', code);
                          const isCurrent = previewCurrency === code;
                          return (
                            <button
                              key={code}
                              type="button"
                              onClick={() => setPreviewCurrency(code)}
                              aria-pressed={isCurrent}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '3px 8px',
                                borderRadius: '5px',
                                backgroundColor: isCurrent ? 'rgba(236, 72, 153, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                                border: `1px solid ${isCurrent ? '#ec4899' : 'rgba(255, 255, 255, 0.1)'}`,
                                color: isCurrent ? '#FFFFFF' : '#CBD5E1',
                                fontSize: '11px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <span>{SUPPORTED_CURRENCIES[code].flag}</span>
                              <span style={{ color: isCurrent ? '#F472B6' : '#94A3B8' }}>{code}:</span>
                              <span style={{ fontWeight: 700 }}>{charm.formatted}</span>
                            </button>
                          );
                        })}
                      </div>
                      <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#94A3B8', lineHeight: 1.3 }}>
                        Visitor geo-location automatically localizes prices with psychological charm endings (.00, .95, .99) and passes native currency to Shopify checkout permalinks.
                      </p>
                      <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(236, 72, 153, 0.15)', paddingTop: '6px' }}>
                        <span style={{ fontSize: '11px', color: '#94A3B8' }}>Interactive Simulator:</span>
                        <a
                          href={`/p/${data.slug || 'offer'}?preview=true&currency=${previewCurrency}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: '#38BDF8',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}
                          title="Open page in new tab with Geo-Pricing Simulator Toolbar"
                        >
                          <ExternalLink size={10} />
                          <span>Launch {previewCurrency} Simulator ↗</span>
                        </a>
                      </div>
                    </div>
                  )}

                  <div>
                    <select
                      aria-labelledby={fid('shopify-product')}
                      value={data.shopifyProductId || ''}
                      onChange={e => handleSelectProduct(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: '6px',
                        backgroundColor: '#0a0a0f',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#ffffff',
                        fontSize: '11px',
                        outline: 'none'
                      }}
                    >
                      <option value="">-- Or Quick Select from Dropdown --</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.title} ({p.price})
                        </option>
                      ))}
                    </select>
                  </div>
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
                        backgroundColor: '#047857',
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
                  <div id={fid('checkout-mode')} style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '6px' }}>
                    Checkout Flow Mode:
                  </div>
                  <div role="group" aria-labelledby={fid('checkout-mode')} style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => handleFieldChange('checkoutMode', 'direct')}
                      aria-pressed={data.checkoutMode !== 'lead-gate'}
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
                      <div style={{ fontSize: '11px', opacity: 0.8 }}>1-Click (Less friction - Default)</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleFieldChange('checkoutMode', 'lead-gate')}
                      aria-pressed={data.checkoutMode === 'lead-gate'}
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
                      <div style={{ fontSize: '11px', opacity: 0.8 }}>Collect email for coupon first</div>
                    </button>
                  </div>
                </div>

                {/* Post-Submit Action when in Lead-Gate Mode */}
                {data.checkoutMode === 'lead-gate' && (
                  <div>
                    <label htmlFor={fid('post-submit-action')} style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '6px' }}>
                      Post-Lead Action:
                    </label>
                    <select
                      id={fid('post-submit-action')}
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
                      <option value="redirect_checkout">Immediate Checkout Redirect (Default, less friction)</option>
                      <option value="modal_voucher">On-Screen Voucher Code Card</option>
                      <option value="custom_url">Custom Thank You URL</option>
                    </select>

                    {data.postSubmitAction === 'custom_url' && (
                      <input
                        type="url"
                        aria-label="Custom thank-you page address"
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
                  <label htmlFor={fid('discount-code')} style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                    Auto-Applied Discount Code (Optional)
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Tag size={13} style={{ color: '#ec4899' }} />
                    <input
                      id={fid('discount-code')}
                      type="text"
                      placeholder="e.g. VIP15 or GLOW20"
                      value={data.discountCode || ''}
                      onChange={e => { setDiscSyncError(null); handleFieldChange('discountCode', e.target.value.toUpperCase()); }}
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
                        disabled={syncingDisc || !discountPercentOk}
                        aria-describedby={discountPercentOk ? undefined : fid('discount-percent-hint')}
                        onClick={async () => {
                          if (!discountPercentOk) return;
                          setSyncingDisc(true);
                          setDiscSyncedMsg(null);
                          setDiscSyncError(null);
                          try {
                            const headers = await authHeaders();
                            const wsId = workspace?.id || 'default';
                            const res = await fetch(`/api/workspace/${wsId}/shopify/create-discount`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', ...headers },
                              body: JSON.stringify({ code: data.discountCode, discountType: 'percentage', value: discountPercent })
                            });
                            const json = await res.json().catch(() => ({}));
                            if (json?.success) {
                              setDiscSyncedMsg(json.message || (json.discount?.syncedToLiveShopify
                                ? `${data.discountCode} is active in Shopify.`
                                : `${data.discountCode} is saved here. Shopify was not updated.`));
                              setTimeout(() => setDiscSyncedMsg(null), 3000);
                            } else {
                              setDiscSyncError(json?.error || `${data.discountCode} was not created in Shopify.`);
                            }
                          } catch (err) {
                            console.error('Failed syncing discount:', err);
                            setDiscSyncError(`${data.discountCode} was not created in Shopify because the request did not go through.`);
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
                          cursor: (syncingDisc || !discountPercentOk) ? 'not-allowed' : 'pointer',
                          opacity: discountPercentOk ? 1 : 0.55,
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
                  {data.discountCode && (
                    <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <label htmlFor={fid('discount-percent')} style={{ fontSize: '11px', color: '#9ca3af' }}>
                        Percent off in Shopify
                      </label>
                      <input
                        id={fid('discount-percent')}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={99}
                        step={1}
                        placeholder="e.g. 15"
                        value={discountPercent || ''}
                        onChange={e => handleFieldChange('discountPercentage', e.target.value === '' ? undefined : Number(e.target.value))}
                        style={{
                          width: '72px',
                          padding: '4px 8px',
                          borderRadius: '6px',
                          backgroundColor: '#0a0a0f',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: '#ffffff',
                          fontSize: '12px'
                        }}
                      />
                      <span style={{ fontSize: '11px', color: '#9ca3af' }}>%</span>
                      {!discountPercentOk && (
                        <span id={fid('discount-percent-hint')} style={{ fontSize: '11px', color: '#9ca3af', flexBasis: '100%' }}>
                          Enter a whole percent from 1 to 99 before syncing this code to Shopify.
                        </span>
                      )}
                    </div>
                  )}
                  {discSyncedMsg && (
                    <div role="status" style={{ marginTop: '4px', fontSize: '11px', color: '#34d399', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <CheckCircle2 size={12} /> <span>{discSyncedMsg}</span>
                    </div>
                  )}
                  {discSyncError && (
                    <div role="alert" style={{ marginTop: '4px', fontSize: '11px', color: '#f87171' }}>
                      {discSyncError}
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
                    <span style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Target Shopify Permalink:
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={copyPermalink}
                        style={{ background: 'transparent', border: 'none', color: '#10b981', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
                      >
                        {copiedLink ? <Check size={11} /> : <Copy size={11} />}
                        <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                      </button>
                      <a
                        href={currentCheckoutUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#60a5fa', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '2px', textDecoration: 'none' }}
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
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                        Boost checkout value with a complementary product offer
                      </div>
                    </div>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      aria-label="Order bump"
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
                      <label htmlFor={fid('order-bump-product-id')} style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                        Select Add-on Product from Catalog:
                      </label>
                      <select
                        id={fid('order-bump-product-id')}
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
                      <label htmlFor={fid('order-bump-headline')} style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                        Bump Card Headline:
                      </label>
                      <input
                        id={fid('order-bump-headline')}
                        type="text"
                        value={data.orderBumpHeadline || ''}
                        placeholder="Say what the add-on is, in your own words"
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
                      <label htmlFor={fid('order-bump-description')} style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                        Bump Offer Description:
                      </label>
                      <textarea
                        id={fid('order-bump-description')}
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
                        <label htmlFor={fid('order-bump-price')} style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                          Add-on Price:
                        </label>
                        <input
                          id={fid('order-bump-price')}
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
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <label htmlFor={fid('order-bump-variant-id')} style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af' }}>
                            Shopify Variant ID:
                          </label>
                          <button
                            type="button"
                            onClick={() => setIsBumpPickerOpen(true)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#f472b6',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: 0
                            }}
                          >
                            <ShoppingBag size={11} />
                            Pick from Catalog
                          </button>
                        </div>
                        <input
                          id={fid('order-bump-variant-id')}
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

                    {data.orderBumpTitle && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          backgroundColor: 'rgba(244, 114, 182, 0.08)',
                          border: '1px solid rgba(244, 114, 182, 0.25)',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          fontSize: '11px'
                        }}
                      >
                        {data.orderBumpImage && (
                          <img
                            src={data.orderBumpImage}
                            alt={data.orderBumpTitle}
                            style={{ width: '28px', height: '28px', borderRadius: '4px', objectFit: 'cover' }}
                          />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ color: '#FFFFFF', fontWeight: 600 }}>{data.orderBumpTitle}</span>
                          <span style={{ color: '#F472B6', marginLeft: '6px', fontWeight: 700 }}>{data.orderBumpPrice}</span>
                        </div>
                      </div>
                    )}

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
            </EditorSection>
            <EditorSection
              title={sectionTitle('ab-test')}
              summary={sectionSummary('ab-test', data, { storeConnected: isStoreConnected })}
              open={openSections.includes('ab-test')}
              onToggle={() => setOpenSections(o => toggleSection(o, 'ab-test'))}
            >
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
                      aria-label="A/B split testing"
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
                        <label htmlFor={fid('split-ratio')} style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af' }}>
                          Traffic Split Ratio:
                        </label>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#a78bfa' }}>
                          {data.splitRatio || 50}% Variant A / {100 - (data.splitRatio || 50)}% Variant B
                        </span>
                      </div>
                      <input
                        id={fid('split-ratio')}
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
            </EditorSection>
            <EditorSection
              title={sectionTitle('extras')}
              summary={sectionSummary('extras', data, { storeConnected: isStoreConnected })}
              open={openSections.includes('extras')}
              onToggle={() => setOpenSections(o => toggleSection(o, 'extras'))}
            >
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
                          <label htmlFor={fid('urgency-minutes')} style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                            Minutes:
                          </label>
                          <input
                            id={fid('urgency-minutes')}
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
                          <label htmlFor={fid('urgency-text')} style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                            Banner Message:
                          </label>
                          <input
                            id={fid('urgency-text')}
                            type="text"
                            value={data.urgencyText || ''}
                            placeholder={URGENCY_FALLBACK}
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
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>
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
                        <label htmlFor={fid('scarcity-batch-count')} style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                          Units Left:
                        </label>
                        <input
                          id={fid('scarcity-batch-count')}
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
                        <label htmlFor={fid('scarcity-batch-text')} style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                          Custom Badge Copy:
                        </label>
                        <input
                          id={fid('scarcity-batch-text')}
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
                        Exit-intent email drawer
                      </span>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                        Slide-up drawer that asks leaving shoppers for their email, and shows your code if you set one
                      </div>
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '6px' }}>
                    <input
                      type="checkbox"
                      aria-label="Exit-intent email drawer"
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
                        <label htmlFor={fid('exit-intent-badge')} style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                          Rescue Badge:
                        </label>
                        <input
                          id={fid('exit-intent-badge')}
                          type="text"
                          value={data.exitIntentBadge || ''}
                          onChange={e => handleFieldChange('exitIntentBadge', e.target.value)}
                          placeholder="Optional"
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
                        <label htmlFor={fid('exit-intent-discount-code')} style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                          VIP Discount Code:
                        </label>
                        <input
                          id={fid('exit-intent-discount-code')}
                          type="text"
                          value={data.exitIntentDiscountCode || data.discountCode || ''}
                          onChange={e => handleFieldChange('exitIntentDiscountCode', e.target.value.toUpperCase())}
                          placeholder="e.g. SAVE15"
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
                      <label htmlFor={fid('exit-intent-headline')} style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                        Headline:
                      </label>
                      <input
                        id={fid('exit-intent-headline')}
                        type="text"
                        value={data.exitIntentHeadline || ''}
                        onChange={e => handleFieldChange('exitIntentHeadline', e.target.value)}
                        placeholder="e.g. Before you go"
                        aria-describedby={fid('exit-intent-headline-hint')}
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
                      {/* The published drawer needs the user's own headline, and shows a code only when one is set. */}
                      <div id={fid('exit-intent-headline-hint')} style={{ fontSize: '11px', marginTop: '4px', color: (data.exitIntentHeadline || '').trim() ? '#94a3b8' : '#fbbf24' }}>
                        {(data.exitIntentHeadline || '').trim()
                          ? 'After sign-up, shoppers see a code only when one is set.'
                          : 'The drawer is not published until it has a headline.'}
                      </div>
                    </div>

                    <div>
                      <label htmlFor={fid('exit-intent-subhead')} style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                        Subhead Description:
                      </label>
                      <textarea
                        id={fid('exit-intent-subhead')}
                        rows={2}
                        value={data.exitIntentSubhead || ''}
                        onChange={e => handleFieldChange('exitIntentSubhead', e.target.value)}
                        placeholder="Optional"
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
                      <label htmlFor={fid('exit-intent-button-text')} style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                        Button Action Text:
                      </label>
                      <input
                        id={fid('exit-intent-button-text')}
                        type="text"
                        value={data.exitIntentButtonText || ''}
                        onChange={e => handleFieldChange('exitIntentButtonText', e.target.value)}
                        placeholder="Continue"
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
                      ✦ <strong>Mobile-First Slide-Up Drawer</strong>: Triggers on desktop cursor exit and mobile rapid up-scroll (or 14s idle pause). Frequency-capped in <code>sessionStorage</code> to protect buyer trust.
                    </div>
                  </div>
                )}
              </div>

              {/* Mobile Sticky Action Bar Toggle */}
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  backgroundColor: data.mobileStickyBarEnabled !== false ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                  border: data.mobileStickyBarEnabled !== false ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>Mobile Sticky Action Bar</span>
                    <span style={{ fontSize: '11px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8' }}>
                      CONVERSION
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                    Fixes your primary checkout or booking button to the bottom of the screen on mobile devices.
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    aria-label="Mobile sticky action bar"
                    checked={data.mobileStickyBarEnabled !== false}
                    onChange={e => handleFieldChange('mobileStickyBarEnabled', e.target.checked)}
                    style={{ accentColor: '#38bdf8', width: '16px', height: '16px' }}
                  />
                  <span style={{ fontSize: '11px', fontWeight: 700, color: data.mobileStickyBarEnabled !== false ? '#38bdf8' : '#64748b' }}>
                    {data.mobileStickyBarEnabled !== false ? 'Enabled' : 'Off'}
                  </span>
                </label>
              </div>

              {/* SECTION: LIVE VERIFIED UGC SOCIAL PROOF WALL (PHASE 13) */}
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  backgroundColor: data.socialProofWallEnabled !== false ? 'rgba(236, 72, 153, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                  border: data.socialProofWallEnabled !== false ? '1px solid rgba(236, 72, 153, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Star size={14} style={{ color: '#fbbf24', fill: '#fbbf24' }} />
                      <span>Verified Buyer Social Proof Wall (UGC)</span>
                      <span style={{ fontSize: '11px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px', background: 'rgba(236, 72, 153, 0.2)', color: '#f472b6' }}>
                        SOCIAL PROOF
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                      Swipeable mobile carousel + 3-column desktop grid of verified 4-star & 5-star customer reviews.
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      aria-label="Social proof wall"
                      checked={data.socialProofWallEnabled !== false}
                      onChange={e => handleFieldChange('socialProofWallEnabled', e.target.checked)}
                      style={{ accentColor: '#ec4899', width: '16px', height: '16px' }}
                    />
                    <span style={{ fontSize: '11px', fontWeight: 700, color: data.socialProofWallEnabled !== false ? '#ec4899' : '#64748b' }}>
                      {data.socialProofWallEnabled !== false ? 'Enabled' : 'Off'}
                    </span>
                  </label>
                </div>

                {data.socialProofWallEnabled !== false && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    {/* Minimum Star Filter */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div id={fid('min-rating')} style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8' }}>
                        Minimum Star Rating Filter
                      </div>
                      <div role="group" aria-labelledby={fid('min-rating')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => handleFieldChange('socialProofMinRating', 4)}
                          aria-pressed={data.socialProofMinRating !== 5}
                          style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            border: (data.socialProofMinRating !== 5) ? '1px solid #ec4899' : '1px solid rgba(255,255,255,0.1)',
                            background: (data.socialProofMinRating !== 5) ? 'rgba(236, 72, 153, 0.15)' : 'rgba(255,255,255,0.02)',
                            color: (data.socialProofMinRating !== 5) ? '#f472b6' : '#94a3b8'
                          }}
                        >
                          ★★★★☆ 4+ Stars (Recommended)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFieldChange('socialProofMinRating', 5)}
                          aria-pressed={data.socialProofMinRating === 5}
                          style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            border: data.socialProofMinRating === 5 ? '1px solid #ec4899' : '1px solid rgba(255,255,255,0.1)',
                            background: data.socialProofMinRating === 5 ? 'rgba(236, 72, 153, 0.15)' : 'rgba(255,255,255,0.02)',
                            color: data.socialProofMinRating === 5 ? '#f472b6' : '#94a3b8'
                          }}
                        >
                          ★★★★★ 5 Stars Only
                        </button>
                      </div>
                    </div>

                    {/* Custom Wall Headline */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label htmlFor={fid('social-proof-headline')} style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8' }}>
                        Wall Section Headline
                      </label>
                      <input
                        id={fid('social-proof-headline')}
                        type="text"
                        value={data.socialProofHeadline ?? ''}
                        placeholder={SOCIAL_PROOF_FALLBACK}
                        onChange={e => handleFieldChange('socialProofHeadline', e.target.value)}
                        style={{
                          padding: '7px 10px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          color: '#f8fafc'
                        }}
                      />
                    </div>

                    {/* UGC Photos Toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#f8fafc' }}>
                          Show Customer Photos (UGC Media)
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          Renders unboxing &amp; texture photos on cards with full-screen lightbox preview.
                        </div>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          aria-label="Show customer photos"
                          checked={data.socialProofPhotosEnabled !== false}
                          onChange={e => handleFieldChange('socialProofPhotosEnabled', e.target.checked)}
                          style={{ accentColor: '#ec4899', width: '15px', height: '15px' }}
                        />
                        <span style={{ fontSize: '11px', fontWeight: 700, color: data.socialProofPhotosEnabled !== false ? '#ec4899' : '#64748b' }}>
                          {data.socialProofPhotosEnabled !== false ? 'Shown' : 'Hidden'}
                        </span>
                      </label>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#64748b' }}>
                      <span>✦ Dynamic UGC Active: pulls authentic reviews from completed orders with beauty preview fallback.</span>
                    </div>
                  </div>
                )}
              </div>
            </EditorSection>
            <EditorSection
              title={sectionTitle('privacy')}
              summary={sectionSummary('privacy', data, { storeConnected: isStoreConnected })}
              open={openSections.includes('privacy')}
              onToggle={() => setOpenSections(o => toggleSection(o, 'privacy'))}
            >
              {/* GDPR & CCPA PRIVACY / COOKIE CONSENT MANAGER */}
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  backgroundColor: data.cookieConsentEnabled !== false ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                  border: data.cookieConsentEnabled !== false ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <ShieldCheck size={14} style={{ color: '#10b981' }} />
                      <span>Cookie Consent & GDPR/CCPA Banner</span>
                      <span style={{ fontSize: '11px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.2)', color: '#10b981' }}>
                        COMPLIANCE
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                      Floating luxury frosted glass pill respecting visitor tracking preferences with zero compute overhead.
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      aria-label="Cookie consent banner"
                      checked={data.cookieConsentEnabled !== false}
                      onChange={e => handleFieldChange('cookieConsentEnabled', e.target.checked)}
                      style={{ accentColor: '#10b981', width: '16px', height: '16px' }}
                    />
                    <span style={{ fontSize: '11px', fontWeight: 700, color: data.cookieConsentEnabled !== false ? '#10b981' : '#64748b' }}>
                      {data.cookieConsentEnabled !== false ? 'Enabled' : 'Off'}
                    </span>
                  </label>
                </div>

                {data.cookieConsentEnabled !== false && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    {/* Geo-Targeting Selection */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div id={fid('geo-target')} style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8' }}>
                        Visitor Targeting Mode
                      </div>
                      <div role="group" aria-labelledby={fid('geo-target')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => handleFieldChange('cookieConsentGeoTarget', 'eu_uk_only')}
                          aria-pressed={data.cookieConsentGeoTarget !== 'all_visitors'}
                          style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            border: (data.cookieConsentGeoTarget !== 'all_visitors') ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                            background: (data.cookieConsentGeoTarget !== 'all_visitors') ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.02)',
                            color: (data.cookieConsentGeoTarget !== 'all_visitors') ? '#a7f3d0' : '#94a3b8'
                          }}
                        >
                          🇪🇺 🇬🇧 EU & UK Only (Smart)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFieldChange('cookieConsentGeoTarget', 'all_visitors')}
                          aria-pressed={data.cookieConsentGeoTarget === 'all_visitors'}
                          style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            border: data.cookieConsentGeoTarget === 'all_visitors' ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                            background: data.cookieConsentGeoTarget === 'all_visitors' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.02)',
                            color: data.cookieConsentGeoTarget === 'all_visitors' ? '#a7f3d0' : '#94a3b8'
                          }}
                        >
                          🌐 All Visitors
                        </button>
                      </div>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        {data.cookieConsentGeoTarget === 'all_visitors'
                          ? 'Displays consent pill to every visitor worldwide.'
                          : 'Smart Geo-Targeting displays banner only to visitors requiring GDPR/UK-GDPR compliance, maximizing conversion elsewhere.'}
                      </span>
                    </div>

                    {/* Privacy Policy URL */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label htmlFor={fid('privacy-policy-url')} style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8' }}>
                        Privacy Policy Link (Optional)
                      </label>
                      <input
                        id={fid('privacy-policy-url')}
                        type="text"
                        value={data.privacyPolicyUrl || ''}
                        placeholder="/privacy or https://yourstore.com/policies/privacy-policy"
                        onChange={e => handleFieldChange('privacyPolicyUrl', e.target.value)}
                        style={{
                          padding: '7px 10px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          color: '#f8fafc'
                        }}
                      />
                    </div>
                  </div>
                )}
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
                  <span style={{ fontSize: '11px', color: '#a78bfa', fontWeight: 600 }}>
                    Zero-Code Injection
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label htmlFor={fid('meta-pixel-id')} style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                      Meta (Facebook/Instagram) Pixel ID:
                    </label>
                    <input
                      id={fid('meta-pixel-id')}
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
                    <label htmlFor={fid('tiktok-pixel-id')} style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                      TikTok Pixel ID:
                    </label>
                    <input
                      id={fid('tiktok-pixel-id')}
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
                    <label htmlFor={fid('ga4-tracking-id')} style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>
                      Google Analytics 4 (GA4) Measurement ID:
                    </label>
                    <input
                      id={fid('ga4-tracking-id')}
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
            </EditorSection>
            <EditorSection
              title={sectionTitle('hosting')}
              summary={sectionSummary('hosting', data, { storeConnected: isStoreConnected })}
              open={openSections.includes('hosting')}
              onToggle={() => setOpenSections(o => toggleSection(o, 'hosting'))}
            >
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
                  {/* What is live is the Publish status section at the top of the panel, read from the server (#23). */}
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
                      <a
                        href={`/p/${data.slug || 'offer'}?preview=true&currency=${previewCurrency}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: '#f472b6',
                          fontSize: '11px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px',
                          textDecoration: 'none'
                        }}
                        title="Open live page with Geo-Pricing Simulator Toolbar"
                      >
                        <ExternalLink size={12} />
                        <span>Geo Simulator</span>
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
                    <label htmlFor={fid('custom-domain')} style={{ fontSize: '11px', fontWeight: 600, color: '#f3f4f6' }}>
                      Custom Brand Subdomain:
                    </label>
                    {data.customDomainVerified ? (
                      <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <Check size={11} /> CNAME Verified
                      </span>
                    ) : (
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                        Optional • High-Trust
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      id={fid('custom-domain')}
                      type="text"
                      placeholder="e.g. offer.yourbrand.com"
                      value={data.customDomain || ''}
                      onChange={e => {
                        handleFieldChange('customDomain', e.target.value.toLowerCase().trim());
                        dnsRequest.current++;
                        setDnsOutcome(null);
                        setCheckingDns(false);
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
                      ref={checkDnsButtonRef}
                      type="button"
                      onClick={() => handleCheckDns()}
                      disabled={!data.customDomain}
                      aria-disabled={checkingDns || undefined}
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

                  <div aria-live="polite">
                    {dnsOutcome?.kind === 'refused' && (
                      <div
                        style={{
                          fontSize: '11px',
                          padding: '8px 10px',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(148, 163, 184, 0.1)',
                          color: '#e2e8f0',
                          border: '1px solid rgba(148, 163, 184, 0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '8px'
                        }}
                      >
                        <span style={{ flex: '1 1 180px', lineHeight: 1.4 }}>{dnsOutcome.message}</span>
                        {dnsOutcome.retryable && (
                          <button
                            type="button"
                            onClick={() => handleCheckDns(true)}
                            aria-disabled={checkingDns || undefined}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(56, 189, 248, 0.15)',
                              border: '1px solid rgba(56, 189, 248, 0.35)',
                              color: '#38bdf8',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: checkingDns ? 'default' : 'pointer',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {checkingDns ? 'Checking…' : 'Retry'}
                          </button>
                        )}
                      </div>
                    )}
                    {dnsOutcome?.kind === 'verdict' && (() => {
                      const dnsResult = dnsOutcome.result;
                      const detail = dnsVerdictDetail(dnsResult);
                      return (
                        <div
                          style={{
                            fontSize: '11px',
                            padding: '8px 10px',
                            borderRadius: '6px',
                            backgroundColor: dnsResult.verified ? 'rgba(16, 185, 129, 0.12)' : dnsResult.contested ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                            color: dnsResult.verified ? '#34d399' : dnsResult.contested ? '#fbbf24' : '#f87171',
                            border: `1px solid ${dnsResult.verified ? 'rgba(16, 185, 129, 0.3)' : dnsResult.contested ? 'rgba(245, 158, 11, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontWeight: 700 }}>
                              {dnsResult.verified ? '✓ Domain Verified' : dnsResult.contested ? '⚠️ Domain Connected to Another Store' : '✕ CNAME Target Mismatch'}
                            </span>
                            {dnsResult.verified && (
                              <span style={{ fontSize: '11px', fontWeight: 800, color: dnsResult.sslActive ? '#34D399' : '#FBBF24' }}>
                                {dnsResult.sslActive ? '🔒 HTTPS Active' : '⏳ SSL Provisioning'}
                              </span>
                            )}
                          </div>
                          {detail && (
                            <div style={{ fontSize: '11px', opacity: 0.9 }}>
                              {detail}
                            </div>
                          )}
                          {dnsResult.contested && dnsResult.verificationToken && (
                            <div style={{ marginTop: '4px', fontSize: '11px', color: '#fef08a', overflowWrap: 'anywhere' }}>
                              Add TXT record: <code style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: '2px 5px', borderRadius: '3px' }}>{dnsResult.expectedTxtHost || `_jourvance.${data.customDomain}`} = {dnsResult.verificationToken}</code>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
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
                  <label htmlFor={fid('webhook-url')} style={{ fontSize: '11px', fontWeight: 600, color: '#f3f4f6' }}>
                    Outbound Lead &amp; Bump Webhook Relay (Optional):
                  </label>
                  <input
                    id={fid('webhook-url')}
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
                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                    Relays new leads, bump selections, and UTM attribution in real time to Klaviyo, Zapier, or your CRM.
                  </div>
                </div>
              </div>
            </EditorSection>
          </div>
        </>
      )}

      {/* Primary Funnel Product Picker Modal */}
      <ShopifyProductPickerModal
        isOpen={isPrimaryPickerOpen}
        onClose={() => setIsPrimaryPickerOpen(false)}
        onSelectProduct={handlePrimaryProductPicked}
        workspace={workspace}
        onOpenShopifyConnect={onOpenShopifyConnect}
        title="Select Primary Funnel Product"
        subtitle="Choose a product from your catalog. Jourvance will automatically connect the variant ID to 1-click checkout."
        selectedVariantId={data.shopifyVariantId}
      />

      {/* Order Bump Add-on Product Picker Modal */}
      <ShopifyProductPickerModal
        isOpen={isBumpPickerOpen}
        onClose={() => setIsBumpPickerOpen(false)}
        onSelectProduct={handleBumpProductPicked}
        workspace={workspace}
        onOpenShopifyConnect={onOpenShopifyConnect}
        title="Select Order Bump Add-on"
        subtitle="Choose a companion product (e.g. travel mini, contour tool) to offer right inside checkout."
        selectedVariantId={data.orderBumpVariantId}
      />
    </div>
  );
};
