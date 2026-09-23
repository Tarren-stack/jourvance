import React, { useState } from 'react';
import {
  X, ShoppingBag, Zap, Copy, Check, RefreshCw, CheckCircle2,
  DollarSign, ArrowRight, ShieldCheck, Activity, Users, Send
} from 'lucide-react';
import { authHeaders } from '../../lib/firebase';
import type { JourneyNode, Workspace } from '../../types/journey';

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

  if (!isOpen) return null;

  const currentHost = typeof window !== 'undefined' ? window.location.origin : 'https://jourvance.com';
  const ordersWebhookUrl = `${currentHost}/api/webhooks/shopify/orders-create`;
  const customersWebhookUrl = `${currentHost}/api/webhooks/shopify/customers-create`;

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
      if (data?.success) {
        setOrdersSyncResult(`Synced ${data.ordersCount || 0} orders ($${(data.totalRevenue || 0).toFixed(2)} total attributed revenue).`);
        setTimeout(() => setOrdersSyncResult(null), 4000);
      }
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
      }
    } catch (err) {
      console.error('Order simulation failed:', err);
    } finally {
      setSimulating(false);
    }
  };

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
          maxWidth: '720px',
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
              <Activity size={13} /> Closed-Loop Attribution Engine
            </div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#FFFFFF' }}>
              Shopify Order Sync & Real-Time ROAS
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94A3B8', lineHeight: 1.5 }}>
              Connect real customer purchases on Shopify back to your visual funnel nodes with $0 third-party app cost.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: '4px', borderRadius: '8px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* SECTION 1: LIVE SHOPIFY WEBHOOK CONNECTORS */}
        <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '14px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34D399', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShoppingBag size={15} />
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#F8FAFC' }}>Native Shopify Webhooks</div>
                <div style={{ fontSize: '11px', color: '#94A3B8' }}>Add these in Shopify Admin → Settings → Notifications → Webhooks</div>
              </div>
            </div>

            <button
              onClick={handleSyncOrders}
              disabled={syncingOrders}
              style={{
                padding: '6px 12px',
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
                style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(0, 0, 0, 0.4)', color: '#CBD5E1', fontSize: '12px', fontFamily: 'monospace' }}
              />
              <button
                type="button"
                onClick={() => handleCopy(ordersWebhookUrl, 'orders')}
                style={{ padding: '8px 14px', borderRadius: '8px', background: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.3)', color: '#F472B6', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                {copiedUrl === 'orders' ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedUrl === 'orders' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Customers Webhook Box */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '4px' }}>
              Event: <span style={{ color: '#F8FAFC' }}>Customer creation (customers/create)</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                readOnly
                value={customersWebhookUrl}
                style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(0, 0, 0, 0.4)', color: '#CBD5E1', fontSize: '12px', fontFamily: 'monospace' }}
              />
              <button
                type="button"
                onClick={() => handleCopy(customersWebhookUrl, 'customers')}
                style={{ padding: '8px 14px', borderRadius: '8px', background: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.3)', color: '#F472B6', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                {copiedUrl === 'customers' ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedUrl === 'customers' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* SECTION 2: 1-CLICK TEST ORDER SIMULATOR */}
        <div style={{ backgroundColor: 'rgba(236, 72, 153, 0.04)', border: '1px solid rgba(236, 72, 153, 0.25)', borderRadius: '14px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'rgba(236, 72, 153, 0.2)', border: '1px solid rgba(236, 72, 153, 0.4)', color: '#F472B6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={15} />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#F8FAFC' }}>Interactive Order Simulator</div>
              <div style={{ fontSize: '11px', color: '#94A3B8' }}>Fire a test order to immediately see your canvas ROAS and CRM update in real time.</div>
            </div>
          </div>

          {simSuccess && (
            <div style={{ padding: '12px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.35)', color: '#34D399', fontSize: '12px' }}>
              <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={15} /> {simSuccess.message || 'Simulated Order Processed!'}
              </div>
              <div style={{ marginTop: '4px', color: '#CBD5E1', fontSize: '11px' }}>
                Attributed to Funnel Node: <strong>{simSuccess.attributedSlug || simSuccess.attributedNodeId}</strong> • Total: ${simSuccess.totalRevenue}
              </div>
            </div>
          )}

          <form onSubmit={handleSimulateOrder} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '4px' }}>
                  Target Funnel Page Node
                </label>
                <select
                  value={selectedNodeId}
                  onChange={e => setSelectedNodeId(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(0, 0, 0, 0.4)', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                >
                  {landingPages.map(lp => (
                    <option key={lp.id} value={lp.id} style={{ background: '#16161D' }}>
                      {(lp.data as any)?.label || 'Landing Page'} ({(lp.data as any)?.slug || lp.id.slice(0, 6)})
                    </option>
                  ))}
                  {landingPages.length === 0 && (
                    <option value="demo" style={{ background: '#16161D' }}>Demo Offer Funnel</option>
                  )}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '4px' }}>
                  Total Order Amount ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={simAmount}
                  onChange={e => setSimAmount(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(0, 0, 0, 0.4)', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '4px' }}>
                  Customer Name
                </label>
                <input
                  type="text"
                  value={simName}
                  onChange={e => setSimName(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(0, 0, 0, 0.4)', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', marginBottom: '4px' }}>
                  Customer Email
                </label>
                <input
                  type="email"
                  value={simEmail}
                  onChange={e => setSimEmail(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(0, 0, 0, 0.4)', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                />
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: '#E2E8F0', padding: '4px 0' }}>
              <input
                type="checkbox"
                checked={simBump}
                onChange={e => setSimBump(e.target.checked)}
                style={{ width: '15px', height: '15px', accentColor: '#EC4899', cursor: 'pointer' }}
              />
              <span>Include Order Bump Add-on (+$16.00 AOV Booster)</span>
            </label>

            <button
              type="submit"
              disabled={simulating}
              style={{
                marginTop: '4px',
                padding: '11px 18px',
                borderRadius: '10px',
                border: 'none',
                background: 'linear-gradient(135deg, #EC4899, #DB2777)',
                color: '#FFFFFF',
                fontSize: '13px',
                fontWeight: 700,
                cursor: simulating ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: '0 8px 20px rgba(236, 72, 153, 0.35)'
              }}
            >
              {simulating ? <RefreshCw size={15} className="animate-spin" /> : <Zap size={15} />}
              <span>{simulating ? 'Processing Simulated Webhook...' : '⚡ Simulate Shopify Order'}</span>
            </button>
          </form>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '9px 18px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#CBD5E1', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
