"use client";

import * as React from "react";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Globe,
  Code,
  SearchIcon,
  BellRing,
  LaptopMinimal,
  ChartColumn,
  CalendarClock,
  Chrome,
  ArrowLeftRight,
  Database,
  SquareFunction,
  ChevronsLeftRightEllipsis,
  EthernetPort,
  Variable,
  Tally4,
  RefreshCw,
} from "lucide-react";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";

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

interface CommandSearchProps {
  className?: string;
}

export function CommandSearch({ className }: CommandSearchProps) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  const handleCommand = useCallback(
    (command: string) => {
      setOpen(false);

      const routes: Record<string, string> = {
        // Navigation
        home: "/",
        dashboard: "/",
        monitors: "/monitors",
        tests: "/tests",
        jobs: "/jobs",
        runs: "/runs",
        variables: "/variables",
        alerts: "/alerts",
        "status-pages": "/status-pages",

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
        "create-job": "/jobs/create",

        // Quick Actions
        "view-critical-alerts": "/monitors?filter=down",
        "view-running-jobs": "/jobs?status=running",
        "view-recent-runs": "/runs?sort=recent",
        "view-failed-tests": "/tests?status=failed",

        // System
        "queue-stats": "/api/queue-stats",
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
    [router]
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
        className="h-8 px-2 min-w-[96px] justify-between mr-2 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center space-x-1">
          <SearchIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">CMD</span>
        </div>
        <kbd className="inline-flex h-4 items-center rounded border bg-muted px-1 text-[9px] font-mono text-muted-foreground">
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
                <CommandItem onSelect={() => handleCommand("home")}>
                  <ChartColumn className="mr-2 h-4 w-4 !text-slate-400" />
                  <span>Dashboard</span>
                </CommandItem>
                <CommandItem onSelect={() => handleCommand("alerts")}>
                  <BellRing className="mr-2 h-4 w-4 !text-amber-600" />
                  <span>Alerts</span>
                </CommandItem>
                <CommandItem onSelect={() => handleCommand("status-pages")}>
                  <Tally4 className="mr-2 h-4 w-4 !text-green-600" />
                  <span>Status Pages</span>
                </CommandItem>
                <CommandItem onSelect={() => handleCommand("tests")}>
                  <Code className="mr-2 h-4 w-4 !text-blue-600" />
                  <span>Tests</span>
                </CommandItem>
                <CommandItem onSelect={() => handleCommand("jobs")}>
                  <CalendarClock className="mr-2 h-4 w-4 !text-violet-600" />
                  <span>Jobs</span>
                </CommandItem>
                <CommandItem onSelect={() => handleCommand("runs")}>
                  <RefreshCw className="mr-2 h-4 w-4 !text-teal-600" />
                  <span>Runs</span>
                </CommandItem>
                <CommandItem onSelect={() => handleCommand("variables")}>
                  <Variable className="mr-2 h-4 w-4 !text-zinc-400" />
                  <span>Variables</span>
                </CommandItem>
                <CommandItem onSelect={() => handleCommand("monitors")}>
                  <Globe className="mr-2 h-4 w-4 !text-cyan-600" />
                  <span>Monitors</span>
                </CommandItem>
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading="Create Tests">
                <CommandItem
                  onSelect={() => handleCommand("create-test-browser")}
                >
                  <Chrome className="mr-2 h-4 w-4 !text-sky-600" />
                  <span>Browser Test</span>
                </CommandItem>
                <CommandItem onSelect={() => handleCommand("create-test-api")}>
                  <ArrowLeftRight className="mr-2 h-4 w-4 !text-teal-600" />
                  <span>API Test</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => handleCommand("create-test-database")}
                >
                  <Database className="mr-2 h-4 w-4 !text-cyan-600" />
                  <span>Database Test</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => handleCommand("create-test-custom")}
                >
                  <SquareFunction className="mr-2 h-4 w-4 !text-blue-600" />
                  <span>Custom Test</span>
                </CommandItem>
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading="Create Monitors">
                <CommandItem
                  onSelect={() => handleCommand("create-monitor-http")}
                >
                  <ArrowLeftRight className="mr-2 h-4 w-4 !text-teal-600" />
                  <span>HTTP Monitor</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => handleCommand("create-monitor-website")}
                >
                  <LaptopMinimal className="mr-2 h-4 w-4 !text-sky-600" />
                  <span>Website Monitor</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => handleCommand("create-monitor-ping")}
                >
                  <ChevronsLeftRightEllipsis className="mr-2 h-4 w-4 !text-cyan-600" />
                  <span>Ping Monitor</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => handleCommand("create-monitor-port")}
                >
                  <EthernetPort className="mr-2 h-4 w-4 !text-blue-600" />
                  <span>Port Monitor</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => handleCommand("create-monitor-synthetic")}
                >
                  <PlaywrightLogo className="mr-2 h-4 w-4 !text-purple-600" />
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
