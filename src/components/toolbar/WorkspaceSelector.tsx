import React, { useState, useRef, useEffect } from 'react';
import { Layers, ChevronDown, Check, Plus, ShoppingBag, ExternalLink, Sparkles } from 'lucide-react';
import type { Workspace } from '../../types/journey';

interface Props {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  onSelectWorkspace: (ws: Workspace) => void;
  onOpenShopifyConnect: () => void;
  onCreateWorkspace: () => void;
  onOpenBilling?: () => void;
}

export const WorkspaceSelector: React.FC<Props> = ({
  workspaces,
  currentWorkspace,
  onSelectWorkspace,
  onOpenShopifyConnect,
  onCreateWorkspace,
  onOpenBilling
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Escape closes the list and hands focus back to its button, like the header's other menus (C31).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (containerRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Tabbing out of the button and the list closes it, so it never sits open over the header. The
  // list takes focus itself (tabIndex -1), so a click on its heading still counts as inside.
  const closeWhenFocusLeaves = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && (triggerRef.current?.contains(next) || menuRef.current?.contains(next))) return;
    setOpen(false);
  };

  const isConnected = currentWorkspace?.shopifyConfig?.status === 'connected' && !!currentWorkspace?.shopifyConfig?.storeDomain;

  return (
    // minWidth 0 down the row, so on a 320px phone the two names shorten with an ellipsis instead of
    // Connect Shopify running past the right edge (R03).
    <div ref={containerRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, maxWidth: '100%' }}>
      {/* Workspace Menu Trigger */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        onBlur={open ? closeWhenFocusLeaves : undefined}
        aria-expanded={open}
        aria-controls={open ? 'jv-workspace-menu' : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px',
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          color: '#e5e7eb',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          minWidth: 0
        }}
      >
        <Layers size={15} style={{ color: '#ec4899', flexShrink: 0 }} />
        <span style={{ maxWidth: '140px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentWorkspace?.name || 'Workspace'}
        </span>
        <ChevronDown size={14} style={{ color: '#9ca3af', flexShrink: 0 }} />
      </button>

      {/* Dropdown Menu: straight after its button, so Tab walks into the list before the Shopify pill */}
      {open && (
        <div
          id="jv-workspace-menu"
          ref={menuRef}
          role="group"
          aria-label="Workspaces"
          tabIndex={-1}
          onBlur={closeWhenFocusLeaves}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            width: '260px',
            backgroundColor: '#16161d',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '12px',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.5)',
            zIndex: 1000,
            overflow: 'hidden',
            padding: '6px'
          }}
        >
          <div style={{ padding: '6px 10px', fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Workspaces ({workspaces.length})
          </div>

          <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
            {workspaces.map(ws => {
              const selected = ws.id === currentWorkspace?.id;
              const wsConnected = ws.shopifyConfig?.status === 'connected' && !!ws.shopifyConfig?.storeDomain;
              return (
                <button
                  key={ws.id}
                  onClick={() => {
                    onSelectWorkspace(ws);
                    setOpen(false);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    backgroundColor: selected ? 'rgba(236, 72, 153, 0.1)' : 'transparent',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    color: selected ? '#f472b6' : '#d1d5db',
                    fontSize: '13px'
                  }}
                >
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: selected ? 600 : 400 }}>{ws.name}</div>
                    <div style={{ fontSize: '11px', color: wsConnected ? '#10b981' : '#6b7280' }}>
                      {wsConnected ? ws.shopifyConfig?.storeDomain : 'No store linked'}
                    </div>
                  </div>
                  {selected && <Check size={14} style={{ color: '#ec4899', flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>

          <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.08)', margin: '6px 0' }} />

          <button
            onClick={() => {
              onCreateWorkspace();
              setOpen(false);
            }}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              borderRadius: '6px',
              backgroundColor: 'transparent',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              color: '#f3f4f6',
              fontSize: '13px',
              fontWeight: 500
            }}
          >
            <Plus size={15} style={{ color: '#10b981' }} />
            <span>Add New Workspace</span>
          </button>

          <button
            onClick={() => {
              onOpenShopifyConnect();
              setOpen(false);
            }}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              borderRadius: '6px',
              backgroundColor: 'transparent',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              color: '#34d399',
              fontSize: '13px',
              fontWeight: 500
            }}
          >
            <ShoppingBag size={15} />
            <span>Manage Shopify Store</span>
          </button>
        </div>
      )}

      {/* Shopify Connection Pill */}
      <button
        onClick={onOpenShopifyConnect}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 10px',
          backgroundColor: isConnected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255, 255, 255, 0.04)',
          border: `1px solid ${isConnected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
          borderRadius: '8px',
          color: isConnected ? '#34d399' : '#9ca3af',
          fontSize: '12px',
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          minWidth: 0,
          // "Connect Shopify" is the action, so the workspace name gives way first.
          flexShrink: isConnected ? 1 : 0
        }}
        title={isConnected ? `Shopify Store: ${currentWorkspace?.shopifyConfig?.storeDomain}` : 'Click to connect a Shopify store'}
      >
        <ShoppingBag size={14} style={{ color: isConnected ? '#10b981' : '#9ca3af', flexShrink: 0 }} />
        <span style={{ maxWidth: '160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isConnected ? currentWorkspace?.shopifyConfig?.storeDomain : 'Connect Shopify'}
        </span>
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            flexShrink: 0,
            backgroundColor: isConnected ? '#10b981' : '#6b7280'
          }}
        />
      </button>

    </div>
  );
};
