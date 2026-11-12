"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AREA_TEXT, NAV } from "@/lib/nav-areas";
import {
  CAPABILITY_FLAG,
  CREATE_GROUPS,
  createActionsFor,
  type CreateCapabilities,
} from "@/lib/create-actions";
import { useAdminStatus } from "@/hooks/use-admin-status";

type NavId = keyof typeof NAV;
type Gate = "investigate" | "configure" | "orgAdmin" | "superAdmin";

/** Destinations in sidebar order (Respond, Communicate, Automate, Monitor, Settings). */
export const COMMAND_NAV_SECTIONS: Array<{ heading: string; items: Array<{ id: NavId; url: string; gate?: Gate }> }> = [
  {
    heading: "Respond",
    items: [
      { id: "dashboard", url: "/" },
      { id: "incidents", url: "/incidents" },
      { id: "copilot", url: "/copilot", gate: "investigate" },
      { id: "services", url: "/services", gate: "configure" },
    ],
  },
  {
    heading: "Communicate",
    items: [
      { id: "statusPages", url: "/status-pages" },
      { id: "notifications", url: "/notifications" },
      { id: "deliveryHistory", url: "/notifications?tab=history" },
    ],
  },
  {
    heading: "Automate",
    items: [
      { id: "requirements", url: "/requirements" },
      { id: "tests", url: "/tests" },
      { id: "jobs", url: "/jobs" },
      { id: "runs", url: "/runs" },
      { id: "variables", url: "/variables" },
    ],
  },
  { heading: "Monitor", items: [{ id: "monitors", url: "/monitors" }] },
  {
    heading: "Settings",
    items: [
      { id: "organization", url: "/org-admin", gate: "orgAdmin" },
      { id: "superAdmin", url: "/super-admin", gate: "superAdmin" },
      { id: "integrations", url: "/org-admin?tab=integrations", gate: "configure" },
      { id: "savedQueries", url: "/org-admin?tab=integrations&section=saved-queries", gate: "configure" },
      { id: "privateAgents", url: "/org-admin?tab=private-agents", gate: "configure" },
    ],
  },
];

interface CommandSearchProps extends Partial<CreateCapabilities> {
  className?: string;
  canInvestigateSre?: boolean;
  canConfigureSre?: boolean;
}

export function CommandSearch({
  className,
  canInvestigateSre = false,
  canConfigureSre = false,
  ...createCapabilities
}: CommandSearchProps) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const { isAdmin, isOrgAdmin } = useAdminStatus();

  const allowed: Record<Gate, boolean> = {
    investigate: canInvestigateSre,
    configure: canConfigureSre,
    orgAdmin: Boolean(isOrgAdmin),
    superAdmin: Boolean(isAdmin),
  };

  const go = (url: string) => {
    setOpen(false);
    router.push(url);
  };

  // Command palette toggle only
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const isMac =
        typeof navigator !== "undefined" &&
        navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const metaKey = isMac ? e.metaKey : e.ctrlKey;

      // Command palette toggle
      if (e.key === "k" && metaKey) {
        e.preventDefault();
        setOpen((open) => !open);
        return;
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open]);

  return (
    <div className={className}>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label="Open command menu"
        className="h-8 min-w-8 justify-center px-2 transition-colors hover:bg-accent/50 sm:min-w-[96px] sm:justify-between"
      >
        <div className="flex items-center space-x-1">
          <SearchIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="hidden text-[10px] text-muted-foreground sm:inline">
            CMD
          </span>
        </div>
        <kbd className="hidden h-4 items-center rounded border bg-muted px-1 font-mono text-[9px] text-muted-foreground sm:inline-flex">
          ⌘K
        </kbd>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 max-w-[500px] top-[35%] translate-y-[-35%] [&>button]:hidden">
          <DialogTitle className="sr-only">Command Menu</DialogTitle>
          <DialogDescription className="sr-only">
            Use the command menu to navigate to different parts of the
            application, or use the shortcuts.
          </DialogDescription>
          <Command className="rounded-lg border-0 shadow-md">
            <CommandInput placeholder="Type a command or search..." />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>

              {COMMAND_NAV_SECTIONS.map(({ heading, items }) => {
                const visible = items.filter((item) => !item.gate || allowed[item.gate]);
                if (visible.length === 0) return null;
                return (
                  <CommandGroup key={heading} heading={heading}>
                    {visible.map(({ id, url }) => {
                      const { title, icon: Icon, tone } = NAV[id];
                      return (
                        <CommandItem key={id} value={`${heading} ${title}`} onSelect={() => go(url)}>
                          <Icon className={`mr-2 h-4 w-4 ${AREA_TEXT[tone]}`} />
                          <span>{title}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                );
              })}

              {CREATE_GROUPS.map(({ id, heading }) => {
                const visible = createActionsFor(id).filter(
                  (action) => !action.gate || createCapabilities[CAPABILITY_FLAG[action.gate]],
                );
                if (visible.length === 0) return null;
                return (
                  <CommandGroup key={id} heading={heading}>
                    {visible.map(({ id: actionId, title, url, icon: Icon, text }) => (
                      <CommandItem key={actionId} value={`${heading} ${title}`} onSelect={() => go(url)}>
                        <Icon className={`mr-2 h-4 w-4 ${text}`} />
                        <span>{title}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                );
              })}
            </CommandList>
            <div className="flex justify-end items-center px-4 py-2 border-t text-xs text-muted-foreground select-none">
              <span className="mr-4">↑↓ Navigate</span>
              <span>↩ Select</span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </div>
  );
}
