import * as React from "react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  maxLength?: number
  showCharacterCount?: boolean
  className?: string
  labelClassName?: string
}

export const FormInput = React.forwardRef<HTMLInputElement, FormInputProps>(
  ({ label, error, maxLength, showCharacterCount = false, className, labelClassName, ...props }, ref) => {
    const [charCount, setCharCount] = React.useState(props.value?.toString().length || 0)
    // Controlled inputs report their own length; uncontrolled ones are tracked on change.
    const shownCount = props.value !== undefined ? String(props.value).length : charCount

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setCharCount(e.target.value.length)
      props.onChange?.(e)
    }

    return (
      <div className="space-y-2">
        {label && (
          <Label htmlFor={props.id} className={cn("text-sm font-medium", labelClassName)}>
            {label}
          </Label>
        )}
        <div className="relative">
          <Input
            ref={ref}
            maxLength={maxLength}
            className={cn(
              showCharacterCount && maxLength && "pr-14",
              error && "border-destructive focus-visible:ring-destructive",
              className
            )}
            {...props}
            onChange={handleChange}
          />
          {showCharacterCount && maxLength && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {shownCount}/{maxLength}
            </div>
          )}
        </div>
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </div>
    )
  }
)

FormInput.displayName = "FormInput" 