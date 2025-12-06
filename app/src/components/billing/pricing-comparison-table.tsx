"use client";

import {
  Table,
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
  };
  pro: {
    playwrightMinutes: number;
    k6VuMinutes: number;
    aiCredits: number;
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
  const pricing = overagePricing ?? {
    plus: { playwrightMinutes: 0.03, k6VuMinutes: 0.01, aiCredits: 0.05 },
    pro: { playwrightMinutes: 0.02, k6VuMinutes: 0.01, aiCredits: 0.03 },
  };

  // Format price for display
  const formatPrice = (price: number, unit: string) => {
    if (price < 0.01) {
      return `$${(price * 1000).toFixed(1)}/${unit} (per 1000)`;
    }
    return `$${price.toFixed(price < 0.1 ? 3 : 2)}/${unit}`;
  };

  return (
    <div className="rounded-lg border overflow-x-auto bg-card shadow-sm">
      <Table>
        <TableHeader className="bg-muted/50 sticky top-0 z-10">
          <TableRow className="hover:bg-muted/50 border-b">
            <TableHead className="font-semibold text-foreground w-2/5 min-w-[200px] py-3">
              Feature
            </TableHead>
            <TableHead className="text-center font-semibold text-foreground min-w-[140px] py-3">
              Plus
            </TableHead>
            <TableHead className="text-center font-semibold text-foreground min-w-[140px] py-3">
              Pro
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(categories || []).flatMap((category, categoryIndex) => [
            // Category header row
            <TableRow
              key={`category-${categoryIndex}`}
              className="bg-muted/40 hover:bg-muted/50"
            >
              <TableCell
                colSpan={3}
                className="font-semibold text-sm py-2.5 text-foreground"
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
                <TableCell className="font-medium py-3 text-sm pl-6">
                  {feature.name}
                </TableCell>
                <TableCell className="text-center py-3 text-sm">
                  <PricingFeatureCell value={feature.plus} />
                </TableCell>
                <TableCell className="text-center py-3 text-sm">
                  <PricingFeatureCell value={feature.pro} />
                </TableCell>
              </TableRow>
            )),
          ])}
          {/* Overage Pricing Section */}
          <TableRow className="bg-muted/40 hover:bg-muted/50 border-t-2">
            <TableCell
              colSpan={3}
              className="font-semibold text-sm py-2.5 text-foreground"
            >
              Overage Pricing
            </TableCell>
          </TableRow>
          <TableRow className="hover:bg-muted/30 transition-colors">
            <TableCell className="py-3 pl-6 text-sm font-medium">
              Playwright Minutes
            </TableCell>
            <TableCell className="text-center py-3 text-sm font-medium">
              {formatPrice(pricing.plus.playwrightMinutes, "min")}
            </TableCell>
            <TableCell className="text-center py-3 text-sm font-medium">
              {formatPrice(pricing.pro.playwrightMinutes, "min")}
            </TableCell>
          </TableRow>
          <TableRow className="hover:bg-muted/30 transition-colors">
            <TableCell className="py-3 pl-6 text-sm font-medium">
              K6 VU Minutes
            </TableCell>
            <TableCell className="text-center py-3 text-sm font-medium">
              {formatPrice(pricing.plus.k6VuMinutes, "VU-min")}
            </TableCell>
            <TableCell className="text-center py-3 text-sm font-medium">
              {formatPrice(pricing.pro.k6VuMinutes, "VU-min")}
            </TableCell>
          </TableRow>
          <TableRow className="hover:bg-muted/30 transition-colors border-b">
            <TableCell className="py-3 pl-6 text-sm font-medium">
              AI Credits
            </TableCell>
            <TableCell className="text-center py-3 text-sm font-medium">
              {formatPrice(pricing.plus.aiCredits, "credit")}
            </TableCell>
            <TableCell className="text-center py-3 text-sm font-medium">
              {formatPrice(pricing.pro.aiCredits, "credit")}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      {/* Mobile scroll indicator */}
      <div className="md:hidden text-center text-xs text-muted-foreground py-2.5 bg-muted/30 border-t">
        ← Scroll horizontally to compare →
      </div>
    </div>
  );
}
