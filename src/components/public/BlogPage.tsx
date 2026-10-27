import React, { useState } from 'react';
import { ArrowRight, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { VIEW_LABEL } from '../../lib/studioLabels';

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
      title: 'A simple path from ad to follow-up',
      category: 'Lead Generation',
      readTime: '5 min read',
      date: 'Sept 20, 2026',
      excerpt:
        'A long form with many steps loses people. A short path works better: one ad, one page, a short form, and a follow-up email.',
      content: [
        'A long path loses people. Each extra page is a place they can leave.',
        'Keep the path short. Use one ad, one page that repeats the ad, a form with three fields, and a follow-up email that goes out right away.',
        'Use the same headline on the ad and the page. Ask only for a name, an email, and a phone number. Send the first email as soon as they submit the form.'
      ],
      takeaways: [
        'Use the same headline on the ad and the page.',
        'Ask for three things on the first form. Ask for more on the call.',
        'Send the first follow-up email right away, with one clear next step.'
      ]
    },
    {
      id: 'art-visual-mapping-advantage',
      title: 'See the whole journey in one place',
      category: 'Funnel Strategy',
      readTime: '4 min read',
      date: 'Sept 18, 2026',
      excerpt:
        'Ads, pages, and email often live in different tools. One map shows the path a customer actually takes.',
      content: [
        'Ads, pages, and email often live in different tools. You write the ad in one place, the page in another, and the email in a third.',
        'The customer sees one path. If the promise changes between the ad and the email, they hesitate and leave.',
        'A map puts the whole path on one screen. You can see how many people move from the page to the form. A big drop shows you where to look.'
      ],
      takeaways: [
        'Design the path as one journey, not as separate pieces.',
        'Look at the line between two steps to find where people leave.',
        'Walk the journey yourself before you send people to it.'
      ]
    },
    {
      id: 'art-email-mistakes',
      title: 'Follow-up emails that get a reply',
      category: 'Email Automation',
      readTime: '6 min read',
      date: 'Sept 14, 2026',
      excerpt:
        'The first two days after someone fills out your form decide whether they reply. These three habits help.',
      content: [
        'Getting an email address is only half the work. Many people never reply because the first message comes too late.',
        'A second problem is a busy email. Banners, menus, and three buttons compete for attention. A short plain email with one question is easier to answer.',
        'The first email should name the offer they asked for. Give them something useful before you ask for a call.'
      ],
      takeaways: [
        'Send the welcome email within a minute of the form.',
        'Write a short plain email when you want a personal reply.',
        'End with one question, such as "What time works for you on Thursday?"'
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
              type="button"
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
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#10B981', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 style={{ width: '18px', height: '18px' }} aria-hidden="true" />
                  <span>What to try</span>
                </h2>
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
                <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#FFFFFF', marginBottom: '0.5rem' }}>
                  Build this journey in Jourvance
                </h2>
                <p style={{ fontSize: '0.9rem', color: '#94A3B8', marginBottom: '1.5rem' }}>
                  Open {VIEW_LABEL.canvas} and start from a blueprint.
                </p>
                <button
                  type="button"
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
                  <span>{VIEW_LABEL.canvas}</span>
                  <ArrowRight style={{ width: '16px', height: '16px' }} aria-hidden="true" />
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
                Practical ideas for your next campaign.
              </h1>
              <p style={{ fontSize: '1.1rem', lineHeight: 1.6, color: '#94A3B8', maxWidth: '650px', margin: '0 auto' }}>
                Explore customer journeys, landing pages, and follow-up with a marketer's eye for the work behind each campaign.
                Find an idea to try, adapt it to your business, and see what you learn.
              </p>
            </div>

            {/* Category Filter Pills */}
            <div role="group" aria-label="Topics" style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '3rem' }}>
              {categories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  aria-pressed={selectedCategory === cat}
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
                <article
                  key={article.id}
                  style={{
                    backgroundColor: '#111827',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '14px',
                    padding: '2rem'
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

                  <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#FFFFFF', margin: '0 0 0.75rem', lineHeight: 1.3 }}>
                    <button
                      type="button"
                      onClick={() => setActiveArticleId(article.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: 'inherit',
                        font: 'inherit',
                        textAlign: 'left',
                        cursor: 'pointer'
                      }}
                    >
                      {article.title}
                    </button>
                  </h2>

                  <p style={{ fontSize: '0.925rem', color: '#94A3B8', lineHeight: 1.6, margin: 0 }}>
                    {article.excerpt}
                  </p>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
