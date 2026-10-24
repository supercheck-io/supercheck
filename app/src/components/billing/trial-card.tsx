import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";

interface TrialCardProps {
  durationDays: number;
  highlights: string[];
}

/** What an active free trial includes. The surrounding page already says how many days are left and what happens when it ends. */
export function TrialCard({ durationDays, highlights }: TrialCardProps) {
  return (
    <Card aria-labelledby="trial-card-heading" className="gap-4 p-5 shadow-none sm:p-6">
      <div className="space-y-1">
        <h2 id="trial-card-heading" className="text-base font-semibold">
          What your free trial includes
        </h2>
        <p className="text-sm text-muted-foreground">
          Most of the product for {durationDays} days, no card required. Custom domains and single sign-on are on paid plans. These
          allowances are for the whole trial; choose a plan at any time to lift them.
        </p>
      </div>
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        {highlights.map((highlight) => (
          <li key={highlight} className="flex items-start gap-2.5 leading-6">
            <Check aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-primary" />
            <span>{highlight}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
