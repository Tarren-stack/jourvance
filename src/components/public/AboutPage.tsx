import React from 'react';
import { ArrowRight, ShieldCheck, Zap, Target } from 'lucide-react';

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
            Built by a marketer. Made for your business.
          </h1>
          <p style={{ fontSize: '1.15rem', lineHeight: 1.6, color: '#94A3B8', maxWidth: '700px', margin: '0 auto' }}>
            Eight years of hands-on marketing experience, brought together to help you connect your marketing
            and grow your business.
          </p>
        </div>

        {/* Story Section */}
        <div
          style={{
            backgroundColor: '#111827',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            padding: 'clamp(1.5rem, 5vw, 3rem) clamp(1.25rem, 4vw, 2.5rem)',
            marginBottom: '3rem',
            lineHeight: 1.7,
            color: '#CBD5E1',
            fontSize: '1rem'
          }}
        >
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '1.25rem' }}>
            The story behind Jourvance
          </h2>
          <p style={{ marginBottom: '1.25rem' }}>
            I'm Tarren Munoz, the founder of Jourvance. I've spent the past eight years in marketing,
            working with a wide range of software, website builders, and marketing tools. That experience
            shaped what I wanted to build and the problems I wanted to solve.
          </p>
          <p style={{ marginBottom: '1.25rem' }}>
            Every part of your marketing shapes the next. The page someone lands on, the offer they see,
            and the follow-up they receive all need to work together. I wanted a clearer way to see those
            connections and build around them.
          </p>
          <p style={{ marginBottom: '1.25rem' }}>
            Jourvance brings together what I've learned and what I've needed over the years. It connects
            customer journeys, landing pages, and follow-up in one workspace, built around the practical
            work of turning an idea into a campaign.
          </p>
          <p style={{ color: '#F1F5F9', fontWeight: 600 }}>
            My goal is simple: give business owners and marketers the tools and clarity to put their ideas
            into action, keep improving, and grow their businesses. That's why I built Jourvance.
          </p>
          <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <p style={{ margin: 0, fontWeight: 700, color: '#FFFFFF' }}>Tarren Munoz</p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#94A3B8' }}>Founder, Jourvance</p>
          </div>
        </div>

        {/* 3 Guiding Pillars */}
        <div style={{ marginBottom: '4rem' }}>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF', textAlign: 'center', marginBottom: '2.5rem' }}>
            What drives Jourvance
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '1.5rem' }}>
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
                1. See the whole journey
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#94A3B8', lineHeight: 1.5 }}>
                Connect your landing pages, forms, and follow-up so you can understand the path you're building for your customers.
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
                2. Turn ideas into action
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#94A3B8', lineHeight: 1.5 }}>
                Start with a journey blueprint, make it your own, and build on it as your business evolves.
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
                3. Built around real needs
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#94A3B8', lineHeight: 1.5 }}>
                Our focus is practical tools that help you plan, create, and improve your marketing, shaped by hands-on experience.
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
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '0.75rem' }}>
            Start building your next customer journey
          </h2>
          <p style={{ fontSize: '0.95rem', color: '#94A3B8', maxWidth: '500px', margin: '0 auto 1.75rem' }}>
            Bring your next idea to the canvas and map a path from first interest to follow-up.
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
