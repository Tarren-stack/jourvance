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
  Radio,
  Globe,
  CreditCard
} from 'lucide-react';
import type { Workspace } from '../../types/journey';
import {
  connectShopifyStore,
  disconnectShopifyStore,
  connectWooCommerceStore,
  disconnectWooCommerceStore,
  fetchShopifySignals,
  registerShopifyWebhooks,
  fetchWebhookHealth,
  sendWebhookTestPing,
  type WebhookHealthData,
  type WebhookDeliveryReceipt
} from '../../lib/shopifyClient';
import { ModalDialog } from '../modals/ModalDialog';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  workspace: Workspace | null;
  onWorkspaceUpdated: (updated: Workspace) => void;
  onOpenBilling?: () => void;
}

// Names the dialog: ModalDialog's aria-labelledby points at the visible heading.
const TITLE_ID = 'jv-shopify-connect-title';

export const ShopifyConnectModal: React.FC<Props> = ({
  isOpen,
  onClose,
  workspace,
  onWorkspaceUpdated,
  onOpenBilling
}) => {
  const [activeTab, setActiveTab] = useState<'connection' | 'woocommerce' | 'stripe' | 'webhooks'>(() => {
    if (workspace?.woocommerceConfig?.status === 'connected') return 'woocommerce';
    return 'connection';
  });
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

  // WooCommerce Connection State
  const [wooUrl, setWooUrl] = useState(workspace?.woocommerceConfig?.storeUrl || '');
  const [wooKey, setWooKey] = useState(workspace?.woocommerceConfig?.consumerKey || '');
  const [wooSecret, setWooSecret] = useState('');
  const [wooLoading, setWooLoading] = useState(false);
  const [wooError, setWooError] = useState<string | null>(null);
  const [wooSuccess, setWooSuccess] = useState<string | null>(null);
  const isWooConnected = Boolean(workspace?.woocommerceConfig?.status === 'connected');

  // Webhook Health & Live Diagnostics State
  const [webhookHealth, setWebhookHealth] = useState<WebhookHealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [pingLoading, setPingLoading] = useState(false);
  const [pingSuccess, setPingSuccess] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState('orders/create');

  const handleConnectWoo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    setWooLoading(true);
    setWooError(null);
    setWooSuccess(null);
    const res = await connectWooCommerceStore(workspace.id, wooUrl, wooKey, wooSecret);
    setWooLoading(false);
    if (!res.success) {
      setWooError(res.error || 'Failed connecting WooCommerce store.');
    } else if (res.workspace) {
      setWooSuccess('WooCommerce store connected successfully.');
      onWorkspaceUpdated(res.workspace);
    }
  };

  const handleDisconnectWoo = async () => {
    if (!workspace) return;
    setWooLoading(true);
    setWooError(null);
    const res = await disconnectWooCommerceStore(workspace.id);
    setWooLoading(false);
    if (res.success && res.workspace) {
      onWorkspaceUpdated(res.workspace);
      setWooSuccess('WooCommerce store disconnected.');
    } else {
      setWooError(res.error || 'Failed disconnecting WooCommerce store.');
    }
  };

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
    <ModalDialog bare labelledBy={TITLE_ID} onClose={onClose} maxWidth={720} fallbackFocusSelectors={['#journey-map']}>
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
              <h3 id={TITLE_ID} style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>
                Shopify Integration & Telemetry
              </h3>
              <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af' }}>
                Connect Store & Checkout: <span style={{ color: '#ec4899', fontWeight: 500 }}>{workspace.name}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
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

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '0 24px',
            gap: '8px',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            overflowX: 'auto'
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
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap'
            }}
          >
            <ShoppingBag size={15} />
            Shopify
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('woocommerce')}
            style={{
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'woocommerce' ? '2px solid #38bdf8' : '2px solid transparent',
              color: activeTab === 'woocommerce' ? '#f3f4f6' : '#9ca3af',
              fontWeight: activeTab === 'woocommerce' ? 600 : 500,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap'
            }}
          >
            <Globe size={15} />
            WooCommerce
            {isWooConnected && (
              <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#38bdf8' }} />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('stripe')}
            style={{
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'stripe' ? '2px solid #10b981' : '2px solid transparent',
              color: activeTab === 'stripe' ? '#f3f4f6' : '#9ca3af',
              fontWeight: activeTab === 'stripe' ? 600 : 500,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap'
            }}
          >
            <CreditCard size={15} />
            Stripe & Direct Links
          </button>

          {isConnected && (
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
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap'
              }}
            >
              <Activity size={15} />
              Shopify Webhooks
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
                      : '#6b7280'
                }}
              />
            </button>
          )}
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
                          {topic.detail ? `: ${topic.detail}` : ''}
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
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#e5e7eb', marginBottom: '6px' }} htmlFor="shopify-store-domain">
                    Shopify Store Domain
                  </label>
                  <input
                    id="shopify-store-domain"
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

          {/* TAB 2: WooCommerce */}
          {activeTab === 'woocommerce' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {isWooConnected ? (
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px'
                  }}
                >
                  <CheckCircle2 size={18} style={{ color: '#38bdf8', flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#38bdf8' }}>
                      WooCommerce Connected: {workspace.woocommerceConfig?.storeName || workspace.woocommerceConfig?.storeUrl}
                    </div>
                    <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px', lineHeight: 1.5 }}>
                      URL: {workspace.woocommerceConfig?.storeUrl} | Currency: {workspace.woocommerceConfig?.currency || 'USD'}
                    </div>
                    <div style={{ marginTop: '12px' }}>
                      <button
                        type="button"
                        onClick={handleDisconnectWoo}
                        disabled={wooLoading}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          backgroundColor: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          color: '#f87171',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        {wooLoading ? 'Disconnecting...' : 'Disconnect WooCommerce Store'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    padding: '14px 16px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(56, 189, 248, 0.05)',
                    border: '1px solid rgba(56, 189, 248, 0.15)',
                    fontSize: '13px',
                    color: '#94a3b8',
                    lineHeight: 1.5
                  }}
                >
                  Connect your WordPress WooCommerce store via the native WooCommerce REST API. Products, variants, and order conversions sync automatically with zero monthly plugin fees.
                </div>
              )}

              {wooError && (
                <div style={{ padding: '10px 14px', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#f87171', fontSize: '13px' }}>
                  {wooError}
                </div>
              )}
              {wooSuccess && (
                <div style={{ padding: '10px 14px', borderRadius: '8px', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.25)', color: '#34d399', fontSize: '13px' }}>
                  {wooSuccess}
                </div>
              )}

              <form onSubmit={handleConnectWoo} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label htmlFor="shopify-woo-store-url" style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#f3f4f6', marginBottom: '6px' }}>
                    WordPress Store URL
                  </label>
                  <input
                    id="shopify-woo-store-url"
                    type="url"
                    value={wooUrl}
                    onChange={e => setWooUrl(e.target.value)}
                    placeholder="https://mystore.com"
                    required
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '8px',
                      color: '#f3f4f6',
                      fontSize: '13px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="shopify-woo-consumer-key" style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#f3f4f6', marginBottom: '6px' }}>
                    Consumer Key (ck_...)
                  </label>
                  <input
                    id="shopify-woo-consumer-key"
                    type="text"
                    value={wooKey}
                    onChange={e => setWooKey(e.target.value)}
                    placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    required
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '8px',
                      color: '#f3f4f6',
                      fontSize: '13px',
                      fontFamily: 'monospace',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="shopify-woo-consumer-secret" style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#f3f4f6', marginBottom: '6px' }}>
                    Consumer Secret (cs_...)
                  </label>
                  <input
                    id="shopify-woo-consumer-secret"
                    type="password"
                    value={wooSecret}
                    onChange={e => setWooSecret(e.target.value)}
                    placeholder={workspace?.woocommerceConfig?.consumerSecretOnFile ? 'Saved on server. Leave blank to keep.' : 'cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '8px',
                      color: '#f3f4f6',
                      fontSize: '13px',
                      fontFamily: 'monospace',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    fontSize: '12px',
                    color: '#9ca3af',
                    lineHeight: 1.5
                  }}
                >
                  <strong style={{ color: '#f3f4f6' }}>How to generate WooCommerce API keys:</strong>
                  <ol style={{ margin: '6px 0 0', paddingLeft: '18px' }}>
                    <li>In your WordPress admin, go to <strong>WooCommerce &gt; Settings &gt; Advanced &gt; REST API</strong>.</li>
                    <li>Click <strong>Add key</strong>, set Description to <em>Jourvance</em>, and Permissions to <em>Read</em> (or Read/Write).</li>
                    <li>Click <strong>Generate API key</strong>, then copy and paste your Consumer Key and Consumer Secret above.</li>
                  </ol>
                </div>

                <button
                  type="submit"
                  disabled={wooLoading}
                  style={{
                    alignSelf: 'flex-start',
                    padding: '10px 18px',
                    borderRadius: '8px',
                    backgroundColor: '#38bdf8',
                    border: 'none',
                    color: '#0f172a',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: wooLoading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {wooLoading ? 'Testing Connection...' : isWooConnected ? 'Update WooCommerce Connection' : 'Connect WooCommerce Store'}
                </button>
              </form>
            </div>
          )}

          {/* TAB 3: Stripe & Direct Links */}
          {activeTab === 'stripe' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  padding: '16px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px'
                }}
              >
                <CreditCard size={20} style={{ color: '#10b981', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#f3f4f6' }}>
                    Direct Action Destinations (No Store Connection Required)
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#9ca3af', lineHeight: 1.5 }}>
                    If you use Stripe Payment Links, Calendly, Google Calendar, or an external checkout form, you do not need to connect an API or store plugin.
                  </p>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  padding: '16px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  fontSize: '13px',
                  color: '#cbd5e1',
                  lineHeight: 1.5
                }}
              >
                <div style={{ fontWeight: 600, color: '#f3f4f6' }}>How to link any landing page to your direct checkout:</div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', fontWeight: 700, fontSize: '11px' }}>1</span>
                  <span>Create a Payment Link in your <strong>Stripe Dashboard</strong> (e.g. <code>https://buy.stripe.com/...</code>) or get your <strong>Calendly booking link</strong>.</span>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', fontWeight: 700, fontSize: '11px' }}>2</span>
                  <span>Click any <strong>Landing Page</strong> card on your Jourvance canvas to open the Page Editor.</span>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', fontWeight: 700, fontSize: '11px' }}>3</span>
                  <span>Under <strong>Product and checkout</strong>, paste your URL into <strong>Direct destination checkout or booking URL</strong>.</span>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', fontWeight: 700, fontSize: '11px' }}>4</span>
                  <span>Save and test using <strong>Test Lead Flow</strong> to verify the visitor journey.</span>
                </div>
              </div>
            </div>
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
                    aria-label="Webhook event to simulate"
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
    </ModalDialog>
  );
};
