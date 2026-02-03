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

import { Button } from '@/components/ui/button';
import {
  Node as FlowNode,
  NodeTypes,
  PanOnScrollMode,
  ReactFlow,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Node as CustomNodeComponent } from './node';

import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { share } from '@/lib/share';
import { useWorkerList } from '@/store/authStore';
import '@xyflow/react/dist/style.css';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface NodeData {
  agent: Agent;
  img?: ActiveWebView[];
  isExpanded?: boolean;
  onExpandChange?: (nodeId: string, isExpanded: boolean) => void;
  [key: string]: any;
}

type CustomNode = FlowNode<NodeData>;

const nodeTypes: NodeTypes = {
  node: (props: any) => <CustomNodeComponent {...props} />,
};

const VIEWPORT_ANIMATION_DURATION = 500;

export default function Workflow({
  taskAssigning,
}: {
  taskAssigning: Agent[];
}) {
  const { t } = useTranslation();
  //Get Chatstore for the active project's task
  const { chatStore } = useChatStoreAdapter();
  const [isEditMode, _setIsEditMode] = useState(false);
  const [_lastViewport, setLastViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [nodes, setNodes, onNodesChange] = useNodesState<CustomNode>([]);
  const workerList = useWorkerList();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const isEditModeRef = useRef(isEditMode);
  const { setViewport, getViewport } = useReactFlow();
  const [isAnimating, setIsAnimating] = useState(false);
  const totalNodesWidth = useMemo(() => {
    if (!nodes.length) return 0;

    const widths = nodes.map((node) => (node.data.isExpanded ? 684 : 342));
    const spacing = Math.max(nodes.length - 1, 0) * 20;

    return widths.reduce((sum, width) => sum + width, 0) + spacing + 16; // padding buffer
  }, [nodes]);

  const minViewportX = useMemo(() => {
    if (!containerWidth) return 0;
    const contentWidth = Math.max(totalNodesWidth, containerWidth);
    return Math.min(0, containerWidth - contentWidth);
  }, [containerWidth, totalNodesWidth]);

  const clampViewportX = useCallback(
    (x: number) => Math.min(0, Math.max(minViewportX, x)),
    [minViewportX]
  );

  const baseWorker: Agent[] = useMemo(
    () => [
      {
        tasks: [],
        agent_id: 'developer_agent',
        tools: [
          'Human Toolkit',
          'Terminal Toolkit',
          'Note Taking Toolkit',
          'Web Deploy Toolkit',
        ],
        name: 'Developer Agent',
        type: 'developer_agent',
        log: [],
        activeWebviewIds: [],
      },
      {
        tasks: [],
        agent_id: 'browser_agent',
        name: 'Browser Agent',
        type: 'browser_agent',
        tools: [
          'Search Toolkit',
          'Browser Toolkit',
          'Human Toolkit',
          'Note Taking Toolkit',
          'Terminal Toolkit',
        ],
        log: [],
        activeWebviewIds: [],
      },
      {
        tasks: [],
        tools: [
          'Video Downloader Toolkit',
          'Audio Analysis Toolkit',
          'Image Analysis Toolkit',
          'Open AI Image Toolkit',
          'Human Toolkit',
          'Terminal Toolkit',
          'Note Taking Toolkit',
          'Search Toolkit',
        ],
        agent_id: 'multi_modal_agent',
        name: 'Multi Modal Agent',
        type: 'multi_modal_agent',
        log: [],
        activeWebviewIds: [],
      },
      // {
      // 	tasks: [],
      // 	agent_id: "social_media_agent",
      // 	name: "Social Media Agent",
      // 	type: "social_media_agent",
      // 	log: [],
      // 	activeWebviewIds: [],
      // },
      {
        tasks: [],
        agent_id: 'document_agent',
        name: 'Document Agent',
        tools: [
          'File Write Toolkit',
          'Pptx Toolkit',
          'Human Toolkit',
          'Mark It Down Toolkit',
          'Excel Toolkit',
          'Note Taking Toolkit',
          'Terminal Toolkit',
          'Google Drive Mcp Toolkit',
        ],
        type: 'document_agent',
        log: [],
        activeWebviewIds: [],
      },
    ],
    []
  );

  // update ref value
  useEffect(() => {
    isEditModeRef.current = isEditMode;
  }, [isEditMode]);

  const reSetNodePosition = useCallback(() => {
    if (!isEditMode) {
      // re-calculate all node x positions
      setNodes((prev: CustomNode[]) => {
        let currentX = 8; // start x position

        return prev.map((node) => {
          // calculate node width and position based on expansion state
          const nodeWidth = node.data.isExpanded ? 684 : 342;
          const newPosition = { x: currentX, y: node.position.y };
          currentX += nodeWidth + 20; // 20 is the spacing between nodes

          return {
            ...node,
            position: newPosition,
          };
        });
      });
    }
  }, [isEditMode, setNodes]);

  // when exiting edit mode, re-calculate node positions
  useEffect(() => {
    if (!isEditMode) {
      reSetNodePosition();
    }
  }, [isEditMode, reSetNodePosition]);

  // update isEditMode state for all nodes
  useEffect(() => {
    setNodes((prev: CustomNode[]) => {
      return prev.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isEditMode: isEditMode,
        },
      }));
    });
  }, [isEditMode, setNodes]);

  const handleExpandChange = useCallback(
    (nodeId: string, isExpanded: boolean) => {
      if (isEditMode) {
        setNodes((prev: CustomNode[]) => {
          return prev.map((node) => {
            // update current node expansion state
            const updatedNode = {
              ...node,
              data: {
                ...node.data,
                isExpanded:
                  node.id === nodeId ? isExpanded : node.data.isExpanded,
                isEditMode: isEditMode,
              },
            };

            return {
              ...updatedNode,
            };
          });
        });
      } else {
        // update node expansion state and re-calculate all node x positions
        setNodes((prev: CustomNode[]) => {
          let currentX = 8; // start x position

          return prev.map((node) => {
            // update current node expansion state
            const updatedNode = {
              ...node,
              data: {
                ...node.data,
                isExpanded:
                  node.id === nodeId ? isExpanded : node.data.isExpanded,
                isEditMode: isEditMode,
              },
            };

            // calculate node width and position based on expansion state
            const nodeWidth = updatedNode.data.isExpanded ? 684 : 342;
            const newPosition = { x: currentX, y: node.position.y };
            currentX += nodeWidth + 20; // 20 is the spacing between nodes

            return {
              ...updatedNode,
              position: newPosition,
            };
          });
        });
      }
    },
    [setNodes, isEditMode]
  );

  useEffect(() => {
    // console.log("workerList	", workerList);
    setNodes((prev: CustomNode[]) => {
      if (!taskAssigning) return prev;
      // Agents not yet in taskAssigning (from baseWorker or workerList)
      const base = [...baseWorker, ...workerList].filter(
        (worker) => !taskAssigning.find((agent) => agent.type === worker.type)
      );
      let targetData = [...prev];
      // Merge all agents
      const allAgents = [...taskAssigning, ...base];
      // Sort: agents with tasks come first, then agents without tasks
      const sortedAgents = allAgents.sort((a, b) => {
        const aHasTasks = a.tasks && a.tasks.length > 0;
        const bHasTasks = b.tasks && b.tasks.length > 0;
        if (aHasTasks && !bHasTasks) return -1;
        if (!aHasTasks && bHasTasks) return 1;
        return 0;
      });
      targetData = sortedAgents.map((agent, index) => {
        const node = targetData.find((node) => node.id === agent.agent_id);
        if (node) {
          return {
            ...node,
            data: {
              ...node.data,
              img: agent?.activeWebviewIds,
              agent: agent,
              onExpandChange: handleExpandChange,
              isEditMode: isEditMode,
              workerInfo: agent?.workerInfo,
            },
            position: isEditMode
              ? node.position
              : { x: index * (342 + 20) + 8, y: 16 },
          };
        } else {
          return {
            id: agent.agent_id,
            data: {
              type: agent.type,
              agent: agent,
              img: agent?.activeWebviewIds,
              isExpanded: false,
              onExpandChange: handleExpandChange,
              isEditMode: isEditMode,
              workerInfo: agent?.workerInfo,
            },
            position: { x: index * (342 + 20) + 8, y: 16 },
            type: 'node',
          };
        }
      });
      return targetData;
    });
    if (!isEditMode) {
      reSetNodePosition();
    }
  }, [
    taskAssigning,
    isEditMode,
    workerList,
    baseWorker,
    handleExpandChange,
    reSetNodePosition,
    setNodes,
  ]);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);

    return () => {
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  const moveViewport = (dx: number) => {
    if (isAnimating) return;
    const viewport = getViewport();
    setIsAnimating(true);
    const newX = clampViewportX(viewport.x + dx);
    setViewport(
      { x: newX, y: viewport.y, zoom: viewport.zoom },
      {
        duration: VIEWPORT_ANIMATION_DURATION,
      }
    );
    setTimeout(() => {
      setIsAnimating(false);
    }, VIEWPORT_ANIMATION_DURATION);
  };

  const _handleShare = async (taskId: string) => {
    share(taskId);
  };

  useEffect(() => {
    const container: HTMLElement | null =
      document.querySelector('.react-flow__pane');
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0 && !isEditMode) {
        e.preventDefault();

        const { x, y, zoom } = getViewport();
        const nextX = clampViewportX(x - e.deltaY);
        setViewport({ x: nextX, y, zoom }, { duration: 0 });
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, [getViewport, setViewport, isEditMode, clampViewportX]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <div className="flex w-full items-center justify-between">
        <div className="text-lg font-bold leading-relaxed text-text-body">
          {t('workforce.your-ai-workforce')}
        </div>
        <div className="flex items-center justify-center gap-sm">
          {/* <Button
						variant="outline"
						size="icon"
						className="border border-solid border-menutabs-border-active bg-menutabs-bg-default p-2"
						onClick={() => {
							if (isEditMode) {
								// save current viewport state
								setLastViewport(getViewport());
								// restore original state
								setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 500 });
								// reset node positions
								setNodes((nodes: CustomNode[]) => {
									let currentX = 8;
									return nodes.map((node: CustomNode) => {
										const nodeWidth = node.data.isExpanded ? 560 : 280;
										const newPosition = { x: currentX, y: 16 };
										currentX += nodeWidth + 20;

										return {
											...node,
											position: newPosition,
										};
									});
								});
								setIsEditMode(false);
							} else {
								// enter edit mode
								setViewport({ x: 0, y: 0, zoom: 0.5 }, { duration: 500 });
								setIsEditMode(true);
							}
						}}
					>
						<SquareStack />
					</Button> */}
          <div className="justify-cneter flex items-center gap-1 rounded-lg border border-solid border-menutabs-border-active bg-menutabs-bg-default p-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                moveViewport(200);
              }}
            >
              <ChevronLeft className="h-4 w-4 text-icon-primary" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => moveViewport(-200)}
            >
              <ChevronRight className="h-4 w-4 text-icon-primary" />
            </Button>
          </div>
        </div>
      </div>
      <div className="h-full w-full" ref={containerRef}>
        <ReactFlow
          nodes={nodes}
          edges={[]}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          proOptions={{ hideAttribution: true }}
          zoomOnScroll={isEditMode}
          zoomOnPinch={isEditMode}
          zoomOnDoubleClick={isEditMode}
          panOnDrag={isEditMode}
          panOnScroll={!isEditMode}
          nodesDraggable={isEditMode}
          panOnScrollMode={PanOnScrollMode.Horizontal}
          onMove={(event, viewport) => {
            const clampedX = clampViewportX(viewport.x);
            if (clampedX !== viewport.x) {
              setViewport({ ...viewport, x: clampedX });
              return;
            }
            if (isEditMode) {
              setLastViewport(viewport);
            }
          }}
        >
          {/* <CustomControls /> */}
        </ReactFlow>
      </div>
    </div>
  );
}
