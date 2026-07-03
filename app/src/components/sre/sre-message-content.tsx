import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];

type ParsedSreChart = {
  title?: string;
  type: "bar" | "line";
  data: Array<Record<string, string | number>>;
  series: Array<{ key: string; label: string }>;
};

function renderInlineMarkdown(text: string) {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts = text.split(pattern);

  parts.forEach((part, index) => {
    if (!part) return;

    if (part.startsWith("**") && part.endsWith("**")) {
      nodes.push(<strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>);
      return;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      nodes.push(
        <code key={`${part}-${index}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]">
          {part.slice(1, -1)}
        </code>
      );
      return;
    }

    nodes.push(part);
  });

  return nodes;
}

function isMarkdownTableSeparator(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseSreChartBlock(value: string): ParsedSreChart | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const type = record.type === "line" ? "line" : record.type === "bar" ? "bar" : null;
  const xKey = typeof record.xKey === "string" ? record.xKey : null;
  const rawSeries = Array.isArray(record.series) ? record.series.slice(0, 3) : [];
  const rawData = Array.isArray(record.data) ? record.data.slice(0, 24) : [];

  if (!type || !xKey || rawSeries.length === 0 || rawData.length === 0) return null;

  const series = rawSeries.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];

    const itemRecord = item as Record<string, unknown>;
    const key = typeof itemRecord.key === "string" ? itemRecord.key : null;
    const label = typeof itemRecord.label === "string" && itemRecord.label.trim() ? itemRecord.label.trim() : key;
    return key && label ? [{ key, label: label.slice(0, 48) }] : [];
  });

  if (series.length === 0) return null;

  const data = rawData.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];

    const itemRecord = item as Record<string, unknown>;
    const labelValue = itemRecord[xKey];
    const row: Record<string, string | number> = {
      label: typeof labelValue === "number" || typeof labelValue === "string" ? String(labelValue).slice(0, 80) : "",
    };

    series.forEach((entry, index) => {
      const rawValue = itemRecord[entry.key];
      row[`series${index}`] = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : 0;
    });

    return row.label ? [row] : [];
  });

  if (data.length === 0) return null;

  return {
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim().slice(0, 80) : undefined,
    type,
    data,
    series,
  };
}

function SreInlineChart({ chart }: { chart: ParsedSreChart }) {
  const chartConfig = chart.series.reduce<ChartConfig>((config, series, index) => {
    config[`series${index}`] = {
      label: series.label,
      color: CHART_COLORS[index] ?? CHART_COLORS[0],
    };
    return config;
  }, {});

  return (
    <div className="rounded-lg border bg-background p-3">
      {chart.title && <p className="mb-3 text-sm font-medium">{chart.title}</p>}
      <ChartContainer config={chartConfig} className="h-56 w-full">
        {chart.type === "bar" ? (
          <BarChart data={chart.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} width={36} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {chart.series.map((_, index) => (
              <Bar key={`series${index}`} dataKey={`series${index}`} fill={`var(--color-series${index})`} radius={4} />
            ))}
          </BarChart>
        ) : (
          <LineChart data={chart.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} width={36} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {chart.series.map((_, index) => (
              <Line
                key={`series${index}`}
                type="monotone"
                dataKey={`series${index}`}
                stroke={`var(--color-series${index})`}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        )}
      </ChartContainer>
    </div>
  );
}

export function SreMessageContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const rendered: ReactNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);

    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 2;
      rendered.push(
        <p
          key={`heading-${index}`}
          className={cn("font-semibold leading-6 text-foreground", level <= 2 ? "mt-2 text-base" : "mt-1 text-sm")}
        >
          {renderInlineMarkdown(headingMatch[2] ?? "")}
        </p>
      );
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      const language = trimmed.slice(3).trim();
      let codeIndex = index + 1;

      while (codeIndex < lines.length && !(lines[codeIndex] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[codeIndex] ?? "");
        codeIndex += 1;
      }

      if (language === "chart") {
        const chart = parseSreChartBlock(codeLines.join("\n"));
        if (chart) {
          rendered.push(<SreInlineChart key={`chart-${index}`} chart={chart} />);
          index = codeIndex;
          continue;
        }
      }

      rendered.push(
        <pre key={`code-${index}`} className="overflow-x-auto rounded-lg border bg-muted/30 p-3 text-xs leading-5">
          {language && <span className="mb-2 block text-[11px] font-medium text-muted-foreground">{language}</span>}
          <code className="font-mono">{codeLines.join("\n")}</code>
        </pre>
      );
      index = codeIndex;
      continue;
    }

    if (trimmed.includes("|") && isMarkdownTableSeparator(lines[index + 1] ?? "")) {
      const header = splitMarkdownTableRow(trimmed);
      const rows: string[][] = [];
      let tableIndex = index + 2;

      while (tableIndex < lines.length && (lines[tableIndex] ?? "").trim().includes("|")) {
        rows.push(splitMarkdownTableRow(lines[tableIndex] ?? ""));
        tableIndex += 1;
      }

      rendered.push(
        <div key={`table-${index}`} className="overflow-hidden rounded-lg border">
          <Table className="bg-background text-xs">
            <TableHeader>
              <TableRow>
                {header.map((cell, cellIndex) => (
                  <TableHead key={`${cell}-${cellIndex}`} className="h-8 whitespace-normal px-3">
                    {renderInlineMarkdown(cell)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, rowIndex) => (
                <TableRow key={`row-${rowIndex}`}>
                  {header.map((_, cellIndex) => (
                    <TableCell key={`cell-${rowIndex}-${cellIndex}`} className="whitespace-normal px-3 py-2">
                      {renderInlineMarkdown(row[cellIndex] ?? "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
      index = tableIndex - 1;
      continue;
    }

    const orderedMatch = /^(\d+)\.\s+(.*)$/.exec(trimmed);
    const unorderedMatch = /^[-*]\s+(.*)$/.exec(trimmed);

    if (!trimmed) {
      rendered.push(<div key={`break-${index}`} className="h-1" aria-hidden="true" />);
      continue;
    }

    if (orderedMatch) {
      rendered.push(
        <div key={`${line}-${index}`} className="flex gap-2">
          <span className="mt-px min-w-5 shrink-0 font-medium text-muted-foreground">{orderedMatch[1]}.</span>
          <span className="min-w-0">{renderInlineMarkdown(orderedMatch[2] ?? "")}</span>
        </div>
      );
      continue;
    }

    if (unorderedMatch) {
      rendered.push(
        <div key={`${line}-${index}`} className="flex gap-2">
          <span className="mt-px shrink-0 text-muted-foreground">-</span>
          <span className="min-w-0">{renderInlineMarkdown(unorderedMatch[1] ?? "")}</span>
        </div>
      );
      continue;
    }

    rendered.push(<p key={`${line}-${index}`}>{renderInlineMarkdown(trimmed)}</p>);
  }

  return <div className="flex flex-col gap-2">{rendered}</div>;
}
