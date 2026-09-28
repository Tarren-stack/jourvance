import React, { useState, useEffect, Suspense, lazy, useMemo, useCallback } from 'react';
import type { JourneyProject, JourneyNode, JourneyEdge, JourneyNodeData, NodeType, Workspace, CanvasViewMode, ActiveAppView } from './types/journey';
import { loadCurrentJourney, saveCurrentJourney } from './lib/journeyStorage';
import { applyLiveStats } from './lib/liveStats';
import { CanvasHeader } from './components/toolbar/CanvasHeader';
import { PublicHeader } from './components/public/PublicHeader';
import { PublicFooter } from './components/public/PublicFooter';
import { HomePage } from './components/public/HomePage';
import { AboutPage } from './components/public/AboutPage';
import { BlogPage } from './components/public/BlogPage';
import { ContactPage } from './components/public/ContactPage';
import { fetchWorkspaces, createWorkspace } from './lib/shopifyClient';
import { auth, onAuthStateChanged, logOut, authHeaders, type User } from './lib/firebase';
import type { PageNodeData, FunnelForecast } from './types/journey';
import type { PublishedPageInfo } from './components/preview/PublishModal';
import { injectRetentionFlows, DEFAULT_FORECAST } from './lib/funnelForecaster';
import { auditFunnel } from './lib/funnelAuditor';

// Code-split heavy interior app and modal bundles to ensure sub-second public page loads
const JourneyCanvas = lazy(() => import('./components/canvas/JourneyCanvas').then(m => ({ default: m.JourneyCanvas })));
const NodeInspector = lazy(() => import('./components/drawers/NodeInspector').then(m => ({ default: m.NodeInspector })));
const EdgeInspector = lazy(() => import('./components/drawers/EdgeInspector').then(m => ({ default: m.EdgeInspector })));
const HubEmailSuite = lazy(() => import('./components/campaign/HubEmailSuite').then(m => ({ default: m.HubEmailSuite })));
const AttributionReports = lazy(() => import('./components/analytics/AttributionReports').then(m => ({ default: m.AttributionReports })));
const FinancialSimulatorDrawer = lazy(() => import('./components/drawers/FinancialSimulatorDrawer').then(m => ({ default: m.FinancialSimulatorDrawer })));
const PreFlightAuditDrawer = lazy(() => import('./components/drawers/PreFlightAuditDrawer').then(m => ({ default: m.PreFlightAuditDrawer })));
const OperatorDashboard = lazy(() => import('./components/admin/OperatorDashboard').then(m => ({ default: m.OperatorDashboard })));
const LiveFunnelModal = lazy(() => import('./components/preview/LiveFunnelModal').then(m => ({ default: m.LiveFunnelModal })));
const ShopifyConnectModal = lazy(() => import('./components/shopify/ShopifyConnectModal').then(m => ({ default: m.ShopifyConnectModal })));
const ShopifySyncModal = lazy(() => import('./components/modals/ShopifySyncModal').then(m => ({ default: m.ShopifySyncModal })));
const AuthModal = lazy(() => import('./components/auth/AuthModal').then(m => ({ default: m.AuthModal })));
const BillingModal = lazy(() => import('./components/billing/BillingModal').then(m => ({ default: m.BillingModal })));
const ExportAssetsModal = lazy(() => import('./components/export/ExportAssetsModal').then(m => ({ default: m.ExportAssetsModal })));
const PublishModal = lazy(() => import('./components/preview/PublishModal').then(m => ({ default: m.PublishModal })));
const BlueprintModal = lazy(() => import('./components/modals/BlueprintModal').then(m => ({ default: m.BlueprintModal })));
const SaveBlueprintModal = lazy(() => import('./components/modals/SaveBlueprintModal').then(m => ({ default: m.SaveBlueprintModal })));

const SuspenseLoader: React.FC<{ label?: string }> = ({ label = 'Loading studio...' }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    width: '100%',
    minHeight: '260px',
    color: '#94a3b8',
    fontSize: '13px',
    gap: '10px'
  }}>
    <div style={{
      width: '16px',
      height: '16px',
      border: '2px solid rgba(255, 255, 255, 0.15)',
      borderTopColor: '#f43f5e',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite'
    }} />
    <span>{label}</span>
  </div>
);

export const App: React.FC = () => {
  const [project, setProject] = useState<JourneyProject>(() => loadCurrentJourney());
  const [activePage, setActivePage] = useState<'home' | 'about' | 'blog' | 'contact' | 'canvas'>(() => {
    if (typeof window === 'undefined') return 'home';
    const path = window.location.pathname.replace(/^\//, '').toLowerCase();
    if (path === 'about' || path === 'blog' || path === 'contact' || path === 'canvas') {
      return path;
    }
    return 'home';
  });

  useEffect(() => {
    const targetPath = activePage === 'home' ? '/' : `/${activePage}`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ page: activePage }, '', targetPath);
    }
  }, [activePage]);

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.replace(/^\//, '').toLowerCase();
      if (path === 'about' || path === 'blog' || path === 'contact' || path === 'canvas') {
        setActivePage(path);
      } else {
        setActivePage('home');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const selectedEdge = useMemo(() => {
    return project.edges.find(e => e.id === selectedEdgeId) || null;
  }, [project.edges, selectedEdgeId]);

  const edgeSourceNode = useMemo(() => {
    if (!selectedEdge) return null;
    return project.nodes.find(n => n.id === selectedEdge.source) || null;
  }, [project.nodes, selectedEdge]);

  const edgeTargetNode = useMemo(() => {
    if (!selectedEdge) return null;
    return project.nodes.find(n => n.id === selectedEdge.target) || null;
  }, [project.nodes, selectedEdge]);

  const handleDeleteEdge = useCallback((edgeId: string) => {
    setProject(prev => {
      const nextEdges = prev.edges.filter(e => e.id !== edgeId);
      return { ...prev, edges: nextEdges, updatedAt: new Date().toISOString() };
    });
    setSelectedEdgeId(null);
  }, []);
  
  // Workspace & Multi-Tenancy (1 Shopify Store Per Workspace)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [showShopifyModal, setShowShopifyModal] = useState(false);
  const [showShopifySyncModal, setShowShopifySyncModal] = useState(false);
  const [activeView, setActiveView] = useState<ActiveAppView>('canvas');
  const [canvasViewMode, setCanvasViewMode] = useState<CanvasViewMode>('edit');
  const [showRetentionBranches, setShowRetentionBranches] = useState<boolean>(true);

  // Modals & Authentication
  const [user, setUser] = useState<User | null>(null);
  const [showLiveModal, setShowLiveModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [showOperatorDashboard, setShowOperatorDashboard] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showBlueprintModal, setShowBlueprintModal] = useState(false);
  const [showSaveBlueprintModal, setShowSaveBlueprintModal] = useState(false);
  const [blueprintModalTab, setBlueprintModalTab] = useState<'turnkey' | 'custom' | 'import'>('turnkey');
  const [blueprintImportCode, setBlueprintImportCode] = useState<string>('');
  const [showSimulatorDrawer, setShowSimulatorDrawer] = useState(false);
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedPages, setPublishedPages] = useState<PublishedPageInfo[]>([]);
  const [unpublishing, setUnpublishing] = useState(false);
  
  const [saving, setSaving] = useState(false);
  const [savedRecently, setSavedRecently] = useState(false);

  // Deep-link listener for ?import_blueprint=...
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const importCode = params.get('import_blueprint');
      if (importCode) {
        setBlueprintImportCode(importCode);
        setBlueprintModalTab('import');
        setShowBlueprintModal(true);
        setActivePage('canvas');
        setActiveView('canvas');
      }
    } catch (err) {
      console.warn('[Jourvance] Failed parsing import_blueprint param:', err);
    }
  }, []);

  // Load Workspaces
  useEffect(() => {
    let cancelled = false;
    fetchWorkspaces().then(wsList => {
      if (cancelled || !wsList.length) return;
      setWorkspaces(wsList);
      setCurrentWorkspace(prev => prev || wsList[0]);
    });
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Monitor Firebase Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, u => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  // Load the server copy on sign-in. Saves used to be write-only: nothing ever read a journey
  // back, so signing in on a second device showed the default blueprint, and the next save
  // replaced the stored journey with it. The server copy wins only when it is strictly NEWER
  // than what this browser holds, so unsaved local edits are never thrown away.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/journey/${encodeURIComponent(project.id)}`, { headers: await authHeaders() });
        const data = await res.json().catch(() => ({}));
        const remote = data?.success ? data.journey : null;
        if (cancelled || !remote || !Array.isArray(remote.nodes) || !Array.isArray(remote.edges)) return;
        setProject(p => (String(remote.updatedAt) > String(p.updatedAt)
          ? {
              ...p,
              name: remote.name || p.name,
              businessType: remote.businessType || p.businessType,
              offerHeadline: remote.offerHeadline || p.offerHeadline,
              goal: remote.goal || p.goal,
              workspaceId: remote.workspaceId || p.workspaceId,
              shopifyStoreDomain: remote.shopifyStoreDomain || p.shopifyStoreDomain,
              forecast: remote.forecast || p.forecast,
              nodes: remote.nodes,
              edges: remote.edges,
              updatedAt: remote.updatedAt
            }
          : p));
      } catch { /* offline or signed out mid-flight: the local copy stands */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Auto-save changes locally
  useEffect(() => {
    saveCurrentJourney(project);
  }, [project]);

  // Measured counts come from the event log. The effect depends on the journey's shape,
  // not on the counts themselves, so applying a result does not schedule another fetch.
  const statsShape = `${project.id}:${project.nodes.map(n => `${n.id}:${(n.data as { spend?: number }).spend || 0}:${(n.data as { jourvanceFlowId?: string }).jourvanceFlowId || ''}`).join(',')}:${project.edges.map(e => e.id).join(',')}`;
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
        const res = await fetch('/api/funnel/stats', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            journeyId: project.id,
            nodes: project.nodes.map(n => ({
              id: n.id,
              type: n.type,
              slug: (n.data as { slug?: string }).slug || '',
              utmCampaign: (n.data as { utmCampaign?: string }).utmCampaign || '',
              offerType: (n.data as { offerType?: string }).offerType || '',
              spend: (n.data as { spend?: number }).spend || 0,
              jourvanceFlowId: (n.data as { jourvanceFlowId?: string }).jourvanceFlowId || ''
            })),
            edges: project.edges.map(e => ({ id: e.id, source: e.source, target: e.target }))
          })
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (cancelled || !data?.success || !data.stats) return;
        setProject(p => applyLiveStats(p, data.stats));
      } catch { /* offline: the canvas keeps the last real counts */ }
    };
    pull();
    const timer = window.setInterval(pull, 20000);
    return () => { cancelled = true; window.clearInterval(timer); };
    // project.id/nodes/edges are read from the render that matches statsShape
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, statsShape]);

  const selectedNode = project.nodes.find(n => n.id === selectedNodeId) || null;

  const handleUpdateProjectName = (name: string) => {
    setProject(p => ({ ...p, name }));
  };

  const handleNodesChange = (nodes: JourneyNode[]) => {
    setProject(p => ({ ...p, nodes, updatedAt: new Date().toISOString() }));
  };

  const handleEdgesChange = (edges: JourneyEdge[]) => {
    setProject(p => ({ ...p, edges, updatedAt: new Date().toISOString() }));
  };

  const handleUpdateNode = (nodeId: string, data: JourneyNodeData) => {
    setProject(p => ({
      ...p,
      nodes: p.nodes.map(n => (n.id === nodeId ? { ...n, data } : n)),
      updatedAt: new Date().toISOString()
    }));
  };

  const handleDeleteNode = (nodeId: string) => {
    setProject(p => ({
      ...p,
      nodes: p.nodes.filter(n => n.id !== nodeId),
      edges: p.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
      updatedAt: new Date().toISOString()
    }));
    setSelectedNodeId(null);
  };

  const handleAddNode = (type: NodeType) => {
    const id = `node-${type}-${Date.now().toString(36)}`;
    const xOffset = (project.nodes.length * 280) % 1200 + 100;
    const yOffset = 180 + (project.nodes.length % 2 === 0 ? 0 : 40);

    let newNodeData: JourneyNodeData;

    switch (type) {
      case 'ad-source':
        newNodeData = {
          type: 'ad-source',
          label: 'New Ad Campaign',
          platform: 'meta',
          headline: 'Your ad headline',
          body: 'Describe the offer in words you can stand behind.',
          ctaText: 'Learn More',
          utmCampaign: 'promo-blast',
          impressions: 0,
          clicks: 0,
          ctr: 0,
          spend: 0
        };
        break;
      case 'landing-page':
        newNodeData = {
          type: 'landing-page',
          label: 'Promotion Landing Page',
          slug: `offer-${Date.now().toString(36)}`,
          headline: 'Your offer headline',
          subhead: 'Describe what the visitor gets.',
          bullets: ['First point you can stand behind', 'Second point you can stand behind'],
          trustBadge: '',
          buttonText: 'Claim Offer',
          visitors: 0,
          conversions: 0,
          conversionRate: 0
        };
        break;
      case 'lead-form':
        newNodeData = {
          type: 'lead-form',
          label: 'Consultation Form',
          formTitle: 'Enter your details to reserve your consultation',
          submitButtonText: 'Confirm Reservation',
          successMessage: 'We received your reservation! Check your email for details.',
          fields: [
            { id: 'f_name', label: 'Full Name', type: 'text', required: true, enabled: true, placeholder: 'Alex Smith' },
            { id: 'f_email', label: 'Email Address', type: 'email', required: true, enabled: true, placeholder: 'alex@example.com' },
            { id: 'f_phone', label: 'Phone Number', type: 'tel', required: true, enabled: true, placeholder: '(555) 123-4567' }
          ],
          views: 0,
          submissions: 0,
          completionRate: 0
        };
        break;
      case 'follow-up-sequence':
        newNodeData = {
          type: 'follow-up-sequence',
          label: 'Client Welcome Flow',
          sequenceTitle: 'Automated Follow-Up',
          contactsEnrolled: 0,
          avgOpenRate: 0,
          avgClickRate: 0,
          steps: [
            {
              id: `step-1`,
              channel: 'email',
              delay: 'Instant (0m)',
              subject: 'Your confirmation and VIP welcome guide',
              body: 'Hi [First Name],\n\nThank you for reaching out! We are excited to connect with you.\n\nBest,\nThe Team'
            }
          ]
        };
        break;
      case 'thank-you':
        newNodeData = {
          type: 'thank-you',
          label: 'VIP Order Confirmation',
          slug: 'thank-you',
          headline: 'Your VIP Allocation & Order is Confirmed',
          subhead: 'Thank you for your order! Your confirmation and receipt have been emailed to you.',
          badgeText: 'VIP Member Privilege',
          bounceBackDiscountCode: 'VIPRETURN',
          bounceBackDiscountText: '$15 Off Your Next Order',
          usageGuideTitle: 'The 3-Step Quick Start Onboarding Guide',
          usageGuideSteps: [
            'Review your order receipt and welcome guide in your inbox.',
            'Follow the setup steps or initial instructions for maximum results.',
            'Reach out to our dedicated concierge support if you have any questions.'
          ],
          storeReturnText: 'Explore More Best-Sellers & Add-Ons',
          communityInviteText: 'Join Our Private VIP Customer Community',
          pageViews: 0,
          bounceBackClaims: 0
        };
        break;
      case 'upsell':
        newNodeData = {
          type: 'upsell',
          label: 'Post-Purchase Upsell (OTO)',
          offerType: 'upsell',
          headline: 'Special VIP Allocation: Complete Your Routine with 40% Off',
          subhead: 'Your initial parcel is reserved! Add our triple-action replenishment reserve before order dispatch.',
          badgeText: 'SAVE 40% VIP OFFER',
          urgencyMinutes: 5,
          productTitle: 'Bioactive Triple Barrier Replenishment Reserve',
          productPrice: '$38.00',
          regularPrice: '$64.00',
          discountPercentage: 40,
          discountCode: 'VIPOTO40',
          productImage: 'https://images.unsplash.com/photo-1601049541289-9b1b7bbbfe19?auto=format&fit=crop&w=600&q=80',
          benefits: [
            'Direct batch allocation from master cosmetic formulation',
            'Full 90-day cellular renewal supply',
            'Includes free complimentary expedited priority shipping'
          ],
          acceptButtonText: '⚡ Yes, Upgrade My Order (1-Tap Checkout)',
          declineButtonText: 'No thanks, continue to my order confirmation',
          views: 0,
          takes: 0,
          conversionRate: 0,
          attributedRevenue: 0
        };
        break;
      case 'ab-split':
        newNodeData = {
          type: 'ab-split',
          label: 'A/B Traffic Splitter',
          slug: `split-${Date.now().toString(36)}`,
          splitRatio: 50,
          goal: 'conversion_rate',
          branchALabel: 'Branch A (Control)',
          branchBLabel: 'Branch B (Challenger)',
          branchAVisitors: 0,
          branchAConversions: 0,
          branchAGrossRevenue: 0,
          branchBVisitors: 0,
          branchBConversions: 0,
          branchBGrossRevenue: 0
        };
        break;
    }

    const newNode: JourneyNode = {
      id,
      type,
      position: { x: xOffset, y: yOffset },
      data: newNodeData
    };

    setProject(p => ({
      ...p,
      nodes: [...p.nodes, newNode],
      updatedAt: new Date().toISOString()
    }));
    setSelectedNodeId(id);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      saveCurrentJourney(project);
      // Signed out, the canvas is local-only. There is no 'anonymous' tenant to save into:
      // the server derives the owner from a verified token, so a keyless POST is a 401.
      if (user) {
        const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
        await fetch(`/api/user/${user.uid}/journey/${project.id}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(project)
        }).catch(() => {});
      }
      
      setSavedRecently(true);
      setTimeout(() => setSavedRecently(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleLoadBlueprint = (
    prepared: { name: string; nodes: JourneyNode[]; edges: JourneyEdge[] },
    mode: 'replace' | 'new'
  ) => {
    if (mode === 'replace') {
      setProject(prev => ({
        ...prev,
        name: prepared.name,
        nodes: prepared.nodes,
        edges: prepared.edges,
        updatedAt: new Date().toISOString()
      }));
    } else {
      const newJourney: JourneyProject = {
        id: `journey_${Date.now()}`,
        name: prepared.name,
        businessType: project.businessType || 'E-Commerce Brand',
        offerHeadline: prepared.name,
        goal: 'High-converting Shopify customer acquisition funnel',
        workspaceId: currentWorkspace?.id,
        nodes: prepared.nodes,
        edges: prepared.edges,
        updatedAt: new Date().toISOString()
      };
      setProject(newJourney);
    }
    setActivePage('canvas');
    setActiveView('canvas');
    setSelectedNodeId(null);
  };

  const handleSyncRetentionToCanvas = (options: { addCartRecovery?: boolean; addUpsellRescue?: boolean }) => {
    setProject(prev => {
      const result = injectRetentionFlows({
        nodes: prev.nodes,
        edges: prev.edges,
        addCartRecovery: options.addCartRecovery,
        addUpsellRescue: options.addUpsellRescue,
        cartRecoveryDiscount: prev.forecast?.cartRecoveryDiscount ?? 10,
        upsellRescueDiscount: prev.forecast?.upsellRescueDiscount ?? 10
      });

      const updatedForecast: FunnelForecast = {
        ...(prev.forecast || DEFAULT_FORECAST),
        cartRecoveryEnabled: options.addCartRecovery ? true : (prev.forecast?.cartRecoveryEnabled ?? false),
        upsellRescueEnabled: options.addUpsellRescue ? true : (prev.forecast?.upsellRescueEnabled ?? false)
      };

      const updatedProject: JourneyProject = {
        ...prev,
        nodes: result.nodes,
        edges: result.edges,
        forecast: updatedForecast,
        updatedAt: new Date().toISOString()
      };

      saveCurrentJourney(updatedProject);
      return updatedProject;
    });
  };

  const handleCreateWorkspace = async () => {
    const name = prompt('Enter a name for your new Shopify workspace:');
    if (!name || !name.trim()) return;
    const res = await createWorkspace(name.trim());
    if (res.success && res.workspace) {
      setWorkspaces(prev => [...prev, res.workspace!]);
      setCurrentWorkspace(res.workspace);
    } else if (res.error?.includes('Upgrade')) {
      setShowBillingModal(true);
    } else {
      alert(res.error || 'Could not create workspace.');
    }
  };

  const handlePublishFunnel = async () => {
    // Option A: Pre-Flight Funnel Audit clearance check
    const auditReport = auditFunnel(project, currentWorkspace);
    if (auditReport.overallScore < 80 && auditReport.fixableChecks > 0) {
      const proceed = window.confirm(
        `Pre-Flight Funnel Audit: Conversion Readiness Score is ${auditReport.overallScore}/100 with ${auditReport.fixableChecks} quick revenue-protection wins available.\n\nClick Cancel to review the audit and apply 1-click fixes, or OK to publish anyway.`
      );
      if (!proceed) {
        setShowAuditDrawer(true);
        return;
      }
    }

    setPublishing(true);
    try {
      await handleSave();

      let pubPages: PublishedPageInfo[] = [];

      if (user) {
        const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
        const res = await fetch(`/api/journey/${project.id}/publish`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ workspaceId: currentWorkspace?.id })
        });
        const data = await res.json().catch(() => ({}));
        if (data.success && Array.isArray(data.publishedPages)) {
          pubPages = data.publishedPages;
        }
      }

      if (!pubPages.length) {
        pubPages = project.nodes
          .filter(n => n.type === 'landing-page' || n.type === 'ab-split')
          .map(n => {
            if (n.type === 'ab-split') {
              const d = n.data as any;
              const cleanSlug = (d.slug || n.id)
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, '-')
                .replace(/^-+|-+$/g, '') || `split-${n.id.slice(0, 6)}`;
              return {
                nodeId: n.id,
                slug: cleanSlug,
                url: `/p/split/${cleanSlug}`,
                headline: d.label || 'A/B Traffic Splitter',
                productTitle: `A/B Split (${d.splitRatio ?? 50}% / ${100 - (d.splitRatio ?? 50)}%)`,
                checkoutMode: 'ab-split'
              };
            }
            const d = n.data as PageNodeData;
            const cleanSlug = (d.slug || n.id)
              .toLowerCase()
              .replace(/[^a-z0-9_-]/g, '-')
              .replace(/^-+|-+$/g, '') || `offer-${n.id.slice(0, 6)}`;
            return {
              nodeId: n.id,
              slug: cleanSlug,
              url: `/p/${cleanSlug}`,
              customDomain: d.customDomain ? d.customDomain.toLowerCase().trim() : undefined,
              headline: d.headline,
              productTitle: d.shopifyProductTitle,
              checkoutMode: d.checkoutMode || 'direct'
            };
          });
      }

      setProject(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => {
          if (n.type === 'landing-page') {
            const pageInfo = pubPages.find(p => p.nodeId === n.id);
            return {
              ...n,
              data: {
                ...n.data,
                published: true,
                publishedAt: new Date().toISOString(),
                publishedUrl: pageInfo?.url || `/p/${(n.data as PageNodeData).slug || 'offer'}`
              }
            };
          }
          return n;
        })
      }));

      setPublishedPages(pubPages);
      setShowPublishModal(true);
    } catch (err) {
      console.error('Publish funnel failed:', err);
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublishFunnel = async () => {
    setUnpublishing(true);
    try {
      if (user) {
        const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
        await fetch(`/api/journey/${project.id}/unpublish`, {
          method: 'POST',
          headers
        }).catch(() => {});
      }
      setProject(prev => ({
        ...prev,
        nodes: prev.nodes.map(n => {
          if (n.type === 'landing-page') {
            return {
              ...n,
              data: {
                ...n.data,
                published: false
              }
            };
          }
          return n;
        })
      }));
      setShowPublishModal(false);
    } finally {
      setUnpublishing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {activePage === 'canvas' ? (
        <>
          {/* Top Canvas Header Toolbar */}
          <CanvasHeader
            project={project}
            onUpdateProjectName={handleUpdateProjectName}
            onSave={handleSave}
            onTestJourney={() => setShowLiveModal(true)}
            onExportAssets={() => setShowExportModal(true)}
            onAddNode={handleAddNode}
            onOpenWebsite={() => setActivePage('home')}
            user={user}
            onOpenAuth={() => setShowAuthModal(true)}
            onOpenBilling={() => setShowBillingModal(true)}
            onOpenAdmin={() => setShowOperatorDashboard(true)}
            onSignOut={() => logOut()}
            saving={saving}
            savedRecently={savedRecently}
            onPublishFunnel={handlePublishFunnel}
            publishing={publishing}
            workspaces={workspaces}
            currentWorkspace={currentWorkspace}
            onSelectWorkspace={ws => setCurrentWorkspace(ws)}
            onOpenShopifyConnect={() => setShowShopifyModal(true)}
            onCreateWorkspace={handleCreateWorkspace}
            activeView={activeView}
            onSelectView={setActiveView}
            onOpenBlueprints={() => {
              setBlueprintModalTab('turnkey');
              setShowBlueprintModal(true);
            }}
            onSaveBlueprint={() => setShowSaveBlueprintModal(true)}
            canvasViewMode={canvasViewMode}
            onToggleCanvasViewMode={setCanvasViewMode}
            showRetentionBranches={showRetentionBranches}
            onToggleRetentionBranches={() => setShowRetentionBranches(prev => !prev)}
            onOpenShopifySync={() => setShowShopifySyncModal(true)}
            onOpenSimulator={() => setShowSimulatorDrawer(true)}
            onOpenAudit={() => setShowAuditDrawer(true)}
            onSelectNode={nodeId => setSelectedNodeId(nodeId)}
          />

          {/* Main Area: Funnel Canvas, Email Studio, OR Attribution Reports */}
          <Suspense fallback={<SuspenseLoader label="Loading studio view..." />}>
            {activeView === 'email-studio' ? (
              <HubEmailSuite
                workspace={currentWorkspace}
                onOpenShopifyConnect={() => setShowShopifyModal(true)}
                onReturnToCanvas={() => setActiveView('canvas')}
              />
            ) : activeView === 'attribution' ? (
              <AttributionReports
                workspace={currentWorkspace}
                nodes={project.nodes}
                forecast={project.forecast}
                onOpenShopifySync={() => setShowShopifySyncModal(true)}
              />
            ) : (
              <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <JourneyCanvas
                  nodes={project.nodes}
                  edges={project.edges}
                  onNodesChange={handleNodesChange}
                  onEdgesChange={handleEdgesChange}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={node => {
                    setSelectedNodeId(node ? node.id : null);
                    if (node) setSelectedEdgeId(null);
                  }}
                  selectedEdgeId={selectedEdgeId}
                  onSelectEdge={edge => {
                    setSelectedEdgeId(edge ? edge.id : null);
                    if (edge) setSelectedNodeId(null);
                  }}
                  canvasViewMode={canvasViewMode}
                  showRetentionBranches={showRetentionBranches}
                  onToggleRetentionBranches={setShowRetentionBranches}
                />

                {/* Slide-Over Drawer Inspector */}
                <NodeInspector
                  node={selectedNode}
                  onClose={() => setSelectedNodeId(null)}
                  onUpdateNode={handleUpdateNode}
                  onDeleteNode={handleDeleteNode}
                  offerHeadline={project.offerHeadline}
                  businessType={project.businessType}
                  journeyId={project.id}
                  workspace={currentWorkspace}
                  onOpenShopifyConnect={() => setShowShopifyModal(true)}
                />

                {/* Step Transition Analytics & Leakage Drawer */}
                <EdgeInspector
                  edge={selectedEdge}
                  sourceNode={edgeSourceNode}
                  targetNode={edgeTargetNode}
                  onClose={() => setSelectedEdgeId(null)}
                  onSelectNode={nodeId => {
                    setSelectedEdgeId(null);
                    setSelectedNodeId(nodeId);
                  }}
                  onDeleteEdge={handleDeleteEdge}
                />
              </main>
            )}
          </Suspense>
        </>
      ) : (
        /* Public Marketing Web Pages */
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
          <PublicHeader
            activePage={activePage}
            onNavigate={setActivePage}
            onTestJourney={() => setShowLiveModal(true)}
            user={user}
            onOpenAuth={() => setShowAuthModal(true)}
            onOpenBilling={() => setShowBillingModal(true)}
            onOpenAdmin={() => setShowOperatorDashboard(true)}
            onSignOut={() => logOut()}
          />

          <main style={{ flex: 1 }}>
            {activePage === 'home' && (
              <HomePage
                onNavigate={setActivePage}
                onTestJourney={() => setShowLiveModal(true)}
                onOpenBilling={() => setShowBillingModal(true)}
              />
            )}
            {activePage === 'about' && (
              <AboutPage onNavigate={setActivePage} />
            )}
            {activePage === 'blog' && (
              <BlogPage onNavigate={setActivePage} />
            )}
            {activePage === 'contact' && (
              <ContactPage onNavigate={setActivePage} />
            )}
          </main>

          <PublicFooter onNavigate={setActivePage} />
        </div>
      )}

      {/* Lazy-Loaded Modals & Drawers */}
      <Suspense fallback={null}>
        {/* Live Funnel Simulation Modal */}
        {showLiveModal && (
          <LiveFunnelModal
            project={project}
            onClose={() => setShowLiveModal(false)}
          />
        )}

        {/* Shopify Connect Modal */}
        <ShopifyConnectModal
          isOpen={showShopifyModal}
          onClose={() => setShowShopifyModal(false)}
          workspace={currentWorkspace}
          onWorkspaceUpdated={updated => {
            setCurrentWorkspace(updated);
            setWorkspaces(prev => prev.map(w => (w.id === updated.id ? updated : w)));
          }}
          onOpenBilling={() => setShowBillingModal(true)}
        />

        {/* Shopify Live Attribution & Order Simulator Modal */}
        <ShopifySyncModal
          isOpen={showShopifySyncModal}
          onClose={() => setShowShopifySyncModal(false)}
          workspace={currentWorkspace}
          nodes={project.nodes}
        />

        {/* User Auth Modal */}
        {showAuthModal && (
          <AuthModal
            onClose={() => setShowAuthModal(false)}
          />
        )}

        {/* Subscription Billing Upgrade Modal */}
        {showBillingModal && (
          <BillingModal
            onClose={() => setShowBillingModal(false)}
            userEmail={user?.email || undefined}
          />
        )}

        {/* Operator Admin Dashboard */}
        {showOperatorDashboard && (
          <OperatorDashboard
            currentProject={project}
            onClose={() => setShowOperatorDashboard(false)}
            onLoadProject={p => {
              setProject(p);
              setShowOperatorDashboard(false);
            }}
          />
        )}

        {/* Production Assets Export Modal */}
        <ExportAssetsModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          nodes={project.nodes as any}
          journeyTitle={project.name}
          workspaceId={currentWorkspace?.id}
          journeyId={project.id}
        />

        {/* Funnel Publish Modal */}
        <PublishModal
          isOpen={showPublishModal}
          onClose={() => setShowPublishModal(false)}
          publishedPages={publishedPages}
          workspace={currentWorkspace}
          onUnpublish={handleUnpublishFunnel}
          unpublishing={unpublishing}
        />

        {/* Save as Reusable Blueprint Modal */}
        <SaveBlueprintModal
          isOpen={showSaveBlueprintModal}
          onClose={() => setShowSaveBlueprintModal(false)}
          nodes={project.nodes}
          edges={project.edges}
          currentJourneyName={project.name}
        />

        {/* E-Commerce Funnel Blueprints Modal */}
        <BlueprintModal
          isOpen={showBlueprintModal}
          onClose={() => {
            setShowBlueprintModal(false);
            setBlueprintImportCode('');
          }}
          onLoadBlueprint={handleLoadBlueprint}
          workspace={currentWorkspace}
          currentJourneyName={project.name}
          initialTab={blueprintModalTab}
          initialImportCode={blueprintImportCode}
        />

        {/* Funnel Financial Simulator & ROAS Forecaster (Wave 10) */}
        <FinancialSimulatorDrawer
          isOpen={showSimulatorDrawer}
          onClose={() => setShowSimulatorDrawer(false)}
          nodes={project.nodes}
          initialForecast={project.forecast}
          onSaveForecast={(forecast: FunnelForecast) => {
            setProject(prev => {
              const updated = { ...prev, forecast, updatedAt: new Date().toISOString() };
              saveCurrentJourney(updated);
              return updated;
            });
          }}
          onSyncRetentionToCanvas={handleSyncRetentionToCanvas}
        />

        {/* Pre-Flight Conversion Audit & Readiness Inspector */}
        <PreFlightAuditDrawer
          isOpen={showAuditDrawer}
          onClose={() => setShowAuditDrawer(false)}
          project={project}
          workspace={currentWorkspace}
          onUpdateProject={(updated) => {
            setProject(updated);
            saveCurrentJourney(updated);
          }}
          onOpenPublish={() => {
            setShowAuditDrawer(false);
            handlePublishFunnel();
          }}
          onSelectNode={(nodeId) => {
            setSelectedNodeId(nodeId);
          }}
        />
      </Suspense>
    </div>
  );
};
export default App;
