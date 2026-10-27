"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  discoverSreMcpTools,
  getSreMcpToolState,
  saveSreMcpToolAllowlist,
  type SreMcpToolState,
} from "@/actions/sre-mcp-connectors";
import type { SreConnectorListItem } from "@/actions/sre-connectors";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TableBadge } from "@/components/ui/table-badge";

type McpToolsDialogProps = {
  connector: SreConnectorListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FixedArgs = Record<string, string | number | boolean | null>;

function parseFixedArguments(text: string): FixedArgs | null {
  if (!text.trim()) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as FixedArgs)
      : null;
  } catch {
    return null;
  }
}

export function McpToolsDialog({ connector, open, onOpenChange }: McpToolsDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<SreMcpToolState | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});

  const apply = (next: SreMcpToolState) => {
    setState(next);
    setSelected(
      Object.fromEntries(
        next.allowlist.map((tool) => [
          tool.name,
          Object.keys(tool.fixedArguments).length > 0
            ? JSON.stringify(tool.fixedArguments)
            : "",
        ]),
      ),
    );
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getSreMcpToolState({ id: connector.id }).then((result) => {
      if (cancelled) return;
      if (result.success) apply(result.state);
      else toast.error(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open, connector.id]);

  const discover = () =>
    startTransition(async () => {
      const result = await discoverSreMcpTools({ id: connector.id });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      // Keep ticks the admin already made; new tools stay unticked. Drop ticks for
      // tools that disappeared or became unsupported so Save cannot get stuck.
      setState(result.state);
      setSelected((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([name]) =>
            result.state.discovered.some(
              (tool) => tool.name === name && !tool.unsupportedReason,
            ),
          ),
        ),
      );
      toast.success(result.message);
    });

  const save = () =>
    startTransition(async () => {
      const tools: Array<{ name: string; fixedArguments?: FixedArgs }> = [];
      for (const [name, text] of Object.entries(selected)) {
        const fixedArguments = parseFixedArguments(text);
        if (!fixedArguments) {
          toast.error(`Fixed arguments for ${name} must be a JSON object`);
          return;
        }
        tools.push({ name, fixedArguments });
      }
      const result = await saveSreMcpToolAllowlist({ id: connector.id, tools });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      apply(result.state);
      toast.success(result.message);
    });

  const toggle = (name: string) =>
    setSelected((current) => {
      const next = { ...current };
      if (Object.hasOwn(next, name)) delete next[name];
      else next[name] = "";
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>MCP tools for {connector.name}</DialogTitle>
          <DialogDescription>
            Discover the tools your server offers, then tick the read-only tools
            AI investigations may call. Nothing is callable until you allowlist
            it. Server-provided hints such as read-only are shown for reference
            and never grant access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Button type="button" variant="outline" onClick={discover} disabled={isPending}>
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Discover tools
          </Button>
          {state?.discoveredAt && (
            <p className="text-xs text-muted-foreground">
              Last discovered {new Date(state.discoveredAt).toLocaleString()}
            </p>
          )}

          {state && state.discovered.length === 0 && (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              No tools discovered yet.
            </p>
          )}

          <ul className="space-y-2">
            {state?.discovered.map((tool) => {
              const checked = Object.hasOwn(selected, tool.name);
              const blocked = Boolean(tool.unsupportedReason);
              return (
                <li key={tool.name} className="rounded-md border p-3">
                  <label className="flex items-start gap-3">
                    <Checkbox
                      checked={checked}
                      disabled={blocked && !checked}
                      onCheckedChange={() => toggle(tool.name)}
                      aria-label={`Allow ${tool.name}`}
                    />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="font-mono">{tool.name}</span>
                        {tool.readOnlyHint && (
                          <TableBadge tone="info" compact>
                            Server says read-only
                          </TableBadge>
                        )}
                        {tool.destructiveHint && (
                          <TableBadge tone="warning" compact>
                            Server says destructive
                          </TableBadge>
                        )}
                        {blocked && (
                          <TableBadge tone="warning" compact>
                            Cannot allowlist
                          </TableBadge>
                        )}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {tool.description || "No description"}
                      </span>
                      {blocked && (
                        <span className="block text-xs text-amber-700 dark:text-amber-300">
                          {tool.unsupportedReason}
                        </span>
                      )}
                    </span>
                  </label>
                  {checked && (
                    <div className="mt-2 pl-7">
                      <Input
                        value={selected[tool.name]}
                        onChange={(event) =>
                          setSelected((current) => ({
                            ...current,
                            [tool.name]: event.target.value,
                          }))
                        }
                        placeholder='Fixed arguments (optional JSON, not for secrets), e.g. {"namespace":"prod"}'
                        aria-label={`Fixed arguments for ${tool.name}`}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Arguments are validated against the saved schema before every call.
          </span>
          <Button type="button" onClick={save} disabled={isPending || !state}>
            Save allowlist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
