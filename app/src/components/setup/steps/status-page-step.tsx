"use client";

import { useEffect } from "react";

import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { StepProps } from "./step-types";

export function StatusPageStep({ response, draft, patchDraft, setStatusPageOptOut, permissions, readOnly }: StepProps) {
  const page = draft.statusPage ?? {};
  const optOut = Boolean(page.optOut);
  const monitors = draft.monitors?.pages ?? [];
  const extras = [draft.monitors?.heartbeat?.name, draft.monitors?.aiEndpoint?.name, draft.monitors?.mcpMonitor?.name].filter(Boolean) as string[];
  const components = [...monitors.map((m) => m.name), ...extras];
  const name = page.name ?? `${response.projectName} status`;
  const disabled = readOnly || !permissions.canCreateStatusPage;

  const set = (next: Partial<typeof page>) => patchDraft((d) => ({ ...d, statusPage: { ...d.statusPage, ...next } }));

  // First visit: store the default name shown in the field, or Review would create nothing for it.
  const untouched = !draft.statusPage;
  useEffect(() => {
    if (untouched && !disabled) patchDraft((d) => (d.statusPage ? d : { ...d, statusPage: { name } }));
  }, [untouched, disabled, name, patchDraft]);

  return (
    <div className="space-y-6">
      {!permissions.canCreateStatusPage ? <Alert variant="info">You do not have permission to create status pages. Ask a project admin.</Alert> : null}

      <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
        <div className="min-w-0">
          <Label htmlFor="setup-status-optout" className="text-sm font-semibold">
            I don&apos;t need a status page
          </Label>
          <p className="text-xs text-muted-foreground">You can create one any time from Status Pages. The checklist counts this as done.</p>
        </div>
        <Switch
          id="setup-status-optout"
          checked={optOut}
          disabled={readOnly}
          onCheckedChange={(on) => {
            set({ optOut: on });
            setStatusPageOptOut(on);
          }}
        />
      </div>

      {optOut ? (
        <Alert variant="info">No status page for this project. You can create one after all from Status Pages.</Alert>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="setup-status-name">Name</Label>
            <Input id="setup-status-name" value={name} maxLength={255} disabled={disabled} onChange={(event) => set({ name: event.target.value.trim() ? event.target.value : undefined })} />
            <p className="text-xs text-muted-foreground">An address is generated for you. Add a custom domain later in the page settings.</p>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
            <div className="min-w-0">
              <Label htmlFor="setup-status-publish" className="text-sm font-semibold">
                Publish now
              </Label>
              <p className="text-xs text-muted-foreground">Otherwise it stays a draft until you publish it.</p>
            </div>
            <Switch id="setup-status-publish" checked={Boolean(page.publish)} disabled={disabled} onCheckedChange={(publish) => set({ publish })} />
          </div>
          <section aria-labelledby="setup-status-components" className="space-y-2">
            <h3 id="setup-status-components" className="text-sm font-semibold">
              Components
            </h3>
            {components.length > 0 ? (
              <>
                <p className="text-xs text-muted-foreground">One component per monitor from the previous step.</p>
                <ul className="flex flex-wrap gap-2 text-sm">
                  {components.map((label) => (
                    <li key={label} className="rounded-md border px-2.5 py-1">
                      {label}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No monitors picked, so the page starts without components. Add them later from the page.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
