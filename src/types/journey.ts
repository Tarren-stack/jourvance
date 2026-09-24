import type { Node, Edge } from '@xyflow/react';

export type NodeType = 'ad-source' | 'landing-page' | 'lead-form' | 'follow-up-sequence' | 'thank-you' | 'upsell';

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
  customerCount?: number;
  ordersCount?: number;
  lastSyncedAt?: string;
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
  // Wave 5: Exit-Intent Conversion Rescue
  exitIntentEnabled?: boolean;
  exitIntentHeadline?: string;
  exitIntentSubhead?: string;
  exitIntentDiscountCode?: string;
  exitIntentButtonText?: string;
  exitIntentBadge?: string;
  // Metrics & Financials (Wave 3 & Wave 6 Live Closed Loop)
  visitors: number;
  conversions: number;
  conversionRate: number;
  grossRevenue?: number;
  orderBumpRevenue?: number;
  orderBumpTakes?: number;
  bumpTakeRate?: number;
  aov?: number;
  liveRevenue?: number;
  liveOrders?: number;
  liveBumpOrders?: number;
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

export interface ThankYouNodeData extends Record<string, unknown> {
  type: 'thank-you';
  label: string;
  slug?: string;
  headline: string;
  subhead: string;
  badgeText?: string;
  bounceBackDiscountCode?: string;
  bounceBackDiscountText?: string;
  usageGuideTitle?: string;
  usageGuideSteps?: string[];
  communityInviteUrl?: string;
  communityInviteText?: string;
  storeReturnUrl?: string;
  storeReturnText?: string;
  // Metrics
  pageViews?: number;
  bounceBackClaims?: number;
}

export interface UpsellNodeData extends Record<string, unknown> {
  type: 'upsell';
  label: string;
  slug?: string;
  offerType: 'upsell' | 'downsell';
  headline: string;
  subhead: string;
  badgeText?: string;
  urgencyMinutes?: number;
  // Product info
  shopifyProductId?: string;
  shopifyVariantId?: string;
  productTitle?: string;
  productPrice?: string;
  regularPrice?: string;
  discountPercentage?: number;
  discountCode?: string;
  productImage?: string;
  benefits?: string[];
  // Actions
  acceptButtonText?: string;
  declineButtonText?: string;
  downsellSlug?: string;
  // Telemetry
  views?: number;
  takes?: number;
  conversionRate?: number;
  attributedRevenue?: number;
}

export type JourneyNodeData = AdNodeData | PageNodeData | FormNodeData | SequenceNodeData | ThankYouNodeData | UpsellNodeData;

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
  forecast?: FunnelForecast;
}

// ── Wave 10: Interactive Funnel Financial Simulator & ROAS Forecaster ───────────

export interface FunnelForecast {
  monthlyAdSpend: number;
  cpc: number;
  conversionRate: number; // percentage (e.g. 2.8)
  corePrice: number;
  cogsPercentage: number; // percentage (e.g. 20)
  bumpTakeRate: number; // percentage (e.g. 28)
  bumpPrice: number;
  upsellTakeRate: number; // percentage (e.g. 22)
  upsellPrice: number;
  savedAt?: string;
}

export interface FunnelSimulationResults {
  totalClicks: number;
  frontEndOrders: number;
  bumpSales: number;
  upsellSales: number;
  coreRevenue: number;
  bumpRevenue: number;
  upsellRevenue: number;
  grossRevenue: number;
  effectiveAov: number;
  baseAov: number;
  aovLift: number;
  estimatedCogs: number;
  netProfit: number;
  blendedRoas: number;
  breakevenCac: number;
  projectedCac: number;
  profitBuffer: number;
  breakevenCvr: number;
  cvrBuffer: number;
  isProfitable: boolean;
  leverage5PctUpsellRevenue: number;
  leverage5PctUpsellProfit: number;
}

// ── Wave 6: Unified Customer, Order & Campaign CRM Models ──────────────────────

export interface CustomerRecord {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  totalSpent: number;
  ordersCount: number;
  acceptsMarketing: boolean;
  tags: string[];
  source?: string;
  firstSeenAt?: string;
  lastOrderAt?: string;
  shopifyCustomerId?: string;
}

export interface ShopifyOrderItem {
  title: string;
  variantId?: string;
  quantity: number;
  price: number;
}

export interface ShopifyOrder {
  id: string;
  orderNumber?: string;
  totalPrice: number;
  subtotalPrice?: number;
  currency: string;
  customerEmail: string;
  customerName?: string;
  discountCode?: string;
  lineItems: ShopifyOrderItem[];
  orderBumpIncluded?: boolean;
  attributedNodeId?: string;
  attributedSlug?: string;
  attributedAdId?: string;
  createdAt: string;
}

export interface AudienceSegment {
  id: string;
  name: string;
  description: string;
  count: number;
  filterKey: 'all' | 'buyers' | 'vip' | 'repeat' | 'leads' | 'exit_rescue';
}

export interface EmailCampaign {
  id: string;
  subject: string;
  previewText?: string;
  body: string;
  segment: string;
  segmentName: string;
  recipients: number;
  sentAt: string;
  openRate: number;
  clickRate: number;
  attributedSales: number;
  sendMode: 'direct' | 'shopify_push';
  shopifyTagApplied?: string;
}

// ── Wave 7: Automated Lead Nurture Drips & Multi-Channel Attribution Models ──

export type ActiveAppView = 'canvas' | 'email-studio' | 'attribution';

export interface DripStep {
  id: string;
  stepNumber: number;
  delayHours: number; // e.g. 0 (immediate), 24, 48, 72
  subject: string;
  previewText?: string;
  body: string;
  discountVoucher?: string;
}

export interface DripSequence {
  id: string;
  name: string;
  description: string;
  triggerType: 'lead_capture' | 'exit_intent' | 'abandoned_cart' | 'manual';
  smartExitOnPurchase: boolean; // exits automatically when order is attributed
  steps: DripStep[];
  activeEnrollments: number;
  totalCompleted: number;
  totalExitedPurchased: number;
  attributedSales: number;
  createdAt: string;
  updatedAt: string;
}

export interface DripEnrollment {
  id: string;
  sequenceId: string;
  customerEmail: string;
  customerName?: string;
  sourceSlug?: string;
  currentStepIndex: number;
  status: 'active' | 'completed' | 'converted_exit';
  enrolledAt: string;
  nextStepDueAt: string;
  lastStepSentAt?: string;
  convertedAt?: string;
  history: Array<{
    stepNumber: number;
    subject: string;
    sentAt: string;
    status: 'delivered' | 'bounced';
  }>;
}

export type AttributionModelType = 'first_touch' | 'last_touch' | 'linear';

export interface ChannelAttribution {
  channelId: string;
  channelName: string;
  iconName: 'meta' | 'google' | 'tiktok' | 'email' | 'direct';
  spend: number;
  clicks: number;
  leads: number;
  orders: number;
  revenue: number;
  roas: number;
  cac: number;
  conversionRate: number;
}

export interface FunnelDropoffStep {
  id: string;
  name: string;
  count: number;
  percentage: number;
  dropoffRate: number;
}

export interface AttributionReport {
  timeframe: '7d' | '30d' | 'all';
  model: AttributionModelType;
  summary: {
    totalRevenue: number;
    totalSpend: number;
    blendedRoas: number;
    blendedCac: number;
    blendedAov: number;
    totalOrders: number;
    totalLeads: number;
    repeatBuyerRate: number;
    netProfit: number;
  };
  channels: ChannelAttribution[];
  funnelSteps: FunnelDropoffStep[];
  recentAttributions: Array<{
    orderId: string;
    orderNumber: string;
    amount: number;
    customerEmail: string;
    channel: string;
    touchpointCount: number;
    createdAt: string;
  }>;
}

export interface ShopifyDiscountRule {
  id: string;
  code: string;
  discountType: 'percentage' | 'fixed_amount';
  value: number;
  usageLimit?: number | null;
  isUniquePerLead: boolean;
  shopifyPriceRuleId?: string;
  createdAt: string;
  status: 'active' | 'expired';
}

export interface ShopifyAbandonedCheckout {
  id: string;
  token: string;
  customerEmail: string;
  customerName?: string;
  totalPrice: number;
  currency: string;
  lineItems: Array<{ title: string; quantity: number; price: number }>;
  abandonedCheckoutUrl: string;
  abandonedAt: string;
  recoveryStatus: 'pending' | 'email_sent' | 'recovered' | 'expired';
  recoveryEmailSentAt?: string;
  recoveredAt?: string;
  recoveredOrderId?: string;
}
