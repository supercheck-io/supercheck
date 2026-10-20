"use client";

import React from "react";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useBreadcrumbs } from "@/components/breadcrumb-context";
import { Home } from "lucide-react";
import { cn } from "@/lib/utils";

export function BreadcrumbDisplay() {
  const { breadcrumbs } = useBreadcrumbs();

  if (!breadcrumbs || breadcrumbs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        <Home className="h-4 w-4" />
      </div>
    );
  }

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="min-w-0 flex-nowrap overflow-hidden">
        {breadcrumbs.map((item, index) => {
          const isLast = index === breadcrumbs.length - 1;
          const isHome = item.label === "Home";
          const label = isHome ? (
            <Home className="h-4 w-4 shrink-0" />
          ) : (
            item.label
          );

          return (
            <React.Fragment key={`${item.label}-${index}`}>
              <BreadcrumbItem
                className={cn(
                  isHome ? "shrink-0" : "min-w-0",
                  isLast && "flex-1",
                )}
              >
                {item.isCurrentPage ? (
                  <BreadcrumbPage
                    className={cn(isHome ? "flex" : "min-w-0 truncate")}
                    title={isHome ? undefined : item.label}
                  >
                    {label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    asChild
                    className={cn(isHome ? "flex" : "min-w-0 truncate")}
                    title={isHome ? undefined : item.label}
                  >
                    <Link href={item.href || "#"}>{label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator className="shrink-0" />}
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
