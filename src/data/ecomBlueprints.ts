import type { JourneyNode, JourneyEdge } from '../types/journey';

export type BlueprintCategory = 'direct-checkout' | 'lead-magnet' | 'aov-booster' | 'high-ticket' | 'digital-product' | 'retention';

export interface EcomBlueprint {
  id: string;
  title: string;
  tagline: string;
  category: BlueprintCategory;
  badge: string;
  description: string;
  expectedAovLift: string;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
}

export const ECOM_BLUEPRINTS: EcomBlueprint[] = [
  {
    id: 'single-product-flash-drop',
    title: 'Direct-to-Consumer Product Drop',
    tagline: '1-Click Direct to Checkout (Frictionless Default)',
    category: 'direct-checkout',
    badge: 'Fastest Checkout',
    expectedAovLift: 'High Conversion Velocity',
    description: 'Designed for retail goods and physical e-commerce brands. Eliminates multi-step cart hurdles and sends shoppers directly into accelerated checkout with an auto-applied incentive.',
    nodes: [
      {
        id: 'bp1-ad',
        type: 'ad-source',
        position: { x: 50, y: 150 },
        data: {
          type: 'ad-source',
          label: 'Paid Traffic • Product Spotlight',
          platform: 'meta',
          headline: 'Engineered for Daily Reliability: Save 20% Today',
          body: 'Discover our flagship product crafted with premium materials and backed by our 30-day money-back satisfaction guarantee.',
          ctaText: 'Claim Your Order',
          imageUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80',
          utmCampaign: 'flagship-product-drop',
          impressions: 14200,
          clicks: 680,
          ctr: 4.8,
          spend: 340
        }
      },
      {
        id: 'bp1-page',
        type: 'landing-page',
        position: { x: 420, y: 140 },
        data: {
          type: 'landing-page',
          label: 'Product Showcase Landing Page',
          slug: 'product-flagship-drop',
          headline: 'Engineered for Performance and Everyday Reliability',
          subhead: 'A premium, precision-designed solution built to solve your daily challenges without compromises.',
          bullets: [
            'Precision craftsmanship using industrial-grade materials',
            '30-day risk-free in-home trial with 100% money-back guarantee',
            'Free express priority shipping and dedicated 24/7 customer care'
          ],
          trustBadge: 'Rated 4.9/5 stars by over 1,400+ verified customers worldwide',
          buttonText: 'Order Now — Instant Checkout',
          discountCode: 'WELCOME20',
          checkoutMode: 'direct',
          shopifyProductId: '',
          shopifyVariantId: '',
          shopifyProductTitle: 'Flagship Edition Pro',
          shopifyProductPrice: '$79.00',
          shopifyProductImage: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80',
          mobileStickyBarEnabled: true,
          visitors: 680,
          conversions: 108,
          conversionRate: 15.9
        }
      },
      {
        id: 'bp1-seq',
        type: 'follow-up-sequence',
        position: { x: 800, y: 150 },
        data: {
          type: 'follow-up-sequence',
          label: 'Order Care & Review Generation',
          sequenceTitle: 'Post-Purchase Onboarding & Review',
          hubFlowId: 'flow_post_purchase_ecom',
          exportFormat: 'hub',
          contactsEnrolled: 108,
          avgOpenRate: 72.4,
          avgClickRate: 34.8,
          steps: [
            {
              id: 's1',
              channel: 'email',
              delay: 'Instant',
              subject: 'Your order is confirmed + your quick-start guide 📦',
              previewText: 'Everything you need to know about your order',
              body: 'Hi [First Name],\n\nThank you for your order! Our warehouse team is already preparing your shipment with insured priority tracking.\n\nWhile your package is on its way, here is your quick-start guide to ensure you get the absolute best results from day one.\n\nBest regards,\nThe Team'
            },
            {
              id: 's2',
              channel: 'email',
              delay: '5 Days',
              subject: 'Checking in: How is your experience so far? ✨',
              previewText: 'We would love your honest feedback',
              body: 'Hi [First Name],\n\nYour order should have arrived! We would love to hear your initial thoughts. If you have any questions or need setup help, reply directly to this email and our support team will take care of you.\n\nWarmly,\nCustomer Experience Team'
            }
          ]
        }
      },
      {
        id: 'bp1-ty',
        type: 'thank-you',
        position: { x: 800, y: 360 },
        data: {
          type: 'thank-you',
          label: 'Order Confirmation & VIP Pass',
          slug: 'product-flagship-drop',
          headline: 'Your Order is Confirmed and in Production',
          subhead: 'We have received your order details and sent a confirmation receipt to your email inbox.',
          badgeText: 'Priority Customer Status',
          bounceBackDiscountCode: 'VIPRETURN',
          bounceBackDiscountText: '$15 Off Your Next Order',
          usageGuideTitle: 'Quick-Start Checklist',
          usageGuideSteps: [
            'Check your inbox for tracking updates and delivery alerts.',
            'Review our 2-minute quick-start setup video.',
            'Contact customer care anytime if you need custom assistance.'
          ],
          storeReturnText: 'Browse Additional Accessories',
          communityInviteText: 'Join Our Private Customer Community',
          pageViews: 108,
          bounceBackClaims: 18
        }
      }
    ],
    edges: [
      { id: 'e-bp1-1', source: 'bp1-ad', target: 'bp1-page', data: { sourceThroughput: 680, targetCount: 680, rate: 100 } },
      { id: 'e-bp1-2', source: 'bp1-page', target: 'bp1-seq', data: { sourceThroughput: 680, targetCount: 108, rate: 15.9 } },
      { id: 'e-bp1-3', source: 'bp1-page', target: 'bp1-ty', data: { sourceThroughput: 680, targetCount: 108, rate: 15.9 } }
    ]
  },
  {
    id: 'high-ticket-consultation',
    title: 'High-Ticket Client Consultation & Application',
    tagline: 'Authority Stack → Qualified Application → Calendar Booking',
    category: 'high-ticket',
    badge: 'Application & Booking',
    expectedAovLift: 'High Client Value',
    description: 'Designed for consulting firms, agencies, specialized professionals, and high-ticket service specialists. Filters traffic through an application gate and books pre-qualified discovery consultations.',
    nodes: [
      {
        id: 'bp2-ad',
        type: 'ad-source',
        position: { x: 50, y: 150 },
        data: {
          type: 'ad-source',
          label: 'Targeted Ad • High-Intent Search',
          platform: 'google',
          headline: 'Scale Your Business Without Overhead: Request Consultation',
          body: 'Work directly with our senior strategy team to build, optimize, and streamline your operations in 30 days.',
          ctaText: 'Apply for Strategy Session',
          imageUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=800&q=80',
          utmCampaign: 'high-ticket-consult-acquisition',
          impressions: 11000,
          clicks: 520,
          ctr: 4.7,
          spend: 480
        }
      },
      {
        id: 'bp2-page',
        type: 'landing-page',
        position: { x: 420, y: 140 },
        data: {
          type: 'landing-page',
          label: 'Case Study & Qualification Page',
          slug: 'private-consultation-application',
          headline: 'A Proven Framework to Accelerate Your Growth',
          subhead: 'We partner with established founders and executives to streamline execution, increase revenue, and eliminate operational bottlenecks.',
          bullets: [
            'Direct access to senior partners with verified industry track records',
            'Tailored 90-day implementation roadmap built for your specific model',
            'Full accountability and confidential weekly strategic reviews'
          ],
          trustBadge: 'Over $45M+ in verified client results generated across 180+ engagements',
          buttonText: 'Apply for Discovery Consultation',
          checkoutMode: 'lead-gate',
          postSubmitAction: 'modal_voucher',
          mobileStickyBarEnabled: true,
          visitors: 520,
          conversions: 84,
          conversionRate: 16.2
        }
      },
      {
        id: 'bp2-form',
        type: 'lead-form',
        position: { x: 420, y: 380 },
        data: {
          type: 'lead-form',
          label: 'Intake Application Form',
          formTitle: 'Confidential Client Application',
          submitButtonText: 'Submit Application & Pick Time',
          successMessage: 'Application received! Redirecting to calendar selection...',
          fields: [
            { id: 'f_name', label: 'Full Name', type: 'text', required: true, enabled: true, placeholder: 'Jane Doe' },
            { id: 'f_email', label: 'Business Email', type: 'email', required: true, enabled: true, placeholder: 'jane@company.com' },
            { id: 'f_tel', label: 'Direct Phone', type: 'tel', required: true, enabled: true, placeholder: '+1 (555) 012-3456' },
            { id: 'f_notes', label: 'Primary Business Goal', type: 'textarea', required: false, enabled: true, placeholder: 'What is your #1 operational bottleneck right now?' }
          ],
          views: 520,
          submissions: 84,
          completionRate: 16.2
        }
      },
      {
        id: 'bp2-seq',
        type: 'follow-up-sequence',
        position: { x: 800, y: 150 },
        data: {
          type: 'follow-up-sequence',
          label: 'Consultation Prep & Confirmation Series',
          sequenceTitle: 'High-Ticket Discovery Series',
          hubFlowId: 'flow_consultation_prep',
          exportFormat: 'hub',
          contactsEnrolled: 84,
          avgOpenRate: 81.5,
          avgClickRate: 46.2,
          steps: [
            {
              id: 's1',
              channel: 'email',
              delay: 'Instant',
              subject: 'Your consultation application is confirmed 🗓️',
              previewText: 'How to prepare for our discovery session',
              body: 'Hi [First Name],\n\nThank you for submitting your application. We have received your preliminary details and our senior partner has approved your strategy session.\n\nPlease review our briefing document attached so we can dive straight into high-leverage solutions during our call.\n\nWarm regards,\nStrategic Client Team'
            },
            {
              id: 's2',
              channel: 'email',
              delay: '24 Hours',
              subject: 'Case Study: How our methodology generated 3.4x ROI',
              previewText: 'A quick breakdown before our call',
              body: 'Hi [First Name],\n\nBefore we speak tomorrow, here is a 3-minute case breakdown showing how we solved a similar operational hurdle for an industry peer.\n\nLooking forward to speaking with you,\nThe Strategy Team'
            }
          ]
        }
      },
      {
        id: 'bp2-ty',
        type: 'thank-you',
        position: { x: 800, y: 380 },
        data: {
          type: 'thank-you',
          label: 'Booking Confirmed Portal',
          slug: 'consultation-confirmed',
          headline: 'Your Strategy Session is Locked On Our Calendar',
          subhead: 'Our team is preparing your preliminary audit. Check your email for calendar invite and conference link.',
          badgeText: 'Confirmed Session',
          usageGuideTitle: 'Next Steps Before the Call',
          usageGuideSteps: [
            'Add the calendar invitation to your schedule to receive automated reminders.',
            'Gather your current monthly key metrics for our collaborative audit.',
            'Ensure you are in a quiet workspace with video access enabled.'
          ],
          storeReturnText: 'Read Our Latest Research Reports',
          communityInviteText: 'Connect on LinkedIn',
          pageViews: 84,
          bounceBackClaims: 12
        }
      }
    ],
    edges: [
      { id: 'e-bp2-1', source: 'bp2-ad', target: 'bp2-page', data: { sourceThroughput: 520, targetCount: 520, rate: 100 } },
      { id: 'e-bp2-2', source: 'bp2-page', target: 'bp2-form', data: { sourceThroughput: 520, targetCount: 84, rate: 16.2 } },
      { id: 'e-bp2-3', source: 'bp2-form', target: 'bp2-seq', data: { sourceThroughput: 84, targetCount: 84, rate: 100 } },
      { id: 'e-bp2-4', source: 'bp2-form', target: 'bp2-ty', data: { sourceThroughput: 84, targetCount: 84, rate: 100 } }
    ]
  },
  {
    id: 'digital-product-membership',
    title: 'Digital Product, Course & SaaS Access Funnel',
    tagline: 'Sales Page → Instant Access Checkout + Order Bump Add-on',
    category: 'digital-product',
    badge: 'Instant Delivery',
    expectedAovLift: 'High Digital Margins',
    description: 'Designed for digital assets, SaaS subscriptions, training programs, and resource vaults. Features an integrated order bump for complementary resources and automated digital delivery.',
    nodes: [
      {
        id: 'bp3-ad',
        type: 'ad-source',
        position: { x: 50, y: 150 },
        data: {
          type: 'ad-source',
          label: 'Social Ad • Transformation Angle',
          platform: 'meta',
          headline: 'Master The Exact Playbook Used By Top 1% Operators',
          body: 'Get instant access to complete templates, operational SOPs, and video walkthroughs designed to save you 20+ hours per week.',
          ctaText: 'Unlock Full Access',
          imageUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80',
          utmCampaign: 'digital-playbook-meta',
          impressions: 28000,
          clicks: 1350,
          ctr: 4.82,
          spend: 540
        }
      },
      {
        id: 'bp3-page',
        type: 'landing-page',
        position: { x: 420, y: 140 },
        data: {
          type: 'landing-page',
          label: 'Digital Sales Page + Order Bump',
          slug: 'digital-mastery-pass',
          headline: 'The Complete Implementation Playbook & Toolkit',
          subhead: 'Stop reinventing the wheel. Get battle-tested SOPs, frameworks, and workflows ready to plug directly into your workflow.',
          bullets: [
            'Immediate lifetime access to all modules, templates, and spreadsheets',
            'Quarterly curriculum updates and live monthly Q&A masterminds',
            'Full 30-day no-questions-asked satisfaction guarantee'
          ],
          trustBadge: 'Used by over 3,200+ professionals across 40+ countries',
          buttonText: 'Enroll Now — Instant Download',
          discountCode: 'EARLYBIRD',
          checkoutMode: 'direct',
          shopifyProductId: '',
          shopifyVariantId: '',
          shopifyProductTitle: 'Complete Implementation Mastery Pass',
          shopifyProductPrice: '$147.00',
          shopifyProductImage: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80',
          orderBumpEnabled: true,
          orderBumpProductId: '',
          orderBumpVariantId: '',
          orderBumpTitle: 'VIP Template Pack & Private Implementation Vault',
          orderBumpPrice: '$37.00 (Save $60)',
          orderBumpImage: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=400&q=80',
          orderBumpHeadline: 'One-Time Add-On: Get 50+ Ready-to-Use Operational SOPs',
          orderBumpDescription: 'Check this box to unlock our full private template library with copy-paste automation scripts for just $37 (regularly $97).',
          mobileStickyBarEnabled: true,
          visitors: 1350,
          conversions: 182,
          conversionRate: 13.5
        }
      },
      {
        id: 'bp3-seq',
        type: 'follow-up-sequence',
        position: { x: 800, y: 150 },
        data: {
          type: 'follow-up-sequence',
          label: 'Member Welcome & Implementation Series',
          sequenceTitle: 'Digital Product Onboarding Series',
          hubFlowId: 'flow_digital_onboarding',
          exportFormat: 'hub',
          contactsEnrolled: 182,
          avgOpenRate: 78.4,
          avgClickRate: 52.1,
          steps: [
            {
              id: 's1',
              channel: 'email',
              delay: 'Instant',
              subject: 'Your access credentials + private member portal 🔑',
              previewText: 'Login details and start instructions',
              body: 'Hi [First Name],\n\nWelcome to the program! Here are your digital access credentials:\n\nPortal: [Member Login Link]\nUsername: [Email Address]\n\nWe recommend starting with Section 1: "The Core Framework" to get your first win today.\n\nEnjoy the material,\nThe Education Team'
            },
            {
              id: 's2',
              channel: 'email',
              delay: '3 Days',
              subject: 'Pro tip: Have you downloaded the companion workbook? 📑',
              previewText: 'Maximize your implementation speed',
              body: 'Hi [First Name],\n\nQuick tip: Make sure to make a copy of the interactive spreadsheet workbook in Module 2. It does all the calculations for you automatically.\n\nAccess portal: [Member Login Link]'
            }
          ]
        }
      },
      {
        id: 'bp3-ty',
        type: 'thank-you',
        position: { x: 800, y: 360 },
        data: {
          type: 'thank-you',
          label: 'Digital Delivery & Access Portal',
          slug: 'digital-mastery-pass',
          headline: 'Welcome to the Program — Your Access is Active',
          subhead: 'Your account has been provisioned and your receipt has been dispatched to your email.',
          badgeText: 'Verified Member',
          bounceBackDiscountCode: 'MEMBER20',
          bounceBackDiscountText: '20% Off Any Advanced Coaching Session',
          usageGuideTitle: 'Quick Onboarding Guide',
          usageGuideSteps: [
            'Click below to access your digital dashboard and set your password.',
            'Download the complete companion files and resource templates.',
            'Join our exclusive member Discord / Slack community.'
          ],
          storeReturnText: 'Access Member Dashboard Now',
          communityInviteText: 'Join Private Member Community',
          pageViews: 182,
          bounceBackClaims: 24
        }
      }
    ],
    edges: [
      { id: 'e-bp3-1', source: 'bp3-ad', target: 'bp3-page', data: { sourceThroughput: 1350, targetCount: 1350, rate: 100 } },
      { id: 'e-bp3-2', source: 'bp3-page', target: 'bp3-seq', data: { sourceThroughput: 1350, targetCount: 182, rate: 13.5 } },
      { id: 'e-bp3-3', source: 'bp3-page', target: 'bp3-ty', data: { sourceThroughput: 1350, targetCount: 182, rate: 13.5 } }
    ]
  },
  {
    id: 'vip-lead-magnet-discount',
    title: 'Universal VIP Lead Magnet & Nurture Series',
    tagline: '2-Step Value Gate (Lead Capture → Welcome Offer)',
    category: 'lead-magnet',
    badge: 'List Builder + Sales',
    expectedAovLift: 'List Growth & Front-End Conversions',
    description: 'Captures first-party email and phone leads with a high-value incentive (checklist, guide, or welcome voucher). Automatically delivers the asset via email and presents a limited-time welcome offer.',
    nodes: [
      {
        id: 'bp4-ad',
        type: 'ad-source',
        position: { x: 50, y: 150 },
        data: {
          type: 'ad-source',
          label: 'Top-of-Funnel Lead Ad',
          platform: 'tiktok',
          headline: 'Free Download: The 2026 Conversion Optimization Checklist',
          body: 'Discover the exact 27-point conversion audit we use to scale modern stores and funnels. 100% free download.',
          ctaText: 'Download Free Checklist',
          imageUrl: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=800&q=80',
          utmCampaign: 'lead-magnet-audit-checklist',
          impressions: 22000,
          clicks: 980,
          ctr: 4.45,
          spend: 420
        }
      },
      {
        id: 'bp4-page',
        type: 'landing-page',
        position: { x: 420, y: 140 },
        data: {
          type: 'landing-page',
          label: 'Resource Download Gate',
          slug: 'vip-audit-checklist',
          headline: 'Claim The 27-Point Growth & Conversion Checklist',
          subhead: 'Join over 15,000+ founders and operators who use our battle-tested audit framework to maximize customer acquisition and retention.',
          bullets: [
            'Instant PDF download sent directly to your inbox',
            'Includes step-by-step video breakdown of key funnel levers',
            'Complimentary access to our weekly strategic newsletter'
          ],
          trustBadge: 'Rated 4.9/5 stars by over 1,200+ verified founders and marketing directors',
          buttonText: 'Get Instant Free Access Now',
          discountCode: 'VIP15',
          checkoutMode: 'lead-gate',
          postSubmitAction: 'modal_voucher',
          mobileStickyBarEnabled: true,
          visitors: 980,
          conversions: 340,
          conversionRate: 34.7
        }
      },
      {
        id: 'bp4-seq',
        type: 'follow-up-sequence',
        position: { x: 800, y: 150 },
        data: {
          type: 'follow-up-sequence',
          label: 'Resource Delivery & Welcome Nurture',
          sequenceTitle: 'VIP Welcome Nurture Sequence',
          hubFlowId: 'flow_lead_magnet_welcome',
          exportFormat: 'hub',
          contactsEnrolled: 340,
          avgOpenRate: 68.4,
          avgClickRate: 36.2,
          steps: [
            {
              id: 's1',
              channel: 'email',
              delay: 'Instant',
              subject: 'Your 27-Point Checklist download is inside 📥',
              previewText: 'Download your file + a special welcome gift',
              body: 'Hi [First Name],\n\nHere is your direct download link: [Download Resource Link]\n\nAs a welcome gift, you also have access to an exclusive 15% discount on our flagship product using code VIP15 at checkout.\n\nEnjoy the guide,\nThe Team'
            },
            {
              id: 's2',
              channel: 'email',
              delay: '24 Hours',
              subject: 'The #1 mistake founders make when scaling funnels',
              previewText: 'Our clinical guide to customer retention',
              body: 'Hi [First Name],\n\nDid you know that over 65% of drop-off happens on the final checkout screen? Here is the exact fix we recommend...\n\nRead full guide: [Guide Link]'
            },
            {
              id: 's3',
              channel: 'email',
              delay: '48 Hours',
              subject: 'Reminder: Your 15% welcome code expires tonight',
              previewText: 'Don’t leave your discount behind',
              body: 'Hi [First Name],\n\nJust a quick heads up: your 15% welcome incentive expires tonight at midnight!\n\nClaim your order: [Store Link]'
            }
          ]
        }
      },
      {
        id: 'bp4-ty',
        type: 'thank-you',
        position: { x: 800, y: 360 },
        data: {
          type: 'thank-you',
          label: 'Download Delivery Portal',
          slug: 'vip-audit-checklist',
          headline: 'Your Guide is On Its Way To Your Inbox',
          subhead: 'Check your inbox in the next 60 seconds. You can also download the file directly below.',
          badgeText: 'Resource Unlocked',
          bounceBackDiscountCode: 'VIPRETURN',
          bounceBackDiscountText: '15% Off Your Next Core Order',
          usageGuideTitle: 'Recommended Implementation Plan',
          usageGuideSteps: [
            'Download the PDF checklist and print or bookmark it for your team.',
            'Review our top 3 quick wins to implement immediately this week.',
            'Apply your 15% VIP welcome voucher on our flagship store.'
          ],
          storeReturnText: 'Browse Our Complete Catalog',
          communityInviteText: 'Join Our Private Mastermind Group',
          pageViews: 340,
          bounceBackClaims: 52
        }
      }
    ],
    edges: [
      { id: 'e-bp4-1', source: 'bp4-ad', target: 'bp4-page', data: { sourceThroughput: 980, targetCount: 980, rate: 100 } },
      { id: 'e-bp4-2', source: 'bp4-page', target: 'bp4-seq', data: { sourceThroughput: 980, targetCount: 340, rate: 34.7 } },
      { id: 'e-bp4-3', source: 'bp4-page', target: 'bp4-ty', data: { sourceThroughput: 980, targetCount: 340, rate: 34.7 } }
    ]
  },
  {
    id: 'oto-upsell-funnel-system',
    title: 'Post-Purchase Upsell & Downsell Funnel',
    tagline: 'Landing Page → 1-Click Upsell (OTO) → Downsell → VIP Portal',
    category: 'aov-booster',
    badge: 'Post-Purchase Upsell',
    expectedAovLift: 'Maximum Order Value',
    description: 'The industry-standard architecture for maximizing customer lifetime value. After the initial purchase, customers are offered an exclusive 1-click upgrade. If declined, a lower-barrier downsell is presented before reaching the final confirmation.',
    nodes: [
      {
        id: 'bp5-ad',
        type: 'ad-source',
        position: { x: 50, y: 150 },
        data: {
          type: 'ad-source',
          label: 'Acquisition Ad • Core Offer',
          platform: 'meta',
          headline: 'The All-in-One Solution for Modern Teams: Save 20%',
          body: 'Built for speed, durability, and daily ease of use. Claim your special bundle before inventory sells out.',
          ctaText: 'Claim Special Bundle',
          imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80',
          utmCampaign: 'core-upsell-campaign',
          impressions: 24000,
          clicks: 1100,
          ctr: 4.6,
          spend: 520
        }
      },
      {
        id: 'bp5-page',
        type: 'landing-page',
        position: { x: 400, y: 140 },
        data: {
          type: 'landing-page',
          label: 'Core Offer Landing Page',
          slug: 'core-flagship-offer',
          headline: 'Experience Premium Quality Without The Markup',
          subhead: 'Direct-to-consumer craftsmanship designed to outperform market alternatives at half the price.',
          bullets: [
            'Tested and proven by thousands of daily users',
            'Full 30-day money-back satisfaction guarantee',
            'Priority courier delivery included with every order'
          ],
          trustBadge: 'Rated 4.9/5 stars by over 2,400+ verified customers',
          buttonText: 'Order Core Bundle — Instant Checkout',
          discountCode: 'WELCOME20',
          checkoutMode: 'direct',
          shopifyProductId: '',
          shopifyVariantId: '',
          shopifyProductTitle: 'Core Performance Unit',
          shopifyProductPrice: '$69.00',
          shopifyProductImage: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=80',
          mobileStickyBarEnabled: true,
          visitors: 1100,
          conversions: 165,
          conversionRate: 15.0
        }
      },
      {
        id: 'bp5-upsell',
        type: 'upsell',
        position: { x: 740, y: 140 },
        data: {
          type: 'upsell',
          label: 'Post-Purchase Upsell (OTO)',
          slug: 'vip-bundle-upsell',
          offerType: 'upsell',
          headline: 'Wait! Add The Deluxe Accessories Kit for 40% Off',
          subhead: 'This exclusive upgrade is only available on this screen. Complete your setup with our all-inclusive accessory kit.',
          badgeText: 'One-Time Secret Upgrade',
          productTitle: 'Deluxe Pro Accessories & Protection Suite',
          productPrice: '$39.00',
          regularPrice: '$65.00',
          discountPercentage: 40,
          productImage: 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?auto=format&fit=crop&w=600&q=80',
          benefits: [
            'Custom-molded protective travel case and premium accessories',
            '2-year extended warranty coverage included at zero extra cost',
            'Ships together in your main box with free priority upgrade'
          ],
          acceptButtonText: 'Yes! Add Upgrade to My Order ($39.00)',
          declineButtonText: 'No thanks, I will stick with the standard package',
          views: 165,
          takes: 58,
          conversionRate: 35.15
        }
      },
      {
        id: 'bp5-downsell',
        type: 'upsell',
        position: { x: 740, y: 380 },
        data: {
          type: 'upsell',
          label: 'Downsell Alternative',
          slug: 'mini-essentials-downsell',
          offerType: 'downsell',
          headline: 'How About Our Compact Essentials Pack for Just $19?',
          subhead: 'If you do not need the full suite, grab the core essentials at an unbeatable one-time price.',
          badgeText: 'Final Opportunity',
          productTitle: 'Compact Essentials Pack',
          productPrice: '$19.00',
          regularPrice: '$35.00',
          discountPercentage: 45,
          productImage: 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?auto=format&fit=crop&w=600&q=80',
          benefits: [
            'Essential adapters and microfiber maintenance cloth',
            'Immediate addition to current order with zero extra shipping'
          ],
          acceptButtonText: 'Add Essentials Pack for $19.00',
          declineButtonText: 'Skip and take me to my order receipt',
          views: 107,
          takes: 31,
          conversionRate: 28.97
        }
      },
      {
        id: 'bp5-ty',
        type: 'thank-you',
        position: { x: 1080, y: 240 },
        data: {
          type: 'thank-you',
          label: 'Final VIP Order Summary',
          slug: 'core-flagship-offer',
          headline: 'Your Complete Order is Confirmed & Locked',
          subhead: 'All items and upgrades have been merged into a single priority shipment. Here is your tracking receipt.',
          badgeText: 'VIP Order Merged',
          bounceBackDiscountCode: 'VIPRETURN',
          bounceBackDiscountText: '$20 Off Your Next Reorder',
          usageGuideTitle: 'What to Expect Next',
          usageGuideSteps: [
            'You will receive a shipment notification email with tracking information within 24 hours.',
            'Download our digital product manual while you wait for delivery.',
            'Our 24/7 support team is available if you have any questions.'
          ],
          storeReturnText: 'Browse The Store',
          communityInviteText: 'Join Customer Circle',
          pageViews: 165,
          bounceBackClaims: 32
        }
      }
    ],
    edges: [
      { id: 'e-bp5-1', source: 'bp5-ad', target: 'bp5-page', data: { sourceThroughput: 1100, targetCount: 1100, rate: 100 } },
      { id: 'e-bp5-2', source: 'bp5-page', target: 'bp5-upsell', data: { sourceThroughput: 1100, targetCount: 165, rate: 15.0 } },
      { id: 'e-bp5-3', source: 'bp5-upsell', target: 'bp5-downsell', data: { sourceThroughput: 107, targetCount: 107, rate: 100 } },
      { id: 'e-bp5-4', source: 'bp5-upsell', target: 'bp5-ty', data: { sourceThroughput: 58, targetCount: 58, rate: 100 } },
      { id: 'e-bp5-5', source: 'bp5-downsell', target: 'bp5-ty', data: { sourceThroughput: 107, targetCount: 107, rate: 100 } }
    ]
  },
  {
    id: 'turnkey-retention-ecosystem',
    title: 'The Complete Acquisition & Courtesy Retention Engine',
    tagline: 'Paid Ad → Hero Landing Page → 1-Click OTO Upsell → 24h Courtesy Rescue & Cart Recovery',
    category: 'retention',
    badge: 'Flagship Retention Engine',
    expectedAovLift: '+38% Net Revenue Recovered',
    description: 'Engineered for luxury skincare and modern wellness brands. Pairs high-converting front-end acquisition and 1-click upsells with automated 24h courtesy rescue and abandoned cart safety nets.',
    nodes: [
      {
        id: 'bp6-ad',
        type: 'ad-source',
        position: { x: 50, y: 160 },
        data: {
          type: 'ad-source',
          label: 'Meta Ad • The Radiance Ritual',
          platform: 'meta',
          headline: 'Elevate Your Daily Ritual: The Botanical Peptide Duo',
          body: 'Formulated with cold-pressed rosehip and active botanicals for radiant, nourished skin. Enjoy complimentary priority shipping on your first set.',
          ctaText: 'Discover Your Ritual',
          imageUrl: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=800&q=80',
          utmCampaign: 'flagship-radiance-duo',
          impressions: 32000,
          clicks: 1480,
          ctr: 4.6,
          spend: 680
        }
      },
      {
        id: 'bp6-page',
        type: 'landing-page',
        position: { x: 420, y: 160 },
        data: {
          type: 'landing-page',
          label: 'Flagship Offer & Order Bump',
          slug: 'radiance-ritual-flagship',
          headline: 'The Radiance Duo: Daily Botanical Nurture for Glowing Skin',
          subhead: 'A gentle, concentrated daily treatment formulated with cold-pressed rosehip and botanical squalane.',
          bullets: [
            'Concentrated plant actives for continuous daytime hydration',
            'Formulated with organic rosehip, cold-pressed squalane, and green tea',
            'Includes personalized concierge guidance and insured priority dispatch'
          ],
          trustBadge: 'Handcrafted in small batches with sustainably sourced botanical extracts',
          buttonText: 'Claim Your Radiance Set — Instant Checkout',
          discountCode: 'WELCOME10',
          checkoutMode: 'direct',
          shopifyProductId: '',
          shopifyVariantId: '',
          shopifyProductTitle: 'The Radiance Concentrate (50ml)',
          shopifyProductPrice: '$68.00',
          shopifyProductImage: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=800&q=80',
          mobileStickyBarEnabled: true,
          orderBumpEnabled: true,
          orderBumpTitle: 'Illuminating Eye Elixir (15ml)',
          orderBumpPrice: '$24.00',
          orderBumpHeadline: 'One-Time Privilege: Illuminating Eye Elixir',
          orderBumpDescription: 'Revitalize and brighten tired eye contours with cold-pressed green tea caffeine and active botanicals.',
          orderBumpImage: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=600&q=80',
          visitors: 1480,
          conversions: 236,
          conversionRate: 15.9
        }
      },
      {
        id: 'bp6-upsell',
        type: 'upsell',
        position: { x: 790, y: 160 },
        data: {
          type: 'upsell',
          label: '1-Click Upsell: Overnight Elixir',
          slug: 'overnight-recovery-elixir',
          offerType: 'upsell',
          headline: 'Complete Your Evening Protocol With The Night Recovery Elixir',
          subhead: 'Replenish your skin barrier overnight with pure botanical lipids and bakuchiol. Add this companion formula for 40% off before your box seals.',
          badgeText: 'Private 40% VIP Privilege',
          urgencyMinutes: 5,
          productTitle: 'Overnight Barrier Recovery Elixir (30ml)',
          productPrice: '$38.00',
          regularPrice: '$64.00',
          discountPercentage: 40,
          productImage: 'https://images.unsplash.com/photo-1608248597359-54859e9177a4?auto=format&fit=crop&w=600&q=80',
          benefits: [
            'Evening lipid barrier support that works in synergy with your daytime ritual',
            'Zero additional shipping fee — packed directly into your primary parcel',
            'Small-batch botanical formula bottled fresh'
          ],
          acceptButtonText: 'Yes! Add Overnight Elixir to My Order ($38.00)',
          declineButtonText: 'No thank you, I will stick with my daytime treatment',
          views: 236,
          takes: 94,
          conversionRate: 39.83,
          totalDeclines: 142,
          recoveredTakes: 26,
          recoveredRevenue: 884,
          recoveryRate: 18.3
        }
      },
      {
        id: 'bp6-ty',
        type: 'thank-you',
        position: { x: 1160, y: 160 },
        data: {
          type: 'thank-you',
          label: 'VIP Order Receipt & Portal',
          slug: 'radiance-ritual-flagship',
          headline: 'Your Radiance Ritual is Confirmed & Being Prepared',
          subhead: 'We have received your order details and sent a confirmation receipt with insured tracking to your email inbox.',
          badgeText: 'VIP Client Status',
          bounceBackDiscountCode: 'VIPGLOW15',
          bounceBackDiscountText: '$15 Off Your Next Replenishment',
          usageGuideTitle: 'Your 3-Step Radiance Protocol',
          usageGuideSteps: [
            'Step 1: Cleanse with warm water and gently pat skin dry.',
            'Step 2: Smooth 3-4 drops of The Radiance Concentrate over face and neck.',
            'Step 3: Check your inbox for your tracking link and skin wellness guide.'
          ],
          storeReturnText: 'Explore Complete Collection',
          communityInviteText: 'Join The Private Skin Sanctuary',
          pageViews: 236,
          bounceBackClaims: 48
        }
      },
      {
        id: 'bp6-cart-recovery',
        type: 'follow-up-sequence',
        position: { x: 420, y: 440 },
        data: {
          type: 'follow-up-sequence',
          label: 'Cart Abandonment Recovery',
          sequenceTitle: 'Abandoned Checkout Recovery Sequence',
          sequenceType: 'checkout_recovery',
          isRetentionBranch: true,
          delayHours: 1,
          voucherCode: 'COMPLETE10',
          smartExitOnPurchase: true,
          hubFlowId: 'flow_abandoned_cart_recovery',
          contactsEnrolled: 380,
          avgOpenRate: 68.4,
          avgClickRate: 31.2,
          steps: [
            {
              id: 'cr1',
              channel: 'email',
              delay: '1 Hour',
              subject: 'Did you leave your Radiance Ritual behind? ✨',
              previewText: 'Your personalized skincare bag is held for 24 hours',
              body: 'Hi [First Name],\n\nWe noticed you started setting up your Radiance Ritual but did not complete checkout.\n\nTo help you get started, we have held your cart and reserved complimentary priority shipping:\n[Checkout Link]\n\nWarmly,\nThe Beauty Concierge'
            },
            {
              id: 'cr2',
              channel: 'email',
              delay: '20 Hours',
              subject: 'Private courtesy: 10% off your Radiance Ritual before it expires',
              previewText: 'Use voucher COMPLETE10 at checkout',
              body: 'Hi [First Name],\n\nYour cart reservation is expiring soon. As a courtesy, enjoy 10% off with code COMPLETE10:\n[Checkout Link]\n\nWith care,\nClient Care Team'
            }
          ]
        }
      },
      {
        id: 'bp6-upsell-rescue',
        type: 'follow-up-sequence',
        position: { x: 790, y: 440 },
        data: {
          type: 'follow-up-sequence',
          label: '24h Courtesy Rescue (Upsell Decline)',
          sequenceTitle: '24h Post-Decline Companion Rescue',
          sequenceType: 'upsell_recovery',
          isRetentionBranch: true,
          delayHours: 18,
          voucherCode: 'SAVE10',
          smartExitOnPurchase: true,
          hubFlowId: 'flow_upsell_rescue_24h',
          contactsEnrolled: 142,
          avgOpenRate: 74.2,
          avgClickRate: 36.8,
          steps: [
            {
              id: 'ur1',
              channel: 'email',
              delay: '18 Hours',
              subject: 'A private courtesy reservation for your recent order ✨',
              previewText: 'We held a companion formula reservation for your skincare routine',
              body: 'Hi [First Name],\n\nThank you again for your order! While our apothecary team prepares your package, we noticed you passed on the Night Recovery Elixir.\n\nBecause the elixir is formulated to pair with your daytime duo, we held a courtesy bottle with a private 10% privilege.\n\nUse voucher code SAVE10 at checkout:\n[Offer Link]\n\nThis courtesy reservation remains active for 24 hours.\n\nWarm regards,\nThe Apothecary Team'
            }
          ]
        }
      }
    ],
    edges: [
      { id: 'e-bp6-1', source: 'bp6-ad', target: 'bp6-page', data: { sourceThroughput: 1480, targetCount: 1480, rate: 100 } },
      { id: 'e-bp6-2', source: 'bp6-page', target: 'bp6-upsell', sourceHandle: 'accepted', data: { sourceThroughput: 1480, targetCount: 236, rate: 15.9, sourceHandle: 'accepted' } },
      { id: 'e-bp6-3', source: 'bp6-page', target: 'bp6-cart-recovery', sourceHandle: 'abandon', targetHandle: 'retention-in', data: { isRetentionEdge: true, sourceHandle: 'abandon', targetHandle: 'retention-in', sourceThroughput: 1244, targetCount: 380, rate: 30.5 } },
      { id: 'e-bp6-4', source: 'bp6-upsell', target: 'bp6-ty', sourceHandle: 'accepted', data: { sourceHandle: 'accepted', sourceThroughput: 236, targetCount: 94, rate: 39.8 } },
      { id: 'e-bp6-5', source: 'bp6-upsell', target: 'bp6-upsell-rescue', sourceHandle: 'rescue', targetHandle: 'retention-in', data: { isRetentionEdge: true, sourceHandle: 'rescue', targetHandle: 'retention-in', sourceThroughput: 142, targetCount: 142, rate: 100 } },
      { id: 'e-bp6-6', source: 'bp6-upsell-rescue', target: 'bp6-ty', data: { isRetentionEdge: true, sourceThroughput: 142, targetCount: 26, rate: 18.3 } }
    ]
  }
];
