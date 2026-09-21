import React from 'react';
import { Layers, ArrowRight, ShieldCheck, Zap, Heart, Target } from 'lucide-react';

interface AboutPageProps {
  onNavigate: (page: 'home' | 'about' | 'blog' | 'contact' | 'canvas') => void;
}

export const AboutPage: React.FC<AboutPageProps> = ({ onNavigate }) => {
  return (
    <div style={{ backgroundColor: '#0B0F19', color: '#F8FAFC', padding: '5rem 2rem 7rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <span
            style={{
              fontSize: '0.8rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              color: '#818CF8',
              letterSpacing: '0.08em'
            }}
          >
            About Jourvance
          </span>
          <h1
            style={{
              fontSize: 'clamp(2.25rem, 4.5vw, 3.5rem)',
              fontWeight: 900,
              lineHeight: 1.15,
              letterSpacing: '-0.03em',
              margin: '0.75rem 0 1.5rem',
              color: '#FFFFFF'
            }}
          >
            Built for Businesses That Value Clarity Over Tool Chaos
          </h1>
          <p style={{ fontSize: '1.15rem', lineHeight: 1.6, color: '#94A3B8', maxWidth: '700px', margin: '0 auto' }}>
            We believe that when you can see your entire customer journey in one place, conversion stops being a guessing game.
          </p>
        </div>

        {/* Story Section */}
        <div
          style={{
            backgroundColor: '#111827',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            padding: '3rem 2.5rem',
            marginBottom: '3rem',
            lineHeight: 1.7,
            color: '#CBD5E1',
            fontSize: '1rem'
          }}
        >
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '1.25rem' }}>
            The Origin of Jourvance
          </h2>
          <p style={{ marginBottom: '1.25rem' }}>
            Over the last decade, marketing software split itself into a dozen fragmented pieces. Business owners and agencies
            ended up with one tool for landing pages, another for forms, a third for email automation, and separate dashboards
            for Facebook and Google Ads.
          </p>
          <p style={{ marginBottom: '1.25rem' }}>
            None of these tools talked to each other in a way you could actually see. When a campaign failed to generate
            clients, you were left guessing: Did the ad fail? Was the landing page headline weak? Did the form have too many
            fields? Or did the follow-up email get stuck in spam?
          </p>
          <p style={{ color: '#F1F5F9', fontWeight: 600 }}>
            Jourvance was created to fix this. We combined the advertising hook, the landing page offer, the lead intake form,
            and the follow-up letters onto a single interactive visual canvas.
          </p>
        </div>

        {/* 3 Guiding Pillars */}
        <div style={{ marginBottom: '4rem' }}>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', textAlign: 'center', marginBottom: '2.5rem' }}>
            Our Guiding Principles
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem' }}>
            {/* Pillar 1 */}
            <div
              style={{
                backgroundColor: '#1E293B',
                borderRadius: '12px',
                padding: '2rem 1.5rem',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                <Target style={{ width: '20px', height: '20px', color: '#818CF8' }} />
              </div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '0.5rem' }}>
                1. Visual Context Wins
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#94A3B8', lineHeight: 1.5 }}>
                When you see the edge connecting your landing page to your follow-up email, you naturally write copy that matches the promise.
              </p>
            </div>

            {/* Pillar 2 */}
            <div
              style={{
                backgroundColor: '#1E293B',
                borderRadius: '12px',
                padding: '2rem 1.5rem',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                <Zap style={{ width: '20px', height: '20px', color: '#10B981' }} />
              </div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '0.5rem' }}>
                2. Zero Blank Screens
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#94A3B8', lineHeight: 1.5 }}>
                Starting with a blank canvas causes analysis paralysis. Jourvance starts you with proven conversion blueprints ready to customize.
              </p>
            </div>

            {/* Pillar 3 */}
            <div
              style={{
                backgroundColor: '#1E293B',
                borderRadius: '12px',
                padding: '2rem 1.5rem',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: 'rgba(56, 189, 248, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                <ShieldCheck style={{ width: '20px', height: '20px', color: '#38BDF8' }} />
              </div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '0.5rem' }}>
                3. Honest & Lean
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#94A3B8', lineHeight: 1.5 }}>
                No bloated server dependencies. Fast client-side execution, offline-safe storage, and transparent flat pricing.
              </p>
            </div>
          </div>
        </div>

        {/* CTA Card */}
        <div
          style={{
            backgroundColor: '#111827',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: '16px',
            padding: '3rem 2rem',
            textAlign: 'center'
          }}
        >
          <h3 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '0.75rem' }}>
            Experience Jourvance Today
          </h3>
          <p style={{ fontSize: '0.95rem', color: '#94A3B8', maxWidth: '500px', margin: '0 auto 1.75rem' }}>
            Start mapping your funnel immediately. No credit card required.
          </p>
          <button
            onClick={() => onNavigate('canvas')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.8rem 1.75rem',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
              border: 'none',
              color: '#FFFFFF',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            <span>Open Canvas Studio</span>
            <ArrowRight style={{ width: '16px', height: '16px' }} />
          </button>
        </div>
      </div>
    </div>
  );
};
