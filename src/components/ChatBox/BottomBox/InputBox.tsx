import { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

import { ExpandedInputBox } from "./ExpandedInputBox";
import { TriggerDialog } from "@/components/Trigger/TriggerDialog";
import { ArrowRight, X, Image, FileText, UploadCloud, Plus, Zap, Maximize } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { TriggerInput } from "@/types";

// Module-level singleton to track which InputBox instance has the expanded dialog open
// This prevents multiple dialogs from opening when Cmd+P is pressed
let activeExpandedDialogId: string | null = null;

/**
 * File attachment object
 */
export interface FileAttachment {
	fileName: string;
	filePath: string;
}

/**
 * Inputbox Props
 */
export interface InputboxProps {
	/** Current text value */
	value?: string;
	/** Callback when text changes */
	onChange?: (value: string) => void;
	/** Callback when send button is clicked (only fires when value is not empty) */
	onSend?: () => void;
	/** Array of file attachments */
	files?: FileAttachment[];
	/** Callback when files are modified */
	onFilesChange?: (files: FileAttachment[]) => void;
	/** Callback when add file button is clicked */
	onAddFile?: () => void;
	/** Placeholder text for empty state */
	placeholder?: string;
	/** Disable all interactions */
	disabled?: boolean;
	/** Additional CSS classes */
	className?: string;
	/** Ref for textarea */
	textareaRef?: React.RefObject<HTMLTextAreaElement>;
	/** Allow drag and drop */
	allowDragDrop?: boolean;
	/** Privacy mode enabled */
	privacy?: boolean;
	/** Use cloud model in dev */
	useCloudModelInDev?: boolean;

	/** Callback when trigger is being created (for placeholder) */
	onTriggerCreating?: (triggerData: TriggerInput) => void;
	/** Callback when trigger is created successfully */
	onTriggerCreated?: (triggerData: TriggerInput) => void;
	/** Hide the expand button (used when InputBox is already inside ExpandedInputBox) */
	hideExpandButton?: boolean;
}

/**
 * Inputbox Component
 * 
 * A multi-state input component with two visual states:
 * - **Default**: Empty state with placeholder text and disabled send button
 * - **Focus/Input**: Active state with content, file attachments, and active send button
 * 
 * Features:
 * - Auto-expanding textarea (up to 100px height)
 * - File attachment display (shows up to 5 files + count indicator)
 * - Action buttons (add file on left, send on right)
 * - Send button changes color based on content (gray when empty, green when has content)
 * - Arrow icon rotates when there's content
 * - Supports Enter to send, Shift+Enter for new line
 * - Drag and drop file support
 * 
 * @example
 * ```tsx
 * const [message, setMessage] = useState("");
 * const [files, setFiles] = useState<FileAttachment[]>([]);
 * 
 * <Inputbox
 *   value={message}
 *   onChange={setMessage}
 *   onSend={() => {
 *     console.log("Sending:", message);
 *     setMessage("");
 *   }}
 *   files={files}
 *   onFilesChange={setFiles}
 *   onAddFile={() => {
 *     // Open file picker
 *   }}
 *   placeholder="What do you need to achieve today?"
 *   allowDragDrop={true}
 * />
 * ```
 */

export const Inputbox = ({
	value = "",
	onChange,
	onSend,
	files = [],
	onFilesChange,
	onAddFile,
	placeholder = "Ask Eigent to automate your tasks",
	disabled = false,
	className,
	textareaRef: externalTextareaRef,
	allowDragDrop = false,
	privacy = true,
	useCloudModelInDev = false,
	onTriggerCreating,
	onTriggerCreated,
	hideExpandButton = false,
}: InputboxProps) => {
	const { t } = useTranslation();
	const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
	const textareaRef = externalTextareaRef || internalTextareaRef;
	const [isFocused, setIsFocused] = useState(false);
	const [isDragging, setIsDragging] = useState(false);
	const dragCounter = useRef(0);
	const [hoveredFilePath, setHoveredFilePath] = useState<string | null>(null);
	const [isRemainingOpen, setIsRemainingOpen] = useState(false);
	const hoverCloseTimerRef = useRef<number | null>(null);
	const [isComposing, setIsComposing] = useState(false);
	const [isExpandedDialogOpen, setIsExpandedDialogOpen] = useState(false);
	const [triggerDialogOpen, setTriggerDialogOpen] = useState(false);
	const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);
	const instanceIdRef = useRef<string>(`inputbox-${Math.random().toString(36).substr(2, 9)}`);



	// Handle dialog open/close with singleton tracking
	const handleExpandedDialogChange = useCallback((open: boolean) => {
		if (open) {
			activeExpandedDialogId = instanceIdRef.current;
			setIsExpandedDialogOpen(true);
		} else {
			if (activeExpandedDialogId === instanceIdRef.current) {
				activeExpandedDialogId = null;
			}
			setIsExpandedDialogOpen(false);
		}
	}, []);

	const openRemainingPopover = () => {
		if (hoverCloseTimerRef.current) {
			window.clearTimeout(hoverCloseTimerRef.current);
			hoverCloseTimerRef.current = null;
		}
		setIsRemainingOpen(true);
	};

	const scheduleCloseRemainingPopover = () => {
		if (hoverCloseTimerRef.current) {
			window.clearTimeout(hoverCloseTimerRef.current);
		}
		hoverCloseTimerRef.current = window.setTimeout(() => {
			setIsRemainingOpen(false);
			hoverCloseTimerRef.current = null;
		}, 150);
	};

	// Keyboard shortcut handler for Cmd+P / Ctrl+P
	// Opens dialog if none is open, or closes if this instance owns the open dialog
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
				e.preventDefault();

				// If this instance has the dialog open, close it
				if (isExpandedDialogOpen && activeExpandedDialogId === instanceIdRef.current) {
					handleExpandedDialogChange(false);
				}
				// If no dialog is open, open this one
				else if (activeExpandedDialogId === null) {
					handleExpandedDialogChange(true);
				}
				// Otherwise another instance has it open, do nothing
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [isExpandedDialogOpen, handleExpandedDialogChange]);

	// Auto-resize textarea on value changes (hug content up to max height)
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
	}, [value, textareaRef]);

	// Determine if we're in the "Input" state (has content or files)
	const hasContent = value.trim().length > 0 || files.length > 0;
	const isActive = isFocused || hasContent;

	const handleTextChange = (newValue: string) => {
		onChange?.(newValue);
	};

	const handleSend = () => {
		if (value.trim().length > 0 && !disabled) {
			onSend?.();
		} else if (value.trim().length === 0) {
			toast.error(t("chat.message-cannot-be-empty"), {
				closeButton: true,
			});
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey && !disabled && !isComposing) {
			e.preventDefault();
			handleSend();
		}
	};

	const handleRemoveFile = (filePath: string) => {
		const newFiles = files.filter((f) => f.filePath !== filePath);
		onFilesChange?.(newFiles);
	};

	const getFileIcon = (fileName: string) => {
		const ext = fileName.split(".").pop()?.toLowerCase() || "";
		if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
			return <Image className="w-4 h-4 text-icon-primary" />;
		}
		return <FileText className="w-4 h-4 text-icon-primary" />;
	};

	// Drag & drop handlers
	const isFileDrag = (e: React.DragEvent) => {
		try {
			return Array.from(e.dataTransfer?.types || []).includes("Files");
		} catch {
			return false;
		}
	};

	const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
		if (!allowDragDrop || !privacy || useCloudModelInDev) return;
		if (!isFileDrag(e)) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "copy";
		setIsDragging(true);
	};

	const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
		if (!allowDragDrop || !privacy || useCloudModelInDev) return;
		if (!isFileDrag(e)) return;
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current += 1;
		setIsDragging(true);
	};

	const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current = Math.max(0, dragCounter.current - 1);
		if (dragCounter.current === 0) setIsDragging(false);
	};

	const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(false);
		dragCounter.current = 0;
		if (!allowDragDrop || !privacy || useCloudModelInDev) return;
		try {
			const dropped = Array.from(e.dataTransfer?.files || []);
			if (dropped.length === 0) return;
			const mapped = dropped.map((f: File) => ({
				fileName: f.name,
				filePath: (f as any).path || f.name,
			}));
			const newFiles = [
				...files.filter((f: FileAttachment) => !mapped.find((m) => m.filePath === f.filePath)),
				...mapped.filter((m) => !files.find((f) => f.filePath === m.filePath)),
			];
			onFilesChange?.(newFiles);
		} catch (error) {
			console.error("Drop File Error:", error);
		}
	};

	// Determine remaining files count (show max 5 files + count tag)
	const maxVisibleFiles = 5;
	const visibleFiles = files.slice(0, maxVisibleFiles);
	const remainingCount = files.length > maxVisibleFiles ? files.length - maxVisibleFiles : 0;

	return (
		<div
			className={cn(
				"bg-input-bg-input box-border flex flex-col items-start pb-2 pt-0 px-2 relative rounded-2xl w-full border border-solid border-input-border-default transition-colors",
				isFocused && "border-input-border-focus",
				isDragging && "border-info-primary bg-info-primary/10",
				className
			)}
			onDragEnter={handleDragEnter}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{isDragging && (
				<div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-info-primary bg-info-primary/10 text-info-primary backdrop-blur-sm">
					<UploadCloud className="w-8 h-8" />
					<div className="text-sm font-semibold">{t('chat.drop-files-to-attach')}</div>
				</div>
			)}

			{/* Text Input Area */}
			<div className="box-border flex flex-1 gap-2.5 items-start justify-center pb-2 pt-2.5 px-0 relative w-full">
				<div className="flex-1 box-border flex gap-2.5 items-center justify-center min-h-px min-w-px mx-2 py-0 relative">
					<Textarea
						variant="none"
						size="default"
						ref={textareaRef}
						value={value}
						onChange={(e) => handleTextChange(e.target.value)}
						onKeyDown={handleKeyDown}
						onCompositionStart={() => setIsComposing(true)}
						onCompositionEnd={() => setIsComposing(false)}
						onFocus={() => setIsFocused(true)}
						onBlur={() => setIsFocused(false)}
						disabled={disabled}
						placeholder={t("chat.ask-placeholder")}
						className={cn(
							"flex-1 resize-none",
							"border-none shadow-none focus-visible:ring-0 focus-visible:outline-none",
							"px-0 py-0 min-h-[40px] max-h-[200px]",
							"scrollbar overflow-auto",
							isActive ? "text-input-text-focus" : "text-input-text-default"
						)}
						style={{
							fontFamily: "Inter",
						}}
						rows={1}
						onInput={(e) => {
							const el = e.currentTarget;
							el.style.height = "auto";
							el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
						}}
					/>
				</div>
			</div>

			{/* File Attachments (only show if has files) */}
			{files.length > 0 && (
				<div className="box-border flex flex-wrap gap-1 items-start pb-2 pt-0 relative w-full">
					{visibleFiles.map((file) => {
						const isHovered = hoveredFilePath === file.filePath;
						return (
							<div
								key={file.filePath}
								className={cn(
									"bg-tag-surface box-border flex gap-0.5 items-center relative rounded-lg max-w-32 h-auto pr-1"
								)}
								onMouseEnter={() => setHoveredFilePath(file.filePath)}
								onMouseLeave={() => setHoveredFilePath((prev) => (prev === file.filePath ? null : prev))}
							>
								{/* File icon as a link that turns into remove on hover */}
								<a
									href="#"
									className={cn(
										"rounded-md cursor-pointer flex items-center justify-center w-6 h-6"
									)}
									onClick={(e) => {
										e.preventDefault();
										e.stopPropagation();
										handleRemoveFile(file.filePath);
									}}
									title={isHovered ? t("chat.remove-file") : file.fileName}
								>
									{isHovered ? (
										<X className="text-icon-secondary size-4" />
									) : (
										getFileIcon(file.fileName)
									)}
								</a>

								{/* File Name */}
								<p
									className={cn(
										"flex-1 font-['Inter'] font-bold leading-tight min-h-px min-w-px overflow-ellipsis overflow-hidden relative text-text-body text-xs whitespace-nowrap my-0"
									)}
									title={file.fileName}
								>
									{file.fileName}
								</p>
							</div>
						);
					})}
					{/* Show remaining count if more than 5 files */}
					{remainingCount > 0 && (
						<Popover open={isRemainingOpen} onOpenChange={setIsRemainingOpen}>
							<PopoverTrigger asChild>
								<Button
									size="icon"
									variant="ghost"
									className="bg-tag-surface box-border flex items-center relative rounded-lg h-auto"
									onMouseEnter={openRemainingPopover}
									onMouseLeave={scheduleCloseRemainingPopover}
									onClick={(e) => {
										e.stopPropagation();
									}}
								>
									<p className="font-['Inter'] font-bold leading-tight text-text-body text-xs whitespace-nowrap my-0">
										{remainingCount}+
									</p>
								</Button>
							</PopoverTrigger>
							<PopoverContent
								align="end"
								sideOffset={4}
								className="!w-auto max-w-40 p-1 rounded-md border border-dropdown-border bg-dropdown-bg shadow-perfect"
								onMouseEnter={openRemainingPopover}
								onMouseLeave={scheduleCloseRemainingPopover}
							>
								<div className="max-h-[176px] overflow-auto scrollbar-hide gap-1 flex flex-col">
									{files.slice(maxVisibleFiles).map((file) => {
										const isHovered = hoveredFilePath === file.filePath;
										return (
											<div
												key={file.filePath}
												className="flex items-center gap-1 px-1 py-0.5 bg-tag-surface hover:bg-tag-surface-hover transition-colors duration-300 cursor-pointer rounded-lg"
												onMouseEnter={() => setHoveredFilePath(file.filePath)}
												onMouseLeave={() => setHoveredFilePath((prev) => (prev === file.filePath ? null : prev))}
											>
												<a
													href="#"
													className={cn(
														"rounded-md cursor-pointer flex items-center justify-center w-6 h-6"
													)}
													onClick={(e) => {
														e.preventDefault();
														e.stopPropagation();
														handleRemoveFile(file.filePath);
														setIsRemainingOpen(false);
													}}
													title={isHovered ? t("chat.remove-file") : file.fileName}
												>
													{isHovered ? <X className="text-icon-secondary size-4" /> : getFileIcon(file.fileName)}
												</a>
												<p className="flex-1 font-['Inter'] font-bold leading-tight text-text-body text-xs whitespace-nowrap my-0 overflow-hidden text-ellipsis">
													{file.fileName}
												</p>
											</div>
										);
									})}
								</div>
							</PopoverContent>
						</Popover>
					)}
				</div>
			)}

			{/* Action Buttons */}
			<div className="flex items-center justify-between relative w-full">
				{/* Left: Add File Button and Add Trigger Button */}
				<div className="flex items-center relative gap-1">
					<Button
						variant="outline"
						size="icon"
						className="shadow-none rounded-lg"
						onClick={onAddFile}
						disabled={disabled || !privacy || useCloudModelInDev}
					>
						<Plus
							size={16}
							className="text-icon-primary"
						/>
					</Button>

					{/* Add Trigger Button - opens TriggerDialog */}
					<Button
						variant="ghost"
						size="xs"
						className="rounded-lg"
						disabled={disabled}
						onClick={() => setTriggerDialogOpen(true)}
					>
						<Zap size={16} className="text-icon-primary" />
						{t('triggers.trigger-label')}
					</Button>

					{/* TriggerDialog for adding trigger and task */}
					<TriggerDialog
						selectedTrigger={null}
						onTriggerCreating={onTriggerCreating || (() => { })}
						onTriggerCreated={onTriggerCreated || (() => { })}
						isOpen={triggerDialogOpen}
						onOpenChange={setTriggerDialogOpen}
						initialTaskPrompt={value}
					/>
				</div>

				<div className="flex items-center gap-1">
					{/* Expand Input Dialog Button - hidden when inside ExpandedInputBox */}
					{!hideExpandButton && (
						<Button
							variant="ghost"
							size="icon"
							className="rounded-lg"
							onClick={() => handleExpandedDialogChange(true)}
							disabled={disabled}
							title={t("chat.expand-input")}
						>
							<Maximize
								size={16}
								className="text-icon-primary"
							/>
						</Button>
					)}
					<Button
						size="icon"
						variant={value.trim().length > 0 ? "success" : "secondary"}
						className="rounded-full"
						onClick={handleSend}
						disabled={disabled || value.trim().length === 0}
					>
						<ArrowRight
							size={16}
							className={cn(
								"text-button-primary-icon-default transition-transform duration-200",
								value.trim().length > 0 && "rotate-[-90deg]"
							)}
						/>
						{/* Inner shadow highlight (from Figma design) */}
						<div className="absolute inset-0 pointer-events-none shadow-[0px_1px_0px_0px_inset_rgba(255,255,255,0.33)]" />
					</Button>
				</div>
			</div>

			{/* Expanded Input Box */}
			<AnimatePresence>
				{isExpandedDialogOpen && (
					<ExpandedInputBox
						inputProps={{
							value,
							onChange,
							onSend,
							files,
							onFilesChange,
							onAddFile,
							disabled,
							privacy,
							useCloudModelInDev,
						}}
						onClose={() => handleExpandedDialogChange(false)}
					/>
				)}
			</AnimatePresence>
		</div>
	);
};