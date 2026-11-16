import Link from "next/link";
import { HeartPulse, ExternalLink, Smartphone, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconChip, type IconTone } from "@/components/ui/icon-chip";
import { TableBadge } from "@/components/ui/table-badge";
import { NAV } from "@/lib/nav-areas";
import { ADMIN_TYPES, TYPE_TONE } from "@/lib/type-tones";
import { CHECKLIST_GROUP_TITLES, type Checklist, type ChecklistGroup } from "@/lib/setup/checklist";

const GROUPS: ChecklistGroup[] = ["watch", "prove", "fix", "team"];

/** Each item wears the icon and tone of the page it opens, from the same registries as the sidebar and Quick Create. */
export const CHECKLIST_ICONS: Record<string, { icon: LucideIcon; tone: IconTone }> = {
  monitors: NAV.monitors,
  alerts: NAV.notifications,
  heartbeat: { icon: HeartPulse, tone: TYPE_TONE.monitor.heartbeat },
  statusPage: NAV.statusPages,
  requirements: NAV.requirements,
  tests: NAV.tests,
  jobs: NAV.jobs,
  connectors: NAV.integrations,
  services: NAV.services,
  team: { icon: ADMIN_TYPES.member.icon, tone: TYPE_TONE.admin.member },
  cliToken: { icon: ADMIN_TYPES.cliToken.icon, tone: TYPE_TONE.admin.cliToken },
  mobile: { icon: Smartphone, tone: NAV.notifications.tone },
};

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
          <section key={group} aria-labelledby={`checklist-${group}`} className="space-y-3">
            <h3 id={`checklist-${group}`} className="text-base font-semibold">
              {CHECKLIST_GROUP_TITLES[group]}
            </h3>
            <ul className="divide-y rounded-xl border">
              {items.map((item) => (
                <li key={item.key} className="flex items-center gap-3 px-4 py-3" data-testid={`checklist-item-${item.key}`}>
                  {CHECKLIST_ICONS[item.key] ? <IconChip icon={CHECKLIST_ICONS[item.key].icon} tone={CHECKLIST_ICONS[item.key].tone} size="sm" /> : null}
                  <span className="min-w-0 flex-1 text-sm">
                    {item.title}
                    <span className="sr-only">{item.done ? " (done)" : " (not done)"}</span>
                  </span>
                  {item.done ? <TableBadge tone="success" compact aria-hidden="true">Done</TableBadge> : null}
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
        <section aria-labelledby="checklist-next" className="space-y-3">
          <h3 id="checklist-next" className="text-base font-semibold">
            Next steps <span className="font-normal text-muted-foreground">· not counted</span>
          </h3>
          <ul className="divide-y rounded-xl border">
            {checklist.nextSteps.map((step) => {
              const external = step.href.startsWith("http");
              return (
                <li key={step.key} className="flex items-center gap-3 px-4 py-3">
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
