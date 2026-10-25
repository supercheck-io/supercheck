"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 p-0 text-muted-foreground"
          aria-label={ariaLabel}
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2 p-4" side="bottom" align={align} sideOffset={8}>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          {bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
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
