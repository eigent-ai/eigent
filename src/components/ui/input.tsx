import * as React from "react"

import { cn } from "@/lib/utils"
import { Button } from "./button"
import { TooltipSimple } from "./tooltip"
import { CircleAlert } from "lucide-react"

export type InputSize = "default" | "sm"
export type InputState = "default" | "hover" | "input" | "error" | "success" | "disabled"

type BaseInputProps = Omit<React.ComponentProps<"input">, "size"> & {
  size?: InputSize
  state?: InputState
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

const sizeClasses: Record<InputSize, string> = {
  default: "h-10 text-body-sm md:text-sm",
  sm: "h-8 text-body-sm",
}

function resolveStateClasses(state: InputState | undefined) {
  if (state === "disabled") {
    return {
      container: "opacity-50 cursor-not-allowed",
      field:
        "border-input-border-default bg-input-bg-default text-input-text-default",
      placeholder: "placeholder-input-label-default",
    }
  }
  if (state === "hover") {
    return {
      container: "",
      field:
        "border-input-border-hover bg-input-bg-default text-input-text-default",
      placeholder: "placeholder-input-label-default",
    }
  }
  if (state === "input") {
    return {
      container: "",
      field:
        "border-input-border-focus bg-input-bg-input text-input-text-focus",
      placeholder: "placeholder-input-label-default",
    }
  }
  if (state === "error") {
    return {
      container: "",
      field:
        "border-input-border-cuation bg-input-bg-default text-text-body",
      placeholder: "placeholder-input-label-default",
    }
  }
  if (state === "success") {
    return {
      container: "",
      field:
        "border-input-border-success bg-input-bg-confirm text-text-body",
      placeholder: "placeholder-input-label-default",
    }
  }
  return {
    container: "",
    field:
      "border-input-border-default bg-input-bg-default text-input-text-default",
    placeholder: "placeholder-input-label-default/10",
  }
}

const Input = React.forwardRef<HTMLInputElement, BaseInputProps>(
  (
    {
      className,
      type,
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
      onEnter,
      ...props
    },
    ref
  ) => {
    const { onKeyDown, ...inputProps } = props
    const stateCls = resolveStateClasses(disabled ? "disabled" : state)
    const hasLeft = Boolean(leadingIcon)
    const hasRight = Boolean(backIcon) || Boolean(trailingButton)

    return (
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
            "relative flex items-center rounded-md border border-solid shadow-sm transition-colors",
            // Only apply hover/focus visuals when not in error state
            state !== "error" &&
              "hover:bg-input-bg-hover hover:border-input-border-hover focus-within:border-input-border-focus focus-within:bg-input-bg-input",
            stateCls.field,
            sizeClasses[size]
          )}
        >
          {leadingIcon ? (
            <span className="pointer-events-none absolute left-2 inline-flex h-5 w-5 items-center justify-center text-icon-primary">
              {leadingIcon}
            </span>
          ) : null}

          <input
            type={type}
            ref={ref}
            disabled={disabled}
            placeholder={placeholder}
            className={cn(
              "peer w-full bg-transparent outline-none placeholder:transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium",
              stateCls.placeholder,
              hasLeft ? "pl-9" : "pl-3",
              hasRight ? "pr-9" : "pr-3",
              className
            )}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onEnter?.()
              }
              onKeyDown?.(e)
            }}
            {...inputProps}
          />

          {backIcon ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tabIndex={-1}
              className="absolute right-2 inline-flex h-5 w-5 items-center justify-center text-icon-primary disabled:opacity-50 rounded-full focus:ring-0"
              disabled={disabled}
              onClick={onBackIconClick}
            >
              {backIcon}
            </Button>
          ) : null}

          {trailingButton ? (
            <div className={cn("absolute right-2", backIcon ? "-mr-7" : "")}>{trailingButton}</div>
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
    )
  }
)
Input.displayName = "Input"

export { Input }
