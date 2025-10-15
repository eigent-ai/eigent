import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, style, ...props }, ref) => {
  return (
    <>
      <textarea
        data-scrollbar="ui-textarea"
        className={cn(
          "flex min-h-[60px] w-full rounded-md border border-input bg-transparent pl-3 pr-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm [scrollbar-gutter:stable]",
          className
        )}
        style={{ paddingRight: "4px", ...(style as React.CSSProperties) }}
        ref={ref}
        {...props}
      />
      <style>{`
        /* Firefox */
        [data-scrollbar="ui-textarea"] { scrollbar-width: thin; }
        /* Ensure 4px track in Firefox (thin is ~6px, so tighten via colors) */
        [data-scrollbar="ui-textarea"] { scrollbar-color: var(--scrollbar-thumb, rgba(0,0,0,0.3)) transparent; }
        /* WebKit */
        [data-scrollbar="ui-textarea"]::-webkit-scrollbar { width: 4px; height: 4px; }
        [data-scrollbar="ui-textarea"]::-webkit-scrollbar-thumb { background-color: var(--scrollbar-thumb, rgba(0,0,0,0.3)); border-radius: 9999px; }
        [data-scrollbar="ui-textarea"]::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </>
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
