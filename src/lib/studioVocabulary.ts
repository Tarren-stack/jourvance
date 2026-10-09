/**
 * Email Studio's one word per concept (EMAIL_STUDIO_PLAN.md D2, Wave 6). The words the studio's copy
 * no longer says, and the phrases D2 keeps on purpose. One list for both gates: the source pin
 * (email-studio-vocabulary.test.mjs) and the browser check's no-dash step. Pure data and one pure
 * function, no imports, so node imports this file straight from the .ts.
 */

export interface RetiredWord {
  /** The retired word as D2 names it. */
  word: string;
  /** What D2 says instead. */
  say: string;
  re: RegExp;
}

export const RETIRED_WORDS: readonly RetiredWord[] = [
  // The verb names the concept too ("Automate Inactivity Winback" was a flow's switch). The adjective and
  // adverb ("Automatic STOP opt-out suffix", "unlocks automatically") describe behaviour, not a flow, and stay.
  { word: 'automation', say: 'flow, or built-in flow', re: /\bautomat(?:e|es|ed|ing|ion|ions)\b/i },
  // Covers "queue sequence" and "Sequence" too.
  { word: 'sequence', say: 'flow, or starter flow', re: /\bsequences?\b/i },
  { word: 'drip', say: 'flow', re: /\bdrips?\b/i },
  { word: 'series', say: 'flow', re: /\bseries\b/i },
  { word: 'program', say: 'flow', re: /\bprograms?\b/i },
  { word: 'campaign', say: 'broadcast', re: /\bcampaigns?\b/i },
  { word: 'letter', say: 'email, or order email', re: /\bletters?\b/i },
  { word: 'note', say: 'email', re: /\bnotes?\b/i },
  { word: 'trigger', say: 'starts when', re: /\btrigger(?:s|ed)?\b/i },
  { word: 'Run Queue Tick', say: 'Send due emails now', re: /\bqueue tick\b/i },
  // The same mechanism under its old name: "when the queue is run" names a thing the studio no longer
  // has. "Abandoned Checkouts Queue" (a list of checkouts) is not this and is not matched.
  { word: 'the queue', say: 'when it comes due, or Send due emails now', re: /\bthe queue\b/i },
  { word: 'Analytics', say: 'Results', re: /\banalytics\b/i },
  { word: 'DNS & Deliverability', say: 'Sending, or Results', re: /\bDNS\s*&\s*Deliverability\b|\bDeliverability\s*&\s*(?:DNS|Conversion)\b/i },
  { word: 'on the X tab', say: 'in <destination>, <section>', re: /\bon the [A-Za-z][\w &]* tab\b/i }
];

/**
 * Kept on purpose, so taken out of a string before it is judged:
 * - D2: the page title and the canvas node name (pinned by email-studio-fit.test.mjs and the
 *   SequenceEditor tests).
 * - 'UTM campaign': the name of the utm_campaign link parameter, a term of the link tag and not a
 *   word for a broadcast.
 * - The default subject of a new email ('A note from the store'): the words a customer reads in the
 *   email, not the studio's own vocabulary.
 */
export const KEPT_PHRASES: readonly string[] = [
  'Email Studio & E-Commerce Flows',
  'Follow-Up Sequence',
  'UTM campaign',
  'Another note from the store',
  'A note from the store'
];

/** The retired words a piece of visible copy says, after the kept phrases and any `alsoKept` are taken out. */
export function retiredIn(text: string, alsoKept: readonly string[] = []): string[] {
  let rest = String(text || '');
  for (const phrase of [...KEPT_PHRASES, ...alsoKept]) {
    if (phrase) rest = rest.split(phrase).join(' ');
  }
  return RETIRED_WORDS.filter((row) => row.re.test(rest)).map((row) => row.word);
}
