import Link from "next/link";
import { CheckCircle2, Circle, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CHECKLIST_GROUP_TITLES, type Checklist, type ChecklistGroup } from "@/lib/setup/checklist";

const GROUPS: ChecklistGroup[] = ["watch", "prove", "fix", "team"];

/** Ticks come from real project rows (derived server-side); this only renders them. */
export function SetupChecklist({ checklist }: { checklist: Checklist }) {
  if (checklist.items.length === 0 && checklist.nextSteps.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing to set up yet.</p>;
  }
  return (
    <div className="space-y-6" data-testid="setup-checklist">
      {GROUPS.map((group) => {
        const items = checklist.items.filter((item) => item.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`checklist-${group}`} className="space-y-2">
            <h3 id={`checklist-${group}`} className="text-sm font-semibold">
              {CHECKLIST_GROUP_TITLES[group]}
            </h3>
            <ul className="divide-y rounded-lg border">
              {items.map((item) => (
                <li key={item.key} className="flex items-center gap-3 px-4 py-2.5" data-testid={`checklist-item-${item.key}`}>
                  {item.done ? (
                    <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 text-sm">
                    {item.title}
                    <span className="sr-only">{item.done ? " (done)" : " (not done)"}</span>
                  </span>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={item.href}>{item.done ? "View" : "Set up"}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {checklist.nextSteps.length > 0 ? (
        <section aria-labelledby="checklist-next" className="space-y-2">
          <h3 id="checklist-next" className="text-sm font-semibold">
            Next steps <span className="font-normal text-muted-foreground">· not counted</span>
          </h3>
          <ul className="divide-y rounded-lg border">
            {checklist.nextSteps.map((step) => {
              const external = step.href.startsWith("http");
              return (
                <li key={step.key} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 text-sm">{step.title}</span>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={step.href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
                      Open {external ? <ExternalLink aria-hidden="true" /> : null}
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
