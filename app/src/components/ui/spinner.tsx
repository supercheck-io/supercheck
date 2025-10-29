import { cn } from "@/lib/utils";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Spinner({ size = "md", className }: SpinnerProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-6 w-6", 
    lg: "h-8 w-8"
  };

  return (
    <div
      className={cn(
        "animate-spin rounded-full border-2 border-current border-t-transparent",
        sizeClasses[size],
        className
      )}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}

interface LoadingBadgeProps {
  className?: string;
}

export function LoadingBadge({ className }: LoadingBadgeProps) {
  return (
    <div className={cn(
      "inline-flex items-center gap-2 px-2 py-2 rounded-md border bg-muted/50 border-border/50",
      className
    )}>
      <Spinner size="sm" className="text-muted-foreground" />
      <span className="text-xs text-muted-foreground">
        Loading...
      </span>
    </div>
  );
}