import { authHeaders } from './firebase';

export interface AICopyRequest {
  nodeType: 'ad' | 'page' | 'email';
  businessType?: string;
  offerHeadline: string;
  goal?: string;
}

export async function requestAICopy(req: AICopyRequest): Promise<any> {
  try {
    const res = await fetch('/api/ai/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(req)
    });
    const data = await res.json();
    if (data.success && data.copy) {
      return data.copy;
    }
  } catch (err) {
    console.warn('[Jourvance] Local API error, using smart local template generator:', err);
  }

  // Fallback client-side generation
  if (req.nodeType === 'ad') {
    return {
      headline: req.offerHeadline || 'Your ad headline',
      body: 'Describe the offer in words you can stand behind.',
      cta: 'Learn more'
    };
  } else if (req.nodeType === 'page') {
    return {
      headline: req.offerHeadline || 'Your offer headline',
      subhead: 'Describe what the visitor gets.',
      cta: 'Continue'
    };
  } else {
    return {
      subject: req.offerHeadline ? `A note about ${req.offerHeadline}` : 'A note from the store',
      preview: 'Replace this before anyone receives it',
      body: `Hi there,\n\nReplace this note with the real next step before anyone receives it.\n\nThe Team`
    };
  }
}
