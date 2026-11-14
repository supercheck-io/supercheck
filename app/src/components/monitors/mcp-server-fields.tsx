"use client";

import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SecretPicker } from "./secret-picker";
import type { FormValues } from "./monitor-form";
import type { MonitorFormData } from "@/lib/input-sanitizer";
import type { McpMonitorConfig } from "@/db/schema/types";
import { FORBIDDEN_KEY_HEADERS, MCP_TOOL_NAME } from "@/lib/monitor-validation";

export const MCP_DEFAULT_TIMEOUT = "30";
const MAX_REQUIRED_TOOLS = 50;
const MAX_ARGUMENT_BYTES = 8 * 1024;

export type McpAuthType = "none" | "bearer" | "header";
export type McpProtocol = "auto" | "2025" | "2026";

type McpFormFields = {
  interval: string;
  mcpConfig_authType?: McpAuthType;
  mcpConfig_secretKey?: string;
  mcpConfig_headerName?: string;
  mcpConfig_protocol?: McpProtocol;
  mcpConfig_requiredTools?: string[];
  mcpConfig_toolName?: string;
  mcpConfig_toolArgs?: string;
  mcpConfig_toolExpect?: string;
  mcpConfig_slowMs?: string;
  mcpConfig_timeoutSeconds?: string;
};

const intInRange = (value: string | undefined, min: number, max: number) =>
  value === undefined || value.trim() === "" || (/^\d+$/.test(value.trim()) && Number(value) >= min && Number(value) <= max);

/** Parses the arguments box; `undefined` means empty, `null` means not a JSON object. */
export function parseToolArguments(text: string | undefined): Record<string, unknown> | undefined | null {
  if (!text || text.trim() === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Field errors for the MCP Monitor; mirrors the limits the API enforces. */
export function addMcpIssues(data: McpFormFields, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
  const authType = data.mcpConfig_authType ?? "none";
  if (authType !== "none" && !data.mcpConfig_secretKey?.trim()) issue("mcpConfig_secretKey", "Select a secret");
  if (authType === "header") {
    const header = data.mcpConfig_headerName?.trim() ?? "";
    if (!header) issue("mcpConfig_headerName", "Enter a header name");
    else if (!/^[A-Za-z0-9-]{1,64}$/.test(header)) issue("mcpConfig_headerName", "Use letters, digits and hyphens only");
    else if (FORBIDDEN_KEY_HEADERS.has(header.toLowerCase())) issue("mcpConfig_headerName", "This header name is not allowed");
  }
  const tools = data.mcpConfig_requiredTools ?? [];
  if (tools.length > MAX_REQUIRED_TOOLS) issue("mcpConfig_requiredTools", `Add at most ${MAX_REQUIRED_TOOLS} tools`);
  else if (tools.some((name) => !MCP_TOOL_NAME.test(name))) {
    issue("mcpConfig_requiredTools", "Tool names use letters, digits and _ . : - (up to 128 characters)");
  }
  const toolName = data.mcpConfig_toolName?.trim() ?? "";
  if (toolName && !MCP_TOOL_NAME.test(toolName)) issue("mcpConfig_toolName", "Tool names use letters, digits and _ . : - (up to 128 characters)");
  const args = parseToolArguments(data.mcpConfig_toolArgs);
  if (args === null) issue("mcpConfig_toolArgs", "Enter a JSON object, for example {\"query\": \"ping\"}");
  else if (args && new TextEncoder().encode(JSON.stringify(args)).length > MAX_ARGUMENT_BYTES) {
    issue("mcpConfig_toolArgs", "Arguments must be at most 8 KiB");
  }
  if (!toolName && (args || data.mcpConfig_toolExpect?.trim())) issue("mcpConfig_toolName", "Enter the tool to call");
  if ((data.mcpConfig_toolExpect ?? "").length > 500) issue("mcpConfig_toolExpect", "Use 500 characters or fewer");
  if (!intInRange(data.mcpConfig_slowMs, 100, 60000)) issue("mcpConfig_slowMs", "Enter a whole number from 100 to 60000");
  if (!intInRange(data.mcpConfig_timeoutSeconds, 5, 60)) issue("mcpConfig_timeoutSeconds", "Enter a whole number from 5 to 60");
  if (Number(data.mcpConfig_timeoutSeconds || MCP_DEFAULT_TIMEOUT) > parseInt(data.interval, 10)) {
    issue("mcpConfig_timeoutSeconds", "The timeout cannot exceed the check interval");
  }
}

/** The MCP Monitor config; empty optional fields are left out so the worker defaults apply. */
export function buildMcpConfig(data: MonitorFormData): Record<string, unknown> {
  const text = (v?: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
  const authType = (data.mcpConfig_authType as McpAuthType | undefined) ?? "none";
  const mcp: McpMonitorConfig = {
    auth:
      authType === "none"
        ? { type: "none" }
        : { type: authType, secretKey: text(data.mcpConfig_secretKey), ...(authType === "header" ? { headerName: text(data.mcpConfig_headerName) } : {}) },
  };
  const protocol = data.mcpConfig_protocol as McpProtocol | undefined;
  if (protocol && protocol !== "auto") mcp.protocol = protocol;
  const required = (Array.isArray(data.mcpConfig_requiredTools) ? (data.mcpConfig_requiredTools as string[]) : []).filter(Boolean);
  if (required.length) mcp.requiredTools = required;
  const toolName = text(data.mcpConfig_toolName);
  if (toolName) {
    const args = parseToolArguments(text(data.mcpConfig_toolArgs));
    const expectText = text(data.mcpConfig_toolExpect);
    mcp.toolCall = { name: toolName, ...(args ? { arguments: args } : {}), ...(expectText ? { expectText } : {}) };
  }
  const slow = text(data.mcpConfig_slowMs);
  if (slow) mcp.slowMs = Number(slow);
  return { mcp, timeoutSeconds: Number(text(data.mcpConfig_timeoutSeconds) ?? MCP_DEFAULT_TIMEOUT) };
}

/** Form values for the edit page, from a stored `config`. */
export function mcpFormValues(config: { mcp?: McpMonitorConfig; timeoutSeconds?: number } | null | undefined) {
  const mcp = config?.mcp;
  return {
    mcpConfig_authType: mcp?.auth.type ?? "none",
    mcpConfig_secretKey: mcp?.auth.secretKey ?? "",
    mcpConfig_headerName: mcp?.auth.headerName ?? "",
    mcpConfig_protocol: mcp?.protocol ?? "auto",
    mcpConfig_requiredTools: mcp?.requiredTools ?? [],
    mcpConfig_toolName: mcp?.toolCall?.name ?? "",
    mcpConfig_toolArgs: mcp?.toolCall?.arguments ? JSON.stringify(mcp.toolCall.arguments, null, 2) : "",
    mcpConfig_toolExpect: mcp?.toolCall?.expectText ?? "",
    mcpConfig_slowMs: mcp?.slowMs === undefined ? "" : String(mcp.slowMs),
    mcpConfig_timeoutSeconds: String(config?.timeoutSeconds ?? MCP_DEFAULT_TIMEOUT),
  } satisfies Partial<FormValues>;
}

/** Chips input: Enter or comma adds a name, the x button removes it. Names are shown as plain text. */
function ToolChips({ value, onChange, id }: { value: string[]; onChange: (next: string[]) => void; id: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const names = draft.split(",").map((n) => n.trim()).filter((n) => n && !value.includes(n));
    if (names.length) onChange([...value, ...names]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <Input
        id={id}
        value={draft}
        placeholder="Type a tool name and press Enter"
        data-testid="mcp-required-tools-input"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && draft === "" && value.length) onChange(value.slice(0, -1));
        }}
      />
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Required tools" data-testid="mcp-required-tools">
          {value.map((name) => (
            <li key={name} className="inline-flex items-center gap-1 rounded-md bg-muted py-0.5 pl-2 pr-0.5 text-xs font-mono">
              <span className="break-all">{name}</span>
              <Button type="button" variant="ghost" size="icon" className="h-5 w-5" aria-label={`Remove ${name}`} onClick={() => onChange(value.filter((n) => n !== name))}>
                <X className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface McpServerFieldsProps {
  form: UseFormReturn<FormValues>;
  projectId: string | null | undefined;
}

export function McpServerFields({ form, projectId }: McpServerFieldsProps) {
  const authType = form.watch("mcpConfig_authType") ?? "none";
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="space-y-4" data-testid="mcp-server-fields">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="mcpConfig_authType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Login</FormLabel>
              <Select value={field.value ?? "none"} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full" data-testid="mcp-auth-type">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="bearer">Bearer token</SelectItem>
                  <SelectItem value="header">Custom header</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        {authType !== "none" && (
          <FormField
            control={form.control}
            name="mcpConfig_secretKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Secret</FormLabel>
                <SecretPicker projectId={projectId} value={field.value} onChange={field.onChange} testId="mcp-secret" label="Login secret" />
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </div>
      {authType === "header" && (
        <FormField
          control={form.control}
          name="mcpConfig_headerName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Header name</FormLabel>
              <FormControl>
                <Input placeholder="X-Api-Key" data-testid="mcp-header-name" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <FormField
        control={form.control}
        name="mcpConfig_requiredTools"
        render={({ field }) => (
          <FormItem>
            <FormLabel htmlFor="mcp-required-tools">Tools that must exist</FormLabel>
            <ToolChips id="mcp-required-tools" value={field.value ?? []} onChange={field.onChange} />
            <p className="text-xs text-muted-foreground">The check fails when one of these is missing from the server.</p>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="space-y-3 rounded-md border p-4">
        <div>
          <p className="text-sm font-medium">Call a tool</p>
          <p className="text-xs text-muted-foreground">Optional. Pick a read-only tool. It runs on every check.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="mcpConfig_toolName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tool name</FormLabel>
                <FormControl>
                  <Input placeholder="search_docs" data-testid="mcp-tool-name" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="mcpConfig_toolExpect"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Result must contain</FormLabel>
                <FormControl>
                  <Input placeholder="Optional, not case sensitive" data-testid="mcp-tool-expect" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="mcpConfig_toolArgs"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Arguments (JSON)</FormLabel>
              <FormControl>
                <Textarea rows={3} className="font-mono" placeholder='{"query": "ping"}' data-testid="mcp-tool-args" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="mcpConfig_slowMs"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Slow after (ms)</FormLabel>
              <FormControl>
                <Input inputMode="numeric" placeholder="Optional, e.g. 2000" data-testid="mcp-slow-ms" {...field} value={field.value ?? ""} />
              </FormControl>
              <p className="text-xs text-muted-foreground">Warns when a check is slower than this three times in a row.</p>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="mcpConfig_timeoutSeconds"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Timeout (seconds)</FormLabel>
              <FormControl>
                <Input inputMode="numeric" placeholder={MCP_DEFAULT_TIMEOUT} data-testid="mcp-timeout" {...field} value={field.value ?? ""} />
              </FormControl>
              <p className="text-xs text-muted-foreground">From 5 to 60. Default 30.</p>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="-ml-2 gap-1" data-testid="mcp-advanced-toggle">
            <ChevronRight className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-90" : ""}`} />
            Advanced
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <FormField
            control={form.control}
            name="mcpConfig_protocol"
            render={({ field }) => (
              <FormItem className="max-w-sm">
                <FormLabel>Protocol</FormLabel>
                <Select value={field.value ?? "auto"} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full" data-testid="mcp-protocol">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="2025">2025 handshake</SelectItem>
                    <SelectItem value="2026">2026 stateless</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Auto detects the version the server speaks.</p>
                <FormMessage />
              </FormItem>
            )}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
