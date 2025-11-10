import { Inputbox, InputboxProps, FileAttachment } from "./InputBox";
import { BoxHeaderSplitting, BoxHeaderConfirm } from "./BoxHeader";
import { QueuedBox, QueuedMessage } from "./QueuedBox";
import { BoxAction } from "./BoxAction";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Rocket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";

export type BottomBoxState = "input" | "splitting" | "confirm" | "running" | "finished";

interface BottomBoxProps {
	// General state
	state: BottomBoxState;
	
	// Queue-related props
	queuedMessages?: QueuedMessage[];
	onRemoveQueuedMessage?: (id: string) => void;
	
    // Subtask-related props (confirm/splitting state)
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

    // Background color reflects current state only
    let backgroundClass = "bg-input-bg-default";
    if (state === "splitting") backgroundClass = "bg-input-bg-spliting";
    else if (state === "confirm") backgroundClass = "bg-input-bg-confirm";

	return (
		<div className="flex flex-col w-full overflow-hidden relative z-50">
			{/* QueuedBox overlay (should not affect BoxMain layout) */}
			{queuedMessages.length > 0 && (
				<div className="px-2 z-50 pointer-events-auto">
					<QueuedBox
							queuedMessages={queuedMessages}
							onRemoveQueuedMessage={onRemoveQueuedMessage}
						/>
				</div>
			)}
			{/* BoxMain */}
			<div className={`flex flex-col gap-2 w-full p-2 rounded-lg ${backgroundClass} overflow-hidden`}>
				{/* BoxHeader variants */}
				{state === "splitting" && (
						<BoxHeaderSplitting />
				)}
				{state === "confirm" && (
						<BoxHeaderConfirm
								subtitle={subtitle}
								onStartTask={onStartTask}
								onEdit={onEdit}
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
		</div>
	);
}

export { type FileAttachment, type QueuedMessage };
