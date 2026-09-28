import React, { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type EdgeTypes,
  type NodeChange,
  type EdgeChange
} from '@xyflow/react';
import { Sparkles, EyeOff } from 'lucide-react';
import type { JourneyNode, JourneyEdge, JourneyNodeData, CanvasViewMode } from '../../types/journey';
import { AdNode } from './nodes/AdNode';
import { PageNode } from './nodes/PageNode';
import { FormNode } from './nodes/FormNode';
import { SequenceNode } from './nodes/SequenceNode';
import { ThankYouNode } from './nodes/ThankYouNode';
import { UpsellNode } from './nodes/UpsellNode';
import { AbSplitNode } from './nodes/AbSplitNode';
import { ConversionEdge } from './edges/ConversionEdge';

interface Props {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  onNodesChange: (nodes: JourneyNode[]) => void;
  onEdgesChange: (edges: JourneyEdge[]) => void;
  selectedNodeId: string | null;
  onSelectNode: (node: JourneyNode | null) => void;
  selectedEdgeId?: string | null;
  onSelectEdge?: (edge: JourneyEdge | null) => void;
  canvasViewMode?: CanvasViewMode;
  showRetentionBranches?: boolean;
  onToggleRetentionBranches?: (show: boolean) => void;
}

export const JourneyCanvas: React.FC<Props> = ({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  selectedNodeId,
  onSelectNode,
  selectedEdgeId,
  onSelectEdge,
  canvasViewMode = 'edit',
  showRetentionBranches,
  onToggleRetentionBranches
}) => {
  const nodeTypes: NodeTypes = useMemo(() => ({
    'ad-source': AdNode,
    'landing-page': PageNode,
    'lead-form': FormNode,
    'follow-up-sequence': SequenceNode,
    'thank-you': ThankYouNode,
    'upsell': UpsellNode,
    'ab-split': AbSplitNode
  }), []);

  const edgeTypes: EdgeTypes = useMemo(() => ({
    conversion: ConversionEdge
  }), []);

  const [rfNodes, setRfNodes, onNodesChangeHandler] = useNodesState(nodes);
  const [rfEdges, setRfEdges, onEdgesChangeHandler] = useEdgesState(edges);
  const [localShowRetention, setLocalShowRetention] = useState(true);

  const effectiveShowRetention = showRetentionBranches !== undefined ? showRetentionBranches : localShowRetention;

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const isRetentionNode = useCallback((n: JourneyNode) => {
    const data = n.data as any;
    return Boolean(
      data?.isRetentionBranch ||
      data?.sequenceType === 'upsell_recovery' ||
      data?.sequenceType === 'checkout_recovery' ||
      data?.sequenceType === 'at_risk_winback'
    );
  }, []);

  const retentionNodeIds = useMemo(() => {
    const set = new Set<string>();
    for (const n of rfNodes) {
      if (isRetentionNode(n as JourneyNode)) {
        set.add(n.id);
      }
    }
    return set;
  }, [rfNodes, isRetentionNode]);

  const retentionCount = retentionNodeIds.size;

  // Synchronize when external nodes change, preserving active user coordinates
  React.useEffect(() => {
    setRfNodes(currentRfNodes => {
      const positionMap = new Map(currentRfNodes.map(rn => [rn.id, rn.position]));
      return nodes.map(n => ({
        ...n,
        position: positionMap.has(n.id) ? (positionMap.get(n.id) || n.position) : n.position,
        selected: n.id === selectedNodeId,
        data: {
          ...n.data,
          canvasViewMode
        }
      }));
    });
  }, [nodes, selectedNodeId, canvasViewMode, setRfNodes]);

  React.useEffect(() => {
    setRfEdges(
      edges.map(e => {
        const source = nodeMap.get(e.source);
        const target = nodeMap.get(e.target);
        const isRetention = Boolean(
          e.data?.isRetentionEdge ||
          e.sourceHandle === 'declined' ||
          e.sourceHandle === 'rescue' ||
          e.sourceHandle === 'abandon' ||
          (target?.data as any)?.isRetentionBranch ||
          (target?.data as any)?.sequenceType === 'upsell_recovery' ||
          (target?.data as any)?.sequenceType === 'checkout_recovery' ||
          (target?.data as any)?.sequenceType === 'at_risk_winback'
        );

        return {
          ...e,
          data: {
            sourceThroughput: 0,
            targetCount: 0,
            rate: 0,
            sourceHandle: e.sourceHandle || undefined,
            targetHandle: e.targetHandle || undefined,
            isRetentionEdge: isRetention,
            ...(e.data || {}),
            sourceNodeType: source?.data?.type,
            targetNodeType: target?.data?.type,
            sourceNodeLabel: source?.data?.label,
            targetNodeLabel: target?.data?.label,
            sourceNodeData: source?.data,
            targetNodeData: target?.data,
            isSelected: e.id === selectedEdgeId,
            onSelectEdge: (id: string) => {
              const clicked = edges.find(item => item.id === id);
              if (onSelectNode) onSelectNode(null);
              if (onSelectEdge) onSelectEdge(clicked || null);
            }
          }
        };
      })
    );
  }, [edges, nodeMap, selectedEdgeId, onSelectEdge, onSelectNode, setRfEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeHandler(changes as any);
      const removals = changes.filter(c => c.type === 'remove');
      if (removals.length > 0) {
        const removedIds = new Set(removals.map((c: any) => c.id));
        setRfNodes(currentNodes => {
          const remaining = currentNodes.filter(n => !removedIds.has(n.id)) as JourneyNode[];
          onNodesChange(remaining);
          return remaining;
        });
        if (selectedNodeId && removedIds.has(selectedNodeId)) {
          onSelectNode(null);
        }
      }
    },
    [onNodesChangeHandler, onNodesChange, selectedNodeId, onSelectNode, setRfNodes]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChangeHandler(changes as any);
      const removals = changes.filter(c => c.type === 'remove');
      if (removals.length > 0) {
        const removedIds = new Set(removals.map((c: any) => c.id));
        setRfEdges(currentEdges => {
          const remaining = currentEdges.filter(e => !removedIds.has(e.id)) as JourneyEdge[];
          onEdgesChange(remaining);
          return remaining;
        });
        if (selectedEdgeId && removedIds.has(selectedEdgeId)) {
          if (onSelectEdge) onSelectEdge(null);
        }
      }
    },
    [onEdgesChangeHandler, onEdgesChange, selectedEdgeId, onSelectEdge, setRfEdges]
  );

  const handleConnect = useCallback(
    (params: Connection) => {
      const sourceNode = nodeMap.get(params.source);
      const targetNode = nodeMap.get(params.target);
      const isRetention = Boolean(
        params.sourceHandle === 'declined' ||
        params.sourceHandle === 'rescue' ||
        params.sourceHandle === 'abandon' ||
        (targetNode?.data as any)?.isRetentionBranch ||
        (targetNode?.data as any)?.sequenceType === 'upsell_recovery' ||
        (targetNode?.data as any)?.sequenceType === 'checkout_recovery' ||
        (targetNode?.data as any)?.sequenceType === 'at_risk_winback'
      );

      const newEdge: JourneyEdge = {
        id: `e-${params.source}-${params.target}-${Date.now()}`,
        source: params.source,
        target: params.target,
        sourceHandle: params.sourceHandle,
        targetHandle: params.targetHandle,
        type: 'conversion',
        data: {
          sourceThroughput: 0,
          targetCount: 0,
          rate: 0,
          sourceHandle: params.sourceHandle || undefined,
          targetHandle: params.targetHandle || undefined,
          isRetentionEdge: isRetention
        }
      };
      const nextEdges = addEdge(newEdge, rfEdges) as JourneyEdge[];
      setRfEdges(nextEdges);
      onEdgesChange(nextEdges);
    },
    [rfEdges, onEdgesChange, setRfEdges, nodeMap]
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (onSelectEdge) onSelectEdge(null);
      onSelectNode(node as JourneyNode);
    },
    [onSelectNode, onSelectEdge]
  );

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      if (onSelectNode) onSelectNode(null);
      if (onSelectEdge) onSelectEdge(edge as JourneyEdge);
    },
    [onSelectNode, onSelectEdge]
  );

  const handlePaneClick = useCallback(() => {
    onSelectNode(null);
    if (onSelectEdge) onSelectEdge(null);
  }, [onSelectNode, onSelectEdge]);

  const handleNodeDragStop = useCallback(() => {
    onNodesChange(rfNodes as JourneyNode[]);
  }, [rfNodes, onNodesChange]);

  const displayedNodes = useMemo(() => {
    if (effectiveShowRetention) return rfNodes;
    return rfNodes.filter(n => !retentionNodeIds.has(n.id));
  }, [rfNodes, effectiveShowRetention, retentionNodeIds]);

  const displayedEdges = useMemo(() => {
    if (effectiveShowRetention) return rfEdges;
    return rfEdges.filter(e => !retentionNodeIds.has(e.source) && !retentionNodeIds.has(e.target));
  }, [rfEdges, effectiveShowRetention, retentionNodeIds]);

  const toggleRetention = () => {
    const nextVal = !effectiveShowRetention;
    setLocalShowRetention(nextVal);
    if (onToggleRetentionBranches) {
      onToggleRetentionBranches(nextVal);
    }
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Floating Toolbar Filter: Show / Hide Retention Flows */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          right: 16,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
      >
        <button
          type="button"
          onClick={toggleRetention}
          title={effectiveShowRetention ? 'Hide courtesy retention and rescue flows from the canvas' : 'Show courtesy retention and rescue flows on the canvas'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '8px',
            background: effectiveShowRetention ? 'rgba(15, 23, 42, 0.88)' : 'rgba(15, 23, 42, 0.65)',
            border: effectiveShowRetention ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid rgba(255, 255, 255, 0.1)',
            color: effectiveShowRetention ? '#FBBF24' : '#94A3B8',
            fontSize: '11px',
            fontWeight: 700,
            backdropFilter: 'blur(12px)',
            cursor: 'pointer',
            boxShadow: effectiveShowRetention
              ? '0 0 16px rgba(245, 158, 11, 0.25), 0 4px 12px rgba(0, 0, 0, 0.4)'
              : '0 4px 12px rgba(0, 0, 0, 0.4)',
            transition: 'all 0.15s ease'
          }}
        >
          {effectiveShowRetention ? (
            <Sparkles size={12} color="#FBBF24" />
          ) : (
            <EyeOff size={12} color="#94A3B8" />
          )}
          <span>{effectiveShowRetention ? 'Retention Flows: Visible' : 'Retention Flows: Hidden'}</span>
          {retentionCount > 0 && (
            <span
              style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: '9999px',
                background: effectiveShowRetention ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                color: effectiveShowRetention ? '#FDE68A' : '#94A3B8',
                fontWeight: 700
              }}
            >
              {retentionCount}
            </span>
          )}
        </button>
      </div>

      <ReactFlowProvider>
        <ReactFlow
          nodes={displayedNodes}
          edges={displayedEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
          onNodeDragStop={handleNodeDragStop}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={1.8}
          defaultEdgeOptions={{ type: 'conversion' }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1.2}
            color="rgba(255, 255, 255, 0.08)"
          />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap
            position="bottom-right"
            nodeColor={n => {
              if (n.type === 'ad-source') return '#3B82F6';
              if (n.type === 'landing-page') return '#6366F1';
              if (n.type === 'lead-form') return '#10B981';
              if ((n.data as any)?.sequenceType === 'checkout_recovery') return '#10B981';
              if ((n.data as any)?.sequenceType === 'at_risk_winback') return '#8B5CF6';
              return '#F59E0B';
            }}
            maskColor="rgba(11, 15, 25, 0.75)"
            style={{ width: 140, height: 90 }}
          />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
};
