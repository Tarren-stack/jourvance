import { authHeaders } from './firebase';
import type { Workspace, ShopifyProduct } from '../types/journey';

export async function fetchWorkspaces(): Promise<Workspace[]> {
  try {
    const res = await fetch('/api/workspaces', { headers: await authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (data?.success && Array.isArray(data.workspaces)) {
      return data.workspaces;
    }
  } catch (err) {
    console.warn('[Jourvance] Failed to fetch workspaces:', err);
  }
  return [
    {
      id: 'ws-default',
      userId: 'local',
      name: 'Main E-Commerce Workspace',
      shopifyConfig: {
        storeDomain: '',
        status: 'disconnected'
      },
      planTier: 'starter',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];
}

export async function createWorkspace(name: string): Promise<{ success: boolean; workspace?: Workspace; error?: string }> {
  try {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ name })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 402) {
      return { success: false, error: data.error || 'Upgrade to Pro to create more workspaces.' };
    }
    if (data?.success && data.workspace) {
      return { success: true, workspace: data.workspace };
    }
    return { success: false, error: data.error || 'Could not create workspace.' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function connectShopifyStore(
  workspaceId: string,
  storeDomain: string,
  storefrontAccessToken?: string
): Promise<{ success: boolean; workspace?: Workspace; error?: string }> {
  try {
    const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}/shopify/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ storeDomain, storefrontAccessToken })
    });
    const data = await res.json().catch(() => ({}));
    if (data?.success && data.workspace) {
      return { success: true, workspace: data.workspace };
    }
    return { success: false, error: data.error || 'Could not connect Shopify store.' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function disconnectShopifyStore(workspaceId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}/shopify/disconnect`, {
      method: 'POST',
      headers: await authHeaders()
    });
    const data = await res.json().catch(() => ({}));
    return !!data?.success;
  } catch {
    return false;
  }
}

export async function fetchShopifyProducts(workspaceId: string): Promise<{
  products: ShopifyProduct[];
  source: string;
  storeDomain: string;
  notice?: string;
}> {
  try {
    const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}/shopify/products`, {
      headers: await authHeaders()
    });
    const data = await res.json().catch(() => ({}));
    if (data?.success && Array.isArray(data.products)) {
      return {
        products: data.products,
        source: data.source || 'live',
        storeDomain: data.storeDomain || '',
        notice: data.notice
      };
    }
  } catch (err) {
    console.warn('[Jourvance] Failed to load Shopify products:', err);
  }
  return { products: [], source: 'offline', storeDomain: '' };
}

/**
 * Builds a direct-to-checkout permalink for Shopify with optional discount & UTM campaign tags.
 * Format: https://{storeDomain}/cart/{variantId}:{quantity}?discount={code}&utm_source=jourvance&utm_campaign={campaign}
 */
export function buildCheckoutPermalink(opts: {
  storeDomain: string;
  variantId?: string;
  quantity?: number;
  discountCode?: string;
  utmCampaign?: string;
}): string {
  let domain = (opts.storeDomain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!domain) domain = 'your-store.myshopify.com';

  const cleanVariantId = (opts.variantId || '42109840192').replace(/^gid:\/\/shopify\/ProductVariant\//, '');
  const qty = opts.quantity && opts.quantity > 0 ? opts.quantity : 1;

  const params = new URLSearchParams();
  if (opts.discountCode && opts.discountCode.trim()) {
    params.set('discount', opts.discountCode.trim().toUpperCase());
  }
  params.set('utm_source', 'jourvance');
  params.set('utm_medium', 'funnel');
  if (opts.utmCampaign && opts.utmCampaign.trim()) {
    params.set('utm_campaign', opts.utmCampaign.trim());
  }

  const query = params.toString();
  return `https://${domain}/cart/${cleanVariantId}:${qty}${query ? `?${query}` : ''}`;
}

/**
 * Builds a direct-to-checkout permalink for multiple Shopify items (core product + order bump).
 * Format: https://{storeDomain}/cart/{variantId1}:{qty1},{variantId2}:{qty2}?discount={code}&...
 */
export function buildMultiItemCheckoutPermalink(opts: {
  storeDomain: string;
  items: Array<{ variantId?: string; quantity?: number }>;
  discountCode?: string;
  utmCampaign?: string;
  utmSource?: string;
  utmMedium?: string;
  fbclid?: string;
  ttclid?: string;
  gclid?: string;
}): string {
  let domain = (opts.storeDomain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!domain) domain = 'your-store.myshopify.com';

  const validItems = opts.items
    .filter(i => !!i.variantId)
    .map(i => {
      const cleanId = String(i.variantId!).replace(/^gid:\/\/shopify\/ProductVariant\//, '');
      const qty = i.quantity && i.quantity > 0 ? i.quantity : 1;
      return `${cleanId}:${qty}`;
    });

  const cartPath = validItems.length > 0 ? validItems.join(',') : '42109840192:1';

  const params = new URLSearchParams();
  if (opts.discountCode && opts.discountCode.trim()) {
    params.set('discount', opts.discountCode.trim().toUpperCase());
  }
  params.set('utm_source', opts.utmSource || 'jourvance');
  params.set('utm_medium', opts.utmMedium || 'funnel');
  if (opts.utmCampaign && opts.utmCampaign.trim()) {
    params.set('utm_campaign', opts.utmCampaign.trim());
  }
  if (opts.fbclid) params.set('fbclid', opts.fbclid);
  if (opts.ttclid) params.set('ttclid', opts.ttclid);
  if (opts.gclid) params.set('gclid', opts.gclid);

  const query = params.toString();
  return `https://${domain}/cart/${cartPath}${query ? `?${query}` : ''}`;
}

/**
 * Checks CNAME DNS propagation for custom brand subdomains (Wave 3)
 */
export async function verifyCustomDomain(domain: string): Promise<{
  success: boolean;
  verified: boolean;
  domain: string;
  cnames?: string[];
  expectedTarget?: string;
  message?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/domain/verify?domain=${encodeURIComponent(domain)}`);
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      verified: false,
      domain,
      error: err.message || 'DNS check failed'
    };
  }
}


