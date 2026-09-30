// What the map says after Backspace or Delete removes steps or lines (C04). Every step's own
// description promises "Backspace deletes the selected step", so the delete is announced in the
// map's polite notice with the undo shortcut, and an undo that brings the steps back says so.
// Steps are named the way their cards read (stepShortName), never by node id, and placed in the
// sentence with nameInSentence and endSentence, the rule every map sentence shares (T09).
// Pure: no React, no DOM, so node tests can load it.

import { endSentence, nameInSentence, stepShortName } from './stepNames.ts';
import type { StepOrData } from './stepNames.ts';

type Line = { source: string; target: string };

/** True on a Mac, iPhone or iPad, where undo is Command Z. Reads navigator's platform or user agent. */
export function isApplePlatform(platform: string | null | undefined): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(String(platform ?? ''));
}

/** The undo shortcut in words, as a screen reader should say it. */
export function undoKeys(apple: boolean): string {
  return apple ? 'Command Z' : 'Control Z';
}

function listNames(steps: StepOrData[], noun: string): string {
  const names = steps.map(n => nameInSentence(stepShortName(n)));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.length} ${noun}`;
}

/**
 * The sentence after a keyboard delete. Steps win: the lines React Flow removes with a step are
 * part of deleting it. A line on its own is named by the steps it joins. Empty when nothing went.
 */
export function deletedNotice(
  removed: { nodes: StepOrData[]; edges: Line[] },
  stepsById: Map<string, StepOrData>,
  apple: boolean
): string {
  const tail = ` Press ${undoKeys(apple)} to undo.`;
  if (removed.nodes.length > 0) return endSentence(`Deleted ${listNames(removed.nodes, 'steps')}`) + tail;
  if (removed.edges.length === 1) {
    const [line] = removed.edges;
    const from = stepsById.has(line.source) ? nameInSentence(stepShortName(stepsById.get(line.source))) : 'a step that is gone';
    const to = stepsById.has(line.target) ? nameInSentence(stepShortName(stepsById.get(line.target))) : 'a step that is gone';
    return endSentence(`Deleted the line from ${from} to ${to}`) + tail;
  }
  if (removed.edges.length > 1) return `Deleted ${removed.edges.length} lines.${tail}`;
  return '';
}

/** The sentence when an undo brings deleted steps back. */
export function restoredNotice(steps: StepOrData[]): string {
  return steps.length > 0 ? endSentence(`Restored ${listNames(steps, 'steps')}`) : '';
}

/**
 * Where focus should go once a deleted step's card has left the page: to the map when focus fell
 * to the page body or went with the card, and nowhere when the person is somewhere else.
 */
export function focusFellWithDelete(active: { isConnected?: boolean } | null, body: unknown): boolean {
  return !active || active === body || active.isConnected === false;
}
