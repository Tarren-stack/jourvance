import type { JourneyNode, JourneyEdge, JourneyProject } from '../types/journey';

export const DEFAULT_LEAD_CAPTURE_PROJECT: JourneyProject = {
  id: 'lead-capture-core',
  name: 'New Client Lead Capture & Follow-up',
  businessType: 'Professional & Local Services',
  offerHeadline: 'Your offer',
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
        headline: 'Your ad headline',
        body: 'Describe the offer in words you can stand behind.',
        ctaText: 'Claim Your Offer',
        utmCampaign: 'lead-gen-spring',
        imageUrl: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=600&auto=format&fit=crop&q=80',
        impressions: 0,
        clicks: 0,
        ctr: 0,
        spend: 0
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
        headline: 'Your offer headline',
        subhead: 'Describe what the visitor gets.',
        bullets: [
          'First point you can stand behind',
          'Second point you can stand behind'
        ],
        trustBadge: '',
        buttonText: 'Continue',
        heroImageUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&auto=format&fit=crop&q=80',
        visitors: 0,
        conversions: 0,
        conversionRate: 0
      }
    },
    {
      id: 'node-form-1',
      type: 'lead-form',
      position: { x: 740, y: 170 },
      data: {
        type: 'lead-form',
        label: 'Client Intake Form',
        formTitle: 'Where should we reach you?',
        submitButtonText: 'Submit',
        successMessage: 'Thanks. We have your details.',
        notifyEmail: 'team@yourbusiness.com',
        fields: [
          { id: 'f_name', label: 'Full Name', type: 'text', required: true, enabled: true, placeholder: 'Jane Doe' },
          { id: 'f_email', label: 'Work / Personal Email', type: 'email', required: true, enabled: true, placeholder: 'jane@example.com' },
          { id: 'f_phone', label: 'Phone number', type: 'tel', required: false, enabled: true, placeholder: '(555) 000-1234' },
          { id: 'f_notes', label: 'Tell us a bit about your primary goal', type: 'textarea', required: false, enabled: true, placeholder: 'I am looking to improve...' }
        ],
        views: 0,
        submissions: 0,
        completionRate: 0
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
        contactsEnrolled: 0,
        avgOpenRate: 0,
        avgClickRate: 0,
        steps: [
          {
            id: 'step-1',
            channel: 'email',
            delay: 'Instant (0m)',
            subject: 'You are on the list',
            previewText: 'Replace this before anyone receives it',
            body: `Hi [First Name],\n\nThanks for signing up. Replace this note with the real next step before anyone receives it.\n\nThe Team`
          },
          {
            id: 'step-2',
            channel: 'email',
            delay: '24 Hours',
            subject: 'A follow-up',
            previewText: 'Replace this before anyone receives it',
            body: `Hi [First Name],\n\nThis is a follow-up in the sequence. Replace it with a real detail about your offer before anyone receives it.\n\nThe Team`
          },
          {
            id: 'step-3',
            channel: 'email',
            delay: '72 Hours',
            subject: 'One more note',
            previewText: 'Replace this before anyone receives it',
            body: `Hi [First Name],\n\nThis is the last note in the sequence. Mention a deadline only if you actually have one.\n\nThe Team`
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
        sourceThroughput: 0,
        targetCount: 0,
        rate: 0
      }
    },
    {
      id: 'edge-page-form',
      source: 'node-page-1',
      target: 'node-form-1',
      type: 'conversion',
      data: {
        sourceThroughput: 0,
        targetCount: 0,
        rate: 0
      }
    },
    {
      id: 'edge-form-seq',
      source: 'node-form-1',
      target: 'node-seq-1',
      type: 'conversion',
      data: {
        sourceThroughput: 0,
        targetCount: 0,
        rate: 0
      }
    }
  ]
};
