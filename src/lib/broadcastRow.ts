/**
 * What All broadcasts says for one broadcast (HubEmailSuite.tsx). The list route (emailRoutes.mjs
 * presentCampaign) answers each broadcast's `status` and its stored `lastError`. One a stopped server
 * left part way through its send, or whose send threw, is `interrupted` with no `sentAt`; it read
 * "Not sent" and its reason was dropped, so a merchant who sent it again could mail people twice.
 */
export interface BroadcastRowFields {
  sentAt?: string | null;
  status?: string;
  lastError?: string;
}

/** The status column's word: Interrupted, the date it went, Scheduled, or Not sent. */
export function broadcastStatusText(b: BroadcastRowFields): string {
  if (b.status === 'interrupted') return 'Interrupted';
  if (b.sentAt) return new Date(b.sentAt).toLocaleDateString();
  return b.status === 'scheduled' ? 'Scheduled' : 'Not sent';
}

/** The sentence under an interrupted broadcast's row: the reason the server stored, or nothing. */
export function broadcastStoppedReason(b: BroadcastRowFields): string {
  if (b.status !== 'interrupted') return '';
  return typeof b.lastError === 'string' ? b.lastError.trim() : '';
}
