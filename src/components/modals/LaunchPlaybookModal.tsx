import React from 'react';
import {
  X,
  Compass,
  ShoppingBag,
  Sparkles,
  Layers,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  ArrowRight,
  Rocket
} from 'lucide-react';
import { ModalDialog } from './ModalDialog';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  // Deterministic Milestone Statuses
  isStoreConnected: boolean;
  hasBlueprint: boolean;
  hasOffer: boolean;
  isAuditPassed: boolean;
  isPublished: boolean;
  // Detail context
  storeName?: string;
  designCount?: number;
  storeScore?: number | null;
  publishedUrl?: string | null;
  // 1-Click Milestone Action Handlers
  onOpenShopifyConnect: () => void;
  onOpenBlueprints: () => void;
  onConfigureOffer: () => void;
  onOpenAudit: () => void;
  onOpenPublish: () => void;
}

export const LaunchPlaybookModal: React.FC<Props> = ({
  isOpen,
  onClose,
  isStoreConnected,
  hasBlueprint,
  hasOffer,
  isAuditPassed,
  isPublished,
  storeName,
  designCount = 0,
  storeScore = null,
  publishedUrl,
  onOpenShopifyConnect,
  onOpenBlueprints,
  onConfigureOffer,
  onOpenAudit,
  onOpenPublish
}) => {
  if (!isOpen) return null;

  const steps = [
    {
      id: 'store',
      title: '1. Connect Shopify Store',
      description: isStoreConnected
        ? `Connected to ${storeName || 'Shopify store'}. Catalog and checkout links are active.`
        : 'Link your store to sync products, enable 1-click checkouts, and track live orders.',
      passed: isStoreConnected,
      badgeText: isStoreConnected ? 'Connected' : 'Action Needed',
      actionLabel: isStoreConnected ? 'Manage Store' : 'Connect Shopify',
      action: onOpenShopifyConnect,
      icon: ShoppingBag
    },
    {
      id: 'blueprint',
      title: '2. Choose Funnel Blueprint',
      description: hasBlueprint
        ? 'Funnel architecture mapped with traffic, conversion, and retention steps.'
        : 'Select a turnkey beauty or e-commerce blueprint to establish your customer journey.',
      passed: hasBlueprint,
      badgeText: hasBlueprint ? 'Configured' : 'Action Needed',
      actionLabel: hasBlueprint ? 'Change Blueprint' : 'Browse Blueprints',
      action: onOpenBlueprints,
      icon: Sparkles
    },
    {
      id: 'offer',
      title: '3. Configure Core Offer',
      description: hasOffer
        ? 'Headline and product offer configured for customer purchase.'
        : 'Set your hero headline, feature copy, pricing, and optional 1-click order bump.',
      passed: hasOffer,
      badgeText: hasOffer ? 'Ready' : 'Pending',
      actionLabel: hasOffer ? 'Edit Offer' : 'Configure Offer',
      action: onConfigureOffer,
      icon: Layers
    },
    {
      id: 'audit',
      title: '4. Pre-Flight Conversion Audit',
      description: isAuditPassed
        ? (storeScore !== null
            ? `Store conversion readiness score is ${storeScore}/100 with zero design flaws.`
            : 'Zero design issues detected across your funnel steps.')
        : (designCount > 0
            ? `${designCount} open design ${designCount === 1 ? 'check' : 'checks'} need your review.`
            : 'Review your mobile sticky CTA, order bump, and recovery safety nets.'),
      passed: isAuditPassed,
      badgeText: isAuditPassed
        ? (storeScore !== null ? `${storeScore}/100 Score` : 'Passed')
        : (designCount > 0 ? `${designCount} Issues` : 'Review'),
      actionLabel: isAuditPassed ? 'View Audit' : 'Review Issues',
      action: onOpenAudit,
      icon: CheckCircle2
    },
    {
      id: 'publish',
      title: '5. Publish Live Funnel',
      description: isPublished
        ? (publishedUrl ? `Live at ${publishedUrl}` : 'Funnel is published and accepting visitors.')
        : 'Deploy your high-converting funnel to a custom domain or secure subdomain.',
      passed: isPublished,
      badgeText: isPublished ? 'Live' : 'Unpublished',
      actionLabel: isPublished ? (publishedUrl ? 'Visit Live Page' : 'Republish') : 'Publish Live',
      action: onOpenPublish,
      icon: ExternalLink
    }
  ];

  const completedCount = steps.filter(s => s.passed).length;
  const progressPct = Math.round((completedCount / steps.length) * 100);
  const isAllComplete = completedCount === steps.length;

  return (
    <ModalDialog labelledBy="launch-playbook-title" onClose={onClose} maxWidth={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: isAllComplete
                  ? 'linear-gradient(135deg, #10B981 0%, #059669 100%)'
                  : 'linear-gradient(135deg, #EC4899 0%, #8B5CF6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: isAllComplete
                  ? '0 4px 16px rgba(16, 185, 129, 0.35)'
                  : '0 4px 16px rgba(236, 72, 153, 0.35)',
                flexShrink: 0
              }}
            >
              <Rocket size={20} color="#FFFFFF" />
            </div>
            <div>
              <h2
                id="launch-playbook-title"
                style={{
                  fontSize: '18px',
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  color: '#FFFFFF',
                  margin: 0
                }}
              >
                Launch Readiness Playbook
              </h2>
              <p style={{ fontSize: '13px', color: '#94A3B8', margin: '3px 0 0' }}>
                Follow these 5 essential milestones to take your funnel live.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Launch Playbook"
            style={{
              width: '44px',
              height: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              color: '#94A3B8',
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = '#FFFFFF';
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = '#94A3B8';
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Progress Bar & Summary Card */}
        <div
          style={{
            padding: '16px',
            borderRadius: '10px',
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#F8FAFC' }}>
              {isAllComplete ? 'Ready for Live Traffic' : `${completedCount} of ${steps.length} Milestones Complete`}
            </span>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: isAllComplete ? '#34D399' : '#F472B6'
              }}
            >
              {progressPct}%
            </span>
          </div>

          {/* Progress track */}
          <div
            style={{
              width: '100%',
              height: '8px',
              borderRadius: '9999px',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: '100%',
                borderRadius: '9999px',
                background: isAllComplete
                  ? 'linear-gradient(90deg, #10B981, #34D399)'
                  : 'linear-gradient(90deg, #EC4899, #8B5CF6)',
                transition: 'width 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
              }}
            />
          </div>

          <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0 }}>
            {isAllComplete
              ? 'Your store funnel is completely configured, audited, and live for customer checkout.'
              : 'Complete remaining milestones to ensure optimal conversion, payment processing, and checkout flow.'}
          </p>
        </div>

        {/* 5 Milestone Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {steps.map(step => {
            const Icon = step.icon;
            return (
              <div
                key={step.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '14px 16px',
                  borderRadius: '10px',
                  backgroundColor: step.passed
                    ? 'rgba(16, 185, 129, 0.06)'
                    : 'rgba(255, 255, 255, 0.03)',
                  border: step.passed
                    ? '1px solid rgba(16, 185, 129, 0.25)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                  transition: 'all 0.15s ease'
                }}
              >
                {/* Left: Icon & Text */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      backgroundColor: step.passed
                        ? 'rgba(16, 185, 129, 0.15)'
                        : 'rgba(255, 255, 255, 0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: '2px'
                    }}
                  >
                    <Icon size={16} color={step.passed ? '#34D399' : '#94A3B8'} />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF' }}>
                        {step.title}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '9999px',
                          backgroundColor: step.passed
                            ? 'rgba(16, 185, 129, 0.2)'
                            : 'rgba(245, 158, 11, 0.18)',
                          color: step.passed ? '#34D399' : '#FBBF24'
                        }}
                      >
                        {step.badgeText}
                      </span>
                    </div>
                    <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0, lineHeight: 1.4 }}>
                      {step.description}
                    </p>
                  </div>
                </div>

                {/* Right: 1-Click Action Button */}
                <button
                  type="button"
                  onClick={step.action}
                  aria-label={`${step.actionLabel} for ${step.title}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    minHeight: '44px',
                    padding: '0 14px',
                    borderRadius: '8px',
                    background: step.passed
                      ? 'rgba(255, 255, 255, 0.08)'
                      : 'linear-gradient(135deg, #EC4899 0%, #8B5CF6 100%)',
                    border: step.passed
                      ? '1px solid rgba(255, 255, 255, 0.12)'
                      : 'none',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'all 0.15s ease',
                    boxShadow: step.passed ? 'none' : '0 2px 8px rgba(236, 72, 153, 0.3)'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <span>{step.actionLabel}</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer Help Note & Dismiss */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '12px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)'
          }}
        >
          <span style={{ fontSize: '12px', color: '#64748B' }}>
            All checks update in real time as you edit your funnel.
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              minHeight: '44px',
              padding: '0 16px',
              borderRadius: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: '#E2E8F0',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </ModalDialog>
  );
};

export default LaunchPlaybookModal;
