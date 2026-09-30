import type { JourneyNode, JourneyEdge, JourneyProject } from '../types/journey';

export const DEFAULT_LEAD_CAPTURE_PROJECT: JourneyProject = {
  id: 'lead-capture-core',
  name: 'New Client Lead Capture & Follow-up',
  businessType: 'Professional & Local Services',
  // Empty: the offer is the person's to name. 'Your offer' went to Write with AI as the offer itself (U04).
  offerHeadline: '',
  goal: 'Turn ad visitors into booked consultations and nurtured leads',
  // The epoch, not module-load time: App adopts the server copy only when it is strictly newer
  // than the local one, and a starter map stamped "now" beat every saved journey on a new device.
  updatedAt: new Date(0).toISOString(),
  nodes: [
    {
      id: 'node-ad-1',
      type: 'ad-source',
      position: { x: 50, y: 180 },
      data: {
        type: 'ad-source',
        label: 'Meta Ad Campaign',
        platform: 'meta',
        // All empty, with the editor's hint saying what to write: an instruction stored here
        // published as the ad (R19), 'Your ad headline' read as the ad's own words (T10), and
        // "Claim Your Offer" promised an offer nobody defined, under a campaign tag nobody chose (U04).
        headline: '',
        body: '',
        ctaText: '',
        utmCampaign: '',
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
        // Empty, so the card reads 'No headline yet' and Check design asks for one (U04).
        headline: '',
        subhead: '',
        bullets: [],
        trustBadge: '',
        buttonText: 'Continue',
        // The map leads this page to Client Intake Form, and only the lead gate makes the published
        // button open a form. Direct checkout with no store gave every visitor a dead button (R18).
        checkoutMode: 'lead-gate',
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
        // No notifyEmail: nothing sends one, and an invented address read as if leads were emailed there (T10).
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
        // Neutral subjects, and no preview or message: the old drafts put "Replace this" in the
        // letter itself, where it read as the letter's own words. Check design asks for each (T10).
        steps: [
          { id: 'step-1', channel: 'email', delay: 'Instant (0m)', subject: 'You are on the list', previewText: '', body: '' },
          { id: 'step-2', channel: 'email', delay: '24 Hours', subject: 'A follow-up', previewText: '', body: '' },
          { id: 'step-3', channel: 'email', delay: '72 Hours', subject: 'One more note', previewText: '', body: '' }
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
