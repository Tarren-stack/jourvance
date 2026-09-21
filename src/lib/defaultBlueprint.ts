import type { JourneyNode, JourneyEdge, JourneyProject } from '../types/journey';

export const DEFAULT_LEAD_CAPTURE_PROJECT: JourneyProject = {
  id: 'lead-capture-core',
  name: 'New Client Lead Capture & Follow-up',
  businessType: 'Professional & Local Services',
  offerHeadline: 'Complimentary Consultation & VIP New Client Package',
  goal: 'Turn ad visitors into booked consultations and nurtured leads',
  updatedAt: new Date().toISOString(),
  nodes: [
    {
      id: 'node-ad-1',
      type: 'ad-source',
      position: { x: 50, y: 180 },
      data: {
        type: 'ad-source',
        label: 'Meta Ad Campaign',
        platform: 'meta',
        headline: 'Claim Your Exclusive VIP Consultation & New Client Package',
        body: 'Looking for proven, 5-star results without the runaround? Reserve your personalized consultation today. Limited slots available this month.',
        ctaText: 'Claim Your Offer',
        utmCampaign: 'lead-gen-spring',
        imageUrl: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=600&auto=format&fit=crop&q=80',
        impressions: 4250,
        clicks: 420,
        ctr: 9.88,
        spend: 210
      }
    },
    {
      id: 'node-page-1',
      type: 'landing-page',
      position: { x: 380, y: 160 },
      data: {
        type: 'landing-page',
        label: 'Lead Capture Lander',
        slug: 'vip-consultation',
        headline: 'Experience Premium Results Tailored Directly to Your Goals',
        subhead: 'Join over 450+ verified clients who upgraded their experience. Fast turnaround, transparent pricing, and 100% satisfaction guaranteed.',
        bullets: [
          'Direct 1-on-1 strategy session with a dedicated senior specialist',
          'Comprehensive audit and custom tailored action plan',
          'Zero risk, zero obligation welcome guarantee'
        ],
        trustBadge: 'Rated 4.9/5 stars by over 450+ clients',
        buttonText: 'Claim Your Free Consultation',
        heroImageUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&auto=format&fit=crop&q=80',
        visitors: 420,
        conversions: 105,
        conversionRate: 25.0
      }
    },
    {
      id: 'node-form-1',
      type: 'lead-form',
      position: { x: 740, y: 170 },
      data: {
        type: 'lead-form',
        label: 'Client Intake Form',
        formTitle: 'Where should we send your invitation details?',
        submitButtonText: 'Submit & Lock In My Offer',
        successMessage: 'Thank you! Your spot is reserved. Check your email for next steps.',
        notifyEmail: 'team@yourbusiness.com',
        fields: [
          { id: 'f_name', label: 'Full Name', type: 'text', required: true, enabled: true, placeholder: 'Jane Doe' },
          { id: 'f_email', label: 'Work / Personal Email', type: 'email', required: true, enabled: true, placeholder: 'jane@example.com' },
          { id: 'f_phone', label: 'Phone Number (for SMS confirmation)', type: 'tel', required: true, enabled: true, placeholder: '(555) 000-1234' },
          { id: 'f_notes', label: 'Tell us a bit about your primary goal', type: 'textarea', required: false, enabled: true, placeholder: 'I am looking to improve...' }
        ],
        views: 105,
        submissions: 68,
        completionRate: 64.76
      }
    },
    {
      id: 'node-seq-1',
      type: 'follow-up-sequence',
      position: { x: 1100, y: 150 },
      data: {
        type: 'follow-up-sequence',
        label: 'Nurture & Booking Flow',
        sequenceTitle: 'New Client 3-Part Follow-Up',
        contactsEnrolled: 68,
        avgOpenRate: 72.4,
        avgClickRate: 38.2,
        steps: [
          {
            id: 'step-1',
            channel: 'email',
            delay: 'Instant (0m)',
            subject: 'Your VIP Consultation Pass is confirmed',
            previewText: 'Here are your details and what to expect next...',
            body: `Hi [First Name],\n\nThank you for claiming your VIP Consultation Package! We are thrilled to connect with you.\n\nHere is what happens next:\n1. We will review the notes you shared\n2. We will prepare your custom audit prior to our call\n3. Select your preferred time on our calendar here: https://yourbusiness.com/calendar\n\nIf you need anything beforehand, simply reply to this email.\n\nWarmly,\nThe Team`
          },
          {
            id: 'step-2',
            channel: 'email',
            delay: '24 Hours',
            subject: 'Quick question about your project goals',
            previewText: 'A fast 1-minute question so we can prepare...',
            body: `Hi [First Name],\n\nHope your week is going smoothly!\n\nAhead of our consultation, what is the single biggest bottleneck you are currently experiencing?\n\nJust reply directly with a sentence or two—it helps us hit the ground running with actionable answers right away.\n\nBest,\nYour Dedicated Specialist`
          },
          {
            id: 'step-3',
            channel: 'email',
            delay: '72 Hours',
            subject: 'Friendly reminder: Your consultation reservation',
            previewText: 'Just making sure you have your spot secured...',
            body: `Hi [First Name],\n\nJust checking in to ensure you had a chance to pick a time slot that fits your schedule.\n\nOur calendar is filling up for this month, but your spot is still reserved here: https://yourbusiness.com/calendar\n\nLooking forward to speaking with you!\n\nBest regards,\nThe Team`
          }
        ]
      }
    }
  ],
  edges: [
    {
      id: 'edge-ad-page',
      source: 'node-ad-1',
      target: 'node-page-1',
      type: 'conversion',
      data: {
        sourceThroughput: 420,
        targetCount: 420,
        rate: 100
      }
    },
    {
      id: 'edge-page-form',
      source: 'node-page-1',
      target: 'node-form-1',
      type: 'conversion',
      data: {
        sourceThroughput: 420,
        targetCount: 105,
        rate: 25.0
      }
    },
    {
      id: 'edge-form-seq',
      source: 'node-form-1',
      target: 'node-seq-1',
      type: 'conversion',
      data: {
        sourceThroughput: 105,
        targetCount: 68,
        rate: 64.76
      }
    }
  ]
};
