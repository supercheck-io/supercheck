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
import { UserAvatar, UserCell } from "@/components/ui/user-cell";
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
  assigneeImage,
  role = "assignee",
  label = "Assignee",
  canUpdate,
}: {
  incidentId: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  assigneeImage?: string | null;
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
        <UserCell name={assigneeName} image={assigneeImage} avatarClassName="h-5 w-5" />
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
            {(() => {
              const person = assigneeUserId ? people.find((p) => p.id === assigneeUserId) : undefined;
              const name = assigneeUserId ? (person?.name ?? assigneeName ?? "Assigned") : null;
              return (
                <span className="flex items-center gap-2">
                  <UserAvatar name={name} image={person?.image ?? assigneeImage} className="h-5 w-5" />
                  {name ?? "Unassigned"}
                </span>
              );
            })()}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
          {people.map((person) => (
            <SelectItem key={person.id} value={person.id}>
              <span className="flex items-center gap-2">
                <UserAvatar name={person.name} image={person.image} className="h-5 w-5" />
                {person.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
