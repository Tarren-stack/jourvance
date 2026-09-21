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
  DollarSign
} from 'lucide-react';

interface HomePageProps {
  onNavigate: (page: 'home' | 'about' | 'blog' | 'contact' | 'canvas') => void;
  onTestJourney: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onNavigate, onTestJourney }) => {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');

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

      {/* ── CORE CAPABILITIES ── */}
      <section style={{ padding: '6rem 2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
            Built for Real Conversion
          </span>
          <h2 style={{ fontSize: 'clamp(2rem, 4vw, 2.75rem)', fontWeight: 800, letterSpacing: '-0.025em', marginTop: '0.5rem' }}>
            Everything You Need to Convert Traffic Into Booked Revenue
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem' }}>
          {/* Feature 1 */}
          <div
            style={{
              backgroundColor: '#111827',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '14px',
              padding: '2rem'
            }}
          >
            <div style={{ width: '42px', height: '42px', borderRadius: '10px', backgroundColor: 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
              <Layers style={{ width: '22px', height: '22px', color: '#818CF8' }} />
            </div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.6rem', color: '#FFFFFF' }}>
              Interactive Visual Canvas
            </h3>
            <p style={{ fontSize: '0.875rem', color: '#94A3B8', lineHeight: 1.6 }}>
              Powered by modern flow modeling. Connect ads to landing pages to forms to follow-up letters with live conversion rate edges.
            </p>
          </div>

          {/* Feature 2 */}
          <div
            style={{
              backgroundColor: '#111827',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '14px',
              padding: '2rem'
            }}
          >
            <div style={{ width: '42px', height: '42px', borderRadius: '10px', backgroundColor: 'rgba(56, 189, 248, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
              <Zap style={{ width: '22px', height: '22px', color: '#38BDF8' }} />
            </div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.6rem', color: '#FFFFFF' }}>
              Turnkey Blueprints
            </h3>
            <p style={{ fontSize: '0.875rem', color: '#94A3B8', lineHeight: 1.6 }}>
              Never start with a blank screen. Load pre-architected lead capture pipelines proven to convert across service businesses and SaaS.
            </p>
          </div>

          {/* Feature 3 */}
          <div
            style={{
              backgroundColor: '#111827',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '14px',
              padding: '2rem'
            }}
          >
            <div style={{ width: '42px', height: '42px', borderRadius: '10px', backgroundColor: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
              <Sliders style={{ width: '22px', height: '22px', color: '#10B981' }} />
            </div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.6rem', color: '#FFFFFF' }}>
              Slide-Over Inspectors
            </h3>
            <p style={{ fontSize: '0.875rem', color: '#94A3B8', lineHeight: 1.6 }}>
              Edit headlines, change form fields, reorder follow-up emails, and adjust delays in real time without navigating away from the canvas.
            </p>
          </div>

          {/* Feature 4 */}
          <div
            style={{
              backgroundColor: '#111827',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '14px',
              padding: '2rem'
            }}
          >
            <div style={{ width: '42px', height: '42px', borderRadius: '10px', backgroundColor: 'rgba(245, 158, 11, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
              <Play style={{ width: '22px', height: '22px', color: '#F59E0B' }} />
            </div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.6rem', color: '#FFFFFF' }}>
              Live Prospect Simulator
            </h3>
            <p style={{ fontSize: '0.875rem', color: '#94A3B8', lineHeight: 1.6 }}>
              Walk through your funnel exactly as your visitor experiences it. Verify page layout, form validation, and email dispatches in seconds.
            </p>
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
