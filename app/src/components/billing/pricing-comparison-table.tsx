"use client";

import {
  DEFAULT_OVERAGE_PRICING,
  formatOveragePrice,
} from "@/lib/billing/pricing-defaults";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PricingFeatureCell } from "./pricing-feature-cell";

export interface FeatureRow {
  name: string;
  plus: string | boolean | number;
  pro: string | boolean | number;
  enterprise?: string | boolean | number;
  selfHosted?: string | boolean | number;
}

export interface FeatureCategory {
  category: string;
  features: FeatureRow[];
}

export interface OveragePricingData {
  plus: {
    playwrightMinutes: number;
    k6VuMinutes: number;
    aiCredits: number;
    sreInvestigationUnits: number;
  };
  pro: {
    playwrightMinutes: number;
    k6VuMinutes: number;
    aiCredits: number;
    sreInvestigationUnits: number;
  };
}

interface PricingComparisonTableProps {
  categories: FeatureCategory[];
  overagePricing?: OveragePricingData;
}

export function PricingComparisonTable({
  categories,
  overagePricing,
}: PricingComparisonTableProps) {
  // Default overage pricing (fallback if not provided)
  const pricing = overagePricing ?? DEFAULT_OVERAGE_PRICING;

  return (
    <div className="min-w-0 rounded-lg border bg-card shadow-sm">
      <div
        role="region"
        aria-label="Plan comparison"
        tabIndex={0}
        className="overflow-x-auto rounded-t-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <table className="w-full caption-bottom text-sm" aria-label="Hosted plan features and overage rates">
          <TableHeader className="bg-muted/50 sticky top-0 z-10">
            <TableRow className="hover:bg-muted/50 border-b">
              <TableHead scope="col" className="font-semibold text-foreground w-1/4 min-w-[180px] py-3">
                Feature
              </TableHead>
              <TableHead scope="col" className="text-center font-semibold text-foreground min-w-[120px] py-3">
                Plus
              </TableHead>
              <TableHead scope="col" className="text-center font-semibold text-foreground min-w-[120px] py-3">
                Pro
              </TableHead>
              <TableHead scope="col" className="text-center font-semibold text-foreground min-w-[120px] py-3">
                Enterprise
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(categories || []).flatMap((category, categoryIndex) => [
              // Category header row
              <TableRow
                key={`category-${categoryIndex}`}
                className="bg-muted/50 hover:bg-muted/50 border-l-2 border-l-primary/50"
              >
                <TableCell
                  colSpan={4}
                  className="font-semibold text-xs uppercase tracking-wider py-3 text-muted-foreground"
                >
                  {category.category}
                </TableCell>
              </TableRow>,
              // Feature rows
              ...category.features.map((feature, featureIndex) => (
                <TableRow
                  key={`feature-${category.category}-${featureIndex}`}
                  className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <TableHead scope="row" className="font-medium py-3 text-sm pl-6 text-foreground whitespace-normal">
                    {feature.name}
                  </TableHead>
                  <TableCell className="text-center py-3 text-sm">
                    <PricingFeatureCell value={feature.plus} />
                  </TableCell>
                  <TableCell className="text-center py-3 text-sm">
                    <PricingFeatureCell value={feature.pro} />
                  </TableCell>
                  <TableCell className="text-center py-3 text-sm">
                    <PricingFeatureCell value={feature.enterprise ?? "Custom"} />
                  </TableCell>
                </TableRow>
              )),
            ])}
            {/* Overage Pricing Section */}
            <TableRow className="bg-muted/50 hover:bg-muted/50 border-l-2 border-l-primary/50 border-t-2">
              <TableCell
                colSpan={4}
                className="font-semibold text-xs uppercase tracking-wider py-3 text-muted-foreground"
              >
                Overage Pricing
              </TableCell>
            </TableRow>
            <TableRow className="hover:bg-muted/30 transition-colors">
              <TableHead scope="row" className="py-3 pl-6 text-sm font-medium text-foreground whitespace-normal">
                Playwright Minutes
              </TableHead>
              <TableCell className="text-center py-3 text-sm font-medium">
                {formatOveragePrice(pricing.plus.playwrightMinutes, "min")}
              </TableCell>
              <TableCell className="text-center py-3 text-sm font-medium">
                {formatOveragePrice(pricing.pro.playwrightMinutes, "min")}
              </TableCell>
              <TableCell className="text-center py-3 text-sm text-muted-foreground">
                Custom
              </TableCell>
            </TableRow>
            <TableRow className="hover:bg-muted/30 transition-colors">
              <TableHead scope="row" className="py-3 pl-6 text-sm font-medium text-foreground whitespace-normal">
                K6 VU Minutes
              </TableHead>
              <TableCell className="text-center py-3 text-sm font-medium">
                {formatOveragePrice(pricing.plus.k6VuMinutes, "VU-min")}
              </TableCell>
              <TableCell className="text-center py-3 text-sm font-medium">
                {formatOveragePrice(pricing.pro.k6VuMinutes, "VU-min")}
              </TableCell>
              <TableCell className="text-center py-3 text-sm text-muted-foreground">
                Custom
              </TableCell>
            </TableRow>
            <TableRow className="hover:bg-muted/30 transition-colors border-b">
              <TableHead scope="row" className="py-3 pl-6 text-sm font-medium text-foreground whitespace-normal">
                AI Credits
              </TableHead>
              <TableCell className="text-center py-3 text-sm text-muted-foreground">
                Hard limit (no overage)
              </TableCell>
              <TableCell className="text-center py-3 text-sm text-muted-foreground">
                Hard limit (no overage)
              </TableCell>
              <TableCell className="text-center py-3 text-sm text-muted-foreground">
                Custom
              </TableCell>
            </TableRow>
            <TableRow className="hover:bg-muted/30 transition-colors border-b">
              <TableHead scope="row" className="py-3 pl-6 text-sm font-medium text-foreground whitespace-normal">
                Completed full AI SRE reports
              </TableHead>
              <TableCell className="text-center py-3 text-sm font-medium">
                {formatOveragePrice(
                  pricing.plus.sreInvestigationUnits,
                  "completed full report",
                )}
              </TableCell>
              <TableCell className="text-center py-3 text-sm font-medium">
                {formatOveragePrice(
                  pricing.pro.sreInvestigationUnits,
                  "completed full report",
                )}
              </TableCell>
              <TableCell className="text-center py-3 text-sm text-muted-foreground">
                Custom
              </TableCell>
            </TableRow>
          </TableBody>
        </table>
      </div>

      {/* Mobile scroll indicator */}
      <div className="md:hidden text-center text-xs text-muted-foreground py-2.5 bg-muted/30 border-t">
        ← Scroll horizontally to compare →
      </div>
    </div>
  );
}
