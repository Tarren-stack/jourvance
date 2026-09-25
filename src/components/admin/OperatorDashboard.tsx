import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Users,
  Layers,
  TrendingUp,
  Activity,
  Globe,
  CheckCircle2,
  X,
  Server,
  RefreshCw,
  Search,
  ExternalLink,
  Lock
} from 'lucide-react';
import type { JourneyProject } from '../../types/journey';
import { authHeaders } from '../../lib/firebase';

interface OperatorDashboardProps {
  currentProject: JourneyProject;
  onClose: () => void;
  onLoadProject: (project: JourneyProject) => void;
}

export const OperatorDashboard: React.FC<OperatorDashboardProps> = ({
  currentProject,
  onClose,
  onLoadProject
}) => {
  const [activeTab, setActiveTab] = useState<'metrics' | 'users' | 'journeys' | 'system'>('metrics');
  const [searchTerm, setSearchTerm] = useState('');
  const [savedJourneys, setSavedJourneys] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<{ leads: number; orders: number; pageViews: number; hubConfigured: boolean }>({
    leads: 0, orders: 0, pageViews: 0, hubConfigured: false
  });

  useEffect(() => {
    let cancelled = false;
    authHeaders().then(async headers => {
      const [journeysRes, summaryRes, healthRes] = await Promise.all([
        fetch('/api/admin/journeys', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/admin/summary', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/health').then(r => r.json()).catch(() => ({}))
      ]);
      if (cancelled) return;
      if (journeysRes.success && journeysRes.journeys) setSavedJourneys(journeysRes.journeys);
      if (summaryRes.success) {
        setSummary({
          leads: summaryRes.leads || 0,
          orders: summaryRes.orders || 0,
          pageViews: summaryRes.pageViews || 0,
          hubConfigured: Boolean(summaryRes.hubConfigured || healthRes.hubConfigured)
        });
      } else if (typeof healthRes.hubConfigured === 'boolean') {
        setSummary(s => ({ ...s, hubConfigured: healthRes.hubConfigured }));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const owners = Object.values(savedJourneys.reduce((acc: Record<string, { id: string; funnels: number }>, journey: any) => {
    const id = String(journey.userId || 'unknown');
    if (!acc[id]) acc[id] = { id, funnels: 0 };
    acc[id].funnels += 1;
    return acc;
  }, {}));
  const visibleOwners = owners.filter(o => o.id.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        backgroundColor: 'rgba(7, 10, 18, 0.95)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        display: 'flex',
        flexDirection: 'column',
        color: '#F8FAFC',
        overflow: 'hidden'
      }}
    >
      {/* Top Admin Bar */}
      <div
        style={{
          height: '65px',
          padding: '0 2rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#0F172A'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <ShieldCheck size={20} color="#10B981" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#FFFFFF' }}>
                Jourvance Operator Admin
              </span>
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  backgroundColor: 'rgba(16, 185, 129, 0.2)',
                  color: '#34D399',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '9999px',
                  border: '1px solid rgba(16, 185, 129, 0.4)'
                }}
              >
                Owner Portal
              </span>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
              Restricted to tlm@tarrenmunoz.com • Connected to Zelus Hub
            </span>
          </div>
        </div>

        {/* Tab switchers */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {(['metrics', 'users', 'journeys', 'system'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '0.45rem 0.9rem',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: 600,
                textTransform: 'capitalize',
                cursor: 'pointer',
                border: activeTab === tab ? '1px solid #6366F1' : '1px solid transparent',
                backgroundColor: activeTab === tab ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                color: activeTab === tab ? '#A5B4FC' : '#94A3B8'
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.45rem 0.85rem',
            borderRadius: '6px',
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#CBD5E1',
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <X size={15} />
          <span>Exit Admin</span>
        </button>
      </div>

      {/* Main Content Viewport */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '2.5rem' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          {/* ── METRICS TAB ── */}
          {activeTab === 'metrics' && (
            <div>
              <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF' }}>Platform Overview</h2>
                <p style={{ fontSize: '0.9rem', color: '#94A3B8' }}>Live SaaS activity across Jourvance instances.</p>
              </div>

              {/* 4 Overview Stat Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' }}>
                <div style={{ backgroundColor: '#111827', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', color: '#94A3B8' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>Registered Users</span>
                    <Users size={18} color="#6366F1" />
                  </div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#FFFFFF' }}>{owners.length}</div>
                  <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontWeight: 600 }}>Distinct owners on saved journeys</span>
                </div>

                <div style={{ backgroundColor: '#111827', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', color: '#94A3B8' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>Active Pipelines</span>
                    <Layers size={18} color="#38BDF8" />
                  </div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#FFFFFF' }}>{savedJourneys.length}</div>
                  <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontWeight: 600 }}>{summary.pageViews} recorded page views</span>
                </div>

                <div style={{ backgroundColor: '#111827', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', color: '#94A3B8' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>Total Leads Processed</span>
                    <TrendingUp size={18} color="#10B981" />
                  </div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#FFFFFF' }}>{summary.leads}</div>
                  <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontWeight: 600 }}>{summary.orders} orders on file</span>
                </div>

                <div style={{ backgroundColor: '#111827', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '12px', padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', color: '#94A3B8' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>Hub Brain API</span>
                    <Activity size={18} color="#F59E0B" />
                  </div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#FFFFFF' }}>{summary.hubConfigured ? 'On' : 'Off'}</div>
                  <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontWeight: 600 }}>{summary.hubConfigured ? 'Hub key is set' : 'No hub key on this server'}</span>
                </div>
              </div>

              {/* Infrastructure Summary */}
              <div style={{ backgroundColor: '#111827', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '14px', padding: '1.75rem' }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '1rem' }}>
                  Infrastructure Status
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', backgroundColor: '#1E293B', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <Globe size={16} color="#10B981" />
                      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#F1F5F9' }}>This server</span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontWeight: 700, backgroundColor: 'rgba(255, 255, 255, 0.06)', padding: '0.2rem 0.6rem', borderRadius: '4px' }}>
                      Local process
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', backgroundColor: '#1E293B', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <Server size={16} color="#6366F1" />
                      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#F1F5F9' }}>Recorded orders</span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontWeight: 700, backgroundColor: 'rgba(255, 255, 255, 0.06)', padding: '0.2rem 0.6rem', borderRadius: '4px' }}>
                      {summary.orders}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', backgroundColor: '#1E293B', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <CheckCircle2 size={16} color="#10B981" />
                      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#F1F5F9' }}>Hub connection</span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontWeight: 700, backgroundColor: 'rgba(255, 255, 255, 0.06)', padding: '0.2rem 0.6rem', borderRadius: '4px' }}>
                      {summary.hubConfigured ? 'Configured' : 'Not configured'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── USERS TAB ── */}
          {activeTab === 'users' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF' }}>Customer Accounts</h2>
                  <p style={{ fontSize: '0.9rem', color: '#94A3B8' }}>Owners are the accounts that have a journey saved on this server.</p>
                </div>

                <div style={{ position: 'relative', width: '280px' }}>
                  <input
                    type="text"
                    placeholder="Search accounts..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem 0.55rem 2rem',
                      borderRadius: '8px',
                      backgroundColor: '#1E293B',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#FFFFFF',
                      fontSize: '0.85rem',
                      outline: 'none'
                    }}
                  />
                  <Search size={14} color="#94A3B8" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
                </div>
              </div>

              <div style={{ backgroundColor: '#111827', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#1E293B', color: '#94A3B8', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      <th style={{ padding: '0.85rem 1rem', fontWeight: 700 }}>Owner id</th>
                      <th style={{ padding: '0.85rem 1rem', fontWeight: 700 }}>Funnels</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOwners.length === 0 && (
                      <tr>
                        <td colSpan={2} style={{ padding: '1rem', color: '#94A3B8' }}>No saved journeys yet.</td>
                      </tr>
                    )}
                    {visibleOwners.map(acc => (
                        <tr key={acc.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                          <td style={{ padding: '0.85rem 1rem', color: '#FFFFFF', fontWeight: 600 }}>{acc.id}</td>
                          <td style={{ padding: '0.85rem 1rem', color: '#FFFFFF' }}>{acc.funnels}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── JOURNEYS TAB ── */}
          {activeTab === 'journeys' && (
            <div>
              <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF' }}>All Customer Journeys</h2>
                <p style={{ fontSize: '0.9rem', color: '#94A3B8' }}>View and audit funnels built across the platform.</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
                {/* Current Active Journey Card */}
                <div style={{ backgroundColor: '#111827', borderRadius: '12px', border: '1px solid rgba(99, 102, 241, 0.4)', padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.75rem', color: '#818CF8', fontWeight: 800, textTransform: 'uppercase' }}>Current Workspace</span>
                    <span style={{ fontSize: '0.75rem', color: '#10B981', fontWeight: 700 }}>Active</span>
                  </div>
                  <h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '0.5rem' }}>
                    {currentProject.name}
                  </h4>
                  <p style={{ fontSize: '0.85rem', color: '#94A3B8', marginBottom: '1.25rem' }}>
                    Offer: "{currentProject.offerHeadline || 'Default Lead Capture'}" ({currentProject.businessType || 'Universal'})
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748B', paddingTop: '0.75rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                    <span>Nodes: {currentProject.nodes.length}</span>
                    <span>Connections: {currentProject.edges.length}</span>
                  </div>
                </div>

                {/* Additional Sample Journey */}
                <div style={{ backgroundColor: '#111827', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)', padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontWeight: 800, textTransform: 'uppercase' }}>HVAC Pro Pipeline</span>
                    <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>alex.hvac@example.com</span>
                  </div>
                  <h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '0.5rem' }}>
                    AC Tune-Up Lead Magnet
                  </h4>
                  <p style={{ fontSize: '0.85rem', color: '#94A3B8', marginBottom: '1.25rem' }}>
                    Meta Ad → $49 Seasonal Checkup Lander → Zip Code Form → 48h Follow-up
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748B', paddingTop: '0.75rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                    <span>Nodes: 4</span>
                    <span>Conversions: 28</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── SYSTEM TAB ── */}
          {activeTab === 'system' && (
            <div>
              <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#FFFFFF' }}>System & Integration Diagnostics</h2>
                <p style={{ fontSize: '0.9rem', color: '#94A3B8' }}>Live connection telemetry and registrar settings.</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ backgroundColor: '#111827', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)', padding: '1.75rem' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '0.75rem' }}>
                    Zelus Labs Hub Connection
                  </h3>
                  <div style={{ fontSize: '0.85rem', color: '#94A3B8', lineHeight: 1.6 }}>
                    <p>Endpoint: <code style={{ color: '#818CF8' }}>https://zeluslabs.dev</code></p>
                    <p>App ID: <code style={{ color: '#818CF8' }}>jourvance</code></p>
                    <p>Spoke API Key: <code style={{ color: '#818CF8' }}>zlk_jourvance_*</code> (value lives only in the server's HUB_API_KEY env, never in this bundle)</p>
                    <p>Brain RAG Access: <span style={{ color: '#10B981', fontWeight: 700 }}>Online & Verified</span></p>
                  </div>
                </div>

                <div style={{ backgroundColor: '#111827', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)', padding: '1.75rem' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '0.75rem' }}>
                    Domain & DNS Profile
                  </h3>
                  <div style={{ fontSize: '0.85rem', color: '#94A3B8', lineHeight: 1.6 }}>
                    <p>Domain: <code style={{ color: '#818CF8' }}>jourvance.com</code></p>
                    <p>Registrar Order ID: <code style={{ color: '#818CF8' }}>214660972</code></p>
                    <p>Nameservers: <code style={{ color: '#818CF8' }}>Namecheap Default DNS</code></p>
                    <p>Target CNAME: <code style={{ color: '#818CF8' }}>jourvance.onrender.com</code></p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
