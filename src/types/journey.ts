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
  // Metrics
  visitors: number;
  conversions: number;
  conversionRate: number;
}

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
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  updatedAt: string;
}
