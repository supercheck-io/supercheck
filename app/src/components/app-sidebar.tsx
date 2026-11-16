"use client";

import * as React from "react";
import { useContext, useSyncExternalStore } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import {
  SquarePlus,
  BookOpenText,
  Plus,
  Chrome,
  ArrowLeftRight,
  Database,
  SquareFunction,
  LaptopMinimal,
  ChevronsLeftRightEllipsis,
  EthernetPort,
  type LucideIcon,
} from "lucide-react";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { K6Logo } from "@/components/logo/k6-logo";

import { NavMain, type MenuItem } from "@/components/nav-main";
import { ProjectSwitcher } from "@/components/project-switcher";
import { ImpersonationCard } from "@/components/impersonation-card";
import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useAdminStatus } from "@/hooks/use-admin-status";
import { NAV } from "@/lib/nav-areas";
import { createActionsFor, type CreateGroupId } from "@/lib/create-actions";
import { useAppConfig } from "@/hooks/use-app-config";
import { useProjectContextSafe } from "@/hooks/use-project-context";
import { useProjectSetup, useUserPreferences } from "@/hooks/use-project-setup";
import { sidebarLayout, type SidebarGroup as PersonaGroup, type UserPersona } from "@/lib/setup/persona";
import { getReleaseVersionBadge } from "@/lib/release-metadata";

// Internal: build-time value baked in by the release image build; not an operator setting.
const releaseVersionBadge = getReleaseVersionBadge(
  process.env.NEXT_PUBLIC_SUPERCHECK_VERSION,
);

// Create menus render from the shared registry, so they match Cmd+K and Quick Create.
const sidebarItems = (group: CreateGroupId) =>
  createActionsFor(group).map(({ title, url, icon, force }) => ({ title, url, icon, color: force }));

// Sidebar navigation data
const data = {
  Respond: [
    {
      title: NAV.dashboard.title,
      url: "/",
      icon: NAV.dashboard.icon,
      isActive: true,
    },
    {
      title: NAV.incidents.title,
      url: "/incidents",
      icon: NAV.incidents.icon,
    },
    {
      title: NAV.copilot.title,
      url: "/copilot",
      icon: NAV.copilot.icon,
      tone: NAV.copilot.tone,
    },
    {
      title: NAV.services.title,
      url: "/services",
      icon: NAV.services.icon,
    },
  ],

  Communicate: [
    {
      title: NAV.statusPages.title,
      url: "/status-pages",
      icon: NAV.statusPages.icon,
      tone: NAV.statusPages.tone,
    },
    {
      title: NAV.notifications.title,
      url: "/notifications",
      icon: NAV.notifications.icon,
    },
  ],

  Automate: [
    {
      title: "Create",
      url: "#",
      icon: SquarePlus,

      items: [
        { groupLabel: "Functional" },
        { items: sidebarItems("tests").slice(0, 4) },
        { groupLabel: "Non-Functional" },
        { items: sidebarItems("tests").slice(4) },
      ],
    },
    {
      title: NAV.requirements.title,
      url: "/requirements",
      icon: NAV.requirements.icon,
    },
    {
      title: NAV.tests.title,
      url: "/tests",
      icon: NAV.tests.icon,
    },
    {
      title: NAV.jobs.title,
      url: "/jobs",
      icon: NAV.jobs.icon,
    },
    {
      title: NAV.runs.title,
      url: "/runs",
      icon: NAV.runs.icon,
    },
    {
      title: NAV.variables.title,
      url: "/variables",
      icon: NAV.variables.icon,
    },
  ],

  Monitor: [
    {
      title: "Create",
      url: "#",
      icon: SquarePlus,
      items: sidebarItems("monitors"),
    },
    {
      title: NAV.monitors.title,
      url: "/monitors",
      icon: NAV.monitors.icon,
    },
  ],

  SuperAdmin: [
    {
      title: NAV.superAdmin.title,
      url: "/super-admin",
      icon: NAV.superAdmin.icon,
    },
  ],
  OrgAdmin: [
    {
      title: NAV.organization.title,
      url: "/org-admin",
      icon: NAV.organization.icon,
    },
  ],

  navSecondary: [
    {
      title: "Docs",
      url: "https://supercheck.io/docs/app/welcome",
      icon: BookOpenText,
      badge: releaseVersionBadge,
    },
  ],
};

type SidebarProps = React.ComponentProps<typeof Sidebar>;

/** Persona + setup progress. Absent (null) renders today's sidebar exactly. */
interface SidebarPrefs {
  persona: UserPersona | null;
  setupBadge: string | null;
}

// Reads preferences only under a QueryClient, so the sidebar still renders without one.
export function AppSidebar(props: SidebarProps) {
  const hasQueryClient = useContext(QueryClientContext) !== undefined;
  return hasQueryClient ? (
    <AppSidebarWithPrefs {...props} />
  ) : (
    <AppSidebarView {...props} prefs={{ persona: null, setupBadge: null }} />
  );
}

function AppSidebarWithPrefs(props: SidebarProps) {
  const { data: preferences } = useUserPreferences();
  const { setupFeatures } = useAppConfig();
  const projectId = useProjectContextSafe()?.currentProject?.id ?? null;
  const { data: setup } = useProjectSetup(setupFeatures.setup ? projectId : null);
  const open = setup && setup.state.status !== "completed" && setup.state.status !== "dismissed";
  return (
    <AppSidebarView
      {...props}
      prefs={{
        persona: preferences?.persona ?? null,
        setupBadge: open ? `${setup.checklist.done}/${setup.checklist.total}` : null,
      }}
    />
  );
}

function AppSidebarView({ prefs, ...props }: SidebarProps & { prefs: SidebarPrefs }) {
  // HYDRATION FIX: Track client mount state to prevent hydration errors
  // with synchronous localStorage restoration.
  // Server will return false, Client will return true after mounting.
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Use cached admin status hook (React Query cached for 5 minutes)
  const {
    isAdmin,
    isOrgAdmin,
    isLoading: isAdminStatusLoading,
  } = useAdminStatus();

  // Status is loaded when mounted AND not loading
  // On server/initial render: isMounted=false, so isAdminStatusLoaded=false
  // After hydration: isMounted=true, isAdminStatusLoaded depends on cache
  const isAdminStatusLoaded = isMounted && !isAdminStatusLoading;

  // Create combined admin items based on admin status
  const adminItems = React.useMemo(() => {
    // Don't show admin items until status is loaded to prevent hydration issues
    if (!isAdminStatusLoaded) {
      return [];
    }

    type IconComponent =
      | LucideIcon
      | React.ComponentType<{ className?: string }>;

    type AdminItem = {
      title: string;
      url: string;
      icon: IconComponent;
      isActive?: boolean;
      items?: Array<{
        title: string;
        url: string;
        icon?: IconComponent;
        color?: string;
      }>;
    };

    const baseSettings: AdminItem[] = [];

    if (isOrgAdmin) {
      baseSettings.push(...(data.OrgAdmin as AdminItem[]));
    }

    if (isAdmin) {
      baseSettings.push(...(data.SuperAdmin as AdminItem[]));
    }

    return baseSettings;
  }, [isAdmin, isOrgAdmin, isAdminStatusLoaded]);

  const layout = sidebarLayout(prefs.persona);
  const personaOn = prefs.persona !== null;
  // With a persona set Dashboard moves to the top block so a folded group never hides it.
  const respondItems = personaOn ? data.Respond.slice(1) : data.Respond;
  const topItems: MenuItem[] = [
    ...(personaOn
      ? [{ title: NAV.dashboard.title, url: "/", icon: NAV.dashboard.icon, tone: NAV.dashboard.tone }]
      : []),
    ...(prefs.setupBadge
      ? [{ title: NAV.projectSetup.title, url: "/setup", icon: NAV.projectSetup.icon, tone: NAV.projectSetup.tone, badge: prefs.setupBadge }]
      : []),
  ];
  const fold = (group: PersonaGroup) => ({
    collapsible: personaOn,
    defaultOpen: layout.expanded === null || layout.expanded === group,
  });
  // Literal groupLabel strings stay in this order: the command palette spec reads them from source.
  const groups: Record<PersonaGroup, React.ReactNode> = {
    Respond: <NavMain key="Respond" groupLabel="Respond" items={respondItems} {...fold("Respond")} />,
    Communicate: <NavMain key="Communicate" groupLabel="Communicate" items={data.Communicate} {...fold("Communicate")} />,
    Automate: <NavMain key="Automate" groupLabel="Automate" items={data.Automate} {...fold("Automate")} />,
    Monitor: <NavMain key="Monitor" groupLabel="Monitor" items={data.Monitor} {...fold("Monitor")} />,
  };

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="group-data-[collapsible=icon]:px-0 border-t">
        <ProjectSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="-mb-2 ">
          <SidebarMenu>
            <SidebarMenuItem>
              <Link href="/create" className="flex w-full">
                <SidebarMenuButton
                  tooltip="Quick Create"
                  className="flex items-center justify-center min-w-7 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground  w-[90%] ml-[5%] mr-[5%] group-data-[collapsible=icon]:mt-3 group-data-[collapsible=icon]:mb-2"
                >
                  <Plus className="h-4 w-4 ml-2" />
                  <span> Quick Create</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        {topItems.length > 0 && <NavMain groupLabel="" items={topItems} />}
        {layout.order.map((group) => groups[group])}
        {adminItems.length > 0 && (
          <NavMain groupLabel="Settings" items={adminItems} />
        )}
      </SidebarContent>
      <NavMain groupLabel="" items={data.navSecondary} />
      <SidebarFooter>
        <ImpersonationCard />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
