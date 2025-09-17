import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
	Paperclip,
	ArrowRight,
	Rocket,
	CirclePause,
	CirclePlay,
	Loader2,
	X,
	ArrowLeft,
	Pause,
	Play,
	Image,
	FileText,
} from "lucide-react";
import { useChatStore } from "@/store/chatStore";

import racPause from "@/assets/rac-pause.svg";
import { fetchDelete, proxyFetchDelete } from "@/api/http";

import { useState, useEffect } from "react";
import { fetchPut } from "@/api/http";
import { Tag } from "../ui/tag";
import { useTranslation } from "react-i18next";
import { TooltipSimple } from "../ui/tooltip";
import { toast } from "sonner";

export const BottomInput = ({
	message,
	onMessageChange,
	onKeyDown,
	onSend,
	textareaRef,
	isPending,
	onPendingChange,
	onStartTask,
	loading,
	privacy,
	isTakeControl,
	setIsTakeControl,
	useCloudModelInDev
}: {
	message: string;
	onMessageChange: (v: string) => void;
	onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
	onSend: () => void;
	textareaRef: React.RefObject<HTMLTextAreaElement>;
	isPending: boolean;
	onPendingChange: (v: boolean) => void;
	onStartTask?: () => void;
	loading?: boolean;
	privacy?: boolean;
	isTakeControl?: boolean;
	setIsTakeControl?: (v: boolean) => void;
	useCloudModelInDev: boolean;
}) => {
	const chatStore = useChatStore();
	const {t} = useTranslation();
	const [isConfirm, setIsConfirm] = useState(true);
	const [hasSubTask, setHasSubTask] = useState(false);


	useEffect(() => {
		const message = chatStore.tasks[
			chatStore.activeTaskId as string
		].messages.findLast((item) => item.step === "to_sub_tasks");
		if (message) {
			setIsConfirm(message.isConfirm || false);
			setHasSubTask(true);
		} else {
			setIsConfirm(true);
			setHasSubTask(false);
		}
	}, [chatStore.tasks[chatStore.activeTaskId as string]?.messages]);

	// get once per second
	const [taskTime, setTaskTime] = useState(
		chatStore.getFormattedTaskTime(chatStore.activeTaskId as string)
	);
	useEffect(() => {
		const interval = setInterval(() => {
			setTaskTime(
				chatStore.getFormattedTaskTime(chatStore.activeTaskId as string)
			);
		}, 500);
		return () => clearInterval(interval);
	}, [chatStore]);

	const [isLoading, setIsLoading] = useState(false);
	const handleTakeControl = (type: "pause" | "resume") => {
		setIsLoading(true);
		if (type === "pause") {
			let { taskTime, elapsed } =
				chatStore.tasks[chatStore.activeTaskId as string];

			const now = Date.now();
			elapsed += now - taskTime;
			chatStore.setElapsed(chatStore.activeTaskId as string, elapsed);
			chatStore.setTaskTime(chatStore.activeTaskId as string, 0);
		} else {
			chatStore.setTaskTime(chatStore.activeTaskId as string, Date.now());
		}
		fetchPut(`/task/${chatStore.activeTaskId}/take-control`, {
			action: type,
		});
		setIsLoading(false);
		if (type === "pause") {
			chatStore.setStatus(chatStore.activeTaskId as string, "pause");
		} else {
			chatStore.setStatus(chatStore.activeTaskId as string, "running");
		}
	};

	// handle file select
	const handleFileSelect = async () => {
		try {
			const result = await window.electronAPI.selectFile({
				title: t("chat.select-file"),
				filters: [{ name: t("chat.all-files"), extensions: ["*"] }],
			});

			if (result.success && result.files && result.files.length > 0) {
				// add new selected file to existing file list
				const files = [
					...chatStore.tasks[chatStore.activeTaskId as string].attaches.filter(
						(f) => !result.files.find((r: File) => r.filePath === f.filePath)
					),
					...result.files,
				];
				chatStore.setAttaches(chatStore.activeTaskId as string, files);
			}
		} catch (error) {
			console.error("Select File Error:", error);
		}
	};

	const handleEditQuery = () => {
		fetchDelete(`/chat/${chatStore.activeTaskId}`);
		const tempTaskId = chatStore.activeTaskId;
		const messageIndex = chatStore.tasks[
			chatStore.activeTaskId as string
		].messages.findIndex((item) => item.step === "to_sub_tasks");
		const question =
			chatStore.tasks[chatStore.activeTaskId as string].messages[
				messageIndex - 2
			].content;
		let id = chatStore.create();
		chatStore.setHasMessages(id, true);
		chatStore.removeTask(tempTaskId as string);
		proxyFetchDelete(`/api/chat/history/${tempTaskId}`);
		onMessageChange(question);
	};

	const handleReplay = async () => {
		let taskId = chatStore.activeTaskId as string;
		const question =
			chatStore.tasks[chatStore.activeTaskId as string].messages[0].content;
		chatStore.replay(taskId, question, 0.1);
	};

	return (
		<>
			{chatStore.tasks[chatStore.activeTaskId as string].type &&
			chatStore.tasks[chatStore.activeTaskId as string].type !== "" &&
			!isTakeControl ? (
				<div className="mr-2 flex items-center justify-between gap-sm z-50 bg-input-bg-default p-sm rounded-2xl border border-solid border-input-border-default">
					<Tag variant="primary">
						# {t("chat.token")}{" "}
						{chatStore.tasks[chatStore.activeTaskId as string].tokens || 0}
					</Tag>
					<div className="text-black text-sm font-medium leading-17">
						{/* {taskTime} */}
					</div>
					<Button
						onClick={handleReplay}
						disabled={
							chatStore.tasks[chatStore.activeTaskId as string]?.status !==
							"finished"
						}
						size="sm"
						className={`bg-button-fill-information rounded-full`}
					>
						{isLoading ? (
							<Loader2
								color="white"
								className="text-button-primary-icon-default animate-spin "
							/>
						) : (
							<CirclePlay
								color="white"
								className="text-button-primary-icon-default"
							/>
						)}
						Replay
					</Button>
				</div>
			) : !isConfirm && !isTakeControl ? (
				<div className="mr-2 flex items-center justify-between gap-sm z-50 bg-input-bg-default p-sm rounded-2xl border border-solid border-input-border-default">
					<Button
						variant="ghost"
						size="xs"
						onClick={handleEditQuery}
						className="rounded-full"
					>
						<ArrowLeft
							size={16}
							className="text-button-transparent-icon-default"
						/>
						<span className="text-xs leading-tight font-bold">
							Back to Edit
						</span>
					</Button>
					<Button
						disabled={loading}
						onClick={onStartTask}
						size="xs"
						variant="success"
						className="flex-1 rounded-full gap-1 flex items-center justify-center"
					>
						<span className="text-xs leading-17 font-medium">
							{loading ? "Processing..." : "Start Task"}
						</span>
						<Rocket size={16} className="text-button-primary-icon-default" />
					</Button>
				</div>
			) : hasSubTask &&
			  !chatStore.tasks[chatStore.activeTaskId as string].activeAsk &&
			  !isTakeControl ? (
				<div className="mr-2 flex items-center justify-between gap-sm z-50 bg-input-bg-default p-sm rounded-2xl border border-solid border-input-border-default">
					<Tag variant="primary">
						# {t("chat.token")}{" "}
						{chatStore.tasks[chatStore.activeTaskId as string].tokens || 0}
					</Tag>
					<div className="text-black text-sm font-medium leading-17">
						{taskTime}
					</div>
					{!(
						chatStore.tasks[chatStore.activeTaskId as string].status ===
						"finished"
					) ? (
						<Button
							disabled={
								chatStore.tasks[chatStore.activeTaskId as string].status !==
									"running" &&
								chatStore.tasks[chatStore.activeTaskId as string].status !==
									"pause"
							}
							onClick={() => {
								handleTakeControl(
									chatStore.tasks[chatStore.activeTaskId as string].status ===
										"running"
										? "pause"
										: "resume"
								);
							}}
							size="xs"
							variant={
								chatStore.tasks[chatStore.activeTaskId as string].status ===
								"pause"
									? "success"
									: "cuation"
							}
							className={`rounded-full gap-1 flex items-center justify-center`}
						>
							{isLoading ? (
								<Loader2
									color="white"
									className="w-4 h-4 text-button-primary-icon-default animate-spin "
								/>
							) : chatStore.tasks[chatStore.activeTaskId as string].status ===
							  "pause" ? (
								<CirclePlay
									color="white"
									className="w-4 h-4 text-button-primary-icon-default"
								/>
							) : (
								<CirclePause
									color="white"
									className="w-4 h-4 text-button-primary-icon-default"
								/>
							)}

							<span className="text-button-primary-icon-default text-xs font-semibold leading-17">
								{chatStore.tasks[chatStore.activeTaskId as string].status ===
								"pause"
									? t("chat.start")
									: t("chat.pause")}
							</span>
						</Button>
					) : (
						<Button
							onClick={handleReplay}
							className={`bg-button-fill-information rounded-full py-xs px-sm h-auto gap-1 flex items-center justify-center`}
						>
							{isLoading ? (
								<Loader2
									color="white"
									className="w-4 h-4 text-button-primary-icon-default animate-spin "
								/>
							) : (
								<CirclePlay
									color="white"
									className="w-4 h-4 text-button-primary-icon-default"
								/>
							)}

							<span className="text-button-primary-icon-default text-xs font-semibold leading-17">
								{t("chat.replay")}
							</span>
						</Button>
					)}
				</div>
			) : (
				<div className="mr-2 relative z-10  h-auto min-h-[82px] rounded-2xl bg-input-bg-default !px-2 !pb-2 gap-0 space-x-1 shadow-none border-solid border border-zinc-300">
					<Textarea
						disabled={!privacy || isPending || useCloudModelInDev}
						ref={textareaRef}
						value={message}
						onChange={(e) => onMessageChange(e.target.value)}
						onKeyDown={onKeyDown}
						className="scrollbar text-input-text-focus text-[13px] leading-tight font-medium px-2 pb-2.5 mt-2.5 w-full h-auto border-none shadow-none resize-none border focus-visible:ring-ring focus-visible:ring-0 focus-visible:outline-none"
						style={{
							minHeight: "60px",
							maxHeight: "200px",
							fontFamily: "Inter",
						}}
						rows={1}
						placeholder={t("chat.ask-placeholder")}
						onInput={(e) => {
							const el = e.currentTarget;
							el.style.height = "auto";
							el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
						}}
					/>
					{chatStore.tasks[chatStore.activeTaskId as string]?.attaches.length >
						0 && (
						<div className="flex items-center gap-sm py-sm flex-wrap">
							{(() => {
								const attaches =
									chatStore.tasks[chatStore.activeTaskId as string].attaches;
								return (
									<>
										{attaches.length > 0 &&
											attaches.map((item) => (
												<div
													key={item.fileName}
													className="cursor-pointer flex items-center gap-xs w-[125px] text-xs px-xs py-0.5 rounded-lg bg-tag-surface-hover"
												>
													{["jpg", "png", "jpeg"].includes(
														item.filePath.split(".").at(-1)?.toLowerCase() || ""
													) ? (
														<Image className="w-4 h-4 text-icon-primary" />
													) : (
														<FileText className="w-4 h-4 text-icon-primary" />
													)}
													<span
														className=" flex-1 text-ellipsis overflow-hidden whitespace-nowrap font-bold text-xs leading-none text-text-body"
														title={item.fileName}
													>
														{item.fileName}
													</span>
													<Button
														onClick={(e) => {
															e.stopPropagation();
															let files = attaches.filter(
																(f) => f.filePath !== item.filePath
															);
															chatStore.setAttaches(
																chatStore.activeTaskId as string,
																files
															);
														}}
														size="icon"
														variant="ghost"
														className="rounded-md !p-0 bg-button-secondary-fill-default hover:bg-button-secondary-fill-hover"
														title="Remove File"
													>
														<X className="!h-[16px] !w-[16px] text-white-100% hover:text-gray-600" />
													</Button>
												</div>
											))}
									</>
								);
							})()}
						</div>
					)}
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-1">
							<TooltipSimple content="Select File">
								<Button
									disabled={!privacy || isPending || useCloudModelInDev}
									onClick={handleFileSelect}
									variant="ghost"
									size="icon"
									className="rounded"
								>
									<Paperclip
										size={16}
										className="text-button-transparent-icon-disabled"
									/>
								</Button>
							</TooltipSimple>
						</div>
						<TooltipSimple content={message.trim().length > 0 ? "Send Message" : "Enter your message"}>
							<Button
								disabled={!privacy || isPending || useCloudModelInDev}
								onClick={() => {
									if (isPending) {
										if (isTakeControl) {
											handleTakeControl("resume");
											setIsTakeControl && setIsTakeControl(false);
										} else {
											setIsTakeControl && setIsTakeControl(true);
											handleTakeControl("pause");
										}
									} else if(message.trim().length > 0) {
										onSend();
										onPendingChange(true);
									} else {
										console.log("Message is empty ", message);
										toast.error("Message cannot be empty", {
											closeButton: true,
										});
									}
								}}
								size="icon"
								variant={
									isPending
										? isTakeControl
											? "success"
											: "cuation"
										: message.trim().length > 0
										? "success"
										: "primary"
								}
								className={`rounded-full  transition-all w-6`}
							>
								{isPending ? (
									// <CircleLoader className="w-4 h-4" />
									<>
										{isTakeControl ? (
											<Play
												color="white"
												className="w-4 h-4 text-button-primary-icon-default"
											/>
										) : (
											<img
												src={racPause}
												alt="racPause"
												className="w-4 h-4 text-text-inverse-primary"
											/>
										)}
									</>
								) : (
										<ArrowRight
											size={16}
											style={{
												transform: message ? "rotate(-90deg)" : "rotate(0deg)",
											}}
											className="transition-all text-button-primary-icon-default"
										/>
									)}
							</Button>
						</TooltipSimple>
					</div>
				</div>
			)}
		</>
	);
};
