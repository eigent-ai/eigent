import { useEffect, useRef, useState, useCallback } from "react";
import {
	PanOnScrollMode,
	ReactFlow,
	useNodesState,
	useReactFlow,
	Node as FlowNode,
	NodeTypes,
} from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Node as CustomNodeComponent } from "./node";

import { SquareStack, ChevronLeft, ChevronRight, Share } from "lucide-react";
import "@xyflow/react/dist/style.css";
import { useWorkerList } from "@/store/authStore";
import { share } from "@/lib/share";
import { useTranslation } from "react-i18next";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";

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
	const {t} = useTranslation();
	//Get Chatstore for the active project's task
	const { chatStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}

	const [isEditMode, setIsEditMode] = useState(false);
	const [lastViewport, setLastViewport] = useState({ x: 0, y: 0, zoom: 1 });
	const [nodes, setNodes, onNodesChange] = useNodesState<CustomNode>([]);
	const workerList = useWorkerList();
	const baseWorker: Agent[] = [
		{
			tasks: [],
			agent_id: "developer_agent",
			tools: [
				"Human Toolkit",
				"Terminal Toolkit",
				"Note Taking Toolkit",
				"Web Deploy Toolkit",
			],
			name: "Developer Agent",
			type: "developer_agent",
			log: [],
			activeWebviewIds: [],
		},
		{
			tasks: [],
			agent_id: "search_agent",
			name: "Search Agent",
			type: "search_agent",
			tools: [
				"Search Toolkit",
				"Browser Toolkit",
				"Human Toolkit",
				"Note Taking Toolkit",
				"Terminal Toolkit",
			],
			log: [],
			activeWebviewIds: [],
		},
		{
			tasks: [],
			tools: [
				"Video Downloader Toolkit",
				"Audio Analysis Toolkit",
				"Image Analysis Toolkit",
				"Open AI Image Toolkit",
				"Human Toolkit",
				"Terminal Toolkit",
				"Note Taking Toolkit",
				"Search Toolkit",
			],
			agent_id: "multi_modal_agent",
			name: "Multi Modal Agent",
			type: "multi_modal_agent",
			log: [],
			activeWebviewIds: [],
		},
		// {
		// 	tasks: [],
		// 	agent_id: "social_medium_agent",
		// 	name: "Social Medium Agent",
		// 	type: "social_medium_agent",
		// 	log: [],
		// 	activeWebviewIds: [],
		// },
		{
			tasks: [],
			agent_id: "document_agent",
			name: "Document Agent",
			tools: [
				"File Write Toolkit",
				"Pptx Toolkit",
				"Human Toolkit",
				"Mark It Down Toolkit",
				"Excel Toolkit",
				"Note Taking Toolkit",
				"Terminal Toolkit",
				"Google Drive Mcp Toolkit",
			],
			type: "document_agent",
			log: [],
			activeWebviewIds: [],
		},
	];

	const isEditModeRef = useRef(isEditMode);

	// update ref value
	useEffect(() => {
		isEditModeRef.current = isEditMode;
	}, [isEditMode]);

	const reSetNodePosition = () => {
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
	};

	// when exiting edit mode, re-calculate node positions
	useEffect(() => {
		if (!isEditMode) {
			reSetNodePosition();
		}
	}, [isEditMode, setNodes]);

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
			const base = [...baseWorker, ...workerList].filter(
				(worker) => !taskAssigning.find((agent) => agent.type === worker.type)
			);
			let targetData = [...prev];
			taskAssigning = [...base, ...taskAssigning];
			// taskAssigning = taskAssigning.filter((agent) => agent.tasks.length > 0);
			targetData = taskAssigning.map((agent, index) => {
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
						type: "node",
					};
				}
			});
			return targetData;
		});
		if (!isEditMode) {
			reSetNodePosition();
		}
	}, [taskAssigning, isEditMode, workerList]);

	const { setViewport, getViewport } = useReactFlow();
	useEffect(() => {
		const container: HTMLElement | null =
			document.querySelector(".react-flow__pane");
		if (!container) return;

		const onWheel = (e: WheelEvent) => {
			if (e.deltaY !== 0 && !isEditMode) {
				e.preventDefault();

				const { x, y, zoom } = getViewport();
				setViewport({ x: x - e.deltaY, y, zoom }, { duration: 0 });
			}
		};

		container.addEventListener("wheel", onWheel, { passive: false });

		return () => {
			container.removeEventListener("wheel", onWheel);
		};
	}, [getViewport, setViewport, isEditMode]);

	const [isAnimating, setIsAnimating] = useState(false);
	const moveViewport = (dx: number) => {
		if (isAnimating) return;
		const viewport = getViewport();
		setIsAnimating(true);
		// Prevent scrolling past x=0 (too far right) when moving left
		const newX = dx > 0 ? Math.min(0, viewport.x + dx) : viewport.x + dx;
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

	const handleShare = async (taskId: string) => {
		share(taskId);
	};

	return (
		<div className="w-full h-full flex flex-col items-center justify-center">
			<div className="flex items-center justify-between w-full ">
				<div className="text-text-body font-bold text-lg leading-relaxed">
					{t("workforce.your-ai-workforce")}
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
					<div className=" p-1 rounded-lg bg-menutabs-bg-default border border-solid border-menutabs-border-active flex items-center justify-cneter gap-1">
						<Button
							variant="ghost"
							size="icon"
							onClick={() => {
								moveViewport(200);
							}}
						>
							<ChevronLeft className="w-4 h-4 text-icon-primary" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => moveViewport(-200)}
						>
							<ChevronRight className="w-4 h-4 text-icon-primary" />
						</Button>
					</div>
				</div>
			</div>
			<div className="h-full w-full">
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
