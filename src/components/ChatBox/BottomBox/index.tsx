import { Inputbox, InputboxProps, FileAttachment } from "./InputBox";
import { BoxHeader, QueuedMessage, SubTask } from "./BoxHeader";
import { BoxAction } from "./BoxAction";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Rocket } from "lucide-react";
import { useTranslation } from "react-i18next";

export type BottomBoxState = "input" | "queuing" | "splitting" | "confirm" | "running" | "finished";

interface BottomBoxProps {
	// General state
	state: BottomBoxState;
	
	// Queue-related props
	queuedMessages?: QueuedMessage[];
	onRemoveQueuedMessage?: (id: string) => void;
	
	// Subtask-related props (confirm/splitting state)
	subTasks?: SubTask[];
	onRemoveSubTask?: (id: string) => void;
	subtitle?: string;
	
	// Action buttons
	onStartTask?: () => void;
	onEdit?: () => void;
	
	// Task info
	tokens?: number;
	taskTime?: string;
	taskStatus?: 'running' | 'finished' | 'pending' | 'pause';
	
	// Replay
	onReplay?: () => void;
	replayDisabled?: boolean;
	replayLoading?: boolean;
	
	// Pause/Resume
	onPauseResume?: () => void;
	pauseResumeLoading?: boolean;
	
	// Input props
	inputProps: Omit<InputboxProps, "className"> & { className?: string };
	
	// Loading states
	loading?: boolean;
}

export default function BottomBox({
	state,
	queuedMessages = [],
	onRemoveQueuedMessage,
	subTasks = [],
	onRemoveSubTask,
	subtitle,
	onStartTask,
	onEdit,
	tokens = 0,
	taskTime,
	taskStatus,
	onReplay,
	replayDisabled,
	replayLoading,
	onPauseResume,
	pauseResumeLoading,
	inputProps,
	loading,
}: BottomBoxProps) {
	const { t } = useTranslation();
	
	// Decide which header to show, if any
	let headerState: "queuing" | "splitting" | "confirm" | null = null;
	if (state === "confirm") headerState = "confirm";
	else if (state === "splitting") headerState = "splitting";
	else if (state === "queuing") headerState = "queuing";
	else if (state === "running" && queuedMessages.length > 0) headerState = "queuing";

	// Determine background based on state
	let backgroundClass = "bg-input-bg-default"; // default/initial state
	if (state === "splitting") {
		backgroundClass = "bg-input-bg-spliting";
	} else if (state === "confirm") {
		backgroundClass = "bg-input-bg-confirm";
	}

	return (
		<div className={`flex flex-col gap-2 w-full p-2 rounded-xl ${backgroundClass} overflow-hidden z-50`}>
			{/* BoxHeader (conditionally visible by state) */}
			{headerState && (
				<BoxHeader
					state={headerState}
					subtitle={subtitle}
					title={headerState === "confirm" ? "Confirm Subtasks" : undefined}
					queuedMessages={headerState === "queuing" ? queuedMessages : []}
					onRemoveQueuedMessage={headerState === "queuing" ? onRemoveQueuedMessage : undefined}
					subTasks={headerState === "confirm" ? subTasks : []}
					onRemoveSubTask={headerState === "confirm" ? onRemoveSubTask : undefined}
					onStartTask={headerState === "confirm" || headerState === "queuing" ? onStartTask : undefined}
					onEdit={headerState === "confirm" ? onEdit : undefined}
				/>
			)}

			{/* Inputbox (always visible) */}
			<Inputbox {...inputProps} />

			{/* BoxAction (visible after initial input, when task has started) */}
			{state !== "input" && (
				<BoxAction
					tokens={tokens}
					taskTime={taskTime}
					status={taskStatus}
					disabled={replayDisabled}
					loading={replayLoading}
					onReplay={onReplay}
					onPauseResume={onPauseResume}
					pauseResumeLoading={pauseResumeLoading}
				/>
			)}
		</div>
	);
}

export { type FileAttachment, type QueuedMessage, type SubTask };