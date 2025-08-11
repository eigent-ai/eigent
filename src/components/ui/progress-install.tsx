import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

const ProgressInstall = React.forwardRef<
	React.ElementRef<typeof ProgressPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
	<ProgressPrimitive.Root
		ref={ref}
		className={cn(
			"relative h-3 w-full overflow-hidden rounded-full bg-specialty-progress-surface",
			className
		)}
		{...props}
	>
		<ProgressPrimitive.Indicator
			className={`h-full w-full flex-1 transition-all`}
			style={{
				transform: `translateX(-${100 - (value || 0)}%)`,
				background:
					"linear-gradient(90deg, var(--colors-blue-300, #8EC5FF) 0%, var(--colors-emerald-300, #5EE9B5) 17.79%, var(--colors-fuchsia-300, #F4A8FF) 36.06%, var(--colors-orange-300, #FFB86A) 53.37%, var(--colors-red-300, #FFA2A2) 68.27%, var(--colors-yellow-300, #FFDF20) 80.29%, var(--colors-amber-300, #FFD230) 89.42%, var(--colors-indigo-300, #A3B3FF) 98.44%)",
			}}
		/>
	</ProgressPrimitive.Root>
));
ProgressInstall.displayName = ProgressPrimitive.Root.displayName;

export { ProgressInstall };
