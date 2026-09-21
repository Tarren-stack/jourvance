import React, { useState, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { JourneyProject, JourneyNode, JourneyEdge, JourneyNodeData, NodeType } from './types/journey';
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
import { auth, onAuthStateChanged, logOut, type User } from './lib/firebase';

export const App: React.FC = () => {
  const [project, setProject] = useState<JourneyProject>(() => loadCurrentJourney());
  const [activePage, setActivePage] = useState<'home' | 'about' | 'blog' | 'contact' | 'canvas'>('home');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  
  // Modals & Authentication
  const [user, setUser] = useState<User | null>(null);
  const [showLiveModal, setShowLiveModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [showOperatorDashboard, setShowOperatorDashboard] = useState(false);
  
  const [saving, setSaving] = useState(false);
  const [savedRecently, setSavedRecently] = useState(false);

  // Monitor Firebase Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, u => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

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
      const userId = user?.uid || 'anonymous';
      await fetch(`/api/user/${userId}/journey/${project.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project)
      }).catch(() => {});
      
      setSavedRecently(true);
      setTimeout(() => setSavedRecently(false), 2500);
    } finally {
      setSaving(false);
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
            onAddNode={handleAddNode}
            onOpenWebsite={() => setActivePage('home')}
            user={user}
            onOpenAuth={() => setShowAuthModal(true)}
            onOpenBilling={() => setShowBillingModal(true)}
            onOpenAdmin={() => setShowOperatorDashboard(true)}
            onSignOut={() => logOut()}
            saving={saving}
            savedRecently={savedRecently}
          />

          {/* Main Interactive Canvas Area */}
          <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <ReactFlowProvider>
              <JourneyCanvas
                nodes={project.nodes}
                edges={project.edges}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                selectedNodeId={selectedNodeId}
                onSelectNode={node => setSelectedNodeId(node ? node.id : null)}
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
            />
          </main>
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
    </div>
  );
};
export default App;
