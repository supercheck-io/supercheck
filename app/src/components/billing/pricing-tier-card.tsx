"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PricingTierCardProps {
  name: string;
  price?: number | string;
  priceInterval?: string;
  tagline: string;
  badge?: string;
  keyFeatures: string[];
  overageText?: string;
  ctaText: string;
  ctaVariant?: "default" | "outline";
  ctaHref?: string;
  onCtaClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  highlighted?: boolean;
}

export function PricingTierCard({
  name,
  price,
  priceInterval,
  tagline,
  badge,
  keyFeatures,
  overageText,
  ctaText,
  ctaVariant = "outline",
  ctaHref,
  onCtaClick,
  loading = false,
  disabled = false,
  highlighted = false,
}: PricingTierCardProps) {
  return (
    <Card
      className={cn(
        "relative h-full flex flex-col shadow-none",
        highlighted
          ? "border-[hsl(220,90%,56%)] bg-[hsl(220,90%,56%)]/5 dark:border-[hsl(220,90%,66%)] dark:bg-[hsl(220,90%,66%)]/5"
          : "border",
      )}
    >
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <Badge
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-semibold",
              highlighted
                ? "bg-[hsl(220,90%,56%)] text-white dark:bg-[hsl(220,90%,66%)] dark:text-slate-950 border-0"
                : "bg-muted text-muted-foreground border-0",
            )}
          >
            {badge}
          </Badge>
        </div>
      )}

      <CardHeader className="space-y-4 pb-6">
        {/* Plan Name and Tagline */}
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{name}</h2>
          <p className="text-sm text-muted-foreground mt-1">{tagline}</p>
        </div>

        {/* Price */}
        {price !== undefined && (
          <div className="flex items-baseline gap-1">
            {typeof price === "number" ? (
              <>
                <span className="text-5xl font-bold tracking-tight">
                  ${price}
                </span>
                {priceInterval && (
                  <span className="text-base text-muted-foreground font-medium">
                    /{priceInterval}
                  </span>
                )}
              </>
            ) : (
              <span className="text-4xl font-bold tracking-tight">{price}</span>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-6 flex-1 flex flex-col pt-0">
        {/* Key Features */}
        <ul className="space-y-3 flex-1">
          {keyFeatures.map((feature, index) => (
            <li key={index} className="flex items-start gap-3">
              <Check
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(220,90%,56%)] dark:text-[hsl(220,90%,66%)]"
                strokeWidth={2}
              />
              <span className="text-sm leading-5 text-foreground/90">
                {feature}
              </span>
            </li>
          ))}
        </ul>

        {/* CTA Button */}
        {ctaHref ? (
          <Button
            className={cn(
              "w-full h-11 text-sm font-semibold",
              highlighted &&
                "bg-[hsl(220,90%,56%)] hover:bg-[hsl(220,90%,50%)] text-white dark:bg-[hsl(220,90%,66%)] dark:text-slate-950 dark:hover:bg-[hsl(220,90%,72%)]",
            )}
            size="lg"
            variant={highlighted ? "default" : ctaVariant}
            asChild
          >
            <a href={ctaHref} aria-label={`${ctaText} about ${name}`}>
              {ctaText}
            </a>
          </Button>
        ) : (
          <Button
            className={cn(
              "w-full h-11 text-sm font-semibold",
              highlighted &&
                "bg-[hsl(220,90%,56%)] hover:bg-[hsl(220,90%,50%)] text-white dark:bg-[hsl(220,90%,66%)] dark:text-slate-950 dark:hover:bg-[hsl(220,90%,72%)]",
            )}
            size="lg"
            variant={highlighted ? "default" : ctaVariant}
            onClick={onCtaClick}
            disabled={loading || disabled}
          >
            {loading ? (
              <>
                <Loader2
                  aria-hidden="true"
                  className="animate-spin mr-2 h-4 w-4"
                />
                Opening checkout...
              </>
            ) : (
              ctaText
            )}
          </Button>
        )}

        {/* Overage Pricing */}
        {overageText && (
          <div className="pt-4 border-t border-border/50">
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              {overageText}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
