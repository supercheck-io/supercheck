"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanFeature } from "@/lib/billing/pricing-copy";

interface PricingTierCardProps {
  name: string;
  price?: number;
  priceInterval?: string;
  tagline: string;
  badge?: string;
  features: PlanFeature[];
  ctaText: string;
  ctaHref?: string;
  onCtaClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  highlighted?: boolean;
}

/** One column of the joined plan grid; matches the plan columns on the marketing pricing page. */
export function PricingTierCard({
  name,
  price,
  priceInterval,
  tagline,
  badge,
  features,
  ctaText,
  ctaHref,
  onCtaClick,
  loading = false,
  disabled = false,
  highlighted = false,
}: PricingTierCardProps) {
  const ctaClass = "mt-8 w-full sm:w-auto sm:self-start";
  const variant = highlighted ? "default" : "outline";
  return (
    <div
      className={cn(
        "flex flex-col p-6 sm:p-8 [&:not(:first-child)]:border-t lg:[&:not(:first-child)]:border-t-0 lg:[&:not(:first-child)]:border-l",
        highlighted ? "bg-background" : "bg-card",
      )}
    >
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">{name}</h2>
        {badge && (
          <Badge variant="outline" className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {badge}
          </Badge>
        )}
      </div>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="text-5xl font-semibold tracking-tight">
          {price === undefined ? "Custom" : `$${price}`}
        </span>
        {price !== undefined && priceInterval && (
          <span className="font-mono text-sm text-muted-foreground">/{priceInterval}</span>
        )}
      </div>
      <p className="mt-4 min-h-10 max-w-xs text-pretty text-sm text-muted-foreground">{tagline}</p>
      <ul className="mt-6 flex-1 space-y-3 border-t pt-6">
        {features.map((feature) => {
          const text = typeof feature === "string" ? feature : feature.text;
          const hint = typeof feature === "string" ? null : feature.hint;
          return (
            <li key={text} className="flex items-start gap-3 text-sm leading-6">
              <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                {text}
                {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {ctaHref ? (
        <Button className={ctaClass} variant={variant} asChild>
          <a href={ctaHref}>{ctaText}</a>
        </Button>
      ) : (
        <Button className={ctaClass} variant={variant} onClick={onCtaClick} disabled={loading || disabled}>
          {loading ? (
            <>
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              Opening checkout...
            </>
          ) : (
            ctaText
          )}
        </Button>
      )}
    </div>
  );
}
