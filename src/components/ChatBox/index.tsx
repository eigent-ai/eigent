import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { fetchPost } from "@/api/http";
import { BottomInput } from "./BottomInput";
import { TaskCard } from "./TaskCard";
import { MessageCard } from "./MessageCard";
import { TypeCardSkeleton } from "./TypeCardSkeleton";
import { FileText, TriangleAlert } from "lucide-react";
import { generateUniqueId } from "@/lib";
import { useChatStore } from "@/store/chatStore";
import { proxyFetchGet } from "@/api/http";
import { useNavigate, useSearchParams } from "react-router-dom";
import { NoticeCard } from "./NoticeCard";
import { useAuthStore } from "@/store/authStore";
import { PrivacyDialog } from "../Dialog/Privacy";

export default function ChatBox(): JSX.Element {
	const [message, setMessage] = useState<string>("");
	const chatStore = useChatStore();

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const [privacy, setPrivacy] = useState<any>(false);
	const [hasSearchKey, setHasSearchKey] = useState<any>(false);
	// const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
	const { modelType } = useAuthStore();
	const [useCloudModelInDev, setUseCloudModelInDev] = useState(false);
	useEffect(() => {
		if (
			import.meta.env.VITE_USE_LOCAL_PROXY === "true" &&
			modelType === "cloud"
		) {
			setUseCloudModelInDev(true);
		} else {
			setUseCloudModelInDev(false);
		}
	}, [modelType]);
	useEffect(() => {
		proxyFetchGet("/api/user/privacy")
			.then((res) => {
				let _privacy = 0;
				Object.keys(res).forEach((key) => {
					if (!res[key]) {
						_privacy++;
						return;
					}
				});
				setPrivacy(_privacy === 0 ? true : false);
			})
			.catch((err) => console.error("Failed to fetch settings:", err));

		proxyFetchGet("/api/configs").then((configsRes) => {
			const configs = Array.isArray(configsRes) ? configsRes : [];
			const _hasApiKey = configs.find(
				(item) => item.config_name === "GOOGLE_API_KEY"
			);
			const _hasApiId = configs.find(
				(item) => item.config_name === "SEARCH_ENGINE_ID"
			);
			if (_hasApiKey && _hasApiId) setHasSearchKey(true);
		});
	}, []);

	// Refresh privacy status when dialog closes
	// useEffect(() => {
	// 	if (!privacyDialogOpen) {
	// 		proxyFetchGet("/api/user/privacy")
	// 			.then((res) => {
	// 				let _privacy = 0;
	// 				Object.keys(res).forEach((key) => {
	// 					if (!res[key]) {
	// 						_privacy++;
	// 						return;
	// 					}
	// 				});
	// 				setPrivacy(_privacy === 0 ? true : false);
	// 			})
	// 			.catch((err) => console.error("Failed to fetch settings:", err));
	// 	}
	// }, [privacyDialogOpen]);
	const [searchParams] = useSearchParams();
	const share_token = searchParams.get("share_token");

	const navigate = useNavigate();

	const handleSend = async (messageStr?: string, taskId?: string) => {
		const _taskId = taskId || chatStore.activeTaskId;
		if (message.trim() === "" && !messageStr) return;
		const tempMessageContent = messageStr || message;
		chatStore.setHasMessages(_taskId as string, true);
		if (!_taskId) return;
		chatStore.addMessages(_taskId, {
			id: generateUniqueId(),
			role: "user",
			content: tempMessageContent,
			attaches:
				JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) || [],
		});
		setMessage("");

		setTimeout(() => {
			scrollToBottom();
		}, 200);
		if (textareaRef.current) textareaRef.current.style.height = "60px";
		try {
			if (chatStore.tasks[_taskId].activeAsk) {
				chatStore.setIsPending(_taskId, true);

				await fetchPost(`/chat/${_taskId}/human-reply`, {
					agent: chatStore.tasks[_taskId].activeAsk,
					reply: tempMessageContent,
				});
				if (chatStore.tasks[_taskId].askList.length === 0) {
					chatStore.setActiveAsk(_taskId, "");
				} else {
					let activeAskList = chatStore.tasks[_taskId].askList;
					console.log(
						"activeAskList",
						JSON.parse(JSON.stringify(activeAskList))
					);
					let message = activeAskList.shift();
					chatStore.setActiveAskList(_taskId, [...activeAskList]);
					chatStore.setActiveAsk(_taskId, message?.agent_name || "");
					chatStore.setIsPending(_taskId, false);
					chatStore.addMessages(_taskId, message!);
				}
			} else {
				if (chatStore.tasks[_taskId as string]?.hasWaitComfirm) {
					// If the task has not started yet (pending status), start it normally
					if (chatStore.tasks[_taskId as string].status === "pending") {
						chatStore.setIsPending(_taskId, true);
						chatStore.startTask(_taskId);
						// keep hasWaitComfirm as true so that follow-up improves work as usual
					} else {
						// Task already started and is waiting for user confirmation – use improve API
						fetchPost(`/chat/${_taskId}`, {
							question: tempMessageContent,
						});
						chatStore.setIsPending(_taskId, true);
					}
				} else {
					chatStore.setIsPending(_taskId, true);
					chatStore.startTask(_taskId);
					chatStore.setHasWaitComfirm(_taskId as string, true);
				}
			}
		} catch (error) {
			console.error("error:", error);
		}
	};

	useEffect(() => {
		if (share_token) {
			handleSendShare(share_token);
		}
	}, [share_token]);

	const handleSendShare = async (token: string) => {
		if (!token) return;
		let _token: string = token.split("__")[0];
		let taskId: string = token.split("__")[1];
		chatStore.create(taskId, "share");
		chatStore.setHasMessages(taskId, true);
		const res = await proxyFetchGet(`/api/chat/share/info/${_token}`);
		if (res?.question) {
			chatStore.addMessages(taskId, {
				id: generateUniqueId(),
				role: "user",
				content: res.question.split("|")[0],
			});
			chatStore.startTask(taskId, "share", _token, 0.1);
			chatStore.setActiveTaskId(taskId);
			chatStore.handleConfirmTask(taskId, "share");
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && e.ctrlKey && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const scrollToBottom = useCallback(() => {
		if (scrollContainerRef.current) {
			setTimeout(() => {
				scrollContainerRef.current!.scrollTo({
					top: scrollContainerRef.current!.scrollHeight + 20,
					behavior: "smooth",
				});
			}, 200);
		}
	}, [scrollContainerRef.current?.scrollHeight]);

	const [loading, setLoading] = useState(false);
	const handleConfirmTask = async (taskId?: string) => {
		const _taskId = taskId || chatStore.activeTaskId;
		if (!_taskId) return;
		setLoading(true);
		await chatStore.handleConfirmTask(_taskId);
		setLoading(false);
	};

	const [hasSubTask, setHasSubTask] = useState(false);
	const messageStatus = useMemo(() => chatStore.tasks[chatStore.activeTaskId as string]?.status, [chatStore?.tasks[chatStore.activeTaskId as string]?.status]);

	useEffect(() => {
		const _hasSubTask = chatStore.tasks[
			chatStore.activeTaskId as string
		]?.messages?.find((message) => message.step === "to_sub_tasks")
			? true
			: false;
		setHasSubTask(_hasSubTask);
	}, [chatStore?.tasks[chatStore.activeTaskId as string]?.messages]);

	useEffect(() => {
		const activeAsk =
			chatStore?.tasks[chatStore.activeTaskId as string]?.activeAsk;
		let timer: NodeJS.Timeout;
		if (activeAsk && activeAsk !== "") {
			const _taskId = chatStore.activeTaskId as string;
			timer = setTimeout(() => {
				handleSend("skip", _taskId);
			}, 30000); // 30 seconds
			return () => clearTimeout(timer); // clear previous timer
		}
		// if activeAsk is empty, also clear timer
		return () => {
			clearTimeout(timer);
		};
	}, [
		chatStore?.tasks[chatStore.activeTaskId as string]?.activeAsk,
		message, // depend on message
	]);

	return (
		<div className="w-full h-full flex flex-col items-center justify-center">
			{/* <PrivacyDialog
				open={privacyDialogOpen}
				onOpenChange={setPrivacyDialogOpen}
			/> */}
			{(chatStore.activeTaskId &&
				chatStore.tasks[chatStore.activeTaskId].messages.length > 0) ||
			chatStore.tasks[chatStore.activeTaskId as string]?.hasMessages ? (
				<div className="w-full h-[calc(100vh-54px)] flex flex-col rounded-xl border border-border-disabled p-2 pr-0  border-solid relative overflow-hidden">
					<div className="absolute inset-0 blur-bg bg-bg-surface-secondary pointer-events-none"></div>
					<div
						ref={scrollContainerRef}
						className="flex-1 relative z-10 flex flex-col overflow-y-auto scrollbar pr-2 gap-2"
					>
						{chatStore.activeTaskId &&
							chatStore.tasks[chatStore.activeTaskId].messages.map(
								(item, index) => {
									if (item.content.length > 0) {
										// Use specialized component for agent summaries
										if (item.step === "end") {
											return (
												<div
													key={"end-" + item.id}
													className="flex flex-col gap-4"
												>
													<MessageCard
														typewriter={
															chatStore.tasks[chatStore.activeTaskId as string]
																.type !== "replay" ||
															(chatStore.tasks[chatStore.activeTaskId as string]
																.type === "replay" &&
																chatStore.tasks[
																	chatStore.activeTaskId as string
																].delayTime !== 0)
														}
														id={item.id}
														key={item.id}
														role={item.role}
														content={item.content}
														onTyping={scrollToBottom}
													/>
													<div className="flex gap-2 flex-wrap">
														{item.fileList?.map((file) => {
															return (
																<div
																	key={"file-" + file.name}
																	onClick={() => {
																		// set selected file
																		chatStore.setSelectedFile(
																			chatStore.activeTaskId as string,
																			file
																		);
																		// open DocumentWorkSpace
																		chatStore.setActiveWorkSpace(
																			chatStore.activeTaskId as string,
																			"documentWorkSpace"
																		);
																	}}
																	className="flex items-center gap-2 bg-message-fill-default rounded-sm  px-2 py-1 w-[140px] "
																>
																	<FileText
																		size={24}
																		className="flex-shrink-0"
																	/>
																	<div className="flex flex-col">
																		<div className="max-w-[100px] font-bold text-sm text-body text-text-body overflow-hidden text-ellipsis whitespace-nowrap">
																			{file.name.split(".")[0]}
																		</div>
																		<div className="font-medium leading-29 text-xs text-text-body">
																			{file.type}
																		</div>
																	</div>
																</div>
															);
														})}
													</div>
												</div>
											);
										} else if (item.content === "skip") {
											return (
												<MessageCard
													id={item.id}
													key={item.id}
													role={item.role}
													content="No reply received, task continue"
													onTyping={scrollToBottom}
												/>
											);
										} else {
											return (
												<MessageCard
													typewriter={
														chatStore.tasks[chatStore.activeTaskId as string]
															.type !== "replay" ||
														(chatStore.tasks[chatStore.activeTaskId as string]
															.type === "replay" &&
															chatStore.tasks[chatStore.activeTaskId as string]
																.delayTime !== 0)
													}
													id={item.id}
													key={item.id}
													role={item.role}
													content={item.content}
													onTyping={scrollToBottom}
													attaches={item.attaches}
												/>
											);
										}
									} else if (item.step === "end" && item.content === "") {
										return (
											<div
												key={"end-" + item.id}
												className="flex flex-col gap-4"
											>
												{/* <MessageCard
													id={item.id}
													content={
														"Task complete! If you have any further questions or need additional information, feel free to ask again."
													}
													className="!px-0 !py-1"
													role={item.role}
													onTyping={scrollToBottom}
												/> */}
												<div className="flex gap-2 flex-wrap">
													{item.fileList?.map((file) => {
														return (
															<div
																key={"file-" + file.name}
																onClick={() => {
																	// set selected file
																	chatStore.setSelectedFile(
																		chatStore.activeTaskId as string,
																		file
																	);
																	chatStore.setActiveWorkSpace(
																		chatStore.activeTaskId as string,
																		"documentWorkSpace"
																	);
																}}
																className="flex items-center gap-2 bg-message-fill-default rounded-sm  px-2 py-1 w-[140px] "
															>
																<FileText size={24} className="flex-shrink-0" />
																<div className="flex flex-col">
																	<div className="max-w-[100px] font-bold text-sm text-body text-text-body overflow-hidden text-ellipsis whitespace-nowrap">
																		{file.name.split(".")[0]}
																	</div>
																	<div className="font-medium leading-29 text-xs text-text-body">
																		{file.type}
																	</div>
																</div>
															</div>
														);
													})}
												</div>
											</div>
										);
									}
									if (
										item.step === "notice_card" &&
										!chatStore.tasks[chatStore.activeTaskId as string]
											.isTakeControl &&
										chatStore.tasks[chatStore.activeTaskId as string].cotList
											.length > 0
									) {
										return <NoticeCard key={"notice-" + item.id} />;
									}
									if (
										item.step === "to_sub_tasks" &&
										!chatStore.tasks[chatStore.activeTaskId as string]
											.isTakeControl
									) {
										if (!chatStore.activeTaskId) return <> </>;
										return (
											<TaskCard
												key={"task-" + item.id}
												taskInfo={
													chatStore.tasks[chatStore.activeTaskId].taskInfo || []
												}
												taskType={item.taskType || 1}
												taskAssigning={
													chatStore.tasks[chatStore.activeTaskId]
														.taskAssigning || []
												}
												taskRunning={
													chatStore.tasks[chatStore.activeTaskId].taskRunning ||
													[]
												}
												progressValue={
													chatStore.tasks[chatStore.activeTaskId].progressValue
												}
												summaryTask={
													chatStore.tasks[chatStore.activeTaskId].summaryTask ||
													""
												}
												onAddTask={() => {
													chatStore.setIsTaskEdit(chatStore.activeTaskId as string, true);
													chatStore.addTaskInfo();
												}}
												onUpdateTask={(taskIndex, content) => {
													chatStore.setIsTaskEdit(chatStore.activeTaskId as string, true);
													chatStore.updateTaskInfo(taskIndex, content);
												}}
												onDeleteTask={(taskIndex) => {
													chatStore.setIsTaskEdit(chatStore.activeTaskId as string, true);
													chatStore.deleteTaskInfo(taskIndex);
												}}
											/>
										);
									}
								}
							)}
						{/* Skeleton  */}
						{((!hasSubTask &&
							!chatStore.tasks[chatStore.activeTaskId as string]
								?.hasWaitComfirm &&
							chatStore.tasks[chatStore.activeTaskId as string]?.messages
								.length > 0 &&  !["finished"].includes(messageStatus)) ||
							chatStore.tasks[chatStore.activeTaskId as string]
								.isTakeControl) && (
							<TypeCardSkeleton
								isTakeControl={
									chatStore.tasks[chatStore.activeTaskId as string]
										.isTakeControl
								}
							/>
						)}
					</div>
					{chatStore.activeTaskId && (
						<BottomInput
							isTakeControl={
								chatStore.tasks[chatStore.activeTaskId as string].isTakeControl
							}
							setIsTakeControl={(isTakeControl) =>
								chatStore.setIsTakeControl(
									chatStore.activeTaskId as string,
									isTakeControl
								)
							}
							isPending={chatStore.tasks[chatStore.activeTaskId].isPending}
							onPendingChange={(val) =>
								chatStore.setIsPending(chatStore.activeTaskId as string, val)
							}
							privacy={privacy}
							message={message}
							onMessageChange={setMessage}
							onKeyDown={handleKeyDown}
							onSend={handleSend}
							textareaRef={textareaRef}
							loading={loading}
							onStartTask={() => handleConfirmTask()}
							useCloudModelInDev={useCloudModelInDev}
						/>
					)}
				</div>
			) : (
				<div
					className="w-full h-[calc(100vh-54px)] flex items-center rounded-xl border border-border-disabled p-2 pr-0  border-solid  relative overflow-hidden"
					onClick={() => {
						if (!privacy) {
							navigate("/setting/privacy");
							// setPrivacyDialogOpen(true);
						}
					}}
					style={{ cursor: !privacy ? "pointer" : "default" }}
				>
					<div className="absolute inset-0 blur-bg bg-bg-surface-secondary pointer-events-none"></div>
					<div className=" w-full flex flex-col relative z-10">
						<div className="flex flex-col items-center gap-1 h-[210px] justify-end">
							<div className="text-xl leading-[30px] text-zinc-800 text-center font-bold">
								Welcome to Eigent
							</div>
							<div className="text-lg leading-7 text-zinc-500 text-center mb-5">
								How can I help you today?
							</div>
						</div>

						{chatStore.activeTaskId && (
							<BottomInput
								isPending={chatStore.tasks[chatStore.activeTaskId].isPending}
								onPendingChange={(val) =>
									chatStore.setIsPending(chatStore.activeTaskId as string, val)
								}
								privacy={privacy}
								message={message}
								onMessageChange={setMessage}
								onKeyDown={handleKeyDown}
								onSend={handleSend}
								textareaRef={textareaRef}
								loading={loading}
								useCloudModelInDev={useCloudModelInDev}
							/>
						)}
						<div className="h-[210px] flex justify-center items-start gap-2 mt-3 pr-2">
							{!privacy ? (
								<div className="flex items-center gap-2">
									<div
										onClick={(e) => {
											e.stopPropagation();
											// setPrivacyDialogOpen(true);
											navigate("/setting/privacy");
										}}
										className=" cursor-pointer flex items-center gap-1 px-sm py-xs rounded-md bg-surface-information"
									>
										<TriangleAlert
											size={16}
											className="text-icon-information"
										/>
										<span className="text-text-information text-sm font-medium leading-[22px]">
											Complete system setup to start use Eigent
										</span>
									</div>
								</div>
							) : useCloudModelInDev ? (
								<div className="flex items-center gap-2">
									<div
										onClick={() => {
											navigate("/setting/models");
										}}
										className="cursor-pointer flex items-center gap-1 px-sm py-xs rounded-md bg-surface-information"
									>
										<span className="text-text-information text-sm font-medium leading-[22px]">
											You're in Self-hosted mode. Cloud models can't be used
											here — set up your own local cloud model to keep things
											running.
										</span>
									</div>
								</div>
							) : (
								!hasSearchKey &&
								modelType !== "cloud" && (
									<div className="flex items-center gap-2">
										<div
											onClick={() => {
												navigate("/setting/mcp");
											}}
											className="cursor-pointer flex items-center gap-1 px-sm py-xs rounded-md bg-surface-information"
										>
											<span className="text-text-information text-sm font-medium leading-[22px]">
												You're using Self-hosted mode. Enter the EXA and Google
												Search Keys in “MCP and Tools” to ensure Eigent works
												properly.
											</span>
										</div>
									</div>
								)
							)}
							{!useCloudModelInDev &&
								privacy &&
								(hasSearchKey || modelType === "cloud") && (
									<div className="mr-2 flex flex-col items-center gap-2">
										{[
											{
												label: "Palm Springs Tennis Trip Planner",
												message:
													"I am two tennis fans and want to go see the tennis tournament in palm springs. l live in SF - please prepare a detailed itinerary with flights, hotels, things to do for 3 days - around the time semifinal/finals are happening. We like hiking, vegan food and spas. Our budget is $5K. The itinerary should be a detailed timeline of time, activity, cost, other details and if applicable a link to buy tickets/make reservations etc. for the item. Some preferences 1.Spa access would be nice but not necessary 2. When you finnish this task, please generate a html report about this trip.",
											},
											{
												label: "Bank Transfer CSV Analysis and Visualization",
												message:
													"Create a mock bank transfer CSV file include 10 columns and 10 rows. Read the generated CSV file and summarize the data, generate a chart to visualize relevant trends or insights from the data.",
											},
											{
												label: "Find Duplicate Files in Downloads Folder",
												message:
													"Help me find duplicate files by content, size, and format in my downloads folder.",
											},
										].map(({ label, message }) => (
											<div
												key={label}
												className="cursor-pointer px-sm py-xs rounded-md bg-input-bg-default opacity-70 hover:opacity-100 text-xs font-medium leading-none text-button-tertiery-text-default transition-all duration-300"
												onClick={() => {
													setMessage(message);
												}}
											>
												<span>{label}</span>
											</div>
										))}
									</div>
								)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
