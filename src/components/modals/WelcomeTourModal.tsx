import React, { useState } from 'react';
import {
  X,
  Sparkles,
  ShoppingBag,
  Play,
  Rocket,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Compass
} from 'lucide-react';
import { ModalDialog } from './ModalDialog';

export const WELCOME_TOUR_STORAGE_KEY = 'jourvance_welcome_tour_seen';

export function hasSeenWelcomeTour(): boolean {
  try {
    return localStorage.getItem(WELCOME_TOUR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markWelcomeTourSeen(): void {
  try {
    localStorage.setItem(WELCOME_TOUR_STORAGE_KEY, '1');
  } catch {
    // Private browsing or blocked storage keeps the dismissal for this session.
  }
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onOpenBlueprints: () => void;
  onOpenAiBuilder: () => void;
  onSelectLandingPage: () => void;
  onOpenStoreConnect: () => void;
  onOpenSimulator: () => void;
  onOpenLaunchPlaybook: () => void;
}

interface TourStep {
  id: string;
  badge: string;
  title: string;
  summary: string;
  highlights: string[];
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  icon: React.ComponentType<{ size?: number | string; color?: string }>;
  accent: string;
}

export const WelcomeTourModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onOpenBlueprints,
  onOpenAiBuilder,
  onSelectLandingPage,
  onOpenStoreConnect,
  onOpenSimulator,
  onOpenLaunchPlaybook
}) => {
  const [stepIndex, setStepIndex] = useState(0);

  if (!isOpen) return null;

  const dismissAndClose = () => {
    markWelcomeTourSeen();
    onClose();
  };

  const steps: TourStep[] = [
    {
      id: 'blueprints',
      badge: 'Step 1 of 4 · Foundation',
      title: 'Start with a Turnkey Blueprint or Draft with AI',
      summary:
        'Whether you run physical retail, client services, consulting, digital courses, or SaaS, you never have to build from a blank screen.',
      highlights: [
        'Browse ready-made turnkey blueprints for physical goods, client bookings, consulting, and digital products.',
        'Or describe your offer in plain words and let Draft with AI map your steps and copy.',
        'Every step on the map connects traffic, landing pages, upsells, and follow-up emails in one place.'
      ],
      primaryLabel: 'Browse Blueprints',
      onPrimary: () => {
        markWelcomeTourSeen();
        onClose();
        onOpenBlueprints();
      },
      secondaryLabel: 'Draft with AI',
      onSecondary: () => {
        markWelcomeTourSeen();
        onClose();
        onOpenAiBuilder();
      },
      icon: Sparkles,
      accent: '#EC4899'
    },
    {
      id: 'commerce',
      badge: 'Step 2 of 4 · Offer & Checkout',
      title: 'Edit Your Page & Connect Checkout or Calendar Links',
      summary:
        'Click any step on the canvas to open its editor in the right-hand Step Panel. Your call-to-action button connects to online stores, payment links, or calendar bookings.',
      highlights: [
        'Shopify & WooCommerce: Sync your live product catalog, variants, order bumps, and webhooks.',
        'Stripe, Google Calendar & Calendly: Paste any direct payment or booking link with zero server cost.',
        'Copy your Confirmation Redirect URL (/p/your-slug/thank-you) so completed purchases or bookings land on your Thank-You page.'
      ],
      primaryLabel: 'Edit Landing Page',
      onPrimary: () => {
        markWelcomeTourSeen();
        onClose();
        onSelectLandingPage();
      },
      secondaryLabel: 'Connect Store or Link',
      onSecondary: () => {
        markWelcomeTourSeen();
        onClose();
        onOpenStoreConnect();
      },
      icon: ShoppingBag,
      accent: '#10B981'
    },
    {
      id: 'simulate',
      badge: 'Step 3 of 4 · Interactive Testing',
      title: 'Simulate as Lead or Buyer & Share Client Pitch Links',
      summary:
        'Before sending real traffic, walk through your entire customer journey in the interactive simulator to verify every page, bump, and email.',
      highlights: [
        'Switch between Simulate as Lead (opt-in flow) and Simulate as Buyer (full checkout + order bump).',
        'Review the Simulation Journey Summary at the end with projected pipeline value and queued emails.',
        'Click Share Client Walk to copy a direct preview link (?simulate=true) for clients or teammates.'
      ],
      primaryLabel: 'Launch Simulator',
      onPrimary: () => {
        markWelcomeTourSeen();
        onClose();
        onOpenSimulator();
      },
      icon: Play,
      accent: '#38BDF8'
    },
    {
      id: 'launch',
      badge: 'Step 4 of 4 · Go Live',
      title: 'Run Pre-Flight Checks & Publish in One Click',
      summary:
        'Your 5-step Launch Readiness Playbook tracks your progress from initial setup to live traffic, and Pre-Flight Checks catch missing links before you publish.',
      highlights: [
        'Check Design verifies your headlines, checkout links, and follow-up sequences automatically.',
        'Publish puts your hosted funnel live at /p/your-slug or on your own verified custom domain.',
        'Need help anytime? Click Ask Jourvance in the bottom-right corner for step-aware guidance.'
      ],
      primaryLabel: 'Open Launch Playbook',
      onPrimary: () => {
        markWelcomeTourSeen();
        onClose();
        onOpenLaunchPlaybook();
      },
      icon: Rocket,
      accent: '#8B5CF6'
    }
  ];

  const current = steps[stepIndex] || steps[0];
  const Icon = current.icon;

  return (
    <ModalDialog labelledBy="welcome-tour-title" onClose={dismissAndClose} maxWidth={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #EC4899 0%, #8B5CF6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <Compass size={20} color="#FFFFFF" />
            </div>
            <div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: current.accent,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}
              >
                {current.badge}
              </span>
              <h2
                id="welcome-tour-title"
                style={{
                  fontSize: '18px',
                  fontWeight: 800,
                  color: '#FFFFFF',
                  margin: '2px 0 0',
                  letterSpacing: '-0.02em'
                }}
              >
                Welcome to Jourvance Studio
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={dismissAndClose}
            aria-label="Close Welcome Tour"
            style={{
              width: '38px',
              height: '38px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: '#94A3B8',
              cursor: 'pointer',
              flexShrink: 0
            }}
          >
            <X size={17} />
          </button>
        </div>

        {/* Step Indicator Pills */}
        <div
          role="tablist"
          aria-label="Welcome tour steps"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}
        >
          {steps.map((s, idx) => {
            const active = idx === stepIndex;
            const done = idx < stepIndex;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStepIndex(idx)}
                style={{
                  padding: '6px 8px',
                  borderRadius: '8px',
                  border: active
                    ? `1px solid ${s.accent}`
                    : done
                      ? '1px solid rgba(16, 185, 129, 0.35)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                  backgroundColor: active
                    ? 'rgba(255, 255, 255, 0.08)'
                    : done
                      ? 'rgba(16, 185, 129, 0.08)'
                      : 'rgba(255, 255, 255, 0.02)',
                  color: active ? '#FFFFFF' : done ? '#34D399' : '#94A3B8',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
              >
                {idx + 1}. {s.id === 'blueprints' ? 'Blueprints' : s.id === 'commerce' ? 'Checkout' : s.id === 'simulate' ? 'Simulate' : 'Publish'}
              </button>
            );
          })}
        </div>

        {/* Active Step Card */}
        <div
          style={{
            padding: '18px',
            borderRadius: '12px',
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <Icon size={18} color={current.accent} />
            </div>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#F8FAFC', margin: 0 }}>
              {current.title}
            </h3>
          </div>

          <p style={{ fontSize: '13px', color: '#CBD5E1', lineHeight: 1.55, margin: 0 }}>
            {current.summary}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {current.highlights.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <CheckCircle2 size={14} color={current.accent} style={{ flexShrink: 0, marginTop: '3px' }} />
                <span style={{ fontSize: '12px', color: '#94A3B8', lineHeight: 1.45 }}>{item}</span>
              </div>
            ))}
          </div>

          {/* Direct Action Shortcuts for this step */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', paddingTop: '4px' }}>
            <button
              type="button"
              onClick={current.onPrimary}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.1)',
                border: `1px solid ${current.accent}`,
                color: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>{current.primaryLabel}</span>
              <ChevronRight size={14} />
            </button>
            {current.secondaryLabel && current.onSecondary && (
              <button
                type="button"
                onClick={current.onSecondary}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#E2E8F0',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {current.secondaryLabel}
              </button>
            )}
          </div>
        </div>

        {/* Footer Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <button
            type="button"
            onClick={dismissAndClose}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#94A3B8',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Skip Tour
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStepIndex(i => Math.max(0, i - 1))}
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#F8FAFC',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <ChevronLeft size={14} />
                <span>Previous</span>
              </button>
            )}

            {stepIndex < steps.length - 1 ? (
              <button
                type="button"
                onClick={() => setStepIndex(i => Math.min(steps.length - 1, i + 1))}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #EC4899 0%, #8B5CF6 100%)',
                  border: 'none',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span>Next Step</span>
                <ChevronRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={dismissAndClose}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                  border: 'none',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Finish & Start Building
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalDialog>
  );
};

export default WelcomeTourModal;
