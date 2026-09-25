import React, { useEffect, useState } from 'react';
import { ShoppingBag, CheckCircle2, AlertCircle, X, RefreshCw, Layers } from 'lucide-react';
import type { Workspace } from '../../types/journey';
import { connectShopifyStore, disconnectShopifyStore, fetchShopifySignals, registerShopifyWebhooks } from '../../lib/shopifyClient';

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

  useEffect(() => {
    if (!isOpen || !workspace || workspace.shopifyConfig?.status !== 'connected') {
      setSignals(null);
      return;
    }
    let gone = false;
    fetchShopifySignals(workspace.id).then((row) => {
      if (gone) return;
      if (!row.success) setSignalError(row.error || 'Store signals could not be loaded.');
      else {
        setSignalError('');
        setSignals(row);
      }
    });
    return () => { gone = true; };
  }, [isOpen, workspace]);

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
        setSuccessMsg('Store disconnected.');
      }
    } finally {
      setLoading(false);
    }
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
          maxWidth: '640px',
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
                Connect a Shopify store
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

        {/* Content */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6' }}>Shopify webhooks</div>
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
                  <button type="button" onClick={registerWebhooks} disabled={loading} style={{ marginTop: '10px', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(16,185,129,0.4)', background: 'transparent', color: '#34d399', cursor: 'pointer' }}>
                    Register these webhooks
                  </button>
                )}
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6' }}>Customer events pixel</div>
                <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#9ca3af', lineHeight: 1.5 }}>
                  Paste this under Customer events. It sends product views, add to cart, collection views, search, and checkout starts. It does not send an email address.
                </p>
                <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#d1d5db' }}>
                  {signals?.lastEventAt ? `Last event ${signals.lastEventAt}. ${signals.todayCount || 0} stored today.` : `No pixel or page event stored yet. ${signals?.todayCount || 0} stored today.`}
                </p>
                {signals?.pixelSnippet && (
                  <textarea readOnly value={signals.pixelSnippet} aria-label="Customer events pixel" style={{ width: '100%', minHeight: '120px', marginTop: '8px', boxSizing: 'border-box', background: '#0b0b10', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '8px', fontSize: '11px' }} />
                )}
              </div>
              {signals?.restockSnippet && (
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6' }}>Back in stock form</div>
                  <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#9ca3af', lineHeight: 1.5 }}>
                    Paste this on the Shopify product template. It records a request for that variant. It does not email anyone by itself.
                  </p>
                  <textarea readOnly value={signals.restockSnippet} aria-label="Back in stock form" style={{ width: '100%', minHeight: '100px', marginTop: '8px', boxSizing: 'border-box', background: '#0b0b10', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '8px', fontSize: '11px' }} />
                </div>
              )}
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
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="e.g. yourbrand.myshopify.com"
                  value={storeDomain}
                  onChange={e => setStoreDomain(e.target.value)}
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
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#6b7280' }}>
                Use the .myshopify.com domain from that store’s admin.
              </p>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#e5e7eb', marginBottom: '6px' }} htmlFor="shopify-admin-token">
                Admin API access token
              </label>
              <input
                id="shopify-admin-token"
                type="password"
                autoComplete="off"
                placeholder={tokenOnFile ? 'Token saved. Paste a new one to replace it.' : 'shpat_…'}
                value={adminToken}
                onChange={e => setAdminToken(e.target.value)}
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
                <li>Install the app and reveal the Admin API access token. It starts with shpat_.</li>
                <li>Paste it here. Shopify checks it before this store is marked connected.</li>
              </ol>
              <p style={{ margin: '6px 0 0', fontSize: '11px' }}>
                <a href="https://help.shopify.com/en/manual/apps/app-types/custom-apps" target="_blank" rel="noreferrer" style={{ color: '#34d399' }}>
                  Shopify’s custom app steps
                </a>
              </p>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#e5e7eb', marginBottom: '6px' }} htmlFor="shopify-webhook-secret">
                App API secret
              </label>
              <input
                id="shopify-webhook-secret"
                type="password"
                autoComplete="off"
                placeholder={secretOnFile ? 'Secret saved. Paste a new one to replace it.' : 'Used to verify order webhooks'}
                value={webhookSecret}
                onChange={e => setWebhookSecret(e.target.value)}
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
                In the same custom app, open API credentials and copy the API secret key. Shopify signs order and checkout webhooks with it. Jourvance refuses those webhooks until this secret is saved. Leave this blank to keep the secret already on file.
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
        </div>
      </div>
    </div>
  );
};
