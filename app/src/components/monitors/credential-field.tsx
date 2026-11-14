"use client";

import type { UseFormReturn } from "react-hook-form";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SecretPicker } from "./secret-picker";
import type { FormValues } from "./monitor-form";

interface CredentialFieldProps {
  form: UseFormReturn<FormValues>;
  projectId: string | null | undefined;
  /** Basic auth password or bearer token. */
  kind: "password" | "token";
  /** An existing monitor keeps its inline value; the hint asks to move it. */
  hasStoredInline: boolean;
}

/** Bearer token or basic password: from a project secret (default) or typed inline. */
export function CredentialField({ form, projectId, kind, hasStoredInline }: CredentialFieldProps) {
  const label = kind === "token" ? "Bearer Token" : "Password";
  const inlineName = kind === "token" ? "httpConfig_authToken" : "httpConfig_authPassword";
  const source = form.watch("httpConfig_authSource") ?? "secret";
  const testId = `monitor-auth-${kind}`;

  return (
    <div className="space-y-2">
      <FormField
        control={form.control}
        name="httpConfig_authSource"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{label} source</FormLabel>
            <Select value={field.value ?? "secret"} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full" data-testid={`${testId}-source`}>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="secret">From project secret</SelectItem>
                <SelectItem value="inline">Enter value</SelectItem>
              </SelectContent>
            </Select>
          </FormItem>
        )}
      />
      {source === "secret" ? (
        <FormField
          control={form.control}
          name="httpConfig_authSecretKey"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{label} secret</FormLabel>
              <SecretPicker
                projectId={projectId}
                value={field.value}
                onChange={field.onChange}
                testId={`${testId}-secret`}
                label={`${label} secret`}
              />
              <FormMessage />
            </FormItem>
          )}
        />
      ) : (
        <FormField
          control={form.control}
          name={inlineName}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="off" placeholder={`Enter ${label.toLowerCase()}`} data-testid={`${testId}-inline`} {...field} value={field.value ?? ""} />
              </FormControl>
              {hasStoredInline && (
                <p className="text-xs text-muted-foreground" data-testid={`${testId}-move-hint`}>
                  Move this credential to a project secret.
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
}
