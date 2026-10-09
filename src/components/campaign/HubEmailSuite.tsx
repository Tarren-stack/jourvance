import React, { useState, useEffect, useRef } from 'react';
import {
  Mail, Send, Users, TrendingUp, Sparkles, Plus, CheckCircle2,
  Clock, ArrowUpRight, Copy, Check, RefreshCw, AlertCircle, ShoppingBag, Eye,
  GitFork, Inbox, MessageSquare, Globe, FormInput,
  ExternalLink, Zap, Terminal, X, Filter, Search, Tag, DollarSign, ArrowRight, Layers,
  ShieldCheck, Play, SlidersHorizontal, Crown, AlertTriangle, ChevronRight
} from 'lucide-react';
import { authHeaders } from '../../lib/firebase';
import { EmailPrograms } from './EmailPrograms';
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
  // flow a button inside the studio asked for.
  const selectDestination = (key: StudioDestinationKey) => {
    if (key === destination.key) return;
    setMapFlowId('');
    setMapNodeId('');
    setActiveTab(firstSectionOf(key));
  };
  // WAI-ARIA tabs, automatic activation: an arrow, Home or End selects the tab and moves focus to it.
  const onDestinationKey = (e: React.KeyboardEvent, index: number) => {
    const next = nextTabIndex(e.key, index, STUDIO_DESTINATIONS.length);
    if (next === null) return;
    e.preventDefault();
    const target = STUDIO_DESTINATIONS[next];
    selectDestination(target.key);
    destinationTabs.current[target.key]?.focus();
  };
  const onSectionKey = (e: React.KeyboardEvent, index: number) => {
    const next = nextTabIndex(e.key, index, destination.sections.length);
    if (next === null) return;
    e.preventDefault();
    const target = destination.sections[next];
    setMapFlowId('');
    setMapNodeId('');
    setActiveTab(target.key);
    sectionTabs.current[target.key]?.focus();
  };
  const [flows, setFlows] = useState<HubFlow[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [segments, setSegments] = useState<AudienceSegment[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
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

  // New Broadcast state
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcastSubject, setBroadcastSubject] = useState('');
  const [broadcastPreviewText, setBroadcastPreviewText] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>('all');
  const [sendMode, setSendMode] = useState<'direct' | 'shopify_push'>('direct');
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcastSuccess, setBroadcastSuccess] = useState(false);
  const [broadcastFeedback, setBroadcastFeedback] = useState<string>('');
  const [sendWhen, setSendWhen] = useState<'now' | 'clock' | 'gradual' | 'smart'>('now');
  const [sendAt, setSendAt] = useState('');
  const [gradualPercent, setGradualPercent] = useState(10);
  const [gradualEvery, setGradualEvery] = useState<'minute' | 'hour'>('hour');
  const [smartSkip, setSmartSkip] = useState(false);
  const [utmSource, setUtmSource] = useState('');
  const [utmCampaignName, setUtmCampaignName] = useState('');
  const [abVariable, setAbVariable] = useState('');
  const [abSubject, setAbSubject] = useState('');
  const [abBody, setAbBody] = useState('');
  const [abHours, setAbHours] = useState(4);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsConfirm, setSmsConfirm] = useState(false);
  const [excludeId, setExcludeId] = useState('');
  const [holdoutOn, setHoldoutOn] = useState(false);
  const [holdoutPercent, setHoldoutPercent] = useState(10);
  const [lists, setLists] = useState<{ id: string; name: string; count: number }[]>([]);
  const [followUpNote, setFollowUpNote] = useState('');
  const [fallbackHour, setFallbackHour] = useState('');
  const [exploreSend, setExploreSend] = useState(false);
  const [smartGradual, setSmartGradual] = useState(false);
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
      const [fRes, bRes, aRes, sRes, segRes, listRes, dSeqRes, dEnrRes, chkRes, predRes] = await Promise.all([
        fetch('/api/email/flows', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/email/broadcasts', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/email/analytics', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/email/audience', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/email/segments', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/email/lists', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/drips/sequences', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/drips/enrollments', { headers }).then(r => r.json()).catch(() => ({})),
        fetch(`/api/workspace/${wsId}/shopify/abandoned-checkouts`, { headers }).then(async r => ({ ...(await r.json().catch(() => ({}))), httpStatus: r.status })).catch(() => ({ httpStatus: 0 })),
        fetch('/api/email/predictions', { headers }).then(r => r.json()).catch(() => ({}))
      ]);

      if (fRes?.success && Array.isArray(fRes.flows)) setFlows(fRes.flows);
      if (bRes?.success && Array.isArray(bRes.broadcasts)) setBroadcasts(bRes.broadcasts);
      if (aRes?.success && aRes.analytics) setAnalytics(aRes.analytics);
      if (sRes?.success) {
        if (Array.isArray(sRes.subscribers)) setSubscribers(sRes.subscribers);
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
      if (dEnrRes?.success && Array.isArray(dEnrRes.enrollments)) setDripEnrollments(dEnrRes.enrollments);
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
    setBroadcastFeedback(data?.message || data?.error || '');
    if (data?.success) await loadData();
  };

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastSubject.trim() || !broadcastBody.trim()) return;
    setSendingBroadcast(true);
    setBroadcastFeedback('');
    try {
      const res = await fetch('/api/email/campaign/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          subject: broadcastSubject,
          previewText: broadcastPreviewText,
          body: broadcastBody,
          segmentId: selectedSegmentId,
          include: [{ type: selectedSegmentId.startsWith('list_') ? 'list' : 'segment', id: selectedSegmentId }],
          exclude: excludeId ? [{ type: excludeId.startsWith('list_') ? 'list' : 'segment', id: excludeId }] : [],
          sendMode,
          when: sendMode === 'shopify_push' ? 'now' : sendWhen,
          sendAt,
          gradual: sendWhen === 'gradual' || (sendWhen === 'smart' && smartGradual)
            ? { percent: gradualPercent, every: gradualEvery, ...(sendWhen === 'smart' ? { wrap: true } : {}) }
            : undefined,
          fallbackHour: sendWhen === 'smart' && fallbackHour !== '' ? Number(fallbackHour) : '',
          explore: sendWhen === 'smart' && exploreSend,
          smartSkip,
          utm: { source: utmSource, medium: 'email', campaign: utmCampaignName },
          ab: abVariable ? { variable: abVariable, subjectB: abSubject, bodyB: abBody, offsetHours: abHours } : { variable: 'off' },
          smsMessage,
          smsConfirm: smsConfirm ? 'opted-in' : '',
          holdout: holdoutOn ? { enabled: true, percent: holdoutPercent } : { enabled: false },
          workspaceId: workspace?.id
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) {
        setBroadcastFeedback(data?.error || 'That campaign was not saved.');
        return;
      }
      if (data?.success) {
        setBroadcastSuccess(true);
        setBroadcastFeedback([data.message, data.smartReport].filter(Boolean).join(' '));
        setTimeout(() => {
          setShowBroadcastModal(false);
          setBroadcastSuccess(false);
          setBroadcastFeedback('');
          setBroadcastSubject('');
          setBroadcastPreviewText('');
          setBroadcastBody('');
          loadData();
        }, 1800);
      }
    } finally {
      setSendingBroadcast(false);
    }
  };

  const handleDraftWhaleBroadcast = () => {
    setSelectedSegmentId('whales');
    // Drafts name no gift, code or percentage: an offer is the merchant's to write, and only if it exists (R24).
    setBroadcastSubject('A thank-you to our most loyal clients');
    setBroadcastPreviewText('A personal note from us');
    setBroadcastBody('Hello lovely,\n\nAs one of our most valued clients, we wanted to say thank you.\n\nReplace this note with your real message before anyone receives it. Mention a gift or discount only if it exists in your store.');
    setBroadcastSuccess(false);
    setBroadcastFeedback('');
    setShowBroadcastModal(true);
  };

  const handleDraftWinbackBroadcast = () => {
    setSelectedSegmentId('at_risk');
    setBroadcastSubject('It has been a little while');
    setBroadcastPreviewText("We'd love to welcome you back");
    setBroadcastBody('Hello lovely,\n\nWe noticed it’s been a little while since your last visit, and we wanted to check in.\n\nReplace this note with your real message before anyone receives it. Mention a discount only if the code exists in your store.');
    setBroadcastSuccess(false);
    setBroadcastFeedback('');
    setShowBroadcastModal(true);
  };

  const handleDraftLapsedBroadcast = () => {
    setSelectedSegmentId('lapsed');
    setBroadcastSubject('A warm invitation back');
    setBroadcastPreviewText("A warm note whenever you're ready");
    setBroadcastBody('Hello lovely,\n\nIt’s been some time since your last order, and we wanted to send a warm note your way.\n\nReplace this note with your real message before anyone receives it. Mention a discount only if the code exists in your store.');
    setBroadcastSuccess(false);
    setBroadcastFeedback('');
    setShowBroadcastModal(true);
  };

  const isConnected = workspace?.shopifyConfig?.status === 'connected' && !!workspace?.shopifyConfig?.storeDomain;

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
                onClick={() => { setMapFlowId(''); setMapNodeId(''); setActiveTab(tab.key as any); }}
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
              <div style={{ marginTop: '12px', maxHeight: '240px', overflow: 'auto', backgroundColor: 'rgba(0, 0, 0, 0.25)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
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
                          {enr.status === 'converted_exit' ? 'Ordered, so it stopped' : enr.status === 'completed' ? 'Finished' : 'In the flow'}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#d1d5db' }}>
                          {enr.history?.length || 0} sent
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                          Trigger: Lead captured via Landing Page | {flow.steps.length} Automated Steps
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
        {activeTab === 'builder' && <EmailPrograms mode="builder" />}
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
            {checkoutsLoad.state === 'failed' && (
              <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(248, 113, 113, 0.35)', backgroundColor: 'rgba(248, 113, 113, 0.08)', color: '#fecaca', fontSize: '13px' }}>
                <span>{checkoutsLoad.text}</span>
                {checkoutsLoad.retry && (
                  <button
                    type="button"
                    aria-disabled={loading || undefined}
                    onClick={() => { if (!loading) void loadData(); }}
                    style={{ minHeight: '36px', padding: '0 12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.2)', backgroundColor: 'transparent', color: '#f3f4f6', fontSize: '12px', fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }}
                  >
                    {loading ? 'Loading' : 'Try again'}
                  </button>
                )}
              </div>
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
                              backgroundColor: chk.recoveryStatus === 'recovered' ? 'rgba(16, 185, 129, 0.2)' : chk.recoveryStatus === 'email_sent' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                              color: chk.recoveryStatus === 'recovered' ? '#34D399' : chk.recoveryStatus === 'email_sent' ? '#60A5FA' : '#FACC15'
                            }}>
                              {chk.recoveryStatus === 'recovered' ? 'Recovered' : chk.recoveryStatus === 'email_sent' ? 'Email sent' : 'Pending'}
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
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>
                  Campaign Broadcasts & Offers
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
                  Targeted product announcements, flash discounts, and replenishment emails with direct delivery or 1-click Shopify Email sync.
                </p>
                {analytics?.opensStored !== true && (
                  <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#9ca3af' }}>{OPENS_UNSTORED}</p>
                )}
              </div>

              <button
                onClick={() => setShowBroadcastModal(true)}
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
                <Plus size={16} />
                <span>New Campaign</span>
              </button>
            </div>

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
                <div>Campaign & Segment</div>
                <div>Send Mode</div>
                <div>Sent Date</div>
                <div>Sent</div>
                <div>Opened</div>
                <div>Revenue</div>
              </div>

              {broadcasts.length === 0 ? (
                <div style={{ padding: '36px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
                  No broadcasts dispatched yet. Click "New Campaign" to send your first targeted broadcast.
                </div>
              ) : (
                broadcasts.map(b => (
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
                ))
              )}
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

            {/* Audience Stats Ribbon */}
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
                  <Send size={11} /> Draft VIP Note
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

            <AudienceDesk />

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
                        Clients with no purchases after this many days are marked At-Risk for automated winback flows.
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
                              Automate Inactivity Winback
                            </label>
                            <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: autoWinbackEnabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)', color: autoWinbackEnabled ? '#34d399' : '#9ca3af', fontWeight: 600 }}>
                              {autoWinbackEnabled ? 'Active' : 'Off'}
                            </span>
                          </div>
                          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#9ca3af', lineHeight: 1.4 }}>
                            Automatically enrolls clients into the winback sequence when they cross {customAtRiskDays} days inactive. The sequence names a code only if you add one.
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
                  setSelectedCustomerEmail(null);
                  if (templateKey === 'whale_perk') {
                    // No code, gift or percentage the merchant did not set (R24).
                    setBroadcastSubject('A personal thank-you');
                    setBroadcastPreviewText('A note for one of our most valued clients');
                    setBroadcastBody(`Hi ${contact.name.split(' ')[0] || 'there'},\n\nAs one of our most valued clients, we wanted to personally say thank you.\n\nReplace this note with your real message before anyone receives it. Mention a gift or discount only if it exists in your store.\n\nWith gratitude,\n${workspace?.shopifyConfig?.storeDomain || workspace?.name || 'Your Care Team'}`);
                  } else if (templateKey === 'at_risk_winback') {
                    setBroadcastSubject('We would love to welcome you back');
                    setBroadcastPreviewText('It has been a little while');
                    setBroadcastBody(`Hi ${contact.name.split(' ')[0] || 'there'},\n\nIt has been a while since your last order, and we would love to welcome you back.\n\nReplace this note with your real message before anyone receives it. Mention a discount only if the code exists in your store.\n\nWarmly,\n${workspace?.shopifyConfig?.storeDomain || workspace?.name || 'Your Care Team'}`);
                  } else if (templateKey === 'lead_welcome') {
                    setBroadcastSubject('Welcome, and thank you for joining');
                    setBroadcastPreviewText('A note to say hello');
                    setBroadcastBody(`Hi ${contact.name.split(' ')[0] || 'there'},\n\nThank you for joining our community!\n\nReplace this note with your real message before anyone receives it. Mention a discount only if the code exists in your store.\n\nWarmly,\n${workspace?.shopifyConfig?.storeDomain || workspace?.name || 'Your Care Team'}`);
                  } else {
                    setBroadcastSubject(`Personal note for ${contact.name.split(' ')[0] || 'you'}`);
                    setBroadcastPreviewText('Checking in on your latest order');
                    setBroadcastBody(`Hi ${contact.name.split(' ')[0] || 'there'},\n\nWe wanted to follow up and see how you are enjoying your order.\n\nWarmly,\n${workspace?.shopifyConfig?.storeDomain || workspace?.name || 'Your Care Team'}`);
                  }
                  setShowBroadcastModal(true);
                }}
                onTagsUpdated={(email, updatedTags) => {
                  setSubscribers(prev => prev.map(s => s.email === email ? { ...s, tags: updatedTags } : s));
                }}
              />
            )}
          </div>
        )}

        {/* TAB 4: ANALYTICS */}
        {activeTab === 'analytics' && analytics && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>
                Deliverability & Conversion Metrics
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
                {analytics.opensStored === true
                  ? 'Opens, clicks, and delivery show up only after a sent campaign reports them.'
                  : OPENS_UNSTORED}
              </p>
            </div>

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
            {analytics.windows && (
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

      {/* New Broadcast Modal */}
      {showBroadcastModal && (
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
            padding: '16px'
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '620px',
              backgroundColor: '#16161d',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>
                  Create Segmented Campaign Broadcast
                </h3>
                <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#9ca3af' }}>
                  Send now, at a clock time, or in batches. An empty audience sends nothing. A follow-up to people who did not open waits until opens are stored.
                </p>
              </div>
              <button
                onClick={() => setShowBroadcastModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }}
              >
                ✕
              </button>
            </div>

            {broadcastSuccess && (
              <div
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: '#34d399',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <CheckCircle2 size={16} /> <span>{broadcastFeedback || 'Campaign broadcast processed successfully!'}</span>
              </div>
            )}

            <form onSubmit={handleSendBroadcast} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Delivery Mode Tabs */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Delivery Method
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setSendMode('direct')}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: sendMode === 'direct' ? '1px solid #10b981' : '1px solid rgba(255, 255, 255, 0.08)',
                      backgroundColor: sendMode === 'direct' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                      color: sendMode === 'direct' ? '#ffffff' : '#9ca3af',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: sendMode === 'direct' ? '#34d399' : '#9ca3af' }}>
                      <Zap size={14} /> Direct Dispatch ($0 Cost)
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>Send via configured mail transport</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSendMode('shopify_push')}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: sendMode === 'shopify_push' ? '1px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.08)',
                      backgroundColor: sendMode === 'shopify_push' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                      color: sendMode === 'shopify_push' ? '#ffffff' : '#9ca3af',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: sendMode === 'shopify_push' ? '#60a5fa' : '#9ca3af' }}>
                      <ShoppingBag size={14} /> Push to Shopify Email
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>Tags customer segment in Shopify Admin</div>
                  </button>
                </div>
              </div>

              {/* Target Segment */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Target Customer Segment
                </label>
                <select
                  value={selectedSegmentId}
                  onChange={e => setSelectedSegmentId(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: '#ffffff',
                    fontSize: '13px',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {!segments.some(s => s.id === selectedSegmentId) && selectedSegmentId !== 'all' && (
                    <option value={selectedSegmentId} style={{ backgroundColor: '#1a1a24', color: '#ffffff' }}>
                      {selectedSegmentId === 'whales' ? 'VIP Whales (Platinum)' : selectedSegmentId === 'at_risk' ? 'At-Risk Inactive Clients' : selectedSegmentId === 'lapsed' ? 'Lapsed Clients' : selectedSegmentId}
                    </option>
                  )}
                  {segments.map(seg => (
                    <option key={seg.id} value={seg.id} style={{ backgroundColor: '#1a1a24', color: '#ffffff' }}>
                      {withNote(`${seg.name} (${seg.count} contacts)`, seg.definition || seg.description)}
                    </option>
                  ))}
                  {lists.map(list => (
                    <option key={list.id} value={list.id} style={{ backgroundColor: '#1a1a24', color: '#ffffff' }}>
                      List · {list.name} ({list.count})
                    </option>
                  ))}
                  {segments.length === 0 && (
                    <option value="all" style={{ backgroundColor: '#1a1a24' }}>
                      All Active Subscribers ({subscribers.length} contacts)
                    </option>
                  )}
                </select>
              </div>

              {/* 1-Click Beauty Campaign Presets */}
              <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#d1d5db', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Sparkles size={13} style={{ color: '#ec4899' }} /> 1-Click Beauty Campaign Presets
                  </span>
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>Click to auto-fill beauty copy</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={handleDraftWhaleBroadcast}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '7px',
                      border: selectedSegmentId === 'whales' ? '1px solid #c084fc' : '1px solid rgba(192, 132, 252, 0.3)',
                      backgroundColor: selectedSegmentId === 'whales' ? 'rgba(168, 85, 247, 0.22)' : 'rgba(168, 85, 247, 0.08)',
                      color: '#f3e8ff',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px'
                    }}
                  >
                    <Crown size={12} style={{ color: '#c084fc' }} /> VIP Thank-You
                  </button>
                  <button
                    type="button"
                    onClick={handleDraftWinbackBroadcast}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '7px',
                      border: selectedSegmentId === 'at_risk' ? '1px solid #fbbf24' : '1px solid rgba(245, 158, 11, 0.3)',
                      backgroundColor: selectedSegmentId === 'at_risk' ? 'rgba(245, 158, 11, 0.22)' : 'rgba(245, 158, 11, 0.08)',
                      color: '#fef3c7',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px'
                    }}
                  >
                    <AlertTriangle size={12} style={{ color: '#f59e0b' }} /> At-Risk Winback
                  </button>
                  <button
                    type="button"
                    onClick={handleDraftLapsedBroadcast}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '7px',
                      border: selectedSegmentId === 'lapsed' ? '1px solid #94a3b8' : '1px solid rgba(148, 163, 184, 0.3)',
                      backgroundColor: selectedSegmentId === 'lapsed' ? 'rgba(148, 163, 184, 0.22)' : 'rgba(148, 163, 184, 0.08)',
                      color: '#f1f5f9',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px'
                    }}
                  >
                    <Clock size={12} style={{ color: '#94a3b8' }} /> Lapsed Reconnect
                  </button>
                </div>
              </div>

              {sendMode === 'direct' && (
                <div style={{ display: 'grid', gap: 8 }}>
                  <label style={{ fontSize: 12, color: '#9ca3af' }}>When
                    <select aria-label="When to send" value={sendWhen} onChange={(e) => {
                      const next = e.target.value as 'now' | 'clock' | 'gradual' | 'smart';
                      setSendWhen(next);
                      if (next === 'smart' && abVariable === 'send_time') setAbVariable('');
                    }} style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, borderRadius: 8, background: '#111', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }}>
                      <option value="now">Send now</option>
                      <option value="clock">At a clock time</option>
                      <option value="gradual">Gradual</option>
                      <option value="smart" disabled={abVariable === 'send_time'}>At each person’s hour</option>
                    </select>
                  </label>
                  {sendWhen === 'smart' && (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Their hour after 5 opens or clicks. Otherwise the store hour after 200 opens or clicks in 90 days. Otherwise the hour you set. Otherwise the next send. A stored timezone on the contact is used when there is one.</p>
                      <label style={{ fontSize: 12, color: '#9ca3af' }}>Fallback hour, 0 through 23. Leave empty for the next send.
                        <input aria-label="Fallback hour" type="number" min={0} max={23} value={fallbackHour} onChange={(e) => setFallbackHour(e.target.value)} style={{ display: 'block', width: 80, marginTop: 4, padding: 8, borderRadius: 8, background: '#111', color: '#fff' }} />
                      </label>
                      <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                        <input type="checkbox" checked={exploreSend} onChange={(e) => setExploreSend(e.target.checked)} /> Send 10% at another hour between 9:00 and 17:00
                      </label>
                      <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                        <input type="checkbox" checked={smartGradual} onChange={(e) => setSmartGradual(e.target.checked)} /> Send gradually. Each person’s hour is the batch time
                      </label>
                    </div>
                  )}
                  {(sendWhen === 'clock' || sendWhen === 'gradual') && (
                    <label style={{ fontSize: 12, color: '#9ca3af' }}>Date and time in the account timezone, or UTC when none is saved
                      <input aria-label="Send at" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, borderRadius: 8, background: '#111', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }} />
                    </label>
                  )}
                  {(sendWhen === 'gradual' || (sendWhen === 'smart' && smartGradual)) && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <label style={{ fontSize: 12, color: '#9ca3af' }}>Percent per batch
                        <input aria-label="Batch percent" type="number" min={1} max={50} value={gradualPercent} onChange={(e) => setGradualPercent(Number(e.target.value))} style={{ display: 'block', width: 80, marginTop: 4, padding: 8, borderRadius: 8, background: '#111', color: '#fff' }} />
                      </label>
                      <label style={{ fontSize: 12, color: '#9ca3af' }}>Every
                        <select aria-label="Batch interval" value={gradualEvery} onChange={(e) => setGradualEvery(e.target.value as 'minute' | 'hour')} style={{ display: 'block', marginTop: 4, padding: 8, borderRadius: 8, background: '#111', color: '#fff' }}>
                          <option value="hour">Hour</option>
                          <option value="minute">Minute</option>
                        </select>
                      </label>
                    </div>
                  )}
                  <label style={{ fontSize: 12, color: '#9ca3af' }}>Exclude
                    <select aria-label="Exclude" value={excludeId} onChange={(e) => setExcludeId(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, borderRadius: 8, background: '#111', color: '#fff' }}>
                      <option value="">Nobody</option>
                      {segments.map((seg) => <option key={seg.id} value={seg.id}>{seg.name}</option>)}
                      {lists.map((list) => <option key={list.id} value={list.id}>List · {list.name}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                    <input type="checkbox" checked={smartSkip} onChange={(e) => setSmartSkip(e.target.checked)} /> Skip someone who already got a marketing email in 16 hours, or a text in 24 hours
                  </label>
                  <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                    <input aria-label="Campaign holdout" type="checkbox" checked={holdoutOn} onChange={(e) => setHoldoutOn(e.target.checked)} /> Hold out a percent. They receive nothing.
                  </label>
                  {holdoutOn && (
                    <label style={{ fontSize: 12, color: '#9ca3af' }}>Percent who receive nothing, 1 to 90
                      <input aria-label="Campaign holdout percent" type="number" min={1} max={90} value={holdoutPercent} onChange={(e) => setHoldoutPercent(Number(e.target.value))} style={{ display: 'block', width: 80, marginTop: 4, padding: 8, borderRadius: 8, background: '#111', color: '#fff' }} />
                    </label>
                  )}
                  <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Holdout stays off until you check it. The broadcast row then shows revenue per person for the sent group and the held-out group, with both sample sizes.</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input aria-label="UTM source" placeholder="UTM source" value={utmSource} onChange={(e) => setUtmSource(e.target.value)} style={{ padding: 8, borderRadius: 8, background: '#111', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }} />
                    <input aria-label="UTM campaign" placeholder="UTM campaign" value={utmCampaignName} onChange={(e) => setUtmCampaignName(e.target.value)} style={{ padding: 8, borderRadius: 8, background: '#111', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }} />
                  </div>
                  <label style={{ fontSize: 12, color: '#9ca3af' }}>A/B one variable. You choose the winner.
                    <select aria-label="A/B variable" value={abVariable} onChange={(e) => setAbVariable(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, borderRadius: 8, background: '#111', color: '#fff' }}>
                      <option value="">No A/B</option>
                      <option value="subject">Subject</option>
                      <option value="content">Content</option>
                      <option value="send_time" disabled={sendWhen === 'smart'}>Send time</option>
                    </select>
                  </label>
                  {abVariable === 'subject' && <input aria-label="Second subject" placeholder="Second subject" value={abSubject} onChange={(e) => setAbSubject(e.target.value)} style={{ padding: 8, borderRadius: 8, background: '#111', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }} />}
                  {abVariable === 'content' && <textarea aria-label="Second version" placeholder="Second version" value={abBody} onChange={(e) => setAbBody(e.target.value)} style={{ padding: 8, borderRadius: 8, background: '#111', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }} />}
                  {abVariable === 'send_time' && <label style={{ fontSize: 12, color: '#9ca3af' }}>Hours later for version B<input aria-label="Hours later" type="number" min={1} max={168} value={abHours} onChange={(e) => setAbHours(Number(e.target.value))} style={{ display: 'block', width: 80, marginTop: 4, padding: 8 }} /></label>}
                  <label style={{ fontSize: 12, color: '#9ca3af' }}>Text on the same campaign
                    <textarea aria-label="Text message" value={smsMessage} onChange={(e) => setSmsMessage(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, borderRadius: 8, background: '#111', color: '#fff' }} />
                  </label>
                  <label style={{ fontSize: 13, color: '#e5e7eb' }}>
                    <input type="checkbox" checked={smsConfirm} onChange={(e) => setSmsConfirm(e.target.checked)} /> This text goes only to numbers that already opted in
                  </label>
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Email Subject Line
                </label>
                <input
                  type="text"
                  placeholder="e.g. VIP Access: 20% Off Our New Serum"
                  value={broadcastSubject}
                  onChange={e => setBroadcastSubject(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: '#ffffff',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Preview Pre-header Text (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Small-batch private batch reserved for the next 24 hours"
                  value={broadcastPreviewText}
                  onChange={e => setBroadcastPreviewText(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: '#ffffff',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Live Gmail & iPhone Inbox Snippet Simulation */}
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#f472b6', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Mail size={12} /> Live Gmail & iPhone Inbox Snippet
                  </span>
                  <span style={{ fontSize: '11px', color: '#6b7280' }}>How subscribers see your note before opening</span>
                </div>
                <div
                  style={{
                    backgroundColor: '#0a0a0f',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    fontSize: '12px',
                    lineHeight: 1.4
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span style={{ fontWeight: 700, color: '#f3f4f6' }}>
                      {workspace?.shopifyConfig?.shopName || workspace?.name || 'Jourvance Studio'}
                    </span>
                    <span style={{ fontSize: '11px', color: '#6b7280' }}>10:42 AM</span>
                  </div>
                  <div style={{ fontWeight: 600, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {broadcastSubject.trim() || 'Your subject line'}
                  </div>
                  <div style={{ color: '#9ca3af', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>
                    {broadcastPreviewText.trim()
                      ? broadcastPreviewText.trim()
                      : (broadcastBody.trim().slice(0, 90) || 'Your preview text')}
                  </div>
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>
                    Letter & Offer Content
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ fontSize: '11px', color: '#6b7280' }}>Insert:</span>
                    {[
                      { label: '{{first_name}}', code: '{{first_name}}' },
                      { label: '{{store_name}}', code: '{{store_name}}' },
                      { label: '{{discount_code}}', code: '{{discount_code}}' },
                      { label: '{{email}}', code: '{{email}}' }
                    ].map(tok => (
                      <button
                        key={tok.code}
                        type="button"
                        onClick={() => setBroadcastBody(prev => `${prev} ${tok.code}`)}
                        style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          border: '1px solid rgba(236, 72, 153, 0.3)',
                          backgroundColor: 'rgba(236, 72, 153, 0.08)',
                          color: '#f9a8d4',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        {tok.label}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  rows={6}
                  placeholder="Write your email announcement or special offer details..."
                  value={broadcastBody}
                  onChange={e => setBroadcastBody(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: '#ffffff',
                    fontSize: '13px',
                    outline: 'none',
                    resize: 'vertical'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setShowBroadcastModal(false)}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: 'transparent',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#9ca3af',
                    borderRadius: '8px',
                    fontSize: '13px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sendingBroadcast}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: sendMode === 'shopify_push' ? '#2563eb' : '#ec4899',
                    border: 'none',
                    color: '#ffffff',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: sendingBroadcast ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: sendMode === 'shopify_push' ? '0 4px 14px rgba(37, 99, 235, 0.35)' : '0 4px 14px rgba(236, 72, 153, 0.35)'
                  }}
                >
                  {sendingBroadcast ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  <span>
                    {sendingBroadcast
                      ? 'Processing...'
                      : sendMode === 'shopify_push'
                      ? 'Tag contacts here'
                      : sendWhen === 'now'
                      ? 'Send now'
                      : 'Schedule'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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
                    Pre-formatted Liquid merge tags ready to paste into your ESP campaign builder.
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
                <span>{copiedExportKey === 'all' ? 'All Steps Copied!' : `Copy Entire Sequence (${exportModalFlow.steps.length} Emails)`}</span>
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
                💡 Tip: Paste subject lines into your campaign settings and the body into the text block.
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
                  In your Jourvance Funnel Canvas, click on any <strong>Landing Page Node</strong> &rarr; scroll to <strong>Outbound Webhook Relay</strong> &rarr; paste your Klaviyo Webhook Trigger, Zapier Catch Hook, or Make webhook URL.
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
