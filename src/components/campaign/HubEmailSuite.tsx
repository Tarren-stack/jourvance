import React, { useState, useEffect, useRef } from 'react';
import {
  Mail, Send, Users, TrendingUp, Sparkles, Plus, CheckCircle2,
  Clock, ArrowUpRight, Copy, Check, RefreshCw, AlertCircle, ShoppingBag, Eye,
  GitFork, Inbox, MessageSquare, Globe, FormInput,
  ExternalLink, Zap, Terminal, X, Filter, Search, Tag, DollarSign, ArrowRight, Layers,
  ShieldCheck, Play, SlidersHorizontal, Crown, AlertTriangle, ChevronRight
} from 'lucide-react';
import { authHeaders } from '../../lib/firebase';
import { BroadcastComposer, BroadcastDraftList, COMPOSER_REPLACE, useBroadcastDraft, type BroadcastPerson, type BroadcastPreset } from './BroadcastComposer';
import { EmailFlowMap } from './EmailFlowMap';
import { EmailFlowsList } from './EmailFlowsList';
import { SignupForms } from './SignupForms';
import { AudienceDesk } from './AudienceDesk';
import { EmailInbox } from './EmailInbox';
import { SmsPanel } from './SmsPanel';
import { SendingSetup } from './SendingSetup';
import { KlaviyoSync } from './KlaviyoSync';
import { CustomerProfileDrawer } from './CustomerProfileDrawer';
import { moneyText, OPENS_UNSTORED, STAT_UNAVAILABLE, statText, withNote } from '../../lib/emailStats';
import { STUDIO_DESTINATIONS, destinationOf, firstSectionOf, nextTabIndex, placeFor, type StudioDestinationKey, type StudioSectionKey } from '../../lib/emailStudioNav';
import {
  BROADCASTS_LIST, BROADCASTS_READ, LIST_LOADING, PEOPLE_LIST, PEOPLE_READ, RESULTS_READ, STARTER_PEOPLE_LIST, STARTER_PEOPLE_READ,
  listLine, nothingSent, readOutcome, resultsLine, studioRead, type ListState, type StudioRead
} from '../../lib/studioLoad';
import { StudioListLine } from './StudioListLine';
import { leaveFlowEditorOk } from '../../lib/studioLeave';
import type { Workspace, AudienceSegment, DripSequence, DripEnrollment, ShopifyAbandonedCheckout } from '../../types/journey';

interface FlowStep {
  type: string;
  subject: string;
  previewText?: string;
  delay: string;
  body?: string;
}

interface HubFlow {
  id: string;
  name: string;
  category: string;
  active: boolean;
  steps: FlowStep[];
}

interface Broadcast {
  id: string;
  subject: string;
  previewText?: string;
  segment?: string;
  segmentName?: string;
  sentAt: string | null;
  recipients: number;
  openRate: number | null;
  clickRate: number | null;
  attributedSales?: number | null;
  sent?: number | null;
  delivered?: number | null;
  opened?: number | null;
  clicked?: number | null;
  unsubscribed?: number | null;
  revenue?: number | null;
  prefetchOpens?: number | null;
  sendMode?: 'direct' | 'shopify_push';
  shopifyTagApplied?: string;
  status?: string;
  when?: string;
  ab?: { variable: string; winner: string; offsetHours: number } | null;
  smartReport?: string;
  holdout?: { enabled: boolean; percent: number } | null;
  holdoutReport?: {
    sent: { sample: number; perPerson: number | null };
    held: { sample: number; perPerson: number | null };
  } | null;
}

interface Subscriber {
  email: string;
  name: string;
  phone?: string;
  status: string;
  tags: string[];
  totalSpent?: number;
  ordersCount?: number;
  joinedAt: string;
  lastOrderAt?: string | null;
  predictionLine?: string;
  rfmSegment?: string;
  rfmTier?: string;
  rfmBadge?: string;
  rfmColor?: string;
  recencyDays?: number | null;
  isVip?: boolean;
  isAtRisk?: boolean;
  isLapsed?: boolean;
}

interface RfmConfig {
  atRiskDays: number;
  lapsedDays: number;
  vipSilver: number;
  vipGold: number;
  vipPlatinum: number;
  coolingDays: number;
  autoWinbackEnabled?: boolean;
  autoWinbackEnabledAt?: string | null;
  allowUnlimitedDiscountUse?: boolean;
}

interface RfmSummary {
  whales: number;
  gold: number;
  silver: number;
  atRisk: number;
  lapsed: number;
  repeatBuyers: number;
  totalBuyers: number;
  totalContacts: number;
  leads?: number;
}

interface Analytics {
  totalSent: number | null;
  sent?: number | null;
  delivered?: number | null;
  opened?: number | null;
  clicked?: number | null;
  unsubscribed?: number | null;
  revenue?: number | null;
  prefetchOpens?: number | null;
  avgOpenRate: number | null;
  avgClickRate: number | null;
  deliveryRate: number | null;
  activeSubscribers: number;
  windows?: { emailClickDays: number; emailOpenDays: number; smsClickDays: number };
  windowNote?: string;
  opensStored?: boolean;
}

interface Props {
  workspace: Workspace | null;
  onOpenShopifyConnect?: () => void;
  onReturnToCanvas?: () => void;
  /** The tab to open on. Read once at mount; App mounts Email Studio fresh on each switch. */
  initialTab?: EmailStudioTab;
  /** A flow to select on the Flow map, when a step on the funnel links to one. */
  openFlowId?: string;
}

// Wide enough that 'Unavailable' fits a 1fr column of the broadcast table.
const BROADCAST_TABLE_MIN_WIDTH = 680;

// Side padding of the studio's banner, view row and body: 32px on a desktop, down to 16px on a phone.
const STUDIO_GUTTER = 'clamp(16px, 5vw, 32px)';

const DESTINATION_ICONS: Record<StudioDestinationKey, typeof Clock> = {
  flows: GitFork,
  broadcasts: Send,
  audience: Users,
  results: TrendingUp,
  settings: SlidersHorizontal
};

/**
 * One tab on either strip. 44px tall, the touch target floor. The selected tab is pink, heavier, and
 * carries SELECTED_BAR, so it is marked by more than colour. No transition: nothing here needs motion.
 */
const studioTabStyle = (selected: boolean, level: 'top' | 'section'): React.CSSProperties => ({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  minHeight: '44px',
  padding: level === 'top' ? '0 12px' : '0 10px',
  border: 'none',
  borderRadius: '8px 8px 0 0',
  backgroundColor: selected ? 'rgba(236, 72, 153, 0.12)' : 'transparent',
  color: selected ? '#f472b6' : '#9ca3af',
  fontSize: level === 'top' ? '14px' : '13px',
  fontWeight: selected ? 700 : 500,
  cursor: 'pointer'
});

// The selected tab's bar. A border, not a background or a shadow, so Windows high contrast keeps it.
const SELECTED_BAR: React.CSSProperties = {
  position: 'absolute',
  left: '10px',
  right: '10px',
  bottom: 0,
  borderBottom: '3px solid #f472b6',
  borderRadius: '2px'
};

// A group under the Flows list that stays closed until asked for. A native disclosure, so the keyboard
// and a screen reader get its open and closed state for free.
const STUDIO_GROUP: React.CSSProperties = {
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: '12px',
  padding: '4px 16px 12px',
  backgroundColor: 'rgba(255, 255, 255, 0.02)'
};
const STUDIO_GROUP_SUMMARY: React.CSSProperties = {
  display: 'list-item',
  cursor: 'pointer',
  padding: '12px 0 4px',
  fontSize: '14px',
  fontWeight: 700,
  color: '#f3f4f6'
};

type CheckoutsLoad = { state: 'loading' | 'loaded' } | { state: 'failed'; text: string; retry: boolean };

/** What Open checkouts says when its read failed. Retry only where retrying can help. */
function checkoutsFailure(httpStatus: number, error?: unknown): CheckoutsLoad {
  if (httpStatus === 401) return { state: 'failed', text: "Sign in to see this account's open checkouts.", retry: false };
  if (!httpStatus) return { state: 'failed', text: 'Open checkouts could not be loaded. The server did not answer.', retry: true };
  const said = typeof error === 'string' && error.trim() ? ` ${error.trim()}` : '';
  return { state: 'failed', text: `Open checkouts could not be loaded.${said}`, retry: httpStatus >= 500 };
}

/**
 * D6 (Wave 6): the lists loadData reads that the studio draws, each with its own read state, so a
 * failed read says so and is never drawn as an empty list or a 0. Open checkouts keeps its own.
 */
type StudioLoads = Record<'broadcasts' | 'analytics' | 'audience' | 'enrollments', ListState>;
const LOADS_AT_MOUNT: StudioLoads = { broadcasts: LIST_LOADING, analytics: LIST_LOADING, audience: LIST_LOADING, enrollments: LIST_LOADING };

export type EmailStudioTab = 'campaigns' | 'flows' | 'map' | 'transactional' | 'builder' | 'forms' | 'inbox' | 'sms' | 'audience' | 'analytics' | 'sending' | 'klaviyo';

export const HubEmailSuite: React.FC<Props> = ({ workspace, onOpenShopifyConnect, onReturnToCanvas, initialTab, openFlowId }) => {
  // The open section (EMAIL_STUDIO_PLAN.md D1). An old tab key, as App passes 'map' from a funnel
  // step, opens the section LEGACY_TAB names; the destination is the one that holds that section.
  const [activeTab, setActiveTab] = useState<StudioSectionKey>(() => placeFor(initialTab || 'flows').section);
  const destination = destinationOf(activeTab);
  const destinationTabs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({});
  const sectionTabs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({});
  // A flow (and one of its steps) opened from a button inside Email Studio. A click on either tab
  // strip clears both, so the Flow map section on its own opens as it always has.
  const [mapFlowId, setMapFlowId] = useState('');
  const [mapNodeId, setMapNodeId] = useState('');
  const openFlowInMap = (flowId: string, nodeId?: string) => {
    setMapFlowId(flowId);
    setMapNodeId(nodeId || '');
    setActiveTab('map');
  };
  // A destination opens on its first section, plainly: like a click on the old strip, it clears a
  // flow a button inside the studio asked for. Wave 8: leaving the flow editor with an unsaved edit asks
  // first (studioLeave.ts), and Cancel changes nothing. Answers whether the destination is now open.
  const selectDestination = (key: StudioDestinationKey): boolean => {
    if (key === destination.key) return true;
    if (!leaveFlowEditorOk()) return false;
    setMapFlowId('');
    setMapNodeId('');
    setActiveTab(firstSectionOf(key));
    return true;
  };
  // A section of the open destination, by a click or a key. The section already open changes nothing.
  const selectSection = (key: StudioSectionKey): boolean => {
    if (key !== activeTab && !leaveFlowEditorOk()) return false;
    setMapFlowId('');
    setMapNodeId('');
    setActiveTab(key);
    return true;
  };
  // WAI-ARIA tabs, automatic activation: an arrow, Home or End selects the tab and moves focus to it.
  // When the move is refused (Cancel on an unsaved flow), focus stays on the tab that is still selected.
  const onDestinationKey = (e: React.KeyboardEvent, index: number) => {
    const next = nextTabIndex(e.key, index, STUDIO_DESTINATIONS.length);
    if (next === null) return;
    e.preventDefault();
    const target = STUDIO_DESTINATIONS[next];
    if (!selectDestination(target.key)) return;
    destinationTabs.current[target.key]?.focus();
  };
  const onSectionKey = (e: React.KeyboardEvent, index: number) => {
    const next = nextTabIndex(e.key, index, destination.sections.length);
    if (next === null) return;
    e.preventDefault();
    const target = destination.sections[next];
    if (!selectSection(target.key)) return;
    sectionTabs.current[target.key]?.focus();
  };
  const [flows, setFlows] = useState<HubFlow[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [segments, setSegments] = useState<AudienceSegment[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [loads, setLoads] = useState<StudioLoads>(LOADS_AT_MOUNT);
  const [copiedFlowId, setCopiedFlowId] = useState<string | null>(null);

  // Wave 7: Automated Drips state
  const [dripSequences, setDripSequences] = useState<DripSequence[]>([]);
  const [dripEnrollments, setDripEnrollments] = useState<DripEnrollment[]>([]);
  const [processingDripTick, setProcessingDripTick] = useState(false);
  const [dripTickMsg, setDripTickMsg] = useState<string | null>(null);

  // Wave 8: Abandoned Checkouts state
  const [abandonedCheckouts, setAbandonedCheckouts] = useState<ShopifyAbandonedCheckout[]>([]);
  // Open checkouts says "none yet" only of a list that was read.
  const [checkoutsLoad, setCheckoutsLoad] = useState<CheckoutsLoad>({ state: 'loading' });

  // Broadcasts (EMAIL_STUDIO_PLAN.md Wave 5): the composer's draft lives here, so leaving Broadcasts
  // for another section and coming back finds it as it was. focusComposer is set by a button that
  // opens the composer (New broadcast, a draft, a written draft), never by the tab strip.
  const composer = useBroadcastDraft();
  const [focusComposer, setFocusComposer] = useState(false);
  // What the last send, schedule or A/B winner said, shown on All broadcasts.
  const [broadcastNotice, setBroadcastNotice] = useState('');
  const broadcastsHeading = useRef<HTMLHeadingElement>(null);
  const [focusBroadcasts, setFocusBroadcasts] = useState(false);
  const [lists, setLists] = useState<{ id: string; name: string; count: number }[]>([]);
  const [followUpNote, setFollowUpNote] = useState('');
  const [predictionNote, setPredictionNote] = useState('');

  // Audience Sync & Filtering state
  const [syncingShopify, setSyncingShopify] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);
  const [audienceFilter, setAudienceFilter] = useState<string>('all');
  const [audienceSearch, setAudienceSearch] = useState<string>('');
  const [selectedCustomerEmail, setSelectedCustomerEmail] = useState<string | null>(null);

  // RFM Customer Lifecycle state
  const [rfmConfig, setRfmConfig] = useState<RfmConfig>({
    atRiskDays: 90,
    lapsedDays: 180,
    vipSilver: 100,
    vipGold: 250,
    vipPlatinum: 500,
    coolingDays: 60
  });
  const [rfmSummary, setRfmSummary] = useState<RfmSummary | null>(null);
  const [showRfmSettings, setShowRfmSettings] = useState(false);
  const [savingRfmConfig, setSavingRfmConfig] = useState(false);
  const [rfmConfigSavedMsg, setRfmConfigSavedMsg] = useState<string | null>(null);
  const [customAtRiskDays, setCustomAtRiskDays] = useState<number>(90);
  const [customLapsedDays, setCustomLapsedDays] = useState<number>(180);
  const [customVipPlatinum, setCustomVipPlatinum] = useState<number>(500);
  const [customVipGold, setCustomVipGold] = useState<number>(250);
  const [customVipSilver, setCustomVipSilver] = useState<number>(100);
  const [autoWinbackEnabled, setAutoWinbackEnabled] = useState<boolean>(false);
  const [allowUnlimitedDiscountUse, setAllowUnlimitedDiscountUse] = useState<boolean>(false);

  // Klaviyo & Shopify Email 1-Click Export state
  const [exportModalFlow, setExportModalFlow] = useState<HubFlow | null>(null);
  const [exportPlatform, setExportPlatform] = useState<'klaviyo' | 'shopify'>('klaviyo');
  const [copiedExportKey, setCopiedExportKey] = useState<string | null>(null);
  const [showWebhookGuide, setShowWebhookGuide] = useState(false);

  const formatStepForPlatform = (step: FlowStep, platform: 'klaviyo' | 'shopify') => {
    const store = workspace?.shopifyConfig?.storeDomain || 'your-store.myshopify.com';
    const recipient = platform === 'klaviyo' ? "{{ person.first_name|default:'there' }}" : "{{ customer.first_name | default: 'there' }}";
    const recoveryLink = platform === 'klaviyo' ? "{{ event.checkout_url }}" : `https://${store}/cart?utm_source=shopify_email`;
    const unsub = platform === 'klaviyo' ? "{% unsubscribe %}" : "{{ unsubscribe_link }}";

    return `Subject: ${step.subject}
Preview: ${step.previewText || ''}
Timing: ${step.delay}

Hi ${recipient},

${step.body || ''}

Complete your order with your applied offer:
${recoveryLink}

Warmly,
The Customer Care Team

${unsub}`;
  };

  const handleCopyExportText = (key: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedExportKey(key);
    setTimeout(() => setCopiedExportKey(null), 2500);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const wsId = workspace?.id || 'default';
      // D6: every read settles (studioRead never rejects), and each list keeps its own loading, loaded or
      // failed state, so a read that failed is never shown as an empty list or a 0.
      const [fRead, bRead, aRead, sRead, segRead, listRead, dSeqRead, dEnrRead, chkRes, predRead] = await Promise.all([
        studioRead('/api/email/flows', headers),
        studioRead('/api/email/broadcasts', headers),
        studioRead('/api/email/analytics', headers),
        studioRead('/api/email/audience', headers),
        studioRead('/api/email/segments', headers),
        studioRead('/api/email/lists', headers),
        studioRead('/api/drips/sequences', headers),
        studioRead('/api/drips/enrollments', headers),
        fetch(`/api/workspace/${wsId}/shopify/abandoned-checkouts`, { headers }).then(async r => ({ ...(await r.json().catch(() => ({}))), httpStatus: r.status })).catch(() => ({ httpStatus: 0 })),
        studioRead('/api/email/predictions', headers)
      ]);
      const body = (read: StudioRead): any => (read.answered && read.data && typeof read.data === 'object' ? read.data : {});
      const fRes = body(fRead);
      const bRes = body(bRead);
      const aRes = body(aRead);
      const sRes = body(sRead);
      const segRes = body(segRead);
      const listRes = body(listRead);
      const dSeqRes = body(dSeqRead);
      const dEnrRes = body(dEnrRead);
      const predRes = body(predRead);
      const outcomes: StudioLoads = {
        broadcasts: readOutcome(bRead, BROADCASTS_READ, (data) => Array.isArray(data.broadcasts)),
        analytics: readOutcome(aRead, RESULTS_READ, (data) => Boolean(data.analytics && typeof data.analytics === 'object')),
        audience: readOutcome(sRead, PEOPLE_READ, (data) => Array.isArray(data.subscribers)),
        enrollments: readOutcome(dEnrRead, STARTER_PEOPLE_READ, (data) => Array.isArray(data.enrollments))
      };
      setLoads(outcomes);

      if (fRes?.success && Array.isArray(fRes.flows)) setFlows(fRes.flows);
      if (outcomes.broadcasts.state === 'loaded') setBroadcasts(bRes.broadcasts);
      if (outcomes.analytics.state === 'loaded') setAnalytics(aRes.analytics);
      if (outcomes.audience.state === 'loaded') {
        setSubscribers(sRes.subscribers);
        if (sRes.rfmConfig) {
          setRfmConfig(sRes.rfmConfig);
          setCustomAtRiskDays(sRes.rfmConfig.atRiskDays ?? 90);
          setCustomLapsedDays(sRes.rfmConfig.lapsedDays ?? 180);
          setCustomVipPlatinum(sRes.rfmConfig.vipPlatinum ?? 500);
          setCustomVipGold(sRes.rfmConfig.vipGold ?? 250);
          setCustomVipSilver(sRes.rfmConfig.vipSilver ?? 100);
          setAutoWinbackEnabled(Boolean(sRes.rfmConfig.autoWinbackEnabled));
          setAllowUnlimitedDiscountUse(Boolean(sRes.rfmConfig.allowUnlimitedDiscountUse));
        }
        if (sRes.rfmSummary) setRfmSummary(sRes.rfmSummary);
      }
      if (segRes?.success && Array.isArray(segRes.segments)) setSegments(segRes.segments);
      if (listRes?.success && Array.isArray(listRes.lists)) setLists(listRes.lists);
      if (segRes?.followUpNote || bRes?.followUpNote) setFollowUpNote(segRes?.followUpNote || bRes?.followUpNote || '');
      if (dSeqRes?.success && Array.isArray(dSeqRes.sequences)) setDripSequences(dSeqRes.sequences);
      if (outcomes.enrollments.state === 'loaded') setDripEnrollments(dEnrRes.enrollments);
      if (chkRes?.success && Array.isArray(chkRes.checkouts)) {
        setAbandonedCheckouts(chkRes.checkouts);
        setCheckoutsLoad({ state: 'loaded' });
      } else {
        setCheckoutsLoad(checkoutsFailure(Number(chkRes?.httpStatus) || 0, chkRes?.error));
      }
      if (predRes?.success) {
        setPredictionNote(predRes.ready
          ? `Predicted value uses this store’s order gaps. Sample ${predRes.sampleSize}. Computed ${String(predRes.computedAt || '').slice(0, 10)}.`
          : `Predicted value stays blank until this account has 50 orders, 20 customers with two or more orders, and 90 days of history. ${predRes.missing || ''}`.trim());
      }
    } finally {
      setLoading(false);
    }
  };

  // The sequence list is read once at mount. After a starter flow's emails are saved on the Flow
  // map, read it again so All flows and its people table show this account's version.
  const refreshSequences = async () => {
    const data = await fetch('/api/drips/sequences', { headers: await authHeaders() }).then(r => r.json()).catch(() => ({}));
    if (data?.success && Array.isArray(data.sequences)) setDripSequences(data.sequences);
  };

  const handleRunDripTick = async () => {
    setProcessingDripTick(true);
    setDripTickMsg(null);
    try {
      const res = await fetch('/api/drips/process-tick', { method: 'POST', headers: await authHeaders() });
      const data = await res.json();
      if (data.success) {
        setDripTickMsg(`Processed ${data.processedCount} due steps • Exited ${data.convertedExitCount} converted buyers (${data.activeRemaining} active)`);
        loadData();
      }
    } catch (err) {
      console.warn('Drip tick failed:', err);
    } finally {
      setProcessingDripTick(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSyncShopifyCustomers = async () => {
    setSyncingShopify(true);
    setSyncSuccessMsg(null);
    try {
      const headers = await authHeaders();
      const wsId = workspace?.id || 'default';
      const res = await fetch(`/api/workspace/${wsId}/shopify/sync-customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers }
      });
      const data = await res.json().catch(() => ({}));
      setSyncSuccessMsg(data?.notice || (data?.storeReached
        ? `Imported ${data.importedCount || 0} customers from Shopify.`
        : 'Shopify was not reached. No customers were imported.'));
      setTimeout(() => setSyncSuccessMsg(null), 4000);
      if (data?.storeReached) await loadData();
    } catch (err) {
      console.error('Failed syncing Shopify customers:', err);
    } finally {
      setSyncingShopify(false);
    }
  };

  const handleSaveRfmConfig = async () => {
    setSavingRfmConfig(true);
    setRfmConfigSavedMsg(null);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/email/rfm-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          atRiskDays: Number(customAtRiskDays) || 90,
          lapsedDays: Number(customLapsedDays) || 180,
          vipPlatinum: Number(customVipPlatinum) || 500,
          vipGold: Number(customVipGold) || 250,
          vipSilver: Number(customVipSilver) || 100,
          autoWinbackEnabled,
          allowUnlimitedDiscountUse
        })
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        setRfmConfig(data.config);
        setAutoWinbackEnabled(Boolean(data.config?.autoWinbackEnabled));
        setAllowUnlimitedDiscountUse(Boolean(data.config?.allowUnlimitedDiscountUse));
        setRfmConfigSavedMsg(`Lifecycle thresholds updated! ${data.modifiedCount ?? 0} contacts re-evaluated.`);
        const audRes = await fetch('/api/email/audience', { headers }).then(r => r.json()).catch(() => ({}));
        if (audRes?.success) {
          if (Array.isArray(audRes.subscribers)) setSubscribers(audRes.subscribers);
          if (audRes.rfmSummary) setRfmSummary(audRes.rfmSummary);
        }
        setTimeout(() => {
          setShowRfmSettings(false);
          setRfmConfigSavedMsg(null);
        }, 1500);
      } else {
        alert(data?.error || 'Failed to save RFM thresholds');
      }
    } catch (err: any) {
      alert('Error updating thresholds: ' + err.message);
    } finally {
      setSavingRfmConfig(false);
    }
  };

  const handleCopyForKlaviyo = (flow: HubFlow) => {
    const text = flow.steps
      .map(
        (s, i) =>
          `EMAIL #${i + 1} (${s.delay})\nSubject: ${s.subject}\nPreview: ${s.previewText || ''}\n\n${s.body || ''}\n-----------------------------------\n`
      )
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopiedFlowId(flow.id);
    setTimeout(() => setCopiedFlowId(null), 2500);
  };

  const chooseWinner = async (id: string, winner: 'a' | 'b') => {
    const res = await fetch(`/api/email/campaigns/${id}/winner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ winner })
    });
    const data = await res.json().catch(() => ({}));
    setBroadcastNotice(data?.message || data?.error || '');
    if (data?.success) await loadData();
  };

  /**
   * Opens Broadcasts, New broadcast. `begin` starts the draft it opens on (a new one, a stored draft or
   * a written one); when the composer holds unsaved changes it asks before replacing them, and Cancel
   * changes nothing. Answers whether it opened.
   */
  const openComposer = (begin: () => void): boolean => {
    if (composer.dirty && !window.confirm(COMPOSER_REPLACE)) return false;
    begin();
    setMapFlowId('');
    setMapNodeId('');
    setFocusComposer(true);
    setActiveTab('builder');
    return true;
  };
  const openPreset = (kind: BroadcastPreset, person?: BroadcastPerson) => openComposer(() => composer.startPreset(kind, person));

  const handleDraftWhaleBroadcast = () => { openPreset('whales'); };
  const handleDraftWinbackBroadcast = () => { openPreset('at_risk'); };

  // A send or a schedule answered: All broadcasts, its sentence, focus on its heading, the list read again.
  const handleBroadcastSent = (message: string) => {
    setBroadcastNotice(message);
    setFocusBroadcasts(true);
    setActiveTab('campaigns');
    loadData();
  };
  useEffect(() => {
    if (!focusBroadcasts || activeTab !== 'campaigns') return;
    broadcastsHeading.current?.focus();
    setFocusBroadcasts(false);
  }, [focusBroadcasts, activeTab]);

  const isConnected = workspace?.shopifyConfig?.status === 'connected' && !!workspace?.shopifyConfig?.storeDomain;

  // D6: what Broadcasts and People say above their rows (studioLoad.ts listLine).
  const broadcastsLine = listLine(loads.broadcasts, broadcasts.length, BROADCASTS_LIST);
  const peopleLine = listLine(loads.audience, subscribers.length, PEOPLE_LIST);
  // The People figures and table, only once the audience was read: before that, or after a first read
  // failed, every count would be a 0 nobody measured.
  const peopleShown = loads.audience.state === 'loaded' || subscribers.length > 0;

  // How many emails the enrollment's own sequence has, or 0 when that sequence is not loaded.
  const stepCountOf = (sequenceId: string) => dripSequences.find((seq) => seq.id === sequenceId)?.steps.length || 0;

  return (
    <div
      style={{
        flex: 1,
        backgroundColor: '#0b0c10',
        color: '#f3f4f6',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflowY: 'auto'
      }}
    >
      {/* Top Banner / Store Context. Wraps at phone width so the buttons drop below the title
          instead of running past the edge into a sideways scroller (U08). */}
      <div
        style={{
          padding: `24px ${STUDIO_GUTTER} 16px`,
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px 16px',
          background: 'linear-gradient(180deg, rgba(236, 72, 153, 0.06) 0%, rgba(11, 12, 16, 0) 100%)'
        }}
      >
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px' }}>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#ffffff' }}>
              Email Studio & <span style={{ whiteSpace: 'nowrap' }}>E-Commerce</span> Flows
            </h1>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
            Flows, broadcasts, your audience, results and settings. A message counts as sent only when the service accepts it.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
          {isConnected ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                borderRadius: '8px',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                fontSize: '12px',
                color: '#34d399',
                minWidth: 0,
                overflowWrap: 'anywhere'
              }}
            >
              <ShoppingBag size={14} style={{ flexShrink: 0 }} />
              <span>Synced with {workspace?.shopifyConfig?.storeDomain}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenShopifyConnect}
              style={{
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                borderRadius: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#e5e7eb',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              <ShoppingBag size={14} style={{ color: '#10b981' }} />
              <span>Link Shopify Store</span>
            </button>
          )}

          {onReturnToCanvas && (
            <button
              type="button"
              onClick={onReturnToCanvas}
              style={{
                whiteSpace: 'nowrap',
                padding: '7px 14px',
                borderRadius: '8px',
                backgroundColor: 'rgba(236, 72, 153, 0.15)',
                border: '1px solid rgba(236, 72, 153, 0.3)',
                color: '#f472b6',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Back to Canvas
            </button>
          )}
        </div>
      </div>

      {/* The five destinations (EMAIL_STUDIO_PLAN.md D1), a WAI-ARIA tablist: Left and Right move the
          selection and the focus together, Home and End go to either end, and only the selected tab
          is in the Tab order. Each destination's sections are a second tablist of the same kind. */}
      <div
        role="tablist"
        aria-label="Email Studio"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
          padding: `8px ${STUDIO_GUTTER} 0`,
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
        }}
      >
        {STUDIO_DESTINATIONS.map((dest, index) => {
          const Icon = DESTINATION_ICONS[dest.key];
          const selected = dest.key === destination.key;
          return (
            <button
              key={dest.key}
              ref={(el) => { destinationTabs.current[dest.key] = el; }}
              type="button"
              role="tab"
              id={`email-studio-tab-${dest.key}`}
              aria-selected={selected}
              aria-controls={`email-studio-panel-${dest.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectDestination(dest.key)}
              onKeyDown={(e) => onDestinationKey(e, index)}
              style={studioTabStyle(selected, 'top')}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{dest.label}</span>
              {selected && <span aria-hidden="true" style={SELECTED_BAR} />}
            </button>
          );
        })}
      </div>

      {/* Every tab's aria-controls names a panel that exists; only the selected one has content. */}
      {STUDIO_DESTINATIONS.filter((dest) => dest.key !== destination.key).map((dest) => (
        <div key={dest.key} role="tabpanel" id={`email-studio-panel-${dest.key}`} aria-labelledby={`email-studio-tab-${dest.key}`} hidden />
      ))}
      <div
        role="tabpanel"
        id={`email-studio-panel-${destination.key}`}
        aria-labelledby={`email-studio-tab-${destination.key}`}
        // The panel that holds the content is the Tab stop after its tab (WAI-ARIA tabs: a panel whose
        // first content is not focusable takes tabindex 0). With a second strip that panel is the
        // section's, so this one stays out of the Tab order and Tab still goes from tab to section.
        tabIndex={destination.sections.length > 1 ? undefined : 0}
        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
      >
      {destination.sections.length > 1 && (
        <div
          role="tablist"
          aria-label={`${destination.label} sections`}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
            padding: `4px ${STUDIO_GUTTER} 0`,
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
          }}
        >
          {destination.sections.map((tab, index) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                ref={(el) => { sectionTabs.current[tab.key] = el; }}
                type="button"
                role="tab"
                id={`email-studio-section-tab-${tab.key}`}
                aria-selected={active}
                aria-controls={`email-studio-section-${tab.key}`}
                tabIndex={active ? 0 : -1}
                onClick={() => { selectSection(tab.key); }}
                onKeyDown={(e) => onSectionKey(e, index)}
                style={studioTabStyle(active, 'section')}
              >
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: '9999px',
                      backgroundColor: active ? 'rgba(236, 72, 153, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                      color: active ? '#f472b6' : '#d1d5db',
                      border: '1px solid rgba(255, 255, 255, 0.12)'
                    }}
                  >
                    {tab.badge}
                  </span>
                )}
                {active && <span aria-hidden="true" style={SELECTED_BAR} />}
              </button>
            );
          })}
        </div>
      )}
      {destination.sections.length > 1 && destination.sections.filter((tab) => tab.key !== activeTab).map((tab) => (
        <div key={tab.key} role="tabpanel" id={`email-studio-section-${tab.key}`} aria-labelledby={`email-studio-section-tab-${tab.key}`} hidden />
      ))}

      {/* Main Tab Content: the open section's panel. Today's panels sit here unchanged inside. */}
      <div
        {...(destination.sections.length > 1
          ? { role: 'tabpanel', id: `email-studio-section-${activeTab}`, 'aria-labelledby': `email-studio-section-tab-${activeTab}`, tabIndex: 0 }
          : {})}
        style={{ padding: `24px ${STUDIO_GUTTER}`, flex: 1 }}
      >
        {/* FLOWS, ALL FLOWS (EMAIL_STUDIO_PLAN.md Wave 4): one list of every flow, each row one button
            that opens it in the editor. Under it, two groups that stay closed until asked for: the
            people in the starter flows, and the hub's own flows, which are export only. */}
        {activeTab === 'flows' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <EmailFlowsList onOpenFlow={openFlowInMap} sequences={dripSequences} onRefresh={loadData} />
            <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af', maxWidth: '760px' }}>
              People join the starter flows from real leads and checkouts. The server checks for due emails every minute; Send due emails now, in Settings, Advanced, checks at once. An email is marked sent only after the email service accepts it.
            </p>

            {/* The people in the starter flows: one table for all of them, each row naming its flow. */}
            <details style={STUDIO_GROUP}>
              <summary style={STUDIO_GROUP_SUMMARY}>People in starter flows</summary>
              {/* D6: "nobody yet" only of a list that was read; a failed read says so. */}
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <StudioListLine line={listLine(loads.enrollments, dripEnrollments.length, STARTER_PEOPLE_LIST)} onRetry={loadData} busy={loading} />
              {dripEnrollments.length > 0 && (
              <div style={{ maxHeight: '240px', overflow: 'auto', backgroundColor: 'rgba(0, 0, 0, 0.25)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ color: '#9ca3af', textAlign: 'left', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <th style={{ padding: '8px 12px' }}>Email</th>
                      <th style={{ padding: '8px 12px' }}>Flow</th>
                      <th style={{ padding: '8px 12px' }}>Step</th>
                      <th style={{ padding: '8px 12px' }}>Status</th>
                      <th style={{ padding: '8px 12px' }}>History</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dripEnrollments.map(enr => (
                      <tr key={enr.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                        <td style={{ padding: '8px 12px', color: '#E2E8F0', fontWeight: 500 }}>{enr.customerEmail}</td>
                        <td style={{ padding: '8px 12px', color: '#d1d5db' }}>{dripSequences.find((seq) => seq.id === enr.sequenceId)?.name || enr.sequenceId}</td>
                        <td style={{ padding: '8px 12px', color: '#d1d5db' }}>Step {enr.currentStepIndex + 1}{stepCountOf(enr.sequenceId) ? ` of ${stepCountOf(enr.sequenceId)}` : ''}</td>
                        <td style={{ padding: '8px 12px', color: '#d1d5db' }}>
                          {/* Wave 2: an enrolment taken out because its starter flow was turned off says so, never "In the flow". */}
                          {enr.status === 'converted_exit' ? 'Ordered, so it stopped' : enr.status === 'completed' ? 'Finished' : enr.status === 'stopped' ? (enr.stoppedReason === 'flow_off' ? 'Taken out, flow turned off' : 'Stopped') : 'In the flow'}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#d1d5db' }}>
                          {/* Only the emails that went: a failed send or a skipped starter draft (Wave 2) is not one. */}
                          {(enr.history || []).filter((row) => row?.status === 'sent').length} sent
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
              </div>
            </details>

            {/* D1: the hub's own flows, at the foot, closed, and export only. */}
            {flows.length > 0 && (
              <details style={STUDIO_GROUP}>
                <summary style={STUDIO_GROUP_SUMMARY}>From the hub, export only</summary>
                <div style={{ marginTop: '12px' }}>
              {/* Flows Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(460px, 100%), 1fr))', gap: '16px' }}>
                {flows.map(flow => (
                  <div
                    key={flow.id}
                    style={{
                      backgroundColor: '#121217',
                      borderRadius: '12px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      padding: '20px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '14px',
                      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: 600, fontSize: '15px', color: '#ffffff' }}>{flow.name}</span>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: flow.active ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                              color: flow.active ? '#34d399' : '#9ca3af'
                            }}
                          >
                            {flow.active ? 'Active' : 'Draft'}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '3px' }}>
                          {flow.steps.length === 1 ? '1 step' : `${flow.steps.length} steps`} · Export only. What starts it is set where you import it.
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setExportPlatform('klaviyo');
                            setExportModalFlow(flow);
                          }}
                          style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            backgroundColor: 'rgba(99, 102, 241, 0.15)',
                            border: '1px solid rgba(99, 102, 241, 0.35)',
                            color: '#A5B4FC',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          title="Export with Klaviyo Liquid merge tags"
                        >
                          <ExternalLink size={12} />
                          <span>Klaviyo</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setExportPlatform('shopify');
                            setExportModalFlow(flow);
                          }}
                          style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            backgroundColor: 'rgba(16, 185, 129, 0.12)',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            color: '#34D399',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          title="Export with Shopify Email Liquid variables"
                        >
                          <ShoppingBag size={12} />
                          <span>Shopify</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleCopyForKlaviyo(flow)}
                          style={{
                            padding: '6px 8px',
                            borderRadius: '6px',
                            backgroundColor: copiedFlowId === flow.id ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                            border: `1px solid ${copiedFlowId === flow.id ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
                            color: copiedFlowId === flow.id ? '#34d399' : '#9ca3af',
                            fontSize: '11px',
                            fontWeight: 500,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                          title="Quick copy plain text"
                        >
                          {copiedFlowId === flow.id ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>

                    {/* Flow Steps Progression */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {flow.steps.map((step, idx) => (
                        <div
                          key={idx}
                          style={{
                            backgroundColor: 'rgba(0, 0, 0, 0.3)',
                            borderRadius: '8px',
                            border: '1px solid rgba(255, 255, 255, 0.05)',
                            padding: '10px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '12px'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '6px',
                                backgroundColor: 'rgba(236, 72, 153, 0.15)',
                                color: '#ec4899',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '11px',
                                fontWeight: 700,
                                flexShrink: 0
                              }}
                            >
                              {idx + 1}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: '13px', fontWeight: 500, color: '#f3f4f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {step.subject}
                              </div>
                              <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                                Delay: {step.delay} {step.previewText ? `• "${step.previewText}"` : ''}
                              </div>
                            </div>
                          </div>
                          <Mail size={15} style={{ color: '#6b7280', flexShrink: 0 }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

                </div>
              </details>
            )}
          </div>
        )}

        {/* TAB 2: CAMPAIGNS (BROADCASTS) */}
        {activeTab === 'map' && <EmailFlowMap initialFlowId={mapFlowId || openFlowId} initialNodeId={mapNodeId || undefined} fromStep={!mapFlowId} onContentSaved={refreshSequences} />}
        {/* BROADCASTS, NEW BROADCAST (Wave 5): the composer, the builder plus who gets it and when. */}
        {activeTab === 'builder' && (
          <BroadcastComposer
            composer={composer}
            workspaceId={workspace?.id}
            focusHeading={focusComposer}
            onHeadingFocused={() => setFocusComposer(false)}
            onSent={handleBroadcastSent}
          />
        )}
        {activeTab === 'forms' && <SignupForms />}
        {activeTab === 'inbox' && <EmailInbox />}
        {activeTab === 'sms' && <SmsPanel />}
        {activeTab === 'sending' && <SendingSetup />}
        {activeTab === 'klaviyo' && <KlaviyoSync />}
        {/* AUDIENCE, OPEN CHECKOUTS: the abandoned checkouts table, moved off Flows (D1). It says
            "none yet" only of a list that was read. */}
        {activeTab === 'checkouts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {checkoutsLoad.state === 'loading' && (
              <p role="status" style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>Loading open checkouts.</p>
            )}
            {/* The one failure line every studio list uses, so its button is Retry, named for this read. */}
            {checkoutsLoad.state === 'failed' && (
              <StudioListLine line={{ kind: 'failed', text: checkoutsLoad.text, retry: checkoutsLoad.retry }} onRetry={() => { void loadData(); }} busy={loading} />
            )}
            {checkoutsLoad.state === 'loaded' && abandonedCheckouts.length === 0 && (
              <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
                No open checkouts yet. A checkout someone starts in your Shopify store and does not finish shows here.
              </p>
            )}
            {abandonedCheckouts.length > 0 && (
              <div
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '12px',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.3)', color: '#F472B6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ShoppingBag size={14} />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#F8FAFC' }}>
                        Shopify Abandoned Checkouts Queue
                      </h3>
                      <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                        Live cart drop-offs captured via Shopify checkout webhooks with 1-click recovery permalinks.
                      </div>
                    </div>
                  </div>

                  <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#34D399' }}>
                    {abandonedCheckouts.filter(c => c.recoveryStatus === 'recovered').length} Recovered
                  </span>
                </div>

                <div style={{
                  overflowX: 'auto',
                  backgroundColor: 'rgba(0, 0, 0, 0.25)',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.04)'
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                    <thead>
                      <tr style={{ color: '#64748B', textAlign: 'left', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <th style={{ padding: '8px 12px' }}>Customer Email</th>
                        <th style={{ padding: '8px 12px' }}>Cart Value</th>
                        <th style={{ padding: '8px 12px' }}>Items</th>
                        <th style={{ padding: '8px 12px' }}>Status</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right' }}>Recovery Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {abandonedCheckouts.map(chk => (
                        <tr key={chk.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                          <td style={{ padding: '8px 12px', color: '#E2E8F0', fontWeight: 500 }}>
                            {chk.customerEmail}
                          </td>
                          <td style={{ padding: '8px 12px', color: '#34D399', fontWeight: 700 }}>
                            ${chk.totalPrice.toFixed(2)}
                          </td>
                          <td style={{ padding: '8px 12px', color: '#94A3B8' }}>
                            {chk.lineItems.map(li => li.title).join(', ') || 'Cart Items'}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 700,
                              backgroundColor: chk.recoveryStatus === 'recovered' ? 'rgba(16, 185, 129, 0.2)' : chk.recoveryStatus === 'email_sent' ? 'rgba(59, 130, 246, 0.2)' : chk.recoveryStatus === 'stopped' ? 'rgba(148, 163, 184, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                              color: chk.recoveryStatus === 'recovered' ? '#34D399' : chk.recoveryStatus === 'email_sent' ? '#60A5FA' : chk.recoveryStatus === 'stopped' ? '#E2E8F0' : '#FACC15'
                            }}>
                              {/* Wave 2: a checkout stopped (Cart recovery turned off, or a test address) is never "Pending". */}
                              {chk.recoveryStatus === 'recovered' ? 'Recovered' : chk.recoveryStatus === 'email_sent' ? 'Email sent' : chk.recoveryStatus === 'stopped' ? (chk.stoppedReason === 'flow_off' ? 'Stopped, flow turned off' : 'Stopped') : 'Pending'}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            <a
                              href={chk.abandonedCheckoutUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                color: '#F472B6',
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                            >
                              <span>Open Cart</span>
                              <ExternalLink size={10} />
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        )}

        {/* SETTINGS, ADVANCED: the hand-run controls, off the Flows screen (D1), named per D2. */}
        {activeTab === 'advanced' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '760px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f3f4f6' }}>Advanced</h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>Controls you rarely need. Flows run without them.</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)', backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px' }}>
                <button
                  type="button"
                  onClick={handleRunDripTick}
                  disabled={processingDripTick}
                  aria-describedby="studio-send-due-note"
                  style={{
                    minHeight: '40px',
                    padding: '0 14px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(99, 102, 241, 0.2))',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    color: '#34D399',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Play size={13} aria-hidden="true" />
                  <span>{processingDripTick ? 'Sending due emails' : 'Send due emails now'}</span>
                </button>
                <p id="studio-send-due-note" style={{ flex: '1 1 260px', margin: 0, fontSize: '13px', color: '#9ca3af' }}>
                  The server checks for due emails every minute. This checks at once: it sends what is due and stops a flow for anyone who has bought since, where that flow stops on a purchase.
                </p>
              </div>
              <div role="status">
                {dripTickMsg && (
                  <div style={{
                    padding: '10px 16px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    color: '#34D399',
                    fontSize: '12px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <CheckCircle2 size={15} />
                    <span>{dripTickMsg}</span>
                  </div>
                )}

              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)', backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
              <button
                type="button"
                onClick={() => setShowWebhookGuide(true)}
                aria-describedby="studio-webhooks-note"
                style={{
                  minHeight: '40px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(236, 72, 153, 0.1)',
                  border: '1px solid rgba(236, 72, 153, 0.25)',
                  color: '#F472B6',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Zap size={13} aria-hidden="true" />
                <span>Webhooks</span>
              </button>
              <p id="studio-webhooks-note" style={{ flex: '1 1 260px', margin: 0, fontSize: '13px', color: '#9ca3af' }}>
                When a landing page has a webhook address saved, each lead it captures is posted there as JSON. This shows the fields.
              </p>
            </div>
          </div>
        )}
        {activeTab === 'campaigns' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 ref={broadcastsHeading} tabIndex={-1} style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>
                  All broadcasts
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
                  A broadcast is one email sent once to a list or a segment. New broadcast opens the builder, with who gets it and when.
                </p>
                {/* Only from a Results read that answered: a failed read says nothing about opens. */}
                {analytics && analytics.opensStored !== true && (
                  <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#9ca3af' }}>{OPENS_UNSTORED}</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => { openComposer(() => composer.start()); }}
                style={{
                  padding: '9px 18px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #ec4899, #db2777)',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 14px rgba(236, 72, 153, 0.35)'
                }}
              >
                <Plus size={16} aria-hidden="true" />
                <span>New broadcast</span>
              </button>
            </div>

            <p role="status" style={{ margin: 0, fontSize: '13px', color: '#d1d5db' }}>{broadcastNotice}</p>

            <BroadcastDraftList
              onOpen={(draft) => { openComposer(() => composer.start(draft)); }}
              onDeleted={(id) => composer.forget(id)}
            />

            {/* Broadcasts List. Six columns cannot share a phone's width, so the table scrolls
                sideways inside its own card (the page never does) and takes keyboard focus to do it. */}
            <div
              role="region"
              aria-label="Broadcasts"
              tabIndex={0}
              style={{
                backgroundColor: '#121217',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                overflowX: 'auto',
                overflowY: 'hidden'
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2.5fr 1fr 1fr 1fr 1fr 1fr',
                  minWidth: BROADCAST_TABLE_MIN_WIDTH,
                  padding: '12px 20px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#6b7280',
                  textTransform: 'uppercase'
                }}
              >
                <div>Broadcast & audience</div>
                <div>Send Mode</div>
                <div>Sent Date</div>
                <div>Sent</div>
                <div>Opened</div>
                <div>Revenue</div>
              </div>

              {/* D6: "No broadcasts yet" only of a list that was read; a failed read says so, with Retry. */}
              {broadcastsLine.kind !== 'none' && (
                <div style={{ padding: '20px' }}>
                  <StudioListLine line={broadcastsLine} onRetry={loadData} busy={loading} />
                </div>
              )}
              {broadcasts.map(b => (
                  <div
                    key={b.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '2.5fr 1fr 1fr 1fr 1fr 1fr',
                      minWidth: BROADCAST_TABLE_MIN_WIDTH,
                      padding: '14px 20px',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      fontSize: '13px',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500, color: '#f3f4f6' }}>{b.subject}</div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
                        <span
                          style={{
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            backgroundColor: 'rgba(236, 72, 153, 0.12)',
                            color: '#f472b6',
                            border: '1px solid rgba(236, 72, 153, 0.25)'
                          }}
                        >
                          {b.segmentName || b.segment || 'All Subscribers'}
                        </span>
                        {b.previewText && (
                          <span style={{ fontSize: '11px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
                            "{b.previewText}"
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                          backgroundColor: b.sendMode === 'shopify_push' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                          color: b.sendMode === 'shopify_push' ? '#60a5fa' : '#34d399'
                        }}
                      >
                        {b.sendMode === 'shopify_push' ? 'Shopify Push' : 'Direct Delivery'}
                      </span>
                    </div>

                    <div style={{ color: '#9ca3af', fontSize: '12px' }}>{b.sentAt ? new Date(b.sentAt).toLocaleDateString() : (b.status === 'scheduled' ? 'Scheduled' : 'Not sent')}</div>
                    <div style={{ color: '#d1d5db', fontWeight: 500 }}>{statText(b.sent, (n) => n.toLocaleString())}</div>
                    {b.opened == null && b.clicked == null ? (
                      <div style={{ color: '#9ca3af' }}>{STAT_UNAVAILABLE}</div>
                    ) : (
                      <div>
                        <span style={{ color: '#34d399', fontWeight: 600 }}>{statText(b.opened)}</span>
                        <span style={{ color: '#6b7280', margin: '0 4px' }}>/</span>
                        <span style={{ color: '#60a5fa', fontWeight: 600 }}>{statText(b.clicked)}</span>
                      </div>
                    )}
                    <div style={{ color: '#fbbf24', fontWeight: 700 }}>
                      {moneyText(b.revenue)}
                    </div>
                    <p style={{ gridColumn: '1 / -1', margin: '8px 0 0', fontSize: 12, color: '#9ca3af' }}>
                      Delivered {statText(b.delivered)} · Unsubscribed {statText(b.unsubscribed)}
                      {b.prefetchOpens ? ` · ${b.prefetchOpens} opens included an Apple Mail prefetch flag.` : ''}
                    </p>
                    {b.smartReport && <p style={{ gridColumn: '1 / -1', margin: '8px 0 0', fontSize: 12, color: '#d1d5db' }}>{b.smartReport}</p>}
                    {b.holdout?.enabled && (
                      <p style={{ gridColumn: '1 / -1', margin: '8px 0 0', fontSize: 12, color: '#d1d5db' }}>
                        Holdout {b.holdout.percent}%. Sent group: {b.holdoutReport?.sent.sample ? `${b.holdoutReport.sent.sample} people, ${moneyText(b.holdoutReport.sent.perPerson)} each` : STAT_UNAVAILABLE}. Held-out group: {b.holdoutReport?.held.sample ? `${b.holdoutReport.held.sample} people, ${moneyText(b.holdoutReport.held.perPerson)} each` : STAT_UNAVAILABLE}.
                      </p>
                    )}
                    {b.ab && !b.ab.winner && (
                      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, marginTop: 8 }}>
                        <button type="button" onClick={() => chooseWinner(b.id, 'a')} style={{ fontSize: 12, color: '#e5e7eb', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>Set A as the winner</button>
                        <button type="button" onClick={() => chooseWinner(b.id, 'b')} style={{ fontSize: 12, color: '#e5e7eb', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>Set B as the winner</button>
                      </div>
                    )}
                  </div>
                ))}
            </div>
            {followUpNote && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#9ca3af' }}>{followUpNote}</p>}
          </div>
        )}

        {/* TAB 3: AUDIENCE & CRM */}
        {activeTab === 'audience' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>
                  Unified Customer CRM & Subscribers
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
                  Real-time sync between your Shopify customers, captured funnel leads, and exit-intent rescued shoppers.
                </p>
                {predictionNote && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#d1d5db' }}>{predictionNote}</p>}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setShowRfmSettings(true)}
                  style={{
                    padding: '9px 16px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(168, 85, 247, 0.12)',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    color: '#c084fc',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.2s'
                  }}
                >
                  <SlidersHorizontal size={15} />
                  <span>Lifecycle & Inactivity Settings</span>
                </button>

                <button
                  onClick={handleSyncShopifyCustomers}
                  disabled={syncingShopify}
                  style={{
                    padding: '9px 16px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: syncingShopify ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.2s'
                  }}
                >
                  <RefreshCw size={15} className={syncingShopify ? 'animate-spin' : ''} />
                  <span>{syncingShopify ? 'Syncing Shopify...' : 'Sync Shopify Customers'}</span>
                </button>
              </div>
            </div>

            {syncSuccessMsg && (
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#34d399',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <CheckCircle2 size={16} />
                <span>{syncSuccessMsg}</span>
              </div>
            )}

            {/* D6: loading, a failed read (with Retry where it can help), or "No people yet" of a list that was read. */}
            <StudioListLine line={peopleLine} onRetry={loadData} busy={loading} />

            {/* Audience Stats Ribbon */}
            {peopleShown && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div style={{ backgroundColor: '#121217', padding: '16px 20px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>Total Contacts</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#ffffff', marginTop: '4px' }}>
                  {subscribers.length.toLocaleString()}
                </div>
                <div style={{ fontSize: '11px', color: '#34d399', marginTop: '2px' }}>
                  {(rfmSummary?.leads ?? subscribers.filter(s => (s.ordersCount || 0) === 0).length)} prospects • {(rfmSummary?.totalBuyers ?? subscribers.filter(s => (s.ordersCount || 0) > 0).length)} buyers
                </div>
              </div>

              <div style={{ backgroundColor: 'rgba(168, 85, 247, 0.06)', padding: '16px 20px', borderRadius: '12px', border: '1px solid rgba(168, 85, 247, 0.3)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '11px', color: '#c084fc', textTransform: 'uppercase', fontWeight: 600 }}>VIP Whales (${rfmConfig.vipPlatinum}+)</div>
                    <Crown size={14} style={{ color: '#c084fc' }} />
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#e9d5ff', marginTop: '4px' }}>
                    {(rfmSummary?.whales ?? subscribers.filter(s => s.rfmTier === 'whale' || (s.totalSpent || 0) >= rfmConfig.vipPlatinum).length).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '11px', color: '#c084fc', marginTop: '2px' }}>Platinum top spenders</div>
                </div>
                <button
                  type="button"
                  onClick={handleDraftWhaleBroadcast}
                  style={{
                    marginTop: '10px',
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: '7px',
                    border: '1px solid rgba(192, 132, 252, 0.35)',
                    backgroundColor: 'rgba(168, 85, 247, 0.15)',
                    color: '#f3e8ff',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'background-color 0.15s ease'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(168, 85, 247, 0.28)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(168, 85, 247, 0.15)')}
                >
                  <Send size={11} /> Draft a VIP email
                </button>
              </div>

              <div style={{ backgroundColor: 'rgba(234, 179, 8, 0.06)', padding: '16px 20px', borderRadius: '12px', border: '1px solid rgba(234, 179, 8, 0.25)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#facc15', textTransform: 'uppercase', fontWeight: 600 }}>VIP Gold & Silver</div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#fef08a', marginTop: '4px' }}>
                    {((rfmSummary ? (rfmSummary.gold + rfmSummary.silver) : subscribers.filter(s => s.rfmTier === 'gold' || s.rfmTier === 'silver').length)).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '11px', color: '#eab308', marginTop: '2px' }}>
                    {rfmSummary?.gold ?? subscribers.filter(s => s.rfmTier === 'gold').length} Gold • {rfmSummary?.silver ?? subscribers.filter(s => s.rfmTier === 'silver').length} Silver
                  </div>
                </div>
              </div>

              <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.06)', padding: '16px 20px', borderRadius: '12px', border: '1px solid rgba(245, 158, 11, 0.25)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '11px', color: '#fbbf24', textTransform: 'uppercase', fontWeight: 600 }}>At-Risk Inactive ({rfmConfig.atRiskDays}d+)</div>
                    <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#fde68a', marginTop: '4px' }}>
                    {(rfmSummary?.atRisk ?? subscribers.filter(s => s.isAtRisk).length).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '2px' }}>
                    Needs retention • {(rfmSummary?.lapsed ?? subscribers.filter(s => s.isLapsed).length)} lapsed
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDraftWinbackBroadcast}
                  style={{
                    marginTop: '10px',
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: '7px',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    color: '#fef3c7',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'background-color 0.15s ease'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(245, 158, 11, 0.28)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(245, 158, 11, 0.15)')}
                >
                  <Send size={11} /> Draft Winback
                </button>
              </div>

              <div style={{ backgroundColor: '#121217', padding: '16px 20px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>Total Customer LTV</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#10b981', marginTop: '4px' }}>
                  ${subscribers.reduce((sum, s) => sum + (s.totalSpent || 0), 0).toFixed(2)}
                </div>
                <div style={{ fontSize: '11px', color: '#34d399', marginTop: '2px' }}>Attributed customer spend</div>
              </div>
            </div>
            )}

            <AudienceDesk />

            {peopleShown && (
            <>
            {/* Filter Pills & Search */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { id: 'all', label: `All (${subscribers.length})` },
                  { id: 'whales', label: `VIP Whales (${rfmSummary?.whales ?? subscribers.filter(s => s.rfmTier === 'whale' || (s.totalSpent || 0) >= rfmConfig.vipPlatinum).length})` },
                  { id: 'gold', label: `VIP Gold (${rfmSummary?.gold ?? subscribers.filter(s => s.rfmTier === 'gold').length})` },
                  { id: 'silver', label: `VIP Silver (${rfmSummary?.silver ?? subscribers.filter(s => s.rfmTier === 'silver').length})` },
                  { id: 'at_risk', label: `At-Risk Inactive (${rfmSummary?.atRisk ?? subscribers.filter(s => s.isAtRisk).length})` },
                  { id: 'buyers', label: `Verified Buyers (${subscribers.filter(s => (s.ordersCount || 0) > 0).length})` },
                  { id: 'repeat', label: `Repeat Buyers (${subscribers.filter(s => (s.ordersCount || 0) >= 2).length})` },
                  { id: 'leads', label: `Funnel Leads (${subscribers.filter(s => (s.ordersCount || 0) === 0).length})` },
                  { id: 'exit_rescue', label: `Exit Rescues (${subscribers.filter(s => (s.tags || []).includes('Exit-Intent-Rescue')).length})` }
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setAudienceFilter(p.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      border: audienceFilter === p.id ? '1px solid #ec4899' : '1px solid rgba(255, 255, 255, 0.08)',
                      backgroundColor: audienceFilter === p.id ? 'rgba(236, 72, 153, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                      color: audienceFilter === p.id ? '#ffffff' : '#9ca3af',
                      fontSize: '12px',
                      fontWeight: audienceFilter === p.id ? 600 : 500,
                      cursor: 'pointer'
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div style={{ position: 'relative', width: '220px' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: '#6b7280' }} />
                <input
                  type="text"
                  placeholder="Search contacts..."
                  value={audienceSearch}
                  onChange={e => setAudienceSearch(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 12px 8px 32px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    color: '#ffffff',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            {/* CRM Customer Table */}
            <div
              style={{
                backgroundColor: '#121217',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.5fr 1.5fr 1.2fr 1fr 1.8fr 36px',
                  padding: '12px 20px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#6b7280',
                  textTransform: 'uppercase'
                }}
              >
                <div>Customer & Lifecycle Tier</div>
                <div>Email & Phone</div>
                <div>Orders & Recency</div>
                <div>Marketing</div>
                <div>Tags & Lifecycle</div>
                <div style={{ textAlign: 'center' }}>360°</div>
              </div>

              {subscribers
                .filter(sub => {
                  if (audienceFilter === 'whales') return sub.rfmTier === 'whale' || (sub.totalSpent || 0) >= rfmConfig.vipPlatinum || (sub.tags || []).includes('VIP-Platinum');
                  if (audienceFilter === 'gold') return sub.rfmTier === 'gold' || (sub.tags || []).includes('VIP-Gold');
                  if (audienceFilter === 'silver') return sub.rfmTier === 'silver' || (sub.tags || []).includes('VIP-Silver');
                  if (audienceFilter === 'at_risk') return !!sub.isAtRisk || (sub.tags || []).includes('At-Risk');
                  if (audienceFilter === 'buyers') return (sub.ordersCount || 0) > 0;
                  if (audienceFilter === 'vip') return (sub.totalSpent || 0) >= 100 || (sub.tags || []).includes('VIP Customer');
                  if (audienceFilter === 'repeat') return (sub.ordersCount || 0) >= 2 || (sub.tags || []).includes('Repeat Buyer');
                  if (audienceFilter === 'leads') return (sub.ordersCount || 0) === 0;
                  if (audienceFilter === 'exit_rescue') return (sub.tags || []).includes('Exit-Intent-Rescue');
                  return true;
                })
                .filter(sub => {
                  if (!audienceSearch) return true;
                  const q = audienceSearch.toLowerCase();
                  return (
                    sub.name.toLowerCase().includes(q) ||
                    sub.email.toLowerCase().includes(q) ||
                    (sub.phone && sub.phone.includes(q)) ||
                    sub.tags.some(t => t.toLowerCase().includes(q)) ||
                    (sub.rfmBadge && sub.rfmBadge.toLowerCase().includes(q)) ||
                    (sub.rfmSegment && sub.rfmSegment.toLowerCase().includes(q))
                  );
                })
                .map((sub, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedCustomerEmail(sub.email)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.5fr 1.5fr 1.2fr 1fr 1.8fr 36px',
                      padding: '14px 20px',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      fontSize: '13px',
                      alignItems: 'center',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color: '#f3f4f6' }}>{sub.name || 'Anonymous Customer'}</span>
                        {sub.rfmBadge && (
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              backgroundColor: sub.rfmTier === 'whale' ? 'rgba(168, 85, 247, 0.18)' :
                                               sub.rfmTier === 'gold' ? 'rgba(234, 179, 8, 0.18)' :
                                               sub.rfmTier === 'silver' ? 'rgba(6, 182, 212, 0.18)' :
                                               sub.rfmTier === 'at_risk' ? 'rgba(245, 158, 11, 0.18)' :
                                               sub.rfmTier === 'lapsed' ? 'rgba(239, 68, 68, 0.18)' :
                                               sub.rfmTier === 'new' ? 'rgba(16, 185, 129, 0.18)' : 'rgba(255, 255, 255, 0.08)',
                              color: sub.rfmColor || (sub.rfmTier === 'whale' ? '#c084fc' : sub.rfmTier === 'at_risk' ? '#fbbf24' : '#94a3b8'),
                              border: `1px solid ${sub.rfmTier === 'whale' ? 'rgba(168, 85, 247, 0.4)' : sub.rfmTier === 'at_risk' ? 'rgba(245, 158, 11, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`
                            }}
                          >
                            {sub.rfmTier === 'whale' && <Crown size={10} />}
                            {sub.rfmTier === 'at_risk' && <AlertTriangle size={10} />}
                            {sub.rfmBadge}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                        Joined {new Date(sub.joinedAt).toLocaleDateString()}
                      </div>
                    </div>

                    <div>
                      <div style={{ color: '#e2e8f0', fontSize: '12px' }}>{sub.email}</div>
                      {sub.phone && <div style={{ color: '#94a3b8', fontSize: '11px' }}>{sub.phone}</div>}
                    </div>

                    <div>
                      <div style={{ color: '#ffffff', fontWeight: 600 }}>
                        ${(sub.totalSpent || 0).toFixed(2)}
                      </div>
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                        {sub.ordersCount || 0} {(sub.ordersCount || 0) === 1 ? 'order' : 'orders'}
                      </div>
                      {sub.recencyDays != null ? (
                        <div style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          marginTop: '2px',
                          color: sub.isLapsed ? '#ef4444' : sub.isAtRisk ? '#f59e0b' : (sub.recencyDays <= 30 ? '#10b981' : '#94a3b8')
                        }}>
                          {sub.recencyDays === 0 ? 'Ordered today' :
                           sub.isAtRisk ? `At-Risk (${sub.recencyDays}d inactive)` :
                           sub.isLapsed ? `Lapsed (${sub.recencyDays}d)` :
                           `Ordered ${sub.recencyDays}d ago`}
                        </div>
                      ) : (
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>No orders yet</div>
                      )}
                    </div>

                    <div>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                          backgroundColor: sub.status === 'active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: sub.status === 'active' ? '#34d399' : '#f87171'
                        }}
                      >
                        {sub.status === 'active' ? 'Subscribed' : 'Unsubscribed'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {sub.tags.map((tag, tIdx) => {
                        const isWhale = tag === 'VIP-Platinum';
                        const isGold = tag === 'VIP-Gold';
                        const isSilver = tag === 'VIP-Silver';
                        const isVipGen = tag === 'VIP Customer';
                        const isAtRisk = tag === 'At-Risk';
                        const isLapsed = tag === 'Lapsed';
                        const isBuyer = tag.includes('Buyer');

                        return (
                          <span
                            key={tIdx}
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              backgroundColor: isWhale
                                ? 'rgba(168, 85, 247, 0.2)'
                                : isGold
                                ? 'rgba(234, 179, 8, 0.18)'
                                : isSilver
                                ? 'rgba(6, 182, 212, 0.18)'
                                : isVipGen
                                ? 'rgba(236, 72, 153, 0.15)'
                                : isAtRisk
                                ? 'rgba(245, 158, 11, 0.18)'
                                : isLapsed
                                ? 'rgba(239, 68, 68, 0.18)'
                                : isBuyer
                                ? 'rgba(16, 185, 129, 0.12)'
                                : 'rgba(255, 255, 255, 0.06)',
                              color: isWhale
                                ? '#e9d5ff'
                                : isGold
                                ? '#fef08a'
                                : isSilver
                                ? '#a5f3fc'
                                : isVipGen
                                ? '#f472b6'
                                : isAtRisk
                                ? '#fbbf24'
                                : isLapsed
                                ? '#f87171'
                                : isBuyer
                                ? '#34d399'
                                : '#d1d5db',
                              border: isWhale
                                ? '1px solid rgba(168, 85, 247, 0.4)'
                                : isAtRisk
                                ? '1px solid rgba(245, 158, 11, 0.4)'
                                : '1px solid rgba(255, 255, 255, 0.1)'
                            }}
                          >
                            {tag}
                          </span>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <span
                        title="View Customer 360 Profile"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '24px',
                          height: '24px',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          color: '#94a3b8'
                        }}
                      >
                        <ChevronRight size={13} />
                      </span>
                    </div>
                  </div>
                ))}
            </div>
            </>
            )}

            {/* RFM Lifecycle & Inactivity Settings Modal */}
            {showRfmSettings && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.75)',
                  backdropFilter: 'blur(6px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 9999,
                  padding: '20px'
                }}
              >
                <div
                  style={{
                    backgroundColor: '#16161d',
                    borderRadius: '16px',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 30px rgba(168, 85, 247, 0.15)',
                    width: '100%',
                    maxWidth: '560px',
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      padding: '20px 24px',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(168, 85, 247, 0.15)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#c084fc'
                        }}
                      >
                        <SlidersHorizontal size={18} />
                      </div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#ffffff' }}>
                          Customer Lifecycle & Inactivity Thresholds
                        </h3>
                        <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#9ca3af' }}>
                          Customize VIP whale spend tiers and inactivity decay windows.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowRfmSettings(false)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#9ca3af',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                    {rfmConfigSavedMsg && (
                      <div
                        style={{
                          padding: '10px 14px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(16, 185, 129, 0.15)',
                          border: '1px solid rgba(16, 185, 129, 0.3)',
                          color: '#34d399',
                          fontSize: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                      >
                        <CheckCircle2 size={16} />
                        <span>{rfmConfigSavedMsg}</span>
                      </div>
                    )}

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6' }}>
                          At-Risk Inactivity Window (Days)
                        </label>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#f59e0b' }}>
                          {customAtRiskDays} Days
                        </span>
                      </div>
                      <p style={{ margin: '4px 0 8px', fontSize: '12px', color: '#9ca3af' }}>
                        Clients with no purchases after this many days are marked At-Risk, so the winback flow can reach them.
                      </p>
                      <input
                        type="range"
                        min="14"
                        max="180"
                        step="5"
                        value={customAtRiskDays}
                        onChange={e => setCustomAtRiskDays(Number(e.target.value))}
                        style={{ width: '100%', accentColor: '#f59e0b', cursor: 'pointer' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                        <span>14d (Fast)</span>
                        <span>60d</span>
                        <span>90d (Default)</span>
                        <span>180d</span>
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6' }}>
                          Lapsed Inactivity Window (Days)
                        </label>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#ef4444' }}>
                          {customLapsedDays} Days
                        </span>
                      </div>
                      <p style={{ margin: '4px 0 8px', fontSize: '12px', color: '#9ca3af' }}>
                        Clients inactive past this period receive the Lapsed status.
                      </p>
                      <input
                        type="range"
                        min="60"
                        max="365"
                        step="15"
                        value={customLapsedDays}
                        onChange={e => setCustomLapsedDays(Number(e.target.value))}
                        style={{ width: '100%', accentColor: '#ef4444', cursor: 'pointer' }}
                      />
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '16px' }}>
                      <h4 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 600, color: '#f3f4f6' }}>
                        VIP Spend Tiers
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#c084fc', marginBottom: '4px' }}>
                            Platinum Whale ($)
                          </label>
                          <input
                            type="number"
                            min="50"
                            step="25"
                            value={customVipPlatinum}
                            onChange={e => setCustomVipPlatinum(Number(e.target.value))}
                            style={{
                              width: '100%',
                              boxSizing: 'border-box',
                              padding: '8px 10px',
                              borderRadius: '8px',
                              border: '1px solid rgba(168, 85, 247, 0.3)',
                              backgroundColor: 'rgba(0, 0, 0, 0.3)',
                              color: '#ffffff',
                              fontSize: '13px',
                              fontWeight: 600
                            }}
                          />
                          <span style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>Top Whale tier</span>
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#facc15', marginBottom: '4px' }}>
                            VIP Gold ($)
                          </label>
                          <input
                            type="number"
                            min="25"
                            step="25"
                            value={customVipGold}
                            onChange={e => setCustomVipGold(Number(e.target.value))}
                            style={{
                              width: '100%',
                              boxSizing: 'border-box',
                              padding: '8px 10px',
                              borderRadius: '8px',
                              border: '1px solid rgba(234, 179, 8, 0.3)',
                              backgroundColor: 'rgba(0, 0, 0, 0.3)',
                              color: '#ffffff',
                              fontSize: '13px',
                              fontWeight: 600
                            }}
                          />
                          <span style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>Luxe frequent</span>
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#22d3ee', marginBottom: '4px' }}>
                            VIP Silver ($)
                          </label>
                          <input
                            type="number"
                            min="10"
                            step="25"
                            value={customVipSilver}
                            onChange={e => setCustomVipSilver(Number(e.target.value))}
                            style={{
                              width: '100%',
                              boxSizing: 'border-box',
                              padding: '8px 10px',
                              borderRadius: '8px',
                              border: '1px solid rgba(6, 182, 212, 0.3)',
                              backgroundColor: 'rgba(0, 0, 0, 0.3)',
                              color: '#ffffff',
                              fontSize: '13px',
                              fontWeight: 600
                            }}
                          />
                          <span style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>Rising VIP</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <label htmlFor="autoWinbackToggle" style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6', cursor: 'pointer' }}>
                              Inactivity winback flow
                            </label>
                            <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: autoWinbackEnabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)', color: autoWinbackEnabled ? '#34d399' : '#9ca3af', fontWeight: 600 }}>
                              {autoWinbackEnabled ? 'Active' : 'Off'}
                            </span>
                          </div>
                          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#9ca3af', lineHeight: 1.4 }}>
                            Adds a client to the winback flow when they cross {customAtRiskDays} days inactive. The flow names a code only if you add one.
                          </p>
                          <div style={{ marginTop: '6px', fontSize: '11px', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <ShieldCheck size={13} /> Option A Deliverability Guard: Only enrolls clients who cross {customAtRiskDays}d from today onward. Exits automatically on purchase.
                          </div>
                        </div>
                        <input
                          id="autoWinbackToggle"
                          type="checkbox"
                          checked={autoWinbackEnabled}
                          onChange={e => setAutoWinbackEnabled(e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: '#a855f7', cursor: 'pointer', marginTop: '2px' }}
                        />
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '16px 24px',
                      backgroundColor: 'rgba(0, 0, 0, 0.25)',
                      borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: '10px'
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setShowRfmSettings(false)}
                      style={{
                        padding: '8px 16px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        backgroundColor: 'transparent',
                        color: '#9ca3af',
                        fontSize: '13px',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveRfmConfig}
                      disabled={savingRfmConfig}
                      style={{
                        padding: '8px 18px',
                        borderRadius: '8px',
                        border: 'none',
                        backgroundColor: '#a855f7',
                        color: '#ffffff',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: savingRfmConfig ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      {savingRfmConfig ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                      <span>{savingRfmConfig ? 'Re-evaluating CRM...' : 'Save & Sync CRM Tags'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {selectedCustomerEmail && (
              <CustomerProfileDrawer
                customerEmail={selectedCustomerEmail}
                onClose={() => setSelectedCustomerEmail(null)}
                onDraftCampaign={(contact, templateKey) => {
                  // No code, gift or percentage the merchant did not set (R24): the written drafts are BroadcastComposer's.
                  const kind: BroadcastPreset = templateKey === 'whale_perk' || templateKey === 'at_risk_winback' || templateKey === 'lead_welcome' ? templateKey : 'personal';
                  const person = { firstName: contact.name.split(' ')[0] || '', signOff: workspace?.shopifyConfig?.storeDomain || workspace?.name || 'Your Care Team' };
                  if (openPreset(kind, person)) setSelectedCustomerEmail(null);
                }}
                onTagsUpdated={(email, updatedTags) => {
                  setSubscribers(prev => prev.map(s => s.email === email ? { ...s, tags: updatedTags } : s));
                }}
              />
            )}
          </div>
        )}

        {/* RESULTS (D1). Never a blank panel (D6): loading, a failed read with Retry, "Nothing has been sent
            yet" of a read that counted no sends, or the figures. */}
        {activeTab === 'analytics' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>
                Results
              </h2>
              {analytics && (
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
                  {analytics.opensStored === true
                    ? 'Opens, clicks and delivery show up only after a sent email reports them.'
                    : OPENS_UNSTORED}
                </p>
              )}
            </div>

            <StudioListLine line={resultsLine(loads.analytics, analytics)} onRetry={loadData} busy={loading} />

            {analytics && !nothingSent(analytics) && (
            <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px' }}>
              {([
                ['Sent', analytics.sent ?? analytics.totalSent],
                ['Delivered', analytics.delivered],
                ['Opened', analytics.opened],
                ['Clicked', analytics.clicked]
              ] as const).map(([name, value]) => (
                <div key={name} style={{ backgroundColor: '#121217', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <div style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500 }}>{name}</div>
                  <div style={{ fontSize: value == null ? '18px' : '26px', fontWeight: 700, color: value == null ? '#9ca3af' : '#ffffff', marginTop: '6px' }}>{statText(value, (n) => n.toLocaleString())}</div>
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>From events stored for this account</div>
                </div>
              ))}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>{analytics.windowNote || 'Last-touch revenue stays blank until a click or an open is stored.'}{analytics.prefetchOpens ? ` ${analytics.prefetchOpens} opens included an Apple Mail prefetch flag.` : ''}</p>
            </>
            )}
            {analytics?.windows && (
              <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }} onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const body = {
                  emailClickDays: Number((form.elements.namedItem('emailClickDays') as HTMLInputElement).value),
                  emailOpenDays: Number((form.elements.namedItem('emailOpenDays') as HTMLInputElement).value),
                  smsClickDays: Number((form.elements.namedItem('smsClickDays') as HTMLInputElement).value)
                };
                await fetch('/api/email/attribution-windows', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
                  body: JSON.stringify(body)
                });
                await loadData();
              }}>
                <label style={{ fontSize: 12, color: '#d1d5db' }}>Email click days<input name="emailClickDays" aria-label="Email click days" defaultValue={analytics.windows.emailClickDays} type="number" min={1} max={30} style={{ display: 'block', marginTop: 4, width: 80 }} /></label>
                <label style={{ fontSize: 12, color: '#d1d5db' }}>Email open days<input name="emailOpenDays" aria-label="Email open days" defaultValue={analytics.windows.emailOpenDays} type="number" min={1} max={30} style={{ display: 'block', marginTop: 4, width: 80 }} /></label>
                <label style={{ fontSize: 12, color: '#d1d5db' }}>Text click days<input name="smsClickDays" aria-label="Text click days" defaultValue={analytics.windows.smsClickDays} type="number" min={1} max={30} style={{ display: 'block', marginTop: 4, width: 80 }} /></label>
                <button type="submit" style={{ fontSize: 12, color: '#e5e7eb', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '8px 10px', cursor: 'pointer' }}>Save windows</button>
              </form>
            )}
          </div>
        )}
      </div>
      </div>

      {/* Export Flow to Klaviyo / Shopify Email Modal */}
      {exportModalFlow && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(8px)',
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
              maxWidth: '680px',
              backgroundColor: '#16161d',
              borderRadius: '16px',
              border: `1px solid ${exportPlatform === 'klaviyo' ? 'rgba(99, 102, 241, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
              boxShadow: '0 25px 50px rgba(0,0,0,0.7)',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '90vh',
              overflow: 'hidden'
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
                background: exportPlatform === 'klaviyo'
                  ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(236, 72, 153, 0.05))'
                  : 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(99, 102, 241, 0.05))'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: exportPlatform === 'klaviyo'
                      ? 'linear-gradient(135deg, #6366F1, #8B5CF6)'
                      : 'linear-gradient(135deg, #10B981, #059669)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {exportPlatform === 'klaviyo' ? <ExternalLink size={18} color="#FFFFFF" /> : <ShoppingBag size={18} color="#FFFFFF" />}
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#ffffff' }}>
                    Export Flow: {exportModalFlow.name}
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#9ca3af' }}>
                    Liquid merge tags, ready to paste into an email in Klaviyo or Shopify Email.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExportModalFlow(null)}
                style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '4px' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Platform Switcher & Bulk Copy Bar */}
            <div
              style={{
                padding: '12px 24px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px'
              }}
            >
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setExportPlatform('klaviyo')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    backgroundColor: exportPlatform === 'klaviyo' ? '#6366F1' : 'rgba(255, 255, 255, 0.05)',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Klaviyo Format (Liquid)
                </button>
                <button
                  type="button"
                  onClick={() => setExportPlatform('shopify')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '8px',
                    backgroundColor: exportPlatform === 'shopify' ? '#10B981' : 'rgba(255, 255, 255, 0.05)',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Shopify Email Format
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  const allText = exportModalFlow.steps
                    .map((s, i) => `=== EMAIL #${i + 1} (${s.delay}) ===\n\n${formatStepForPlatform(s, exportPlatform)}\n\n`)
                    .join('--------------------------------------------------\n\n');
                  handleCopyExportText('all', allText);
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  backgroundColor: copiedExportKey === 'all' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                  border: `1px solid ${copiedExportKey === 'all' ? '#10B981' : 'rgba(255, 255, 255, 0.15)'}`,
                  color: copiedExportKey === 'all' ? '#34D399' : '#FFFFFF',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}
              >
                {copiedExportKey === 'all' ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedExportKey === 'all' ? 'All Steps Copied!' : `Copy the whole flow (${exportModalFlow.steps.length} emails)`}</span>
              </button>
            </div>

            {/* Steps Preview List */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {exportModalFlow.steps.map((step, idx) => {
                const formatted = formatStepForPlatform(step, exportPlatform);
                const isCopied = copiedExportKey === `step-${idx}`;

                return (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: 'rgba(0, 0, 0, 0.4)',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      style={{
                        padding: '10px 14px',
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(236, 72, 153, 0.15)',
                            color: '#F472B6'
                          }}
                        >
                          Email #{idx + 1}
                        </span>
                        <span style={{ fontSize: '11px', color: '#9CA3AF' }}>Timing: {step.delay}</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCopyExportText(`step-${idx}`, formatted)}
                        style={{
                          background: isCopied ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                          border: `1px solid ${isCopied ? '#10B981' : 'rgba(255, 255, 255, 0.1)'}`,
                          borderRadius: '5px',
                          color: isCopied ? '#34D399' : '#E5E7EB',
                          fontSize: '11px',
                          padding: '4px 8px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        {isCopied ? <Check size={12} /> : <Copy size={12} />}
                        <span>{isCopied ? 'Copied' : 'Copy Step'}</span>
                      </button>
                    </div>

                    <pre
                      style={{
                        margin: 0,
                        padding: '14px',
                        fontSize: '11px',
                        lineHeight: 1.5,
                        color: '#E2E8F0',
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        maxHeight: '180px',
                        overflowY: 'auto'
                      }}
                    >
                      {formatted}
                    </pre>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '14px 24px',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: 'rgba(0, 0, 0, 0.2)'
              }}
            >
              <span style={{ fontSize: '11px', color: '#64748B' }}>
                💡 Tip: Paste each subject line into that email's settings and the body into its text block.
              </span>
              <button
                type="button"
                onClick={() => setExportModalFlow(null)}
                style={{
                  padding: '7px 16px',
                  borderRadius: '6px',
                  backgroundColor: '#1E293B',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Outbound Webhook Relay Guide Modal */}
      {showWebhookGuide && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(8px)',
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
              maxWidth: '620px',
              backgroundColor: '#16161d',
              borderRadius: '16px',
              border: '1px solid rgba(236, 72, 153, 0.3)',
              boxShadow: '0 25px 50px rgba(0,0,0,0.7)',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '90vh',
              overflow: 'hidden'
            }}
          >
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Zap size={20} color="#EC4899" />
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#ffffff' }}>
                  Outbound Webhook Relay
                </h3>
              </div>
              <button
                type="button"
                aria-label="Close the webhook guide"
                onClick={() => setShowWebhookGuide(false)}
                style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '4px' }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8', lineHeight: 1.5 }}>
                When a landing page has a webhook address saved, a lead submission posts this JSON there. cartUrl is present only when that page has a real store domain and variant.
              </p>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '6px' }}>
                  JSON Payload Schema
                </label>
                <pre
                  style={{
                    backgroundColor: '#070A12',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    padding: '12px',
                    margin: 0,
                    fontSize: '11px',
                    color: '#34D399',
                    fontFamily: 'monospace',
                    lineHeight: 1.4
                  }}
                >
{`{
  "event": "funnel_lead",
  "email": "",
  "name": "",
  "phone": "",
  "pageSlug": "",
  "variant": "a",
  "exitIntent": false,
  "bumpAccepted": false,
  "bumpProductTitle": null,
  "cartUrl": null,
  "checkoutUrl": null,
  "discountCode": "",
  "timestamp": ""
}`}
                </pre>
              </div>

              <div
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#F1F5F9' }}>
                  Where to configure your Webhook URL:
                </span>
                <span style={{ fontSize: '12px', color: '#94A3B8', lineHeight: 1.4 }}>
                  In your Jourvance Funnel Canvas, click on any <strong>Landing Page Node</strong> &rarr; scroll to <strong>Outbound Webhook Relay</strong> &rarr; paste the webhook address from Klaviyo, a Zapier Catch Hook, or Make.
                </span>
              </div>
            </div>

            <div
              style={{
                padding: '14px 24px',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                justifyContent: 'flex-end',
                backgroundColor: 'rgba(0, 0, 0, 0.2)'
              }}
            >
              <button
                type="button"
                onClick={() => setShowWebhookGuide(false)}
                style={{
                  padding: '7px 18px',
                  borderRadius: '6px',
                  backgroundColor: '#EC4899',
                  border: 'none',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
