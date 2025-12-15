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
                "flex flex-col items-center justify-center p-8 text-center min-h-[70vh] w-full border-2 border-dashed rounded-lg bg-muted/10 animate-in fade-in-50",
                className
            )}
        >
            {icon && <div className="mb-4 opacity-50">{icon}</div>}
            <h3 className="text-lg font-medium mb-2 w-full">{title}</h3>
            <p className="text-sm text-muted-foreground w-full max-w-lg mb-6 leading-relaxed">
                {description}
            </p>
            {action && <div className="mt-2">{action}</div>}
        </div>
    );
}
