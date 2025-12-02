"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, Sparkles } from "lucide-react";
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
        "relative overflow-hidden transition-all duration-300 hover:shadow-xl h-full flex flex-col border",
        highlighted 
          ? "border-primary/50 shadow-lg" 
          : "border-border hover:border-muted-foreground/40"
      )}
    >


      {badge && (
        <div className="absolute top-0 right-0 z-10">
          <Badge 
            className={cn(
              "rounded-none rounded-bl-lg px-3 py-1.5 text-xs font-semibold",
              highlighted && "bg-primary text-primary-foreground"
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
          <h3 className="text-2xl font-bold tracking-tight">{name}</h3>
          <p className="text-sm text-muted-foreground mt-1">{tagline}</p>
        </div>

        {/* Price */}
        <div className="flex items-baseline gap-1">
          <span className="text-5xl font-bold tracking-tight">${price}</span>
          <span className="text-base text-muted-foreground font-medium">/{priceInterval}</span>
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
                    ? "bg-primary text-primary-foreground" 
                    : "bg-primary/10 text-primary"
                )}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </div>
              <span className="text-sm leading-5 text-foreground/90">{feature}</span>
            </li>
          ))}
        </ul>

        {/* CTA Button */}
        <Button
          className={cn(
            "w-full h-11 text-sm font-semibold",
            highlighted && "shadow-md"
          )}
          size="lg"
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
        <div className="pt-4 border-t border-border/50">
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            {overageText}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
