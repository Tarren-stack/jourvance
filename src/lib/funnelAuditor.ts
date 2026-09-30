// Store checks: a score for a journey that sells through a connected store (#10).
// The design checks in designChecks.ts run on every journey. This score asks store questions
// (checkout, order bump, upsell, follow-ups), so it is computed and shown only when the
// workspace has a connected store: storeScoreFor answers null otherwise.
// It used to invent what it could not know: a monthly "margin at risk", conversion lifts in
// percent, and fixes that wrote product names, prices, an image and a promise onto the
// person's page. Those are gone. A fix here is a FixPlan like a design fix: it turns a setting
// on, adds a step with placeholder words only, or adds recovery emails as "Replace this" drafts.
// Value imports carry .ts so `node --test` loads this file directly.

import type { JourneyProject, JourneyNode, JourneyEdge, Workspace, PageNodeData, UpsellNodeData } from '../types/journey';
import type { FixChange, FixPlan } from './designChecks';
import {
  extractPricingFromNodes, injectRetentionFlows, parseNumericPrice, DEFAULT_FORECAST, retentionFlowsThatFit, sellsThroughCheckout
} from './funnelForecaster.ts';
import { buildPlan, describeChange, fixLine, isPlaceholderText } from './designChecks.ts';
import { lineIsDrawable, nodeLookup, stepName } from './journeyGraph.ts';

export interface AuditCheckItem {
  id: string;
  pillarId: 'acquisition' | 'aov' | 'retention' | 'trust';
  title: string;
  points: number;
  maxPoints: number;
  passed: boolean;
  severity: 'critical' | 'recommended' | 'optional';
  summary: string;
  autoFixType?: 'enable_mobile_sticky' | 'add_upsell_node' | 'sync_cart_recovery' | 'sync_upsell_rescue';
  targetNodeId?: string;
}

export interface AuditPillar {
  id: 'acquisition' | 'aov' | 'retention' | 'trust';
  title: string;
  description: string;
  score: number;
  maxScore: number;
  items: AuditCheckItem[];
}

export interface FunnelAuditReport {
  overallScore: number; // 0 to 100
  grade: 'A+' | 'A' | 'B' | 'C' | 'D';
  tier: 'ready' | 'good' | 'leaking';
  headline: string;
  subhead: string;
  pillars: AuditPillar[];
  totalChecks: number;
  passedChecks: number;
  fixableChecks: number;
}

/** True when the workspace has a connected store. Store checks need one. */
export function isStoreConnected(workspace: Pick<Workspace, 'shopifyConfig'> | null | undefined): boolean {
  return workspace?.shopifyConfig?.status === 'connected';
}

/** The store score, or null when no store is connected (the score would only measure what is absent). */
export function storeScoreFor(project: JourneyProject, workspace: Workspace | null | undefined): FunnelAuditReport | null {
  return isStoreConnected(workspace) ? auditFunnel(project, workspace) : null;
}

/**
 * Where the upsell fix would go: the page and its own routing line (its main exit, into a step
 * that is not a follow-up), or null when the fix does not fit. It does not fit when the page has
 * no checkout, or when the page leads to a lead form, because an upsell there sits before sign-up
 * and not after purchase.
 */
function upsellSlot(nodes: JourneyNode[], edges: JourneyEdge[]): { page: JourneyNode; next: JourneyEdge | undefined } | null {
  const page = nodes.find(n => n.type === 'landing-page');
  if (!page || nodes.some(n => n.type === 'upsell') || !sellsThroughCheckout(page)) return null;
  const byId = nodeLookup(nodes);
  const onward = edges.filter(e =>
    e.source === page.id && !e.sourceHandle && lineIsDrawable(e, byId) &&
    byId.get(e.target)?.type !== 'follow-up-sequence'
  );
  if (onward.length > 1) return null;
  if (onward[0] && byId.get(onward[0].target)?.type === 'lead-form') return null;
  return { page, next: onward[0] };
}

/**
 * Scores a journey that sells through a store on four groups of checks, out of 100.
 * Deterministic and pure. Call it through storeScoreFor so it runs only with a connected store.
 */
export function auditFunnel(project: JourneyProject, workspace?: Workspace | null): FunnelAuditReport {
  const nodes = project.nodes || [];
  const edges = project.edges || [];
  const pricing = extractPricingFromNodes(nodes);

  const landingPageNode = nodes.find(n => n.type === 'landing-page');
  const lpData = (landingPageNode?.data as PageNodeData) || undefined;

  const upsellNodes = nodes.filter(n => n.type === 'upsell');
  const primaryUpsell = upsellNodes.find(n => (n.data as UpsellNodeData)?.offerType !== 'downsell') || upsellNodes[0];

  // -------------------------------------------------------------
  // Landing page and checkout (30 pts)
  // -------------------------------------------------------------
  const ownHeadline = (text: unknown) =>
    typeof text === 'string' && text.trim().length > 3 && !isPlaceholderText(text);
  const isHeadlineDefined = ownHeadline(project.offerHeadline) || ownHeadline(lpData?.headline);

  const isProductLinked = sellsThroughCheckout(landingPageNode);
  // The forecaster falls back to 58.00 when there is no price, which is not a configured price.
  const configuredPrice = lpData?.shopifyProductPrice && parseNumericPrice(lpData.shopifyProductPrice, 0) > 0
    ? lpData.shopifyProductPrice.trim()
    : '';

  const isMobileStickyEnabled = Boolean(lpData?.mobileStickyBarEnabled);

  const acquisitionItems: AuditCheckItem[] = [
    {
      id: 'headline_defined',
      pillarId: 'acquisition',
      title: 'Landing page headline',
      points: isHeadlineDefined ? 10 : 0,
      maxPoints: 10,
      passed: isHeadlineDefined,
      severity: 'critical',
      summary: isHeadlineDefined
        ? 'The landing page has a headline of its own.'
        : 'The landing page headline is missing or still the placeholder.',
      targetNodeId: landingPageNode?.id
    },
    {
      id: 'product_pricing_linked',
      pillarId: 'acquisition',
      title: 'Product linked to checkout',
      points: isProductLinked ? 10 : 0,
      maxPoints: 10,
      passed: isProductLinked,
      severity: 'critical',
      summary: isProductLinked
        ? configuredPrice ? `A product is linked (${configuredPrice}).` : 'A product is linked.'
        : 'No product or checkout link is set on the landing page.',
      targetNodeId: landingPageNode?.id
    },
    {
      id: 'mobile_sticky_bar',
      pillarId: 'acquisition',
      title: 'Mobile sticky checkout bar',
      points: isMobileStickyEnabled ? 10 : 0,
      maxPoints: 10,
      passed: isMobileStickyEnabled,
      severity: 'recommended',
      summary: isMobileStickyEnabled
        ? 'The checkout bar stays on screen on phones.'
        : 'The mobile sticky checkout bar is off.',
      autoFixType: landingPageNode && !isMobileStickyEnabled ? 'enable_mobile_sticky' : undefined,
      targetNodeId: landingPageNode?.id
    }
  ];

  // -------------------------------------------------------------
  // Order value (30 pts)
  // -------------------------------------------------------------
  const isBumpActive = Boolean(lpData?.orderBumpEnabled && pricing.hasBump && pricing.bumpPrice > 0);
  const isUpsellActive = Boolean(pricing.hasUpsell && pricing.upsellPrice > 0);
  const bumpPrice = lpData?.orderBumpPrice ? lpData.orderBumpPrice.trim() : '';

  const aovItems: AuditCheckItem[] = [
    {
      id: 'order_bump_configured',
      pillarId: 'aov',
      title: 'Order bump at checkout',
      points: isBumpActive ? 15 : 0,
      maxPoints: 15,
      passed: isBumpActive,
      severity: 'recommended',
      summary: isBumpActive
        ? `An order bump is on (${[pricing.bumpTitle, bumpPrice].filter(Boolean).join(', ') || 'add-on'}).`
        : 'The landing page has no order bump with a price.',
      // The bump is the person's own offer, so this row only opens the step.
      targetNodeId: landingPageNode?.id
    },
    {
      id: 'post_purchase_upsell',
      pillarId: 'aov',
      title: 'Upsell after purchase',
      points: isUpsellActive ? 15 : 0,
      maxPoints: 15,
      passed: isUpsellActive,
      severity: 'recommended',
      summary: isUpsellActive
        ? `An upsell with a price is on the journey (${String(
            (primaryUpsell?.data as UpsellNodeData | undefined)?.productPrice || ''
          ).trim() || 'priced'}).`
        : primaryUpsell
          ? 'The upsell step has no price yet.'
          : 'The journey has no upsell step.',
      // Offered only when there is no upsell at all and the page sells through a checkout that
      // does not lead to a lead form. An unpriced upsell is the person's to finish.
      autoFixType: upsellSlot(nodes, edges) ? 'add_upsell_node' : undefined,
      targetNodeId: primaryUpsell?.id
    }
  ];

  // -------------------------------------------------------------
  // Follow-ups (25 pts)
  // -------------------------------------------------------------
  const isCartRecoveryActive = Boolean(pricing.hasCartRecovery);
  const isUpsellRescueActive = Boolean(pricing.hasUpsellRescue);
  // A recovery sequence is offered only where it can be linked, so a fix never adds a step that
  // nothing reaches: the first landing page's Left checkout exit, or the first upsell's Rescue exit.
  // Cart recovery also needs that page to sell through a checkout, or no one can leave one. The
  // Forecaster's Sync to Canvas asks the same retentionFlowsThatFit (R12).
  const retentionFit = retentionFlowsThatFit(nodes, edges);
  const recoveryPage = nodes.find(n => n.data?.type === 'landing-page');
  const rescueUpsell = nodes.find(n => n.data?.type === 'upsell');

  const retentionItems: AuditCheckItem[] = [
    {
      id: 'cart_recovery_flow',
      pillarId: 'retention',
      title: 'Cart recovery emails',
      points: isCartRecoveryActive ? 15 : 0,
      maxPoints: 15,
      passed: isCartRecoveryActive,
      severity: 'recommended',
      summary: isCartRecoveryActive
        ? 'A cart recovery sequence is on the journey.'
        : 'No cart recovery sequence follows visitors who leave checkout.',
      autoFixType: retentionFit.cartRecovery ? 'sync_cart_recovery' : undefined,
      targetNodeId: recoveryPage?.id
    },
    {
      id: 'upsell_rescue_flow',
      pillarId: 'retention',
      title: 'Upsell decline follow-up',
      points: isUpsellRescueActive ? 10 : 0,
      maxPoints: 10,
      passed: isUpsellRescueActive,
      severity: 'optional',
      summary: isUpsellRescueActive
        ? 'A follow-up sequence reaches people who decline the upsell.'
        : 'No follow-up sequence reaches people who decline the upsell.',
      autoFixType: retentionFit.upsellRescue ? 'sync_upsell_rescue' : undefined,
      targetNodeId: rescueUpsell?.id ?? primaryUpsell?.id
    }
  ];

  // -------------------------------------------------------------
  // Trust and publishing (15 pts)
  // -------------------------------------------------------------
  const isTrustBadgePresent = Boolean(lpData?.trustBadge && lpData.trustBadge.trim().length > 3);

  // A connected store is the precondition for this whole score, so it cannot earn a row here:
  // counting it made this row pass on every score anyone could see (#10). A verified custom
  // domain cannot either: that is a DNS check that passes before any publish and stays set after
  // Unpublish, so only the publish flag says the page is live.
  const isLandingPagePublished = lpData?.published === true;

  const trustItems: AuditCheckItem[] = [
    {
      id: 'trust_badge_guarantee',
      pillarId: 'trust',
      title: 'Trust line on the landing page',
      points: isTrustBadgePresent ? 5 : 0,
      maxPoints: 5,
      passed: isTrustBadgePresent,
      severity: 'optional',
      summary: isTrustBadgePresent
        ? 'The landing page shows a trust line.'
        : 'The landing page shows no trust line, such as your return policy.',
      // Only the person can say what they promise, so this row only opens the step.
      targetNodeId: landingPageNode?.id
    },
    {
      id: 'domain_and_publishing',
      pillarId: 'trust',
      title: 'Landing page published',
      points: isLandingPagePublished ? 10 : 0,
      maxPoints: 10,
      passed: isLandingPagePublished,
      severity: 'critical',
      summary: isLandingPagePublished
        ? 'The landing page is published.'
        : 'The landing page is not published yet.',
      // Publishing has its own button; this row opens the page so it can be checked first.
      targetNodeId: landingPageNode?.id
    }
  ];

  // -------------------------------------------------------------
  // Pillar Construction & Aggregation
  // -------------------------------------------------------------
  const pillar = (id: AuditPillar['id'], title: string, description: string, items: AuditCheckItem[]): AuditPillar => ({
    id,
    title,
    description,
    score: items.reduce((sum, item) => sum + item.points, 0),
    maxScore: items.reduce((sum, item) => sum + item.maxPoints, 0),
    items
  });
  const pillars: AuditPillar[] = [
    pillar('acquisition', 'Landing page and checkout', 'The headline, the linked product and the phone checkout bar.', acquisitionItems),
    pillar('aov', 'Order value', 'An order bump and an upsell after purchase.', aovItems),
    pillar('retention', 'Follow-ups', 'Emails for people who leave checkout or decline the upsell.', retentionItems),
    pillar('trust', 'Trust and publishing', 'A trust line and a published landing page.', trustItems)
  ];

  const overallScore = Math.min(100, Math.max(0, pillars.reduce((sum, p) => sum + p.score, 0)));
  const allItems = [...acquisitionItems, ...aovItems, ...retentionItems, ...trustItems];
  const passedChecks = allItems.filter(item => item.passed).length;
  const fixableChecks = allItems.filter(item => !item.passed && item.autoFixType).length;

  let grade: FunnelAuditReport['grade'] = 'D';
  let tier: FunnelAuditReport['tier'] = 'leaking';
  let headline = 'Many store checks are open';
  let subhead = 'Review the rows below before you send traffic.';

  if (overallScore >= 95) {
    grade = 'A+';
    tier = 'ready';
    headline = 'Every store check passed';
    subhead = 'Checkout, order value, follow-ups and trust items are all in place.';
  } else if (overallScore >= 90) {
    grade = 'A';
    tier = 'ready';
    headline = 'Nearly every store check passed';
    subhead = 'One small item is open. See the rows below.';
  } else if (overallScore >= 75) {
    grade = 'B';
    tier = 'good';
    headline = 'Most store checks passed';
    subhead = 'A few items are open. See the rows below.';
  } else if (overallScore >= 60) {
    grade = 'C';
    tier = 'good';
    headline = 'Several store checks are open';
    subhead = 'Some checkout and follow-up items are missing. See the rows below.';
  }

  return {
    overallScore,
    grade,
    tier,
    headline,
    subhead,
    pillars,
    totalChecks: allItems.length,
    passedChecks,
    fixableChecks
  };
}

/** A free spot to the right of a step, below anything already there. */
function slotRightOf(nodes: JourneyNode[], anchor: JourneyNode): { x: number; y: number } {
  const x = anchor.position.x + 360;
  let y = anchor.position.y;
  while (nodes.some(n => Math.abs(n.position.x - x) < 120 && Math.abs(n.position.y - y) < 100)) y += 140;
  return { x, y };
}

function freshId(nodes: JourneyNode[], prefix: string): string {
  const base = `${prefix}-${Date.now().toString(36)}`;
  let id = base;
  for (let i = 2; nodes.some(n => n.id === id); i++) id = `${base}-${i}`;
  return id;
}

/**
 * The plan for a store row's fix, or null when the row has none or it would not apply now.
 * Preview it, apply it and undo it with applyFixPlan and revertFixPlan (designChecks.ts).
 */
export function planAuditFix(project: JourneyProject, item: Pick<AuditCheckItem, 'id' | 'autoFixType' | 'targetNodeId'>): FixPlan | null {
  const nodes = project.nodes || [];
  const edges = project.edges || [];
  const key = `store:${item.id}`;

  switch (item.autoFixType) {
    case 'enable_mobile_sticky': {
      const page = nodes.find(n => (item.targetNodeId ? n.id === item.targetNodeId : n.type === 'landing-page'));
      if (!page || page.type !== 'landing-page') return null;
      const before = (page.data as PageNodeData).mobileStickyBarEnabled;
      if (before === true) return null;
      return buildPlan(project, key, 'Turn on the mobile checkout bar', [
        { kind: 'set-node-field', nodeId: page.id, field: 'mobileStickyBarEnabled', before, after: true }
      ], [`Turns on the mobile sticky checkout bar on ${stepName(page)}.`]);
    }

    case 'add_upsell_node': {
      const slot = upsellSlot(nodes, edges);
      if (!slot) return null;
      const { page: landingPageNode, next } = slot;
      const upsell: JourneyNode = {
        id: freshId(nodes, 'node-upsell'),
        type: 'upsell',
        position: slotRightOf(nodes, landingPageNode),
        data: {
          type: 'upsell',
          label: 'Upsell',
          offerType: 'upsell',
          headline: 'Your upsell headline',
          subhead: '',
          productTitle: '',
          productPrice: '',
          benefits: [],
          acceptButtonText: 'Yes, add it to my order',
          declineButtonText: 'No thanks'
        } as UpsellNodeData
      };
      const all = nodeLookup([...nodes, upsell]);
      const line = (l: { source: string; target: string; sourceHandle?: string }) =>
        fixLine(all.get(l.source)!, l.sourceHandle ?? null, all.get(l.target)!, null);
      // A page's main handle has no id, so the new line names none (naming 'accepted' hid it).
      const pageToUpsell = { source: landingPageNode.id, target: upsell.id };
      const changes: FixChange[] = [{ kind: 'add-node', node: upsell }];
      if (next) {
        // In between: the page now leads to the upsell, and both answers go where the page went.
        changes.push({ kind: 'remove-edge', edge: next, index: edges.indexOf(next) });
        changes.push({ kind: 'add-edge', edge: line(pageToUpsell) });
        changes.push({ kind: 'add-edge', edge: line({ source: upsell.id, sourceHandle: 'accepted', target: next.target }) });
        changes.push({ kind: 'add-edge', edge: line({ source: upsell.id, sourceHandle: 'declined', target: next.target }) });
      } else {
        changes.push({ kind: 'add-edge', edge: line(pageToUpsell) });
      }
      return buildPlan(project, key, 'Add an upsell step', changes, [
        'Adds an upsell step with a placeholder headline and no product or price.',
        ...changes.filter(c => c.kind !== 'add-node').map(c => describeChange(c, [...nodes, upsell], edges))
      ]);
    }

    case 'sync_cart_recovery':
    case 'sync_upsell_rescue': {
      const cart = item.autoFixType === 'sync_cart_recovery';
      const fit = retentionFlowsThatFit(nodes, edges);
      if (!(cart ? fit.cartRecovery : fit.upsellRescue)) return null;
      const result = injectRetentionFlows({
        nodes,
        edges,
        addCartRecovery: cart,
        addUpsellRescue: !cart,
        placeholderCopy: true
      });
      // Never add a sequence that nothing leads to.
      if (result.addedNodes.length !== 1 || result.addedEdges.length === 0) return null;
      const before = project.forecast;
      const after = { ...(before || DEFAULT_FORECAST), [cart ? 'cartRecoveryEnabled' : 'upsellRescueEnabled']: true };
      const changes: FixChange[] = [
        ...result.addedNodes.map(node => ({ kind: 'add-node' as const, node })),
        ...result.addedEdges.map(edge => ({ kind: 'add-edge' as const, edge })),
        { kind: 'set-forecast', before, after }
      ];
      const count = (result.addedNodes[0].data as { steps?: unknown[] }).steps?.length ?? 0;
      return buildPlan(project, key, cart ? 'Add cart recovery emails' : 'Add upsell decline emails', changes, [
        `Adds ${cart ? 'a cart recovery' : 'an upsell decline'} sequence with ${count} draft ${count === 1 ? 'email that says' : 'emails that say'} "Replace this" and no discount code.`,
        ...result.addedEdges.map(edge => describeChange({ kind: 'add-edge', edge }, result.nodes, edges)),
        `Turns on ${cart ? 'cart recovery' : 'upsell rescue'} in the forecast.`
      ]);
    }

    default:
      return null;
  }
}
