import React, { useEffect, useState } from 'react';
import {
  ShoppingBag,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  Layers,
  Activity,
  Send,
  ShieldCheck,
  Clock,
  Check,
  AlertTriangle,
  Radio
} from 'lucide-react';
import type { Workspace } from '../../types/journey';
import {
  connectShopifyStore,
  disconnectShopifyStore,
  fetchShopifySignals,
  registerShopifyWebhooks,
  fetchWebhookHealth,
  sendWebhookTestPing,
  type WebhookHealthData,
  type WebhookDeliveryReceipt
} from '../../lib/shopifyClient';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  workspace: Workspace | null;
  onWorkspaceUpdated: (updated: Workspace) => void;
  onOpenBilling?: () => void;
}

export const ShopifyConnectModal: React.FC<Props> = ({
  isOpen,
  onClose,
  workspace,
  onWorkspaceUpdated,
  onOpenBilling
}) => {
  const [activeTab, setActiveTab] = useState<'connection' | 'webhooks'>('connection');
  const [storeDomain, setStoreDomain] = useState(workspace?.shopifyConfig?.storeDomain || '');
  const [adminToken, setAdminToken] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const tokenOnFile = Boolean(workspace?.shopifyConfig?.adminAccessToken || workspace?.shopifyConfig?.storefrontAccessToken);
  const secretOnFile = Boolean(workspace?.shopifyConfig?.webhookSecretOnFile);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [signals, setSignals] = useState<Awaited<ReturnType<typeof fetchShopifySignals>> | null>(null);
  const [signalError, setSignalError] = useState('');

  // Webhook Health & Live Diagnostics State
  const [webhookHealth, setWebhookHealth] = useState<WebhookHealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [pingLoading, setPingLoading] = useState(false);
  const [pingSuccess, setPingSuccess] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState('orders/create');

  useEffect(() => {
    if (!isOpen || !workspace || workspace.shopifyConfig?.status !== 'connected') {
      setSignals(null);
      setWebhookHealth(null);
      return;
    }
    let gone = false;
    fetchShopifySignals(workspace.id).then((row) => {
      if (gone) return;
      if (!row.success) setSignalError(row.error || 'Store signals could not be loaded.');
      else {
        setSignalError('');
        setSignals(row);
        if (row.webhookHealth) {
          setWebhookHealth(row.webhookHealth);
        }
      }
    });

    // Also fetch dedicated health
    fetchWebhookHealth(workspace.id).then((healthRow) => {
      if (gone) return;
      if (healthRow.success && healthRow.status) {
        setWebhookHealth(healthRow as WebhookHealthData);
      }
    });

    return () => {
      gone = true;
    };
  }, [isOpen, workspace]);

  // Periodic polling when webhooks tab is active
  useEffect(() => {
    if (!isOpen || !workspace || activeTab !== 'webhooks' || workspace.shopifyConfig?.status !== 'connected') {
      return;
    }
    const interval = setInterval(() => {
      fetchWebhookHealth(workspace.id).then((healthRow) => {
        if (healthRow.success && healthRow.status) {
          setWebhookHealth(healthRow as WebhookHealthData);
        }
      });
    }, 8000);
    return () => clearInterval(interval);
  }, [isOpen, workspace, activeTab]);

  const loadHealth = async () => {
    if (!workspace) return;
    setHealthLoading(true);
    try {
      const res = await fetchWebhookHealth(workspace.id);
      if (res.success && res.status) {
        setWebhookHealth(res as WebhookHealthData);
      }
    } finally {
      setHealthLoading(false);
    }
  };

  const handleTestPing = async () => {
    if (!workspace) return;
    setPingLoading(true);
    setPingSuccess(null);
    setError(null);
    try {
      const res = await sendWebhookTestPing(workspace.id, selectedTopic);
      if (res.success) {
        setPingSuccess(res.message || 'Test ping processed and signature verified.');
        if (res.health) setWebhookHealth(res.health);
        else loadHealth();
      } else {
        setError(res.error || 'Test ping failed to deliver.');
      }
    } finally {
      setPingLoading(false);
    }
  };

  const registerWebhooks = async () => {
    if (!workspace) return;
    setLoading(true);
    setSignalError('');
    try {
      const row = await registerShopifyWebhooks(workspace.id);
      if (!row.success) setSignalError(row.error || 'Shopify did not register the webhooks.');
      else setSignals((prev) => ({ ...(prev || { success: true }), ...row, success: true }));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !workspace) return null;

  const isConnected = workspace.shopifyConfig?.status === 'connected' && !!workspace.shopifyConfig?.storeDomain;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeDomain.trim()) {
      setError('Enter that store’s .myshopify.com domain.');
      return;
    }
    if (!adminToken.trim() && !tokenOnFile) {
      setError('Paste the Admin API access token from this Shopify store.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await connectShopifyStore(workspace.id, storeDomain.trim(), adminToken.trim(), webhookSecret.trim());
      if (res.success && res.workspace) {
        onWorkspaceUpdated(res.workspace);
        setAdminToken('');
        setWebhookSecret('');
        setSuccessMsg(res.notice || `Shopify accepted ${res.workspace.shopifyConfig?.shopName || res.workspace.shopifyConfig?.storeDomain}.`);
        loadHealth();
      } else {
        setError(res.error || 'Connection failed. Please check your domain and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect this Shopify store from this workspace?')) return;
    setLoading(true);
    try {
      const ok = await disconnectShopifyStore(workspace.id);
      if (ok) {
        onWorkspaceUpdated({
          ...workspace,
          shopifyConfig: { storeDomain: '', status: 'disconnected' }
        });
        setStoreDomain('');
        setWebhookHealth(null);
        setSuccessMsg('Store disconnected.');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatRelativeTime = (isoString?: string | null) => {
    if (!isoString) return 'None yet';
    const diff = Math.max(0, Date.now() - new Date(isoString).getTime());
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(isoString).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 5, 8, 0.85)',
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
          maxWidth: '720px',
          maxHeight: '90vh',
          backgroundColor: '#121217',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column'
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
            background: 'linear-gradient(180deg, rgba(236, 72, 153, 0.08) 0%, rgba(18, 18, 23, 0) 100%)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(16, 185, 129, 0.3)'
              }}
            >
              <ShoppingBag size={22} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>
                Shopify Integration & Telemetry
              </h3>
              <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
                Workspace: <span style={{ color: '#ec4899', fontWeight: 500 }}>{workspace.name}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '8px'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation (Option A) */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '0 24px',
            gap: '8px',
            backgroundColor: 'rgba(0, 0, 0, 0.2)'
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('connection')}
            style={{
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'connection' ? '2px solid #ec4899' : '2px solid transparent',
              color: activeTab === 'connection' ? '#f3f4f6' : '#9ca3af',
              fontWeight: activeTab === 'connection' ? 600 : 500,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.15s ease'
            }}
          >
            <ShoppingBag size={15} />
            Store Connection
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('webhooks');
              loadHealth();
            }}
            style={{
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'webhooks' ? '2px solid #ec4899' : '2px solid transparent',
              color: activeTab === 'webhooks' ? '#f3f4f6' : '#9ca3af',
              fontWeight: activeTab === 'webhooks' ? 600 : 500,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.15s ease'
            }}
          >
            <Activity size={15} />
            Live Webhook Health & Logs
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor:
                  webhookHealth?.status === 'healthy'
                    ? '#10b981'
                    : webhookHealth?.status === 'degraded'
                    ? '#f59e0b'
                    : webhookHealth?.status === 'failing' || webhookHealth?.status === 'missing_secret'
                    ? '#ef4444'
                    : '#6b7280',
                boxShadow:
                  webhookHealth?.status === 'healthy'
                    ? '0 0 8px rgba(16, 185, 129, 0.6)'
                    : webhookHealth?.status === 'degraded'
                    ? '0 0 8px rgba(245, 158, 11, 0.6)'
                    : 'none'
              }}
            />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* TAB 1: Store Connection */}
          {activeTab === 'connection' && (
            <>
              {/* Status Banner */}
              {isConnected ? (
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px'
                  }}
                >
                  <CheckCircle2 size={18} style={{ color: '#10b981', flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#10b981' }}>
                      Shopify accepted {workspace.shopifyConfig?.shopName || workspace.shopifyConfig?.storeDomain}
                    </div>
                    <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                      {workspace.shopifyConfig?.missingScopes?.length
                        ? `This store has not granted: ${workspace.shopifyConfig.missingScopes.join(', ')}.`
                        : 'This store’s admin token can read products, orders, and customers, and can create discount codes.'}
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    fontSize: '13px',
                    color: '#9ca3af',
                    lineHeight: 1.5
                  }}
                >
                  Each Shopify store creates its own Admin API token. Paste that token here so Jourvance can read that store. A token from a different store is refused.
                </div>
              )}

              {isConnected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6' }}>Shopify Webhook Subscriptions</div>
                    <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#9ca3af', lineHeight: 1.5 }}>
                      {signals?.publicUrl
                        ? 'Register sends each topic to Shopify. A topic that Shopify refuses stays unchecked.'
                        : 'These topics are not registered. Shopify cannot reach this app until a public https address is set. The paths below are what you would subscribe.'}
                    </p>
                    {signalError && <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#f87171' }}>{signalError}</p>}
                    <ul style={{ margin: '8px 0 0', paddingLeft: '18px', fontSize: '12px', color: '#d1d5db', lineHeight: 1.5 }}>
                      {(signals?.topics || []).map((topic) => (
                        <li key={topic.topic}>
                          <span style={{ color: topic.registered ? '#34d399' : '#9ca3af' }}>{topic.registered ? 'Registered' : 'Not registered'}</span>
                          {' '}{topic.topic}{' '}
                          <code style={{ color: '#93c5fd' }}>{topic.path}</code>
                          {topic.detail ? ` — ${topic.detail}` : ''}
                        </li>
                      ))}
                    </ul>
                    {signals?.publicUrl && (
                      <button
                        type="button"
                        onClick={registerWebhooks}
                        disabled={loading}
                        style={{
                          marginTop: '10px',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: '1px solid rgba(16,185,129,0.4)',
                          background: 'transparent',
                          color: '#34d399',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: 500
                        }}
                      >
                        Register these webhooks with Shopify
                      </button>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6' }}>Customer Events Pixel</div>
                    <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#9ca3af', lineHeight: 1.5 }}>
                      Paste this under Customer events. It sends product views, add to cart, collection views, search, and checkout starts.
                    </p>
                    {signals?.pixelSnippet && (
                      <textarea
                        readOnly
                        value={signals.pixelSnippet}
                        aria-label="Customer events pixel"
                        style={{
                          width: '100%',
                          minHeight: '100px',
                          marginTop: '8px',
                          boxSizing: 'border-box',
                          background: '#0b0b10',
                          color: '#e5e7eb',
                          border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: '8px',
                          padding: '8px',
                          fontSize: '11px',
                          fontFamily: 'monospace'
                        }}
                      />
                    )}
                  </div>
                </div>
              )}

              {error && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#f87171',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              {successMsg && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    color: '#34d399',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <CheckCircle2 size={16} />
                  <span>{successMsg}</span>
                </div>
              )}

              <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#e5e7eb', marginBottom: '6px' }}>
                    Shopify Store Domain
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. yourbrand.myshopify.com"
                    value={storeDomain}
                    onChange={(e) => setStoreDomain(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      backgroundColor: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      color: '#f3f4f6',
                      fontSize: '14px',
                      outline: 'none'
                    }}
                  />
                  <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#6b7280' }}>
                    Use the .myshopify.com domain from that store’s admin.
                  </p>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#e5e7eb', marginBottom: '6px' }} htmlFor="shopify-admin-token">
                    Admin API Access Token
                  </label>
                  <input
                    id="shopify-admin-token"
                    type="password"
                    autoComplete="off"
                    placeholder={tokenOnFile ? 'Token saved. Paste a new one to replace it.' : 'shpat_…'}
                    value={adminToken}
                    onChange={(e) => setAdminToken(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      backgroundColor: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      color: '#f3f4f6',
                      fontSize: '14px',
                      outline: 'none'
                    }}
                  />
                  <ol style={{ margin: '8px 0 0', paddingLeft: '18px', fontSize: '11px', color: '#9ca3af', lineHeight: 1.5 }}>
                    <li>In that store, open Settings, then Apps and sales channels, then Develop apps.</li>
                    <li>Create an app and allow read products, read orders, read customers, and write price rules.</li>
                    <li>Install the app and reveal the Admin API access token (starts with shpat_).</li>
                  </ol>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#e5e7eb', marginBottom: '6px' }} htmlFor="shopify-webhook-secret">
                    App API Webhook Secret
                  </label>
                  <input
                    id="shopify-webhook-secret"
                    type="password"
                    autoComplete="off"
                    placeholder={secretOnFile ? 'Secret saved. Paste a new one to replace it.' : 'Used to verify order webhooks'}
                    value={webhookSecret}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      backgroundColor: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      color: '#f3f4f6',
                      fontSize: '14px',
                      outline: 'none'
                    }}
                  />
                  <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#9ca3af', lineHeight: 1.5 }}>
                    In the same custom app, open API credentials and copy the API secret key. Shopify signs order and checkout webhooks with it. Jourvance refuses those webhooks until this secret is saved.
                  </p>
                </div>

                {/* Tenancy Rule Note */}
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(236, 72, 153, 0.05)',
                    border: '1px solid rgba(236, 72, 153, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                >
                  <Layers size={16} style={{ color: '#ec4899', flexShrink: 0 }} />
                  <div style={{ fontSize: '12px', color: '#d1d5db', lineHeight: 1.4 }}>
                    <strong>1 Store Per Workspace:</strong> Each workspace is isolated to one Shopify store. To manage another store, you can add another workspace in your plan.
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      backgroundColor: '#10b981',
                      color: '#ffffff',
                      fontWeight: 600,
                      fontSize: '14px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)'
                    }}
                  >
                    {loading ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        <span>Connecting Store...</span>
                      </>
                    ) : (
                      <>
                        <ShoppingBag size={16} />
                        <span>{isConnected ? 'Update Connection' : 'Connect Shopify Store'}</span>
                      </>
                    )}
                  </button>

                  {isConnected && (
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      disabled={loading}
                      style={{
                        padding: '10px 14px',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        color: '#f87171',
                        fontWeight: 500,
                        fontSize: '13px',
                        borderRadius: '8px',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        cursor: 'pointer'
                      }}
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </form>
            </>
          )}

          {/* TAB 2: Live Webhook Health & Logs */}
          {activeTab === 'webhooks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {/* Webhook Health Status Card */}
              <div
                style={{
                  padding: '16px 20px',
                  borderRadius: '12px',
                  backgroundColor:
                    webhookHealth?.status === 'healthy'
                      ? 'rgba(16, 185, 129, 0.08)'
                      : webhookHealth?.status === 'degraded'
                      ? 'rgba(245, 158, 11, 0.08)'
                      : webhookHealth?.status === 'failing' || webhookHealth?.status === 'missing_secret'
                      ? 'rgba(239, 68, 68, 0.08)'
                      : 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${
                    webhookHealth?.status === 'healthy'
                      ? 'rgba(16, 185, 129, 0.3)'
                      : webhookHealth?.status === 'degraded'
                      ? 'rgba(245, 158, 11, 0.3)'
                      : webhookHealth?.status === 'failing' || webhookHealth?.status === 'missing_secret'
                      ? 'rgba(239, 68, 68, 0.3)'
                      : 'rgba(255, 255, 255, 0.1)'
                  }`
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        backgroundColor:
                          webhookHealth?.status === 'healthy'
                            ? 'rgba(16, 185, 129, 0.2)'
                            : webhookHealth?.status === 'degraded'
                            ? 'rgba(245, 158, 11, 0.2)'
                            : webhookHealth?.status === 'failing' || webhookHealth?.status === 'missing_secret'
                            ? 'rgba(239, 68, 68, 0.2)'
                            : 'rgba(255, 255, 255, 0.08)',
                        color:
                          webhookHealth?.status === 'healthy'
                            ? '#34d399'
                            : webhookHealth?.status === 'degraded'
                            ? '#fbbf24'
                            : webhookHealth?.status === 'failing' || webhookHealth?.status === 'missing_secret'
                            ? '#f87171'
                            : '#9ca3af'
                      }}
                    >
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor:
                            webhookHealth?.status === 'healthy'
                              ? '#34d399'
                              : webhookHealth?.status === 'degraded'
                              ? '#fbbf24'
                              : webhookHealth?.status === 'failing' || webhookHealth?.status === 'missing_secret'
                              ? '#f87171'
                              : '#9ca3af'
                        }}
                      />
                      {webhookHealth?.status === 'healthy'
                        ? 'Healthy & Active'
                        : webhookHealth?.status === 'degraded'
                        ? 'Degraded (Signature Mismatch)'
                        : webhookHealth?.status === 'missing_secret'
                        ? 'Missing API Secret'
                        : webhookHealth?.status === 'failing'
                        ? 'Delivery Failing'
                        : 'Ready & Listening'}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={loadHealth}
                    disabled={healthLoading}
                    title="Refresh diagnostics"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#9ca3af',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px'
                    }}
                  >
                    <RefreshCw size={13} className={healthLoading ? 'animate-spin' : ''} />
                    <span>Refresh</span>
                  </button>
                </div>

                <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#d1d5db', lineHeight: 1.4 }}>
                  {webhookHealth?.message || 'Awaiting incoming webhook signals from Shopify.'}
                </p>

                {/* 4-Stat Ribbon */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '10px',
                    paddingTop: '12px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.08)'
                  }}
                >
                  <div style={{ background: 'rgba(0,0,0,0.25)', padding: '8px 10px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>
                      24h Signals
                    </div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#f3f4f6', marginTop: '2px' }}>
                      {webhookHealth?.metrics?.total24h ?? 0}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(0,0,0,0.25)', padding: '8px 10px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>
                      Success Rate
                    </div>
                    <div
                      style={{
                        fontSize: '16px',
                        fontWeight: 700,
                        marginTop: '2px',
                        color:
                          (webhookHealth?.metrics?.successRate ?? 100) >= 95
                            ? '#34d399'
                            : (webhookHealth?.metrics?.successRate ?? 100) >= 70
                            ? '#fbbf24'
                            : '#f87171'
                      }}
                    >
                      {webhookHealth?.metrics?.successRate ?? 100}%
                    </div>
                  </div>

                  <div style={{ background: 'rgba(0,0,0,0.25)', padding: '8px 10px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>
                      Last Signal
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#d1d5db', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatRelativeTime(webhookHealth?.lastReceivedAt)}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(0,0,0,0.25)', padding: '8px 10px', borderRadius: '8px' }}>
                    <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>
                      HMAC Shield
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#34d399', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <ShieldCheck size={13} />
                      <span>Enforced</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Pre-Flight Test Ping Toolbar */}
              <div
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Radio size={16} style={{ color: '#ec4899' }} />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6' }}>
                      Pre-Flight Signal Verification
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                    Zero-cost simulation (does not charge cards or alter real CRM contacts)
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' }}>
                  <select
                    value={selectedTopic}
                    onChange={(e) => setSelectedTopic(e.target.value)}
                    style={{
                      flex: 1,
                      backgroundColor: 'rgba(18, 18, 23, 0.9)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '8px',
                      color: '#f3f4f6',
                      padding: '9px 12px',
                      fontSize: '13px',
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="orders/create">orders/create (Order Placed)</option>
                    <option value="checkouts/create">checkouts/create (Checkout Started)</option>
                    <option value="products/update">products/update (Catalog Sync)</option>
                  </select>

                  <button
                    type="button"
                    onClick={handleTestPing}
                    disabled={pingLoading || !isConnected}
                    style={{
                      padding: '9px 18px',
                      background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: pingLoading || !isConnected ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      boxShadow: '0 4px 12px rgba(236, 72, 153, 0.25)',
                      opacity: !isConnected ? 0.6 : 1
                    }}
                  >
                    {pingLoading ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>Simulating...</span>
                      </>
                    ) : (
                      <>
                        <Send size={14} />
                        <span>Send Test Ping</span>
                      </>
                    )}
                  </button>
                </div>

                {pingSuccess && (
                  <div
                    style={{
                      marginTop: '10px',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      color: '#34d399',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Check size={14} />
                    <span>{pingSuccess}</span>
                  </div>
                )}
              </div>

              {/* Live Delivery Diagnostic Log Table */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6' }}>
                    Live Delivery Diagnostic Log (Last 50 Events)
                  </div>
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                    {webhookHealth?.recentDeliveries?.length || 0} events recorded in memory
                  </span>
                </div>

                <div
                  style={{
                    backgroundColor: '#0b0b10',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '10px',
                    maxHeight: '260px',
                    overflowY: 'auto'
                  }}
                >
                  {(!webhookHealth?.recentDeliveries || webhookHealth.recentDeliveries.length === 0) ? (
                    <div style={{ padding: '32px 16px', textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
                      <Clock size={24} style={{ color: '#4b5563', margin: '0 auto 8px', display: 'block' }} />
                      No webhook deliveries logged yet. Send a test ping above or wait for live store order signals.
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#9ca3af', backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                          <th style={{ padding: '8px 12px', fontWeight: 600 }}>Status</th>
                          <th style={{ padding: '8px 12px', fontWeight: 600 }}>Topic</th>
                          <th style={{ padding: '8px 12px', fontWeight: 600 }}>Summary</th>
                          <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Latency</th>
                          <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {webhookHealth.recentDeliveries.map((delivery) => (
                          <tr
                            key={delivery.id}
                            style={{
                              borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                              transition: 'background-color 0.15s ease'
                            }}
                          >
                            <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                              {delivery.hmacStatus === 'valid' ? (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                                    color: '#34d399'
                                  }}
                                >
                                  <Check size={11} />
                                  Verified
                                </span>
                              ) : (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                    color: '#f87171'
                                  }}
                                >
                                  <AlertTriangle size={11} />
                                  {delivery.hmacStatus === 'missing_secret' ? 'No Secret' : 'Signature Mismatch'}
                                </span>
                              )}
                            </td>

                            <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '2px 6px',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  fontFamily: 'monospace',
                                  backgroundColor: 'rgba(59, 130, 246, 0.12)',
                                  color: '#93c5fd'
                                }}
                              >
                                {delivery.topic}
                              </span>
                              {delivery.isTest && (
                                <span
                                  style={{
                                    marginLeft: '6px',
                                    padding: '1px 5px',
                                    borderRadius: '4px',
                                    fontSize: '9px',
                                    fontWeight: 700,
                                    backgroundColor: 'rgba(245, 158, 11, 0.2)',
                                    color: '#fbbf24',
                                    textTransform: 'uppercase'
                                  }}
                                >
                                  Test
                                </span>
                              )}
                            </td>

                            <td
                              style={{
                                padding: '8px 12px',
                                color: '#e5e7eb',
                                maxWidth: '280px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                              title={delivery.summary}
                            >
                              {delivery.summary}
                            </td>

                            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#9ca3af', fontFamily: 'monospace' }}>
                              {delivery.latencyMs}ms
                            </td>

                            <td style={{ padding: '8px 12px', textAlign: 'right', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                              {formatRelativeTime(delivery.receivedAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
