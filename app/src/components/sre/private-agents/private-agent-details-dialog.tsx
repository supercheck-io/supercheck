"use client";

import type { ReactNode } from "react";

import type { PrivateAgentListItem } from "@/actions/private-agents";
import type { SreConnectorListItem } from "@/actions/sre-connectors";
import { privateAgentScope, privateAgentStatusTones } from "@/components/sre/data-table/private-agents/columns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TableBadge } from "@/components/ui/table-badge";
import { DateCell } from "@/components/ui/table-cells";
import { UUIDField } from "@/components/ui/uuid-field";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function heartbeatState(agent: PrivateAgentListItem) {
  if (agent.status === "disabled") return null;
  if (!agent.lastHeartbeatAt) return { label: "No heartbeat yet", tone: "info" as const };
  if (agent.status === "connected") return { label: "On time", tone: "success" as const };
  return { label: "Heartbeat missed", tone: "warning" as const };
}

/** Read-only agent details, built from the list already loaded in the table. */
export function PrivateAgentDetailsDialog({
  agent,
  connectors,
  onOpenChange,
}: {
  agent: PrivateAgentListItem | null;
  /** Connectors already loaded on the Integrations tab; undefined until it has been opened. */
  connectors?: SreConnectorListItem[];
  onOpenChange: (open: boolean) => void;
}) {
  const state = agent ? heartbeatState(agent) : null;
  const usedBy = agent
    ? (connectors ?? []).filter((connector) => connector.privateAgent?.id === agent.id)
    : [];

  return (
    <Dialog open={Boolean(agent)} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-xl sm:w-full">
        <DialogHeader>
          <DialogTitle>{agent?.name}</DialogTitle>
          <DialogDescription>Private Agent details</DialogDescription>
        </DialogHeader>
        {agent && (
          <dl className="space-y-3">
            <Field label="Agent ID">
              <UUIDField value={agent.id} />
            </Field>
            <Field label="Status">
              <TableBadge
                tone={privateAgentStatusTones[agent.status]}
                compact
                className="capitalize"
              >
                {agent.status}
              </TableBadge>
            </Field>
            <Field label="Version">{agent.version ?? "Not reported"}</Field>
            <Field label="Region">{agent.region ?? "No region"}</Field>
            <Field label="Network">{agent.networkLabel ?? "No network label"}</Field>
            <Field label="Scope">{privateAgentScope(agent)}</Field>
            <Field label="Last heartbeat">
              <div className="flex items-center gap-2">
                <DateCell value={agent.lastHeartbeatAt} />
                {state && (
                  <TableBadge tone={state.tone} compact>
                    {state.label}
                  </TableBadge>
                )}
              </div>
            </Field>
            {agent.lastError && (
              <Field label="Last error">
                <span className="break-words text-destructive">{agent.lastError}</span>
              </Field>
            )}
            <Field label="Connectors">
              {connectors === undefined ? (
                <span className="text-muted-foreground">
                  Open the Integrations tab to load connectors.
                </span>
              ) : usedBy.length === 0 ? (
                <span className="text-muted-foreground">No connectors use this agent.</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {usedBy.map((connector) => (
                    <TableBadge key={connector.id} compact>
                      {connector.name}
                    </TableBadge>
                  ))}
                </div>
              )}
            </Field>
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}
