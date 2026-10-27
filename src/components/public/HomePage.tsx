import React, { lazy, Suspense, useState } from 'react';
import './HomeCanvasPreview.css';
import {
  ArrowRight,
  Play,
  CheckCircle2,
  Zap,
  Layers,
  Sparkles,
  MousePointerClick,
  FileText,
  Mail,
  ChevronDown,
  TrendingUp,
  Shield,
  Gauge,
  Sliders,
  DollarSign,
  Globe,
  Share2,
  BarChart3,
  Smartphone,
  Laptop,
  Download
} from 'lucide-react';

import { ACTION_LABEL, ROAS_STAT_NAME, STEP_TYPES, VIEW_LABEL } from '../../lib/studioLabels';

type BuilderTab = 'map' | 'pages' | 'ads' | 'emails' | 'forms' | 'tracking';

const stepLabel = (type: (typeof STEP_TYPES)[number]['type']) =>
  STEP_TYPES.find((item) => item.type === type)?.label ?? type;

const BUILDER_GROUPS: { name: string; tabs: { id: BuilderTab; label: string; icon: typeof Layers }[] }[] = [
  {
    name: 'Places',
    tabs: [
      { id: 'map', label: VIEW_LABEL.canvas, icon: Layers },
      { id: 'emails', label: VIEW_LABEL['email-studio'], icon: Mail },
      { id: 'tracking', label: VIEW_LABEL.attribution, icon: BarChart3 }
    ]
  },
  {
    name: 'Steps on the canvas',
    tabs: [
      { id: 'pages', label: stepLabel('landing-page'), icon: Globe },
      { id: 'ads', label: stepLabel('ad-source'), icon: Share2 },
      { id: 'forms', label: stepLabel('lead-form'), icon: FileText }
    ]
  }
];

function CanvasLink({
  note,
  onNavigate
}: {
  note: string;
  onNavigate: (page: 'canvas') => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={() => onNavigate('canvas')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem 1.5rem',
          borderRadius: '10px',
          background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
          color: '#FFFFFF',
          fontSize: '0.9rem',
          fontWeight: 700,
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)'
        }}
      >
        <span>{VIEW_LABEL.canvas}</span>
        <ArrowRight size={16} aria-hidden />
      </button>
      <span style={{ fontSize: '0.8rem', color: '#64748B', maxWidth: '280px', lineHeight: 1.45 }}>{note}</span>
    </div>
  );
}

function Point({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
      <CheckCircle2 size={16} color="#10B981" aria-hidden style={{ flexShrink: 0, marginTop: '0.15rem' }} />
      <span>{children}</span>
    </div>
  );
}

function ExampleCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        backgroundColor: '#070A12',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '14px',
        padding: '1.5rem'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.85rem', marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#FFFFFF' }}>{title}</div>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#CBD5E1', border: '1px solid rgba(255, 255, 255, 0.16)', borderRadius: '999px', padding: '0.15rem 0.55rem', flexShrink: 0 }}>
          Example
        </span>
      </div>
      {children}
    </div>
  );
}

const HomeCanvasPreview = lazy(() => import('./HomeCanvasPreview').then(module => ({ default: module.HomeCanvasPreview })));

interface HomePageProps {
  onNavigate: (page: 'home' | 'about' | 'blog' | 'contact' | 'canvas') => void;
  onTestJourney: () => void;
  onOpenBilling?: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onNavigate, onTestJourney, onOpenBilling }) => {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [activeBuilderTab, setActiveBuilderTab] = useState<'map' | 'pages' | 'ads' | 'emails' | 'forms' | 'tracking'>('map');
  const [pagePreviewDevice, setPagePreviewDevice] = useState<'desktop' | 'mobile'>('desktop');

  const faqs = [
    {
      q: 'What makes Jourvance different from standard funnel builders like ClickFunnels or GoHighLevel?',
      a: 'Traditional funnel builders force you to build pages in isolation, configure automations in separate menus, and guess where drop-offs happen. Jourvance places your entire customer journey (advertising hooks, landing page blocks, intake forms, and automated email nurture) onto a single interactive visual canvas. You see the complete picture and test the live prospect experience before spending money on traffic.'
    },
    {
      q: 'Do I need any coding or design skills to use Jourvance?',
      a: 'Not at all. Jourvance gives you turnkey, pre-tested funnel blueprints, drag-and-drop landing page blocks, and automated nurture sequences right out of the box. You can launch your first high-converting offer in under 15 minutes.'
    },
    {
      q: 'Does Jourvance charge per-lead or transaction fees?',
      a: 'No. Jourvance does not charge a fee on each order. Starter Studio is free. Growth Pro is $49 a month, or $39 a month billed once a year. Open Pricing to check out.'
    },
    {
      q: 'Can I simulate the funnel as a real prospect before publishing?',
      a: 'Yes! You can preview your desktop and mobile pages in real time, run live simulations to test the shopper experience, and connect your Shopify checkout with a single click.'
    }
  ];

  return (
    <div style={{ backgroundColor: '#0B0F19', color: '#F8FAFC' }}>
      {/* ── HERO SECTION ── */}
      <section
        style={{
          position: 'relative',
          padding: '5rem clamp(1rem, 4vw, 2rem) 4rem',
          textAlign: 'center',
          maxWidth: '1200px',
          margin: '0 auto',
          overflow: 'hidden'
        }}
      >
        {/* Glow ambient background effect */}
        <div
          style={{
            position: 'absolute',
            top: '-80px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '600px',
            height: '350px',
            background: 'radial-gradient(circle, rgba(99, 102, 241, 0.22) 0%, rgba(11, 15, 25, 0) 70%)',
            filter: 'blur(50px)',
            pointerEvents: 'none',
            zIndex: 0
          }}
        />

        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* Announcement pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.35rem 1rem',
              borderRadius: '9999px',
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              fontSize: '0.825rem',
              fontWeight: 600,
              color: '#A5B4FC',
              marginBottom: '1.75rem'
            }}
          >
            <Sparkles style={{ width: '14px', height: '14px', color: '#818CF8' }} />
            <span>The visual customer journey studio for any business.</span>
          </div>

          {/* Main H1 */}
          <h1
            style={{
              fontSize: 'clamp(2.5rem, 5vw, 4.25rem)',
              fontWeight: 900,
              lineHeight: 1.12,
              letterSpacing: '-0.035em',
              maxWidth: '960px',
              margin: '0 auto 1.5rem',
              background: 'linear-gradient(180deg, #FFFFFF 20%, #CBD5E1 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}
          >
            Design, test, and launch your customer journey on one canvas
          </h1>

          {/* Subtitle */}
          <p
            style={{
              fontSize: 'clamp(1.05rem, 2vw, 1.25rem)',
              lineHeight: 1.6,
              color: '#94A3B8',
              maxWidth: '740px',
              margin: '0 auto 2.5rem'
            }}
          >
            Bring your traffic sources, landing pages, lead capture, and automated follow-up sequences together on one visual canvas. Test the visitor experience before you spend on ads.
          </p>

          {/* Primary & Secondary Action Buttons */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              flexWrap: 'wrap',
              marginBottom: '3.5rem'
            }}
          >
            <button
              onClick={() => onNavigate('canvas')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '0.9rem 2rem',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                color: '#ffffff',
                fontSize: '1rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 20px rgba(99, 102, 241, 0.4)',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 24px rgba(99, 102, 241, 0.55)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(99, 102, 241, 0.4)';
              }}
            >
              <span>{VIEW_LABEL.canvas}</span>
              <ArrowRight style={{ width: '18px', height: '18px' }} />
            </button>

            <button
              onClick={onTestJourney}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '0.9rem 1.75rem',
                borderRadius: '10px',
                backgroundColor: 'rgba(30, 41, 59, 0.9)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#F1F5F9',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'rgba(51, 65, 85, 0.95)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'rgba(30, 41, 59, 0.9)')}
            >
              <Play style={{ width: '16px', height: '16px', color: '#38BDF8' }} />
              <span>{ACTION_LABEL.testFunnel}</span>
            </button>
          </div>

          <Suspense fallback={<div className="home-canvas-preview-loading" role="status">Loading canvas example...</div>}>
            <HomeCanvasPreview onOpenCanvas={() => onNavigate('canvas')} />
          </Suspense>
        </div>
      </section>

      {/* Founder story */}
      <section aria-labelledby="home-founder-heading" style={{ maxWidth: '1000px', margin: '0 auto', padding: '0 2rem 4rem' }}>
        <div style={{ backgroundColor: '#111827', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '16px', padding: 'clamp(1.5rem, 4vw, 3rem)' }}>
          <h2 id="home-founder-heading" style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)', fontWeight: 800, color: '#FFFFFF', marginBottom: '1.25rem' }}>
            Why I built Jourvance
          </h2>
          <figure style={{ margin: 0 }}>
            <blockquote style={{ margin: 0, fontSize: '1.125rem', lineHeight: 1.7, color: '#CBD5E1', maxWidth: '65ch' }}>
              <p>I've spent eight years in marketing. Jourvance brings together what I've learned and the tools I've needed along the way.</p>
            </blockquote>
            <figcaption style={{ marginTop: '1.25rem', fontSize: '0.95rem', lineHeight: 1.6 }}>
              <strong style={{ display: 'block', color: '#FFFFFF' }}>Tarren Munoz</strong>
              <span style={{ color: '#94A3B8' }}>Founder, Jourvance</span>
            </figcaption>
          </figure>
          <a
            href="/about"
            onClick={event => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              onNavigate('about');
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', minHeight: '44px', marginTop: '1rem', color: '#A5B4FC', fontSize: '1rem', fontWeight: 700, textUnderlineOffset: '0.2em' }}
          >
            Read the Jourvance story
            <ArrowRight aria-hidden="true" size={18} style={{ flexShrink: 0 }} />
          </a>
        </div>
      </section>

      {/* ── THE PROBLEM VS THE SOLUTION ── */}
      <section
        style={{
          padding: '5rem 2rem',
          backgroundColor: '#070A12',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
        }}
      >
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
            <h2 style={{ fontSize: 'clamp(1.75rem, 3.5vw, 2.5rem)', fontWeight: 800, letterSpacing: '-0.025em', marginBottom: '1rem' }}>
              The Cost of Fragmented Marketing
            </h2>
            <p style={{ fontSize: '1.05rem', color: '#94A3B8', maxWidth: '650px', margin: '0 auto' }}>
              Most businesses don't have a traffic problem. They have a connection problem.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '2rem' }}>
            {/* The Old Way */}
            <div
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.04)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '14px',
                padding: '2rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#EF4444', fontWeight: 700, fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                <span style={{ fontSize: '1.1rem' }}>✕</span>
                <span>The Fragmented Stack</span>
              </div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '1rem', color: '#94A3B8', fontSize: '0.9rem' }}>
                <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                  <span style={{ color: '#EF4444', fontWeight: 700 }}>•</span>
                  <span>Separate subscriptions: landing page builder ($49), email tool ($49), Zapier ($29), form plugin ($19).</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                  <span style={{ color: '#EF4444', fontWeight: 700 }}>•</span>
                  <span>Blind drop-offs: You can't see why leads abandon between the ad and the form.</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                  <span style={{ color: '#EF4444', fontWeight: 700 }}>•</span>
                  <span>Broken zaps & delayed emails: Leads wait hours for a welcome message and turn cold.</span>
                </li>
              </ul>
            </div>

            {/* The Jourvance Way */}
            <div
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.04)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                borderRadius: '14px',
                padding: '2rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#10B981', fontWeight: 700, fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                <CheckCircle2 style={{ width: '18px', height: '18px' }} />
                <span>The Jourvance Visual Platform</span>
              </div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '1rem', color: '#F1F5F9', fontSize: '0.9rem' }}>
                <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                  <span style={{ color: '#10B981', fontWeight: 700 }}>•</span>
                  <span>Visual canvas: ad, landing page, intake form, and email sequence in one connected view.</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                  <span style={{ color: '#10B981', fontWeight: 700 }}>•</span>
                  <span>Page preview: Read the page before you publish it. Preview does not send email.</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                  <span style={{ color: '#10B981', fontWeight: 700 }}>•</span>
                  <span>Starter is free. Growth Pro is $49 a month, or $39 a month billed yearly. Open Pricing to check out.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── CORE CAPABILITIES: 6-PILLAR INTERACTIVE BUILDER SHOWCASE ── */}
      <section style={{ padding: '6rem 2rem', maxWidth: '1240px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
            Tools for everyday marketing
          </span>
          <h2 style={{ fontSize: 'clamp(2rem, 4vw, 2.75rem)', fontWeight: 800, letterSpacing: '-0.025em', marginTop: '0.5rem', color: '#FFFFFF' }}>
            Build each step with the whole journey in view.
          </h2>
          <p style={{ fontSize: '1.05rem', color: '#94A3B8', maxWidth: '720px', margin: '0.75rem auto 0', lineHeight: 1.6 }}>
            Funnel Canvas, Email Studio, and Attribution are places in the left rail. A landing page, an ad source, and a lead form are steps you add on the canvas.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '1.75rem',
            flexWrap: 'wrap',
            marginBottom: '2.5rem'
          }}
        >
          {BUILDER_GROUPS.map(group => (
            <div key={group.name} role="group" aria-label={group.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.55rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94A3B8' }}>
                {group.name}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                {group.tabs.map(tab => {
                  const Icon = tab.icon;
                  const isActive = activeBuilderTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setActiveBuilderTab(tab.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.55rem',
                        padding: '0.65rem 1.15rem',
                        borderRadius: '10px',
                        fontSize: '0.875rem',
                        fontWeight: 700,
                        border: isActive ? '1px solid #6366F1' : '1px solid rgba(255, 255, 255, 0.08)',
                        backgroundColor: isActive ? 'rgba(99, 102, 241, 0.18)' : 'rgba(17, 24, 39, 0.6)',
                        color: isActive ? '#FFFFFF' : '#94A3B8',
                        cursor: 'pointer',
                        boxShadow: isActive ? '0 4px 14px rgba(99, 102, 241, 0.25)' : 'none'
                      }}
                    >
                      <Icon size={16} color={isActive ? '#818CF8' : '#64748B'} aria-hidden />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Tab Showcase Card */}
        <div
          style={{
            backgroundColor: '#0B101E',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '20px',
            padding: '2.5rem',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 35px rgba(99, 102, 241, 0.08)',
            marginBottom: '4rem'
          }}
        >
          {activeBuilderTab === 'map' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '2.5rem', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
                  A place in the left rail
                </span>
                <h3 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', margin: '0.4rem 0 0.85rem' }}>
                  {VIEW_LABEL.canvas}
                </h3>
                <p style={{ fontSize: '0.925rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                  This is the map. Add a step, connect it to the next one, and read the whole path before you publish.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '2rem' }}>
                  <Point>Ads, pages, forms, and follow-up emails sit on the same map.</Point>
                  <Point>Test funnel walks the journey before you spend on ads. Nothing is sent or charged.</Point>
                  <Point>Check design lists what is still unfinished on this journey.</Point>
                </div>
                <CanvasLink note="This opens Funnel Canvas." onNavigate={onNavigate} />
              </div>
              <ExampleCard title="One journey">
                <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.65rem', margin: 0, padding: 0 }}>
                  {[
                    [stepLabel('ad-source'), 'Meta, Google, or organic'],
                    [stepLabel('landing-page'), 'The page people land on'],
                    [stepLabel('lead-form'), 'Name, email, and your questions'],
                    [stepLabel('follow-up-sequence'), 'Emails that send on their own']
                  ].map(([name, detail], index) => (
                    <li key={name}>
                      {index > 0 && <div style={{ textAlign: 'center', color: '#64748B', fontSize: '0.75rem', fontWeight: 700, margin: '0.15rem 0 0.55rem' }}>then</div>}
                      <div style={{ padding: '0.75rem 0.9rem', borderRadius: '10px', background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#FFFFFF' }}>{name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: '0.15rem' }}>{detail}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </ExampleCard>
            </div>
          )}

          {activeBuilderTab === 'pages' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '2.5rem', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
                  A step on the canvas
                </span>
                <h3 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', margin: '0.4rem 0 0.85rem' }}>
                  {stepLabel('landing-page')}
                </h3>
                <p style={{ fontSize: '0.925rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                  Add a landing page step, then open the page builder. Write the page, check it on a computer and a phone, and publish it with the journey.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '2rem' }}>
                  <Point>The page builder is part of the landing page step. It is not a separate product.</Point>
                  <Point>Preview the same page on a computer and a phone before you publish.</Point>
                  <Point>The preview does not send email or take a payment.</Point>
                </div>
                <CanvasLink note="This opens Funnel Canvas. Add a landing page step there." onNavigate={onNavigate} />
              </div>
              <ExampleCard title="Page preview">
                <div role="group" aria-label="Preview size" style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
                  <button
                    type="button"
                    aria-pressed={pagePreviewDevice === 'desktop'}
                    onClick={() => setPagePreviewDevice('desktop')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.7rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid rgba(255,255,255,0.1)', backgroundColor: pagePreviewDevice === 'desktop' ? '#6366F1' : 'transparent', color: '#FFF', cursor: 'pointer' }}
                  >
                    <Laptop size={12} aria-hidden />
                    Computer
                  </button>
                  <button
                    type="button"
                    aria-pressed={pagePreviewDevice === 'mobile'}
                    onClick={() => setPagePreviewDevice('mobile')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.7rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid rgba(255,255,255,0.1)', backgroundColor: pagePreviewDevice === 'mobile' ? '#6366F1' : 'transparent', color: '#FFF', cursor: 'pointer' }}
                  >
                    <Smartphone size={12} aria-hidden />
                    Phone
                  </button>
                </div>
                <div style={{ padding: pagePreviewDevice === 'mobile' ? '1.25rem 1rem' : '1.5rem 1.25rem', maxWidth: pagePreviewDevice === 'mobile' ? '280px' : '100%', margin: '0 auto', textAlign: 'center', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px' }}>
                  <div style={{ fontSize: pagePreviewDevice === 'mobile' ? '1.15rem' : '1.35rem', fontWeight: 800, color: '#FFFFFF', lineHeight: 1.3, marginBottom: '0.65rem' }}>
                    Book a time to talk about your offer
                  </div>
                  <p style={{ fontSize: '0.825rem', color: '#94A3B8', marginBottom: '1rem' }}>
                    One page for this journey. People land here from the ad.
                  </p>
                  <div style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: '#6366F1', color: '#FFFFFF', fontSize: '0.85rem', fontWeight: 700 }}>
                    Continue
                  </div>
                </div>
              </ExampleCard>
            </div>
          )}

          {activeBuilderTab === 'ads' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '2.5rem', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
                  A step on the canvas
                </span>
                <h3 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', margin: '0.4rem 0 0.85rem' }}>
                  {stepLabel('ad-source')}
                </h3>
                <p style={{ fontSize: '0.925rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                  An ad source is the first step on the map. Write the headline and the text, pick where the ad runs, and add the campaign tag Attribution uses.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '2rem' }}>
                  <Point>Choose Meta, Google, or organic.</Point>
                  <Point>Write the headline, the text under it, and the button label.</Point>
                  <Point>You type the campaign tag and the ad spend. Jourvance does not invent those numbers.</Point>
                </div>
                <CanvasLink note="This opens Funnel Canvas. Add an ad source step there." onNavigate={onNavigate} />
              </div>
              <ExampleCard title="Ad source">
                <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {[
                    ['Platform', 'Meta'],
                    ['Ad headline', 'See your offer on one page'],
                    ['Primary text', 'Tell people what happens after they click.'],
                    ['Button', 'Learn more'],
                    ['Campaign tag', 'spring-offer']
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94A3B8', marginBottom: '0.2rem' }}>{label}</dt>
                      <dd style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#FFFFFF', padding: '0.55rem 0.75rem', borderRadius: '8px', background: '#1E293B' }}>{value}</dd>
                    </div>
                  ))}
                </dl>
              </ExampleCard>
            </div>
          )}

          {activeBuilderTab === 'emails' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '2.5rem', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
                  A place in the left rail
                </span>
                <h3 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', margin: '0.4rem 0 0.85rem' }}>
                  {VIEW_LABEL['email-studio']}
                </h3>
                <p style={{ fontSize: '0.925rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                  Write the emails that follow a signup, and choose when each one sends. The same emails open in Email Studio.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '2rem' }}>
                  <Point>Each email has a subject and a send time.</Point>
                  <Point>A follow-up step on the canvas uses the flow you edit in Email Studio.</Point>
                  <Point>Open rates stay blank until mail tracking is turned on.</Point>
                </div>
                <CanvasLink note="This opens Funnel Canvas. Email Studio is in the left rail." onNavigate={onNavigate} />
              </div>
              <ExampleCard title="Follow-up emails">
                <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.65rem', margin: 0, padding: 0 }}>
                  {[
                    ['Sends right away', 'Thanks for signing up'],
                    ['Sends the next day', 'Here is what happens next'],
                    ['Sends in three days', 'Still want help with this?']
                  ].map(([when, subject], index) => (
                    <li key={subject} style={{ padding: '0.8rem 0.9rem', borderRadius: '8px', background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#94A3B8' }}>Email {index + 1}. {when}</div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#FFFFFF', marginTop: '0.25rem' }}>{subject}</div>
                    </li>
                  ))}
                </ol>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0.85rem 0 0' }}>
                  Opens are not shown here. They stay blank until mail tracking is turned on.
                </p>
              </ExampleCard>
            </div>
          )}

          {activeBuilderTab === 'forms' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '2.5rem', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
                  A step on the canvas
                </span>
                <h3 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', margin: '0.4rem 0 0.85rem' }}>
                  {stepLabel('lead-form')}
                </h3>
                <p style={{ fontSize: '0.925rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                  A lead form is a step on the canvas. Ask for a name, an email, and any other question you add. Write the message people see after they submit.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '2rem' }}>
                  <Point>Each question can be required or optional.</Point>
                  <Point>You write the button label and the confirmation message.</Point>
                  <Point>Submitting the form does not email your team from this step.</Point>
                </div>

                <CanvasLink note="This opens Funnel Canvas. Add a lead form step there." onNavigate={onNavigate} />
              </div>
              <ExampleCard title="Lead form">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {[
                    ['Full name (required)', ''],
                    ['Work email (required)', ''],
                    ['What do you need help with?', '']
                  ].map(([label]) => (
                    <div key={label}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#CBD5E1', marginBottom: '0.25rem' }}>{label}</div>
                      <div style={{ height: '36px', borderRadius: '6px', background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.12)' }} />
                    </div>
                  ))}
                  <div style={{ marginTop: '0.35rem', textAlign: 'center', padding: '0.7rem', borderRadius: '8px', background: '#6366F1', color: '#FFFFFF', fontSize: '0.85rem', fontWeight: 700 }}>
                    Send
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0.25rem 0 0' }}>
                    After they submit, they see the confirmation message you write. This picture does not send anything.
                  </p>
                </div>
              </ExampleCard>
            </div>
          )}

          {activeBuilderTab === 'tracking' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '2.5rem', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
                  A place in the left rail
                </span>
                <h3 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', margin: '0.4rem 0 0.85rem' }}>
                  {VIEW_LABEL.attribution}
                </h3>
                <p style={{ fontSize: '0.925rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                  Attribution shows results by channel for the journey you have open. The cells fill in after orders are matched. Until then they stay blank.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '2rem' }}>
                  <Point>Each channel row can show ad spend, clicks, orders, and {ROAS_STAT_NAME}.</Point>
                  <Point>The date range is the last 7 days, the last 30 days, or all time.</Point>
                  <Point>You enter ad spend on the ad source step. Attribution does not guess it.</Point>
                </div>
                <CanvasLink note="This opens Funnel Canvas. Attribution is in the left rail." onNavigate={onNavigate} />
              </div>
              <ExampleCard title="Results by channel">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: '420px' }}>
                    <caption style={{ captionSide: 'bottom', textAlign: 'left', color: '#94A3B8', fontSize: '0.75rem', paddingTop: '0.75rem' }}>
                      Example. These cells fill in after orders are matched to a channel.
                    </caption>
                    <thead>
                      <tr>
                        {['Channel', 'Ad spend', 'Clicks', 'Orders', ROAS_STAT_NAME].map((heading) => (
                          <th key={heading} scope="col" style={{ textAlign: 'left', color: '#94A3B8', fontWeight: 700, padding: '0.4rem 0.45rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row" style={{ textAlign: 'left', color: '#FFFFFF', fontWeight: 700, padding: '0.7rem 0.45rem' }}>Meta</th>
                        {['Not yet', 'Not yet', 'Not yet', 'Not yet'].map((cell, index) => (
                          <td key={index} style={{ color: '#94A3B8', padding: '0.7rem 0.45rem' }}>{cell}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </ExampleCard>
            </div>
          )}
        </div>

        {/* ── ARCHITECTURAL COMPARISON MATRIX ── */}
        <div style={{ marginTop: '5rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
              Compared
            </span>
            <h3 id="home-compare-heading" style={{ fontSize: 'clamp(1.75rem, 3.5vw, 2.25rem)', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '0.4rem', color: '#FFFFFF' }}>
              Other tools and Jourvance
            </h3>
            <p style={{ fontSize: '0.95rem', color: '#94A3B8', maxWidth: '650px', margin: '0.5rem auto 0' }}>
              Starter is free. Growth Pro is one price, with no fee on each order.
            </p>
          </div>

          <div
            style={{
              backgroundColor: '#0F172A',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)'
            }}
          >
            <div style={{ overflowX: 'auto' }}>
            <table aria-labelledby="home-compare-heading" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', minWidth: '640px' }}>
              <thead>
                <tr style={{ backgroundColor: '#1E293B' }}>
                  <th scope="col" style={{ textAlign: 'left', padding: '1.25rem 1.5rem', color: '#94A3B8', fontWeight: 800 }}>What</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '1.25rem 1.5rem', color: '#FCA5A5', fontWeight: 800 }}>Other tools</th>
                  <th scope="col" style={{ textAlign: 'left', padding: '1.25rem 1.5rem', color: '#6EE7B7', fontWeight: 800 }}>Jourvance</th>
                </tr>
              </thead>
              <tbody>
            {[
              { cap: 'Funnel Canvas', oldWay: 'A diagram in another tool, separate from the live pages', newWay: 'The map, the pages, and the follow-up in one place' },
              { cap: 'Landing pages', oldWay: 'A separate page builder subscription', newWay: 'Pages built in, including a phone layout' },
              { cap: 'Ad sources', oldWay: 'Campaign links kept in a spreadsheet', newWay: 'Ad links with the campaign tag filled in' },
              { cap: 'Follow-up email', oldWay: 'A separate email tool and a connector that can break', newWay: 'Follow-up email connected to your forms' },
              { cap: 'Lead forms', oldWay: 'A separate form tool with a cap on replies', newWay: 'Forms with the questions you choose' },
              { cap: 'Test funnel', oldWay: 'Publish first, then find out what the page says', newWay: 'Walk the journey before you send people to it. Nothing is sent or charged.' },
              { cap: 'Shared data', oldWay: 'A connector between tools that can break', newWay: 'The steps share the same journey' },
              { cap: 'Billing', oldWay: 'A separate invoice for each tool', newWay: 'Starter is free. Growth Pro is $49 a month, or $39 a month billed yearly.' }
            ].map((row, i) => (
              <tr key={row.cap} style={{ backgroundColor: i % 2 === 0 ? 'rgba(255, 255, 255, 0.015)' : 'transparent' }}>
                <th scope="row" style={{ textAlign: 'left', padding: '1.15rem 1.5rem', fontWeight: 700, color: '#F1F5F9', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>{row.cap}</th>
                <td style={{ padding: '1.15rem 1.5rem', color: '#94A3B8', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>{row.oldWay}</td>
                <td style={{ padding: '1.15rem 1.5rem', color: '#FFFFFF', fontWeight: 600, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>{row.newWay}</td>
              </tr>
            ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </section>

      {/* ── PRICING SECTION ── */}
      <section
        style={{
          padding: '5rem 2rem 6rem',
          backgroundColor: '#070A12',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)'
        }}
      >
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
              Transparent Pricing
            </span>
            <h2 style={{ fontSize: 'clamp(2rem, 4vw, 2.75rem)', fontWeight: 800, letterSpacing: '-0.025em', marginTop: '0.5rem', marginBottom: '0.75rem' }}>
              Simple, Predictable Plans for Growing Brands & Businesses
            </h2>
            <p style={{ fontSize: '1rem', color: '#94A3B8', maxWidth: '580px', margin: '0 auto 1.5rem' }}>
              Transparent, founder-friendly pricing with zero transaction cuts or surprise fees.
            </p>

            {/* Billing Cycle Switcher */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                backgroundColor: '#1E293B',
                borderRadius: '9999px',
                padding: '0.25rem',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <button
                type="button"
                onClick={() => setBillingCycle('monthly')}
                style={{
                  padding: '0.4rem 1.1rem',
                  borderRadius: '9999px',
                  border: 'none',
                  backgroundColor: billingCycle === 'monthly' ? '#6366F1' : 'transparent',
                  color: '#FFFFFF',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle('annual')}
                style={{
                  padding: '0.4rem 1.1rem',
                  borderRadius: '9999px',
                  border: 'none',
                  backgroundColor: billingCycle === 'annual' ? '#6366F1' : 'transparent',
                  color: '#FFFFFF',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}
              >
                <span>Annual</span>
                <span
                  style={{
                    fontSize: '0.65rem',
                    fontWeight: 800,
                    backgroundColor: '#10B981',
                    color: '#FFFFFF',
                    padding: '0.1rem 0.45rem',
                    borderRadius: '9999px'
                  }}
                >
                  Save 20%
                </span>
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '2rem' }}>
            {/* Tier 1: Free Starter Studio */}
            <div
              style={{
                backgroundColor: '#111827',
                borderRadius: '16px',
                padding: '2.5rem 2rem',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.4rem', color: '#FFFFFF' }}>
                Starter Studio
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#94A3B8', marginBottom: '1.5rem' }}>
                Ideal for mapping journeys and launching your first high-converting offer.
              </p>
              <div style={{ marginBottom: '1.75rem' }}>
                <span style={{ fontSize: '2.75rem', fontWeight: 900, color: '#FFFFFF' }}>$0</span>
                <span style={{ color: '#64748B', fontSize: '0.9rem' }}> / forever</span>
              </div>
              <button
                onClick={() => onNavigate('canvas')}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginBottom: '1.75rem',
                  transition: 'background 0.2s ease'
                }}
              >
                {VIEW_LABEL.canvas}
              </button>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem', color: '#CBD5E1' }}>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Interactive Node Canvas</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Turnkey Lead Capture Blueprint</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Live Funnel & Mobile Preview</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Local Browser Auto-Save</span>
                </li>
              </ul>
            </div>

            {/* Tier 2: Growth Pro (Featured) */}
            <div
              style={{
                backgroundColor: '#1E293B',
                borderRadius: '16px',
                padding: '2.5rem 2rem',
                border: '2px solid #6366F1',
                boxShadow: '0 10px 30px rgba(99, 102, 241, 0.25)',
                position: 'relative'
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '-12px',
                  right: '20px',
                  backgroundColor: '#6366F1',
                  color: '#FFFFFF',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '9999px',
                  letterSpacing: '0.05em'
                }}
              >
                Most Popular
              </div>

              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.4rem', color: '#FFFFFF' }}>
                Growth Pro
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#94A3B8', marginBottom: '1.5rem' }}>
                For more journeys, follow-up email, and checkout.
              </p>
              <div style={{ marginBottom: '1.75rem' }}>
                <span style={{ fontSize: '2.75rem', fontWeight: 900, color: '#FFFFFF' }}>
                  {billingCycle === 'monthly' ? '$49' : '$39'}
                </span>
                <span style={{ color: '#94A3B8', fontSize: '0.9rem' }}>
                  {billingCycle === 'monthly' ? ' / month' : ' / mo (billed annually)'}
                </span>
              </div>
              <button
                onClick={() => (onOpenBilling ? onOpenBilling() : onNavigate('canvas'))}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
                  border: 'none',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  cursor: 'pointer',
                  marginBottom: '1.75rem',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.4)'
                }}
              >
                Checkout for Growth Pro
              </button>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem', color: '#F1F5F9' }}>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Unlimited Journeys & Pipelines</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Follow-up email and cart recovery</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Multi-Store Shopify Sync & Attribution</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Hub Brain AI Copywriting Assistant</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Custom Domain Publishing</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Zero Transaction or Lead Fees</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ SECTION ── */}
      <section style={{ padding: '5rem 2rem', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h2 style={{ fontSize: 'clamp(1.75rem, 3vw, 2.25rem)', fontWeight: 800, letterSpacing: '-0.025em' }}>
            Frequently Asked Questions
          </h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {faqs.map((faq, idx) => (
            <div
              key={idx}
              style={{
                backgroundColor: '#111827',
                borderRadius: '10px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                overflow: 'hidden'
              }}
            >
              <button
                onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '1.25rem 1.5rem',
                  background: 'none',
                  border: 'none',
                  color: '#FFFFFF',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  textAlign: 'left',
                  cursor: 'pointer'
                }}
              >
                <span>{faq.q}</span>
                <ChevronDown
                  style={{
                    width: '18px',
                    height: '18px',
                    color: '#94A3B8',
                    transform: openFaq === idx ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s ease'
                  }}
                />
              </button>
              {openFaq === idx && (
                <div
                  style={{
                    padding: '0 1.5rem 1.25rem',
                    fontSize: '0.875rem',
                    lineHeight: 1.6,
                    color: '#94A3B8',
                    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                    paddingTop: '0.75rem'
                  }}
                >
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── FINAL CTA BANNER ── */}
      <section style={{ padding: '4rem 2rem 6rem', maxWidth: '1000px', margin: '0 auto' }}>
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(30, 41, 59, 0.8) 100%)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: '20px',
            padding: '4rem 2rem',
            textAlign: 'center',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)'
          }}
        >
          <h2 style={{ fontSize: 'clamp(2rem, 3.5vw, 2.75rem)', fontWeight: 800, marginBottom: '1rem', color: '#FFFFFF' }}>
            Put your next marketing idea into action.
          </h2>
          <p style={{ fontSize: '1.05rem', color: '#CBD5E1', maxWidth: '600px', margin: '0 auto 2rem' }}>
            Open the canvas, start with a blueprint, and build a customer journey around your business.
          </p>
          <button
            onClick={() => onNavigate('canvas')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.6rem',
              padding: '0.9rem 2.25rem',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              color: '#FFFFFF',
              fontSize: '1rem',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(99, 102, 241, 0.5)'
            }}
          >
            <span>{VIEW_LABEL.canvas}</span>
            <ArrowRight style={{ width: '18px', height: '18px' }} />
          </button>
        </div>
      </section>
    </div>
  );
};
