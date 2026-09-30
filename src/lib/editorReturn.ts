import type { JourneyNode, JourneyProject } from '../types/journey';

// The editor round trip: a step on the map opens another editor (Email Studio today), and the
// way back lands on that same step. These are the pure rules, so node tests can hold them and
// the App, the banner, Email Studio and the canvas all read one answer.
//
// The return lives in App state only. A reload lands on the map with no banner.

/** Where Back to funnel goes: one step on one journey, plus the flow that step links to. */
export interface FunnelReturn {
  journeyId: string;
  nodeId: string;
  stepName: string;
  /** The step's linked Jourvance flow id, or '' when it has none. */
  flowId: string;
}

type ProjectRef = Pick<JourneyProject, 'id'> & { nodes: Pick<JourneyNode, 'id' | 'data'>[] };

export const STUDIO_NOT_OPENED = 'Email Studio did not open, because the journey was not saved. Save it, then try again.';
export const LINKED_FLOW_MISSING = 'The flow this step links to was not found. It may have been deleted.';

export function emailStudioButtonLabel(hasFlow: boolean): string {
  return hasFlow ? 'Edit this flow in Email Studio' : 'Build a flow in Email Studio';
}

/** The return record for a follow-up sequence step, or null for any other step or a missing one. */
export function funnelReturnFor(project: ProjectRef, nodeId: string): FunnelReturn | null {
  const node = project.nodes.find((n) => n.id === nodeId);
  if (!node || node.data?.type !== 'follow-up-sequence') return null;
  const data = node.data as { label?: unknown; jourvanceFlowId?: unknown };
  return {
    journeyId: project.id,
    nodeId,
    stepName: String(data.label || '').trim() || 'this step',
    flowId: String(data.jourvanceFlowId || '').trim()
  };
}

/** The step to land on, or null when the return is gone, belongs to another journey, or its step was deleted. */
export function returnStepId(project: ProjectRef, ret: FunnelReturn | null | undefined): string | null {
  if (!ret || ret.journeyId !== project.id) return null;
  return project.nodes.some((n) => n.id === ret.nodeId) ? ret.nodeId : null;
}

/** The banner sentence. It names the step, and says plainly when the step is no longer there. */
export function returnBannerText(project: ProjectRef, ret: FunnelReturn): string {
  if (!returnStepId(project, ret)) return 'The step you came from is no longer on this journey. Back to funnel opens the map.';
  return ret.flowId
    ? `You opened Email Studio from ${ret.stepName}. Save your flow changes here before you go back.`
    : `You opened Email Studio from ${ret.stepName}. Build a flow on the Flow map and save it. Then go back and choose it on that step.`;
}

/**
 * The one save-then-navigate gate. `open` runs only after `save` resolved true. A false, a
 * rejection or any other value keeps the user where they are, and the caller says why.
 */
export async function openAfterSave(save: () => Promise<boolean>, open: () => void): Promise<boolean> {
  let ok = false;
  try { ok = (await save()) === true; } catch { ok = false; }
  if (!ok) return false;
  open();
  return true;
}

/**
 * A deep-link pick. `ids` is null when the list failed to load, and then nothing is reported
 * missing, because an unread list proves nothing about the flow.
 */
export function chooseFlowId(ids: string[] | null, prefer?: string): { id: string; missing: boolean } {
  const found = !!prefer && !!ids?.includes(prefer);
  return { id: found ? (prefer as string) : (ids?.[0] || ''), missing: !!prefer && ids !== null && !found };
}

export interface CanvasFitOptions {
  padding: number;
  nodes?: { id: string }[];
  maxZoom?: number;
}

/**
 * The canvas's initial viewport. A displayed step that is selected is framed at no more than
 * 100% zoom. Otherwise the whole map is fitted. A hidden step never frames an empty area.
 */
export function canvasFitOptions(focusNodeId: string | null | undefined, displayedIds: Iterable<string>): CanvasFitOptions {
  if (focusNodeId) {
    for (const id of displayedIds) {
      if (id === focusNodeId) return { padding: 0.2, nodes: [{ id: focusNodeId }], maxZoom: 1 };
    }
  }
  return { padding: 0.2 };
}
