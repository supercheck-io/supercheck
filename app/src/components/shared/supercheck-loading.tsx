"use client";

import { cn } from "@/lib/utils";

import { SupercheckLogo } from "@/components/logo/supercheck-logo";

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
        sm: { logo: 24, spinner: 44, stroke: 'border-[3px]' },
        md: { logo: 32, spinner: 60, stroke: 'border-[4px]' },
        lg: { logo: 48, spinner: 84, stroke: 'border-[6px]' },
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
                    <SupercheckLogo width={config.logo} height={config.logo} />
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
 * FullPageLoading - Full page loading overlay with SuperCheck branding
 */
export function FullPageLoading({
    message = "Loading..."
}: {
    message?: string
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <SuperCheckLoading size="md" message={message} />
        </div>
    );
}


