"use client";

import { ChevronRight, type LucideIcon } from "lucide-react";
import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useProjectContext } from "@/hooks/use-project-context";
import { prefetchSidebarRoute } from "@/lib/prefetch-utils";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import Link from "next/link";
import React from "react";

function HoverPrefetchLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { currentProject } = useProjectContext();
  const prefetchedRef = useRef(false);

  const handleMouseEnter = useCallback(() => {
    if (!prefetchedRef.current) {
      prefetchedRef.current = true;
      router.prefetch(href);
      prefetchSidebarRoute(href, currentProject?.id ?? null, queryClient);
    }
  }, [router, href, queryClient, currentProject?.id]);

  return (
    <Link
      href={href}
      prefetch={false}
      onMouseEnter={handleMouseEnter}
      className={className}
    >
      {children}
    </Link>
  );
}

type IconComponent = LucideIcon | React.ComponentType<{ className?: string }>;

export type SubItem = {
  title: string;
  url: string;
  icon?: IconComponent;
  color?: string;
};

export type MenuItem = {
  title: string;
  url: string;
  icon?: IconComponent;
  isActive?: boolean;
  badge?: string;
  items?: (SubItem | { groupLabel?: string; items?: SubItem[] })[];
};

export function NavMain({
  groupLabel,
  items,
}: {
  groupLabel: string;
  items: MenuItem[];
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{groupLabel}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <Collapsible
            key={item.title}
            asChild
            defaultOpen={item.isActive}
            className="group/collapsible"
          >
            <SidebarMenuItem>
              {item.items && (
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title}>
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                    {item.items && (
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    )}
                  </SidebarMenuButton>
                </CollapsibleTrigger>
              )}
              {!item.items && (
                <SidebarMenuButton tooltip={item.title} asChild>
                  {item.url.startsWith("http") ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.icon && <item.icon />}
                      <span>{item.title}</span>
                      {item.badge && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {item.badge}
                        </span>
                      )}
                    </a>
                  ) : (
                    <HoverPrefetchLink href={item.url}>
                      {item.icon && <item.icon />}
                      <span>{item.title}</span>
                      {item.badge && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {item.badge}
                        </span>
                      )}
                    </HoverPrefetchLink>
                  )}
                </SidebarMenuButton>
              )}

              <CollapsibleContent>
                <SidebarMenuSub>
                  {item.items?.map((subItem, idx) => {
                    if ("groupLabel" in subItem && !("title" in subItem)) {
                      return (
                        <div
                          key={`group-${idx}`}
                          className="text-sidebar-foreground/70 flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium"
                        >
                          {subItem.groupLabel}
                        </div>
                      );
                    }

                    if ("items" in subItem && !("url" in subItem)) {
                      return (
                        <React.Fragment key={`group-items-${idx}`}>
                          {subItem.items?.map((item) => {
                            const ItemIcon = item.icon;
                            return (
                              <SidebarMenuSubItem key={item.title}>
                                <SidebarMenuSubButton asChild>
                                  <HoverPrefetchLink href={item.url}>
                                    {ItemIcon && (
                                      <ItemIcon
                                        className={`h-4 w-4 ${item.color || ""
                                          }`}
                                      />
                                    )}
                                    <span>{item.title}</span>
                                  </HoverPrefetchLink>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                        </React.Fragment>
                      );
                    }

                    const regularItem = subItem as SubItem;
                    const IconComponent = regularItem.icon;
                    return (
                      <SidebarMenuSubItem key={regularItem.title}>
                        <SidebarMenuSubButton asChild>
                          <HoverPrefetchLink href={regularItem.url}>
                            {IconComponent && (
                              <IconComponent
                                className={`h-4 w-4 ${regularItem.color || ""}`}
                              />
                            )}
                            <span>{regularItem.title}</span>
                          </HoverPrefetchLink>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
