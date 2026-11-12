"use client";

import * as React from "react";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  SearchIcon,
  LaptopMinimal,
  Chrome,
  ArrowLeftRight,
  Database,
  SquareFunction,
  ChevronsLeftRightEllipsis,
  EthernetPort,
} from "lucide-react";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { K6Logo } from "@/components/logo/k6-logo";

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
import { typeTextForce } from "@/lib/type-tones";

function NavCommandItem({ id, onSelect }: { id: keyof typeof NAV; onSelect: () => void }) {
  const { title, icon: Icon, tone } = NAV[id];
  return (
    <CommandItem onSelect={onSelect}>
      <Icon className={`mr-2 h-4 w-4 ${AREA_TEXT[tone]}`} />
      <span>{title}</span>
    </CommandItem>
  );
}

interface CommandSearchProps {
  className?: string;
  canInvestigateSre?: boolean;
  canConfigureSre?: boolean;
}

export function CommandSearch({
  className,
  canInvestigateSre = false,
  canConfigureSre = false,
}: CommandSearchProps) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  const handleCommand = useCallback(
    (command: string) => {
      setOpen(false);

      const routes: Record<string, string> = {
        // Navigation
        home: "/",
        dashboard: "/",
        requirements: "/requirements",
        monitors: "/monitors",
        tests: "/tests",
        jobs: "/jobs",
        runs: "/runs",
        variables: "/variables",
        alerts: "/notifications?tab=history",
        notifications: "/notifications",
        incidents: "/incidents",
        "status-pages": "/status-pages",
        admin: "/org-admin",
        ...(canConfigureSre
          ? {
              "admin-services": "/services",
              "admin-integrations": "/org-admin?tab=integrations",
              "admin-diagnostic-recipes":
                "/org-admin?tab=integrations&section=saved-queries",
              "admin-private-agents": "/org-admin?tab=private-agents",
            }
          : {}),
        ...(canInvestigateSre
          ? {
              "investigation-chat": "/copilot",
            }
          : {}),

        // Create Actions
        "create-monitor-http": "/monitors/create?type=http_request",
        "create-monitor-website": "/monitors/create?type=website",
        "create-monitor-ping": "/monitors/create?type=ping_host",
        "create-monitor-port": "/monitors/create?type=port_check",
        "create-monitor-synthetic": "/monitors/create?type=synthetic_test",
        "create-test-browser": "/playground?scriptType=browser",
        "create-test-api": "/playground?scriptType=api",
        "create-test-custom": "/playground?scriptType=custom",
        "create-test-database": "/playground?scriptType=database",
        "create-test-performance": "/playground?scriptType=performance",
        "create-job": "/jobs/create",

        // Quick Actions
        "view-critical-alerts": "/monitors?filter=down",
        "view-running-jobs": "/jobs?status=running",
        "view-recent-runs": "/runs?sort=recent",
        "view-failed-tests": "/tests?status=failed",

        // System
        "system-health": "/api/dashboard",
      };

      const route = routes[command];
      if (route) {
        if (route.startsWith("/api/")) {
          window.open(route, "_blank");
        } else {
          router.push(route);
        }
      }
    },
    [canConfigureSre, canInvestigateSre, router],
  );

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

              <CommandGroup heading="Navigation">
                <NavCommandItem id="dashboard" onSelect={() => handleCommand("home")} />
                <NavCommandItem id="deliveryHistory" onSelect={() => handleCommand("alerts")} />
                <NavCommandItem id="incidents" onSelect={() => handleCommand("incidents")} />
                <NavCommandItem id="notifications" onSelect={() => handleCommand("notifications")} />
                <NavCommandItem id="statusPages" onSelect={() => handleCommand("status-pages")} />
                <NavCommandItem id="requirements" onSelect={() => handleCommand("requirements")} />
                <NavCommandItem id="tests" onSelect={() => handleCommand("tests")} />
                <NavCommandItem id="jobs" onSelect={() => handleCommand("jobs")} />
                <NavCommandItem id="runs" onSelect={() => handleCommand("runs")} />
                <NavCommandItem id="variables" onSelect={() => handleCommand("variables")} />
                <NavCommandItem id="monitors" onSelect={() => handleCommand("monitors")} />
              </CommandGroup>

              <CommandSeparator />

              {canInvestigateSre && (
                <>
                  <CommandGroup heading="Respond">
                    <NavCommandItem id="copilot" onSelect={() => handleCommand("investigation-chat")} />
                  </CommandGroup>

                  <CommandSeparator />
                </>
              )}

              <CommandGroup heading="Admin">
                <NavCommandItem id="organization" onSelect={() => handleCommand("admin")} />
                {canConfigureSre && (
                  <>
                    <NavCommandItem id="services" onSelect={() => handleCommand("admin-services")} />
                    <NavCommandItem id="integrations" onSelect={() => handleCommand("admin-integrations")} />
                    <NavCommandItem id="savedQueries" onSelect={() => handleCommand("admin-diagnostic-recipes")} />
                    <NavCommandItem id="privateAgents" onSelect={() => handleCommand("admin-private-agents")} />
                  </>
                )}
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading="Create Tests">
                <CommandItem
                  onSelect={() => handleCommand("create-test-browser")}
                >
                  <Chrome className={`mr-2 h-4 w-4 ${typeTextForce("test", "browser")}`} />
                  <span>Browser Test</span>
                </CommandItem>
                <CommandItem onSelect={() => handleCommand("create-test-api")}>
                  <ArrowLeftRight className={`mr-2 h-4 w-4 ${typeTextForce("test", "api")}`} />
                  <span>API Test</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => handleCommand("create-test-database")}
                >
                  <Database className={`mr-2 h-4 w-4 ${typeTextForce("test", "database")}`} />
                  <span>Database Test</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => handleCommand("create-test-custom")}
                >
                  <SquareFunction className={`mr-2 h-4 w-4 ${typeTextForce("test", "custom")}`} />
                  <span>Custom Test</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => handleCommand("create-test-performance")}
                >
                  <K6Logo className="mr-2 h-4 w-4" />
                  <span>Performance Test</span>
                </CommandItem>
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading="Create Monitors">
                <CommandItem
                  onSelect={() => handleCommand("create-monitor-http")}
                >
                  <ArrowLeftRight className={`mr-2 h-4 w-4 ${typeTextForce("monitor", "http_request")}`} />
                  <span>HTTP Monitor</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => handleCommand("create-monitor-website")}
                >
                  <LaptopMinimal className={`mr-2 h-4 w-4 ${typeTextForce("monitor", "website")}`} />
                  <span>Website Monitor</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => handleCommand("create-monitor-ping")}
                >
                  <ChevronsLeftRightEllipsis className={`mr-2 h-4 w-4 ${typeTextForce("monitor", "ping_host")}`} />
                  <span>Ping Monitor</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => handleCommand("create-monitor-port")}
                >
                  <EthernetPort className={`mr-2 h-4 w-4 ${typeTextForce("monitor", "port_check")}`} />
                  <span>Port Monitor</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => handleCommand("create-monitor-synthetic")}
                >
                  <PlaywrightLogo className="mr-2 h-4 w-4" />
                  <span>Synthetic Monitor</span>
                </CommandItem>
              </CommandGroup>
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
