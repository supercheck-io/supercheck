"use client";

import { cn } from "@/lib/utils";

interface SuperCheckLoadingProps {
    message?: string;
    size?: "sm" | "md" | "lg";
    className?: string;
}

/**
 * SuperCheckLoading - A clean, professional branded loading component
 * 
 * Features:
 * - Prominent Bolder Logo
 * - Muted spinner ring
 * - Static, professional text (no flashing)
 */
export function SuperCheckLoading({
    message = "Loading...",
    size = "md",
    className
}: SuperCheckLoadingProps) {
    // Config: Logo size and Spinner size
    // Spinner is tighter to logo now
    const sizeConfig = {
        sm: { logo: 24, spinner: 40, stroke: 'border-[2px]' },
        md: { logo: 32, spinner: 48, stroke: 'border-[3px]' },
        lg: { logo: 48, spinner: 72, stroke: 'border-[4px]' },
    };

    const config = sizeConfig[size];

    return (
        <div className={cn("flex flex-col items-center justify-center gap-8", className)}>
            {/* Logo with spinner ring */}
            <div className="relative flex items-center justify-center">
                {/* Spinning ring - Muted color */}
                <div
                    className={cn(
                        "absolute border-transparent border-t-muted-foreground/40 border-r-muted-foreground/40 rounded-full animate-spin",
                        config.stroke
                    )}
                    style={{
                        width: config.spinner,
                        height: config.spinner,
                    }}
                />

                {/* Static logo in center */}
                <div className="relative z-10">
                    <SuperCheckLogo size={config.logo} />
                </div>
            </div>

            {/* Loading Text - Static (no pulse), clean font */}
            <p className="text-base font-medium text-muted-foreground mt-2">
                {message}
            </p>
        </div>
    );
}

/**
 * SuperCheckLogo - The main SuperCheck logo component
 * Green checkmark in a circle
 */
function SuperCheckLogo({ size = 24 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
        >
            {/* Main circle */}
            <circle
                cx="16"
                cy="16"
                r="16"
                fill="#50b748"
            />

            {/* White checkmark */}
            <path
                d="M13.52 23.383L6.158 16.02l2.828-2.828 4.533 4.535 9.617-9.617 2.828 2.828L13.52 23.383z"
                fill="white"
            />
        </svg>
    );
}

/**
 * FullPageLoading - Full page loading overlay with SuperCheck branding
 */
export function FullPageLoading({
    message = "Loading..."
}: {
    message?: string
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <SuperCheckLoading size="lg" message={message} />
        </div>
    );
}
