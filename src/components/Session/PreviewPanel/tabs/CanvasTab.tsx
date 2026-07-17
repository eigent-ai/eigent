// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import {
  addEdge,
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback } from 'react';

const INITIAL_NODES: Node[] = [
  {
    id: 'start',
    type: 'input',
    position: { x: 0, y: 40 },
    data: { label: 'Start' },
  },
  {
    id: 'idea',
    position: { x: 220, y: 160 },
    data: { label: 'Idea' },
  },
];

const INITIAL_EDGES: Edge[] = [
  { id: 'start-idea', source: 'start', target: 'idea' },
];

function CanvasFlow() {
  const [nodes, , onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      fitView
      proOptions={{ hideAttribution: true }}
      className="bg-ds-bg-neutral-default-default"
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      <MiniMap pannable zoomable className="!bg-ds-bg-neutral-subtle-default" />
      <Controls />
    </ReactFlow>
  );
}

/**
 * Free-form React Flow canvas. Each canvas tab keeps its own flow state in its
 * own ReactFlowProvider so it stays isolated from the workspace workflow graph.
 */
export function CanvasTab() {
  return (
    <div className="h-full min-h-0 w-full overflow-hidden">
      <ReactFlowProvider>
        <CanvasFlow />
      </ReactFlowProvider>
    </div>
  );
}

export default CanvasTab;
