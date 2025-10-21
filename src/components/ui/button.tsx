import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center whitespace-nowrap transition-all duration-200 ease-in-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20  aria-invalid:border-destructive",
	{
		variants: {
			variant: {
				primary:
					"bg-button-primary-fill-default !text-button-primary-text-default font-bold rounded-xs shadow-button-shadow hover:bg-button-primary-fill-hover active:bg-button-primary-fill-active focus:bg-button-primary-fill-hover focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer ",
				secondary:
					"bg-button-secondary-fill-default !text-button-secondary-text-default font-bold rounded-xs shadow-button-shadow hover:bg-button-secondary-fill-hover active:bg-button-secondary-fill-active focus:bg-button-secondary-hover focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer",
				outline:
					"bg-button-tertiery-fill-default !text-button-tertiery-text-default font-bold rounded-xs shadow-button-shadow hover:bg-button-tertiery-fill-hover active:bg-button-tertiery-fill-active focus:bg-button-tertiery-hover focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer",
				ghost:
					"bg-button-transparent-fill-default !text-button-transparent-text-default font-bold rounded-xs hover:bg-button-transparent-fill-hover active:bg-button-transparent-fill-active focus:bg-button-transparent-fill-hover focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer",
				success:
					"bg-button-fill-success !text-button-fill-success-foreground font-bold rounded-xs shadow-button-shadow hover:bg-fill-fill-success-hover active:bg-fill-fill-success-active focus:bg-fill-fill-success-hover focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer",
				cuation:
					"bg-button-fill-cuation !text-button-fill-cuation-foreground font-bold rounded-xs shadow-button-shadow focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer",
				information:
					"bg-button-fill-information !text-button-fill-information-foreground font-bold rounded-xs shadow-button-shadow focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer",
				warning:
					"bg-button-fill-warning !text-button-fill-warning-foreground font-bold rounded-xs shadow-button-shadow focus:ring-2 focus:ring-gray-4 focus:ring-offset-2 cursor-pointer",
				},
			size: {
				xxs: "inline-flex justify-start items-center gap-1 px-1 py-0.5 rounded-md text-label-xs font-bold [&_svg]:size-16",
				xs: "inline-flex justify-start items-center gap-1 px-2 py-1 rounded-md text-label-xs font-bold [&_svg]:size-10",
				sm: "inline-flex justify-start items-center gap-1 px-2 py-1 rounded-md text-label-sm font-medium [&_svg]:size-[16px]",
				md: "inline-flex justify-start items-center gap-2 px-4 py-2 rounded-md text-label-md font-medium [&_svg]:size-[24px]",
				lg: "inline-flex justify-start items-center gap-sm px-4 py-2 rounded-md text-label-lg font-bold [&_svg]:size-[24px]",
				icon: "inline-flex justify-start items-center gap-1 px-1 py-1 rounded-md [&_svg]:size-10",
			},
		},
		defaultVariants: {
			variant: "primary",
			size: "md",
		},
	}
);

const Button = React.forwardRef<
	HTMLButtonElement,
	React.ComponentProps<"button"> &
		VariantProps<typeof buttonVariants> & { asChild?: boolean }
>(({ className, variant, size, asChild = false, children, ...props }, ref) => {
	const Comp = asChild ? Slot : "button";

	return (
		<Comp
			data-slot="button"
			className={cn(buttonVariants({ variant, size, className }))}
			ref={ref}
			{...props}
		>
			{children}
			{/* {variant === "primary" && <div />} */}
		</Comp>
	);
});

Button.displayName = "Button";

export { Button, buttonVariants };
