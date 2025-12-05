"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

// FieldGroup - Container for form fields
const FieldGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col gap-6", className)} {...props} />
));
FieldGroup.displayName = "FieldGroup";

// Field - Individual field container
const Field = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("grid gap-2", className)} {...props} />
));
Field.displayName = "Field";

// FieldLabel - Label for a field
interface FieldLabelProps extends React.ComponentPropsWithoutRef<typeof Label> {
  required?: boolean;
}

const FieldLabel = React.forwardRef<
  React.ElementRef<typeof Label>,
  FieldLabelProps
>(({ className, children, required, ...props }, ref) => (
  <Label ref={ref} className={cn("text-sm font-medium", className)} {...props}>
    {children}
    {required && <span className="text-destructive ml-0.5">*</span>}
  </Label>
));
FieldLabel.displayName = "FieldLabel";

// FieldDescription - Description text for a field
const FieldDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      "text-sm text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 [&_a]:hover:text-foreground",
      className
    )}
    {...props}
  />
));
FieldDescription.displayName = "FieldDescription";

// FieldError - Error message for a field
const FieldError = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm font-medium text-destructive", className)}
    {...props}
  />
));
FieldError.displayName = "FieldError";

// FieldSeparator - Separator with optional text
interface FieldSeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

const FieldSeparator = React.forwardRef<HTMLDivElement, FieldSeparatorProps>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn("relative", className)} {...props}>
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t" />
      </div>
      {children && (
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">
            {children}
          </span>
        </div>
      )}
    </div>
  )
);
FieldSeparator.displayName = "FieldSeparator";

export {
  FieldGroup,
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldSeparator,
};
