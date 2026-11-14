"use client";

import type { UseFormReturn } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SecretPicker } from "./secret-picker";
import type { FormValues } from "./monitor-form";
import type { MonitorFormData } from "@/lib/input-sanitizer";

export const AI_ENDPOINT_DEFAULT_URL = "https://api.openai.com/v1/chat/completions";
const MONTH_MINUTES = 30 * 24 * 60;

/** Each check is one paid call on the customer's key, so show the monthly count. */
export function monthlyCalls(intervalSeconds: number, locations: number): number {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return 0;
  return Math.round((MONTH_MINUTES * 60) / intervalSeconds) * Math.max(1, locations);
}

/** The AI endpoint preset config; empty optional fields are left out so the worker defaults apply. */
export function buildAiEndpointConfig(data: MonitorFormData): Record<string, unknown> {
  const text = (v?: string) => (v && v.trim() !== "" ? v.trim() : undefined);
  const num = (v?: string) => (text(v) === undefined ? undefined : Number(v));
  const aiEndpoint: Record<string, unknown> = { model: text(data.aiConfig_model) };
  if (!data.aiConfig_noKey) {
    aiEndpoint.secretKey = text(data.aiConfig_secretKey);
    aiEndpoint.keyHeader = text(data.aiConfig_keyHeader);
  }
  aiEndpoint.prompt = data.aiConfig_prompt && data.aiConfig_prompt.trim() !== "" ? data.aiConfig_prompt : undefined;
  aiEndpoint.maxTokens = num(data.aiConfig_maxTokens);
  aiEndpoint.expectText = text(data.aiConfig_expectText);
  aiEndpoint.firstTokenTimeoutMs = num(data.aiConfig_firstTokenTimeoutMs);
  for (const key of Object.keys(aiEndpoint)) if (aiEndpoint[key] === undefined) delete aiEndpoint[key];
  return { aiEndpoint, timeoutSeconds: num(data.aiConfig_timeoutSeconds) ?? 60 };
}

interface AiEndpointFieldsProps {
  form: UseFormReturn<FormValues>;
  projectId: string | null | undefined;
  locationCount: number;
}

export function AiEndpointFields({ form, projectId, locationCount }: AiEndpointFieldsProps) {
  const noKey = form.watch("aiConfig_noKey") === true;
  const calls = monthlyCalls(parseInt(form.watch("interval"), 10), locationCount);

  return (
    <div className="space-y-4" data-testid="ai-endpoint-fields">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="aiConfig_secretKey"
          render={({ field }) => (
            <FormItem>
              <FormLabel>API key secret</FormLabel>
              {noKey ? (
                <p className="text-sm text-muted-foreground">No key is sent.</p>
              ) : (
                <SecretPicker projectId={projectId} value={field.value} onChange={field.onChange} testId="ai-secret" label="API key secret" />
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="aiConfig_keyHeader"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Key header</FormLabel>
              <FormControl>
                <Input placeholder="Authorization" disabled={noKey} data-testid="ai-key-header" {...field} value={field.value ?? ""} />
              </FormControl>
              <p className="text-xs text-muted-foreground">Authorization sends a Bearer key; any other header name sends the raw key.</p>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="aiConfig_noKey"
        render={({ field }) => (
          <FormItem className="flex items-center gap-2 space-y-0">
            <FormControl>
              <Checkbox
                id="ai-no-key"
                checked={field.value === true}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                data-testid="ai-no-key"
              />
            </FormControl>
            <FormLabel htmlFor="ai-no-key" className="font-normal">
              No key (endpoint needs none)
            </FormLabel>
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="aiConfig_model"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Model</FormLabel>
            <FormControl>
              <Input placeholder="gpt-4o-mini" data-testid="ai-model" {...field} value={field.value ?? ""} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="aiConfig_prompt"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Prompt</FormLabel>
            <FormControl>
              <Textarea rows={2} placeholder="Reply with the single word OK." data-testid="ai-prompt" {...field} value={field.value ?? ""} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="aiConfig_maxTokens"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Max tokens</FormLabel>
              <FormControl>
                <Input inputMode="numeric" placeholder="16" data-testid="ai-max-tokens" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="aiConfig_expectText"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reply must contain</FormLabel>
              <FormControl>
                <Input placeholder="Optional, not case sensitive" data-testid="ai-expect-text" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="aiConfig_firstTokenTimeoutMs"
          render={({ field }) => (
            <FormItem>
              <FormLabel>First token limit (ms)</FormLabel>
              <FormControl>
                <Input inputMode="numeric" placeholder="15000" data-testid="ai-first-token-limit" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="aiConfig_timeoutSeconds"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Total time limit (seconds)</FormLabel>
              <FormControl>
                <Input inputMode="numeric" placeholder="60" data-testid="ai-total-limit" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <p className="text-sm text-muted-foreground" data-testid="ai-monthly-calls">
        Each check is one paid call on your key: about {calls.toLocaleString("en-US")} calls a month.
      </p>
    </div>
  );
}
