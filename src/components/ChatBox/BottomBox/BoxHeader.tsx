import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown, ChevronLeft, Circle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimateIcon } from "@/components/animate-ui/icons/icon";
import { Orbit } from "@/components/animate-ui/icons/orbit";

/**
 * Queued message item
 */
export interface QueuedMessage {
	id: string;
	content: string;
	timestamp?: number;
}

/**
 * Subtask item for confirmation
 */
export interface SubTask {
	id: string;
	content: string;
	status?: "pending" | "confirmed" | "rejected";
}

/**
 * BoxHeader State Types
 */
export type BoxHeaderState = "empty" | "queuing" | "splitting" | "confirm";

/**
 * BoxHeader Props
 */
export interface BoxHeaderProps {
	/** Current state of the header */
	state: BoxHeaderState;
	/** Queued messages (for queuing state) */
	queuedMessages?: QueuedMessage[];
	/** Subtasks (for confirm state) */
	subTasks?: SubTask[];
	/** Title text (not used, auto-generated based on state) */
	title?: string;
	/** Subtitle/description text (shown in confirm state only) */
	subtitle?: string;
	/** Callback when start task button is clicked (confirm state only) */
	onStartTask?: () => void;
	/** Callback when back/edit button is clicked (confirm state, triggered by lead button) */
	onEdit?: () => void;
	/** Callback when a queued message is removed */
	onRemoveQueuedMessage?: (id: string) => void;
	/** Callback when a subtask is removed */
	onRemoveSubTask?: (id: string) => void;
	/** Additional CSS classes */
	className?: string;
}

/**
 * BoxHeader Component
 * 
 * A multi-state header component for the chat box bottom area with four states:
 * 
 * - **Empty**: Hidden state (returns null)
 * - **Queuing**: Shows queued messages when a task is running and user inputs are queued
 *   - Header Top: Lead button (expand/collapse) + Title
 * - **Splitting**: Shows task splitting progress
 *   - Header Top: Lead button (expand/collapse) + Title
 * - **Confirm**: Shows subtasks for confirmation before starting
 *   - Header Top: Lead button (back/edit with chevron left) + Subtitle + Start Task button
 * 
 * Structure:
 * - Header Top: Lead button, title/subtitle, action button (confirm state only)
 * - Header Content: Accordion item list (queued messages or subtasks)
 * 
 * @example
 * ```tsx
 * // Queuing State
 * <BoxHeader
 *   state="queuing"
 *   queuedMessages={[
 *     { id: "1", content: "Search this reddit..." },
 *     { id: "2", content: "Create a report..." }
 *   ]}
 * />
 * 
 * // Confirm State
 * <BoxHeader
 *   state="confirm"
 *   subTasks={[
 *     { id: "1", content: "Research pricing..." },
 *     { id: "2", content: "Create comparison table..." }
 *   ]}
 *   subtitle="Get all the Stargazers' information..."
 *   onStartTask={() => console.log("Confirmed")}
 *   onEdit={() => console.log("Back to edit")}
 * />
 * ```
 */
export const BoxHeader = ({
	state,
	queuedMessages = [],
	subTasks = [],
	title,
	subtitle,
	onStartTask,
	onEdit,
	onRemoveQueuedMessage,
	onRemoveSubTask,
	className,
}: BoxHeaderProps) => {
	const [isExpanded, setIsExpanded] = useState(true);

	// Empty state - hide header
	if (state === "empty") {
		return null;
	}

	// Determine content based on state
	const items = state === "queuing" ? queuedMessages : subTasks;
	const showActionButton = state === "confirm";

	return (
		<div
			className={cn(
				"flex flex-col gap-1 items-start justify-center w-full",
				className
			)}
		>
		{/* Header Top */}
		<div className="box-border flex gap-1 items-center px-2.5 py-0 relative w-full">
			{/* Lead Button - Back/Edit for confirm state, Expand/Collapse for others (hidden for splitting state) */}
			{state !== "splitting" && (
				<Button
					variant="ghost"
					size="sm"
					className="px-1 focus-visible:outline-none focus:ring-0"
					onClick={state === "confirm" ? onEdit : () => setIsExpanded(!isExpanded)}
				>
					{state === "confirm" ? (
						<ChevronLeft size={16} className="text-icon-primary" />
					) : isExpanded ? (
						<ChevronUp size={16} className="text-icon-primary" />
					) : (
						<ChevronDown size={16} className="text-icon-primary" />
					)}
				</Button>
			)}

			{/* Middle - Title & Subtitle */}
			<div className="flex-1 flex gap-0.5 items-center min-h-px min-w-px relative">
					{/* Queuing State: Show Title only */}
					{state === "queuing" && (
						<>
							<div className="flex flex-coljustify-center relative shrink-0 mr-1">
								<span className="font-['Inter'] font-bold leading-17 text-text-body text-sm whitespace-nowrap">
									{queuedMessages.length}
								</span>
							</div>
							<div className="flex flex-col justify-center relative shrink-0">
								<span className="font-['Inter'] font-bold leading-17 text-text-body text-sm whitespace-nowrap">
									Queued Tasks
								</span>
							</div>
						</>
					)}

					{/* Splitting State: Show Title only */}
					{state === "splitting" && (
						<div className="flex items-center gap-1 justify-center relative shrink-0">
						 <div className="inline-flex justify-center items-center px-2 py-1">
							<AnimateIcon animate loop className="justify-center items-center h-4 w-4">
							  <Orbit size={16} className="text-icon-information" />
						  </AnimateIcon>
						 </div>
							<span className="font-['Inter'] font-bold leading-17 text-text-information text-sm whitespace-nowrap">
								Splitting Tasks
							</span>
						</div>
					)}

					{/* Confirm State: Show Subtitle only */}
					{state === "confirm" && subtitle && (
						<div className="flex-1 flex flex-col justify-center min-h-px min-w-px overflow-ellipsis overflow-hidden relative">
							<span className="font-['Inter'] font-normal leading-tight text-text-label text-xs whitespace-nowrap overflow-ellipsis overflow-hidden m-0">
								{subtitle}
							</span>
						</div>
					)}
				</div>

				{/* Right - Action Button (only for confirm state) */}
				{showActionButton && (
					<Button
						variant="success"
						size="sm"
						className="rounded-full"
						onClick={onStartTask}
					>
						Start Task
					</Button>
				)}
			</div>

		{/* Header Content - Accordion Items (hidden in confirm state) */}
		{state !== "confirm" && (
			<div
				className={cn(
					"box-border flex flex-col gap-1 items-start px-2 py-0 relative w-full overflow-y-auto scrollbar-always-visible transition-all duration-200 ease-in-out",
					isExpanded && items.length > 0 ? "max-h-[156px] opacity-100" : "max-h-0 opacity-0"
				)}
			>
				{state === "queuing" &&
					queuedMessages.map((msg) => (
						<QueueingItem
							key={msg.id}
							content={msg.content}
							onRemove={() => onRemoveQueuedMessage?.(msg.id)}
						/>
					))}
			</div>
		)}
		</div>
	);
};

/**
 * Queuing Item Component
 * Individual queued message item
 */
interface QueueingItemProps {
	content: string;
	onRemove?: () => void;
}

const QueueingItem = ({ content, onRemove }: QueueingItemProps) => {
	const [isHovered, setIsHovered] = useState(false);

	return (
		<div
			className="box-border flex gap-2 items-center px-1 py-1 relative w-full hover:bg-surface-secondary rounded-md transition-all duration-200 cursor-pointer"
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			{/* Circle Icon */}
			<div className="bg-transparent rounded-md w-5 h-5 p-0.5 flex items-center justify-center shrink-0">
				<Circle size={16} className="text-icon-secondary" />
			</div>

			{/* Content Text */}
			<div className="flex-1 flex flex-col justify-center leading-tight min-h-px min-w-px overflow-ellipsis overflow-hidden relative">
				<p className="font-['Inter'] font-normal leading-tight m-0 text-[10px] whitespace-nowrap overflow-ellipsis overflow-hidden">
					{content}
				</p>
			</div>

			{/* X Icon - Shows on hover from right side */}
			<Button
				variant="ghost"
				size="icon"
				className={cn(
					"rounded-md w-5 h-5 p-0.5 shrink-0 transition-all duration-200",
					isHovered 
						? "opacity-100 translate-x-0 hover:bg-button-transparent-fill-hover" 
						: "opacity-0 translate-x-2 pointer-events-none"
				)}
				onClick={(e) => {
					e.preventDefault();
					onRemove?.();
				}}
				aria-label="Remove queued message"
			>
				<X size={16} className="text-icon-secondary" />
			</Button>
		</div>
	);
};

/**
 * SubTask Item Component
 * Individual subtask item for confirmation
 */
interface SubTaskItemProps {
	content: string;
	status?: "pending" | "confirmed" | "rejected";
	onRemove?: () => void;
}

const SubTaskItem = ({ content, status = "pending", onRemove }: SubTaskItemProps) => {
	const [isHovered, setIsHovered] = useState(false);

	return (
		<div
			className="box-border flex gap-1 items-center px-0.5 py-0 relative w-full"
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			{/* Status Icon Button */}
			<Button
				variant="ghost"
				size="icon"
				className={cn(
					"rounded-md w-5 h-5 p-0.5 transition-colors",
					isHovered
						? "bg-button-transparent-fill-hover"
						: "bg-transparent"
				)}
				onClick={onRemove}
			>
				{isHovered ? (
					<X size={16} className="text-icon-secondary" />
				) : (
					<Circle
						size={16}
						className={cn(
							"text-icon-secondary",
							status === "confirmed" && "text-icon-success fill-current",
							status === "rejected" && "text-icon-cuation fill-current"
						)}
					/>
				)}
			</Button>

		{/* Content Text */}
		<div className="flex-1 flex flex-col justify-center leading-tight min-h-px min-w-px overflow-ellipsis overflow-hidden relative">
			<p
				className={cn(
					"font-['Inter'] font-normal leading-tight m-0 text-[10px] whitespace-nowrap overflow-ellipsis overflow-hidden",
					status === "confirmed" && "text-text-success",
					status === "rejected" && "text-text-cuation line-through",
					status === "pending" && "text-text-label"
				)}
			>
				{content}
			</p>
		</div>
	</div>
	);
};
