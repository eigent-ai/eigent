"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, AlertCircle, ChevronLeft } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TooltipSimple } from "@/components/ui/tooltip";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Overlay
		ref={ref}
		className={cn(
			"fixed inset-0 z-50 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
			className
		)}
		{...props}
	/>
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// Size variants for dialog content
const dialogContentVariants = cva(
	"fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-0 border border-solid border-popup-border bg-popup-bg shadow-perfect duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-xl",
	{
		variants: {
			size: {
				sm: "max-w-[400px]",
				md: "max-w-[600px]",
				lg: "max-w-[900px]",
			},
		},
		defaultVariants: {
			size: "md",
		},
	}
);

// Enhanced Dialog Content with size variants
interface DialogContentProps
	extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
		VariantProps<typeof dialogContentVariants> {
	showCloseButton?: boolean;
	closeButtonClassName?: string;
	closeButtonIcon?: React.ReactNode;
	onClose?: () => void;
}

const DialogContent = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Content>,
	DialogContentProps
>(({ className, children, size, showCloseButton = true, closeButtonClassName, closeButtonIcon, onClose, ...props }, ref) => (
	<DialogPortal>
		<DialogOverlay />
		<DialogPrimitive.Content
			ref={ref}
			className={cn(dialogContentVariants({ size }), className)}
			{...props}
		>
			{children}
			{showCloseButton && (
				<DialogPrimitive.Close asChild>
					<Button
						variant="ghost"
						size="icon"
						className={cn(
							"absolute right-4 top-4 focus:outline-none focus:ring-0 focus:ring-offset-0",
							closeButtonClassName
						)}
						onClick={onClose}
					>
						{closeButtonIcon || <X className="h-4 w-4" />}
						<span className="sr-only">Close</span>
					</Button>
				</DialogPrimitive.Close>
			)}
		</DialogPrimitive.Content>
	</DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

// Enhanced Dialog Header with title, subtitle, and tooltip support
interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
	title?: string;
	subtitle?: string;
	tooltip?: string;
	showTooltip?: boolean;
	showBackButton?: boolean;
	onBackClick?: () => void;
}

const DialogHeader = React.forwardRef<HTMLDivElement, DialogHeaderProps>(
	({ className, title, subtitle, tooltip, showTooltip = false, showBackButton = false, onBackClick, children, ...props }, ref) => (
		<div
			ref={ref}
			className={cn(
				"bg-popup-surface flex items-center justify-between p-4 relative shrink-0 w-full gap-2 overflow-hidden rounded-t-xl",
				className
			)}
			{...props}
		>
			<div className="flex items-center gap-2">
				{showBackButton && (
					<Button
						variant="ghost"
						size="icon"
						onClick={onBackClick}
						className="h-6 w-6 p-0 hover:bg-transparent"
					>
						<ChevronLeft className="h-4 w-4 text-icon-primary" />
					</Button>
				)}
				<div className="flex flex-col text-center sm:text-left">
					{title && (
						<div className="flex items-center gap-1">
							<DialogPrimitive.Title asChild>
								<span className="text-body-md font-bold text-text-heading my-[1px]">
									{title}
								</span>
							</DialogPrimitive.Title>
							{showTooltip && tooltip && (
								<TooltipSimple content={tooltip}>
									<AlertCircle className="h-4 w-4 text-icon-primary" />
								</TooltipSimple>
							)}
						</div>
					)}
					{subtitle && (
						<DialogPrimitive.Description asChild>
							<span className="text-label-sm text-text-label font-extralight mt-1">
								{subtitle}
							</span>
						</DialogPrimitive.Description>
					)}
				</div>
			</div>
			{children}
		</div>
	)
);
DialogHeader.displayName = "DialogHeader";

// Enhanced Dialog Content section
const DialogContentSection = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		className={cn("flex-1 p-4 min-h-0", className)}
		{...props}
	/>
));
DialogContentSection.displayName = "DialogContentSection";

// Enhanced Dialog Footer with button support
interface DialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {
	showConfirmButton?: boolean;
	showCancelButton?: boolean;
	confirmButtonText?: string;
	cancelButtonText?: string;
	onConfirm?: () => void;
	onCancel?: () => void;
	confirmButtonVariant?: "primary" | "secondary" | "outline" | "ghost" | "success" | "cuation" | "information" | "warning";
	cancelButtonVariant?: "primary" | "secondary" | "outline" | "ghost" | "success" | "cuation" | "information" | "warning";
}

const DialogFooter = React.forwardRef<HTMLDivElement, DialogFooterProps>(
	({ 
		className, 
		showConfirmButton = false,
		showCancelButton = false,
		confirmButtonText = "Confirm",
		cancelButtonText = "Cancel",
		onConfirm,
		onCancel,
		confirmButtonVariant = "primary",
		cancelButtonVariant = "outline",
		children,
		...props 
	}, ref) => (
		<div
			ref={ref}
			className={cn(
				"flex gap-2 items-center justify-end pb-4 pt-2 px-4 relative shrink-0 w-full",
				className
			)}
			{...props}
		>
			{children}
			{showCancelButton && (
				<Button
					variant={cancelButtonVariant}
					size="sm"
					onClick={onCancel}
				>
					{cancelButtonText}
				</Button>
			)}
			{showConfirmButton && (
				<Button
					variant={confirmButtonVariant}
					size="sm"
					onClick={onConfirm}
				>
					{confirmButtonText}
				</Button>
			)}
		</div>
	)
);
DialogFooter.displayName = "DialogFooter";

// Legacy DialogTitle for backward compatibility
const DialogTitle = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Title
		ref={ref}
		className={cn(
			"text-body-sm font-bold text-text-heading",
			className
		)}
		{...props}
	/>
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

// Legacy DialogDescription for backward compatibility
const DialogDescription = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Description
		ref={ref}
		className={cn("text-label-sm text-text-label", className)}
		{...props}
	/>
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
	Dialog,
	DialogPortal,
	DialogOverlay,
	DialogTrigger,
	DialogClose,
	DialogContent,
	DialogHeader,
	DialogContentSection,
	DialogFooter,
	DialogTitle,
	DialogDescription,
};
