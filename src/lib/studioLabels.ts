// The words a person sees for the studio's places and actions. The rail, the toolbar, the map
// and the page headings all read from here, so one action never grows a second name.
import type { AttributionModelType, NodeType } from '../types/journey';

export const VIEW_LABEL = {
  canvas: 'Funnel Canvas',
  'email-studio': 'Email Studio',
  attribution: 'Attribution'
} as const;

export const ACTION_LABEL = {
  checkDesign: 'Check design',
  launchPlaybook: 'Launch playbook',
  adReturn: 'Ad return',
  showAdReturn: 'Show ad return',
  addStep: 'Add Step',
  testFunnel: 'Test funnel',
  publicWebsite: 'Public website',
  saveBlueprint: 'Save as blueprint'
} as const;

/** Said under the map tools while Show ad return is on. */
export const AD_RETURN_NOTE = 'These figures are estimates from the spend and orders on this funnel.';

export const ROAS_STAT_NAME = 'Return on ad spend (ROAS)';
export const AOV_PHRASE = 'average order value';

export interface StepTypeChoice {
  type: NodeType;
  label: string;
  description: string;
  dotColor: string;
}

export const STEP_TYPES: readonly StepTypeChoice[] = [
  { type: 'ad-source', label: 'Ad source', description: 'Paid or organic traffic', dotColor: '#3B82F6' },
  { type: 'landing-page', label: 'Landing page', description: 'The page visitors land on', dotColor: '#6366F1' },
  { type: 'ab-split', label: 'A/B split', description: 'Send some visitors to each version', dotColor: '#8B5CF6' },
  { type: 'lead-form', label: 'Lead form', description: 'Ask for a name and email', dotColor: '#10B981' },
  { type: 'follow-up-sequence', label: 'Follow-up', description: 'Emails that send on their own', dotColor: '#F59E0B' },
  { type: 'thank-you', label: 'Thank-you page', description: 'Order confirmation', dotColor: '#EC4899' },
  { type: 'upsell', label: 'Upsell', description: 'Offer another product after purchase', dotColor: '#10B981' }
];

/** The Check design button's accessible name, without a store score. */
export function checkDesignName(designCount: number): string {
  return designCount > 0
    ? `Check design, ${designCount} open ${designCount === 1 ? 'check' : 'checks'}`
    : 'Check design, all checks passed';
}

/** One sentence for the attribution model that is selected right now. */
export function attributionModelHelp(model: AttributionModelType): string {
  if (model === 'last_touch') return 'Last-touch gives the sale to the last click before the order.';
  if (model === 'first_touch') return 'First-touch gives the sale to the first click.';
  return 'Linear splits the sale evenly across every click.';
}
