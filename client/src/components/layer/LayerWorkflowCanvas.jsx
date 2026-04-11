import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  ConnectionMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import DctStartNode from "./nodes/DctStartNode";
import DctAgentNode from "./nodes/DctAgentNode";

const defaultEdgeOptions = { animated: true, style: { stroke: "hsl(24 5% 45%)", strokeWidth: 1.5 } };

export default function LayerWorkflowCanvas({
  nodes,
  setNodes,
  edges,
  setEdges,
  onSelectNodeId,
}) {
  const nodeTypes = useMemo(
    () => ({
      dctStart: DctStartNode,
      dctAgent: DctAgentNode,
    }),
    []
  );

  const isValidConnection = useCallback(
    (connection) => {
      const src = nodes.find((n) => n.id === connection.source);
      const tgt = nodes.find((n) => n.id === connection.target);
      if (!src || !tgt) return false;
      if (src.type === "dctStart" && tgt.type === "dctAgent") return true;
      if (src.type === "dctAgent" && tgt.type === "dctAgent") return true;
      return false;
    },
    [nodes]
  );

  const onConnect = useCallback(
    (params) =>
      setEdges((eds) =>
        addEdge({ ...params, animated: true, style: defaultEdgeOptions.style }, eds)
      ),
    [setEdges]
  );

  const onSelectionChange = useCallback(
    ({ nodes: selected }) => {
      onSelectNodeId(selected.length === 1 ? selected[0].id : null);
    },
    [onSelectNodeId]
  );

  return (
    <div className="h-[min(70vh,640px)] w-full overflow-hidden rounded-2xl border border-stone-200 bg-white">
      <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={(changes) => setNodes((ns) => applyNodeChanges(changes, ns))}
        onEdgesChange={(changes) => setEdges((es) => applyEdgeChanges(changes, es))}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        connectionMode={ConnectionMode.Loose}
        isValidConnection={isValidConnection}
        defaultEdgeOptions={defaultEdgeOptions}
        proOptions={{ hideAttribution: true }}
        className="bg-transparent"
      >
        <Background color="hsl(30 10% 82%)" gap={20} size={1} />
        <Controls className="!bg-white !border-stone-200 !shadow-lg" />
        <MiniMap
          className="!bg-stone-50 !border-stone-200"
          nodeColor={() => "hsl(24 9% 28%)"}
          maskColor="rgba(28,25,23,0.18)"
        />
      </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
