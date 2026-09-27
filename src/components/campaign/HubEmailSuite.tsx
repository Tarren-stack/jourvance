import React, { useState, useEffect } from 'react';
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
import { SignupForms } from './SignupForms';
import { AudienceDesk } from './AudienceDesk';
import { EmailInbox } from './EmailInbox';
import { SmsPanel } from './SmsPanel';
import { SendingSetup } from './SendingSetup';
import { KlaviyoSync } from './KlaviyoSync';
import { CustomerProfileDrawer } from './CustomerProfileDrawer';
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
}

interface Props {
  workspace: Workspace | null;
  onOpenShopifyConnect?: () => void;
  onReturnToCanvas?: () => void;
}

export const HubEmailSuite: React.FC<Props> = ({ workspace, onOpenShopifyConnect, onReturnToCanvas }) => {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'flows' | 'map' | 'transactional' | 'builder' | 'forms' | 'inbox' | 'sms' | 'audience' | 'analytics' | 'sending' | 'klaviyo'>('flows');
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
        fetch(`/api/workspace/${wsId}/shopify/abandoned-checkouts`, { headers }).then(r => r.json()).catch(() => ({})),
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
      if (chkRes?.success && Array.isArray(chkRes.checkouts)) setAbandonedCheckouts(chkRes.checkouts);
      if (predRes?.success) {
        setPredictionNote(predRes.ready
          ? `Predicted value uses this store’s order gaps. Sample ${predRes.sampleSize}. Computed ${String(predRes.computedAt || '').slice(0, 10)}.`
          : `Predicted value stays blank until this account has 50 orders, 20 customers with two or more orders, and 90 days of history. ${predRes.missing || ''}`.trim());
      }
    } finally {
      setLoading(false);
    }
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
    setBroadcastSubject('A private preview & courtesy gift for our most cherished VIP');
    setBroadcastPreviewText('Your VIP loyalty means the world to us — here is your exclusive priority access');
    setBroadcastBody('Hello lovely,\n\nAs one of our most valued VIP clients, we wanted to ensure you received private first-access to our newest reserve collection before public release.\n\nWe’ve also arranged a complimentary full-size gift with your next order. Simply enjoy your bespoke VIP experience.');
    setBroadcastSuccess(false);
    setBroadcastFeedback('');
    setShowBroadcastModal(true);
  };

  const handleDraftWinbackBroadcast = () => {
    setSelectedSegmentId('at_risk');
    setBroadcastSubject('We miss you — a private 15% courtesy treat for your next ritual');
    setBroadcastPreviewText("It's been a little while, and we'd love to welcome you back");
    setBroadcastBody('Hello lovely,\n\nWe noticed it’s been a little while since your last visit, and we wanted to check in.\n\nSelf-care should always feel effortless. To welcome you back, we’ve placed a special 15% courtesy reward on your profile for your next restock:\n\nUse code WELCOMEBACK15 at checkout.');
    setBroadcastSuccess(false);
    setBroadcastFeedback('');
    setShowBroadcastModal(true);
  };

  const handleDraftLapsedBroadcast = () => {
    setSelectedSegmentId('lapsed');
    setBroadcastSubject('A warm invitation back to your self-care sanctuary');
    setBroadcastPreviewText("Your bespoke treat is waiting whenever you're ready");
    setBroadcastBody('Hello lovely,\n\nIt’s been some time since we had the pleasure of treating you, and we wanted to send a warm note your way.\n\nWhenever you’re ready to replenish your favorite beauty rituals, our studio and sanctuary are ready for you.\n\nEnjoy complimentary priority shipping on us with code SANCTUARY.');
    setBroadcastSuccess(false);
    setBroadcastFeedback('');
    setShowBroadcastModal(true);
  };

  const isConnected = workspace?.shopifyConfig?.status === 'connected' && !!workspace?.shopifyConfig?.storeDomain;

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
      {/* Top Banner / Store Context */}
      <div
        style={{
          padding: '24px 32px 16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(180deg, rgba(236, 72, 153, 0.06) 0%, rgba(11, 12, 16, 0) 100%)'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#ffffff' }}>
              Email Studio & E-Commerce Flows
            </h1>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: '6px',
                backgroundColor: 'rgba(236, 72, 153, 0.15)',
                color: '#ec4899',
                border: '1px solid rgba(236, 72, 153, 0.3)'
              }}
            >
              Hub Engine
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
            Flows, order letters, signup forms, inbox, texts, and sending setup. A message counts as sent only when the service accepts it.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
                color: '#34d399'
              }}
            >
              <ShoppingBag size={14} />
              <span>Synced with {workspace?.shopifyConfig?.storeDomain}</span>
            </div>
          ) : (
            <button
              onClick={onOpenShopifyConnect}
              style={{
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
              onClick={onReturnToCanvas}
              style={{
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

      {/* Navigation Sub-Tabs */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 32px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          flexWrap: 'wrap'
        }}
      >
        {[
          { key: 'flows', label: 'Automations', icon: Clock },
          { key: 'map', label: 'Flow map', icon: GitFork },
          { key: 'transactional', label: 'Order letters', icon: ShoppingBag },
          { key: 'builder', label: 'Builder', icon: Layers },
          { key: 'forms', label: 'Forms', icon: FormInput },
          { key: 'campaigns', label: 'Broadcasts', icon: Send },
          { key: 'inbox', label: 'Inbox', icon: Inbox },
          { key: 'sms', label: 'Texts', icon: MessageSquare, badge: 'Soon' },
          { key: 'audience', label: 'Audience', icon: Users },
          { key: 'sending', label: 'DNS & Deliverability', icon: ShieldCheck },
          { key: 'klaviyo', label: 'Klaviyo', icon: RefreshCw },
          { key: 'analytics', label: 'Deliverability', icon: TrendingUp }
        ].map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: active ? 600 : 500,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: active ? 'rgba(236, 72, 153, 0.15)' : 'transparent',
                color: active ? '#f472b6' : '#9ca3af',
                transition: 'all 0.15s ease'
              }}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
              {(tab as any).badge && (
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    padding: '1px 6px',
                    borderRadius: '9999px',
                    backgroundColor: active ? 'rgba(236, 72, 153, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                    color: active ? '#f472b6' : '#d1d5db',
                    border: '1px solid rgba(255, 255, 255, 0.12)'
                  }}
                >
                  {(tab as any).badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Tab Content */}
      <div style={{ padding: '24px 32px', flex: 1 }}>
        {/* TAB 1: FLOWS & DRIPS */}
        {activeTab === 'flows' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <EmailPrograms mode="automations" />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f3f4f6' }}>
                  Queue sequences
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
                  Welcome and abandoned checkout are enrolled from real leads and checkouts. Run the queue when a step is due. A step is marked sent only after the email service accepts it.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={handleRunDripTick}
                  disabled={processingDripTick}
                  style={{
                    padding: '8px 14px',
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
                  title="Run queue tick: dispatches due emails and exits converted buyers"
                >
                  <Play size={13} />
                  <span>{processingDripTick ? 'Processing Queue...' : 'Run Queue Tick'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowWebhookGuide(true)}
                  style={{
                    padding: '8px 12px',
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
                  <Zap size={13} />
                  <span>Webhooks</span>
                </button>

                <button
                  onClick={loadData}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#9ca3af',
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {/* Notification message */}
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

            {/* Active Drip Sequence Cards */}
            {dripSequences.map(seq => (
              <div
                key={seq.id}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '12px',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#F8FAFC' }}>
                      {seq.name}
                    </h3>
                    <span style={{
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 600,
                      backgroundColor: 'rgba(99, 102, 241, 0.15)',
                      color: '#818CF8'
                    }}>
                      Trigger: {seq.triggerType === 'upsell_recovery' ? 'Post-Purchase Courtesy' : seq.triggerType === 'checkout_abandonment' ? 'Abandoned Checkout' : seq.triggerType === 'lead_capture' ? 'Lead Capture' : seq.triggerType === 'exit_intent' ? 'Exit Intent' : seq.triggerType.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      color: '#34D399',
                      fontSize: '11px',
                      fontWeight: 700
                    }}>
                      <ShieldCheck size={14} />
                      <span>Smart Exit on Purchase Active</span>
                    </div>
                  </div>
                </div>

                {/* Sequence Metrics Ribbon */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '10px 16px',
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  flexWrap: 'wrap'
                }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <span style={{ color: '#94A3B8' }}>Active Enrolled:</span>
                    <strong style={{ color: '#818CF8' }}>{seq.activeEnrollments}</strong>
                  </div>
                  <span style={{ color: '#475569' }}>•</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <span style={{ color: '#94A3B8' }}>Exited on Purchase:</span>
                    <strong style={{ color: '#34D399' }}>{seq.totalExitedPurchased}</strong>
                  </div>
                  <span style={{ color: '#475569' }}>•</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <span style={{ color: '#94A3B8' }}>Completed 3-Steps:</span>
                    <strong style={{ color: '#E2E8F0' }}>{seq.totalCompleted}</strong>
                  </div>
                  <span style={{ color: '#475569' }}>•</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <span style={{ color: '#94A3B8' }}>Last-touch revenue:</span>
                    <strong style={{ color: '#34D399' }}>{seq.attributedSales == null ? '—' : `$${seq.attributedSales.toLocaleString()}`}</strong>
                  </div>
                </div>

                {/* Step Progression Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                  {seq.steps.map(step => (
                    <div
                      key={step.id}
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: '10px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#EC4899',
                          textTransform: 'uppercase'
                        }}>
                          Step {step.stepNumber} • {step.delayHours === 0 ? 'Immediate' : `+${step.delayHours}h`}
                        </span>
                        {step.discountVoucher && (
                          <span style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(244, 114, 182, 0.15)',
                            color: '#F472B6'
                          }}>
                            {step.discountVoucher}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#F1F5F9' }}>
                        {step.subject}
                      </div>
                      <div style={{ fontSize: '11px', color: '#94A3B8', lineClamp: 2, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {step.previewText || step.body}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Recent Enrollments Stream */}
                <div style={{ marginTop: '8px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#CBD5E1', marginBottom: '8px' }}>
                    Active Subscriber Enrollments ({dripEnrollments.length})
                  </div>
                  <div style={{
                    maxHeight: '160px',
                    overflowY: 'auto',
                    backgroundColor: 'rgba(0, 0, 0, 0.25)',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.04)'
                  }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                      <thead>
                        <tr style={{ color: '#64748B', textAlign: 'left', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          <th style={{ padding: '8px 12px' }}>Email</th>
                          <th style={{ padding: '8px 12px' }}>Step</th>
                          <th style={{ padding: '8px 12px' }}>Status</th>
                          <th style={{ padding: '8px 12px' }}>History</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dripEnrollments.map(enr => (
                          <tr key={enr.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                            <td style={{ padding: '8px 12px', color: '#E2E8F0', fontWeight: 500 }}>{enr.customerEmail}</td>
                            <td style={{ padding: '8px 12px', color: '#94A3B8' }}>Step {enr.currentStepIndex + 1} of 3</td>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: 700,
                                backgroundColor: enr.status === 'converted_exit' ? 'rgba(16, 185, 129, 0.2)' : enr.status === 'completed' ? 'rgba(100, 116, 139, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                                color: enr.status === 'converted_exit' ? '#34D399' : enr.status === 'completed' ? '#94A3B8' : '#818CF8'
                              }}>
                                {enr.status === 'converted_exit' ? 'Converted & Exited 🛒' : enr.status === 'completed' ? 'Completed' : 'Active Pacing'}
                              </span>
                            </td>
                            <td style={{ padding: '8px 12px', color: '#64748B' }}>
                              {enr.history?.length || 0} sent
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ))}

            {/* Wave 8: Abandoned Checkouts Recovery Queue */}
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
                              fontSize: '10px',
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

            {/* Flows Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(460px, 1fr))', gap: '16px' }}>
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
        )}

        {/* TAB 2: CAMPAIGNS (BROADCASTS) */}
        {activeTab === 'map' && <EmailFlowMap />}
        {activeTab === 'transactional' && <EmailPrograms mode="transactional" />}
        {activeTab === 'builder' && <EmailPrograms mode="builder" />}
        {activeTab === 'forms' && <SignupForms />}
        {activeTab === 'inbox' && <EmailInbox />}
        {activeTab === 'sms' && <SmsPanel />}
        {activeTab === 'sending' && <SendingSetup />}
        {activeTab === 'klaviyo' && <KlaviyoSync />}
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

            {/* Broadcasts List */}
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
                  gridTemplateColumns: '2.5fr 1fr 1fr 1fr 1fr 1fr',
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
                            fontSize: '10px',
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
                    <div style={{ color: '#d1d5db', fontWeight: 500 }}>{b.sent == null ? '—' : b.sent.toLocaleString()}</div>
                    <div>
                      <span style={{ color: '#34d399', fontWeight: 600 }}>{b.opened == null ? '—' : b.opened}</span>
                      <span style={{ color: '#6b7280', margin: '0 4px' }}>/</span>
                      <span style={{ color: '#60a5fa', fontWeight: 600 }}>{b.clicked == null ? '—' : b.clicked}</span>
                    </div>
                    <div style={{ color: '#fbbf24', fontWeight: 700 }}>
                      {b.revenue == null ? '—' : `$${b.revenue.toFixed(2)}`}
                    </div>
                    <p style={{ gridColumn: '1 / -1', margin: '8px 0 0', fontSize: 12, color: '#9ca3af' }}>
                      Delivered {b.delivered == null ? '—' : b.delivered} · Unsubscribed {b.unsubscribed == null ? '—' : b.unsubscribed}
                      {b.prefetchOpens ? ` · ${b.prefetchOpens} opens included an Apple Mail prefetch flag.` : ''}
                    </p>
                    {b.smartReport && <p style={{ gridColumn: '1 / -1', margin: '8px 0 0', fontSize: 12, color: '#d1d5db' }}>{b.smartReport}</p>}
                    {b.holdout?.enabled && (
                      <p style={{ gridColumn: '1 / -1', margin: '8px 0 0', fontSize: 12, color: '#d1d5db' }}>
                        Holdout {b.holdout.percent}%. Sent group: {b.holdoutReport?.sent.sample ? `${b.holdoutReport.sent.sample} people, ${b.holdoutReport.sent.perPerson == null ? '—' : `$${b.holdoutReport.sent.perPerson.toFixed(2)}`} each` : '—'}. Held-out group: {b.holdoutReport?.held.sample ? `${b.holdoutReport.held.sample} people, ${b.holdoutReport.held.perPerson == null ? '—' : `$${b.holdoutReport.held.perPerson.toFixed(2)}`} each` : '—'}.
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
                  <Send size={11} /> Draft Whale Perk
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
                              fontSize: '10px',
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
                          fontSize: '10px',
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
                        <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>No orders yet</div>
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
                          <span style={{ display: 'block', fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>Top Whale tier</span>
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
                          <span style={{ display: 'block', fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>Luxe frequent</span>
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
                          <span style={{ display: 'block', fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>Rising VIP</span>
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
                            <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', backgroundColor: autoWinbackEnabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)', color: autoWinbackEnabled ? '#34d399' : '#9ca3af', fontWeight: 600 }}>
                              {autoWinbackEnabled ? 'Active' : 'Off'}
                            </span>
                          </div>
                          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#9ca3af', lineHeight: 1.4 }}>
                            Automatically enrolls clients into our gentle winback sequence with code WELCOMEBACK15 when they cross {customAtRiskDays} days inactive.
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

                    <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <label htmlFor="unlimitedDiscountToggle" style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6', cursor: 'pointer' }}>
                              Single-Use Coupon Safeguard
                            </label>
                            <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', backgroundColor: !allowUnlimitedDiscountUse ? 'rgba(16, 185, 129, 0.2)' : 'rgba(234, 179, 8, 0.2)', color: !allowUnlimitedDiscountUse ? '#34d399' : '#fde047', fontWeight: 600 }}>
                              {!allowUnlimitedDiscountUse ? '1 Use Per Client' : 'Unlimited Use'}
                            </span>
                          </div>
                          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#9ca3af', lineHeight: 1.4 }}>
                            {!allowUnlimitedDiscountUse
                              ? 'Restricts WELCOMEBACK15 to one redemption per customer in Shopify to prevent coupon sharing.'
                              : 'Allows customers to reuse WELCOMEBACK15 on multiple orders.'}
                          </p>
                        </div>
                        <input
                          id="unlimitedDiscountToggle"
                          type="checkbox"
                          checked={!allowUnlimitedDiscountUse}
                          onChange={e => setAllowUnlimitedDiscountUse(!e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: '#10b981', cursor: 'pointer', marginTop: '2px' }}
                        />
                      </div>

                      <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '8px', backgroundColor: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#e5e7eb' }}>
                          <CheckCircle2 size={14} style={{ color: '#34d399' }} />
                          <span>Shopify Codes: <strong>WELCOMEBACK15</strong> (15%), <strong>SAVE10</strong> (10%), <strong>SANCTUARY</strong> (10%)</span>
                        </div>
                        <span style={{ fontSize: '10px', color: '#9ca3af' }}>Auto-Synced</span>
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
                    setBroadcastSubject('Your Private VIP Sanctuary Perk');
                    setBroadcastPreviewText('An exclusive reward reserved for our most cherished clients');
                    setBroadcastBody(`Hi ${contact.name.split(' ')[0] || 'there'},\n\nAs one of our most valued clients, we wanted to personally gift you our private VIP Sanctuary reward.\n\nUse code SANCTUARY at checkout for 10% off your next botanical ritual.\n\nWith gratitude,\n${workspace?.shopifyConfig?.storeDomain || workspace?.name || 'Your Care Team'}`);
                  } else if (templateKey === 'at_risk_winback') {
                    setBroadcastSubject('We missed you — a 15% reconnect gift inside');
                    setBroadcastPreviewText('Your private courtesy code WELCOMEBACK15 is ready');
                    setBroadcastBody(`Hi ${contact.name.split(' ')[0] || 'there'},\n\nIt has been a while since your last order, and we would love to welcome you back.\n\nUse courtesy code WELCOMEBACK15 at checkout for 15% off your next restock.\n\nWarmly,\n${workspace?.shopifyConfig?.storeDomain || workspace?.name || 'Your Care Team'}`);
                  } else if (templateKey === 'lead_welcome') {
                    setBroadcastSubject('A special welcome gift: 10% off your first order');
                    setBroadcastPreviewText('Claim your welcome voucher SAVE10 today');
                    setBroadcastBody(`Hi ${contact.name.split(' ')[0] || 'there'},\n\nThank you for joining our community! We are excited to help you find your signature skincare ritual.\n\nEnjoy 10% off your first order with code SAVE10.\n\nWarmly,\n${workspace?.shopifyConfig?.storeDomain || workspace?.name || 'Your Care Team'}`);
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
                Opens, clicks, and delivery show up only after a sent campaign reports them.
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
                  <div style={{ fontSize: '26px', fontWeight: 700, color: '#ffffff', marginTop: '6px' }}>{value == null ? '—' : value.toLocaleString()}</div>
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
                      {seg.name} ({seg.count} contacts) — {seg.definition || seg.description}
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
                    <Crown size={12} style={{ color: '#c084fc' }} /> VIP Whale Perk
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
                    <AlertTriangle size={12} style={{ color: '#f59e0b' }} /> At-Risk 15% Winback
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
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: '#9ca3af' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <ShieldCheck size={12} style={{ color: '#10b981' }} />
                    Shopify Voucher: <strong style={{ color: '#34d399' }}>WELCOMEBACK15</strong> (15% Off Active)
                  </span>
                  <span style={{ color: '#6b7280' }}>
                    {rfmConfig.allowUnlimitedDiscountUse ? 'Unlimited reuse' : '1 use per client'}
                  </span>
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
                  <span style={{ fontSize: '10px', color: '#6b7280' }}>How subscribers see your note before opening</span>
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
                    {broadcastSubject.trim() || 'VIP Access: 20% Off Our New Serum'}
                  </div>
                  <div style={{ color: '#9ca3af', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>
                    {broadcastPreviewText.trim()
                      ? broadcastPreviewText.trim()
                      : (broadcastBody.trim().slice(0, 90) || 'Your private preview is waiting inside...')}
                  </div>
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>
                    Letter & Offer Content
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ fontSize: '10px', color: '#6b7280' }}>Insert:</span>
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
                          fontSize: '10px',
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
                onClick={() => setShowWebhookGuide(false)}
                style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '4px' }}
              >
                <X size={18} />
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
