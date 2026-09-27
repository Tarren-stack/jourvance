import { authHeaders } from './firebase';
import type { CustomBlueprint, JourneyNode, JourneyEdge } from '../types/journey';

export async function fetchCustomBlueprints(): Promise<CustomBlueprint[]> {
  try {
    const res = await fetch('/api/templates', {
      headers: await authHeaders()
    });
    const data = await res.json();
    return data.success && Array.isArray(data.templates) ? data.templates : [];
  } catch (err) {
    console.warn('[Jourvance] Failed fetching custom blueprints:', err);
    return [];
  }
}

export async function saveCustomBlueprint(payload: {
  name: string;
  description: string;
  category: string;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
}): Promise<{ success: boolean; template?: CustomBlueprint; error?: string }> {
  try {
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await authHeaders())
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Failed saving blueprint.' };
    }
    return { success: true, template: data.template };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error saving blueprint.' };
  }
}

export async function deleteCustomBlueprint(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/templates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: await authHeaders()
    });
    const data = await res.json();
    return !!data.success;
  } catch (err) {
    console.warn('[Jourvance] Failed deleting blueprint:', err);
    return false;
  }
}

export async function fetchSharedBlueprint(code: string): Promise<{ success: boolean; template?: CustomBlueprint; error?: string }> {
  try {
    const cleanCode = code.trim().replace(/^https?:\/\/.*[?&]import_blueprint=/, '');
    const res = await fetch(`/api/templates/shared/${encodeURIComponent(cleanCode)}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Shared blueprint not found.' };
    }
    return { success: true, template: data.template };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error fetching shared blueprint.' };
  }
}

export async function importSharedBlueprint(code: string): Promise<{ success: boolean; template?: CustomBlueprint; error?: string }> {
  try {
    const cleanCode = code.trim().replace(/^https?:\/\/.*[?&]import_blueprint=/, '');
    const res = await fetch(`/api/templates/import/${encodeURIComponent(cleanCode)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await authHeaders())
      }
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Failed importing blueprint.' };
    }
    return { success: true, template: data.template };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error importing blueprint.' };
  }
}
