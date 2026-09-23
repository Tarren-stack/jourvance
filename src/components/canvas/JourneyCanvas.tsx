import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow,
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
  type EdgeTypes
} from '@xyflow/react';
import type { JourneyNode, JourneyEdge, JourneyNodeData, CanvasViewMode } from '../../types/journey';
import { AdNode } from './nodes/AdNode';
import { PageNode } from './nodes/PageNode';
import { FormNode } from './nodes/FormNode';
import { SequenceNode } from './nodes/SequenceNode';
import { ConversionEdge } from './edges/ConversionEdge';

interface Props {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
  onNodesChange: (nodes: JourneyNode[]) => void;
  onEdgesChange: (edges: JourneyEdge[]) => void;
  selectedNodeId: string | null;
  onSelectNode: (node: JourneyNode | null) => void;
  canvasViewMode?: CanvasViewMode;
}

export const JourneyCanvas: React.FC<Props> = ({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  selectedNodeId,
  onSelectNode,
  canvasViewMode = 'edit'
}) => {
  const nodeTypes: NodeTypes = useMemo(() => ({
    'ad-source': AdNode,
    'landing-page': PageNode,
    'lead-form': FormNode,
    'follow-up-sequence': SequenceNode
  }), []);

  const edgeTypes: EdgeTypes = useMemo(() => ({
    conversion: ConversionEdge
  }), []);

  const [rfNodes, setRfNodes, onNodesChangeHandler] = useNodesState(nodes);
  const [rfEdges, setRfEdges, onEdgesChangeHandler] = useEdgesState(edges);

  // Synchronize when external nodes change
  React.useEffect(() => {
    setRfNodes(nodes.map(n => ({
      ...n,
      selected: n.id === selectedNodeId,
      data: {
        ...n.data,
        canvasViewMode
      }
    })));
  }, [nodes, selectedNodeId, canvasViewMode, setRfNodes]);

  React.useEffect(() => {
    setRfEdges(edges);
  }, [edges, setRfEdges]);

  const handleConnect = useCallback(
    (params: Connection) => {
      const newEdge: JourneyEdge = {
        id: `e-${params.source}-${params.target}-${Date.now()}`,
        source: params.source,
        target: params.target,
        type: 'conversion',
        data: {
          sourceThroughput: 100,
          targetCount: 50,
          rate: 50.0
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
      onSelectNode(node as JourneyNode);
    },
    [onSelectNode]
  );

  const handlePaneClick = useCallback(() => {
    onSelectNode(null);
  }, [onSelectNode]);

  const handleNodeDragStop = useCallback(() => {
    onNodesChange(rfNodes as JourneyNode[]);
  }, [rfNodes, onNodesChange]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={(changes) => {
          onNodesChangeHandler(changes);
        }}
        onEdgesChange={(changes) => {
          onEdgesChangeHandler(changes);
        }}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
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
    </div>
  );
};
