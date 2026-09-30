import type { JourneyProject } from '../types/journey';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from './defaultBlueprint.ts';
import { clearTemplateMetrics } from './liveStats.ts';
import { repairJourneyHandles } from './stepHandles.ts';
import { SYNC_PREFIX } from './accountSync.ts';

/** The journey open on the canvas. A bare /canvas opens whatever it holds. */
export const STORAGE_KEY = 'jourvance_active_project';

/**
 * Every journey's own browser copy lives at PARKED_PREFIX + id. It is written on every autosave
 * beside the active slot, so it is never stale, even with two tabs open on different journeys.
 * Nothing here removes a copy on its own: only removeBrowserJourney does, when the person asks.
 */
export const PARKED_PREFIX = 'jourvance_journey:';

export function loadCurrentJourney(): JourneyProject {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.nodes && parsed.edges) {
        // Maps saved before #6 name an 'accepted' handle on a landing page, which draws no line.
        return repairJourneyHandles(parsed as JourneyProject);
      }
    }
  } catch (e) {
    console.warn('[Jourvance] Failed to parse localStorage project, using default:', e);
  }
  return clearTemplateMetrics(DEFAULT_LEAD_CAPTURE_PROJECT);
}

/**
 * True for the error a browser throws when its storage for this site is full. Chrome, Safari and
 * Firefox name it QuotaExceededError (code 22); older Firefox named it NS_ERROR_DOM_QUOTA_REACHED
 * (code 1014). A blocked store (privacy settings) throws something else, and reads as not full.
 */
export function isStorageFull(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const { name, code } = e as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

/** What a browser write achieved: kept, or refused because storage is full, or refused otherwise. */
type WriteResult = 'ok' | 'full' | 'refused';

function write(key: string, raw: string): WriteResult {
  try {
    localStorage.setItem(key, raw);
    return 'ok';
  } catch (e) {
    console.error(`[Jourvance] Failed to write ${key}:`, e);
    return isStorageFull(e) ? 'full' : 'refused';
  }
}

export interface BrowserWrite {
  /** Both the active slot and the journey's own copy were written. */
  kept: boolean;
  /** A write was refused because this browser's storage for the site is full. */
  full: boolean;
}

/**
 * Keep the journey in this browser: the active slot and its own copy. Not kept when the browser
 * refused either write, because a switch or a reload would then find it stale, and `full` says
 * whether that was because storage is full (freeing space helps; trying again does not).
 */
export function keepJourney(project: JourneyProject): BrowserWrite {
  const raw = JSON.stringify(project);
  const active = write(STORAGE_KEY, raw);
  lastSlotWrite = active;
  const own = write(PARKED_PREFIX + project.id, raw);
  return { kept: active === 'ok' && own === 'ok', full: active === 'full' || own === 'full' };
}

/**
 * How this tab's last write to the active slot went, null before its first. Module state is per tab,
 * and keepJourney is the only writer of the slot, so this is what tells "another tab wrote the slot
 * since" apart from "this tab could not write over it" (activeSlotHold).
 */
let lastSlotWrite: WriteResult | null = null;

/** keepJourney, answering only whether it was kept. */
export function saveCurrentJourney(project: JourneyProject): boolean {
  return keepJourney(project).kept;
}

/** Write the journey's own browser copy only. False when the browser refused (quota, privacy mode). */
export function parkJourney(project: JourneyProject): boolean {
  return write(PARKED_PREFIX + project.id, JSON.stringify(project)) === 'ok';
}

/** A stored body that reads as a journey with this id, or null. */
function readStored(key: string, id?: string): JourneyProject | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<JourneyProject> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    if (id !== undefined && parsed.id !== id) return null;
    return repairJourneyHandles(parsed as JourneyProject);
  } catch (e) {
    console.warn(`[Jourvance] Ignoring a browser copy that does not parse (${key}):`, e);
    return null;
  }
}

/** The journey's own browser copy, or null when this browser has none that reads as that journey. */
export function readParkedJourney(id: string): JourneyProject | null {
  return readStored(PARKED_PREFIX + id, id);
}

/** Every journey this browser keeps, once each. The active slot wins over a journey's own copy. */
export function listLocalJourneys(): JourneyProject[] {
  const byId = new Map<string, JourneyProject>();
  const active = readStored(STORAGE_KEY);
  if (active) byId.set(active.id, active);
  let keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PARKED_PREFIX)) keys.push(key);
    }
  } catch {
    keys = [];
  }
  for (const key of keys) {
    const parked = readStored(key, key.slice(PARKED_PREFIX.length));
    if (parked && !byId.has(parked.id)) byId.set(parked.id, parked);
  }
  return [...byId.values()];
}

// ---- Removing a browser copy (only when the person asks) ----

/** Everything removeBrowserJourney took out, exactly as it was stored, so Undo can put it back. */
export interface RemovedBrowserJourney {
  id: string;
  /** The journey's own copy, byte for byte. */
  raw: string;
  /** Its lineage records (accountSync.ts), one per account that had it open, as stored. */
  syncRecords: [key: string, value: string][];
}

export type RemoveResult =
  | { ok: true; removed: RemovedBrowserJourney }
  | { ok: false; reason: 'open' | 'missing' | 'refused' }
  | { ok: false; reason: 'active-slot'; hold: ActiveSlotHold };

/** The lineage record keys for one journey: exactly `<uid>:<id>` after the prefix, both encoded. */
function syncRecordKeys(id: string): string[] {
  const tail = `:${encodeURIComponent(id)}`;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(SYNC_PREFIX) || !k.endsWith(tail)) continue;
    if (k.slice(SYNC_PREFIX.length).split(':').length === 2) keys.push(k);
  }
  return keys;
}

/**
 * Why the active slot holds a journey this tab does not have open. 'another-tab': this tab's last
 * write to the slot landed, so another tab of this browser has written it since. 'not-saved-here':
 * this tab's last write to the slot was refused (`full` when storage is full), so the slot may
 * still hold the journey this tab left; another tab may have it open as well, which nothing here
 * can see. Either way a bare /canvas opens it until a tab writes the slot again.
 */
export type ActiveSlotHold = { kind: 'another-tab' } | { kind: 'not-saved-here'; full: boolean };

/** Why the active slot holds `id` while this tab has `openId` open, or null when it does not. */
export function activeSlotHold(id: string, openId: string): ActiveSlotHold | null {
  if (!id || id === openId || readStored(STORAGE_KEY)?.id !== id) return null;
  if (lastSlotWrite === 'ok') return { kind: 'another-tab' };
  return { kind: 'not-saved-here', full: lastSlotWrite === 'full' };
}

/**
 * Take a journey's own copy out of this browser, with the lineage records that describe it (a
 * record for a copy that is gone would say the next copy came from an account revision it never
 * saw). The journey on screen is never removed: `openId` is it ('open'), and a journey the active
 * slot still holds is refused with why ('active-slot', activeSlotHold), because the slot would keep
 * it, the library would still list it, and a tab that has it open would write its copy back. Nothing
 * calls this without the person choosing it (JourneyLibraryDialog asks first).
 */
export function removeBrowserJourney(id: string, openId: string): RemoveResult {
  if (!id || id === openId) return { ok: false, reason: 'open' };
  const hold = activeSlotHold(id, openId);
  if (hold) return { ok: false, reason: 'active-slot', hold };
  try {
    const raw = localStorage.getItem(PARKED_PREFIX + id);
    if (raw === null) return { ok: false, reason: 'missing' };
    const syncRecords: [string, string][] = [];
    for (const key of syncRecordKeys(id)) {
      const value = localStorage.getItem(key);
      if (value !== null) syncRecords.push([key, value]);
    }
    localStorage.removeItem(PARKED_PREFIX + id);
    for (const [key] of syncRecords) localStorage.removeItem(key);
    return { ok: true, removed: { id, raw, syncRecords } };
  } catch (e) {
    console.error(`[Jourvance] Failed to remove the browser copy of ${id}:`, e);
    return { ok: false, reason: 'refused' };
  }
}

/** Undo for removeBrowserJourney: the same bytes under the same keys. False when the browser refused. */
export function restoreBrowserJourney(removed: RemovedBrowserJourney): boolean {
  if (write(PARKED_PREFIX + removed.id, removed.raw) !== 'ok') return false;
  for (const [key, value] of removed.syncRecords) write(key, value);
  return true;
}

// ---- How much of this browser's storage is used ----

/**
 * Browsers allow a site about 5 MB of this storage (Chrome and Firefox count 5,242,880 UTF-16
 * characters of keys and values, Safari about the same). It is not a number any browser reports,
 * so the library words it as an estimate. navigator.storage.estimate() is not used: Chrome keeps
 * this storage outside the figures it reports, so it would read as nearly empty while full.
 */
export const BROWSER_STORAGE_LIMIT_CHARS = 5 * 1024 * 1024;

export interface BrowserStorageUsage {
  /** Characters of every key and value this site holds, journeys included. */
  usedChars: number;
  /** The part of that held by journeys: the active slot and every journey's own copy. */
  journeyChars: number;
}

/** What this site holds in this browser's storage now, or null when the browser will not say. */
export function browserStorageUsage(): BrowserStorageUsage | null {
  try {
    let usedChars = 0;
    let journeyChars = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null) continue;
      const size = key.length + (localStorage.getItem(key)?.length ?? 0);
      usedChars += size;
      if (key === STORAGE_KEY || key.startsWith(PARKED_PREFIX)) journeyChars += size;
    }
    return { usedChars, journeyChars };
  } catch {
    return null;
  }
}

/** One characters-to-megabytes rule for the usage line, to one decimal place ("3.1 MB", "5 MB"). */
export function formatStorageMb(chars: number): string {
  return `${Math.round((chars / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Below this many kilobytes the usage line counts in whole KB, at and above it in MB. An ordinary
 * journey is a few KB, so a line floored to "less than 0.1 MB" never moved when one was removed.
 */
export const STORAGE_KB_BELOW = 1000;

/** The amount part of the usage line: "Less than 1 KB", "14 KB", "820 KB", then "1 MB", "3.1 MB". */
export function formatStorageAmount(chars: number): string {
  const kb = Math.round(chars / 1024);
  if (kb < 1) return 'Less than 1 KB';
  if (kb < STORAGE_KB_BELOW) return `${kb} KB`;
  return formatStorageMb(chars);
}

/** The library's usage line, worded as the estimate it is, or null when the browser will not say. */
export function storageUsageLine(usage: BrowserStorageUsage | null, limitChars = BROWSER_STORAGE_LIMIT_CHARS): string | null {
  if (!usage) return null;
  const limit = formatStorageMb(limitChars);
  const amount = formatStorageAmount(usage.usedChars);
  // "Less than 1 KB" is already worded as a bound; every other amount is rounded, so it says About.
  return `${amount.startsWith('Less') ? amount : `About ${amount}`} of ${limit} used in this browser.`;
}

/**
 * The journey to show first. With no id, or the open journey's id, that is the active slot. An id
 * this browser keeps opens from its own copy (the autosave then writes it into the active slot),
 * and the journey that was open is parked first so it can be reopened. Otherwise the active
 * journey is shown and `missing` says the address named one this browser does not have.
 */
export function loadInitialJourney(requestedId: string | null): { project: JourneyProject; missing: boolean } {
  const active = loadCurrentJourney();
  if (!requestedId || requestedId === active.id) return { project: active, missing: false };
  const parked = readParkedJourney(requestedId);
  if (!parked) return { project: active, missing: true };
  // Cheap insurance for a journey saved before its own copy existed. The starter map shown when
  // nothing is stored is not a journey anybody kept, so it is not parked.
  if (readStored(STORAGE_KEY)) parkJourney(active);
  return { project: parked, missing: false };
}

export function resetToDefaultBlueprint(): JourneyProject {
  const fresh = clearTemplateMetrics(JSON.parse(JSON.stringify(DEFAULT_LEAD_CAPTURE_PROJECT)));
  fresh.updatedAt = new Date().toISOString();
  saveCurrentJourney(fresh);
  return fresh;
}
