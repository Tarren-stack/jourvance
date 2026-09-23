import type { Node, Edge } from '@xyflow/react';

export type NodeType = 'ad-source' | 'landing-page' | 'lead-form' | 'follow-up-sequence';

export interface AdNodeData extends Record<string, unknown> {
  type: 'ad-source';
  label: string;
  platform: 'meta' | 'google' | 'tiktok' | 'organic';
  headline: string;
  body: string;
  ctaText: string;
  imageUrl?: string;
  imagePrompt?: string;
  utmCampaign: string;
  // Metrics
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  cpc?: number;
  roas?: number;
}

export interface ShopifyConfig {
  storeDomain: string;
  storefrontAccessToken?: string;
  currency?: string;
  connectedAt?: string;
  status: 'connected' | 'disconnected' | 'error';
}

export interface Workspace {
  id: string;
  userId: string;
  name: string;
  shopifyConfig?: ShopifyConfig;
  planTier: 'starter' | 'pro' | 'enterprise';
  createdAt: string;
  updatedAt: string;
}

export interface ShopifyProductVariant {
  id: string;
  title: string;
  price: string;
  available: boolean;
  sku?: string;
}

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  description?: string;
  price: string;
  imageUrl?: string;
  images?: string[];
  variants: ShopifyProductVariant[];
}

export interface PageNodeData extends Record<string, unknown> {
  type: 'landing-page';
  label: string;
  slug: string;
  headline: string;
  subhead: string;
  bullets: string[];
  trustBadge: string;
  buttonText: string;
  heroImageUrl?: string;
  // Shopify Commerce Link
  shopifyProductId?: string;
  shopifyVariantId?: string;
  shopifyProductTitle?: string;
  shopifyProductPrice?: string;
  shopifyProductImage?: string;
  discountCode?: string;
  checkoutMode?: 'direct' | 'lead-gate'; // default 'direct' (less friction)
  checkoutUrl?: string;
  // Publishing & Live Hosting
  published?: boolean;
  publishedAt?: string;
  publishedUrl?: string;
  customDomain?: string;
  customDomainVerified?: boolean;
  webhookUrl?: string;
  // Ad Tracking & Pixel Injection
  metaPixelId?: string;
  tiktokPixelId?: string;
  ga4TrackingId?: string;
  // Post-Submit Action for Lead-Gate Mode
  postSubmitAction?: 'redirect_checkout' | 'modal_voucher' | 'custom_url';
  customRedirectUrl?: string;
  // Order Bump / Add-on Offer (AOV Booster)
  orderBumpEnabled?: boolean;
  orderBumpProductId?: string;
  orderBumpVariantId?: string;
  orderBumpTitle?: string;
  orderBumpPrice?: string;
  orderBumpImage?: string;
  orderBumpHeadline?: string;
  orderBumpDescription?: string;
  // Wave 4: A/B Split Testing & Traffic Routing
  abTestingEnabled?: boolean;
  splitRatio?: number; // e.g. 50 (meaning 50% A, 50% B)
  variantB?: PageVariantData;
  variantAVisitors?: number;
  variantAConversions?: number;
  variantAGrossRevenue?: number;
  variantBVisitors?: number;
  variantBConversions?: number;
  variantBGrossRevenue?: number;
  // Wave 4: Urgency & Scarcity Boosters
  urgencyTimerEnabled?: boolean;
  urgencyMinutes?: number;
  urgencyText?: string;
  scarcityBatchEnabled?: boolean;
  scarcityBatchCount?: number;
  scarcityBatchText?: string;
  // Wave 4: Post-Submit Experience
  postSubmitExperience?: 'direct_checkout' | 'vip_voucher_modal';
  // Metrics & Financials (Wave 3)
  visitors: number;
  conversions: number;
  conversionRate: number;
  grossRevenue?: number;
  orderBumpRevenue?: number;
  orderBumpTakes?: number;
  bumpTakeRate?: number;
  aov?: number;
}

export interface PageVariantData {
  headline?: string;
  subhead?: string;
  bullets?: string[];
  buttonText?: string;
  heroImageUrl?: string;
  discountCode?: string;
  trustBadge?: string;
  visitors?: number;
  conversions?: number;
  conversionRate?: number;
  grossRevenue?: number;
}

export interface PublicPublishedPage {
  slug: string;
  journeyId: string;
  workspaceId: string;
  nodeId: string;
  publishedAt: string;
  data: PageNodeData;
  shopifyConfig?: ShopifyConfig;
  customDomain?: string;
}

export type CanvasViewMode = 'edit' | 'roas';

export interface FormFieldConfig {
  id: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'textarea';
  required: boolean;
  enabled: boolean;
  placeholder?: string;
}

export interface FormNodeData extends Record<string, unknown> {
  type: 'lead-form';
  label: string;
  formTitle: string;
  submitButtonText: string;
  successMessage: string;
  fields: FormFieldConfig[];
  redirectUrl?: string;
  notifyEmail?: string;
  // Metrics
  views: number;
  submissions: number;
  completionRate: number;
}

export interface SequenceStep {
  id: string;
  channel: 'email' | 'sms';
  delay: string; // e.g. "Instant", "24 hours", "3 days"
  subject: string;
  previewText?: string;
  body: string;
}

export interface SequenceNodeData extends Record<string, unknown> {
  type: 'follow-up-sequence';
  label: string;
  sequenceTitle: string;
  steps: SequenceStep[];
  hubFlowId?: string;
  exportFormat?: 'hub' | 'klaviyo' | 'shopify-email';
  // Metrics
  contactsEnrolled: number;
  avgOpenRate: number;
  avgClickRate: number;
}

export type JourneyNodeData = AdNodeData | PageNodeData | FormNodeData | SequenceNodeData;

export type JourneyNode = Node<JourneyNodeData, NodeType>;

export interface ConversionEdgeData extends Record<string, unknown> {
  sourceThroughput: number;
  targetCount: number;
  rate: number;
  dropOffAlert?: boolean;
}

export type JourneyEdge = Edge<ConversionEdgeData>;

export interface JourneyProject {
  id: string;
  name: string;
  businessType: string;
  offerHeadline: string;
  goal: string;
  workspaceId?: string;
  shopifyStoreDomain?: string;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  updatedAt: string;
}

