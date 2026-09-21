import React, { useState } from 'react';
import { X, Copy, Check, Download, Globe, Mail, Share2, Code, CheckCircle2 } from 'lucide-react';
import type { Node } from '@xyflow/react';
import type { PageNodeData, AdNodeData, SequenceNodeData, FormNodeData, SequenceStep } from '../../types/journey';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  nodes: Node[];
  journeyTitle: string;
}

export const ExportAssetsModal: React.FC<Props> = ({ isOpen, onClose, nodes, journeyTitle }) => {
  const [activeTab, setActiveTab] = useState<'page' | 'emails' | 'ads' | 'json'>('page');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  // Extract nodes
  const pageNode = nodes.find(n => n.type === 'landing-page')?.data as PageNodeData | undefined;
  const adNode = nodes.find(n => n.type === 'ad-source')?.data as AdNodeData | undefined;
  const sequenceNode = nodes.find(n => n.type === 'follow-up-sequence')?.data as SequenceNodeData | undefined;
  const formNode = nodes.find(n => n.type === 'lead-form')?.data as FormNodeData | undefined;

  // Generate HTML for Landing Page
  const generateLandingPageHtml = () => {
    const headline = pageNode?.headline || 'High-Converting Offer Headline';
    const subhead = pageNode?.subhead || 'Clear, concise subheadline addressing customer pain and immediate value.';
    const buttonText = pageNode?.buttonText || formNode?.submitButtonText || 'Get Started Free';
    const bullets = pageNode?.bullets || ['Proven 3-step execution framework', 'Instant access upon qualification', 'Zero long-term contracts or lock-ins'];
    const fields = formNode?.fields || [
      { id: '1', label: 'Full Name', type: 'text', placeholder: 'Jane Doe', required: true },
      { id: '2', label: 'Work Email', type: 'email', placeholder: 'jane@company.com', required: true }
    ];

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headline} — Powered by Jourvance</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: #070A12;
      color: #F1F5F9;
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1.5rem;
    }
    .container {
      max-width: 640px;
      width: 100%;
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 2.75rem 2.25rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #818CF8;
      background: rgba(99, 102, 241, 0.12);
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      margin-bottom: 1.25rem;
    }
    h1 {
      font-size: 2.15rem;
      font-weight: 800;
      line-height: 1.25;
      letter-spacing: -0.025em;
      margin-bottom: 0.85rem;
      color: #FFFFFF;
    }
    .subhead {
      font-size: 1.05rem;
      color: #94A3B8;
      margin-bottom: 2rem;
    }
    .bullets {
      list-style: none;
      margin-bottom: 2.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .bullets li {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.95rem;
      color: #E2E8F0;
    }
    .bullets li::before {
      content: "✓";
      color: #10B981;
      font-weight: 800;
    }
    .form-group {
      margin-bottom: 1.15rem;
    }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
      color: #CBD5E1;
      margin-bottom: 0.4rem;
    }
    input {
      width: 100%;
      padding: 0.85rem 1rem;
      border-radius: 10px;
      background: #1E293B;
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #FFFFFF;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus {
      border-color: #6366F1;
    }
    button.submit-btn {
      width: 100%;
      padding: 1rem;
      border-radius: 10px;
      background: linear-gradient(135deg, #6366F1 0%, #4F46E5 100%);
      color: #FFFFFF;
      font-size: 1rem;
      font-weight: 700;
      border: none;
      cursor: pointer;
      margin-top: 0.5rem;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
    }
    .guarantee {
      text-align: center;
      font-size: 0.8rem;
      color: #64748B;
      margin-top: 1.25rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <span class="badge">Limited Intake</span>
    <h1>${headline}</h1>
    <p class="subhead">${subhead}</p>

    <ul class="bullets">
      ${bullets.map(b => `<li>${b}</li>`).join('\n      ')}
    </ul>

    <form onsubmit="event.preventDefault(); alert('Form submitted successfully!');">
      ${fields.map(f => `
      <div class="form-group">
        <label>${f.label}</label>
        <input type="${f.type}" placeholder="${f.placeholder}" ${f.required ? 'required' : ''} />
      </div>`).join('')}
      <button type="submit" class="submit-btn">${buttonText}</button>
      <p class="guarantee">🔒 Your information is confidential and never shared.</p>
    </form>
  </div>
</body>
</html>`;
  };

  // Generate Email Drip Markdown
  const generateEmailSequenceText = () => {
    const steps: SequenceStep[] = sequenceNode?.steps || [
      {
        id: '1',
        channel: 'email',
        delay: 'Instant',
        subject: 'Your intake confirmation + next steps',
        previewText: 'Thank you for reaching out.',
        body: 'Hi {{first_name}},\n\nThank you for requesting access to our pipeline blueprint. We have received your details and our team is reviewing your intake questions right now.\n\nIn the meantime, take 3 minutes to review our case study: {{case_study_link}}.\n\nBest,\nYour Team'
      },
      {
        id: '2',
        channel: 'email',
        delay: '24 Hours',
        subject: 'The 3 hidden conversion bottlenecks cost you pipeline',
        previewText: 'How fragmented funnels leak 40% of ad spend.',
        body: 'Hi {{first_name}},\n\nYesterday we shared your initial confirmation. Today I want to show you the single biggest mistake service businesses make when spending on Meta ads:\n\nSending traffic to a generic homepage instead of a dedicated single-offer landing page.\n\nWhen leads land on an unfocused page, they leave. That is why our visual pipeline maps every click from first impression to follow-up.\n\nReady to map yours? Reply to this email or book a call here: {{calendar_link}}.\n\nBest,\nYour Team'
      },
      {
        id: '3',
        channel: 'email',
        delay: '72 Hours',
        subject: 'Are we still on for this week?',
        previewText: 'Holding your spot in our intake queue.',
        body: 'Hi {{first_name}},\n\nJust checking in to see if you had any questions on our proposal. We are finalizing our onboarding schedule for this week and have 2 slots remaining.\n\nLet me know if you would like me to hold a slot for you.\n\nBest,\nYour Team'
      }
    ];

    return steps
      .map(
        (e: SequenceStep, i: number) =>
          `═══════════════════════════════════════════════════════════════\nEMAIL #${i + 1} — TIMING: ${e.delay.toUpperCase()}\n═══════════════════════════════════════════════════════════════\nSUBJECT: ${e.subject}\nPREVIEW TEXT: ${e.previewText || ''}\n\nBODY:\n${e.body}\n`
      )
      .join('\n\n');
  };

  // Generate Ad Copy & UTM Links
  const generateAdCopyText = () => {
    const headline = adNode?.headline || 'Stop Leaking 40% of Your Ad Spend';
    const primaryText = adNode?.primaryText || 'Most businesses run great ads but send visitors to a confusing homepage. Jourvance lets you build connected customer journeys that turn clicks into qualified leads.';
    const hook = adNode?.hook || 'Stop losing leads between your ad and your calendar.';
    const cta = adNode?.ctaText || 'Learn More';
    const destinationUrl = 'https://jourvance.com/p/offer';

    const utmMeta = `${destinationUrl}?utm_source=meta&utm_medium=cpc&utm_campaign=lead_intake&utm_content=hook_angle_1`;
    const utmGoogle = `${destinationUrl}?utm_source=google&utm_medium=search&utm_campaign=brand_conversion&utm_term=customer_journey_builder`;
    const utmTikTok = `${destinationUrl}?utm_source=tiktok&utm_medium=video&utm_campaign=founder_story&utm_content=problem_agitation`;

    return `═══════════════════════════════════════════════════════════════
AD CREATIVE & COPY SPECIFICATION
═══════════════════════════════════════════════════════════════
HOOK ANGLE:
"${hook}"

PRIMARY AD COPY:
${primaryText}

HEADLINE:
${headline}

CALL TO ACTION (CTA):
${cta}

═══════════════════════════════════════════════════════════════
PRE-CONFIGURED UTM TRACKING DESTINATION URLS
═══════════════════════════════════════════════════════════════

1. META (FACEBOOK / INSTAGRAM FEED & REELS):
${utmMeta}

2. GOOGLE SEARCH / PMAX:
${utmGoogle}

3. TIKTOK ADS:
${utmTikTok}
`;
  };

  // Get current text content
  const getCurrentContent = () => {
    switch (activeTab) {
      case 'page':
        return generateLandingPageHtml();
      case 'emails':
        return generateEmailSequenceText();
      case 'ads':
        return generateAdCopyText();
      case 'json':
        return JSON.stringify({ title: journeyTitle, exportedAt: new Date().toISOString(), nodes }, null, 2);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getCurrentContent());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const content = getCurrentContent();
    let filename = `${journeyTitle.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    let mimeType = 'text/plain';

    if (activeTab === 'page') {
      filename += '-landing-page.html';
      mimeType = 'text/html';
    } else if (activeTab === 'emails') {
      filename += '-email-sequence.txt';
    } else if (activeTab === 'ads') {
      filename += '-ad-copy-utms.txt';
    } else if (activeTab === 'json') {
      filename += '-blueprint.json';
      mimeType = 'application/json';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 7, 18, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem'
      }}
    >
      <div
        style={{
          backgroundColor: '#0F172A',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '18px',
          width: '100%',
          maxWidth: '850px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.5rem 1.75rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#111C33'
          }}
        >
          <div>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#818CF8', letterSpacing: '0.08em' }}>
              Production Handoff
            </span>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#FFFFFF', marginTop: '0.2rem' }}>
              Export Production Assets
            </h2>
            <p style={{ fontSize: '0.825rem', color: '#94A3B8' }}>
              One-click exports for your landing pages, emails, ad copy, and tracking URLs.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: 'none',
              borderRadius: '8px',
              padding: '0.5rem',
              color: '#94A3B8',
              cursor: 'pointer'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 1.75rem',
            backgroundColor: '#0B1120',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            overflowX: 'auto'
          }}
        >
          <button
            onClick={() => setActiveTab('page')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'page' ? '#6366F1' : 'transparent',
              color: activeTab === 'page' ? '#FFFFFF' : '#94A3B8'
            }}
          >
            <Globe size={15} />
            <span>Landing Page HTML</span>
          </button>

          <button
            onClick={() => setActiveTab('emails')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'emails' ? '#6366F1' : 'transparent',
              color: activeTab === 'emails' ? '#FFFFFF' : '#94A3B8'
            }}
          >
            <Mail size={15} />
            <span>Email Sequence</span>
          </button>

          <button
            onClick={() => setActiveTab('ads')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'ads' ? '#6366F1' : 'transparent',
              color: activeTab === 'ads' ? '#FFFFFF' : '#94A3B8'
            }}
          >
            <Share2 size={15} />
            <span>Ad Copy + UTMs</span>
          </button>

          <button
            onClick={() => setActiveTab('json')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'json' ? '#6366F1' : 'transparent',
              color: activeTab === 'json' ? '#FFFFFF' : '#94A3B8'
            }}
          >
            <Code size={15} />
            <span>JSON Blueprint</span>
          </button>
        </div>

        {/* Code/Text Viewer Box */}
        <div style={{ flex: 1, padding: '1.25rem 1.75rem', overflowY: 'auto' }}>
          <div
            style={{
              backgroundColor: '#070A12',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              padding: '1.25rem',
              maxHeight: '380px',
              overflowY: 'auto'
            }}
          >
            <pre
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.8rem',
                color: '#E2E8F0',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.5
              }}
            >
              {getCurrentContent()}
            </pre>
          </div>
        </div>

        {/* Action Footer */}
        <div
          style={{
            padding: '1.25rem 1.75rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#0B1120'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#10B981', fontSize: '0.825rem', fontWeight: 600 }}>
            <CheckCircle2 size={16} /> Ready to publish & launch
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              onClick={handleCopy}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.65rem 1.25rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#FFFFFF',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {copied ? <Check size={16} color="#10B981" /> : <Copy size={16} />}
              <span>{copied ? 'Copied to Clipboard' : 'Copy All'}</span>
            </button>

            <button
              onClick={handleDownload}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.65rem 1.25rem',
                borderRadius: '8px',
                backgroundColor: '#6366F1',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)'
              }}
            >
              <Download size={16} />
              <span>Download File</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
