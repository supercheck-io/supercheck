"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProjectSecretNames } from "@/hooks/use-project-secrets";

interface SecretPickerProps {
  projectId: string | null | undefined;
  value: string | undefined;
  onChange: (value: string) => void;
  /** Stable prefix for the data-testid and the accessible label. */
  testId: string;
  label: string;
  disabled?: boolean;
}

/** Picks a project secret by name. Shows names only, with loading, error and empty states. */
export function SecretPicker({ projectId, value, onChange, testId, label, disabled }: SecretPickerProps) {
  const { data: names, isLoading, isError, error, refetch, isFetching } = useProjectSecretNames(projectId);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground" data-testid={`${testId}-loading`} role="status">Loading secrets…</p>;
  }
  if (isError) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid={`${testId}-error`} role="alert">
        <span className="text-destructive">{error instanceof Error ? error.message : "The secrets could not be loaded."}</span>
        <Button type="button" variant="secondary" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          Retry
        </Button>
      </div>
    );
  }
  // A stored name that no longer exists stays visible so the user sees what is saved.
  const options = names ?? [];
  const withCurrent = value && !options.includes(value) ? [value, ...options] : options;
  if (withCurrent.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid={`${testId}-empty`}>
        No secrets in this project yet.{" "}
        <Link href="/variables" className="underline underline-offset-4">
          Add a secret
        </Link>
      </p>
    );
  }
  return (
    <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full" aria-label={label} data-testid={testId}>
        <SelectValue placeholder="Select a secret" />
      </SelectTrigger>
      <SelectContent>
        {withCurrent.map((name) => (
          <SelectItem key={name} value={name} data-testid={`${testId}-option-${name}`}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
