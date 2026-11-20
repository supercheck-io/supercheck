import { Check } from "lucide-react";

interface TrialCardProps {
  durationDays: number;
  highlights: string[];
}

/** What an active free trial includes, laid out like the trial box on the marketing pricing page. */
export function TrialCard({ durationDays, highlights }: TrialCardProps) {
  return (
    <section aria-labelledby="trial-card-heading" className="rounded-xl border p-6 sm:p-8">
      <h2 id="trial-card-heading" className="text-lg font-semibold">
        Your {durationDays}-day free trial includes
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Custom domains are on paid plans. Choose a plan any time to lift these limits.
      </p>
      <ul className="mt-5 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {highlights.map((highlight) => (
          <li key={highlight} className="flex items-start gap-3 leading-6">
            <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
            <span>{highlight}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
