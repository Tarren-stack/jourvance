/**
 * Leaving the flow editor, or Email Studio, with edits that are not saved (EMAIL_STUDIO_PLAN.md Wave 8,
 * and the open list of 2026-10-09).
 *
 * The editor's draft lives in EmailFlowMap's own state, and the editor is unmounted by every way out of
 * it: a click or an arrow key on Email Studio's tab strips, Back to funnel, Back to Canvas, and the
 * sidebar's and the header's view switch in App. Only the editor's own flow picker asked first, so an
 * edit made on Welcome's second email was dropped by a click on All flows. Every one of those ways out
 * asks here first.
 *
 * The broadcast composer's draft lives in HubEmailSuite (useBroadcastDraft), so a switch between the
 * studio's own tabs keeps it and must not ask about it; only leaving Email Studio drops it. So there are
 * two questions: leaveFlowEditorOk (the studio's tab strips: the flow edit only) and leaveStudioOk (App's
 * ways out of the studio: the flow edit, the broadcast draft, or both in ONE question).
 *
 * Each says here whether it holds an unsaved edit while it is mounted (noteFlowUnsaved,
 * noteBroadcastUnsaved), and clears it when it unmounts. One flag each for the page: the app mounts one
 * Email Studio at a time.
 */

/** What the editor asks before an edit on screen is dropped. Its flow picker asks the same. */
export const FLOW_UNSAVED_LEAVE = 'This flow has changes that are not saved. Leave it and lose them?';
/** What leaving Email Studio asks when the broadcast being written is not saved as a draft. */
export const BROADCAST_UNSAVED_LEAVE = 'The broadcast you are writing has changes that are not saved as a draft. Leave Email Studio and lose them?';
/** Both at once: one question, never two in a row. */
export const STUDIO_UNSAVED_LEAVE = 'This flow and the broadcast you are writing both have changes that are not saved. Leave Email Studio and lose them?';

let unsavedFlow = false;
let unsavedBroadcast = false;

/** The flow editor's unsaved state, set by EmailFlowMap. */
export function noteFlowUnsaved(unsaved: boolean): void {
  unsavedFlow = unsaved;
}

/** Whether the flow editor holds an edit that is not saved. */
export function flowUnsaved(): boolean {
  return unsavedFlow;
}

/** The broadcast composer's unsaved state, set by useBroadcastDraft (BroadcastComposer.tsx). */
export function noteBroadcastUnsaved(unsaved: boolean): void {
  unsavedBroadcast = unsaved;
}

/** Whether the broadcast being written holds changes that are not saved as a draft. */
export function broadcastUnsaved(): boolean {
  return unsavedBroadcast;
}

/**
 * True when nothing unsaved is on screen, or the person chose to leave it. Asks once: after OK the flag
 * is cleared, so a second guard on the same way out (App's, after Email Studio's) does not ask again.
 * Cancel answers false, and the caller changes nothing. A broadcast draft is not asked about here: the
 * studio's tabs keep it.
 */
export function leaveFlowEditorOk(): boolean {
  if (!unsavedFlow) return true;
  if (typeof window === 'undefined' || !window.confirm(FLOW_UNSAVED_LEAVE)) return false;
  unsavedFlow = false;
  return true;
}

/** The one question leaving Email Studio asks, or '' when nothing unsaved would be lost. */
export function studioLeaveQuestion(): string {
  if (unsavedFlow && unsavedBroadcast) return STUDIO_UNSAVED_LEAVE;
  if (unsavedFlow) return FLOW_UNSAVED_LEAVE;
  if (unsavedBroadcast) return BROADCAST_UNSAVED_LEAVE;
  return '';
}

/**
 * Every way out of Email Studio (App's view switch, Back to Canvas, Back to funnel): one question for
 * whatever unsaved work the studio holds, asked once. OK clears both flags, so the second guard on the
 * same way out (showCanvas, then setActiveView) does not ask again; Cancel answers false.
 */
export function leaveStudioOk(): boolean {
  const question = studioLeaveQuestion();
  if (!question) return true;
  if (typeof window === 'undefined' || !window.confirm(question)) return false;
  unsavedFlow = false;
  unsavedBroadcast = false;
  return true;
}

/**
 * A beforeunload listener that makes the browser ask before a reload or a closed tab drops an unsaved
 * edit. The flow editor and the broadcast composer each add it while they hold one.
 */
export function warnBeforeUnload(event: Pick<BeforeUnloadEvent, 'preventDefault' | 'returnValue'>): void {
  event.preventDefault();
  // Older Chrome and Edge ask only when returnValue is set.
  (event as { returnValue: unknown }).returnValue = '';
}
