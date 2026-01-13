import { useMemo } from "react";
import { CircleDashed, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TaskType } from "./TaskType";
import { Progress } from "@/components/ui/progress";

interface StreamingTaskListProps {
	streamingText: string;
}

/**
 * Parse streaming task text and extract task content
 * Supports formats:
 * - <task>content</task>
 * - <task>content (incomplete, still streaming)
 */
function parseStreamingTasks(text: string): { tasks: string[]; isStreaming: boolean } {
	const tasks: string[] = [];

	// Match complete tasks: <task>content</task>
	const completeTaskRegex = /<task>([\s\S]*?)<\/task>/g;
	let match;
	while ((match = completeTaskRegex.exec(text)) !== null) {
		const content = match[1].trim();
		if (content) {
			tasks.push(content);
		}
	}

	// Check for incomplete task (streaming): <task>content without closing tag
	const lastOpenTag = text.lastIndexOf("<task>");
	const lastCloseTag = text.lastIndexOf("</task>");

	let isStreaming = false;
	if (lastOpenTag > lastCloseTag) {
		// There's an unclosed <task> tag - extract its content
		const incompleteContent = text.substring(lastOpenTag + 6).trim();
		if (incompleteContent) {
			tasks.push(incompleteContent);
			isStreaming = true;
		}
	}

	return { tasks, isStreaming };
}

export function StreamingTaskList({ streamingText }: StreamingTaskListProps) {
	const { t } = useTranslation();
	const { tasks, isStreaming } = useMemo(() => parseStreamingTasks(streamingText), [streamingText]);

	if (tasks.length === 0) {
		// Show a loading state when no tasks have been parsed yet
		return (
			<div className="w-full h-auto flex flex-col gap-2 pl-2 py-sm transition-all duration-300">
				<div className="w-full h-auto bg-task-surface backdrop-blur-[5px] rounded-xl py-sm relative overflow-hidden">
					<div className="absolute top-0 left-0 w-full bg-transparent">
						<Progress value={100} className="h-[2px] w-full" />
					</div>
					<div className="flex items-center gap-2 px-sm py-2">
						<LoaderCircle size={16} className="text-icon-information animate-spin" />
						<span className="text-sm text-text-secondary animate-pulse">{t("layout.task-splitting")}...</span>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="w-full h-auto flex flex-col gap-2 pl-2 py-sm transition-all duration-300">
			<div className="w-full h-auto bg-task-surface backdrop-blur-[5px] rounded-xl py-sm relative overflow-hidden">
				{/* Progress bar at top */}
				<div className="absolute top-0 left-0 w-full bg-transparent">
					<Progress value={100} className="h-[2px] w-full" />
				</div>

				{/* Task type badge */}
				<div className="flex items-center gap-2 px-sm mb-2">
					<TaskType type={1} />
					<span className="text-text-tertiary text-xs font-medium">
						{t("layout.tasks")} {tasks.length}
					</span>
				</div>

				{/* Task list */}
				<div className="mt-sm flex flex-col px-sm">
					{tasks.map((task, index) => {
						const isLastTask = index === tasks.length - 1;
						const isCurrentlyStreaming = isLastTask && isStreaming;

						return (
							<div
								key={`streaming-task-${index}`}
								className="relative min-h-2 flex items-start p-sm group rounded-lg animate-in fade-in-0 slide-in-from-left-2 duration-300"
							>
								{/* Task indicator */}
								<div className="w-7 h-4 pt-1 pr-sm flex items-center justify-center flex-shrink-0">
									{isCurrentlyStreaming ? (
										<LoaderCircle size={13} className="text-icon-information animate-spin" />
									) : (
										<CircleDashed size={13} className="text-icon-secondary" />
									)}
								</div>

								{/* Task content */}
								<div className="relative min-h-4 pb-2 w-full border-[0px] border-b border-solid border-task-border-default flex items-start">
									<span className="text-xs leading-[20px] text-text-primary">
										{task}
										{isCurrentlyStreaming && (
											<span className="inline-block w-1 h-4 ml-0.5 bg-icon-information animate-pulse" />
										)}
									</span>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
