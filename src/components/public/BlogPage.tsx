import React, { useState } from 'react';
import { BookOpen, Calendar, Clock, ArrowRight, ArrowLeft, CheckCircle2, Share2, Tag } from 'lucide-react';

interface Article {
  id: string;
  title: string;
  category: string;
  readTime: string;
  date: string;
  excerpt: string;
  content: string[];
  takeaways: string[];
}

interface BlogPageProps {
  onNavigate: (page: 'home' | 'about' | 'blog' | 'contact' | 'canvas') => void;
}

export const BlogPage: React.FC<BlogPageProps> = ({ onNavigate }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);

  const articles: Article[] = [
    {
      id: 'art-lead-pipeline-2026',
      title: 'The Anatomy of a High-Converting Lead Capture Pipeline in 2026',
      category: 'Lead Generation',
      readTime: '5 min read',
      date: 'Sept 20, 2026',
      excerpt:
        'Why multi-page survey funnels are failing, and how a tight 4-node journey (Hook Ad → Single-Offer Lander → 3-Field Form → Automated Nurture) consistently converts over 25%.',
      content: [
        'Over-complicated marketing funnels are leaking money. For years, the prevailing wisdom told founders and agencies to build 7-step survey funnels with branching quiz logic. While that works for massive enterprise brands, small-to-medium service businesses suffer from brutal drop-off rates at every extra step.',
        'High conversion in 2026 comes down to cognitive simplicity: one strong advertising hook, one single-offer landing page with zero distracting navigation, an intake form with no more than three fields, and an immediate confirmation email delivered in under 60 seconds.',
        'When your landing page repeats the exact headline from your ad, visitor trust spikes. When your intake form only asks for Name, Work Email, and Phone Number, completion rates average 60%. And when your follow-up sequence arrives instantly, response rates double.'
      ],
      takeaways: [
        'Maintain exact message match between your ad creative and landing page headline.',
        'Cap intake forms at 3 fields for initial contact (qualify deeper on the call).',
        'Trigger the first follow-up letter instantly (0-minute delay) with a clear next step.'
      ]
    },
    {
      id: 'art-visual-mapping-advantage',
      title: 'Why Visual Journey Mapping Beats Siloed Marketing Software Every Time',
      category: 'Funnel Strategy',
      readTime: '4 min read',
      date: 'Sept 18, 2026',
      excerpt:
        'When your ad manager, landing page software, and email autoresponder live in different tabs, you lose the mental model of the customer. Here is why visual pipeline mapping changes everything.',
      content: [
        'The biggest hidden tax in digital marketing is the "context switch tax." When you write an ad in Facebook Ads Manager, you are looking at audience demographics. When you write a landing page in a page builder, you are looking at layout grids. When you write an email in your CRM, you are looking at list tags.',
        'The problem? Your customer experiences all three of these in one continuous, uninterrupted stream. If the tone, promise, or urgency shifts between the ad and the email, the prospect feels hesitation and abandons.',
        'Visual journey modeling forces you to design the entire customer path in one viewport. You see the conversion rate directly on the edge connecting the page to the form. If drop-off is high, the problem is immediately obvious.'
      ],
      takeaways: [
        'Design customer journeys as continuous pipelines, not isolated assets.',
        'Monitor conversion rates on the connections between steps to isolate bottlenecks.',
        'Use live prospect simulation to experience the entire funnel from the visitor’s perspective.'
      ]
    },
    {
      id: 'art-email-mistakes',
      title: '5 Follow-Up Email Mistakes That Kill Your Lead Conversion Rate',
      category: 'Email Automation',
      readTime: '6 min read',
      date: 'Sept 14, 2026',
      excerpt:
        'You captured the lead — now what? Avoid these 5 deadly autoresponder mistakes that cause qualified leads to ghost your sales team.',
      content: [
        'Capturing a prospect’s email address is only the halfway mark. Most leads are lost in the first 48 hours because of poorly constructed follow-up sequences. The most common mistake is waiting hours or days before sending the first message.',
        'The second mistake is sending overly branded HTML templates packed with banners, multi-column navigation, and three competing calls to action. In B2B and high-ticket service industries, clean plain-text emails with a single direct question get 3x more replies.',
        'Third is failing to remind the prospect why they opted in. Your first email must acknowledge the specific offer they requested and provide immediate value before asking them to get on a 30-minute sales call.'
      ],
      takeaways: [
        'Deliver the welcome message within 60 seconds of form submission.',
        'Favor clean text over heavy HTML newsletter designs for personal response.',
        'End with a simple single-sentence question (e.g., "What time works best for you this Thursday?").'
      ]
    }
  ];

  const categories = ['All', 'Lead Generation', 'Funnel Strategy', 'Email Automation'];

  const filteredArticles =
    selectedCategory === 'All'
      ? articles
      : articles.filter(a => a.category === selectedCategory);

  const activeArticle = articles.find(a => a.id === activeArticleId) || null;

  return (
    <div style={{ backgroundColor: '#0B0F19', color: '#F8FAFC', padding: '5rem 2rem 7rem', minHeight: '80vh' }}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
        {/* Article Reader View */}
        {activeArticle ? (
          <div>
            <button
              onClick={() => setActiveArticleId(null)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: 'none',
                border: 'none',
                color: '#818CF8',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: 'pointer',
                marginBottom: '2rem'
              }}
            >
              <ArrowLeft style={{ width: '16px', height: '16px' }} />
              <span>Back to all articles</span>
            </button>

            <article
              style={{
                backgroundColor: '#111827',
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '3rem 2.5rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', fontSize: '0.8rem', color: '#94A3B8' }}>
                <span
                  style={{
                    backgroundColor: 'rgba(99, 102, 241, 0.15)',
                    color: '#818CF8',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '4px',
                    fontWeight: 700
                  }}
                >
                  {activeArticle.category}
                </span>
                <span>•</span>
                <span>{activeArticle.date}</span>
                <span>•</span>
                <span>{activeArticle.readTime}</span>
              </div>

              <h1 style={{ fontSize: 'clamp(1.75rem, 3.5vw, 2.5rem)', fontWeight: 800, lineHeight: 1.25, color: '#FFFFFF', marginBottom: '1.5rem' }}>
                {activeArticle.title}
              </h1>

              <div style={{ lineHeight: 1.8, fontSize: '1.05rem', color: '#CBD5E1', marginBottom: '2.5rem' }}>
                {activeArticle.content.map((p, idx) => (
                  <p key={idx} style={{ marginBottom: '1.25rem' }}>
                    {p}
                  </p>
                ))}
              </div>

              {/* Actionable Takeaways Box */}
              <div
                style={{
                  backgroundColor: '#1E293B',
                  borderRadius: '12px',
                  padding: '1.75rem',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  marginBottom: '2.5rem'
                }}
              >
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#10B981', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '18px', height: '18px' }} />
                  <span>Key Actionable Takeaways</span>
                </h3>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem', color: '#F1F5F9' }}>
                  {activeArticle.takeaways.map((t, idx) => (
                    <li key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                      <span style={{ color: '#10B981', fontWeight: 700 }}>✓</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Bottom CTA */}
              <div
                style={{
                  textAlign: 'center',
                  paddingTop: '2rem',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                <h4 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '0.5rem' }}>
                  Build this exact pipeline in Jourvance
                </h4>
                <p style={{ fontSize: '0.9rem', color: '#94A3B8', marginBottom: '1.5rem' }}>
                  Load the Turnkey Lead Capture Blueprint on our live interactive canvas.
                </p>
                <button
                  onClick={() => onNavigate('canvas')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.75rem 1.75rem',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
                    border: 'none',
                    color: '#FFFFFF',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  <span>Open Studio Canvas</span>
                  <ArrowRight style={{ width: '16px', height: '16px' }} />
                </button>
              </div>
            </article>
          </div>
        ) : (
          /* Articles List View */
          <div>
            <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
              <span
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  color: '#818CF8',
                  letterSpacing: '0.08em'
                }}
              >
                Jourvance Insights
              </span>
              <h1
                style={{
                  fontSize: 'clamp(2.25rem, 4vw, 3.25rem)',
                  fontWeight: 900,
                  letterSpacing: '-0.03em',
                  margin: '0.75rem 0 1rem',
                  color: '#FFFFFF'
                }}
              >
                Conversion Engineering & Funnel Strategy
              </h1>
              <p style={{ fontSize: '1.1rem', color: '#94A3B8', maxWidth: '650px', margin: '0 auto' }}>
                Practical, actionable playbooks on customer journey mapping, landing page conversion, and automated follow-up.
              </p>
            </div>

            {/* Category Filter Pills */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '3rem' }}>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    padding: '0.45rem 1rem',
                    borderRadius: '9999px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: selectedCategory === cat ? '1px solid #6366F1' : '1px solid rgba(255, 255, 255, 0.08)',
                    backgroundColor: selectedCategory === cat ? 'rgba(99, 102, 241, 0.2)' : 'rgba(17, 24, 39, 0.6)',
                    color: selectedCategory === cat ? '#A5B4FC' : '#94A3B8',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Articles Grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {filteredArticles.map(article => (
                <div
                  key={article.id}
                  onClick={() => setActiveArticleId(article.id)}
                  style={{
                    backgroundColor: '#111827',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '14px',
                    padding: '2rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.4)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', fontSize: '0.75rem', color: '#64748B' }}>
                    <span
                      style={{
                        backgroundColor: 'rgba(99, 102, 241, 0.15)',
                        color: '#818CF8',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        fontWeight: 700
                      }}
                    >
                      {article.category}
                    </span>
                    <span>•</span>
                    <span>{article.date}</span>
                    <span>•</span>
                    <span>{article.readTime}</span>
                  </div>

                  <h3 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '0.75rem', lineHeight: 1.3 }}>
                    {article.title}
                  </h3>

                  <p style={{ fontSize: '0.925rem', color: '#94A3B8', lineHeight: 1.6, marginBottom: '1.25rem' }}>
                    {article.excerpt}
                  </p>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#818CF8', fontSize: '0.85rem', fontWeight: 700 }}>
                    <span>Read Article</span>
                    <ArrowRight style={{ width: '14px', height: '14px' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
