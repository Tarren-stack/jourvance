import React, { useEffect, useState } from 'react';
import {
  X,
  Crown,
  AlertTriangle,
  ShoppingBag,
  ShoppingCart,
  Mail,
  Phone,
  Tag,
  Plus,
  Play,
  Pause,
  XCircle,
  Copy,
  Check,
  Send,
  Clock,
  Sparkles,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  RotateCcw
} from 'lucide-react';
import { authHeaders } from '../../lib/firebase';

interface OrderLineItem {
  title: string;
  quantity: number;
  price: number;
  imageUrl?: string;
}

interface CustomerOrder {
  id: string;
  orderNumber: string;
  totalPrice: number;
  currency: string;
  financialStatus: string;
  fulfillmentStatus: string;
  createdAt: string;
  lineItems: OrderLineItem[];
}

interface CustomerCheckout {
  id: string;
  totalPrice: number;
  currency: string;
  abandonedAt: string;
  recoveryStatus: string;
  abandonedCheckoutUrl?: string;
  lineItems: OrderLineItem[];
}

interface CustomerEnrollment {
  id: string;
  sequenceId: string;
  sequenceName: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  currentStepIndex: number;
  totalSteps: number;
  enrolledAt: string;
  nextStepDueAt?: string;
  history?: Array<{ stepIndex: number; sentAt: string; subject?: string }>;
}

interface TimelineItem {
  kind: 'joined' | 'order' | 'checkout' | 'automation' | 'touch' | 'event';
  title: string;
  description: string;
  at: string;
  total?: number;
  orderId?: string;
  recovered?: boolean;
}

interface ContactDetails {
  email: string;
  name: string;
  phone?: string;
  status: string;
  tags: string[];
  totalSpent?: number;
  ordersCount?: number;
  joinedAt: string;
  lastOrderAt?: string | null;
  rfmSegment?: string;
  rfmTier?: string;
  rfmBadge?: string;
  rfmColor?: string;
  recencyDays?: number | null;
  isVip?: boolean;
  isAtRisk?: boolean;
  isLapsed?: boolean;
}

interface StrategicAdvice {
  title: string;
  actionText: string;
  suggestedTemplate: string;
  body: string;
}

interface CustomerProfileDrawerProps {
  customerEmail: string | null;
  onClose: () => void;
  onDraftCampaign?: (contact: ContactDetails, templateKey: string) => void;
  onTagsUpdated?: (email: string, updatedTags: string[]) => void;
}

export const CustomerProfileDrawer: React.FC<CustomerProfileDrawerProps> = ({
  customerEmail,
  onClose,
  onDraftCampaign,
  onTagsUpdated
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contact, setContact] = useState<ContactDetails | null>(null);
  const [strategicAdvice, setStrategicAdvice] = useState<StrategicAdvice | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [checkouts, setCheckouts] = useState<CustomerCheckout[]>([]);
  const [enrollments, setEnrollments] = useState<CustomerEnrollment[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [activeTab, setActiveTab] = useState<'orders' | 'flows' | 'timeline'>('orders');

  // Tag editor state
  const [newTagInput, setNewTagInput] = useState('');
  const [savingTags, setSavingTags] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  // Quick enroll state
  const [availableSequences, setAvailableSequences] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedEnrollSeqId, setSelectedEnrollSeqId] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    if (!customerEmail) return;

    let mounted = true;
    setLoading(true);
    setError(null);

    const loadData = async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch(`/api/email/contact-details?email=${encodeURIComponent(customerEmail)}`, {
          headers
        });
        const data = await res.json();

        if (!mounted) return;

        if (res.ok && data.success) {
          setContact(data.contact);
          setStrategicAdvice(data.strategicAdvice);
          setOrders(data.orders || []);
          setCheckouts(data.checkouts || []);
          setEnrollments(data.enrollments || []);
          setTimeline(data.timeline || []);
        } else {
          setError(data.error || 'Failed to load customer profile.');
        }

        // Also fetch sequences for manual enrollment dropdown
        const seqRes = await fetch('/api/drips/sequences', { headers });
        if (seqRes.ok) {
          const seqData = await seqRes.json();
          if (mounted && Array.isArray(seqData.sequences)) {
            setAvailableSequences(seqData.sequences.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));
            if (seqData.sequences.length > 0) {
              setSelectedEnrollSeqId(seqData.sequences[0].id);
            }
          }
        }
      } catch (err) {
        if (mounted) {
          setError('Network error loading customer profile.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadData();

    return () => {
      mounted = false;
    };
  }, [customerEmail]);

  if (!customerEmail) return null;

  const handleCopyEmail = () => {
    if (!contact?.email) return;
    navigator.clipboard.writeText(contact.email);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const handleAddTag = async () => {
    if (!contact || !newTagInput.trim() || savingTags) return;
    const tagClean = newTagInput.trim();
    if (contact.tags.includes(tagClean)) {
      setNewTagInput('');
      return;
    }

    const updatedTags = [...contact.tags, tagClean];
    setSavingTags(true);

    try {
      const headers = await authHeaders();
      const res = await fetch('/api/email/contact-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ email: contact.email, tags: updatedTags })
      });

      if (res.ok) {
        setContact({ ...contact, tags: updatedTags });
        setNewTagInput('');
        onTagsUpdated?.(contact.email, updatedTags);
      }
    } finally {
      setSavingTags(false);
    }
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!contact || savingTags) return;
    const updatedTags = contact.tags.filter(t => t !== tagToRemove);
    setSavingTags(true);

    try {
      const headers = await authHeaders();
      const res = await fetch('/api/email/contact-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ email: contact.email, tags: updatedTags })
      });

      if (res.ok) {
        setContact({ ...contact, tags: updatedTags });
        onTagsUpdated?.(contact.email, updatedTags);
      }
    } finally {
      setSavingTags(false);
    }
  };

  const handleToggleEnrollment = async (enrollmentId: string, action: 'pause' | 'resume' | 'cancel') => {
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/drips/enrollment-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ enrollmentId, action })
      });

      if (res.ok) {
        setEnrollments(prev =>
          prev.map(enr => {
            if (enr.id === enrollmentId) {
              const nextStatus = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'cancelled';
              return { ...enr, status: nextStatus };
            }
            return enr;
          })
        );
      }
    } catch {
      // silently handle
    }
  };

  const handleManualEnroll = async () => {
    if (!contact || !selectedEnrollSeqId || enrolling) return;
    setEnrolling(true);

    try {
      const headers = await authHeaders();
      const res = await fetch('/api/drips/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          sequenceId: selectedEnrollSeqId,
          customerEmail: contact.email,
          customerName: contact.name,
          sourceSlug: 'crm-drawer'
        })
      });

      const data = await res.json();
      if (res.ok && data.success && data.enrollment) {
        const seq = availableSequences.find(s => s.id === selectedEnrollSeqId);
        const newEnrollment: CustomerEnrollment = {
          ...data.enrollment,
          sequenceName: seq?.name || selectedEnrollSeqId,
          totalSteps: 3
        };
        setEnrollments(prev => [newEnrollment, ...prev]);
      }
    } finally {
      setEnrolling(false);
    }
  };

  const getInitials = (name?: string, email?: string) => {
    if (name && name.trim()) {
      const parts = name.trim().split(' ');
      if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      return name.slice(0, 2).toUpperCase();
    }
    if (email) return email.slice(0, 2).toUpperCase();
    return 'CU';
  };

  const aov = contact && (contact.ordersCount || 0) > 0
    ? (contact.totalSpent || 0) / (contact.ordersCount || 1)
    : 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        justifyContent: 'flex-end',
        animation: 'fadeIn 0.2s ease-out'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '640px',
          height: '100%',
          backgroundColor: '#111827',
          borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          color: '#f8fafc',
          overflow: 'hidden'
        }}
      >
        {/* Drawer Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#0f172a'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '50%',
                background: contact?.rfmTier === 'whale'
                  ? 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)'
                  : 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '16px',
                color: '#ffffff',
                boxShadow: contact?.rfmTier === 'whale'
                  ? '0 0 16px rgba(168, 85, 247, 0.4)'
                  : 'none'
              }}
            >
              {getInitials(contact?.name, customerEmail)}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#ffffff' }}>
                  {contact?.name || customerEmail.split('@')[0]}
                </h3>
                {contact?.rfmBadge && (
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '11px',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      backgroundColor: contact.rfmTier === 'whale' ? 'rgba(168, 85, 247, 0.2)' :
                                       contact.rfmTier === 'gold' ? 'rgba(234, 179, 8, 0.2)' :
                                       contact.rfmTier === 'silver' ? 'rgba(6, 182, 212, 0.2)' :
                                       contact.rfmTier === 'at_risk' ? 'rgba(245, 158, 11, 0.2)' :
                                       contact.rfmTier === 'lapsed' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                      color: contact.rfmColor || (contact.rfmTier === 'whale' ? '#c084fc' : '#94a3b8'),
                      border: `1px solid ${contact.rfmTier === 'whale' ? 'rgba(168, 85, 247, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`
                    }}
                  >
                    {contact.rfmTier === 'whale' && <Crown size={11} />}
                    {contact.rfmTier === 'at_risk' && <AlertTriangle size={11} />}
                    {contact.rfmBadge}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '3px' }}>
                <span style={{ fontSize: '13px', color: '#94a3b8' }}>{customerEmail}</span>
                <button
                  type="button"
                  onClick={handleCopyEmail}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: copiedEmail ? '#10b981' : '#64748b',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px'
                  }}
                  title="Copy customer email"
                >
                  {copiedEmail ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedEmail ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              padding: '8px',
              color: '#94a3b8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s'
            }}
            aria-label="Close drawer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Drawer Body (Scrollable) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
              <div style={{ fontSize: '14px', fontWeight: 600 }}>Loading customer 360 profile…</div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>Fetching Shopify order history and automation timeline</div>
            </div>
          ) : error ? (
            <div style={{ padding: '20px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '12px', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5' }}>
              <div style={{ fontWeight: 600, fontSize: '14px' }}>Could not load customer</div>
              <div style={{ fontSize: '12px', marginTop: '4px' }}>{error}</div>
            </div>
          ) : contact ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Strategic RFM Intelligence Card */}
              {strategicAdvice && (
                <div
                  style={{
                    padding: '16px 20px',
                    borderRadius: '14px',
                    backgroundColor: contact.rfmTier === 'whale' ? 'rgba(168, 85, 247, 0.1)' :
                                     contact.isAtRisk ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                    border: `1px solid ${contact.rfmTier === 'whale' ? 'rgba(168, 85, 247, 0.35)' : contact.isAtRisk ? 'rgba(245, 158, 11, 0.35)' : 'rgba(255, 255, 255, 0.08)'}`,
                    position: 'relative'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Sparkles size={16} color={contact.rfmTier === 'whale' ? '#c084fc' : contact.isAtRisk ? '#fbbf24' : '#ec4899'} />
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>
                        {strategicAdvice.title}
                      </span>
                    </div>

                    {onDraftCampaign && (
                      <button
                        type="button"
                        onClick={() => onDraftCampaign(contact, strategicAdvice.suggestedTemplate)}
                        style={{
                          padding: '6px 14px',
                          borderRadius: '8px',
                          background: contact.rfmTier === 'whale'
                            ? 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)'
                            : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                          border: 'none',
                          color: '#ffffff',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                        }}
                      >
                        <Send size={12} />
                        <span>{strategicAdvice.actionText}</span>
                      </button>
                    )}
                  </div>

                  <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#cbd5e1', lineHeight: 1.5 }}>
                    {strategicAdvice.body}
                  </p>
                </div>
              )}

              {/* 4-Card Key Metrics Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                <div style={{ backgroundColor: '#1e293b', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Lifetime Spend</div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#10b981', marginTop: '2px' }}>
                    ${(contact.totalSpent || 0).toFixed(2)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Total revenue</div>
                </div>

                <div style={{ backgroundColor: '#1e293b', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Orders</div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#ffffff', marginTop: '2px' }}>
                    {contact.ordersCount || 0}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                    ${aov.toFixed(2)} AOV
                  </div>
                </div>

                <div style={{ backgroundColor: '#1e293b', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Recency</div>
                  <div style={{
                    fontSize: '18px',
                    fontWeight: 800,
                    marginTop: '2px',
                    color: contact.isLapsed ? '#ef4444' : contact.isAtRisk ? '#f59e0b' : '#38bdf8'
                  }}>
                    {contact.recencyDays != null ? `${contact.recencyDays}d` : 'None'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    {contact.recencyDays != null ? 'Since last order' : 'No purchases yet'}
                  </div>
                </div>

                <div style={{ backgroundColor: '#1e293b', padding: '12px 14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Marketing</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: contact.status === 'active' ? '#10b981' : '#f59e0b', marginTop: '6px' }}>
                    {contact.status === 'active' ? 'Subscribed' : contact.status}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Email & SMS</div>
                </div>
              </div>

              {/* Tag Management Bar */}
              <div style={{ backgroundColor: '#1e293b', padding: '14px 16px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: '#cbd5e1' }}>
                    <Tag size={13} color="#94a3b8" />
                    <span>Customer Tags</span>
                  </div>
                  {savingTags && <span style={{ fontSize: '11px', color: '#94a3b8' }}>Saving…</span>}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                  {contact.tags.map(tag => (
                    <span
                      key={tag}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        fontSize: '11px',
                        color: '#e2e8f0',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#64748b',
                          cursor: 'pointer',
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center'
                        }}
                        title={`Remove tag ${tag}`}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  {contact.tags.length === 0 && (
                    <span style={{ fontSize: '11px', color: '#64748b' }}>No custom tags assigned</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Add tag (e.g. VIP-Sample, Sensitive-Skin)..."
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddTag();
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#ffffff',
                      fontSize: '12px',
                      outline: 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddTag}
                    disabled={!newTagInput.trim() || savingTags}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      border: 'none',
                      color: '#ffffff',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: newTagInput.trim() ? 'pointer' : 'default',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Plus size={12} />
                    <span>Add</span>
                  </button>
                </div>
              </div>

              {/* Tab Navigation */}
              <div style={{ display: 'flex', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', gap: '16px' }}>
                <button
                  type="button"
                  onClick={() => setActiveTab('orders')}
                  style={{
                    padding: '8px 4px',
                    border: 'none',
                    borderBottom: activeTab === 'orders' ? '2px solid #ec4899' : '2px solid transparent',
                    backgroundColor: 'transparent',
                    color: activeTab === 'orders' ? '#ffffff' : '#94a3b8',
                    fontWeight: activeTab === 'orders' ? 700 : 500,
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <ShoppingBag size={14} />
                  <span>Orders & Bag ({orders.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('flows')}
                  style={{
                    padding: '8px 4px',
                    border: 'none',
                    borderBottom: activeTab === 'flows' ? '2px solid #ec4899' : '2px solid transparent',
                    backgroundColor: 'transparent',
                    color: activeTab === 'flows' ? '#ffffff' : '#94a3b8',
                    fontWeight: activeTab === 'flows' ? 700 : 500,
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Clock size={14} />
                  <span>Automations ({enrollments.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('timeline')}
                  style={{
                    padding: '8px 4px',
                    border: 'none',
                    borderBottom: activeTab === 'timeline' ? '2px solid #ec4899' : '2px solid transparent',
                    backgroundColor: 'transparent',
                    color: activeTab === 'timeline' ? '#ffffff' : '#94a3b8',
                    fontWeight: activeTab === 'timeline' ? 700 : 500,
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <RotateCcw size={14} />
                  <span>Timeline ({timeline.length})</span>
                </button>
              </div>

              {/* Tab Content: Orders & Bag */}
              {activeTab === 'orders' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* Abandoned Checkouts Callout */}
                  {checkouts.length > 0 && (
                    <div style={{ padding: '14px 16px', borderRadius: '10px', backgroundColor: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 700, color: '#fbbf24' }}>
                          <ShoppingCart size={15} />
                          <span>Abandoned Cart Detected</span>
                        </div>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                          {new Date(checkouts[0].abandonedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '6px' }}>
                        Total: <strong>${checkouts[0].totalPrice.toFixed(2)}</strong> • Status: {checkouts[0].recoveryStatus}
                      </div>
                      {checkouts[0].abandonedCheckoutUrl && (
                        <a
                          href={checkouts[0].abandonedCheckoutUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '11px',
                            color: '#38bdf8',
                            marginTop: '8px',
                            textDecoration: 'none'
                          }}
                        >
                          <span>Open Recovered Shopify Checkout</span>
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  )}

                  {/* Orders List */}
                  {orders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>
                      <ShoppingBag size={28} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                      <div style={{ fontSize: '13px' }}>No Shopify orders placed yet</div>
                      <div style={{ fontSize: '11px', marginTop: '2px' }}>This customer is currently a top-of-funnel lead</div>
                    </div>
                  ) : (
                    orders.map(order => (
                      <div
                        key={order.id}
                        style={{
                          backgroundColor: '#1e293b',
                          borderRadius: '10px',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          padding: '14px 16px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: 700, fontSize: '14px', color: '#ffffff' }}>
                              #{order.orderNumber}
                            </span>
                            <span
                              style={{
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                backgroundColor: order.financialStatus === 'paid' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                color: order.financialStatus === 'paid' ? '#34d399' : '#fbbf24'
                              }}
                            >
                              {order.financialStatus}
                            </span>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: '14px', fontWeight: 800, color: '#10b981' }}>
                              ${order.totalPrice.toFixed(2)}
                            </span>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                              {new Date(order.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>

                        {order.lineItems.length > 0 && (
                          <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.04)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {order.lineItems.map((item, idx) => (
                              <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                                <span style={{ color: '#cbd5e1' }}>
                                  {item.title} <span style={{ color: '#64748b' }}>× {item.quantity}</span>
                                </span>
                                <span style={{ color: '#94a3b8' }}>${item.price.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab Content: Automations */}
              {activeTab === 'flows' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* Manual Enroll Picker */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '12px', backgroundColor: '#1e293b', borderRadius: '10px' }}>
                    <select
                      value={selectedEnrollSeqId}
                      onChange={(e) => setSelectedEnrollSeqId(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#ffffff',
                        fontSize: '12px'
                      }}
                    >
                      {availableSequences.map(seq => (
                        <option key={seq.id} value={seq.id}>{seq.name}</option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={handleManualEnroll}
                      disabled={enrolling || !selectedEnrollSeqId}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '6px',
                        backgroundColor: '#6366f1',
                        border: 'none',
                        color: '#ffffff',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <Plus size={12} />
                      <span>{enrolling ? 'Enrolling…' : 'Enroll in Flow'}</span>
                    </button>
                  </div>

                  {/* Enrollments List */}
                  {enrollments.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>
                      <Clock size={28} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                      <div style={{ fontSize: '13px' }}>Not actively enrolled in any automated sequences</div>
                      <div style={{ fontSize: '11px', marginTop: '2px' }}>Use the dropdown above to enroll in a welcome or winback flow</div>
                    </div>
                  ) : (
                    enrollments.map(enr => (
                      <div
                        key={enr.id}
                        style={{
                          backgroundColor: '#1e293b',
                          borderRadius: '10px',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          padding: '14px 16px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '13px', color: '#ffffff' }}>
                              {enr.sequenceName}
                            </div>
                            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                              Enrolled {new Date(enr.enrolledAt).toLocaleDateString()} • Step {enr.currentStepIndex + 1} of {enr.totalSteps}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                backgroundColor: enr.status === 'active' ? 'rgba(16, 185, 129, 0.15)' :
                                                 enr.status === 'paused' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                                color: enr.status === 'active' ? '#34d399' :
                                       enr.status === 'paused' ? '#fbbf24' : '#94a3b8'
                              }}
                            >
                              {enr.status}
                            </span>

                            {enr.status === 'active' ? (
                              <button
                                type="button"
                                onClick={() => handleToggleEnrollment(enr.id, 'pause')}
                                style={{
                                  background: 'none',
                                  border: '1px solid rgba(255, 255, 255, 0.1)',
                                  borderRadius: '6px',
                                  color: '#f59e0b',
                                  padding: '4px 8px',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title="Pause automation"
                              >
                                <Pause size={10} />
                                <span>Pause</span>
                              </button>
                            ) : enr.status === 'paused' ? (
                              <button
                                type="button"
                                onClick={() => handleToggleEnrollment(enr.id, 'resume')}
                                style={{
                                  background: 'none',
                                  border: '1px solid rgba(255, 255, 255, 0.1)',
                                  borderRadius: '6px',
                                  color: '#10b981',
                                  padding: '4px 8px',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title="Resume automation"
                              >
                                <Play size={10} />
                                <span>Resume</span>
                              </button>
                            ) : null}

                            {enr.status !== 'cancelled' && (
                              <button
                                type="button"
                                onClick={() => handleToggleEnrollment(enr.id, 'cancel')}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#64748b',
                                  padding: '4px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                                title="Unenroll customer"
                              >
                                <XCircle size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab Content: Timeline */}
              {activeTab === 'timeline' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {timeline.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>
                      <Clock size={28} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                      <div style={{ fontSize: '13px' }}>No recorded activity yet</div>
                    </div>
                  ) : (
                    timeline.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '12px',
                          padding: '10px 12px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(255, 255, 255, 0.02)',
                          border: '1px solid rgba(255, 255, 255, 0.04)'
                        }}
                      >
                        <div
                          style={{
                            padding: '6px',
                            borderRadius: '8px',
                            backgroundColor: item.kind === 'order' ? 'rgba(16, 185, 129, 0.15)' :
                                             item.kind === 'checkout' ? 'rgba(245, 158, 11, 0.15)' :
                                             item.kind === 'automation' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                            color: item.kind === 'order' ? '#34d399' :
                                   item.kind === 'checkout' ? '#fbbf24' :
                                   item.kind === 'automation' ? '#818cf8' : '#94a3b8'
                          }}
                        >
                          {item.kind === 'order' && <ShoppingBag size={14} />}
                          {item.kind === 'checkout' && <ShoppingCart size={14} />}
                          {item.kind === 'automation' && <Clock size={14} />}
                          {item.kind === 'touch' && <Mail size={14} />}
                          {item.kind === 'joined' && <ShieldCheck size={14} />}
                          {item.kind === 'event' && <Sparkles size={14} />}
                        </div>

                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                            {item.title}
                          </div>
                          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                            {item.description}
                          </div>
                        </div>

                        <span style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {new Date(item.at).toLocaleDateString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
