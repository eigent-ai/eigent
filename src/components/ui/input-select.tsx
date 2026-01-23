import * as React from "react"
import { Check, ChevronDown, CircleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { TooltipSimple } from "@/components/ui/tooltip"

export type InputSelectSize = "default" | "sm"
export type InputSelectState = "error" | "success"

type InputSelectOption = {
  value: string
  label: string
}

type InputSelectProps = {
  value: string
  onChange: (value: string) => void
  options: InputSelectOption[]
  placeholder?: string
  title?: string
  tooltip?: string
  note?: string
  errorNote?: string
  required?: boolean
  disabled?: boolean
  size?: InputSelectSize
  state?: InputSelectState
  leadingIcon?: React.ReactNode
  className?: string
  maxDropdownHeight?: number
  /**
   * Called when an option is selected from the dropdown
   */
  onOptionSelect?: (option: InputSelectOption) => void
  /**
   * Custom validation function for the input value
   * Returns true if valid, false if invalid
   * If returns false, component will show error state
   */
  validateInput?: (value: string) => boolean
  /**
   * Called when input loses focus or dropdown closes
   * Use this to transform/normalize the input value
   * Return the normalized value, or undefined to keep as-is
   * Return false to indicate validation failure (will show error state)
   */
  onInputCommit?: (value: string) => string | false | void
}

const sizeClasses: Record<InputSelectSize, string> = {
  default: "h-10 text-body-sm",
  sm: "h-8 text-body-sm",
}

function resolveStateClasses(state: InputSelectState | undefined, disabled: boolean) {
  if (disabled) {
    return {
      wrapper: "opacity-50 cursor-not-allowed",
      container: "border-transparent bg-input-bg-default",
      note: "text-text-label",
    }
  }
  if (state === "error") {
    return {
      wrapper: "",
      container: "border-input-border-cuation bg-input-bg-default",
      note: "text-text-cuation",
    }
  }
  if (state === "success") {
    return {
      wrapper: "",
      container: "border-input-border-success bg-input-bg-confirm",
      note: "text-text-success",
    }
  }
  return {
    wrapper: "",
    container: "border-transparent bg-input-bg-default",
    note: "text-text-label",
  }
}

const InputSelect = React.forwardRef<HTMLInputElement, InputSelectProps>(
  (
    {
      value,
      onChange,
      options,
      placeholder,
      title,
      tooltip,
      note,
      errorNote,
      required = false,
      disabled = false,
      size = "default",
      state,
      leadingIcon,
      className,
      maxDropdownHeight = 200,
      onOptionSelect,
      validateInput,
      onInputCommit,
    },
    ref
  ) => {
    const [isOpen, setIsOpen] = React.useState(false)
    const [inputValue, setInputValue] = React.useState(value)
    const [hasError, setHasError] = React.useState(false)
    const containerRef = React.useRef<HTMLDivElement>(null)
    const inputRef = React.useRef<HTMLInputElement>(null)
    const dropdownRef = React.useRef<HTMLDivElement>(null)
    const isCommittingRef = React.useRef(false)

    // Merge refs
    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)

    // Sync input value with external value
    React.useEffect(() => {
      setInputValue(value)
      setHasError(false) // Clear error when external value changes
    }, [value])

    // Commit value function - validates and saves input
    const commitValue = React.useCallback(() => {
      // Prevent double commits
      if (isCommittingRef.current) return
      isCommittingRef.current = true

      let finalValue = inputValue

      // Run custom commit handler if provided
      if (onInputCommit) {
        const result = onInputCommit(inputValue)
        if (result === false) {
          // Validation failed - show error state
          setHasError(true)
          isCommittingRef.current = false
          return
        }
        if (typeof result === "string") {
          finalValue = result
          setInputValue(result)
        }
      }

      // Validate if validator is provided
      if (validateInput && !validateInput(finalValue)) {
        setHasError(true)
        isCommittingRef.current = false
        return
      }

      // Validation passed - clear error and update value
      setHasError(false)
      if (finalValue !== value) {
        onChange(finalValue)
      }
      
      isCommittingRef.current = false
    }, [inputValue, value, onInputCommit, validateInput, onChange])

    // Handle click outside to close dropdown
    React.useEffect(() => {
      if (!isOpen) return

      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node
        if (
          containerRef.current &&
          !containerRef.current.contains(target) &&
          dropdownRef.current &&
          !dropdownRef.current.contains(target)
        ) {
          commitValue()
          setIsOpen(false)
        }
      }

      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setInputValue(value) // Reset to original value
          setIsOpen(false)
          inputRef.current?.blur()
        }
      }

      // Use capture phase to handle events before they bubble
      document.addEventListener("mousedown", handleClickOutside, true)
      document.addEventListener("keydown", handleEscape, true)

      return () => {
        document.removeEventListener("mousedown", handleClickOutside, true)
        document.removeEventListener("keydown", handleEscape, true)
      }
    }, [isOpen, value, commitValue])

    // Handle scroll within dropdown - prevent parent scroll only when necessary
    const handleDropdownWheel = React.useCallback((e: React.WheelEvent<HTMLDivElement>) => {
      const target = e.currentTarget
      const { scrollTop, scrollHeight, clientHeight } = target
      const hasScrollableContent = scrollHeight > clientHeight
      
      if (!hasScrollableContent) {
        // No scrollable content, prevent all scroll and stop propagation
        e.preventDefault()
        e.stopPropagation()
        return
      }

      const isAtTop = scrollTop <= 0
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1 // -1 for rounding

      // If at boundary and trying to scroll past it, prevent default to stop parent from scrolling
      if ((isAtTop && e.deltaY < 0) || (isAtBottom && e.deltaY > 0)) {
        e.preventDefault()
      }
      
      // Always stop propagation to prevent parent dialog from scrolling
      e.stopPropagation()
    }, [])

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value)
      // Clear error when user starts typing again
      if (hasError) {
        setHasError(false)
      }
    }

    const handleInputFocus = () => {
      if (!disabled) {
        setIsOpen(true)
      }
    }

    const handleInputBlur = () => {
      // Use setTimeout to allow option clicks to process first
      // If user clicks an option, the option handler will update the value
      // If user clicks outside, we commit the current input value
      setTimeout(() => {
        commitValue()
        setIsOpen(false)
      }, 150)
    }

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        commitValue()
        setIsOpen(false)
        inputRef.current?.blur()
      } else if (e.key === "ArrowDown" && !isOpen) {
        e.preventDefault()
        setIsOpen(true)
      }
    }

    const handleOptionClick = (option: InputSelectOption) => {
      setInputValue(option.label)
      setHasError(false) // Clear error when selecting an option
      onChange(option.value)
      onOptionSelect?.(option)
      setIsOpen(false)
    }

    const handleContainerClick = () => {
      if (!disabled) {
        inputRef.current?.focus()
        setIsOpen(true)
      }
    }

    // Use internal error state if no external state is provided
    const effectiveState = hasError ? "error" : state
    const stateCls = resolveStateClasses(effectiveState, disabled)

    // Determine which note to show
    const displayNote = hasError && errorNote ? errorNote : note

    // Find the currently selected option
    const selectedOption = options.find((opt) => opt.value === value)

    return (
      <div className={cn("w-full relative", stateCls.wrapper, className)}>
        {title && (
          <div className="mb-1.5 flex items-center gap-1 text-body-sm font-bold text-text-heading">
            <span>{title}</span>
            {required && <span className="text-text-body">*</span>}
            {tooltip && (
              <TooltipSimple content={tooltip}>
                <CircleAlert size={16} className="text-icon-primary" />
              </TooltipSimple>
            )}
          </div>
        )}

        {/* Input container */}
        <div
          ref={containerRef}
          onClick={handleContainerClick}
          className={cn(
            "relative flex w-full items-center rounded-lg border border-solid outline-none transition-all px-3 gap-2 text-text-body cursor-text",
            sizeClasses[size],
            stateCls.container,
            !disabled &&
              state !== "error" &&
              state !== "success" && [
                "hover:bg-input-bg-hover hover:ring-1 hover:ring-input-border-hover hover:ring-offset-0",
                isOpen &&
                  "bg-input-bg-input ring-1 ring-input-border-focus ring-offset-0",
              ]
          )}
        >
          {leadingIcon && (
            <span className="flex-shrink-0 h-4 w-4 text-icon-primary">{leadingIcon}</span>
          )}
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className="flex-1 bg-transparent outline-none placeholder:text-text-label/20 min-w-0"
          />
          <ChevronDown
            className={cn(
              "h-4 w-4 text-icon-primary flex-shrink-0 transition-transform",
              isOpen && "rotate-180"
            )}
          />
        </div>

        {/* Dropdown */}
        {isOpen && (
          <div
            ref={dropdownRef}
            className="absolute left-0 right-0 top-full mt-1 z-50 bg-input-bg-default rounded-lg border border-solid border-transparent shadow-md overflow-hidden"
          >
            <div
              className="overflow-y-auto overflow-x-hidden p-1 overscroll-contain"
              style={{ maxHeight: maxDropdownHeight }}
              onWheel={handleDropdownWheel}
            >
              {options.map((option) => (
                <div
                  key={option.value}
                  onClick={() => handleOptionClick(option)}
                  className={cn(
                    "relative flex w-full cursor-pointer select-none items-center rounded-lg py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-menutabs-fill-hover transition-colors",
                    selectedOption?.value === option.value &&
                      "bg-menutabs-fill-hover"
                  )}
                >
                  {option.label}
                  {selectedOption?.value === option.value && (
                    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {displayNote && (
          <div className={cn("mt-1 text-xs", stateCls.note)}>{displayNote}</div>
        )}
      </div>
    )
  }
)

InputSelect.displayName = "InputSelect"

export { InputSelect, type InputSelectOption }
