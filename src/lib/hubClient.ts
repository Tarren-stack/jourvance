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
      headers: { 'Content-Type': 'application/json' },
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
      headline: `Special Offer: ${req.offerHeadline}`,
      body: `Ready for real results without the headaches? Discover why top clients trust our proven service. Claim your spot today.`,
      cta: 'Claim Offer Now'
    };
  } else if (req.nodeType === 'page') {
    return {
      headline: `Get ${req.offerHeadline} — Guaranteed`,
      subhead: `Designed for busy businesses who demand excellence and clarity. Transparent, dependable, and high-impact.`,
      cta: 'Claim Your Spot Now'
    };
  } else {
    return {
      subject: `Your ${req.offerHeadline} confirmation details`,
      preview: `Here is what you need to get started right away...`,
      body: `Hi there,\n\nThank you for claiming ${req.offerHeadline}!\n\nHere are the next steps:\n1. Check your confirmation details\n2. Schedule your preferred time on our calendar\n3. Reply to this email if you have any questions!\n\nBest,\nThe Team`
    };
  }
}
