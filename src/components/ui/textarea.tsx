import * as React from "react"

import { cn } from "@/lib/utils"
import { Button } from "./button"
import { TooltipSimple } from "./tooltip"
import { CircleAlert } from "lucide-react"

export type TextareaVariant = "none" | "enhanced"
export type TextareaSize = "default" | "sm"
export type TextareaState = "default" | "hover" | "input" | "error" | "success" | "disabled"

type BaseTextareaProps = Omit<React.ComponentProps<"textarea">, "size"> & {
  variant?: TextareaVariant
  size?: TextareaSize
  state?: TextareaState
  title?: string
  tooltip?: string
  note?: string
  required?: boolean
  leadingIcon?: React.ReactNode
  backIcon?: React.ReactNode
  onBackIconClick?: () => void
  trailingButton?: React.ReactNode
  onEnter?: () => void
}

const sizeClasses: Record<TextareaSize, string> = {
  default: "min-h-[60px] text-body-sm md:text-sm",
  sm: "min-h-[40px] text-body-sm",
}

function resolveStateClasses(state: TextareaState | undefined) {
  if (state === "disabled") {
    return {
      container: "opacity-50 cursor-not-allowed",
      field:
        "border-input-border-default bg-input-bg-default text-input-text-default",
      placeholder: "text-input-label-default",
    }
  }
  if (state === "hover") {
    return {
      container: "",
      field:
        "border-input-border-hover bg-input-bg-default text-input-text-default",
      placeholder: "text-input-label-default",
    }
  }
  if (state === "input") {
    return {
      container: "",
      field:
        "border-input-border-focus bg-input-bg-input text-input-text-focus",
      placeholder: "text-input-label-default",
    }
  }
  if (state === "error") {
    return {
      container: "",
      field:
        "border-input-border-cuation bg-input-bg-default text-text-body",
      placeholder: "text-input-label-default",
    }
  }
  if (state === "success") {
    return {
      container: "",
      field:
        "border-input-border-success bg-input-bg-confirm text-text-body",
      placeholder: "text-input-label-default",
    }
  }
  return {
    container: "",
    field:
      "border-input-border-default bg-input-bg-default text-input-text-default",
    placeholder: "text-input-label-default/10",
  }
}

const Textarea = React.forwardRef<HTMLTextAreaElement, BaseTextareaProps>(
  (
    {
      className,
      variant = "none",
      size = "default",
      state = "default",
      title,
      tooltip,
      note,
      required = false,
      leadingIcon,
      backIcon,
      onBackIconClick,
      trailingButton,
      disabled,
      placeholder,
      style,
      onEnter,
      ...props
    },
    ref
  ) => {
    const { onKeyDown, ...textareaProps } = props
    // Original "none" variant - keep the original styling
    if (variant === "none") {
      return (
        <>
          <textarea
            data-scrollbar="ui-textarea"
            className={cn(
              "flex min-h-[60px] w-full rounded-md border border-input bg-transparent pl-3 pr-3 py-2 text-body-md shadow-sm placeholder:text-text-label/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [scrollbar-gutter:stable]",
              className
            )}
            style={{ paddingRight: "4px", ...(style as React.CSSProperties) }}
            ref={ref}
            disabled={disabled}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                if (onEnter) {
                  e.preventDefault()
                  onEnter()
                }
              }
              onKeyDown?.(e)
            }}
            {...textareaProps}
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
    }

    // Enhanced variant with input-like functionality
    const stateCls = resolveStateClasses(disabled ? "disabled" : state)
    const hasLeft = Boolean(leadingIcon)
    const hasRight = Boolean(backIcon) || Boolean(trailingButton)

    return (
      <>
        <div className={cn("w-full", stateCls.container)}>
          {title ? (
            <div className="mb-1.5 flex items-center gap-1 text-body-sm font-bold text-text-heading">
              <span>{title}</span>
              {required && <span className="text-text-body">*</span>}
              {tooltip && (
                <TooltipSimple content={tooltip}>
                  <CircleAlert size={16} className="text-icon-primary" />
                </TooltipSimple>
              )}
            </div>
          ) : null}

          <div
            className={cn(
              "relative flex items-start rounded-lg border border-solid transition-colors",
              // Only apply hover/focus visuals when not in error state
              state !== "error" &&
                "hover:bg-input-bg-hover hover:border-input-border-hover focus-within:border-input-border-focus focus-within:bg-input-bg-input",
              stateCls.field,
              sizeClasses[size]
            )}
          >
            {leadingIcon ? (
              <span className="pointer-events-none absolute left-2 top-2 inline-flex h-5 w-5 items-center justify-center text-icon-primary">
                {leadingIcon}
              </span>
            ) : null}

            <textarea
              data-scrollbar="ui-textarea"
              ref={ref}
              disabled={disabled}
              placeholder={placeholder}
              className={cn(
                "peer border-none w-full bg-transparent outline-none placeholder:transition-colors resize-none [scrollbar-gutter:stable]",
                stateCls.placeholder,
                hasLeft ? "pl-9" : "pl-3",
                hasRight ? "pr-9" : "pr-3",
                "pt-2 pb-2",
                className
              )}
              style={{ paddingRight: "4px", ...(style as React.CSSProperties) }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  if (onEnter) {
                    e.preventDefault()
                    onEnter()
                  }
                }
                onKeyDown?.(e)
              }}
              {...textareaProps}
            />

            {backIcon ? (
              <Button
                variant="ghost"
                size="icon"
                type="button"
                tabIndex={-1}
                disabled={disabled}
                onClick={onBackIconClick}
              >
                {backIcon}
              </Button>
            ) : null}

            {trailingButton ? (
              <div className={cn("absolute right-2 top-2", backIcon ? "-mr-7" : "")}>{trailingButton}</div>
            ) : null}
          </div>

          {note ? (
            <div
              className={cn(
                "mt-1.5 !text-body-xs",
                state === "error"
                  ? "text-text-cuation"
                  : state === "success"
                  ? "text-text-success"
                  : "text-text-label"
              )}
              dangerouslySetInnerHTML={{
                __html: note.replace(
                  /(https?:\/\/[^\s]+)/g,
                  '<a href="$1" target="_blank" rel="noopener noreferrer" class="underline text-text-information hover:opacity-70 cursor-pointer transition-opacity duration-200">$1</a>'
                )
              }}
            />
          ) : null}
        </div>
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
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
