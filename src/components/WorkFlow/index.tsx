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
import { useChatStore } from "@/store/chatStore";
import { useWorkerList } from "@/store/authStore";
import { share } from "@/lib/share";
import { WorkSpaceMenu } from "../WorkSpaceMenu";

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

export default function Workflow({
	taskAssigning,
}: {
	taskAssigning: Agent[];
}) {
	const chatStore = useChatStore();
	const [isEditMode, setIsEditMode] = useState(false);
	const [lastViewport, setLastViewport] = useState({ x: 0, y: 0, zoom: 1 });
	const [nodes, setNodes, onNodesChange] = useNodesState<CustomNode>([]);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
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
					const nodeWidth = node.data.isExpanded ? 560 : 280;
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
						const nodeWidth = updatedNode.data.isExpanded ? 560 : 280;
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
		console.log("workerList	", workerList);
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
							: { x: index * 300 + 8, y: 16 },
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
						position: { x: index * 300 + 8, y: 16 },
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

	const { setViewport, getViewport, getNode } = useReactFlow();
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

	const handleShare = async (taskId: string) => {
		share(taskId);
	};

	return (
		<div className="w-full h-full flex flex-col items-center justify-center">
			<div className="w-full flex items-center justify-between">

				<WorkSpaceMenu />
				<div className="flex items-center justify-center gap-sm ">
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
					</Button>
					<div className=" p-1 rounded-lg bg-menutabs-bg-default border border-solid border-menutabs-border-active flex items-center justify-cneter gap-1">
						<Button
							variant="ghost"
							size="icon"
							onClick={() => {
								const viewport = getViewport();
								const newX = Math.min(0, viewport.x + 200);
								setViewport(
									{ x: newX, y: viewport.y, zoom: viewport.zoom },
									{ duration: 500 }
								);
							}}
						>
							<ChevronLeft className="w-4 h-4 text-icon-primary" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => {
								const viewport = getViewport();
								const newX = viewport.x - 200;
								setViewport(
									{ x: newX, y: viewport.y, zoom: viewport.zoom },
									{ duration: 500 }
								);
							}}
						>
							<ChevronRight className="w-4 h-4 text-icon-primary" />
						</Button>
					</div> */}
					{chatStore.tasks[chatStore.activeTaskId as string]?.status ===
						"finished" && (
						<div className="flex items-center justify-center p-1 rounded-lg border border-solid border-menutabs-border-active bg-menutabs-bg-default">
							<Button
								variant="ghost"
								size="sm"
								className="bg-button-fill-information text-button-fill-information-foreground hover:bg-button-fill-information-hover active:bg-button-fill-information-active focus:bg-button-fill-information-hover focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer"
								onClick={() => {
									handleShare(chatStore.activeTaskId as string);
								}}
							>
								Share
							</Button>
						</div>
					)}
				</div>
			</div>
			<div className="h-full w-full relative">
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
				
				{/* Bottom Navigation Dots */}
				<div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 z-10">
					<div className="flex items-center gap-8 px-4 py-2 rounded-full">
						{nodes.map((node, index) => {
							const isSelected = selectedNodeId === node.id;
							return (
								<button
									key={node.id}
									onClick={() => {
										// Set the selected node
										setSelectedNodeId(node.id);
										
										// Get the node from ReactFlow
										const flowNode = getNode(node.id);
										if (flowNode) {
											// Get current viewport
											const currentViewport = getViewport();
											
											// Calculate the 1/3 point position
											const container = document.querySelector('.react-flow__viewport');
											if (container) {
												const rect = container.getBoundingClientRect();
												
												// Position the node at 1/3 from the left side
												const oneThirdX = rect.width / 3; // 1/3 point horizontally
												const topPadding = 16; // Padding from the top edge
												
												// Calculate the node's center position
												const nodeCenterX = flowNode.position.x + (flowNode.data.isExpanded ? 280 : 140) / 2;
												
												// Calculate new viewport position to place node at 1/3 point
												const newX = oneThirdX - nodeCenterX * currentViewport.zoom;
												const newY = topPadding - flowNode.position.y * currentViewport.zoom;
												
												setViewport(
													{ x: newX, y: newY, zoom: currentViewport.zoom },
													{ duration: 500 }
												);
											}
										}
									}}
									className={`${
										isSelected 
											? 'h-2 rounded-md bg-fill-fill-primary' 
											: 'w-2 h-2 rounded-full bg-fill-fill-primary'
									} hover:bg-fill-fill-primary-hover hover:scale-120 cursor-pointer transition-all duration-200 active:scale-120`}
									style={isSelected ? { width: '24px' } : {}}
									title={`Navigate to ${node.data.agent.name}`}
								/>
							);
						})}
					</div>
				</div>
				
				{/* Navigation Buttons */}
				<div className="absolute bottom-0 right-2 z-10">
					<div className="flex items-center gap-2 rounded-full">
						<button
							onClick={() => {
								const currentIndex = nodes.findIndex(node => node.id === selectedNodeId);
								if (currentIndex > 0) {
									const prevNode = nodes[currentIndex - 1];
									setSelectedNodeId(prevNode.id);
									
									// Navigate to previous node
									const flowNode = getNode(prevNode.id);
									if (flowNode) {
										const currentViewport = getViewport();
										const container = document.querySelector('.react-flow__viewport');
										if (container) {
											const rect = container.getBoundingClientRect();
											const oneThirdX = rect.width / 3;
											const topPadding = 16;
											const nodeCenterX = flowNode.position.x + (flowNode.data.isExpanded ? 280 : 140) / 2;
											const newX = oneThirdX - nodeCenterX * currentViewport.zoom;
											const newY = topPadding - flowNode.position.y * currentViewport.zoom;
											
											setViewport(
												{ x: newX, y: newY, zoom: currentViewport.zoom },
												{ duration: 500 }
											);
										}
									}
								}
							}}
							className="w-8 h-8 flex items-center justify-center rounded-full cursor-pointer transition-all duration-200"
							title="Previous node"
						>
							<ChevronLeft className="w-4 h-4 text-icon-primary" />
						</button>
						<button
							onClick={() => {
								const currentIndex = nodes.findIndex(node => node.id === selectedNodeId);
								if (currentIndex < nodes.length - 1) {
									const nextNode = nodes[currentIndex + 1];
									setSelectedNodeId(nextNode.id);
									
									// Navigate to next node
									const flowNode = getNode(nextNode.id);
									if (flowNode) {
										const currentViewport = getViewport();
										const container = document.querySelector('.react-flow__viewport');
										if (container) {
											const rect = container.getBoundingClientRect();
											const oneThirdX = rect.width / 3;
											const topPadding = 16;
											const nodeCenterX = flowNode.position.x + (flowNode.data.isExpanded ? 280 : 140) / 2;
											const newX = oneThirdX - nodeCenterX * currentViewport.zoom;
											const newY = topPadding - flowNode.position.y * currentViewport.zoom;
											
											setViewport(
												{ x: newX, y: newY, zoom: currentViewport.zoom },
												{ duration: 500 }
											);
										}
									}
								}
							}}
							className="w-8 h-8 flex items-center justify-center rounded-full cursor-pointer transition-all duration-200"
							title="Next node"
						>
							<ChevronRight className="w-4 h-4 text-icon-primary" />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
