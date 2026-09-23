import React, { useState, useEffect } from 'react';
import {
  Mail, Send, Users, TrendingUp, Sparkles, Plus, CheckCircle2,
  Clock, ArrowUpRight, Copy, Check, RefreshCw, AlertCircle, ShoppingBag, Eye,
  ExternalLink, Zap, Terminal, X, Filter, Search, Tag, DollarSign, ArrowRight, Layers
} from 'lucide-react';
import { authHeaders } from '../../lib/firebase';
import type { Workspace, AudienceSegment } from '../../types/journey';

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
  sentAt: string;
  recipients: number;
  openRate: number;
  clickRate: number;
  attributedSales?: number;
  sendMode?: 'direct' | 'shopify_push';
  shopifyTagApplied?: string;
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
}

interface Analytics {
  totalSent: number;
  avgOpenRate: number;
  avgClickRate: number;
  deliveryRate: number;
  activeSubscribers: number;
}

interface Props {
  workspace: Workspace | null;
  onOpenShopifyConnect?: () => void;
  onReturnToCanvas?: () => void;
}

export const HubEmailSuite: React.FC<Props> = ({ workspace, onOpenShopifyConnect, onReturnToCanvas }) => {
  const [activeTab, setActiveTab] = useState<'campaigns' | 'flows' | 'audience' | 'analytics'>('campaigns');
  const [flows, setFlows] = useState<HubFlow[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [segments, setSegments] = useState<AudienceSegment[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedFlowId, setCopiedFlowId] = useState<string | null>(null);

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

  // Audience Sync & Filtering state
  const [syncingShopify, setSyncingShopify] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);
  const [audienceFilter, setAudienceFilter] = useState<string>('all');
  const [audienceSearch, setAudienceSearch] = useState<string>('');

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
      const [fRes, bRes, aRes, sRes, segRes] = await Promise.all([
        fetch('/api/email/flows', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/email/broadcasts', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/email/analytics', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/email/audience', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/email/segments', { headers }).then(r => r.json()).catch(() => ({}))
      ]);

      if (fRes?.success && Array.isArray(fRes.flows)) setFlows(fRes.flows);
      if (bRes?.success && Array.isArray(bRes.broadcasts)) setBroadcasts(bRes.broadcasts);
      if (aRes?.success && aRes.analytics) setAnalytics(aRes.analytics);
      if (sRes?.success && Array.isArray(sRes.subscribers)) setSubscribers(sRes.subscribers);
      if (segRes?.success && Array.isArray(segRes.segments)) setSegments(segRes.segments);
    } finally {
      setLoading(false);
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
      if (data?.success) {
        setSyncSuccessMsg(`Synced ${data.syncedCount || 0} customer profiles from Shopify (${data.totalCustomers} total contacts in CRM).`);
        setTimeout(() => setSyncSuccessMsg(null), 4000);
        await loadData();
      }
    } catch (err) {
      console.error('Failed syncing Shopify customers:', err);
    } finally {
      setSyncingShopify(false);
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
          sendMode,
          workspaceId: workspace?.id
        })
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        setBroadcastSuccess(true);
        setBroadcastFeedback(data.message || 'Campaign processed successfully!');
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
            Automated customer journey emails, VIP offer sequences, and 1-click export to Klaviyo & Shopify.
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
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
        }}
      >
        {[
          { key: 'flows', label: 'Automated Flows', icon: Clock },
          { key: 'campaigns', label: 'Broadcasts & Drops', icon: Send },
          { key: 'audience', label: 'Audience & Leads', icon: Users },
          { key: 'analytics', label: 'Deliverability & Stats', icon: TrendingUp }
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
            </button>
          );
        })}
      </div>

      {/* Main Tab Content */}
      <div style={{ padding: '24px 32px', flex: 1 }}>
        {/* TAB 1: FLOWS */}
        {activeTab === 'flows' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>
                  E-Commerce Conversion Flows
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af' }}>
                  Pre-built sequences for new leads, voucher claims, and post-optin checkouts.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
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
                  <span>Outbound Webhook Relay</span>
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
                <div>Recipients</div>
                <div>Performance</div>
                <div>Attributed Sales</div>
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

                    <div style={{ color: '#9ca3af', fontSize: '12px' }}>{new Date(b.sentAt).toLocaleDateString()}</div>
                    <div style={{ color: '#d1d5db', fontWeight: 500 }}>{b.recipients.toLocaleString()}</div>
                    <div>
                      <span style={{ color: '#34d399', fontWeight: 600 }}>{b.openRate}%</span>
                      <span style={{ color: '#6b7280', margin: '0 4px' }}>/</span>
                      <span style={{ color: '#60a5fa', fontWeight: 600 }}>{b.clickRate}%</span>
                    </div>
                    <div style={{ color: '#fbbf24', fontWeight: 700 }}>
                      ${(b.attributedSales || 0).toFixed(2)}
                    </div>
                  </div>
                ))
              )}
            </div>
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
              </div>

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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
              <div style={{ backgroundColor: '#121217', padding: '16px 20px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>Total Contacts</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#ffffff', marginTop: '4px' }}>
                  {subscribers.length.toLocaleString()}
                </div>
                <div style={{ fontSize: '11px', color: '#34d399', marginTop: '2px' }}>Unified CRM Audience</div>
              </div>

              <div style={{ backgroundColor: '#121217', padding: '16px 20px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>Shopify Verified Buyers</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#ec4899', marginTop: '4px' }}>
                  {subscribers.filter(s => (s.ordersCount || 0) > 0).length.toLocaleString()}
                </div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>Past checkout buyers</div>
              </div>

              <div style={{ backgroundColor: '#121217', padding: '16px 20px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>Total Customer LTV</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#10b981', marginTop: '4px' }}>
                  ${subscribers.reduce((sum, s) => sum + (s.totalSpent || 0), 0).toFixed(2)}
                </div>
                <div style={{ fontSize: '11px', color: '#34d399', marginTop: '2px' }}>Attributed Customer Spend</div>
              </div>

              <div style={{ backgroundColor: '#121217', padding: '16px 20px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ fontSize: '11px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>Marketing Consented</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#60a5fa', marginTop: '4px' }}>
                  {subscribers.filter(s => s.status === 'active').length.toLocaleString()}
                </div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>Compliant for broadcasts</div>
              </div>
            </div>

            {/* Filter Pills & Search */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { id: 'all', label: `All (${subscribers.length})` },
                  { id: 'buyers', label: `Verified Buyers (${subscribers.filter(s => (s.ordersCount || 0) > 0).length})` },
                  { id: 'vip', label: `VIPs $100+ (${subscribers.filter(s => (s.totalSpent || 0) >= 100).length})` },
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
                  gridTemplateColumns: '1.4fr 1.6fr 1fr 1fr 2fr',
                  padding: '12px 20px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#6b7280',
                  textTransform: 'uppercase'
                }}
              >
                <div>Customer Name</div>
                <div>Email & Phone</div>
                <div>Orders & Spend</div>
                <div>Marketing</div>
                <div>Tags & Source</div>
              </div>

              {subscribers
                .filter(sub => {
                  if (audienceFilter === 'buyers') return (sub.ordersCount || 0) > 0;
                  if (audienceFilter === 'vip') return (sub.totalSpent || 0) >= 100;
                  if (audienceFilter === 'repeat') return (sub.ordersCount || 0) >= 2;
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
                    sub.tags.some(t => t.toLowerCase().includes(q))
                  );
                })
                .map((sub, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.4fr 1.6fr 1fr 1fr 2fr',
                      padding: '14px 20px',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      fontSize: '13px',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: '#f3f4f6' }}>{sub.name || 'Anonymous Customer'}</div>
                      <div style={{ fontSize: '11px', color: '#6b7280' }}>
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
                      {sub.tags.map((tag, tIdx) => (
                        <span
                          key={tIdx}
                          style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            backgroundColor: tag.includes('VIP')
                              ? 'rgba(236, 72, 153, 0.15)'
                              : tag.includes('Buyer')
                              ? 'rgba(16, 185, 129, 0.12)'
                              : 'rgba(255, 255, 255, 0.06)',
                            color: tag.includes('VIP')
                              ? '#f472b6'
                              : tag.includes('Buyer')
                              ? '#34d399'
                              : '#d1d5db',
                            border: '1px solid rgba(255, 255, 255, 0.1)'
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
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
                Real-time open, click, and delivery rates for your customer journey communications.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
              <div style={{ backgroundColor: '#121217', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500 }}>Active Contacts</div>
                <div style={{ fontSize: '26px', fontWeight: 700, color: '#ffffff', marginTop: '6px' }}>
                  {analytics.activeSubscribers.toLocaleString()}
                </div>
                <div style={{ fontSize: '11px', color: '#34d399', marginTop: '4px' }}>Verified Deliverable</div>
              </div>

              <div style={{ backgroundColor: '#121217', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500 }}>Average Open Rate</div>
                <div style={{ fontSize: '26px', fontWeight: 700, color: '#34d399', marginTop: '6px' }}>
                  {analytics.avgOpenRate}%
                </div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>Industry Benchmark: 22.4%</div>
              </div>

              <div style={{ backgroundColor: '#121217', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500 }}>Average Click Rate</div>
                <div style={{ fontSize: '26px', fontWeight: 700, color: '#60a5fa', marginTop: '6px' }}>
                  {analytics.avgClickRate}%
                </div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>Direct to Shopify Checkout</div>
              </div>

              <div style={{ backgroundColor: '#121217', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500 }}>Inbox Delivery Rate</div>
                <div style={{ fontSize: '26px', fontWeight: 700, color: '#f472b6', marginTop: '6px' }}>
                  {analytics.deliveryRate}%
                </div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>SPF / DKIM Authenticated</div>
              </div>
            </div>
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
                  Target by customer psychology with direct delivery or 1-click Shopify Email sync.
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
                  {segments.map(seg => (
                    <option key={seg.id} value={seg.id} style={{ backgroundColor: '#1a1a24', color: '#ffffff' }}>
                      {seg.name} ({seg.count} contacts) — {seg.description}
                    </option>
                  ))}
                  {segments.length === 0 && (
                    <option value="all" style={{ backgroundColor: '#1a1a24' }}>
                      All Active Subscribers ({subscribers.length} contacts)
                    </option>
                  )}
                </select>
              </div>

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

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: '6px' }}>
                  Letter & Offer Content
                </label>
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
                      ? 'Tag & Push to Shopify Email'
                      : 'Send Direct Broadcast'}
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
                Whenever a shopper submits their email or takes an order bump on any Jourvance funnel page, a non-blocking JSON webhook is immediately dispatched to your target URL.
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
  "email": "customer@example.com",
  "name": "Sarah Jenkins",
  "phone": "+1-555-0199",
  "pageSlug": "spring-glow-bundle",
  "bumpAccepted": true,
  "bumpProductTitle": "Hydration Mist Mini Add-On",
  "cartUrl": "https://brand.myshopify.com/cart/42109840192:1,42109840193:1?discount=SPRING20",
  "timestamp": "2026-09-23T15:30:00.000Z"
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
