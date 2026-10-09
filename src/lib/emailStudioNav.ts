/**
 * Email Studio's navigation (EMAIL_STUDIO_PLAN.md D1, Wave 3): five destinations, each with the
 * sections inside it, and LEGACY_TAB, which says where each of the twelve tab keys from before the
 * five opens. App passes 'map' when a funnel step opens the studio, so every old key must keep
 * landing somewhere real (editor-return-wiring.test.mjs pins that call).
 *
 * A section is one panel. Where a section is one of the old tabs it keeps that tab's key, so the
 * panels moved under the new strip without a change to their insides. Pure data and one pure
 * keyboard rule, no React, so the node tests import this file directly.
 */
import type { EmailStudioTab } from '../components/campaign/HubEmailSuite';

export type StudioDestinationKey = 'flows' | 'broadcasts' | 'audience' | 'results' | 'settings';

/** The old tab keys, plus the two sections that had no tab of their own. */
export type StudioSectionKey = EmailStudioTab | 'checkouts' | 'advanced';

export interface StudioSection {
  key: StudioSectionKey;
  label: string;
  /** A short word drawn beside the label, read as part of the tab's name. */
  badge?: string;
}

export interface StudioDestination {
  key: StudioDestinationKey;
  label: string;
  /** The first section is where the destination opens. One section means no second strip. */
  sections: readonly StudioSection[];
}

/** D1, in order. Flows comes first because the studio opens there. */
export const STUDIO_DESTINATIONS: readonly StudioDestination[] = [
  {
    key: 'flows',
    label: 'Flows',
    // Wave 4: the order emails are a group in the All flows list, opened in the same editor, so the
    // section they had of their own is gone.
    sections: [
      { key: 'flows', label: 'All flows' },
      { key: 'map', label: 'Flow map' }
    ]
  },
  {
    key: 'broadcasts',
    label: 'Broadcasts',
    // Wave 5: the Builder tab is retired. Its key opens the composer, New broadcast: the builder plus
    // who gets it, when, A/B and holdout (BroadcastComposer.tsx). D2: the builder is never a tab.
    sections: [
      { key: 'campaigns', label: 'All broadcasts' },
      { key: 'builder', label: 'New broadcast' }
    ]
  },
  {
    key: 'audience',
    label: 'Audience',
    sections: [
      { key: 'audience', label: 'People' },
      { key: 'forms', label: 'Sign-up forms' },
      { key: 'inbox', label: 'Replies' },
      { key: 'checkouts', label: 'Open checkouts' }
    ]
  },
  {
    key: 'results',
    label: 'Results',
    sections: [{ key: 'analytics', label: 'Results' }]
  },
  {
    key: 'settings',
    label: 'Settings',
    sections: [
      { key: 'sending', label: 'Sending' },
      { key: 'klaviyo', label: 'Klaviyo' },
      { key: 'sms', label: 'Texts', badge: 'Soon' },
      { key: 'advanced', label: 'Advanced' }
    ]
  }
];

export interface StudioPlace {
  destination: StudioDestinationKey;
  section: StudioSectionKey;
}

/**
 * Where each tab key from before Wave 3 opens. 'map' is the Flow map, the flow editor. 'transactional'
 * (the order letters) opens All flows, where the order emails are listed since Wave 4. 'builder' (the
 * retired Builder tab) opens Broadcasts, New broadcast, since Wave 5.
 */
export const LEGACY_TAB: Readonly<Record<EmailStudioTab, StudioPlace>> = {
  flows: { destination: 'flows', section: 'flows' },
  map: { destination: 'flows', section: 'map' },
  transactional: { destination: 'flows', section: 'flows' },
  campaigns: { destination: 'broadcasts', section: 'campaigns' },
  builder: { destination: 'broadcasts', section: 'builder' },
  audience: { destination: 'audience', section: 'audience' },
  forms: { destination: 'audience', section: 'forms' },
  inbox: { destination: 'audience', section: 'inbox' },
  analytics: { destination: 'results', section: 'analytics' },
  sending: { destination: 'settings', section: 'sending' },
  klaviyo: { destination: 'settings', section: 'klaviyo' },
  sms: { destination: 'settings', section: 'sms' }
};

/** Where the studio opens with no key, or with a key it does not know. */
export const STUDIO_HOME: StudioPlace = { destination: 'flows', section: 'flows' };

/** The place an old tab key opens. Anything else opens the studio's home. */
export function placeFor(tab: string | undefined | null): StudioPlace {
  if (tab && Object.prototype.hasOwnProperty.call(LEGACY_TAB, tab)) return LEGACY_TAB[tab as EmailStudioTab];
  return STUDIO_HOME;
}

/** The destination that holds a section. */
export function destinationOf(section: StudioSectionKey): StudioDestination {
  return STUDIO_DESTINATIONS.find((dest) => dest.sections.some((s) => s.key === section)) || STUDIO_DESTINATIONS[0];
}

/** The section a destination opens on. */
export function firstSectionOf(destination: StudioDestinationKey): StudioSectionKey {
  const dest = STUDIO_DESTINATIONS.find((d) => d.key === destination) || STUDIO_DESTINATIONS[0];
  return dest.sections[0].key;
}

/**
 * The WAI-ARIA tabs pattern's keys, with automatic activation: the tab an arrow, Home or End moves
 * to (the caller selects it and focuses it), or null for any other key. The arrows wrap.
 */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count < 1) return null;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
