import type { JourneyProject } from '../types/journey';
import { DEFAULT_LEAD_CAPTURE_PROJECT } from './defaultBlueprint';

const STORAGE_KEY = 'jourvance_active_project';

export function loadCurrentJourney(): JourneyProject {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.nodes && parsed.edges) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[Jourvance] Failed to parse localStorage project, using default:', e);
  }
  return DEFAULT_LEAD_CAPTURE_PROJECT;
}

export function saveCurrentJourney(project: JourneyProject): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch (e) {
    console.error('[Jourvance] Failed to write localStorage project:', e);
  }
}

export function resetToDefaultBlueprint(): JourneyProject {
  const fresh = JSON.parse(JSON.stringify(DEFAULT_LEAD_CAPTURE_PROJECT));
  fresh.updatedAt = new Date().toISOString();
  saveCurrentJourney(fresh);
  return fresh;
}
