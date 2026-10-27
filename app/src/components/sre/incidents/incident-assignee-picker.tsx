"use client";

import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { assignSreIncident } from "@/actions/sre-incident-lifecycle";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSreIncidentAssignees } from "@/hooks/use-sre";
import { useProjectContext } from "@/hooks/use-project-context";
import {
  getSreIncidentDetailQueryKey,
  getSreIncidentTimelineQueryKey,
  getSreIncidentsQueryKey,
} from "@/lib/sre/query-keys";

const UNASSIGNED = "__unassigned__";

export function IncidentAssigneePicker({
  incidentId,
  assigneeUserId,
  assigneeName,
  role = "assignee",
  label = "Assignee",
  canUpdate,
}: {
  incidentId: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  role?: "assignee" | "commander";
  label?: string;
  canUpdate: boolean;
}) {
  const id = useId();
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const assignees = useSreIncidentAssignees(canUpdate);
  const people = assignees.data?.success ? assignees.data.assignees : [];

  if (!canUpdate) {
    return (
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <p className="text-sm">{assigneeName ?? "Unassigned"}</p>
      </div>
    );
  }

  const change = async (value: string) => {
    setPending(true);
    const result = await assignSreIncident({
      incidentId,
      assigneeUserId: value === UNASSIGNED ? null : value,
      role,
    }).catch(() => null).finally(() => setPending(false));
    if (!result?.success) {
      toast.error(result?.error ?? "Failed to assign incident");
      return;
    }
    toast.success(result.message);
    await Promise.allSettled(
      [
        getSreIncidentDetailQueryKey(projectId, incidentId),
        getSreIncidentTimelineQueryKey(projectId, incidentId),
        getSreIncidentsQueryKey(projectId),
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  };

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <Select
        value={assigneeUserId ?? UNASSIGNED}
        onValueChange={change}
        disabled={pending}
      >
        <SelectTrigger id={id} className="h-8 w-full">
          <SelectValue placeholder="Unassigned">
            {assigneeUserId
              ? (people.find((p) => p.id === assigneeUserId)?.name ?? assigneeName ?? "Assigned")
              : "Unassigned"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
          {people.map((person) => (
            <SelectItem key={person.id} value={person.id}>
              {person.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
