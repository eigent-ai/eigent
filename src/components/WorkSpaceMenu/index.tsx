import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useWorkerList } from "@/store/authStore";
import {
	Bot,
	FileText,
	Globe,
	Image,
	Inbox,
	CodeXml,
	Bird,
	LayoutGrid,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { AddWorker } from "@/components/AddWorker";
import { Badge } from "../ui/badge";
import { useTranslation } from "react-i18next";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";

export function WorkSpaceMenu() {
	const { t } = useTranslation();
	const { chatStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	const workerList = useWorkerList();
	const baseWorker: Agent[] = [
		{
			tasks: [],
			agent_id: "developer_agent",
			name: t("layout.developer-agent"),
			type: "developer_agent",
			log: [],
			activeWebviewIds: [],
		},
		{
			tasks: [],
			agent_id: "search_agent",
			name: t("layout.search-agent"),
			type: "search_agent",
			log: [],
			activeWebviewIds: [],
		},
		{
			tasks: [],
			agent_id: "multi_modal_agent",
			name: t("layout.multi-modal-agent"),
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
			name: t("layout.document-agent"),
			type: "document_agent",
			log: [],
			activeWebviewIds: [],
		},
	];
	const [agentList, setAgentList] = useState<Agent[]>([]);
	useEffect(() => {
		const taskAssigning =
			chatStore.tasks[chatStore.activeTaskId as string]?.taskAssigning;
		const base = [...baseWorker, ...workerList].filter(
			(worker) => !taskAssigning.find((agent) => agent.type === worker.type)
		);
		setAgentList([...base, ...taskAssigning]);
	}, [
		chatStore.tasks[chatStore.activeTaskId as string]?.taskAssigning,
		workerList,
	]);

	useEffect(() => {
		const cleanup = window.electronAPI.onWebviewNavigated((id: string, url: string) => {
			let webViewUrls = [
				...chatStore.tasks[chatStore.activeTaskId as string].webViewUrls,
			];
			let taskAssigning = [
				...chatStore.tasks[chatStore.activeTaskId as string].taskAssigning,
			];
			const hasId = taskAssigning.find((item) =>
				item.activeWebviewIds?.find((webview) => webview.id === id)
			);
			if (!hasId) {
				const hasUrl = webViewUrls.find(
					(item) => new URL(item.url).hostname === new URL(url).hostname
				);

				if (hasUrl) {
					const activeAgentIndex = taskAssigning.findIndex((item) =>
						item.tasks.find((task) => task.id === hasUrl?.processTaskId)
					);

					if (activeAgentIndex === -1) {
						const searchAgentIndex = taskAssigning.findIndex((item) => item.type === 'search_agent');
						if (searchAgentIndex !== -1) {
							taskAssigning[searchAgentIndex].activeWebviewIds?.push({
								id,
								url,
								img: "",
								processTaskId: hasUrl?.processTaskId || "",
							});
							chatStore.setTaskAssigning(
								chatStore.activeTaskId as string,
								taskAssigning
							);
						}
					} else {
						taskAssigning[activeAgentIndex].activeWebviewIds?.push({
							id,
							url,
							img: "",
							processTaskId: hasUrl?.processTaskId || "",
						});
						chatStore.setTaskAssigning(
							chatStore.activeTaskId as string,
							taskAssigning
						);
					}
					const urlIndex = webViewUrls.findIndex((item) => item.url === url);
					if (urlIndex !== -1) {
						webViewUrls.splice(urlIndex, 1);
					}
					chatStore.setWebViewUrls(chatStore.activeTaskId as string, [
						...webViewUrls,
					]);
				} else {
					// If no URL match found, also try to add to search_agent
					const searchAgentIndex = taskAssigning.findIndex((item) => item.type === 'search_agent');
					if (searchAgentIndex !== -1 && webViewUrls.length > 0) {
						taskAssigning[searchAgentIndex].activeWebviewIds?.push({
							id,
							url,
							img: "",
							processTaskId: webViewUrls[0]?.processTaskId || "",
						});
						chatStore.setTaskAssigning(
							chatStore.activeTaskId as string,
							taskAssigning
						);
					}
				}
			}

			let webviews: { id: string; agent_id: string; index: number }[] = [];
			taskAssigning.map((item) => {
				if (item.type === "search_agent") {
					item.activeWebviewIds?.map((webview, index) => {
						// console.log("@@@@@@", webview);
						if (webview.id === id) {
							webviews.push({ ...webview, agent_id: item.agent_id, index });
						}
					});
				}
			});

			if (taskAssigning.length === 0 || webviews.length === 0) return;

			// capture webview
			const captureWebview = () => {
				webviews.map((webview) => {
					window.ipcRenderer
						.invoke("capture-webview", webview.id)
						.then((base64: string) => {
							let taskAssigning = [
								...chatStore.tasks[chatStore.activeTaskId as string]
									.taskAssigning,
							];
							const searchAgentIndex = taskAssigning.findIndex(
								(agent) => agent.agent_id === webview.agent_id
							);

							if (
								searchAgentIndex !== -1 &&
								base64 &&
								base64 !== "data:image/jpeg;base64,"
							) {
								taskAssigning[searchAgentIndex].activeWebviewIds![
									webview.index
								].img = base64;

								chatStore.setTaskAssigning(
									chatStore.activeTaskId as string,
									taskAssigning
								);
							}
						})
						.catch((error) => {
							console.error("capture webview error:", error);
						});
				});
			};
			setTimeout(() => {
				captureWebview();
			}, 200);
		});

		// Cleanup function to remove listener when component unmounts or dependencies change
		return cleanup;
	}, [
		chatStore.activeTaskId,
		chatStore.tasks[chatStore.activeTaskId as string]?.webViewUrls,
		chatStore.tasks[chatStore.activeTaskId as string]?.taskAssigning,
	]);

	const agentMap = {
		developer_agent: {
			name: t("layout.developer-agent"),
			icon: <CodeXml size={16} className="text-text-primary" />,
			textColor: "text-text-developer",
			bgColor: "bg-bg-fill-coding-active",
			shapeColor: "bg-bg-fill-coding-default",
			borderColor: "border-bg-fill-coding-active",
			bgColorLight: "bg-emerald-200",
		},
		search_agent: {
			name: t("layout.search-agent"),
			icon: <Globe size={16} className="text-text-primary" />,
			textColor: "text-blue-700",
			bgColor: "bg-bg-fill-browser-active",
			shapeColor: "bg-bg-fill-browser-default",
			borderColor: "border-bg-fill-browser-active",
			bgColorLight: "bg-blue-200",
		},
		document_agent: {
			name: t("layout.document-agent"),
			icon: <FileText size={16} className="text-text-primary" />,
			textColor: "text-yellow-700",
			bgColor: "bg-bg-fill-writing-active",
			shapeColor: "bg-bg-fill-writing-default",
			borderColor: "border-bg-fill-writing-active",
			bgColorLight: "bg-yellow-200",
		},
		multi_modal_agent: {
			name: t("layout.multi-modal-agent"),
			icon: <Image size={16} className="text-text-primary" />,
			textColor: "text-fuchsia-700",
			bgColor: "bg-bg-fill-multimodal-active",
			shapeColor: "bg-bg-fill-multimodal-default",
			borderColor: "border-bg-fill-multimodal-active",
			bgColorLight: "bg-fuchsia-200",
		},
		social_medium_agent: {
			name: t("layout.social-media-agent"),
			icon: <Bird size={16} className="text-text-primary" />,
			textColor: "text-purple-700",
			bgColor: "bg-violet-700",
			shapeColor: "bg-violet-300",
			borderColor: "border-violet-700",
			bgColorLight: "bg-purple-50",
		},
	};
	const agentIconMap = {
		developer_agent: (
			<CodeXml
				className={`!h-[10px] !w-[10px] ${agentMap.developer_agent.textColor}`}
			/>
		),
		search_agent: (
			<Globe
				className={`!h-[10px] !w-[10px] ${agentMap.search_agent.textColor}`}
			/>
		),
		document_agent: (
			<FileText
				className={`!h-[10px] !w-[10px] ${agentMap.document_agent.textColor}`}
			/>
		),
		multi_modal_agent: (
			<Image
				className={`!h-[10px] !w-[10px] ${agentMap.multi_modal_agent.textColor}`}
			/>
		),
		social_medium_agent: (
			<Bird
				className={`!h-[10px] !w-[10px] ${agentMap.social_medium_agent.textColor}`}
			/>
		),
	};

	const onValueChange = (val: string) => {
		if (!chatStore.activeTaskId) return;
		if (val === "") {
			chatStore.setActiveWorkSpace(chatStore.activeTaskId, "workflow");
			return;
		}
		if (val === "documentWorkSpace") {
			chatStore.setNuwFileNum(chatStore.activeTaskId, 0);
		}
		chatStore.setActiveWorkSpace(chatStore.activeTaskId, val);

		window.electronAPI.hideAllWebview();
	};

	return (
		<div className="h-full">
			<div className="h-full flex items-center flex-start">
				<div className="flex items-center flex-start gap-1 mr-3">
					{chatStore.activeTaskId && (
						<ToggleGroup
							type="single"
							size="sm"
							value={
								chatStore.tasks[chatStore.activeTaskId as string]
									.activeWorkSpace as string
							}
							onValueChange={onValueChange}
							className="flex items-center gap-2"
						>
							<ToggleGroupItem value="workflow" className="!w-10 !h-10 p-2">
								<LayoutGrid className="!h-6 !w-6" />
							</ToggleGroupItem>
							<ToggleGroupItem
								value="documentWorkSpace"
								className="!w-10 !h-10 p-2 relative"
							>
								{chatStore.tasks[chatStore.activeTaskId as string].nuwFileNum >
									0 && (
									<Badge
										className="absolute top-0.5 right-0.5 h-4 min-w-4 rounded-full px-1 font-mono tabular-nums bg-icon-cuation text-white-100%"
										variant="destructive"
									>
										{
											chatStore.tasks[chatStore.activeTaskId as string]
												.nuwFileNum
										}
									</Badge>
								)}
								<Inbox className="!h-6 !w-6" />
							</ToggleGroupItem>
						</ToggleGroup>
					)}
				</div>
				{/* activeAgent */}
				<AnimatePresence>
					{agentList.length > 0 && (
						<motion.div
							initial={{ opacity: 0, x: -30 }}
							animate={{ opacity: 1, x: 0 }}
							exit={{ opacity: 0, x: -30 }}
							transition={{ duration: 0.3, ease: "easeInOut" }}
							className={`px-3 border-[0px] border-solid border-l border-white-100%`}
						>
							<ToggleGroup
								type="single"
								value={
									chatStore.tasks[chatStore.activeTaskId as string]
										.activeWorkSpace as string
								}
								onValueChange={onValueChange}
								className="flex items-center gap-2 max-w-[500px] overflow-x-auto scrollbar-horizontal"
							>
								<AnimatePresence mode="popLayout">
									{agentList.map((agent) => (
										<motion.div
											key={agent.agent_id}
											initial={{ opacity: 0, scale: 0.8, x: -20 }}
											animate={{ opacity: 1, scale: 1, x: 0 }}
											exit={{ opacity: 0, scale: 0.8, x: 20 }}
											transition={{
												duration: 0.3,
												ease: "easeInOut",
											}}
											layout
										>
											<ToggleGroupItem
												disabled={
													![
														"developer_agent",
														"search_agent",
														"document_agent",
													].includes(agent.type as AgentNameType) ||
													agent.tasks.length === 0
												}
												value={agent.agent_id}
												aria-label="Toggle bold"
												className={`relative !w-10 !h-10 !p-2 hover:bg-white-100% ${
													agent.tasks.length === 0 && "opacity-30"
												}`}
											>
												<Bot className={`!h-6 !w-6 `} />
												<div className="absolute top-0 right-1">
													{
														agentIconMap[
															agent.type as keyof typeof agentIconMap
														]
													}
												</div>
											</ToggleGroupItem>
										</motion.div>
									))}
								</AnimatePresence>
							</ToggleGroup>
						</motion.div>
					)}
				</AnimatePresence>
				<div className="h-full w-[1px] bg-white-100% mr-3"></div>
				<AddWorker />
			</div>
		</div>
	);
}
