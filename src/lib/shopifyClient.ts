import { authHeaders } from './firebase';
import type { Workspace, ShopifyProduct } from '../types/journey';
import { isDemoVariantId } from './productPickerCatalog';

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
  adminAccessToken?: string,
  webhookSecret?: string
): Promise<{ success: boolean; workspace?: Workspace; error?: string; notice?: string }> {
  try {
    const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}/shopify/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ storeDomain, adminAccessToken, webhookSecret })
    });
    const data = await res.json().catch(() => ({}));
    if (data?.success && data.workspace) {
      return { success: true, workspace: data.workspace, notice: data.notice };
    }
    return { success: false, error: data.error || 'Could not connect Shopify store.' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export interface WebhookDeliveryReceipt {
  id: string;
  topic: string;
  shopDomain: string;
  receivedAt: string;
  hmacStatus: 'valid' | 'invalid_signature' | 'missing_secret' | 'store_not_found';
  latencyMs: number;
  summary: string;
  isTest?: boolean;
}

export interface WebhookHealthData {
  status: 'healthy' | 'degraded' | 'failing' | 'idle' | 'missing_secret' | 'disconnected';
  message: string;
  lastReceivedAt: string | null;
  metrics: {
    total24h: number;
    valid24h: number;
    failed24h: number;
    successRate: number;
  };
  recentDeliveries: WebhookDeliveryReceipt[];
}

export async function fetchShopifySignals(workspaceId: string): Promise<{
  success: boolean;
  connected?: boolean;
  publicUrl?: boolean;
  topics?: { topic: string; path: string; address?: string; registered: boolean; detail?: string }[];
  lastEventAt?: string | null;
  todayCount?: number;
  pixelSnippet?: string;
  restockSnippet?: string;
  notice?: string;
  webhookHealth?: WebhookHealthData;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}/shopify/signals`, { headers: await authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) return { success: false, error: data.error || 'Store signals could not be loaded.' };
    return data;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function fetchWebhookHealth(workspaceId: string): Promise<{
  success: boolean;
  error?: string;
} & Partial<WebhookHealthData>> {
  try {
    const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}/shopify/webhook-health`, { headers: await authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) return { success: false, error: data.error || 'Webhook health could not be loaded.' };
    return data;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function sendWebhookTestPing(workspaceId: string, topic?: string): Promise<{
  success: boolean;
  message?: string;
  delivery?: WebhookDeliveryReceipt;
  health?: WebhookHealthData;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}/shopify/webhook-test-ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ topic: topic || 'orders/create' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) return { success: false, error: data.error || 'Test ping could not be delivered.' };
    return data;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function registerShopifyWebhooks(workspaceId: string): Promise<{
  success: boolean;
  registered?: boolean;
  publicUrl?: boolean;
  topics?: { topic: string; path: string; registered: boolean; detail?: string }[];
  notice?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}/shopify/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: '{}'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) return { success: false, error: data.error || 'Shopify did not register the webhooks.' };
    return data;
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
  const domain = (opts.storeDomain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const cleanVariantId = String(opts.variantId || '').replace(/^gid:\/\/shopify\/ProductVariant\//, '');
  if (!domain || domain === 'demo.myshopify.com' || domain === 'your-store.myshopify.com' || !cleanVariantId || isDemoVariantId(cleanVariantId)) return '';
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
  const domain = (opts.storeDomain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!domain || domain === 'demo.myshopify.com' || domain === 'your-store.myshopify.com') return '';

  const validItems = opts.items
    .filter(i => !!i.variantId && !isDemoVariantId(i.variantId))
    .map(i => {
      const cleanId = String(i.variantId!).replace(/^gid:\/\/shopify\/ProductVariant\//, '');
      const qty = i.quantity && i.quantity > 0 ? i.quantity : 1;
      return `${cleanId}:${qty}`;
    });

  if (!validItems.length) return '';
  const cartPath = validItems.join(',');

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

export interface DomainVerifyResult {
  success: boolean;
  verified: boolean;
  domain: string;
  cnames?: string[];
  expectedTarget?: string;
  contested?: boolean;
  method?: 'cname' | 'txt_challenge';
  verificationToken?: string;
  expectedTxtHost?: string;
  expectedTxtRecord?: string;
  sslActive?: boolean;
  sslDetails?: {
    issuer?: string;
    validTo?: string;
    daysRemaining?: number;
    authorized?: boolean;
  };
  message?: string;
  error?: string;
}

/**
 * Checks CNAME DNS propagation & SSL certificate for custom brand subdomains (Wave 3). With the
 * journey that asks, a verified domain is switched on only for that journey's published page.
 */
export async function verifyCustomDomain(domain: string, journeyId?: string): Promise<DomainVerifyResult> {
  try {
    const journeyParam = journeyId ? `&journeyId=${encodeURIComponent(journeyId)}` : '';
    const res = await fetch(`/api/domain/verify?domain=${encodeURIComponent(domain)}${journeyParam}`, {
      headers: await authHeaders()
    });
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

export async function getDomainVerificationToken(domain: string): Promise<{
  success: boolean;
  domain: string;
  token?: string;
  txtHost?: string;
  txtRecord?: string;
  cnameHost?: string;
  cnameTarget?: string;
  verified?: boolean;
  contested?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/domain/token?domain=${encodeURIComponent(domain)}`, {
      headers: await authHeaders()
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, domain, error: err.message || 'Token fetch failed' };
  }
}

export interface EmailDeliverabilityReport {
  success: boolean;
  domain: string;
  score: number;
  status: 'optimal' | 'good' | 'warning' | 'critical';
  spf: {
    valid: boolean;
    record?: string;
    policy?: string;
    includes?: string[];
    error?: string;
  };
  dkim: {
    valid: boolean;
    selector?: string;
    record?: string;
    error?: string;
  };
  dmarc: {
    valid: boolean;
    record?: string;
    policy?: string;
    rua?: string;
    pct?: number;
    error?: string;
  };
  mx: {
    valid: boolean;
    records?: { exchange: string; priority: number }[];
    error?: string;
  };
  recommendations: string[];
  suggestedRecords: {
    type: string;
    name: string;
    value: string;
    purpose: string;
  }[];
  error?: string;
}

/**
 * Deep DNS deliverability health check (SPF, DKIM, DMARC, MX)
 */
export async function checkEmailDeliverabilityDns(domain: string): Promise<EmailDeliverabilityReport> {
  try {
    const res = await fetch(`/api/email/dns-check?domain=${encodeURIComponent(domain)}`, {
      headers: await authHeaders()
    });
    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      domain,
      score: 0,
      status: 'critical',
      spf: { valid: false, error: 'Network error checking SPF' },
      dkim: { valid: false, error: 'Network error checking DKIM' },
      dmarc: { valid: false, error: 'Network error checking DMARC' },
      mx: { valid: false, error: 'Network error checking MX' },
      recommendations: ['Check connection and retry.'],
      suggestedRecords: [],
      error: err.message || 'DNS check failed'
    };
  }
}



