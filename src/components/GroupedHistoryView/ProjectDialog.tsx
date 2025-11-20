import { useState, useEffect, useRef } from "react";
import { ProjectGroup } from "@/types/history";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogContentSection,
	DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import TaskItem from "./TaskItem";
import { useTranslation } from "react-i18next";
import {
	Hash,
	CheckCircle,
	Clock,
	Pin,
	Loader2,
	LoaderCircle,
} from "lucide-react";
import { useProjectStore } from "@/store/projectStore";

interface ProjectDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	project: ProjectGroup;
	onProjectRename: (projectId: string, newName: string) => void;
	onTaskSelect: (
		projectId: string,
		question: string,
		historyId: string
	) => void;
	onTaskDelete: (taskId: string) => void;
	onTaskShare: (taskId: string) => void;
	activeTaskId?: string;
}

export default function ProjectDialog({
	open,
	onOpenChange,
	project,
	onProjectRename,
	onTaskSelect,
	onTaskDelete,
	onTaskShare,
	activeTaskId,
}: ProjectDialogProps) {
	const { t } = useTranslation();
	const projectStore = useProjectStore();
	const [projectName, setProjectName] = useState(
		project.project_name || t("layout.new-project")
	);
	const [isSaving, setIsSaving] = useState(false);
	const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const lastSavedNameRef = useRef<string>(
		project.project_name || t("layout.new-project")
	);

	// Update state when project changes
	useEffect(() => {
		const name = project.project_name || t("layout.new-project");
		setProjectName(name);
		lastSavedNameRef.current = name;
	}, [project.project_name, project.project_id, t]);

	// Auto-save with debouncing
	useEffect(() => {
		// Clear any existing timeout
		if (saveTimeoutRef.current) {
			clearTimeout(saveTimeoutRef.current);
		}

		const trimmedName = projectName.trim();

		// Only save if the name has actually changed and is not empty
		if (trimmedName && trimmedName !== lastSavedNameRef.current) {
			setIsSaving(true);

			// Debounce: wait 800ms after user stops typing
			saveTimeoutRef.current = setTimeout(() => {
				// Update via callback (for history API)
				onProjectRename(project.project_id, trimmedName);

				// Also update in projectStore if the project exists there
				const storeProject = projectStore.getProjectById(project.project_id);
				if (storeProject) {
					projectStore.updateProject(project.project_id, { name: trimmedName });
				}

				lastSavedNameRef.current = trimmedName;
				setIsSaving(false);
			}, 800);
		} else if (!trimmedName) {
			// If empty, don't show saving state
			setIsSaving(false);
		}

		// Cleanup timeout on unmount or when projectName changes
		return () => {
			if (saveTimeoutRef.current) {
				clearTimeout(saveTimeoutRef.current);
			}
		};
	}, [projectName, project.project_id, onProjectRename, projectStore]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (saveTimeoutRef.current) {
				clearTimeout(saveTimeoutRef.current);
			}
		};
	}, []);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				size="md"
				className="max-h-[80vh] flex flex-col h-full"
				onClick={(e) => e.stopPropagation()}
				onMouseDown={(e) => e.stopPropagation()}
			>
				<DialogHeader
					title={t("layout.project-settings")}
					subtitle={t("layout.manage-project-details")}
					onClick={(e) => e.stopPropagation()}
					onMouseDown={(e) => e.stopPropagation()}
				/>

				<DialogContentSection
					className="flex flex-col overflow-y-auto scrollbar"
					onClick={(e) => e.stopPropagation()}
					onMouseDown={(e) => e.stopPropagation()}
				>
					{/* Project Name Section - Inline Edit with Auto-Save */}
					<div
						className="flex flex-col gap-sm mb-lg"
						onClick={(e) => e.stopPropagation()}
						onMouseDown={(e) => e.stopPropagation()}
					>
						<label className="text-text-label font-bold text-label-sm">
							{t("layout.project-name")}
						</label>
						<div
							className="flex items-center gap-sm"
							onClick={(e) => e.stopPropagation()}
							onMouseDown={(e) => e.stopPropagation()}
						>
							<Input
								disabled={true}
								value={projectName}
								onChange={(e) => setProjectName(e.target.value)}
								onClick={(e) => e.stopPropagation()}
								onMouseDown={(e) => e.stopPropagation()}
								onFocus={(e) => e.stopPropagation()}
								placeholder={t("layout.enter-project-name")}
							/>
							{isSaving ? (
								<Loader2 className="w-4 h-4 text-icon-action animate-spin flex-shrink-0" />
							) : (
								<></>
							)}
						</div>
					</div>

					{/* Project Stats */}
					<div className="grid grid-cols-4 gap-lg border-solid border-t-0 border-x-0 border-border-disabled pb-md">
						<div className="flex flex-col gap-xs">
							<span className="text-text-label text-label-sm font-normal">
								{t("layout.total-tokens")}
							</span>
							<div className="flex flex-row items-center gap-sm">
								<Hash className="w-4 h-4 text-icon-primary" />
								<span className="text-text-heading text-body-lg font-bold">
									{project.total_tokens.toLocaleString()}
								</span>
							</div>
						</div>

						<div className="flex flex-col gap-xs">
							<span className="text-text-label text-label-sm font-normal">
								{t("layout.total-tasks")}
							</span>
							<div className="flex flex-row items-center gap-sm">
								<Pin className="w-4 h-4 text-icon-primary" />
								<span className="text-text-heading text-body-lg font-bold">
									{project.task_count}
								</span>
							</div>
						</div>

						<div className="flex flex-col gap-xs">
							<span className="text-text-label text-label-sm font-normal">
								{t("layout.completed")}
							</span>
							<div className="flex flex-row items-center gap-sm">
								<CheckCircle className="w-4 h-4 text-icon-success" />
								<span className="text-text-heading text-body-lg font-bold">
									{project.total_completed_tasks}
								</span>
							</div>
						</div>

						<div className="flex flex-col gap-xs">
							<span className="text-text-label text-label-sm font-normal">
								{t("layout.ongoing")}
							</span>
							<div className="flex flex-row items-center gap-sm">
								<LoaderCircle className="w-4 h-4 text-icon-information" />
								<span className="text-text-heading text-body-lg font-bold">
									{project.total_ongoing_tasks}
								</span>
							</div>
						</div>
					</div>

					{/* Tasks List */}
					<div className="flex flex-col h-full gap-sm overflow-y-auto scrollbar mt-4">
						<div className="flex flex-col h-full gap-sm overflow-y-auto scrollbar">
							{project.tasks.length > 0 ? (
								project.tasks.map((task, index) => (
									<TaskItem
										key={task.id}
										task={task}
										isActive={activeTaskId === task.id.toString()}
										onSelect={() =>
											onTaskSelect(
												project.project_id,
												task.question,
												task.id.toString()
											)
										}
										onDelete={() => onTaskDelete(task.id.toString())}
										onShare={() => onTaskShare(task.id.toString())}
										isLast={index === project.tasks.length - 1}
										showActions={false}
									/>
								))
							) : (
								<div
									className="
                  text-center py-lg 
                  text-text-label text-sm
                "
								>
									<Clock className="w-8 h-8 mx-auto mb-sm text-icon-secondary opacity-50" />
									{t("layout.no-tasks-in-project")}
								</div>
							)}
						</div>
					</div>
				</DialogContentSection>

				<DialogFooter
					onClick={(e) => e.stopPropagation()}
					onMouseDown={(e) => e.stopPropagation()}
				>
					<Button
						variant="ghost"
						size="sm"
						onClick={(e) => {
							e.stopPropagation();
							onOpenChange(false);
						}}
					>
						{t("layout.close")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
