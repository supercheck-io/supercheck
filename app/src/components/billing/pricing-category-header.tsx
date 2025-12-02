"use client";

interface PricingCategoryHeaderProps {
  name: string;
}

export function PricingCategoryHeader({ name }: PricingCategoryHeaderProps) {
  return (
    <div className="bg-muted/50 px-4 py-3 -mx-4 -my-1 sticky top-0 z-10">
      <h3 className="font-semibold text-sm text-foreground">{name}</h3>
    </div>
  );
}
