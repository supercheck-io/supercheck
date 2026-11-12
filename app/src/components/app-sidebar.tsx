"use client";

import * as React from "react";
import { useSyncExternalStore } from "react";
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

import { NavMain } from "@/components/nav-main";
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
      tone: NAV.superAdmin.tone,
    },
  ],
  OrgAdmin: [
    {
      title: NAV.organization.title,
      url: "/org-admin",
      icon: NAV.organization.icon,
      tone: NAV.organization.tone,
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

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
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
        <NavMain groupLabel="Respond" items={data.Respond} />
        <NavMain groupLabel="Communicate" items={data.Communicate} />
        <NavMain groupLabel="Automate" items={data.Automate} />
        <NavMain groupLabel="Monitor" items={data.Monitor} />
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
