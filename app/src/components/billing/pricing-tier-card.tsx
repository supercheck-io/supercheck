"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PricingTierCardProps {
  name: string;
  price: number;
  priceInterval: string;
  tagline: string;
  badge?: string;
  keyFeatures: string[];
  overageText: string;
  ctaText: string;
  ctaVariant?: "default" | "outline";
  onCtaClick: () => void;
  loading?: boolean;
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
  onCtaClick,
  loading = false,
  highlighted = false,
}: PricingTierCardProps) {
  return (
    <Card
      className={cn(
        "relative overflow-hidden transition-all hover:shadow-lg h-full flex flex-col",
        highlighted && "border-primary shadow-md border-2"
      )}
    >
      {badge && (
        <div className="absolute top-0 right-0 z-10">
          <Badge className="rounded-none rounded-bl-lg px-2.5 py-1 text-xs font-medium">
            {badge}
          </Badge>
        </div>
      )}

      <CardHeader className={cn("space-y-3 pb-5", badge && "pt-8")}>
        {/* Plan Name and Tagline */}
        <div>
          <h3 className="text-xl font-bold">{name}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">{tagline}</p>
        </div>

        {/* Price */}
        <div className="flex items-baseline gap-1.5">
          <span className="text-4xl font-bold">${price}</span>
          <span className="text-base text-muted-foreground">/{priceInterval}</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 flex-1 flex flex-col">
        {/* Key Features */}
        <ul className="space-y-2.5 flex-1">
          {keyFeatures.map((feature, index) => (
            <li key={index} className="flex items-start gap-2.5">
              <div className="flex-shrink-0 h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center mt-px">
                <Check className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-sm leading-5">{feature}</span>
            </li>
          ))}
        </ul>

        {/* CTA Button */}
        <Button
          className="w-full"
          size="default"
          variant={ctaVariant}
          onClick={onCtaClick}
          disabled={loading}
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

        {/* Overage Pricing */}
        <div className="pt-3 border-t">
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            {overageText}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
