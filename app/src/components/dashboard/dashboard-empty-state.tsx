import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

interface DashboardEmptyStateProps {
    title: string;
    description: string;
    icon?: ReactNode;
    action?: ReactNode;
    className?: string;
}

export function DashboardEmptyState({
  title,
  description,
  icon,
  action,
  className,
}: DashboardEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[360px] w-full flex-col items-center justify-center rounded-lg border-2 border-dashed bg-muted/10 p-8 text-center animate-in fade-in-50",
        className
      )}
    >
      {icon && <div className="mb-4 opacity-50">{icon}</div>}
      <h3 className="mb-2 w-full text-lg font-medium">{title}</h3>
      <p className="mb-6 w-full max-w-lg text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
