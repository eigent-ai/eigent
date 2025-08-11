{
	/* <div className="">
# Token{" "}
{chatStore.tasks[chatStore.activeTaskId as string].tokens || 0}
</div> */
}

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const tagVariants = cva(
	"bg-tag-file-info !rounded-full py-0.5 px-2 text-tag-text-info text-xs leading-17 font-medium",
	{
		variants: {
			variant: {
				primary: "bg-tag-fill-info text-tag-text-info",
			},
			size: {
				sm: "inline-flex justify-start items-center gap-1 px-2 py-1 rounded-md text-xs font-medium leading-tight [&_svg]:size-[16px]",
			},
		},
		defaultVariants: {
			variant: "primary",
			size: "sm",
		},
	}
);


function Tag({
	className,
	variant,
	size,
	asChild = false,
	children,
	...props
}: React.ComponentProps<"div"> &
	VariantProps<typeof tagVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot : "div";

	return (
		<Comp
			className={cn(tagVariants({ variant, size, className }))}
			{...props}
		>
			{children}
		</Comp>
	);
}

export { Tag, tagVariants };
