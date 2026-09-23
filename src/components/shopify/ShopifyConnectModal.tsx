import React, { useState } from 'react';
import { ShoppingBag, CheckCircle2, AlertCircle, X, ExternalLink, RefreshCw, Layers } from 'lucide-react';
import type { Workspace } from '../../types/journey';
import { connectShopifyStore, disconnectShopifyStore } from '../../lib/shopifyClient';

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
  const [storefrontToken, setStorefrontToken] = useState(workspace?.shopifyConfig?.storefrontAccessToken || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen || !workspace) return null;

  const isConnected = workspace.shopifyConfig?.status === 'connected' && !!workspace.shopifyConfig?.storeDomain;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeDomain.trim()) {
      setError('Please enter your Shopify store domain (e.g., yourbrand.myshopify.com)');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await connectShopifyStore(workspace.id, storeDomain.trim(), storefrontToken.trim());
      if (res.success && res.workspace) {
        onWorkspaceUpdated(res.workspace);
        setSuccessMsg(`Successfully connected to ${res.workspace.shopifyConfig?.storeDomain}`);
        setTimeout(() => {
          onClose();
        }, 1200);
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
          maxWidth: '520px',
          backgroundColor: '#121217',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden',
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
                Shopify Storefront Connect
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
                  Connected to {workspace.shopifyConfig?.storeDomain}
                </div>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                  Live catalog sync is active. Landing page buttons will link directly to your Shopify checkout permalinks.
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
              Link your Shopify store to pull product images, live pricing, and automatically generate direct-to-checkout cart permalinks with instant discount codes.
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
                Enter your `.myshopify.com` domain or primary store custom domain.
              </p>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#e5e7eb', marginBottom: '6px' }}>
                Storefront Access Token <span style={{ color: '#6b7280', fontWeight: 400 }}>(Optional)</span>
              </label>
              <input
                type="password"
                placeholder="shpat_xxxxxxxxxxxxxxxxxxxxx"
                value={storefrontToken}
                onChange={e => setStorefrontToken(e.target.value)}
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
                Needed only if your store catalog is private or password-protected.
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
