"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { InfoPopover } from "@/components/ui/info-popover";

export interface MetricInfo {
  title: string;
  description: string;
  bullets: string[];
  ariaLabel: string;
}

export function MetricInfoButton({
  title,
  description,
  bullets,
  ariaLabel,
  align = "start",
}: MetricInfo & { align?: "start" | "center" | "end" }) {
  return (
    <InfoPopover
      label={ariaLabel}
      title={title}
      description={description}
      bullets={bullets}
      align={align}
      className="h-5 w-5"
    />
  );
}

interface MetricCardProps {
  title: string;
  /** Large value. When omitted the `emptyMessage` is shown instead. */
  value?: string;
  caption?: React.ReactNode;
  emptyMessage?: string;
  href?: string;
  info?: MetricInfo;
  testId?: string;
}

/** KPI card: muted title row, value, caption; the value area links to its detail page. */
export function MetricCard({
  title,
  value,
  caption,
  emptyMessage,
  href,
  info,
  testId,
}: MetricCardProps) {
  const body =
    value !== undefined ? (
      <>
        <div className="truncate text-2xl font-bold tracking-tight">{value}</div>
        {caption ? (
          <p className="truncate text-xs text-muted-foreground">{caption}</p>
        ) : null}
      </>
    ) : (
      <p className="py-1 text-sm text-muted-foreground">{emptyMessage}</p>
    );

  return (
    <Card data-testid={testId}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
          {title}
          {info ? <MetricInfoButton {...info} /> : null}
        </div>
        {href ? (
          <Link
            href={href}
            className="block space-y-1 rounded-sm outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {body}
          </Link>
        ) : (
          <div className="space-y-1">{body}</div>
        )}
      </CardContent>
    </Card>
  );
}
