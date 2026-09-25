import type { JourneyNode, JourneyEdge } from '../types/journey';

export interface EcomBlueprint {
  id: string;
  title: string;
  tagline: string;
  category: 'direct-checkout' | 'lead-magnet' | 'aov-booster';
  badge: string;
  description: string;
  expectedAovLift: string;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
}

export const ECOM_BLUEPRINTS: EcomBlueprint[] = [
  {
    id: 'single-product-flash-drop',
    title: 'Single-Product Flash Drop',
    tagline: '1-Click Direct to Shopify Checkout (Frictionless Default)',
    category: 'direct-checkout',
    badge: 'Fastest Checkout',
    expectedAovLift: 'High Conversion Speed',
    description: 'Designed for cold and warm ad traffic. Eliminates cart steps and drops shoppers straight into accelerated Shopify checkout with an auto-applied discount coupon.',
    nodes: [
      {
        id: 'bp1-ad',
        type: 'ad-source',
        position: { x: 50, y: 150 },
        data: {
          type: 'ad-source',
          label: 'Meta Ad • Flash Drop',
          platform: 'meta',
          headline: '48-Hour Vault Access: 20% Off Luminous Radiance',
          body: 'Clinical-grade 15% active Vitamin C and hyaluronic complex. Instant barrier hydration and visible morning glow.',
          ctaText: 'Shop Secret Drop',
          imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=800&q=80',
          utmCampaign: 'flash-drop-meta',
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
          label: 'Product Flash Landing Page',
          slug: 'flash-radiance-drop',
          headline: 'Experience Clinical Radiance in 7 Days',
          subhead: 'A lightweight botanical serum formulated with active ethyl-ascorbic acid to visibly even skin tone and restore barrier bounce.',
          bullets: [
            '15% Stabilized Vitamin C for brightening without stinging',
            'Multi-weight Hyaluronic Acid locks in 48-hour hydration',
            '100% cruelty-free, vegan & dermatologist approved'
          ],
          trustBadge: 'Rated 4.9/5 stars by over 1,400+ verified beauty lovers',
          buttonText: 'Buy Now — Instant Checkout',
          discountCode: 'FLASH20',
          checkoutMode: 'direct',
          shopifyProductId: 'gid://shopify/Product/84920194821',
          shopifyVariantId: '42109840192',
          shopifyProductTitle: 'Luminous Vitamin C Radiance Serum',
          shopifyProductPrice: '$58.00',
          shopifyProductImage: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=800&q=80',
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
          label: 'Customer Onboarding & Review',
          sequenceTitle: 'Post-Purchase Radiance Guide',
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
              subject: 'Your order is confirmed + your founder routine guide 🧴',
              previewText: 'How to get maximum glow from day 1',
              body: 'Hi [First Name],\n\nThank you for claiming your Flash Drop order! While our team prepares your package with insured tracking, here is the exact 3-step routine our founder recommends for optimal absorption:\n\n1. Apply 3-4 drops onto damp skin.\n2. Gently press into face and neck.\n3. Follow with your favorite moisturizer to lock in active ceramides.\n\nWarmly,\nThe Jourvance Team'
            },
            {
              id: 's2',
              channel: 'email',
              delay: '5 Days',
              subject: 'Checking in: how does your skin feel? ✨',
              previewText: 'Quick radiance check-in',
              body: 'Hi [First Name],\n\nYour order should have arrived! We would love to hear your first impressions. Reply directly to this email if you have any questions about layering products.'
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
          label: 'VIP Order Confirmation',
          slug: 'flash-radiance-drop',
          headline: 'Your VIP Allocation & Order is Confirmed',
          subhead: 'Your small-batch Vitamin C formulation is in preparation. Here is your ritual usage guide.',
          badgeText: 'VIP Member Privilege',
          bounceBackDiscountCode: 'VIPRETURN',
          bounceBackDiscountText: '$15 Off Your Next Renewal Formulation',
          usageGuideTitle: 'The 3-Step Radiance Ritual',
          usageGuideSteps: [
            'Cleanse with warm water to prime cellular absorption.',
            'Warm 3-4 drops between palms and press gently into face & neck.',
            'Follow with moisturizer to seal active bio-actives for 48 hours.'
          ],
          storeReturnText: 'Browse Complimentary Formulations',
          communityInviteText: 'Join The Private VIP Beauty Circle',
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
    id: 'vip-lead-magnet-discount',
    title: 'VIP 15% Off Lead Gate',
    tagline: '2-Step Lead Gate (Email Capture → Direct Checkout)',
    category: 'lead-magnet',
    badge: 'List Builder + Sales',
    expectedAovLift: 'Lead, then checkout',
    description: 'Captures first-party email leads before purchase with a VIP discount code modal. Ingests contacts into Hub Email and automatically routes them to Shopify checkout with coupon applied.',
    nodes: [
      {
        id: 'bp2-ad',
        type: 'ad-source',
        position: { x: 50, y: 150 },
        data: {
          type: 'ad-source',
          label: 'TikTok Ad • VIP Coupon',
          platform: 'tiktok',
          headline: 'Unlock 15% Off Our Bestselling Serum',
          body: 'Discover why aesthetic clinics recommend our botanical ceramide complex. Claim your VIP voucher code today.',
          ctaText: 'Claim 15% VIP Voucher',
          imageUrl: 'https://images.unsplash.com/photo-1608248597359-5563a628867a?auto=format&fit=crop&w=800&q=80',
          utmCampaign: 'vip-voucher-tt',
          impressions: 22000,
          clicks: 980,
          ctr: 4.45,
          spend: 420
        }
      },
      {
        id: 'bp2-page',
        type: 'landing-page',
        position: { x: 420, y: 140 },
        data: {
          type: 'landing-page',
          label: 'VIP Voucher Lead Landing Page',
          slug: 'vip-welcome-offer',
          headline: 'Claim Your VIP 15% Skincare Voucher',
          subhead: 'Join over 12,000+ members who receive exclusive small-batch drops, complimentary masterclasses, and instant discount codes.',
          bullets: [
            'Instant 15% discount code applied at Shopify checkout',
            'Early VIP access to limited-edition botanical drops',
            'Full 30-day money-back satisfaction guarantee'
          ],
          trustBadge: 'Rated 4.9/5 stars by over 1,200+ verified buyers',
          buttonText: 'Claim 15% VIP Voucher & Shop',
          discountCode: 'VIP15',
          checkoutMode: 'lead-gate',
          postSubmitAction: 'redirect_checkout',
          shopifyProductId: 'gid://shopify/Product/84920194821',
          shopifyVariantId: '42109840192',
          shopifyProductTitle: 'Luminous Vitamin C Radiance Serum',
          shopifyProductPrice: '$58.00',
          shopifyProductImage: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=800&q=80',
          visitors: 980,
          conversions: 340,
          conversionRate: 34.7
        }
      },
      {
        id: 'bp2-seq',
        type: 'follow-up-sequence',
        position: { x: 800, y: 150 },
        data: {
          type: 'follow-up-sequence',
          label: 'VIP 3-Part Nurture Series',
          sequenceTitle: 'VIP Welcome & Drip Sequence',
          hubFlowId: 'flow_ecom_welcome',
          exportFormat: 'hub',
          contactsEnrolled: 340,
          avgOpenRate: 64.2,
          avgClickRate: 29.5,
          steps: [
            {
              id: 's1',
              channel: 'email',
              delay: 'Instant',
              subject: 'Your 15% VIP coupon code is inside 🎁',
              previewText: 'Welcome to the inner circle',
              body: 'Hi [First Name],\n\nWelcome to our VIP inner circle! Here is your exclusive 15% discount code: VIP15.\n\nUse it at checkout: [Checkout Link]\n\nEnjoy your new routine,\nThe Team'
            },
            {
              id: 's2',
              channel: 'email',
              delay: '24 Hours',
              subject: 'The secret to glowing skin without redness',
              previewText: 'Our clinical guide to active antioxidants',
              body: 'Hi [First Name],\n\nMany Vitamin C formulations cause irritation because of unstable acidity. Here is how our formulation protects your moisture barrier...\n\nClaim your order: [Checkout Link]'
            },
            {
              id: 's3',
              channel: 'email',
              delay: '48 Hours',
              subject: 'Notice: Your VIP 15% code expires at midnight',
              previewText: 'Don’t leave your discount behind',
              body: 'Hi [First Name],\n\nJust a quick heads up: your 15% VIP code expires tonight!\n\nClaim your bottle now: [Checkout Link]'
            }
          ]
        }
      },
      {
        id: 'bp2-ty',
        type: 'thank-you',
        position: { x: 800, y: 360 },
        data: {
          type: 'thank-you',
          label: 'VIP Voucher Confirmation',
          slug: 'vip-welcome-offer',
          headline: 'Your VIP 15% Pass Has Been Activated',
          subhead: 'Welcome to our inner beauty collective. Your voucher has been generated and your ritual is ready.',
          badgeText: 'VIP Member Perk',
          bounceBackDiscountCode: 'VIPRETURN',
          bounceBackDiscountText: '$15 Off Your Next Renewal Formulation',
          usageGuideTitle: 'The 3-Step Radiance Ritual',
          usageGuideSteps: [
            'Cleanse with warm water to prime cellular absorption.',
            'Warm 3-4 drops between palms and press gently into face & neck.',
            'Follow with moisturizer to seal active bio-actives for 48 hours.'
          ],
          storeReturnText: 'Browse Complimentary Formulations',
          communityInviteText: 'Join The Private VIP Beauty Circle',
          pageViews: 340,
          bounceBackClaims: 52
        }
      }
    ],
    edges: [
      { id: 'e-bp2-1', source: 'bp2-ad', target: 'bp2-page', data: { sourceThroughput: 980, targetCount: 980, rate: 100 } },
      { id: 'e-bp2-2', source: 'bp2-page', target: 'bp2-seq', data: { sourceThroughput: 980, targetCount: 340, rate: 34.7 } },
      { id: 'e-bp2-3', source: 'bp2-page', target: 'bp2-ty', data: { sourceThroughput: 980, targetCount: 340, rate: 34.7 } }
    ]
  },
  {
    id: 'high-aov-duo-bundle',
    title: 'High-AOV Duo & Order Bump',
    tagline: 'Core Product + 1-Click Complementary Add-On (AOV Booster)',
    category: 'aov-booster',
    badge: 'Order bump',
    expectedAovLift: 'Order bump on the page',
    description: 'Generates multi-item cart permalinks (/cart/v1:1,v2:1). Shoppers can tick a 1-click in-line order bump to add a complementary product with special bundle savings.',
    nodes: [
      {
        id: 'bp3-ad',
        type: 'ad-source',
        position: { x: 50, y: 150 },
        data: {
          type: 'ad-source',
          label: 'Meta Ad • Routine Upgrade',
          platform: 'meta',
          headline: 'Double Your Radiance: The Complete Botanical Ritual',
          body: 'Pair our Vitamin C Serum with Velvet Botanical Renewal Oil. Lock in moisture and wake up to glowing glass skin.',
          ctaText: 'Unlock Ritual Duo',
          imageUrl: 'https://images.unsplash.com/photo-1601049541289-9b1b7bbbfe19?auto=format&fit=crop&w=800&q=80',
          utmCampaign: 'aov-duo-meta',
          impressions: 18500,
          clicks: 740,
          ctr: 4.0,
          spend: 370
        }
      },
      {
        id: 'bp3-page',
        type: 'landing-page',
        position: { x: 420, y: 140 },
        data: {
          type: 'landing-page',
          label: 'Duo Landing Page + Order Bump',
          slug: 'botanical-radiance-duo',
          headline: 'Awaken Your Skin’s Natural Radiance',
          subhead: 'Our bestselling daily Vitamin C serum paired with overnight restorative botanical oil for intense hydration and cellular renewal.',
          bullets: [
            'Instant plumping and long-lasting barrier hydration',
            'Cold-pressed marula and rosehip seed seed oils',
            'Save 25% when you complete the duo today'
          ],
          trustBadge: 'Rated 4.9/5 stars by over 2,100+ verified clients',
          buttonText: 'Buy Now — Instant Checkout',
          discountCode: 'RITUAL20',
          checkoutMode: 'direct',
          shopifyProductId: 'gid://shopify/Product/84920194821',
          shopifyVariantId: '42109840192',
          shopifyProductTitle: 'Luminous Vitamin C Radiance Serum',
          shopifyProductPrice: '$58.00',
          shopifyProductImage: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=800&q=80',
          // Order Bump Configuration
          orderBumpEnabled: true,
          orderBumpProductId: 'gid://shopify/Product/84920194822',
          orderBumpVariantId: '42109840194',
          orderBumpTitle: 'Velvet Botanical Renewal Oil (30ml)',
          orderBumpPrice: '$38.00 (Save $26)',
          orderBumpImage: 'https://images.unsplash.com/photo-1601049541289-9b1b7bbbfe19?auto=format&fit=crop&w=400&q=80',
          orderBumpHeadline: 'One-Time Offer: Complete Your Routine with Velvet Renewal Oil',
          orderBumpDescription: 'Tick this box to add our restorative cold-pressed marula oil for just $38 (regular $64). Locks in your Vitamin C serum for 48 hours.',
          visitors: 740,
          conversions: 142,
          conversionRate: 19.2
        }
      },
      {
        id: 'bp3-seq',
        type: 'follow-up-sequence',
        position: { x: 800, y: 150 },
        data: {
          type: 'follow-up-sequence',
          label: 'Duo Care & Cross-Sell',
          sequenceTitle: 'Ritual Guide & Replenishment',
          hubFlowId: 'flow_duo_replenish',
          exportFormat: 'hub',
          contactsEnrolled: 142,
          avgOpenRate: 69.8,
          avgClickRate: 31.2,
          steps: [
            {
              id: 's1',
              channel: 'email',
              delay: 'Instant',
              subject: 'How to layer your Radiance Serum & Renewal Oil ✨',
              previewText: 'Your AM/PM layering secret',
              body: 'Hi [First Name],\n\nCongratulations on securing your Ritual Duo! Here is how to cocktail these two potent formulas for glass skin:\n\nAM Routine: Cleanse, apply 3 drops of Vitamin C Serum, followed by SPF.\nPM Routine: After serum, press 2 drops of Velvet Renewal Oil into your cheeks and forehead to lock in moisture overnight.\n\nWarm regards,\nThe Jourvance Team'
            },
            {
              id: 's2',
              channel: 'email',
              delay: '30 Days',
              subject: 'Time to replenish your favorites? Save 20% on refills 🌿',
              previewText: 'Never run out of your glow ritual',
              body: 'Hi [First Name],\n\nIf you are halfway through your bottles, grab your refill before our next small batch sells out with code: REFILL20.\n\nOrder refills: [Checkout Link]'
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
          label: 'Ritual Duo Confirmation',
          slug: 'duo-radiance-upgrade',
          headline: 'Your Complete Ritual Duo is Confirmed',
          subhead: 'Your small-batch Vitamin C Serum and Velvet Renewal Oil are being hand-blended and packaged with care.',
          badgeText: 'VIP Member Privilege',
          bounceBackDiscountCode: 'VIPRETURN',
          bounceBackDiscountText: '$15 Off Your Next Renewal Formulation',
          usageGuideTitle: 'The Complete AM / PM Layering Ritual',
          usageGuideSteps: [
            'AM: Cleanse gently, then pat 3 drops of Vitamin C Serum into damp skin before SPF.',
            'PM: After serum, press 2-3 drops of Velvet Renewal Oil into cheeks to lock in active ceramides.',
            'Weekly: Focus extra drops on dry zones or decolletage for intense cellular recovery.'
          ],
          storeReturnText: 'Browse Complimentary Formulations',
          communityInviteText: 'Join The Private VIP Beauty Circle',
          pageViews: 142,
          bounceBackClaims: 28
        }
      }
    ],
    edges: [
      { id: 'e-bp3-1', source: 'bp3-ad', target: 'bp3-page', data: { sourceThroughput: 740, targetCount: 740, rate: 100 } },
      { id: 'e-bp3-2', source: 'bp3-page', target: 'bp3-seq', data: { sourceThroughput: 740, targetCount: 142, rate: 19.2 } },
      { id: 'e-bp3-3', source: 'bp3-page', target: 'bp3-ty', data: { sourceThroughput: 740, targetCount: 142, rate: 19.2 } }
    ]
  },
  {
    id: 'oto-upsell-funnel-system',
    title: 'Post-Purchase Upsell & Downsell Branch',
    tagline: 'Landing Page → 1-Click Upsell (OTO) → Downsell → VIP Portal',
    category: 'aov-booster',
    badge: 'Post-purchase upsell',
    expectedAovLift: 'Upsell after checkout',
    description: 'The industry-standard high-ticket funnel architecture. After initial checkout, buyers are presented with an exclusive 1-click replenishment reserve (OTO). If declined, it branches to a lower-friction travel downsell before landing on the VIP confirmation portal.',
    nodes: [
      {
        id: 'bp4-ad',
        type: 'ad-source',
        position: { x: 50, y: 150 },
        data: {
          type: 'ad-source',
          label: 'Meta Ad • Core Offer',
          platform: 'meta',
          headline: 'Unlock Clinical Grade Cellular Radiance',
          body: 'Formulated with 15% pure Vitamin C and barrier-restoring botanical peptides. Clinically proven results in 7 days.',
          ctaText: 'Claim Special Offer',
          imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=800&q=80',
          utmCampaign: 'oto-radiance-meta',
          impressions: 24000,
          clicks: 1100,
          ctr: 4.6,
          spend: 520
        }
      },
      {
        id: 'bp4-page',
        type: 'landing-page',
        position: { x: 400, y: 140 },
        data: {
          type: 'landing-page',
          label: 'Core Offer Landing Page',
          slug: 'oto-radiance-offer',
          headline: 'Experience Luminous Vitamin C Radiance',
          subhead: 'Formulated with active ethyl-ascorbic acid and lipid-barrier peptides for instant plumping and long-lasting glow.',
          bullets: [
            'Noticeable radiance and tone balance in 7 days',
            'Clinically stable 15% Vitamin C formulation',
            'Backed by 30-day money-back satisfaction guarantee'
          ],
          trustBadge: 'Rated 4.9/5 stars by over 2,400+ verified beauty clients',
          buttonText: 'Claim 15% VIP Voucher & Checkout',
          discountCode: 'WELCOME15',
          checkoutMode: 'direct',
          shopifyProductId: 'gid://shopify/Product/84920194821',
          shopifyVariantId: '42109840192',
          shopifyProductTitle: 'Luminous Vitamin C Radiance Serum',
          shopifyProductPrice: '$58.00',
          shopifyProductImage: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=800&q=80',
          visitors: 1100,
          conversions: 240,
          conversionRate: 21.8
        }
      },
      {
        id: 'bp4-upsell',
        type: 'upsell',
        position: { x: 750, y: 80 },
        data: {
          type: 'upsell',
          label: '1-Click Upsell (OTO)',
          slug: 'oto-radiance-offer',
          offerType: 'upsell',
          headline: 'Wait! Add Our 90-Day Replenishment Reserve for 40% Off',
          subhead: 'Your initial parcel is being prepped. Lock in your private laboratory batch allocation before dispatch.',
          badgeText: 'SAVE 40% VIP OFFER',
          urgencyMinutes: 5,
          productTitle: 'Bioactive Triple Barrier Replenishment Reserve (90-Day Supply)',
          productPrice: '$38.00',
          regularPrice: '$64.00',
          discountPercentage: 40,
          discountCode: 'VIPOTO40',
          productImage: 'https://images.unsplash.com/photo-1601049541289-9b1b7bbbfe19?auto=format&fit=crop&w=600&q=80',
          benefits: [
            'Direct batch allocation from master cosmetic formulation',
            'Full 90-day cellular barrier replenishment supply',
            'Includes complimentary priority expedited shipping'
          ],
          acceptButtonText: '⚡ Yes, Upgrade My Order (1-Tap Checkout)',
          declineButtonText: 'No thanks, skip this offer',
          downsellSlug: 'downsell',
          views: 240,
          takes: 62,
          conversionRate: 25.8,
          attributedRevenue: 2356.00
        }
      },
      {
        id: 'bp4-downsell',
        type: 'upsell',
        position: { x: 750, y: 350 },
        data: {
          type: 'upsell',
          label: 'Downsell Step',
          slug: 'oto-radiance-offer',
          offerType: 'downsell',
          headline: 'Wait! Try The Deluxe Travel Mini for Just $24',
          subhead: 'Before your parcel leaves our fulfillment lab, claim our bestselling travel duo at half off.',
          badgeText: 'SAVE 50% DOWNSELL',
          urgencyMinutes: 3,
          productTitle: 'Deluxe Travel Ritual Duo (Serum + Barrier Balm Mini)',
          productPrice: '$24.00',
          regularPrice: '$48.00',
          discountPercentage: 50,
          discountCode: 'VIPDOWN50',
          productImage: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=600&q=80',
          benefits: [
            'Handy travel size perfect for carry-on luggage',
            'Includes trial size Barrier Recovery Balm',
            'Ships inside your existing parcel at zero extra shipping cost'
          ],
          acceptButtonText: '⚡ Yes, Add The Travel Mini ($24)',
          declineButtonText: 'No thanks, continue to my order confirmation',
          views: 178,
          takes: 38,
          conversionRate: 21.3,
          attributedRevenue: 912.00
        }
      },
      {
        id: 'bp4-ty',
        type: 'thank-you',
        position: { x: 1100, y: 200 },
        data: {
          type: 'thank-you',
          label: 'VIP Order Confirmation',
          slug: 'oto-radiance-offer',
          headline: 'Your VIP Order & Allocation is Confirmed',
          subhead: 'Thank you for choosing our bioactive formulation ritual. Your parcel is in preparation.',
          badgeText: 'VIP Member Privilege',
          bounceBackDiscountCode: 'VIPRETURN',
          bounceBackDiscountText: '$15 Off Your Next Renewal Formulation',
          usageGuideTitle: 'The 3-Step Radiance Ritual',
          usageGuideSteps: [
            'Cleanse with warm water to prime cellular absorption.',
            'Warm 3-4 drops between palms and press gently into face & neck.',
            'Follow with barrier formulation to lock in bio-actives for 48 hours.'
          ],
          storeReturnText: 'Browse Complimentary Formulations',
          communityInviteText: 'Join The Private VIP Beauty Circle',
          pageViews: 240,
          bounceBackClaims: 44
        }
      }
    ],
    edges: [
      { id: 'e-bp4-1', source: 'bp4-ad', target: 'bp4-page', data: { sourceThroughput: 1100, targetCount: 1100, rate: 100 } },
      { id: 'e-bp4-2', source: 'bp4-page', target: 'bp4-upsell', data: { sourceThroughput: 1100, targetCount: 240, rate: 21.8 } },
      { id: 'e-bp4-3', source: 'bp4-upsell', target: 'bp4-ty', sourceHandle: 'accepted', data: { sourceThroughput: 240, targetCount: 62, rate: 25.8 } },
      { id: 'e-bp4-4', source: 'bp4-upsell', target: 'bp4-downsell', sourceHandle: 'declined', data: { sourceThroughput: 240, targetCount: 178, rate: 74.2 } },
      { id: 'e-bp4-5', source: 'bp4-downsell', target: 'bp4-ty', data: { sourceThroughput: 178, targetCount: 178, rate: 100 } }
    ]
  }
];

