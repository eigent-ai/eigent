import { Button } from "@/components/ui/button";
import { Pause, Play, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FloatingActionProps {
	/** Current task status */
	status: "running" | "pause" | "pending" | "finished";
	/** Callback when pause button is clicked */
	onPause?: () => void;
	/** Callback when resume button is clicked */
	onResume?: () => void;
	/** Callback when skip to next is clicked */
	onSkip?: () => void;
	/** Loading state for pause/resume actions */
	loading?: boolean;
	/** Additional CSS classes */
	className?: string;
}

export const FloatingAction = ({
	status,
	onPause,
	onResume,
	onSkip,
	loading = false,
	className,
}: FloatingActionProps) => {
	// Only show when task is running or paused
	if (status !== "running" && status !== "pause") {
		return null;
	}

	return (
		<div
			className={cn(
				"sticky top-2 bottom-2 left-0 right-0 flex w-full justify-center items-center z-20 pointer-events-none",
				className
			)}
		>
			<div className="pointer-events-auto flex items-center gap-2 bg-bg-surface-primary/95 backdrop-blur-md rounded-full p-1 shadow-[0px_4px_16px_rgba(0,0,0,0.12)] border border-border-default">
				{status === "running" ? (
					// State 1: Running - Show Pause button
					<Button
						variant="cuation"
						size="sm"
						onClick={onPause}
						disabled={loading}
						className="rounded-full"
					>
						<span className="text-sm font-semibold">Pause</span>
					</Button>
				) : (
					// State 2: Paused - Show Resume and Skip buttons
					<>
						<Button
							variant="success"
							size="sm"
							onClick={onResume}
							disabled={loading}
							className="gap-1.5 rounded-full min-w-[80px]"
						>
							<Play className="w-3.5 h-3.5" />
							<span className="text-sm font-semibold">Resume</span>
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={onSkip}
							disabled={loading}
							className="gap-1.5 rounded-full"
						>
							<span className="text-sm font-semibold">Next Task</span>
						</Button>
					</>
				)}
			</div>
		</div>
	);
};