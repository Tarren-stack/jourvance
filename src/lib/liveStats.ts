import type { JourneyEdge, JourneyNode, JourneyNodeData, JourneyProject } from '../types/journey';

/** Fields that are measurements. Copy, prices, and ad spend the operator typed stay put. */
const MEASURED_KEYS = [
  'impressions', 'clicks', 'ctr', 'roas',
  'visitors', 'conversions', 'conversionRate',
  'grossRevenue', 'orderBumpRevenue', 'orderBumpTakes', 'bumpTakeRate', 'aov',
  'liveRevenue', 'liveOrders', 'liveBumpOrders',
  'variantAVisitors', 'variantAConversions', 'variantAGrossRevenue',
  'variantBVisitors', 'variantBConversions', 'variantBGrossRevenue',
  'views', 'submissions', 'completionRate',
  'contactsEnrolled', 'avgOpenRate', 'avgClickRate',
  'pageViews', 'bounceBackClaims',
  'takes', 'attributedRevenue'
] as const;

const TEMPLATE_NODE = /^(node-(ad|page|form|seq)-1|bp[1-4]-)/;

const INVENTED_PROOF = /4\.9\/5|verified (beauty lovers|customers|buyers|clients)|\d[\d,]*\+\s*(verified |members|clients|buyers|beauty)|100% satisfaction|zero risk, zero obligation|guaranteed quality|5-star results|money-back|clinically proven/i;
const SEEDED_PROMISE = /VIP Consultation|yourbusiness\.com\/calendar|spot is (still )?reserved|Dedicated Specialist|senior specialist|Lock In My Offer|invitation details|saved your cart|cart is saved/i;

function scrubSeedText(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value : '';
  if (!text) return text;
  return INVENTED_PROOF.test(text) || SEEDED_PROMISE.test(text) ? fallback : text;
}

function zeroMeasured(data: JourneyNodeData): JourneyNodeData {
  const next = { ...data } as JourneyNodeData & Record<string, unknown>;
  for (const key of MEASURED_KEYS) {
    if (key in next) next[key] = 0;
  }
  if (typeof next.trustBadge === 'string') next.trustBadge = scrubSeedText(next.trustBadge, '');
  if (typeof next.headline === 'string') next.headline = scrubSeedText(next.headline, 'Your offer headline');
  if (typeof next.subhead === 'string') next.subhead = scrubSeedText(next.subhead, 'Describe what the visitor gets.');
  if (typeof next.body === 'string') next.body = scrubSeedText(next.body, 'Describe the offer in words you can stand behind.');
  if (typeof next.buttonText === 'string') next.buttonText = scrubSeedText(next.buttonText, 'Continue');
  if (typeof next.formTitle === 'string') next.formTitle = scrubSeedText(next.formTitle, 'Where should we reach you?');
  if (typeof next.submitButtonText === 'string') next.submitButtonText = scrubSeedText(next.submitButtonText, 'Submit');
  if (typeof next.successMessage === 'string') next.successMessage = scrubSeedText(next.successMessage, 'Thanks. We have your details.');
  if (Array.isArray(next.bullets)) {
    next.bullets = next.bullets.map(item => scrubSeedText(item, '')).filter(Boolean);
  }
  if (Array.isArray(next.fields)) {
    next.fields = next.fields.map(field => {
      if (!field || typeof field !== 'object') return field;
      const row = { ...(field as Record<string, unknown>) };
      if (typeof row.label === 'string' && /SMS confirmation/i.test(row.label)) row.label = 'Phone number';
      return row;
    });
  }
  if (Array.isArray(next.steps)) {
    next.steps = next.steps.map(step => {
      if (!step || typeof step !== 'object') return step;
      const row = { ...(step as Record<string, unknown>) };
      if (typeof row.subject === 'string') row.subject = scrubSeedText(row.subject, 'You are on the list');
      if (typeof row.previewText === 'string') row.previewText = scrubSeedText(row.previewText, 'Replace this before anyone receives it');
      if (typeof row.body === 'string') row.body = scrubSeedText(row.body, 'Hi [First Name],\n\nReplace this note with the real next step before anyone receives it.');
      return row;
    });
  }
  return next;
}

/** Template nodes ship with made-up conversion counts. Drop those. Leave nodes the operator built. */
export function clearTemplateMetrics(project: JourneyProject): JourneyProject {
  const templateIds = new Set(project.nodes.filter(n => TEMPLATE_NODE.test(n.id)).map(n => n.id));
  if (templateIds.size === 0) return project;
  const offer = SEEDED_PROMISE.test(project.offerHeadline || '') ? 'Your offer' : project.offerHeadline;
  return {
    ...project,
    offerHeadline: offer,
    nodes: project.nodes.map(n => templateIds.has(n.id) ? { ...n, data: zeroMeasured(n.data) } : n),
    edges: project.edges.map(e => (
      templateIds.has(e.source) || templateIds.has(e.target)
        ? { ...e, data: { ...(e.data || {}), sourceThroughput: 0, targetCount: 0, rate: 0 } }
        : e
    ))
  };
}

/** A blueprint is a starting layout, not a history of results. */
export function zeroBlueprintMetrics(nodes: JourneyNode[], edges: JourneyEdge[]): { nodes: JourneyNode[]; edges: JourneyEdge[] } {
  return {
    nodes: nodes.map(n => ({ ...n, data: zeroMeasured(n.data) })),
    edges: edges.map(e => ({ ...e, data: { ...(e.data || {}), sourceThroughput: 0, targetCount: 0, rate: 0 } }))
  };
}

export interface LiveStatsPayload {
  nodes?: Record<string, Record<string, number | string | null>>;
  edges?: Record<string, { sourceThroughput: number; targetCount: number; rate: number }>;
}

/** Overlay server counts. Returns the same project when nothing changed, so save does not loop. */
export function applyLiveStats(project: JourneyProject, stats: LiveStatsPayload | null | undefined): JourneyProject {
  if (!stats) return project;
  let changed = false;
  const nodes = project.nodes.map(n => {
    const patch = stats.nodes?.[n.id];
    if (!patch) return n;
    const data = { ...n.data } as JourneyNodeData & Record<string, unknown>;
    let nodeChanged = false;
    for (const [key, value] of Object.entries(patch)) {
      if (data[key] !== value) {
        data[key] = value;
        nodeChanged = true;
      }
    }
    if (!nodeChanged) return n;
    changed = true;
    return { ...n, data };
  });
  const edges = project.edges.map(e => {
    const patch = stats.edges?.[e.id];
    if (!patch) return e;
    const prev = e.data || { sourceThroughput: 0, targetCount: 0, rate: 0 };
    if (prev.sourceThroughput === patch.sourceThroughput && prev.targetCount === patch.targetCount && prev.rate === patch.rate) {
      return e;
    }
    changed = true;
    return { ...e, data: { ...prev, ...patch } };
  });
  if (!changed) return project;
  return { ...project, nodes, edges, updatedAt: new Date().toISOString() };
}
