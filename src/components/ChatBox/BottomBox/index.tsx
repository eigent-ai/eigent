import { Inputbox, InputboxProps, FileAttachment } from "./InputBox";
import { BoxHeaderSplitting, BoxHeaderConfirm } from "./BoxHeader";
import { QueuedBox, QueuedMessage } from "./QueuedBox";
import { useTranslation } from "react-i18next";

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
	taskTime?: string;
	taskStatus?: 'running' | 'finished' | 'pending' | 'pause';

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
	inputProps,
}: BottomBoxProps) {
	const { t } = useTranslation();
	const enableQueuedBox = false; //TODO: Enable queued box https://github.com/eigent-ai/eigent/issues/684

	// Background color reflects current state only
	let backgroundClass = "bg-input-bg-default";
	if (state === "splitting") backgroundClass = "bg-input-bg-spliting";
	else if (state === "confirm") backgroundClass = "bg-input-bg-confirm";

	return (
		<div className="flex flex-col w-full relative z-50">
			{/* QueuedBox overlay (should not affect BoxMain layout) */}
			{enableQueuedBox && queuedMessages.length > 0 && (
				<div className="px-2 z-50 pointer-events-auto">
					<QueuedBox
						queuedMessages={queuedMessages}
						onRemoveQueuedMessage={onRemoveQueuedMessage}
					/>
				</div>
			)}
			{/* BoxMain */}
			<div className={`flex flex-col w-full p-2 rounded-t-lg ${backgroundClass}`}>
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
			</div>
		</div>
	);
}

export { type FileAttachment, type QueuedMessage };
