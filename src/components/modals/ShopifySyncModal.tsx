import React, { useState, useEffect } from 'react';
import {
  X, ShoppingBag, Zap, Copy, Check, RefreshCw, CheckCircle2,
  DollarSign, ArrowRight, ShieldCheck, Activity, Users, Send,
  Tag, AlertCircle, ExternalLink, Clock, Plus
} from 'lucide-react';
import { authHeaders } from '../../lib/firebase';
import type { JourneyNode, Workspace, ShopifyDiscountRule, ShopifyAbandonedCheckout } from '../../types/journey';

function WebhookUrl({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '4px' }}>
        Event: <span style={{ color: '#F8FAFC' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          readOnly
          value={value}
          style={{ flex: 1, padding: '7px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.4)', color: '#CBD5E1', fontSize: '11px', fontFamily: 'monospace' }}
        />
        <button
          type="button"
          onClick={onCopy}
          style={{ padding: '7px 12px', borderRadius: '8px', background: 'rgba(236,72,153,0.15)', border: '1px solid rgba(236,72,153,0.3)', color: '#F472B6', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  );
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  workspace: Workspace | null;
  nodes: JourneyNode[];
  onOrderSimulated?: (result: any) => void;
}

export const ShopifySyncModal: React.FC<Props> = ({
  isOpen,
  onClose,
  workspace,
  nodes,
  onOrderSimulated
}) => {
  const [activeTab, setActiveTab] = useState<'webhooks' | 'discounts' | 'abandoned'>('webhooks');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [ordersSyncResult, setOrdersSyncResult] = useState<string | null>(null);

  // Simulator state
  const landingPages = nodes.filter(n => n.type === 'landing-page');
  const [selectedNodeId, setSelectedNodeId] = useState<string>(landingPages[0]?.id || '');
  const [simName, setSimName] = useState('Elena Rostova');
  const [simEmail, setSimEmail] = useState('elena.rostova@example.com');
  const [simAmount, setSimAmount] = useState('62.00');
  const [simBump, setSimBump] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [simSuccess, setSimSuccess] = useState<any | null>(null);

  // Discounts state
  const [discounts, setDiscounts] = useState<ShopifyDiscountRule[]>([]);
  const [discCode, setDiscCode] = useState('');
  const [discType, setDiscType] = useState<'percentage' | 'fixed_amount'>('percentage');
  const [discValue, setDiscValue] = useState('20');
  const [discUnique, setDiscUnique] = useState(false);
  const [creatingDiscount, setCreatingDiscount] = useState(false);
  const [discountSuccess, setDiscountSuccess] = useState<string | null>(null);

  // Abandoned checkouts state
  const [checkouts, setCheckouts] = useState<ShopifyAbandonedCheckout[]>([]);
  const [loadingCheckouts, setLoadingCheckouts] = useState(false);
  const [simulatingCheckout, setSimulatingCheckout] = useState(false);
  const [simCheckoutSuccess, setSimCheckoutSuccess] = useState<string | null>(null);

  const currentHost = typeof window !== 'undefined' ? window.location.origin : 'https://jourvance.com';
  const ordersWebhookUrl = `${currentHost}/api/webhooks/shopify/orders-create`;
  const checkoutsWebhookUrl = `${currentHost}/api/webhooks/shopify/checkouts-create`;
  const fulfillmentsWebhookUrl = `${currentHost}/api/webhooks/shopify/fulfillments-create`;
  const cancelledWebhookUrl = `${currentHost}/api/webhooks/shopify/orders-cancelled`;
  const refundsWebhookUrl = `${currentHost}/api/webhooks/shopify/refunds-create`;
  const webhookSecretOnFile = Boolean(workspace?.shopifyConfig?.webhookSecretOnFile);

  useEffect(() => {
    if (!isOpen) return;
    loadDiscounts();
    loadAbandonedCheckouts();
  }, [isOpen, workspace?.id]);

  const loadDiscounts = async () => {
    try {
      const headers = await authHeaders();
      const wsId = workspace?.id || 'default';
      const res = await fetch(`/api/workspace/${wsId}/shopify/discounts`, { headers });
      const data = await res.json().catch(() => ({}));
      if (data?.success && Array.isArray(data.discounts)) {
        setDiscounts(data.discounts);
      }
    } catch (err) {
      console.error('Failed loading discounts:', err);
    }
  };

  const loadAbandonedCheckouts = async () => {
    setLoadingCheckouts(true);
    try {
      const headers = await authHeaders();
      const wsId = workspace?.id || 'default';
      const res = await fetch(`/api/workspace/${wsId}/shopify/abandoned-checkouts`, { headers });
      const data = await res.json().catch(() => ({}));
      if (data?.success && Array.isArray(data.checkouts)) {
        setCheckouts(data.checkouts);
      }
    } catch (err) {
      console.error('Failed loading checkouts:', err);
    } finally {
      setLoadingCheckouts(false);
    }
  };

  const handleCopy = (url: string, key: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(key);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleSyncOrders = async () => {
    setSyncingOrders(true);
    setOrdersSyncResult(null);
    try {
      const headers = await authHeaders();
      const wsId = workspace?.id || 'default';
      const res = await fetch(`/api/workspace/${wsId}/shopify/sync-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers }
      });
      const data = await res.json().catch(() => ({}));
      setOrdersSyncResult(data?.notice || (data?.storeReached
        ? `Imported ${data.imported || 0} orders from Shopify.`
        : 'Shopify was not reached. No orders were imported.'));
      setTimeout(() => setOrdersSyncResult(null), 4000);
    } catch (err) {
      console.error('Failed syncing orders:', err);
    } finally {
      setSyncingOrders(false);
    }
  };

  const handleSimulateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimulating(true);
    setSimSuccess(null);
    try {
      const headers = await authHeaders();
      const wsId = workspace?.id || 'default';
      const selectedNode = landingPages.find(n => n.id === selectedNodeId);
      const slug = (selectedNode?.data as any)?.slug || 'demo-offer';

      const res = await fetch(`/api/workspace/${wsId}/shopify/simulate-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          nodeId: selectedNodeId,
          slug,
          customerName: simName,
          customerEmail: simEmail,
          amount: parseFloat(simAmount) || 62.00,
          bumpIncluded: simBump
        })
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        setSimSuccess(data);
        if (onOrderSimulated) onOrderSimulated(data);
        loadAbandonedCheckouts();
      }
    } catch (err) {
      console.error('Order simulation failed:', err);
    } finally {
      setSimulating(false);
    }
  };

  const handleCreateDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!discCode.trim()) return;
    setCreatingDiscount(true);
    setDiscountSuccess(null);
    try {
      const headers = await authHeaders();
      const wsId = workspace?.id || 'default';
      const res = await fetch(`/api/workspace/${wsId}/shopify/create-discount`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          code: discCode.trim().toUpperCase(),
          discountType: discType,
          value: parseFloat(discValue) || 20,
          isUniquePerLead: discUnique
        })
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        setDiscountSuccess(data.discount?.syncedToLiveShopify
          ? `Code ${data.discount.code} is active in Shopify.`
          : `Code ${data.discount.code} is saved in Jourvance. Shopify was not updated because this workspace has no store token.`);
        loadDiscounts();
        setTimeout(() => setDiscountSuccess(null), 4000);
      }
    } catch (err) {
      console.error('Failed creating discount:', err);
    } finally {
      setCreatingDiscount(false);
    }
  };

  const handleSimulateAbandonedCheckout = async () => {
    setSimulatingCheckout(true);
    setSimCheckoutSuccess(null);
    try {
      const headers = await authHeaders();
      const wsId = workspace?.id || 'default';
      const res = await fetch(`/api/workspace/${wsId}/shopify/simulate-abandoned-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          customerEmail: `shopper_${Date.now().toString().slice(-4)}@venture.io`,
          customerName: 'Marcus Shopper',
          amount: 87.00
        })
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        setSimCheckoutSuccess(`Simulated checkout created for ${data.checkout.customerEmail}. Recovery drip enqueued.`);
        loadAbandonedCheckouts();
        setTimeout(() => setSimCheckoutSuccess(null), 4000);
      }
    } catch (err) {
      console.error('Failed simulating checkout:', err);
    } finally {
      setSimulatingCheckout(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 7, 13, 0.88)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
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
          maxWidth: '780px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#12141C',
          borderRadius: '20px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.7), 0 0 40px rgba(236, 72, 153, 0.1)',
          padding: '28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          color: '#F8FAFC'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '16px' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(236, 72, 153, 0.12)', border: '1px solid rgba(236, 72, 153, 0.25)', color: '#F472B6', padding: '3px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
              <Activity size={13} /> Shopify Full Integration Engine
            </div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#FFFFFF' }}>
              Shopify Automation & Attribution Hub
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94A3B8', lineHeight: 1.5 }}>
              Manage closed-loop webhooks, native Shopify discount rules, order tagging, and cart abandonment recovery.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: '4px', borderRadius: '8px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '8px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('webhooks')}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'webhooks' ? '#EC4899' : 'rgba(255, 255, 255, 0.05)',
              color: activeTab === 'webhooks' ? '#FFFFFF' : '#94A3B8',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Zap size={14} /> <span>Orders & Webhooks</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('discounts')}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'discounts' ? '#EC4899' : 'rgba(255, 255, 255, 0.05)',
              color: activeTab === 'discounts' ? '#FFFFFF' : '#94A3B8',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Tag size={14} /> <span>Discounts & Tagging</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('abandoned')}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: 'none',
              background: activeTab === 'abandoned' ? '#EC4899' : 'rgba(255, 255, 255, 0.05)',
              color: activeTab === 'abandoned' ? '#FFFFFF' : '#94A3B8',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <ShoppingBag size={14} /> <span>Abandoned Checkouts ({checkouts.length})</span>
          </button>
        </div>

        {/* TAB 1: WEBHOOKS & SIMULATOR */}
        {activeTab === 'webhooks' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '14px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34D399', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ShoppingBag size={15} />
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#F8FAFC' }}>Native Shopify Webhook Endpoints</div>
                    <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                      {webhookSecretOnFile
                        ? 'Shopify checks these with the app API secret saved for this store.'
                        : 'These stay refused until you save the app API secret on the connect screen.'}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleSyncOrders}
                  disabled={syncingOrders}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#E2E8F0',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: syncingOrders ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <RefreshCw size={12} className={syncingOrders ? 'animate-spin' : ''} />
                  <span>{syncingOrders ? 'Syncing...' : 'Sync Recent Orders'}</span>
                </button>
              </div>

              {ordersSyncResult && (
                <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', color: '#34D399', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={14} /> <span>{ordersSyncResult}</span>
                </div>
              )}

              {/* Orders Webhook Box */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '4px' }}>
                  Event: <span style={{ color: '#F8FAFC' }}>Order creation (orders/create)</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    readOnly
                    value={ordersWebhookUrl}
                    style={{ flex: 1, padding: '7px 10px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(0, 0, 0, 0.4)', color: '#CBD5E1', fontSize: '11px', fontFamily: 'monospace' }}
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy(ordersWebhookUrl, 'orders')}
                    style={{ padding: '7px 12px', borderRadius: '8px', background: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.3)', color: '#F472B6', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    {copiedUrl === 'orders' ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copiedUrl === 'orders' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <WebhookUrl label="Fulfillment creation (fulfillments/create)" value={fulfillmentsWebhookUrl} copied={copiedUrl === 'fulfillments'} onCopy={() => handleCopy(fulfillmentsWebhookUrl, 'fulfillments')} />
              <WebhookUrl label="Order cancelled (orders/cancelled)" value={cancelledWebhookUrl} copied={copiedUrl === 'cancelled'} onCopy={() => handleCopy(cancelledWebhookUrl, 'cancelled')} />
              <WebhookUrl label="Refund creation (refunds/create)" value={refundsWebhookUrl} copied={copiedUrl === 'refunds'} onCopy={() => handleCopy(refundsWebhookUrl, 'refunds')} />

              {/* Checkout Webhook Box */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '4px' }}>
                  Event: <span style={{ color: '#F8FAFC' }}>Checkout creation / update (checkouts/create)</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    readOnly
                    value={checkoutsWebhookUrl}
                    style={{ flex: 1, padding: '7px 10px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(0, 0, 0, 0.4)', color: '#CBD5E1', fontSize: '11px', fontFamily: 'monospace' }}
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy(checkoutsWebhookUrl, 'checkouts')}
                    style={{ padding: '7px 12px', borderRadius: '8px', background: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.3)', color: '#F472B6', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    {copiedUrl === 'checkouts' ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copiedUrl === 'checkouts' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>


          </div>
        )}

        {/* TAB 2: DISCOUNTS & ORDER TAGGING */}
        {activeTab === 'discounts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Automatic Order Tagging Card */}
            <div style={{ padding: '14px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <ShieldCheck size={20} style={{ color: '#34D399', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#34D399' }}>Order tags stay on the Jourvance order</div>
                <div style={{ fontSize: '12px', color: '#CBD5E1', marginTop: '3px', lineHeight: 1.5 }}>
                  A real Shopify order webhook stores these tags on the order record here. They are not written back to Shopify Admin:
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '9999px', background: 'rgba(255, 255, 255, 0.1)', fontSize: '11px', fontFamily: 'monospace', color: '#FFFFFF' }}>Jourvance Funnel</span>
                    <span style={{ padding: '2px 8px', borderRadius: '9999px', background: 'rgba(255, 255, 255, 0.1)', fontSize: '11px', fontFamily: 'monospace', color: '#FFFFFF' }}>Funnel: [slug]</span>
                    <span style={{ padding: '2px 8px', borderRadius: '9999px', background: 'rgba(255, 255, 255, 0.1)', fontSize: '11px', fontFamily: 'monospace', color: '#FFFFFF' }}>Order-Bump-Accepted</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Discount Provisioning Form */}
            <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '14px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.3)', color: '#F472B6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Tag size={15} />
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#F8FAFC' }}>Native Shopify Discount Provisioning</div>
                  <div style={{ fontSize: '11px', color: '#94A3B8' }}>Saves the code here, and sends it to Shopify when this store’s token can write price rules.</div>
                </div>
              </div>

              {discountSuccess && (
                <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', color: '#34D399', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle2 size={14} /> <span>{discountSuccess}</span>
                </div>
              )}

              <form onSubmit={handleCreateDiscount} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '3px' }}>
                      Discount Code
                    </label>
                    <input
                      type="text"
                      placeholder="Code you want at checkout"
                      value={discCode}
                      onChange={e => setDiscCode(e.target.value.toUpperCase())}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(0, 0, 0, 0.4)', color: '#FFFFFF', fontSize: '12px', fontFamily: 'monospace', outline: 'none' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '3px' }}>
                      Type
                    </label>
                    <select
                      value={discType}
                      onChange={e => setDiscType(e.target.value as any)}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(0, 0, 0, 0.4)', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                    >
                      <option value="percentage">Percentage (%)</option>
                      <option value="fixed_amount">Fixed Amount ($)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '3px' }}>
                      Value ({discType === 'percentage' ? '%' : '$'})
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={discValue}
                      onChange={e => setDiscValue(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(0, 0, 0, 0.4)', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                    />
                  </div>
                </div>

                {/* Architecture Choice: Shared Standard Code vs Unique 1-Time per Lead */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: '8px', background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#F8FAFC' }}>
                      {discUnique ? 'Mode: Unique 1-Time Code per Lead' : 'Mode: Shared Standard Promo Code (Recommended)'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>
                      {discUnique
                        ? 'Generates single-use codes (usage_limit: 1) to eliminate coupon scraping on Honey & RetailMeNot.'
                        : 'Universal code for all ad funnels, emails, and permalinks with zero setup friction.'}
                    </div>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={discUnique}
                      onChange={e => setDiscUnique(e.target.checked)}
                      style={{ width: '15px', height: '15px', accentColor: '#EC4899', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '11px', color: '#CBD5E1' }}>1-Time Only</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={creatingDiscount}
                  style={{
                    padding: '9px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #EC4899, #DB2777)',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: creatingDiscount ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  {creatingDiscount ? <RefreshCw size={13} className="animate-spin" /> : <Tag size={13} />}
                  <span>{creatingDiscount ? 'Pushing to Shopify...' : '⚡ Push Discount to Shopify Admin'}</span>
                </button>
              </form>
            </div>

            {/* Active Provisioned Discounts Table */}
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '8px' }}>
                Active Provisioned Discounts ({discounts.length})
              </div>
              <div style={{ border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255, 255, 255, 0.03)', textAlign: 'left', color: '#94A3B8' }}>
                      <th style={{ padding: '8px 12px' }}>Code</th>
                      <th style={{ padding: '8px 12px' }}>Discount</th>
                      <th style={{ padding: '8px 12px' }}>Usage Mode</th>
                      <th style={{ padding: '8px 12px' }}>Shopify Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discounts.map(d => (
                      <tr key={d.id} style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700, fontFamily: 'monospace', color: '#F472B6' }}>{d.code}</td>
                        <td style={{ padding: '8px 12px', color: '#F8FAFC' }}>
                          {d.discountType === 'percentage' ? `${d.value}% Off` : `$${d.value.toFixed(2)} Off`}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#94A3B8' }}>
                          {d.isUniquePerLead ? '1-Time Single Use' : 'Standard Shared'}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', background: d.syncedToLiveShopify ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.06)', color: d.syncedToLiveShopify ? '#34D399' : '#94A3B8' }}>
                            <Check size={11} /> {d.syncedToLiveShopify ? 'In Shopify' : 'Saved here only'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: ABANDONED CHECKOUTS */}
        {activeTab === 'abandoned' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#F8FAFC' }}>Shopify Abandoned Checkouts</div>
                <div style={{ fontSize: '11px', color: '#94A3B8' }}>Shoppers who started checkout on Shopify but dropped off before paying.</div>
              </div>

            </div>

            {/* Checkouts Table */}
            <div style={{ border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: 'rgba(255, 255, 255, 0.03)', textAlign: 'left', color: '#94A3B8' }}>
                    <th style={{ padding: '8px 12px' }}>Customer Email</th>
                    <th style={{ padding: '8px 12px' }}>Cart Value</th>
                    <th style={{ padding: '8px 12px' }}>Items</th>
                    <th style={{ padding: '8px 12px' }}>Recovery Status</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {checkouts.map(c => (
                    <tr key={c.id} style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <td style={{ padding: '8px 12px', color: '#F8FAFC', fontWeight: 600 }}>
                        {c.customerEmail}
                        <div style={{ fontSize: '10px', color: '#94A3B8' }}>{new Date(c.abandonedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      </td>
                      <td style={{ padding: '8px 12px', color: '#34D399', fontWeight: 700 }}>
                        ${c.totalPrice.toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#CBD5E1', maxWidth: '180px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.lineItems.map(li => li.title).join(', ') || '1 Product'}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {c.recoveryStatus === 'recovered' ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', background: 'rgba(16, 185, 129, 0.15)', color: '#34D399' }}>
                            <CheckCircle2 size={11} /> Recovered (${c.totalPrice.toFixed(2)})
                          </span>
                        ) : c.recoveryStatus === 'email_sent' ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', background: 'rgba(59, 130, 246, 0.15)', color: '#60A5FA' }}>
                            <Send size={11} /> Email Sent
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', background: 'rgba(234, 179, 8, 0.15)', color: '#FACC15' }}>
                            <Clock size={11} /> Pending (45m Window)
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <a
                          href={c.abandonedCheckoutUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            background: 'rgba(255, 255, 255, 0.08)',
                            color: '#F8FAFC',
                            fontSize: '11px',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <span>Checkout</span>
                          <ExternalLink size={10} />
                        </a>
                      </td>
                    </tr>
                  ))}
                  {checkouts.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#94A3B8' }}>
                        No abandoned checkouts recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '8px 18px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#CBD5E1', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
