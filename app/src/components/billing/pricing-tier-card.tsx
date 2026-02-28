"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface PricingTierCardProps {
  name: string;
  price: number | string;
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
        "relative overflow-hidden transition-all duration-300 h-full flex flex-col",
        highlighted
          ? "border-2 border-emerald-500/60 shadow-lg shadow-emerald-500/10 hover:shadow-xl hover:shadow-emerald-500/15"
          : "border hover:border-muted-foreground/30 hover:shadow-lg"
      )}
    >

      {badge && (
        <div className="absolute top-3.5 right-3.5 z-10">
          <Badge
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-semibold",
              highlighted
                ? "bg-emerald-500 text-white border-0 shadow-sm"
                : "bg-muted text-muted-foreground border-0"
            )}
          >
            {highlighted && <Sparkles className="h-3 w-3 mr-1" />}
            {badge}
          </Badge>
        </div>
      )}

      <CardHeader className={cn("space-y-4 pb-6", badge && "pt-10")}>
        {/* Plan Name and Tagline */}
        <div>
          <h3
            className={cn(
              "text-2xl font-bold tracking-tight",
              highlighted && "text-emerald-600 dark:text-emerald-400"
            )}
          >
            {name}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">{tagline}</p>
        </div>

        {/* Price */}
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
      </CardHeader>

      <CardContent className="space-y-6 flex-1 flex flex-col pt-0">
        {/* Key Features */}
        <ul className="space-y-3 flex-1">
          {keyFeatures.map((feature, index) => (
            <li key={index} className="flex items-start gap-3">
              <div
                className={cn(
                  "flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center mt-0.5",
                  highlighted
                    ? "bg-emerald-500 text-white"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </div>
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
                "bg-emerald-600 hover:bg-emerald-700 text-white shadow-md"
            )}
            size="lg"
            variant={highlighted ? "default" : ctaVariant}
            asChild
          >
            <a href={ctaHref}>{ctaText}</a>
          </Button>
        ) : (
          <Button
            className={cn(
              "w-full h-11 text-sm font-semibold",
              highlighted &&
                "bg-emerald-600 hover:bg-emerald-700 text-white shadow-md"
            )}
            size="lg"
            variant={highlighted ? "default" : ctaVariant}
            onClick={onCtaClick}
            disabled={loading || disabled}
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin mr-2 h-4 w-4" />
                Processing...
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
