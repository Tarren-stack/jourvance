import type { JourneyNode, JourneyEdge } from '../../types/journey';
import { edgeFigure, type CanvasMetrics, type NodeMeasure } from '../../lib/journeyMetrics.ts';
import { edgeStatus } from '../../lib/conversionBenchmarks.ts';

// Fictional homepage content only. Never import this into the editor, store or stats client.
export function createHomeCanvasExample() {
  const visits = 1200;
  const orders = 120;
  const upsellTakes = 36;
  const upsellDeclines = orders - upsellTakes;
  const downsellTakes = 21;
  const downsellDeclines = upsellDeclines - downsellTakes;
  const mainPrice = 49;
  const upsellPrice = 24;
  const downsellPrice = 12;
  const spend = 1200;
  const mainRevenue = orders * mainPrice;
  const upsellRevenue = upsellTakes * upsellPrice;
  const downsellRevenue = downsellTakes * downsellPrice;
  const revenue = mainRevenue + upsellRevenue + downsellRevenue;
  const sent = orders * 3;
  const opened = 180;
  const clicked = 54;
  const price = (amount: number) => `$${amount.toFixed(2)}`;

  const nodes: JourneyNode[] = [
    {
      id: 'demo-ad', type: 'ad-source', position: { x: 0, y: 0 },
      data: {
        type: 'ad-source', label: 'Everyday Carry Campaign', platform: 'meta',
        headline: 'Less clutter. More room for your day.',
        body: `Keep your daily essentials together with the Everyday Carry Kit. Yours for $${mainPrice}.`,
        ctaText: 'Shop the kit', utmCampaign: 'demo-everyday-carry',
        spend, impressions: 24000, clicks: visits, ctr: 5
      }
    },
    {
      id: 'demo-offer', type: 'landing-page', position: { x: 430, y: 0 },
      data: {
        type: 'landing-page', label: 'Everyday Carry Kit', slug: 'carry-kit',
        headline: `Everyday Carry Kit for $${mainPrice}`,
        subhead: 'A compact organizer for your phone, keys and daily essentials.',
        bullets: ['One place for small essentials', 'Fits inside your everyday bag', 'Ready for work or weekends'],
        trustBadge: '', buttonText: `Buy the kit for $${mainPrice}`, checkoutMode: 'direct',
        visitors: visits, conversions: orders, conversionRate: orders / visits * 100
      }
    },
    {
      id: 'demo-upsell', type: 'upsell', position: { x: 860, y: 0 },
      data: {
        type: 'upsell', label: 'Travel Organizer Upgrade', slug: 'travel-bundle', offerType: 'upsell',
        headline: `Add the Travel Organizer Bundle for $${upsellPrice}`,
        subhead: 'Give your kit a travel companion with space for chargers and accessories.',
        productTitle: 'Travel Organizer Bundle', productPrice: price(upsellPrice),
        benefits: ['Room for travel accessories', 'Add it to the same order'],
        acceptButtonText: `Yes, add the bundle for $${upsellPrice}`,
        declineButtonText: 'No thanks, show me the smaller option', downsellSlug: 'cable-pouch'
      }
    },
    {
      id: 'demo-downsell', type: 'upsell', position: { x: 860, y: 450 },
      data: {
        type: 'upsell', label: 'Compact Cable Pouch', slug: 'cable-pouch', offerType: 'downsell',
        headline: `Prefer something smaller? Add a Cable Pouch for $${downsellPrice}`,
        subhead: 'A smaller add-on for keeping your charging cables together.',
        productTitle: 'Compact Cable Pouch', productPrice: price(downsellPrice),
        benefits: ['A lighter, lower-priced option', 'Keeps loose cables together'],
        acceptButtonText: `Yes, add the pouch for $${downsellPrice}`,
        declineButtonText: 'No thanks, finish my order'
      }
    },
    {
      id: 'demo-confirmation', type: 'thank-you', position: { x: 1290, y: 0 },
      data: {
        type: 'thank-you', label: 'Order Confirmation', slug: 'order-confirmed',
        headline: 'Your everyday essentials are on their way',
        subhead: 'Your order is confirmed. Look out for your receipt and kit tips by email.',
        badgeText: 'Order confirmed', usageGuideTitle: 'Get to know your kit',
        usageGuideSteps: ['Check your order email', 'Choose your daily essentials', 'Pack your kit for tomorrow']
      }
    },
    {
      id: 'demo-followup', type: 'follow-up-sequence', position: { x: 430, y: 450 },
      data: {
        type: 'follow-up-sequence', label: 'Customer Follow-Up', sequenceTitle: 'Your kit, three helpful emails',
        klaviyoWhen: 'order_paid', contactsEnrolled: orders,
        avgOpenRate: opened / sent * 100, avgClickRate: clicked / sent * 100,
        steps: [
          { id: 'demo-email-1', channel: 'email', delay: 'Instant (0m)', subject: 'Thanks for your order', previewText: 'Your kit is one step closer.', body: 'Thanks for choosing the Everyday Carry Kit. Your order receipt has the details of your kit and any extras you added.' },
          { id: 'demo-email-2', channel: 'email', delay: '24 Hours', subject: 'Make room for your everyday essentials', previewText: 'Three ways to organize your kit.', body: 'Start with what you carry every day. Give your keys, phone and small accessories their own place, then leave a little room for tomorrow.' },
          { id: 'demo-email-3', channel: 'email', delay: '7 Days', subject: 'How is your kit fitting in?', previewText: 'Tell us how you use your kit.', body: 'We would love to hear how you use your Everyday Carry Kit. Reply with a question or a tip from your first week.' }
        ]
      }
    }
  ];
  const edges: JourneyEdge[] = [
    { id: 'demo-ad-offer', source: 'demo-ad', target: 'demo-offer' },
    { id: 'demo-purchase', source: 'demo-offer', target: 'demo-upsell' },
    { id: 'demo-upsell-yes', source: 'demo-upsell', sourceHandle: 'accepted', target: 'demo-confirmation' },
    { id: 'demo-upsell-no', source: 'demo-upsell', sourceHandle: 'declined', target: 'demo-downsell' },
    { id: 'demo-downsell-yes', source: 'demo-downsell', sourceHandle: 'accepted', target: 'demo-confirmation' },
    { id: 'demo-downsell-no', source: 'demo-downsell', sourceHandle: 'declined', target: 'demo-confirmation' },
    // A parallel follow-up line is the editor's existing post-purchase flow pattern.
    { id: 'demo-purchase-followup', source: 'demo-offer', target: 'demo-followup', targetHandle: 'retention-in' }
  ].map(edge => ({ ...edge, type: 'conversion' }));
  const measures: Record<string, NodeMeasure> = {
    'demo-ad': { clicks: visits, attributedRevenue: revenue, roas: revenue / spend },
    'demo-offer': { visitors: visits, conversions: orders, conversionRate: orders / visits * 100, grossRevenue: mainRevenue },
    'demo-upsell': { views: orders, takes: upsellTakes, totalDeclines: upsellDeclines, conversionRate: upsellTakes / orders * 100, attributedRevenue: upsellRevenue },
    'demo-downsell': { views: upsellDeclines, takes: downsellTakes, totalDeclines: downsellDeclines, conversionRate: downsellTakes / upsellDeclines * 100, attributedRevenue: downsellRevenue },
    'demo-confirmation': { pageViews: upsellTakes + downsellTakes + downsellDeclines, bounceBackClaims: 0 },
    'demo-followup': { flowEnrolled: orders, flowSent: sent, flowOpened: opened, flowClicked: clicked, flowRevenue: 0 }
  };

  // Reuse the editor's rate calculations without fabricating a live API snapshot.
  const metrics: CanvasMetrics = {
    view: null,
    nodes: Object.fromEntries(nodes.map(node => [node.id, {
      measure: measures[node.id], note: 'Demo data. Illustrative results.'
    }])),
    edges: Object.fromEntries(edges.map(edge => {
      const source = nodes.find(node => node.id === edge.source)!;
      const target = nodes.find(node => node.id === edge.target)!;
      const figure = edgeFigure({
        sourceType: source.type, targetType: target.type, sourceHandle: edge.sourceHandle,
        targetData: target.data, source: measures[source.id], target: measures[target.id]
      });
      const demo = { ...figure, basis: 'Demo' as const };
      return [edge.id, { ...demo, status: edgeStatus(demo.def, demo) }];
    }))
  };
  return { nodes, edges, metrics };
}
