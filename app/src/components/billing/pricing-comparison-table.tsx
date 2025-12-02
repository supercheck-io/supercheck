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

interface PricingComparisonTableProps {
  categories: FeatureCategory[];
}

export function PricingComparisonTable({
  categories,
}: PricingComparisonTableProps) {
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
          {categories.flatMap((category) =>
            category.features.map((feature, featureIndex) => (
              <TableRow
                key={`feature-${category.category}-${featureIndex}`}
                className="border-b last:border-0 hover:bg-muted/30 transition-colors"
              >
                <TableCell className="font-medium py-3 text-sm">
                  {feature.name}
                </TableCell>
                <TableCell className="text-center py-3 text-sm">
                  <PricingFeatureCell value={feature.plus} />
                </TableCell>
                <TableCell className="text-center py-3 text-sm">
                  <PricingFeatureCell value={feature.pro} />
                </TableCell>
              </TableRow>
            ))
          )}
          {/* Overage Pricing Section */}
          <TableRow className="bg-muted/30 hover:bg-muted/40 border-t-2">
            <TableCell className="font-semibold py-3 text-sm">
              Overage Pricing
            </TableCell>
            <TableCell className="text-center py-3 text-sm font-medium text-muted-foreground">
              See below
            </TableCell>
            <TableCell className="text-center py-3 text-sm font-medium text-muted-foreground">
              See below
            </TableCell>
          </TableRow>
          <TableRow className="hover:bg-muted/30 transition-colors">
            <TableCell className="py-3 pl-6 text-sm">
              Playwright Minutes
            </TableCell>
            <TableCell className="text-center py-3 text-sm font-medium">$0.03/min</TableCell>
            <TableCell className="text-center py-3 text-sm font-medium">$0.015/min</TableCell>
          </TableRow>
          <TableRow className="hover:bg-muted/30 transition-colors">
            <TableCell className="py-3 pl-6 text-sm">
              K6 VU Minutes
            </TableCell>
            <TableCell className="text-center py-3 text-sm font-medium">$0.005/min</TableCell>
            <TableCell className="text-center py-3 text-sm font-medium">$0.003/min</TableCell>
          </TableRow>
          <TableRow className="hover:bg-muted/30 transition-colors border-b">
            <TableCell className="py-3 pl-6 text-sm">
              AI Credits
            </TableCell>
            <TableCell className="text-center py-3 text-sm font-medium">$0.05/credit</TableCell>
            <TableCell className="text-center py-3 text-sm font-medium">$0.03/credit</TableCell>
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
