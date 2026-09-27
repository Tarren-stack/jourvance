import React, { useCallback, useMemo } from 'react';
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
  canvasViewMode = 'edit'
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

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

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
        return {
          ...e,
          data: {
            sourceThroughput: 0,
            targetCount: 0,
            rate: 0,
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
          rate: 0
        }
      };
      const nextEdges = addEdge(newEdge, rfEdges) as JourneyEdge[];
      setRfEdges(nextEdges);
      onEdgesChange(nextEdges);
    },
    [rfEdges, onEdgesChange, setRfEdges]
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

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
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
