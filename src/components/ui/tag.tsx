import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const tagVariants = cva(
	"inline-flex justify-start items-center leading-relaxed",
	{
		variants: {
			variant: {
				primary: "bg-tag-fill-info text-[var(--tag-foreground-info)]",
				info: "bg-tag-fill-info !text-[var(--tag-foreground-info)]",
				success: "bg-tag-fill-success !text-[var(--tag-foreground-success)]",
				cuation: "bg-tag-fill-cuation !text-[var(--tag-foreground-cuation)]",
				warning: "bg-tag-fill-warning !text-[var(--tag-foreground-warning)]",
				default: "bg-tag-fill-default !text-[var(--tag-foreground-default)]",
				ghost: "bg-transparent !text-[var(--tag-foreground-default)]",
			},
			size: {
				xs: "px-2 py-0.5 gap-1 text-body-xs font-bold leading-tight [&_svg]:size-[10px] rounded-full",
				sm: "px-2 py-1.5 gap-1 text-body-xs font-bold leading-tight [&_svg]:size-[16px] rounded-full",
				md: "px-3 py-1.5 gap-2 text-body-md font-semibold leading-relaxed [&_svg]:size-[20px] rounded-xl",
			},
		},
		defaultVariants: {
			variant: "primary",
			size: "sm",
		},
	}
);

interface TagProps
	extends React.ComponentProps<"div">,
		VariantProps<typeof tagVariants> {
	asChild?: boolean;
	text?: string;
	icon?: React.ReactNode;
}

const Tag = React.forwardRef<HTMLDivElement, TagProps>(
	({ className, variant, size, asChild = false, text, icon, children, ...props }, ref) => {
		const Comp = asChild ? Slot : "div";

		// When asChild is true, just pass through the child without wrapping
		if (asChild) {
			return (
				<Comp
					ref={ref}
					className={cn(tagVariants({ variant, size, className }))}
					{...props}
				>
					{children}
				</Comp>
			);
		}

		// Normal rendering when asChild is false
		return (
			<Comp
				ref={ref}
				className={cn(tagVariants({ variant, size, className }))}
				{...props}
			>
				{icon && <span className="flex-shrink-0">{icon}</span>}
				{text && <span>{text}</span>}
				{children}
			</Comp>
		);
	}
);

Tag.displayName = "Tag";

export { Tag, tagVariants };
