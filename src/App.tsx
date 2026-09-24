import React, { useState, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { JourneyProject, JourneyNode, JourneyEdge, JourneyNodeData, NodeType, Workspace, CanvasViewMode, ActiveAppView } from './types/journey';
import { loadCurrentJourney, saveCurrentJourney } from './lib/journeyStorage';
import { CanvasHeader } from './components/toolbar/CanvasHeader';
import { JourneyCanvas } from './components/canvas/JourneyCanvas';
import { NodeInspector } from './components/drawers/NodeInspector';
import { LiveFunnelModal } from './components/preview/LiveFunnelModal';
import { PublicHeader } from './components/public/PublicHeader';
import { PublicFooter } from './components/public/PublicFooter';
import { HomePage } from './components/public/HomePage';
import { AboutPage } from './components/public/AboutPage';
import { BlogPage } from './components/public/BlogPage';
import { ContactPage } from './components/public/ContactPage';
import { AuthModal } from './components/auth/AuthModal';
import { BillingModal } from './components/billing/BillingModal';
import { OperatorDashboard } from './components/admin/OperatorDashboard';
import { ExportAssetsModal } from './components/export/ExportAssetsModal';
import { ShopifyConnectModal } from './components/shopify/ShopifyConnectModal';
import { ShopifySyncModal } from './components/modals/ShopifySyncModal';
import { HubEmailSuite } from './components/campaign/HubEmailSuite';
import { AttributionReports } from './components/analytics/AttributionReports';
import { PublishModal, type PublishedPageInfo } from './components/preview/PublishModal';
import { BlueprintModal } from './components/modals/BlueprintModal';
import { fetchWorkspaces, createWorkspace } from './lib/shopifyClient';
import { auth, onAuthStateChanged, logOut, authHeaders, type User } from './lib/firebase';
import type { PageNodeData } from './types/journey';

export const App: React.FC = () => {
  const [project, setProject] = useState<JourneyProject>(() => loadCurrentJourney());
  const [activePage, setActivePage] = useState<'home' | 'about' | 'blog' | 'contact' | 'canvas'>('home');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  
  // Workspace & Multi-Tenancy (1 Shopify Store Per Workspace)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [showShopifyModal, setShowShopifyModal] = useState(false);
  const [showShopifySyncModal, setShowShopifySyncModal] = useState(false);
  const [activeView, setActiveView] = useState<ActiveAppView>('canvas');
  const [canvasViewMode, setCanvasViewMode] = useState<CanvasViewMode>('edit');

  // Modals & Authentication
  const [user, setUser] = useState<User | null>(null);
  const [showLiveModal, setShowLiveModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [showOperatorDashboard, setShowOperatorDashboard] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showBlueprintModal, setShowBlueprintModal] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedPages, setPublishedPages] = useState<PublishedPageInfo[]>([]);
  const [unpublishing, setUnpublishing] = useState(false);
  
  const [saving, setSaving] = useState(false);
  const [savedRecently, setSavedRecently] = useState(false);

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
          headline: 'Claim Your Special Offer',
          body: 'Discover our proven service designed for you.',
          ctaText: 'Learn More',
          utmCampaign: 'promo-blast',
          impressions: 1200,
          clicks: 120,
          ctr: 10.0,
          spend: 60
        };
        break;
      case 'landing-page':
        newNodeData = {
          type: 'landing-page',
          label: 'Promotion Landing Page',
          slug: `offer-${Date.now().toString(36)}`,
          headline: 'High-Impact Results For Your Business',
          subhead: 'Guaranteed quality and personalized support.',
          bullets: ['Fast and reliable turnaround', '100% satisfaction guarantee'],
          trustBadge: 'Rated 4.9/5 stars by verified clients',
          buttonText: 'Claim Offer',
          visitors: 120,
          conversions: 30,
          conversionRate: 25.0
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
          views: 30,
          submissions: 18,
          completionRate: 60.0
        };
        break;
      case 'follow-up-sequence':
        newNodeData = {
          type: 'follow-up-sequence',
          label: 'Client Welcome Flow',
          sequenceTitle: 'Automated Follow-Up',
          contactsEnrolled: 18,
          avgOpenRate: 68.0,
          avgClickRate: 32.0,
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
          subhead: 'Thank you for choosing our bioactive formulation ritual. Your parcel is currently being prepared with care.',
          badgeText: 'VIP Member Privilege',
          bounceBackDiscountCode: 'VIPRETURN',
          bounceBackDiscountText: '$15 Off Your Next Renewal Formulation',
          usageGuideTitle: 'The 3-Step Botanical Ritual Guide',
          usageGuideSteps: [
            'Cleanse with warm botanical water to prime cellular barrier.',
            'Warm 3–4 drops between fingertips to activate bioactive peptides.',
            'Press gently into face, neck, and decolletage morning and evening.'
          ],
          storeReturnText: 'Browse Complimentary Formulations',
          communityInviteText: 'Join The Private VIP Beauty Circle',
          pageViews: 18,
          bounceBackClaims: 4
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
          views: 184,
          takes: 46,
          conversionRate: 25.0,
          attributedRevenue: 1748.00
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
          .filter(n => n.type === 'landing-page')
          .map(n => {
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
            onOpenBlueprints={() => setShowBlueprintModal(true)}
            canvasViewMode={canvasViewMode}
            onToggleCanvasViewMode={setCanvasViewMode}
            onOpenShopifySync={() => setShowShopifySyncModal(true)}
          />

          {/* Main Area: Funnel Canvas, Email Studio, OR Attribution Reports */}
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
              onOpenShopifySync={() => setShowShopifySyncModal(true)}
            />
          ) : (
            <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <ReactFlowProvider>
                <JourneyCanvas
                  nodes={project.nodes}
                  edges={project.edges}
                  onNodesChange={handleNodesChange}
                  onEdgesChange={handleEdgesChange}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={node => setSelectedNodeId(node ? node.id : null)}
                  canvasViewMode={canvasViewMode}
                />
              </ReactFlowProvider>

              {/* Slide-Over Drawer Inspector */}
              <NodeInspector
                node={selectedNode}
                onClose={() => setSelectedNodeId(null)}
                onUpdateNode={handleUpdateNode}
                onDeleteNode={handleDeleteNode}
                offerHeadline={project.offerHeadline}
                businessType={project.businessType}
                workspace={currentWorkspace}
                onOpenShopifyConnect={() => setShowShopifyModal(true)}
              />
            </main>
          )}
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
        onOrderSimulated={result => {
          if (result && result.nodeId) {
            setProject(prev => ({
              ...prev,
              nodes: prev.nodes.map(n => {
                if (n.id === result.nodeId) {
                  const data = n.data as any;
                  return {
                    ...n,
                    data: {
                      ...data,
                      liveRevenue: (data.liveRevenue || 0) + (result.amount || 0),
                      liveOrders: (data.liveOrders || 0) + 1,
                      liveBumpOrders: (data.liveBumpOrders || 0) + (result.bumpIncluded ? 1 : 0)
                    }
                  };
                }
                return n;
              })
            }));
          }
        }}
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

      {/* E-Commerce Funnel Blueprints Modal */}
      <BlueprintModal
        isOpen={showBlueprintModal}
        onClose={() => setShowBlueprintModal(false)}
        onLoadBlueprint={handleLoadBlueprint}
        workspace={currentWorkspace}
        currentJourneyName={project.name}
      />
    </div>
  );
};
export default App;
