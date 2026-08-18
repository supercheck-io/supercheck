import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
];

const LARGE_OUTPUT_LINE_THRESHOLD = 500;
const LARGE_OUTPUT_LINE_HEIGHT = 20;

type ParsedSreChart = {
  title?: string;
  description?: string;
  type: "area" | "bar" | "line";
  data: Array<Record<string, string | number>>;
  series: Array<{ key: string; label: string }>;
  sources: Array<{
    label: string;
    type?: string;
    query?: string;
    evidenceIds: string[];
  }>;
};

function safeChartText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

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
        <code
          key={`${part}-${index}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]"
        >
          {part.slice(1, -1)}
        </code>,
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

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return null;

  const record = parsed as Record<string, unknown>;
  const type =
    record.type === "line"
      ? "line"
      : record.type === "bar"
        ? "bar"
        : record.type === "area"
          ? "area"
          : null;
  const xKey = typeof record.xKey === "string" ? record.xKey : null;
  const rawSeries = Array.isArray(record.series)
    ? record.series.slice(0, 4)
    : [];
  const rawData = Array.isArray(record.data) ? record.data.slice(0, 48) : [];

  if (!type || !xKey || rawSeries.length === 0 || rawData.length === 0)
    return null;

  const series = rawSeries.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      return [];

    const itemRecord = item as Record<string, unknown>;
    const key = typeof itemRecord.key === "string" ? itemRecord.key : null;
    const label =
      typeof itemRecord.label === "string" && itemRecord.label.trim()
        ? itemRecord.label.trim()
        : key;
    return key && label ? [{ key, label: label.slice(0, 48) }] : [];
  });

  if (series.length === 0) return null;

  const rawSources = Array.isArray(record.sources)
    ? record.sources.slice(0, 3)
    : record.source
      ? [record.source]
      : [];
  const sources = rawSources.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return [];
    }

    const sourceRecord = item as Record<string, unknown>;
    const label =
      safeChartText(sourceRecord.label, 64) ??
      safeChartText(sourceRecord.name, 64) ??
      safeChartText(sourceRecord.type, 64);
    if (!label) {
      return [];
    }

    const evidenceIds = Array.isArray(sourceRecord.evidenceIds)
      ? sourceRecord.evidenceIds
          .flatMap((id) => {
            const text = safeChartText(id, 80);
            return text ? [text] : [];
          })
          .slice(0, 4)
      : [];

    return [
      {
        label,
        type: safeChartText(sourceRecord.type, 40) ?? undefined,
        query: safeChartText(sourceRecord.query, 120) ?? undefined,
        evidenceIds,
      },
    ];
  });

  const data = rawData.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      return [];

    const itemRecord = item as Record<string, unknown>;
    const labelValue = itemRecord[xKey];
    const row: Record<string, string | number> = {
      label:
        typeof labelValue === "number" || typeof labelValue === "string"
          ? String(labelValue).slice(0, 80)
          : "",
    };

    series.forEach((entry, index) => {
      const rawValue = itemRecord[entry.key];
      row[`series${index}`] =
        typeof rawValue === "number" && Number.isFinite(rawValue)
          ? rawValue
          : 0;
    });

    return row.label ? [row] : [];
  });

  if (data.length === 0) return null;

  return {
    title:
      typeof record.title === "string" && record.title.trim()
        ? record.title.trim().slice(0, 80)
        : undefined,
    description:
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim().slice(0, 160)
        : undefined,
    type,
    data,
    series,
    sources,
  };
}

function SreInlineChart({ chart }: { chart: ParsedSreChart }) {
  const showBrush = chart.data.length > 12;
  const chartConfig = chart.series.reduce<ChartConfig>(
    (config, series, index) => {
      config[`series${index}`] = {
        label: series.label,
        color: CHART_COLORS[index] ?? CHART_COLORS[0],
      };
      return config;
    },
    {},
  );
  const latestRow = chart.data.at(-1);
  const latestMetrics = latestRow
    ? chart.series.map((series, index) => ({
        label: series.label,
        value: latestRow[`series${index}`],
      }))
    : [];

  return (
    <div
      role="group"
      aria-label={chart.title ?? "Copilot evidence chart"}
      className="rounded-lg border bg-background p-3 shadow-sm"
    >
      {(chart.title ||
        chart.description ||
        chart.sources.length > 0 ||
        latestMetrics.length > 0) && (
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {chart.title && (
              <p className="text-sm font-medium">{chart.title}</p>
            )}
            {chart.description && (
              <p className="mt-1 text-xs text-muted-foreground">
                {chart.description}
              </p>
            )}
            {chart.sources.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {chart.sources.map((source) => (
                  <span
                    key={`${source.label}-${source.type ?? "source"}`}
                    title={[
                      source.label,
                      source.type,
                      source.query,
                      source.evidenceIds.length > 0
                        ? `Evidence: ${source.evidenceIds.join(", ")}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    className="inline-flex max-w-full min-w-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    <span className="shrink-0 font-medium text-foreground/80">
                      Source
                    </span>
                    <span className="max-w-36 truncate sm:max-w-48">
                      {source.label}
                    </span>
                    {source.type && (
                      <span className="shrink-0 text-muted-foreground/70">
                        {source.type}
                      </span>
                    )}
                    {source.evidenceIds.length > 0 && (
                      <span className="shrink-0 text-muted-foreground/70">
                        {source.evidenceIds.length} evidence
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
          {latestMetrics.length > 0 && (
            <div className="flex shrink-0 flex-wrap gap-2">
              {latestMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-md border bg-muted/30 px-2 py-1"
                >
                  <span className="block max-w-28 truncate text-[11px] text-muted-foreground">
                    {metric.label}
                  </span>
                  <span className="block font-mono text-xs font-medium tabular-nums">
                    {metric.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <ChartContainer config={chartConfig} className="h-56 w-full">
        {chart.type === "bar" ? (
          <BarChart
            data={chart.data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              minTickGap={16}
            />
            <YAxis tickLine={false} axisLine={false} width={36} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            {chart.series.map((_, index) => (
              <Bar
                key={`series${index}`}
                dataKey={`series${index}`}
                fill={`var(--color-series${index})`}
                radius={4}
              />
            ))}
            {showBrush && (
              <Brush
                dataKey="label"
                height={20}
                travellerWidth={8}
                fill="var(--muted)"
                stroke="var(--border)"
              />
            )}
          </BarChart>
        ) : chart.type === "line" ? (
          <LineChart
            data={chart.data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              minTickGap={16}
            />
            <YAxis tickLine={false} axisLine={false} width={36} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
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
            {showBrush && (
              <Brush
                dataKey="label"
                height={20}
                travellerWidth={8}
                fill="var(--muted)"
                stroke="var(--border)"
              />
            )}
          </LineChart>
        ) : (
          <AreaChart
            data={chart.data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              minTickGap={16}
            />
            <YAxis tickLine={false} axisLine={false} width={36} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            {chart.series.map((_, index) => (
              <Area
                key={`series${index}`}
                type="monotone"
                dataKey={`series${index}`}
                fill={`var(--color-series${index})`}
                fillOpacity={0.18}
                stroke={`var(--color-series${index})`}
                strokeWidth={2}
              />
            ))}
            {showBrush && (
              <Brush
                dataKey="label"
                height={20}
                travellerWidth={8}
                fill="var(--muted)"
                stroke="var(--border)"
              />
            )}
          </AreaChart>
        )}
      </ChartContainer>
    </div>
  );
}

function VirtualizedLargeOutput({ lines }: { lines: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LARGE_OUTPUT_LINE_HEIGHT,
    overscan: 12,
    initialRect: { width: 800, height: 384 },
  });

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/20">
      <div className="border-b bg-background px-3 py-2 text-xs text-muted-foreground">
        Large output · {lines.length.toLocaleString()} lines
      </div>
      <div
        ref={scrollRef}
        role="region"
        aria-label={`Large Copilot output, ${lines.length} lines`}
        tabIndex={0}
        className="h-96 overflow-auto font-mono text-xs leading-5 [scrollbar-gutter:stable]"
      >
        <div
          data-testid="virtualized-large-output"
          className="relative min-w-max"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualLine) => (
            <div
              key={virtualLine.key}
              data-index={virtualLine.index}
              className="absolute left-0 top-0 flex h-5 w-full min-w-max whitespace-pre px-3"
              style={{ transform: `translateY(${virtualLine.start}px)` }}
            >
              <span
                aria-hidden="true"
                className="mr-3 inline-block w-12 shrink-0 select-none text-right text-muted-foreground/60"
              >
                {virtualLine.index + 1}
              </span>
              <span>{lines[virtualLine.index] || " "}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SreMessageContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  if (lines.length >= LARGE_OUTPUT_LINE_THRESHOLD) {
    return <VirtualizedLargeOutput lines={lines} />;
  }

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
          className={cn(
            "font-semibold leading-6 text-foreground",
            level <= 2 ? "mt-2 text-base" : "mt-1 text-sm",
          )}
        >
          {renderInlineMarkdown(headingMatch[2] ?? "")}
        </p>,
      );
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      const language = trimmed.slice(3).trim();
      let codeIndex = index + 1;

      while (
        codeIndex < lines.length &&
        !(lines[codeIndex] ?? "").trim().startsWith("```")
      ) {
        codeLines.push(lines[codeIndex] ?? "");
        codeIndex += 1;
      }

      if (language === "chart") {
        const chart = parseSreChartBlock(codeLines.join("\n"));
        if (chart) {
          rendered.push(
            <SreInlineChart key={`chart-${index}`} chart={chart} />,
          );
          index = codeIndex;
          continue;
        }
      }

      rendered.push(
        <pre
          key={`code-${index}`}
          className="overflow-x-auto rounded-lg border bg-muted/30 p-3 text-xs leading-5"
        >
          {language && (
            <span className="mb-2 block text-[11px] font-medium text-muted-foreground">
              {language}
            </span>
          )}
          <code className="font-mono">{codeLines.join("\n")}</code>
        </pre>,
      );
      index = codeIndex;
      continue;
    }

    if (
      trimmed.includes("|") &&
      isMarkdownTableSeparator(lines[index + 1] ?? "")
    ) {
      const header = splitMarkdownTableRow(trimmed);
      const rows: string[][] = [];
      let tableIndex = index + 2;

      while (
        tableIndex < lines.length &&
        (lines[tableIndex] ?? "").trim().includes("|")
      ) {
        rows.push(splitMarkdownTableRow(lines[tableIndex] ?? ""));
        tableIndex += 1;
      }

      rendered.push(
        <div
          key={`table-${index}`}
          className="overflow-hidden rounded-lg border"
        >
          <Table className="bg-background text-xs">
            <TableHeader>
              <TableRow>
                {header.map((cell, cellIndex) => (
                  <TableHead
                    key={`${cell}-${cellIndex}`}
                    className="h-8 whitespace-normal px-3"
                  >
                    {renderInlineMarkdown(cell)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, rowIndex) => (
                <TableRow key={`row-${rowIndex}`}>
                  {header.map((_, cellIndex) => (
                    <TableCell
                      key={`cell-${rowIndex}-${cellIndex}`}
                      className="whitespace-normal px-3 py-2"
                    >
                      {renderInlineMarkdown(row[cellIndex] ?? "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>,
      );
      index = tableIndex - 1;
      continue;
    }

    const orderedMatch = /^(\d+)\.\s+(.*)$/.exec(trimmed);
    const unorderedMatch = /^[-*]\s+(.*)$/.exec(trimmed);

    if (!trimmed) {
      rendered.push(
        <div key={`break-${index}`} className="h-1" aria-hidden="true" />,
      );
      continue;
    }

    if (orderedMatch) {
      rendered.push(
        <div key={`${line}-${index}`} className="flex gap-2">
          <span className="mt-px min-w-5 shrink-0 font-medium text-muted-foreground">
            {orderedMatch[1]}.
          </span>
          <span className="min-w-0">
            {renderInlineMarkdown(orderedMatch[2] ?? "")}
          </span>
        </div>,
      );
      continue;
    }

    if (unorderedMatch) {
      rendered.push(
        <div key={`${line}-${index}`} className="flex gap-2">
          <span className="mt-px shrink-0 text-muted-foreground">-</span>
          <span className="min-w-0">
            {renderInlineMarkdown(unorderedMatch[1] ?? "")}
          </span>
        </div>,
      );
      continue;
    }

    rendered.push(
      <p key={`${line}-${index}`}>{renderInlineMarkdown(trimmed)}</p>,
    );
  }

  return <div className="flex flex-col gap-2">{rendered}</div>;
}
