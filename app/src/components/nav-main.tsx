"use client";

import { ChevronRight, type LucideIcon } from "lucide-react";

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

// Type for icon that accepts both LucideIcon and custom React components
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
                    <Link href={item.url}>
                      {item.icon && <item.icon />}
                      <span>{item.title}</span>
                      {item.badge && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  )}
                </SidebarMenuButton>
              )}

              <CollapsibleContent>
                <SidebarMenuSub>
                  {item.items?.map((subItem, idx) => {
                    // Check if this is a group label item
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

                    // Handle group items
                    if ("items" in subItem && !("url" in subItem)) {
                      return (
                        <React.Fragment key={`group-items-${idx}`}>
                          {subItem.items?.map((item) => {
                            const ItemIcon = item.icon;
                            return (
                              <SidebarMenuSubItem key={item.title}>
                                <SidebarMenuSubButton asChild>
                                  <Link href={item.url}>
                                    {ItemIcon && (
                                      <ItemIcon
                                        className={`h-4 w-4 ${item.color || ""
                                          }`}
                                      />
                                    )}
                                    <span>{item.title}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                        </React.Fragment>
                      );
                    }

                    // Regular sub item
                    const regularItem = subItem as SubItem;
                    const IconComponent = regularItem.icon;
                    return (
                      <SidebarMenuSubItem key={regularItem.title}>
                        <SidebarMenuSubButton asChild>
                          <Link href={regularItem.url}>
                            {IconComponent && (
                              <IconComponent
                                className={`h-4 w-4 ${regularItem.color || ""}`}
                              />
                            )}
                            <span>{regularItem.title}</span>
                          </Link>
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
