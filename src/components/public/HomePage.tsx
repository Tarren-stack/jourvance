import React, { useState } from 'react';
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
  Download,
  Check,
  X
} from 'lucide-react';

interface HomePageProps {
  onNavigate: (page: 'home' | 'about' | 'blog' | 'contact' | 'canvas') => void;
  onTestJourney: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onNavigate, onTestJourney }) => {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [activeBuilderTab, setActiveBuilderTab] = useState<'map' | 'pages' | 'ads' | 'emails' | 'forms' | 'tracking'>('map');
  const [pagePreviewDevice, setPagePreviewDevice] = useState<'desktop' | 'mobile'>('desktop');

  const faqs = [
    {
      q: 'What makes Jourvance different from standard funnel builders like ClickFunnels or GoHighLevel?',
      a: 'Traditional funnel builders force you to build pages in isolation, configure automations in separate menus, and guess where drop-offs happen. Jourvance places your entire customer journey — advertising hooks, landing page blocks, intake forms, and automated email nurture — onto a single interactive visual canvas. You see the complete picture and test the live prospect experience before spending money on traffic.'
    },
    {
      q: 'Do I need any coding or design skills to use Jourvance?',
      a: 'Zero. Jourvance comes out-of-the-box with a pre-wired Turnkey Lead Capture Blueprint. You get high-converting ad copy layouts, single-offer landing page structures, and follow-up email sequences ready to go. You can customize text and delays in slide-over inspector drawers without touching a line of code.'
    },
    {
      q: 'Does Jourvance charge per-lead or transaction fees?',
      a: 'No. Unlike platforms that penalize your growth by charging per contact or taking a percentage of your revenue, Jourvance gives you unlimited journeys, leads, and forms for a flat $49/mo on our Pro plan.'
    },
    {
      q: 'Can I simulate the funnel as a real prospect before publishing?',
      a: 'Yes! The Live Funnel Simulator is built right in. Click "Live Simulator" and walk through your ad, experience your landing page, submit the intake form, and watch the email sequence dispatch in real time.'
    }
  ];

  return (
    <div style={{ backgroundColor: '#0B0F19', color: '#F8FAFC' }}>
      {/* ── HERO SECTION ── */}
      <section
        style={{
          position: 'relative',
          padding: '5rem 2rem 4rem',
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
            <span>Universal SaaS for all businesses • Live on jourvance.com</span>
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
            Map, Build & Convert Your Entire Customer Journey on One Visual Canvas
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
            Stop losing qualified leads between disconnected ad dashboards, landing page builders, and email silos.
            Design your full conversion pipeline from first ad click to booked customer on a live interactive canvas.
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
              <span>Launch Studio Canvas</span>
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
              <span>Watch Live Funnel Simulation</span>
            </button>
          </div>

          {/* ── INTERACTIVE CANVAS VISUAL MOCKUP ── */}
          <div
            style={{
              position: 'relative',
              borderRadius: '16px',
              padding: '1.75rem',
              background: 'rgba(17, 24, 39, 0.75)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 40px rgba(99, 102, 241, 0.15)',
              textAlign: 'left'
            }}
          >
            {/* Top Toolbar Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: '1.25rem',
                marginBottom: '1.5rem',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#EF4444' }} />
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#F59E0B' }} />
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10B981' }} />
                <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', fontWeight: 600, color: '#94A3B8' }}>
                  Lead Capture Blueprint (Interactive Preview)
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: '#10B981',
                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '6px',
                    fontWeight: 600
                  }}
                >
                  Funnel Health: 94% Optimal
                </span>
                <button
                  onClick={() => onNavigate('canvas')}
                  style={{
                    background: 'none',
                    border: '1px solid rgba(99, 102, 241, 0.4)',
                    color: '#818CF8',
                    padding: '0.25rem 0.65rem',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Edit Canvas →
                </button>
              </div>
            </div>

            {/* 4 Connected Pipeline Cards */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '1.25rem',
                position: 'relative'
              }}
            >
              {/* Card 1: Ad Creative */}
              <div
                style={{
                  backgroundColor: '#1E293B',
                  borderRadius: '12px',
                  padding: '1.15rem',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: '#818CF8', fontWeight: 800 }}>
                    Step 1 • Traffic
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 700 }}>10.0% CTR</span>
                </div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.4rem', color: '#FFFFFF' }}>
                  Meta Video & Hook Ad
                </h4>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', lineHeight: 1.4, marginBottom: '0.75rem' }}>
                  "Scale your client pipeline without 5 messy tools."
                </p>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748B', paddingTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <span>1,200 Impressions</span>
                  <span>120 Clicks</span>
                </div>
              </div>

              {/* Card 2: Landing Page */}
              <div
                style={{
                  backgroundColor: '#1E293B',
                  borderRadius: '12px',
                  padding: '1.15rem',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: '#38BDF8', fontWeight: 800 }}>
                    Step 2 • Lander
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 700 }}>25.0% Opt-In</span>
                </div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.4rem', color: '#FFFFFF' }}>
                  Single-Offer Page
                </h4>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', lineHeight: 1.4, marginBottom: '0.75rem' }}>
                  Grounded headline, 3 value points, verified proof badge.
                </p>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748B', paddingTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <span>120 Visitors</span>
                  <span>30 Inquiries</span>
                </div>
              </div>

              {/* Card 3: Lead Form */}
              <div
                style={{
                  backgroundColor: '#1E293B',
                  borderRadius: '12px',
                  padding: '1.15rem',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: '#10B981', fontWeight: 800 }}>
                    Step 3 • Intake
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 700 }}>60.0% Submit</span>
                </div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.4rem', color: '#FFFFFF' }}>
                  3-Field Smart Form
                </h4>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', lineHeight: 1.4, marginBottom: '0.75rem' }}>
                  Friction-free: Full Name, Work Email, Phone Number.
                </p>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748B', paddingTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <span>30 Views</span>
                  <span>18 Leads</span>
                </div>
              </div>

              {/* Card 4: Follow-up Sequence */}
              <div
                style={{
                  backgroundColor: '#1E293B',
                  borderRadius: '12px',
                  padding: '1.15rem',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: '#F59E0B', fontWeight: 800 }}>
                    Step 4 • Nurture
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 700 }}>68% Open Rate</span>
                </div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.4rem', color: '#FFFFFF' }}>
                  Automated Sequence
                </h4>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', lineHeight: 1.4, marginBottom: '0.75rem' }}>
                  Letter 1 (0m) → Letter 2 (+24h) → Letter 3 (+48h).
                </p>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748B', paddingTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <span>18 Enrolled</span>
                  <span>12 Booked</span>
                </div>
              </div>
            </div>
          </div>
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
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
                  <span>All-in-one visual canvas: Ad, lander, intake form, and email timeline in one view.</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                  <span style={{ color: '#10B981', fontWeight: 700 }}>•</span>
                  <span>Live funnel simulator: Test drive the entire flow as a customer before going live.</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                  <span style={{ color: '#10B981', fontWeight: 700 }}>•</span>
                  <span>Flat $49/mo pricing: Zero lead caps, zero transaction markups, zero hidden fees.</span>
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
            The Complete Conversion Platform
          </span>
          <h2 style={{ fontSize: 'clamp(2rem, 4vw, 2.75rem)', fontWeight: 800, letterSpacing: '-0.025em', marginTop: '0.5rem', color: '#FFFFFF' }}>
            Five Dedicated Builders. One Intelligent Pipeline Map.
          </h2>
          <p style={{ fontSize: '1.05rem', color: '#94A3B8', maxWidth: '720px', margin: '0.75rem auto 0', lineHeight: 1.6 }}>
            Stop subscribing to 5 disconnected tools. Jourvance unites your landing pages, ad creatives, lead intake forms, and automated email follow-ups on a single interactive canvas.
          </p>
        </div>

        {/* Builder Tab Switcher Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
            marginBottom: '2.5rem'
          }}
        >
          {[
            { id: 'map', label: 'Visual Journey Map', icon: Layers },
            { id: 'pages', label: 'Landing Page Builder', icon: Globe },
            { id: 'ads', label: 'Ad Creative Studio', icon: Share2 },
            { id: 'emails', label: 'Email Drip Sequencer', icon: Mail },
            { id: 'forms', label: 'Lead Intake Forms', icon: FileText },
            { id: 'tracking', label: 'Pipeline Tracking', icon: BarChart3 }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeBuilderTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveBuilderTab(tab.id as any)}
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
                  transition: 'all 0.2s ease',
                  boxShadow: isActive ? '0 4px 14px rgba(99, 102, 241, 0.25)' : 'none'
                }}
              >
                <Icon size={16} color={isActive ? '#818CF8' : '#64748B'} />
                <span>{tab.label}</span>
              </button>
            );
          })}
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
          {/* TAB 1: VISUAL JOURNEY MAP */}
          {activeBuilderTab === 'map' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2.5rem', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
                  The Master Orchestrator
                </span>
                <h3 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', margin: '0.4rem 0 0.85rem' }}>
                  Visual Customer Journey Canvas
                </h3>
                <p style={{ fontSize: '0.925rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                  Traditional setups keep your ads in Meta Ads Manager, your pages in Unbounce, your forms in Typeform, and your follow-ups in ActiveCampaign. Jourvance places your entire pipeline onto a living visual graph with live conversion-rate edges between every step.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Full-Funnel Graphing:</strong> Connect ads to pages to forms to follow-up drips with one click.</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Live Conversion Edges:</strong> See exact click-through and drop-off percentages along each connector.</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Instant Simulator:</strong> Test-drive the entire prospect experience before spending a dollar.</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <button
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
                    <span>Launch Journey Studio</span>
                    <ArrowRight size={16} />
                  </button>
                  <span style={{ fontSize: '0.8rem', color: '#64748B' }}>Replaces: Miro, Lucidchart & Funnelytics</span>
                </div>
              </div>

              {/* Map Preview Graphic */}
              <div
                style={{
                  backgroundColor: '#070A12',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '14px',
                  padding: '1.75rem',
                  boxShadow: 'inset 0 2px 10px rgba(0, 0, 0, 0.5)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981' }} />
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#F1F5F9' }}>Interactive Pipeline Graph</span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.12)', padding: '0.2rem 0.6rem', borderRadius: '6px', fontWeight: 600 }}>
                    10.0% Pipeline Conversion
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1rem', borderRadius: '10px', background: '#1E293B', border: '1px solid rgba(99, 102, 241, 0.25)' }}>
                    <div>
                      <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#818CF8', fontWeight: 800 }}>TRAFFIC SOURCE</span>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#FFFFFF' }}>Meta Video Hook Ad</div>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#38BDF8', fontWeight: 700 }}>1,200 Imp · 120 Clicks</span>
                  </div>

                  <div style={{ textAlign: 'center', color: '#818CF8', fontSize: '0.75rem', fontWeight: 700 }}>
                    ↓ 10.0% Click-Through Rate
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1rem', borderRadius: '10px', background: '#1E293B', border: '1px solid rgba(99, 102, 241, 0.25)' }}>
                    <div>
                      <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#38BDF8', fontWeight: 800 }}>DESTINATION</span>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#FFFFFF' }}>Single-Offer Consultation Page</div>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 700 }}>120 Visitors · 30.0% Conv</span>
                  </div>

                  <div style={{ textAlign: 'center', color: '#10B981', fontSize: '0.75rem', fontWeight: 700 }}>
                    ↓ 30.0% Form Opt-In Rate
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1rem', borderRadius: '10px', background: '#1E293B', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                    <div>
                      <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#10B981', fontWeight: 800 }}>LEAD NURTURE</span>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#FFFFFF' }}>3-Step Automated Intake Drip</div>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 700 }}>36 Leads Enrolled</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: LANDING PAGE BUILDER */}
          {activeBuilderTab === 'pages' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2.5rem', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
                  High-Speed Conversion Engineering
                </span>
                <h3 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', margin: '0.4rem 0 0.85rem' }}>
                  Full Website & Landing Page Builder
                </h3>
                <p style={{ fontSize: '0.925rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                  Generic website builders overwhelm visitors with navigation menus and generic copy. Jourvance builds focused, single-offer landing pages designed for one action: turning an interested visitor into a qualified lead.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Contextual Handshake:</strong> Match landing page headlines precisely to your ad hooks.</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Zero-Bloat Performance:</strong> Loads under 600ms on mobile devices for maximum ad Quality Score.</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>1-Click HTML & Custom Domain:</strong> Host directly on your custom domain or export self-contained HTML.</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <button
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
                    <span>Build Landing Page</span>
                    <ArrowRight size={16} />
                  </button>
                  <span style={{ fontSize: '0.8rem', color: '#64748B' }}>Replaces: Unbounce ($99/mo) & Instapage ($149/mo)</span>
                </div>
              </div>

              {/* Page Builder Preview */}
              <div
                style={{
                  backgroundColor: '#070A12',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '14px',
                  overflow: 'hidden',
                  boxShadow: 'inset 0 2px 10px rgba(0, 0, 0, 0.5)'
                }}
              >
                {/* Viewport bar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: '#1E293B', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#EF4444' }} />
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F59E0B' }} />
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981' }} />
                    <span style={{ fontSize: '0.75rem', color: '#94A3B8', marginLeft: '6px', fontFamily: 'monospace' }}>jourvance.com/p/consultation</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      onClick={() => setPagePreviewDevice('desktop')}
                      style={{ padding: '3px 8px', borderRadius: '5px', fontSize: '0.7rem', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: pagePreviewDevice === 'desktop' ? '#6366F1' : 'transparent', color: '#FFF', cursor: 'pointer' }}
                    >
                      <Laptop size={12} />
                    </button>
                    <button
                      onClick={() => setPagePreviewDevice('mobile')}
                      style={{ padding: '3px 8px', borderRadius: '5px', fontSize: '0.7rem', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: pagePreviewDevice === 'mobile' ? '#6366F1' : 'transparent', color: '#FFF', cursor: 'pointer' }}
                    >
                      <Smartphone size={12} />
                    </button>
                  </div>
                </div>

                <div style={{ padding: pagePreviewDevice === 'mobile' ? '1.5rem 1rem' : '2.25rem 1.75rem', maxWidth: pagePreviewDevice === 'mobile' ? '320px' : '100%', margin: '0 auto', textAlign: 'center' }}>
                  <span style={{ display: 'inline-block', fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#818CF8', background: 'rgba(99, 102, 241, 0.12)', padding: '0.25rem 0.75rem', borderRadius: '9999px', marginBottom: '0.85rem' }}>
                    Limited Availability
                  </span>
                  <h4 style={{ fontSize: pagePreviewDevice === 'mobile' ? '1.25rem' : '1.5rem', fontWeight: 800, color: '#FFFFFF', lineHeight: 1.3, marginBottom: '0.75rem' }}>
                    Transform Inbound Ad Clicks Into Scheduled Appointments
                  </h4>
                  <p style={{ fontSize: '0.825rem', color: '#94A3B8', marginBottom: '1.25rem' }}>
                    Stop sending paid traffic to a cluttered homepage. Book your private strategic consultation today.
                  </p>
                  <div style={{ textAlign: 'left', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', padding: '0.85rem', marginBottom: '1.25rem' }}>
                    <div style={{ fontSize: '0.75rem', color: '#E2E8F0', marginBottom: '0.4rem' }}>✓ 1-on-1 Funnel Diagnosis & Bottleneck Audit</div>
                    <div style={{ fontSize: '0.75rem', color: '#E2E8F0', marginBottom: '0.4rem' }}>✓ Turnkey Ad-to-Email Architecture Blueprint</div>
                    <div style={{ fontSize: '0.75rem', color: '#E2E8F0' }}>✓ Guaranteed zero contract commitment</div>
                  </div>
                  <button style={{ width: '100%', padding: '0.85rem', borderRadius: '8px', background: '#6366F1', color: '#FFFFFF', fontSize: '0.85rem', fontWeight: 700, border: 'none' }}>
                    Claim Your Consultation Spot
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: AD CREATIVE STUDIO */}
          {activeBuilderTab === 'ads' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2.5rem', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
                  Audience Acquisition
                </span>
                <h3 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', margin: '0.4rem 0 0.85rem' }}>
                  Multi-Channel Ad Creative Studio
                </h3>
                <p style={{ fontSize: '0.925rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                  Don't draft ad copy in Google Docs and lose track of which angle connects to which page. Jourvance formats your ad copy, headlines, and hooks directly inside the pipeline, generating synchronized UTM links automatically.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Multi-Format Mockups:</strong> Preview Meta Feed, Google Search, and Stories instantly.</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Automated UTM Tagging:</strong> Injects tracking parameters seamlessly to eliminate attribution guessing.</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Hook Variation Generator:</strong> Test pain, urgency, and outcome angles with AI assistance.</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <button
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
                    <span>Design Ad Campaign</span>
                    <ArrowRight size={16} />
                  </button>
                  <span style={{ fontSize: '0.8rem', color: '#64748B' }}>Replaces: Ad copy docs & UTM spreadsheet chaos</span>
                </div>
              </div>

              {/* Ad Creative Mockup */}
              <div
                style={{
                  backgroundColor: '#0F172A',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '14px',
                  padding: '1.5rem',
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.85rem' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, #6366F1, #8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFF', fontWeight: 800 }}>
                    J
                  </div>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#FFFFFF' }}>Jourvance Partner</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748B' }}>Sponsored · Paid Traffic</div>
                  </div>
                </div>

                <p style={{ fontSize: '0.85rem', color: '#E2E8F0', lineHeight: 1.45, marginBottom: '0.85rem' }}>
                  "Are you leaking 40% of ad clicks between your creative and your calendar? Discover how visual customer journeys double your qualified pipeline."
                </p>

                <div style={{ width: '100%', height: '140px', borderRadius: '8px', background: 'linear-gradient(135deg, #1E1B4B, #312E81)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.85rem' }}>
                  <div style={{ textAlign: 'center', padding: '1rem' }}>
                    <span style={{ fontSize: '0.65rem', color: '#818CF8', fontWeight: 800, textTransform: 'uppercase' }}>Turnkey Funnel Architecture</span>
                    <div style={{ fontSize: '1rem', fontWeight: 800, color: '#FFFFFF', marginTop: '0.35rem' }}>Stop The 5-Tool Fragmentation Tax</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '8px' }}>
                  <div>
                    <div style={{ fontSize: '0.65rem', color: '#64748B', textTransform: 'uppercase' }}>JOURVANCE.COM</div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#FFFFFF' }}>Claim Free Pipeline Blueprint</div>
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0.35rem 0.75rem', borderRadius: '6px', background: '#6366F1', color: '#FFFFFF' }}>
                    Learn More
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: EMAIL DRIP SEQUENCER */}
          {activeBuilderTab === 'emails' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2.5rem', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
                  Automated Conversion Nurture
                </span>
                <h3 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', margin: '0.4rem 0 0.85rem' }}>
                  Email & Drip Sequence Builder
                </h3>
                <p style={{ fontSize: '0.925rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                  Leads turn cold within hours if follow-ups are delayed or disconnected. Jourvance sequences timed automated emails triggered instantly upon form completion to maintain conversion momentum.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Timed Behavioral Delays:</strong> Day 0 confirmation, Day 1 authority case study, Day 3 closing push.</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Dynamic Merge Fields:</strong> Insert prospect names, phone numbers, and custom answers automatically.</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>1-Click Sequence Export:</strong> Copy formatted markdown or push directly to your CRM webhook.</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <button
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
                    <span>Configure Drip Sequence</span>
                    <ArrowRight size={16} />
                  </button>
                  <span style={{ fontSize: '0.8rem', color: '#64748B' }}>Replaces: ActiveCampaign ($49/mo) & ConvertKit ($29/mo)</span>
                </div>
              </div>

              {/* Email Drip Mockup */}
              <div
                style={{
                  backgroundColor: '#070A12',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '14px',
                  padding: '1.5rem'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.85rem', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#FFFFFF' }}>Automated Drip Sequence</div>
                  <span style={{ fontSize: '0.75rem', color: '#38BDF8', fontWeight: 700 }}>3 Emails Configured</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ padding: '0.85rem', borderRadius: '8px', background: '#1E293B', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                      <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#10B981', textTransform: 'uppercase' }}>EMAIL 1 • INSTANT (DAY 0)</span>
                      <span style={{ fontSize: '0.7rem', color: '#64748B' }}>58% Open Rate</span>
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#FFFFFF' }}>Your Consultation Pass & Blueprint Access</div>
                    <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: '0.2rem' }}>Hi Sarah, thank you for requesting access to our pipeline...</div>
                  </div>

                  <div style={{ padding: '0.85rem', borderRadius: '8px', background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                      <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#818CF8', textTransform: 'uppercase' }}>EMAIL 2 • 24H DELAY (DAY 1)</span>
                      <span style={{ fontSize: '0.7rem', color: '#64748B' }}>44% Open Rate</span>
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#FFFFFF' }}>The 3 hidden leaks in your customer funnel</div>
                    <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: '0.2rem' }}>Yesterday we shared your initial blueprint. Today I want to show...</div>
                  </div>

                  <div style={{ padding: '0.85rem', borderRadius: '8px', background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                      <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#F59E0B', textTransform: 'uppercase' }}>EMAIL 3 • 72H DELAY (DAY 3)</span>
                      <span style={{ fontSize: '0.7rem', color: '#64748B' }}>39% Open Rate</span>
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#FFFFFF' }}>Holding your onboarding spot for this week</div>
                    <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: '0.2rem' }}>Just checking in to see if you had questions before our schedule fills...</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: LEAD INTAKE & FORM BUILDER */}
          {activeBuilderTab === 'forms' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2.5rem', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
                  Frictionless Qualification
                </span>
                <h3 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', margin: '0.4rem 0 0.85rem' }}>
                  Intake & Lead Capture Form Builder
                </h3>
                <p style={{ fontSize: '0.925rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                  Long, tedious forms ruin conversions, while overly simple forms bring unqualified spam. Jourvance gives you an intuitive form builder to capture qualified prospects and route submissions immediately to your sales inbox or CRM.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Custom Qualification Inputs:</strong> Add phone, budget ranges, and service interest with ease.</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Instant Team Alerts:</strong> Receive notifications the second a high-value lead submits.</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Custom Success States:</strong> Display personalized confirmation copy or redirect to your booking calendar.</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <button
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
                    <span>Create Intake Form</span>
                    <ArrowRight size={16} />
                  </button>
                  <span style={{ fontSize: '0.8rem', color: '#64748B' }}>Replaces: Typeform ($35/mo) & Jotform ($39/mo)</span>
                </div>
              </div>

              {/* Form Mockup */}
              <div
                style={{
                  backgroundColor: '#0F172A',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '14px',
                  padding: '1.75rem',
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)'
                }}
              >
                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '0.35rem' }}>
                  Strategic Intake Application
                </div>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', marginBottom: '1.25rem' }}>
                  Verify your consultation qualification details.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#CBD5E1', marginBottom: '0.25rem' }}>Full Name *</label>
                    <input type="text" readOnly value="Sarah Mitchell" style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '6px', background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '0.8rem' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#CBD5E1', marginBottom: '0.25rem' }}>Work Email *</label>
                    <input type="email" readOnly value="sarah@zelusmarketing.com" style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '6px', background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '0.8rem' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#CBD5E1', marginBottom: '0.25rem' }}>Monthly Ad Budget</label>
                    <input type="text" readOnly value="$5,000 - $15,000 / mo" style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '6px', background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#FFFFFF', fontSize: '0.8rem' }} />
                  </div>
                  <button style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: '#6366F1', color: '#FFFFFF', fontSize: '0.85rem', fontWeight: 700, border: 'none', marginTop: '0.5rem' }}>
                    Confirm & Reserve Consultation
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: PIPELINE TRACKING & ANALYTICS */}
          {activeBuilderTab === 'tracking' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2.5rem', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
                  Clarity Over Confusion
                </span>
                <h3 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', margin: '0.4rem 0 0.85rem' }}>
                  Pipeline Attribution & Drop-Off Analytics
                </h3>
                <p style={{ fontSize: '0.925rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                  Most marketers don't know where their funnels leak. Jourvance computes throughput across every connecting edge, showing you exact traffic volumes, conversion percentages, and drop-off alerts at every stage.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Visual Bottleneck Alerts:</strong> Immediately flags steps with abnormal drop-offs in red.</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>True Cost-Per-Acquisition:</strong> Measure cost-per-lead and cost-per-booked client accurately.</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem', color: '#E2E8F0' }}>
                    <CheckCircle2 size={16} color="#10B981" />
                    <span><strong>Hub Telemetry Integration:</strong> Backed by Zelus Labs telemetry tracking with zero cookie clutter.</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <button
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
                    <span>View Pipeline Telemetry</span>
                    <ArrowRight size={16} />
                  </button>
                  <span style={{ fontSize: '0.8rem', color: '#64748B' }}>Replaces: Complex Google Analytics 4 goals</span>
                </div>
              </div>

              {/* Analytics Graph Mockup */}
              <div
                style={{
                  backgroundColor: '#070A12',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '14px',
                  padding: '1.5rem'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.85rem', marginBottom: '1.25rem' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#FFFFFF' }}>Conversion Health Radar</div>
                  <span style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 700 }}>94% Funnel Health</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                  <div style={{ background: '#1E293B', padding: '1rem', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                    <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>Top-of-Funnel CTR</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#38BDF8', marginTop: '0.2rem' }}>10.0%</div>
                    <div style={{ fontSize: '0.65rem', color: '#10B981', marginTop: '0.2rem' }}>+3.2% vs industry avg</div>
                  </div>
                  <div style={{ background: '#1E293B', padding: '1rem', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                    <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>Opt-In Rate</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10B981', marginTop: '0.2rem' }}>30.0%</div>
                    <div style={{ fontSize: '0.65rem', color: '#10B981', marginTop: '0.2rem' }}>36 Leads Generated</div>
                  </div>
                </div>

                <div style={{ background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.2)', borderRadius: '10px', padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#FFFFFF' }}>Pipeline Conversion Flow</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#818CF8' }}>36 / 120 (30%)</span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '9999px', overflow: 'hidden' }}>
                    <div style={{ width: '30%', height: '100%', background: 'linear-gradient(90deg, #6366F1, #10B981)' }} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── ARCHITECTURAL COMPARISON MATRIX ── */}
        <div style={{ marginTop: '5rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
              Why Consolidate
            </span>
            <h3 style={{ fontSize: 'clamp(1.75rem, 3.5vw, 2.25rem)', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '0.4rem', color: '#FFFFFF' }}>
              The Fragmented Stack vs. The Jourvance Unified Engine
            </h3>
            <p style={{ fontSize: '0.95rem', color: '#94A3B8', maxWidth: '650px', margin: '0.5rem auto 0' }}>
              See how replacing 5 point-solutions saves over $2,400 per year while providing a 10x smoother experience.
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
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1.5fr 1.5fr',
                padding: '1.25rem 1.5rem',
                backgroundColor: '#1E293B',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                fontWeight: 800,
                fontSize: '0.85rem'
              }}
            >
              <span style={{ color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Capability</span>
              <span style={{ color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>The Fragmented Stack ($250+/mo)</span>
              <span style={{ color: '#10B981', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Jourvance ($49/mo Flat)</span>
            </div>

            {[
              { cap: 'Visual Customer Journey Modeling', oldWay: 'Manual diagrams in Miro (no code or live pages)', newWay: 'Fully interactive canvas wired to real live assets' },
              { cap: 'Full Landing Page Builder', oldWay: 'Separate subscription to Unbounce ($99/mo)', newWay: 'Single-offer responsive pages built in' },
              { cap: 'Multi-Channel Ad Creative Studio', oldWay: 'Messy spreadsheets with broken UTM links', newWay: 'Unified ad studio with automated UTM generator' },
              { cap: 'Automated Email Drip Sequences', oldWay: 'ActiveCampaign ($49/mo) with complex zaps', newWay: 'Timed follow-up sequencer connected to your forms' },
              { cap: 'Lead Intake & Qualifying Forms', oldWay: 'Typeform ($35/mo) with strict response caps', newWay: 'Unlimited custom fields & qualification questions' },
              { cap: 'End-to-End Funnel Simulation', oldWay: 'Impossible without spending real money on ads', newWay: '1-click interactive Live Prospect Simulator' },
              { cap: 'Data Integration & Sync', oldWay: 'Fragile Zapier connections ($29/mo) that break', newWay: 'Zero middleware needed — all components share data' },
              { cap: 'Monthly Cost of Ownership', oldWay: '$250 - $350+ every month with lead tax', newWay: '$49/mo flat with unlimited leads' }
            ].map((row, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1.5fr 1.5fr',
                  padding: '1.15rem 1.5rem',
                  borderBottom: i < 7 ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
                  backgroundColor: i % 2 === 0 ? 'rgba(255, 255, 255, 0.015)' : 'transparent',
                  alignItems: 'center',
                  fontSize: '0.85rem'
                }}
              >
                <span style={{ fontWeight: 700, color: '#F1F5F9' }}>{row.cap}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#94A3B8' }}>
                  <X size={15} color="#EF4444" style={{ flexShrink: 0 }} />
                  <span>{row.oldWay}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#FFFFFF', fontWeight: 600 }}>
                  <Check size={15} color="#10B981" style={{ flexShrink: 0 }} />
                  <span>{row.newWay}</span>
                </div>
              </div>
            ))}
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
            <h2 style={{ fontSize: 'clamp(2rem, 4vw, 2.75rem)', fontWeight: 800, letterSpacing: '-0.025em', marginTop: '0.5rem', marginBottom: '1rem' }}>
              Simple, Predictable Plans for Growing Businesses
            </h2>
            <p style={{ fontSize: '1rem', color: '#94A3B8' }}>
              No per-lead caps. No transaction tax. Flat monthly pricing.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
            {/* Tier 1: Free Sandbox */}
            <div
              style={{
                backgroundColor: '#111827',
                borderRadius: '16px',
                padding: '2.5rem 2rem',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.4rem', color: '#FFFFFF' }}>
                Sandbox Explorer
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#94A3B8', marginBottom: '1.5rem' }}>
                Ideal for mapping journeys and testing funnel logic.
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
                  marginBottom: '1.75rem'
                }}
              >
                Start Free Canvas
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
                  <span>Live Funnel Simulator</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Local Browser Auto-Save</span>
                </li>
              </ul>
            </div>

            {/* Tier 2: Pro (Featured) */}
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
                For business owners & consultants ready to launch and convert.
              </p>
              <div style={{ marginBottom: '1.75rem' }}>
                <span style={{ fontSize: '2.75rem', fontWeight: 900, color: '#FFFFFF' }}>$49</span>
                <span style={{ color: '#94A3B8', fontSize: '0.9rem' }}> / month</span>
              </div>
              <button
                onClick={() => onNavigate('canvas')}
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
                Launch Pro Studio
              </button>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem', color: '#F1F5F9' }}>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Unlimited Journeys & Pipelines</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Unlimited Form Submissions</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Hub Brain AI Copywriting Assistant</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '16px', height: '16px', color: '#10B981' }} />
                  <span>Custom Domain Support</span>
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
            Ready to Build Your High-Converting Journey?
          </h2>
          <p style={{ fontSize: '1.05rem', color: '#CBD5E1', maxWidth: '600px', margin: '0 auto 2rem' }}>
            Open the live visual canvas, load the Turnkey Blueprint, and see your entire customer pipeline in under 60 seconds.
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
            <span>Launch Canvas Studio</span>
            <ArrowRight style={{ width: '18px', height: '18px' }} />
          </button>
        </div>
      </section>
    </div>
  );
};
