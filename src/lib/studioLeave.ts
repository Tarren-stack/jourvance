/**
 * Leaving the flow editor with edits that are not saved (EMAIL_STUDIO_PLAN.md Wave 8).
 *
 * The editor's draft lives in EmailFlowMap's own state, and the editor is unmounted by every way out of
 * it: a click or an arrow key on Email Studio's tab strips, Back to funnel, Back to Canvas, and the
 * sidebar's and the header's view switch in App. Only the editor's own flow picker asked first, so an
 * edit made on Welcome's second email was dropped by a click on All flows. Every one of those ways out
 * asks here first.
 *
 * The editor says here whether it holds an unsaved edit, while it is mounted (noteFlowUnsaved), and
 * clears it when it unmounts. One flag for the page: the app mounts one Email Studio at a time.
 */

/** What the editor asks before an edit on screen is dropped. Its flow picker asks the same. */
export const FLOW_UNSAVED_LEAVE = 'This flow has changes that are not saved. Leave it and lose them?';

let unsavedFlow = false;

/** The flow editor's unsaved state, set by EmailFlowMap. */
export function noteFlowUnsaved(unsaved: boolean): void {
  unsavedFlow = unsaved;
}

/** Whether the flow editor holds an edit that is not saved. */
export function flowUnsaved(): boolean {
  return unsavedFlow;
}

/**
 * True when nothing unsaved is on screen, or the person chose to leave it. Asks once: after OK the flag
 * is cleared, so a second guard on the same way out (App's, after Email Studio's) does not ask again.
 * Cancel answers false, and the caller changes nothing.
 */
export function leaveFlowEditorOk(): boolean {
  if (!unsavedFlow) return true;
  if (typeof window === 'undefined' || !window.confirm(FLOW_UNSAVED_LEAVE)) return false;
  unsavedFlow = false;
  return true;
}
